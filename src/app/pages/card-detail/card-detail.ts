import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ApiError } from '../../shared/api';
import { AppShell } from '../../shared/app-shell/app-shell';
import { Card, Cards } from '../../shared/cards';
import { EditCard } from '../dashboard/edit-card/edit-card';

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

function startOfToday(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
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
 * One card's own page — everything about it, with Call and Edit.
 *
 * The dashboard's renewals and overdue panels name a customer but carry no
 * actions; the register above them does, but only for the cards it happens to
 * be showing. Tapping a name used to scroll up and hunt for the card, which
 * fails as soon as a filter, a search or the two-row limit is hiding it. A page
 * of its own always works, and can be linked to, bookmarked and reloaded.
 *
 * The card is fetched by CardID rather than handed over from the list that was
 * on screen, for that same reason: arriving here from a bookmark has to be as
 * good as arriving from a tap.
 */
@Component({
  selector: 'app-card-detail',
  imports: [AppShell, DatePipe, EditCard, RouterLink],
  templateUrl: './card-detail.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardDetail {
  private readonly cardsApi = inject(Cards);
  private readonly destroyRef = inject(DestroyRef);

  private readonly editCard = viewChild.required(EditCard);

  /** From the route — `cards/:cardId`, bound by withComponentInputBinding. */
  readonly cardId = input.required<string>();

  protected readonly card = signal<Card | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);

  /** The dates, parsed once, in the order a shopkeeper reads them. */
  protected readonly dates = computed(() => {
    const card = this.card();
    if (!card) return null;

    return {
      issued: parseCalendarDate(card.issueDate),
      due: parseCalendarDate(card.dueDate),
      expiry: parseCalendarDate(card.expiryDate),
      renewed: card.renewedAt ? new Date(card.renewedAt) : null,
      completed: card.completedAt ? new Date(card.completedAt) : null,
    };
  });

  /**
   * Whether the card's own expiry has passed.
   *
   * Drives the same two decisions as everywhere else: the muted look, and no
   * Edit. Renewing an expired card would not revive it — expiry outranks the
   * due date — so the button is not offered.
   */
  protected readonly expired = computed(() => {
    const expiry = this.dates()?.expiry;

    return expiry !== null && expiry !== undefined && expiry.getTime() < startOfToday().getTime();
  });

  protected readonly initials = computed(() => initialsOf(this.card()?.customerName ?? ''));

  /**
   * How the status reads here, which is not simply what the API stores.
   *
   * The API has one `Expired` for two situations — a due date gone by and an
   * expiry gone by — so printing `card.status` straight put "Expired" above an
   * Edit button on a card that was merely overdue. Same split as the register
   * and the dashboard, so one card cannot be called two things on two screens.
   */
  protected readonly badge = computed<{ label: string; tone: string }>(() => {
    const card = this.card();
    if (!card) return { label: '', tone: 'text-bg-secondary' };

    if (this.expired()) return { label: 'Expired', tone: 'myc-badge-expired' };

    if (card.status === 'Expired') return { label: 'Overdue', tone: 'text-bg-danger' };

    return { label: card.status, tone: 'text-bg-secondary' };
  });

  constructor() {
    /**
     * Loading is driven by an effect, not by the constructor.
     *
     * A required route input has no value while the component is being
     * constructed — reading it there throws NG0950. The effect runs once the
     * router has bound it, and again if the id changes, which is what makes
     * navigating from one card straight to another work without the component
     * being torn down and rebuilt.
     */
    effect(() => {
      this.cardId();
      this.load();
    });
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);

    this.cardsApi
      .get(this.cardId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (card) => {
          this.card.set(card);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.loadError.set(
            error instanceof ApiError
              ? error.message
              : 'Could not load this card. Please try again in a moment.',
          );
        },
      });
  }

  protected openEdit(): void {
    const card = this.card();
    if (!card) return;

    this.editCard().open(card);
  }

  /** Replaces the page's copy after a save, so it shows what was just written. */
  protected onSaved(card: Card): void {
    this.card.set(card);
  }
}
