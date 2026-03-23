'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import type { MesoCycle, TrainingSession } from '@/types';
import { useEffect, useState, useMemo } from 'react';
import { differenceInDays, subDays, parseISO, format } from 'date-fns';
import { Dumbbell, Flame, Calendar, ChevronRight, Plus, Target } from 'lucide-react';

const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000000';

const goalColors: Record<string, string> = {
  strength: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  hypertrophy: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  endurance: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
};

export default function Dashboard() {
  const [userId, setUserId] = useState(DEFAULT_USER_ID);
  const router = useRouter();

  useEffect(() => {
    let stored = localStorage.getItem('userId');
    if (!stored || stored === 'default-user') {
      localStorage.setItem('userId', DEFAULT_USER_ID);
      stored = DEFAULT_USER_ID;
    }
    setUserId(stored);
  }, []);

  const { data: cycles } = useQuery({
    queryKey: ['cycles', userId],
    queryFn: async () => {
      const res = await api.get(`/api/meso-cycles?user_id=${userId}`);
      return res.data as MesoCycle[];
    },
  });

  const { data: sessions } = useQuery({
    queryKey: ['sessions', userId],
    queryFn: async () => {
      const res = await api.get(`/api/sessions?user_id=${userId}`);
      return res.data as TrainingSession[];
    },
  });

  const activeCycle = cycles?.find((c) => c.is_active);

  const cycleProgress = useMemo(() => {
    if (!activeCycle) return 0;
    const start = parseISO(activeCycle.start_date);
    const end = parseISO(activeCycle.end_date);
    const total = differenceInDays(end, start);
    if (total <= 0) return 100;
    const elapsed = differenceInDays(new Date(), start);
    return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
  }, [activeCycle]);

  const daysRemaining = useMemo(() => {
    if (!activeCycle) return 0;
    return Math.max(0, differenceInDays(parseISO(activeCycle.end_date), new Date()));
  }, [activeCycle]);

  const weeklyStats = useMemo(() => {
    const weekAgo = subDays(new Date(), 7);
    const thisWeek =
      sessions?.filter((s) => {
        try {
          const d = parseISO(s.actual_date ?? s.scheduled_date);
          return d >= weekAgo && s.status === 'completed';
        } catch {
          return false;
        }
      }) ?? [];
    const volume = thisWeek.reduce(
      (t, s) =>
        t +
        (s.exercises?.reduce(
          (et, se) =>
            et + se.sets.reduce((st, set) => st + set.reps * set.weight, 0),
          0
        ) ??
          s.total_volume ??
          0),
      0
    );
    return { count: thisWeek.length, volume };
  }, [sessions]);

  const recentSessions = sessions?.slice(0, 5) ?? [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {format(new Date(), 'EEEE, MMMM d')}
          </p>
        </div>
        <Button onClick={() => router.push('/sessions')} className="gap-2">
          <Plus className="size-4" />
          New Session
        </Button>
      </div>

      {/* Active Cycle */}
      {activeCycle ? (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1 flex items-center gap-1.5">
                  <div className="size-1.5 rounded-full bg-primary animate-pulse" />
                  Active Cycle
                </div>
                <h2 className="text-xl font-bold">{activeCycle.name}</h2>
              </div>
              <span
                className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${
                  goalColors[activeCycle.goal] ?? 'bg-muted text-muted-foreground'
                }`}
              >
                {activeCycle.goal}
              </span>
            </div>
            <Progress value={cycleProgress} />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{cycleProgress}% complete</span>
              <span>{daysRemaining > 0 ? `${daysRemaining} days remaining` : 'Cycle ended'}</span>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 flex flex-col items-center gap-3">
            <Target className="size-8 text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium">No active training cycle</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Create a meso cycle to organize your training
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => router.push('/cycles')}>
              Create a Cycle →
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="size-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                This Week
              </span>
            </div>
            <div className="text-3xl font-bold tabular-nums">{weeklyStats.count}</div>
            <div className="text-xs text-muted-foreground mt-0.5">sessions completed</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <Flame className="size-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                Weekly Volume
              </span>
            </div>
            <div className="text-3xl font-bold tabular-nums">
              {weeklyStats.volume > 0
                ? `${(weeklyStats.volume / 1000).toFixed(1)}k`
                : '—'}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">lbs lifted</div>
          </CardContent>
        </Card>
      </div>

      {/* Recent sessions */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-semibold">Recent Sessions</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/sessions')}
          >
            View all →
          </Button>
        </div>
        {recentSessions.length > 0 ? (
          <div className="space-y-2">
            {recentSessions.map((session) => {
              const vol = session.exercises?.reduce(
                (t, se) =>
                  t + se.sets.reduce((s, set) => s + set.reps * set.weight, 0),
                0
              ) ?? 0;
              return (
                <button
                  key={session.id}
                  onClick={() => router.push(`/sessions/${session.id}`)}
                  className="w-full text-left rounded-xl border bg-card px-4 py-3 hover:bg-muted/50 transition-colors group flex items-center gap-3"
                >
                  <Dumbbell className="size-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{session.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {session.scheduled_date}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {vol > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {vol.toLocaleString()} lbs
                      </span>
                    )}
                    <Badge
                      variant={
                        session.status === 'completed' ? 'default' : 'secondary'
                      }
                    >
                      {session.status}
                    </Badge>
                    <ChevronRight className="size-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border bg-card px-4 py-10 text-center space-y-2">
            <Dumbbell className="size-8 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">No sessions yet.</p>
            <button
              className="text-sm text-primary underline"
              onClick={() => router.push('/sessions')}
            >
              Create your first session →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
