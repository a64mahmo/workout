'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, setDemoAdapter } from '@/lib/api';
import { isDemoMode, setDemoFlag } from '@/lib/demo';

interface User {
  id: string;
  email: string;
  name: string;
  has_fitbit_connected: boolean;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** True while browsing with fake data (no API calls). */
  isDemo: boolean;
  /** Sign in to the demo account: fake data, nothing reaches the API. */
  startDemo: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);

  const fetchMe = useCallback(async () => {
    try {
      const res = await api.get('/api/auth/me');
      setUser(res.data);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    setIsDemo(isDemoMode());
    fetchMe().finally(() => setIsLoading(false));
  }, [fetchMe]);

  const startDemo = async () => {
    setDemoFlag(true);
    setDemoAdapter(true);
    setIsDemo(true);
    await fetchMe();
  };

  const login = async (email: string, password: string) => {
    await api.post('/api/auth/login', { email, password });
    await fetchMe();
  };

  const register = async (email: string, name: string, password: string) => {
    await api.post('/api/auth/register', { email, name, password });
    await fetchMe();
  };

  const logout = async () => {
    if (isDemoMode()) {
      // Leave demo: drop the fake data and reload so no cached demo queries linger.
      setDemoFlag(false);
      setDemoAdapter(false);
      window.location.href = '/login';
      return;
    }
    await api.post('/api/auth/logout');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout, isDemo, startDemo }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
