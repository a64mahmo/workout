# Workout Tracker

A full-stack workout tracking app with training cycle management, session logging, exercise progression, and Fitbit integration.

**Production:** https://workout-production-cb80.up.railway.app

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS, shadcn/ui |
| Backend | FastAPI, SQLAlchemy (async), asyncpg |
| Database | PostgreSQL (Railway) / SQLite (local dev) |
| Auth | JWT via `httpOnly` cookies, bcrypt, rate limiting |
| Deployment | Docker (single container), nginx, supervisord, Railway |
| Integrations | Fitbit OAuth2 |

---

## Features

- **Training cycles** — Meso/micro cycle planning with goal tracking (Strength, Hypertrophy, Endurance)
- **Sessions** — Create, log, and complete workouts with real-time set tracking and rest timers
- **Exercise history** — Per-exercise progression view
- **Plans** — Reusable workout templates you can apply to sessions
- **Suggestions** — RPE-based weight recommendations and volume analysis by muscle group
- **Fitbit** — Sync steps, heart rate, sleep, and weight; today's stats on dashboard
- **Auth** — Secure JWT login/register with rate limiting and OWASP-compliant password rules

---

## Architecture

```
browser
  └── nginx (port $PORT, Railway)
        ├── /api/* → FastAPI :8000
        └── /*     → Next.js :3000
                        └── /api/* rewrites → FastAPI :8000  (local dev only)
```

Single Docker container runs three processes via **supervisord**:
- **nginx** — listens on `$PORT` (injected at startup via `envsubst`)
- **FastAPI (uvicorn)** — port 8000
- **Next.js** — port 3000

---

## Authentication

Login and register set an `httpOnly` JWT cookie. All protected API routes validate the cookie via the `get_current_user_id` dependency (`backend/app/deps.py`).

### Security properties
| Property | Implementation |
|---|---|
| Password storage | bcrypt via passlib |
| Session token | JWT HS256, 24h expiry |
| Token transport | `httpOnly; SameSite=lax; Secure` cookie |
| XSS protection | `httpOnly` prevents JS access to token |
| CSRF protection | `SameSite=lax` |
| Brute force | 5 attempts / 15 min per IP |
| Password policy | 8+ chars, uppercase, lowercase, digit (enforced in UI) |

### Flow
1. `POST /api/auth/register` or `/api/auth/login` — validates credentials, sets `access_token` cookie
2. Browser sends cookie automatically on every request (`withCredentials: true`)
3. FastAPI's `get_current_user_id` dep reads and verifies the JWT
4. `POST /api/auth/logout` clears the cookie

---

## Local Development

### Prerequisites
- Python 3.10+
- Node.js 18+

### Backend
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in values
uvicorn app.main:app --reload --port 8000
```

API docs at http://localhost:8000/api/docs

### Frontend
```bash
cd frontend
npm install
npm run dev
```

App at http://localhost:3000. API calls proxied to `http://localhost:8000` via Next.js rewrites.

### Environment Variables

**Backend** (`.env`):
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/workout
JWT_SECRET_KEY=your-long-random-secret
FITBIT_CLIENT_ID=
FITBIT_CLIENT_SECRET=
FITBIT_REDIRECT_URI=http://localhost:3000/settings/fitbit/callback
ALLOWED_ORIGINS=http://localhost:3000
```

**Frontend** (`.env.local`):
```env
# Leave empty — Next.js rewrites proxy /api/ to the backend
NEXT_PUBLIC_API_URL=
```

---

## Production Deployment (Railway)

### Required environment variables
```env
DATABASE_URL=postgresql://...      # from Railway Postgres addon
JWT_SECRET_KEY=                    # openssl rand -hex 32
FITBIT_CLIENT_ID=
FITBIT_CLIENT_SECRET=
FITBIT_REDIRECT_URI=https://your-app.up.railway.app/settings/fitbit/callback
ALLOWED_ORIGINS=https://your-app.up.railway.app
RAILWAY_ENVIRONMENT=production     # enables Secure flag on cookies
```

Set the deploy branch to `prod` in Railway service settings.

---

## API Endpoints

All endpoints except `/api/auth/register`, `/api/auth/login`, and `/api/health` require authentication (JWT cookie).

### Auth (`/api/auth`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register — sets JWT cookie |
| POST | `/api/auth/login` | Login — sets JWT cookie (rate limited) |
| POST | `/api/auth/logout` | Clear JWT cookie |
| GET | `/api/auth/me` | Get current user profile |

### Exercises (`/api/exercises`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/exercises` | List exercises (`?muscle_group=` filter) |
| GET | `/api/exercises/{id}` | Exercise details |
| GET | `/api/exercises/{id}/history` | Exercise history for current user |
| POST | `/api/exercises` | Create exercise |
| PUT | `/api/exercises/{id}` | Update exercise |
| DELETE | `/api/exercises/{id}` | Delete exercise |

### Meso Cycles (`/api/meso-cycles`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/meso-cycles` | List user's cycles |
| POST | `/api/meso-cycles` | Create cycle |
| PUT | `/api/meso-cycles/{id}` | Update cycle |
| DELETE | `/api/meso-cycles/{id}` | Delete cycle |
| GET | `/api/meso-cycles/{id}/micro-cycles` | List micro cycles |
| POST | `/api/meso-cycles/{id}/micro-cycles` | Create micro cycle |

### Sessions (`/api/sessions`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sessions` | List user's sessions |
| GET | `/api/sessions/{id}` | Session with exercises and sets |
| POST | `/api/sessions` | Create session |
| PUT | `/api/sessions/{id}` | Update session |
| DELETE | `/api/sessions/{id}` | Delete session |
| POST | `/api/sessions/{id}/start` | Start session |
| POST | `/api/sessions/{id}/complete` | Complete (calculates volume) |
| POST | `/api/sessions/{id}/cancel` | Cancel |
| POST | `/api/sessions/{id}/exercises` | Add exercise |
| PUT | `/api/sessions/session-exercises/{id}` | Update session exercise |
| DELETE | `/api/sessions/session-exercises/{id}` | Remove exercise |
| POST | `/api/sessions/session-exercises/{id}/sets` | Add set |
| PUT | `/api/sessions/exercise-sets/{id}` | Update set |
| DELETE | `/api/sessions/exercise-sets/{id}` | Delete set |

### Plans (`/api/plans`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/plans` | List user's plans |
| GET | `/api/plans/{id}` | Plan with sessions |
| POST | `/api/plans` | Create plan |
| DELETE | `/api/plans/{id}` | Delete plan |
| GET | `/api/plans/templates` | Built-in templates (PPL, Upper/Lower, Full Body) |
| POST | `/api/plans/{id}/sessions` | Add session to plan |
| PUT | `/api/plans/plan-sessions/{id}` | Update plan session |
| DELETE | `/api/plans/plan-sessions/{id}` | Delete plan session |
| POST | `/api/plans/plan-sessions/{id}/exercises` | Add exercise |
| PUT | `/api/plans/plan-exercises/{id}` | Update plan exercise |
| DELETE | `/api/plans/plan-exercises/{id}` | Delete plan exercise |
| GET | `/api/plans/plan-sessions/{id}/preview` | Preview with suggested weights |
| POST | `/api/plans/plan-sessions/{id}/apply` | Apply to a training session |

### Suggestions (`/api/suggestions`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/suggestions/exercises` | Exercise suggestions by volume |
| GET | `/api/suggestions/weight` | Weight suggestion by RPE (`?exercise_id=`) |
| GET | `/api/suggestions/muscle-groups` | Volume by muscle group |

### Fitbit (`/api/fitbit`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/fitbit/auth-url` | Get Fitbit OAuth2 URL |
| POST | `/api/fitbit/callback` | Exchange code for tokens |
| GET | `/api/fitbit/status` | Connection status |
| GET | `/api/fitbit/today-stats` | Steps, HR, weight, sleep for today |
| POST | `/api/fitbit/disconnect` | Clear tokens |
| POST | `/api/fitbit/sync-session/{id}` | Sync HR + health metrics for a session |

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |

---

## Database Schema

```
users                  — credentials + fitbit tokens
exercises              — global exercise library
meso_cycles            — 4-12 week training blocks
micro_cycles           — weekly breakdowns
training_sessions      — individual workouts
session_exercises      — exercises within a session
exercise_sets          — sets per exercise (reps, weight, RPE)
health_metrics         — Fitbit sleep/weight data per session
volume_history         — calculated volume per exercise per session
plans                  — reusable workout templates
plan_sessions          — sessions within a plan
plan_exercises         — exercises within a plan session
```

---

## Project Structure

```
workout/
├── Dockerfile
├── nginx.conf
├── supervisord.conf
├── start.sh
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth.py           # JWT login/register/logout/me
│   │   │   ├── exercises.py
│   │   │   ├── meso_cycles.py
│   │   │   ├── sessions.py
│   │   │   ├── plans.py
│   │   │   ├── suggestions.py
│   │   │   └── fitbit.py
│   │   ├── models/models.py      # SQLAlchemy ORM models
│   │   ├── schemas/schemas.py    # Pydantic DTOs
│   │   ├── services/
│   │   │   └── fitbit_service.py # Fitbit API client + auto token refresh
│   │   ├── deps.py               # get_current_user_id JWT dependency
│   │   ├── database.py
│   │   └── main.py
│   └── requirements.txt
└── frontend/
    └── src/
        ├── app/
        │   ├── page.tsx           # Dashboard
        │   ├── login/page.tsx     # Login page
        │   ├── register/page.tsx  # Register page
        │   ├── cycles/
        │   ├── sessions/
        │   ├── plans/
        │   ├── suggestions/
        │   ├── exercises/
        │   └── settings/
        ├── components/
        │   ├── app-shell.tsx      # Layout + auth guard wrapper
        │   ├── auth/
        │   │   └── auth-guard.tsx # Redirects unauthenticated users to /login
        │   ├── shared/
        │   │   └── navigation.tsx # Nav with logged-in user + logout
        │   └── ui/                # shadcn components
        ├── contexts/
        │   └── auth-context.tsx   # Auth state, login/register/logout
        └── lib/
            └── api.ts             # Axios with withCredentials, 401 handler
```

---

## Fitbit Setup

1. Register app at [dev.fitbit.com](https://dev.fitbit.com)
   - Callback URL: `http://localhost:3000/settings/fitbit/callback`
   - Scopes: `activity heartrate profile sleep weight`
2. Set `FITBIT_CLIENT_ID`, `FITBIT_CLIENT_SECRET`, `FITBIT_REDIRECT_URI` in backend `.env`
3. Go to Settings → Connect Fitbit

Tokens are automatically refreshed when within 5 minutes of expiry.

---

## Testing

```bash
cd backend
source venv/bin/activate
pytest tests/ -v
```

---

## License

MIT
