// RP Hypertrophy-style post-exercise feedback: the questions shown after an
// exercise's last set, and (for the in-browser demo backend) the same
// adjustment rules the real API applies — keep in sync with
// cloudflare/src/feedback.ts.

export interface ExerciseFeedback {
  /** 0 low · 1 moderate · 2 amazing */
  pump: number;
  /** 0 easy · 1 pretty good · 2 pushed my limits · 3 too much */
  workload: number;
  /** 0 none · 1 some · 2 a lot */
  joints: number;
}

export const FEEDBACK_QUESTIONS: { key: keyof ExerciseFeedback; label: string; options: string[] }[] = [
  { key: 'pump', label: 'Pump', options: ['Low', 'Moderate', 'Amazing'] },
  // Easy · Good (pretty good) · Hard (pushed my limits) · Too much
  { key: 'workload', label: 'Workload', options: ['Easy', 'Good', 'Hard', 'Too much'] },
  { key: 'joints', label: 'Joint pain', options: ['None', 'Some', 'A lot'] },
];

const PUMP = ['low pump', 'moderate pump', 'great pump'];
const WORKLOAD = ['felt easy', 'workload was good', 'pushed your limits', 'too much'];
const JOINTS = ['no joint pain', 'some joint discomfort', 'a lot of joint pain'];
export const describeFeedback = (fb: ExerciseFeedback) => `${WORKLOAD[fb.workload]}, ${PUMP[fb.pump]}, ${JOINTS[fb.joints]}`;

export function isValidFeedback(v: unknown): v is ExerciseFeedback {
  if (!v || typeof v !== 'object') return false;
  const f = v as Record<string, unknown>;
  const ok = (x: unknown, max: number) => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= max;
  return ok(f.pump, 2) && ok(f.workload, 3) && ok(f.joints, 2);
}

/** Same rules as the API: see cloudflare/src/feedback.ts for the rationale. */
export function applyFeedback<T extends { suggested_weight: number; suggested_sets: number; adjustment_reason: string; meso_phase: string }>(
  s: T,
  fb: ExerciseFeedback | null,
  lastTopWeight: number,
): { suggestion: T; note: string | null } {
  if (!fb) return { suggestion: s, note: null };
  const deload = s.meso_phase === 'deload';
  let sets = s.suggested_sets;
  let weight = s.suggested_weight;
  const notes: string[] = [];
  if (fb.workload === 3 || fb.joints === 2) {
    sets = Math.max(1, sets - 1);
    notes.push('−1 set');
  } else if (!deload && ((fb.workload === 0 && fb.pump <= 1) || (fb.workload === 1 && fb.pump === 0))) {
    sets = Math.min(12, sets + 1);
    notes.push('+1 set');
  }
  if ((fb.joints >= 1 || fb.workload === 3) && lastTopWeight > 0 && weight > lastTopWeight) {
    weight = lastTopWeight;
    notes.push(`hold ${lastTopWeight} lbs`);
  }
  if (!notes.length) return { suggestion: s, note: null };
  const note = `Last time ${describeFeedback(fb)} → ${notes.join(', ')}`;
  return { suggestion: { ...s, suggested_sets: sets, suggested_weight: weight, adjustment_reason: `${s.adjustment_reason} | ${note}` }, note };
}
