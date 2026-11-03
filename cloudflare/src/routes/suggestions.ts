import { z } from "zod";
import type { Row } from "../db";
import { int, notFound, nowIso, num, opt, parse, pyFloat as f, pyRound, str, uuid } from "../http";
import { aiEnabled, predict } from "../ai";
import { applyFeedback, describeFeedback, parseFeedback } from "../feedback";
import { calculateSuggestion, type SessionStats, type SuggestionResult } from "../progression";
import type { Router } from "../router";

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const parseDate = (s: string | null | undefined): number | null => {
  if (!s || !ISO_DATE.test(s)) return null;
  const t = Date.parse(s + "T00:00:00Z");
  return Number.isNaN(t) ? null : t;
};
const daysBetween = (a: number, b: number) => Math.round((b - a) / DAY_MS);
const roundToPlate = (w: number) => pyRound(pyRound(w / 2.5) * 2.5, 1);

function sessionStats(sets: Row[]): SessionStats {
  const valid = sets.filter((r) => r.weight && r.reps);
  const volume = valid.reduce((a, r) => a + Number(r.weight) * Math.trunc(r.reps), 0);
  let top: Row | null = null;
  for (const r of valid) if (!top || Number(r.weight) > Number(top.weight)) top = r;
  const rpes = sets.filter((r) => r.rpe !== null && r.rpe !== undefined).map((r) => Number(r.rpe));
  return {
    volume,
    set_count: valid.length,
    top_weight: top ? Number(top.weight) : 0,
    top_reps: top && top.reps ? Math.trunc(top.reps) : null,
    avg_rpe: rpes.length ? pyRound(rpes.reduce((a, b) => a + b, 0) / rpes.length, 1) : null,
    max_rpe: rpes.length ? Math.max(...rpes) : null,
    date: sets[0].scheduled_date ?? null,
    meso_cycle_id: sets[0].meso_cycle_id ?? null,
  };
}

const epley = (w: number, r: number) => (r <= 0 || w <= 0 || r === 1 ? w : w * (1 + r / 30));
function weightForRpe(e1rm: number, reps: number, rpe: number) {
  const eff = reps + (10 - rpe);
  return eff <= 0 ? e1rm : e1rm / (1 + eff / 30);
}

const Outcome = z.object({ actual_weight: opt(num), actual_reps: opt(int), actual_rpe: opt(num) });

export function suggestionRoutes(r: Router) {
  r.get("/suggestions/exercises", ({ db }) => {
    const rows = db.all(
      `SELECT e.id, e.name, e.muscle_group, SUM(vh.total_volume) AS volume, MAX(ts.scheduled_date) AS last_performed
       FROM exercises e
       JOIN volume_history vh ON e.id = vh.exercise_id
       JOIN training_sessions ts ON vh.session_id = ts.id
       GROUP BY e.id, e.name, e.muscle_group
       HAVING SUM(vh.total_volume) > 0
       ORDER BY SUM(vh.total_volume) DESC`,
    );
    return rows.map((ex) => {
      const volume = Number(ex.volume);
      const reason =
        volume > 50000
          ? "High volume - maintain intensity"
          : volume >= 10000
            ? "Moderate volume - consider progression"
            : "Lower volume - good candidate for more work";
      return {
        exercise: { id: ex.id, name: ex.name, muscle_group: ex.muscle_group, description: null, created_at: null },
        total_volume: volume,
        last_performed: ex.last_performed || null,
        suggestion_reason: reason,
      };
    });
  });

  r.get("/suggestions/weight", async ({ db, query, env }) => {
    const q = parse(z.object({ exercise_id: str, meso_cycle_id: opt(str), session_id: opt(str) }), query, "query");
    const exerciseId = q.exercise_id;
    let mesoCycleId = q.meso_cycle_id ?? null;

    // ── Plan context from the current session ──
    let planRpe: number | null = null;
    let planReps: number | null = null;
    let planWeek: number | null = null;
    let planTotalWeeks: number | null = null;

    if (q.session_id) {
      const ts = db.one("SELECT plan_session_id, meso_cycle_id FROM training_sessions WHERE id = ?", q.session_id);
      if (ts?.plan_session_id) {
        const ps = db.one("SELECT week_number, plan_id FROM plan_sessions WHERE id = ?", ts.plan_session_id);
        if (ps) {
          planWeek = ps.week_number;
          planTotalWeeks = db.scalar<number>("SELECT MAX(week_number) FROM plan_sessions WHERE plan_id = ?", ps.plan_id) || planWeek;
        }
        const pe = db.one(
          "SELECT target_rpe, target_reps FROM plan_exercises WHERE plan_session_id = ? AND exercise_id = ? ORDER BY rowid",
          ts.plan_session_id,
          exerciseId,
        );
        if (pe) {
          planRpe = pe.target_rpe ?? null;
          planReps = pe.target_reps ?? null;
        }
      }
      if (!mesoCycleId && ts?.meso_cycle_id) mesoCycleId = ts.meso_cycle_id;
    }

    // ── History (Postgres ordering: NULLs first on DESC) ──
    const rows = db.all(
      `SELECT es.weight, es.reps, es.rpe, ts.id AS session_id, ts.scheduled_date, ts.meso_cycle_id
       FROM exercise_sets es
       JOIN session_exercises se ON es.session_exercise_id = se.id
       JOIN training_sessions ts ON se.session_id = ts.id
       WHERE se.exercise_id = ? AND ts.status = 'completed' AND es.is_completed = 1
         AND es.is_warmup = 0 AND es.weight > 0 ${mesoCycleId ? "AND ts.meso_cycle_id = ?" : ""}
       ORDER BY (ts.scheduled_date IS NULL) DESC, ts.scheduled_date DESC,
                (ts.created_at IS NULL) DESC, ts.created_at DESC, es.set_number DESC
       LIMIT 300`,
      exerciseId,
      ...(mesoCycleId ? [mesoCycleId] : []),
    );

    if (!rows.length) {
      return {
        previous_weight: 0,
        suggested_weight: 0,
        average_rpe: null,
        adjustment_reason: "No history - start light (RPE 6-7) and build up",
        meso_week: planWeek || 1,
        meso_phase: "accumulation",
        target_rpe: planRpe || 7.0,
        session_volume: 0,
        set_count: 0,
        previous_volume: null,
        volume_trend: "none",
        suggested_sets: 3,
        volume_directive: "Start at MEV (~3-4 working sets), prioritise technique",
        estimated_1rm: null,
        average_weight: 0,
        suggestion: "No history - start light and build up",
        percentage: 100,
      };
    }

    const bySession = new Map<string, Row[]>();
    for (const row of rows) {
      if (!bySession.has(row.session_id)) bySession.set(row.session_id, []);
      bySession.get(row.session_id)!.push(row);
    }
    const groups = [...bySession.values()];
    const lastSets = groups[0];
    const last = sessionStats(lastSets);
    const prev = groups.length > 1 ? sessionStats(groups[1]) : null;

    // ── Meso week detection ──
    let mesoWeek = planWeek;
    let mesoTotalWeeks = planTotalWeeks || 4;
    if (mesoWeek === null) {
      if (mesoCycleId && last.date) {
        const meso = db.get("meso_cycles", mesoCycleId);
        const start = parseDate(meso?.start_date);
        const lastD = parseDate(last.date);
        if (start !== null && lastD !== null) {
          mesoWeek = Math.max(1, Math.floor(daysBetween(start, lastD) / 7) + 1);
          const end = parseDate(meso?.end_date);
          if (end !== null) mesoTotalWeeks = Math.max(4, Math.floor(daysBetween(start, end) / 7));
        }
      }
      if (mesoWeek === null) {
        const todayMs = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
        const cutoff = todayMs - 56 * DAY_MS;
        const weeks = new Set<number>();
        for (const sets of groups) {
          const d = parseDate(sets[0].scheduled_date);
          if (d !== null && d >= cutoff) weeks.add(Math.floor(daysBetween(cutoff, d) / 7));
        }
        mesoWeek = weeks.size ? Math.max(1, weeks.size) : 1;
      }
    }

    // ── Suggestion ──
    let suggestion: SuggestionResult | null = null;
    if (planRpe !== null) {
      const targetReps = planReps !== null ? planReps : last.top_reps || 10;
      const est: number[] = [];
      for (const s of lastSets) {
        const w = Number(s.weight);
        const reps = s.reps ? Math.trunc(s.reps) : 0;
        if (w <= 0 || reps <= 0) continue;
        if (s.rpe !== null && s.rpe !== undefined) est.push(w * (1 + (reps + (10 - Number(s.rpe))) / 30));
        else est.push(epley(w, reps));
      }
      if (est.length) {
        est.sort((a, b) => a - b);
        const mid = Math.floor(est.length / 2);
        const e1rm = est.length % 2 ? est[mid] : (est[mid - 1] + est[mid]) / 2;
        const suggested = roundToPlate(weightForRpe(e1rm, targetReps, planRpe));

        const weekLabel =
          planWeek && planTotalWeeks ? `Week ${planWeek}/${planTotalWeeks}` : planWeek ? `Week ${planWeek}` : "";
        const diff = suggested - last.top_weight;
        const delta =
          Math.abs(diff) < 0.1
            ? "same as last session"
            : diff > 0
              ? `+${f(roundToPlate(diff))} lbs from last`
              : `${f(roundToPlate(diff))} lbs from last`;
        const effort = `RPE ${f(planRpe)}`;
        let sets = last.set_count;
        if (last.avg_rpe !== null) {
          if (last.avg_rpe < 7.5) sets += 1;
          else if (last.avg_rpe >= 9.0) sets = Math.max(1, sets - 1);
        }
        suggestion = {
          suggested_weight: suggested,
          adjustment_reason: weekLabel ? `${weekLabel} · ${effort} · ${delta}` : `${effort} · ${delta}`,
          meso_week: mesoWeek,
          meso_phase: "plan",
          meso_phase_label: weekLabel ? `Programmed (${weekLabel})` : "Programmed",
          target_rpe: planRpe,
          suggested_sets: Math.min(sets, 12),
          volume_directive: "Follow plan volume",
          estimated_1rm: pyRound(e1rm, 1),
        };
      }
    }
    suggestion ??= calculateSuggestion(last, mesoWeek, mesoTotalWeeks);

    // ── RP-style feedback from the last session of this exercise ──
    const lastFeedback = parseFeedback(
      db.scalar(
        "SELECT feedback FROM session_exercises WHERE session_id = ? AND exercise_id = ? AND feedback IS NOT NULL ORDER BY rowid DESC LIMIT 1",
        lastSets[0].session_id,
        exerciseId,
      ),
    );
    const fb = applyFeedback(suggestion, lastFeedback, last.top_weight);
    suggestion = fb.suggestion;

    const volPrev = prev ? prev.volume : null;
    const volLast = last.volume;
    const trend =
      volPrev === null ? "no prior data" : volLast > volPrev * 1.05 ? "increasing" : volLast < volPrev * 0.95 ? "decreasing" : "stable";

    // ── Workers AI prediction (guarded by the rules result; falls back to it) ──
    const rulesWeight = suggestion.suggested_weight;
    const rulesReason = suggestion.adjustment_reason;
    let source: "ai" | "rules" = "rules";
    if (aiEnabled(env) && rulesWeight > 0) {
      const exerciseName = (db.scalar<string>("SELECT name FROM exercises WHERE id = ?", exerciseId)) ?? "Unknown exercise";
      const history = groups.slice(0, 6).map((sets) => ({
        date: sets[0].scheduled_date ?? null,
        sets: [...sets].reverse().map((x) => ({ weight: Number(x.weight), reps: x.reps ?? null, rpe: x.rpe ?? null })),
      }));
      const cacheKey = [env.AI_MODEL, exerciseId, lastSets[0].session_id, q.session_id ?? "", planRpe ?? "", planReps ?? "", rulesWeight, suggestion.suggested_sets, JSON.stringify(lastFeedback)].join("|");
      const ai = await predict(env, db, cacheKey, {
        exerciseName,
        history,
        planTargetReps: planReps,
        planTargetRpe: planRpe,
        feedback: lastFeedback ? describeFeedback(lastFeedback) : null,
        rules: suggestion,
      });
      if (ai) {
        source = "ai";
        suggestion = { ...suggestion, suggested_weight: ai.suggested_weight, suggested_sets: ai.suggested_sets, adjustment_reason: ai.reason };
        // The feedback weight cap is a guardrail: the AI can't override it.
        if (lastFeedback && (lastFeedback.joints >= 1 || lastFeedback.workload === 3) && suggestion.suggested_weight > last.top_weight) {
          suggestion = { ...suggestion, suggested_weight: last.top_weight };
        }
        if (fb.note) suggestion = { ...suggestion, adjustment_reason: `${suggestion.adjustment_reason} | ${fb.note}` };
      }
    }

    const logId = uuid();
    db.insert("suggestion_logs", {
      id: logId,
      exercise_id: exerciseId,
      meso_cycle_id: mesoCycleId,
      previous_weight: pyRound(last.top_weight, 1),
      average_rpe: last.avg_rpe,
      suggested_weight: suggestion.suggested_weight,
      adjustment_reason: suggestion.adjustment_reason,
      created_at: nowIso(),
    });

    return {
      previous_weight: pyRound(last.top_weight, 1),
      suggested_weight: suggestion.suggested_weight,
      average_rpe: last.avg_rpe,
      adjustment_reason: suggestion.adjustment_reason,
      meso_week: suggestion.meso_week,
      meso_phase: suggestion.meso_phase,
      meso_phase_label: suggestion.meso_phase_label,
      target_rpe: suggestion.target_rpe,
      session_volume: pyRound(volLast, 1),
      set_count: last.set_count,
      previous_volume: volPrev !== null ? pyRound(volPrev, 1) : null,
      volume_trend: trend,
      suggested_sets: suggestion.suggested_sets,
      volume_directive: suggestion.volume_directive,
      estimated_1rm: suggestion.estimated_1rm,
      average_weight: pyRound(last.top_weight, 1),
      suggestion: suggestion.adjustment_reason,
      percentage: last.top_weight ? pyRound((suggestion.suggested_weight / last.top_weight) * 100, 1) : 100,
      log_id: logId,
      feedback: lastFeedback,
      feedback_note: fb.note,
      prediction_source: source,
      rules_suggested_weight: rulesWeight,
      rules_adjustment_reason: rulesReason,
    };
  });

  r.get("/suggestions/weight/history", ({ db, query }) => {
    const q = parse(
      z.object({ exercise_id: opt(str), meso_cycle_id: opt(str), limit: int.pipe(z.number().max(100)).default(20) }),
      query,
      "query",
    );
    const where: string[] = [];
    const args: unknown[] = [];
    if (q.exercise_id) (where.push("sl.exercise_id = ?"), args.push(q.exercise_id));
    if (q.meso_cycle_id) (where.push("sl.meso_cycle_id = ?"), args.push(q.meso_cycle_id));
    const rows = db.all(
      `SELECT sl.*, e.name AS exercise_name, e.muscle_group FROM suggestion_logs sl
       JOIN exercises e ON sl.exercise_id = e.id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY (sl.created_at IS NULL) DESC, sl.created_at DESC LIMIT ?`,
      ...args,
      q.limit,
    );
    return rows.map((l) => ({
      id: l.id,
      exercise_id: l.exercise_id,
      exercise_name: l.exercise_name,
      muscle_group: l.muscle_group,
      meso_cycle_id: l.meso_cycle_id ?? null,
      previous_weight: l.previous_weight ?? null,
      suggested_weight: l.suggested_weight,
      average_rpe: l.average_rpe ?? null,
      adjustment_reason: l.adjustment_reason,
      actual_weight: l.actual_weight ?? null,
      actual_reps: l.actual_reps ?? null,
      actual_rpe: l.actual_rpe ?? null,
      created_at: l.created_at ?? null,
    }));
  });

  r.patch("/suggestions/weight/history/:id", ({ db, body }, { id }) => {
    const b = parse(Outcome, body);
    if (!db.get("suggestion_logs", id)) throw notFound("Suggestion log");
    db.update("suggestion_logs", id, {
      actual_weight: b.actual_weight ?? undefined,
      actual_reps: b.actual_reps ?? undefined,
      actual_rpe: b.actual_rpe ?? undefined,
    });
    return { message: "Outcome recorded", log_id: id };
  });

  r.get("/suggestions/muscle-groups", ({ db }) => {
    const rows = db.all(
      `SELECT e.muscle_group, SUM(vh.total_volume) AS volume FROM exercises e
       JOIN volume_history vh ON e.id = vh.exercise_id GROUP BY e.muscle_group`,
    );
    const out: Record<string, number> = {};
    for (const g of rows) if (g.volume && g.volume > 0) out[g.muscle_group] = Math.trunc(g.volume);
    return out;
  });
}
