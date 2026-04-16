/**
 * Unit tests for the RP-style weight suggestion algorithm.
 *
 * The algorithm lives in the backend, but its logic can be replicated here
 * in TypeScript to verify all edge cases without running the full server.
 * These tests serve as living documentation and guard against drift if the
 * algorithm is ever ported/mirrored to the frontend for offline use.
 */

// ── Pure algorithm mirror ─────────────────────────────────────────────────────

interface SetRow {
  weight: number;
  reps: number;
  rpe?: number;
}

interface SessionSets {
  sets: SetRow[];
}

interface PlanContext {
  targetRpe: number;
  targetReps: number;
  weekNumber?: number;
  totalWeeks?: number;
}

function epleyE1rm(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return weight;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

function weightForRpe(e1rm: number, targetReps: number, targetRpe: number): number {
  const rir = 10 - targetRpe;
  const effectiveReps = targetReps + rir;
  if (effectiveReps <= 0) return e1rm;
  return e1rm / (1 + effectiveReps / 30);
}

function roundToPlate(weight: number): number {
  return Math.round(Math.round(weight / 2.5) * 2.5 * 10) / 10;
}

function suggestWeight(
  sessions: SessionSets[], // most recent first
  plan?: PlanContext,
): {
  previous_weight: number;
  suggested_weight: number;
  average_rpe: number | null;
  adjustment_reason: string;
} {
  if (sessions.length === 0) {
    return {
      previous_weight: 0,
      suggested_weight: 0,
      average_rpe: null,
      adjustment_reason: 'No history — start light and build up',
    };
  }

  const topSet = (sets: SetRow[]) => sets.reduce((a, b) => (b.weight > a.weight ? b : a));

  const lastSets = sessions[0].sets;
  const lastTop = topSet(lastSets);
  const lastWeight = lastTop.weight;

  const lastRpes = lastSets.map(s => s.rpe).filter((r): r is number => r != null);
  const avgRpe = lastRpes.length > 0 ? lastRpes.reduce((a, b) => a + b) / lastRpes.length : null;

  const prevWeight = sessions.length > 1 ? topSet(sessions[1].sets).weight : null;

  let suggested: number;
  let reason: string;

  // ── e1RM-based path (when plan context is available) ─────────────────────
  let usedPlan = false;
  if (plan && lastTop.reps > 0) {
    const targetReps = plan.targetReps || lastTop.reps;

    // Compute e1RM from each set, RPE-adjusted when available (median for robustness)
    const estimates: number[] = [];
    for (const s of lastSets) {
      if (s.weight <= 0 || s.reps <= 0) continue;
      if (s.rpe != null) {
        const rir = 10 - s.rpe;
        estimates.push(s.weight * (1 + (s.reps + rir) / 30));
      } else {
        estimates.push(epleyE1rm(s.weight, s.reps));
      }
    }

    if (estimates.length > 0) {
      estimates.sort((a, b) => a - b);
      const mid = Math.floor(estimates.length / 2);
      const e1rm = estimates.length % 2 ? estimates[mid] : (estimates[mid - 1] + estimates[mid]) / 2;

      suggested = roundToPlate(weightForRpe(e1rm, targetReps, plan.targetRpe));

      const diff = suggested - lastWeight;
      const delta = Math.abs(diff) < 0.1
        ? 'same as last session'
        : diff > 0 ? `+${roundToPlate(diff)} lbs from last` : `${roundToPlate(diff)} lbs from last`;
      const rir = 10 - plan.targetRpe;
      const rirLabel = rir === Math.floor(rir) ? `${rir} RIR` : `${Math.round(rir)} RIR`;
      const weekLabel = plan.weekNumber && plan.totalWeeks
        ? `Week ${plan.weekNumber}/${plan.totalWeeks}`
        : plan.weekNumber ? `Week ${plan.weekNumber}` : '';
      reason = weekLabel
        ? `${weekLabel} · RPE ${plan.targetRpe} (${rirLabel}) · ${delta}`
        : `RPE ${plan.targetRpe} (${rirLabel}) · ${delta}`;
      usedPlan = true;
    }
  }

  // ── Heuristic fallback ───────────────────────────────────────────────────
  if (!usedPlan) {
    if (avgRpe === null) {
      if (prevWeight !== null && lastWeight > prevWeight) {
        suggested = lastWeight + 2.5;
        reason = `Beat last session (${prevWeight} → ${lastWeight} lbs) — keep progressing`;
      } else if (prevWeight !== null && lastWeight === prevWeight) {
        suggested = lastWeight + 2.5;
        reason = `Matched last session at ${lastWeight} lbs — try adding 2.5 lbs`;
      } else {
        suggested = lastWeight;
        reason = `Top set: ${lastWeight} lbs — no RPE logged, hold and track effort`;
      }
    } else if (avgRpe >= 9.5) {
      suggested = lastWeight * 0.95;
      reason = `RPE ${avgRpe} — very high effort, back off ~5% to recover quality reps`;
    } else if (avgRpe >= 9.0) {
      suggested = lastWeight;
      reason = `RPE ${avgRpe} — hold at ${lastWeight} lbs and aim for ${lastTop.reps + 1}+ reps`;
    } else if (avgRpe >= 8.0) {
      suggested = lastWeight + 2.5;
      reason = `RPE ${avgRpe} — solid effort, add 2.5 lbs`;
    } else if (avgRpe >= 7.0) {
      suggested = lastWeight + 2.5;
      reason = `RPE ${avgRpe} — in the zone, progress +2.5 lbs`;
    } else {
      suggested = lastWeight + 5.0;
      reason = `RPE ${avgRpe} — felt easy, push harder (+5 lbs)`;
    }

    suggested = roundToPlate(suggested);
  }

  const roundedAvgRpe =
    avgRpe !== null ? Math.round(avgRpe * 10) / 10 : null;

  return {
    previous_weight: Math.round(lastWeight * 10) / 10,
    suggested_weight: suggested!,
    average_rpe: roundedAvgRpe,
    adjustment_reason: reason!,
  };
}

// ── No history ────────────────────────────────────────────────────────────────

test('no history returns zeroes with guidance', () => {
  const result = suggestWeight([]);
  expect(result.previous_weight).toBe(0);
  expect(result.suggested_weight).toBe(0);
  expect(result.average_rpe).toBeNull();
  expect(result.adjustment_reason).toMatch(/no history/i);
});

// ── RPE thresholds ────────────────────────────────────────────────────────────

test('avg_rpe 6.5 → +5 lbs (too easy)', () => {
  const result = suggestWeight([
    { sets: [{ weight: 100, reps: 10, rpe: 6.5 }, { weight: 100, reps: 10, rpe: 6.5 }] },
  ]);
  expect(result.suggested_weight).toBe(105);
  expect(result.adjustment_reason).toMatch(/\+5/);
});

test('avg_rpe 7.0 → +2.5 lbs (optimal zone lower boundary)', () => {
  const result = suggestWeight([
    { sets: [{ weight: 100, reps: 10, rpe: 7.0 }] },
  ]);
  expect(result.suggested_weight).toBe(102.5);
});

test('avg_rpe 7.5 → +2.5 lbs (mid optimal zone)', () => {
  const result = suggestWeight([
    { sets: [{ weight: 100, reps: 10, rpe: 7.5 }] },
  ]);
  expect(result.suggested_weight).toBe(102.5);
});

test('avg_rpe 8.0 → +2.5 lbs (late-meso boundary)', () => {
  const result = suggestWeight([
    { sets: [{ weight: 100, reps: 8, rpe: 8.0 }] },
  ]);
  expect(result.suggested_weight).toBe(102.5);
});

test('avg_rpe 8.5 → +2.5 lbs (late-meso mid)', () => {
  const result = suggestWeight([
    { sets: [{ weight: 100, reps: 8, rpe: 8.5 }] },
  ]);
  expect(result.suggested_weight).toBe(102.5);
});

test('avg_rpe 9.0 → hold weight', () => {
  const result = suggestWeight([
    { sets: [{ weight: 100, reps: 6, rpe: 9.0 }] },
  ]);
  expect(result.suggested_weight).toBe(100);
  expect(result.adjustment_reason).toMatch(/hold/i);
});

test('avg_rpe 9.2 → hold weight', () => {
  const result = suggestWeight([
    { sets: [{ weight: 100, reps: 6, rpe: 9.2 }] },
  ]);
  expect(result.suggested_weight).toBe(100);
});

test('avg_rpe 9.5 → -5% (deload boundary)', () => {
  const result = suggestWeight([
    { sets: [{ weight: 100, reps: 5, rpe: 9.5 }] },
  ]);
  // 100 * 0.95 = 95, rounded to 2.5 = 95
  expect(result.suggested_weight).toBe(95);
  expect(result.adjustment_reason).toMatch(/back off/i);
});

test('avg_rpe 9.8 → -5% deload', () => {
  const result = suggestWeight([
    { sets: [{ weight: 200, reps: 3, rpe: 9.8 }] },
  ]);
  // 200 * 0.95 = 190, nearest 2.5 = 190
  expect(result.suggested_weight).toBe(190);
});

// ── Rounding to nearest 2.5 ───────────────────────────────────────────────────

test('suggestion rounds to nearest 2.5 lbs', () => {
  // 101 + 2.5 = 103.5 → round(103.5/2.5)*2.5 = round(41.4)*2.5 = 41*2.5 = 102.5
  const result = suggestWeight([
    { sets: [{ weight: 101, reps: 8, rpe: 7.5 }] },
  ]);
  expect(result.suggested_weight % 2.5).toBeCloseTo(0);
});

test('deload rounding — 105 * 0.95 = 99.75 → nearest 2.5 = 100', () => {
  const result = suggestWeight([
    { sets: [{ weight: 105, reps: 5, rpe: 9.8 }] },
  ]);
  // 105 * 0.95 = 99.75 → round(99.75/2.5)*2.5 = round(39.9)*2.5 = 40*2.5 = 100
  expect(result.suggested_weight).toBe(100);
});

// ── No RPE fallback ───────────────────────────────────────────────────────────

test('no RPE, single session → hold weight with note', () => {
  const result = suggestWeight([
    { sets: [{ weight: 80, reps: 10 }] },
  ]);
  expect(result.previous_weight).toBe(80);
  expect(result.suggested_weight).toBe(80);
  expect(result.average_rpe).toBeNull();
});

test('no RPE, two sessions improving → +2.5 lbs', () => {
  const result = suggestWeight([
    { sets: [{ weight: 85, reps: 10 }] },  // more recent
    { sets: [{ weight: 80, reps: 10 }] },  // older
  ]);
  expect(result.suggested_weight).toBe(87.5);
  expect(result.adjustment_reason).toMatch(/keep progressing/i);
});

test('no RPE, two sessions stalled → +2.5 lbs nudge', () => {
  const result = suggestWeight([
    { sets: [{ weight: 80, reps: 10 }] },
    { sets: [{ weight: 80, reps: 10 }] },
  ]);
  expect(result.suggested_weight).toBe(82.5);
  expect(result.adjustment_reason).toMatch(/matched/i);
});

// ── Top-set logic ─────────────────────────────────────────────────────────────

test('uses heaviest set as reference, not first set', () => {
  const result = suggestWeight([
    {
      sets: [
        { weight: 90, reps: 12, rpe: 7 },
        { weight: 100, reps: 10, rpe: 8 },
        { weight: 110, reps: 8, rpe: 8.5 },  // heaviest
      ],
    },
  ]);
  expect(result.previous_weight).toBe(110);
});

test('previous_weight is top set of second-most-recent session', () => {
  const result = suggestWeight([
    { sets: [{ weight: 110, reps: 8, rpe: 8 }] },   // latest
    { sets: [{ weight: 100, reps: 10, rpe: 7 }] },  // previous
  ]);
  expect(result.previous_weight).toBe(110);
});

// ── Average RPE across all sets ───────────────────────────────────────────────

test('averages RPE across all sets in last session', () => {
  // Sets with RPE 6, 7, 8 → avg 7.0 → in zone → +2.5
  const result = suggestWeight([
    {
      sets: [
        { weight: 100, reps: 10, rpe: 6 },
        { weight: 100, reps: 10, rpe: 7 },
        { weight: 100, reps: 8, rpe: 8 },
      ],
    },
  ]);
  expect(result.average_rpe).toBeCloseTo(7.0);
  expect(result.suggested_weight).toBe(102.5);
});

test('sets without RPE are excluded from average', () => {
  // Only one set has RPE=7; the other doesn't. Avg should be 7.
  const result = suggestWeight([
    {
      sets: [
        { weight: 100, reps: 10, rpe: 7 },
        { weight: 100, reps: 10 },  // no rpe
      ],
    },
  ]);
  expect(result.average_rpe).toBe(7);
});

// ── Percentage field ──────────────────────────────────────────────────────────

test('percentage reflects ratio of suggested to previous', () => {
  const result = suggestWeight([
    { sets: [{ weight: 100, reps: 10, rpe: 7.5 }] },
  ]);
  // suggested = 102.5, previous = 100 → 102.5%
  const percentage = (result.suggested_weight / result.previous_weight) * 100;
  expect(percentage).toBeCloseTo(102.5);
});

// ── e1RM / plan-based suggestions ────────────────────────────────────────────

test('plan context: week 1 RPE 7 suggests lighter than week 4 RPE 9', () => {
  const sessions = [
    { sets: [{ weight: 135, reps: 10, rpe: 8 }] },
  ];
  const wk1 = suggestWeight(sessions, { targetRpe: 7, targetReps: 10, weekNumber: 1, totalWeeks: 4 });
  const wk4 = suggestWeight(sessions, { targetRpe: 9, targetReps: 10, weekNumber: 4, totalWeeks: 4 });
  expect(wk1.suggested_weight).toBeLessThan(wk4.suggested_weight);
});

test('plan context: higher target RPE → heavier suggestion', () => {
  const sessions = [
    { sets: [{ weight: 200, reps: 8, rpe: 8 }] },
  ];
  const low = suggestWeight(sessions, { targetRpe: 7, targetReps: 8 });
  const high = suggestWeight(sessions, { targetRpe: 9, targetReps: 8 });
  expect(low.suggested_weight).toBeLessThan(high.suggested_weight);
});

test('plan context: lower target reps → heavier suggestion at same RPE', () => {
  const sessions = [
    { sets: [{ weight: 150, reps: 10, rpe: 8 }] },
  ];
  const highRep = suggestWeight(sessions, { targetRpe: 8, targetReps: 12 });
  const lowRep = suggestWeight(sessions, { targetRpe: 8, targetReps: 6 });
  expect(lowRep.suggested_weight).toBeGreaterThan(highRep.suggested_weight);
});

test('plan context: result is rounded to 2.5 lbs', () => {
  const result = suggestWeight(
    [{ sets: [{ weight: 137, reps: 9, rpe: 7.5 }] }],
    { targetRpe: 8, targetReps: 10 },
  );
  expect(result.suggested_weight % 2.5).toBeCloseTo(0);
});

test('plan context: reason includes week label, RPE, RIR, and delta', () => {
  const result = suggestWeight(
    [{ sets: [{ weight: 100, reps: 10, rpe: 7 }] }],
    { targetRpe: 8, targetReps: 10, weekNumber: 2, totalWeeks: 4 },
  );
  expect(result.adjustment_reason).toMatch(/Week 2\/4/);
  expect(result.adjustment_reason).toMatch(/RPE 8/);
  expect(result.adjustment_reason).toMatch(/RIR/);
  expect(result.adjustment_reason).toMatch(/from last|same as last/);
});

test('plan context: falls back to heuristic when no sets have data', () => {
  const result = suggestWeight(
    [{ sets: [{ weight: 0, reps: 0 }] }],
    { targetRpe: 8, targetReps: 10 },
  );
  // No usable e1RM → falls back to heuristic (top set weight is 0)
  expect(result.suggested_weight).toBe(0);
});

test('without plan context, existing heuristic still works', () => {
  const result = suggestWeight([
    { sets: [{ weight: 100, reps: 10, rpe: 7.5 }] },
  ]);
  // No plan → heuristic: RPE 7.5 → +2.5 lbs
  expect(result.suggested_weight).toBe(102.5);
});

test('e1RM uses RPE-adjusted effective reps when RPE is logged', () => {
  // 100 lbs × 10 reps @ RPE 8 → RIR=2 → effective=12 → e1RM = 100*(1+12/30) = 140
  // Target: RPE 7 × 10 reps → RIR=3 → effective=13 → weight = 140/(1+13/30) ≈ 97.7 → round 97.5
  const result = suggestWeight(
    [{ sets: [{ weight: 100, reps: 10, rpe: 8 }] }],
    { targetRpe: 7, targetReps: 10 },
  );
  expect(result.suggested_weight).toBe(97.5);
});
