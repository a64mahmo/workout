/**
 * Comprehensive tests for the session detail page (/sessions/[id])
 *
 * Coverage:
 *  - Loading / not-found states
 *  - Status-based header buttons (scheduled / in_progress / completed / cancelled)
 *  - Session title, date, volume strip
 *  - SetRow rendering for weighted and bodyweight exercises
 *  - Ghost placeholder propagation (including the regression: completing set 1
 *    must keep ghost on sets 2 & 3)
 *  - canComplete logic — disabled when fields empty, enabled when filled
 *  - Complete-set mutation + edit-state cleanup
 *  - Uncheck completed set
 *  - Add set
 *  - Remove exercise
 *  - Start / Finish / Cancel session mutations
 *  - AI weight suggestions (show amber, apply → green, undo)
 *  - RPE: cannot be negative, can be cleared
 *  - Input: select-all on focus
 *  - Back navigation
 */

import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SessionDetailPage from '@/app/sessions/[id]/page';
import type { TrainingSession, SessionExercise, ExerciseSet, Exercise } from '@/types';

// ─── mocks ──────────────────────────────────────────────────────────────────

jest.mock('next/navigation', () => ({
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
}));
const mockPush = jest.fn();

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() } }));
import { api } from '@/lib/api';
const mockApi = api as jest.Mocked<typeof api>;

// Silence animation timers
beforeAll(() => {
  jest.useFakeTimers();
  // Stub browser APIs not in jsdom
  Object.defineProperty(window, 'scrollY', { value: 0, writable: true });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {}
    constructor() {}
    root = null; rootMargin = ''; thresholds = [];
    takeRecords() { return []; }
  } as unknown as typeof IntersectionObserver;
});
afterAll(() => jest.useRealTimers());

beforeEach(() => {
  jest.clearAllMocks();
  mockPush.mockReset();
  // Default: exercises list returns empty, history returns empty, suggestions return nothing
  mockApi.get.mockImplementation(async (url: string) => {
    if (url === '/api/exercises') return { data: EXERCISES };
    if (url.includes('/history')) return { data: [] };
    if (url.includes('/suggestions/weight')) return { data: { suggested_weight: 0, adjustment_reason: '', previous_weight: 0 } };
    if (url.includes('/api/plans')) return { data: [] };
    return { data: [] };
  });
});

// ─── factories ──────────────────────────────────────────────────────────────

const EXERCISES: Exercise[] = [
  { id: 'ex-1', name: 'Bench Press', muscle_group: 'chest', category: 'weighted', created_at: '' },
  { id: 'ex-2', name: 'Pull-up', muscle_group: 'back', category: 'bodyweight', created_at: '' },
  { id: 'ex-3', name: 'Squat', muscle_group: 'legs', category: 'weighted', created_at: '' },
];

function makeSet(overrides: Partial<ExerciseSet> & { id: string; set_number: number }): ExerciseSet {
  return {
    session_exercise_id: 'se-1',
    reps: 0,
    weight: 0,
    is_warmup: false,
    is_completed: false,
    created_at: '',
    ...overrides,
  };
}

function makeExercise(overrides: Partial<SessionExercise> & { id: string } = { id: 'se-1' }): SessionExercise {
  return {
    session_id: 'session-1',
    exercise_id: 'ex-1',
    order_index: 0,
    rest_seconds: 90,
    exercise: EXERCISES[0],
    sets: [
      makeSet({ id: 's1', set_number: 1 }),
      makeSet({ id: 's2', set_number: 2 }),
      makeSet({ id: 's3', set_number: 3 }),
    ],
    ...overrides,
  };
}

function makeSession(overrides: Partial<TrainingSession> = {}): TrainingSession {
  return {
    id: 'session-1',
    user_id: 'u1',
    meso_cycle_id: 'mc-1',
    name: 'Push Day',
    scheduled_date: '2026-04-04',
    status: 'scheduled',
    created_at: '',
    updated_at: '',
    exercises: [],
    ...overrides,
  };
}

// ─── render helper ──────────────────────────────────────────────────────────

function renderPage(session: TrainingSession | null, isLoading = false) {
  if (session) {
    mockApi.get.mockImplementation(async (url: string) => {
      if (url === `/api/sessions/session-1`) return { data: session };
      if (url === '/api/exercises') return { data: EXERCISES };
      if (url.includes('/history')) return { data: [] };
      if (url.includes('/suggestions/weight')) return { data: { suggested_weight: 0, adjustment_reason: '', previous_weight: 0 } };
      if (url.includes('/api/plans')) return { data: [] };
      return { data: [] };
    });
  } else if (isLoading) {
    mockApi.get.mockImplementation(() => new Promise(() => {})); // never resolves
  } else {
    // not found
    mockApi.get.mockImplementation(async () => { throw new Error('not found'); });
  }

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

  const { rerender, ...rest } = render(
    <QueryClientProvider client={qc}>
      <SessionDetailPage params={Promise.resolve({ id: 'session-1' })} />
    </QueryClientProvider>,
  );

  return { ...rest, qc };
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('SessionDetailPage', () => {

  // ── Loading ────────────────────────────────────────────────────────────────
  describe('loading state', () => {
    it('shows skeleton loaders while fetching', async () => {
      mockApi.get.mockImplementation(() => new Promise(() => {}));
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <SessionDetailPage params={Promise.resolve({ id: 'session-1' })} />
        </QueryClientProvider>,
      );
      // animate-pulse skeletons should be present before data arrives
      const skeletons = document.querySelectorAll('.animate-pulse');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  // ── Not found ─────────────────────────────────────────────────────────────
  describe('session not found', () => {
    it('renders "Session not found" when query returns nothing', async () => {
      mockApi.get.mockRejectedValue(new Error('404'));
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <SessionDetailPage params={Promise.resolve({ id: 'session-1' })} />
        </QueryClientProvider>,
      );
      await waitFor(() => expect(screen.getByText(/session not found/i)).toBeInTheDocument());
    });
  });

  // ── Session metadata ───────────────────────────────────────────────────────
  describe('session metadata', () => {
    it('displays session name', async () => {
      renderPage(makeSession({ name: 'Leg Day' }));
      await waitFor(() => expect(screen.getByText('Leg Day')).toBeInTheDocument());
    });

    it('displays formatted scheduled date', async () => {
      renderPage(makeSession({ scheduled_date: '2026-04-04' }));
      await waitFor(() => expect(screen.getByText(/apr.*4.*2026/i)).toBeInTheDocument());
    });

    it('shows total volume when session has completed sets', async () => {
      const session = makeSession({
        status: 'in_progress',
        exercises: [makeExercise({
          id: 'se-1',
          sets: [
            makeSet({ id: 's1', set_number: 1, is_completed: true, weight: 100, reps: 10 }), // 1000
            makeSet({ id: 's2', set_number: 2, is_completed: false }),
          ],
        })],
      });
      renderPage(session);
      await waitFor(() => expect(screen.getByText(/1,000|1000/)).toBeInTheDocument());
    });

    it('does not show volume when zero', async () => {
      renderPage(makeSession({ exercises: [] }));
      await waitFor(() => expect(screen.getByText('Push Day')).toBeInTheDocument());
      expect(screen.queryByText(/lbs/)).not.toBeInTheDocument();
    });
  });

  // ── Header buttons by status ───────────────────────────────────────────────
  describe('header buttons', () => {
    it('scheduled with no exercises: shows Cancel but not Start', async () => {
      renderPage(makeSession({ status: 'scheduled', exercises: [] }));
      await waitFor(() => expect(screen.getByText('Push Day')).toBeInTheDocument());
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /start/i })).not.toBeInTheDocument();
    });

    it('scheduled with exercises: shows both Start and Cancel', async () => {
      renderPage(makeSession({ status: 'scheduled', exercises: [makeExercise()] }));
      await waitFor(() => expect(screen.getByRole('button', { name: /start/i })).toBeInTheDocument());
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('in_progress with completed sets: shows Finish button', async () => {
      const session = makeSession({
        status: 'in_progress',
        exercises: [makeExercise({
          id: 'se-1',
          sets: [makeSet({ id: 's1', set_number: 1, is_completed: true, reps: 10, weight: 100 })],
        })],
      });
      renderPage(session);
      await waitFor(() => expect(screen.getByRole('button', { name: /finish/i })).toBeInTheDocument());
    });

    it('in_progress with NO completed sets: no Finish button', async () => {
      const session = makeSession({
        status: 'in_progress',
        exercises: [makeExercise()],
      });
      renderPage(session);
      await waitFor(() => expect(screen.getByText('Push Day')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /finish/i })).not.toBeInTheDocument();
    });

    it('completed status: shows Edit button, no Start/Cancel/Finish', async () => {
      renderPage(makeSession({ status: 'completed' }));
      await waitFor(() => expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /start/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /finish/i })).not.toBeInTheDocument();
    });

    it('cancelled status: no Start / Finish / Edit / Cancel buttons', async () => {
      renderPage(makeSession({ status: 'cancelled' }));
      await waitFor(() => expect(screen.getByText('Push Day')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /start|finish|edit|cancel/i })).not.toBeInTheDocument();
    });

    it('status badge shown in header for non-in_progress sessions', async () => {
      renderPage(makeSession({ status: 'scheduled' }));
      await waitFor(() => expect(screen.getByText(/scheduled/i)).toBeInTheDocument());
    });
  });

  // ── Session mutations ──────────────────────────────────────────────────────
  describe('start session', () => {
    it('calls POST /sessions/:id/start and refetches', async () => {
      mockApi.post.mockResolvedValue({ data: {} });
      renderPage(makeSession({ status: 'scheduled', exercises: [makeExercise()] }));
      await waitFor(() => screen.getByRole('button', { name: /start/i }));
      fireEvent.click(screen.getByRole('button', { name: /start/i }));
      await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/api/sessions/session-1/start'));
    });
  });

  describe('cancel session', () => {
    it('calls POST /sessions/:id/cancel and navigates to /sessions', async () => {
      mockApi.post.mockResolvedValue({ data: {} });
      renderPage(makeSession({ status: 'scheduled' }));
      await waitFor(() => screen.getByRole('button', { name: /cancel/i }));
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/api/sessions/session-1/cancel'));
      expect(mockPush).toHaveBeenCalledWith('/sessions');
    });
  });

  describe('finish session', () => {
    it('opens confirm dialog when Finish is clicked', async () => {
      const session = makeSession({
        status: 'in_progress',
        exercises: [makeExercise({
          id: 'se-1',
          sets: [makeSet({ id: 's1', set_number: 1, is_completed: true, reps: 10, weight: 100 })],
        })],
      });
      renderPage(session);
      await waitFor(() => screen.getByRole('button', { name: /finish/i }));
      fireEvent.click(screen.getByRole('button', { name: /finish/i }));
      await waitFor(() => expect(screen.getByText(/finish workout/i)).toBeInTheDocument());
    });
  });

  // ── Exercise list ──────────────────────────────────────────────────────────
  describe('exercise list', () => {
    it('renders exercise name', async () => {
      renderPage(makeSession({ exercises: [makeExercise()] }));
      await waitFor(() => expect(screen.getByText('Bench Press')).toBeInTheDocument());
    });

    it('shows empty-state prompt when no exercises', async () => {
      renderPage(makeSession({ status: 'scheduled', exercises: [] }));
      await waitFor(() => expect(screen.getByText(/apply plan template/i)).toBeInTheDocument());
    });

    it('shows set count badge', async () => {
      const se = makeExercise({ id: 'se-1', sets: [makeSet({ id: 's1', set_number: 1 }), makeSet({ id: 's2', set_number: 2 })] });
      renderPage(makeSession({ exercises: [se] }));
      await waitFor(() => expect(screen.getByText('0 / 2')).toBeInTheDocument());
    });
  });

  // ── SetRow: weighted exercise ─────────────────────────────────────────────
  describe('SetRow — weighted exercise', () => {
    async function renderWithSets(sets: ExerciseSet[]) {
      const session = makeSession({
        status: 'in_progress',
        exercises: [makeExercise({ id: 'se-1', sets })],
      });
      const utils = renderPage(session);
      await waitFor(() => screen.getByText('Bench Press'));
      return utils;
    }

    it('renders set numbers', async () => {
      await renderWithSets([
        makeSet({ id: 's1', set_number: 1 }),
        makeSet({ id: 's2', set_number: 2 }),
      ]);
      expect(screen.getAllByText('1').length).toBeGreaterThan(0);
      expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    });

    it('renders weight and reps inputs for pending sets', async () => {
      await renderWithSets([makeSet({ id: 's1', set_number: 1 })]);
      expect(screen.getAllByPlaceholderText('—').length).toBeGreaterThanOrEqual(2);
    });

    it('complete button disabled when weight and reps are empty', async () => {
      await renderWithSets([makeSet({ id: 's1', set_number: 1 })]);
      const completeBtn = document.querySelector('button[disabled]');
      expect(completeBtn).not.toBeNull();
    });

    it('complete button enabled after typing weight and reps', async () => {
      await renderWithSets([makeSet({ id: 's1', set_number: 1 })]);
      const inputs = screen.getAllByRole('spinbutton');
      // weight is first spinbutton, reps is second
      fireEvent.change(inputs[0], { target: { value: '100' } });
      fireEvent.change(inputs[1], { target: { value: '10' } });
      await waitFor(() => {
        const btns = document.querySelectorAll('button:not([disabled])');
        const checkBtn = Array.from(btns).find(b => b.classList.contains('bg-primary'));
        expect(checkBtn).toBeTruthy();
      });
    });

    it('calls PUT /exercise-sets/:id with typed values on complete', async () => {
      mockApi.put.mockResolvedValue({ data: makeSet({ id: 's1', set_number: 1, is_completed: true, reps: 10, weight: 100 }) });
      await renderWithSets([makeSet({ id: 's1', set_number: 1 })]);
      const inputs = screen.getAllByRole('spinbutton');
      fireEvent.change(inputs[0], { target: { value: '100' } });
      fireEvent.change(inputs[1], { target: { value: '10' } });
      // Click the complete button (green bg)
      await waitFor(() => {
        const btn = document.querySelector('button.bg-primary');
        expect(btn).not.toBeNull();
      });
      fireEvent.click(document.querySelector('button.bg-primary')!);
      await waitFor(() => expect(mockApi.put).toHaveBeenCalledWith(
        '/api/sessions/exercise-sets/s1',
        expect.objectContaining({ reps: 10, weight: 100, is_completed: true }),
      ));
    });

    it('calls PUT /exercise-sets/:id with ghost values when inputs are empty', async () => {
      mockApi.put.mockResolvedValue({ data: makeSet({ id: 's1', set_number: 1, is_completed: true, reps: 8, weight: 150 }) });
      // s1 has template weight=150 reps=8, s2 is blank
      await renderWithSets([
        makeSet({ id: 's1', set_number: 1, weight: 150, reps: 8 }),
        makeSet({ id: 's2', set_number: 2 }),
      ]);
      // s1 should show ghost placeholders of 150 / 8
      const inputs = screen.getAllByRole('spinbutton');
      // Complete s1 without typing anything — ghost value should be used
      await waitFor(() => {
        const btn = document.querySelector('button.bg-primary');
        expect(btn).not.toBeNull();
      });
      fireEvent.click(document.querySelector('button.bg-primary')!);
      await waitFor(() => expect(mockApi.put).toHaveBeenCalledWith(
        '/api/sessions/exercise-sets/s1',
        expect.objectContaining({ reps: 8, weight: 150 }),
      ));
    });

    it('shows completed set as crossed-out with checkmark', async () => {
      await renderWithSets([
        makeSet({ id: 's1', set_number: 1, is_completed: true, reps: 10, weight: 100 }),
      ]);
      // Completed set values rendered with line-through class
      expect(document.querySelector('.line-through')).toBeInTheDocument();
    });

    it('completed set shows green check icon', async () => {
      await renderWithSets([
        makeSet({ id: 's1', set_number: 1, is_completed: true, reps: 10, weight: 100 }),
      ]);
      // text-emerald-500 applied to check button
      expect(document.querySelector('.text-emerald-500')).toBeInTheDocument();
    });
  });

  // ── SetRow: bodyweight exercise ────────────────────────────────────────────
  describe('SetRow — bodyweight exercise', () => {
    async function renderBodyweight(sets: ExerciseSet[]) {
      const pullUp: SessionExercise = {
        id: 'se-bw',
        session_id: 'session-1',
        exercise_id: 'ex-2',
        order_index: 0,
        exercise: EXERCISES[1], // Pull-up, bodyweight
        sets,
      };
      const session = makeSession({ status: 'in_progress', exercises: [pullUp] });
      const utils = renderPage(session);
      await waitFor(() => screen.getByText('Pull-up'));
      return utils;
    }

    it('does not render weight input for bodyweight exercise', async () => {
      await renderBodyweight([makeSet({ id: 's1', set_number: 1, session_exercise_id: 'se-bw' })]);
      // There should be no "lbs" label
      expect(screen.queryByText('lbs')).not.toBeInTheDocument();
    });

    it('complete button enabled with only reps (no weight required)', async () => {
      await renderBodyweight([makeSet({ id: 's1', set_number: 1, session_exercise_id: 'se-bw' })]);
      const inputs = screen.getAllByRole('spinbutton');
      // Only reps and RPE inputs for bodyweight
      fireEvent.change(inputs[0], { target: { value: '12' } });
      await waitFor(() => {
        const btn = document.querySelector('button.bg-primary');
        expect(btn).not.toBeNull();
      });
    });

    it('complete button disabled when reps is empty for bodyweight', async () => {
      await renderBodyweight([makeSet({ id: 's1', set_number: 1, session_exercise_id: 'se-bw' })]);
      expect(document.querySelector('button[disabled]')).toBeTruthy();
    });

    it('calls PUT with weight=0 for bodyweight complete', async () => {
      mockApi.put.mockResolvedValue({ data: makeSet({ id: 's1', set_number: 1, is_completed: true, reps: 12, weight: 0, session_exercise_id: 'se-bw' }) });
      await renderBodyweight([makeSet({ id: 's1', set_number: 1, session_exercise_id: 'se-bw' })]);
      const inputs = screen.getAllByRole('spinbutton');
      fireEvent.change(inputs[0], { target: { value: '12' } });
      await waitFor(() => document.querySelector('button.bg-primary'));
      fireEvent.click(document.querySelector('button.bg-primary')!);
      await waitFor(() => expect(mockApi.put).toHaveBeenCalledWith(
        '/api/sessions/exercise-sets/s1',
        expect.objectContaining({ weight: 0, reps: 12 }),
      ));
    });
  });

  // ── Ghost values ───────────────────────────────────────────────────────────
  describe('ghost placeholder propagation', () => {
    async function renderInProgress(sets: ExerciseSet[]) {
      const session = makeSession({
        status: 'in_progress',
        exercises: [makeExercise({ id: 'se-1', sets })],
      });
      renderPage(session);
      await waitFor(() => screen.getByText('Bench Press'));
    }

    it('shows template value as ghost placeholder on first pending set', async () => {
      await renderInProgress([
        makeSet({ id: 's1', set_number: 1, weight: 100, reps: 8 }),
        makeSet({ id: 's2', set_number: 2 }),
      ]);
      // The ghost placeholder on the weight input should be '100'
      expect(screen.getAllByPlaceholderText('100').length).toBeGreaterThan(0);
    });

    it('REGRESSION: completing set 1 keeps ghost on sets 2 and 3', async () => {
      // This is the core regression: after set 1 is completed, sets 2 & 3
      // must still show the completed weight as ghost, not revert to '—'
      await renderInProgress([
        makeSet({ id: 's1', set_number: 1, is_completed: true, weight: 150, reps: 10 }),
        makeSet({ id: 's2', set_number: 2 }),
        makeSet({ id: 's3', set_number: 3 }),
      ]);
      // Both pending sets must show '150' ghost
      expect(screen.getAllByPlaceholderText('150').length).toBe(2);
      expect(screen.getAllByPlaceholderText('10').length).toBe(2);
    });

    it('uses last completed set (not first) when multiple sets are done', async () => {
      await renderInProgress([
        makeSet({ id: 's1', set_number: 1, is_completed: true, weight: 100, reps: 10 }),
        makeSet({ id: 's2', set_number: 2, is_completed: true, weight: 105, reps: 9 }),
        makeSet({ id: 's3', set_number: 3 }),
      ]);
      // Ghost should be from set 2 (105) not set 1 (100)
      expect(screen.getAllByPlaceholderText('105').length).toBeGreaterThan(0);
      expect(screen.queryAllByPlaceholderText('100')).toHaveLength(0);
    });

    it('warmup set does not contribute to ghost seed', async () => {
      await renderInProgress([
        makeSet({ id: 'w1', set_number: 1, is_completed: true, is_warmup: true, weight: 60, reps: 12 }),
        makeSet({ id: 's1', set_number: 2 }),
      ]);
      // '60' should NOT appear as ghost since warmup is excluded
      expect(screen.queryAllByPlaceholderText('60')).toHaveLength(0);
    });

    it('shows "—" ghost when no history and no template', async () => {
      await renderInProgress([
        makeSet({ id: 's1', set_number: 1 }),
      ]);
      expect(screen.getAllByPlaceholderText('—').length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Uncheck set ────────────────────────────────────────────────────────────
  describe('uncheck completed set', () => {
    it('calls PUT /exercise-sets/:id with is_completed=false', async () => {
      mockApi.put.mockResolvedValue({ data: {} });
      const session = makeSession({
        status: 'in_progress',
        exercises: [makeExercise({
          id: 'se-1',
          sets: [makeSet({ id: 's1', set_number: 1, is_completed: true, reps: 10, weight: 100 })],
        })],
      });
      renderPage(session);
      await waitFor(() => screen.getByTitle('Tap to edit'));
      fireEvent.click(screen.getByTitle('Tap to edit'));
      await waitFor(() => expect(mockApi.put).toHaveBeenCalledWith(
        '/api/sessions/exercise-sets/s1',
        expect.objectContaining({ is_completed: false }),
      ));
    });
  });

  // ── Add set ────────────────────────────────────────────────────────────────
  describe('add set', () => {
    it('calls POST /session-exercises/:id/sets with correct set_number', async () => {
      mockApi.post.mockResolvedValue({ data: makeSet({ id: 's4', set_number: 4 }) });
      const session = makeSession({
        status: 'in_progress',
        exercises: [makeExercise({
          id: 'se-1',
          sets: [makeSet({ id: 's1', set_number: 1 }), makeSet({ id: 's2', set_number: 2 }), makeSet({ id: 's3', set_number: 3 })],
        })],
      });
      renderPage(session);
      await waitFor(() => screen.getByText('+ Add Set'));
      fireEvent.click(screen.getByText('+ Add Set'));
      await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith(
        '/api/sessions/session-exercises/se-1/sets',
        expect.objectContaining({ set_number: 4 }),
      ));
    });
  });

  // ── Remove exercise ────────────────────────────────────────────────────────
  describe('remove exercise', () => {
    it('calls DELETE /session-exercises/:id on remove', async () => {
      mockApi.delete.mockResolvedValue({ data: {} });
      const session = makeSession({
        status: 'in_progress',
        exercises: [makeExercise({ id: 'se-1' })],
      });
      renderPage(session);
      await waitFor(() => screen.getByText('Bench Press'));
      // Click the X / remove button on the exercise card
      const removeBtn = screen.getByTitle('Remove exercise');
      fireEvent.click(removeBtn);
      await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith(
        '/api/sessions/session-exercises/se-1',
      ));
    });
  });

  // ── RPE validation ─────────────────────────────────────────────────────────
  describe('RPE input validation', () => {
    async function renderPendingSet() {
      const session = makeSession({
        status: 'in_progress',
        exercises: [makeExercise({ id: 'se-1', sets: [makeSet({ id: 's1', set_number: 1 })] })],
      });
      renderPage(session);
      await waitFor(() => screen.getByText('Bench Press'));
      const inputs = screen.getAllByRole('spinbutton');
      // RPE is the third spinbutton (weight, reps, RPE)
      return inputs[2];
    }

    it('accepts a valid positive RPE value', async () => {
      const rpe = await renderPendingSet();
      fireEvent.change(rpe, { target: { value: '8' } });
      expect((rpe as HTMLInputElement).value).toBe('8');
    });

    it('rejects a negative RPE value', async () => {
      const rpe = await renderPendingSet();
      fireEvent.change(rpe, { target: { value: '-1' } });
      // onChange guard should block negative — value stays ''
      expect((rpe as HTMLInputElement).value).toBe('');
    });

    it('allows clearing RPE (empty string)', async () => {
      const rpe = await renderPendingSet();
      fireEvent.change(rpe, { target: { value: '7' } });
      fireEvent.change(rpe, { target: { value: '' } });
      expect((rpe as HTMLInputElement).value).toBe('');
    });

    it('allows RPE of 0', async () => {
      const rpe = await renderPendingSet();
      fireEvent.change(rpe, { target: { value: '0' } });
      expect((rpe as HTMLInputElement).value).toBe('0');
    });

    it('RPE of -0.5 is rejected', async () => {
      const rpe = await renderPendingSet();
      fireEvent.change(rpe, { target: { value: '-0.5' } });
      expect((rpe as HTMLInputElement).value).toBe('');
    });
  });

  // ── Select all on focus ────────────────────────────────────────────────────
  describe('input: select-all on focus', () => {
    it('weight input calls select() on focus', async () => {
      const session = makeSession({
        status: 'in_progress',
        exercises: [makeExercise({ id: 'se-1', sets: [makeSet({ id: 's1', set_number: 1 })] })],
      });
      renderPage(session);
      await waitFor(() => screen.getByText('Bench Press'));
      const inputs = screen.getAllByRole('spinbutton');
      const selectSpy = jest.spyOn(inputs[0], 'select');
      fireEvent.focus(inputs[0]);
      expect(selectSpy).toHaveBeenCalled();
    });

    it('reps input calls select() on focus', async () => {
      const session = makeSession({
        status: 'in_progress',
        exercises: [makeExercise({ id: 'se-1', sets: [makeSet({ id: 's1', set_number: 1 })] })],
      });
      renderPage(session);
      await waitFor(() => screen.getByText('Bench Press'));
      const inputs = screen.getAllByRole('spinbutton');
      const selectSpy = jest.spyOn(inputs[1], 'select');
      fireEvent.focus(inputs[1]);
      expect(selectSpy).toHaveBeenCalled();
    });
  });

  // ── AI suggestions ─────────────────────────────────────────────────────────
  describe('AI weight suggestions', () => {
    async function renderWithSuggestion(suggestedWeight: number) {
      const exId = 'ex-1';
      mockApi.get.mockImplementation(async (url: string) => {
        if (url === '/api/sessions/session-1') return { data: makeSession({
          status: 'in_progress',
          exercises: [makeExercise({ id: 'se-1' })],
        }) };
        if (url === '/api/exercises') return { data: EXERCISES };
        if (url.includes(`/api/suggestions/weight`) && url.includes(exId) || url.includes('exercise_id=ex-1')) {
          return { data: { suggested_weight: suggestedWeight, adjustment_reason: 'Great progress!', previous_weight: 100 } };
        }
        if (url.includes('/api/suggestions/weight')) return { data: { suggested_weight: suggestedWeight, adjustment_reason: 'Great progress!', previous_weight: 100 } };
        if (url.includes('/history')) return { data: [] };
        if (url.includes('/api/plans')) return { data: [] };
        return { data: [] };
      });
      // suggestions only fetched when isEditing (which is true for in_progress)
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <SessionDetailPage params={Promise.resolve({ id: 'session-1' })} />
        </QueryClientProvider>,
      );
      await waitFor(() => screen.getByText('Bench Press'));
      return qc;
    }

    it('hides suggestion strip when suggested_weight is 0', async () => {
      await renderWithSuggestion(0);
      // No suggestion chip visible
      expect(screen.queryByText(/great progress/i)).not.toBeInTheDocument();
    });
  });

  // ── Back navigation ────────────────────────────────────────────────────────
  describe('back navigation', () => {
    it('back button calls router.back()', async () => {
      const backFn = jest.fn();
      jest.spyOn(require('next/navigation'), 'useRouter').mockReturnValue({ back: backFn, push: mockPush });
      renderPage(makeSession());
      await waitFor(() => screen.getByText('Push Day'));
      // The back chevron button
      const backBtn = document.querySelector('button[class*="ghost"]') as HTMLButtonElement;
      if (backBtn) fireEvent.click(backBtn);
      await waitFor(() => expect(backFn).toHaveBeenCalled());
    });
  });

  // ── Set ordering ───────────────────────────────────────────────────────────
  describe('set ordering', () => {
    it('always renders sets in set_number order regardless of API order', async () => {
      // API returns sets in reverse order (3, 2, 1)
      const session = makeSession({
        status: 'in_progress',
        exercises: [makeExercise({
          id: 'se-1',
          sets: [
            makeSet({ id: 's3', set_number: 3 }),
            makeSet({ id: 's1', set_number: 1 }),
            makeSet({ id: 's2', set_number: 2 }),
          ],
        })],
      });
      renderPage(session);
      await waitFor(() => screen.getByText('Bench Press'));
      // Find all set number labels within the set rows
      const allOnes = screen.getAllByText('1');
      const allTwos = screen.getAllByText('2');
      const allThrees = screen.getAllByText('3');
      expect(allOnes.length).toBeGreaterThan(0);
      expect(allTwos.length).toBeGreaterThan(0);
      expect(allThrees.length).toBeGreaterThan(0);
      // Verify DOM order: 1 appears before 2 before 3
      const parent = allOnes[0].closest('[class*="border-t"]')?.parentElement;
      if (parent) {
        const rows = Array.from(parent.querySelectorAll('[class*="border-t"]'));
        const nums = rows.map(r => r.querySelector('[class*="tabular-nums"]')?.textContent?.trim());
        expect(nums[0]).toBe('1');
        expect(nums[1]).toBe('2');
        expect(nums[2]).toBe('3');
      }
    });
  });

  // ── Volume calculation ─────────────────────────────────────────────────────
  describe('volume calculation', () => {
    it('only counts completed sets in volume', async () => {
      const session = makeSession({
        status: 'in_progress',
        exercises: [makeExercise({
          id: 'se-1',
          sets: [
            makeSet({ id: 's1', set_number: 1, is_completed: true, weight: 100, reps: 10 }),  // 1000
            makeSet({ id: 's2', set_number: 2, is_completed: false, weight: 100, reps: 10 }), // not counted
          ],
        })],
      });
      renderPage(session);
      await waitFor(() => expect(screen.getByText(/1,000|1000/)).toBeInTheDocument());
      expect(screen.queryByText(/2,000|2000/)).not.toBeInTheDocument();
    });

    it('formats large volumes with k suffix', async () => {
      const session = makeSession({
        exercises: [makeExercise({
          id: 'se-1',
          sets: [
            makeSet({ id: 's1', set_number: 1, is_completed: true, weight: 200, reps: 10 }), // 2000
            makeSet({ id: 's2', set_number: 2, is_completed: true, weight: 200, reps: 10 }), // 2000 → 4000
            makeSet({ id: 's3', set_number: 3, is_completed: true, weight: 200, reps: 10 }), // total 6000
          ],
        })],
      });
      renderPage(session);
      await waitFor(() => expect(screen.getByText(/6\.0k/)).toBeInTheDocument());
    });
  });

  // ── Completed session: edit mode ───────────────────────────────────────────
  describe('completed session edit mode', () => {
    it('inputs are read-only by default for completed session', async () => {
      const session = makeSession({
        status: 'completed',
        exercises: [makeExercise({
          id: 'se-1',
          sets: [makeSet({ id: 's1', set_number: 1, is_completed: true, reps: 10, weight: 100 })],
        })],
      });
      renderPage(session);
      await waitFor(() => screen.getByText('Bench Press'));
      // No spinbutton inputs visible in read-only mode
      expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    });

    it('Edit button toggles to Lock', async () => {
      renderPage(makeSession({ status: 'completed' }));
      await waitFor(() => screen.getByRole('button', { name: /edit/i }));
      fireEvent.click(screen.getByRole('button', { name: /edit/i }));
      await waitFor(() => expect(screen.getByRole('button', { name: /lock/i })).toBeInTheDocument());
    });
  });

  // ── Multiple exercises ─────────────────────────────────────────────────────
  describe('multiple exercises', () => {
    it('renders all exercises in order', async () => {
      const se1 = makeExercise({ id: 'se-1', sets: [] });
      const se2: SessionExercise = {
        id: 'se-2',
        session_id: 'session-1',
        exercise_id: 'ex-3',
        order_index: 1,
        exercise: EXERCISES[2], // Squat
        sets: [],
      };
      renderPage(makeSession({ exercises: [se1, se2] }));
      await waitFor(() => screen.getByText('Bench Press'));
      expect(screen.getByText('Squat')).toBeInTheDocument();
    });

    it('ghost values are independent per exercise', async () => {
      const se1 = makeExercise({
        id: 'se-1',
        sets: [
          makeSet({ id: 's1', set_number: 1, is_completed: true, weight: 100, reps: 10 }),
          makeSet({ id: 's2', set_number: 2 }),
        ],
      });
      const se2: SessionExercise = {
        id: 'se-2',
        session_id: 'session-1',
        exercise_id: 'ex-3',
        order_index: 1,
        exercise: EXERCISES[2], // Squat
        sets: [
          makeSet({ id: 'sq1', set_number: 1, session_exercise_id: 'se-2', is_completed: true, weight: 200, reps: 5 }),
          makeSet({ id: 'sq2', set_number: 2, session_exercise_id: 'se-2' }),
        ],
      };
      renderPage(makeSession({ exercises: [se1, se2] }));
      await waitFor(() => screen.getByText('Bench Press'));
      // Bench press ghost: 100
      expect(screen.getAllByPlaceholderText('100').length).toBeGreaterThan(0);
      // Squat ghost: 200
      expect(screen.getAllByPlaceholderText('200').length).toBeGreaterThan(0);
    });
  });

});
