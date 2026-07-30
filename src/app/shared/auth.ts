import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, firstValueFrom, map, of, tap, throwError } from 'rxjs';
import { API_BASE_URL, toApiError } from './api';

/**
 * Where the session token is kept.
 *
 * localStorage rather than sessionStorage or an in-memory value, because the
 * requirement is that a signed-in shopkeeper stays signed in — closing the
 * browser and coming back tomorrow has to land on the dashboard. Only
 * localStorage survives that.
 */
const TOKEN_KEY = 'myc.session.token';

/** What registering a shop sends. ShopkeeperID is not among it — see below. */
export interface RegisterRequest {
  shopName: string;
  ownerName: string;
  mobile: string;
  email: string;
  password: string;
}

/**
 * A registered shop.
 *
 * `shopkeeperId` is assigned by the API, not chosen here: it is the key every
 * card is filed under, so letting the browser pick one would let a shop file
 * cards into another shop's register.
 */
export interface Shop {
  shopkeeperId: string;
  shopName: string;
  ownerName: string;
  mobile: string;
  email: string;
  /** Absolute URL of the profile photo, or null if none has been uploaded. */
  photoUrl: string | null;
  createdAt: string;
}

/**
 * What a profile save sends. Every field is optional — only what changed goes.
 *
 * The email and password are absent: changing either is an account security
 * matter with its own flow, not a field on a profile form. So is the
 * ShopkeeperID, which every card is filed under.
 */
export interface ProfileEdit {
  shopName?: string;
  ownerName?: string;
  mobile?: string;
}

/**
 * Registration, sign-in, and who is currently signed in.
 *
 * The session itself lives in Redis on the API side and has no expiry: it ends
 * when the shopkeeper signs out and at no other time. This service holds the
 * token that names it, and the shop it belongs to once `restore()` has checked
 * the token is still good.
 *
 * Components read `shopkeeper()` / `signedIn()` rather than calling the API
 * themselves, and the route guards in ./guards read the same signals.
 */
@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly http = inject(HttpClient);

  private readonly shop = signal<Shop | null>(null);

  /** The signed-in shop, or null. Set by login() and by restore() on startup. */
  readonly shopkeeper = this.shop.asReadonly();

  readonly signedIn = computed(() => this.shop() !== null);

  /**
   * The token to send with API requests, or null. Read from storage each time
   * rather than cached, so signing out in one tab is noticed by the others.
   */
  token(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      // Storage can be unavailable — private browsing, or blocked entirely.
      // That means no session can be remembered, not that the app should fail.
      return null;
    }
  }

  /** Registers a shop and returns it, ShopkeeperID included. */
  register(payload: RegisterRequest): Observable<Shop> {
    return this.http
      .post<{ data: Shop }>(`${API_BASE_URL}/auth/register`, payload)
      .pipe(
        map((response) => response.data),
        catchError((error: HttpErrorResponse) => throwError(() => toApiError(error))),
      );
  }

  /**
   * Signs in and remembers the session. On success the shop is signed in for
   * good — the API stores the session without an expiry — so nothing needs to
   * refresh it and nothing will quietly end it.
   */
  login(email: string, password: string): Observable<Shop> {
    return this.http
      .post<{ data: { token: string; shopkeeper: Shop } }>(`${API_BASE_URL}/auth/login`, {
        email,
        password,
      })
      .pipe(
        map((response) => response.data),
        tap(({ token, shopkeeper }) => {
          this.storeToken(token);
          this.shop.set(shopkeeper);
        }),
        map(({ shopkeeper }) => shopkeeper),
        catchError((error: HttpErrorResponse) => throwError(() => toApiError(error))),
      );
  }

  /**
   * Signs out. This is the only thing that ends a session: the API deletes the
   * Redis key, and the token is dropped here.
   *
   * The local state is cleared even if the request fails. A shopkeeper who
   * pressed sign out must end up signed out on this device regardless — a
   * token the API has already rejected is no use to keep, and one it never
   * heard about is no use either.
   */
  logout(): Observable<void> {
    const token = this.token();

    if (!token) {
      this.clearSession();
      return of(void 0);
    }

    return this.http
      .delete<void>(`${API_BASE_URL}/auth/session`, {
        // Sent explicitly rather than left to the interceptor. The token has to
        // still be readable when this request goes out — clearing it first
        // would send an unauthenticated request, the API would reject it, and
        // the Redis key would survive a sign-out that appeared to work.
        headers: { Authorization: `Bearer ${token}` },
      })
      .pipe(
        map(() => void 0),
        catchError(() => of(void 0)),
        // Only once the request is on its way is the local state dropped, and
        // it is dropped either way: someone who pressed sign out ends up
        // signed out on this device regardless of what the API said.
        finalize(() => this.clearSession()),
      );
  }

  /**
   * Saves the shop's own details.
   *
   * The returned shop replaces the one in `shopkeeper()`, so the dashboard's
   * header and greeting update the moment this resolves — without a reload and
   * without any page having to know the profile was edited.
   */
  updateProfile(changes: ProfileEdit): Observable<Shop> {
    return this.http
      .patch<{ data: Shop }>(`${API_BASE_URL}/account/profile`, changes)
      .pipe(
        map((response) => response.data),
        tap((shop) => this.shop.set(shop)),
        catchError((error: HttpErrorResponse) => throwError(() => toApiError(error))),
      );
  }

  /**
   * Uploads a new profile photo.
   *
   * Sent as FormData so the browser sets the multipart Content-Type with its
   * own boundary. Setting that header by hand is the classic way to break an
   * upload — the boundary won't match the body.
   */
  uploadPhoto(file: File): Observable<Shop> {
    const body = new FormData();
    body.append('photo', file);

    return this.http
      .put<{ data: Shop }>(`${API_BASE_URL}/account/profile/photo`, body)
      .pipe(
        map((response) => response.data),
        tap((shop) => this.shop.set(shop)),
        catchError((error: HttpErrorResponse) => throwError(() => toApiError(error))),
      );
  }

  /** Removes the photo, falling back to the owner's initials. */
  removePhoto(): Observable<Shop> {
    return this.http
      .delete<{ data: Shop }>(`${API_BASE_URL}/account/profile/photo`)
      .pipe(
        map((response) => response.data),
        tap((shop) => this.shop.set(shop)),
        catchError((error: HttpErrorResponse) => throwError(() => toApiError(error))),
      );
  }

  /**
   * Works out whether there is still a session, once, at startup.
   *
   * The stored token is only a claim — the session lives in Redis, and the
   * only way to know it is still there is to ask. Everything downstream (the
   * route guards, the dashboard) depends on this having finished, which is why
   * it is wired as an app initializer in app.config.ts.
   */
  async restore(): Promise<void> {
    if (!this.token()) return;

    try {
      const response = await firstValueFrom(
        this.http.get<{ data: { shopkeeper: Shop } }>(`${API_BASE_URL}/auth/session`),
      );
      this.shop.set(response.data.shopkeeper);
    } catch (error) {
      // A rejected token is a dead token: drop it so the app stops sending it.
      // Any other failure — the API being down, say — leaves it alone, because
      // the session may well still exist and be reachable later.
      if (error instanceof HttpErrorResponse && error.status === 401) {
        this.clearSession();
      }
    }
  }

  private storeToken(token: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Nothing to be done: the sign-in still worked for this page, it just
      // won't be remembered after a reload.
    }
  }

  private clearSession(): void {
    this.shop.set(null);
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Already unreadable — there is nothing to remove.
    }
  }
}
