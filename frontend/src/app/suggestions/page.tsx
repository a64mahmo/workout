'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ExerciseSuggestion, TrainingSession } from '@/types';
import { useState, useMemo } from 'react';
import { useTheme } from 'next-themes';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  TrendingUp, TrendingDown, Minus,
  Dumbbell, Scale, Search, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  format, parseISO, differenceInDays,
  startOfWeek, subWeeks, isWithinInterval, endOfWeek,
} from 'date-fns';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WeightSuggestion {
  average_weight: number;
  previous_weight: number;
  suggested_weight: number;
  average_rpe: number | null;
  suggestion: string;
  adjustment_reason: string;
  percentage: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MUSCLE_COLOR: Record<string, string> = {
  chest:      '#f43f5e',
  back:       '#3b82f6',
  shoulders:  '#8b5cf6',
  biceps:     '#f97316',
  triceps:    '#eab308',
  legs:       '#22c55e',
  core:       '#14b8a6',
  glutes:     '#ec4899',
  hamstrings: '#84cc16',
  cardio:     '#06b6d4',
  other:      '#6b7280',
};

const MUSCLE_ORDER = ['back', 'legs', 'chest', 'shoulders', 'biceps', 'triceps', 'core', 'glutes', 'hamstrings'];

function fmtVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return `${Math.round(v)}`;
}

function sessionVolume(s: TrainingSession): number {
  if (s.total_volume && s.total_volume > 0) return s.total_volume;
  return s.exercises?.reduce((t, se) =>
    t + se.sets.reduce((v, set) =>
      v + (set.is_completed ? (set.reps || 0) * (set.weight || 0) : 0), 0), 0) ?? 0;
}

// ---------------------------------------------------------------------------
// Chart tooltip
// ---------------------------------------------------------------------------

function useChartColors() {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  return {
    axisText:     dark ? '#9ca3af' : '#6b7280',
    cursor:       dark ? '#292524' : '#f3f4f6',
    tooltipBg:    dark ? '#1c1917' : '#ffffff',
    tooltipBorder:dark ? '#44403c' : '#e7e5e4',
  };
}

function MuscleTooltip(colors: ReturnType<typeof useChartColors>) {
  return function Inner(props: Record<string, unknown>) {
    const active  = props.active  as boolean | undefined;
    const payload = props.payload as { value: number; name: string }[] | undefined;
    const label   = props.label   as string | undefined;
    if (!active || !payload?.length) return null;
    return (
      <div style={{
        background: colors.tooltipBg,
        border: `1px solid ${colors.tooltipBorder}`,
        borderRadius: 8, padding: '8px 12px', fontSize: 13,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      }}>
        <p style={{ color: colors.axisText, fontSize: 11, marginBottom: 2, textTransform: 'capitalize' }}>{label}</p>
        <p style={{ fontWeight: 700 }}>{fmtVol(payload[0].value)} lbs</p>
      </div>
    );
  };
}

// ---------------------------------------------------------------------------
// Weekly volume from sessions
// ---------------------------------------------------------------------------

function useWeeklyVolumeByMuscle(sessions: TrainingSession[] | undefined) {
  return useMemo(() => {
    if (!sessions) return {};
    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const weekEnd   = endOfWeek(weekStart, { weekStartsOn: 1 });
    const prevStart = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
    const prevEnd   = endOfWeek(prevStart, { weekStartsOn: 1 });

    const thisWeek: Record<string, number> = {};
    const lastWeek: Record<string, number> = {};

    sessions.filter(s => s.status === 'completed').forEach(s => {
      try {
        const d = parseISO(s.scheduled_date + 'T00:00:00');
        const isThis = isWithinInterval(d, { start: weekStart, end: weekEnd });
        const isLast = isWithinInterval(d, { start: prevStart, end: prevEnd });
        if (!isThis && !isLast) return;

        s.exercises?.forEach(se => {
          const mg = se.exercise?.muscle_group;
          if (!mg) return;
          const vol = se.sets.reduce((t, set) =>
            t + (set.is_completed ? (set.reps || 0) * (set.weight || 0) : 0), 0);
          if (isThis) thisWeek[mg] = (thisWeek[mg] || 0) + vol;
          if (isLast) lastWeek[mg] = (lastWeek[mg] || 0) + vol;
        });
      } catch { /* skip bad date */ }
    });

    return { thisWeek, lastWeek };
  }, [sessions]);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SuggestionsPage() {
  const [selectedExercise, setSelectedExercise] = useState('');
  const [search, setSearch] = useState('');
  const [muscleFilter, setMuscleFilter] = useState('all');
  const [showAll, setShowAll] = useState(false);
  const chartColors = useChartColors();

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: exerciseSuggestions = [], isLoading: loadingEx } = useQuery({
    queryKey: ['suggestions', 'exercises'],
    queryFn: async () => {
      const res = await api.get('/api/suggestions/exercises');
      return res.data as ExerciseSuggestion[];
    },
  });

  const { data: muscleGroupVolumes } = useQuery({
    queryKey: ['suggestions', 'muscle-groups'],
    queryFn: async () => {
      const res = await api.get('/api/suggestions/muscle-groups');
      return res.data as Record<string, number>;
    },
  });

  const { data: weightSuggestion, isLoading: loadingWeight } = useQuery({
    queryKey: ['suggestions', 'weight', selectedExercise],
    queryFn: async () => {
      const res = await api.get(`/api/suggestions/weight?exercise_id=${selectedExercise}`);
      return res.data as WeightSuggestion;
    },
    enabled: !!selectedExercise,
  });

  const { data: sessions } = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const res = await api.get('/api/sessions');
      return res.data as TrainingSession[];
    },
  });

  // ── Derived data ──────────────────────────────────────────────────────────
  const { thisWeek, lastWeek } = useWeeklyVolumeByMuscle(sessions);

  // Muscle group chart data (sorted by volume desc)
  const muscleChartData = useMemo(() => {
    if (!muscleGroupVolumes) return [];
    return Object.entries(muscleGroupVolumes)
      .sort((a, b) => b[1] - a[1])
      .map(([mg, vol]) => ({ label: mg, volume: vol }));
  }, [muscleGroupVolumes]);

  // This-week vs last-week comparison
  const weekCompareData = useMemo(() => {
    const allMuscles = new Set([
      ...Object.keys(thisWeek || {}),
      ...Object.keys(lastWeek || {}),
    ]);
    return MUSCLE_ORDER
      .filter(mg => allMuscles.has(mg))
      .map(mg => ({
        mg,
        thisWeek: thisWeek?.[mg] || 0,
        lastWeek: lastWeek?.[mg] || 0,
      }));
  }, [thisWeek, lastWeek]);

  // Filtered exercise list
  const filteredExercises = useMemo(() => {
    return exerciseSuggestions.filter(s => {
      const matchSearch = s.exercise.name.toLowerCase().includes(search.toLowerCase());
      const matchMuscle = muscleFilter === 'all' || s.exercise.muscle_group === muscleFilter;
      return matchSearch && matchMuscle;
    });
  }, [exerciseSuggestions, search, muscleFilter]);

  const visibleExercises = showAll ? filteredExercises : filteredExercises.slice(0, 8);

  const selectedName = exerciseSuggestions.find(
    s => s.exercise.id === selectedExercise,
  )?.exercise.name;

  const uniqueMuscles = useMemo(() =>
    Array.from(new Set(exerciseSuggestions.map(s => s.exercise.muscle_group))).sort(),
    [exerciseSuggestions],
  );

  // ── Weight suggestion metadata ─────────────────────────────────────────────
  const weightMeta = useMemo(() => {
    if (!weightSuggestion) return null;
    const pct = weightSuggestion.percentage;
    if (pct >= 100) return { icon: <TrendingUp className="size-4" />, color: '#22c55e', label: 'Progression' };
    if (pct >= 80)  return { icon: <Minus className="size-4" />,      color: '#f97316', label: 'Recovery' };
    return           { icon: <TrendingDown className="size-4" />,     color: '#f43f5e', label: 'Deload' };
  }, [weightSuggestion]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 pb-8">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Suggestions</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Volume analytics and weight recommendations from your history
        </p>
      </div>

      {/* ── This week vs last week ── */}
      {weekCompareData.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h2 className="font-semibold text-sm">This Week vs Last Week</h2>
          <div className="space-y-2.5">
            {weekCompareData.map(({ mg, thisWeek: tw, lastWeek: lw }) => {
              const max = Math.max(tw, lw, 1);
              const delta = lw > 0 ? ((tw - lw) / lw) * 100 : null;
              const color = MUSCLE_COLOR[mg] ?? MUSCLE_COLOR.other;
              return (
                <div key={mg} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 capitalize font-medium">
                      <span className="size-2 rounded-full inline-block" style={{ background: color }} />
                      {mg}
                    </span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <span>{fmtVol(tw)} lbs</span>
                      {delta !== null && (
                        <span
                          className="font-medium"
                          style={{ color: delta > 0 ? '#22c55e' : delta < 0 ? '#f43f5e' : '#9ca3af' }}
                        >
                          {delta > 0 ? '+' : ''}{delta.toFixed(0)}%
                        </span>
                      )}
                    </span>
                  </div>
                  {/* Two stacked bars */}
                  <div className="space-y-0.5">
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${(tw / max) * 100}%`, background: color }}
                      />
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all opacity-40"
                        style={{ width: `${(lw / max) * 100}%`, background: color }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">Thick bar = this week · Thin bar = last week</p>
        </section>
      )}

      {/* ── All-time volume by muscle group chart ── */}
      {muscleChartData.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div>
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <TrendingUp className="size-4 text-primary" />
              All-time Volume by Muscle Group
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">Total lbs lifted per muscle</p>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={muscleChartData}
              layout="vertical"
              margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
            >
              <XAxis
                type="number"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: chartColors.axisText }}
                tickFormatter={fmtVol}
              />
              <YAxis
                dataKey="label"
                type="category"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: chartColors.axisText }}
                width={72}
                tickFormatter={(v: string) => v.charAt(0).toUpperCase() + v.slice(1)}
              />
              <Tooltip
                content={MuscleTooltip(chartColors)}
                cursor={{ fill: chartColors.cursor, radius: 4 }}
              />
              <Bar dataKey="volume" radius={[0, 4, 4, 0]} maxBarSize={18}>
                {muscleChartData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={MUSCLE_COLOR[entry.label] ?? MUSCLE_COLOR.other}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* ── Weight lookup ── */}
      <section className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div>
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Scale className="size-4 text-primary" />
            Weight Recommendation
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Based on your last 50 completed sets for the exercise
          </p>
        </div>

        <Select
          value={selectedExercise}
          onValueChange={(v) => v && setSelectedExercise(v)}
          items={exerciseSuggestions.map(s => ({ value: s.exercise.id, label: s.exercise.name }))}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Search an exercise…" />
          </SelectTrigger>
          <SelectContent>
            {exerciseSuggestions.map((s, i) => (
              <SelectItem
                key={`${s.exercise.id}-${i}`}
                value={s.exercise.id}
                label={s.exercise.name}
              >
                {s.exercise.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {loadingWeight && selectedExercise && (
          <div className="h-24 rounded-lg bg-muted animate-pulse" />
        )}

        {weightSuggestion && weightMeta && (
          <div className="rounded-lg border border-border p-4 space-y-4">
            {/* Pill */}
            <div className="flex items-center gap-2">
              <span
                className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{
                  background: `${weightMeta.color}20`,
                  color: weightMeta.color,
                }}
              >
                {weightMeta.icon}
                {weightMeta.label}
              </span>
              {selectedName && (
                <span className="text-sm text-muted-foreground">{selectedName}</span>
              )}
            </div>

            {/* Numbers */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Previous avg</p>
                <p className="text-2xl font-bold tabular-nums">
                  {weightSuggestion.previous_weight}
                  <span className="text-sm font-normal text-muted-foreground ml-1">lbs</span>
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Suggested</p>
                <p className="text-2xl font-bold tabular-nums" style={{ color: weightMeta.color }}>
                  {weightSuggestion.suggested_weight}
                  <span className="text-sm font-normal text-muted-foreground ml-1">lbs</span>
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Avg RPE</p>
                <p className="text-2xl font-bold tabular-nums">
                  {weightSuggestion.average_rpe ?? '—'}
                  <span className="text-sm font-normal text-muted-foreground ml-1">
                    {weightSuggestion.average_rpe ? '/ 10' : ''}
                  </span>
                </p>
              </div>
            </div>

            {/* Progress bar showing % of previous */}
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>0</span>
                <span className="font-medium" style={{ color: weightMeta.color }}>
                  {weightSuggestion.percentage}% of average
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(weightSuggestion.percentage, 110)}%`,
                    background: weightMeta.color,
                  }}
                />
              </div>
            </div>

            <p className="text-sm text-muted-foreground">{weightSuggestion.adjustment_reason}</p>
          </div>
        )}
      </section>

      {/* ── Exercise volume table ── */}
      <section className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div>
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Dumbbell className="size-4 text-primary" />
            Exercise Volume
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            All-time total volume per exercise in your history
          </p>
        </div>

        {/* Filters */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search exercises…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-9 text-sm"
            />
          </div>
          <Select
            value={muscleFilter}
            onValueChange={v => setMuscleFilter(v ?? 'all')}
            items={[
              { value: 'all', label: 'All muscles' },
              ...uniqueMuscles.map(m => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) })),
            ]}
          >
            <SelectTrigger className="h-9 w-36 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" label="All muscles">All muscles</SelectItem>
              {uniqueMuscles.map(m => (
                <SelectItem key={m} value={m} label={m.charAt(0).toUpperCase() + m.slice(1)}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loadingEx ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : filteredExercises.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No exercises match</p>
        ) : (
          <>
            {/* Max volume for bar scaling */}
            {(() => {
              const maxVol = Math.max(...visibleExercises.map(s => s.total_volume), 1);
              return (
                <div className="space-y-1.5">
                  {visibleExercises.map((s, i) => {
                    const color = MUSCLE_COLOR[s.exercise.muscle_group] ?? MUSCLE_COLOR.other;
                    const pct = (s.total_volume / maxVol) * 100;
                    const daysAgo = s.last_performed
                      ? differenceInDays(new Date(), parseISO(s.last_performed))
                      : null;
                    return (
                      <div
                        key={`${s.exercise.id}-${i}`}
                        className="relative rounded-lg border border-border overflow-hidden"
                      >
                        {/* Volume bar background */}
                        <div
                          className="absolute inset-y-0 left-0 opacity-[0.07] transition-all"
                          style={{ width: `${pct}%`, background: color }}
                        />
                        <div className="relative flex items-center gap-3 px-3 py-2.5">
                          <span
                            className="size-2 rounded-full shrink-0"
                            style={{ background: color }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{s.exercise.name}</p>
                            <p className="text-xs text-muted-foreground capitalize">{s.exercise.muscle_group}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-semibold tabular-nums">
                              {fmtVol(s.total_volume)} lbs
                            </p>
                            {daysAgo !== null && (
                              <p className="text-[11px] text-muted-foreground">
                                {daysAgo === 0 ? 'today' : `${daysAgo}d ago`}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {filteredExercises.length > 8 && (
              <button
                onClick={() => setShowAll(v => !v)}
                className="w-full flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
              >
                {showAll ? (
                  <><ChevronUp className="size-4" /> Show less</>
                ) : (
                  <><ChevronDown className="size-4" /> Show all {filteredExercises.length} exercises</>
                )}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
