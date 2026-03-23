'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import type { MesoCycle } from '@/types';
import { format, addWeeks, differenceInDays, parseISO } from 'date-fns';
import { Plus, Target, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const goals = ['strength', 'hypertrophy', 'endurance'];
const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000000';

const goalColors: Record<string, string> = {
  strength: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  hypertrophy:
    'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  endurance:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
};

function getCycleProgress(cycle: MesoCycle): number {
  try {
    const start = parseISO(cycle.start_date);
    const end = parseISO(cycle.end_date);
    const total = differenceInDays(end, start);
    if (total <= 0) return 100;
    const elapsed = differenceInDays(new Date(), start);
    return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
  } catch {
    return 0;
  }
}

function getDaysRemaining(cycle: MesoCycle): number {
  try {
    return Math.max(0, differenceInDays(parseISO(cycle.end_date), new Date()));
  } catch {
    return 0;
  }
}

function getTotalWeeks(cycle: MesoCycle): number {
  try {
    return Math.round(
      differenceInDays(parseISO(cycle.end_date), parseISO(cycle.start_date)) / 7
    );
  } catch {
    return 0;
  }
}

export default function CyclesPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newCycle, setNewCycle] = useState({
    name: '',
    start_date: format(new Date(), 'yyyy-MM-dd'),
    end_date: format(addWeeks(new Date(), 8), 'yyyy-MM-dd'),
    goal: 'hypertrophy',
  });
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState(DEFAULT_USER_ID);

  useEffect(() => {
    let stored = localStorage.getItem('userId');
    if (!stored || stored === 'default-user') {
      localStorage.setItem('userId', DEFAULT_USER_ID);
      stored = DEFAULT_USER_ID;
    }
    setUserId(stored);
  }, []);

  const { data: cycles, isLoading } = useQuery({
    queryKey: ['cycles', userId],
    queryFn: async () => {
      const res = await api.get(`/api/meso-cycles?user_id=${userId}`);
      return res.data as MesoCycle[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof newCycle) => {
      const res = await api.post(`/api/meso-cycles?user_id=${userId}`, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cycles', userId] });
      setIsDialogOpen(false);
      setNewCycle({
        name: '',
        start_date: format(new Date(), 'yyyy-MM-dd'),
        end_date: format(addWeeks(new Date(), 8), 'yyyy-MM-dd'),
        goal: 'hypertrophy',
      });
    },
    onError: (error: any) => {
      alert(
        'Failed: ' +
          (error.response?.data?.detail?.[0]?.msg || error.message)
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/meso-cycles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cycles', userId] });
    },
  });

  const active = cycles?.filter((c) => c.is_active) ?? [];
  const past = cycles?.filter((c) => !c.is_active) ?? [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Meso Cycles</h1>
          <p className="text-sm text-muted-foreground">
            {cycles?.length ?? 0} total
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger
            render={
              <Button className="gap-2">
                <Plus className="size-4" />
                New Cycle
              </Button>
            }
          />
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create Meso Cycle</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 mt-2">
              <Input
                placeholder="Cycle name (e.g. Spring Hypertrophy Block)"
                value={newCycle.name}
                onChange={(e) =>
                  setNewCycle({ ...newCycle, name: e.target.value })
                }
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1.5 block">
                    Start Date
                  </label>
                  <Input
                    type="date"
                    value={newCycle.start_date}
                    onChange={(e) =>
                      setNewCycle({ ...newCycle, start_date: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1.5 block">
                    End Date
                  </label>
                  <Input
                    type="date"
                    value={newCycle.end_date}
                    onChange={(e) =>
                      setNewCycle({ ...newCycle, end_date: e.target.value })
                    }
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1.5 block">
                  Training Goal
                </label>
                <Select
                  value={newCycle.goal}
                  onValueChange={(v) => v && setNewCycle({ ...newCycle, goal: v })}
                >
                  <SelectTrigger className="w-full h-10">
                    <SelectValue placeholder="Select goal" />
                  </SelectTrigger>
                  <SelectContent>
                    {goals.map((g) => (
                      <SelectItem key={g} value={g} className="capitalize">
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="w-full"
                onClick={() =>
                  newCycle.name && createMutation.mutate(newCycle)
                }
                disabled={createMutation.isPending || !newCycle.name}
              >
                {createMutation.isPending ? 'Creating…' : 'Create Cycle'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-36 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : cycles && cycles.length > 0 ? (
        <div className="space-y-8">
          {active.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                Active
              </h2>
              <div className="space-y-3">
                {active.map((cycle) => (
                  <CycleCard
                    key={cycle.id}
                    cycle={cycle}
                    progress={getCycleProgress(cycle)}
                    daysRemaining={getDaysRemaining(cycle)}
                    totalWeeks={getTotalWeeks(cycle)}
                    onDelete={() => deleteMutation.mutate(cycle.id)}
                  />
                ))}
              </div>
            </section>
          )}
          {past.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                Past Cycles
              </h2>
              <div className="space-y-3">
                {past.map((cycle) => (
                  <CycleCard
                    key={cycle.id}
                    cycle={cycle}
                    progress={getCycleProgress(cycle)}
                    daysRemaining={getDaysRemaining(cycle)}
                    totalWeeks={getTotalWeeks(cycle)}
                    onDelete={() => deleteMutation.mutate(cycle.id)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="size-16 rounded-2xl bg-muted flex items-center justify-center">
            <Target className="size-8 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="font-medium">No cycles yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create a meso cycle to structure your training blocks
            </p>
          </div>
          <Button className="gap-2" onClick={() => setIsDialogOpen(true)}>
            <Plus className="size-4" />
            Create Cycle
          </Button>
        </div>
      )}
    </div>
  );
}

function CycleCard({
  cycle,
  progress,
  daysRemaining,
  totalWeeks,
  onDelete,
}: {
  cycle: MesoCycle;
  progress: number;
  daysRemaining: number;
  totalWeeks: number;
  onDelete: () => void;
}) {
  let dateRange = `${cycle.start_date} – ${cycle.end_date}`;
  try {
    dateRange = `${format(parseISO(cycle.start_date), 'MMM d')} – ${format(
      parseISO(cycle.end_date),
      'MMM d, yyyy'
    )}`;
  } catch {}

  return (
    <Card>
      <CardContent className="pt-4 space-y-4">
        {/* Top row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              {cycle.is_active && (
                <div className="size-2 rounded-full bg-primary shrink-0" />
              )}
              <span className="font-semibold truncate">{cycle.name}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {dateRange} · {totalWeeks}w
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={cn(
                'text-xs font-medium px-2.5 py-1 rounded-full capitalize',
                goalColors[cycle.goal] ?? 'bg-muted text-muted-foreground'
              )}
            >
              {cycle.goal}
            </span>
            <button
              onClick={onDelete}
              className="text-muted-foreground hover:text-destructive transition-colors"
              aria-label="Delete cycle"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <Progress value={progress} />
          <div className="flex justify-between text-xs text-muted-foreground mt-1.5">
            <span>{progress}% complete</span>
            <span>
              {cycle.is_active && daysRemaining > 0
                ? `${daysRemaining}d remaining`
                : progress >= 100
                  ? 'Finished'
                  : 'Not started'}
            </span>
          </div>
        </div>

        {/* Micro cycles */}
        {cycle.micro_cycles && cycle.micro_cycles.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {cycle.micro_cycles.map((mc) => (
              <span
                key={mc.id}
                className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-md"
              >
                W{mc.week_number}: {mc.focus}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
