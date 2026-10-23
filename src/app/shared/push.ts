import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { firstValueFrom } from 'rxjs';
// Type-only, so the SDK itself is not pulled into this chunk — see `#sdk`.
import type { FirebaseApp } from 'firebase/app';
import { API_BASE_URL, toApiError } from './api';
import { VAPID_PUBLIC_KEY, firebaseConfig, isPushConfigured } from './firebase-config';

/**
 * The tray slot foreground reminders are raised in on Android.
 *
 * One fixed id rather than a fresh one per message: Android replaces a
 * notification carrying an id it already has, so today's reminder takes the
 * place of yesterday's instead of stacking behind it. The web side spells the
 * same intention `tag: 'due-reminder'`.
 */
const FOREGROUND_NOTIFICATION_ID = 1;

/** A shop's notification settings, as the API stores them. */
export interface NotificationPreferences {
  push: boolean;
  email: boolean;
  /** Days ahead of a due date to be reminded, or null to follow the server. */
  leadDays: number | null;
}

/** One browser registered to receive push for this shop. */
export interface PushDevice {
  /** The last 12 characters of the token — enough to tell rows apart. */
  id: string;
  platform: 'web' | 'android' | 'ios';
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
}

/** Everything the settings page needs in one call. */
export interface NotificationSettings {
  preferences: NotificationPreferences;
  devices: PushDevice[];
  /** Whether the server has the credentials to send on each channel. */
  available: { push: boolean; email: boolean };
  /** The reminder window this shop actually gets, in days. */
  leadDays: number;
}

/**
 * Why push cannot be switched on here, or null when it can.
 *
 * Each reads differently to a shopkeeper and needs different wording, which is
 * why this is a reason rather than a boolean. "Your browser does not support
 * this" and "you blocked notifications, here is how to unblock them" are not
 * the same message, and showing the wrong one sends someone hunting through
 * settings for a switch that was never there.
 */
export type PushBlocker =
  | 'unsupported'
  | 'denied'
  | 'not-configured'
  | 'server-not-configured'
  | 'insecure-context';

/**
 * Web push, through Firebase Cloud Messaging.
 *
 * Reaches desktop browsers, Android Chrome, and iOS 16.4+ — the last only once
 * the app has been added to the home screen, which is Apple's rule and not
 * something the app can work around. `blocker()` reports which of those cases a
 * given browser is in so the settings page can explain itself.
 *
 * Everything here is defensive. Push is a bonus on top of an app that works
 * fully without it, so no failure in this service should ever surface as
 * anything worse than the toggle not turning on.
 */
@Injectable({ providedIn: 'root' })
export class Push {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  /**
   * Whether this is the Android app rather than a browser.
   *
   * The two take completely different routes to the same place: the native
   * build talks to FCM through the OS, and the Firebase JS SDK, VAPID keys and
   * service workers are all irrelevant to it. Nearly every method here branches
   * on this, and the branches share only the API calls at the end.
   */
  private readonly isNative = Capacitor.isNativePlatform();

  /**
   * Which kind of client this is, in the API's vocabulary.
   *
   * Read from Capacitor rather than assumed, because the server builds a
   * different FCM payload per platform and picks it from this value alone. An
   * iOS build that filed itself as 'android' would be sent an
   * `android.notification` block, which APNs has no idea what to do with — the
   * token registers, the server reports the push as sent, and the phone shows
   * nothing. Nothing anywhere would say why.
   */
  private readonly clientPlatform: 'web' | 'android' | 'ios' =
    Capacitor.getPlatform() === 'ios' ? 'ios'
    : Capacitor.getPlatform() === 'android' ? 'android'
    : 'web';

  /**
   * Whether this is the installed app rather than a browser.
   *
   * Exposed because the settings page has advice that only applies to one of
   * them — the iOS "add to home screen" caveat is a web-push limitation, and
   * showing it inside the Android app would be telling a shopkeeper to install
   * something they have already installed.
   */
  readonly native = this.isNative;

  private app: FirebaseApp | null = null;

  /**
   * The native permission state, mirrored into a signal.
   *
   * The web can be asked synchronously — `Notification.permission` is a
   * property. Capacitor's equivalent is a promise, and the settings page reads
   * permission from inside a computed, so the answer has to already be here by
   * the time it looks. Seeded on construction and updated after every request.
   */
  private readonly nativePermission = signal<NotificationPermission | 'unavailable'>('default');

  constructor() {
    if (this.isNative) {
      void this.syncNativePermission();
      void this.listenOnNative();
    }
  }

  /**
   * The Firebase SDK, imported on first use rather than at startup.
   *
   * `Push` is injected at the app root so it can re-register the token on
   * sign-in, which would otherwise drag the whole messaging SDK — around 75kB
   * over the wire — into the initial bundle. Most visits never touch push at
   * all, and the ones that do are already past the point where load time is
   * what matters. Loading it here keeps that cost off the first paint, which
   * on a shop's mobile connection is the one that is felt.
   *
   * The promise is cached, not the module, so concurrent callers share one
   * fetch instead of racing to start several.
   */
  private sdk: Promise<{
    app: typeof import('firebase/app');
    messaging: typeof import('firebase/messaging');
  }> | null = null;

  private loadSdk() {
    this.sdk ??= Promise.all([import('firebase/app'), import('firebase/messaging')]).then(
      ([app, messaging]) => ({ app, messaging }),
    );

    return this.sdk;
  }

  /** The token this browser currently holds, once it has been fetched. */
  private readonly currentToken = signal<string | null>(null);

  readonly token = this.currentToken.asReadonly();

  /** Whether a permission prompt or token fetch is in flight. */
  private readonly working = signal(false);
  readonly busy = this.working.asReadonly();

  /**
   * The browser's notification permission, re-read rather than cached.
   *
   * It can change outside the app entirely — through the padlock menu in the
   * address bar — so a cached value goes stale with nothing to invalidate it.
   */
  permission(): NotificationPermission | 'unavailable' {
    if (this.isNative) return this.nativePermission();

    if (typeof Notification === 'undefined') return 'unavailable';
    return Notification.permission;
  }

  /** Reads the OS permission on Android into `nativePermission`. */
  private async syncNativePermission(): Promise<void> {
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const status = await PushNotifications.checkPermissions();

      // Capacitor's vocabulary is receive: 'granted' | 'denied' | 'prompt'.
      // Mapped onto the web's names so the rest of the service and the
      // settings page have one set of states to reason about.
      this.nativePermission.set(
        status.receive === 'granted' ? 'granted'
        : status.receive === 'denied' ? 'denied'
        : 'default',
      );
    } catch {
      this.nativePermission.set('unavailable');
    }
  }

  /**
   * Why push is unavailable, or null if it can be switched on.
   *
   * `serverConfigured` comes from the settings endpoint: the browser can be
   * perfectly capable while the API has no Firebase credentials, and a toggle
   * that turns on and then never delivers anything is worse than one that
   * explains why it is disabled.
   */
  blocker(serverConfigured = true): PushBlocker | null {
    if (!serverConfigured) return 'server-not-configured';

    /**
     * The native app skips every web check below it.
     *
     * None of them mean anything here: there is no VAPID key (that is a Web
     * Push concept), no service worker, no `Notification` global, and no
     * secure-context rule — the app's assets are loaded from the APK, not
     * over http. Falling through to them would report the Android build as
     * "not configured" and disable a toggle that works perfectly.
     */
    if (this.isNative) {
      const state = this.permission();

      if (state === 'unavailable') return 'unsupported';
      if (state === 'denied') return 'denied';

      return null;
    }

    if (!isPushConfigured()) return 'not-configured';

    // The Push API is unavailable outside a secure context, and the failure is
    // an obscure one. localhost counts as secure, so this only bites a
    // deployment served over plain HTTP.
    if (typeof isSecureContext !== 'undefined' && !isSecureContext) return 'insecure-context';

    if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) {
      return 'unsupported';
    }

    if (Notification.permission === 'denied') return 'denied';

    return null;
  }

  /** Whether this client can do push at all. Asked before offering it. */
  async supported(): Promise<boolean> {
    // The native app always can: the plugin is compiled in, and google-services
    // .json is baked into the APK at build time rather than checked at runtime.
    if (this.isNative) return true;

    try {
      if (!isPushConfigured()) return false;

      const { messaging } = await this.loadSdk();
      return await messaging.isSupported();
    } catch {
      return false;
    }
  }

  /**
   * Asks for permission, gets a token, and registers it against the signed-in
   * shop. Returns the token, or null if it could not be obtained.
   *
   * Safe to call when already enabled — FCM returns the existing token, and
   * re-registering refreshes `lastSeenAt` on the server.
   */
  async enable(): Promise<string | null> {
    if (this.working()) return this.currentToken();

    this.working.set(true);
    try {
      if (this.isNative) return await this.enableNative();

      if (!(await this.supported())) return null;

      // Must be called from a user gesture on most browsers. The settings
      // toggle is one; calling this on page load is not, and Chrome now
      // refuses those outright rather than prompting.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return null;

      const registration = await this.registerServiceWorker();
      if (!registration) return null;

      const { messaging } = await this.loadSdk();

      const token = await messaging.getToken(messaging.getMessaging(await this.firebase()), {
        vapidKey: VAPID_PUBLIC_KEY,
        // Passed explicitly so FCM uses our registration rather than going
        // looking for /firebase-messaging-sw.js and registering a second copy
        // at a different scope.
        serviceWorkerRegistration: registration,
      });

      if (!token) return null;

      await this.sendTokenToApi(token, 'web');
      this.currentToken.set(token);
      await this.listenInForeground();

      return token;
    } catch (error) {
      console.error('Could not enable push notifications', error);
      return null;
    } finally {
      this.working.set(false);
    }
  }

  /**
   * Stops push to this browser: tells the API to forget the token, then asks
   * FCM to delete it.
   *
   * The API is told first on purpose. If the local delete succeeded and the
   * API call then failed, the server would keep sending to a token this
   * browser no longer holds — the shopkeeper would have switched notifications
   * off and still, silently, be a registered device.
   */
  async disable(): Promise<void> {
    const token = this.currentToken();

    try {
      if (token) {
        await firstValueFrom(
          this.http.delete(`${API_BASE_URL}/account/notifications/devices`, { body: { token } }),
        );
      }

      if (this.isNative) {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        // Severs this device from FCM entirely. The OS permission is left
        // alone — revoking that is the user's to do in Android settings, and
        // an app that reset it would have to re-prompt to be switched back on.
        await PushNotifications.unregister();
        return;
      }

      if (await this.supported()) {
        const { messaging } = await this.loadSdk();
        await messaging.deleteToken(messaging.getMessaging(await this.firebase()));
      }
    } catch (error) {
      // Nothing here is worth interrupting the user for: the preference is
      // saved separately, and the server stops sending either way.
      console.warn('Could not fully unregister push', error);
    } finally {
      this.currentToken.set(null);
    }
  }

  /**
   * Re-registers this browser's existing token, without prompting.
   *
   * Called after sign-in. FCM rotates tokens, and a rotated token that was
   * never sent up is a device the server keeps pushing to at an address that no
   * longer resolves — the shopkeeper simply stops getting notifications, with
   * nothing anywhere saying why. It also re-points the device at whoever has
   * just signed in, which is what stops a shared browser from delivering the
   * previous shop's customer names.
   *
   * Silent by design: it never asks for permission, so it does nothing at all
   * on a browser that has not already granted it.
   */
  async refresh(): Promise<void> {
    try {
      if (this.isNative) {
        await this.syncNativePermission();
        if (this.permission() !== 'granted') return;

        // Already granted, so this re-registers without prompting — the OS
        // returns the existing token rather than asking again.
        const token = await this.registerNative();
        if (token) {
          await this.sendTokenToApi(token, this.clientPlatform);
          this.currentToken.set(token);
        }
        return;
      }

      if (this.permission() !== 'granted') return;
      if (!(await this.supported())) return;

      const registration = await this.registerServiceWorker();
      if (!registration) return;

      const { messaging } = await this.loadSdk();

      const token = await messaging.getToken(messaging.getMessaging(await this.firebase()), {
        vapidKey: VAPID_PUBLIC_KEY,
        serviceWorkerRegistration: registration,
      });

      if (!token) return;

      await this.sendTokenToApi(token, 'web');
      this.currentToken.set(token);
      await this.listenInForeground();
    } catch (error) {
      console.warn('Could not refresh the push token', error);
    }
  }

  /** The settings page's state — preferences, devices and what the server can do. */
  async settings(): Promise<NotificationSettings> {
    try {
      const response = await firstValueFrom(
        this.http.get<{ data: NotificationSettings }>(`${API_BASE_URL}/account/notifications`),
      );
      return response.data;
    } catch (error) {
      throw toApiError(error as HttpErrorResponse);
    }
  }

  /** Saves changed settings. Only what changed needs sending. */
  async savePreferences(changes: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    try {
      const response = await firstValueFrom(
        this.http.patch<{ data: NotificationPreferences }>(
          `${API_BASE_URL}/account/notifications`,
          changes,
        ),
      );
      return response.data;
    } catch (error) {
      throw toApiError(error as HttpErrorResponse);
    }
  }

  /** Sends this shop its real reminder now, ignoring today's send log. */
  async sendTest(): Promise<{
    sent: boolean;
    reason?: string;
    message?: string;
    cards?: number;
    push?: string;
    email?: string;
  }> {
    try {
      const response = await firstValueFrom(
        this.http.post<{ data: { sent: boolean; reason?: string; message?: string } }>(
          `${API_BASE_URL}/account/notifications/test`,
          {},
        ),
      );
      return response.data;
    } catch (error) {
      throw toApiError(error as HttpErrorResponse);
    }
  }

  /**
   * Asks Android for permission, registers with FCM, and files the token.
   *
   * Android 13+ needs a runtime permission, and `POST_NOTIFICATIONS` must be
   * declared in AndroidManifest.xml or this returns "denied" without ever
   * showing a dialog — indistinguishable, from here, from the user refusing.
   */
  private async enableNative(): Promise<string | null> {
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');

      const status = await PushNotifications.requestPermissions();
      await this.syncNativePermission();

      if (status.receive !== 'granted') return null;

      const token = await this.registerNative();
      if (!token) return null;

      await this.sendTokenToApi(token, this.clientPlatform);
      this.currentToken.set(token);

      return token;
    } catch (error) {
      console.error('Could not enable notifications on this device', error);
      return null;
    }
  }

  /**
   * Registers with FCM and resolves the device token.
   *
   * Wrapped in a promise because the plugin's `register()` does not return the
   * token — it resolves as soon as the request is *made*, and the token arrives
   * later on the 'registration' event. Awaiting `register()` alone would
   * reliably give back nothing at all.
   *
   * The timeout is the third way out. Registration can hang indefinitely when
   * Play Services is unavailable or the device is offline, and without it the
   * settings toggle would sit spinning with no path to an error.
   */
  private async registerNative(): Promise<string | null> {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    return new Promise<string | null>((resolve) => {
      let settled = false;
      const handles: { remove: () => Promise<void> }[] = [];

      const finish = (token: string | null) => {
        if (settled) return;
        settled = true;

        clearTimeout(timer);
        // Removed on every path. These listeners are per-registration; leaving
        // them attached would stack another pair on each sign-in, and every one
        // of them would resolve a promise nobody is waiting on any more.
        void Promise.all(handles.map((handle) => handle.remove())).catch(() => {});

        resolve(token);
      };

      const timer = setTimeout(() => {
        console.warn('FCM registration timed out');
        finish(null);
      }, 20_000);

      void (async () => {
        try {
          handles.push(
            await PushNotifications.addListener('registration', (token) => finish(token.value)),
          );
          handles.push(
            await PushNotifications.addListener('registrationError', (error) => {
              console.error('FCM registration failed', error);
              finish(null);
            }),
          );

          await PushNotifications.register();
        } catch (error) {
          console.error('Could not register with FCM', error);
          finish(null);
        }
      })();
    });
  }

  /**
   * Handles notifications that arrive while the Android app is open, and taps
   * on ones that arrived while it was not.
   *
   * Attached once at construction rather than after registration, because a tap
   * on a notification can *launch* the app: the listener has to already exist
   * when that happens, or the event fires into nothing and the tap opens the
   * dashboard instead of the page it named.
   */
  private async listenOnNative(): Promise<void> {
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');

      // Foreground. Android hands a message straight to the app while it is in
      // front and draws nothing itself, so the tray notification has to be
      // raised here — as a local notification rather than an in-app toast, so a
      // reminder looks and behaves the same whether the app happened to be open
      // when it arrived. It also survives the app being closed, which is the
      // whole point of a due-date reminder.
      await PushNotifications.addListener('pushNotificationReceived', (notification) => {
        const title = notification.title ?? (notification.data?.['title'] as string | undefined);
        const body = notification.body ?? (notification.data?.['body'] as string | undefined);

        if (title) {
          void this.showLocalNotification(
            title,
            body,
            notification.data?.['url'] as string | undefined,
          );
        }
      });

      // A tap, from the tray. Routed in-app rather than reloading the web view,
      // which would throw away the session restore and flash the landing page.
      await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const url = action.notification.data?.['url'] as string | undefined;

        void this.router.navigateByUrl(url ?? '/dashboard');
      });

      // A tap on one of the notifications raised above. A local notification is
      // a different event from a pushed one even though it looks identical in
      // the tray, so without this the tap only opens the app and the shopkeeper
      // lands on the dashboard rather than the card the reminder was about.
      const { LocalNotifications } = await import('@capacitor/local-notifications');

      await LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
        const url = action.notification.extra?.['url'] as string | undefined;

        void this.router.navigateByUrl(url ?? '/dashboard');
      });
    } catch (error) {
      console.warn('Could not attach native push listeners', error);
    }
  }

  /**
   * Raises a tray notification for a message that arrived with the app open.
   *
   * The channel and the status-bar icon are the ones the pushed notifications
   * already use, so a reminder that arrived while the app was open is
   * indistinguishable from one that arrived while it was closed — same icon,
   * same colour, same place in the shopkeeper's notification settings.
   */
  private async showLocalNotification(
    title: string,
    body: string | undefined,
    url: string | undefined,
  ): Promise<void> {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');

      await LocalNotifications.schedule({
        notifications: [
          {
            // Fixed, so today's reminder replaces yesterday's rather than
            // stacking behind it — the same thing `tag` does on the web.
            id: FOREGROUND_NOTIFICATION_ID,
            title,
            body: body ?? '',
            // Must match the channel MainActivity creates, and the one the API
            // sends pushed reminders on. A notification on a channel that does
            // not exist is dropped without an error.
            channelId: 'due_reminders',
            // The white silhouette from res/drawable, not the launcher icon.
            smallIcon: 'ic_stat_notify',
            // Read back by the tap listener — the only place it can be.
            extra: { url: url ?? '/dashboard' },
          },
        ],
      });
    } catch (error) {
      console.warn('Could not show the notification', error);
    }
  }

  /** The Firebase app, created once and reused. */
  private async firebase(): Promise<FirebaseApp> {
    const { app } = await this.loadSdk();

    this.app ??= app.initializeApp(firebaseConfig);
    return this.app;
  }

  /**
   * Registers the messaging service worker, or returns the existing one.
   *
   * Given its own narrow scope rather than the app's own. Angular's
   * `ngsw-worker.js` already claims that, and while two workers can share an
   * origin they cannot share a scope — registering this one over the app's
   * would replace the one making it installable and able to work offline.
   *
   * Both paths are resolved against `document.baseURI` rather than written as
   * '/…'. A deployment under a subfolder — trustridesre.com/manageyourcard —
   * has no /firebase-messaging-sw.js at the origin root, so a root path 404s,
   * the registration fails, and no FCM token is ever issued. The symptom is
   * not an error anyone sees: reminders simply report `push: skipped` forever,
   * because the shop has no device on file to push to.
   */
  private async registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) return null;

    try {
      const script = new URL('firebase-messaging-sw.js', document.baseURI);
      const scope = new URL('firebase-cloud-messaging-push-scope', document.baseURI);

      return await navigator.serviceWorker.register(script.pathname, {
        scope: scope.pathname,
      });
    } catch (error) {
      console.error('Could not register the messaging service worker', error);
      return null;
    }
  }

  /**
   * Files the token against the signed-in shop.
   *
   * The platform is sent because the server builds a different FCM payload for
   * each: an Android device needs a `notification` block to display anything
   * while backgrounded, iOS needs an `aps` one, and sending either shape to a
   * browser shows the notification twice. Getting this wrong fails silently in
   * every direction.
   */
  private async sendTokenToApi(
    token: string,
    platform: 'web' | 'android' | 'ios',
  ): Promise<void> {
    await firstValueFrom(
      this.http.post(`${API_BASE_URL}/account/notifications/devices`, { token, platform }),
    );
  }

  /** Set once, so repeated enable()/refresh() calls do not stack listeners. */
  private listening = false;

  /**
   * Shows a message that arrives while the app is open and focused.
   *
   * The service worker's `onBackgroundMessage` does not fire in this case — the
   * browser deliberately leaves a foreground app to present its own message —
   * so without this a reminder arriving while someone is looking at the
   * dashboard would be silently dropped.
   *
   * Shown through the service worker's `showNotification` rather than as an
   * in-app toast, so a reminder looks the same wherever it arrives: in the
   * system tray, outliving the tab, and clickable back into the app. A toast
   * disappears on its own and is gone the moment the page is closed, which is
   * the opposite of what a due-date reminder is for.
   */
  private async listenInForeground(): Promise<void> {
    if (this.listening) return;
    this.listening = true;

    try {
      const { messaging } = await this.loadSdk();
      // The same registration the token was issued against, so the click lands
      // in this worker's `notificationclick` handler.
      const registration = await this.registerServiceWorker();

      messaging.onMessage(messaging.getMessaging(await this.firebase()), (payload) => {
        const title = payload.data?.['title'] ?? payload.notification?.title;
        const body = payload.data?.['body'] ?? payload.notification?.body;

        if (!title || !registration) return;

        void registration.showNotification(title, {
          body: body ?? '',
          icon: new URL('icons/icon-192x192.png', document.baseURI).pathname,
          // Monochrome and transparent — see the note in
          // public/firebase-messaging-sw.js. The app icon here comes out as a
          // white square on Android.
          badge: new URL('icons/badge-96x96.png', document.baseURI).pathname,
          // Matches the background handler: today's reminder replaces
          // yesterday's rather than stacking behind it.
          tag: payload.data?.['tag'] ?? 'due-reminder',
          data: { url: payload.data?.['url'] ?? '/dashboard' },
        });
      });
    } catch (error) {
      console.warn('Could not listen for foreground messages', error);
      this.listening = false;
    }
  }
}
