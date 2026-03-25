'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  Menu,
  X,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/exercises', label: 'Exercises', icon: Dumbbell },
  { href: '/cycles', label: 'Cycles', icon: RefreshCcw },
  { href: '/plans', label: 'Plans', icon: ClipboardList },
  { href: '/sessions', label: 'Sessions', icon: Calendar },
  { href: '/suggestions', label: 'Suggestions', icon: Zap },
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
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <nav
      className={cn(
        'border-b sticky top-0 z-40 backdrop-blur transition-colors',
        isMenuOpen ? 'bg-background/70' : 'bg-background/95'
      )}
    >
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 transition-opacity hover:opacity-80"
        >
          <div className="size-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <Dumbbell className="size-3.5 text-primary-foreground" />
          </div>
          <span className="font-bold text-base tracking-tight">
            Workout
          </span>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-0.5">
          {navItems.map((item) => {
            const isActive =
              item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href);

            return (
              <Link key={item.href} href={item.href}>
                <button
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                    'hover:bg-muted hover:cursor-pointer',
                    isActive
                      ? 'text-primary bg-primary/10'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <item.icon
                    className={cn(
                      'size-3.5',
                      isActive
                        ? 'text-primary'
                        : 'text-muted-foreground'
                    )}
                  />
                  {item.label}
                </button>
              </Link>
            );
          })}
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-2">
          <div className="hidden md:block">
            <ThemeToggle />
          </div>

          {/* Mobile Menu Button */}
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? (
              <X className="size-4" />
            ) : (
              <Menu className="size-4" />
            )}
            <span className="sr-only">Toggle menu</span>
          </Button>
        </div>
      </div>

      {/* MOBILE DROPDOWN MENU */}
      {isMenuOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-30 md:hidden animate-in fade-in duration-200"
            onClick={() => setIsMenuOpen(false)}
          />

          {/* Dropdown Panel */}
          <div
            className="
        absolute top-full left-0 right-0
        md:hidden
        border-b shadow-lg
        bg-background/95 backdrop-blur-xl
        animate-in fade-in duration-600
      "
          >
            <div className="container mx-auto px-4 py-4">
              <div className="flex flex-col gap-2">
                {navItems.map((item) => {
                  const isActive =
                    item.href === '/'
                      ? pathname === '/'
                      : pathname.startsWith(item.href);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setIsMenuOpen(false)}
                    >
                      <button
                        className={cn(
                          'flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm font-medium transition-all',
                          'hover:bg-muted',
                          isActive
                            ? 'text-primary bg-primary/10'
                            : 'text-foreground'
                        )}
                      >
                        <item.icon
                          className={cn(
                            'size-5',
                            isActive
                              ? 'text-primary'
                              : 'text-muted-foreground'
                          )}
                        />
                        {item.label}
                      </button>
                    </Link>
                  );
                })}

                {/* Theme Toggle */}
                <div className="flex items-center justify-between border-t pt-4 mt-2">
                  <span className="text-sm text-muted-foreground">
                    Theme
                  </span>
                  <ThemeToggle />
                </div>
              </div>
            </div>
          </div>
        </>
      )}

    </nav>
  );
}