import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiError } from '../../shared/api';
import { AppShell } from '../../shared/app-shell/app-shell';
import { Auth } from '../../shared/auth';
import { NotificationSettings } from '../../shared/notification-settings/notification-settings';
import { Toasts } from '../../shared/toast';
import { mobileValidator } from '../../shared/validators';

type FieldKey = 'shopName' | 'ownerName' | 'mobile';

/** What the file input accepts, and what the API will actually store. */
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** 2MB, matching the API's own limit — see MAX_PHOTO_SIZE there. */
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * The shop's own profile: its photo, the name it trades under, the owner's
 * name and the mobile number.
 *
 * The ShopkeeperID and the email are shown but not editable. The ID is the key
 * every card is filed under — changing it would orphan the whole register —
 * and changing an email is an account security matter that wants its own flow,
 * not a field on a form.
 *
 * Everything here reads and writes through Auth, so saving updates the
 * session's copy of the shop and the dashboard's header follows immediately.
 */
@Component({
  selector: 'app-profile',
  imports: [AppShell, NotificationSettings, ReactiveFormsModule],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Profile {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(Auth);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toasts = inject(Toasts);

  protected readonly accept = ACCEPTED_TYPES.join(',');

  /** The signed-in shop. authGuard guarantees there is one on this route. */
  protected readonly shop = this.auth.shopkeeper;

  protected readonly initials = computed(() => initialsOf(this.shop()?.ownerName ?? ''));

  protected readonly saving = signal(false);
  protected readonly uploading = signal(false);

  /** Set briefly after a successful save, so the change is acknowledged. */
  protected readonly saved = signal(false);

  protected readonly formError = signal<string | null>(null);
  protected readonly photoError = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    shopName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    ownerName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    mobile: ['', [Validators.required, mobileValidator]],
  });

  constructor() {
    const shop = this.shop();
    if (shop) {
      this.form.setValue(
        {
          shopName: shop.shopName,
          ownerName: shop.ownerName,
          mobile: shop.mobile,
        },
        { emitEvent: false },
      );
    }

    // Both messages describe the last attempt, not the form, so they stop
    // being true the moment anything is edited.
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.formError.set(null);
      this.saved.set(false);
    });
  }

  protected control(key: FieldKey) {
    return this.form.controls[key];
  }

  protected showError(key: FieldKey): boolean {
    const control = this.control(key);
    return control.invalid && control.touched;
  }

  protected errorFor(key: FieldKey): string {
    const errors = this.control(key).errors;
    if (!errors) return '';

    // The API's own words win — it knows things this form cannot, such as
    // another shop already using the number.
    if (typeof errors['server'] === 'string') return errors['server'];

    if (errors['required']) {
      return (
        {
          shopName: 'Shop name is required.',
          ownerName: 'Owner name is required.',
          mobile: 'Mobile number is required.',
        } as Record<FieldKey, string>
      )[key];
    }
    if (errors['mobile']) {
      return 'Enter a 10-digit mobile number starting 6, 7, 8 or 9.';
    }
    if (errors['minlength']) return 'That looks too short.';
    if (errors['maxlength']) return 'That is longer than we can store.';

    return 'Check this field.';
  }

  protected onSubmit(): void {
    if (this.saving()) return;

    this.formError.set(null);
    this.saved.set(false);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      const first = (['shopName', 'ownerName', 'mobile'] as FieldKey[]).find((key) =>
        this.control(key).invalid,
      );
      if (first) document.getElementById(first)?.focus();
      return;
    }

    const value = this.form.getRawValue();

    this.saving.set(true);
    this.auth
      .updateProfile({
        shopName: value.shopName.trim(),
        ownerName: value.ownerName.trim(),
        mobile: value.mobile.trim(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (shop) => {
          this.saving.set(false);
          this.saved.set(true);
          this.toasts.success('Profile saved', `${shop.shopName} is up to date.`);
          // Re-seeded from what was stored, not from what was typed: the API
          // normalises the mobile, so this is where "+91 98765 43210" becomes
          // the 10 digits actually saved.
          this.form.setValue(
            { shopName: shop.shopName, ownerName: shop.ownerName, mobile: shop.mobile },
            { emitEvent: false },
          );
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.showFailure(error);
        },
      });
  }

  /** Opens the file picker. The input itself is visually hidden. */
  protected choosePhoto(input: HTMLInputElement): void {
    this.photoError.set(null);
    input.click();
  }

  protected onPhotoChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    // Clearing the input matters: picking the same file twice in a row fires
    // no change event otherwise, so a failed upload could not be retried.
    input.value = '';

    if (!file) return;

    // Checked here as well as on the API. This one is only to save a shopkeeper
    // on a slow connection from uploading 8MB before being told no.
    if (!ACCEPTED_TYPES.includes(file.type)) {
      this.photoError.set('Use a JPG, PNG or WebP image.');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      this.photoError.set('That image is too large. The limit is 2MB.');
      return;
    }

    this.uploadPhoto(file);
  }

  private uploadPhoto(file: File): void {
    this.photoError.set(null);
    this.uploading.set(true);

    this.auth
      .uploadPhoto(file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.uploading.set(false);
          this.toasts.success('Photo updated');
        },
        error: (error: unknown) => {
          this.uploading.set(false);
          this.photoError.set(
            error instanceof ApiError
              ? (Object.values(error.fieldErrors)[0] ?? error.message)
              : 'Could not upload that photo. Please try again in a moment.',
          );
        },
      });
  }

  protected removePhoto(): void {
    if (this.uploading()) return;

    this.photoError.set(null);
    this.uploading.set(true);

    this.auth
      .removePhoto()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.uploading.set(false),
        error: (error: unknown) => {
          this.uploading.set(false);
          this.photoError.set(
            error instanceof ApiError
              ? error.message
              : 'Could not remove that photo. Please try again in a moment.',
          );
        },
      });
  }

  private showFailure(error: unknown): void {
    if (!(error instanceof ApiError) || !error.hasFieldErrors) {
      this.formError.set(
        error instanceof ApiError
          ? error.message
          : 'Could not save your profile. Please try again in a moment.',
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
