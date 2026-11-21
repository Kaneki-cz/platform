/**
 * App-wide "can we reach the server?" flag, without a native NetInfo module
 * (which would need a new APK). lib/api.ts flips it: a fetch that throws
 * (no network, DNS failure, server down) marks us offline; any response at
 * all marks us online again. components/OfflineBanner.tsx listens.
 */
type Listener = (offline: boolean) => void;

let offline = false;
const listeners = new Set<Listener>();

export function setOffline(next: boolean) {
  if (next === offline) return;
  offline = next;
  listeners.forEach((l) => l(offline));
}

export function isOffline() {
  return offline;
}

export function subscribeOffline(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
