import { AbstractControl, ValidationErrors } from '@angular/forms';

/**
 * Form rules shared across the app's forms. They live here rather than beside
 * one form so that "what counts as a valid email" has a single answer — two
 * copies of a regex drift, and then registering with an address you can't sign
 * in with becomes possible.
 */

/**
 * Indian mobile number: ten digits starting 6–9, with an optional +91 and any
 * spacing the shopkeeper feels like typing. Whatever they enter is normalised
 * before it is validated, so "+91 98765 43210" and "9876543210" both pass.
 */
export function mobileValidator(control: AbstractControl): ValidationErrors | null {
  const raw = String(control.value ?? '').trim();
  if (!raw) return null; // "required" already covers the empty case

  const digits = raw.replace(/[\s-]/g, '').replace(/^\+?91/, '');
  return /^[6-9]\d{9}$/.test(digits) ? null : { mobile: true };
}

/** Rejects the addresses Validators.email lets through, e.g. "a@b". */
export function emailValidator(control: AbstractControl): ValidationErrors | null {
  const raw = String(control.value ?? '').trim();
  if (!raw) return null;

  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(raw) ? null : { email: true };
}

/**
 * Password strength, for the form that *sets* one. Long enough to be worth
 * having, mixed enough not to be a dictionary word, and nothing beyond that —
 * rules a shopkeeper can't satisfy at the counter only push them towards
 * writing the password on the register.
 *
 * Deliberately NOT used on sign-in: an existing password only has to match,
 * and re-stating the policy there both annoys and advertises it.
 */
export function passwordValidator(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value ?? '');
  if (!value) return null;

  if (value.length < 8) return { password: 'short' };
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return { password: 'weak' };
  return null;
}
