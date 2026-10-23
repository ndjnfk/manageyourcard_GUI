import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ApiError } from '../../shared/api';
import { AppShell } from '../../shared/app-shell/app-shell';
import { Card, Cards } from '../../shared/cards';

/**
 * A card that has left the register, with the bits the list needs worked out.
 *
 * Two kinds land here: cards the shopkeeper closed, and cards whose expiry ran
 * out and whose day of grace on the dashboard is over.
 */
interface HistoryCard {
  readonly cardId: string;
  readonly cardNumber: string;
  readonly customer: string;
  readonly mobile: string;
  readonly notes: string | null;
  readonly issued: Date | null;
  readonly due: Date | null;
  readonly completed: Date | null;
  /** Came here by expiring rather than by being closed. */
  readonly expired: boolean;
  readonly expiry: Date | null;
  /** 0 if it was never renewed before being closed. */
  readonly renewalCount: number;
  /** When it was last renewed, or null if it never was. */
  readonly renewedOn: Date | null;
  readonly initials: string;
}

/**
 * Reads a plain YYYY-MM-DD into a local midnight Date.
 *
 * Deliberately not `new Date(value)`: that parses a bare date string as UTC
 * midnight, which for anyone west of Greenwich is the previous evening.
 */
function parseCalendarDate(value: string | null): Date | null {
  if (!value) return null;

  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;

  return new Date(year, month - 1, day);
}

function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * History — the cards this shop has finished with.
 *
 * A card lands here when the shopkeeper turns on "Completed / Closed" in the
 * edit dialog. Nothing here is counted, chased or shown on the dashboard: the
 * whole point of closing a card is to stop it taking up attention. It is kept
 * rather than deleted because "what did we do for this customer, and when"
 * is exactly what someone asks six months later.
 *
 * Reopening is done from the same edit dialog on the dashboard — a card closed
 * by mistake is not a dead end.
 */
@Component({
  selector: 'app-history',
  imports: [AppShell, DatePipe, RouterLink],
  templateUrl: './history.html',
  styleUrl: './history.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class History {
  private readonly cardsApi = inject(Cards);
  private readonly destroyRef = inject(DestroyRef);

  private readonly closed = signal<readonly Card[]>([]);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);

  protected readonly query = signal('');

  protected readonly cards = computed<readonly HistoryCard[]>(() =>
    this.closed().map((card) => ({
      cardId: card.cardId,
      cardNumber: card.cardNumber,
      customer: card.customerName,
      mobile: card.customerMobile,
      notes: card.notes,
      issued: parseCalendarDate(card.issueDate),
      due: parseCalendarDate(card.dueDate),
      // An ISO timestamp, not a calendar date — the moment it was closed.
      completed: card.completedAt ? new Date(card.completedAt) : null,
      /**
       * Whether the card came here by expiring rather than by being closed.
       *
       * This page holds both now, and they arrived for opposite reasons: one
       * because the shopkeeper finished the work, the other because nobody got
       * to it in time. Calling the second one "Completed" — which is what a
       * single hardcoded badge did — reads as a job well done.
       */
      expired: card.completedAt === null,
      expiry: parseCalendarDate(card.expiryDate),
      renewalCount: card.renewalCount,
      renewedOn: card.renewedAt ? new Date(card.renewedAt) : null,
      initials: initialsOf(card.customerName),
    })),
  );

  /** Same three things a shopkeeper knows as on the dashboard's search. */
  protected readonly visibleCards = computed<readonly HistoryCard[]>(() => {
    const term = this.query().trim().toLowerCase();
    if (!term) return this.cards();

    return this.cards().filter(
      (card) =>
        card.cardNumber.toLowerCase().includes(term) ||
        card.customer.toLowerCase().includes(term) ||
        card.mobile.replace(/\s/g, '').includes(term.replace(/\s/g, '')),
    );
  });

  constructor() {
    this.load();
  }

  protected onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /** Loads the closed cards. Also the retry, when loading them failed. */
  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);

    this.cardsApi
      .listCompleted()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cards) => {
          this.closed.set(cards);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.loadError.set(
            error instanceof ApiError
              ? error.message
              : 'Could not load your history. Please try again in a moment.',
          );
        },
      });
  }
}
