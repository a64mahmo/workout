'use client';

import { use, useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { BottomSheet, BottomSheetTrigger, BottomSheetContent } from '@/components/ui/bottom-sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { computeGhostMap } from '@/lib/ghost-map';
import { PREF_REST_TIMER } from '@/app/settings/page';
import type {
  TrainingSession,
  Exercise,
  SessionExercise,
  ExerciseSet,
  WorkoutPlan,
  ExerciseProgressionSuggestion,
} from '@/types';
import {
  ChevronLeft,
  Dumbbell,
  Flame,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  SkipForward,
  CheckCircle2,
  Circle,
  Timer,
  Play,
  Activity,
  Heart,
  Moon,
  Weight,
  Loader2,
  Pencil,
  Trophy,
  Clock,
  Trash2,
  Sparkles,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { cn, formatStatus } from '@/lib/utils';


// ── Muscle colours ────────────────────────────────────────────────────────────
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
function muscleColor(g: string) {
  return muscleColors[g?.toLowerCase()] ?? 'bg-muted text-muted-foreground';
}

function fmtSecs(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`;
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface HistorySet { set_number: number; reps: number; weight: number; rpe?: number }
interface HistoryEntry {
  session_id: string; // added
  session_date: string | null;
  session_name: string;
  sets: HistorySet[];
  total_volume: number;
}
interface RestState { active: boolean; remaining: number; total: number }

// ── Rest Timer (full-width bottom bar) ───────────────────────────────────────
function RestTimer({
  state,
  onAdjust,
  onDismiss,
}: {
  state: RestState;
  onAdjust: (d: number) => void;
  onDismiss: () => void;
}) {
  const { remaining, total } = state;
  const pct = Math.max(0, (remaining / Math.max(total, 1)) * 100);
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const urgent = remaining <= 10 && remaining > 0;
  const done = remaining === 0;

  return (
    <div className={cn(
      'fixed bottom-0 inset-x-0 z-50',
      'bg-background/98 backdrop-blur border-t shadow-[0_-8px_32px_rgba(0,0,0,0.12)]',
      'animate-in slide-in-from-bottom-4 duration-200',
      urgent ? 'border-destructive/50' : 'border-border',
    )}>
      {/* Progress bar */}
      <div className="h-1 w-full bg-muted overflow-hidden">
        <div
          className={cn(
            'h-full transition-[width] duration-1000 ease-linear',
            done ? 'bg-emerald-500' : urgent ? 'bg-destructive' : 'bg-primary',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        {/* Label + countdown */}
        <div className="flex flex-col items-center justify-center w-24 shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Rest</span>
          <span className={cn(
            'text-4xl font-bold tabular-nums leading-none mt-0.5',
            done ? 'text-emerald-500' : urgent ? 'text-destructive' : 'text-foreground',
          )}>
            {mins > 0
              ? `${mins}:${String(secs).padStart(2, '0')}`
              : `0:${String(remaining).padStart(2, '0')}`}
          </span>
        </div>

        {/* Adjust buttons */}
        <div className="flex-1 flex items-center justify-center gap-2">
          {[-30, -10, +10, +30].map(d => (
            <button
              key={d}
              onClick={() => onAdjust(d)}
              className="flex-1 h-11 rounded-xl bg-muted hover:bg-muted/70 text-sm font-semibold tabular-nums transition-colors"
            >
              {d > 0 ? `+${d}` : d}s
            </button>
          ))}
        </div>

        {/* Skip */}
        <button
          onClick={onDismiss}
          className="shrink-0 flex flex-col items-center gap-0.5 w-12 text-muted-foreground hover:text-foreground transition-colors"
        >
          <SkipForward className="size-5" />
          <span className="text-[9px] font-semibold uppercase tracking-wide">Skip</span>
        </button>
      </div>
    </div>
  );
}

// ── Inline rest timer (between rows inside exercise card) ─────────────────────
function InlineRestTimer({
  state,
  onAdjust,
  onDismiss,
}: {
  state: RestState;
  onAdjust: (d: number) => void;
  onDismiss: () => void;
}) {
  const { remaining, total } = state;
  const pct = Math.max(0, (remaining / Math.max(total, 1)) * 100);
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const urgent = remaining <= 10 && remaining > 0;
  const done = remaining === 0;

  return (
    <div className={cn(
      'mx-3 my-2 rounded-xl overflow-hidden border',
      urgent ? 'border-destructive/40 bg-destructive/5'
        : done ? 'border-emerald-500/40 bg-emerald-500/5'
        : 'border-primary/20 bg-primary/5',
      'animate-in fade-in duration-200',
    )}>
      <div className="h-1 w-full bg-muted/50 overflow-hidden">
        <div
          className={cn('h-full transition-[width] duration-1000 ease-linear', done ? 'bg-emerald-500' : urgent ? 'bg-destructive' : 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex items-center gap-1.5 shrink-0">
          <Timer className="size-3.5 text-muted-foreground" />
          <span className={cn('text-2xl font-bold tabular-nums leading-none', done ? 'text-emerald-500' : urgent ? 'text-destructive' : 'text-primary')}>
            {mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `0:${String(remaining).padStart(2, '0')}`}
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center gap-1">
          {[-30, -10, +10, +30].map(d => (
            <button
              key={d}
              onClick={() => onAdjust(d)}
              className="flex-1 h-8 rounded-lg bg-background/80 hover:bg-background text-xs font-semibold tabular-nums transition-colors border border-border/30"
            >
              {d > 0 ? `+${d}` : d}s
            </button>
          ))}
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 flex flex-col items-center gap-0.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <SkipForward className="size-4" />
          <span className="text-[9px] font-semibold uppercase tracking-wide">Skip</span>
        </button>
      </div>
    </div>
  );
}

// ── Per-exercise rest control ─────────────────────────────────────────────────
function RestControl({
  enabled,
  duration,
  onToggle,
  onChangeDuration,
}: {
  enabled: boolean;
  duration: number;
  onToggle: () => void;
  onChangeDuration: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const commit = () => {
    const v = parseInt(draft);
    if (v > 0) onChangeDuration(v);
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={onToggle}
        className={cn(
          'flex items-center gap-1 text-xs transition-colors font-medium px-1.5 py-0.5 rounded',
          enabled
            ? 'text-primary bg-primary/10 hover:bg-primary/20'
            : 'text-muted-foreground/50 bg-muted/50 hover:bg-muted',
        )}
        title={enabled ? 'Disable rest timer' : 'Enable rest timer'}
      >
        <Timer className="size-3" />
        {enabled ? 'Rest on' : 'Rest off'}
      </button>

      {enabled && (
        editing ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              type="number"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
              className="w-14 h-6 text-xs text-center rounded border border-primary/50 bg-background tabular-nums outline-none focus:ring-1 focus:ring-primary/40"
              placeholder="sec"
            />
            <span className="text-xs text-muted-foreground">s</span>
          </div>
        ) : (
          <button
            onClick={() => { setDraft(String(duration)); setEditing(true); }}
            className="text-xs tabular-nums text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
          >
            {fmtSecs(duration)}
          </button>
        )
      )}
    </div>
  );
}

// ── History panel ─────────────────────────────────────────────────────────────
function ExerciseHistoryPanel({ exerciseId, open, isBodyweight = false }: {
  exerciseId: string; open: boolean; isBodyweight?: boolean;
}) {
  const { data, isLoading } = useQuery<HistoryEntry[]>({
    queryKey: ['exercise-history', exerciseId],
    queryFn: async () => {
      const res = await api.get(`/api/exercises/${exerciseId}/history`);
      return res.data;
    },
    enabled: open,
    staleTime: 60_000,
  });

  if (!open) return null;

  return (
    <div className="border-t border-border/40 bg-muted/10 px-4 py-3 space-y-2 animate-in slide-in-from-top-2 duration-150">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
        <TrendingUp className="size-3" />
        Recent Performance
      </div>
      {isLoading && <div className="h-10 rounded-lg bg-muted animate-pulse" />}
      {data?.length === 0 && <p className="text-xs text-muted-foreground">No history yet.</p>}
      {data && data.length > 0 && (
        <div className="space-y-1.5">
          {data.map((entry, i) => (
            <div key={i} className="rounded-lg border border-border/40 bg-background/60 px-3 py-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium">
                  {entry.session_date ? format(new Date(entry.session_date + 'T00:00:00'), 'MMM d, yyyy') : '—'}
                </span>
                {!isBodyweight && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {entry.total_volume >= 1000 ? `${(entry.total_volume / 1000).toFixed(1)}k` : entry.total_volume} lbs
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {entry.sets.map(s => (
                  <span key={s.set_number} className="text-xs bg-muted rounded px-1.5 py-0.5 tabular-nums">
                    {isBodyweight ? `${s.reps} reps` : `${s.reps}×${s.weight}`}{s.rpe ? <span className="text-muted-foreground ml-0.5">@{s.rpe}</span> : null}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Set row ───────────────────────────────────────────────────────────────────
function SetRow({
  set, isActive, editVal, onEdit, onComplete, onUncheck, onDelete,
  isCompleting, isUnchecking, isEditable, isBodyweight = false,
  canComplete, isJustCompleted = false, prevSet, ghostVal,
}: {
  set: ExerciseSet;
  isActive: boolean;
  editVal: { reps: string; weight: string; rpe: string };
  onEdit: (field: 'reps' | 'weight' | 'rpe', val: string) => void;
  onComplete: () => void;
  onUncheck: () => void;
  onDelete: () => void;
  isCompleting: boolean;
  isUnchecking: boolean;
  isEditable: boolean;
  isBodyweight?: boolean;
  canComplete?: boolean;
  isJustCompleted?: boolean;
  prevSet?: HistorySet;
  ghostVal?: { weight?: string; reps?: string };
}) {
  const prevLabel = prevSet
    ? (isBodyweight ? `${prevSet.reps}` : `${prevSet.weight}×${prevSet.reps}`)
    : '—';

  const [swipeX, setSwipeX] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const swipeOp = Math.min(1, Math.abs(swipeX) / 60);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchRef.current || isDeleting) return;
    const dx = e.touches[0].clientX - touchRef.current.x;
    const dy = e.touches[0].clientY - touchRef.current.y;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 6)
      setSwipeX(Math.max(-90, Math.min(0, dx)));
  };
  const handleTouchEnd = () => {
    if (swipeX < -60) {
      setIsDeleting(true);
      setTimeout(() => onDelete(), 320);
    } else {
      setSwipeX(0);
    }
    touchRef.current = null;
  };

  const rowContent = (inner: React.ReactNode) => (
    <div className={cn('relative overflow-hidden', isDeleting && 'set-delete-slide')} style={{ touchAction: 'pan-y' }}
      onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      {/* Delete reveal */}
      <div className="absolute inset-y-0 right-0 w-20 bg-destructive flex items-center justify-center pointer-events-none rounded-r-none"
        style={{ opacity: swipeOp }}>
        <Trash2 className="size-4 text-white" />
      </div>
      {/* Row */}
      <div style={{
        transform: `translateX(${swipeX}px)`,
        transition: swipeX === 0 ? 'transform 0.2s ease' : 'none',
      }}>
        {inner}
      </div>
    </div>
  );

  // ── Completed / read-only ──
  if (set.is_completed || !isEditable) {
    return (
      <div className="border-t border-border/20 first:border-t-0">
        {rowContent(
          <div className={cn('flex items-center gap-2 px-3 py-3 group bg-card', isJustCompleted && 'set-completed-pop')}>
            {/* Set # + prev stacked */}
            <div className="w-12 shrink-0 text-center">
              <div className={cn('text-sm font-semibold tabular-nums', set.is_completed ? 'text-emerald-500' : 'text-muted-foreground')}>{set.set_number}</div>
              <div className="text-[10px] text-muted-foreground/60 tabular-nums leading-tight">{prevLabel}</div>
            </div>
            {!isBodyweight && (
              <span className={cn('flex-1 text-base tabular-nums text-center font-medium', set.is_completed ? 'line-through text-muted-foreground/60' : 'text-muted-foreground')}>
                {set.weight}
              </span>
            )}
            <span className={cn('flex-1 text-base tabular-nums text-center font-medium', set.is_completed ? 'line-through text-muted-foreground/60' : 'text-muted-foreground')}>
              {set.reps}
            </span>
            <span className="w-11 shrink-0 text-xs tabular-nums text-center text-muted-foreground/50">{set.rpe || '—'}</span>
            {isEditable ? (
              <button onClick={onUncheck} disabled={isUnchecking} className="shrink-0 size-11 flex items-center justify-center text-emerald-500 hover:text-amber-500 transition-colors" title="Tap to edit">
                {isUnchecking ? <Circle className="size-5 animate-pulse" /> : <CheckCircle2 className="size-5" />}
              </button>
            ) : (
              <span className="size-11 flex items-center justify-center shrink-0"><CheckCircle2 className="size-5 text-emerald-500" /></span>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Editable staged row ──
  return (
    <div className={cn('border-t border-border/20 first:border-t-0', isActive && 'bg-primary/5')}>
      {rowContent(
        <div className={cn('flex items-center gap-1.5 px-2 py-1.5', isActive && 'bg-primary/5')}>
          {/* Set # + prev stacked in a single narrow column */}
          <div className="w-12 shrink-0 text-center">
            <div className={cn('text-sm font-semibold tabular-nums leading-tight', isActive ? 'text-primary' : 'text-muted-foreground')}>
              {set.set_number}
            </div>
            <div className="text-[10px] text-muted-foreground/60 tabular-nums leading-tight">{prevLabel}</div>
          </div>

          {!isBodyweight && (
            <div className="relative flex-1">
              <Input
                type="number" inputMode="decimal"
                value={editVal.weight}
                onChange={e => onEdit('weight', e.target.value)}
                onKeyDown={e => e.key === 'Enter' && canComplete && onComplete()}
                onFocus={e => e.target.select()}
                className={cn('h-11 text-base text-center pr-7 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none', isActive && 'border-primary/40 bg-background', !editVal.weight && ghostVal?.weight && 'placeholder:text-foreground/50 placeholder:font-medium')}
                placeholder={!editVal.weight && ghostVal?.weight ? ghostVal.weight : '—'}
              />
              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none">lbs</span>
            </div>
          )}

          <div className="relative flex-1">
            <Input
              type="number" inputMode="numeric"
              value={editVal.reps}
              onChange={e => onEdit('reps', e.target.value)}
              onKeyDown={e => e.key === 'Enter' && canComplete && onComplete()}
              onFocus={e => e.target.select()}
              className={cn('h-11 text-base text-center pr-8 font-medium [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none', isActive && 'border-primary/40 bg-background', !editVal.reps && ghostVal?.reps && 'placeholder:text-foreground/50 placeholder:font-medium')}
              placeholder={!editVal.reps && ghostVal?.reps ? ghostVal.reps : '—'}
            />
            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none">reps</span>
          </div>

          <div className="w-11 shrink-0">
            <Input type="number" inputMode="decimal" min={0} max={10} value={editVal.rpe} onChange={e => { const v = e.target.value; if (v === '' || parseFloat(v) >= 0) onEdit('rpe', v); }} onFocus={e => e.target.select()} className="h-11 text-sm text-center px-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" placeholder="RPE" />
          </div>

          <button
            onClick={onComplete}
            disabled={!canComplete || isCompleting}
            className={cn(
              'shrink-0 size-11 rounded-xl flex items-center justify-center transition-all',
              canComplete ? 'bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95' : 'bg-muted text-muted-foreground opacity-40 cursor-not-allowed',
            )}
          >
            {isCompleting ? <span className="text-sm animate-pulse">…</span> : <CheckCircle2 className="size-5" />}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Pre-summary type ──────────────────────────────────────────────────────────
interface PreSummary {
  workout_number: number;
  duration_seconds: number | null;
  total_volume: number;
  completed_sets: number;
  total_sets: number;
  exercise_count: number;
  prs: { exercise_name: string; old_max: number; new_max: number }[];
}

// ── Confetti ──────────────────────────────────────────────────────────────────
function ConfettiEffect({ active }: { active: boolean }) {
  const pieces = useMemo(() =>
    Array.from({ length: 80 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      color: ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFEAA7', '#DDA0DD', '#98FB98', '#FFD700', '#FF9F43'][i % 8],
      delay: Math.random() * 700,
      duration: 900 + Math.random() * 700,
      rotate: Math.random() * 360,
      size: 6 + Math.random() * 9,
      isCircle: Math.random() > 0.5,
    })), []);

  if (!active) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[200] overflow-hidden">
      {pieces.map(p => (
        <div
          key={p.id}
          style={{
            position: 'absolute',
            left: `${p.left}%`,
            top: '-20px',
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            borderRadius: p.isCircle ? '50%' : '3px',
            transform: `rotate(${p.rotate}deg)`,
            animation: `confettiFall ${p.duration}ms ${p.delay}ms ease-in forwards`,
          }}
        />
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function SessionDetailInner({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [elapsed, setElapsed] = useState(0);
  const pageLoadTime = useRef(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setElapsed(prev => prev + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const [titleOpacity, setTitleOpacity] = useState(1);
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const op = y <= 20 ? 1 : y >= 90 ? 0 : 1 - (y - 20) / 70;
      setTitleOpacity(op);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const [addExerciseOpen, setAddExerciseOpen] = useState(false);
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [addMuscleFilter, setAddMuscleFilter] = useState<string | null>(null);
  const [addCategoryFilter, setAddCategoryFilter] = useState<string | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(new Set());
  const [collapsedExercises, setCollapsedExercises] = useState<Set<string>>(new Set());
  const [isFinishDialogOpen, setIsFinishDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isConfettiActive, setIsConfettiActive] = useState(false);

  // Per-set edit state
  const [setEdits, setSetEdits] = useState<Record<string, Partial<{ reps: string; weight: string; rpe: string }>>>({});

  // Default rest duration from user preference (falls back to 90s)
  const defaultRestSecs = useMemo(() => {
    if (typeof window === 'undefined') return 90;
    const stored = localStorage.getItem(PREF_REST_TIMER);
    return stored ? parseInt(stored, 10) : 90;
  }, []);

  // Per-exercise rest config: { enabled, duration }
  // Keyed by session_exercise id
  const [restConfig, setRestConfig] = useState<Record<string, { enabled: boolean; duration: number }>>({});

  // Active rest timer state
  const [rest, setRest] = useState<RestState>({ active: false, remaining: 0, total: 0 });
  const [restTimerSeId, setRestTimerSeId] = useState<string | null>(null);
  const [justCompletedSetId, setJustCompletedSetId] = useState<string | null>(null);
  const [replaceExerciseSeId, setReplaceExerciseSeId] = useState<string | null>(null);
  const [replaceExerciseSearch, setReplaceExerciseSearch] = useState('');
  const [replaceMuscleFilter, setReplaceMuscleFilter] = useState<string | null>(null);
  const [replaceCategoryFilter, setReplaceCategoryFilter] = useState<string | null>(null);
  const [replaceUndo, setReplaceUndo] = useState<{
    oldExerciseId: string;
    oldExerciseName: string;
    newSeId: string;
    orderIndex: number;
    sets: { set_number: number; reps: number; weight: number; is_warmup: boolean }[];
  } | null>(null);
  const replaceUndoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRest = useCallback((duration: number, seId: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setRest({ active: true, remaining: duration, total: duration });
    setRestTimerSeId(seId);
    timerRef.current = setInterval(() => {
      setRest(prev => {
        if (prev.remaining <= 1) {
          clearInterval(timerRef.current!);
          return { ...prev, active: false, remaining: 0 };
        }
        return { ...prev, remaining: prev.remaining - 1 };
      });
    }, 1000);
  }, []);

  const dismissRest = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setRest({ active: false, remaining: 0, total: 0 });
    setRestTimerSeId(null);
  }, []);

  const adjustRest = useCallback((delta: number) => {
    setRest(prev => ({ ...prev, remaining: Math.max(0, prev.remaining + delta) }));
  }, []);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  // Apply-plan state
  const [applyPlanOpen, setApplyPlanOpen] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [selectedWeekNum, setSelectedWeekNum] = useState<number | null>(null);
  const [selectedPlanSessionId, setSelectedPlanSessionId] = useState('');
  const [selectedPlanSessionName, setSelectedPlanSessionName] = useState('');
  const [suggestions, setSuggestions] = useState<ExerciseProgressionSuggestion[] | null>(null);
  const [overrides, setOverrides] = useState<Record<string, { weight: string; include: boolean }>>({});
  const [applyError, setApplyError] = useState<string | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: session, isLoading } = useQuery({
    queryKey: ['session', id],
    queryFn: async () => {
      const res = await api.get(`/api/sessions/${id}`);
      return res.data as TrainingSession;
    },
  });

  const { data: allExercises } = useQuery({
    queryKey: ['exercises'],
    queryFn: async () => {
      const res = await api.get('/api/exercises');
      return res.data as Exercise[];
    },
  });

  const { data: preSummary, isLoading: isSummaryLoading } = useQuery<PreSummary>({
    queryKey: ['session-pre-summary', id],
    queryFn: async () => {
      const res = await api.get(`/api/sessions/${id}/pre-summary`);
      return res.data as PreSummary;
    },
    enabled: isFinishDialogOpen,
    staleTime: 0,
  });

  const initializedSessionIdRef = useRef<string | null>(null);

  // Auto-enable editing for non-completed sessions
  useEffect(() => {
    if (session && session.status !== 'completed' && session.status !== 'cancelled') {
      setIsEditing(true);
    }
  }, [session]);

  // Initialise edit + rest state for newly-loaded exercises/sets
  useEffect(() => {
    if (!session) return;

    if (initializedSessionIdRef.current !== session.id) {
      // Clear edits from previous session
      setSetEdits({});
      initializedSessionIdRef.current = session.id;
    }

    setSetEdits(prev => {
      const next = { ...prev };
      for (const se of session.exercises) {
        for (const s of se.sets) {
          if (!s.is_completed && !next[s.id]) {
            next[s.id] = {
              reps: s.reps > 0 ? String(s.reps) : '',
              weight: s.weight > 0 ? String(s.weight) : '',
              rpe: s.rpe != null ? String(s.rpe) : '',
            };
          }
        }
      }
      return next;
    });
    setRestConfig(prev => {
      const next = { ...prev };
      for (const se of session.exercises) {
        if (!next[se.id]) {
          next[se.id] = { enabled: true, duration: se.rest_seconds ?? defaultRestSecs };
        }
      }
      return next;
    });
  }, [session]);

  const addedIds = new Set(session?.exercises.map(se => se.exercise_id) ?? []);

  const muscleGroups = useMemo(() => [...new Set((allExercises ?? []).map(ex => ex.muscle_group).filter(Boolean))].sort(), [allExercises]);
  const categories = useMemo(() => [...new Set((allExercises ?? []).map(ex => ex.category).filter(Boolean))].sort(), [allExercises]);

  function filterExercises(excludeId: string | null, search: string, muscle: string | null, category: string | null) {
    return (allExercises ?? []).filter(ex => {
      if (ex.id === excludeId) return false;
      if (search && !ex.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (muscle && ex.muscle_group?.toLowerCase() !== muscle) return false;
      if (category && ex.category?.toLowerCase() !== category) return false;
      return true;
    });
  }

  const filteredExercises = filterExercises(null, exerciseSearch, addMuscleFilter, addCategoryFilter)
    .filter(ex => !addedIds.has(ex.id));

  const replaceCurrentExerciseId = session?.exercises.find(se => se.id === replaceExerciseSeId)?.exercise_id ?? null;
  const replaceFilteredExercises = filterExercises(replaceCurrentExerciseId, replaceExerciseSearch, replaceMuscleFilter, replaceCategoryFilter);

  const totalVolume = useMemo(
    () => session?.exercises.reduce(
      (t, se) => t + se.sets.filter(s => s.is_completed).reduce((sv, s) => sv + s.reps * s.weight, 0), 0
    ) ?? 0,
    [session],
  );

  const completedSets = useMemo(
    () => session?.exercises.reduce((t, se) => t + se.sets.filter(s => s.is_completed).length, 0) ?? 0,
    [session],
  );

  // Auto-collapse exercises when all sets are completed
  const userExpandedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!session) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const se of session.exercises) {
      const allDone = se.sets.length > 0 && se.sets.every(s => s.is_completed);
      if (allDone && !collapsedExercises.has(se.id) && !userExpandedRef.current.has(se.id)) {
        timers.push(setTimeout(() => {
          setCollapsedExercises(prev => new Set(prev).add(se.id));
        }, 600));
      }
      // Un-collapse if a set was unchecked
      if (!allDone) {
        userExpandedRef.current.delete(se.id);
        if (collapsedExercises.has(se.id)) {
          setCollapsedExercises(prev => {
            const next = new Set(prev);
            next.delete(se.id);
            return next;
          });
        }
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [session]);

  // Prefetch previous-session performance for all exercises so we can show it inline per set row
  const exerciseIds = useMemo(() => session?.exercises.map(se => se.exercise_id) ?? [], [session]);
  const { data: allHistoryData } = useQuery({
    queryKey: ['exercises-history-bulk', exerciseIds.join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        exerciseIds.map(exId =>
          api.get(`/api/exercises/${exId}/history`).then(r => ({ exId, entries: r.data as HistoryEntry[] }))
        )
      );
      return results;
    },
    enabled: exerciseIds.length > 0,
    staleTime: 5 * 60_000,
  });

  // Map: exerciseId → { setNumber → HistorySet } (most recent session only, excluding current)
  const prevSetsMap = useMemo(() => {
    const map: Record<string, Record<number, HistorySet>> = {};
    for (const { exId, entries } of allHistoryData ?? []) {
      map[exId] = {};
      // Find the most recent session that is NOT the current one
      const lastCompletedSession = entries.find(e => e.session_id !== session?.id);
      for (const s of lastCompletedSession?.sets ?? []) {
        map[exId][s.set_number] = s;
      }
    }
    return map;
  }, [allHistoryData, session?.id]);

  // Fetch weight suggestions for all exercises
  const { data: suggestionsData } = useQuery({
    queryKey: ['exercises-suggestions-bulk', id, [...exerciseIds].sort().join(','), session?.meso_cycle_id],
    queryFn: async () => {
      const results = await Promise.allSettled(
        exerciseIds.map(exId =>
          api.get('/api/suggestions/weight', {
            params: {
              exercise_id: exId,
              session_id: id,
              ...(session?.meso_cycle_id ? { meso_cycle_id: session.meso_cycle_id } : {}),
            },
          }).then(r => ({
            exId,
            data: r.data as {
              log_id: string;
              suggested_weight: number;
              adjustment_reason: string;
              previous_weight: number;
              meso_week: number | null;
              meso_phase: string;
              meso_phase_label: string;
              target_rpe: number;
              session_volume: number;
              suggested_sets: number;
              volume_trend: string;
              estimated_1rm: number | null;
            },
          }))
        )
      );
      return results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
    },
    enabled: exerciseIds.length > 0 && isEditing,
    staleTime: 5 * 60_000,
  });

  const suggestionsMap = useMemo(() => {
    const map: Record<string, {
      log_id: string;
      suggested_weight: number;
      adjustment_reason: string;
      meso_week: number | null;
      meso_phase: string;
      meso_phase_label: string;
      target_rpe: number;
      session_volume: number;
      suggested_sets: number;
      volume_trend: string;
      estimated_1rm: number | null;
    }> = {};
    for (const { exId, data } of suggestionsData ?? []) map[exId] = data;
    return map;
  }, [suggestionsData]);

  const applyWeightSuggestion = (seId: string, weight: number) => {
    const exercise = session?.exercises.find(se => se.id === seId);
    if (!exercise) return;
    setSetEdits(prev => {
      const next = { ...prev };
      for (const s of exercise.sets) {
        if (!s.is_completed) next[s.id] = { ...(next[s.id] ?? {}), weight: String(weight) };
      }
      return next;
    });
  };

  // Exercise card swipe state
  const [exSwipeX, setExSwipeX] = useState<Record<string, number>>({});
  const [suggestionFlash, setSuggestionFlash] = useState<Record<string, 'apply' | 'undo'>>({});

  const flashSuggestion = (seId: string, type: 'apply' | 'undo') => {
    setSuggestionFlash(prev => ({ ...prev, [seId]: type }));
    setTimeout(() => setSuggestionFlash(prev => { const n = { ...prev }; delete n[seId]; return n; }), 400);
  };
  const exTouchRef = useRef<Record<string, { x: number; y: number }>>({});

  const getEdit = (s: ExerciseSet) => {
    const edit = setEdits[s.id] ?? {};
    return {
      reps: edit.reps ?? '',
      weight: edit.weight ?? '',
      rpe: edit.rpe ?? (s.rpe != null ? String(s.rpe) : ''),
    };
  };

  // Only update the current set — ghost propagation is computed in render
  const updateEdit = (seId: string, setId: string, field: 'reps' | 'weight' | 'rpe', val: string) =>
    setSetEdits(prev => ({ ...prev, [setId]: { ...(prev[setId] ?? {}), [field]: val } }));

  // ── Mutations ─────────────────────────────────────────────────────────────

  const addExerciseMutation = useMutation({
    mutationFn: async (exerciseId: string) => {
      const res = await api.post(`/api/sessions/${id}/exercises`, {
        exercise_id: exerciseId,
        order_index: session?.exercises.length ?? 0,
      });
      return res.data;
    },
    onSuccess: () => {
      if ((session?.exercises.length ?? 0) === 0) pageLoadTime.current = Date.now();
      queryClient.invalidateQueries({ queryKey: ['session', id] });
      setAddExerciseOpen(false);
      setExerciseSearch('');
    },
  });

  const removeExerciseMutation = useMutation({
    mutationFn: async (seId: string) => { await api.delete(`/api/sessions/session-exercises/${seId}`); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session', id] }),
  });

  const addSetMutation = useMutation({
    mutationFn: async (data: { seId: string; setNumber: number; reps: number; weight: number }) => {
      const res = await api.post(`/api/sessions/session-exercises/${data.seId}/sets`, {
        set_number: data.setNumber,
        reps: data.reps,
        weight: data.weight,
        is_warmup: false,
      });
      return res.data as ExerciseSet;
    },
    onSuccess: (newSet) => {
      queryClient.invalidateQueries({ queryKey: ['session', id] });
      setSetEdits(prev => ({
        ...prev,
        [newSet.id]: { reps: newSet.reps > 0 ? String(newSet.reps) : '', weight: newSet.weight > 0 ? String(newSet.weight) : '', rpe: '' },
      }));
    },
  });

  const recordOutcomeMutation = useMutation({
    mutationFn: async (data: { logId: string; reps: number; weight: number; rpe?: number }) => {
      await api.patch(`/api/suggestions/weight/history/${data.logId}`, {
        actual_reps: data.reps,
        actual_weight: data.weight,
        actual_rpe: data.rpe ?? null,
      });
    },
  });

  const completeSetMutation = useMutation({
    mutationFn: async (data: { setId: string; seId: string; reps: number; weight: number; rpe?: number }) => {
      const res = await api.put(`/api/sessions/exercise-sets/${data.setId}`, {
        reps: data.reps,
        weight: data.weight,
        rpe: data.rpe ?? null,
        is_completed: true,
      });
      return res.data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['session', id] });
      setSetEdits(prev => { const n = { ...prev }; delete n[vars.setId]; return n; });
      setJustCompletedSetId(vars.setId);
      setTimeout(() => setJustCompletedSetId(null), 700);
      const cfg = restConfig[vars.seId] ?? { enabled: true, duration: 90 };
      if (cfg.enabled) startRest(cfg.duration, vars.seId);

      // Record outcome if a suggestion exists for this exercise
      const se = session?.exercises.find(e => e.id === vars.seId);
      if (se) {
        const suggestion = suggestionsMap[se.exercise_id];
        if (suggestion?.log_id) {
          recordOutcomeMutation.mutate({
            logId: suggestion.log_id,
            reps: vars.reps,
            weight: vars.weight,
            rpe: vars.rpe,
          });
        }
      }
    },
  });

  // Uncheck: marks is_completed=false, restores edit state with logged values
  const uncompleteSetMutation = useMutation({
    mutationFn: async (data: { setId: string; reps: number; weight: number; rpe?: number }) => {
      const res = await api.put(`/api/sessions/exercise-sets/${data.setId}`, { is_completed: false });
      return res.data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['session', id] });
      // Restore edit state with the values that were logged
      setSetEdits(prev => ({
        ...prev,
        [vars.setId]: {
          reps: String(vars.reps),
          weight: String(vars.weight),
          rpe: vars.rpe != null ? String(vars.rpe) : '',
        },
      }));
      // If rest timer was running, dismiss it since we're going back
      dismissRest();
    },
  });

  const deleteSetMutation = useMutation({
    mutationFn: async (setId: string) => { await api.delete(`/api/sessions/exercise-sets/${setId}`); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session', id] }),
  });

  const replaceExerciseMutation = useMutation({
    mutationFn: async ({ oldSeId, newExerciseId }: { oldSeId: string; newExerciseId: string }) => {
      const oldExercise = session?.exercises.find(se => se.id === oldSeId);
      const orderIndex = session?.exercises.findIndex(se => se.id === oldSeId) ?? 0;
      const oldSets = oldExercise?.sets ?? [];
      const setCount = Math.max(oldSets.length, 1);
      const refSet = oldSets.filter(s => !s.is_completed).at(-1) ?? oldSets.at(-1) ?? { reps: 10, weight: 0 };
      const oldExerciseId = oldExercise?.exercise_id ?? '';
      const oldExerciseName = allExercises?.find(e => e.id === oldExerciseId)?.name ?? 'exercise';
      const oldSetsSnapshot = oldSets.map((s, i) => ({
        set_number: i + 1, reps: s.reps, weight: s.weight, is_warmup: s.is_warmup ?? false,
      }));
      if (oldSetsSnapshot.length === 0) {
        oldSetsSnapshot.push({ set_number: 1, reps: refSet.reps, weight: refSet.weight, is_warmup: false });
      }
      await api.delete(`/api/sessions/session-exercises/${oldSeId}`);
      const addRes = await api.post(`/api/sessions/${id}/exercises`, { exercise_id: newExerciseId, order_index: orderIndex });
      const newSeId = addRes.data.id;
      for (let i = 0; i < setCount; i++) {
        await api.post(`/api/sessions/session-exercises/${newSeId}/sets`, {
          set_number: i + 1, reps: refSet.reps, weight: refSet.weight, is_warmup: false,
        });
      }
      return { newSeId, oldExerciseId, oldExerciseName, orderIndex, oldSetsSnapshot };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['session', id] });
      setReplaceExerciseSeId(null);
      setReplaceExerciseSearch('');
      // Set undo info and auto-clear after 5s
      if (replaceUndoTimerRef.current) clearTimeout(replaceUndoTimerRef.current);
      setReplaceUndo({
        oldExerciseId: data.oldExerciseId,
        oldExerciseName: data.oldExerciseName,
        newSeId: data.newSeId,
        orderIndex: data.orderIndex,
        sets: data.oldSetsSnapshot,
      });
      replaceUndoTimerRef.current = setTimeout(() => setReplaceUndo(null), 5000);
    },
  });

  const undoReplaceMutation = useMutation({
    mutationFn: async () => {
      if (!replaceUndo) return;
      await api.delete(`/api/sessions/session-exercises/${replaceUndo.newSeId}`);
      const addRes = await api.post(`/api/sessions/${id}/exercises`, {
        exercise_id: replaceUndo.oldExerciseId,
        order_index: replaceUndo.orderIndex,
      });
      const restoredSeId = addRes.data.id;
      for (const s of replaceUndo.sets) {
        await api.post(`/api/sessions/session-exercises/${restoredSeId}/sets`, s);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session', id] });
      if (replaceUndoTimerRef.current) clearTimeout(replaceUndoTimerRef.current);
      setReplaceUndo(null);
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => { const res = await api.post(`/api/sessions/${id}/complete`); return res.data; },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session', id] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setIsConfettiActive(true);
      setTimeout(() => {
        setIsConfettiActive(false);
        router.push('/sessions');
      }, 2500);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => { const res = await api.post(`/api/sessions/${id}/cancel`); return res.data; },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session', id] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      router.push('/sessions');
    },
  });

  const startMutation = useMutation({
    mutationFn: async () => { const res = await api.post(`/api/sessions/${id}/start`); return res.data; },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session', id] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const syncFitbitMutation = useMutation({
    mutationFn: async () => { const res = await api.post(`/api/fitbit/sync-session/${id}`); return res.data; },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session', id] }),
  });

  // Apply plan
  const { data: userPlans } = useQuery<WorkoutPlan[]>({
    queryKey: ['plans'],
    queryFn: async () => {
      const res = await api.get('/api/plans');
      return res.data;
    },
    enabled: applyPlanOpen,
  });

  const { data: plansProgress } = useQuery<Record<string, {
    current_week: number;
    last_completed_at: string | null;
    last_session_name: string;
    completed_session_ids: string[];
  }>>({
    queryKey: ['plans-progress'],
    queryFn: async () => {
      const res = await api.get('/api/plans/progress');
      return res.data;
    },
    enabled: applyPlanOpen,
  });

  const previewMutation = useMutation({
    mutationFn: async (planSessionId: string) => {
      const res = await api.get(`/api/plans/plan-sessions/${planSessionId}/preview`);
      return res.data as ExerciseProgressionSuggestion[];
    },
    onSuccess: (data) => {
      setSuggestions(data);
      const init: Record<string, { weight: string; include: boolean }> = {};
      for (const s of data) {
        init[s.plan_exercise_id] = { weight: s.suggested_weight != null ? String(s.suggested_weight) : '', include: true };
      }
      setOverrides(init);
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!suggestions) return;
      await api.post(`/api/plans/plan-sessions/${selectedPlanSessionId}/apply`, {
        training_session_id: id,
        overrides: suggestions.map(s => ({
          plan_exercise_id: s.plan_exercise_id,
          weight: parseFloat(overrides[s.plan_exercise_id]?.weight || '0') || null,
          include: overrides[s.plan_exercise_id]?.include ?? true,
        })),
      });
      if (selectedPlanSessionName) {
        await api.put(`/api/sessions/${id}`, { name: selectedPlanSessionName });
      }
    },
    onSuccess: () => {
      if ((session?.exercises.length ?? 0) === 0) pageLoadTime.current = Date.now();
      queryClient.invalidateQueries({ queryKey: ['session', id] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setApplyPlanOpen(false);
      setSuggestions(null);
      setSelectedPlanSessionId('');
      setSelectedPlanSessionName('');
      setApplyError(null);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to apply template. Please try again.';
      setApplyError(msg);
    },
  });

  const toggleHistory = (seId: string) =>
    setExpandedHistory(prev => { const n = new Set(prev); void (n.has(seId) ? n.delete(seId) : n.add(seId)); return n; });

  // ── Render helpers ────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-14 rounded-xl bg-muted animate-pulse" />
        <div className="h-56 rounded-xl bg-muted animate-pulse" />
        <div className="h-56 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  if (!session) return <div className="py-24 text-center text-muted-foreground">Session not found.</div>;

  let dateStr = session.scheduled_date;
  try { dateStr = format(new Date(session.scheduled_date + 'T00:00:00'), 'EEEE, MMMM d, yyyy'); } catch {}

  const statusVariant =
    session.status === 'completed' ? 'default'
    : session.status === 'cancelled' ? 'destructive'
    : 'secondary';

  function fmtDuration(secs: number) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function fmtVol(v: number) {
    return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toLocaleString();
  }

  return (
    <div className="space-y-4 pb-36 slide-up-page">

      <ConfettiEffect active={isConfettiActive} />

      {/* ── Sticky header: ← | timer | action ─────────────────────────────── */}
      <div className="sticky top-0 md:top-14 z-30 -mx-4 bg-background/95 backdrop-blur border-b px-3 py-2">
        <div className="max-w-3xl mx-auto grid grid-cols-3 items-center">

          {/* Left: back */}
          <div className="flex justify-start">
            <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={() => router.back()}>
              <ChevronLeft className="size-4" />
            </Button>
          </div>

          {/* Center: live timer or status */}
          <div className="flex justify-center">
            {session.status === 'in_progress' && session.exercises.length > 0 ? (() => {
              void elapsed;
              const started = session.start_time
                ? new Date(session.start_time + 'Z').getTime()
                : pageLoadTime.current;
              const liveSecs = Math.max(0, Math.floor((Date.now() - started) / 1000));
              const h = Math.floor(liveSecs / 3600);
              const m = Math.floor((liveSecs % 3600) / 60);
              const s = liveSecs % 60;
              const label = h > 0
                ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
                : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
              return (
                <span className="flex items-center gap-1 text-sm font-mono font-bold tabular-nums text-foreground">
                  <Clock className="size-3.5 text-muted-foreground" />{label}
                </span>
              );
            })() : (
              <Badge variant={statusVariant} className="text-xs">{formatStatus(session.status)}</Badge>
            )}
          </div>

          {/* Right: primary action */}
          <div className="flex justify-end gap-1.5">
            {session.status === 'scheduled' && (
              <Button variant="ghost" size="sm" onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending} className="h-8 text-muted-foreground text-xs px-2">
                Cancel
              </Button>
            )}
            {session.status === 'scheduled' && session.exercises.length > 0 && (
              <Button size="sm" onClick={() => startMutation.mutate()}
                disabled={startMutation.isPending} className="h-8 gap-1">
                {startMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                Start
              </Button>
            )}
            {session.status !== 'completed' && session.status !== 'cancelled' && completedSets > 0 && (
              <Button size="sm" onClick={() => setIsFinishDialogOpen(true)}
                disabled={completeMutation.isPending}
                className="h-8 gap-1 bg-green-600 hover:bg-green-700 text-white">
                {completeMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                Finish
              </Button>
            )}
            {(session.status === 'completed' || session.status === 'cancelled') && (
              <Button variant={isEditing ? 'default' : 'outline'} size="sm"
                onClick={() => setIsEditing(!isEditing)} className="h-8 gap-1">
                <Pencil className="size-3.5" />
                {isEditing ? 'Lock' : 'Edit'}
              </Button>
            )}
          </div>

        </div>
      </div>

      {/* ── Session title — fades out on scroll ────────────────────────────── */}
      <div
        style={{ opacity: titleOpacity, transform: `translateY(${(1 - titleOpacity) * -8}px)`, transition: 'none' }}
        className="px-1 pt-1"
      >
        <h1 className="font-bold text-2xl leading-tight break-words">{session.name}</h1>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-sm text-muted-foreground">{dateStr}</span>
          {totalVolume > 0 && (
            <span className="flex items-center gap-1 text-sm text-primary font-semibold">
              <Flame className="size-3.5" />
              {totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(1)}k` : totalVolume.toLocaleString()} lbs
            </span>
          )}
        </div>
      </div>

      <Dialog open={isFinishDialogOpen} onOpenChange={setIsFinishDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Trophy className="size-5 text-yellow-500" />
              Finish workout
            </DialogTitle>
          </DialogHeader>

          {isSummaryLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : preSummary ? (
            <div className="space-y-4">
              {/* Workout number badge */}
              <div className="flex items-center justify-center">
                <span className="text-3xl font-bold tabular-nums">#{preSummary.workout_number}</span>
                <span className="ml-2 text-sm text-muted-foreground self-end mb-1">workout</span>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-3">
                {preSummary.duration_seconds != null && (
                  <div className="rounded-xl bg-muted/60 px-3 py-2.5 flex flex-col gap-0.5">
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Clock className="size-3" /> Duration
                    </span>
                    <span className="font-semibold tabular-nums">{fmtDuration(preSummary.duration_seconds)}</span>
                  </div>
                )}
                <div className="rounded-xl bg-muted/60 px-3 py-2.5 flex flex-col gap-0.5">
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Weight className="size-3" /> Volume
                  </span>
                  <span className="font-semibold tabular-nums">{fmtVol(preSummary.total_volume)} lbs</span>
                </div>
                <div className="rounded-xl bg-muted/60 px-3 py-2.5 flex flex-col gap-0.5">
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Dumbbell className="size-3" /> Exercises
                  </span>
                  <span className="font-semibold tabular-nums">{preSummary.exercise_count}</span>
                </div>
                <div className="rounded-xl bg-muted/60 px-3 py-2.5 flex flex-col gap-0.5">
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <CheckCircle2 className="size-3" /> Sets
                  </span>
                  <span className="font-semibold tabular-nums">{preSummary.completed_sets}/{preSummary.total_sets}</span>
                </div>
              </div>

              {/* PRs */}
              {preSummary.prs.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-yellow-600 dark:text-yellow-400 flex items-center gap-1.5">
                    <Trophy className="size-3.5" /> New Personal Records
                  </p>
                  <div className="space-y-1">
                    {preSummary.prs.map(pr => (
                      <div key={pr.exercise_name} className="flex items-center justify-between rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800/40 px-3 py-1.5">
                        <span className="text-xs font-medium break-words whitespace-normal mr-2">{pr.exercise_name}</span>
                        <span className="text-xs tabular-nums text-muted-foreground shrink-0">
                          {pr.old_max > 0 ? `${pr.old_max} → ` : ''}<span className="text-yellow-600 dark:text-yellow-400 font-semibold">{pr.new_max} lbs</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm"><strong>Sets completed:</strong> {completedSets}/{session.exercises.reduce((sum, se) => sum + se.sets.length, 0)}</p>
              <p className="text-sm"><strong>Total volume:</strong> {fmtVol(totalVolume)} lbs</p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFinishDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                completeMutation.mutate();
                setIsFinishDialogOpen(false);
              }}
              disabled={completeMutation.isPending}
            >
              {completeMutation.isPending ? 'Saving…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Exercise list ───────────────────────────────────────────────────── */}
      {session.exercises.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="size-16 rounded-2xl bg-muted flex items-center justify-center">
            <Dumbbell className="size-8 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="font-semibold">No exercises yet</p>
            <p className="text-sm text-muted-foreground mt-1">Apply a plan template or add exercises manually</p>
          </div>
          <Button variant="outline" className="gap-2" onClick={() => setApplyPlanOpen(true)}>
            <TrendingUp className="size-4" />Apply Plan Template
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {[...session.exercises].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)).map((se: SessionExercise, idx: number) => {
            const historyOpen = expandedHistory.has(se.id);
            const completedCount = se.sets.filter(s => s.is_completed).length;
            const totalCount = se.sets.length;
            const exVol = se.sets.filter(s => s.is_completed).reduce((t, s) => t + s.reps * s.weight, 0);
            const firstPendingId = se.sets.find(s => !s.is_completed)?.id;
            const cfg = restConfig[se.id] ?? { enabled: true, duration: se.rest_seconds ?? defaultRestSecs };
            const suggestion = suggestionsMap[se.exercise_id];

            // Compute ghost placeholder text for pending sets.
            const ghostMap = computeGhostMap(
              se.sets,
              (id) => getEdit(se.sets.find(s => s.id === id)!).weight ?? '',
              (id) => getEdit(se.sets.find(s => s.id === id)!).reps ?? '',
            );

            // Exercise card swipe values
            const swX = exSwipeX[se.id] ?? 0;
            const swOp = Math.min(1, Math.abs(swX) / 80);

            return (
              <div
                key={se.id}
                className="relative animate-in fade-in slide-in-from-bottom-2 duration-300"
                style={{ animationDelay: `${idx * 40}ms`, animationFillMode: 'both', touchAction: 'pan-y' }}
                onTouchStart={e => { exTouchRef.current[se.id] = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
                onTouchMove={e => {
                  const start = exTouchRef.current[se.id];
                  if (!start) return;
                  const dx = e.touches[0].clientX - start.x;
                  const dy = e.touches[0].clientY - start.y;
                  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 6)
                    setExSwipeX(prev => ({ ...prev, [se.id]: Math.max(0, Math.min(110, dx)) }));
                }}
                onTouchEnd={() => {
                  const sw = exSwipeX[se.id] ?? 0;
                  if (sw > 80) setReplaceExerciseSeId(se.id);
                  setExSwipeX(prev => { const n = { ...prev }; delete n[se.id]; return n; });
                  delete exTouchRef.current[se.id];
                }}
              >
                {/* Swipe right = replace background only */}
                <div className="absolute inset-0 rounded-xl bg-primary flex items-center pl-5 pointer-events-none" style={{ opacity: swX > 0 ? swOp : 0 }}>
                  <Dumbbell className="size-6 text-primary-foreground" />
                </div>

                {/* Card */}
                <div
                  className="rounded-xl border border-border bg-card overflow-hidden"
                  style={{
                    transform: `translateX(${swX}px)`,
                    transition: swX === 0 ? 'transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none',
                  }}
                >
                {collapsedExercises.has(se.id) ? (
                  /* ── Collapsed view — single compact row, tap to expand ── */
                  <button
                    type="button"
                    aria-expanded={false}
                    aria-label={`Expand ${se.exercise.name}`}
                    className="w-full flex items-center gap-2.5 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors text-left animate-in fade-in slide-in-from-top-1 duration-200"
                    onClick={() => {
                      userExpandedRef.current.add(se.id);
                      setCollapsedExercises(prev => { const n = new Set(prev); n.delete(se.id); return n; });
                    }}
                  >
                    <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                    <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full shrink-0', muscleColor(se.exercise.muscle_group))}>
                      {se.exercise.muscle_group}
                    </span>
                    <span className="font-semibold text-sm break-words whitespace-normal">{se.exercise.name}</span>
                    <div className="ml-auto flex items-center gap-2 shrink-0">
                      <span className="text-xs tabular-nums font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded">
                        {completedCount}/{totalCount}
                      </span>
                      {exVol > 0 && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {exVol >= 1000 ? `${(exVol / 1000).toFixed(1)}k` : exVol} lbs
                        </span>
                      )}
                      <ChevronDown className="size-3.5 text-muted-foreground" />
                    </div>
                  </button>
                ) : (
                  /* ── Expanded view — full card ── */
                  <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                {/* Exercise header — mobile-first: name row + metrics row with dedicated icon buttons */}
                <div className="border-b border-border/50">
                  {/* Row 1 — name region (tap to collapse when all done) + icon buttons */}
                  <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
                    {completedCount === totalCount && totalCount > 0 ? (
                      <button
                        type="button"
                        aria-expanded={true}
                        aria-label={`Collapse ${se.exercise.name}`}
                        onClick={() => {
                          userExpandedRef.current.delete(se.id);
                          setCollapsedExercises(prev => new Set(prev).add(se.id));
                        }}
                        className="flex-1 min-w-0 flex items-center gap-2 text-left -ml-1 px-1 py-1 rounded-md hover:bg-muted/40 active:bg-muted/60 transition-colors"
                      >
                        <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0', muscleColor(se.exercise.muscle_group))}>
                          {se.exercise.muscle_group}
                        </span>
                        <span className="min-w-0 font-semibold text-sm break-words whitespace-normal">{se.exercise.name}</span>
                        {totalCount > 0 && (
                          <span className={cn(
                            'text-[10px] tabular-nums font-medium px-1.5 py-0.5 rounded ml-1',
                            completedCount === totalCount && totalCount > 0
                              ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20'
                              : 'text-muted-foreground bg-muted/40',
                          )}>
                            {completedCount}/{totalCount}
                          </span>
                        )}
                        <ChevronUp className="size-3.5 shrink-0 text-emerald-500" />
                      </button>
                    ) : (
                      <div className="flex-1 min-w-0 flex items-center gap-2 px-1 py-1 -ml-1">
                        <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0', muscleColor(se.exercise.muscle_group))}>
                          {se.exercise.muscle_group}
                        </span>
                        <span className="min-w-0 font-semibold text-sm break-words whitespace-normal">{se.exercise.name}</span>
                        {totalCount > 0 && (
                          <span className={cn(
                            'text-[10px] tabular-nums font-medium px-1.5 py-0.5 rounded ml-1',
                            completedCount === totalCount && totalCount > 0
                              ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20'
                              : 'text-muted-foreground bg-muted/40',
                          )}>
                            {completedCount}/{totalCount}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-0.5 shrink-0 -mr-1">
                      <button
                        type="button"
                        aria-label={historyOpen ? 'Hide history' : 'Show history'}
                        aria-pressed={historyOpen}
                        onClick={e => { e.stopPropagation(); toggleHistory(se.id); }}
                        className={cn(
                          'size-9 flex items-center justify-center rounded-full transition-colors',
                          historyOpen ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60',
                        )}
                      >
                        <Clock className="size-4" />
                      </button>
                      {isEditing && (
                        <button
                          type="button"
                          aria-label="Remove exercise"
                          title="Remove exercise"
                          onClick={e => { e.stopPropagation(); removeExerciseMutation.mutate(se.id); }}
                          className="size-9 flex items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <X className="size-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* AI suggestion strip — weight + sets, or no-history note */}
                  {!suggestion && (
                    <div className="flex items-center gap-1.5 px-4 pb-2.5">
                      <Sparkles className="size-3 shrink-0 text-muted-foreground/30" />
                      <span className="text-xs text-muted-foreground/40">No history yet — log a set to get suggestions</span>
                    </div>
                  )}
                  {suggestion && suggestion.suggested_weight > 0 && (() => {
                    const pendingSets = se.sets.filter(s => !s.is_completed);
                    // Check pending sets via edit state, and completed sets via their logged weight
                    const pendingMatch = pendingSets.length === 0 || pendingSets.every(s =>
                      (setEdits[s.id]?.weight ?? '') === String(suggestion.suggested_weight)
                    );
                    const completedAtSuggestion = se.sets.some(s => s.is_completed && s.weight === suggestion.suggested_weight);
                    const isApplied = pendingMatch && completedAtSuggestion;
                    const currentSets = se.sets.length;
                    const needsMoreSets = suggestion.suggested_sets > currentSets;

                    // Show only the actionable last segment of the pipe-separated reason
                    const reasonParts = suggestion.adjustment_reason?.split(' | ') ?? [];
                    const shortReason = reasonParts[reasonParts.length - 1] ?? '';
                    
                    const isDeload = suggestion.meso_phase === 'deload';

                    return (
                      <div
                        className={cn(
                          'px-4 pb-2.5 flex items-center justify-between gap-3',
                          suggestionFlash[se.id] === 'apply' && 'suggestion-apply-pop',
                          suggestionFlash[se.id] === 'undo' && 'suggestion-undo-shake',
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <Sparkles className={cn('size-3 shrink-0', isApplied ? 'text-emerald-500' : isDeload ? 'text-blue-500' : 'text-amber-500')} />
                          
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              if (!isEditing) return;
                              if (isApplied) {
                                setSetEdits(prev => {
                                  const next = { ...prev };
                                  for (const s of se.sets) {
                                    if (!s.is_completed) next[s.id] = { ...(next[s.id] ?? {}), weight: '' };
                                  }
                                  return next;
                                });
                                flashSuggestion(se.id, 'undo');
                              } else {
                                applyWeightSuggestion(se.id, suggestion.suggested_weight);
                                flashSuggestion(se.id, 'apply');
                              }
                            }}
                            className="flex items-center gap-1.5 min-w-0 text-left"
                            disabled={!isEditing}
                          >
                            <span className="text-xs text-muted-foreground break-words">
                              {isApplied ? (
                                <>
                                  <span className="font-medium text-emerald-600 dark:text-emerald-400">Applied</span>
                                  <span className="text-muted-foreground/60"> · {suggestion.suggested_weight} lbs</span>
                                </>
                              ) : (
                                <>
                                  <span className={cn(
                                    'font-bold tabular-nums shrink-0',
                                    isDeload ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'
                                  )}>{suggestion.suggested_weight} lbs</span>
                                  
                                  <span className="ml-1.5 font-medium text-muted-foreground shrink-0">@ RPE {suggestion.target_rpe}</span>
                                  
                                  {suggestion.estimated_1rm && (
                                    <span className="ml-1.5 px-1 rounded bg-muted text-[10px] text-muted-foreground font-medium shrink-0">
                                      e1RM: {suggestion.estimated_1rm}
                                    </span>
                                  )}

                                  {isDeload ? (
                                    <span className="ml-1.5 px-1 rounded bg-blue-100 dark:bg-blue-900/30 text-[10px] text-blue-700 dark:text-blue-300 font-bold uppercase tracking-wider shrink-0">Deload</span>
                                  ) : (
                                    <span className="ml-1.5 text-muted-foreground/50 shrink-0">· Wk {suggestion.meso_week}</span>
                                  )}
                                  
                                  {shortReason && (
                                    <span className="ml-1.5 text-muted-foreground/40 italic break-words">· {shortReason}</span>
                                  )}
                                </>
                              )}
                            </span>
                            {!isApplied && isEditing && (
                              <span className="text-[10px] font-bold text-amber-600/60 dark:text-amber-400/60 uppercase tracking-tighter">Apply</span>
                            )}
                          </button>
                        </div>

                        {isEditing && needsMoreSets && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px] font-bold gap-1 bg-primary/5 text-primary hover:bg-primary/10 border border-primary/20"
                            onClick={(e) => {
                              e.stopPropagation();
                              const last = se.sets[se.sets.length - 1];
                              addSetMutation.mutate({
                                seId: se.id,
                                setNumber: se.sets.length + 1,
                                reps: last?.reps ?? 10,
                                weight: last?.weight ?? 0,
                              });
                            }}
                          >
                            <Plus className="size-2.5" />
                            {suggestion.suggested_sets} Sets
                          </Button>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Rest timer control */}
                <div className="flex items-center px-4 py-1.5 bg-muted/10 border-b border-border/20">
                  <RestControl
                    enabled={cfg.enabled}
                    duration={cfg.duration}
                    onToggle={() =>
                      setRestConfig(prev => ({
                        ...prev,
                        [se.id]: { ...cfg, enabled: !cfg.enabled },
                      }))
                    }
                    onChangeDuration={v =>
                      setRestConfig(prev => ({
                        ...prev,
                        [se.id]: { ...cfg, duration: v },
                      }))
                    }
                  />
                </div>


                {/* History panel */}
                <ExerciseHistoryPanel exerciseId={se.exercise_id} open={historyOpen} isBodyweight={se.exercise.category === 'bodyweight'} />

                {/* Column headers — aligned to SetRow layout */}
                {se.sets.length > 0 && (
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/20 border-b border-border/10">
                    <span className="w-12 shrink-0 text-[10px] text-muted-foreground uppercase tracking-wide text-center"># / Prev</span>
                    {se.exercise.category !== 'bodyweight' && (
                      <span className="flex-1 text-[10px] text-muted-foreground uppercase tracking-wide text-center">Lbs</span>
                    )}
                    <span className="flex-1 text-[10px] text-muted-foreground uppercase tracking-wide text-center">Reps</span>
                    <span className="w-11 shrink-0 text-[10px] text-muted-foreground uppercase tracking-wide text-center">RPE</span>
                    <span className="w-11 shrink-0" />
                  </div>
                )}

                {/* Set rows */}
                <div>
                  {[...se.sets].sort((a, b) => a.set_number - b.set_number).map(s => {
                    const edit = getEdit(s);
                    const isBodyweight = se.exercise.category === 'bodyweight';
                    const prevSet = prevSetsMap[se.exercise_id]?.[s.set_number];
                    const ghost = ghostMap[s.id];
                    const lastCompleted = [...se.sets].reverse().find(x => x.is_completed && x.id !== s.id);
                    const autoReps = edit.reps || ghost?.reps || String(lastCompleted?.reps ?? prevSet?.reps ?? '');
                    const autoWeight = isBodyweight ? '0' : (edit.weight || ghost?.weight || String(lastCompleted?.weight ?? prevSet?.weight ?? ''));
                    const canComplete = isBodyweight ? !!autoReps : (!!autoReps && !!autoWeight);
                    return (
                      <SetRow
                        key={s.id}
                        set={s}
                        isActive={s.id === firstPendingId}
                        editVal={edit}
                        isEditable={isEditing}
                        isBodyweight={isBodyweight}
                        isJustCompleted={s.id === justCompletedSetId}
                        prevSet={prevSet}
                        ghostVal={ghostMap[s.id]}
                        onEdit={(field, val) => updateEdit(se.id, s.id, field, val)}
                        onComplete={() => {
                          const ghost = ghostMap[s.id];
                          let reps = parseInt(edit.reps) || parseInt(ghost?.reps ?? '') || parseInt(String(lastCompleted?.reps ?? prevSet?.reps ?? 0));
                          let weight = isBodyweight ? 0 : (parseFloat(edit.weight) || parseFloat(ghost?.weight ?? '') || parseFloat(String(lastCompleted?.weight ?? prevSet?.weight ?? 0)));
                          if (!reps) return;
                          if (!isBodyweight && !weight) return;
                          completeSetMutation.mutate({
                            setId: s.id,
                            seId: se.id,
                            reps,
                            weight,
                            rpe: edit.rpe ? parseFloat(edit.rpe) : undefined,
                          });
                        }}
                        onUncheck={() =>
                          uncompleteSetMutation.mutate({
                            setId: s.id,
                            reps: s.reps,
                            weight: s.weight,
                            rpe: s.rpe,
                          })
                        }
                        onDelete={() => deleteSetMutation.mutate(s.id)}
                        isCompleting={completeSetMutation.isPending && completeSetMutation.variables?.setId === s.id}
                        isUnchecking={uncompleteSetMutation.isPending && uncompleteSetMutation.variables?.setId === s.id}
                        canComplete={canComplete}
                      />
                    );
                  })}
                </div>

                {/* Inline rest timer */}
                {rest.active && restTimerSeId === se.id && (
                  <InlineRestTimer state={rest} onAdjust={adjustRest} onDismiss={dismissRest} />
                )}

                {/* Add Set */}
                <div className="px-3 py-2 border-t border-border/20">
                  <button
                    onClick={() => {
                      const last = se.sets[se.sets.length - 1];
                      addSetMutation.mutate({
                        seId: se.id,
                        setNumber: se.sets.length + 1,
                        reps: last?.reps ?? 10,
                        weight: last?.weight ?? 0,
                      });
                    }}
                    disabled={addSetMutation.isPending && addSetMutation.variables?.seId === se.id}
                    className="flex items-center gap-1.5 text-xs text-primary/70 hover:text-primary transition-colors py-0.5 font-medium"
                  >
                    <Plus className="size-3.5" />
                    Add Set
                  </button>
                </div>
                  </div>
                )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add Exercise ───────────────────────────────────────────────────── */}
      {isEditing && (
      <BottomSheet open={addExerciseOpen} onOpenChange={open => { setAddExerciseOpen(open); if (!open) { setExerciseSearch(''); setAddMuscleFilter(null); setAddCategoryFilter(null); } }}>
        <BottomSheetTrigger render={<Button variant="outline" className="w-full gap-2"><Plus className="size-4" />Add Exercise</Button>} />
        <BottomSheetContent title="Add Exercise">
          <div className="px-4 pb-2 shrink-0">
            <Input placeholder="Search exercises…" value={exerciseSearch} onChange={e => setExerciseSearch(e.target.value)} autoFocus className="h-11 text-base" />
          </div>
          <div className="px-4 pb-3 shrink-0 flex gap-2">
            <Select value={addMuscleFilter ?? ''} onValueChange={v => setAddMuscleFilter(v || null)}>
              <SelectTrigger className="flex-1 h-10 text-sm">
                <SelectValue placeholder="Muscle group" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All muscles</SelectItem>
                {muscleGroups.map(mg => <SelectItem key={mg} value={mg.toLowerCase()}>{mg}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={addCategoryFilter ?? ''} onValueChange={v => setAddCategoryFilter(v || null)}>
              <SelectTrigger className="flex-1 h-10 text-sm capitalize">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All types</SelectItem>
                {categories.map(cat => <SelectItem key={cat} value={cat.toLowerCase()} className="capitalize">{cat}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-8">
            {filteredExercises.length === 0
              ? <p className="text-sm text-muted-foreground py-8 text-center">{exerciseSearch || addMuscleFilter || addCategoryFilter ? 'No matches' : 'All exercises added'}</p>
              : filteredExercises.map(ex => (
                  <button key={ex.id} onClick={() => addExerciseMutation.mutate(ex.id)}
                    disabled={addExerciseMutation.isPending}
                    className="w-full text-left px-3 py-3.5 rounded-xl active:bg-muted transition-colors flex items-center justify-between gap-3">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-medium text-[15px] break-words whitespace-normal">{ex.name}</span>
                      {ex.category && <span className="text-xs text-muted-foreground capitalize">{ex.category}</span>}
                    </div>
                    <span className={cn('text-xs px-2.5 py-1 rounded-full shrink-0', muscleColor(ex.muscle_group))}>{ex.muscle_group}</span>
                  </button>
                ))}
          </div>
        </BottomSheetContent>
      </BottomSheet>
      )}

      {/* ── Replace Exercise ──────────────────────────────────────────────── */}
      <BottomSheet open={!!replaceExerciseSeId} onOpenChange={open => { if (!open) { setReplaceExerciseSeId(null); setReplaceExerciseSearch(''); setReplaceMuscleFilter(null); setReplaceCategoryFilter(null); } }}>
        <BottomSheetContent title="Replace Exercise">
          <div className="px-4 pb-2 shrink-0">
            <Input placeholder="Search exercises…" value={replaceExerciseSearch} onChange={e => setReplaceExerciseSearch(e.target.value)} autoFocus className="h-11 text-base" />
          </div>
          <div className="px-4 pb-3 shrink-0 flex gap-2">
            <Select value={replaceMuscleFilter ?? ''} onValueChange={v => setReplaceMuscleFilter(v || null)}>
              <SelectTrigger className="flex-1 h-10 text-sm">
                <SelectValue placeholder="Muscle group" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All muscles</SelectItem>
                {muscleGroups.map(mg => <SelectItem key={mg} value={mg.toLowerCase()}>{mg}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={replaceCategoryFilter ?? ''} onValueChange={v => setReplaceCategoryFilter(v || null)}>
              <SelectTrigger className="flex-1 h-10 text-sm capitalize">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All types</SelectItem>
                {categories.map(cat => <SelectItem key={cat} value={cat.toLowerCase()} className="capitalize">{cat}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-8">
            {replaceFilteredExercises.length === 0
              ? <p className="text-sm text-muted-foreground py-8 text-center">{replaceExerciseSearch || replaceMuscleFilter || replaceCategoryFilter ? 'No matches' : 'Loading…'}</p>
              : replaceFilteredExercises.map(ex => (
                  <button key={ex.id}
                    onClick={() => replaceExerciseMutation.mutate({ oldSeId: replaceExerciseSeId!, newExerciseId: ex.id })}
                    disabled={replaceExerciseMutation.isPending}
                    className="w-full text-left px-3 py-3.5 rounded-xl active:bg-muted transition-colors flex items-center justify-between gap-3">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-medium text-[15px] break-words whitespace-normal">{ex.name}</span>
                      {ex.category && <span className="text-xs text-muted-foreground capitalize">{ex.category}</span>}
                    </div>
                    <span className={cn('text-xs px-2.5 py-1 rounded-full shrink-0', muscleColor(ex.muscle_group))}>{ex.muscle_group}</span>
                  </button>
                ))}
          </div>
        </BottomSheetContent>
      </BottomSheet>

      {/* ── Replace undo snackbar ────────────────────────────────────────────── */}
      {replaceUndo && (
        <div className="fixed bottom-24 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 bg-foreground text-background rounded-xl px-4 py-3 shadow-xl text-sm animate-in slide-in-from-bottom-2 duration-200">
            <span className="font-medium break-words whitespace-normal">Replaced <span className="opacity-60">{replaceUndo.oldExerciseName}</span></span>
            <button
              onClick={() => undoReplaceMutation.mutate()}
              disabled={undoReplaceMutation.isPending}
              className="font-semibold text-primary-foreground underline underline-offset-2 disabled:opacity-50 shrink-0"
            >
              {undoReplaceMutation.isPending ? 'Undoing…' : 'Undo'}
            </button>
          </div>
        </div>
      )}

      {/* ── Apply Plan ─────────────────────────────────────────────────────── */}
      <Dialog open={applyPlanOpen} onOpenChange={open => {
        setApplyPlanOpen(open);
        if (!open) {
          setSuggestions(null);
          setSelectedPlanId('');
          setSelectedWeekNum(null);
          setSelectedPlanSessionId('');
          setSelectedPlanSessionName('');
          setApplyError(null);
        }
      }}>
        <DialogContent className="w-full max-w-lg h-[92dvh] max-h-[92dvh] flex flex-col p-0 gap-0 rounded-2xl overflow-hidden">

          {/* ── Header ── */}
          {(() => {
            const activePlan = userPlans?.find(p => p.id === selectedPlanId);
            const isReview = !!suggestions;
            const isDay = !isReview && !!selectedPlanId && selectedWeekNum !== null;
            const isWeek = !isReview && !!selectedPlanId && selectedWeekNum === null;
            const isPlan = !isReview && !selectedPlanId;

            return (
              <div className="flex items-center gap-3 px-4 pt-5 pb-3 shrink-0">
                {!isPlan && (
                  <button
                    onClick={() => {
                      if (isReview) { setSuggestions(null); setSelectedPlanSessionId(''); setSelectedPlanSessionName(''); setApplyError(null); }
                      else if (isDay) { setSelectedWeekNum(null); }
                      else if (isWeek) { setSelectedPlanId(''); }
                    }}
                    className="shrink-0 size-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors"
                  >
                    <ChevronLeft className="size-5" />
                  </button>
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-base leading-tight">
                    {isPlan && 'Choose a Program'}
                    {isWeek && activePlan?.name}
                    {isDay && `Week ${selectedWeekNum}`}
                    {isReview && 'Review & Adjust'}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {isPlan && 'Select the program to pull from'}
                    {isWeek && 'Which week are you on?'}
                    {isDay && 'Pick today\'s session'}
                    {isReview && 'Tweak weights, then stage your workout'}
                  </p>
                </div>
              </div>
            );
          })()}

          {/* ── Breadcrumb ── */}
          {(selectedPlanId || selectedWeekNum !== null || suggestions) && (() => {
            const activePlan = userPlans?.find(p => p.id === selectedPlanId);
            return (
              <div className="flex items-center gap-1.5 px-4 pb-3 shrink-0">
                <span
                  className={cn('text-xs cursor-pointer', selectedWeekNum !== null || suggestions ? 'text-primary underline underline-offset-2' : 'text-muted-foreground')}
                  onClick={() => { if (selectedWeekNum !== null || suggestions) { setSelectedWeekNum(null); setSuggestions(null); setSelectedPlanSessionId(''); setSelectedPlanSessionName(''); setApplyError(null); } }}
                >{activePlan?.name}</span>
                {selectedWeekNum !== null && (
                  <>
                    <span className="text-xs text-muted-foreground">/</span>
                    <span
                      className={cn('text-xs cursor-pointer', suggestions ? 'text-primary underline underline-offset-2' : 'text-muted-foreground')}
                      onClick={() => { if (suggestions) { setSuggestions(null); setSelectedPlanSessionId(''); setSelectedPlanSessionName(''); setApplyError(null); } }}
                    >Week {selectedWeekNum}</span>
                  </>
                )}
                {suggestions && (
                  <>
                    <span className="text-xs text-muted-foreground">/</span>
                    <span className="text-xs text-muted-foreground break-words whitespace-normal">{selectedPlanSessionName.split(' - ').pop()}</span>
                  </>
                )}
              </div>
            );
          })()}

          <div className="h-px bg-border shrink-0" />

          {/* ── Scrollable body ── */}
          <div className="flex-1 overflow-y-auto px-4 py-4">

            {/* Step 1 — Pick a plan */}
            {!selectedPlanId && !suggestions && (
              <div key="step-plan" className="space-y-3 animate-in fade-in slide-in-from-bottom-3 duration-200">
                {!userPlans?.length && (
                  <p className="text-sm text-muted-foreground text-center py-10">No programs yet. Create a plan first.</p>
                )}
                {[...(userPlans ?? [])]
                  .sort((a, b) => {
                    const ap = plansProgress?.[a.id];
                    const bp = plansProgress?.[b.id];
                    const aStarted = (ap?.completed_session_ids.length ?? 0) > 0;
                    const bStarted = (bp?.completed_session_ids.length ?? 0) > 0;
                    if (aStarted && !bStarted) return -1;
                    if (!aStarted && bStarted) return 1;
                    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                  })
                  .map((plan, i) => {
                  const totalWeeks = plan.plan_sessions.length > 0
                    ? Math.max(...plan.plan_sessions.map(s => s.week_number)) : 0;
                  const pp = plansProgress?.[plan.id];
                  return (
                    <button
                      key={plan.id}
                      onClick={() => setSelectedPlanId(plan.id)}
                      style={{ animationDelay: `${i * 40}ms` }}
                      className="w-full text-left p-4 rounded-2xl border border-border hover:bg-muted/40 hover:border-primary/40 hover:shadow-sm active:scale-[0.98] transition-all duration-150 animate-in fade-in slide-in-from-bottom-2 fill-mode-both"
                    >
                      <div className="font-semibold text-base leading-snug">{plan.name}</div>
                      {pp ? (
                        <div className="mt-2 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-primary">Week {pp.current_week} of {totalWeeks}</span>
                            <span className="text-xs text-muted-foreground">
                              {new Set(pp.completed_session_ids).size}/{plan.plan_sessions.length}
                            </span>
                          </div>
                          <div className="h-1 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${Math.min(100, Math.round(new Set(pp.completed_session_ids).size / plan.plan_sessions.length * 100))}%` }}
                            />
                          </div>
                          {pp.last_completed_at && (
                            <p className="text-xs text-muted-foreground">
                              Last: {pp.last_session_name.replace(/^Week\s+\d+\s*[-–]\s*/i, '')}
                              {' · '}{formatDistanceToNow(new Date(pp.last_completed_at), { addSuffix: true })}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{totalWeeks} weeks</span>
                          <span className="text-xs bg-muted/60 text-muted-foreground/60 px-2 py-0.5 rounded-full">Not started</span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Step 2 — Pick a week */}
            {selectedPlanId && selectedWeekNum === null && !suggestions && (() => {
              const plan = userPlans?.find(p => p.id === selectedPlanId);
              const pp = plansProgress?.[plan?.id ?? ''];
              const currentWeek = pp?.current_week ?? null;
              const completedIds = new Set(pp?.completed_session_ids ?? []);
              const weeks = [...new Set(plan?.plan_sessions.map(s => s.week_number) ?? [])].sort((a, b) => a - b);
              return (
                <div key="step-week" className="grid grid-cols-4 gap-2 animate-in fade-in slide-in-from-bottom-3 duration-200">
                  {weeks.map((wk, i) => {
                    const daySessions = plan?.plan_sessions.filter(s => s.week_number === wk) ?? [];
                    const allDone = daySessions.length > 0 && daySessions.every(s => completedIds.has(s.id));
                    const isCurrent = wk === currentWeek && !allDone;
                    return (
                      <button
                        key={wk}
                        onClick={() => setSelectedWeekNum(wk)}
                        style={{ animationDelay: `${i * 20}ms` }}
                        className={cn(
                          'relative flex flex-col items-center justify-center py-4 rounded-2xl border hover:shadow-sm active:scale-95 transition-all duration-150 gap-0.5 animate-in fade-in zoom-in-95 fill-mode-both',
                          isCurrent
                            ? 'border-primary bg-primary/5 hover:bg-primary/10'
                            : allDone
                              ? 'border-border bg-muted/30 hover:bg-muted/50'
                              : 'border-border hover:bg-muted/40 hover:border-primary/50'
                        )}
                      >
                        {isCurrent && (
                          <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 text-[9px] font-semibold bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full leading-none">NOW</span>
                        )}
                        <span className={cn('text-[10px] uppercase tracking-wide', isCurrent ? 'text-primary' : 'text-muted-foreground')}>Wk</span>
                        <span className={cn('font-bold text-xl leading-none', allDone && 'text-muted-foreground/50')}>{wk}</span>
                        <span className={cn('text-[9px] mt-1', allDone ? 'text-emerald-500 font-medium' : 'text-muted-foreground')}>
                          {allDone ? '✓ done' : `${daySessions.length}d`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            {/* Step 3 — Pick a day */}
            {selectedPlanId && selectedWeekNum !== null && !selectedPlanSessionId && !suggestions && (() => {
              const plan = userPlans?.find(p => p.id === selectedPlanId);
              const pp = plansProgress?.[plan?.id ?? ''];
              const completedIds = new Set(pp?.completed_session_ids ?? []);
              const days = plan?.plan_sessions.filter(s => s.week_number === selectedWeekNum) ?? [];
              return (
                <div key="step-day" className="space-y-3 animate-in fade-in slide-in-from-bottom-3 duration-200">
                  {days.map((ps, i) => {
                    const label = ps.name.replace(/^Week\s+\d+\s*[-–]\s*/i, '');
                    const done = completedIds.has(ps.id);
                    return (
                      <button
                        key={ps.id}
                        onClick={() => { setSelectedPlanSessionId(ps.id); setSelectedPlanSessionName(ps.name); previewMutation.mutate(ps.id); }}
                        disabled={previewMutation.isPending}
                        style={{ animationDelay: `${i * 50}ms` }}
                        className={cn(
                          'w-full text-left p-4 rounded-2xl border hover:shadow-sm active:scale-[0.98] transition-all duration-150 disabled:opacity-50 animate-in fade-in slide-in-from-bottom-2 fill-mode-both',
                          done ? 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10' : 'border-border hover:bg-muted/40 hover:border-primary/40'
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Day {i + 1}</div>
                            <div className={cn('font-semibold text-base leading-snug', done && 'text-muted-foreground')}>{label}</div>
                          </div>
                          {done ? (
                            <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1">✓ done</span>
                          ) : (
                            <span className="shrink-0 text-xs bg-muted text-muted-foreground px-2 py-1 rounded-full mt-1">
                              {ps.exercises.length} ex
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                  {previewMutation.isPending && (
                    <div className="space-y-3 pt-1 animate-in fade-in duration-150">
                      {[1,2,3,4].map(i => <div key={i} className="h-20 rounded-2xl bg-muted animate-pulse" />)}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Step 4 — Review exercises */}
            {suggestions && (
              <div key="step-review" className="space-y-2.5 animate-in fade-in slide-in-from-bottom-3 duration-200">
                {suggestions.map((s, i) => {
                  const ov = overrides[s.plan_exercise_id] ?? { weight: '', include: true };
                  return (
                    <div
                      key={s.plan_exercise_id}
                      style={{ animationDelay: `${i * 35}ms` }}
                      className={cn(
                        'rounded-2xl border p-4 transition-all duration-200 animate-in fade-in slide-in-from-bottom-2 fill-mode-both',
                        ov.include ? 'border-border bg-card' : 'border-border/40 bg-muted/30 opacity-60'
                      )}
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm leading-snug">{s.exercise.name}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-muted-foreground font-medium">{s.target_sets}×{s.target_reps || 'AMRAP'}</span>
                            <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                              <Timer className="size-3" />{fmtSecs(s.rest_seconds)}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => setOverrides(prev => ({ ...prev, [s.plan_exercise_id]: { ...ov, include: !ov.include } }))}
                          className={cn(
                            'text-xs px-3 py-1.5 rounded-xl font-medium transition-all duration-150 shrink-0',
                            ov.include ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                          )}
                        >
                          {ov.include ? 'In' : 'Skip'}
                        </button>
                      </div>
                      {ov.include && s.exercise.category !== 'bodyweight' && (
                        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
                          <div className="relative">
                            <Input type="number" inputMode="decimal" value={ov.weight}
                              onChange={e => setOverrides(prev => ({ ...prev, [s.plan_exercise_id]: { ...ov, weight: e.target.value } }))}
                              className="h-10 text-sm pr-12" placeholder="Target weight" />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">lbs</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{s.suggestion_reason}</p>
                          {s.previous_weight && <p className="text-xs text-muted-foreground/50">Last: {s.previous_weight} lbs</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
                {applyError && (
                  <p className="text-xs text-destructive bg-destructive/10 rounded-xl px-3 py-2 animate-in fade-in slide-in-from-top-1 duration-200">{applyError}</p>
                )}
              </div>
            )}
          </div>

          {/* ── Sticky footer action (review step only) ── */}
          {suggestions && (
            <div className="shrink-0 px-4 py-4 border-t border-border bg-background animate-in fade-in slide-in-from-bottom-2 duration-200">
              <Button
                className="w-full h-12 text-base font-semibold rounded-2xl transition-transform duration-150 active:scale-[0.98]"
                onClick={() => applyMutation.mutate()}
                disabled={applyMutation.isPending}
              >
                {applyMutation.isPending ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />Applying…
                  </span>
                ) : (
                  `Stage ${suggestions.filter(s => overrides[s.plan_exercise_id]?.include !== false).length} Exercises`
                )}
              </Button>
            </div>
          )}

        </DialogContent>
      </Dialog>

      {/* ── Fitbit Integration ────────────────────────────────────────────── */}
      {(session.status === 'completed' || session.status === 'cancelled') && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
            <div className="flex items-center gap-2">
              <Activity className="size-4 text-green-600 dark:text-green-400" />
              <span className="font-semibold text-sm">Fitbit Data</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => syncFitbitMutation.mutate()}
              disabled={syncFitbitMutation.isPending}
              className="gap-1.5 h-7 px-2 text-xs"
            >
              {syncFitbitMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Activity className="size-3.5" />
              )}
              Sync Fitbit
            </Button>
          </div>

          <div className="px-4 py-3 space-y-3">
            {/* Heart Rate */}
            {(session.average_hr || session.max_hr) ? (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Heart className="size-4 text-red-500" />
                  <div>
                    <p className="text-xs text-muted-foreground">Heart Rate</p>
                    <div className="flex items-baseline gap-2">
                      {session.average_hr && (
                        <span className="text-sm font-semibold tabular-nums">{session.average_hr} <span className="text-xs font-normal text-muted-foreground">avg</span></span>
                      )}
                      {session.max_hr && (
                        <span className="text-sm font-semibold tabular-nums">{session.max_hr} <span className="text-xs font-normal text-muted-foreground">max</span></span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Heart className="size-4" />
                <span>No heart rate data synced yet</span>
              </div>
            )}

            {/* Health Metrics */}
            {session.health_metric ? (
              <div className="grid grid-cols-2 gap-3">
                {session.health_metric.sleep_duration_seconds != null && (
                  <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2">
                    <Moon className="size-4 text-indigo-500 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Sleep</p>
                      <p className="text-sm font-semibold tabular-nums">
                        {Math.floor(session.health_metric.sleep_duration_seconds / 3600)}h{' '}
                        {Math.round((session.health_metric.sleep_duration_seconds % 3600) / 60)}m
                      </p>
                    </div>
                  </div>
                )}
                {session.health_metric.sleep_efficiency != null && (
                  <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2">
                    <Moon className="size-4 text-indigo-500 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Sleep Efficiency</p>
                      <p className="text-sm font-semibold tabular-nums">{session.health_metric.sleep_efficiency}%</p>
                    </div>
                  </div>
                )}
                {session.health_metric.weight_kg != null && (
                  <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2">
                    <Weight className="size-4 text-amber-500 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Weight</p>
                      <p className="text-sm font-semibold tabular-nums">{session.health_metric.weight_kg} kg</p>
                    </div>
                  </div>
                )}
                {session.health_metric.body_fat_pct != null && (
                  <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2">
                    <Weight className="size-4 text-amber-500 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Body Fat</p>
                      <p className="text-sm font-semibold tabular-nums">{session.health_metric.body_fat_pct}%</p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Moon className="size-4" />
                <span>No health metrics synced yet. Tap Sync Fitbit to pull sleep and weight data.</span>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

export default function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <SessionDetailInner id={id} />;
}
