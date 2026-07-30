import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { Toasts } from '../../shared/toast';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiError } from '../../shared/api';
import { Auth } from '../../shared/auth';
import { Logo } from '../../shared/logo/logo';
import { emailValidator } from '../../shared/validators';

type FieldKey = 'email' | 'password';

/**
 * Sign in. Email and password only — the two things a shopkeeper who has
 * registered already has.
 *
 * A successful sign-in opens a session that does not expire, so this page is
 * the last time they see it until they sign out: from here on the app opens on
 * the dashboard. The redirect is to /dashboard, and the guards in
 * ../../shared/guards do the rest.
 */
@Component({
  selector: 'app-login',
  imports: [Logo, ReactiveFormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toasts = inject(Toasts);

  protected readonly passwordShown = signal(false);

  /**
   * Set when a sign-in attempt is rejected. One message for both the unknown
   * email and the wrong password: saying which was wrong tells anyone with a
   * list of addresses which of them have accounts here.
   */
  protected readonly failed = signal(false);

  /**
   * A failure that isn't "wrong credentials" — an unreachable API, or a fault
   * on their side. Kept apart from `failed` because the advice differs: one
   * means check what you typed, the other means nothing you type will help.
   */
  protected readonly error = signal<string | null>(null);

  /** True while the request is in flight — the submit button waits on it. */
  protected readonly submitting = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, emailValidator]],
    // No strength rules on sign-in: an existing password only has to match,
    // and re-stating the policy here both annoys and advertises it.
    password: ['', [Validators.required]],
  });

  protected togglePassword(): void {
    this.passwordShown.update((shown) => !shown);
  }

  protected showError(key: FieldKey): boolean {
    const control = this.form.controls[key];
    return control.invalid && control.touched;
  }

  protected errorFor(key: FieldKey): string {
    const errors = this.form.controls[key].errors;
    if (!errors) return '';

    if (errors['required']) {
      return key === 'email' ? 'Email address is required.' : 'Password is required.';
    }
    if (errors['email']) {
      return 'Enter a complete email address, like you@example.com.';
    }
    return 'Check this field.';
  }

  protected onSubmit(): void {
    // A second submit while the first is in flight would open a second Redis
    // session — and since sessions never expire, the spare would sit there for
    // good. The button is disabled; this guards the Enter key too.
    if (this.submitting()) return;

    this.failed.set(false);
    this.error.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      document
        .getElementById(this.form.controls.email.invalid ? 'email' : 'password')
        ?.focus();
      return;
    }

    const { email, password } = this.form.getRawValue();

    this.submitting.set(true);
    this.auth
      .login(email.trim(), password)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (shop) => {
          this.submitting.set(false);
          this.toasts.success('Signed in', `Welcome back, ${shop.ownerName}.`);
          this.router.navigate(['/dashboard']);
        },
        error: (error: unknown) => {
          this.submitting.set(false);

          // A rejection leaves the form as it is — the email stays filled in,
          // because retyping it is not the part they got wrong. Only the
          // password is cleared, since that is what has to be tried again.
          if (error instanceof ApiError && error.isUnauthorized) {
            this.failed.set(true);
            this.form.controls.password.reset();
            document.getElementById('password')?.focus();
            return;
          }

          this.error.set(
            error instanceof ApiError
              ? error.message
              : 'Something went wrong. Please try again in a moment.',
          );
        },
      });
  }
}
