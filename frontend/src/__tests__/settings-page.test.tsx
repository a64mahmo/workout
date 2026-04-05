import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsPage from '@/app/settings/page';
import { ThemeProvider } from 'next-themes';
import { api } from '@/lib/api';

// ─── mocks ──────────────────────────────────────────────────────────────────

jest.mock('@/lib/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));
const mockApi = api as jest.Mocked<typeof api>;

// Basic matchMedia mock for next-themes
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
});

const mockUser = {
  id: 'u1',
  email: 'test@example.com',
  name: 'Test User',
  has_fitbit_connected: false,
};

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        <SettingsPage />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('SettingsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockApi.get.mockImplementation(async (url) => {
      if (url === '/api/auth/me') return { data: mockUser };
      return { data: {} };
    });
  });

  it('renders user information correctly', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByText(/test@example.com/i)).toBeInTheDocument());
  });

  it('updates rest timer preference', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByText(/Default rest timer/i)).toBeInTheDocument());
    const sixtySecBtn = screen.getByText('60s');
    fireEvent.click(sixtySecBtn);
    expect(localStorage.getItem('pref-rest-timer')).toBe('60');
  });

  it('updates weight unit preference', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByText(/Weight unit/i)).toBeInTheDocument());
    const kgBtn = screen.getByText('kg');
    fireEvent.click(kgBtn);
    expect(localStorage.getItem('pref-weight-unit')).toBe('kg');
  });

  it('shows Fitbit connection status', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByText(/Fitbit Integration/i)).toBeInTheDocument());
    // Wait for user query to resolve
    await waitFor(() => expect(screen.getByText(/Not connected/i)).toBeInTheDocument());
  });

  it('shows Fitbit "Disconnect" when connected', async () => {
    mockApi.get.mockImplementation(async (url) => {
      if (url === '/api/auth/me') return { data: { ...mockUser, has_fitbit_connected: true } };
      return { data: {} };
    });
    renderSettings();
    await waitFor(() => expect(screen.getByText(/Disconnect Fitbit/i)).toBeInTheDocument());
    expect(screen.getByText(/Connected/i)).toBeInTheDocument();
  });

  it('triggers volume history sync', async () => {
    mockApi.post.mockResolvedValue({ data: { message: 'success' } });
    renderSettings();
    await waitFor(() => expect(screen.getByText(/Volume History/i)).toBeInTheDocument());
    const syncBtn = screen.getByRole('button', { name: /sync/i });
    fireEvent.click(syncBtn);
    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/api/sessions/sync-volume'));
  });
});
