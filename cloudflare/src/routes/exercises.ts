import { z } from "zod";
import { nonNull, type Row } from "../db";
import { bool, HttpError, int, notFound, nowIso, opt, parse, str, uuid } from "../http";
import type { Router } from "../router";
import { exerciseOut, mesoOut, microOut } from "../serialize";

const ExerciseCreate = z.object({
  name: str,
  muscle_group: str,
  category: str.default("weighted"),
  description: opt(str),
});
const ExerciseUpdate = z.object({ name: opt(str), muscle_group: opt(str), category: opt(str), description: opt(str) });

export function exerciseRoutes(r: Router) {
  r.get("/exercises", ({ db, query }) => {
    const rows = query.muscle_group
      ? db.all("SELECT * FROM exercises WHERE muscle_group = ? ORDER BY rowid", query.muscle_group)
      : db.all("SELECT * FROM exercises ORDER BY rowid");
    return rows.map(exerciseOut);
  });

  r.get("/exercises/:id", ({ db }, { id }) => {
    const e = db.get("exercises", id);
    if (!e) throw notFound("Exercise");
    return exerciseOut(e);
  });

  r.post("/exercises", ({ db, body }) => {
    const b = parse(ExerciseCreate, body);
    const row = { id: uuid(), ...b, description: b.description ?? null, created_at: nowIso() };
    db.insert("exercises", row);
    return exerciseOut(row);
  });

  r.put("/exercises/:id", ({ db, body }, { id }) => {
    const b = parse(ExerciseUpdate, body);
    if (!db.get("exercises", id)) throw notFound("Exercise");
    db.update("exercises", id, nonNull(b));
    return exerciseOut(db.get("exercises", id)!);
  });

  r.delete("/exercises/:id", ({ db }, { id }) => {
    if (!db.get("exercises", id)) throw notFound("Exercise");
    db.run("DELETE FROM volume_history WHERE exercise_id = ?", id);
    db.run("DELETE FROM plan_exercises WHERE exercise_id = ?", id);
    db.run("DELETE FROM suggestion_logs WHERE exercise_id = ?", id);
    db.run("UPDATE session_exercises SET exercise_id = NULL WHERE exercise_id = ?", id);
    db.run("DELETE FROM exercises WHERE id = ?", id);
    return { message: "Exercise deleted" };
  });

  r.get("/exercises/:id/history", ({ db, query }, { id }) => {
    const { limit } = parse(z.object({ limit: int.pipe(z.number().min(1).max(50)).default(10) }), query, "query");
    const sessions = db.all(
      `SELECT DISTINCT ts.id, ts.name, ts.scheduled_date FROM training_sessions ts
       JOIN session_exercises se ON se.session_id = ts.id
       WHERE se.exercise_id = ?
       ORDER BY (ts.scheduled_date IS NULL) DESC, ts.scheduled_date DESC LIMIT ?`,
      id,
      limit,
    );
    if (!sessions.length) return [];
    // Two bulk queries instead of 2 per session: every matching session exercise and its sets.
    const sesBySession = new Map<string, string[]>();
    for (const se of db.all("SELECT id, session_id FROM session_exercises WHERE exercise_id = ? ORDER BY rowid", id)) {
      if (!sesBySession.has(se.session_id)) sesBySession.set(se.session_id, []);
      sesBySession.get(se.session_id)!.push(se.id);
    }
    const setsBySe = new Map<string, Row[]>();
    for (const s of db.all(
      `SELECT es.* FROM exercise_sets es JOIN session_exercises se ON se.id = es.session_exercise_id
       WHERE se.exercise_id = ? ORDER BY es.set_number, es.rowid`,
      id,
    )) {
      if (!setsBySe.has(s.session_exercise_id)) setsBySe.set(s.session_exercise_id, []);
      setsBySe.get(s.session_exercise_id)!.push(s);
    }
    const history = [];
    for (const ts of sessions) {
      for (const seId of sesBySession.get(ts.id) ?? []) {
        const sets = setsBySe.get(seId) ?? [];
        let total = 0;
        const data = [];
        for (const s of sets) {
          if (!s.is_warmup && s.is_completed) {
            total += (s.reps || 0) * (s.weight || 0);
            data.push({ set_number: s.set_number, reps: s.reps || 0, weight: s.weight || 0, rpe: s.rpe ?? null });
          }
        }
        history.push({ session_id: ts.id, session_date: ts.scheduled_date ?? null, session_name: ts.name, sets: data, total_volume: total });
      }
    }
    return history;
  });
}

const MesoCreate = z.object({
  name: str,
  start_date: opt(str),
  end_date: opt(str),
  goal: opt(str),
  is_active: bool.default(true),
});
const MesoUpdate = z.object({
  name: opt(str),
  start_date: opt(str),
  end_date: opt(str),
  goal: opt(str),
  is_active: opt(bool),
});
const MicroCreate = z.object({ week_number: int, focus: opt(str), start_date: opt(str), end_date: opt(str) });

export function mesoRoutes(r: Router) {
  r.get("/meso-cycles", ({ db, userId }) => db.all("SELECT * FROM meso_cycles ORDER BY rowid").map((m) => mesoOut(m, userId)));

  r.get("/meso-cycles/:id", ({ db, userId }, { id }) => {
    const m = db.get("meso_cycles", id);
    if (!m) throw notFound("Cycle");
    return mesoOut(m, userId);
  });

  r.post("/meso-cycles", ({ db, body, userId }) => {
    const b = parse(MesoCreate, body);
    const row = {
      id: uuid(),
      name: b.name,
      start_date: b.start_date ?? null,
      end_date: b.end_date ?? null,
      goal: b.goal ?? null,
      is_active: b.is_active,
      created_at: nowIso(),
    };
    db.insert("meso_cycles", row);
    return mesoOut(row, userId);
  });

  r.put("/meso-cycles/:id", ({ db, body, userId }, { id }) => {
    const b = parse(MesoUpdate, body);
    if (!db.get("meso_cycles", id)) throw notFound("Cycle");
    db.update("meso_cycles", id, b);
    return mesoOut(db.get("meso_cycles", id)!, userId);
  });

  r.delete("/meso-cycles/:id", ({ db }, { id }) => {
    if (!db.get("meso_cycles", id)) throw notFound("Cycle");
    db.run(
      "UPDATE training_sessions SET micro_cycle_id = NULL WHERE micro_cycle_id IN (SELECT id FROM micro_cycles WHERE meso_cycle_id = ?)",
      id,
    );
    db.run("DELETE FROM micro_cycles WHERE meso_cycle_id = ?", id);
    db.run("UPDATE training_sessions SET meso_cycle_id = NULL WHERE meso_cycle_id = ?", id);
    db.run("UPDATE suggestion_logs SET meso_cycle_id = NULL WHERE meso_cycle_id = ?", id);
    db.run("DELETE FROM meso_cycles WHERE id = ?", id);
    return { message: "Cycle deleted" };
  });

  r.get("/meso-cycles/:id/micro-cycles", ({ db }, { id }) =>
    db.all("SELECT * FROM micro_cycles WHERE meso_cycle_id = ? ORDER BY rowid", id).map(microOut),
  );

  r.post("/meso-cycles/:id/micro-cycles", ({ db, body }, { id }) => {
    const b = parse(MicroCreate, body);
    if (!db.get("meso_cycles", id)) throw notFound("Cycle");
    const row = {
      id: uuid(),
      meso_cycle_id: id,
      week_number: b.week_number,
      focus: b.focus ?? null,
      start_date: b.start_date ?? null,
      end_date: b.end_date ?? null,
    };
    db.insert("micro_cycles", row);
    return microOut(row);
  });
}

export { HttpError };
