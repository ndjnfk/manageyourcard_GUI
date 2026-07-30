import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from './auth';

/**
 * Route guards, both reading the same signal.
 *
 * They can answer synchronously because the session has already been checked
 * against the API before the router ever runs — see the app initializer in
 * app.config.ts. Without that, every guard would have to wait on a request and
 * the first paint would be a blank page.
 */

/** For the dashboard: signed out means there is nothing to show. */
export const authGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);

  return auth.signedIn() ? true : router.createUrlTree(['/login']);
};

/**
 * For the landing page, sign-in and registration: a shopkeeper who is already
 * signed in goes straight to their dashboard.
 *
 * This is what makes the app open on the dashboard rather than the landing
 * page when the session is still live — which, since sessions never expire on
 * their own, is every time until they sign out.
 */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);

  return auth.signedIn() ? router.createUrlTree(['/dashboard']) : true;
};

