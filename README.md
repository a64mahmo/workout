# Workout Tracker - Full-Stack Training System

A sophisticated, full-stack workout tracking and planning application designed for athletes and fitness enthusiasts. This system manages structured training programs via **Meso Cycles** (4-12 weeks), tracks individual **Sessions**, provides **Training Plans** with templates, and delivers **Intelligent Suggestions** based on historical volume data.

---

## System Architecture

The project follows a modern decoupled architecture:

- **Frontend:** Next.js 16 Web App with React 19, cross-compiled for mobile (iOS) using Capacitor.
- **Backend:** FastAPI (Python) with async SQLAlchemy ORM for high-concurrency database access.
- **Database:** SQLite (local development) via `aiosqlite`, with PostgreSQL support for production.

### Component Diagram
```
┌─────────────────┐     ┌─────────────────┐
│   Capacitor /   │     │   Web Browser   │
│     iOS App      │     │                 │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │
              ┌──────▼──────┐
              │  Next.js    │
              │  Frontend   │
              └──────┬──────┘
                     │
              ┌──────▼──────┐
              │   FastAPI   │
              │   Backend   │
              └──────┬──────┘
                     │
              ┌──────▼──────┐
              │   SQLite /  │
              │ PostgreSQL  │
              └─────────────┘
```

---

## Key Features

### Training Management
- **Meso Cycle Management:** Organize training into 4-12 week blocks with specific goals (Strength, Hypertrophy, Endurance).
- **Micro Cycle Support:** Weekly breakdowns within meso cycles (Normal, Deload, Peak focus).
- **Session Tracking:** Log sets, reps, weight, and RPE (Rate of Perceived Exertion) in real-time.
- **Volume Calculation:** Automatic calculation of total training volume per session and exercise.

### Training Plans
- **Plan Templates:** Pre-built templates (Push/Pull/Legs, Upper/Lower, Full Body).
- **Custom Plans:** Create personalized training plans with target sets, reps, and weights.
- **Plan Application:** Apply plan sessions directly to training sessions.
- **Session Preview:** Preview plan sessions with suggested weights.

### Intelligent Suggestions
- **Exercise Prioritization:** Based on rolling 30-day volume data per muscle group.
- **Weight Prediction:** RPE-based weight recommendations (Deload, Recovery, Progression).
- **Muscle Group Analysis:** Track volume distribution across muscle groups.

### Mobile Support
- **Native iOS:** Capacitor integration for iOS deployment.
- **Responsive Web:** Mobile-first responsive design.

---

## Tech Stack

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| [Next.js](https://nextjs.org/) | 16.2.1 | React framework with App Router |
| [React](https://react.dev/) | 19.2.4 | UI library |
| [Tailwind CSS](https://tailwindcss.com/) | v4 | Utility-first CSS |
| [shadcn/ui](https://ui.shadcn.com/) | 4.1.0 | UI component library (Radix UI) |
| [TanStack Query](https://tanstack.com/query/latest) | 5.95.2 | Server state management |
| [React Hook Form](https://react-hook-form.com/) | 7.72.0 | Form handling |
| [Zod](https://zod.dev/) | 4.3.6 | Schema validation |
| [Axios](https://axios-http.com/) | 1.13.6 | HTTP client |
| [Capacitor](https://capacitorjs.com/) | 8.2.0 | Native mobile support |
| [date-fns](https://date-fns.org/) | 4.1.0 | Date utilities |
| [Lucide React](https://lucide.dev/) | 1.6.0 | Icon library |

### Backend
| Technology | Version | Purpose |
|------------|---------|---------|
| [FastAPI](https://fastapi.tiangolo.com/) | 0.135.2 | Async Python web framework |
| [SQLAlchemy](https://www.sqlalchemy.org/) | 2.0.35 | Async ORM |
| [aiosqlite](https://pypi.org/project/aiosqlite/) | 0.20.0 | Async SQLite driver |
| [Pydantic](https://docs.pydantic.dev/) | 2.12.1 | Data validation |
| [Passlib](https://passlib.readthedocs.io/) | 1.7.4 | Password hashing (bcrypt) |
| [python-jose](https://pyjwt.readthedocs.io/) | 3.4.0 | JWT token handling |
| [Alembic](https://alembic.sqlalchemy.org/) | 1.13.3 | Database migrations |
| [pytest](https://docs.pytest.org/) | 8.3.2 | Testing framework |
| [httpx](https://www.python-httpx.org/) | 0.27.0 | Async HTTP testing |
| [pytest-asyncio](https://pytest-asyncio.readthedocs.io/) | 0.23.8 | Async test support |

---

## Database Schema

### Core Tables

```
users
├── id (UUID, PK)
├── email (VARCHAR, UNIQUE)
├── name (VARCHAR)
├── hashed_password (VARCHAR)
└── created_at (TIMESTAMP)

exercises
├── id (UUID, PK)
├── name (VARCHAR)
├── muscle_group (VARCHAR)
├── description (TEXT)
└── created_at (TIMESTAMP)

meso_cycles
├── id (UUID, PK)
├── user_id (FK → users)
├── name (VARCHAR)
├── start_date (DATE)
├── end_date (DATE)
├── goal (VARCHAR: strength/hypertrophy/endurance)
├── is_active (BOOLEAN)
└── created_at (TIMESTAMP)

micro_cycles
├── id (UUID, PK)
├── meso_cycle_id (FK → meso_cycles)
├── week_number (INT)
├── focus (VARCHAR: deload/peak/normal)
├── start_date (DATE)
└── end_date (DATE)

training_sessions
├── id (UUID, PK)
├── user_id (FK → users)
├── meso_cycle_id (FK → meso_cycles, nullable)
├── micro_cycle_id (FK → micro_cycles, nullable)
├── name (VARCHAR)
├── scheduled_date (DATE)
├── actual_date (DATE, nullable)
├── status (VARCHAR: scheduled/completed/cancelled)
├── notes (TEXT, nullable)
└── total_volume (FLOAT)

session_exercises
├── id (UUID, PK)
├── session_id (FK → training_sessions)
├── exercise_id (FK → exercises)
├── order_index (INT)
└── notes (TEXT, nullable)

exercise_sets
├── id (UUID, PK)
├── session_exercise_id (FK → session_exercises)
├── set_number (INT)
├── reps (INT)
├── weight (FLOAT)
├── rpe (FLOAT, 1-10, nullable)
├── is_warmup (BOOLEAN)
├── is_completed (BOOLEAN)
└── created_at (TIMESTAMP)

volume_history
├── id (UUID, PK)
├── user_id (FK → users)
├── exercise_id (FK → exercises)
├── session_id (FK → training_sessions)
├── total_volume (FLOAT: reps × weight)
└── calculated_at (TIMESTAMP)

plans
├── id (UUID, PK)
├── user_id (FK → users)
├── name (VARCHAR)
├── description (TEXT, nullable)
├── is_active (BOOLEAN)
├── meso_cycle_id (FK → meso_cycles, nullable)
└── created_at (TIMESTAMP)

plan_sessions
├── id (UUID, PK)
├── plan_id (FK → plans)
├── name (VARCHAR)
├── order_index (INT)
├── scheduled_date (DATE, nullable)
└── notes (TEXT, nullable)

plan_exercises
├── id (UUID, PK)
├── plan_session_id (FK → plan_sessions)
├── exercise_id (FK → exercises)
├── order_index (INT)
├── target_sets (INT)
├── target_reps (INT)
├── target_weight (FLOAT, nullable)
├── target_rpe (FLOAT, nullable)
├── rest_seconds (INT)
└── notes (TEXT, nullable)
```

---

## API Endpoints

### Authentication (`/api/auth`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login user |
| GET | `/api/auth/me` | Get current user profile |

### Exercises (`/api/exercises`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/exercises` | List all exercises (optional `?muscle_group=` filter) |
| GET | `/api/exercises/{id}` | Get exercise details |
| GET | `/api/exercises/{id}/history` | Get exercise history for user |
| POST | `/api/exercises` | Create new exercise |
| PUT | `/api/exercises/{id}` | Update exercise |
| DELETE | `/api/exercises/{id}` | Delete exercise |

### Meso Cycles (`/api/meso-cycles`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/meso-cycles` | List user's meso cycles |
| GET | `/api/meso-cycles/{id}` | Get meso cycle details |
| POST | `/api/meso-cycles` | Create meso cycle |
| PUT | `/api/meso-cycles/{id}` | Update meso cycle |
| DELETE | `/api/meso-cycles/{id}` | Delete meso cycle |
| GET | `/api/meso-cycles/{id}/micro-cycles` | List micro cycles |
| POST | `/api/meso-cycles/{id}/micro-cycles` | Create micro cycle |

### Training Sessions (`/api/sessions`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sessions` | List user's sessions |
| GET | `/api/sessions/{id}` | Get session with exercises and sets |
| POST | `/api/sessions` | Create session |
| PUT | `/api/sessions/{id}` | Update session |
| DELETE | `/api/sessions/{id}` | Delete session |
| POST | `/api/sessions/{id}/complete` | Complete session (calculates volume) |
| POST | `/api/sessions/{id}/exercises` | Add exercise to session |
| PUT | `/api/sessions/session-exercises/{id}` | Update session exercise |
| DELETE | `/api/sessions/session-exercises/{id}` | Remove exercise from session |
| POST | `/api/sessions/session-exercises/{id}/sets` | Add set to exercise |
| PUT | `/api/sessions/exercise-sets/{id}` | Update set |
| DELETE | `/api/sessions/exercise-sets/{id}` | Delete set |

### Training Plans (`/api/plans`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/plans` | List user's plans |
| GET | `/api/plans/{id}` | Get plan with sessions |
| POST | `/api/plans` | Create plan |
| DELETE | `/api/plans/{id}` | Delete plan |
| GET | `/api/plans/templates` | List plan templates |
| GET | `/api/plans/templates/{id}` | Get template details |
| POST | `/api/plans/{id}/sessions` | Add session to plan |
| PUT | `/api/plans/plan-sessions/{id}` | Update plan session |
| DELETE | `/api/plans/plan-sessions/{id}` | Delete plan session |
| POST | `/api/plans/plan-sessions/{id}/exercises` | Add exercise to plan session |
| PUT | `/api/plans/plan-exercises/{id}` | Update plan exercise |
| DELETE | `/api/plans/plan-exercises/{id}` | Delete plan exercise |
| GET | `/api/plans/plan-sessions/{id}/preview` | Preview plan session |
| POST | `/api/plans/plan-sessions/{id}/apply` | Apply plan to training session |

### Suggestions (`/api/suggestions`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/suggestions/exercises` | Get exercise suggestions by volume |
| GET | `/api/suggestions/weight` | Get weight suggestions by RPE |
| GET | `/api/suggestions/muscle-groups` | Get volume by muscle group |

### Health Check
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check endpoint |

---

## Suggestion Engine Logic

### Exercise Volume-Based Suggestions
Calculates rolling 30-day total volume per exercise:
- `> 10,000 lbs`: "High volume - maintain current intensity"
- `5,000 - 10,000 lbs`: "Moderate volume - consider progression"
- `< 5,000 lbs`: "Low volume - good for adding volume"
- `0 lbs`: "New exercise - start with light weight"

### Weight Prediction (RPE-Based)
Analyzes last 50 completed sets for an exercise:
- **High Intensity (Avg RPE > 8):** Deload - 60% of average weight
- **Moderate Intensity (Avg RPE 7-8):** Recovery - 85% of average weight
- **Optimal Intensity (Avg RPE < 7):** Progression - 102.5% of average weight

---

## Project Structure

```
workout/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth.py           # Authentication endpoints
│   │   │   ├── exercises.py     # Exercise CRUD + history
│   │   │   ├── meso_cycles.py   # Meso/micro cycle endpoints
│   │   │   ├── sessions.py      # Training session endpoints
│   │   │   ├── plans.py         # Training plan endpoints
│   │   │   ├── suggestions.py   # Suggestion engine endpoints
│   │   │   └── __init__.py       # Router exports
│   │   ├── models/
│   │   │   ├── models.py        # SQLAlchemy models
│   │   │   └── __init__.py
│   │   ├── schemas/
│   │   │   ├── schemas.py       # Pydantic DTOs
│   │   │   └── __init__.py
│   │   ├── database.py          # Async DB session config
│   │   ├── main.py              # FastAPI app entry point
│   │   └── __init__.py
│   ├── tests/
│   │   ├── test_conn.py         # Connection tests
│   │   └── test_main.py         # API endpoint tests
│   ├── requirements.txt         # Python dependencies
│   ├── seed.py                  # Database seeding script
│   └── workout.db               # SQLite database file
│
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx         # Dashboard
│   │   │   ├── layout.tsx       # Root layout
│   │   │   ├── globals.css      # Global styles
│   │   │   ├── exercises/
│   │   │   │   └── page.tsx     # Exercise library
│   │   │   ├── cycles/
│   │   │   │   └── page.tsx     # Meso cycle management
│   │   │   ├── sessions/
│   │   │   │   ├── page.tsx     # Session list
│   │   │   │   └── [id]/
│   │   │   │       └── page.tsx # Session detail/editor
│   │   │   ├── suggestions/
│   │   │   │   └── page.tsx     # Suggestions view
│   │   │   └── plans/
│   │   │       ├── page.tsx     # Plans list
│   │   │       └── [id]/
│   │   │           └── page.tsx # Plan detail
│   │   ├── components/
│   │   │   ├── providers.tsx    # React Query providers
│   │   │   ├── shared/
│   │   │   │   └── navigation.tsx # Navigation component
│   │   │   └── ui/              # shadcn/ui components
│   │   │       ├── button.tsx
│   │   │       ├── card.tsx
│   │   │       ├── badge.tsx
│   │   │       ├── calendar.tsx
│   │   │       ├── dialog.tsx
│   │   │       ├── input.tsx
│   │   │       ├── progress.tsx
│   │   │       ├── select.tsx
│   │   │       ├── table.tsx
│   │   │       └── tabs.tsx
│   │   └── lib/
│   │       ├── api.ts           # Axios API client
│   │       └── utils.ts         # Utility functions
│   ├── ios/                     # Capacitor iOS project
│   ├── public/                  # Static assets
│   ├── package.json
│   └── README.md
│
├── run.sh                       # Quick start script
├── SPEC.md                      # Detailed product specification
└── README.md                    # This file
```

---

## Getting Started

### Prerequisites
- Python 3.10+
- Node.js 18+
- npm or pnpm

### Quick Start

Run both servers with a single command:
```bash
./run.sh
```

This will:
1. Create a Python virtual environment in `backend/venv`
2. Install Python dependencies
3. Start FastAPI on `http://localhost:8000`
4. Start Next.js on `http://localhost:3000`

### Manual Setup

#### Backend
```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run development server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API documentation available at:
- Swagger UI: `http://localhost:8000/api/docs`
- ReDoc: `http://localhost:8000/api/redoc`

#### Frontend
```bash
cd frontend

# Install dependencies
npm install

# Run development server
npm run dev
```

Access the app at `http://localhost:3000`

### Mobile (iOS) Development

1. Build the frontend:
   ```bash
   cd frontend
   npm run build
   ```

2. Sync with Capacitor:
   ```bash
   npx cap sync ios
   ```

3. Open in Xcode:
   ```bash
   npx cap open ios
   ```

## Building the iOS App

### Prerequisites

- macOS with Xcode installed
- Apple Developer account (for device/simulator testing and App Store distribution)
- Xcode Command Line Tools: `xcode-select --install`

### Option 1: Using Capacitor CLI (Recommended)

The simplest way to build the IPA:

```bash
cd frontend

# Build the web app and sync to iOS
npm run build
npx cap sync ios

# Build the iOS project
npx cap build ios --scheme App
```

This creates an unsigned IPA at `ios/App/App.ipa`.

### Option 2: Using Xcode

1. Open the project in Xcode:
   ```bash
   cd frontend
   npx cap open ios
   ```

2. Select your target device/simulator and signing team in Xcode

3. Build using Product > Build (Cmd+B) or archive using Product > Archive

4. To export an IPA: Product > Export > Choose your distribution method

### Option 3: Using xcodebuild (Command Line)

Build directly from the command line:

```bash
cd frontend

# Build web and sync to iOS
npm run build
npx cap sync ios

# Build the archive
xcodebuild -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration Release \
  -archivePath App.xcarchive \
  archive

# Export as IPA
xcodebuild -exportArchive \
  -archivePath App.xcarchive \
  -exportOptionsPlist ios/App/ExportOptions.plist \
  -exportPath ./dist
```

The IPA will be at `./dist/App.ipa`.

### App Signing

For device deployment or App Store distribution, you need:
- **Apple Developer Program** membership
- **Signing Certificate** (Development or Distribution)
- **Provisioning Profile** (Development or Distribution)

Configure signing in Xcode under Signing & Capabilities, or use environment variables:
```bash
npx cap build ios \
  --xcode-team-id YOUR_TEAM_ID \
  --xcode-export-method development
```

Export methods: `app-store-connect`, `release-testing`, `enterprise`, `debugging`, `developer-id`

---

## Frontend Pages

| Route | Page | Description |
|-------|------|-------------|
| `/` | Dashboard | Overview, recent sessions, quick stats |
| `/exercises` | Exercises | Searchable exercise library with muscle group filter |
| `/cycles` | Meso Cycles | List and manage training cycles |
| `/sessions` | Sessions | Calendar and list view of sessions |
| `/sessions/[id]` | Session Detail | Edit session, add exercises/sets |
| `/plans` | Plans | Training plan management |
| `/plans/[id]` | Plan Detail | Plan session editor |
| `/suggestions` | Suggestions | Volume and weight recommendations |

---

## Authentication

The API uses a simple header-based user identification:
- Register/Login returns a `user_id`
- Client stores `user_id` in localStorage
- All subsequent requests include `X-User-ID` header

```typescript
// Frontend interceptor (src/lib/api.ts)
api.interceptors.request.use((config) => {
  const userId = localStorage.getItem('userId');
  if (userId) {
    config.headers['X-User-ID'] = userId;
  }
  return config;
});
```

---

## Testing

### Backend Tests
```bash
cd backend
source venv/bin/activate
pytest tests/ -v
```

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## License

MIT License
