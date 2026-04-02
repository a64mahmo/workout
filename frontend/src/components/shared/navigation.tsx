'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  SunIcon,
  MoonIcon,
  Dumbbell,
  LayoutDashboard,
  RefreshCcw,
  Calendar,
  Zap,
  ClipboardList,
  Plus,
  Settings,
  LogOut,
  MoreHorizontal,
  X,
  User,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/exercises', label: 'Exercises', icon: Dumbbell },
  { href: '/cycles', label: 'Cycles', icon: RefreshCcw },
  { href: '/plans', label: 'Plans', icon: ClipboardList },
  { href: '/sessions', label: 'Sessions', icon: Calendar },
  { href: '/suggestions', label: 'Suggestions', icon: Zap },
  { href: '/settings', label: 'Settings', icon: Settings },
];

// Primary bottom nav items (mobile) — 2 left, + center, 2 right
const bottomNavLeft = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/sessions', label: 'Sessions', icon: Calendar },
];

// Items accessible via the "More" drawer
const moreNavItems = [
  { href: '/suggestions', label: 'Suggestions', icon: Zap },
  { href: '/plans', label: 'Plans', icon: ClipboardList },
  { href: '/cycles', label: 'Cycles', icon: RefreshCcw },
  { href: '/settings', label: 'Settings', icon: Settings },
];

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return <Button variant="ghost" size="icon-sm" />;

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      <SunIcon className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <MoonIcon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}

export function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [isCreating, setIsCreating] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  const handleNewSession = async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const res = await api.post('/api/sessions', {
        name: 'New Session',
        scheduled_date: today,
        status: 'in_progress',
      });
      router.push(`/sessions/${res.data.id}`);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      {/* ── Top bar (desktop only) ── */}
      <nav className="hidden md:block border-b sticky top-0 z-40 bg-background/95 backdrop-blur transition-colors">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
            <div className="size-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <Dumbbell className="size-3.5 text-primary-foreground" />
            </div>
            <span className="font-bold text-base tracking-tight">Workout</span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-0.5">
            {navItems.map((item) => {
              const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href}>
                  <button className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all hover:bg-muted hover:cursor-pointer',
                    isActive ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground',
                  )}>
                    <item.icon className={cn('size-3.5', isActive ? 'text-primary' : 'text-muted-foreground')} />
                    <span className="hidden lg:inline">{item.label}</span>
                  </button>
                </Link>
              );
            })}
          </div>

          {/* Right controls (desktop) */}
          <div className="flex items-center gap-2">
            <div className="hidden md:block">
              <ThemeToggle />
            </div>
            {user && (
              <div className="hidden md:flex items-center gap-2">
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  <User className="size-3.5" />
                  {user.name}
                </span>
                <Button variant="ghost" size="icon-sm" onClick={handleLogout} title="Sign out">
                  <LogOut className="size-4" />
                  <span className="sr-only">Sign out</span>
                </Button>
              </div>
            )}
            {/* Mobile: theme toggle in top bar */}
            <div className="md:hidden">
              <ThemeToggle />
            </div>
          </div>
        </div>
      </nav>

      {/* ── Mobile bottom nav (hidden on session detail) ── */}
      <div className={cn(
        'fixed bottom-0 inset-x-0 z-50 md:hidden border-t bg-background/98 backdrop-blur transition-transform duration-300',
        /^\/sessions\/[^/]+/.test(pathname) ? 'translate-y-full' : 'translate-y-0',
      )} style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center h-16 px-2">
          {/* Left 2 items */}
          {bottomNavLeft.map((item) => {
            const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className="flex-1" onClick={() => setMoreOpen(false)}>
                <div className={cn(
                  'flex flex-col items-center justify-center gap-0.5 py-2 rounded-xl transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )}>
                  <item.icon className="size-5" />
                  <span className="text-[10px] font-medium">{item.label}</span>
                </div>
              </Link>
            );
          })}

          {/* Center + button */}
          <div className="flex-1 flex justify-center">
            <button
              onClick={() => { setMoreOpen(false); handleNewSession(); }}
              disabled={isCreating}
              className="size-12 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center shadow-lg active:scale-95 transition-transform disabled:opacity-60"
            >
              {isCreating ? <span className="text-xs animate-pulse">…</span> : <Plus className="size-6" />}
            </button>
          </div>

          {/* Right item: Exercises */}
          <Link href="/exercises" className="flex-1" onClick={() => setMoreOpen(false)}>
            <div className={cn(
              'flex flex-col items-center justify-center gap-0.5 py-2 rounded-xl transition-colors',
              pathname.startsWith('/exercises') ? 'text-primary' : 'text-muted-foreground',
            )}>
              <Dumbbell className="size-5" />
              <span className="text-[10px] font-medium">Exercises</span>
            </div>
          </Link>

          {/* Right item: More */}
          <button
            className="flex-1"
            onClick={() => setMoreOpen(o => !o)}
          >
            <div className={cn(
              'flex flex-col items-center justify-center gap-0.5 py-2 rounded-xl transition-colors',
              moreOpen || moreNavItems.some(i => pathname.startsWith(i.href)) ? 'text-primary' : 'text-muted-foreground',
            )}>
              {moreOpen ? <X className="size-5" /> : <MoreHorizontal className="size-5" />}
              <span className="text-[10px] font-medium">More</span>
            </div>
          </button>
        </div>
      </div>

      {/* ── More drawer (slides up above bottom nav) ── */}
      {moreOpen && (
        <>
          <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMoreOpen(false)} />
          <div className="fixed bottom-16 inset-x-0 z-40 md:hidden animate-in slide-in-from-bottom-2 duration-200">
            <div className="mx-3 mb-2 rounded-2xl border bg-background/98 backdrop-blur shadow-xl overflow-hidden">
              {moreNavItems.map((item) => {
                const isActive = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      'flex items-center gap-3 px-5 py-3.5 transition-colors border-b border-border/30 last:border-0',
                      isActive ? 'text-primary bg-primary/5' : 'text-foreground hover:bg-muted/50',
                    )}
                  >
                    <item.icon className={cn('size-5 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')} />
                    <span className="font-medium text-sm">{item.label}</span>
                  </Link>
                );
              })}
              <div className="flex items-center justify-between px-5 py-3 border-t border-border/50">
                <ThemeToggle />
                {user && (
                  <button
                    onClick={() => { setMoreOpen(false); handleLogout(); }}
                    className="flex items-center gap-2 text-sm text-destructive"
                  >
                    <LogOut className="size-4" />
                    Sign out
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
