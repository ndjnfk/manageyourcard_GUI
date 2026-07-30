import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ApiError } from '../../shared/api';
import { AdminApi, AdminStats } from '../admin-api';
import { AdminShell } from '../admin-shell/admin-shell';

/** A headline figure and how it is described. */
interface Tile {
  readonly key: keyof AdminStats;
  readonly label: string;
  readonly hint: string;
  readonly tone: string;
}

const TILES: readonly Tile[] = [
  { key: 'shopkeepers', label: 'Shopkeepers', hint: 'Registered shops', tone: '' },
  { key: 'cards', label: 'Cards', hint: 'Across every shop', tone: '' },
  { key: 'liveCards', label: 'Live cards', hint: 'Still being tracked', tone: 'text-success' },
  { key: 'completedCards', label: 'Completed', hint: 'Closed by a shop', tone: 'text-info' },
];

/**
 * The admin dashboard: how many shops and how many cards the installation
 * holds, across everybody.
 *
 * The maintenance actions are in the side panel rather than here — see
 * ../admin-shell. When one runs it emits `dataChanged`, and these figures are
 * refetched, because clearing the data makes every one of them wrong.
 */
@Component({
  selector: 'app-admin-dashboard',
  imports: [AdminShell, RouterLink],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminDashboard {
  private readonly api = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly tiles = TILES;

  protected readonly stats = signal<AdminStats | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);

  constructor() {
    this.load();
  }

  protected valueOf(key: keyof AdminStats): number {
    return this.stats()?.[key] ?? 0;
  }

  /** Loads the figures. Also the retry, and what a maintenance action triggers. */
  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);

    this.api
      .stats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stats) => {
          this.stats.set(stats);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.loadError.set(
            error instanceof ApiError
              ? error.message
              : 'Could not load the figures. Please try again in a moment.',
          );
        },
      });
  }
}
