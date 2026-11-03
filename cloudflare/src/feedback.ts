// RP Hypertrophy-style post-exercise feedback and how it steers the next
// session's recommendation. Collected after the last set of an exercise:
//   pump      0 low · 1 moderate · 2 amazing
//   workload  0 easy · 1 pretty good · 2 pushed my limits · 3 too much
//   joints    0 none · 1 some discomfort · 2 a lot
import { z } from "zod";
import { pyFloat as f } from "./http";

export const FeedbackSchema = z.object({
  pump: z.number().int().min(0).max(2),
  workload: z.number().int().min(0).max(3),
  joints: z.number().int().min(0).max(2),
});
export type Feedback = z.infer<typeof FeedbackSchema>;

export function parseFeedback(raw: unknown): Feedback | null {
  if (raw == null) return null;
  try {
    const r = FeedbackSchema.safeParse(typeof raw === "string" ? JSON.parse(raw) : raw);
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

const PUMP = ["low pump", "moderate pump", "great pump"];
const WORKLOAD = ["felt easy", "workload was good", "pushed your limits", "too much"];
const JOINTS = ["no joint pain", "some joint discomfort", "a lot of joint pain"];
export const describeFeedback = (fb: Feedback) => `${WORKLOAD[fb.workload]}, ${PUMP[fb.pump]}, ${JOINTS[fb.joints]}`;

export interface Adjustable {
  suggested_weight: number;
  suggested_sets: number;
  adjustment_reason: string;
  meso_phase: string;
}

/**
 * Adjust a suggestion with last session's feedback for this exercise.
 *  - Sets: too much / a lot of joint pain → −1 set; easy with low or moderate
 *    pump, or good workload with low pump → +1 set (not in a deload).
 *  - Load: any joint discomfort, or "too much", caps the weight at last
 *    session's top weight (no increase until it feels better).
 * The note is appended as the last " | " segment so the UI shows it.
 */
export function applyFeedback<T extends Adjustable>(s: T, fb: Feedback | null, lastTopWeight: number): { suggestion: T; note: string | null } {
  if (!fb) return { suggestion: s, note: null };
  const deload = s.meso_phase === "deload";
  let sets = s.suggested_sets;
  let weight = s.suggested_weight;
  const notes: string[] = [];

  if (fb.workload === 3 || fb.joints === 2) {
    sets = Math.max(1, sets - 1);
    notes.push("−1 set");
  } else if (!deload && ((fb.workload === 0 && fb.pump <= 1) || (fb.workload === 1 && fb.pump === 0))) {
    sets = Math.min(12, sets + 1);
    notes.push("+1 set");
  }
  if ((fb.joints >= 1 || fb.workload === 3) && lastTopWeight > 0 && weight > lastTopWeight) {
    weight = lastTopWeight;
    notes.push(`hold ${f(lastTopWeight)} lbs`);
  }

  if (!notes.length) return { suggestion: s, note: null };
  const note = `Last time ${describeFeedback(fb)} → ${notes.join(", ")}`;
  return {
    suggestion: { ...s, suggested_sets: sets, suggested_weight: weight, adjustment_reason: `${s.adjustment_reason} | ${note}` },
    note,
  };
}
