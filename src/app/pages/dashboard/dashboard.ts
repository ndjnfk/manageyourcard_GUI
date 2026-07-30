import { DatePipe, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ApiError } from '../../shared/api';
import { AppShell } from '../../shared/app-shell/app-shell';
import { Auth } from '../../shared/auth';
import { Card, Cards } from '../../shared/cards';
import { AddCard } from './add-card/add-card';
import { EditCard } from './edit-card/edit-card';

/**
 * The four buckets a card can fall into. They are disjoint and derived purely
 * from the due date against today, so they always add up to the total — the
 * same rule the landing page describes.
 */
type CardState = 'active' | 'today' | 'week' | 'expired';

/** How a state is written and coloured. Tones are Bootstrap contextual classes. */
interface StateMeta {
  readonly label: string;
  readonly tone: string;
  readonly badge: string;
}

const STATE_META: Readonly<Record<CardState, StateMeta>> = {
  active: { label: 'Active', tone: 'text-success', badge: 'text-bg-success' },
  today: { label: 'Due today', tone: 'text-warning', badge: 'text-bg-warning' },
  week: { label: 'Due soon', tone: 'text-warning', badge: 'text-bg-warning' },
  expired: { label: 'Overdue', tone: 'text-danger', badge: 'text-bg-danger' },
};

/** A card from the API with everything the template needs worked out. */
interface DashboardCard {
  /** Primary key — what the list tracks by, since it never changes. */
  readonly cardId: string;
  /** The number written on the physical card. What the shopkeeper searches by. */
  readonly cardNumber: string;
  readonly customer: string;
  readonly mobile: string;
  readonly notes: string | null;
  /** 0 if never renewed. Drives the "Renewed" line under the customer's name. */
  readonly renewalCount: number;
  /** When it was last renewed. Null on a card that never has been. */
  readonly renewedOn: Date | null;
  readonly issued: Date;
  readonly due: Date;
  /** Days from today the card falls due. Negative means it has passed. */
  readonly dueInDays: number;
  /**
   * The finer four-way bucket this page groups by. The record's own Status is
   * the three-value one the schema defines; "Due today" and "Due this week"
   * are both "Due Soon" there, split here because they need acting on
   * differently.
   */
  readonly state: CardState;
  readonly meta: StateMeta;
  /** "Due in 4 days" / "Due today" / "6 days overdue" — ready to print. */
  readonly relative: string;
  readonly initials: string;
  /** 0–100, how much of the issue→due cycle has been used up. Drives the ring. */
  readonly progress: number;
}

interface StatTile {
  readonly key: CardState | 'total' | 'renewals';
  readonly icon: 'cards' | 'check' | 'today' | 'week' | 'alert' | 'renew';
  readonly label: string;
  readonly value: number;
  readonly hint: string;
  readonly tone: string;
  /** Filter applied when the tile is tapped, or null if it isn't a filter. */
  readonly filter: CardState | 'all' | null;
}

/** Filter chips above the register. */
type Filter = CardState | 'all';

const DAY_MS = 86_400_000;

/** Cards shown in the register before "Show more" — two full rows on a laptop. */
const CARD_PAGE = 6;

/** Rows shown in the renewals / overdue panels before "Show more". */
const LIST_PAGE = 5;

/** Midnight today — every date in the page is measured from here. */
function startOfToday(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

/**
 * Reads a plain YYYY-MM-DD from the API into a local midnight Date.
 *
 * Deliberately not `new Date(value)`: that parses a bare date string as UTC
 * midnight, which for anyone west of Greenwich is the previous evening — and a
 * card would show as due a day early. Splitting the parts and building a local
 * date keeps "the 14th" meaning the 14th.
 */
function parseCalendarDate(value: string): Date | null {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;

  return new Date(year, month - 1, day);
}

/** Whole days from `from` to `to`. Both are local midnights, so this is exact. */
function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

function bucket(dueInDays: number): CardState {
  if (dueInDays < 0) return 'expired';
  if (dueInDays === 0) return 'today';
  if (dueInDays <= 7) return 'week';
  return 'active';
}

function relativeLabel(dueInDays: number): string {
  if (dueInDays === 0) return 'Due today';
  if (dueInDays === 1) return 'Due tomorrow';
  if (dueInDays > 1) return `Due in ${dueInDays} days`;
  if (dueInDays === -1) return '1 day overdue';
  return `${Math.abs(dueInDays)} days overdue`;
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
 * Signed-in shopkeeper's dashboard: the six headline counts, the register
 * itself, and the two panels that need acting on.
 *
 * The register is loaded from the API and everything on the page is derived
 * from it, so adding a card through the dialog updates the counts, the filters
 * and both panels without any of them being told about it.
 */
@Component({
  selector: 'app-dashboard',
  imports: [AddCard, AppShell, EditCard, DatePipe, NgTemplateOutlet, RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  private readonly auth = inject(Auth);
  private readonly cardsApi = inject(Cards);

  /** The add-card dialog, opened by every "Add new card" control on the page. */
  private readonly addCard = viewChild.required(AddCard);

  /** The edit dialog, opened from a card's Edit button. */
  private readonly editCard = viewChild.required(EditCard);

  /**
   * Whoever is signed in, from the session. Cards are isolated by `id` — the
   * ShopkeeperID the API assigned at registration.
   *
   * The non-null assertion is safe because authGuard does not let this route
   * load without a session; the fallbacks below cover the shape only.
   */
  protected readonly shop = computed(() => {
    const shopkeeper = this.auth.shopkeeper();

    return {
      id: shopkeeper?.shopkeeperId ?? '',
      owner: shopkeeper?.ownerName ?? '',
      name: shopkeeper?.shopName ?? '',
      // Not part of the shop record — a shop registers a name, an owner, a
      // mobile and an email, and nothing asks for a city. The mobile is what
      // there is to show beside the ID.
      contact: shopkeeper?.mobile ?? '',
      initials: initialsOf(shopkeeper?.ownerName ?? ''),
      photoUrl: shopkeeper?.photoUrl ?? null,
    };
  });

  protected readonly today = startOfToday();

  protected readonly query = signal('');
  protected readonly filter = signal<Filter>('all');

  /**
   * "Show more" state, one flag per list. Everything is already loaded — these
   * only decide how much is on screen, so nothing has to be fetched when one
   * is flipped.
   */
  protected readonly showAllCards = signal(false);
  protected readonly showAllUpcoming = signal(false);
  protected readonly showAllOverdue = signal(false);

  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.loadCards();

    // Arriving from another page's "Add new card": the shell can't open a
    // dialog that lives here, so it navigates and asks. afterNextRender would
    // be the wrong hook — the dialog element has to exist, which viewChild
    // guarantees only once the view is up.
    if (history.state?.openAddCard) {
      queueMicrotask(() => this.openAddCard());
    }
  }

  protected onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    // A new search is a new result set — collapse back to the first page rather
    // than leaving it expanded from whatever was searched before.
    this.showAllCards.set(false);
  }

  protected clearSearch(): void {
    this.query.set('');
    this.showAllCards.set(false);
  }

  protected setFilter(next: Filter): void {
    this.filter.set(next);
    this.showAllCards.set(false);
  }

  /** "Good morning" before noon, and so on — the only clock-dependent copy. */
  protected readonly greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  /**
   * Drawer navigation. `route` is null for the destinations that don't exist
   * yet — those render as inert links rather than as routes to nowhere.
   */
  protected readonly navLinks = [
    { label: 'Dashboard', icon: 'grid' as const, active: true, route: '/dashboard' },
    { label: 'All cards', icon: 'cards' as const, active: false, route: null },
    { label: 'Renewals', icon: 'renew' as const, active: false, route: null },
    { label: 'History', icon: 'check' as const, active: false, route: '/history' },
    { label: 'Reminders', icon: 'bell' as const, active: false, route: null },
  ];

  /**
   * Bottom tab bar on phones. `add` renders as the raised centre action, and
   * `route` is null for the destinations that don't exist yet.
   */
  protected readonly tabs = [
    { label: 'Home', icon: 'grid' as const, active: true, route: '/dashboard' },
    { label: 'Cards', icon: 'cards' as const, active: false, route: null },
    { label: 'Add', icon: 'add' as const, active: false, route: null },
    { label: 'History', icon: 'check' as const, active: false, route: '/history' },
    { label: 'Profile', icon: 'user' as const, active: false, route: '/profile' },
  ];


  // ── The register ─────────────────────────────────────────────────────────
  // Loaded from the API. Everything below is derived from it, so a card added
  // through the dialog shows up in the counts, the filters and both panels
  // without any of them being told about it.

  /** The shop's cards, exactly as the API returned them. */
  private readonly register = signal<readonly Card[]>([]);

  protected readonly loading = signal(true);

  /** Set when the register could not be loaded — not when it is simply empty. */
  protected readonly loadError = signal<string | null>(null);

  /**
   * The register with everything the template needs worked out: which bucket
   * each card falls into, how it is written, and how far through its cycle it
   * is. Sorted by urgency, soonest due first.
   */
  protected readonly cards = computed<readonly DashboardCard[]>(() => {
    const today = this.today;

    return this.register()
      .map((card) => {
        const issued = parseCalendarDate(card.issueDate) ?? today;
        const due = parseCalendarDate(card.dueDate) ?? today;
        const dueInDays = daysBetween(today, due);
        const cycle = daysBetween(issued, due);

        return {
          cardId: card.cardId,
          cardNumber: card.cardNumber,
          customer: card.customerName,
          mobile: card.customerMobile,
          notes: card.notes,
          renewalCount: card.renewalCount,
          // An ISO timestamp, not a calendar date — new Date() is right here,
          // unlike for issueDate and dueDate above.
          renewedOn: card.renewedAt ? new Date(card.renewedAt) : null,
          issued,
          due,
          dueInDays,
          state: bucket(dueInDays),
          meta: STATE_META[bucket(dueInDays)],
          relative: relativeLabel(dueInDays),
          initials: initialsOf(card.customerName),
          progress:
            cycle > 0
              ? Math.min(100, Math.max(0, Math.round(((cycle - dueInDays) / cycle) * 100)))
              : 100,
        };
      })
      .sort((a, b) => a.dueInDays - b.dueInDays);
  });

  private count(state: CardState): number {
    return this.cards().filter((card) => card.state === state).length;
  }

  /**
   * The six headline counts. The first four buckets are disjoint and sum to the
   * total; "upcoming renewals" deliberately overlaps them — it is a 30-day
   * look-ahead, not a fifth bucket.
   */
  protected readonly stats = computed<readonly StatTile[]>(() => [
    {
      key: 'total',
      icon: 'cards',
      label: 'Total cards',
      value: this.cards().length,
      hint: 'In your register',
      tone: '',
      filter: 'all',
    },
    {
      key: 'active',
      icon: 'check',
      label: 'Active cards',
      value: this.count('active'),
      hint: 'More than 7 days away',
      tone: 'text-success',
      filter: 'active',
    },
    {
      key: 'today',
      icon: 'today',
      label: 'Due today',
      value: this.count('today'),
      hint: 'Call these first',
      tone: 'text-warning',
      filter: 'today',
    },
    {
      key: 'week',
      icon: 'week',
      label: 'Due this week',
      value: this.count('week'),
      hint: 'Next 7 days',
      tone: 'text-warning',
      filter: 'week',
    },
    {
      key: 'expired',
      icon: 'alert',
      label: 'Expired',
      value: this.count('expired'),
      hint: 'Past the due date',
      tone: 'text-danger',
      filter: 'expired',
    },
    {
      key: 'renewals',
      icon: 'renew',
      label: 'Upcoming renewals',
      value: this.cards().filter((card) => card.dueInDays >= 0 && card.dueInDays <= 30).length,
      hint: 'Next 30 days',
      tone: 'text-info',
      filter: null,
    },
  ]);

  protected readonly filters: readonly { readonly key: Filter; readonly label: string }[] = [
    { key: 'all', label: 'All cards' },
    { key: 'today', label: 'Due today' },
    { key: 'week', label: 'This week' },
    { key: 'expired', label: 'Overdue' },
    { key: 'active', label: 'Active' },
  ];

  /** Card number, customer name or mobile — the three things a counter knows. */
  protected readonly visibleCards = computed<readonly DashboardCard[]>(() => {
    const term = this.query().trim().toLowerCase();
    const state = this.filter();

    return this.cards().filter((card) => {
      if (state !== 'all' && card.state !== state) return false;
      if (!term) return true;
      return (
        card.cardNumber.toLowerCase().includes(term) ||
        card.customer.toLowerCase().includes(term) ||
        card.mobile.replace(/\s/g, '').includes(term.replace(/\s/g, ''))
      );
    });
  });

  /** Every card matching the current filter and search, first page only. */
  protected readonly shownCards = computed<readonly DashboardCard[]>(() => {
    const matches = this.visibleCards();
    return this.showAllCards() ? matches : matches.slice(0, CARD_PAGE);
  });

  /** How many matches "Show more" would reveal — 0 hides the button. */
  protected readonly moreCards = computed(
    () => this.visibleCards().length - this.shownCards().length,
  );

  /** Renewals falling due in the next 30 days, soonest first. */
  private readonly allUpcoming = computed<readonly DashboardCard[]>(() =>
    this.cards().filter((card) => card.dueInDays >= 0 && card.dueInDays <= 30),
  );

  protected readonly upcoming = computed<readonly DashboardCard[]>(() =>
    this.showAllUpcoming() ? this.allUpcoming() : this.allUpcoming().slice(0, LIST_PAGE),
  );

  protected readonly moreUpcoming = computed(
    () => this.allUpcoming().length - this.upcoming().length,
  );

  /** Anything already past its date — the panel that shouldn't stay full. */
  protected readonly allOverdue = computed<readonly DashboardCard[]>(() =>
    this.cards().filter((card) => card.state === 'expired'),
  );

  protected readonly overdue = computed<readonly DashboardCard[]>(() =>
    this.showAllOverdue() ? this.allOverdue() : this.allOverdue().slice(0, LIST_PAGE),
  );

  protected readonly moreOverdue = computed(() => this.allOverdue().length - this.overdue().length);

  /** Drives the banner at the top: how much needs doing before closing time. */
  protected readonly needsAttention = computed(() => this.count('today') + this.count('expired'));

  // ── Adding a card ────────────────────────────────────────────────────────

  /** Opens the dialog. Wired to every "Add new card" control in the app. */
  protected openAddCard(): void {
    this.addCard().open();
  }

  /**
   * A card was saved. It is pushed into the register directly rather than
   * refetching: the API returned the stored card, so a second round trip would
   * only tell us what we already know — and would leave the new card missing
   * from the page for as long as it took.
   */
  protected onCardCreated(card: Card): void {
    this.register.update((cards) => [...cards, card]);
  }

  /**
   * Opens the edit dialog on one card.
   *
   * The dialog wants the card as the API returned it, not the display shape
   * this page derives, so it is looked up in the register rather than passed
   * down from the template's projection.
   */
  protected openEditCard(cardId: string): void {
    const card = this.register().find((entry) => entry.cardId === cardId);
    if (!card) return;

    this.editCard().open(card);
  }

  /**
   * An edit was saved.
   *
   * A card that has just been completed drops out of the register entirely —
   * this page shows only what is still being tracked, and it now belongs to
   * History. Anything else is swapped in place.
   */
  protected onCardSaved(card: Card): void {
    this.register.update((cards) => {
      if (card.status === 'Completed') {
        return cards.filter((entry) => entry.cardId !== card.cardId);
      }

      return cards.map((entry) => (entry.cardId === card.cardId ? card : entry));
    });
  }

  /** Loads the register. Also the retry, when loading it failed. */
  protected loadCards(): void {
    this.loading.set(true);
    this.loadError.set(null);

    this.cardsApi
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cards) => {
          this.register.set(cards);
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
}
