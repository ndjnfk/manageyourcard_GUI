import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, map, merge, switchMap } from 'rxjs';
import { ApiError } from '../../shared/api';
import { Toasts } from '../../shared/toast';
import { Shop } from '../../shared/auth';
import { emailValidator, mobileValidator } from '../../shared/validators';
import { AdminApi } from '../admin-api';
import { AdminShell } from '../admin-shell/admin-shell';

type FieldKey = 'shopName' | 'ownerName' | 'mobile' | 'email' | 'password';

const PER_PAGE = 12;

/**
 * Every shop, with an editor for each.
 *
 * An admin may change more here than a shopkeeper can change about themselves:
 * the email, and the password. The ShopkeeperID is not editable by anyone — it
 * is the key every card is filed under, so changing it would orphan the whole
 * register.
 *
 * Searching and paging happen on the API. Filtering a page that was already
 * cut down would search only what happened to be on screen.
 */
@Component({
  selector: 'app-admin-shopkeepers',
  imports: [AdminShell, DatePipe, ReactiveFormsModule, RouterLink],
  templateUrl: './admin-shopkeepers.html',
  styleUrl: './admin-shopkeepers.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminShopkeepers {
  private readonly api = inject(AdminApi);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toasts = inject(Toasts);

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('editDialog');
  private readonly deleteDialog = viewChild.required<ElementRef<HTMLDialogElement>>('deleteDialog');

  protected readonly query = signal('');
  protected readonly page = signal(1);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);

  protected readonly shops = signal<readonly Shop[]>([]);
  protected readonly total = signal(0);
  protected readonly lastPage = signal(1);

  /** The shop being edited, or null. Only one row opens at a time. */
  protected readonly editing = signal<Shop | null>(null);
  protected readonly saving = signal(false);
  protected readonly saved = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);

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

  protected readonly form = this.fb.nonNullable.group({
    shopName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    ownerName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    mobile: ['', [Validators.required, mobileValidator]],
    email: ['', [Validators.required, emailValidator]],
    // Blank means "leave the password alone" — the hash is never sent here, so
    // there is nothing to round-trip and nothing to preserve.
    password: ['', [Validators.minLength(8), Validators.maxLength(64)]],
  });

  // ── Deleting ───────────────────────────────────────────────────────────────

  /** The shop queued for deletion, or null. */
  protected readonly deleting = signal<Shop | null>(null);
  protected readonly deleteText = signal('');
  protected readonly removing = signal(false);
  protected readonly deleteError = signal<string | null>(null);

  /** Bumped to refetch when the query hasn't changed but the data has. */
  private readonly tick = signal(0);

  constructor() {
    merge(
      toObservable(this.query),
      toObservable(this.page),
      toObservable(this.tick),
    )
      .pipe(
        debounceTime(200),
        map(() => JSON.stringify([this.query().trim(), this.page(), this.tick()])),
        distinctUntilChanged(),
        switchMap((key) => {
          this.loading.set(true);
          this.loadError.set(null);
          const [search, page] = JSON.parse(key) as [string, number];
          return this.api.shopkeepers({ search, page, perPage: PER_PAGE });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (result) => {
          this.shops.set(result.items);
          this.total.set(result.total);
          this.lastPage.set(result.lastPage);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.loadError.set(
            error instanceof ApiError
              ? error.message
              : 'Could not load the shops. Please try again in a moment.',
          );
        },
      });
  }

  protected onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.page.set(1);
  }

  protected goToPage(page: number): void {
    if (page < 1 || page > this.lastPage() || page === this.page()) return;
    this.page.set(page);
  }

  protected reload(): void {
    this.tick.update((n) => n + 1);
  }

  // ── Editing ────────────────────────────────────────────────────────────────

  protected edit(shop: Shop): void {
    this.editing.set(shop);
    this.saved.set(null);
    this.formError.set(null);
    this.form.reset(
      {
        shopName: shop.shopName,
        ownerName: shop.ownerName,
        mobile: shop.mobile,
        email: shop.email,
        password: '',
      },
      { emitEvent: false },
    );

    // A real <dialog>, so focus trapping, Escape and the backdrop come from
    // the browser rather than being re-implemented — the same as the shop
    // app's dialogs.
    this.dialog().nativeElement.showModal();
  }

  protected cancelEdit(): void {
    if (this.saving()) return;
    this.dialog().nativeElement.close();
  }

  /** Fires for every close — the buttons, Escape, or a successful save. */
  protected onDialogClosed(): void {
    this.editing.set(null);
  }

  protected showError(key: FieldKey): boolean {
    const control = this.form.controls[key];
    return control.invalid && control.touched;
  }

  protected errorFor(key: FieldKey): string {
    const errors = this.form.controls[key].errors;
    if (!errors) return '';

    // The API's own words win — it knows what this form cannot, such as
    // another shop already holding the address.
    if (typeof errors['server'] === 'string') return errors['server'];

    if (errors['required']) return 'This is required.';
    if (errors['mobile']) return 'Enter a 10-digit mobile starting 6, 7, 8 or 9.';
    if (errors['email']) return 'Enter a complete email address.';
    if (errors['minlength']) return 'That is too short.';
    if (errors['maxlength']) return 'That is longer than we can store.';

    return 'Check this field.';
  }

  protected save(): void {
    const shop = this.editing();
    if (!shop || this.saving()) return;

    this.formError.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();

    this.saving.set(true);
    this.api
      .updateShopkeeper(shop.shopkeeperId, {
        shopName: value.shopName.trim(),
        ownerName: value.ownerName.trim(),
        mobile: value.mobile.trim(),
        email: value.email.trim(),
        // Omitted when blank: sending an empty string would ask the API to set
        // an empty password rather than to leave it alone.
        ...(value.password ? { password: value.password } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.saving.set(false);
          this.dialog().nativeElement.close();
          this.saved.set(`Saved ${updated.shopkeeperId}.`);
          this.toasts.success(
            'Shop updated',
            value.password
              ? `${updated.shopName} saved, and its password was reset.`
              : `${updated.shopName} saved.`,
          );
          // The row on screen is stale now — and a changed name may re-sort it.
          this.reload();
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.showFailure(error);
        },
      });
  }

  /** Queues a shop for deletion. Nothing happens until its ID is typed back. */
  protected askDelete(shop: Shop): void {
    this.deleting.set(shop);
    this.deleteText.set('');
    this.deleteError.set(null);
    this.saved.set(null);
    this.deleteDialog().nativeElement.showModal();
  }

  protected cancelDelete(): void {
    if (this.removing()) return;
    this.deleteDialog().nativeElement.close();
  }

  protected onDeleteDialogClosed(): void {
    this.deleting.set(null);
    this.deleteText.set('');
  }

  protected onDeleteInput(event: Event): void {
    this.deleteText.set((event.target as HTMLInputElement).value);
  }

  /**
   * The typed text has to be the shop's own ID, exactly.
   *
   * A fixed word would stop a stray click but not a mis-aimed one: the rows
   * are a line apart, and deleting the wrong shop takes its cards with it.
   */
  protected canDelete(): boolean {
    const shop = this.deleting();
    return !!shop && this.deleteText().trim() === shop.shopkeeperId && !this.removing();
  }

  protected confirmDelete(): void {
    const shop = this.deleting();
    if (!shop || !this.canDelete()) return;

    this.removing.set(true);
    this.deleteError.set(null);

    this.api
      .deleteShopkeeper(shop.shopkeeperId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (message) => {
          this.removing.set(false);
          this.deleteDialog().nativeElement.close();
          this.toasts.success('Shop deleted', message);
          // A row has gone, so this page's contents have shifted — and if it
          // was the last one, the page number itself is now past the end.
          if (this.shops().length === 1 && this.page() > 1) {
            this.page.update((n) => n - 1);
          } else {
            this.reload();
          }
        },
        error: (error: unknown) => {
          this.removing.set(false);
          const message =
            error instanceof ApiError
              ? (Object.values(error.fieldErrors)[0] ?? error.message)
              : 'Could not delete that shop. Please try again in a moment.';
          this.deleteError.set(message);
          this.toasts.error('Delete failed', message);
        },
      });
  }

  private showFailure(error: unknown): void {
    if (!(error instanceof ApiError) || !error.hasFieldErrors) {
      this.formError.set(
        error instanceof ApiError
          ? error.message
          : 'Could not save that shop. Please try again in a moment.',
      );
      return;
    }

    for (const [field, message] of Object.entries(error.fieldErrors)) {
      const control = this.form.controls[field as FieldKey];
      if (!control) continue;

      control.setErrors({ ...(control.errors ?? {}), server: message });
      control.markAsTouched();
    }
  }
}
