/**
 * Tests for AuthGuard (src/components/auth/auth-guard.tsx)
 *
 * Coverage:
 *  - Shows a spinner while auth is loading
 *  - Redirects unauthenticated user away from protected routes
 *  - Renders children when user is authenticated on any route
 *  - Renders children (without redirect) on public paths even when unauthenticated
 *  - Renders nothing (null) during redirect transition
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AuthGuard } from '@/components/auth/auth-guard';

// ─── mocks ───────────────────────────────────────────────────────────────────

const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: jest.fn(() => '/sessions'),
}));
import { usePathname } from 'next/navigation';
const mockUsePathname = usePathname as jest.Mock;

jest.mock('@/contexts/auth-context', () => ({
  useAuth: jest.fn(),
}));
import { useAuth } from '@/contexts/auth-context';
const mockUseAuth = useAuth as jest.Mock;

// ─── helpers ─────────────────────────────────────────────────────────────────

const TEST_USER = { id: 'u1', email: 'alice@example.com', name: 'Alice', has_fitbit_connected: false };

function renderGuard(pathname = '/sessions') {
  mockUsePathname.mockReturnValue(pathname);
  return render(
    <AuthGuard>
      <div data-testid="protected-content">Protected</div>
    </AuthGuard>,
  );
}

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AuthGuard — loading state', () => {
  it('shows a spinner while isLoading is true', () => {
    mockUseAuth.mockReturnValue({ user: null, isLoading: true });

    renderGuard();

    // The Loader2 spinner should be rendered
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });
});

describe('AuthGuard — unauthenticated on a protected path', () => {
  it('calls router.replace("/login") when not loading and no user', async () => {
    mockUseAuth.mockReturnValue({ user: null, isLoading: false });

    renderGuard('/sessions');

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
  });

  it('renders null (no content) during the redirect', () => {
    mockUseAuth.mockReturnValue({ user: null, isLoading: false });

    renderGuard('/sessions');

    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });
});

describe('AuthGuard — authenticated user', () => {
  it('renders children on a protected path', () => {
    mockUseAuth.mockReturnValue({ user: TEST_USER, isLoading: false });

    renderGuard('/sessions');

    expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('renders children on a public path', () => {
    mockUseAuth.mockReturnValue({ user: TEST_USER, isLoading: false });

    renderGuard('/login');

    expect(screen.getByTestId('protected-content')).toBeInTheDocument();
  });
});

describe('AuthGuard — unauthenticated on a public path', () => {
  it('renders children without redirecting on /login', () => {
    mockUseAuth.mockReturnValue({ user: null, isLoading: false });

    renderGuard('/login');

    expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('renders children without redirecting on /register', () => {
    mockUseAuth.mockReturnValue({ user: null, isLoading: false });

    renderGuard('/register');

    expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('also allows sub-paths of /login (e.g. /login/sso)', () => {
    mockUseAuth.mockReturnValue({ user: null, isLoading: false });

    renderGuard('/login/sso');

    expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
