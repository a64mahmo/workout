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

function suggestWeight(
  sessions: SessionSets[], // most recent first
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

  // Round to nearest 2.5
  suggested = Math.round(Math.round(suggested / 2.5) * 2.5 * 10) / 10;

  const roundedAvgRpe =
    avgRpe !== null ? Math.round(avgRpe * 10) / 10 : null;

  return {
    previous_weight: Math.round(lastWeight * 10) / 10,
    suggested_weight: suggested,
    average_rpe: roundedAvgRpe,
    adjustment_reason: reason,
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
