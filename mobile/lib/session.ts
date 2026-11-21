/**
 * "Your login expired" signal. lib/api.ts fires it when the server rejects
 * the saved token (401 on an authenticated request); context/AuthContext.tsx
 * listens, signs the user out and shows the login screen with a message —
 * instead of every screen failing with "Could not validate credentials".
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function notifySessionExpired() {
  listeners.forEach((l) => l());
}

export function onSessionExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
