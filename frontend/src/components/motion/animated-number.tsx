'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Numeric crossfade (SwiftUI `.contentTransition(.numericText())`):
 * each character that changes rolls in — up when the value grows, down when it shrinks.
 * Screen readers and text queries see the plain value via the sr-only copy.
 */
export function AnimatedNumber({
  value,
  numeric,
  className,
}: {
  /** Display string, e.g. "1:30" or "12,500". */
  value: string;
  /** Underlying number, used only to pick the roll direction. */
  numeric?: number;
  className?: string;
}) {
  // Remember the last *change* (not the last render) so unrelated re-renders
  // mid-roll don't restart or cancel the animation. Updating state during
  // render when a prop changed is React's "info from previous renders" pattern.
  const [hist, setHist] = useState({ cur: value, curNum: numeric, prev: value, dir: 'up' as 'up' | 'down' });
  if (hist.cur !== value) {
    const down = numeric !== undefined && hist.curNum !== undefined ? numeric < hist.curNum : value < hist.cur;
    setHist({ prev: hist.cur, cur: value, curNum: numeric, dir: down ? 'down' : 'up' });
  }
  const { prev, dir } = hist.cur === value ? hist : { prev: hist.cur, dir: hist.dir };

  // Right-align old and new strings so digits in the same place compare.
  const pad = Math.max(0, value.length - prev.length);
  const oldAligned = ' '.repeat(pad) + prev.slice(Math.max(0, prev.length - value.length));

  return (
    <span className={cn('relative inline-flex tabular-nums', className)}>
      <span className="sr-only">{value}</span>
      <span aria-hidden className="inline-flex">
        {value.split('').map((ch, i) => {
          const changed = prev !== value && oldAligned[i] !== ch;
          return (
            // A changed character gets a new key, so it mounts with the roll class.
            <span key={`${i}-${ch}`} className={cn('inline-block', changed && (dir === 'up' ? 'num-roll-up' : 'num-roll-down'))}>
              {ch === ' ' ? '\u00a0' : ch}
            </span>
          );
        })}
      </span>
    </span>
  );
}

/** Counts from 0 to `to` with an ease-out curve (once, on mount). */
export function CountUp({
  to,
  format = (n) => Math.round(n).toLocaleString(),
  durationMs = 900,
  className,
}: {
  to: number;
  format?: (n: number) => string;
  durationMs?: number;
  className?: string;
}) {
  const [n, setN] = useState(() => (prefersReducedMotion() ? to : 0));

  useEffect(() => {
    if (prefersReducedMotion() || to === 0) {
      setN(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(to * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, durationMs]);

  return (
    <span className={cn('tabular-nums', className)}>
      <span className="sr-only">{format(to)}</span>
      <span aria-hidden>{format(n)}</span>
    </span>
  );
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
