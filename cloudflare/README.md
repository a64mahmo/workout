# Workout Tracker on Cloudflare (Workers + Durable Objects + Workers AI)

Runs the whole app on Cloudflare's **Workers Free plan**: one Worker serves the
static Next.js export and the `/api/*` backend, with data in SQLite-backed
Durable Objects. It replaces the FastAPI + Postgres + nginx container, and the
API contract is the same, so the frontend is unchanged.

```
Browser ──► Worker (src/index.ts)
             ├─ static assets ─► ../frontend/out (Next.js `output: export`)
             ├─ /api/auth/*  ──► Directory DO  ("global": email → user id + password hash)
             └─ /api/*       ──► UserStore DO  (one per user: all of that user's data)
                                   └─ Workers AI (weight predictions, staging/prod)
```

| Piece | File |
|---|---|
| Worker entry: routing, auth, CORS, assets | `src/index.ts` |
| JWT (HS256) + PBKDF2 passwords, legacy bcrypt verify | `src/auth.ts` |
| Account directory DO | `src/directory.ts` |
| Per-user store DO + router | `src/store.ts`, `src/router.ts` |
| Schema (mirrors `backend/app/models`) | `src/schema.ts` |
| Routes (ports of `backend/app/api/*`) | `src/routes/*.ts` |
| Progression engine (port of `services/progression.py`) | `src/progression.ts` |
| Workers AI prediction layer | `src/ai.ts` |
| Env config (dev / staging / production) | `wrangler.jsonc` |

## Environments

`wrangler.jsonc` defines three, and bindings are repeated in each because they don't inherit:

| | Worker name | AI predictions | Command |
|---|---|---|---|
| local | `workout-tracker-dev` | off (rules engine) | `npm run dev` |
| staging | `workout-tracker-staging` | on | `npm run deploy:staging` |
| production | `workout-tracker` | on | `npm run deploy` |

**Vars** (in `wrangler.jsonc`): `ENVIRONMENT`, `ALLOWED_ORIGINS`, `FITBIT_REDIRECT_URI`, `AI_PREDICTIONS` (`on`/`off`), `AI_MODEL`.
Production is served at `https://workout.the-desk.ca` and staging at `https://staging.workout.the-desk.ca` (custom domain routes; the `the-desk.ca` zone must be in the same Cloudflare account).

**Secrets** (local: `.dev.vars`, copied from `.dev.vars.example`; deployed: `wrangler secret put`):

```sh
for s in JWT_SECRET_KEY ADMIN_TOKEN FITBIT_CLIENT_ID FITBIT_CLIENT_SECRET; do
  npx wrangler secret put $s --env production
done
```

Reuse the old `JWT_SECRET_KEY` and existing login cookies stay valid. `ADMIN_TOKEN` guards the import endpoints, so use a long random value (`openssl rand -hex 32`).

## Local development

```sh
cd cloudflare
npm install         # if npm blocks install scripts: npm install-scripts approve workerd esbuild
cp .dev.vars.example .dev.vars
npm run dev:full    # builds the static frontend, then `wrangler dev` on :8787
npm run smoke       # end-to-end API test against :8787 (or BASE=https://...)
```

Local DO data is kept in `.wrangler/state`. Frontend-only work can still use
`cd frontend && npm run dev` against the old backend.

## Deploy

```sh
npx wrangler login
npm run deploy              # production
```

The first deploy applies migration `v1`, which creates the `Directory` and `UserStore` SQLite classes.
Schema changes inside a DO need no migration (tables use `CREATE TABLE IF NOT EXISTS`).
New DO *classes* need a new migration tag.

## Migrating data from Railway/Postgres

```sh
cd backend && source venv/bin/activate
DATABASE_URL="postgresql://..." python export_for_cloudflare.py --out ./cf-export   # gitignored

for f in cf-export/*.json; do
  curl -sX POST https://<worker>/api/admin/import \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" --data @"$f"; echo
done
```

The import replaces that user's store and keeps all ids. Old **bcrypt** password hashes still work.
They're upgraded to PBKDF2 on first login, but pure-JS bcrypt takes about 300ms of CPU, which the Free plan's 10ms limit may reject.
If a migrated login fails, set a new password:

```sh
curl -sX POST https://<worker>/api/admin/set-password -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"email":"you@example.com","password":"..."}'
```

Verified locally: data created through the old FastAPI backend, exported, then
imported here returns identical responses on 96 GET endpoints, including every
weight suggestion. The only difference is that plan exercises now also include `target_rpe`.

## Workers AI predictions

`GET /api/suggestions/weight` still runs the rules engine first. With `AI_PREDICTIONS=on`, it then sends the
recent sets, the plan target and the rules baseline to `AI_MODEL` (JSON mode). The model's answer is used, but:

- the weight is clamped to ±10% of the rules suggestion and rounded to 2.5 lbs, and sets to 1–12
- any error, timeout (6s) or invalid output falls back to the rules result
- results are cached per (exercise, last logged session, plan context), so the AI runs only when there's new data.
  This keeps usage within the free 10,000 neurons/day.

The response shape is unchanged, with three added fields: `prediction_source` (`"ai"` or `"rules"`), `rules_suggested_weight`, `rules_adjustment_reason`.
The binding only exists in staging and production, because it always calls the real service. To try AI locally,
run `npx wrangler login && npx wrangler dev --env staging`.

## Free-plan limits to know

- **10ms CPU per request.** Password hashing on login/register is the heaviest step. PBKDF2-SHA256 at 100k
  iterations measured about 11.3ms, so it's set to 50k (about 5.7ms). On a paid plan, raise `PBKDF2_ITERATIONS` in
  `src/auth.ts`; stored hashes upgrade on next login. Other routes are in-process SQLite and pre-serialized JSON.
- **Durable Objects:** 100k requests/day, 5M rows read and 100k rows written per day, 5 GB storage.
  Registering a user seeds the 12-week program, about 400 row writes.
- Assets are served without invoking the Worker, except `/api/*`, `/sessions/*` and `/plans/*`.
  Those go through the Worker so `/sessions/<id>` can fall back to the prerendered `/sessions/_` page.

## Behaviour notes vs. the Python API

- All data routes now require auth and are scoped to the caller's own store. Before, several by-id routes had no ownership check.
- `POST /sessions/{id}/complete` still overwrites `start_time` with the completion time, same as before.
  That looks like an existing bug and is kept for parity.
- `/api/docs` (Swagger) is not served.
