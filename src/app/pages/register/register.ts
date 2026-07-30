import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { Toasts } from '../../shared/toast';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiError } from '../../shared/api';
import { Auth, Shop } from '../../shared/auth';
import { Logo } from '../../shared/logo/logo';
import { emailValidator, mobileValidator, passwordValidator } from '../../shared/validators';

/**
 * The Shopkeeper record as the schema defines it, plus a contact email and the
 * password. ShopkeeperID is deliberately absent: it is the primary key, so it
 * is assigned when the record is created rather than typed by the shopkeeper.
 */
type FieldKey = 'shopName' | 'ownerName' | 'mobile' | 'email' | 'password';

/**
 * Everything the template needs to render one row of the form. Keeping it as
 * data rather than five hand-written blocks is what stops the markup drifting
 * field by field — and it is how the rest of this app builds repeated UI.
 */
interface Field {
  readonly key: FieldKey;
  readonly label: string;
  readonly hint: string;
  readonly type: 'text' | 'tel' | 'email' | 'password';
  /** Picks the phone keyboard on Android and iOS. */
  readonly mode: 'text' | 'tel' | 'email';
  readonly autocomplete: string;
  readonly placeholder: string;
  readonly maxLength: number;
  /** Renders the show/hide eye button — only the password. */
  readonly reveal?: boolean;
}

/**
 * Shop registration. Creates the Shopkeeper record every card is later filed
 * under, by posting to manageYourCardAPI. Its ShopkeeperID primary key is
 * assigned by the API when the record is created, so it isn't asked for here —
 * it comes back in the response and is shown on the confirmation.
 *
 * The rules in ../../shared/validators run here for immediate feedback, but
 * they are not the authority: the API validates the same things again, and
 * anything it rejects is shown under the field it names.
 */
@Component({
  selector: 'app-register',
  imports: [Logo, ReactiveFormsModule, RouterLink],
  templateUrl: './register.html',
  styleUrl: './register.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Register {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(Auth);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toasts = inject(Toasts);

  /** The registered shop, once the API has accepted it. */
  protected readonly submitted = signal<Shop | null>(null);

  /** True while the request is in flight — the submit button waits on it. */
  protected readonly submitting = signal(false);

  /**
   * A failure that belongs to no single field: an unreachable API, or a fault
   * on their side. Field-level problems go under their field instead.
   */
  protected readonly formError = signal<string | null>(null);

  /** Toggled by the eye button on the password field. */
  protected readonly passwordShown = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    shopName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    ownerName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    mobile: ['', [Validators.required, mobileValidator]],
    email: ['', [Validators.required, emailValidator]],
    password: ['', [Validators.required, passwordValidator, Validators.maxLength(64)]],
  });

  constructor() {
    // The form-level message describes the attempt, not the form, so it stops
    // being true the moment anything is edited. Field-level messages from the
    // API need no such handling: editing a field re-runs its validators, and
    // that replaces its errors — the API's included.
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.formError.set(null);
    });
  }

  protected readonly fields: readonly Field[] = [
    {
      key: 'shopName',
      label: 'Shop name',
      hint: 'As your customers know it.',
      type: 'text',
      mode: 'text',
      autocomplete: 'organization',
      placeholder: 'Kumar Mobile & Electronics',
      maxLength: 80,
    },
    {
      key: 'ownerName',
      label: 'Owner name',
      hint: 'The shopkeeper this account belongs to.',
      type: 'text',
      mode: 'text',
      autocomplete: 'name',
      placeholder: 'Sunil Kumar',
      maxLength: 60,
    },
    {
      key: 'mobile',
      label: 'Mobile number',
      hint: 'Used to reach you, and where renewal reminders can be sent.',
      type: 'tel',
      mode: 'tel',
      autocomplete: 'tel',
      placeholder: '+91 98765 43210',
      maxLength: 17,
    },
    {
      key: 'email',
      label: 'Email address',
      hint: 'For account notices. Reminders still go to your mobile.',
      type: 'email',
      mode: 'email',
      autocomplete: 'email',
      placeholder: 'you@example.com',
      maxLength: 120,
    },
    {
      key: 'password',
      label: 'Password',
      hint: 'At least 8 characters, with a letter and a number.',
      type: 'password',
      mode: 'text',
      // new-password, not password: tells both platforms to offer a generated
      // one and to store it rather than autofilling an existing login.
      autocomplete: 'new-password',
      placeholder: 'At least 8 characters',
      maxLength: 64,
      reveal: true,
    },
  ];

  protected togglePassword(): void {
    this.passwordShown.update((shown) => !shown);
  }

  /** Password fields flip to plain text while the eye is on. */
  protected inputType(field: Field): string {
    if (!field.reveal) return field.type;
    return this.passwordShown() ? 'text' : 'password';
  }

  protected control(key: FieldKey) {
    return this.form.controls[key];
  }

  /**
   * Whether to show a field as failed. Errors while someone is still typing
   * their first attempt are noise, so nothing turns red until the field has
   * been left or the form has been submitted.
   */
  protected showError(key: FieldKey): boolean {
    const control = this.control(key);
    return control.invalid && control.touched;
  }

  /** The one message worth showing for a field, most specific first. */
  protected errorFor(key: FieldKey): string {
    const errors = this.control(key).errors;
    if (!errors) return '';

    // The API's own words come first. It knows things this form cannot — that
    // the email is already registered, say — so when it has spoken about a
    // field, that is the message worth showing.
    if (typeof errors['server'] === 'string') {
      return errors['server'];
    }
    if (errors['required']) {
      const label = this.fields.find((field) => field.key === key)?.label ?? 'This field';
      return `${label} is required.`;
    }
    if (errors['password'] === 'short') {
      return 'Use at least 8 characters.';
    }
    if (errors['password'] === 'weak') {
      return 'Include at least one letter and one number.';
    }
    if (errors['mobile']) {
      return 'Enter a 10-digit mobile number starting 6, 7, 8 or 9.';
    }
    if (errors['email']) {
      return 'Enter a complete email address, like you@example.com.';
    }
    if (errors['minlength']) {
      return 'That looks too short.';
    }
    if (errors['maxlength']) {
      return 'That is longer than we can store.';
    }
    return 'Check this field.';
  }

  protected onSubmit(): void {
    // A second submit while the first is still in flight would register the
    // shop twice, so the button is disabled — this guards the Enter key too.
    if (this.submitting()) return;

    this.formError.set(null);

    if (this.form.invalid) {
      // Nothing has been touched if they submitted an untouched form, so mark
      // everything — otherwise the page reports no errors and does nothing,
      // which reads as a broken button.
      this.form.markAllAsTouched();
      this.focusFirstInvalid();
      return;
    }

    const value = this.form.getRawValue();

    this.submitting.set(true);
    this.auth
      .register({
        shopName: value.shopName.trim(),
        ownerName: value.ownerName.trim(),
        mobile: value.mobile.trim(),
        email: value.email.trim().toLowerCase(),
        password: value.password,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (shop) => {
          this.submitting.set(false);
          this.toasts.success('Shop registered', `Your Shopkeeper ID is ${shop.shopkeeperId}.`);
          // Only the API's copy of the record is shown, never the typed one:
          // it carries the assigned ShopkeeperID, and its mobile and email are
          // the normalised versions actually stored. The password is not in it
          // and has no business on screen once it has been sent.
          this.submitted.set(shop);
          this.form.reset();
          this.passwordShown.set(false);
        },
        error: (error: unknown) => {
          this.submitting.set(false);
          this.showFailure(error);
        },
      });
  }

  protected registerAnother(): void {
    this.submitted.set(null);
    this.passwordShown.set(false);
    this.formError.set(null);
    this.form.reset();
  }

  /**
   * Puts a rejected registration back in front of the shopkeeper. Whatever they
   * typed is left in the form — a rejection is not a reason to make them type
   * it all again.
   */
  private showFailure(error: unknown): void {
    if (!(error instanceof ApiError) || !error.hasFieldErrors) {
      this.formError.set(
        error instanceof ApiError
          ? error.message
          : 'Registration failed. Please try again in a moment.',
      );
      return;
    }

    for (const [field, message] of Object.entries(error.fieldErrors)) {
      const control = this.form.controls[field as FieldKey];
      if (!control) continue;

      control.setErrors({ ...(control.errors ?? {}), server: message });
      control.markAsTouched();
    }

    this.focusFirstInvalid();
  }

  /** Sends the cursor to the first problem rather than leaving it hunting. */
  private focusFirstInvalid(): void {
    const first = this.fields.find((field) => this.control(field.key).invalid);
    if (!first) return;

    document.getElementById(first.key)?.focus();
  }
}
