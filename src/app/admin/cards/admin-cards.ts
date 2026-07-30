import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, map, merge, switchMap } from 'rxjs';
import { ApiError } from '../../shared/api';
import { Shop } from '../../shared/auth';
import { Card } from '../../shared/cards';
import { AdminApi } from '../admin-api';
import { AdminShell } from '../admin-shell/admin-shell';

const PER_PAGE = 12;

const STATUS_BADGE: Readonly<Record<string, string>> = {
  Active: 'text-bg-success',
  'Due Soon': 'text-bg-warning',
  Expired: 'text-bg-danger',
  Completed: 'text-bg-info',
};

/**
 * One shop's cards, seen by an admin — what the Cards button on the shops
 * table opens.
 *
 * The shop comes from the URL rather than from a session, which is only safe
 * because the whole admin API sits behind its own middleware. Read-only: an
 * admin can edit a shop's details, but a card belongs to the shop's own
 * working register and is theirs to change.
 */
@Component({
  selector: 'app-admin-cards',
  imports: [AdminShell, DatePipe, RouterLink],
  templateUrl: './admin-cards.html',
  styleUrl: './admin-cards.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminCards {
  private readonly api = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);

  /** From the route: /admin/shopkeepers/:shopkeeperId/cards */
  readonly shopkeeperId = input.required<string>();

  protected readonly query = signal('');
  protected readonly completed = signal(false);
  protected readonly page = signal(1);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);

  protected readonly cards = signal<readonly Card[]>([]);
  protected readonly shop = signal<Shop | null>(null);
  protected readonly total = signal(0);
  protected readonly lastPage = signal(1);

  protected readonly firstShown = computed(() =>
    this.total() === 0 ? 0 : (this.page() - 1) * PER_PAGE + 1,
  );

  protected readonly lastShown = computed(() => Math.min(this.page() * PER_PAGE, this.total()));

  protected readonly pageNumbers = computed<readonly number[]>(() => {
    const last = this.lastPage();
    const current = this.page();
    const from = Math.max(1, Math.min(current - 2, last - 4));
    const to = Math.min(last, Math.max(current + 2, 5));

    return Array.from({ length: to - from + 1 }, (_, index) => from + index);
  });

  private readonly tick = signal(0);

  constructor() {
    merge(
      toObservable(this.shopkeeperId),
      toObservable(this.query),
      toObservable(this.completed),
      toObservable(this.page),
      toObservable(this.tick),
    )
      .pipe(
        debounceTime(200),
        map(() =>
          JSON.stringify([
            this.shopkeeperId(),
            this.query().trim(),
            this.completed(),
            this.page(),
            this.tick(),
          ]),
        ),
        distinctUntilChanged(),
        switchMap((key) => {
          this.loading.set(true);
          this.loadError.set(null);
          const [id, search, completed, page] = JSON.parse(key) as [
            string,
            string,
            boolean,
            number,
          ];
          return this.api.shopkeeperCards(id, { search, completed, page, perPage: PER_PAGE });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (result) => {
          this.cards.set(result.items);
          this.shop.set(result.shopkeeper);
          this.total.set(result.total);
          this.lastPage.set(result.lastPage);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.loadError.set(
            error instanceof ApiError
              ? error.message
              : 'Could not load these cards. Please try again in a moment.',
          );
        },
      });
  }

  protected badgeFor(status: string): string {
    return STATUS_BADGE[status] ?? 'text-bg-secondary';
  }

  protected onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.page.set(1);
  }

  protected setCompleted(completed: boolean): void {
    this.completed.set(completed);
    this.page.set(1);
  }

  protected goToPage(page: number): void {
    if (page < 1 || page > this.lastPage() || page === this.page()) return;
    this.page.set(page);
  }

  protected reload(): void {
    this.tick.update((n) => n + 1);
  }
}
