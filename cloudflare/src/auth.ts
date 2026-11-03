import bcrypt from "bcryptjs";

const enc = new TextEncoder();

// ── base64url ────────────────────────────────────────────────────────────────
function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ── JWT (HS256) — wire-compatible with the python-jose tokens the old API issued
// Imported once per isolate instead of on every request.
let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null;
function hmacKey(secret: string): Promise<CryptoKey> {
  if (cachedKey?.secret !== secret) {
    cachedKey = {
      secret,
      key: crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]),
    };
  }
  return cachedKey.key;
}

export const TOKEN_TTL_SECONDS = 24 * 3600;

export async function signToken(userId: string, secret: string): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = b64url(enc.encode(JSON.stringify({ sub: userId, exp })));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}

/** Returns the user id, or null when the token is missing, forged or expired. */
export async function verifyToken(token: string, secret: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  try {
    const header = JSON.parse(new TextDecoder().decode(fromB64url(h)));
    if (header.alg !== "HS256") return null;
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(s), enc.encode(`${h}.${p}`));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(p)));
    if (typeof payload.exp === "number" && payload.exp < Date.now() / 1000) return null;
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

// ── Passwords ────────────────────────────────────────────────────────────────
// PBKDF2-SHA256 via WebCrypto. Stored as pbkdf2_sha256$<iter>$<salt b64>$<hash b64>.
// 50k iterations measured ~5.7ms CPU (100k was ~11.3ms), keeping login/register
// under the Workers Free plan's 10ms CPU limit. On a paid plan raise it (max
// 100k in Workers); old hashes are re-hashed on next login automatically.
const PBKDF2_ITERATIONS = 50_000;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Verify a password. `needsRehash` is true for legacy bcrypt hashes imported
 * from the old Python backend so the caller can upgrade them after login.
 * Note: bcrypt in pure JS is CPU-heavy and may exceed the Free plan's 10ms CPU
 * limit; use the admin set-password endpoint if a legacy login fails.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<{ ok: boolean; needsRehash: boolean }> {
  if (stored.startsWith("pbkdf2_sha256$")) {
    const [, iter, salt, hash] = stored.split("$");
    const got = await pbkdf2(password, fromB64(salt), Number(iter));
    const ok = timingSafeEqual(got, fromB64(hash));
    return { ok, needsRehash: ok && Number(iter) !== PBKDF2_ITERATIONS };
  }
  if (/^\$2[aby]\$/.test(stored)) {
    const ok = await bcrypt.compare(password, stored);
    return { ok, needsRehash: ok };
  }
  return { ok: false, needsRehash: false };
}

// ── Cookies ──────────────────────────────────────────────────────────────────
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function authCookie(token: string, secure: boolean): string {
  return `access_token=${token}; HttpOnly; Max-Age=${TOKEN_TTL_SECONDS}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function clearAuthCookie(secure: boolean): string {
  return `access_token=""; HttpOnly; Max-Age=0; Path=/; SameSite=Lax${secure ? "; Secure" : ""}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}
