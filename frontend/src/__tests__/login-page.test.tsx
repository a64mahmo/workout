/**
 * Tests for LoginPage (src/app/login/page.tsx)
 *
 * Covers: form rendering, validation, successful submission, error display,
 * loading state, password visibility toggle, and 429 rate-limit messaging.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockLogin = jest.fn();
jest.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ login: mockLogin }),
}));

// next/link renders an <a> in test env
jest.mock('next/link', () => {
  return function MockLink({ href, children }: { href: string; children: React.ReactNode }) {
    return <a href={href}>{children}</a>;
  };
});

// ── Component under test ───────────────────────────────────────────────────

import LoginPage from '@/app/login/page';

function renderLogin() {
  return render(<LoginPage />);
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Rendering ─────────────────────────────────────────────────────────────────

test('renders email and password fields', () => {
  renderLogin();
  expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
});

test('renders sign-in submit button', () => {
  renderLogin();
  expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
});

test('renders link to create account', () => {
  renderLogin();
  expect(screen.getByRole('link', { name: /create one/i })).toHaveAttribute('href', '/register');
});

// ── Form behaviour ────────────────────────────────────────────────────────────

test('password field is hidden by default', () => {
  renderLogin();
  expect(screen.getByLabelText(/password/i)).toHaveAttribute('type', 'password');
});

test('toggle button shows password in plain text', async () => {
  renderLogin();
  const toggleBtn = screen.getByRole('button', { name: '' }); // icon-only button
  await userEvent.click(toggleBtn);
  expect(screen.getByLabelText(/password/i)).toHaveAttribute('type', 'text');
});

test('toggle button hides password again on second click', async () => {
  renderLogin();
  const toggleBtn = screen.getByRole('button', { name: '' });
  await userEvent.click(toggleBtn);
  await userEvent.click(toggleBtn);
  expect(screen.getByLabelText(/password/i)).toHaveAttribute('type', 'password');
});

// ── Successful login ──────────────────────────────────────────────────────────

test('successful login redirects to /', async () => {
  mockLogin.mockResolvedValueOnce(undefined);

  renderLogin();
  await userEvent.type(screen.getByLabelText(/email/i), 'alice@test.com');
  await userEvent.type(screen.getByLabelText(/password/i), 'password123');
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

  await waitFor(() => {
    expect(mockLogin).toHaveBeenCalledWith('alice@test.com', 'password123');
    expect(mockPush).toHaveBeenCalledWith('/');
  });
});

// ── Loading state ─────────────────────────────────────────────────────────────

test('shows loading spinner while login request is in-flight', async () => {
  let resolve: () => void;
  mockLogin.mockReturnValueOnce(new Promise<void>(r => { resolve = r; }));

  renderLogin();
  await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com');
  await userEvent.type(screen.getByLabelText(/password/i), 'pass');
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

  expect(screen.getByText(/signing in/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();

  // Resolve the promise to clean up
  await waitFor(() => { resolve!(); });
});

test('inputs are disabled while loading', async () => {
  let resolve: () => void;
  mockLogin.mockReturnValueOnce(new Promise<void>(r => { resolve = r; }));

  renderLogin();
  await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com');
  await userEvent.type(screen.getByLabelText(/password/i), 'pass');
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

  expect(screen.getByLabelText(/email/i)).toBeDisabled();
  expect(screen.getByLabelText(/password/i)).toBeDisabled();

  await waitFor(() => { resolve!(); });
});

// ── Error handling ────────────────────────────────────────────────────────────

test('displays API error detail on failed login', async () => {
  mockLogin.mockRejectedValueOnce({
    response: { status: 401, data: { detail: 'Invalid credentials' } },
  });

  renderLogin();
  await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com');
  await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

  await waitFor(() =>
    expect(screen.getByText('Invalid credentials')).toBeInTheDocument()
  );
});

test('shows rate-limit message on 429', async () => {
  mockLogin.mockRejectedValueOnce({
    response: { status: 429, data: { detail: 'Too many login attempts.' } },
  });

  renderLogin();
  await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com');
  await userEvent.type(screen.getByLabelText(/password/i), 'pass');
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

  await waitFor(() =>
    expect(screen.getByText(/too many attempts/i)).toBeInTheDocument()
  );
});

test('shows generic error when response has no detail', async () => {
  mockLogin.mockRejectedValueOnce(new Error('Network error'));

  renderLogin();
  await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com');
  await userEvent.type(screen.getByLabelText(/password/i), 'pass');
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

  await waitFor(() =>
    expect(screen.getByText(/login failed/i)).toBeInTheDocument()
  );
});

test('clears previous error on new submission attempt', async () => {
  mockLogin
    .mockRejectedValueOnce({ response: { status: 401, data: { detail: 'Wrong' } } })
    .mockResolvedValueOnce(undefined);

  renderLogin();
  await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com');
  await userEvent.type(screen.getByLabelText(/password/i), 'bad');
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
  await waitFor(() => expect(screen.getByText('Wrong')).toBeInTheDocument());

  // Fix credentials and resubmit
  await userEvent.clear(screen.getByLabelText(/password/i));
  await userEvent.type(screen.getByLabelText(/password/i), 'correct');
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

  await waitFor(() => expect(screen.queryByText('Wrong')).not.toBeInTheDocument());
});

// ── After error recovery ──────────────────────────────────────────────────────

test('re-enables inputs after failed login', async () => {
  mockLogin.mockRejectedValueOnce({
    response: { status: 401, data: { detail: 'Bad' } },
  });

  renderLogin();
  await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com');
  await userEvent.type(screen.getByLabelText(/password/i), 'bad');
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

  await waitFor(() => expect(screen.getByLabelText(/email/i)).not.toBeDisabled());
  expect(screen.getByLabelText(/password/i)).not.toBeDisabled();
});
