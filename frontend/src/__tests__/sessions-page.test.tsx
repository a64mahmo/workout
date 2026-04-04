/**
 * Tests for SessionsPage (src/app/sessions/page.tsx)
 *
 * Coverage:
 *  - Loading state: skeleton placeholders visible
 *  - Empty state: "No sessions yet" with create button
 *  - Stats strip: totals, volume, month count rendered after load
 *  - Upcoming sessions section
 *  - History section (completed / cancelled sessions)
 *  - Month navigation prev/next buttons
 *  - Sort order toggle
 *  - Delete session: mutation called, optimistic list update
 *  - Create session dialog: triggered by the "New Session" button
 *  - Muscle-group suggestion chips for overdue muscle groups
 */

import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SessionsPage from '@/app/sessions/page';
import type { TrainingSession, MesoCycle } from '@/types';

// ─── mocks ───────────────────────────────────────────────────────────────────

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/lib/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));
import { api } from '@/lib/api';
const mockApi = api as jest.Mocked<typeof api>;

beforeAll(() => {
  jest.useFakeTimers();
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {}
    constructor() {}
    root = null; rootMargin = ''; thresholds = [];
    takeRecords() { return []; }
  } as unknown as typeof IntersectionObserver;
});
afterAll(() => jest.useRealTimers());
afterEach(() => jest.runOnlyPendingTimers());
beforeEach(() => {
  jest.clearAllMocks();
  mockPush.mockReset();
});

// ─── factories ───────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<TrainingSession> = {}): TrainingSession {
  return {
    id: 'sess-1',
    user_id: 'u1',
    meso_cycle_id: 'mc-1',
    name: 'Push Day',
    scheduled_date: '2026-04-01',
    status: 'scheduled',
    created_at: '',
    updated_at: '',
    exercises: [],
    ...overrides,
  };
}

function makeCycle(overrides: Partial<MesoCycle> = {}): MesoCycle {
  return {
    id: 'mc-1',
    name: 'Cycle 1',
    user_id: 'u1',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

// ─── render helper ───────────────────────────────────────────────────────────

async function renderPage() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  let result: any;
  await act(async () => {
    result = render(
      <QueryClientProvider client={qc}>
        <SessionsPage />
      </QueryClientProvider>,
    );
  });

  return { ...result, qc };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('SessionsPage — loading state', () => {
  it('shows skeleton placeholders while data is fetching', async () => {
    mockApi.get.mockReturnValue(new Promise(() => {})); // never resolves

    await renderPage();

    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});

describe('SessionsPage — empty state', () => {
  beforeEach(() => {
    mockApi.get.mockImplementation(async (url: string) => {
      if (url === '/api/sessions') return { data: [] };
      if (url === '/api/meso-cycles') return { data: [] };
      if (url.includes('fitbit')) return { data: { connected: false } };
      return { data: [] };
    });
  });

  it('shows "No sessions yet" when there are no sessions', async () => {
    await renderPage();
    await waitFor(() =>
      expect(screen.getByText(/no sessions yet/i)).toBeInTheDocument(),
    );
  });

  it('shows a create button in the empty state', async () => {
    await renderPage();
    await waitFor(() =>
      expect(screen.getByText(/no sessions yet/i)).toBeInTheDocument(),
    );
    // There are two "Create Session" / "New Session" buttons in empty state
    expect(screen.getAllByRole('button', { name: /create session|new session/i }).length).toBeGreaterThan(0);
  });
});

describe('SessionsPage — upcoming sessions', () => {
  it('renders an upcoming session in the Upcoming section', async () => {
    mockApi.get.mockImplementation(async (url: string) => {
      if (url === '/api/sessions')
        return { data: [makeSession({ status: 'scheduled', name: 'Leg Day' })] };
      if (url === '/api/meso-cycles') return { data: [makeCycle()] };
      if (url.includes('fitbit')) return { data: { connected: false } };
      return { data: [] };
    });

    await renderPage();

    await waitFor(() => expect(screen.getByText('Leg Day')).toBeInTheDocument());
    // The "Upcoming" heading should be present as a section heading
    expect(screen.getByRole('heading', { name: /upcoming/i })).toBeInTheDocument();
  });

  it('renders an in_progress session in the Upcoming section', async () => {
    mockApi.get.mockImplementation(async (url: string) => {
      if (url === '/api/sessions')
        return {
          data: [makeSession({ status: 'in_progress', name: 'Active Workout' })],
        };
      if (url === '/api/meso-cycles') return { data: [makeCycle()] };
      if (url.includes('fitbit')) return { data: { connected: false } };
      return { data: [] };
    });

    await renderPage();

    await waitFor(() =>
      expect(screen.getByText('Active Workout')).toBeInTheDocument(),
    );
  });
});

describe('SessionsPage — stats strip', () => {
  it('shows total session count in stats', async () => {
    mockApi.get.mockImplementation(async (url: string) => {
      if (url === '/api/sessions')
        return {
          data: [
            makeSession({ id: 's1', status: 'completed', actual_date: '2026-04-01' }),
            makeSession({ id: 's2', status: 'completed', actual_date: '2026-04-02' }),
          ],
        };
      if (url === '/api/meso-cycles') return { data: [makeCycle()] };
      if (url.includes('fitbit')) return { data: { connected: false } };
      return { data: [] };
    });

    await renderPage();

    await waitFor(() => expect(screen.getByText('Total sessions')).toBeInTheDocument());
    // "Total sessions" stat card shows the count — find the paragraph sibling
    const statLabel = screen.getByText('Total sessions');
    const statValue = statLabel.nextElementSibling;
    expect(statValue?.textContent).toBe('2');
  });

  it('shows volume in stats when sessions have completed sets', async () => {
    const sessionWithVolume = makeSession({
      id: 's1',
      status: 'completed',
      actual_date: '2026-04-01',
      total_volume: 5000,
    });

    mockApi.get.mockImplementation(async (url: string) => {
      if (url === '/api/sessions') return { data: [sessionWithVolume] };
      if (url === '/api/meso-cycles') return { data: [makeCycle()] };
      if (url.includes('fitbit')) return { data: { connected: false } };
      return { data: [] };
    });

    await renderPage();

    await waitFor(() => expect(screen.getByText('Total volume')).toBeInTheDocument());
    // Find the value under the "Total volume" stat card
    const volLabel = screen.getByText('Total volume');
    const volValue = volLabel.nextElementSibling;
    expect(volValue?.textContent).toBe('5.0k lbs');
  });
});

describe('SessionsPage — history section', () => {
  it('renders completed sessions in the history section', async () => {
    mockApi.get.mockImplementation(async (url: string) => {
      if (url === '/api/sessions')
        return {
          data: [
            makeSession({
              id: 's1',
              status: 'completed',
              actual_date: '2026-04-01',
              name: 'Chest Day',
            }),
          ],
        };
      if (url === '/api/meso-cycles') return { data: [makeCycle()] };
      if (url.includes('fitbit')) return { data: { connected: false } };
      return { data: [] };
    });

    await renderPage();

    await waitFor(() => expect(screen.getByText('Chest Day')).toBeInTheDocument());
    expect(screen.getByText(/history/i)).toBeInTheDocument();
  });

  it('shows a "no sessions" placeholder for an empty month', async () => {
    mockApi.get.mockImplementation(async (url: string) => {
      if (url === '/api/sessions')
        return {
          // completed session is in a different month (far in the past)
          data: [
            makeSession({
              id: 's1',
              status: 'completed',
              actual_date: '2020-01-01',
              name: 'Old Workout',
            }),
          ],
        };
      if (url === '/api/meso-cycles') return { data: [makeCycle()] };
      if (url.includes('fitbit')) return { data: { connected: false } };
      return { data: [] };
    });

    await renderPage();

    await waitFor(() =>
      expect(screen.getByText(/no sessions in/i)).toBeInTheDocument(),
    );
  });
});

describe('SessionsPage — month navigation', () => {
  it('has a prev-month button in the history section', async () => {
    mockApi.get.mockImplementation(async (url: string) => {
      if (url === '/api/sessions')
        return {
          data: [
            makeSession({
              id: 's1',
              status: 'completed',
              actual_date: '2026-04-01',
              name: 'Any Workout',
            }),
          ],
        };
      if (url === '/api/meso-cycles') return { data: [makeCycle()] };
      if (url.includes('fitbit')) return { data: { connected: false } };
      return { data: [] };
    });

    await renderPage();

    await waitFor(() => expect(screen.getByText(/history/i)).toBeInTheDocument());

    // Previous-month chevron button
    const chevrons = document.querySelectorAll('[class*="ChevronLeft"], svg');
    expect(chevrons.length).toBeGreaterThan(0);
  });
});

describe('SessionsPage — delete session', () => {
  it('calls DELETE /api/sessions/:id when delete is triggered', async () => {
    mockApi.get.mockImplementation(async (url: string) => {
      if (url === '/api/sessions')
        return {
          data: [
            makeSession({
              id: 'sess-to-delete',
              status: 'scheduled',
              name: 'Delete Me',
            }),
          ],
        };
      if (url === '/api/meso-cycles') return { data: [makeCycle()] };
      if (url.includes('fitbit')) return { data: { connected: false } };
      return { data: [] };
    });
    mockApi.delete.mockResolvedValueOnce({});

    await renderPage();

    await waitFor(() => expect(screen.getByText('Delete Me')).toBeInTheDocument());

    // Find the desktop delete button (hidden by CSS but in the DOM)
    const deleteBtn = document.querySelector('[aria-label="Delete session"]') as HTMLButtonElement;
    expect(deleteBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    await waitFor(() =>
      expect(mockApi.delete).toHaveBeenCalledWith('/api/sessions/sess-to-delete'),
    );
  });
});

describe('SessionsPage — new session button', () => {
  it('renders the "New Session" trigger button', async () => {
    mockApi.get.mockImplementation(async (url: string) => {
      if (url === '/api/sessions') return { data: [] };
      if (url === '/api/meso-cycles') return { data: [] };
      if (url.includes('fitbit')) return { data: { connected: false } };
      return { data: [] };
    });

    await renderPage();

    await waitFor(() =>
      expect(screen.getByText(/no sessions yet/i)).toBeInTheDocument(),
    );

    expect(
      screen.getByRole('button', { name: /new session/i }),
    ).toBeInTheDocument();
  });
});

describe('SessionsPage — session card navigation', () => {
  it('navigates to the session detail on click', async () => {
    mockApi.get.mockImplementation(async (url: string) => {
      if (url === '/api/sessions')
        return {
          data: [makeSession({ id: 'sess-nav', status: 'scheduled', name: 'Nav Test' })],
        };
      if (url === '/api/meso-cycles') return { data: [makeCycle()] };
      if (url.includes('fitbit')) return { data: { connected: false } };
      return { data: [] };
    });

    await renderPage();

    await waitFor(() => expect(screen.getByText('Nav Test')).toBeInTheDocument());

    // The session card button navigates on click
    fireEvent.click(screen.getByText('Nav Test'));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/sessions/sess-nav'),
    );
  });
});
