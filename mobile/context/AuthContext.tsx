import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import * as api from '@/lib/api';
import { loadApiBaseUrlOverride } from '@/lib/config';
import type { User } from '@/lib/types';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // Must finish before any api.* call below, so a saved server-URL
        // override (see lib/config.ts and the profile settings screen) is
        // already in effect for the very first request the app makes.
        await loadApiBaseUrlOverride();
        const token = await api.getToken();
        if (token) {
          setUser(await api.getCurrentUser());
        }
      } catch {
        // Stored token is invalid/expired — fall back to logged-out state.
        await api.setToken(null);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      login: async (email, password) => setUser(await api.login(email, password)),
      register: async (email, password, fullName) => {
        await api.register(email, password, fullName);
        setUser(await api.login(email, password));
      },
      logout: async () => {
        await api.logout();
        setUser(null);
      },
    }),
    [user, isLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
