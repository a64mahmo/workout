'use client';

import { usePathname } from 'next/navigation';
import { STATIC_PARAM_PLACEHOLDER } from './static-param';

/** Resolve a dynamic route param, reading the real value from the URL when the page is the static placeholder. */
export function useRouteParam(param: string, segmentIndex: number): string {
  const pathname = usePathname();
  if (param !== STATIC_PARAM_PLACEHOLDER) return param;
  const fromUrl = pathname?.split('/').filter(Boolean)[segmentIndex];
  return fromUrl ? decodeURIComponent(fromUrl) : param;
}
