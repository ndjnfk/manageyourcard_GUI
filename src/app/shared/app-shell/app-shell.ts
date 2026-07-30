import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { Auth } from '../auth';
import { Install } from '../install';
import { Logo } from '../logo/logo';
import { Toasts } from '../toast';

function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * The signed-in chrome: app bar, mobile tab bar and drawer.
 *
 * Every page behind the auth guard wraps its content in this, so a shopkeeper
 * gets the same header and the same bottom bar wherever they are. It lived
 * inside the dashboard first; a second and third page needing it is exactly
 * when a copy stops being acceptable, because the copies drift.
 *
 * Pages project their body as default content, and may project a search
 * control into the app bar with `slot="search"`. Nothing about a particular
 * page is known here — what varies is either projected or an input.
 *
 *   <app-shell [attentionCount]="needsAttention()" (addCard)="openAddCard()">
 *     <label slot="search">…</label>
 *     …page…
 *   </app-shell>
 */
@Component({
  selector: 'app-shell',
  imports: [Logo, NgTemplateOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
    // Any click that reaches the document closes the profile menu. The toggle
    // stops propagation so its own click doesn't immediately undo itself; the
    // menu's own links are meant to close it, so they are left to bubble.
    '(document:click)': 'closeProfileMenu()',
  },
})
export class AppShell {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toasts = inject(Toasts);
  private readonly install = inject(Install);

  /**
   * Whether there is an install to offer. The button hides itself when there
   * isn't — on iOS, where the browser fires no such event, or once the app is
   * already installed.
   */
  protected readonly canInstall = this.install.canInstall;

  /**
   * How many cards need attention today. Drives the bell's badge.
   *
   * An input because only the dashboard has counted them — the shell has no
   * business loading the register just to draw a number.
   */
  readonly attentionCount = input(0);

  /**
   * Whether this page can open the add-card dialog itself. Only the dashboard
   * hosts it; everywhere else, Add navigates there and asks it to open.
   */
  readonly addsCardHere = input(false);

  readonly addCard = output<void>();

  protected readonly shop = computed(() => {
    const shopkeeper = this.auth.shopkeeper();

    return {
      id: shopkeeper?.shopkeeperId ?? '',
      owner: shopkeeper?.ownerName ?? '',
      contact: shopkeeper?.mobile ?? '',
      initials: initialsOf(shopkeeper?.ownerName ?? ''),
      photoUrl: shopkeeper?.photoUrl ?? null,
    };
  });

  protected readonly menuOpen = signal(false);
  protected readonly signingOut = signal(false);

  /**
   * The avatar's dropdown, on laptops.
   *
   * Below md the avatar isn't shown at all — the same destinations are in the
   * drawer, which is what the hamburger opens.
   */
  protected readonly profileMenuOpen = signal(false);

  protected readonly profileMenu = [
    { label: 'All cards', icon: 'cards' as const, route: '/cards' },
    { label: 'History', icon: 'check' as const, route: '/history' },
    { label: 'Profile', icon: 'user' as const, route: '/profile' },
  ];

  /**
   * Drawer navigation. `route` is null for the destinations that don't exist
   * yet — those render as inert links rather than as routes to nowhere.
   */
  protected readonly navLinks = [
    { label: 'Dashboard', icon: 'grid' as const, route: '/dashboard' },
    { label: 'All cards', icon: 'cards' as const, route: '/cards' },
    { label: 'History', icon: 'check' as const, route: '/history' },
    { label: 'Profile', icon: 'user' as const, route: '/profile' },
  ];

  /** Bottom tab bar on phones. `add` renders as the raised centre action. */
  protected readonly tabs = [
    { label: 'Home', icon: 'grid' as const, route: '/dashboard' },
    { label: 'Cards', icon: 'cards' as const, route: '/cards' },
    { label: 'Add', icon: 'add' as const, route: null },
    { label: 'History', icon: 'check' as const, route: '/history' },
    { label: 'Profile', icon: 'user' as const, route: '/profile' },
  ];

  constructor() {
    effect(() => {
      this.document.body.classList.toggle('myc-no-scroll', this.menuOpen());
    });

    this.destroyRef.onDestroy(() => {
      this.document.body.classList.remove('myc-no-scroll');
    });
  }

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected closeMenu(): void {
    this.menuOpen.set(false);
  }

  /**
   * Opens or closes the avatar dropdown.
   *
   * stopPropagation is what makes it open at all: without it the click carries
   * on to the document listener that closes the menu, and the two cancel out.
   */
  protected toggleProfileMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.profileMenuOpen.update((open) => !open);
  }

  protected closeProfileMenu(): void {
    this.profileMenuOpen.set(false);
  }

  /**
   * Offers the install. Called straight from the click, with no await before
   * `prompt()` — browsers only allow it while the user gesture is still live,
   * and anything asynchronous in between spends it.
   */
  protected async getApp(): Promise<void> {
    this.closeMenu();

    const accepted = await this.install.promptInstall();
    if (accepted) {
      this.toasts.success('Installing manageyourcard', 'Look for it with your other apps.');
    }
  }

  /** Escape closes whichever is open — the drawer on phones, the menu on laptops. */
  protected onEscape(): void {
    this.closeMenu();
    this.closeProfileMenu();
  }

  /**
   * Adds a card. The dashboard handles it in place; from anywhere else this
   * goes to the dashboard and asks it to open the dialog on arrival, so the
   * button does the same thing wherever it is pressed.
   */
  protected onAddCard(): void {
    this.closeMenu();

    if (this.addsCardHere()) {
      this.addCard.emit();
      return;
    }

    this.router.navigate(['/dashboard'], { state: { openAddCard: true } });
  }

  /**
   * Signs out — the only thing that ends the session. The API deletes the
   * Redis key, and until that happens the shopkeeper stays signed in across
   * restarts, which is the whole point of the arrangement.
   */
  protected signOut(): void {
    if (this.signingOut()) return;
    this.signingOut.set(true);

    this.auth
      .logout()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.closeMenu();
        this.toasts.info('Signed out', 'Your session has ended on this device.');
        this.router.navigate(['/login']);
      });
  }
}
