import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AdminAuth } from './admin-auth';

/**
 * Route guards for the admin panel.
 *
 * Kept apart from the shopkeepers' guards in ../shared/guards for the same
 * reason the API keeps two middlewares: an admin session and a shop session
 * are entirely separate credentials, and one file deciding both is one wrong
 * branch away from a shop reaching the panel.
 *
 * They answer synchronously because the stored token has already been checked
 * against the API before the router runs — see the app initializer in
 * ../app.config.ts.
 */

/** For the panel itself. A shopkeeper session is no help here. */
export const adminGuard: CanActivateFn = () => {
  const admin = inject(AdminAuth);
  const router = inject(Router);

  return admin.signedIn() ? true : router.createUrlTree(['/admin/login']);
};

/**
 * For the admin sign-in page. An admin already signed in goes to the panel.
 *
 * Unlike the shopkeepers' guestGuard, this ignores the shop session entirely:
 * being signed in as a shop says nothing about being an admin.
 */
export const adminGuestGuard: CanActivateFn = () => {
  const admin = inject(AdminAuth);
  const router = inject(Router);

  return admin.signedIn() ? router.createUrlTree(['/admin']) : true;
};
