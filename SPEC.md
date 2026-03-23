# Workout App Specification

## 1. Project Overview

**Project Name:** Workout Tracker
**Type:** Full-stack Web Application
**Core Functionality:** A workout tracking app that allows users to manage training sessions, organize them into meso cycles (4-12 week periods), and provides intelligent exercise suggestions based on previous volume data.
**Target Users:** Fitness enthusiasts and athletes who follow structured training programs.

## 2. Tech Stack

### Frontend
- **Framework:** Next.js 14 (App Router)
- **UI Library:** shadcn/ui (chadcn)
- **Styling:** Tailwind CSS
- **State Management:** React Context + React Query
- **HTTP Client:** Axios

### Backend
- **Framework:** FastAPI
- **Database:** PostgreSQL
- **ORM:** SQLAlchemy with asyncpg
- **Migration:** Alembic

### Database
- **Host:** PostgreSQL (local or cloud)

## 3. Database Schema

### Tables

#### users
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PRIMARY KEY |
| email | VARCHAR(255) | UNIQUE, NOT NULL |
| name | VARCHAR(255) | NOT NULL |
| created_at | TIMESTAMP | DEFAULT NOW() |
| updated_at | TIMESTAMP | DEFAULT NOW() |

#### exercises
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PRIMARY KEY |
| name | VARCHAR(255) | NOT NULL |
| muscle_group | VARCHAR(100) | NOT NULL |
| description | TEXT | NULLABLE |
| created_at | TIMESTAMP | DEFAULT NOW() |

#### meso_cycles
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PRIMARY KEY |
| user_id | UUID | FOREIGN KEY (users.id) |
| name | VARCHAR(255) | NOT NULL |
| start_date | DATE | NOT NULL |
| end_date | DATE | NOT NULL |
| goal | VARCHAR(255) | NOT NULL (strength/hypertrophy/endurance) |
| is_active | BOOLEAN | DEFAULT TRUE |
| created_at | TIMESTAMP | DEFAULT NOW() |
| updated_at | TIMESTAMP | DEFAULT NOW() |

#### micro_cycles
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PRIMARY KEY |
| meso_cycle_id | UUID | FOREIGN KEY (meso_cycles.id) |
| week_number | INTEGER | NOT NULL |
| focus | VARCHAR(255) | NOT NULL (deload/peak/normal) |
| start_date | DATE | NOT NULL |
| end_date | DATE | NOT NULL |

#### training_sessions
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PRIMARY KEY |
| user_id | UUID | FOREIGN KEY (users.id) |
| meso_cycle_id | UUID | FOREIGN KEY (meso_cycles.id) |
| micro_cycle_id | UUID | FOREIGN KEY (micro_cycles.id), NULLABLE |
| name | VARCHAR(255) | NOT NULL |
| scheduled_date | DATE | NOT NULL |
| actual_date | DATE | NULLABLE |
| status | VARCHAR(50) | NOT NULL (scheduled/completed/cancelled) |
| notes | TEXT | NULLABLE |
| total_volume | FLOAT | NULLABLE |
| created_at | TIMESTAMP | DEFAULT NOW() |
| updated_at | TIMESTAMP | DEFAULT NOW() |

#### session_exercises
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PRIMARY KEY |
| session_id | UUID | FOREIGN KEY (training_sessions.id) |
| exercise_id | UUID | FOREIGN KEY (exercises.id) |
| order_index | INTEGER | NOT NULL |
| notes | TEXT | NULLABLE |

#### exercise_sets
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PRIMARY KEY |
| session_exercise_id | UUID | FOREIGN KEY (session_exercises.id) |
| set_number | INTEGER | NOT NULL |
| reps | INTEGER | NOT NULL |
| weight | FLOAT | NOT NULL |
| rpe | FLOAT | NULLABLE (1-10) |
| is_warmup | BOOLEAN | DEFAULT FALSE |
| is_completed | BOOLEAN | DEFAULT FALSE |
| created_at | TIMESTAMP | DEFAULT NOW() |

#### volume_history
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PRIMARY KEY |
| user_id | UUID | FOREIGN KEY (users.id) |
| exercise_id | UUID | FOREIGN KEY (exercises.id) |
| session_id | UUID | FOREIGN KEY (training_sessions.id) |
| total_volume | FLOAT | NOT NULL (reps × weight) |
| calculated_at | TIMESTAMP | DEFAULT NOW() |

## 4. API Endpoints

### Auth
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user

### Exercises
- `GET /api/exercises` - List all exercises
- `GET /api/exercises/{id}` - Get exercise details
- `POST /api/exercises` - Create exercise
- `PUT /api/exercises/{id}` - Update exercise
- `DELETE /api/exercises/{id}` - Delete exercise

### Meso Cycles
- `GET /api/meso-cycles` - List user's meso cycles
- `GET /api/meso-cycles/{id}` - Get meso cycle details with micro cycles
- `POST /api/meso-cycles` - Create meso cycle
- `PUT /api/meso-cycles/{id}` - Update meso cycle
- `DELETE /api/meso-cycles/{id}` - Delete meso cycle

### Micro Cycles
- `GET /api/meso-cycles/{meso_id}/micro-cycles` - List micro cycles
- `POST /api/meso-cycles/{meso_id}/micro-cycles` - Create micro cycle
- `PUT /api/micro-cycles/{id}` - Update micro cycle

### Training Sessions
- `GET /api/sessions` - List sessions (with filters)
- `GET /api/sessions/{id}` - Get session with exercises and sets
- `POST /api/sessions` - Create session
- `PUT /api/sessions/{id}` - Update session
- `DELETE /api/sessions/{id}` - Delete session
- `POST /api/sessions/{id}/complete` - Complete session (calculates volume)

### Session Exercises
- `GET /api/sessions/{session_id}/exercises` - List session exercises
- `POST /api/sessions/{session_id}/exercises` - Add exercise to session
- `PUT /api/session-exercises/{id}` - Update session exercise
- `DELETE /api/session-exercises/{id}` - Remove exercise from session

### Exercise Sets
- `GET /api/session-exercises/{session_exercise_id}/sets` - List sets
- `POST /api/session-exercises/{session_exercise_id}/sets` - Add set
- `PUT /api/exercise-sets/{id}` - Update set
- `DELETE /api/exercise-sets/{id}` - Delete set

### Suggestions
- `GET /api/suggestions/exercises?muscle_group={group}` - Suggest exercises based on volume history
- `GET /api/suggestions/weight?exercise_id={id}` - Suggest weight based on previous performance

## 5. Frontend Pages

### Dashboard (`/`)
- Overview of current meso cycle
- Current week micro cycle info
- Recent sessions list
- Quick stats (total volume this week, sessions completed)
- Quick action: Start new session

### Exercises (`/exercises`)
- Searchable exercise library
- Filter by muscle group
- Add new custom exercise

### Meso Cycles (`/cycles`)
- List of all meso cycles
- Create new cycle wizard
- Cycle details view with micro cycles

### Sessions (`/sessions`)
- Calendar view of sessions
- List view with filters
- Session detail/editor

### Suggestions (`/suggestions`)
- Exercise suggestions based on volume
- Weight recommendations per exercise

## 6. Volume-Based Suggestions Algorithm

### Exercise Suggestion Logic
1. Query volume_history for user's top exercises by total volume (last 30 days)
2. Calculate volume per muscle group
3. Suggest exercises for underworked muscle groups
4. Mix of compound and isolation exercises

### Weight Suggestion Logic
1. Get last 5 completed sessions for the exercise
2. Calculate average weight used at each rep range
3. Suggest weight based on:
   - If increasing: suggest 2.5-5% increase
   - If maintaining: suggest same weight
   - If deload week: suggest 60-70% of working weight
4. Factor in RPE - if average RPE > 8, suggest deload

## 7. UI Components (chadcn/ui)

- Card - For displaying stats and session cards
- Button - Actions
- Input - Form fields
- Select - Dropdowns
- Dialog - Modals for forms
- Table - Lists
- Calendar - Session scheduling
- Tabs - Navigation
- Badge - Status indicators
- Progress - Cycle progress
- Form - With react-hook-form + zod validation

## 8. Acceptance Criteria

### Core Features
- [ ] User can create and manage meso cycles (4-12 weeks)
- [ ] User can create training sessions within cycles
- [ ] User can add exercises to sessions with sets/reps/weight
- [ ] User can complete sessions and track volume
- [ ] System calculates total volume automatically
- [ ] Suggestions appear based on previous volume data

### Data Integrity
- [ ] All CRUD operations work for all entities
- [ ] Session completion updates volume_history
- [ ] Cycle deletion cascades to related records

### UX
- [ ] Clean, modern UI using chadcn/ui components
- [ ] Responsive design
- [ ] Loading states and error handling
- [ ] Form validation with helpful messages

## 9. Project Structure

```
/workout-app
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── (dashboard)/
│   │   │   ├── exercises/
│   │   │   ├── cycles/
│   │   │   ├── sessions/
│   │   │   ├── suggestions/
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx
│   │   ├── components/
│   │   │   ├── ui/
│   │   │   └── shared/
│   │   ├── lib/
│   │   │   ├── api.ts
│   │   │   └── utils.ts
│   │   └── types/
│   ├── package.json
│   └── tailwind.config.ts
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   ├── database.py
│   │   └── main.py
│   ├── alembic/
│   ├── requirements.txt
│   └── .env
└── README.md
```
