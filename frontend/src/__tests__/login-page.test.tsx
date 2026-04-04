/**
 * Tests for LoginPage (src/app/login/page.tsx)
 *
 * Coverage:
 *  - Renders email, password fields and submit button
 *  - Password is hidden by default; toggle button reveals / hides it
 *  - Successful login calls auth.login() and navigates to "/"
 *  - Shows the API-returned error message on failure
 *  - Shows a rate-limit message on HTTP 429
 *  - Shows a generic fallback error when the API returns nothing
 *  - Inputs and button are disabled while the request is in flight
 *  - Register link is present
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import LoginPage from '@/app/login/page';

// ─── mocks ───────────────────────────────────────────────────────────────────

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockLogin = jest.fn();
jest.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ login: mockLogin }),
}));

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

function fillForm(email = 'alice@example.com', password = 'secret') {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: password } });
}

function submit() {
  fireEvent.submit(screen.getByRole('button', { name: /sign in/i }).closest('form')!);
}

// ─────────────────────────────────────────────────────────────────────────────

describe('LoginPage — rendering', () => {
  it('renders the email input', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it('renders the password input', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('password field is of type password by default (hidden)', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(/password/i)).toHaveAttribute('type', 'password');
  });

  it('renders the submit button', () => {
    render(<LoginPage />);
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('renders a link to the register page', () => {
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: /create one/i })).toHaveAttribute('href', '/register');
  });
});

describe('LoginPage — password visibility toggle', () => {
  it('reveals the password when the toggle is clicked', () => {
    render(<LoginPage />);
    const toggle = screen.getByRole('button', { name: '' }); // the eye icon button has no label
    // find the toggle differently — it is the only non-submit button
    const buttons = screen.getAllByRole('button');
    const eyeBtn = buttons.find((b) => b.getAttribute('type') === 'button')!;

    fireEvent.click(eyeBtn);
    expect(screen.getByLabelText(/password/i)).toHaveAttribute('type', 'text');
  });

  it('hides the password again on second toggle click', () => {
    render(<LoginPage />);
    const buttons = screen.getAllByRole('button');
    const eyeBtn = buttons.find((b) => b.getAttribute('type') === 'button')!;

    fireEvent.click(eyeBtn);
    fireEvent.click(eyeBtn);
    expect(screen.getByLabelText(/password/i)).toHaveAttribute('type', 'password');
  });
});

describe('LoginPage — successful login', () => {
  it('calls login() with provided email and password', async () => {
    mockLogin.mockResolvedValueOnce(undefined);
    render(<LoginPage />);
    fillForm('alice@example.com', 'MyPassword1');
    submit();

    await waitFor(() =>
      expect(mockLogin).toHaveBeenCalledWith('alice@example.com', 'MyPassword1'),
    );
  });

  it('navigates to "/" after a successful login', async () => {
    mockLogin.mockResolvedValueOnce(undefined);
    render(<LoginPage />);
    fillForm();
    submit();

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/'));
  });
});

describe('LoginPage — error handling', () => {
  it('shows the API error message on failure', async () => {
    mockLogin.mockRejectedValueOnce({
      response: { status: 400, data: { detail: 'Invalid credentials' } },
    });
    render(<LoginPage />);
    fillForm();
    submit();

    await waitFor(() =>
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument(),
    );
  });

  it('shows rate-limit message on HTTP 429', async () => {
    mockLogin.mockRejectedValueOnce({ response: { status: 429 } });
    render(<LoginPage />);
    fillForm();
    submit();

    await waitFor(() =>
      expect(screen.getByText(/too many attempts/i)).toBeInTheDocument(),
    );
  });

  it('shows generic fallback error when API returns no detail', async () => {
    mockLogin.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    render(<LoginPage />);
    fillForm();
    submit();

    await waitFor(() =>
      expect(screen.getByText(/login failed/i)).toBeInTheDocument(),
    );
  });

  it('clears the error before each new submission', async () => {
    mockLogin
      .mockRejectedValueOnce({ response: { status: 400, data: { detail: 'Bad creds' } } })
      .mockResolvedValueOnce(undefined);

    render(<LoginPage />);
    fillForm();
    submit();
    await waitFor(() => expect(screen.getByText(/bad creds/i)).toBeInTheDocument());

    submit();
    await waitFor(() => expect(screen.queryByText(/bad creds/i)).not.toBeInTheDocument());
  });
});

describe('LoginPage — loading state', () => {
  it('disables the submit button while the request is in flight', async () => {
    let resolve!: () => void;
    mockLogin.mockReturnValueOnce(new Promise((r) => (resolve = r)));

    render(<LoginPage />);
    fillForm();
    submit();

    // Button should now be disabled
    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();

    resolve();
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
  });

  it('disables inputs while loading', async () => {
    let resolve!: () => void;
    mockLogin.mockReturnValueOnce(new Promise((r) => (resolve = r)));

    render(<LoginPage />);
    fillForm();
    submit();

    expect(screen.getByLabelText(/email/i)).toBeDisabled();
    expect(screen.getByLabelText(/password/i)).toBeDisabled();

    resolve();
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
  });
});
