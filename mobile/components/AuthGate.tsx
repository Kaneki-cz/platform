import { useRouter, useSegments } from 'expo-router';
import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/context/AuthContext';
import { colors } from '@/constants/theme';

/**
 * Redirects between the (auth) and (tabs) route groups based on whether a
 * user is signed in. Keeping this logic in one place means individual
 * screens don't need to guard themselves.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';
    // Reachable while logged out on purpose: a fresh install has no saved
    // server override yet, so someone testing an APK needs to be able to
    // point the app at the right backend URL *before* they can log in.
    const isServerSettings = segments[0] === 'server-settings';

    if (!user && !inAuthGroup && !isServerSettings) {
      router.replace('/(auth)/login');
    } else if (user && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [user, isLoading, segments, router]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return <>{children}</>;
}
