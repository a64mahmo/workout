import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionDetailInner } from '@/app/sessions/[id]/page';
import { api } from '@/lib/api';
import type { TrainingSession, Exercise, SessionExercise, ExerciseSet } from '@/types';

// ─── mocks ──────────────────────────────────────────────────────────────────

jest.mock('next/navigation', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

jest.mock('@/lib/api', () => ({ 
  api: { 
    get: jest.fn(), 
    post: jest.fn(), 
    put: jest.fn(), 
    delete: jest.fn(),
    patch: jest.fn() 
  } 
}));
const mockApi = api as jest.Mocked<typeof api>;

// Helper factories
const EXERCISES: Exercise[] = [
  { id: 'ex-1', name: 'Bench Press', muscle_group: 'chest', category: 'weighted', created_at: '' },
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

function makeSession(overrides: Partial<TrainingSession> = {}): TrainingSession {
  return {
    id: 'session-1',
    user_id: 'u1',
    meso_cycle_id: 'mc-1',
    name: 'Push Day',
    scheduled_date: '2026-04-04',
    status: 'in_progress', // ensures isEditing is true
    created_at: '',
    updated_at: '',
    exercises: [
      {
        id: 'se-1',
        session_id: 'session-1',
        exercise_id: 'ex-1',
        order_index: 0,
        rest_seconds: 90,
        exercise: EXERCISES[0],
        sets: [
          makeSet({ id: 's1', set_number: 1 }),
          makeSet({ id: 's2', set_number: 2 }),
        ],
      }
    ],
    ...overrides,
  };
}

function renderPage(session: TrainingSession) {
  const qc = new QueryClient({ 
    defaultOptions: { 
        queries: { retry: false, staleTime: 0 }, 
        mutations: { retry: false } 
    } 
  });

  return render(
    <QueryClientProvider client={qc}>
      <SessionDetailInner id={session.id} />
    </QueryClientProvider>,
  );
}

describe('SessionDetailPage — Suggestion Engine Deep Dives', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup standard mocks
    mockApi.get.mockImplementation(async (url: string) => {
      if (url.includes('/api/sessions/')) return { data: makeSession() };
      if (url === '/api/exercises') return { data: EXERCISES };
      if (url.includes('/history')) return { data: [] };
      if (url.includes('/suggestions/weight')) {
        return { 
          data: { 
            log_id: 'log-123',
            suggested_weight: 105, 
            adjustment_reason: 'RPE 7.0 -> target 7.5 | add 5 lbs', 
            previous_weight: 100,
            meso_week: 2,
            meso_phase: 'accumulation',
            target_rpe: 7.5,
            suggested_sets: 3,
            volume_trend: 'stable'
          } 
        };
      }
      return { data: [] };
    });
  });

  it('renders suggestion with target RPE and weight', async () => {
    renderPage(makeSession());
    // Use findBy to wait for async suggestions
    const weightEl = await screen.findByText((content) => content.includes('105') && content.includes('lbs'));
    expect(weightEl).toBeInTheDocument();
    expect(screen.getByText(/RPE 7\.5/)).toBeInTheDocument();
    expect(screen.getByText(/add 5 lbs/i)).toBeInTheDocument();
  });

  it('highlights Deload phase with specific styling', async () => {
    mockApi.get.mockImplementation(async (url: string) => {
      if (url.includes('/api/sessions/')) return { data: makeSession() };
      if (url === '/api/exercises') return { data: EXERCISES };
      if (url.includes('/history')) return { data: [] };
      if (url.includes('/suggestions/weight')) {
        return { 
          data: { 
            log_id: 'log-deload',
            suggested_weight: 65, 
            adjustment_reason: 'DELOAD | reset weight', 
            meso_phase: 'deload',
            target_rpe: 5.5,
            suggested_sets: 2,
          } 
        };
      }
      return { data: [] };
    });

    renderPage(makeSession());
    const deloadBadge = await screen.findByText(/Deload/i);
    expect(deloadBadge).toBeInTheDocument();
    
    const weightEl = screen.getByText((content) => content.includes('65') && content.includes('lbs'));
    expect(weightEl).toHaveClass('text-blue-600');
  });

  it('shows "Add Sets" button when suggested volume > current volume', async () => {
    renderPage(makeSession());
    const addSetsBtn = await screen.findByText(/3 Sets/i);
    expect(addSetsBtn).toBeInTheDocument();
    
    fireEvent.click(addSetsBtn);
    
    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith(
      '/api/sessions/session-exercises/se-1/sets',
      expect.objectContaining({ set_number: 3 })
    ));
  });

  it('records outcome to audit log when a set is completed', async () => {
    mockApi.put.mockResolvedValue({ data: { id: 's1', is_completed: true } });
    renderPage(makeSession());
    
    await screen.findByText((content) => content.includes('105'));
    
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '105' } });
    fireEvent.change(inputs[1], { target: { value: '10' } });
    
    // Complete the set - the primary background button
    const checkBtn = await waitFor(() => {
        const btn = screen.getAllByRole('button').find(b => b.classList.contains('bg-primary'));
        if (!btn) throw new Error('btn not found');
        return btn;
    });
    fireEvent.click(checkBtn);
    
    await waitFor(() => expect(mockApi.patch).toHaveBeenCalledWith(
      '/api/suggestions/weight/history/log-123',
      expect.objectContaining({
        actual_weight: 105,
        actual_reps: 10
      })
    ));
  });
});
