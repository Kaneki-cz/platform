import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';

import * as api from '@/lib/api';
import { loadApiBaseUrlOverride } from '@/lib/config';
import { onSessionExpired } from '@/lib/session';
import type { User } from '@/lib/types';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  // Returns true if the account came back already verified (server-side
  // email verification currently disabled — see backend's
  // settings.REQUIRE_EMAIL_VERIFICATION) — in that case this ALSO logs the
  // student in immediately, same as login() does. Returns false when the
  // account still needs a code: stays logged out, same as before, and the
  // caller (RegisterScreen) navigates to the verify-email screen next.
  register: (email: string, password: string, fullName?: string) => Promise<boolean>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  resendVerification: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const userRef = useRef<User | null>(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Login expired mid-session: drop back to the login screen once, with a
  // message, instead of letting every screen fail.
  useEffect(
    () =>
      onSessionExpired(() => {
        // Several requests can fail at once; only the first one (while a
        // user is still signed in) shows the message.
        if (userRef.current) {
          userRef.current = null;
          Alert.alert(
            'انتهت جلسة الدخول — Session expired',
            'سجّل دخول تاني عشان تكمّل.\nPlease log in again to continue.',
          );
        }
        setUser(null);
      }),
    [],
  );

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
        const created = await api.register(email, password, fullName);
        if (created.is_verified) {
          // Verification is currently disabled server-side — the account
          // is already good to go, so log in right away instead of
          // sending the student to a code screen that'll never receive one.
          setUser(await api.login(email, password));
          return true;
        }
        // No auto-login here — the account isn't verified yet.
        return false;
      },
      verifyEmail: async (email, code) => setUser(await api.verifyEmail(email, code)),
      resendVerification: async (email) => {
        await api.resendVerification(email);
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
