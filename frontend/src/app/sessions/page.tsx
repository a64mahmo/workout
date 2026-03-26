'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { formatStatus } from '@/lib/utils';
import type { TrainingSession, MesoCycle } from '@/types';
import {
  format, subMonths, addMonths, startOfMonth, endOfMonth,
  parseISO, differenceInDays, isSameMonth, isSameYear,
  subWeeks,
} from 'date-fns';
import {
  Plus, Dumbbell, Flame, ChevronRight, ChevronLeft,
  Heart, Calendar, Activity, Zap, Trash2,
  ArrowDownUp,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sessionVolume(s: TrainingSession): number {
  if (s.total_volume && s.total_volume > 0) return s.total_volume;
  return (
    s.exercises?.reduce(
      (t, se) =>
        t +
        se.sets.reduce(
          (v, set) =>
            v + (set.is_completed ? (set.reps || 0) * (set.weight || 0) : 0),
          0,
        ),
      0,
    ) ?? 0
  );
}

function sessionMuscleGroups(s: TrainingSession): string[] {
  const seen = new Set<string>();
  s.exercises?.forEach((se) => {
    if (se.exercise?.muscle_group) seen.add(se.exercise.muscle_group);
  });
  return Array.from(seen);
}

function fmtVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return `${Math.round(v)}`;
}

const MUSCLE_COLOR: Record<string, string> = {
  chest: '#f43f5e',
  back: '#3b82f6',
  shoulders: '#8b5cf6',
  biceps: '#f97316',
  triceps: '#eab308',
  legs: '#22c55e',
  core: '#14b8a6',
  glutes: '#ec4899',
  hamstrings: '#84cc16',
  cardio: '#06b6d4',
  other: '#6b7280',
};

const MUSCLE_LABEL: Record<string, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  legs: 'Legs',
  core: 'Core',
  glutes: 'Glutes',
  hamstrings: 'Hamstrings',
  cardio: 'Cardio',
};

// ---------------------------------------------------------------------------
// Stats computation
// ---------------------------------------------------------------------------

function useStats(sessions: TrainingSession[] | undefined) {
  return useMemo(() => {
    if (!sessions) return null;
    const completed = sessions.filter((s) => s.status === 'completed');
    const now = new Date();

    const totalVolume = completed.reduce((t, s) => t + sessionVolume(s), 0);

    const thisMonth = completed.filter((s) => {
      try {
        const d = parseISO((s.actual_date || s.scheduled_date) + 'T00:00:00');
        return isSameMonth(d, now) && isSameYear(d, now);
      } catch {
        return false;
      }
    });

    // Streak: consecutive days with at least one completed session going back from today
    let streak = 0;
    const check = new Date(now);
    check.setHours(0, 0, 0, 0);
    for (let i = 0; i < 365; i++) {
      const ds = format(check, 'yyyy-MM-dd');
      const hasSession = completed.some(
        (s) => (s.actual_date || s.scheduled_date) === ds,
      );
      if (!hasSession) break;
      streak++;
      check.setDate(check.getDate() - 1);
    }

    // Avg sessions / week over last 12 weeks
    const twelveWeeksAgo = subWeeks(now, 12);
    const recent = completed.filter((s) => {
      try {
        return parseISO(s.scheduled_date + 'T00:00:00') >= twelveWeeksAgo;
      } catch {
        return false;
      }
    });
    const avgPerWeek = Math.round((recent.length / 12) * 10) / 10;

    // Average HR across sessions that have it
    const hrSessions = completed.filter((s) => s.average_hr);
    const avgHr =
      hrSessions.length > 0
        ? Math.round(
            hrSessions.reduce((t, s) => t + (s.average_hr || 0), 0) /
              hrSessions.length,
          )
        : null;

    return {
      total: completed.length,
      totalVolume,
      thisMonth: thisMonth.length,
      streak,
      avgPerWeek,
      avgHr,
    };
  }, [sessions]);
}

// ---------------------------------------------------------------------------
// Suggestions: muscle groups overdue for training
// ---------------------------------------------------------------------------

function useSuggestions(sessions: TrainingSession[] | undefined) {
  return useMemo(() => {
    if (!sessions) return [];
    const completed = sessions.filter((s) => s.status === 'completed');
    const lastTrained: Record<string, Date> = {};

    completed.forEach((s) => {
      try {
        const d = parseISO(
          (s.actual_date || s.scheduled_date) + 'T00:00:00',
        );
        sessionMuscleGroups(s).forEach((mg) => {
          if (!lastTrained[mg] || d > lastTrained[mg]) {
            lastTrained[mg] = d;
          }
        });
      } catch { }
    });

    const now = new Date();
    const primary = ['chest', 'back', 'shoulders', 'legs', 'biceps', 'triceps', 'core'];

    return primary
      .map((mg) => ({
        muscle_group: mg,
        days: lastTrained[mg]
          ? differenceInDays(now, lastTrained[mg])
          : 999,
        lastDate: lastTrained[mg] ?? null,
      }))
      .filter((s) => s.days >= 3)
      .sort((a, b) => b.days - a.days)
      .slice(0, 6);
  }, [sessions]);
}

// ---------------------------------------------------------------------------
// Session card
// ---------------------------------------------------------------------------

function SessionCard({
  session,
  onView,
  onDelete,
}: {
  session: TrainingSession;
  onView: () => void;
  onDelete: () => void;
}) {
  const vol = useMemo(() => sessionVolume(session), [session]);
  const muscleGroups = useMemo(() => sessionMuscleGroups(session), [session]);
  const exerciseCount = session.exercises?.length ?? 0;

  const { dayNum, monthStr, yearStr } = useMemo(() => {
    try {
      const d = parseISO(
        (session.actual_date || session.scheduled_date) + 'T00:00:00',
      );
      return {
        dayNum: format(d, 'd'),
        monthStr: format(d, 'MMM'),
        yearStr: format(d, 'yyyy'),
      };
    } catch {
      return { dayNum: '--', monthStr: '---', yearStr: '----' };
    }
  }, [session.actual_date, session.scheduled_date]);

  return (
    <div className="group relative flex items-center gap-1 rounded-xl border border-border bg-card hover:bg-muted/30 transition-colors">
      {/* Colored left stripe by status */}
      <div
        className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-xl"
        style={{
          background:
            session.status === 'completed'
              ? 'hsl(var(--primary))'
              : session.status === 'in_progress'
              ? '#f97316'
              : session.status === 'cancelled'
              ? '#6b7280'
              : '#3b82f6',
        }}
      />

      <button
        onClick={onView}
        className="flex items-center gap-4 flex-1 pl-5 pr-3 py-3.5 text-left min-w-0"
      >
        {/* Date block */}
        <div className="text-center w-10 shrink-0">
          <div className="text-xl font-bold leading-none tabular-nums">{dayNum}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">
            {monthStr}
          </div>
          <div className="text-[10px] text-muted-foreground/60 tabular-nums mt-0.5">
            {yearStr}
          </div>
        </div>

        <div className="w-px h-9 bg-border shrink-0" />

        {/* Info */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="font-semibold text-sm truncate">{session.name}</div>

          {/* Sub-row: counts + muscle dots + HR */}
          <div className="flex items-center gap-3 flex-wrap">
            {exerciseCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {exerciseCount} exercise{exerciseCount !== 1 ? 's' : ''}
              </span>
            )}
            {vol > 0 && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Flame className="size-3 text-orange-400" />
                {fmtVol(vol)} lbs
              </span>
            )}
            {session.average_hr && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Heart className="size-3 text-rose-400" />
                {session.average_hr} bpm
              </span>
            )}
            {/* Muscle group dots */}
            {muscleGroups.length > 0 && (
              <div className="flex items-center gap-1">
                {muscleGroups.slice(0, 5).map((mg) => (
                  <span
                    key={mg}
                    title={MUSCLE_LABEL[mg] ?? mg}
                    className="size-2 rounded-full shrink-0"
                    style={{ background: MUSCLE_COLOR[mg] ?? MUSCLE_COLOR.other }}
                  />
                ))}
                {muscleGroups.length > 5 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{muscleGroups.length - 5}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Status + chevron */}
        <div className="flex items-center gap-2 shrink-0">
          <Badge
            variant={
              session.status === 'completed'
                ? 'default'
                : session.status === 'in_progress'
                ? 'outline'
                : 'secondary'
            }
            className="text-xs"
          >
            {formatStatus(session.status)}
          </Badge>
          <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>
      </button>

      {/* Delete button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="pr-3 py-3.5 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
        aria-label="Delete session"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type SortOrder = 'desc' | 'asc';
type StatusFilter = 'all' | 'completed' | 'cancelled' | 'scheduled' | 'in_progress';

export default function SessionsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  // New session dialog
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newSession, setNewSession] = useState({
    name: '',
    meso_cycle_id: '',
    scheduled_date: format(new Date(), 'yyyy-MM-dd'),
    notes: '',
  });

  // Month navigation for completed sessions
  const [viewMonth, setViewMonth] = useState<Date>(new Date());

  // History sort + filter
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------
  const { data: sessions, isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const res = await api.get('/api/sessions');
      return res.data as TrainingSession[];
    },
  });

  const { data: cycles } = useQuery({
    queryKey: ['cycles'],
    queryFn: async () => {
      const res = await api.get('/api/meso-cycles');
      return res.data as MesoCycle[];
    },
  });

  const { data: fitbitToday } = useQuery({
    queryKey: ['fitbit-today'],
    queryFn: async () => {
      const res = await api.get('/api/fitbit/today-stats');
      return res.data as {
        connected: boolean;
        steps?: number;
        resting_hr?: number;
        weight_kg?: number;
        sleep_duration_seconds?: number;
      };
    },
    retry: false,
  });

  // Auto-select single cycle
  useEffect(() => {
    if (cycles?.length === 1 && !newSession.meso_cycle_id) {
      setNewSession((p) => ({ ...p, meso_cycle_id: cycles[0].id }));
    }
  }, [cycles]);

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------
  const createMutation = useMutation({
    mutationFn: async (data: typeof newSession) => {
      const res = await api.post('/api/sessions', data);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setIsDialogOpen(false);
      setNewSession({
        name: '',
        meso_cycle_id: cycles?.length === 1 ? cycles[0].id : '',
        scheduled_date: format(new Date(), 'yyyy-MM-dd'),
        notes: '',
      });
      router.push(`/sessions/${data.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/sessions/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });

  // -------------------------------------------------------------------------
  // Derived data
  // -------------------------------------------------------------------------
  const stats = useStats(sessions);
  const suggestions = useSuggestions(sessions);

  const upcoming = useMemo(
    () =>
      sessions?.filter(
        (s) => s.status === 'scheduled' || s.status === 'in_progress',
      ) ?? [],
    [sessions],
  );

  // History: filter by month + status, then sort
  const historyInMonth = useMemo(() => {
    const filtered = sessions?.filter((s) => {
      // Always filter by viewMonth
      const dateStr = s.actual_date || s.scheduled_date;
      try {
        const d = parseISO(dateStr + 'T00:00:00');
        if (!isSameMonth(d, viewMonth) || !isSameYear(d, viewMonth)) return false;
      } catch {
        return false;
      }
      // Status filter
      if (statusFilter === 'all') {
        return s.status === 'completed' || s.status === 'cancelled';
      }
      return s.status === statusFilter;
    }) ?? [];

    return [...filtered].sort((a, b) => {
      const da = (a.actual_date || a.scheduled_date) ?? '';
      const db = (b.actual_date || b.scheduled_date) ?? '';
      return sortOrder === 'desc' ? db.localeCompare(da) : da.localeCompare(db);
    });
  }, [sessions, viewMonth, statusFilter, sortOrder]);

  const hasHistory = sessions?.some(
    (s) => s.status === 'completed' || s.status === 'cancelled',
  );

  const canCreate =
    !!newSession.name && !!newSession.meso_cycle_id && !!newSession.scheduled_date;

  const startSession = useCallback(
    (muscleGroup: string) => {
      const names: Record<string, string> = {
        chest: 'Chest Day',
        back: 'Back Day',
        shoulders: 'Shoulder Day',
        legs: 'Leg Day',
        biceps: 'Arms Day',
        triceps: 'Arms Day',
        core: 'Core Session',
      };
      setNewSession((p) => ({
        ...p,
        name: names[muscleGroup] ?? `${MUSCLE_LABEL[muscleGroup] ?? muscleGroup} Session`,
        scheduled_date: format(new Date(), 'yyyy-MM-dd'),
      }));
      setIsDialogOpen(true);
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-6 pb-8">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sessions</h1>
          {stats && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {upcoming.length} upcoming · {stats.total} completed
            </p>
          )}
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger
            render={
              <Button className="gap-2">
                <Plus className="size-4" />
                New Session
              </Button>
            }
          />
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create Session</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 mt-2">
              <Input
                placeholder="Session name"
                value={newSession.name}
                onChange={(e) => setNewSession({ ...newSession, name: e.target.value })}
                autoFocus
              />
              <Select
                value={newSession.meso_cycle_id}
                onValueChange={(v) =>
                  v && setNewSession({ ...newSession, meso_cycle_id: v })
                }
                items={cycles?.map((c) => ({ value: c.id, label: c.name }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select meso cycle" />
                </SelectTrigger>
                <SelectContent>
                  {cycles?.map((c) => (
                    <SelectItem key={c.id} value={c.id} label={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={newSession.scheduled_date}
                onChange={(e) =>
                  setNewSession({ ...newSession, scheduled_date: e.target.value })
                }
              />
              <Input
                placeholder="Notes (optional)"
                value={newSession.notes}
                onChange={(e) => setNewSession({ ...newSession, notes: e.target.value })}
              />
              <Button
                className="w-full"
                disabled={!canCreate || createMutation.isPending}
                onClick={() => canCreate && createMutation.mutate(newSession)}
              >
                {createMutation.isPending ? 'Creating…' : 'Create & Open →'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[80, 80, 300].map((h, i) => (
            <div
              key={i}
              className="rounded-xl bg-muted animate-pulse"
              style={{ height: h }}
            />
          ))}
        </div>
      ) : (
        <>
          {/* ── Stats strip ── */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard
                icon={<Dumbbell className="size-4" />}
                label="Total sessions"
                value={stats.total.toLocaleString()}
                color="blue"
              />
              <StatCard
                icon={<Flame className="size-4" />}
                label="Total volume"
                value={`${fmtVol(stats.totalVolume)} lbs`}
                color="orange"
              />
              <StatCard
                icon={<Calendar className="size-4" />}
                label="This month"
                value={`${stats.thisMonth} sessions`}
                sub={`${stats.avgPerWeek}/wk avg`}
                color="purple"
              />
              <StatCard
                icon={
                  fitbitToday?.connected && fitbitToday.resting_hr ? (
                    <Heart className="size-4" />
                  ) : (
                    <Zap className="size-4" />
                  )
                }
                label={
                  fitbitToday?.connected && fitbitToday.resting_hr
                    ? 'Resting HR'
                    : 'Streak'
                }
                value={
                  fitbitToday?.connected && fitbitToday.resting_hr
                    ? `${fitbitToday.resting_hr} bpm`
                    : stats.streak > 0
                    ? `${stats.streak} day${stats.streak !== 1 ? 's' : ''}`
                    : '–'
                }
                sub={
                  fitbitToday?.connected && fitbitToday.steps
                    ? `${fitbitToday.steps.toLocaleString()} steps today`
                    : stats.streak > 0
                    ? 'active streak 🔥'
                    : 'Train today to start'
                }
                color="green"
              />
            </div>
          )}

          {/* ── Muscle group suggestions ── */}
          {suggestions.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                <Activity className="size-3.5" />
                Due for training
              </h2>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {suggestions.map((s) => (
                  <button
                    key={s.muscle_group}
                    onClick={() => startSession(s.muscle_group)}
                    className="flex items-center gap-2 shrink-0 rounded-xl border border-border bg-card hover:bg-muted/50 transition-colors px-3 py-2.5"
                  >
                    <span
                      className="size-2.5 rounded-full"
                      style={{
                        background:
                          MUSCLE_COLOR[s.muscle_group] ?? MUSCLE_COLOR.other,
                      }}
                    />
                    <span className="text-sm font-medium">
                      {MUSCLE_LABEL[s.muscle_group] ?? s.muscle_group}
                    </span>
                    <span
                      className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                        s.days >= 7
                          ? 'bg-destructive/15 text-destructive'
                          : s.days >= 5
                          ? 'bg-orange-500/15 text-orange-500'
                          : 'bg-yellow-500/15 text-yellow-600'
                      }`}
                    >
                      {s.days === 999 ? 'never' : `${s.days}d`}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Tap a muscle group to pre-fill a new session
              </p>
            </div>
          )}

          {/* ── Upcoming sessions ── */}
          {upcoming.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                Upcoming
              </h2>
              <div className="space-y-2">
                {upcoming.map((s) => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    onView={() => router.push(`/sessions/${s.id}`)}
                    onDelete={() => deleteMutation.mutate(s.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── History ── */}
          {hasHistory && (
            <section className="space-y-3">
              {/* Month nav + filters */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                  History
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Status filter */}
                  <Select
                    value={statusFilter}
                    onValueChange={(v) => setStatusFilter((v ?? 'all') as StatusFilter)}
                    items={[
                      { value: 'all', label: 'All' },
                      { value: 'completed', label: 'Completed' },
                      { value: 'cancelled', label: 'Cancelled' },
                    ]}
                  >
                    <SelectTrigger className="h-7 w-28 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" label="All">All</SelectItem>
                      <SelectItem value="completed" label="Completed">Completed</SelectItem>
                      <SelectItem value="cancelled" label="Cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Sort order */}
                  <button
                    onClick={() => setSortOrder((o) => o === 'desc' ? 'asc' : 'desc')}
                    className="flex items-center gap-1 h-7 px-2 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title={sortOrder === 'desc' ? 'Newest first' : 'Oldest first'}
                  >
                    <ArrowDownUp className="size-3" />
                    {sortOrder === 'desc' ? 'Newest' : 'Oldest'}
                  </button>

                  {/* Month navigator */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setViewMonth((m) => subMonths(m, 1))}
                      className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                    <span className="text-xs font-medium min-w-[72px] text-center">
                      {format(viewMonth, 'MMM yyyy')}
                    </span>
                    <button
                      onClick={() => setViewMonth((m) => addMonths(m, 1))}
                      disabled={
                        isSameMonth(viewMonth, new Date()) &&
                        isSameYear(viewMonth, new Date())
                      }
                      className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  </div>
                </div>
              </div>

              {historyInMonth.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border py-10 flex flex-col items-center gap-2 text-muted-foreground">
                  <Calendar className="size-6" />
                  <p className="text-sm">No sessions in {format(viewMonth, 'MMMM yyyy')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {historyInMonth.length} session{historyInMonth.length !== 1 ? 's' : ''} ·{' '}
                    {fmtVol(
                      historyInMonth.reduce((t, s) => t + sessionVolume(s), 0),
                    )}{' '}
                    lbs total
                  </p>
                  {historyInMonth.map((s) => (
                    <SessionCard
                      key={s.id}
                      session={s}
                      onView={() => router.push(`/sessions/${s.id}`)}
                      onDelete={() => deleteMutation.mutate(s.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Empty state */}
          {(!sessions || sessions.length === 0) && (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <div className="size-16 rounded-2xl bg-muted flex items-center justify-center">
                <Dumbbell className="size-8 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="font-semibold">No sessions yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Create your first session to start tracking
                </p>
              </div>
              <Button className="gap-2" onClick={() => setIsDialogOpen(true)}>
                <Plus className="size-4" />
                Create Session
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({
  icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  color: 'blue' | 'orange' | 'purple' | 'green';
}) {
  const colorMap = {
    blue: 'bg-blue-500/10 text-blue-500',
    orange: 'bg-orange-500/10 text-orange-500',
    purple: 'bg-purple-500/10 text-purple-500',
    green: 'bg-green-500/10 text-green-500',
  };
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
      <div className={`size-8 rounded-lg flex items-center justify-center ${colorMap[color]}`}>
        {icon}
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold leading-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}
