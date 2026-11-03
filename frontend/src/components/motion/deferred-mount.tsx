'use client';

import { useEffect, useState } from 'react';

/**
 * Mounts heavy children (charts) after the page has painted and the enter
 * transition is under way, so their first render doesn't block a frame.
 * A same-height placeholder keeps the layout from shifting.
 */
export function DeferredMount({ height, children }: { height: number; children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let idle: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const raf = requestAnimationFrame(() => {
      if ('requestIdleCallback' in window) idle = window.requestIdleCallback(() => setReady(true), { timeout: 400 });
      else timer = setTimeout(() => setReady(true), 50);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);

  if (!ready) return <div aria-hidden style={{ height }} className="rounded-lg skeleton-shimmer opacity-40" />;
  return <div className="fade-in-soft">{children}</div>;
}
