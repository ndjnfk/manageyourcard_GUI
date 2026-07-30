/**
 * Catches the browser's install offer, before Angular exists.
 *
 * `beforeinstallprompt` fires once, early, and only once per page load. If
 * nothing is listening at that moment the offer is simply gone — there is no
 * way to ask for it back, and the app cannot show an install button for the
 * rest of the visit.
 *
 * That is exactly what happened when the listener lived in an Angular service:
 * the service is constructed the first time something injects it, which was
 * the signed-in shell — a lazily loaded chunk that does not exist yet on the
 * sign-in page. The event fired into nothing.
 *
 * So this module is deliberately framework-free and is called from main.ts
 * before `bootstrapApplication`. It is the earliest point our own code runs.
 */

/** Not in lib.dom yet, so it is described here rather than cast away. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Called once from main.ts, before the app boots. */
export function captureInstallPrompt(): void {
  if (typeof window === 'undefined') return;

  installed = window.matchMedia('(display-mode: standalone)').matches;

  window.addEventListener('beforeinstallprompt', (event) => {
    // Without this Chromium shows its own mini-infobar and the event is spent.
    // Keeping it is what lets our own button offer the install instead.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    notify();
  });

  window.addEventListener('appinstalled', () => {
    installed = true;
    // A prompt can only be used once, and this one has been.
    deferred = null;
    notify();
  });
}

/** Whether there is an install still worth offering. */
export function canInstall(): boolean {
  return deferred !== null && !installed;
}

/** Told when that answer changes, so a signal can follow it. */
export function onInstallChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Shows the browser's install dialog.
 *
 * Must be reached from a user gesture, with nothing awaited in between —
 * browsers only honour `prompt()` while the gesture is still live.
 */
export async function showInstallPrompt(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;

  // Cleared first: the event is single-use, and a second click on a spent one
  // throws.
  deferred = null;
  notify();

  await event.prompt();
  const { outcome } = await event.userChoice;

  return outcome === 'accepted';
}
