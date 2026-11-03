// SQLite schema for one UserStore Durable Object (= one user). Mirrors
// backend/app/models/models.py minus the user_id columns, since every row
// in a store belongs to its owner. Cascades are done in code (see store.ts)
// to match the old ORM/Postgres behaviour exactly.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS profile (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT,
  fitbit_access_token TEXT,
  fitbit_refresh_token TEXT,
  fitbit_user_id TEXT,
  fitbit_token_expires_at TEXT
);

CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  muscle_group TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'weighted',
  description TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_exercises_name ON exercises(name);
CREATE INDEX IF NOT EXISTS ix_exercises_muscle_group ON exercises(muscle_group);

CREATE TABLE IF NOT EXISTS meso_cycles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  goal TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS micro_cycles (
  id TEXT PRIMARY KEY,
  meso_cycle_id TEXT NOT NULL,
  week_number INTEGER NOT NULL,
  focus TEXT,
  start_date TEXT,
  end_date TEXT
);
CREATE INDEX IF NOT EXISTS ix_micro_cycles_meso ON micro_cycles(meso_cycle_id);

CREATE TABLE IF NOT EXISTS training_sessions (
  id TEXT PRIMARY KEY,
  meso_cycle_id TEXT,
  micro_cycle_id TEXT,
  plan_session_id TEXT,
  name TEXT NOT NULL,
  scheduled_date TEXT,
  actual_date TEXT,
  status TEXT DEFAULT 'scheduled',
  notes TEXT,
  total_volume REAL DEFAULT 0,
  created_at TEXT,
  start_time TEXT,
  end_time TEXT,
  average_hr INTEGER,
  max_hr INTEGER
);
CREATE INDEX IF NOT EXISTS ix_ts_plan_session ON training_sessions(plan_session_id);
CREATE INDEX IF NOT EXISTS ix_ts_status ON training_sessions(status);

CREATE TABLE IF NOT EXISTS session_exercises (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  exercise_id TEXT,
  order_index INTEGER DEFAULT 0,
  notes TEXT,
  feedback TEXT -- JSON {pump 0-2, workload 0-3, joints 0-2}, RP-style post-exercise feedback
);
CREATE INDEX IF NOT EXISTS ix_se_session ON session_exercises(session_id);
CREATE INDEX IF NOT EXISTS ix_se_exercise ON session_exercises(exercise_id);

CREATE TABLE IF NOT EXISTS exercise_sets (
  id TEXT PRIMARY KEY,
  session_exercise_id TEXT NOT NULL,
  set_number INTEGER NOT NULL,
  reps INTEGER,
  weight REAL,
  rpe REAL,
  is_warmup INTEGER DEFAULT 0,
  is_completed INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_sets_se ON exercise_sets(session_exercise_id);

CREATE TABLE IF NOT EXISTS health_metrics (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  date TEXT NOT NULL,
  sleep_duration_seconds INTEGER,
  sleep_score INTEGER,
  sleep_efficiency INTEGER,
  weight_kg REAL,
  body_fat_pct REAL,
  bmi REAL,
  steps INTEGER,
  resting_hr INTEGER,
  fitbit_synced_at TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_hm_date ON health_metrics(date);
CREATE INDEX IF NOT EXISTS ix_hm_session ON health_metrics(session_id);

CREATE TABLE IF NOT EXISTS volume_history (
  id TEXT PRIMARY KEY,
  exercise_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  total_volume REAL DEFAULT 0,
  calculated_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_vh_exercise ON volume_history(exercise_id);
CREATE INDEX IF NOT EXISTS ix_vh_session ON volume_history(session_id);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS plan_sessions (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  name TEXT NOT NULL,
  week_number INTEGER DEFAULT 1,
  order_index INTEGER DEFAULT 0,
  scheduled_date TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS ix_ps_plan ON plan_sessions(plan_id);

CREATE TABLE IF NOT EXISTS plan_exercises (
  id TEXT PRIMARY KEY,
  plan_session_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  order_index INTEGER DEFAULT 0,
  target_sets INTEGER DEFAULT 3,
  target_reps INTEGER DEFAULT 10,
  target_weight REAL,
  target_rpe REAL,
  rest_seconds INTEGER DEFAULT 60,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS ix_pe_ps ON plan_exercises(plan_session_id);

CREATE TABLE IF NOT EXISTS suggestion_logs (
  id TEXT PRIMARY KEY,
  exercise_id TEXT NOT NULL,
  meso_cycle_id TEXT,
  previous_weight REAL,
  average_rpe REAL,
  suggested_weight REAL NOT NULL,
  adjustment_reason TEXT NOT NULL,
  actual_weight REAL,
  actual_reps INTEGER,
  actual_rpe REAL,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_sl_exercise ON suggestion_logs(exercise_id);
CREATE INDEX IF NOT EXISTS ix_sl_created ON suggestion_logs(created_at);

-- Cached Workers AI predictions (key = exercise + last session + plan context)
CREATE TABLE IF NOT EXISTS ai_predictions (
  key TEXT PRIMARY KEY,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Composite indexes for the hot read paths (suggestions, history, PRs, lists)
CREATE INDEX IF NOT EXISTS ix_sets_se_num ON exercise_sets(session_exercise_id, set_number);
CREATE INDEX IF NOT EXISTS ix_se_exercise_session ON session_exercises(exercise_id, session_id);
CREATE INDEX IF NOT EXISTS ix_ts_status_date ON training_sessions(status, scheduled_date, created_at);
CREATE INDEX IF NOT EXISTS ix_ts_meso ON training_sessions(meso_cycle_id);
CREATE INDEX IF NOT EXISTS ix_pe_ps_exercise ON plan_exercises(plan_session_id, exercise_id);
CREATE INDEX IF NOT EXISTS ix_pe_exercise ON plan_exercises(exercise_id);
CREATE INDEX IF NOT EXISTS ix_ps_plan_week ON plan_sessions(plan_id, week_number);
CREATE INDEX IF NOT EXISTS ix_hm_date_synced ON health_metrics(date, fitbit_synced_at);
`;

/** Column lists per table, used by the admin import to whitelist fields. */
export const TABLE_COLUMNS: Record<string, string[]> = {
  exercises: ["id", "name", "muscle_group", "category", "description", "created_at"],
  meso_cycles: ["id", "name", "start_date", "end_date", "goal", "is_active", "created_at"],
  micro_cycles: ["id", "meso_cycle_id", "week_number", "focus", "start_date", "end_date"],
  plans: ["id", "name", "description", "is_active", "created_at"],
  plan_sessions: ["id", "plan_id", "name", "week_number", "order_index", "scheduled_date", "notes"],
  plan_exercises: [
    "id", "plan_session_id", "exercise_id", "order_index", "target_sets", "target_reps",
    "target_weight", "target_rpe", "rest_seconds", "notes",
  ],
  training_sessions: [
    "id", "meso_cycle_id", "micro_cycle_id", "plan_session_id", "name", "scheduled_date", "actual_date",
    "status", "notes", "total_volume", "created_at", "start_time", "end_time", "average_hr", "max_hr",
  ],
  session_exercises: ["id", "session_id", "exercise_id", "order_index", "notes", "feedback"],
  exercise_sets: ["id", "session_exercise_id", "set_number", "reps", "weight", "rpe", "is_warmup", "is_completed"],
  health_metrics: [
    "id", "session_id", "date", "sleep_duration_seconds", "sleep_score", "sleep_efficiency", "weight_kg",
    "body_fat_pct", "bmi", "steps", "resting_hr", "fitbit_synced_at", "created_at",
  ],
  volume_history: ["id", "exercise_id", "session_id", "total_volume", "calculated_at"],
  suggestion_logs: [
    "id", "exercise_id", "meso_cycle_id", "previous_weight", "average_rpe", "suggested_weight",
    "adjustment_reason", "actual_weight", "actual_reps", "actual_rpe", "created_at",
  ],
};

/**
 * Additive column migrations for stores created before a column existed.
 * CREATE TABLE IF NOT EXISTS never alters an existing table, so each entry is
 * applied when PRAGMA table_info shows the column is missing.
 */
export const COLUMN_MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: "session_exercises", column: "feedback", ddl: "ALTER TABLE session_exercises ADD COLUMN feedback TEXT" },
];
