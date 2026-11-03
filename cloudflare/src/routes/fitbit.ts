// Port of api/fitbit.py + services/fitbit_service.py using fetch().
import { z } from "zod";
import type { Db, Row } from "../db";
import { HttpError, nowIso, parse, str, uuid } from "../http";
import type { Ctx, Router } from "../router";
import { loadSessions } from "../serialize";

const BASE = "https://api.fitbit.com";
const TOKEN_URL = `${BASE}/oauth2/token`;
const AUTH_URL = "https://www.fitbit.com/oauth2/authorize";

class FitbitHttpError extends Error {
  constructor(public status: number) {
    super(`Fitbit HTTP ${status}`);
  }
}

const profile = (db: Db) => {
  const p = db.one("SELECT * FROM profile LIMIT 1");
  if (!p) throw new HttpError(404, "User not found");
  return p;
};
const naive = (ms: number) => new Date(ms).toISOString().slice(0, -1);
const parseNaive = (s: string) => new Date(s.endsWith("Z") ? s : s + "Z").getTime();

async function tokenRequest(env: Env, form: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env.FITBIT_CLIENT_ID}:${env.FITBIT_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form),
  });
  if (!res.ok) throw new FitbitHttpError(res.status);
  return res.json<{ access_token: string; refresh_token: string; user_id: string; expires_in: number }>();
}

function saveTokens(db: Db, id: string, t: { access_token: string; refresh_token: string; user_id?: string; expires_in: number }) {
  db.update("profile", id, {
    fitbit_access_token: t.access_token,
    fitbit_refresh_token: t.refresh_token,
    ...(t.user_id ? { fitbit_user_id: t.user_id } : {}),
    fitbit_token_expires_at: naive(Date.now() + t.expires_in * 1000),
  });
}

async function accessToken(c: Ctx, user: Row): Promise<string> {
  if (user.fitbit_token_expires_at && parseNaive(user.fitbit_token_expires_at) > Date.now() + 5 * 60_000) {
    return user.fitbit_access_token;
  }
  const t = await tokenRequest(c.env, { grant_type: "refresh_token", refresh_token: user.fitbit_refresh_token });
  saveTokens(c.db, user.id, t);
  user.fitbit_access_token = t.access_token;
  user.fitbit_token_expires_at = naive(Date.now() + t.expires_in * 1000);
  return t.access_token;
}

async function fitbitGet<T = Row>(token: string, path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new FitbitHttpError(res.status);
  return res.json<T>();
}

const metricToStats = (m: Row) => ({
  connected: true,
  steps: m.steps ?? null,
  resting_hr: m.resting_hr ?? null,
  weight_kg: m.weight_kg ?? null,
  body_fat_pct: m.body_fat_pct ?? null,
  sleep_duration_seconds: m.sleep_duration_seconds ?? null,
  sleep_score: m.sleep_score ?? null,
  sleep_efficiency: m.sleep_efficiency ?? null,
});

function saveDayStats(db: Db, date: string, stats: Row, syncedAt = nowIso()) {
  const existing = db.one("SELECT id FROM health_metrics WHERE date = ? ORDER BY rowid", date);
  const fields = {
    steps: stats.steps,
    resting_hr: stats.resting_hr,
    weight_kg: stats.weight_kg,
    body_fat_pct: stats.body_fat_pct,
    sleep_duration_seconds: stats.sleep_duration_seconds,
    sleep_score: stats.sleep_score,
    sleep_efficiency: stats.sleep_efficiency,
    fitbit_synced_at: syncedAt,
  };
  if (existing) db.update("health_metrics", existing.id, fields);
  else db.insert("health_metrics", { id: uuid(), date, created_at: nowIso(), ...fields });
}

async function todayStats(c: Ctx, user: Row, date: string | undefined, force: boolean) {
  const { db } = c;
  const today = date || new Date().toISOString().slice(0, 10);
  const cached = db.one("SELECT * FROM health_metrics WHERE date = ? AND fitbit_synced_at IS NOT NULL ORDER BY rowid", today);
  if (!force && cached && Date.now() - parseNaive(cached.fitbit_synced_at) < 3 * 3600_000) return metricToStats(cached);

  let token: string;
  try {
    token = await accessToken(c, user);
  } catch (e) {
    console.log(`Fitbit token refresh failed: ${e}`);
    return { connected: false };
  }

  const stats: Row = {
    connected: true,
    steps: null,
    resting_hr: null,
    weight_kg: null,
    body_fat_pct: null,
    sleep_duration_seconds: null,
    sleep_score: null,
    sleep_efficiency: null,
  };
  let rateLimited = false;
  const attempt = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      if (e instanceof FitbitHttpError && e.status === 429) rateLimited = true;
      console.log(`Fitbit ${label} error: ${e}`);
    }
  };

  await attempt("steps", async () => {
    const d = await fitbitGet(token, `/1/user/-/activities/steps/date/${today}/1d.json`);
    const a = d["activities-steps"] ?? [];
    if (a.length) stats.steps = Math.trunc(Number(a[0].value ?? 0));
  });
  await attempt("HR", async () => {
    const d = await fitbitGet(token, `/1/user/-/activities/heart/date/${today}/1d.json`);
    const a = d["activities-heart"] ?? [];
    if (a.length) stats.resting_hr = a[0].value?.restingHeartRate ?? null;
  });
  await attempt("weight", async () => {
    const d = await fitbitGet(token, `/1/user/-/body/log/weight/date/${today}/7d.json`);
    const w = d.weight ?? [];
    if (w.length) {
      stats.weight_kg = w[w.length - 1].weight ?? null;
      stats.body_fat_pct = w[w.length - 1].fat ?? null;
    }
  });
  await attempt("sleep", async () => {
    const d = await fitbitGet(token, `/1.2/user/-/sleep/date/${today}.json`);
    const s = d.sleep ?? [];
    if (s.length) {
      const main = s.find((x: Row) => x.isMainSleep) ?? s[0];
      stats.sleep_duration_seconds = Math.floor((main.duration ?? 0) / 1000);
      stats.sleep_efficiency = main.efficiency ?? null;
      stats.sleep_score = main.efficiency ?? null;
    }
  });

  if (rateLimited) {
    if (cached) return metricToStats(cached);
    // 5-minute retry placeholder (3h TTL minus 2h55m)
    saveDayStats(db, today, stats, naive(Date.now() - (2 * 3600 + 55 * 60) * 1000));
  } else {
    saveDayStats(db, today, stats);
  }
  return stats;
}

async function syncSession(c: Ctx, session: Row, user: Row) {
  const { db } = c;
  const date = session.actual_date || session.scheduled_date;
  if (!date) return;
  try {
    const token = await accessToken(c, user);
    const hr = await fitbitGet(token, `/1/user/-/activities/heart/date/${date}/1d.json`);
    const a = hr["activities-heart"] ?? [];
    if (a.length) {
      const v = a[0].value ?? {};
      const patch: Row = {};
      if (v.restingHeartRate) patch.average_hr = v.restingHeartRate;
      const peak = (v.heartRateZones ?? []).find((z: Row) => z.name === "Peak" && z.max);
      if (peak) patch.max_hr = peak.max;
      db.update("training_sessions", session.id, patch);
    }
  } catch (e) {
    console.log(`Error fetching heart rate: ${e}`);
  }

  try {
    let metric = db.one("SELECT id FROM health_metrics WHERE date = ? ORDER BY rowid", date);
    if (!metric) {
      metric = { id: uuid() };
      db.insert("health_metrics", { id: metric.id, date, session_id: session.id, created_at: nowIso() });
    } else db.update("health_metrics", metric.id, { session_id: session.id });

    const token = await accessToken(c, user);
    try {
      const s = (await fitbitGet(token, `/1.2/user/-/sleep/date/${date}.json`)).sleep ?? [];
      if (s.length) {
        const main = s.find((x: Row) => x.isMainSleep) ?? s[0];
        db.update("health_metrics", metric.id, {
          sleep_duration_seconds: Math.floor((main.duration ?? 0) / 1000),
          sleep_efficiency: main.efficiency ?? null,
        });
      }
    } catch (e) {
      console.log(`Error fetching sleep: ${e}`);
    }
    try {
      const w = (await fitbitGet(token, `/1/user/-/body/log/weight/date/${date}.json`)).weight ?? [];
      if (w.length) {
        const l = w[w.length - 1];
        db.update("health_metrics", metric.id, { weight_kg: l.weight ?? null, body_fat_pct: l.fat ?? null, bmi: l.bmi ?? null });
      }
    } catch (e) {
      console.log(`Error fetching weight: ${e}`);
    }
  } catch (e) {
    console.log(`Error syncing health metrics: ${e}`);
  }
}

export function fitbitRoutes(r: Router) {
  r.get("/fitbit/auth-url", ({ env }) => {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: env.FITBIT_CLIENT_ID ?? "",
      redirect_uri: env.FITBIT_REDIRECT_URI ?? "",
      scope: "activity heartrate profile sleep weight",
      state: uuid(),
    });
    return { url: `${AUTH_URL}?${params}` };
  });

  r.post("/fitbit/callback", async (c) => {
    const b = parse(z.object({ code: str, state: str }), c.body);
    const user = profile(c.db);
    let t;
    try {
      t = await tokenRequest(c.env, {
        code: b.code,
        grant_type: "authorization_code",
        redirect_uri: c.env.FITBIT_REDIRECT_URI ?? "",
        client_id: c.env.FITBIT_CLIENT_ID ?? "",
      });
    } catch (e) {
      throw new HttpError(500, `Fitbit token exchange failed: ${e}`);
    }
    saveTokens(c.db, user.id, t);
    return { message: "Fitbit connected successfully" };
  });

  r.post("/fitbit/disconnect", ({ db }) => {
    const user = profile(db);
    db.update("profile", user.id, {
      fitbit_access_token: null,
      fitbit_refresh_token: null,
      fitbit_user_id: null,
      fitbit_token_expires_at: null,
    });
    return { message: "Fitbit disconnected" };
  });

  r.get("/fitbit/status", ({ db }) => ({ connected: !!profile(db).fitbit_access_token }));

  r.get("/fitbit/today-stats", (c) => {
    const user = profile(c.db);
    if (!user.fitbit_access_token) return { connected: false };
    return todayStats(c, user, c.query.date, false);
  });

  r.post("/fitbit/sync-today", (c) => {
    const user = profile(c.db);
    if (!user.fitbit_access_token) return { connected: false };
    return todayStats(c, user, c.query.date, true);
  });

  r.post("/fitbit/sync-session/:id", async (c, { id }) => {
    const user = profile(c.db);
    if (!user.fitbit_access_token) throw new HttpError(400, "Fitbit not connected");
    const session = c.db.get("training_sessions", id);
    if (!session) throw new HttpError(404, "Session not found");
    await syncSession(c, session, user);
    return loadSessions(c, "WHERE id = ?", id)[0];
  });
}
