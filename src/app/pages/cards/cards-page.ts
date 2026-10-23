import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, map, merge, switchMap } from 'rxjs';
import { RouterLink } from '@angular/router';
import { ApiError } from '../../shared/api';
import { AppShell } from '../../shared/app-shell/app-shell';
import { Card, CardFilter, Cards } from '../../shared/cards';
import { CardDetails } from '../../shared/card-details/card-details';
import { EditCard } from '../dashboard/edit-card/edit-card';

/** How many rows a page holds. Two full columns on a laptop, a scroll on a phone. */
const PER_PAGE = 12;

/** How a status is written and coloured. Tones are Bootstrap contextual classes. */
interface StatusMeta {
  readonly label: string;
  readonly tone: string;
  readonly badge: string;
}

const STATUS_META: Readonly<Record<string, StatusMeta>> = {
  Active: { label: 'Active', tone: 'text-success', badge: 'text-bg-success' },
  'Due Soon': { label: 'Due soon', tone: 'text-warning', badge: 'text-bg-warning' },
  Expired: { label: 'Overdue', tone: 'text-danger', badge: 'text-bg-danger' },
  Completed: { label: 'Completed', tone: 'text-info', badge: 'text-bg-info' },
};

/**
 * The muted look for a card whose own expiry has passed.
 *
 * The API reports one `Expired` status for two different situations — a due
 * date gone by, and an expiry gone by — so the table above cannot tell them
 * apart on its own. Only the second is finished: a card past its due date is
 * *overdue* and is exactly what the shopkeeper should be chasing, which is why
 * it keeps the red. Matches the dashboard, so the same card cannot be labelled
 * two different things on two pages.
 */
const EXPIRED_META: StatusMeta = {
  label: 'Expired',
  tone: 'myc-text-expired',
  badge: 'myc-badge-expired',
};

/** Midnight today, for comparing against a card's expiry. */
function startOfToday(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

/** Whether this card's expiry has passed — strictly, so the day itself counts. */
function hasExpired(card: Card, today: Date): boolean {
  const expiry = parseCalendarDate(card.expiryDate);

  return expiry !== null && expiry.getTime() < today.getTime();
}

/** A card with everything the row needs worked out. */
interface CardRow {
  readonly cardId: string;
  readonly cardNumber: string;
  readonly customer: string;
  readonly mobile: string;
  readonly notes: string | null;
  readonly due: Date | null;
  readonly renewalCount: number;
  readonly renewedOn: Date | null;
  readonly meta: StatusMeta;
  /** Expiry gone by — dimmed, and with no Edit. See the dashboard for why. */
  readonly expired: boolean;
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
 * All cards — the whole live register, searchable, filterable and paged.
 *
 * The dashboard shows the first handful of what needs doing today; this is
 * where a shopkeeper goes to find one particular card among hundreds.
 *
 * Searching, filtering and paging all happen on the API rather than in the
 * browser. Doing them here would mean searching only the page already
 * fetched, which reads as data going missing — and would make the pager lie
 * about how many matches there are.
 */
@Component({
  selector: 'app-cards-page',
  imports: [AppShell, CardDetails, DatePipe, EditCard, RouterLink],
  templateUrl: './cards-page.html',
  styleUrl: './cards-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardsPage {
  private readonly cardsApi = inject(Cards);
  private readonly destroyRef = inject(DestroyRef);

  private readonly editCard = viewChild.required(EditCard);

  /** The read-only details dialog, for rows that no longer have an Edit. */
  private readonly cardDetails = viewChild.required(CardDetails);

  protected readonly query = signal('');
  protected readonly filter = signal<CardFilter>('all');
  protected readonly page = signal(1);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);

  protected readonly total = signal(0);
  protected readonly lastPage = signal(1);

  private readonly cards = signal<readonly Card[]>([]);

  protected readonly filters: readonly { readonly key: CardFilter; readonly label: string }[] = [
    { key: 'all', label: 'All cards' },
    { key: 'today', label: 'Due today' },
    { key: 'week', label: 'This week' },
    // Two chips, not one. "Overdue" is now only cards whose renewal date has
    // gone by and which can still be renewed — the ones worth a phone call.
    // Expired cards have their own chip because nothing can be done about them,
    // and leaving them in with the rest made the chase list look longer than
    // the work actually was.
    { key: 'overdue', label: 'Overdue' },
    { key: 'expired', label: 'Expired' },
    { key: 'active', label: 'Active' },
  ];

  protected readonly rows = computed<readonly CardRow[]>(() => {
    const today = startOfToday();

    return this.cards().map((card) => {
      const expired = hasExpired(card, today);

      return {
        cardId: card.cardId,
        cardNumber: card.cardNumber,
        customer: card.customerName,
        mobile: card.customerMobile,
        notes: card.notes,
        due: parseCalendarDate(card.dueDate),
        renewalCount: card.renewalCount,
        // An ISO timestamp, not a calendar date — new Date() is right here.
        renewedOn: card.renewedAt ? new Date(card.renewedAt) : null,
        meta: expired ? EXPIRED_META : (STATUS_META[card.status] ?? STATUS_META['Active']),
        expired,
        initials: initialsOf(card.customerName),
      };
    });
  });

  /** "Showing 13–24 of 57" — the first index on this page, 1-based. */
  protected readonly firstShown = computed(() =>
    this.total() === 0 ? 0 : (this.page() - 1) * PER_PAGE + 1,
  );

  protected readonly lastShown = computed(() =>
    Math.min(this.page() * PER_PAGE, this.total()),
  );

  /**
   * The page numbers to draw: a window around the current page, so a register
   * of forty pages doesn't render forty buttons.
   */
  protected readonly pageNumbers = computed<readonly number[]>(() => {
    const last = this.lastPage();
    const current = this.page();
    const from = Math.max(1, Math.min(current - 2, last - 4));
    const to = Math.min(last, Math.max(current + 2, 5));

    return Array.from({ length: to - from + 1 }, (_, index) => from + index);
  });

  /**
   * Bumped to force a refetch when nothing about the query changed but the
   * data did. It is part of the key below, so `distinctUntilChanged` — which
   * exists to swallow the duplicate emissions the signals produce — lets it
   * through instead of treating it as more of the same.
   */
  private readonly tick = signal(0);

  constructor() {
    // One stream for every input that changes what should be on screen. The
    // debounce is what stops a request per keystroke; switchMap is what stops
    // a slow early response landing after a fast later one and showing stale
    // results.
    merge(
      toObservable(this.query),
      toObservable(this.filter),
      toObservable(this.page),
      toObservable(this.tick),
    )
      .pipe(
        debounceTime(200),
        map(() =>
          JSON.stringify([this.query().trim(), this.filter(), this.page(), this.tick()]),
        ),
        distinctUntilChanged(),
        switchMap((key) => {
          this.loading.set(true);
          this.loadError.set(null);
          const [search, filter, page] = JSON.parse(key) as [string, CardFilter, number];
          return this.cardsApi.listPage({ search, filter, page, perPage: PER_PAGE });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (result) => {
          this.cards.set(result.cards);
          this.total.set(result.total);
          this.lastPage.set(result.lastPage);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.loadError.set(
            error instanceof ApiError
              ? error.message
              : 'Could not load your cards. Please try again in a moment.',
          );
        },
      });
  }

  protected onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    // A new search is a new result set, so page 3 of the old one is meaningless.
    this.page.set(1);
  }

  protected clearSearch(): void {
    this.query.set('');
    this.page.set(1);
  }

  protected setFilter(next: CardFilter): void {
    this.filter.set(next);
    this.page.set(1);
  }

  protected goToPage(page: number): void {
    if (page < 1 || page > this.lastPage() || page === this.page()) return;

    this.page.set(page);
    // The list is below the toolbar; without this, changing page on a phone
    // leaves the reader halfway down a page they haven't seen the top of.
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  protected openEdit(cardId: string): void {
    const card = this.cards().find((entry) => entry.cardId === cardId);
    if (!card) return;

    this.editCard().open(card);
  }

  /** Everything on a card, read-only — what an expired row offers in place of Edit. */
  protected openDetails(cardId: string): void {
    const card = this.cards().find((entry) => entry.cardId === cardId);
    if (!card) return;

    this.cardDetails().open(card);
  }

  /**
   * Refetches after an edit rather than patching the row in place.
   *
   * A card that was just completed leaves the live register, and one that was
   * renewed may sort to a different page — so what belongs on this page has
   * genuinely changed, and only the API knows what it is now.
   */
  protected onCardSaved(): void {
    this.tick.update((n) => n + 1);
  }

  /** Retry, when loading failed. */
  protected retry(): void {
    this.tick.update((n) => n + 1);
  }
}
