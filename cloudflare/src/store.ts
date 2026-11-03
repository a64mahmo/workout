import { DurableObject } from "cloudflare:workers";
import { Db, type Row } from "./db";
import { HttpError, type ApiRequest, type ApiResponse } from "./http";
import { Router } from "./router";
import { exerciseRoutes, mesoRoutes } from "./routes/exercises";
import { fitbitRoutes } from "./routes/fitbit";
import { planRoutes, seedPrograms } from "./routes/plans";
import { sessionRoutes } from "./routes/sessions";
import { suggestionRoutes } from "./routes/suggestions";
import { SCHEMA, TABLE_COLUMNS } from "./schema";

const router = new Router();
router.get("/auth/me", ({ db }) => {
  const p = db.one("SELECT * FROM profile LIMIT 1");
  if (!p) throw new HttpError(404, "User not found");
  return { id: p.id, email: p.email, name: p.name, created_at: p.created_at ?? null, has_fitbit_connected: !!p.fitbit_access_token };
});
exerciseRoutes(router);
mesoRoutes(router);
sessionRoutes(router);
suggestionRoutes(router);
planRoutes(router);
fitbitRoutes(router);

export interface Profile {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export interface UserDump {
  profile: Profile & Row;
  tables: Record<string, Row[]>;
}

/** All data for one user, addressed by `USER_STORE.getByName(userId)`. */
export class UserStore extends DurableObject<Env> {
  private db: Db;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = new Db(ctx.storage.sql);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(SCHEMA);
    });
  }

  /** Route an API call. Sync handlers run inside one SQLite transaction. */
  async handle(userId: string, req: ApiRequest): Promise<ApiResponse> {
    const m = router.match(req.method, req.path);
    if (m === null) return { status: 404, body: '{"detail":"Not Found"}' };
    if (m === "method") return { status: 405, body: '{"detail":"Method Not Allowed"}' };
    const c = { db: this.db, userId, query: req.query, body: req.body, env: this.env };
    try {
      // The synchronous part of every handler runs in one SQLite transaction, so
      // a thrown HttpError rolls back partial writes. Fitbit handlers return a
      // Promise; their writes after an await commit individually.
      let result: unknown = this.ctx.storage.transactionSync(() => m.handler(c, m.params));
      if (result instanceof Promise) result = await result;
      return { status: 200, body: JSON.stringify(result ?? null) };
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: JSON.stringify({ detail: e.detail }) };
      console.error(`UserStore ${req.method} ${req.path} failed`, e);
      return { status: 500, body: '{"detail":"Internal Server Error"}' };
    }
  }

  initProfile(p: Profile): void {
    this.db.run(
      "INSERT OR IGNORE INTO profile (id, email, name, created_at) VALUES (?, ?, ?, ?)",
      p.id,
      p.email,
      p.name,
      p.created_at,
    );
  }

  seedDefaultPrograms(): void {
    this.ctx.storage.transactionSync(() => seedPrograms(this.db));
  }

  /** Replace this store's contents with an export from the old backend. */
  importDump(dump: UserDump): Record<string, number> {
    const counts: Record<string, number> = {};
    this.ctx.storage.transactionSync(() => {
      this.db.run("DELETE FROM profile");
      for (const t of Object.keys(TABLE_COLUMNS)) this.db.run(`DELETE FROM ${t}`);
      const p = dump.profile;
      this.db.insert("profile", {
        id: p.id,
        email: p.email,
        name: p.name,
        created_at: p.created_at ?? null,
        fitbit_access_token: p.fitbit_access_token ?? null,
        fitbit_refresh_token: p.fitbit_refresh_token ?? null,
        fitbit_user_id: p.fitbit_user_id ?? null,
        fitbit_token_expires_at: p.fitbit_token_expires_at ?? null,
      });
      for (const [table, cols] of Object.entries(TABLE_COLUMNS)) {
        const rows = dump.tables[table] ?? [];
        for (const row of rows) {
          this.db.insert(table, Object.fromEntries(cols.filter((k) => k in row).map((k) => [k, row[k]])));
        }
        counts[table] = rows.length;
      }
    });
    return counts;
  }
}
