import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, firstValueFrom, map, of, tap, throwError } from 'rxjs';
import { API_BASE_URL, toApiError } from '../shared/api';

/**
 * Where the admin's token is kept.
 *
 * A different key from the shopkeeper's, so both can be signed in in the same
 * browser without one overwriting the other — which is exactly what happens
 * while working on the app.
 */
const TOKEN_KEY = 'myc.admin.token';

export interface Admin {
  name: string;
  email: string;
  createdAt: string;
}

/**
 * The signed-in admin.
 *
 * Unlike a shopkeeper's session, this one expires on its own after seven days.
 * An admin can wipe every shop's data, so a forgotten browser session is worth
 * far more to whoever finds it. `expiresInSeconds` is what the panel uses to
 * warn before it goes.
 */
@Injectable({ providedIn: 'root' })
export class AdminAuth {
  private readonly http = inject(HttpClient);

  private readonly current = signal<Admin | null>(null);

  readonly admin = this.current.asReadonly();
  readonly signedIn = computed(() => this.current() !== null);

  /** Seconds left on the session, or null when it isn't known. */
  readonly expiresInSeconds = signal<number | null>(null);

  /** Days left, rounded down — what the panel actually shows. */
  readonly daysLeft = computed(() => {
    const seconds = this.expiresInSeconds();
    return seconds === null || seconds < 0 ? null : Math.floor(seconds / 86400);
  });

  token(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      // Storage can be unavailable — private browsing, or blocked entirely.
      return null;
    }
  }

  login(email: string, password: string): Observable<Admin> {
    return this.http
      .post<{ data: { token: string; admin: Admin; expiresInSeconds: number } }>(
        `${API_BASE_URL}/admin/login`,
        { email, password },
      )
      .pipe(
        map((response) => response.data),
        tap(({ token, admin, expiresInSeconds }) => {
          this.store(token);
          this.current.set(admin);
          this.expiresInSeconds.set(expiresInSeconds);
        }),
        map(({ admin }) => admin),
        catchError((error: HttpErrorResponse) => throwError(() => toApiError(error))),
      );
  }

  /**
   * Signs out. The token is sent explicitly and the local state cleared only
   * once the request is away — clearing first would send an unauthenticated
   * request, and the Redis key would outlive a sign-out that looked fine.
   */
  logout(): Observable<void> {
    const token = this.token();

    if (!token) {
      this.clear();
      return of(void 0);
    }

    return this.http
      .delete<void>(`${API_BASE_URL}/admin/session`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .pipe(
        map(() => void 0),
        catchError(() => of(void 0)),
        finalize(() => this.clear()),
      );
  }

  /**
   * Checks the stored token once at startup, so the guards can answer
   * synchronously. A 401 means the seven days ran out, or somebody cleared
   * Redis — either way the token is dead and worth dropping.
   */
  async restore(): Promise<void> {
    if (!this.token()) return;

    try {
      const response = await firstValueFrom(
        this.http.get<{ data: { admin: Admin; expiresInSeconds: number } }>(
          `${API_BASE_URL}/admin/session`,
        ),
      );
      this.current.set(response.data.admin);
      this.expiresInSeconds.set(response.data.expiresInSeconds);
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        this.clear();
      }
    }
  }

  private store(token: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // The sign-in still worked for this page; it just won't be remembered.
    }
  }

  private clear(): void {
    this.current.set(null);
    this.expiresInSeconds.set(null);
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Already unreadable — there is nothing to remove.
    }
  }
}
