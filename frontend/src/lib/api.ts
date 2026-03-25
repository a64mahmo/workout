import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export const api = axios.create({
  baseURL: API_URL,
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

api.interceptors.request.use((config) => {
  const userId = localStorage.getItem('userId') || '00000000-0000-0000-0000-000000000000';
  if (userId) {
    // Don't duplicate user_id if already in the URL or params
    const urlHasUserId = config.url?.includes('user_id=');
    const paramsHasUserId = config.params?.user_id != null;
    if (!urlHasUserId && !paramsHasUserId) {
      config.params = { ...config.params, user_id: userId };
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('userId');
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);
