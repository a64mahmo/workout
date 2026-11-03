'use client';

import { usePathname } from 'next/navigation';
import { Navigation } from '@/components/shared/navigation';
import { AuthGuard } from '@/components/auth/auth-guard';
import { useAuth } from '@/contexts/auth-context';

const AUTH_PATHS = ['/login', '/register'];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = AUTH_PATHS.some((p) => pathname.startsWith(p));
  const { isDemo, logout } = useAuth();

  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <AuthGuard>
      {isDemo && (
        <div role="status" className="bg-primary text-primary-foreground text-xs">
          <div className="container mx-auto px-4 py-1.5 flex items-center justify-between gap-3">
            <span>
              <strong className="font-semibold">Demo mode</strong>
              <span className="opacity-80"> · sample data, nothing is sent or saved</span>
            </span>
            <button onClick={() => logout()} className="font-semibold underline underline-offset-2 hover:opacity-80 shrink-0">
              Exit demo
            </button>
          </div>
        </div>
      )}
      <Navigation />
      <main className={`flex-1 container mx-auto px-4 py-6 md:pb-6 ${pathname.startsWith('/sessions/') ? 'pb-6' : 'pb-28'}`}>
        {children}
      </main>
    </AuthGuard>
  );
}
