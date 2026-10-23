/**
 * The Firebase Cloud Messaging service worker.
 *
 * This is what displays a notification when the app is closed or in a
 * background tab — the only code that runs at all when the PWA is not open.
 *
 * Three things about this file are unusual and none of them are accidental:
 *
 *  1. It is plain JavaScript in `public/`, not TypeScript in `src/`. A service
 *     worker is fetched by the browser as a standalone script at a fixed URL,
 *     so it cannot be part of the Angular bundle or import from it.
 *
 *  2. The Firebase config is repeated here rather than imported from
 *     `src/app/shared/firebase-config.ts`, for the same reason. If you change
 *     the project, change it in both places — they are the same values, and
 *     there is no build step tying them together.
 *
 *  3. It uses the `compat` builds over importScripts. The modular SDK is ESM,
 *     and `importScripts` cannot load ES modules. The alternative is declaring
 *     the worker as `type: 'module'`, which Firefox only shipped recently — the
 *     compat build works everywhere.
 *
 * This runs alongside Angular's own `ngsw-worker.js`. Two service workers on
 * one origin is allowed; they are registered at different scopes and neither
 * knows about the other. See `src/app/shared/push.ts` for the registration.
 */

importScripts('https://www.gstatic.com/firebasejs/12.16.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging-compat.js');

// Must match src/app/shared/firebase-config.ts.
firebase.initializeApp({
  apiKey: 'AIzaSyC8gFSH9pQCC4fanxQz7HG5nWp1VCjdDss',
  authDomain: 'manageyourcard-a0c1a.firebaseapp.com',
  projectId: 'manageyourcard-a0c1a',
  storageBucket: 'manageyourcard-a0c1a.firebasestorage.app',
  messagingSenderId: '1051487653263',
  appId: '1:1051487653263:web:759e397b58ae1515ebcffa',
});

const messaging = firebase.messaging();

/**
 * Where the app is served from, derived from this file's own URL.
 *
 * Not written as '/', because the app is not necessarily at the origin root:
 * served under trustridesre.com/manageyourcard, a '/icons/…' icon 404s and a
 * click on '/dashboard' lands on the wrong site entirely. This worker sits
 * beside index.html whatever the deployment, so its own directory is the one
 * reliable answer.
 */
const APP_BASE = new URL('./', self.location.href);

/** Resolves a path from the API — always app-relative — against that base. */
function appUrl(path) {
  if (/^https?:/i.test(path)) return new URL(path);

  return new URL(String(path).replace(/^\/+/, ''), APP_BASE);
}

/**
 * Shows the notification when a message arrives and the app is not in the
 * foreground.
 *
 * The API sends the text under `data` as well as under `webpush.notification`,
 * and this handler reads the `data` copy. That is the reason the API does not
 * set a top-level `notification` field: when it does, FCM displays the message
 * itself *before* this handler runs, and the notification appears twice.
 */
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};

  self.registration.showNotification(data.title || 'manageyourcard', {
    body: data.body || '',
    icon: appUrl('icons/icon-192x192.png').href,
    // The card mark as a flat silhouette, not the launcher icon. Chrome draws
    // the badge from its alpha channel alone — colour is discarded and anything
    // opaque becomes solid white, so the purple app icon arrives as a
    // featureless white square. There is no tint to set from here either: the
    // native shell can colour its small icon (see the API's push service), the
    // web cannot. The mark survives as its outline and the stripe gap; the
    // full-colour version is on the right of the notification, as `icon`.
    badge: appUrl('icons/badge-96x96.png').href,
    // Today's reminder replaces yesterday's rather than stacking behind it —
    // a shopkeeper wants the current count, not a history of counts.
    tag: data.tag || 'due-reminder',
    renotify: true,
    // Carried through to the click handler below, which is the only place the
    // destination can be read back.
    data: { url: data.url || '/dashboard' },
  });
});

/**
 * Opens the app at the right page when the notification is tapped.
 *
 * Focuses an already-open window rather than opening a second one. Without
 * this, a shopkeeper who has the PWA open in the background gets a duplicate
 * window every time they tap a reminder.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const target = appUrl((event.notification.data && event.notification.data.url) || 'dashboard');

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        // Same origin means this is our app — navigate the tab that is already
        // there and bring it forward.
        if (new URL(client.url).origin === target.origin && 'focus' in client) {
          return client.navigate(target.href).then(() => client.focus());
        }
      }

      return self.clients.openWindow(target.href);
    }),
  );
});
