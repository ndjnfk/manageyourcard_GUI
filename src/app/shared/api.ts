import { HttpErrorResponse } from '@angular/common/http';
import { Capacitor } from '@capacitor/core';

/**
 * Where the API lives when this is running in a browser.
 *
 * The API runs on its own port (manageYourCardAPI, 3333) rather than behind
 * this app's dev server, so requests to it are cross-origin — its CORS_ORIGIN
 * has to name this app's origin, or the browser will refuse to hand the
 * response back. See manageYourCardAPI/.env.
 *
 * For a deployment, point this at the deployed API's origin.
 */
// const WEB_API_URL = 'http://localhost:3333/api/v1';
const WEB_API_URL = 'https://trustridesre.com/manageyourcard/api/v1';

/**
 * Where the API lives for the installed Android app.
 *
 * Separate from the web URL because "localhost" does not mean the same thing on
 * a phone: it is the phone itself, so the browser default would have the app
 * calling a server on the handset and failing with a connection refused that
 * looks exactly like the API being down.
 *
 * This has to be an address the device can actually reach:
 *
 *   - a real deployed API over https — what a release build needs;
 *   - during development, this machine's LAN address, e.g.
 *     http://192.168.1.5:3333/api/v1, with the phone on the same Wi-Fi and
 *     that origin added to CORS_ORIGIN in manageYourCardAPI/.env.
 *
 * Note that a debug build will not accept plain http either — see
 * `allowMixedContent: false` in capacitor.config.ts, and the network security
 * config in the Android project if a LAN address over http is needed.
 */
// const NATIVE_API_URL = 'http://192.168.29.179:3333/api/v1';
const NATIVE_API_URL = 'https://trustridesre.com/manageyourcard/api/v1';


/**
 * The API base for whichever client this is.
 *
 * The address above is this development machine on the local network, because
 * the app is tested on a real handset. Two other values are worth knowing:
 *
 *   - `http://10.0.2.2:3333/api/v1` — the Android emulator's alias for the
 *     host machine's localhost, if testing moves to an emulator.
 *   - the deployed API over https, for a release build.
 *
 * A LAN address is only good for as long as the router hands out the same one.
 * If the app suddenly cannot reach the API, check this first — a DHCP lease
 * expiring over a weekend is the usual culprit.
 */
export const API_BASE_URL = Capacitor.isNativePlatform() ? NATIVE_API_URL : WEB_API_URL;

/**
 * The shape the API reports field-level problems in — the same for a 422 from
 * a validator and a 409 from a duplicate that slipped past it, so a form has
 * one way of reading them.
 */
export interface ApiFieldError {
  field: string;
  rule: string;
  message: string;
}

export interface ApiErrorBody {
  errors?: ApiFieldError[];
  message?: string;
}

/**
 * A failed request, already translated out of HTTP.
 *
 * `fieldErrors` is keyed by form control name, so a component can drop the
 * messages straight onto its controls. `message` is the one line to show when
 * nothing can be pinned to a specific field. `status` is kept so a page can
 * tell "wrong password" (401) from "the server is broken" (500) — they need
 * very different wording.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fieldErrors: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get hasFieldErrors(): boolean {
    return Object.keys(this.fieldErrors).length > 0;
  }

  /** Rejected credentials or an ended session, as opposed to a broken request. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

/** Turns an HTTP failure into something a form can act on. */
export function toApiError(error: HttpErrorResponse): ApiError {
  // Status 0 means the request never got a reply: the API isn't running, or
  // the browser blocked it. "Try again" is the wrong advice — nothing will
  // change until the API is up — so name the actual problem.
  if (error.status === 0) {
    return new ApiError(
      'Could not reach the server. Check that the API is running, then try again.',
      0,
    );
  }

  const body = error.error as ApiErrorBody | null;
  const fieldErrors: Record<string, string> = {};

  for (const item of body?.errors ?? []) {
    // First message per field wins: a field with three failing rules only has
    // room for one line under it, and the first is the most specific.
    if (item.field && !fieldErrors[item.field]) {
      fieldErrors[item.field] = item.message;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return new ApiError('Some details need fixing.', error.status, fieldErrors);
  }

  return new ApiError(
    body?.message ?? 'Something went wrong. Please try again in a moment.',
    error.status,
  );
}
