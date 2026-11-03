import { z } from "zod";
import { authCookie, clearAuthCookie, hashPassword, readCookie, signToken, verifyPassword, verifyToken } from "./auth";
import { HttpError, nowIso, parse, uuid, type ApiRequest } from "./http";
import { TEMPLATE_DETAILS, TEMPLATES } from "./routes/plans";
import type { UserDump } from "./store";

export { Directory } from "./directory";
export { UserStore } from "./store";

const directory = (env: Env) => env.DIRECTORY.getByName("global");
const store = (env: Env, userId: string) => env.USER_STORE.getByName(userId);

/** pydantic EmailStr lowercases the domain part. */
const email = z.email().transform((e) => {
  const at = e.lastIndexOf("@");
  return e.slice(0, at) + "@" + e.slice(at + 1).toLowerCase();
});
const UserCreate = z.object({ email, name: z.string(), password: z.string() });
const UserLogin = z.object({ email, password: z.string() });

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function secret(env: Env): string {
  if (!env.JWT_SECRET_KEY) throw new HttpError(500, "JWT_SECRET_KEY is not configured");
  return env.JWT_SECRET_KEY;
}

async function readBody(req: Request): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const text = await req.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(422, [{ loc: ["body"], msg: "JSON decode error", type: "json_invalid" }]);
  }
}

function requireAdmin(req: Request, env: Env) {
  const auth = req.headers.get("Authorization") ?? "";
  if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) throw new HttpError(401, "Not authenticated");
}

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/api/, "").replace(/\/+$/, "") || "/";
  const secure = url.protocol === "https:";

  // ── Public ──
  if (path === "/health") return json({ status: "healthy", service: "workout-tracker-api" });
  if (req.method === "GET" && path === "/plans/templates") return json(TEMPLATES);
  if (req.method === "GET" && path.startsWith("/plans/templates/")) {
    const id = decodeURIComponent(path.split("/")[3] ?? "");
    return json(TEMPLATE_DETAILS[id] ?? { error: "Template not found" });
  }

  // ── Auth (Worker + Directory) ──
  if (req.method === "POST" && path === "/auth/register") {
    const b = parse(UserCreate, await readBody(req));
    const userId = uuid();
    const createdAt = nowIso();
    const created = await directory(env).createAccount({
      email: b.email,
      user_id: userId,
      hashed_password: await hashPassword(b.password),
      created_at: createdAt,
    });
    if (!created) throw new HttpError(400, "Email already registered");
    const s = store(env, userId);
    await s.initProfile({ id: userId, email: b.email, name: b.name, created_at: createdAt });
    try {
      await s.seedDefaultPrograms();
    } catch (e) {
      console.error("Seeding default programs failed", e);
    }
    const token = await signToken(userId, secret(env));
    return json({ user_id: userId, message: "User registered successfully" }, 200, { "Set-Cookie": authCookie(token, secure) });
  }

  if (req.method === "POST" && path === "/auth/login") {
    const dir = directory(env);
    const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
    if (!(await dir.checkLoginRate(ip))) throw new HttpError(429, "Too many login attempts. Try again in 15 minutes.");
    const b = parse(UserLogin, await readBody(req));
    const acct = await dir.getAccount(b.email);
    const check = acct ? await verifyPassword(b.password, acct.hashed_password) : { ok: false, needsRehash: false };
    if (!acct || !check.ok) throw new HttpError(401, "Invalid credentials");
    if (check.needsRehash) await dir.setPassword(acct.email, await hashPassword(b.password));
    const token = await signToken(acct.user_id, secret(env));
    return json({ user_id: acct.user_id, message: "Login successful" }, 200, { "Set-Cookie": authCookie(token, secure) });
  }

  if (req.method === "POST" && path === "/auth/logout") {
    return json({ message: "Logged out" }, 200, { "Set-Cookie": clearAuthCookie(secure) });
  }

  // ── Admin (Bearer ADMIN_TOKEN) — data migration from the old backend ──
  if (req.method === "POST" && path === "/admin/import") {
    requireAdmin(req, env);
    const dump = (await readBody(req)) as UserDump & { hashed_password: string };
    if (!dump?.profile?.id || !dump.profile.email || !dump.hashed_password) throw new HttpError(422, "profile.id, profile.email and hashed_password are required");
    await directory(env).upsertAccount({
      email: dump.profile.email,
      user_id: dump.profile.id,
      hashed_password: dump.hashed_password,
      created_at: dump.profile.created_at ?? nowIso(),
    });
    const counts = await store(env, dump.profile.id).importDump(dump);
    return json({ message: "Imported", user_id: dump.profile.id, counts });
  }
  if (req.method === "POST" && path === "/admin/set-password") {
    requireAdmin(req, env);
    const b = parse(z.object({ email, password: z.string().min(1) }), await readBody(req));
    const ok = await directory(env).setPassword(b.email, await hashPassword(b.password));
    if (!ok) throw new HttpError(404, "User not found");
    return json({ message: "Password updated" });
  }

  // ── Everything else: authenticated, served by the user's Durable Object ──
  const token = readCookie(req, "access_token");
  if (!token) throw new HttpError(401, "Not authenticated");
  const userId = await verifyToken(token, secret(env));
  if (!userId) throw new HttpError(401, "Invalid token");

  const apiReq: ApiRequest = {
    method: req.method,
    path,
    query: Object.fromEntries(url.searchParams),
    body: await readBody(req),
  };
  const res = await store(env, userId).handle(userId, apiReq);
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
}

/** Next.js static export has one placeholder page per dynamic route ("_"). */
const DYNAMIC_ROUTE = /^\/(sessions|plans)\/([^/.]+)(.*)$/;

async function serveAsset(req: Request, env: Env, url: URL): Promise<Response> {
  const res = await env.ASSETS.fetch(req);
  if (res.status !== 404) return res;
  const m = DYNAMIC_ROUTE.exec(url.pathname);
  if (!m || m[2] === "_") return res;
  const fallback = new URL(url);
  fallback.pathname = `/${m[1]}/_${m[3]}`;
  return env.ASSETS.fetch(new Request(fallback, req));
}

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim());
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": req.headers.get("Access-Control-Request-Headers") ?? "*",
    Vary: "Origin",
  };
}

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/") && url.pathname !== "/api") return serveAsset(req, env, url);

    const corsHeaders = cors(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

    let res: Response;
    try {
      res = await handleApi(req, env, url);
    } catch (e) {
      if (e instanceof HttpError) res = json({ detail: e.detail }, e.status);
      else {
        console.error("Unhandled API error", e);
        res = json({ detail: "Internal Server Error" }, 500);
      }
    }
    for (const [k, v] of Object.entries(corsHeaders)) res.headers.set(k, v);
    return res;
  },
} satisfies ExportedHandler<Env>;
