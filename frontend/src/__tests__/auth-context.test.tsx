/**
 * Tests for AuthProvider and useAuth hook (src/contexts/auth-context.tsx)
 *
 * Coverage:
 *  - Fetches current user on mount via GET /api/auth/me
 *  - Sets user to null when /me returns an error (not logged in)
 *  - isLoading starts true, becomes false after fetch resolves
 *  - login() calls POST /api/auth/login then re-fetches /me
 *  - register() calls POST /api/auth/register then re-fetches /me
 *  - logout() calls POST /api/auth/logout and clears the user
 *  - useAuth() throws when used outside of AuthProvider
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AuthProvider, useAuth } from '@/contexts/auth-context';

// ─── mock api ────────────────────────────────────────────────────────────────

jest.mock('@/lib/api', () => ({
  api: { get: jest.fn(), post: jest.fn() },
}));
import { api } from '@/lib/api';
const mockApi = api as jest.Mocked<typeof api>;

// ─── helpers ─────────────────────────────────────────────────────────────────

const TEST_USER = {
  id: 'u1',
  email: 'alice@example.com',
  name: 'Alice',
  has_fitbit_connected: false,
};

/** A consumer component that exposes context values via data-testid attributes */
function AuthConsumer() {
  const [loginErr, setLoginErr] = React.useState('');
  const { user, isLoading, login, register, logout } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="user">{user ? user.email : 'null'}</span>
      {loginErr && <span data-testid="login-error">{loginErr}</span>}
      <button onClick={() => login('a@b.com', 'pass').catch((e: any) => setLoginErr(e.message))}>Login</button>
      <button onClick={() => register('a@b.com', 'Alice', 'pass')}>Register</button>
      <button onClick={() => logout()}>Logout</button>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <AuthProvider>
      <AuthConsumer />
    </AuthProvider>,
  );
}

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AuthProvider — initial mount', () => {
  it('starts with isLoading = true before /me resolves', async () => {
    // /me never resolves during this check
    let resolveMe!: (v: unknown) => void;
    mockApi.get.mockReturnValueOnce(new Promise((r) => (resolveMe = r)) as any);

    renderWithProvider();
    expect(screen.getByTestId('loading').textContent).toBe('true');

    // clean up: resolve the promise so the component unmounts cleanly
    await act(async () => { resolveMe({ data: null }); });
  });

  it('sets user after a successful /me response', async () => {
    mockApi.get.mockResolvedValueOnce({ data: TEST_USER });

    renderWithProvider();

    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe(TEST_USER.email));
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });

  it('leaves user as null when /me throws (unauthenticated)', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('401'));

    renderWithProvider();

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('user').textContent).toBe('null');
  });

  it('calls GET /api/auth/me on mount', async () => {
    mockApi.get.mockResolvedValueOnce({ data: TEST_USER });

    renderWithProvider();

    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/api/auth/me'));
  });
});

describe('AuthProvider — login()', () => {
  it('calls POST /api/auth/login with email and password', async () => {
    // Initial /me (already logged in after login)
    mockApi.get.mockResolvedValue({ data: TEST_USER });
    mockApi.post.mockResolvedValueOnce({ data: {} });

    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    await act(async () => {
      screen.getByText('Login').click();
    });

    expect(mockApi.post).toHaveBeenCalledWith('/api/auth/login', {
      email: 'a@b.com',
      password: 'pass',
    });
  });

  it('re-fetches /me after login so user state is updated', async () => {
    mockApi.get
      .mockResolvedValueOnce({ data: null })   // initial fetch → not logged in
      .mockResolvedValueOnce({ data: TEST_USER }); // after login
    mockApi.post.mockResolvedValueOnce({ data: {} });

    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    await act(async () => {
      screen.getByText('Login').click();
    });

    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe(TEST_USER.email));
  });

  it('propagates errors thrown by the API', async () => {
    mockApi.get.mockResolvedValue({ data: null });
    mockApi.post.mockRejectedValueOnce(new Error('Invalid credentials'));

    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    await act(async () => { screen.getByText('Login').click(); });

    await waitFor(() =>
      expect(screen.getByTestId('login-error').textContent).toBe('Invalid credentials'),
    );
  });
});

describe('AuthProvider — register()', () => {
  it('calls POST /api/auth/register with email, name and password', async () => {
    mockApi.get.mockResolvedValue({ data: TEST_USER });
    mockApi.post.mockResolvedValueOnce({ data: {} });

    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    await act(async () => {
      screen.getByText('Register').click();
    });

    expect(mockApi.post).toHaveBeenCalledWith('/api/auth/register', {
      email: 'a@b.com',
      name: 'Alice',
      password: 'pass',
    });
  });

  it('re-fetches /me after register so user state is updated', async () => {
    mockApi.get
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({ data: TEST_USER });
    mockApi.post.mockResolvedValueOnce({ data: {} });

    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    await act(async () => {
      screen.getByText('Register').click();
    });

    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe(TEST_USER.email));
  });
});

describe('AuthProvider — logout()', () => {
  it('calls POST /api/auth/logout', async () => {
    mockApi.get.mockResolvedValue({ data: TEST_USER });
    mockApi.post.mockResolvedValueOnce({ data: {} });

    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe(TEST_USER.email));

    await act(async () => {
      screen.getByText('Logout').click();
    });

    expect(mockApi.post).toHaveBeenCalledWith('/api/auth/logout');
  });

  it('clears the user immediately after logout', async () => {
    mockApi.get.mockResolvedValue({ data: TEST_USER });
    mockApi.post.mockResolvedValueOnce({ data: {} });

    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe(TEST_USER.email));

    await act(async () => {
      screen.getByText('Logout').click();
    });

    expect(screen.getByTestId('user').textContent).toBe('null');
  });
});

describe('useAuth outside of provider', () => {
  it('throws an error', () => {
    // Suppress expected React error output
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    function Bare() {
      useAuth();
      return null;
    }

    expect(() => render(<Bare />)).toThrow('useAuth must be used within AuthProvider');

    spy.mockRestore();
  });
});
