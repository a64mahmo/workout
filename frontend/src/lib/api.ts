import axios from 'axios';
import { demoAdapter, isDemoMode } from '@/lib/demo';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
  paramsSerializer: (params) => {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        for (const v of value) searchParams.append(key, String(v));
      } else if (value != null) {
        searchParams.append(key, String(value));
      }
    }
    return searchParams.toString();
  },
});

const networkAdapter = api.defaults.adapter;

/** Route every request to the in-browser fake backend (demo) or the real API. */
export function setDemoAdapter(on: boolean) {
  api.defaults.adapter = on ? demoAdapter : networkAdapter;
}
if (isDemoMode()) setDemoAdapter(true);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);
