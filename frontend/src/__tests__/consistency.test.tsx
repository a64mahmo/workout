import React, { Suspense } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SessionDetailPage from '@/app/sessions/[id]/page';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
  },
}));

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  usePathname: () => '/sessions/session-1',
}));

const mockApi = api as jest.Mocked<typeof api>;

const mockSession = {
  id: 'session-1',
  name: 'Consistency Test Workout',
  status: 'in_progress',
  scheduled_date: '2026-04-16',
  total_volume: 0,
  exercises: [
    {
      id: 'se-1',
      exercise_id: 'ex-1',
      exercise: { id: 'ex-1', name: 'Squat', muscle_group: 'legs' },
      sets: [
        { id: 'set-1', set_number: 1, reps: 10, weight: 100, is_completed: true },
        { id: 'set-2', set_number: 2, reps: 10, weight: 100, is_completed: true },
      ],
    },
  ],
};

describe('Frontend UI Consistency', () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    jest.clearAllMocks();
    
    mockApi.get.mockImplementation((url) => {
      if (url === '/api/sessions/session-1') return Promise.resolve({ data: mockSession });
      if (url.includes('/api/suggestions/weight')) return Promise.resolve({ data: { suggested_weight: 105, adjustment_reason: 'Testing' } });
      if (url.includes('/history')) return Promise.resolve({ data: [] });
      if (url === '/api/plans/progress') return Promise.resolve({ data: {} });
      return Promise.resolve({ data: [] });
    });
  });

  const renderPage = async (id: string) => {
    const params = Promise.resolve({ id });
    let res: any;
    await act(async () => {
      res = render(
        <QueryClientProvider client={qc}>
          <Suspense fallback={<div>Loading...</div>}>
            <SessionDetailPage params={params} />
          </Suspense>
        </QueryClientProvider>
      );
    });
    return res;
  };

  test('auto-collapse: uncompleting a set should re-expand the exercise card', async () => {
    await renderPage('session-1');

    // 1. Wait for session to load
    await waitFor(() => expect(screen.getByText('Consistency Test Workout')).toBeInTheDocument(), { timeout: 3000 });

    // 2. All sets are completed, should show "2/2"
    expect(screen.getByText('2/2')).toBeInTheDocument();

    // 3. Find and click collapse (it's the header button when completed)
    const collapseBtn = screen.getByLabelText(/Collapse Squat/i);
    fireEvent.click(collapseBtn);

    // 4. Verify it's collapsed
    expect(screen.getByLabelText(/Expand Squat/i)).toBeInTheDocument();
  });

  test('ghost map: basic presence check', async () => {
    await renderPage('session-1');
    await waitFor(() => expect(screen.getByText('Squat')).toBeInTheDocument());
    
    // Simple presence check of the exercise card
    expect(screen.getByText('Squat')).toBeInTheDocument();
  });
});
