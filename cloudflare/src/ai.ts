// Workers AI weight predictions, layered on top of the deterministic rules
// engine. The rules result is always computed first and is both the guardrail
// (AI output is clamped to ±10% of it) and the fallback on any failure.
import type { Db, Row } from "./db";
import { nowIso, pyFloat as f, pyRound } from "./http";

const MAX_DEVIATION = 0.1;
const TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 14 * 24 * 3600_000;

export interface RulesSuggestion {
  suggested_weight: number;
  suggested_sets: number;
  adjustment_reason: string;
  target_rpe: number;
  meso_week: number;
  meso_phase: string;
}

export interface AiPrediction {
  suggested_weight: number;
  suggested_sets: number;
  reason: string;
}

export interface PredictionInput {
  exerciseName: string;
  /** Most recent first; each entry is one past session's working sets. */
  history: { date: string | null; sets: { weight: number; reps: number | null; rpe: number | null }[] }[];
  planTargetReps: number | null;
  planTargetRpe: number | null;
  /** Lifter's feedback after the last session of this exercise, in words. */
  feedback?: string | null;
  rules: RulesSuggestion;
}

const SCHEMA = {
  type: "object",
  properties: {
    suggested_weight: { type: "number" },
    suggested_sets: { type: "integer" },
    reason: { type: "string" },
  },
  required: ["suggested_weight", "suggested_sets", "reason"],
};

const SYSTEM = `You are a strength coach predicting the next working weight for one exercise.
Use RPE-based autoregulation: if recent RPE is below target, progress; if above, hold or reduce.
A rules engine already produced a baseline; stay within 10% of it and only deviate with a clear reason
from the history (e.g. a consistent trend, missed reps, a fatigue spike). Weights are in lbs, rounded to 2.5.
Reply with JSON only. "reason" is one short sentence (max 140 characters) shown to the lifter.`;

function prompt(p: PredictionInput): string {
  const lines = p.history.slice(0, 6).map((s, i) => {
    const sets = s.sets.map((x) => `${f(x.weight)}x${x.reps ?? "?"}${x.rpe != null ? `@${x.rpe}` : ""}`).join(", ");
    return `${i === 0 ? "last" : `-${i}`} (${s.date ?? "undated"}): ${sets}`;
  });
  const plan =
    p.planTargetRpe != null || p.planTargetReps != null
      ? `Plan target today: ${p.planTargetReps ?? "?"} reps @ RPE ${p.planTargetRpe ?? "?"}.`
      : "No program target today.";
  return [
    `Exercise: ${p.exerciseName}`,
    `Recent sessions (weight x reps @RPE):`,
    ...lines,
    plan,
    ...(p.feedback ? [`Lifter feedback after last session: ${p.feedback}.`] : []),
    `Meso week ${p.rules.meso_week}, phase "${p.rules.meso_phase}", target RPE ${p.rules.target_rpe}.`,
    `Rules baseline: ${f(p.rules.suggested_weight)} lbs for ${p.rules.suggested_sets} sets (${p.rules.adjustment_reason}).`,
  ].join("\n");
}

const roundToPlate = (w: number) => pyRound(pyRound(w / 2.5) * 2.5, 1);

/** Clamp and sanitize model output; null when it is unusable. */
export function sanitize(raw: unknown, rules: RulesSuggestion): AiPrediction | null {
  const o = (typeof raw === "string" ? safeJson(raw) : raw) as Row | null;
  if (!o || typeof o !== "object") return null;
  const w = Number(o.suggested_weight);
  const sets = Math.round(Number(o.suggested_sets));
  const reason = typeof o.reason === "string" ? o.reason.trim().replace(/\s+/g, " ").slice(0, 200) : "";
  if (!Number.isFinite(w) || w < 0 || !Number.isFinite(sets) || !reason) return null;
  const base = rules.suggested_weight;
  const lo = base * (1 - MAX_DEVIATION);
  const hi = base * (1 + MAX_DEVIATION);
  return {
    suggested_weight: roundToPlate(base > 0 ? Math.min(hi, Math.max(lo, w)) : w),
    suggested_sets: Math.min(12, Math.max(1, sets)),
    reason,
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export const aiEnabled = (env: Env) => env.AI_PREDICTIONS === "on" && !!env.AI;

/**
 * Get an AI prediction, using the per-store cache. `cacheKey` must change
 * whenever the inputs change (new session logged, different plan context).
 */
export async function predict(env: Env, db: Db, cacheKey: string, input: PredictionInput): Promise<AiPrediction | null> {
  const hit = db.one("SELECT result, created_at FROM ai_predictions WHERE key = ?", cacheKey);
  if (hit && Date.now() - Date.parse(hit.created_at + "Z") < CACHE_TTL_MS) {
    return sanitize(safeJson(hit.result), input.rules);
  }

  let raw: unknown;
  try {
    const call = env.AI!.run(env.AI_MODEL as Parameters<Ai["run"]>[0], {
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt(input) },
      ],
      response_format: { type: "json_schema", json_schema: SCHEMA },
      max_tokens: 160,
      temperature: 0.2,
    } as never) as Promise<{ response?: unknown }>;
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("AI timeout")), TIMEOUT_MS));
    raw = (await Promise.race([call, timeout])).response;
  } catch (e) {
    console.warn("Workers AI prediction failed, using rules engine:", String(e));
    return null;
  }

  const pred = sanitize(raw, input.rules);
  if (pred) {
    db.run(
      "INSERT INTO ai_predictions (key, result, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET result = excluded.result, created_at = excluded.created_at",
      cacheKey,
      JSON.stringify(pred),
      nowIso(),
    );
  }
  return pred;
}
