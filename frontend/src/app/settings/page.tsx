'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import type { User } from '@/types';
import {
  Activity, Link2, Link2Off, Heart, Moon, Weight, Loader2,
  User as UserIcon, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Pref keys (localStorage) ────────────────────────────────────────────────
export const PREF_REST_TIMER = 'pref-rest-timer';   // seconds as string
export const PREF_WEIGHT_UNIT = 'pref-weight-unit'; // "lbs" | "kg"

// ── Theme definitions ────────────────────────────────────────────────────────
// bg = page background  card = card surface  accent = primary action colour

const THEMES = [
  // Row 1: background variants (all keep orange accent)
  { id: 'light',    label: 'Light',    bg: '#ffffff', card: '#f0f0f0', accent: '#ea580c' },
  { id: 'dark',     label: 'Dark',     bg: '#242424', card: '#333333', accent: '#f97316' },
  { id: 'oled',     label: 'OLED',     bg: '#000000', card: '#111111', accent: '#f97316' },
  { id: 'midnight', label: 'Midnight', bg: '#141b25', card: '#1c2535', accent: '#f97316' },
  { id: 'system',   label: 'System',   bg: 'linear-gradient(135deg,#ffffff 50%,#242424 50%)', card: '#888888', accent: '#f97316' },
  // Row 2: colour accent variants (all use dark base)
  { id: 'cobalt',   label: 'Cobalt',   bg: '#242424', card: '#333333', accent: '#3b82f6' },
  { id: 'forest',   label: 'Forest',   bg: '#242424', card: '#333333', accent: '#22c55e' },
  { id: 'violet',   label: 'Violet',   bg: '#242424', card: '#333333', accent: '#a855f7' },
  { id: 'rose',     label: 'Rose',     bg: '#242424', card: '#333333', accent: '#f43f5e' },
] as const;

type ThemeId = typeof THEMES[number]['id'];

const REST_OPTIONS = [
  { label: '30s', value: 30 },
  { label: '60s', value: 60 },
  { label: '90s', value: 90 },
  { label: '2 min', value: 120 },
  { label: '3 min', value: 180 },
  { label: '5 min', value: 300 },
];

const WEIGHT_UNITS = [
  { label: 'lbs', value: 'lbs' as const },
  { label: 'kg', value: 'kg' as const },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function usePref<T extends string>(key: string, defaultValue: T) {
  const [value, setValue] = useState<T>(defaultValue);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem(key) as T | null;
    if (stored) setValue(stored);
  }, [key]);

  const set = (v: T) => {
    setValue(v);
    localStorage.setItem(key, v);
  };

  return [mounted ? value : defaultValue, set] as const;
}

// ── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, description, children }: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-base">{title}</h2>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="border-t border-border pt-4">
        {children}
      </div>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [connecting, setConnecting] = useState(false);
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [themesMounted, setThemesMounted] = useState(false);

  const [restTimer, setRestTimer] = usePref<string>(PREF_REST_TIMER, '90');
  const [weightUnit, setWeightUnit] = usePref<string>(PREF_WEIGHT_UNIT, 'lbs');

  useEffect(() => setThemesMounted(true), []);

  const { data: user, isLoading } = useQuery<User>({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await api.get('/api/auth/me');
      return res.data;
    },
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await api.get('/api/fitbit/auth-url');
      return res.data.url as string;
    },
    onSuccess: (url) => {
      setConnecting(true);
      window.location.href = url;
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      await api.post('/api/fitbit/disconnect');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const isConnected = user?.has_fitbit_connected;
  const activeTheme = (themesMounted ? theme : 'dark') as ThemeId;

  return (
    <div className="max-w-2xl mx-auto space-y-5 pb-8">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your account, appearance, and training defaults
        </p>
      </div>

      {/* ── Account ── */}
      <Section title="Account">
        <div className="flex items-center gap-4">
          <div className="size-12 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
            {user?.name ? (
              <span className="text-lg font-bold text-primary">
                {user.name.charAt(0).toUpperCase()}
              </span>
            ) : (
              <UserIcon className="size-5 text-primary" />
            )}
          </div>
          <div className="min-w-0">
            <p className="font-semibold truncate">{user?.name ?? '—'}</p>
            <p className="text-sm text-muted-foreground truncate">{user?.email ?? '—'}</p>
          </div>
        </div>
      </Section>

      {/* ── Appearance ── */}
      <Section
        title="Appearance"
        description="Choose a background style or swap the accent colour."
      >
        {/* Row 1 label */}
        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide mb-2">
          Background
        </p>
        <div className="grid grid-cols-5 gap-2 mb-4">
          {THEMES.slice(0, 5).map((t) => {
            const isActive = activeTheme === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-xl p-2 border-2 transition-all cursor-pointer',
                  isActive
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground/40'
                )}
              >
                <div
                  className="w-full h-9 rounded-lg overflow-hidden relative"
                  style={{ background: t.bg }}
                >
                  <div
                    className="absolute bottom-1 left-1 right-1 h-3.5 rounded-md"
                    style={{ background: t.card }}
                  />
                  <div
                    className="absolute top-1 right-1 size-2 rounded-full"
                    style={{ background: t.accent }}
                  />
                </div>
                <span className="text-[10px] font-medium text-center leading-none">
                  {t.label}
                </span>
                {isActive && <Check className="size-3 text-primary" />}
              </button>
            );
          })}
        </div>

        {/* Row 2 label */}
        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide mb-2">
          Accent colour
        </p>
        <div className="grid grid-cols-4 gap-2">
          {THEMES.slice(5).map((t) => {
            const isActive = activeTheme === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-xl p-2 border-2 transition-all cursor-pointer',
                  isActive
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground/40'
                )}
              >
                <div
                  className="w-full h-9 rounded-lg overflow-hidden relative"
                  style={{ background: t.bg }}
                >
                  <div
                    className="absolute bottom-1 left-1 right-1 h-3.5 rounded-md"
                    style={{ background: t.card }}
                  />
                  {/* Accent bar instead of dot — more prominent */}
                  <div
                    className="absolute bottom-0 left-0 right-0 h-1.5 rounded-b-lg"
                    style={{ background: t.accent }}
                  />
                </div>
                <span className="text-[10px] font-medium text-center leading-none">
                  {t.label}
                </span>
                {isActive && <Check className="size-3 text-primary" />}
              </button>
            );
          })}
        </div>

        <p className="text-[11px] text-muted-foreground mt-3">
          Current: <span className="font-medium capitalize">{activeTheme}</span>
          {activeTheme === 'system' ? ` (${resolvedTheme})` : ''}
        </p>
      </Section>

      {/* ── Training Defaults ── */}
      <Section
        title="Training Defaults"
        description="Default values used when starting a new session."
      >
        <div className="space-y-5">
          {/* Default rest timer */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Default rest timer</p>
            <div className="flex flex-wrap gap-2">
              {REST_OPTIONS.map((opt) => {
                const active = restTimer === String(opt.value);
                return (
                  <button
                    key={opt.value}
                    onClick={() => setRestTimer(String(opt.value))}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors cursor-pointer',
                      active
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border hover:border-muted-foreground/40 text-muted-foreground'
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Applied when an exercise has no plan-specific rest time.
            </p>
          </div>

          {/* Weight unit */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Weight unit</p>
            <div className="flex gap-2">
              {WEIGHT_UNITS.map((opt) => {
                const active = weightUnit === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setWeightUnit(opt.value)}
                    className={cn(
                      'px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors cursor-pointer',
                      active
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border hover:border-muted-foreground/40 text-muted-foreground'
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Sets the unit label on weight inputs. Data is stored as-entered.
            </p>
          </div>
        </div>
      </Section>

      {/* ── Fitbit ── */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
            <Activity className="size-5 text-green-600 dark:text-green-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-base">Fitbit Integration</h2>
            <p className="text-xs text-muted-foreground">
              Sync heart rate, sleep, and weight data
            </p>
          </div>
          {isConnected !== undefined && (
            <Badge variant={isConnected ? 'default' : 'secondary'}>
              {isConnected ? 'Connected' : 'Not connected'}
            </Badge>
          )}
        </div>

        <div className="border-t border-border pt-3">
          <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
            <div className="flex items-center gap-2">
              <Heart className="size-4 text-red-500" />
              <span>Heart Rate</span>
            </div>
            <div className="flex items-center gap-2">
              <Moon className="size-4 text-indigo-500" />
              <span>Sleep</span>
            </div>
            <div className="flex items-center gap-2">
              <Weight className="size-4 text-amber-500" />
              <span>Weight</span>
            </div>
          </div>

          {isLoading ? (
            <div className="h-10 rounded-lg bg-muted animate-pulse" />
          ) : isConnected ? (
            <div className="space-y-3">
              <Button
                variant="outline"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
                className="gap-2 w-full justify-center cursor-pointer"
              >
                {disconnectMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Link2Off className="size-4" />
                )}
                Disconnect Fitbit
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Heart rate, sleep, and weight will sync when you use Sync on a completed session.
              </p>
            </div>
          ) : (
            <Button
              onClick={() => connectMutation.mutate()}
              disabled={connectMutation.isPending || connecting}
              className="gap-2 w-full justify-center cursor-pointer"
            >
              {connectMutation.isPending || connecting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Link2 className="size-4" />
              )}
              Connect Fitbit
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
