/** Plate maths for a barbell in lbs (Strong/Hevy-style plate calculator). */

export const DEFAULT_PLATES = [45, 35, 25, 10, 5, 2.5];
export const BARS = [
  { label: 'Olympic bar', weight: 45 },
  { label: "Women's bar", weight: 35 },
  { label: 'Training bar', weight: 15 },
];

export interface PlateLoad {
  /** Plates for ONE side, heaviest first. */
  perSide: number[];
  /** Weight actually loaded (bar + both sides). */
  loaded: number;
  /** Target minus loaded; > 0 when the target can't be made exactly. */
  remainder: number;
  /** Target is at or below the empty bar. */
  barOnly: boolean;
}

/** Greedy works for standard plate sets (each plate ≥ 2× or a sum of smaller ones). */
export function platesFor(target: number, bar = 45, plates = DEFAULT_PLATES): PlateLoad {
  if (!Number.isFinite(target) || target <= bar) {
    return { perSide: [], loaded: bar, remainder: Math.max(0, +(target - bar).toFixed(2)), barOnly: true };
  }
  let side = (target - bar) / 2;
  const perSide: number[] = [];
  for (const p of [...plates].sort((a, b) => b - a)) {
    while (side + 1e-9 >= p) {
      perSide.push(p);
      side -= p;
    }
  }
  const loaded = bar + 2 * perSide.reduce((a, b) => a + b, 0);
  return { perSide, loaded, remainder: +(target - loaded).toFixed(2), barOnly: false };
}

/** Group a side's plates for display: [{plate: 45, count: 2}, ...]. */
export function groupPlates(perSide: number[]): { plate: number; count: number }[] {
  const out: { plate: number; count: number }[] = [];
  for (const p of perSide) {
    const last = out[out.length - 1];
    if (last && last.plate === p) last.count += 1;
    else out.push({ plate: p, count: 1 });
  }
  return out;
}
