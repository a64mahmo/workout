// In-browser stand-in for the real API, used only in demo mode. Mirrors the
// response shapes of the backend (see cloudflare/src/serialize.ts) closely
// enough for every page to work. Nothing here touches the network.
import { createDemoDb, day, nowIso, type DemoDb, type Row } from './seed';

const STORAGE_KEY = 'workout-demo-db';

export class DemoHttpError extends Error {
  constructor(public status: number, public detail: unknown) {
    super(typeof detail === 'string' ? detail : `HTTP ${status}`);
  }
}
const notFound = (what: string) => new DemoHttpError(404, `${what} not found`);

// ── persistence (sessionStorage: survives reloads, gone when the tab closes) ──
let db: DemoDb | null = null;
function load(): DemoDb {
  if (db) return db;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) db = JSON.parse(raw) as DemoDb;
  } catch {
    /* storage blocked — fall through to a fresh seed */
  }
  db ??= createDemoDb();
  return db;
}
function save() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* in-memory only */
  }
}
export function resetDemoDb() {
  db = null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const id = (prefix: string) => `${prefix}-${++load().seq}`;
const get = (rows: Row[], key: string, what: string) => {
  const row = rows.find((r) => r.id === key);
  if (!row) throw notFound(what);
  return row;
};
const pick = (body: Row, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => body && k in body).map((k) => [k, body[k]]));
const nonNull = (o: Row) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

// ── serializers (same shapes as the real API) ──
const exerciseOut = (e: Row): Row => ({ ...e });
function sessionExerciseOut(d: DemoDb, se: Row): Row {
  const ex = d.exercises.find((e) => e.id === se.exercise_id);
  return {
    ...se,
    rest_seconds: 60,
    exercise_name: null,
    exercise: ex ? exerciseOut(ex) : null,
    sets: d.sets.filter((s) => s.session_exercise_id === se.id).sort((a, b) => a.set_number - b.set_number),
  };
}
function sessionOut(d: DemoDb, s: Row): Row {
  return {
    ...s,
    user_id: d.user.id,
    exercises: d.session_exercises.filter((se) => se.session_id === s.id).map((se) => sessionExerciseOut(d, se)),
    health_metric:
      s.status === 'completed'
        ? { id: `${s.id}-hm`, user_id: d.user.id, session_id: s.id, date: s.actual_date, sleep_duration_seconds: 26100, sleep_score: 82, sleep_efficiency: 91, weight_kg: 81.4, body_fat_pct: 15.2, bmi: 24.1, created_at: s.created_at }
        : null,
  };
}
function planExerciseOut(d: DemoDb, pe: Row): Row {
  const ex = d.exercises.find((e) => e.id === pe.exercise_id);
  return { ...pe, exercise: ex ? { id: ex.id, name: ex.name, muscle_group: ex.muscle_group, category: ex.category } : null };
}
function planSessionOut(d: DemoDb, ps: Row): Row {
  return { ...ps, exercises: d.plan_exercises.filter((pe) => pe.plan_session_id === ps.id).map((pe) => planExerciseOut(d, pe)) };
}
function planOut(d: DemoDb, p: Row): Row {
  return {
    ...p,
    user_id: d.user.id,
    meso_cycle_id: null,
    plan_sessions: d.plan_sessions.filter((ps) => ps.plan_id === p.id).map((ps) => planSessionOut(d, ps)),
  };
}
const mesoOut = (d: DemoDb, m: Row): Row => ({ ...m, user_id: d.user.id });

// ── fake AI weight suggestions ──
const AI_REASONS = {
  up: [
    'Bar speed held up at RPE {rpe} — add {d} lbs',
    'Last session looked easy (RPE {rpe}), push {d} lbs',
    'All reps clean at RPE {rpe}; time for +{d} lbs',
  ],
  hold: [
    'RPE {rpe} is right on target — own this weight',
    'Grind on the last set; repeat {w} lbs and add a rep',
  ],
  down: [
    'Fatigue is building (RPE {rpe}); drop {d} lbs and move fast',
    'Missed reps last time — back off {d} lbs to rebuild',
  ],
};
const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k]));
const plate = (w: number) => Math.round(w / 2.5) * 2.5;

function suggestWeight(d: DemoDb, q: Record<string, string>) {
  const exId = q.exercise_id;
  if (!exId) throw new DemoHttpError(422, [{ loc: ['query', 'exercise_id'], msg: 'Field required', type: 'missing' }]);
  const done = d.sessions
    .filter((s) => s.status === 'completed')
    .sort((a, b) => String(b.scheduled_date).localeCompare(String(a.scheduled_date)));
  const history: Row[][] = [];
  for (const s of done) {
    const sets = d.session_exercises
      .filter((se) => se.session_id === s.id && se.exercise_id === exId)
      .flatMap((se) => d.sets.filter((x) => x.session_exercise_id === se.id && x.is_completed && !x.is_warmup && x.weight > 0));
    if (sets.length) history.push(sets);
  }
  const ts = q.session_id ? d.sessions.find((s) => s.id === q.session_id) : null;
  const pe = ts?.plan_session_id ? d.plan_exercises.find((p) => p.plan_session_id === ts.plan_session_id && p.exercise_id === exId) : null;
  const targetRpe = pe?.target_rpe ?? 8;
  const logId = id('log');

  if (!history.length) {
    return {
      previous_weight: 0, suggested_weight: 0, average_rpe: null,
      adjustment_reason: 'No history - start light (RPE 6-7) and build up', meso_week: 4, meso_phase: 'accumulation',
      meso_phase_label: 'Week 4 - Accumulate volume', target_rpe: targetRpe, session_volume: 0, set_count: 0,
      previous_volume: null, volume_trend: 'none', suggested_sets: 3, volume_directive: 'Start at MEV (~3-4 working sets), prioritise technique',
      estimated_1rm: null, average_weight: 0, suggestion: 'No history - start light and build up', percentage: 100,
      log_id: logId, prediction_source: 'ai', rules_suggested_weight: 0, rules_adjustment_reason: '',
    };
  }

  const last = history[0];
  const top = Math.max(...last.map((s) => s.weight));
  const topSet = last.find((s) => s.weight === top)!;
  const rpes = last.map((s) => s.rpe).filter((x) => x != null) as number[];
  const avgRpe = rpes.length ? Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10 : null;
  const vol = last.reduce((a, s) => a + s.weight * s.reps, 0);
  const prevVol = history[1]?.reduce((a, s) => a + s.weight * s.reps, 0) ?? null;

  let kind: 'up' | 'hold' | 'down' = 'up';
  if (avgRpe != null && avgRpe >= targetRpe + 1) kind = 'down';
  else if (avgRpe != null && avgRpe >= targetRpe) kind = 'hold';
  const step = Math.max(2.5, plate(top * 0.025));
  const suggested = kind === 'up' ? top + step : kind === 'down' ? plate(top - step) : top;
  const variants = AI_REASONS[kind];
  const reason = fill(variants[(exId.length + history.length) % variants.length], {
    rpe: avgRpe ?? targetRpe, d: Math.abs(suggested - top), w: top,
  });
  const e1rm = Math.round(top * (1 + (topSet.reps + (10 - (topSet.rpe ?? 8))) / 30) * 10) / 10;

  d.suggestion_logs.push({
    id: logId, exercise_id: exId, meso_cycle_id: q.meso_cycle_id ?? null, previous_weight: top, average_rpe: avgRpe,
    suggested_weight: suggested, adjustment_reason: reason, actual_weight: null, actual_reps: null, actual_rpe: null, created_at: nowIso(),
  });
  return {
    previous_weight: top, suggested_weight: suggested, average_rpe: avgRpe, adjustment_reason: reason,
    meso_week: 4, meso_phase: 'intensification', meso_phase_label: 'Week 4 - Intensify', target_rpe: targetRpe,
    session_volume: vol, set_count: last.length, previous_volume: prevVol,
    volume_trend: prevVol == null ? 'no prior data' : vol > prevVol * 1.05 ? 'increasing' : vol < prevVol * 0.95 ? 'decreasing' : 'stable',
    suggested_sets: Math.min(12, last.length + (kind === 'up' ? 0 : kind === 'down' ? -1 : 0)) || 1,
    volume_directive: 'Approach MRV, maintain or cut 1 set if very sore', estimated_1rm: e1rm, average_weight: top,
    suggestion: reason, percentage: Math.round((suggested / top) * 1000) / 10, log_id: logId,
    prediction_source: 'ai', rules_suggested_weight: suggested, rules_adjustment_reason: reason,
  };
}

// ── routing ──
type Handler = (p: Record<string, string>, body: Row, q: Record<string, string>, d: DemoDb) => unknown;
const routes: [string, string, Handler][] = [];
const on = (method: string, pattern: string, h: Handler) => routes.push([method, pattern, h]);

const deleteSessionExercise = (d: DemoDb, seId: string) => {
  d.sets = d.sets.filter((s) => s.session_exercise_id !== seId);
  d.session_exercises = d.session_exercises.filter((se) => se.id !== seId);
};
const deletePlanSession = (d: DemoDb, psId: string) => {
  d.plan_exercises = d.plan_exercises.filter((pe) => pe.plan_session_id !== psId);
  d.plan_sessions = d.plan_sessions.filter((ps) => ps.id !== psId);
  d.sessions.forEach((s) => s.plan_session_id === psId && (s.plan_session_id = null));
};

// auth
on('GET', '/auth/me', (_p, _b, _q, d) => d.user);
on('POST', '/auth/logout', () => ({ message: 'Logged out' }));
on('POST', '/auth/login', (_p, _b, _q, d) => ({ user_id: d.user.id, message: 'Login successful' }));
on('POST', '/auth/register', (_p, _b, _q, d) => ({ user_id: d.user.id, message: 'User registered successfully' }));

// exercises
on('GET', '/exercises', (_p, _b, q, d) => d.exercises.filter((e) => !q.muscle_group || e.muscle_group === q.muscle_group).map(exerciseOut));
on('GET', '/exercises/:id', (p, _b, _q, d) => exerciseOut(get(d.exercises, p.id, 'Exercise')));
on('POST', '/exercises', (_p, b, _q, d) => {
  const e = { id: id('ex'), category: 'weighted', description: null, ...pick(b, ['name', 'muscle_group', 'category', 'description']), created_at: nowIso() };
  d.exercises.push(e);
  return exerciseOut(e);
});
on('PUT', '/exercises/:id', (p, b, _q, d) => Object.assign(get(d.exercises, p.id, 'Exercise'), nonNull(pick(b, ['name', 'muscle_group', 'category', 'description']))));
on('DELETE', '/exercises/:id', (p, _b, _q, d) => {
  get(d.exercises, p.id, 'Exercise');
  d.exercises = d.exercises.filter((e) => e.id !== p.id);
  d.plan_exercises = d.plan_exercises.filter((pe) => pe.exercise_id !== p.id);
  d.session_exercises.forEach((se) => se.exercise_id === p.id && (se.exercise_id = null));
  return { message: 'Exercise deleted' };
});
on('GET', '/exercises/:id/history', (p, _b, q, d) =>
  d.sessions
    .filter((s) => d.session_exercises.some((se) => se.session_id === s.id && se.exercise_id === p.id))
    .sort((a, b) => String(b.scheduled_date).localeCompare(String(a.scheduled_date)))
    .slice(0, Number(q.limit ?? 10))
    .flatMap((s) =>
      d.session_exercises
        .filter((se) => se.session_id === s.id && se.exercise_id === p.id)
        .map((se) => {
          const sets = d.sets.filter((x) => x.session_exercise_id === se.id && x.is_completed && !x.is_warmup).sort((a, b) => a.set_number - b.set_number);
          return {
            session_id: s.id, session_date: s.scheduled_date, session_name: s.name,
            sets: sets.map((x) => ({ set_number: x.set_number, reps: x.reps || 0, weight: x.weight || 0, rpe: x.rpe })),
            total_volume: sets.reduce((a, x) => a + (x.reps || 0) * (x.weight || 0), 0),
          };
        }),
    ),
);

// meso cycles
on('GET', '/meso-cycles', (_p, _b, _q, d) => d.meso_cycles.map((m) => mesoOut(d, m)));
on('GET', '/meso-cycles/:id', (p, _b, _q, d) => mesoOut(d, get(d.meso_cycles, p.id, 'Cycle')));
on('POST', '/meso-cycles', (_p, b, _q, d) => {
  const m = { id: id('meso'), start_date: null, end_date: null, goal: null, is_active: true, ...pick(b, ['name', 'start_date', 'end_date', 'goal', 'is_active']), created_at: nowIso() };
  d.meso_cycles.push(m);
  return mesoOut(d, m);
});
on('PUT', '/meso-cycles/:id', (p, b, _q, d) => mesoOut(d, Object.assign(get(d.meso_cycles, p.id, 'Cycle'), pick(b, ['name', 'start_date', 'end_date', 'goal', 'is_active']))));
on('DELETE', '/meso-cycles/:id', (p, _b, _q, d) => {
  get(d.meso_cycles, p.id, 'Cycle');
  d.meso_cycles = d.meso_cycles.filter((m) => m.id !== p.id);
  d.micro_cycles = d.micro_cycles.filter((m) => m.meso_cycle_id !== p.id);
  d.sessions.forEach((s) => s.meso_cycle_id === p.id && (s.meso_cycle_id = null));
  return { message: 'Cycle deleted' };
});
on('GET', '/meso-cycles/:id/micro-cycles', (p, _b, _q, d) => d.micro_cycles.filter((m) => m.meso_cycle_id === p.id));
on('POST', '/meso-cycles/:id/micro-cycles', (p, b, _q, d) => {
  const m = { id: id('micro'), meso_cycle_id: p.id, focus: null, start_date: null, end_date: null, ...pick(b, ['week_number', 'focus', 'start_date', 'end_date']) };
  d.micro_cycles.push(m);
  return m;
});

// sessions
on('POST', '/sessions/sync-volume', () => ({ message: 'Volume history synchronization complete' }));
on('GET', '/sessions', (_p, _b, _q, d) => d.sessions.map((s) => sessionOut(d, s)));
on('GET', '/sessions/:id', (p, _b, _q, d) => sessionOut(d, get(d.sessions, p.id, 'Session')));
on('POST', '/sessions', (_p, b, _q, d) => {
  const s = {
    id: id('sess'), meso_cycle_id: null, micro_cycle_id: null, plan_session_id: null, scheduled_date: day(0), notes: null,
    ...pick(b, ['name', 'meso_cycle_id', 'micro_cycle_id', 'plan_session_id', 'scheduled_date', 'notes']),
    status: b?.status || 'scheduled', actual_date: null, total_volume: 0, created_at: nowIso(),
    start_time: null, end_time: null, average_hr: null, max_hr: null,
  };
  d.sessions.push(s);
  return sessionOut(d, s);
});
on('PUT', '/sessions/:id', (p, b, _q, d) =>
  sessionOut(d, Object.assign(get(d.sessions, p.id, 'Session'), pick(b, ['name', 'meso_cycle_id', 'micro_cycle_id', 'plan_session_id', 'scheduled_date', 'actual_date', 'status', 'notes', 'start_time', 'end_time', 'average_hr', 'max_hr']))),
);
on('DELETE', '/sessions/:id', (p, _b, _q, d) => {
  get(d.sessions, p.id, 'Session');
  d.session_exercises.filter((se) => se.session_id === p.id).forEach((se) => deleteSessionExercise(d, se.id));
  d.volume_history = d.volume_history.filter((v) => v.session_id !== p.id);
  d.sessions = d.sessions.filter((s) => s.id !== p.id);
  return { message: 'Session deleted' };
});
on('POST', '/sessions/:id/start', (p, _b, _q, d) => {
  const s = get(d.sessions, p.id, 'Session');
  Object.assign(s, { start_time: nowIso(), status: 'in_progress', actual_date: s.actual_date || day(0) });
  return { message: 'Session started', start_time: s.start_time };
});
on('POST', '/sessions/:id/cancel', (p, _b, _q, d) => {
  get(d.sessions, p.id, 'Session').status = 'cancelled';
  return { message: 'Session cancelled' };
});
const doneSets = (d: DemoDb, sessionId: string) =>
  d.session_exercises.filter((se) => se.session_id === sessionId).map((se) => ({
    se,
    sets: d.sets.filter((x) => x.session_exercise_id === se.id),
  }));
on('GET', '/sessions/:id/pre-summary', (p, _b, _q, d) => {
  const s = get(d.sessions, p.id, 'Session');
  const groups = doneSets(d, s.id);
  const prs = [];
  for (const { se, sets } of groups) {
    const cur = sets.filter((x) => x.is_completed && !x.is_warmup && x.weight > 0);
    if (!cur.length) continue;
    const curMax = Math.max(...cur.map((x) => x.weight));
    const histMax = Math.max(0, ...d.sessions
      .filter((o) => o.id !== s.id && o.status === 'completed')
      .flatMap((o) => d.session_exercises.filter((x) => x.session_id === o.id && x.exercise_id === se.exercise_id))
      .flatMap((x) => d.sets.filter((y) => y.session_exercise_id === x.id && y.is_completed && !y.is_warmup).map((y) => y.weight || 0)));
    if (curMax > histMax) prs.push({ exercise_name: d.exercises.find((e) => e.id === se.exercise_id)?.name ?? null, old_max: histMax, new_max: curMax });
  }
  const all = groups.flatMap((g) => g.sets);
  return {
    workout_number: d.sessions.filter((x) => x.status === 'completed').length + 1,
    duration_seconds: s.start_time ? Math.trunc((Date.now() - new Date(s.start_time + 'Z').getTime()) / 1000) : null,
    total_volume: all.filter((x) => x.is_completed && !x.is_warmup && x.reps && x.weight).reduce((a, x) => a + x.reps * x.weight, 0),
    completed_sets: all.filter((x) => x.is_completed).length,
    total_sets: all.length,
    exercise_count: groups.length,
    prs,
  };
});
on('POST', '/sessions/:id/complete', (p, _b, _q, d) => {
  const s = get(d.sessions, p.id, 'Session');
  let total = 0;
  for (const { se, sets } of doneSets(d, s.id)) {
    const v = sets.filter((x) => x.is_completed && !x.is_warmup && x.reps && x.weight).reduce((a, x) => a + x.reps * x.weight, 0);
    if (v > 0) {
      total += v;
      d.volume_history.push({ id: id('vh'), exercise_id: se.exercise_id, session_id: s.id, total_volume: v, calculated_at: nowIso() });
    }
  }
  Object.assign(s, { status: 'completed', end_time: nowIso(), actual_date: s.actual_date || day(0), total_volume: total, average_hr: 121, max_hr: 168 });
  return { message: 'Session completed', total_volume: total };
});
on('POST', '/sessions/:id/exercises', (p, b, _q, d) => {
  get(d.sessions, p.id, 'Session');
  const se = { id: id('se'), session_id: p.id, exercise_id: b?.exercise_id, order_index: b?.order_index ?? 0, notes: b?.notes ?? null };
  d.session_exercises.push(se);
  return sessionExerciseOut(d, se);
});
on('PUT', '/sessions/session-exercises/:id', (p, b, _q, d) => sessionExerciseOut(d, Object.assign(get(d.session_exercises, p.id, 'Session exercise'), pick(b, ['order_index', 'notes']))));
on('DELETE', '/sessions/session-exercises/:id', (p, _b, _q, d) => {
  get(d.session_exercises, p.id, 'Session exercise');
  deleteSessionExercise(d, p.id);
  return { message: 'Exercise removed from session' };
});
on('POST', '/sessions/session-exercises/:id/sets', (p, b, _q, d) => {
  get(d.session_exercises, p.id, 'Session exercise');
  const s = { id: id('set'), session_exercise_id: p.id, set_number: b?.set_number ?? 1, reps: b?.reps ?? null, weight: b?.weight ?? null, rpe: b?.rpe ?? null, is_warmup: !!b?.is_warmup, is_completed: false };
  d.sets.push(s);
  return s;
});
on('PUT', '/sessions/exercise-sets/:id', (p, b, _q, d) => Object.assign(get(d.sets, p.id, 'Set'), pick(b, ['reps', 'weight', 'rpe', 'is_warmup', 'is_completed'])));
on('DELETE', '/sessions/exercise-sets/:id', (p, _b, _q, d) => {
  get(d.sets, p.id, 'Set');
  d.sets = d.sets.filter((s) => s.id !== p.id);
  return { message: 'Set deleted' };
});

// plans
on('GET', '/plans', (_p, _b, _q, d) => d.plans.map((p) => planOut(d, p)));
on('GET', '/plans/templates', () => ({
  templates: [
    { id: 'ppl', name: 'Push/Pull/Legs', description: '6-day split' },
    { id: 'upper-lower', name: 'Upper/Lower', description: '4-day split' },
    { id: 'full-body', name: 'Full Body', description: '3-day split' },
  ],
}));
on('GET', '/plans/progress', (_p, _b, _q, d) => {
  const out: Record<string, Row> = {};
  const rows = d.sessions
    .filter((s) => s.plan_session_id)
    .sort((a, b) => String(b.actual_date ?? '').localeCompare(String(a.actual_date ?? '')) || String(b.scheduled_date).localeCompare(String(a.scheduled_date)));
  for (const s of rows) {
    const ps = d.plan_sessions.find((x) => x.id === s.plan_session_id);
    if (!ps) continue;
    out[ps.plan_id] ??= { current_week: ps.week_number, last_completed_at: s.actual_date || s.scheduled_date, last_session_name: ps.name, completed_session_ids: [] };
    out[ps.plan_id].completed_session_ids.push(ps.id);
  }
  return out;
});
on('GET', '/plans/:id', (p, _b, _q, d) => planOut(d, get(d.plans, p.id, 'Plan')));
on('POST', '/plans', (_p, b, _q, d) => {
  const plan = { id: id('plan'), name: b?.name, description: b?.description ?? null, is_active: true, created_at: nowIso() };
  d.plans.push(plan);
  return planOut(d, plan);
});
on('PUT', '/plans/:id', (p, b, _q, d) => planOut(d, Object.assign(get(d.plans, p.id, 'Plan'), nonNull(pick(b, ['name', 'description'])))));
on('DELETE', '/plans/:id', (p, _b, _q, d) => {
  get(d.plans, p.id, 'Plan');
  d.plan_sessions.filter((ps) => ps.plan_id === p.id).forEach((ps) => deletePlanSession(d, ps.id));
  d.plans = d.plans.filter((x) => x.id !== p.id);
  return { message: 'Plan deleted' };
});
on('POST', '/plans/:id/sessions', (p, b, _q, d) => {
  get(d.plans, p.id, 'Plan');
  const ps = { id: id('ps'), plan_id: p.id, week_number: 1, order_index: 0, scheduled_date: null, notes: null, ...pick(b, ['name', 'week_number', 'order_index', 'scheduled_date', 'notes']) };
  d.plan_sessions.push(ps);
  return planSessionOut(d, ps);
});
on('PUT', '/plans/plan-sessions/:id', (p, b, _q, d) => planSessionOut(d, Object.assign(get(d.plan_sessions, p.id, 'Plan session'), nonNull(pick(b, ['name', 'week_number', 'order_index', 'scheduled_date', 'notes'])))));
on('DELETE', '/plans/plan-sessions/:id', (p, _b, _q, d) => {
  get(d.plan_sessions, p.id, 'Plan session');
  deletePlanSession(d, p.id);
  return { message: 'Plan session deleted' };
});
on('POST', '/plans/plan-sessions/:id/exercises', (p, b, _q, d) => {
  get(d.plan_sessions, p.id, 'Plan session');
  get(d.exercises, b?.exercise_id, 'Exercise');
  const pe = {
    id: id('pe'), plan_session_id: p.id, order_index: 0, target_sets: 3, target_reps: 10, target_weight: null, target_rpe: null, rest_seconds: 60, notes: null,
    ...pick(b, ['exercise_id', 'order_index', 'target_sets', 'target_reps', 'target_weight', 'target_rpe', 'rest_seconds', 'notes']),
  };
  d.plan_exercises.push(pe);
  return planExerciseOut(d, pe);
});
on('PUT', '/plans/plan-exercises/:id', (p, b, _q, d) =>
  planExerciseOut(d, Object.assign(get(d.plan_exercises, p.id, 'Plan exercise'), nonNull(pick(b, ['exercise_id', 'order_index', 'target_sets', 'target_reps', 'target_weight', 'target_rpe', 'rest_seconds', 'notes'])))),
);
on('DELETE', '/plans/plan-exercises/:id', (p, _b, _q, d) => {
  get(d.plan_exercises, p.id, 'Plan exercise');
  d.plan_exercises = d.plan_exercises.filter((x) => x.id !== p.id);
  return { message: 'Plan exercise deleted' };
});
on('GET', '/plans/plan-sessions/:id/preview', (p, _b, _q, d) =>
  planSessionOut(d, get(d.plan_sessions, p.id, 'Plan session'))
    .exercises.sort((a: Row, b: Row) => a.order_index - b.order_index)
    .map((pe: Row) => ({
      plan_exercise_id: pe.id,
      exercise: pe.exercise ? { ...pe.exercise, description: null, created_at: null } : { id: '', name: 'Unknown', muscle_group: 'Unknown', description: null, created_at: null },
      target_sets: pe.target_sets || 3, target_reps: pe.target_reps || 10, suggested_weight: pe.target_weight,
      previous_weight: null, suggestion_reason: 'Based on your plan', rest_seconds: pe.rest_seconds || 60,
    })),
);
on('POST', '/plans/plan-sessions/:id/apply', (p, b, _q, d) => {
  const ps = planSessionOut(d, get(d.plan_sessions, p.id, 'Plan session'));
  const ts = get(d.sessions, b?.training_session_id, 'Session');
  ts.plan_session_id = ps.id;
  const overrides = new Map<string, Row>((b?.overrides ?? []).map((o: Row) => [o.plan_exercise_id, o]));
  for (const pe of (ps.exercises as Row[]).sort((a, c) => a.order_index - c.order_index)) {
    const o = overrides.get(pe.id) ?? {};
    if ('include' in o && !o.include) continue;
    const se = { id: id('se'), session_id: ts.id, exercise_id: pe.exercise_id, order_index: pe.order_index, notes: pe.notes };
    d.session_exercises.push(se);
    const w = o.weight || pe.target_weight || 0;
    for (let n = 1; n <= (pe.target_sets || 3); n++) {
      d.sets.push({ id: id('set'), session_exercise_id: se.id, set_number: n, reps: pe.target_reps || 10, weight: Number(w) || 0, rpe: null, is_warmup: false, is_completed: false });
    }
  }
  return { message: 'Plan session applied' };
});

// suggestions
on('GET', '/suggestions/weight', (_p, _b, q, d) => suggestWeight(d, q));
on('GET', '/suggestions/weight/history', (_p, _b, q, d) =>
  d.suggestion_logs
    .filter((l) => (!q.exercise_id || l.exercise_id === q.exercise_id) && (!q.meso_cycle_id || l.meso_cycle_id === q.meso_cycle_id))
    .slice(-Number(q.limit ?? 20))
    .reverse()
    .map((l) => {
      const ex = d.exercises.find((e) => e.id === l.exercise_id);
      return { ...l, exercise_name: ex?.name, muscle_group: ex?.muscle_group };
    }),
);
on('PATCH', '/suggestions/weight/history/:id', (p, b, _q, d) => {
  Object.assign(get(d.suggestion_logs, p.id, 'Suggestion log'), nonNull(pick(b, ['actual_weight', 'actual_reps', 'actual_rpe'])));
  return { message: 'Outcome recorded', log_id: p.id };
});
on('GET', '/suggestions/exercises', (_p, _b, _q, d) => {
  const byEx = new Map<string, { volume: number; last: string }>();
  for (const v of d.volume_history) {
    const s = d.sessions.find((x) => x.id === v.session_id);
    const cur = byEx.get(v.exercise_id) ?? { volume: 0, last: '' };
    cur.volume += v.total_volume;
    if (s && s.scheduled_date > cur.last) cur.last = s.scheduled_date;
    byEx.set(v.exercise_id, cur);
  }
  return [...byEx.entries()]
    .sort((a, b) => b[1].volume - a[1].volume)
    .map(([exId, { volume, last }]) => {
      const ex = d.exercises.find((e) => e.id === exId)!;
      return {
        exercise: { id: ex.id, name: ex.name, muscle_group: ex.muscle_group, description: null, created_at: null },
        total_volume: volume,
        last_performed: last || null,
        suggestion_reason: volume > 50000 ? 'High volume - maintain intensity' : volume >= 10000 ? 'Moderate volume - consider progression' : 'Lower volume - good candidate for more work',
      };
    });
});
on('GET', '/suggestions/muscle-groups', (_p, _b, _q, d) => {
  const out: Record<string, number> = {};
  for (const v of d.volume_history) {
    const mg = d.exercises.find((e) => e.id === v.exercise_id)?.muscle_group;
    if (mg) out[mg] = Math.trunc((out[mg] ?? 0) + v.total_volume);
  }
  return out;
});

// fitbit (fake, always "connected")
const fitbitStats = () => ({ connected: true, steps: 8432, resting_hr: 58, weight_kg: 81.4, body_fat_pct: 15.2, sleep_duration_seconds: 26100, sleep_score: 82, sleep_efficiency: 91 });
on('GET', '/fitbit/status', () => ({ connected: true }));
on('GET', '/fitbit/today-stats', fitbitStats);
on('POST', '/fitbit/sync-today', fitbitStats);
on('GET', '/fitbit/auth-url', () => ({ url: '/settings' }));
on('POST', '/fitbit/callback', () => ({ message: 'Fitbit connected successfully' }));
on('POST', '/fitbit/disconnect', () => ({ message: 'Fitbit disconnected' }));
on('POST', '/fitbit/sync-session/:id', (p, _b, _q, d) => {
  const s = get(d.sessions, p.id, 'Session');
  Object.assign(s, { average_hr: s.average_hr ?? 118, max_hr: s.max_hr ?? 164 });
  return sessionOut(d, s);
});

function match(method: string, path: string) {
  const segs = path.split('/').filter(Boolean);
  for (const [m, pattern, h] of routes) {
    const parts = pattern.split('/').filter(Boolean);
    if (m !== method || parts.length !== segs.length) continue;
    const params: Record<string, string> = {};
    if (parts.every((part, i) => (part.startsWith(':') ? ((params[part.slice(1)] = decodeURIComponent(segs[i])), true) : part === segs[i]))) {
      return { h, params };
    }
  }
  return null;
}

/** Handle one API call. Throws DemoHttpError for 4xx. */
export function handleDemoRequest(method: string, url: string, params: Record<string, unknown> | undefined, body: unknown): unknown {
  const u = new URL(url, 'http://demo.local');
  const path = u.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
  const query: Record<string, string> = Object.fromEntries(u.searchParams);
  for (const [k, v] of Object.entries(params ?? {})) if (v != null) query[k] = String(v);
  const m = match(method.toUpperCase(), path);
  if (!m) throw new DemoHttpError(404, 'Not Found');
  const d = load();
  // Snapshot first so a handler that throws halfway leaves the store unchanged,
  // and return a copy so callers can't mutate stored rows.
  const snapshot = clone(d);
  try {
    const out = clone(m.h(m.params, (body ?? {}) as Row, query, d));
    if (method.toUpperCase() !== 'GET' || path === '/suggestions/weight') save();
    return out ?? null;
  } catch (e) {
    db = snapshot;
    throw e;
  }
}
