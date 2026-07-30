import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { ApiError } from '../../shared/api';
import { Toasts } from '../../shared/toast';
import { AdminApi, MaintenanceAction } from '../admin-api';
import { AdminAuth } from '../admin-auth';

/** A destructive action in the side panel, and how it is described. */
interface Maintenance {
  readonly action: MaintenanceAction;
  readonly label: string;
  readonly detail: string;
  /** Typed by the admin before it will run. */
  readonly warning: string;
}

const MAINTENANCE: readonly Maintenance[] = [
  {
    action: 'logout-shopkeepers',
    label: 'Sign out all shopkeepers',
    detail: 'Ends every shop session. They can sign straight back in.',
    warning: 'Every shopkeeper will have to sign in again.',
  },
  {
    action: 'clear-redis',
    label: 'Clear Redis',
    detail: 'Empties Redis. Admin sessions are kept so you stay signed in.',
    warning: 'Everything in Redis except admin sessions will be deleted.',
  },
  {
    action: 'clear-data',
    label: 'Clear all data',
    detail: 'Drops every shop, card and counter. Admins are kept.',
    warning: 'Every shop and every card will be permanently deleted.',
  },
];

/**
 * The admin panel's chrome: a fixed side panel with the navigation and the
 * destructive actions, and a bar across the top.
 *
 * The side panel is where the maintenance actions live, per the brief. They
 * each demand a typed confirmation before running — they wipe every shop's
 * data, and being one click from that in a permanently visible panel would be
 * reckless.
 */
@Component({
  selector: 'app-admin-shell',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './admin-shell.html',
  styleUrl: './admin-shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'closeNav(); cancelConfirm()',
  },
})
export class AdminShell {
  private readonly auth = inject(AdminAuth);
  private readonly api = inject(AdminApi);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toasts = inject(Toasts);

  /** Emitted after a maintenance action, so the page can refresh its figures. */
  readonly dataChanged = output<void>();

  protected readonly admin = this.auth.admin;
  protected readonly daysLeft = this.auth.daysLeft;

  protected readonly maintenance = MAINTENANCE;

  protected readonly navOpen = signal(false);
  protected readonly signingOut = signal(false);

  /** The action awaiting confirmation, or null. */
  protected readonly confirming = signal<Maintenance | null>(null);
  protected readonly confirmText = signal('');
  protected readonly running = signal(false);

  /** Outcome of the last action, shown until the next one is started. */
  protected readonly result = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  protected readonly navLinks = [
    { label: 'Dashboard', route: '/admin', exact: true },
    { label: 'Shopkeepers', route: '/admin/shopkeepers', exact: false },
  ];

  constructor() {
    effect(() => {
      this.document.body.classList.toggle('myc-no-scroll', this.navOpen());
    });

    this.destroyRef.onDestroy(() => {
      this.document.body.classList.remove('myc-no-scroll');
    });
  }

  protected toggleNav(): void {
    this.navOpen.update((open) => !open);
  }

  protected closeNav(): void {
    this.navOpen.set(false);
  }

  /** Arms an action. Nothing runs until the phrase is typed exactly. */
  protected askConfirm(item: Maintenance): void {
    this.confirming.set(item);
    this.confirmText.set('');
    this.result.set(null);
    this.failure.set(null);
  }

  protected cancelConfirm(): void {
    if (this.running()) return;

    this.confirming.set(null);
    this.confirmText.set('');
  }

  protected onConfirmInput(event: Event): void {
    this.confirmText.set((event.target as HTMLInputElement).value);
  }

  /** The typed phrase has to match exactly — case included. */
  protected canRun(): boolean {
    return this.confirmText() === 'CONFIRM' && !this.running();
  }

  protected run(): void {
    const item = this.confirming();
    if (!item || !this.canRun()) return;

    this.running.set(true);
    this.failure.set(null);

    this.api
      .maintenance(item.action)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (message) => {
          this.running.set(false);
          this.confirming.set(null);
          this.confirmText.set('');
          this.result.set(message);
          this.toasts.success(item.label, message);
          // The figures on whatever page is showing are now wrong.
          this.dataChanged.emit();
        },
        error: (error: unknown) => {
          this.running.set(false);
          const message =
            error instanceof ApiError
              ? error.message
              : 'That action failed. Please try again in a moment.';
          this.failure.set(message);
          this.toasts.error(`${item.label} failed`, message);
        },
      });
  }

  protected signOut(): void {
    if (this.signingOut()) return;
    this.signingOut.set(true);

    this.auth
      .logout()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.closeNav();
        this.toasts.info('Signed out', 'Your admin session has ended.');
        this.router.navigate(['/admin/login']);
      });
  }
}
