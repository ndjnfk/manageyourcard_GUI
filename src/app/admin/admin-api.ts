import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';
import { API_BASE_URL, toApiError } from '../shared/api';
import { Shop } from '../shared/auth';
import { Card } from '../shared/cards';

/** Headline counts on the admin dashboard. */
export interface AdminStats {
  shopkeepers: number;
  cards: number;
  liveCards: number;
  completedCards: number;
}

export interface Paged<T> {
  items: T[];
  page: number;
  perPage: number;
  total: number;
  lastPage: number;
}

/** A page of one shop's cards, with the shop it belongs to. */
export interface ShopCards extends Paged<Card> {
  shopkeeper: Shop;
}

/** What an admin may change on a shop. Wider than the shop's own profile form. */
export interface AdminShopEdit {
  shopName?: string;
  ownerName?: string;
  mobile?: string;
  email?: string;
  /** Resets the shop's password. Absent means "leave it". */
  password?: string;
}

/** The destructive actions in the panel's side panel. */
export type MaintenanceAction = 'logout-shopkeepers' | 'clear-redis' | 'clear-data';

/**
 * The admin panel's data calls.
 *
 * Session handling lives in AdminAuth; this is everything else. These are the
 * only calls in the app that are not scoped to a single shop, which is why
 * they sit behind their own middleware on the API.
 */
@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly http = inject(HttpClient);

  stats(): Observable<AdminStats> {
    return this.http.get<{ data: AdminStats }>(`${API_BASE_URL}/admin/stats`).pipe(
      map((response) => response.data),
      catchError((error: HttpErrorResponse) => throwError(() => toApiError(error))),
    );
  }

  shopkeepers(options: { search?: string; page?: number; perPage?: number }): Observable<Paged<Shop>> {
    const params: Record<string, string> = {
      page: String(options.page ?? 1),
      perPage: String(options.perPage ?? 12),
    };
    if (options.search?.trim()) params['search'] = options.search.trim();

    return this.http
      .get<{ data: Shop[]; meta: Omit<Paged<Shop>, 'items'> }>(`${API_BASE_URL}/admin/shopkeepers`, {
        params,
      })
      .pipe(
        map((response) => ({ ...response.meta, items: response.data })),
        catchError((error: HttpErrorResponse) => throwError(() => toApiError(error))),
      );
  }

  updateShopkeeper(shopkeeperId: string, changes: AdminShopEdit): Observable<Shop> {
    return this.http
      .patch<{ data: Shop }>(
        `${API_BASE_URL}/admin/shopkeepers/${encodeURIComponent(shopkeeperId)}`,
        changes,
      )
      .pipe(
        map((response) => response.data),
        catchError((error: HttpErrorResponse) => throwError(() => toApiError(error))),
      );
  }

  /**
   * Deletes a shop and everything belonging to it.
   *
   * `confirm` must be the shop's own ShopkeeperID — the API refuses anything
   * else. A fixed word would guard against a stray click but not against
   * deleting the wrong shop, which is the mistake a table of them invites.
   */
  deleteShopkeeper(shopkeeperId: string): Observable<string> {
    return this.http
      .delete<{ data: { message: string } }>(
        `${API_BASE_URL}/admin/shopkeepers/${encodeURIComponent(shopkeeperId)}`,
        { body: { confirm: shopkeeperId } },
      )
      .pipe(
        map((response) => response.data.message),
        catchError((error: HttpErrorResponse) => throwError(() => toApiError(error))),
      );
  }

  /** One shop's cards — what the Cards button on the shop table opens. */
  shopkeeperCards(
    shopkeeperId: string,
    options: { search?: string; completed?: boolean; page?: number; perPage?: number },
  ): Observable<ShopCards> {
    const params: Record<string, string> = {
      page: String(options.page ?? 1),
      perPage: String(options.perPage ?? 12),
    };
    if (options.search?.trim()) params['search'] = options.search.trim();
    if (options.completed) params['completed'] = 'true';

    return this.http
      .get<{ data: Card[]; meta: Omit<ShopCards, 'items'> }>(
        `${API_BASE_URL}/admin/shopkeepers/${encodeURIComponent(shopkeeperId)}/cards`,
        { params },
      )
      .pipe(
        map((response) => ({ ...response.meta, items: response.data })),
        catchError((error: HttpErrorResponse) => throwError(() => toApiError(error))),
      );
  }

  /**
   * Runs a destructive maintenance action.
   *
   * The confirmation is sent as a literal the API checks for. It is not
   * decoration: these wipe every shop's data, and the guard has to hold for a
   * request sent by hand as well as one sent by this panel.
   */
  maintenance(action: MaintenanceAction): Observable<string> {
    return this.http
      .post<{ data: { message: string } }>(`${API_BASE_URL}/admin/maintenance/${action}`, {
        confirm: 'CONFIRM',
      })
      .pipe(
        map((response) => response.data.message),
        catchError((error: HttpErrorResponse) => throwError(() => toApiError(error))),
      );
  }
}
