'use client';

import { use, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { WorkoutPlan, WorkoutPlanExercise, Exercise } from '@/types';
import {
  ChevronLeft, Plus, Trash2, GripVertical, Dumbbell, Check, X, Pencil,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const muscleColors: Record<string, string> = {
  chest: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  back: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  shoulders: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  biceps: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  triceps: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  legs: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  core: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  cardio: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
};
function muscleColor(group: string) {
  return muscleColors[group?.toLowerCase()] ?? 'bg-muted text-muted-foreground';
}

export default function PlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const [addSessionOpen, setAddSessionOpen] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionName, setEditingSessionName] = useState('');
  const [addExerciseForSession, setAddExerciseForSession] = useState<string | null>(null);
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [editingPeId, setEditingPeId] = useState<string | null>(null);
  const [peEdits, setPeEdits] = useState<{ target_sets: string; target_reps: string; target_weight: string; rest_seconds: string }>({ target_sets: '', target_reps: '', target_weight: '', rest_seconds: '90' });

  const { data: plan, isLoading } = useQuery<WorkoutPlan>({
    queryKey: ['plan', id],
    queryFn: async () => {
      const res = await api.get(`/api/plans/${id}`);
      return res.data;
    },
  });

  const { data: allExercises } = useQuery<Exercise[]>({
    queryKey: ['exercises'],
    queryFn: async () => {
      const res = await api.get('/api/exercises');
      return res.data;
    },
  });

  const addSessionMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await api.post(`/api/plans/${id}/sessions`, {
        name,
        order_index: plan?.plan_sessions.length ?? 0,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan', id] });
      setAddSessionOpen(false);
      setNewSessionName('');
    },
  });

  const renameSessionMutation = useMutation({
    mutationFn: async ({ sid, name }: { sid: string; name: string }) => {
      await api.put(`/api/plans/plan-sessions/${sid}`, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan', id] });
      setEditingSessionId(null);
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: async (sid: string) => {
      await api.delete(`/api/plans/plan-sessions/${sid}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plan', id] }),
  });

  const addExerciseMutation = useMutation({
    mutationFn: async ({ sessionId, exerciseId }: { sessionId: string; exerciseId: string }) => {
      const ps = plan?.plan_sessions.find(s => s.id === sessionId);
      const res = await api.post(`/api/plans/plan-sessions/${sessionId}/exercises`, {
        exercise_id: exerciseId,
        order_index: ps?.exercises.length ?? 0,
        target_sets: 3,
        target_reps: 10,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan', id] });
      setAddExerciseForSession(null);
      setExerciseSearch('');
    },
  });

  const updateExerciseMutation = useMutation({
    mutationFn: async ({ peId, data }: { peId: string; data: { target_sets?: number; target_reps?: number; target_weight?: number | null; rest_seconds?: number } }) => {
      await api.put(`/api/plans/plan-exercises/${peId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan', id] });
      setEditingPeId(null);
    },
  });

  const deleteExerciseMutation = useMutation({
    mutationFn: async (peId: string) => {
      await api.delete(`/api/plans/plan-exercises/${peId}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plan', id] }),
  });

  const startEditPe = (pe: WorkoutPlanExercise) => {
    setEditingPeId(pe.id);
    setPeEdits({
      target_sets: String(pe.target_sets),
      target_reps: String(pe.target_reps),
      target_weight: pe.target_weight != null ? String(pe.target_weight) : '',
      rest_seconds: String(pe.rest_seconds ?? 90),
    });
  };

  const saveEditPe = (peId: string) => {
    const sets = parseInt(peEdits.target_sets);
    const reps = parseInt(peEdits.target_reps);
    const weight = peEdits.target_weight ? parseFloat(peEdits.target_weight) : null;
    const rest = parseInt(peEdits.rest_seconds) || 90;
    if (!sets || !reps) return;
    updateExerciseMutation.mutate({
      peId,
      data: { target_sets: sets, target_reps: reps, target_weight: weight ?? undefined, rest_seconds: rest },
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-14 rounded-xl bg-muted animate-pulse" />
        <div className="h-48 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  if (!plan) return <div className="py-24 text-center text-muted-foreground">Plan not found.</div>;

  return (
    <div className="space-y-5 pb-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => router.back()}>
          <ChevronLeft className="size-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{plan.name}</h1>
          {plan.description && (
            <p className="text-sm text-muted-foreground mt-0.5">{plan.description}</p>
          )}
        </div>
        <Dialog open={addSessionOpen} onOpenChange={setAddSessionOpen}>
          <DialogTrigger render={<Button className="gap-2 shrink-0"><Plus className="size-4" />Add Day</Button>} />
          <DialogContent className="sm:max-w-xs">
            <DialogHeader><DialogTitle>Add Session Day</DialogTitle></DialogHeader>
            <div className="space-y-3 mt-2">
              <Input
                placeholder="e.g. Push Day A, Pull B, Legs"
                value={newSessionName}
                onChange={e => setNewSessionName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && newSessionName.trim() && addSessionMutation.mutate(newSessionName.trim())}
                autoFocus
              />
              <Button
                className="w-full"
                onClick={() => addSessionMutation.mutate(newSessionName.trim())}
                disabled={!newSessionName.trim() || addSessionMutation.isPending}
              >
                {addSessionMutation.isPending ? 'Adding…' : 'Add Day'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {plan.plan_sessions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="size-14 rounded-2xl bg-muted flex items-center justify-center">
            <Dumbbell className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground text-center">
            Add days to this plan (e.g. Push Day, Pull Day, Legs Day)
          </p>
        </div>
      )}

      {/* Session cards */}
      <div className="space-y-4">
        {plan.plan_sessions.map(ps => {
          const addedIds = new Set(ps.exercises.map(e => e.exercise_id));
          const filtered = allExercises?.filter(
            ex => !addedIds.has(ex.id) && ex.name.toLowerCase().includes(exerciseSearch.toLowerCase())
          ) ?? [];

          return (
            <div key={ps.id} className="rounded-xl border border-border bg-card overflow-hidden animate-in fade-in duration-200">
              {/* Session header */}
              <div className="flex items-center gap-2 px-4 py-3 bg-muted/30 border-b border-border/50">
                <GripVertical className="size-4 text-muted-foreground/40 shrink-0" />
                {editingSessionId === ps.id ? (
                  <div className="flex-1 flex items-center gap-2">
                    <Input
                      value={editingSessionName}
                      onChange={e => setEditingSessionName(e.target.value)}
                      className="h-7 text-sm"
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === 'Enter') renameSessionMutation.mutate({ sid: ps.id, name: editingSessionName });
                        if (e.key === 'Escape') setEditingSessionId(null);
                      }}
                    />
                    <button onClick={() => renameSessionMutation.mutate({ sid: ps.id, name: editingSessionName })}
                      className="text-primary hover:text-primary/80">
                      <Check className="size-4" />
                    </button>
                    <button onClick={() => setEditingSessionId(null)} className="text-muted-foreground hover:text-foreground">
                      <X className="size-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="font-semibold text-sm flex-1">{ps.name}</span>
                    <span className="text-xs text-muted-foreground">{ps.exercises.length} exercises</span>
                    <button
                      onClick={() => { setEditingSessionId(ps.id); setEditingSessionName(ps.name); }}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      onClick={() => deleteSessionMutation.mutate(ps.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </>
                )}
              </div>

              {/* Exercises */}
              <div className="divide-y divide-border/30">
                {ps.exercises.map(pe => (
                  <div key={pe.id} className="px-4 py-3">
                    {editingPeId === pe.id ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn('text-xs font-medium px-2 py-0.5 rounded-full shrink-0', muscleColor(pe.exercise.muscle_group))}
                          >
                            {pe.exercise.muscle_group}
                          </span>
                          <span className="font-medium text-sm flex-1">{pe.exercise.name}</span>
                          <button onClick={() => setEditingPeId(null)} className="text-muted-foreground hover:text-foreground">
                            <X className="size-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <Input type="number" value={peEdits.target_sets} onChange={e => setPeEdits(p => ({ ...p, target_sets: e.target.value }))}
                              className="h-8 text-sm pr-8" placeholder="Sets" />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">sets</span>
                          </div>
                          <div className="relative flex-1">
                            <Input type="number" value={peEdits.target_reps} onChange={e => setPeEdits(p => ({ ...p, target_reps: e.target.value }))}
                              className="h-8 text-sm pr-8" placeholder="Reps" />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">reps</span>
                          </div>
                          <div className="relative flex-1">
                            <Input type="number" value={peEdits.target_weight} onChange={e => setPeEdits(p => ({ ...p, target_weight: e.target.value }))}
                              className="h-8 text-sm pr-8" placeholder="Weight" />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">lbs</span>
                          </div>
                          <div className="relative flex-1">
                            <Input type="number" value={peEdits.rest_seconds} onChange={e => setPeEdits(p => ({ ...p, rest_seconds: e.target.value }))}
                              className="h-8 text-sm pr-6" placeholder="90" />
                            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">s</span>
                          </div>
                          <Button size="sm" onClick={() => saveEditPe(pe.id)} disabled={updateExerciseMutation.isPending}>
                            <Check className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full shrink-0', muscleColor(pe.exercise.muscle_group))}>
                          {pe.exercise.muscle_group}
                        </span>
                        <span className="font-medium text-sm flex-1 truncate">{pe.exercise.name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                          {pe.target_sets}×{pe.target_reps}
                          {pe.target_weight ? ` @ ${pe.target_weight} lbs` : ''}
                          {' · '}{pe.rest_seconds ?? 90}s rest
                        </span>
                        <button onClick={() => startEditPe(pe)} className="text-muted-foreground hover:text-primary transition-colors">
                          <Pencil className="size-3.5" />
                        </button>
                        <button onClick={() => deleteExerciseMutation.mutate(pe.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                          <X className="size-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                {/* Add exercise button */}
                <div className="px-4 py-2">
                  <Dialog
                    open={addExerciseForSession === ps.id}
                    onOpenChange={open => {
                      setAddExerciseForSession(open ? ps.id : null);
                      if (!open) setExerciseSearch('');
                    }}
                  >
                    <DialogTrigger
                      render={
                        <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors py-1">
                          <Plus className="size-3.5" />
                          Add exercise
                        </button>
                      }
                    />
                    <DialogContent className="sm:max-w-sm">
                      <DialogHeader><DialogTitle>Add Exercise to {ps.name}</DialogTitle></DialogHeader>
                      <div className="mt-2 space-y-3">
                        <Input
                          placeholder="Search exercises…"
                          value={exerciseSearch}
                          onChange={e => setExerciseSearch(e.target.value)}
                          autoFocus
                        />
                        <div className="max-h-72 overflow-y-auto -mx-1">
                          {filtered.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-6 text-center">
                              {exerciseSearch ? 'No matches' : 'All exercises added'}
                            </p>
                          ) : (
                            filtered.map(ex => (
                              <button
                                key={ex.id}
                                onClick={() => addExerciseMutation.mutate({ sessionId: ps.id, exerciseId: ex.id })}
                                disabled={addExerciseMutation.isPending}
                                className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-muted transition-colors flex items-center justify-between gap-3"
                              >
                                <span className="font-medium text-sm">{ex.name}</span>
                                <span className={cn('text-xs px-2 py-0.5 rounded-full shrink-0', muscleColor(ex.muscle_group))}>
                                  {ex.muscle_group}
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
