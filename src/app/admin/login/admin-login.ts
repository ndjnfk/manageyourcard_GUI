import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiError } from '../../shared/api';
import { Toasts } from '../../shared/toast';
import { emailValidator } from '../../shared/validators';
import { AdminAuth } from '../admin-auth';

type FieldKey = 'email' | 'password';

/**
 * Admin sign-in.
 *
 * There is no sign-up here and there never should be — an installation where
 * anyone can make themselves an admin is not an admin panel. Admins are
 * created from the command line with `node ace admin:create`, which takes
 * access to the server.
 *
 * A successful sign-in opens a session that expires on its own after seven
 * days, unlike a shopkeeper's, which lasts until they sign out.
 */
@Component({
  selector: 'app-admin-login',
  imports: [ReactiveFormsModule],
  templateUrl: './admin-login.html',
  styleUrl: './admin-login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminLogin {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AdminAuth);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toasts = inject(Toasts);

  protected readonly submitting = signal(false);

  /**
   * Set when a sign-in is rejected. One message for both the unknown email and
   * the wrong password: saying which was wrong would confirm that an address
   * is an admin account.
   */
  protected readonly failed = signal(false);

  /** A failure that isn't "wrong credentials" — an unreachable API, or a fault. */
  protected readonly error = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, emailValidator]],
    password: ['', [Validators.required]],
  });

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
      return 'Enter a complete email address.';
    }
    return 'Check this field.';
  }

  protected onSubmit(): void {
    if (this.submitting()) return;

    this.failed.set(false);
    this.error.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      document.getElementById(this.form.controls.email.invalid ? 'email' : 'password')?.focus();
      return;
    }

    const { email, password } = this.form.getRawValue();

    this.submitting.set(true);
    this.auth
      .login(email.trim(), password)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (admin) => {
          this.submitting.set(false);
          this.toasts.success('Signed in', `Welcome, ${admin.name}.`);
          this.router.navigate(['/admin']);
        },
        error: (error: unknown) => {
          this.submitting.set(false);

          if (error instanceof ApiError && error.isUnauthorized) {
            this.failed.set(true);
            // Only the password is cleared — retyping the email is not the
            // part they got wrong.
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
