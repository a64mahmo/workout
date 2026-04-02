'use client';

import { use, useState, useEffect, useMemo } from 'react';
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
import type { WorkoutPlan, Exercise } from '@/types';
import { ChevronLeft, Plus, Trash2, GripVertical, Dumbbell, X, Pencil } from 'lucide-react';
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

// ── Draft types ───────────────────────────────────────────────────────────────
interface DraftExercise {
  tempId: string;       // real pe.id for existing, 'new_...' for new
  isNew: boolean;
  exercise_id: string;
  exercise: Exercise;
  target_sets: number;
  target_reps: number;
  target_weight: number | null;
  rest_seconds: number;
  order_index: number;
}

interface DraftSession {
  tempId: string;       // real ps.id for existing, 'new_...' for new
  isNew: boolean;
  name: string;
  week_number: number;
  order_index: number;
  exercises: DraftExercise[];
}

function planToDraft(plan: WorkoutPlan): DraftSession[] {
  return plan.plan_sessions.map(ps => ({
    tempId: ps.id,
    isNew: false,
    name: ps.name,
    week_number: ps.week_number ?? 1,
    order_index: ps.order_index,
    exercises: ps.exercises.map(pe => ({
      tempId: pe.id,
      isNew: false,
      exercise_id: pe.exercise_id,
      exercise: pe.exercise,
      target_sets: pe.target_sets ?? 3,
      target_reps: pe.target_reps ?? 10,
      target_weight: pe.target_weight ?? null,
      rest_seconds: pe.rest_seconds ?? 90,
      order_index: pe.order_index,
    })),
  }));
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function PlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  // ── Draft state ────────────────────────────────────────────────────────────
  const [draft, setDraft] = useState<DraftSession[]>([]);
  const [draftName, setDraftName] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [pendingWeeks, setPendingWeeks] = useState(0); // extra empty weeks not yet in draft

  // ── UI-only state (no save impact) ─────────────────────────────────────────
  const [addSessionForWeek, setAddSessionForWeek] = useState<number | null>(null);
  const [newSessionName, setNewSessionName] = useState('');
  const [editingSessionTempId, setEditingSessionTempId] = useState<string | null>(null);
  const [editingSessionName, setEditingSessionName] = useState('');
  const [addExerciseForSession, setAddExerciseForSession] = useState<string | null>(null);
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [creatingExercise, setCreatingExercise] = useState(false);
  const [newExerciseMuscleGroup, setNewExerciseMuscleGroup] = useState('chest');
  const [newExerciseCategory, setNewExerciseCategory] = useState<'weighted' | 'bodyweight'>('weighted');
  const [editingPeTempId, setEditingPeTempId] = useState<string | null>(null);
  const [editingHeader, setEditingHeader] = useState(false);

  // ── Server data ────────────────────────────────────────────────────────────
  const { data: plan, isLoading } = useQuery<WorkoutPlan>({
    queryKey: ['plan', id],
    queryFn: async () => { const res = await api.get(`/api/plans/${id}`); return res.data; },
  });

  const { data: allExercises } = useQuery<Exercise[]>({
    queryKey: ['exercises'],
    queryFn: async () => { const res = await api.get('/api/exercises'); return res.data; },
  });

  // Initialise draft when plan first loads (or after a successful save)
  useEffect(() => {
    if (plan && !initialized) {
      setDraft(planToDraft(plan));
      setDraftName(plan.name);
      setDraftDesc(plan.description ?? '');
      setPendingWeeks(0);
      setInitialized(true);
    }
  }, [plan, initialized]);

  // ── Dirty detection ────────────────────────────────────────────────────────
  const isDirty = useMemo(() => {
    if (!plan || !initialized) return false;
    if (draftName !== plan.name || draftDesc !== (plan.description ?? '')) return true;
    return JSON.stringify(draft) !== JSON.stringify(planToDraft(plan));
  }, [plan, draft, draftName, draftDesc, initialized]);

  // ── Draft operations (all local — no API calls) ────────────────────────────
  const addSession = (name: string, weekNumber: number) => {
    const tempId = `new_${Date.now()}`;
    const weekSessions = draft.filter(s => s.week_number === weekNumber);
    setDraft(d => [...d, { tempId, isNew: true, name, week_number: weekNumber, order_index: weekSessions.length, exercises: [] }]);
    setPendingWeeks(0);
    setAddSessionForWeek(null);
    setNewSessionName('');
  };

  const removeSession = (tempId: string) => {
    setDraft(d => d.filter(s => s.tempId !== tempId));
  };

  const commitSessionRename = (tempId: string) => {
    setDraft(d => d.map(s => s.tempId === tempId ? { ...s, name: editingSessionName } : s));
    setEditingSessionTempId(null);
  };

  const addExerciseToDraft = (sessionTempId: string, exercise: Exercise) => {
    setDraft(d => d.map(s => {
      if (s.tempId !== sessionTempId) return s;
      const tempId = `new_${Date.now()}`;
      return {
        ...s,
        exercises: [...s.exercises, {
          tempId, isNew: true,
          exercise_id: exercise.id, exercise,
          target_sets: 3, target_reps: 10, target_weight: null, rest_seconds: 90,
          order_index: s.exercises.length,
        }],
      };
    }));
    setAddExerciseForSession(null);
    setExerciseSearch('');
  };

  const removeExercise = (sessionTempId: string, exTempId: string) => {
    setDraft(d => d.map(s =>
      s.tempId !== sessionTempId ? s : { ...s, exercises: s.exercises.filter(e => e.tempId !== exTempId) }
    ));
  };

  const updateExerciseField = (sessionTempId: string, exTempId: string, field: keyof DraftExercise, rawValue: string) => {
    setDraft(d => d.map(s => {
      if (s.tempId !== sessionTempId) return s;
      return {
        ...s,
        exercises: s.exercises.map(e => {
          if (e.tempId !== exTempId) return e;
          if (field === 'target_sets') return { ...e, target_sets: parseInt(rawValue) || e.target_sets };
          if (field === 'target_reps') return { ...e, target_reps: parseInt(rawValue) || e.target_reps };
          if (field === 'target_weight') return { ...e, target_weight: rawValue === '' ? null : parseFloat(rawValue) || e.target_weight };
          if (field === 'rest_seconds') return { ...e, rest_seconds: parseInt(rawValue) || e.rest_seconds };
          return e;
        }),
      };
    }));
  };

  // Create a brand-new global exercise then add it to the draft (exercise creation IS immediate — it's a global resource)
  const createExerciseMutation = useMutation({
    mutationFn: async ({ name, muscleGroup, category }: { name: string; muscleGroup: string; category: string }) => {
      const res = await api.post('/api/exercises', { name, muscle_group: muscleGroup, category });
      return res.data as Exercise;
    },
    onSuccess: (exercise, _, context) => {
      queryClient.invalidateQueries({ queryKey: ['exercises'] });
      const sessionTempId = addExerciseForSession!;
      addExerciseToDraft(sessionTempId, exercise);
      setCreatingExercise(false);
      setNewExerciseMuscleGroup('chest');
      setNewExerciseCategory('weighted');
      setExerciseSearch('');
    },
  });

  // ── Save mutation — processes the full diff against the server ─────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      // 1. Plan metadata
      if (draftName !== plan!.name || draftDesc !== (plan!.description ?? '')) {
        await api.put(`/api/plans/${id}`, { name: draftName, description: draftDesc || undefined });
      }

      const original = planToDraft(plan!);
      const origSessionMap = new Map(original.map(s => [s.tempId, s]));
      const draftNonNewIds = new Set(draft.filter(s => !s.isNew).map(s => s.tempId));

      // 2. Delete removed sessions (cascade removes their exercises)
      for (const [sid] of origSessionMap) {
        if (!draftNonNewIds.has(sid)) {
          await api.delete(`/api/plans/plan-sessions/${sid}`);
        }
      }

      // 3. Create new sessions; record tempId → real server ID
      const sessionIdMap: Record<string, string> = {};
      for (const s of draft) {
        if (!s.isNew) continue;
        const res = await api.post(`/api/plans/${id}/sessions`, {
          name: s.name,
          week_number: s.week_number,
          order_index: s.order_index,
        });
        sessionIdMap[s.tempId] = res.data.id;
      }

      // 4. Update renamed/moved existing sessions
      for (const s of draft) {
        if (s.isNew) continue;
        const orig = origSessionMap.get(s.tempId);
        if (orig && (orig.name !== s.name || orig.week_number !== s.week_number)) {
          await api.put(`/api/plans/plan-sessions/${s.tempId}`, { name: s.name, week_number: s.week_number });
        }
      }

      // 5. Delete removed exercises from surviving sessions
      for (const [sid, origSession] of origSessionMap) {
        if (!draftNonNewIds.has(sid)) continue; // session deleted — cascade handled above
        const draftSession = draft.find(s => s.tempId === sid);
        if (!draftSession) continue;
        const remainingExIds = new Set(draftSession.exercises.filter(e => !e.isNew).map(e => e.tempId));
        for (const origEx of origSession.exercises) {
          if (!remainingExIds.has(origEx.tempId)) {
            await api.delete(`/api/plans/plan-exercises/${origEx.tempId}`);
          }
        }
      }

      // 6. Create new exercises (using real session IDs)
      for (const s of draft) {
        const realSessionId = s.isNew ? sessionIdMap[s.tempId] : s.tempId;
        for (const ex of s.exercises) {
          if (!ex.isNew) continue;
          await api.post(`/api/plans/plan-sessions/${realSessionId}/exercises`, {
            exercise_id: ex.exercise_id,
            order_index: ex.order_index,
            target_sets: ex.target_sets,
            target_reps: ex.target_reps,
            target_weight: ex.target_weight,
            rest_seconds: ex.rest_seconds,
          });
        }
      }

      // 7. Update changed existing exercises
      for (const s of draft) {
        if (s.isNew) continue;
        const origSession = origSessionMap.get(s.tempId);
        if (!origSession) continue;
        const origExMap = new Map(origSession.exercises.map(e => [e.tempId, e]));
        for (const ex of s.exercises) {
          if (ex.isNew) continue;
          const origEx = origExMap.get(ex.tempId);
          if (!origEx) continue;
          if (
            origEx.target_sets !== ex.target_sets ||
            origEx.target_reps !== ex.target_reps ||
            origEx.target_weight !== ex.target_weight ||
            origEx.rest_seconds !== ex.rest_seconds
          ) {
            await api.put(`/api/plans/plan-exercises/${ex.tempId}`, {
              target_sets: ex.target_sets,
              target_reps: ex.target_reps,
              target_weight: ex.target_weight,
              rest_seconds: ex.rest_seconds,
            });
          }
        }
      }
    },
    onSuccess: async () => {
      const fresh = await queryClient.fetchQuery<WorkoutPlan>({
        queryKey: ['plan', id],
        queryFn: async () => { const res = await api.get(`/api/plans/${id}`); return res.data; },
      });
      setDraft(planToDraft(fresh));
      setDraftName(fresh.name);
      setDraftDesc(fresh.description ?? '');
      setPendingWeeks(0);
    },
  });

  const discard = () => {
    if (!plan) return;
    setDraft(planToDraft(plan));
    setDraftName(plan.name);
    setDraftDesc(plan.description ?? '');
    setPendingWeeks(0);
    setEditingHeader(false);
    setEditingPeTempId(null);
    setEditingSessionTempId(null);
  };

  // ── Derived week layout ────────────────────────────────────────────────────
  const maxWeekInDraft = draft.length > 0 ? Math.max(...draft.map(s => s.week_number)) : 0;
  const totalWeeks = maxWeekInDraft + pendingWeeks;
  const weekNumbers = totalWeeks > 0 ? Array.from({ length: totalWeeks }, (_, i) => i + 1) : [];

  // ── Loading / error states ─────────────────────────────────────────────────
  if (isLoading || !initialized) {
    return (
      <div className="space-y-4">
        <div className="h-14 rounded-xl bg-muted animate-pulse" />
        <div className="h-48 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  if (!plan) return <div className="py-24 text-center text-muted-foreground">Plan not found.</div>;

  return (
    <div className={cn('space-y-5', isDirty ? 'pb-28' : 'pb-10')}>
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => router.back()} className="shrink-0">
            <ChevronLeft className="size-4" />
          </Button>
          {editingHeader ? (
            <div className="flex-1 flex flex-col gap-2">
              <Input
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                placeholder="Plan name"
                className="font-semibold"
                autoFocus
                onKeyDown={e => e.key === 'Escape' && setEditingHeader(false)}
              />
              <Input
                value={draftDesc}
                onChange={e => setDraftDesc(e.target.value)}
                placeholder="Description (optional)"
                className="text-sm"
                onKeyDown={e => e.key === 'Escape' && setEditingHeader(false)}
              />
            </div>
          ) : (
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold truncate">{draftName || plan.name}</h1>
              {draftDesc && <p className="text-sm text-muted-foreground truncate mt-0.5">{draftDesc}</p>}
            </div>
          )}
          <button
            onClick={() => setEditingHeader(e => !e)}
            className="text-muted-foreground hover:text-primary transition-colors shrink-0"
          >
            {editingHeader ? <X className="size-4" /> : <Pencil className="size-4" />}
          </button>
        </div>
      </div>

      {/* Empty state */}
      {draft.length === 0 && pendingWeeks === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="size-14 rounded-2xl bg-muted flex items-center justify-center">
            <Dumbbell className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground text-center">Add a week to start building your plan</p>
          <Button className="gap-2" onClick={() => setPendingWeeks(1)}>
            <Plus className="size-4" /> Add Week 1
          </Button>
        </div>
      )}

      {/* Week sections */}
      <div className="space-y-6">
        {weekNumbers.map(weekNum => {
          const weekSessions = draft
            .filter(s => s.week_number === weekNum)
            .sort((a, b) => a.order_index - b.order_index);

          return (
            <div key={weekNum} className="space-y-3">
              {/* Week header */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Week {weekNum}
                </span>
                <span className="text-xs text-muted-foreground/50">
                  {weekSessions.length} {weekSessions.length === 1 ? 'day' : 'days'}
                </span>
              </div>

              {/* Day cards */}
              <div className="space-y-3">
                {weekSessions.map(ps => {
                  const addedExIds = new Set(ps.exercises.map(e => e.exercise_id));
                  const filtered = allExercises?.filter(
                    ex => !addedExIds.has(ex.id) && ex.name.toLowerCase().includes(exerciseSearch.toLowerCase())
                  ) ?? [];

                  return (
                    <div key={ps.tempId} className="rounded-xl border border-border bg-card overflow-hidden animate-in fade-in duration-200">
                      {/* Session header */}
                      <div className="flex items-center gap-2 px-4 py-3 bg-muted/30 border-b border-border/50">
                        <GripVertical className="size-4 text-muted-foreground/40 shrink-0" />
                        {editingSessionTempId === ps.tempId ? (
                          <div className="flex-1 flex items-center gap-2">
                            <Input
                              value={editingSessionName}
                              onChange={e => setEditingSessionName(e.target.value)}
                              className="h-7 text-sm flex-1"
                              autoFocus
                              onKeyDown={e => {
                                if (e.key === 'Enter') commitSessionRename(ps.tempId);
                                if (e.key === 'Escape') setEditingSessionTempId(null);
                              }}
                            />
                            <Button size="sm" className="h-7 px-3 text-xs" onClick={() => commitSessionRename(ps.tempId)}>
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 px-3 text-xs" onClick={() => setEditingSessionTempId(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <>
                            <span className="font-semibold text-sm flex-1">{ps.name}</span>
                            <span className="text-xs text-muted-foreground">{ps.exercises.length} exercises</span>
                            <button
                              onClick={() => { setEditingSessionTempId(ps.tempId); setEditingSessionName(ps.name); }}
                              className="text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button onClick={() => removeSession(ps.tempId)} className="text-muted-foreground hover:text-destructive transition-colors">
                              <Trash2 className="size-3.5" />
                            </button>
                          </>
                        )}
                      </div>

                      {/* Exercises */}
                      <div className="divide-y divide-border/30">
                        {ps.exercises.map(ex => {
                          const peKey = `${ps.tempId}::${ex.tempId}`;
                          const isEditing = editingPeTempId === peKey;
                          return (
                            <div key={ex.tempId} className="px-4 py-3">
                              {isEditing ? (
                                <div className="space-y-2.5">
                                  <div className="flex items-center gap-2">
                                    <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full shrink-0', muscleColor(ex.exercise.muscle_group))}>
                                      {ex.exercise.muscle_group}
                                    </span>
                                    <span className="font-medium text-sm flex-1">{ex.exercise.name}</span>
                                    <button onClick={() => setEditingPeTempId(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                                      <X className="size-3.5" />
                                    </button>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <div className="relative flex-1">
                                      <Input type="number" value={ex.target_sets}
                                        onChange={e => updateExerciseField(ps.tempId, ex.tempId, 'target_sets', e.target.value)}
                                        className="h-9 text-sm pr-8" placeholder="Sets" />
                                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">sets</span>
                                    </div>
                                    <div className="relative flex-1">
                                      <Input type="number" value={ex.target_reps}
                                        onChange={e => updateExerciseField(ps.tempId, ex.tempId, 'target_reps', e.target.value)}
                                        className="h-9 text-sm pr-8" placeholder="Reps" />
                                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">reps</span>
                                    </div>
                                    {ex.exercise.category !== 'bodyweight' && (
                                      <div className="relative flex-1">
                                        <Input type="number" value={ex.target_weight ?? ''}
                                          onChange={e => updateExerciseField(ps.tempId, ex.tempId, 'target_weight', e.target.value)}
                                          placeholder="—" className="h-9 text-sm pr-8" />
                                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">lbs</span>
                                      </div>
                                    )}
                                    <div className="relative flex-1">
                                      <Input type="number" value={ex.rest_seconds}
                                        onChange={e => updateExerciseField(ps.tempId, ex.tempId, 'rest_seconds', e.target.value)}
                                        className="h-9 text-sm pr-6" placeholder="90" />
                                      <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">s</span>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full shrink-0', muscleColor(ex.exercise.muscle_group))}>
                                    {ex.exercise.muscle_group}
                                  </span>
                                  <span className="font-medium text-sm flex-1 truncate">{ex.exercise.name}</span>
                                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                                    {ex.target_sets}×{ex.target_reps}
                                    {ex.exercise.category !== 'bodyweight' && ex.target_weight ? ` @ ${ex.target_weight} lbs` : ''}
                                    {' · '}{ex.rest_seconds}s
                                  </span>
                                  <button onClick={() => setEditingPeTempId(peKey)} className="text-muted-foreground hover:text-primary transition-colors">
                                    <Pencil className="size-3.5" />
                                  </button>
                                  <button onClick={() => removeExercise(ps.tempId, ex.tempId)} className="text-muted-foreground hover:text-destructive transition-colors">
                                    <X className="size-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Add exercise */}
                        <div className="px-4 py-2">
                          <Dialog
                            open={addExerciseForSession === ps.tempId}
                            onOpenChange={open => {
                              setAddExerciseForSession(open ? ps.tempId : null);
                              if (!open) { setExerciseSearch(''); setCreatingExercise(false); setNewExerciseMuscleGroup('chest'); }
                            }}
                          >
                            <DialogTrigger render={
                              <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors py-1">
                                <Plus className="size-3.5" /> Add exercise
                              </button>
                            } />
                            <DialogContent className="sm:max-w-sm">
                              <DialogHeader><DialogTitle>Add Exercise to {ps.name}</DialogTitle></DialogHeader>
                              <div className="mt-2 space-y-3">
                                {!creatingExercise && (
                                  <Input placeholder="Search exercises…" value={exerciseSearch} onChange={e => setExerciseSearch(e.target.value)} autoFocus />
                                )}
                                {creatingExercise ? (
                                  <div className="space-y-3">
                                    <p className="text-sm font-medium">Create new exercise</p>
                                    <Input placeholder="Exercise name" value={exerciseSearch} onChange={e => setExerciseSearch(e.target.value)} autoFocus />
                                    <div className="flex gap-2">
                                      <select value={newExerciseMuscleGroup} onChange={e => setNewExerciseMuscleGroup(e.target.value)}
                                        className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                                        {['chest','back','shoulders','biceps','triceps','legs','core','cardio'].map(g => (
                                          <option key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</option>
                                        ))}
                                      </select>
                                      <select value={newExerciseCategory} onChange={e => setNewExerciseCategory(e.target.value as 'weighted' | 'bodyweight')}
                                        className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                                        <option value="weighted">Weighted</option>
                                        <option value="bodyweight">Bodyweight</option>
                                      </select>
                                    </div>
                                    <div className="flex gap-2">
                                      <Button variant="outline" className="flex-1" onClick={() => setCreatingExercise(false)}>Cancel</Button>
                                      <Button className="flex-1"
                                        disabled={!exerciseSearch.trim() || createExerciseMutation.isPending}
                                        onClick={() => createExerciseMutation.mutate({ name: exerciseSearch.trim(), muscleGroup: newExerciseMuscleGroup, category: newExerciseCategory })}>
                                        {createExerciseMutation.isPending ? 'Creating…' : 'Create & Add'}
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="max-h-72 overflow-y-auto -mx-1">
                                    {filtered.length === 0 ? (
                                      <div className="py-4 flex flex-col items-center gap-3">
                                        <p className="text-sm text-muted-foreground text-center">
                                          {exerciseSearch ? `No matches for "${exerciseSearch}"` : 'All exercises added'}
                                        </p>
                                        {exerciseSearch && (
                                          <button onClick={() => setCreatingExercise(true)}
                                            className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                                            <Plus className="size-3.5" /> Create "{exerciseSearch}"
                                          </button>
                                        )}
                                      </div>
                                    ) : (
                                      <>
                                        {filtered.map(ex => (
                                          <button key={ex.id} onClick={() => addExerciseToDraft(ps.tempId, ex)}
                                            className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-muted transition-colors flex items-center justify-between gap-3">
                                            <span className="font-medium text-sm">{ex.name}</span>
                                            <span className={cn('text-xs px-2 py-0.5 rounded-full shrink-0', muscleColor(ex.muscle_group))}>
                                              {ex.muscle_group}
                                            </span>
                                          </button>
                                        ))}
                                        {exerciseSearch && (
                                          <button onClick={() => setCreatingExercise(true)}
                                            className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-muted transition-colors flex items-center gap-2 text-primary border-t border-border/50 mt-1">
                                            <Plus className="size-3.5 shrink-0" />
                                            <span className="text-sm">Create "{exerciseSearch}"</span>
                                          </button>
                                        )}
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            </DialogContent>
                          </Dialog>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Add Day to this week */}
              <Dialog open={addSessionForWeek === weekNum} onOpenChange={open => { setAddSessionForWeek(open ? weekNum : null); if (!open) setNewSessionName(''); }}>
                <DialogTrigger render={
                  <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors py-1 pl-1">
                    <Plus className="size-3.5" /> Add Day to Week {weekNum}
                  </button>
                } />
                <DialogContent className="sm:max-w-xs">
                  <DialogHeader><DialogTitle>Add Day — Week {weekNum}</DialogTitle></DialogHeader>
                  <div className="space-y-3 mt-2">
                    <Input placeholder="e.g. Push Day, Pull Day, Legs" value={newSessionName} onChange={e => setNewSessionName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && newSessionName.trim() && addSession(newSessionName.trim(), weekNum)} autoFocus />
                    <Button className="w-full" onClick={() => addSession(newSessionName.trim(), weekNum)} disabled={!newSessionName.trim()}>
                      Add Day
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          );
        })}
      </div>

      {/* Add Week */}
      {(draft.length > 0 || pendingWeeks > 0) && (
        <button onClick={() => setPendingWeeks(w => w + 1)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors py-2 font-medium">
          <Plus className="size-4" /> Add Week {totalWeeks + 1}
        </button>
      )}

      {/* ── Unsaved changes bar ─────────────────────────────────────────────── */}
      {isDirty && (
        <div className="fixed bottom-16 md:bottom-0 inset-x-0 z-40 bg-background border-t shadow-[0_-4px_20px_rgba(0,0,0,0.08)] px-4 py-3">
          <div className="flex items-center gap-3 max-w-xl mx-auto">
            <p className="text-sm text-muted-foreground flex-1">Unsaved changes</p>
            <Button variant="outline" onClick={discard} disabled={saveMutation.isPending}>
              Discard
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
