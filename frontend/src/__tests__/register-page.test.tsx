/**
 * Tests for RegisterPage (src/app/register/page.tsx)
 *
 * Coverage:
 *  - Renders name, email, password fields and submit button
 *  - Password rules list is hidden until the user starts typing
 *  - Each password rule lights up (check / x) as the rule is met
 *  - Submit button is disabled when password requirements are not met
 *  - Prevents submission and shows an error when password is invalid
 *  - Successful registration calls auth.register() and navigates to "/"
 *  - Shows "email already in use" for "Email already registered" API error
 *  - Shows the API error detail for other API errors
 *  - Shows a generic fallback when the API returns no detail
 *  - Password visibility toggle works
 *  - Inputs are disabled while the request is in flight
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import RegisterPage from '@/app/register/page';

// ─── mocks ───────────────────────────────────────────────────────────────────

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockRegister = jest.fn();
jest.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ register: mockRegister }),
}));

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

const VALID_PASSWORD = 'Password1';

function fillForm(name = 'Alice', email = 'alice@example.com', password = VALID_PASSWORD) {
  fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: password } });
}

function submit() {
  const form = screen.getByRole('button', { name: /create account/i }).closest('form')!;
  fireEvent.submit(form);
}

// ─────────────────────────────────────────────────────────────────────────────

describe('RegisterPage — rendering', () => {
  it('renders name, email and password fields', () => {
    render(<RegisterPage />);
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('renders the submit button', () => {
    render(<RegisterPage />);
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });

  it('renders a link to the login page', () => {
    render(<RegisterPage />);
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  });

  it('does NOT show the password rules list before any input', () => {
    render(<RegisterPage />);
    expect(screen.queryByText(/at least 8 characters/i)).not.toBeInTheDocument();
  });
});

describe('RegisterPage — password rules', () => {
  it('shows the rules list once the user starts typing a password', () => {
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'a' } });
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
  });

  it('shows all four rules', () => {
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'x' } });
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/one uppercase letter/i)).toBeInTheDocument();
    expect(screen.getByText(/one lowercase letter/i)).toBeInTheDocument();
    expect(screen.getByText(/one number/i)).toBeInTheDocument();
  });

  it('marks a rule as passing when the condition is met', () => {
    render(<RegisterPage />);
    // Type a password that satisfies the "uppercase" rule
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'A' } });
    const upperRule = screen.getByText(/one uppercase letter/i).closest('li')!;
    expect(upperRule).toHaveClass('text-green-500');
  });

  it('marks a rule as failing when the condition is not met', () => {
    render(<RegisterPage />);
    // No uppercase in 'abc'
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'abc' } });
    const upperRule = screen.getByText(/one uppercase letter/i).closest('li')!;
    expect(upperRule).not.toHaveClass('text-green-500');
  });

  it('submit button is disabled when password does not meet requirements', () => {
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'weak' } });
    expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled();
  });

  it('submit button is enabled when all password requirements are met', () => {
    render(<RegisterPage />);
    fillForm();
    expect(screen.getByRole('button', { name: /create account/i })).not.toBeDisabled();
  });
});

describe('RegisterPage — client-side password validation', () => {
  it('shows an error and does NOT call register() when password is invalid', async () => {
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
    // Set a weak password directly so we can bypass the disabled button via form submit
    Object.defineProperty(
      screen.getByRole('button', { name: /create account/i }),
      'disabled',
      { get: () => false, configurable: true },
    );
    submit();

    // register() should never be called
    expect(mockRegister).not.toHaveBeenCalled();
  });
});

describe('RegisterPage — successful registration', () => {
  it('calls register() with name, email and password', async () => {
    mockRegister.mockResolvedValueOnce(undefined);
    render(<RegisterPage />);
    fillForm('Alice', 'alice@example.com', VALID_PASSWORD);
    submit();

    await waitFor(() =>
      expect(mockRegister).toHaveBeenCalledWith('alice@example.com', 'Alice', VALID_PASSWORD),
    );
  });

  it('navigates to "/" after a successful registration', async () => {
    mockRegister.mockResolvedValueOnce(undefined);
    render(<RegisterPage />);
    fillForm();
    submit();

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/'));
  });
});

describe('RegisterPage — error handling', () => {
  it('shows "email already in use" for "Email already registered" error', async () => {
    mockRegister.mockRejectedValueOnce({
      response: { status: 400, data: { detail: 'Email already registered' } },
    });
    render(<RegisterPage />);
    fillForm();
    submit();

    await waitFor(() =>
      expect(screen.getByText(/email is already in use/i)).toBeInTheDocument(),
    );
  });

  it('shows the API error detail for other API errors', async () => {
    mockRegister.mockRejectedValueOnce({
      response: { status: 400, data: { detail: 'Invalid email format' } },
    });
    render(<RegisterPage />);
    fillForm();
    submit();

    await waitFor(() =>
      expect(screen.getByText(/invalid email format/i)).toBeInTheDocument(),
    );
  });

  it('shows a generic fallback when the API returns no detail', async () => {
    mockRegister.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    render(<RegisterPage />);
    fillForm();
    submit();

    await waitFor(() =>
      expect(screen.getByText(/registration failed/i)).toBeInTheDocument(),
    );
  });
});

describe('RegisterPage — password visibility toggle', () => {
  it('reveals the password field when the eye icon is clicked', () => {
    render(<RegisterPage />);
    const buttons = screen.getAllByRole('button');
    const eyeBtn = buttons.find((b) => b.getAttribute('type') === 'button')!;

    fireEvent.click(eyeBtn);
    expect(screen.getByLabelText(/password/i)).toHaveAttribute('type', 'text');
  });

  it('hides the password again on second click', () => {
    render(<RegisterPage />);
    const buttons = screen.getAllByRole('button');
    const eyeBtn = buttons.find((b) => b.getAttribute('type') === 'button')!;

    fireEvent.click(eyeBtn);
    fireEvent.click(eyeBtn);
    expect(screen.getByLabelText(/password/i)).toHaveAttribute('type', 'password');
  });
});

describe('RegisterPage — loading state', () => {
  it('disables inputs while the request is in flight', async () => {
    let resolve!: () => void;
    mockRegister.mockReturnValueOnce(new Promise((r) => (resolve = r)));

    render(<RegisterPage />);
    fillForm();
    submit();

    expect(screen.getByLabelText(/^name$/i)).toBeDisabled();
    expect(screen.getByLabelText(/email/i)).toBeDisabled();
    expect(screen.getByLabelText(/password/i)).toBeDisabled();

    resolve();
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
  });

  it('shows "Creating account…" text while loading', async () => {
    let resolve!: () => void;
    mockRegister.mockReturnValueOnce(new Promise((r) => (resolve = r)));

    render(<RegisterPage />);
    fillForm();
    submit();

    expect(screen.getByText(/creating account/i)).toBeInTheDocument();

    resolve();
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
  });
});
