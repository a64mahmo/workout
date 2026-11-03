// Fake account for demo mode. Dates are relative to today so the demo always
// looks current: a 6-week block that started 3 weeks ago, 8 finished workouts
// with steady progression, and today's workout ready to start.

export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface DemoDb {
  user: Row;
  exercises: Row[];
  meso_cycles: Row[];
  micro_cycles: Row[];
  plans: Row[];
  plan_sessions: Row[];
  plan_exercises: Row[];
  sessions: Row[];
  session_exercises: Row[];
  sets: Row[];
  volume_history: Row[];
  suggestion_logs: Row[];
  seq: number;
}

/** Local YYYY-MM-DD, `offset` days from today. */
export function day(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const nowIso = () => new Date().toISOString().slice(0, -1);

const EXERCISES: [string, string, string, string][] = [
  ['ex-bench', 'Barbell bench press', 'chest', 'Flat bench, touch and go'],
  ['ex-incline', 'Incline dumbbell press', 'chest', '30° incline'],
  ['ex-row', 'Barbell row', 'back', 'Pendlay style'],
  ['ex-pullup', 'Weighted pull-up', 'back', 'Full hang to chin over bar'],
  ['ex-ohp', 'Overhead press', 'shoulders', 'Strict, no leg drive'],
  ['ex-lateral', 'Cable lateral raise', 'shoulders', 'Single arm'],
  ['ex-curl', 'EZ bar curl', 'biceps', 'Controlled eccentric'],
  ['ex-pushdown', 'Rope pushdown', 'triceps', 'Spread the rope at the bottom'],
  ['ex-squat', 'Back squat', 'legs', 'High bar'],
  ['ex-rdl', 'Romanian deadlift', 'legs', 'Hinge to mid shin'],
  ['ex-legpress', 'Leg press', 'legs', 'Feet shoulder width'],
  ['ex-calf', 'Standing calf raise', 'legs', '2 s pause at the bottom'],
];

// plan day -> [exercise id, sets, reps, start weight, weekly increment, target rpe, rest s]
const PLAN_DAYS: [string, string, [string, number, number, number, number, number, number][]][] = [
  ['ps-upper-a', 'Upper A', [
    ['ex-bench', 4, 6, 185, 5, 8, 180],
    ['ex-row', 4, 8, 155, 5, 8, 150],
    ['ex-ohp', 3, 8, 105, 2.5, 8, 120],
    ['ex-lateral', 3, 15, 15, 0, 9, 60],
    ['ex-pushdown', 3, 12, 50, 2.5, 8.5, 60],
  ]],
  ['ps-lower-a', 'Lower A', [
    ['ex-squat', 4, 5, 245, 5, 8, 210],
    ['ex-rdl', 3, 8, 185, 5, 7.5, 150],
    ['ex-legpress', 3, 12, 360, 10, 8, 120],
    ['ex-calf', 4, 12, 135, 5, 9, 60],
  ]],
  ['ps-upper-b', 'Upper B', [
    ['ex-incline', 4, 10, 60, 2.5, 8, 120],
    ['ex-pullup', 4, 6, 25, 2.5, 8, 150],
    ['ex-ohp', 3, 6, 110, 2.5, 8.5, 120],
    ['ex-curl', 3, 10, 65, 2.5, 8.5, 60],
  ]],
  ['ps-lower-b', 'Lower B', [
    ['ex-rdl', 4, 6, 205, 5, 8, 180],
    ['ex-squat', 3, 8, 215, 5, 7.5, 180],
    ['ex-calf', 3, 15, 115, 5, 9, 60],
  ]],
];

/** Small deterministic PRNG so the demo looks the same on every visit. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function createDemoDb(): DemoDb {
  const r = rng(42);
  const created = `${day(-60)}T09:00:00`;
  const db: DemoDb = {
    user: {
      id: 'demo-user',
      email: 'demo@workout.app',
      name: 'Demo Lifter',
      created_at: created,
      has_fitbit_connected: true,
    },
    exercises: EXERCISES.map(([id, name, muscle_group, description]) => ({
      id, name, muscle_group, category: 'weighted', description, created_at: created,
    })),
    meso_cycles: [{
      id: 'meso-1', name: 'Hypertrophy Block', start_date: day(-21), end_date: day(21),
      goal: 'hypertrophy', is_active: true, created_at: `${day(-21)}T08:00:00`,
    }],
    micro_cycles: Array.from({ length: 6 }, (_, w) => ({
      id: `micro-${w + 1}`, meso_cycle_id: 'meso-1', week_number: w + 1,
      focus: w === 5 ? 'Deload' : w >= 3 ? 'Intensify' : 'Accumulate',
      start_date: day(-21 + w * 7), end_date: day(-15 + w * 7),
    })),
    plans: [{
      id: 'plan-1', name: 'Upper / Lower', description: '4-day upper/lower split, RPE-based progression',
      is_active: true, created_at: `${day(-21)}T08:00:00`,
    }],
    plan_sessions: [],
    plan_exercises: [],
    sessions: [],
    session_exercises: [],
    sets: [],
    volume_history: [],
    suggestion_logs: [],
    seq: 1000,
  };

  PLAN_DAYS.forEach(([psId, name, exs], i) => {
    db.plan_sessions.push({ id: psId, plan_id: 'plan-1', name, week_number: 1, order_index: i, scheduled_date: null, notes: null });
    exs.forEach(([exId, sets, reps, w, , rpe, rest], j) => {
      db.plan_exercises.push({
        id: `${psId}-pe-${j}`, plan_session_id: psId, exercise_id: exId, order_index: j,
        target_sets: sets, target_reps: reps, target_weight: w, target_rpe: rpe, rest_seconds: rest, notes: null,
      });
    });
  });

  // 8 finished workouts over the last 3 weeks, cycling through the plan days.
  const pastOffsets = [-20, -18, -16, -14, -11, -9, -6, -3];
  pastOffsets.forEach((offset, n) => {
    const [psId, name, exs] = PLAN_DAYS[n % PLAN_DAYS.length];
    const week = Math.floor(n / PLAN_DAYS.length);
    const sid = `sess-past-${n + 1}`;
    const date = day(offset);
    let total = 0;
    exs.forEach(([exId, sets, reps, w0, inc], j) => {
      const seId = `${sid}-se-${j}`;
      const weight = w0 + inc * week;
      let exVol = 0;
      db.session_exercises.push({ id: seId, session_id: sid, exercise_id: exId, order_index: j, notes: null });
      for (let k = 1; k <= sets; k++) {
        const rpe = Math.min(10, 7 + k * 0.5 + (r() < 0.3 ? 0.5 : 0));
        const doneReps = reps - (k === sets && r() < 0.35 ? 1 : 0);
        exVol += doneReps * weight;
        db.sets.push({
          id: `${seId}-s${k}`, session_exercise_id: seId, set_number: k, reps: doneReps, weight,
          rpe, is_warmup: false, is_completed: true,
        });
      }
      total += exVol;
      db.volume_history.push({ id: `${seId}-vh`, exercise_id: exId, session_id: sid, total_volume: exVol, calculated_at: `${date}T19:00:00` });
    });
    const durationMin = 55 + Math.round(r() * 20);
    db.sessions.push({
      id: sid, meso_cycle_id: 'meso-1', micro_cycle_id: `micro-${Math.floor((offset + 21) / 7) + 1}`,
      plan_session_id: psId, name, scheduled_date: date, actual_date: date, status: 'completed', notes: null,
      total_volume: total, created_at: `${date}T17:30:00`,
      start_time: `${date}T18:00:00`, end_time: `${date}T18:${String(durationMin % 60).padStart(2, '0')}:00`,
      average_hr: 112 + Math.round(r() * 14), max_hr: 158 + Math.round(r() * 18),
    });
  });

  // Feedback from the last Upper A (RP-style): bench felt easy → expect +1 set
  // today; overhead press bothered the shoulder → its weight is held.
  // (Feedback is read from the most recent session that had the exercise:
  // Upper A for bench/row, Upper B for overhead press.)
  const FEEDBACK: Record<string, Record<string, Row>> = {
    'sess-past-5': { 'ex-bench': { pump: 1, workload: 0, joints: 0 }, 'ex-row': { pump: 2, workload: 1, joints: 0 } },
    'sess-past-7': { 'ex-ohp': { pump: 2, workload: 2, joints: 1 } },
  };
  for (const se of db.session_exercises) {
    const fb = FEEDBACK[se.session_id]?.[se.exercise_id];
    if (fb) se.feedback = fb;
  }

  // Today's workout: Upper A, prefilled from the plan, not started yet.
  const [psId, name, exs] = PLAN_DAYS[0];
  db.sessions.push({
    id: 'sess-today', meso_cycle_id: 'meso-1', micro_cycle_id: 'micro-4', plan_session_id: psId, name,
    scheduled_date: day(0), actual_date: null, status: 'scheduled', notes: null, total_volume: 0,
    created_at: nowIso(), start_time: null, end_time: null, average_hr: null, max_hr: null,
  });
  exs.forEach(([exId, sets, reps, w0, inc], j) => {
    const seId = `sess-today-se-${j}`;
    db.session_exercises.push({ id: seId, session_id: 'sess-today', exercise_id: exId, order_index: j, notes: null });
    for (let k = 1; k <= sets; k++) {
      db.sets.push({ id: `${seId}-s${k}`, session_exercise_id: seId, set_number: k, reps, weight: w0 + inc * 2, rpe: null, is_warmup: false, is_completed: false });
    }
  });

  // Next workout on the calendar.
  db.sessions.push({
    id: 'sess-next', meso_cycle_id: 'meso-1', micro_cycle_id: 'micro-4', plan_session_id: 'ps-lower-a', name: 'Lower A',
    scheduled_date: day(2), actual_date: null, status: 'scheduled', notes: null, total_volume: 0,
    created_at: nowIso(), start_time: null, end_time: null, average_hr: null, max_hr: null,
  });
  return db;
}
