import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AppShell } from '../../shared/app-shell/app-shell';
import { type AppNotification, Inbox } from '../../shared/inbox';

/**
 * The shop's notifications — what the bell in the app bar opens.
 *
 * A record of the reminders that have gone out, newest first. It exists because
 * a delivery is not a record: a push can be missed, dismissed by accident, or
 * never arrive at all, and a shopkeeper who switched notifications off entirely
 * still needs somewhere to see what is due. This list is the same information
 * with none of those failure modes.
 */
@Component({
  selector: 'app-notifications',
  imports: [AppShell],
  templateUrl: './notifications.html',
  styleUrl: './notifications.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Notifications {
  private readonly inbox = inject(Inbox);
  private readonly router = inject(Router);

  protected readonly notifications = this.inbox.notifications;
  protected readonly loading = this.inbox.busy;
  protected readonly loadError = this.inbox.error;
  protected readonly unread = this.inbox.unreadCount;

  protected readonly isEmpty = computed(
    () => !this.loading() && !this.loadError() && this.notifications().length === 0,
  );

  constructor() {
    void this.inbox.load();
  }

  /**
   * Opening a notification marks it read and goes where it points.
   *
   * Read-on-open rather than a separate control: the notification has been
   * seen, and asking someone to dismiss what they just read is busywork. The
   * mark is not awaited — the navigation should not wait on a write nobody is
   * looking at.
   */
  protected open(notification: AppNotification): void {
    void this.inbox.markRead(notification.id);
    void this.router.navigateByUrl(notification.url);
  }

  protected markAllRead(): void {
    void this.inbox.markAllRead();
  }

  /** Re-reads the list, and refreshes it against what is due right now. */
  protected reload(): void {
    void this.inbox.load();
  }

  /**
   * "2 hours ago", "yesterday", "12 Aug".
   *
   * Relative up to a week, because that is the span over which "how long ago"
   * is the useful question. Past that the date itself is what someone is
   * actually looking for.
   */
  protected when(notification: AppNotification): string {
    const then = new Date(notification.createdAt);
    const minutes = Math.floor((Date.now() - then.getTime()) / 60_000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;

    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;

    return then.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  /**
   * The accent a row is drawn in — the most urgent bucket it covers.
   *
   * Matches the dashboard's colours exactly, so a red dot here and a red badge
   * there mean the same thing. Nothing is more confusing than two screens using
   * the same palette to mean different things.
   */
  protected tone(notification: AppNotification): 'overdue' | 'today' | 'soon' {
    const counts = notification.counts;
    if (!counts) return 'soon';

    if (counts.overdue > 0) return 'overdue';
    if (counts.dueToday > 0) return 'today';

    return 'soon';
  }
}
