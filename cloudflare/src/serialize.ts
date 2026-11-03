// Response shapes matching the pydantic models in backend/app/schemas.
import type { Ctx } from "./router";
import type { Db, Row } from "./db";
import { parseFeedback } from "./feedback";

export const exerciseOut = (e: Row) => ({
  id: e.id,
  name: e.name,
  muscle_group: e.muscle_group,
  category: e.category ?? "weighted",
  description: e.description ?? null,
  created_at: e.created_at ?? null,
});

export const setOut = (s: Row) => ({
  id: s.id,
  set_number: s.set_number,
  reps: s.reps ?? null,
  weight: s.weight ?? null,
  rpe: s.rpe ?? null,
  is_warmup: !!s.is_warmup,
  is_completed: !!s.is_completed,
});

export const healthOut = (h: Row, userId: string) => ({
  date: h.date,
  sleep_duration_seconds: h.sleep_duration_seconds ?? null,
  sleep_score: h.sleep_score ?? null,
  sleep_efficiency: h.sleep_efficiency ?? null,
  weight_kg: h.weight_kg ?? null,
  body_fat_pct: h.body_fat_pct ?? null,
  bmi: h.bmi ?? null,
  id: h.id,
  user_id: userId,
  session_id: h.session_id ?? null,
  created_at: h.created_at ?? null,
});

export const mesoOut = (m: Row, userId: string) => ({
  id: m.id,
  user_id: userId,
  name: m.name,
  start_date: m.start_date ?? null,
  end_date: m.end_date ?? null,
  goal: m.goal ?? null,
  is_active: !!m.is_active,
  created_at: m.created_at ?? null,
});

export const microOut = (m: Row) => ({
  id: m.id,
  meso_cycle_id: m.meso_cycle_id,
  week_number: m.week_number,
  focus: m.focus ?? null,
  start_date: m.start_date ?? null,
  end_date: m.end_date ?? null,
});

function groupBy(rows: Row[], key: string): Map<string, Row[]> {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
}

function sessionExerciseOut(se: Row, sets: Row[], exercises: Map<string, Row>) {
  const ex = se.exercise_id ? exercises.get(se.exercise_id) : undefined;
  return {
    id: se.id,
    exercise_id: se.exercise_id ?? null,
    order_index: se.order_index ?? 0,
    notes: se.notes ?? null,
    feedback: parseFeedback(se.feedback),
    rest_seconds: 60,
    sets: sets.map(setOut),
    exercise: ex ? exerciseOut(ex) : null,
    exercise_name: null,
  };
}

/**
 * Load training sessions with exercises, sets and health metric in a fixed
 * number of queries. `where` filters training_sessions (bare column names).
 */
export function loadSessions(c: Ctx, where = "", ...args: unknown[]) {
  const { db, userId } = c;
  const sessions = db.all(`SELECT * FROM training_sessions ${where} ORDER BY rowid`, ...args);
  if (!sessions.length) return [];

  let ses: Row[], sets: Row[], exerciseRows: Row[], healthRows: Row[];
  if (!where) {
    // Whole-store listing: plain scans, no subquery filters to evaluate.
    ses = db.all("SELECT * FROM session_exercises ORDER BY rowid");
    sets = db.all("SELECT * FROM exercise_sets ORDER BY set_number, rowid");
    exerciseRows = db.all("SELECT * FROM exercises");
    healthRows = db.all("SELECT * FROM health_metrics WHERE session_id IS NOT NULL ORDER BY rowid");
  } else {
    const tsIds = `SELECT id FROM training_sessions ${where}`;
    ses = db.all(`SELECT * FROM session_exercises WHERE session_id IN (${tsIds}) ORDER BY rowid`, ...args);
    sets = db.all(
      `SELECT es.* FROM exercise_sets es JOIN session_exercises se ON se.id = es.session_exercise_id
       WHERE se.session_id IN (${tsIds}) ORDER BY es.set_number, es.rowid`,
      ...args,
    );
    exerciseRows = db.all(
      `SELECT * FROM exercises WHERE id IN (SELECT exercise_id FROM session_exercises WHERE session_id IN (${tsIds}))`,
      ...args,
    );
    healthRows = db.all(`SELECT * FROM health_metrics WHERE session_id IN (${tsIds}) ORDER BY rowid`, ...args);
  }
  const exercises = new Map(exerciseRows.map((e) => [e.id as string, e]));
  const health = groupBy(healthRows, "session_id");
  const setsBySe = groupBy(sets, "session_exercise_id");
  const sesBySession = groupBy(ses, "session_id");

  return sessions.map((s) => {
    const hm = health.get(s.id)?.[0];
    return {
      id: s.id,
      user_id: userId,
      meso_cycle_id: s.meso_cycle_id ?? null,
      micro_cycle_id: s.micro_cycle_id ?? null,
      plan_session_id: s.plan_session_id ?? null,
      name: s.name,
      scheduled_date: s.scheduled_date ?? null,
      actual_date: s.actual_date ?? null,
      start_time: s.start_time ?? null,
      end_time: s.end_time ?? null,
      average_hr: s.average_hr ?? null,
      max_hr: s.max_hr ?? null,
      status: s.status ?? "scheduled",
      notes: s.notes ?? null,
      total_volume: s.total_volume ?? null,
      exercises: (sesBySession.get(s.id) ?? []).map((se) => sessionExerciseOut(se, setsBySe.get(se.id) ?? [], exercises)),
      health_metric: hm ? healthOut(hm, userId) : null,
    };
  });
}

export function loadSessionExercise(db: Db, seId: string) {
  const se = db.get("session_exercises", seId);
  if (!se) return null;
  const sets = db.all("SELECT * FROM exercise_sets WHERE session_exercise_id = ? ORDER BY set_number, rowid", seId);
  const ex = se.exercise_id ? db.get("exercises", se.exercise_id) : null;
  return sessionExerciseOut(se, sets, new Map(ex ? [[ex.id, ex]] : []));
}

// ── Plans ────────────────────────────────────────────────────────────────────
const planExerciseBase = (e: Row) => ({ id: e.id, name: e.name, muscle_group: e.muscle_group, category: e.category ?? "weighted" });

export function planExerciseOut(pe: Row, ex: Row | null | undefined) {
  return {
    id: pe.id,
    plan_session_id: pe.plan_session_id,
    exercise_id: pe.exercise_id,
    order_index: pe.order_index ?? 0,
    target_sets: pe.target_sets ?? null,
    target_reps: pe.target_reps ?? null,
    target_weight: pe.target_weight ?? null,
    target_rpe: pe.target_rpe ?? null,
    rest_seconds: pe.rest_seconds ?? null,
    notes: pe.notes ?? null,
    exercise: ex ? planExerciseBase(ex) : null,
  };
}

function planSessionOut(ps: Row, pes: Row[], exercises: Map<string, Row>) {
  return {
    id: ps.id,
    plan_id: ps.plan_id,
    name: ps.name,
    week_number: ps.week_number ?? 1,
    order_index: ps.order_index ?? 0,
    scheduled_date: ps.scheduled_date ?? null,
    notes: ps.notes ?? null,
    exercises: pes.map((pe) => planExerciseOut(pe, exercises.get(pe.exercise_id))),
  };
}

/** `where` filters plan_sessions (bare columns). */
export function loadPlanSessions(db: Db, where: string, ...args: unknown[]) {
  const sessions = db.all(`SELECT * FROM plan_sessions ${where} ORDER BY rowid`, ...args);
  if (!sessions.length) return [];
  const psIds = `SELECT id FROM plan_sessions ${where}`;
  const pes = groupBy(db.all(`SELECT * FROM plan_exercises WHERE plan_session_id IN (${psIds}) ORDER BY rowid`, ...args), "plan_session_id");
  const exercises = new Map(
    db
      .all(`SELECT * FROM exercises WHERE id IN (SELECT exercise_id FROM plan_exercises WHERE plan_session_id IN (${psIds}))`, ...args)
      .map((e) => [e.id as string, e]),
  );
  return sessions.map((ps) => planSessionOut(ps, pes.get(ps.id) ?? [], exercises));
}

/** `where` filters plans (bare columns). */
export function loadPlans(c: Ctx, where = "", ...args: unknown[]) {
  const { db, userId } = c;
  const plans = db.all(`SELECT * FROM plans ${where} ORDER BY (created_at IS NULL) DESC, created_at DESC, rowid`, ...args);
  if (!plans.length) return [];
  const sessions = loadPlanSessions(db, `WHERE plan_id IN (SELECT id FROM plans ${where})`, ...args);
  const byPlan = new Map<string, typeof sessions>();
  for (const s of sessions) {
    if (!byPlan.has(s.plan_id)) byPlan.set(s.plan_id, []);
    byPlan.get(s.plan_id)!.push(s);
  }
  return plans.map((p) => ({
    id: p.id,
    user_id: userId,
    name: p.name,
    description: p.description ?? null,
    is_active: !!p.is_active,
    created_at: p.created_at ?? null,
    plan_sessions: byPlan.get(p.id) ?? [],
    meso_cycle_id: null,
  }));
}
