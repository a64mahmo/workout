/**
 * Tests for AuthContext (src/contexts/auth-context.tsx)
 *
 * Covers: initial loading state, successful login/register/logout,
 * API error propagation, and the useAuth guard.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockApi = api as jest.Mocked<typeof api>;

// Helper component that exposes auth state for assertions
function TestConsumer() {
  const { user, isLoading, login, register, logout } = useAuth();
  return (
    <div>
      {isLoading && <span data-testid="loading">loading</span>}
      {user ? (
        <span data-testid="user">{user.email}</span>
      ) : (
        <span data-testid="no-user">not logged in</span>
      )}
      <button onClick={() => login('a@b.com', 'pass')}>login</button>
      <button onClick={() => register('a@b.com', 'Alice', 'pass')}>register</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

function renderWithAuth(ui = <TestConsumer />) {
  return render(<AuthProvider>{ui}</AuthProvider>);
}

// ── Initial state ─────────────────────────────────────────────────────────────

test('shows loading state on mount, then resolves', async () => {
  mockApi.get.mockResolvedValueOnce({ data: null });
  renderWithAuth();
  expect(screen.getByTestId('loading')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByTestId('loading')).not.toBeInTheDocument());
});

test('sets user when /api/auth/me resolves', async () => {
  mockApi.get.mockResolvedValueOnce({
    data: { id: '1', email: 'alice@test.com', name: 'Alice', has_fitbit_connected: false },
  });
  renderWithAuth();
  await waitFor(() =>
    expect(screen.getByTestId('user')).toHaveTextContent('alice@test.com')
  );
});

test('sets user to null when /api/auth/me fails', async () => {
  mockApi.get.mockRejectedValueOnce(new Error('401'));
  renderWithAuth();
  await waitFor(() => expect(screen.getByTestId('no-user')).toBeInTheDocument());
});

// ── Login ─────────────────────────────────────────────────────────────────────

test('login calls POST /api/auth/login then fetches me', async () => {
  // Initial fetch → not logged in
  mockApi.get.mockResolvedValueOnce({ data: null });
  renderWithAuth();
  await waitFor(() => screen.getByTestId('no-user'));

  // Login flow: post succeeds, then get /me returns user
  mockApi.post.mockResolvedValueOnce({ data: { user_id: '1' } });
  mockApi.get.mockResolvedValueOnce({
    data: { id: '1', email: 'alice@test.com', name: 'Alice', has_fitbit_connected: false },
  });

  await act(async () => {
    await userEvent.click(screen.getByRole('button', { name: 'login' }));
  });

  expect(mockApi.post).toHaveBeenCalledWith('/api/auth/login', {
    email: 'a@b.com',
    password: 'pass',
  });
  await waitFor(() =>
    expect(screen.getByTestId('user')).toHaveTextContent('alice@test.com')
  );
});

test('login propagates API errors to caller', async () => {
  mockApi.get.mockResolvedValueOnce({ data: null });
  renderWithAuth();
  await waitFor(() => screen.getByTestId('no-user'));

  const apiError = Object.assign(new Error('Bad request'), {
    response: { status: 401, data: { detail: 'Invalid credentials' } },
  });
  mockApi.post.mockRejectedValueOnce(apiError);

  let caughtError: unknown;
  function LoginCapture() {
    const { login } = useAuth();
    return (
      <button
        onClick={async () => {
          try {
            await login('bad@test.com', 'wrong');
          } catch (e) {
            caughtError = e;
          }
        }}
      >
        try-login
      </button>
    );
  }

  const { getByRole } = render(
    <AuthProvider>
      <LoginCapture />
    </AuthProvider>
  );
  // Drain the initial /me call
  await waitFor(() => {});

  await act(async () => {
    await userEvent.click(getByRole('button', { name: 'try-login' }));
  });

  expect(caughtError).toBeDefined();
});

// ── Register ──────────────────────────────────────────────────────────────────

test('register calls POST /api/auth/register then fetches me', async () => {
  mockApi.get.mockResolvedValueOnce({ data: null });
  renderWithAuth();
  await waitFor(() => screen.getByTestId('no-user'));

  mockApi.post.mockResolvedValueOnce({ data: { user_id: '2' } });
  mockApi.get.mockResolvedValueOnce({
    data: { id: '2', email: 'a@b.com', name: 'Alice', has_fitbit_connected: false },
  });

  await act(async () => {
    await userEvent.click(screen.getByRole('button', { name: 'register' }));
  });

  expect(mockApi.post).toHaveBeenCalledWith('/api/auth/register', {
    email: 'a@b.com',
    name: 'Alice',
    password: 'pass',
  });
  await waitFor(() =>
    expect(screen.getByTestId('user')).toHaveTextContent('a@b.com')
  );
});

// ── Logout ────────────────────────────────────────────────────────────────────

test('logout calls POST /api/auth/logout and clears user', async () => {
  mockApi.get.mockResolvedValueOnce({
    data: { id: '1', email: 'alice@test.com', name: 'Alice', has_fitbit_connected: false },
  });
  renderWithAuth();
  await waitFor(() => screen.getByTestId('user'));

  mockApi.post.mockResolvedValueOnce({ data: { message: 'Logged out' } });

  await act(async () => {
    await userEvent.click(screen.getByRole('button', { name: 'logout' }));
  });

  expect(mockApi.post).toHaveBeenCalledWith('/api/auth/logout');
  expect(screen.getByTestId('no-user')).toBeInTheDocument();
});

// ── useAuth guard ─────────────────────────────────────────────────────────────

test('useAuth throws when used outside AuthProvider', () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  function BareConsumer() {
    useAuth();
    return null;
  }
  expect(() => render(<BareConsumer />)).toThrow(
    'useAuth must be used within AuthProvider'
  );
  consoleError.mockRestore();
});
