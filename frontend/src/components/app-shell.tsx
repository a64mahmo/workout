'use client';

import { usePathname } from 'next/navigation';
import { Navigation } from '@/components/shared/navigation';
import { AuthGuard } from '@/components/auth/auth-guard';

const AUTH_PATHS = ['/login', '/register'];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = AUTH_PATHS.some((p) => pathname.startsWith(p));

  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <AuthGuard>
      <Navigation />
      <main className={`flex-1 container mx-auto px-4 py-6 md:pb-6 ${pathname.startsWith('/sessions/') ? 'pb-6' : 'pb-28'}`}>
        {children}
      </main>
    </AuthGuard>
  );
}
