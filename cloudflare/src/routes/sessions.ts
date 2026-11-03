import { z } from "zod";
import type { Db } from "../db";
import { bool, int, notFound, nowIso, num, opt, parse, str, toNaiveUtc, uuid } from "../http";
import type { Ctx, Router } from "../router";
import { loadSessionExercise, loadSessions, setOut } from "../serialize";

const SessionCreate = z.object({
  name: str,
  meso_cycle_id: opt(str),
  micro_cycle_id: opt(str),
  plan_session_id: opt(str),
  scheduled_date: opt(str),
  status: opt(str),
  notes: opt(str),
});
const SessionUpdate = z.object({
  name: opt(str),
  meso_cycle_id: opt(str),
  micro_cycle_id: opt(str),
  plan_session_id: opt(str),
  scheduled_date: opt(str),
  actual_date: opt(str),
  status: opt(str),
  notes: opt(str),
  start_time: opt(str),
  end_time: opt(str),
  average_hr: opt(int),
  max_hr: opt(int),
});
const SeCreate = z.object({ exercise_id: str, order_index: int.default(0), notes: opt(str) });
const SeUpdate = z.object({ order_index: opt(int), notes: opt(str) });
const SetCreate = z.object({
  set_number: int,
  reps: opt(int),
  weight: opt(num),
  rpe: opt(num),
  is_warmup: bool.default(false),
});
const SetUpdate = z.object({ reps: opt(int), weight: opt(num), rpe: opt(num), is_warmup: opt(bool), is_completed: opt(bool) });

const today = () => new Date().toISOString().slice(0, 10);

function getSession(c: Ctx, id: string) {
  const s = loadSessions(c, "WHERE id = ?", id)[0];
  if (!s) throw notFound("Session");
  return s;
}

function deleteSessionExercises(db: Db, where: string, ...args: unknown[]) {
  db.run(`DELETE FROM exercise_sets WHERE session_exercise_id IN (SELECT id FROM session_exercises ${where})`, ...args);
  db.run(`DELETE FROM session_exercises ${where}`, ...args);
}

/** Backfill VolumeHistory for completed sessions missing it (port of migrate_volume_history). */
export function backfillVolumeHistory(db: Db) {
  const sessions = db.all(
    "SELECT id FROM training_sessions WHERE status = 'completed' AND id NOT IN (SELECT DISTINCT session_id FROM volume_history)",
  );
  for (const { id } of sessions) {
    const vols = db.all(
      `SELECT se.exercise_id, SUM(es.reps * es.weight) AS volume
       FROM session_exercises se JOIN exercise_sets es ON se.id = es.session_exercise_id
       WHERE se.session_id = ? AND es.is_completed = 1 AND es.is_warmup = 0
         AND es.reps IS NOT NULL AND es.weight IS NOT NULL AND se.exercise_id IS NOT NULL
       GROUP BY se.exercise_id HAVING SUM(es.reps * es.weight) > 0`,
      id,
    );
    for (const v of vols) {
      db.insert("volume_history", {
        id: uuid(),
        exercise_id: v.exercise_id,
        session_id: id,
        total_volume: Number(v.volume),
        calculated_at: nowIso(),
      });
    }
  }
}

export function sessionRoutes(r: Router) {
  r.post("/sessions/sync-volume", ({ db }) => {
    backfillVolumeHistory(db);
    return { message: "Volume history synchronization complete" };
  });

  r.get("/sessions", (c) => loadSessions(c));

  r.get("/sessions/:id", (c, { id }) => getSession(c, id));

  r.post("/sessions", (c) => {
    const b = parse(SessionCreate, c.body);
    const id = uuid();
    c.db.insert("training_sessions", {
      id,
      name: b.name,
      meso_cycle_id: b.meso_cycle_id ?? null,
      micro_cycle_id: b.micro_cycle_id ?? null,
      plan_session_id: b.plan_session_id ?? null,
      scheduled_date: b.scheduled_date ?? null,
      status: b.status || "scheduled",
      notes: b.notes ?? null,
      total_volume: 0,
      created_at: nowIso(),
    });
    return getSession(c, id);
  });

  r.put("/sessions/:id", (c, { id }) => {
    const b = parse(SessionUpdate, c.body);
    if (!c.db.get("training_sessions", id)) throw notFound("Session");
    const patch: Record<string, unknown> = { ...b };
    if ("start_time" in b) patch.start_time = toNaiveUtc(b.start_time);
    if ("end_time" in b) patch.end_time = toNaiveUtc(b.end_time);
    c.db.update("training_sessions", id, patch);
    return getSession(c, id);
  });

  r.delete("/sessions/:id", ({ db }, { id }) => {
    if (!db.get("training_sessions", id)) throw notFound("Session");
    db.run("DELETE FROM volume_history WHERE session_id = ?", id);
    db.run("DELETE FROM health_metrics WHERE session_id = ?", id);
    deleteSessionExercises(db, "WHERE session_id = ?", id);
    db.run("DELETE FROM training_sessions WHERE id = ?", id);
    return { message: "Session deleted" };
  });

  r.post("/sessions/:id/start", ({ db }, { id }) => {
    const s = db.get("training_sessions", id);
    if (!s) throw notFound("Session");
    const start = nowIso();
    db.update("training_sessions", id, { start_time: start, status: "in_progress", actual_date: s.actual_date || today() });
    return { message: "Session started", start_time: start };
  });

  r.get("/sessions/:id/pre-summary", (c, { id }) => {
    const { db } = c;
    const s = getSession(c, id);
    const workoutNumber = (db.scalar<number>("SELECT COUNT(id) FROM training_sessions WHERE status = 'completed'") || 0) + 1;

    let duration: number | null = null;
    if (s.start_time) duration = Math.trunc((Date.now() - new Date(s.start_time + "Z").getTime()) / 1000);

    // Historic max per exercise in this session, in one grouped query (was one query per exercise).
    const histMaxes = new Map<string, number>(
      db
        .all(
          `SELECT se.exercise_id, MAX(es.weight) AS max_w FROM exercise_sets es
           JOIN session_exercises se ON se.id = es.session_exercise_id
           JOIN training_sessions ts ON ts.id = se.session_id
           WHERE se.exercise_id IN (SELECT exercise_id FROM session_exercises WHERE session_id = ?)
             AND ts.id != ? AND ts.status = 'completed' AND es.is_completed = 1 AND es.is_warmup = 0
           GROUP BY se.exercise_id`,
          id,
          id,
        )
        .map((r) => [r.exercise_id as string, (r.max_w as number) || 0]),
    );

    const prs = [];
    for (const se of s.exercises) {
      const done = se.sets.filter((x) => x.is_completed && !x.is_warmup && x.weight && x.weight > 0);
      if (!done.length) continue;
      const currentMax = Math.max(...done.map((x) => x.weight as number));
      const histMax = (se.exercise_id && histMaxes.get(se.exercise_id)) || 0;
      if (currentMax > histMax) prs.push({ exercise_name: se.exercise?.name ?? null, old_max: histMax, new_max: currentMax });
    }

    let totalVolume = 0;
    let completed = 0;
    let total = 0;
    for (const se of s.exercises) {
      for (const x of se.sets) {
        total++;
        if (x.is_completed) completed++;
        if (x.is_completed && !x.is_warmup && x.reps && x.weight) totalVolume += x.reps * x.weight;
      }
    }
    return {
      workout_number: workoutNumber,
      duration_seconds: duration,
      total_volume: totalVolume,
      completed_sets: completed,
      total_sets: total,
      exercise_count: s.exercises.length,
      prs,
    };
  });

  r.post("/sessions/:id/complete", (c, { id }) => {
    const { db } = c;
    const s = getSession(c, id);
    let totalVolume = 0;
    for (const se of s.exercises) {
      let v = 0;
      for (const x of se.sets) if (x.is_completed && !x.is_warmup && x.reps && x.weight) v += x.reps * x.weight;
      if (v > 0) {
        totalVolume += v;
        if (se.exercise_id) {
          db.insert("volume_history", { id: uuid(), exercise_id: se.exercise_id, session_id: id, total_volume: v, calculated_at: nowIso() });
        }
      }
    }
    // Same as the Python API: completion stamps start_time with "now".
    db.update("training_sessions", id, {
      status: "completed",
      start_time: nowIso(),
      actual_date: s.actual_date || today(),
      total_volume: totalVolume,
    });
    return { message: "Session completed", total_volume: totalVolume };
  });

  r.post("/sessions/:id/cancel", ({ db }, { id }) => {
    if (!db.get("training_sessions", id)) throw notFound("Session");
    db.update("training_sessions", id, { status: "cancelled" });
    return { message: "Session cancelled" };
  });

  r.post("/sessions/:id/exercises", ({ db, body }, { id }) => {
    const b = parse(SeCreate, body);
    if (!db.get("training_sessions", id)) throw notFound("Session");
    const seId = uuid();
    db.insert("session_exercises", { id: seId, session_id: id, exercise_id: b.exercise_id, order_index: b.order_index, notes: b.notes ?? null });
    return loadSessionExercise(db, seId);
  });

  r.put("/sessions/session-exercises/:id", ({ db, body }, { id }) => {
    const b = parse(SeUpdate, body);
    if (!db.get("session_exercises", id)) throw notFound("Session exercise");
    db.update("session_exercises", id, b);
    return loadSessionExercise(db, id);
  });

  r.delete("/sessions/session-exercises/:id", ({ db }, { id }) => {
    if (!db.get("session_exercises", id)) throw notFound("Session exercise");
    deleteSessionExercises(db, "WHERE id = ?", id);
    return { message: "Exercise removed from session" };
  });

  r.post("/sessions/session-exercises/:id/sets", ({ db, body }, { id }) => {
    const b = parse(SetCreate, body);
    if (!db.get("session_exercises", id)) throw notFound("Session exercise");
    const row = {
      id: uuid(),
      session_exercise_id: id,
      set_number: b.set_number,
      reps: b.reps ?? null,
      weight: b.weight ?? null,
      rpe: b.rpe ?? null,
      is_warmup: b.is_warmup,
      is_completed: false,
    };
    db.insert("exercise_sets", row);
    return setOut(row);
  });

  r.put("/sessions/exercise-sets/:id", ({ db, body }, { id }) => {
    const b = parse(SetUpdate, body);
    if (!db.get("exercise_sets", id)) throw notFound("Set");
    db.update("exercise_sets", id, b);
    return setOut(db.get("exercise_sets", id)!);
  });

  r.delete("/sessions/exercise-sets/:id", ({ db }, { id }) => {
    if (!db.get("exercise_sets", id)) throw notFound("Set");
    db.run("DELETE FROM exercise_sets WHERE id = ?", id);
    return { message: "Set deleted" };
  });
}
