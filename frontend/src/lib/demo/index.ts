// Demo mode: the whole app runs on fake data in the browser. While it's on,
// the shared axios instance uses `demoAdapter`, so no request leaves the page.
import { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { DemoHttpError, handleDemoRequest, resetDemoDb } from './backend';

const FLAG = 'workout-demo';

export function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

export function setDemoFlag(on: boolean) {
  try {
    if (on) sessionStorage.setItem(FLAG, '1');
    else sessionStorage.removeItem(FLAG);
  } catch {
    /* private mode: demo still works for this page load */
  }
  if (!on) resetDemoDb();
}

/** Simulated latency so loading states and the AI "thinking" are visible. */
function latency(url: string) {
  if (url.includes('/suggestions/weight') && !url.includes('history')) return 450 + Math.random() * 350;
  return 90 + Math.random() * 120;
}

export const demoAdapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
  const url = config.url ?? '';
  const method = (config.method ?? 'get').toUpperCase();
  let body: unknown = config.data;
  if (typeof body === 'string' && body) {
    try {
      body = JSON.parse(body);
    } catch {
      /* leave as string */
    }
  }
  await new Promise((r) => setTimeout(r, latency(url)));

  const respond = (status: number, data: unknown): AxiosResponse => ({
    data,
    status,
    statusText: status < 400 ? 'OK' : 'Error',
    headers: new AxiosHeaders({ 'content-type': 'application/json' }),
    config,
    request: { demo: true },
  });

  try {
    return respond(200, handleDemoRequest(method, url, config.params, body));
  } catch (e) {
    const status = e instanceof DemoHttpError ? e.status : 500;
    const detail = e instanceof DemoHttpError ? e.detail : 'Internal Server Error';
    const res = respond(status, { detail });
    throw new AxiosError(`Request failed with status code ${status}`, status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST, config, res.request, res);
  }
};
