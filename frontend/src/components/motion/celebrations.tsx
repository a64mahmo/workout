'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';

/**
 * Self-drawing check (SwiftUI path `.trim(from:to:)` "animated signature")
 * with an X-Like style spark ring. Pass `burst` on the render where the set
 * was just completed; otherwise it renders a static check.
 */
export function AnimatedCheck({ burst, className }: { burst?: boolean; className?: string }) {
  return (
    <span className={cn('relative inline-flex size-5 items-center justify-center', className)}>
      {burst && (
        <span aria-hidden className="check-burst pointer-events-none absolute inset-0">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="check-spark" style={{ '--a': `${i * 45}deg` } as React.CSSProperties} />
          ))}
        </span>
      )}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cn('size-5', burst && 'check-spring')} aria-hidden>
        <circle cx="12" cy="12" r="10" pathLength={1} className={cn(burst && 'check-draw-circle')} />
        <path d="m9 12 2 2 4-4" pathLength={1} className={cn(burst && 'check-draw-tick')} />
      </svg>
    </span>
  );
}

/**
 * Heartbeat (SwiftUI "pulsing hearts"): a double-thump synced to `bpm`.
 */
export function PulsingHeart({ bpm, className, children }: { bpm?: number | null; className?: string; children: React.ReactNode }) {
  const beat = Math.min(1.5, Math.max(0.35, 60 / (bpm && bpm > 0 ? bpm : 70)));
  return (
    <span className={cn('inline-flex heart-pulse', className)} style={{ '--beat': `${beat}s` } as React.CSSProperties}>
      {children}
    </span>
  );
}

// One accent per moment: gold means "personal record". Shades only, no rainbow.
const FIREWORK_COLORS = ['var(--pr-gold)', '#ffd54a', '#ffe9a3'];

/**
 * Fireworks bursts (SwiftUI "New Year's Eve fireworks"): a few radial bursts
 * at random spots. Rendered only while `active`.
 */
/** Deterministic pseudo-random in [0, 1) — pure, so renders are stable. */
const rand = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export function Fireworks({ active, bursts = 5, seed = 1 }: { active: boolean; bursts?: number; seed?: number }) {
  const shells = useMemo(
    () =>
      Array.from({ length: bursts }, (_, b) => ({
        id: b,
        x: 15 + rand(seed * 31 + b) * 70,
        y: 12 + rand(seed * 37 + b) * 40,
        delay: b * 280 + rand(seed * 41 + b) * 150,
        color: FIREWORK_COLORS[b % FIREWORK_COLORS.length],
        sparks: 14,
        dist: 70 + rand(seed * 43 + b) * 50,
      })),
    [bursts, seed],
  );
  if (!active) return null;
  return (
    <div aria-hidden className="fixed inset-0 pointer-events-none z-[201] overflow-hidden">
      {shells.map((s) => (
        <div key={s.id} className="absolute" style={{ left: `${s.x}%`, top: `${s.y}%` }}>
          <span className="firework-flash" style={{ background: s.color, animationDelay: `${s.delay}ms` }} />
          {Array.from({ length: s.sparks }, (_, i) => (
            <span
              key={i}
              className="firework-spark"
              style={
                {
                  '--a': `${(360 / s.sparks) * i}deg`,
                  '--d': `${s.dist}px`,
                  background: s.color,
                  boxShadow: `0 0 6px var(--pr-gold)`,
                  animationDelay: `${s.delay}ms`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      ))}
    </div>
  );
}
