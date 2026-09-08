import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

// Points the app at the FastAPI backend. Per the plan's security rule, the
// app talks ONLY to this backend — never directly to Qwen.
//
// Priority, highest first:
//   1. A runtime override saved on-device (see setApiBaseUrlOverride below).
//      This is what lets an installed APK — where there's no dev server and
//      no rebuilding for every new tunnel URL — point at whatever backend
//      URL (e.g. a temporary ngrok tunnel) the person testing it was given
//      for that session, from a simple in-app settings screen.
//   2. EXPO_PUBLIC_API_BASE_URL, baked in at build time.
//   3. Auto-detected from the Metro dev server's own host (Expo Go / dev
//      client only — the phone already knows this IP, since that's how it
//      fetched the JS bundle in the first place. Undefined in a standalone
//      build, where there's no dev server to ask.)
//   4. http://localhost:8000 as a last-resort default.

const OVERRIDE_KEY = 'physics_platform_api_base_url_override';

function devApiBaseUrlFromMetroHost(): string | null {
  // "192.168.1.5:8081" while running inside Expo Go / a dev client;
  // undefined in a standalone/production build (no dev server involved).
  const hostUri = Constants.expoConfig?.hostUri;
  const host = hostUri?.split(':')[0];
  return host ? `http://${host}:8000` : null;
}

const explicitApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || null;
const defaultApiBaseUrl = explicitApiBaseUrl ?? devApiBaseUrlFromMetroHost() ?? 'http://localhost:8000';

// In-memory cache of the override, so the rest of the app can read it
// synchronously. loadApiBaseUrlOverride() populates this once at startup
// (see context/AuthContext.tsx); setApiBaseUrlOverride() updates it live
// whenever the user changes it from the settings screen.
let overrideCache: string | null = null;

export async function loadApiBaseUrlOverride(): Promise<void> {
  try {
    overrideCache = (await SecureStore.getItemAsync(OVERRIDE_KEY)) || null;
  } catch {
    overrideCache = null;
  }
}

export async function setApiBaseUrlOverride(url: string | null): Promise<void> {
  const trimmed = url?.trim() || null;
  overrideCache = trimmed;
  if (trimmed) {
    await SecureStore.setItemAsync(OVERRIDE_KEY, trimmed);
  } else {
    await SecureStore.deleteItemAsync(OVERRIDE_KEY);
  }
}

export function getApiBaseUrlOverride(): string | null {
  return overrideCache;
}

export function getDefaultApiBaseUrl(): string {
  return defaultApiBaseUrl;
}

export function getApiBaseUrl(): string {
  return overrideCache ?? defaultApiBaseUrl;
}
