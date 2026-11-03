'use client';

import { useMemo, useState } from 'react';
import { BottomSheet, BottomSheetContent } from '@/components/ui/bottom-sheet';
import { Input } from '@/components/ui/input';
import { BARS, groupPlates, platesFor } from '@/lib/plates';
import { cn } from '@/lib/utils';

// Plate colours follow the common bumper-plate convention.
const PLATE_STYLE: Record<number, { h: number; cls: string }> = {
  45: { h: 88, cls: 'bg-red-500' },
  35: { h: 78, cls: 'bg-yellow-400' },
  25: { h: 66, cls: 'bg-emerald-500' },
  10: { h: 50, cls: 'bg-slate-200 dark:bg-slate-300' },
  5: { h: 40, cls: 'bg-blue-500' },
  2.5: { h: 32, cls: 'bg-zinc-500' },
};

/**
 * Plates per side for a barbell. Opens with the weight of the set you're on;
 * edit it to load any other weight.
 */
export function PlateCalculator({
  open,
  onOpenChange,
  initialWeight,
  exerciseName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialWeight: number;
  exerciseName: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [bar, setBar] = useState(45);
  const target = draft === null ? initialWeight : parseFloat(draft) || 0;
  const load = useMemo(() => platesFor(target, bar), [target, bar]);
  const groups = groupPlates(load.perSide);

  return (
    <BottomSheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setDraft(null);
      }}
    >
      <BottomSheetContent title={`Plates · ${exerciseName}`}>
        <div className="px-4 pb-6 space-y-5">
          <div className="flex items-end gap-3">
            <label className="flex-1 space-y-1">
              <span className="text-xs text-muted-foreground">Total weight (lbs)</span>
              <Input
                type="number"
                inputMode="decimal"
                value={draft ?? String(initialWeight || '')}
                onChange={(e) => setDraft(e.target.value)}
                className="h-11 text-lg tabular-nums"
                aria-label="Total weight in pounds"
              />
            </label>
            <div className="flex rounded-lg border border-border overflow-hidden text-xs" role="group" aria-label="Bar weight">
              {BARS.map((b) => (
                <button
                  key={b.weight}
                  type="button"
                  onClick={() => setBar(b.weight)}
                  title={b.label}
                  aria-pressed={bar === b.weight}
                  className={cn(
                    'px-3 h-11 tabular-nums transition-colors',
                    bar === b.weight ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  {b.weight}
                </button>
              ))}
            </div>
          </div>

          {/* One side of the bar, heaviest plate nearest the collar */}
          <div className="rounded-xl bg-muted/50 px-4 py-5 flex items-center justify-center min-h-32" aria-hidden>
            <div className="h-3 w-10 rounded-l-full bg-zinc-400 dark:bg-zinc-500" />
            <div className="h-6 w-2 bg-zinc-500 dark:bg-zinc-400" />
            {load.perSide.map((p, i) => (
              <div
                key={i}
                className={cn('w-3.5 mx-[1px] rounded-sm shadow-sm stagger-in', PLATE_STYLE[p]?.cls ?? 'bg-zinc-400')}
                style={{ height: PLATE_STYLE[p]?.h ?? 30, '--i': i } as React.CSSProperties}
              />
            ))}
            <div className="h-3 flex-1 max-w-24 rounded-r-full bg-zinc-400 dark:bg-zinc-500" />
          </div>

          <div className="space-y-2" aria-live="polite">
            {load.barOnly ? (
              <p className="text-sm text-muted-foreground">Empty bar ({bar} lbs){target > 0 && target < bar ? ` is more than ${target} lbs.` : '.'}</p>
            ) : (
              <>
                <p className="text-sm">
                  <span className="text-muted-foreground">Each side: </span>
                  <span className="font-semibold tabular-nums">
                    {groups.map((g) => (g.count > 1 ? `${g.count} × ${g.plate}` : `${g.plate}`)).join(' + ')}
                  </span>
                </p>
                {load.remainder > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Closest you can load is {load.loaded} lbs ({load.remainder} lbs short).
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </BottomSheetContent>
    </BottomSheet>
  );
}
