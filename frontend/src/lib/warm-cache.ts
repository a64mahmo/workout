'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Data every tab needs on first visit. Keys and fetchers must match the pages'
 * own useQuery calls exactly, or the warmed cache won't be used.
 * (Fitbit stats are left out on purpose: they call Fitbit's rate-limited API.)
 */
const WARM_QUERIES: { queryKey: unknown[]; url: string }[] = [
  { queryKey: ['sessions'], url: '/api/sessions' },
  { queryKey: ['cycles'], url: '/api/meso-cycles' },
  { queryKey: ['plans'], url: '/api/plans' },
  { queryKey: ['plans-progress'], url: '/api/plans/progress' },
  { queryKey: ['exercises', ''], url: '/api/exercises' },
  { queryKey: ['suggestions', 'exercises'], url: '/api/suggestions/exercises' },
  { queryKey: ['suggestions', 'muscle-groups'], url: '/api/suggestions/muscle-groups' },
  { queryKey: ['me'], url: '/api/auth/me' },
];

export const NAV_ROUTES = ['/', '/sessions', '/exercises', '/plans', '/cycles', '/suggestions', '/settings'];

const whenIdle = (fn: () => void) => {
  if (typeof window === 'undefined') return () => {};
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(fn, { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 300);
  return () => clearTimeout(id);
};

/**
 * Once signed in, prefetch every tab's route bundle and data in idle time so
 * switching tabs never shows a skeleton. Cached data is reused, not refetched.
 */
export function useWarmCache(enabled: boolean) {
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    return whenIdle(() => {
      for (const href of NAV_ROUTES) router.prefetch(href);
      for (const { queryKey, url } of WARM_QUERIES) {
        void queryClient.prefetchQuery({ queryKey, queryFn: async () => (await api.get(url)).data });
      }
    });
  }, [enabled, queryClient, router]);
}
