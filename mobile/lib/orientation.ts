import { useEffect } from 'react';
import { Dimensions } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';

/**
 * Dependency-free tablet heuristic: Android itself draws the line between
 * "phone" and "tablet" layouts at a 600dp shortest-side breakpoint
 * (sw600dp), so this matches that instead of inventing a new threshold.
 * Good enough for "should this device rotate freely everywhere, or stay
 * portrait-locked outside video/exam screens" — no extra native dependency
 * (expo-device) needed just for this check.
 */
export function isTablet(): boolean {
  const { width, height } = Dimensions.get('window');
  return Math.min(width, height) >= 600;
}

/**
 * App-wide default, called once from the root layout: tablets are left
 * fully unlocked (rotate anywhere, same as most tablet apps), while phones
 * are locked to portrait so screens that were never designed for
 * landscape (lists, forms, the tab bar) don't stretch or misbehave.
 * Individual screens can still lift the phone lock temporarily — see
 * useAllowRotation below.
 */
export async function applyDefaultOrientationLock(): Promise<void> {
  try {
    if (isTablet()) {
      await ScreenOrientation.unlockAsync();
    } else {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    }
  } catch {
    // Orientation API unavailable on this platform (e.g. web) — nothing to do.
  }
}

/**
 * Temporarily lifts a phone's portrait lock while `enabled` is true — for
 * the two places rotating actually helps: watching a lecture video
 * (app/lessons/[id].tsx) and taking an exam (app/exams/[examId].tsx), both
 * requested explicitly. Restores the portrait lock the instant `enabled`
 * goes back to false, and always restores it on unmount too, so leaving
 * the screen mid-rotation never leaves the rest of the app stuck in
 * landscape. Tablets are already left unlocked everywhere by
 * applyDefaultOrientationLock above, so this is a deliberate no-op there.
 */
export function useAllowRotation(enabled: boolean): void {
  useEffect(() => {
    if (isTablet()) return undefined;
    if (!enabled) return undefined;
    ScreenOrientation.unlockAsync().catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, [enabled]);
}
