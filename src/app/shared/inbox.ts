import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL, toApiError } from './api';

/** How many cards a reminder covered, split the way the dashboard splits them. */
export interface NotificationCounts {
  /**
   * Cards whose expiry has run out — finished rather than merely late.
   *
   * Optional because notifications written before this bucket existed carry no
   * value for it. Those entries are still in the list and must still render.
   */
  expired?: number;
  overdue: number;
  dueToday: number;
  dueSoon: number;
  total: number;
}

/** One notification in the shop's list. */
export interface AppNotification {
  id: string;
  kind: 'reminder';
  title: string;
  body: string;
  /** Where tapping it goes, as an in-app path. */
  url: string;
  counts: NotificationCounts | null;
  read: boolean;
  createdAt: string;
}

/**
 * The shop's in-app notification list — what the bell in the app bar opens.
 *
 * Separate from `Push`, which is about *delivery*. A push can fail, be switched
 * off, or never arrive because the phone was in a basement; this is the record
 * that the notification happened, and the only one a shopkeeper can go back and
 * read. The two are deliberately not merged: someone with notifications
 * switched off entirely still has this list.
 *
 * Held at the root so the app bar's badge and the notifications page read the
 * same state — marking everything read on the page has to clear the badge
 * behind it, without either knowing about the other.
 */
@Injectable({ providedIn: 'root' })
export class Inbox {
  private readonly http = inject(HttpClient);

  private readonly items = signal<readonly AppNotification[]>([]);
  readonly notifications = this.items.asReadonly();

  private readonly unread = signal(0);

  /** What the bell's badge shows. */
  readonly unreadCount = this.unread.asReadonly();

  readonly hasUnread = computed(() => this.unread() > 0);

  private readonly loading = signal(false);
  readonly busy = this.loading.asReadonly();

  /** Set when the last load failed, so the page can say so rather than look empty. */
  private readonly failure = signal<string | null>(null);
  readonly error = this.failure.asReadonly();

  /**
   * Loads the list. Called when the notifications page opens.
   *
   * The server refreshes the list against what is actually due as part of this,
   * which is what stops the page being empty on a fresh install — before the
   * nightly sweep has ever run. That work is claimed once a day server-side, so
   * opening the page repeatedly does not multiply the entries.
   */
  async load(): Promise<void> {
    this.loading.set(true);
    this.failure.set(null);

    try {
      const response = await firstValueFrom(
        this.http.get<{ data: { notifications: AppNotification[]; unread: number } }>(
          `${API_BASE_URL}/account/notifications/inbox`,
        ),
      );

      this.items.set(response.data.notifications);
      this.unread.set(response.data.unread);
    } catch (error) {
      this.failure.set(
        error instanceof HttpErrorResponse
          ? toApiError(error).message
          : 'Could not load your notifications.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Refreshes just the badge number.
   *
   * Its own endpoint rather than a `load()`: the badge is drawn on every signed
   * -in page, and pulling every notification body to render one number would be
   * wasteful. It also deliberately does not trigger the server-side refresh
   * that `load()` does — that writes to the database, and something drawn this
   * often must not.
   *
   * Silent on failure. A badge that cannot be fetched should show nothing, not
   * interrupt whatever the shopkeeper was doing.
   */
  async refreshCount(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<{ data: { unread: number } }>(
          `${API_BASE_URL}/account/notifications/inbox/unread`,
        ),
      );

      this.unread.set(response.data.unread);
    } catch {
      // Left as it was: a stale count is better than a flickering one.
    }
  }

  /**
   * Marks one as read, locally first.
   *
   * The local update lands before the request so the row responds to the tap
   * immediately — a notification that stays bold for the length of a round trip
   * reads as a tap that did not register. The server is the authority on the
   * count, so its answer replaces the optimistic one.
   */
  async markRead(id: string): Promise<void> {
    const target = this.items().find((item) => item.id === id);
    if (!target || target.read) return;

    this.items.update((list) =>
      list.map((item) => (item.id === id ? { ...item, read: true } : item)),
    );
    this.unread.update((count) => Math.max(0, count - 1));

    try {
      const response = await firstValueFrom(
        this.http.post<{ data: { unread: number } }>(
          `${API_BASE_URL}/account/notifications/inbox/${id}/read`,
          {},
        ),
      );

      this.unread.set(response.data.unread);
    } catch {
      // Put it back. Leaving it looking read when the server still has it
      // unread would mean the badge returns on the next page load with no
      // explanation.
      this.items.update((list) =>
        list.map((item) => (item.id === id ? { ...item, read: false } : item)),
      );
      this.unread.update((count) => count + 1);
    }
  }

  /** Marks everything read. Clears the badge. */
  async markAllRead(): Promise<void> {
    if (this.unread() === 0) return;

    const previous = this.items();

    this.items.update((list) => list.map((item) => ({ ...item, read: true })));
    this.unread.set(0);

    try {
      await firstValueFrom(
        this.http.post(`${API_BASE_URL}/account/notifications/inbox/read`, {}),
      );
    } catch {
      this.items.set(previous);
      await this.refreshCount();
    }
  }

  /** Empties the local state. Called on sign-out — this is one shop's list. */
  clear(): void {
    this.items.set([]);
    this.unread.set(0);
    this.failure.set(null);
  }
}
