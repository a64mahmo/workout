/**
 * Demo mode: the real `api` client, switched to the in-browser fake backend.
 * Runs a whole workout and asserts nothing ever reaches the network.
 */
import { api, setDemoAdapter } from '@/lib/api';
import { setDemoFlag, isDemoMode } from '@/lib/demo';

jest.setTimeout(20000);

const xhrOpen = jest.spyOn(XMLHttpRequest.prototype, 'open');
const fetchSpy = jest.fn();
(global as unknown as { fetch: unknown }).fetch = fetchSpy;

beforeEach(() => {
  sessionStorage.clear();
  setDemoFlag(true);
  setDemoAdapter(true);
});
afterAll(() => {
  setDemoFlag(false);
  setDemoAdapter(false);
});

it('turns on via the session flag', () => {
  expect(isDemoMode()).toBe(true);
});

it('runs a full workout on fake data without touching the network', async () => {
  const me = (await api.get('/api/auth/me')).data;
  expect(me.name).toBe('Demo Lifter');

  const sessions = (await api.get('/api/sessions')).data;
  expect(sessions.filter((s: { status: string }) => s.status === 'completed')).toHaveLength(8);
  const today = sessions.find((s: { id: string }) => s.id === 'sess-today');
  expect(today.exercises.length).toBeGreaterThan(0);

  // Fake AI suggestion, shaped like the real endpoint
  const bench = today.exercises[0];
  const sug = (await api.get('/api/suggestions/weight', { params: { exercise_id: bench.exercise_id, session_id: 'sess-today' } })).data;
  expect(sug.prediction_source).toBe('ai');
  expect(sug.suggested_weight).toBeGreaterThan(0);
  expect(typeof sug.adjustment_reason).toBe('string');
  expect(sug.log_id).toBeTruthy();

  await api.post('/api/sessions/sess-today/start');
  // Beat the bench history to get a PR
  const set = bench.sets[0];
  const updated = (await api.put(`/api/sessions/exercise-sets/${set.id}`, { weight: 315, reps: 5, rpe: 8, is_completed: true })).data;
  expect(updated.is_completed).toBe(true);

  const summary = (await api.get('/api/sessions/sess-today/pre-summary')).data;
  expect(summary.workout_number).toBe(9);
  expect(summary.prs).toEqual([{ exercise_name: 'Barbell bench press', old_max: expect.any(Number), new_max: 315 }]);
  expect(summary.total_volume).toBe(1575);

  const done = (await api.post('/api/sessions/sess-today/complete')).data;
  expect(done.total_volume).toBe(1575);
  expect((await api.get('/api/sessions/sess-today')).data.status).toBe('completed');

  // Other pages' endpoints
  expect((await api.get('/api/plans')).data[0].plan_sessions).toHaveLength(4);
  expect(Object.keys((await api.get('/api/plans/progress')).data)).toEqual(['plan-1']);
  expect((await api.get('/api/meso-cycles')).data[0].name).toBe('Hypertrophy Block');
  expect((await api.get('/api/fitbit/today-stats', { params: { date: '2026-01-01' } })).data.connected).toBe(true);
  expect((await api.get('/api/suggestions/muscle-groups')).data.chest).toBeGreaterThan(0);
  expect((await api.get('/api/exercises?muscle_group=legs')).data.every((e: { muscle_group: string }) => e.muscle_group === 'legs')).toBe(true);

  expect(xhrOpen).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('keeps changes across reloads in the same tab (sessionStorage)', async () => {
  await api.post('/api/exercises', { name: 'Nordic curl', muscle_group: 'legs' });
  // Simulate a reload: a fresh module instance reading the same sessionStorage
  let names: string[] = [];
  await jest.isolateModulesAsync(async () => {
    const fresh = await import('@/lib/demo/backend');
    names = (fresh.handleDemoRequest('GET', '/api/exercises', undefined, undefined) as { name: string }[]).map((e) => e.name);
  });
  expect(names).toContain('Nordic curl');
});

it('returns FastAPI-style errors as axios errors, and leaves data untouched on failure', async () => {
  await expect(api.get('/api/sessions/nope')).rejects.toMatchObject({ response: { status: 404, data: { detail: 'Session not found' } } });
  await expect(api.get('/api/does-not-exist')).rejects.toMatchObject({ response: { status: 404 } });
  await expect(api.get('/api/suggestions/weight')).rejects.toMatchObject({ response: { status: 422 } });
  // apply to a missing training session fails without half-writing
  const before = (await api.get('/api/sessions')).data.length;
  await expect(api.post('/api/plans/plan-sessions/ps-upper-a/apply', { training_session_id: 'missing' })).rejects.toMatchObject({ response: { status: 404 } });
  expect((await api.get('/api/sessions')).data.length).toBe(before);
  expect(xhrOpen).not.toHaveBeenCalled();
});

it('exiting demo wipes the fake data', async () => {
  await api.post('/api/exercises', { name: 'Temp', muscle_group: 'core' });
  setDemoFlag(false);
  expect(isDemoMode()).toBe(false);
  expect(sessionStorage.getItem('workout-demo-db')).toBeNull();
});
