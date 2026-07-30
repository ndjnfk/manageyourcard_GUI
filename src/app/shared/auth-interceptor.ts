import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AdminAuth } from '../admin/admin-auth';
import { API_BASE_URL } from './api';
import { Auth } from './auth';

/** Admin routes take the admin's token; everything else takes the shop's. */
const ADMIN_PREFIX = `${API_BASE_URL}/admin`;

/**
 * Attaches the right session token to API requests.
 *
 * Doing it here rather than in each call means no endpoint can be added later
 * that forgets to authenticate itself.
 *
 * Two tokens, chosen by URL: an admin and a shopkeeper can be signed in in the
 * same browser at once, and sending a shop's token to an admin route (or the
 * reverse) would be rejected — the API keeps the two in separate Redis
 * namespaces precisely so neither can stand in for the other.
 *
 * Tokens are only sent to API_BASE_URL. A bearer token is a credential, so it
 * must not be attached to requests going anywhere else.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(API_BASE_URL)) {
    return next(request);
  }

  const token = request.url.startsWith(ADMIN_PREFIX)
    ? inject(AdminAuth).token()
    : inject(Auth).token();

  if (!token) {
    return next(request);
  }

  return next(request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
