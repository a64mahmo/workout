import { DurableObject } from "cloudflare:workers";

export type Account = {
  email: string;
  user_id: string;
  hashed_password: string;
  created_at: string;
};

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 5;

/**
 * Global account directory (single instance, "global"). Only login/register
 * touch it; all per-user data lives in that user's UserStore.
 */
export class Directory extends DurableObject<Env> {
  /** In-memory login throttle, same semantics as the old in-process dict. */
  private attempts = new Map<string, number[]>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
          email TEXT PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE,
          hashed_password TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
    });
  }

  /** Records an attempt; returns false if the IP is over the limit. */
  checkLoginRate(ip: string): boolean {
    const now = Date.now();
    const recent = (this.attempts.get(ip) ?? []).filter((t) => t > now - RATE_WINDOW_MS);
    if (recent.length >= RATE_MAX) {
      this.attempts.set(ip, recent);
      return false;
    }
    recent.push(now);
    this.attempts.set(ip, recent);
    return true;
  }

  getAccount(email: string): Account | null {
    return (
      this.ctx.storage.sql
        .exec<Account>("SELECT * FROM accounts WHERE email = ?", email)
        .toArray()[0] ?? null
    );
  }

  /** Returns false if the email is taken. */
  createAccount(a: Account): boolean {
    if (this.getAccount(a.email)) return false;
    this.ctx.storage.sql.exec(
      "INSERT INTO accounts (email, user_id, hashed_password, created_at) VALUES (?, ?, ?, ?)",
      a.email,
      a.user_id,
      a.hashed_password,
      a.created_at,
    );
    return true;
  }

  /** Insert or replace (used by the admin import). */
  upsertAccount(a: Account): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO accounts (email, user_id, hashed_password, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET user_id = excluded.user_id,
         hashed_password = excluded.hashed_password, created_at = excluded.created_at`,
      a.email,
      a.user_id,
      a.hashed_password,
      a.created_at,
    );
  }

  setPassword(email: string, hashed: string): boolean {
    const cur = this.ctx.storage.sql.exec("UPDATE accounts SET hashed_password = ? WHERE email = ?", hashed, email);
    return cur.rowsWritten > 0;
  }
}
