'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { WorkoutPlan, MesoCycle } from '@/types';
import { ClipboardList, Plus, Trash2, ChevronRight } from 'lucide-react';

export default function PlansPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [mesoId, setMesoId] = useState('');

  const { data: plans, isLoading } = useQuery<WorkoutPlan[]>({
    queryKey: ['plans'],
    queryFn: async () => {
      const res = await api.get('/api/plans');
      return res.data;
    },
  });

  const { data: cycles } = useQuery<MesoCycle[]>({
    queryKey: ['cycles'],
    queryFn: async () => {
      const res = await api.get('/api/meso-cycles');
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/api/plans', {
        name,
        description: description || undefined,
        meso_cycle_id: mesoId || undefined,
      });
      return res.data as WorkoutPlan;
    },
    onSuccess: (plan) => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      setCreateOpen(false);
      setName('');
      setDescription('');
      setMesoId('');
      router.push(`/plans/${plan.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/plans/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plans'] }),
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Workout Plans</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Templates that pre-fill sessions with exercises and target weights
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger
            render={
              <Button className="gap-2">
                <Plus className="size-4" />
                New Plan
              </Button>
            }
          />
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Create Workout Plan</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 mt-2">
              <Input
                placeholder="Plan name (e.g. Push/Pull/Legs)"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
              />
              <Input
                placeholder="Description (optional)"
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
              <select
                value={mesoId}
                onChange={e => setMesoId(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">No meso cycle (standalone)</option>
                {cycles?.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => { setCreateOpen(false); setName(''); setDescription(''); setMesoId(''); }}
                  disabled={createMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => createMutation.mutate()}
                  disabled={!name.trim() || createMutation.isPending}
                >
                  {createMutation.isPending ? 'Creating…' : 'Create'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {plans?.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="size-16 rounded-2xl bg-muted flex items-center justify-center">
            <ClipboardList className="size-8 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="font-semibold">No workout plans yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create a plan to quickly pre-fill sessions with exercises and targets
            </p>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {plans?.map(plan => {
          const cycle = cycles?.find(c => c.id === plan.meso_cycle_id);
          const sessionCount = plan.plan_sessions.length;
          const exerciseCount = plan.plan_sessions.reduce((t, s) => t + s.exercises.length, 0);
          return (
            <div
              key={plan.id}
              className="rounded-xl border border-border bg-card hover:bg-muted/30 transition-colors cursor-pointer"
              onClick={() => router.push(`/plans/${plan.id}`)}
            >
              <div className="flex items-center gap-4 p-4">
                <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <ClipboardList className="size-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{plan.name}</span>
                    {cycle && (
                      <Badge variant="secondary" className="text-xs">{cycle.name}</Badge>
                    )}
                  </div>
                  {plan.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{plan.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {sessionCount} session{sessionCount !== 1 ? 's' : ''} · {exerciseCount} exercise{exerciseCount !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={e => { e.stopPropagation(); deleteMutation.mutate(plan.id); }}
                    className="text-muted-foreground hover:text-destructive transition-colors p-1"
                  >
                    <Trash2 className="size-4" />
                  </button>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
