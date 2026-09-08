import { Cairo_400Regular, Cairo_500Medium, Cairo_600SemiBold, Cairo_700Bold, useFonts } from '@expo-google-fonts/cairo';
import { Tinos_400Regular, Tinos_700Bold } from '@expo-google-fonts/tinos';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text, TextInput } from 'react-native';

import { AuthGate } from '@/components/AuthGate';
import { AuthProvider } from '@/context/AuthContext';
import { LanguageProvider, useLanguage } from '@/context/LanguageContext';
import { colors, fonts } from '@/constants/theme';

// Best-effort app-wide default: every <Text>/<TextInput> that doesn't set
// its own fontFamily picks up Cairo instead of the platform default
// (Roboto/San Francisco). This relies on React still reading a host
// component's `defaultProps` — React 19 dropped that for plain *function*
// components, so depending on how RN 0.86 implements Text/TextInput
// internally this may silently no-op on some screens rather than error;
// it's still worth setting since it costs nothing when it doesn't apply.
// MathText.tsx (every question/answer) and the exam/quiz screens set
// fontFamily explicitly too, so those specific reading surfaces get Cairo
// either way, independent of whether this global default takes.
function applyDefaultFont() {
  // @ts-ignore — RN's own typings don't declare defaultProps on these.
  Text.defaultProps = Text.defaultProps || {};
  // @ts-ignore
  Text.defaultProps.style = [{ fontFamily: fonts.regular }, Text.defaultProps.style];
  // @ts-ignore
  TextInput.defaultProps = TextInput.defaultProps || {};
  // @ts-ignore
  TextInput.defaultProps.style = [{ fontFamily: fonts.regular }, TextInput.defaultProps.style];
}

// Pulled out so it can read the current language via useLanguage() — the
// Stack itself needs to sit *inside* LanguageProvider for that, and the
// lesson screen's header title needs to switch with it (its own body text
// already does — see app/lessons/[id].tsx).
function RootStack() {
  const { language } = useLanguage();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Applies to any screen below that turns its own header back
        // on (lessons/[id], server-settings) — React Navigation
        // headers don't inherit theme automatically, so without this
        // they'd show as a plain white bar even in a dark app.
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text },
        headerShadowVisible: false,
        // Avoids a white flash of the default navigator background
        // during screen transitions, before each screen's own View
        // paints its background.
        contentStyle: { backgroundColor: colors.background },
      }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="lessons/[id]"
        options={{ headerShown: true, title: language === 'ar' ? 'الدرس' : 'Lesson', presentation: 'card' }}
      />
      <Stack.Screen
        name="exams/[examId]"
        options={{ headerShown: true, title: language === 'ar' ? 'امتحان' : 'Exam', presentation: 'card' }}
      />
      <Stack.Screen name="admin" />
      <Stack.Screen
        name="server-settings"
        options={{ headerShown: true, title: 'Server Connection', presentation: 'modal' }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Cairo_400Regular,
    Cairo_500Medium,
    Cairo_600SemiBold,
    Cairo_700Bold,
    // Tinos — the free, metrically Times-New-Roman-compatible face used for
    // any English/Latin run (see constants/theme.ts's fonts.serif/serifBold
    // and MathText.tsx's splitLatinRuns).
    Tinos_400Regular,
    Tinos_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) applyDefaultFont();
  }, [fontsLoaded]);

  // Hold the whole app on a blank/background-colored frame (rather than
  // partially rendering in the system default font, then flashing to
  // Cairo) until the font files are ready — this only ever blocks for a
  // moment on first cold start, since expo-font caches the loaded fonts.
  if (!fontsLoaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <LanguageProvider>
          <AuthProvider>
            <AuthGate>
              <RootStack />
              {/* App is a fixed dark theme now, not tied to the system setting —
                  force light status-bar icons/text so they stay visible against
                  the dark background regardless of the device's own theme. */}
              <StatusBar style="light" />
            </AuthGate>
          </AuthProvider>
        </LanguageProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
