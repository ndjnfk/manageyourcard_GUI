import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ApiError } from '../api';
import {
  Push,
  type NotificationSettings as Settings,
  type PushBlocker,
  type PushDevice,
} from '../push';
import { Toasts } from '../toast';

/** How each blocker is explained. See `PushBlocker` for why these are distinct. */
const BLOCKER_TEXT: Readonly<Record<PushBlocker, string>> = {
  unsupported: 'This browser cannot show notifications. Try Chrome, Edge or Firefox.',
  denied:
    'Notifications are blocked for this site. Allow them in your browser settings — the padlock beside the address bar — then switch this on again.',
  'not-configured': 'Push notifications are not set up in this build of the app yet.',
  'server-not-configured':
    'The server has no notification credentials yet, so nothing can be delivered.',
  'insecure-context':
    'Notifications need a secure connection (https). This page is served over plain http.',
};

/**
 * Reminder settings: the two channels, how far ahead to be told, and which
 * browsers are registered for push.
 *
 * A separate component rather than more of the profile page, because the two
 * have nothing to do with each other beyond sharing a screen — the profile form
 * saves on submit, this saves on every toggle, and mixing the two save models
 * into one form is how a page ends up with a Save button that only saves half
 * of what is on it.
 *
 * Toggles apply immediately. There is no Save here on purpose: a settings
 * switch that needs confirming is a switch people leave in the wrong position,
 * and every change here is trivially reversible.
 */
@Component({
  selector: 'app-notification-settings',
  templateUrl: './notification-settings.html',
  styleUrl: './notification-settings.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationSettings {
  private readonly push = inject(Push);
  private readonly toasts = inject(Toasts);

  protected readonly loading = signal(true);
  protected readonly settings = signal<Settings | null>(null);
  protected readonly loadError = signal<string | null>(null);

  /** Which toggle is mid-save, so only that row shows as busy. */
  protected readonly savingChannel = signal<'push' | 'email' | 'leadDays' | null>(null);

  protected readonly testing = signal(false);

  /** True inside the installed Android app. Suppresses the web-only advice. */
  protected readonly isNativeApp = this.push.native;

  /** The browser's own permission state, re-read on every render pass. */
  protected readonly permission = computed(() => this.push.permission());

  /**
   * Why push cannot be switched on, or null if it can.
   *
   * Depends on the loaded settings as well as the browser, because the server
   * having no Firebase credentials is just as much a blocker as the browser
   * refusing — and it is the one a shopkeeper cannot diagnose for themselves.
   */
  protected readonly blocker = computed<PushBlocker | null>(() => {
    const loaded = this.settings();
    return this.push.blocker(loaded?.available.push ?? true);
  });

  protected readonly blockerText = computed(() => {
    const reason = this.blocker();
    return reason ? BLOCKER_TEXT[reason] : null;
  });

  /** Whether email can be delivered at all. */
  protected readonly emailAvailable = computed(() => this.settings()?.available.email ?? false);

  protected readonly devices = computed<PushDevice[]>(() => this.settings()?.devices ?? []);

  /** The window that actually applies, whether chosen here or set on the server. */
  protected readonly leadDays = computed(() => this.settings()?.leadDays ?? 7);

  /** The choices offered for how far ahead to be reminded. */
  protected readonly leadOptions = [1, 3, 7, 14, 30];

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);

    try {
      this.settings.set(await this.push.settings());
    } catch (error) {
      this.loadError.set(
        error instanceof ApiError
          ? error.message
          : 'Could not load your notification settings. Try again in a moment.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Turns push on or off for this browser.
   *
   * Switching on does two separate things — asks the browser for permission and
   * saves the preference — and the order matters. Permission is asked first,
   * because someone who dismisses the prompt has not enabled anything, and
   * saving `push: true` first would leave the settings page showing on while
   * this browser is not actually registered.
   */
  protected async togglePush(event: Event): Promise<void> {
    const wanted = (event.target as HTMLInputElement).checked;
    const current = this.settings();
    if (!current || this.savingChannel()) return;

    this.savingChannel.set('push');

    try {
      if (wanted) {
        const token = await this.push.enable();

        if (!token) {
          // Put the switch back. It is showing "on" because the user just
          // clicked it, and leaving it there would claim something that did
          // not happen — `enable` returns null precisely when it did not.
          (event.target as HTMLInputElement).checked = false;
          this.toasts.error(
            'Notifications were not switched on',
            this.blockerText() ?? 'Your browser did not grant permission.',
          );
          return;
        }

        // `enable` registers the device, and the API switches the preference on
        // as part of that — so this only needs to reload what is now true.
        await this.reload();
        this.toasts.success('Notifications on', 'This device will be reminded about due cards.');
        return;
      }

      await this.push.disable();
      const saved = await this.push.savePreferences({ push: false });
      this.settings.update((state) =>
        state ? { ...state, preferences: saved, devices: [] } : state,
      );
      this.toasts.info('Push notifications off');
    } catch (error) {
      (event.target as HTMLInputElement).checked = !wanted;
      this.showFailure(error);
    } finally {
      this.savingChannel.set(null);
    }
  }

  /** Turns the daily reminder email on or off. */
  protected async toggleEmail(event: Event): Promise<void> {
    const wanted = (event.target as HTMLInputElement).checked;
    if (!this.settings() || this.savingChannel()) return;

    this.savingChannel.set('email');

    try {
      const saved = await this.push.savePreferences({ email: wanted });
      this.settings.update((state) => (state ? { ...state, preferences: saved } : state));
      this.toasts.info(wanted ? 'Reminder emails on' : 'Reminder emails off');
    } catch (error) {
      (event.target as HTMLInputElement).checked = !wanted;
      this.showFailure(error);
    } finally {
      this.savingChannel.set(null);
    }
  }

  /** Changes how many days ahead of a due date the reminders start. */
  protected async changeLeadDays(event: Event): Promise<void> {
    const value = Number((event.target as HTMLSelectElement).value);
    if (!this.settings() || this.savingChannel()) return;

    this.savingChannel.set('leadDays');

    try {
      const saved = await this.push.savePreferences({ leadDays: value });
      this.settings.update((state) =>
        state ? { ...state, preferences: saved, leadDays: value } : state,
      );
    } catch (error) {
      this.showFailure(error);
      // Reloaded rather than reverted by hand: the select is now showing a
      // value that was not saved, and the server's copy is the only one that
      // can be trusted to say what it should be.
      await this.reload();
    } finally {
      this.savingChannel.set(null);
    }
  }

  /**
   * Sends this shop its real reminder now.
   *
   * The real one, not a canned "this is a test" — what needs proving is that a
   * genuine reminder arrives and reads correctly, and a stand-in message proves
   * only half of that.
   */
  protected async sendTest(): Promise<void> {
    if (this.testing()) return;

    this.testing.set(true);

    try {
      const result = await this.push.sendTest();

      if (!result.sent) {
        this.toasts.info(
          result.reason === 'nothing-due' ? 'Nothing is due right now' : 'Nothing was sent',
          result.message ?? 'There is no reminder to send at the moment.',
        );
        return;
      }

      const channels = [
        result.push === 'sent' ? 'this device' : null,
        result.email === 'sent' ? 'your email' : null,
      ].filter(Boolean);

      this.toasts.success(
        'Reminder sent',
        `Covering ${result.cards} card${result.cards === 1 ? '' : 's'}, sent to ${channels.join(' and ')}.`,
      );
    } catch (error) {
      this.showFailure(error);
    } finally {
      this.testing.set(false);
    }
  }

  /** Re-reads everything from the API. Used after a change with side effects. */
  private async reload(): Promise<void> {
    try {
      this.settings.set(await this.push.settings());
    } catch {
      // The change itself succeeded; only the refresh failed. Leaving the
      // stale-but-close view is better than blanking the panel.
    }
  }

  private showFailure(error: unknown): void {
    this.toasts.error(
      'That did not save',
      error instanceof ApiError ? error.message : 'Please try again in a moment.',
    );
  }

  /** "Chrome on Windows" out of a user-agent string, or a plain fallback. */
  protected describeDevice(device: PushDevice): string {
    const agent = device.userAgent ?? '';

    const browser =
      /Edg\//.test(agent) ? 'Edge'
      : /OPR\//.test(agent) ? 'Opera'
      : /Chrome\//.test(agent) ? 'Chrome'
      : /Firefox\//.test(agent) ? 'Firefox'
      : /Safari\//.test(agent) ? 'Safari'
      : null;

    const platform =
      /Windows/.test(agent) ? 'Windows'
      : /Android/.test(agent) ? 'Android'
      : /iPhone|iPad|iOS/.test(agent) ? 'iOS'
      : /Mac OS X/.test(agent) ? 'macOS'
      : /Linux/.test(agent) ? 'Linux'
      : null;

    if (browser && platform) return `${browser} on ${platform}`;
    if (browser) return browser;
    if (platform) return platform;

    return 'Unknown device';
  }

  /** "today", "3 days ago" — enough to recognise a device by. */
  protected lastSeen(device: PushDevice): string {
    const days = Math.floor((Date.now() - new Date(device.lastSeenAt).getTime()) / 86_400_000);

    if (days <= 0) return 'used today';
    if (days === 1) return 'used yesterday';
    if (days < 30) return `used ${days} days ago`;

    return 'not used recently';
  }
}
