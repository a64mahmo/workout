'use client';

import { useEffect, useState } from 'react';
import { prefersReducedMotion } from './animated-number';

/**
 * Typewriter with blinking cursor (SwiftUI "typewriting" demo). Types `text`
 * each time it changes; the full text is always present for screen readers.
 */
/** ≈ 0.035 s per character (claude-motion timing). */
const SECONDS_PER_CHAR = 0.035;

export function Typewriter({ text, cps = 1 / SECONDS_PER_CHAR, className }: { text: string; cps?: number; className?: string }) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? text.length : 0));

  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(text.length);
      return;
    }
    setShown(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= text.length) clearInterval(id);
    }, 1000 / cps);
    return () => clearInterval(id);
  }, [text, cps]);

  const typing = shown < text.length;
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {text.slice(0, shown)}
        {typing && <span className="typewriter-cursor">▍</span>}
      </span>
    </span>
  );
}
