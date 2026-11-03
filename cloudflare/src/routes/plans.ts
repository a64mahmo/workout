import { z } from "zod";
import { nonNull, type Db } from "../db";
import { HttpError, int, notFound, nowIso, num, opt, parse, str, uuid } from "../http";
import type { Ctx, Router } from "../router";
import { loadPlanSessions, loadPlans, planExerciseOut } from "../serialize";
import seed from "../seed/powerbuilding.json";

const PlanCreate = z.object({ name: str, description: opt(str) });
const PlanUpdate = z.object({ name: opt(str), description: opt(str) });
const PlanSessionCreate = z.object({
  name: str,
  week_number: int.default(1),
  order_index: int.default(0),
  scheduled_date: opt(str),
  notes: opt(str),
});
const PlanSessionUpdate = z.object({
  name: opt(str),
  week_number: opt(int),
  order_index: opt(int),
  scheduled_date: opt(str),
  notes: opt(str),
});
const PlanExerciseCreate = z.object({
  exercise_id: str,
  order_index: int.default(0),
  target_sets: opt(int).default(3),
  target_reps: opt(int).default(10),
  target_weight: opt(num),
  target_rpe: opt(num),
  rest_seconds: opt(int).default(60),
  notes: opt(str),
});
const PlanExerciseUpdate = z.object({
  exercise_id: opt(str),
  order_index: opt(int),
  target_sets: opt(int),
  target_reps: opt(int),
  target_weight: opt(num),
  target_rpe: opt(num),
  rest_seconds: opt(int),
  notes: opt(str),
});
const ApplyBody = z.object({
  training_session_id: opt(str),
  overrides: opt(z.array(z.record(z.string(), z.unknown()))),
});

export const TEMPLATES = {
  templates: [
    { id: "ppl", name: "Push/Pull/Legs", description: "6-day split" },
    { id: "upper-lower", name: "Upper/Lower", description: "4-day split" },
    { id: "full-body", name: "Full Body", description: "3-day split" },
  ],
};
export const TEMPLATE_DETAILS: Record<string, unknown> = {
  ppl: {
    name: "Push/Pull/Legs",
    days: [
      { day: 1, name: "Push", muscle_groups: ["chest", "shoulders", "triceps"] },
      { day: 2, name: "Pull", muscle_groups: ["back", "biceps"] },
      { day: 3, name: "Legs", muscle_groups: ["legs", "core"] },
    ],
  },
  "upper-lower": {
    name: "Upper/Lower",
    days: [
      { day: 1, name: "Upper", muscle_groups: ["chest", "back", "shoulders", "biceps", "triceps"] },
      { day: 2, name: "Lower", muscle_groups: ["legs", "core"] },
    ],
  },
  "full-body": {
    name: "Full Body",
    days: [
      { day: 1, name: "Full Body A", muscle_groups: ["chest", "back", "legs"] },
      { day: 2, name: "Full Body B", muscle_groups: ["shoulders", "biceps", "triceps", "core"] },
    ],
  },
};

const getPlan = (c: Ctx, id: string) => {
  const p = loadPlans(c, "WHERE id = ?", id)[0];
  if (!p) throw notFound("Plan");
  return p;
};
const getPlanSession = (db: Db, id: string) => {
  const ps = loadPlanSessions(db, "WHERE id = ?", id)[0];
  if (!ps) throw notFound("Plan session");
  return ps;
};

function deletePlanSessions(db: Db, where: string, ...args: unknown[]) {
  const ids = `SELECT id FROM plan_sessions ${where}`;
  db.run(`UPDATE training_sessions SET plan_session_id = NULL WHERE plan_session_id IN (${ids})`, ...args);
  db.run(`DELETE FROM plan_exercises WHERE plan_session_id IN (${ids})`, ...args);
  db.run(`DELETE FROM plan_sessions ${where}`, ...args);
}

/** Port of services/program_seed.py — idempotent. */
export function seedPrograms(db: Db) {
  if (db.one("SELECT id FROM plans WHERE name = ?", seed.plan_name)) return;
  const exMap = new Map<string, string>();
  for (const ex of seed.exercises as { name: string; muscle_group: string; category?: string; description?: string }[]) {
    const existing = db.one("SELECT id FROM exercises WHERE name = ?", ex.name);
    if (existing) exMap.set(ex.name, existing.id);
    else {
      const id = uuid();
      db.insert("exercises", {
        id,
        name: ex.name,
        muscle_group: ex.muscle_group,
        category: ex.category ?? "weighted",
        description: ex.description ?? "",
        created_at: nowIso(),
      });
      exMap.set(ex.name, id);
    }
  }
  const planId = uuid();
  db.insert("plans", { id: planId, name: seed.plan_name, description: seed.plan_description, is_active: true, created_at: nowIso() });

  (seed.sessions as [string, string, [string, number, number, number | null, number | null, number, string][]][]).forEach(
    ([week, name, exercises], orderIdx) => {
      const m = /\d+/.exec(String(week));
      const psId = uuid();
      db.insert("plan_sessions", { id: psId, plan_id: planId, name: `${week} - ${name}`, week_number: m ? Number(m[0]) : 1, order_index: orderIdx });
      exercises.forEach(([exName, warmup, reps, pct, rpe, rest, notes], exIdx) => {
        const exId = exMap.get(exName);
        if (!exId) return;
        db.insert("plan_exercises", {
          id: uuid(),
          plan_session_id: psId,
          exercise_id: exId,
          order_index: exIdx,
          target_sets: warmup + 1,
          target_reps: reps,
          target_weight: pct,
          target_rpe: rpe,
          rest_seconds: rest,
          notes,
        });
      });
    },
  );
}

export function planRoutes(r: Router) {
  r.get("/plans", (c) => loadPlans(c));
  r.get("/plans/templates", () => TEMPLATES);
  r.get("/plans/templates/:id", (_c, { id }) => TEMPLATE_DETAILS[id] ?? { error: "Template not found" });

  r.get("/plans/progress", ({ db }) => {
    const rows = db.all(
      `SELECT ts.actual_date, ts.scheduled_date, ps.id AS ps_id, ps.plan_id, ps.week_number, ps.name AS ps_name
       FROM training_sessions ts JOIN plan_sessions ps ON ts.plan_session_id = ps.id
       ORDER BY (ts.actual_date IS NULL), ts.actual_date DESC, (ts.scheduled_date IS NULL) DESC, ts.scheduled_date DESC`,
    );
    const progress: Record<string, { current_week: number; last_completed_at: string | null; last_session_name: string; completed_session_ids: string[] }> = {};
    for (const row of rows) {
      progress[row.plan_id] ??= {
        current_week: row.week_number,
        last_completed_at: row.actual_date || row.scheduled_date || null,
        last_session_name: row.ps_name,
        completed_session_ids: [],
      };
      progress[row.plan_id].completed_session_ids.push(row.ps_id);
    }
    return progress;
  });

  r.get("/plans/:id", (c, { id }) => getPlan(c, id));

  r.post("/plans", (c) => {
    const b = parse(PlanCreate, c.body);
    const id = uuid();
    c.db.insert("plans", { id, name: b.name, description: b.description ?? null, is_active: true, created_at: nowIso() });
    return getPlan(c, id);
  });

  r.put("/plans/:id", (c, { id }) => {
    const b = parse(PlanUpdate, c.body);
    if (!c.db.get("plans", id)) throw notFound("Plan");
    c.db.update("plans", id, nonNull(b));
    return getPlan(c, id);
  });

  r.delete("/plans/:id", ({ db }, { id }) => {
    if (!db.get("plans", id)) throw notFound("Plan");
    deletePlanSessions(db, "WHERE plan_id = ?", id);
    db.run("DELETE FROM plans WHERE id = ?", id);
    return { message: "Plan deleted" };
  });

  r.post("/plans/:id/sessions", ({ db, body }, { id }) => {
    const b = parse(PlanSessionCreate, body);
    if (!db.get("plans", id)) throw notFound("Plan");
    const psId = uuid();
    db.insert("plan_sessions", { id: psId, plan_id: id, ...b });
    return getPlanSession(db, psId);
  });

  r.put("/plans/plan-sessions/:id", ({ db, body }, { id }) => {
    const b = parse(PlanSessionUpdate, body);
    if (!db.get("plan_sessions", id)) throw notFound("Plan session");
    db.update("plan_sessions", id, nonNull(b));
    return getPlanSession(db, id);
  });

  r.delete("/plans/plan-sessions/:id", ({ db }, { id }) => {
    if (!db.get("plan_sessions", id)) throw notFound("Plan session");
    deletePlanSessions(db, "WHERE id = ?", id);
    return { message: "Plan session deleted" };
  });

  r.post("/plans/plan-sessions/:id/exercises", ({ db, body }, { id }) => {
    const b = parse(PlanExerciseCreate, body);
    if (!db.get("plan_sessions", id)) throw notFound("Plan session");
    const ex = db.get("exercises", b.exercise_id);
    if (!ex) throw notFound("Exercise");
    const row = { id: uuid(), plan_session_id: id, ...b };
    db.insert("plan_exercises", row);
    return planExerciseOut(db.get("plan_exercises", row.id)!, ex);
  });

  r.put("/plans/plan-exercises/:id", ({ db, body }, { id }) => {
    const b = parse(PlanExerciseUpdate, body);
    if (!db.get("plan_exercises", id)) throw notFound("Plan exercise");
    db.update("plan_exercises", id, nonNull(b));
    const pe = db.get("plan_exercises", id)!;
    return planExerciseOut(pe, db.get("exercises", pe.exercise_id));
  });

  r.delete("/plans/plan-exercises/:id", ({ db }, { id }) => {
    if (!db.get("plan_exercises", id)) throw notFound("Plan exercise");
    db.run("DELETE FROM plan_exercises WHERE id = ?", id);
    return { message: "Plan exercise deleted" };
  });

  r.get("/plans/plan-sessions/:id/preview", ({ db }, { id }) => {
    const ps = getPlanSession(db, id);
    const unknown = { id: "", name: "Unknown", muscle_group: "Unknown", description: null, created_at: null };
    return [...ps.exercises]
      .sort((a, b) => a.order_index - b.order_index)
      .map((pe) => ({
        plan_exercise_id: pe.id,
        exercise: pe.exercise
          ? { id: pe.exercise.id, name: pe.exercise.name, muscle_group: pe.exercise.muscle_group, description: null, created_at: null }
          : unknown,
        target_sets: pe.target_sets || 3,
        target_reps: pe.target_reps ? Math.trunc(pe.target_reps) : 10,
        suggested_weight: pe.target_weight,
        previous_weight: null,
        suggestion_reason: "Based on your plan",
        rest_seconds: pe.rest_seconds || 60,
      }));
  });

  r.post("/plans/plan-sessions/:id/apply", ({ db, body }, { id }) => {
    const b = parse(ApplyBody, body ?? {});
    const ps = getPlanSession(db, id);
    if (!db.get("plans", ps.plan_id)) throw notFound("Plan");
    const tsId = b.training_session_id;
    if (!tsId || !db.get("training_sessions", tsId)) throw new HttpError(404, "Session not found");

    const overrides = new Map<unknown, Record<string, unknown>>((b.overrides ?? []).map((o) => [o.plan_exercise_id, o]));
    db.update("training_sessions", tsId, { plan_session_id: ps.id });

    for (const pe of [...ps.exercises].sort((a, b) => a.order_index - b.order_index)) {
      const o = overrides.get(pe.id) ?? {};
      if (o.include === false || (("include" in o) && !o.include)) continue;
      const seId = uuid();
      db.insert("session_exercises", { id: seId, session_id: tsId, exercise_id: pe.exercise_id, order_index: pe.order_index, notes: pe.notes });
      const w = (o.weight as number | null | undefined) || pe.target_weight || 0;
      for (let n = 1; n <= (pe.target_sets || 3); n++) {
        db.insert("exercise_sets", {
          id: uuid(),
          session_exercise_id: seId,
          set_number: n,
          reps: pe.target_reps || 10,
          weight: w ? Number(w) : 0.0,
          is_warmup: false,
          is_completed: false,
        });
      }
    }
    return { message: "Plan session applied" };
  });
}
