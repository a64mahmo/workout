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

  useEffect(() => { setMounted(true); }, []); 

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
    <nav className="border-b bg-background/95 backdrop-blur sticky top-0 z-40">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
            <div className="size-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <Dumbbell className="size-3.5 text-primary-foreground" />
            </div>
            <span className="font-bold text-base tracking-tight">Workout</span>
          </Link>

        </div>
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
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all hover:bg-muted hover:cursor-pointer',
                      isActive
                        ? 'text-primary bg-primary/10'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
                    )}
                  >
                    <item.icon
                      className={cn(
                        'size-3.5',
                        isActive ? 'text-primary' : 'text-muted-foreground'
                      )}
                    />
                    {item.label}
                  </button>
                </Link>
              );
            })}
          </div>

        <div className="flex items-center gap-2">
          <div className="hidden md:block">
            <ThemeToggle />
          </div>

          {/* Mobile Menu Button */}
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden hover:cursor-pointer"
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

      {/* Mobile Navigation Menu - Full Screen Overlay */}
      {isMenuOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 md:hidden animate-in fade-in duration-200"
            onClick={() => setIsMenuOpen(false)}
          />

          {/* Menu Panel */}
          <div className="fixed top-0 left-0 h-full w-80 max-w-[85vw] bg-background border-r shadow-xl z-50 md:hidden animate-in slide-in-from-left duration-300">
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b">
                <div className="flex items-center gap-2">
                  <div className="size-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
                    <Dumbbell className="size-3.5 text-primary-foreground" />
                  </div>
                  <span className="font-bold text-base tracking-tight">Workout</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setIsMenuOpen(false)}
                  className="hover:cursor-pointer"
                >
                  <X className="size-4" />
                  <span className="sr-only">Close menu</span>
                </Button>
              </div>

              {/* Navigation Items */}
              <div className="flex-1 px-4 py-6">
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
                            'flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm font-medium transition-all hover:bg-muted hover:cursor-pointer',
                            isActive
                              ? 'text-primary bg-primary/10 border border-primary/20'
                              : 'text-foreground hover:text-foreground'
                          )}
                        >
                          <item.icon
                            className={cn(
                              'size-5',
                              isActive ? 'text-primary' : 'text-muted-foreground'
                            )}
                          />
                          {item.label}
                        </button>
                      </Link>
                    );
                  })}
                </div>
              </div>

              {/* Footer with Theme Toggle */}
              <div className="border-t p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Theme</span>
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
