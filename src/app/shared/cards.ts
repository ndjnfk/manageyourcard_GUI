import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';
import { API_BASE_URL, toApiError } from './api';

/**
 * The states a card can be in, as the API reports them.
 *
 * The first three follow from the dates and change on their own as time
 * passes. "Completed" is declared by the shopkeeper when the work is done, and
 * overrides the rest — a finished card is not expired, it is finished.
 */
export type CardStatus = 'Active' | 'Due Soon' | 'Expired' | 'Completed';

/**
 * A card in the shop's register.
 *
 * `cardId` is the primary key. `cardNumber` is a different thing: the number
 * that goes on the physical card, unique within the shop. Both are assigned by
 * the API — neither is typed in, which is what stops two cards sharing a
 * number.
 *
 * The dates are plain calendar dates (YYYY-MM-DD), not instants. "Due on the
 * 14th" is true whatever the hour, and sending them as timestamps is how a card
 * ends up looking due a day early for anyone in a different timezone.
 */
export interface Card {
  cardId: string;
  cardNumber: string;
  customerName: string;
  customerMobile: string;
  issueDate: string;
  dueDate: string;
  expiryDate: string | null;
  /** When the shopkeeper closed it, or null while it is still being tracked. */
  completedAt: string | null;
  /** When it was last renewed, or null if it never has been. */
  renewedAt: string | null;
  /** How many times it has been renewed. 0 until the first one. */
  renewalCount: number;
  status: CardStatus;
  notes: string | null;
  createdAt: string;
}

/**
 * What an edit sends. Every field is optional — only what changed goes.
 *
 * `notes: null` clears the note, where leaving the key out means "don't touch
 * it". The dates and the card number are absent because they are not editable.
 */
export interface CardEdit {
  customerName?: string;
  notes?: string | null;
  completed?: boolean;
  /**
   * Renews the card by moving its due date out to this date. Must be later
   * than the current due date — the API refuses anything that isn't, so the
   * renewal count can't be inflated by a save that renewed nothing.
   */
  newDueDate?: string;
}

/**
 * What adding a card sends.
 *
 * No card number: the API generates it, so that two cards can never end up
 * sharing one. No CardID or status either — both are the API's to decide.
 */
export interface NewCard {
  customerName: string;
  customerMobile: string;
  issueDate: string;
  dueDate: string;
  expiryDate?: string;
  notes?: string;
}

/** The buckets the register can be narrowed to. Mirrors the API's own list. */
/**
 * The buckets the register can be narrowed to. Mirrors the API's own list.
 *
 * 'overdue' and 'expired' are separate: an overdue card is worth chasing, an
 * expired one cannot be renewed at all, and mixing them padded the chase list
 * with cards nobody could act on.
 */
export type CardFilter = 'all' | 'active' | 'today' | 'week' | 'overdue' | 'expired';

/** How a listing is narrowed and paged. */
export interface ListOptions {
  completed?: boolean;
  search?: string;
  filter?: CardFilter;
  page?: number;
  perPage?: number;
}

/** One page of results, plus what the pager needs to draw itself. */
export interface CardPage {
  cards: Card[];
  page: number;
  perPage: number;
  /** Matching cards in total, not just on this page. */
  total: number;
  lastPage: number;
}

/**
 * The signed-in shop's card register.
 *
 * No shop is named in any of these calls — the API takes it from the session.
 * That is the point: there is no parameter here that could be changed to read
 * somebody else's cards.
 */
@Injectable({ providedIn: 'root' })
export class Cards {
  private readonly http = inject(HttpClient);

  /**
   * The live register — cards still being tracked, soonest due first.
   *
   * Completed cards are not included. They are not part of the register any
   * more, and counting them would make every figure on the dashboard wrong.
   */
  list(): Observable<Card[]> {
    return this.http.get<{ data: Card[] }>(`${API_BASE_URL}/cards`).pipe(
      map((response) => response.data),
      catchError((error: HttpErrorResponse) => throwError(() => toApiError(error))),
    );
  }

  /**
   * One card, by its CardID — what the card's own page loads.
   *
   * Fetched rather than passed in from whichever list was on screen, so the
   * page survives a reload, a bookmark or a link shared between two devices.
   */
  get(cardId: string): Observable<Card> {
    return this.http.get<{ data: Card }>(`${API_BASE_URL}/cards/${cardId}`).pipe(
      map((response) => response.data),
      catchError((error: HttpErrorResponse) => throwError(() => toApiError(error))),
    );
  }

  /**
   * One page of the register, narrowed and paged by the API.
   *
   * The narrowing and paging happen server-side on purpose: filtering a page
   * that was already cut down client-side would search only what happened to
   * be on screen, which looks like data going missing.
   */
  listPage(options: ListOptions): Observable<CardPage> {
    const params: Record<string, string> = {
      page: String(options.page ?? 1),
      perPage: String(options.perPage ?? 12),
    };

    if (options.completed) params['completed'] = 'true';
    if (options.search?.trim()) params['search'] = options.search.trim();
    if (options.filter && options.filter !== 'all') params['filter'] = options.filter;

    return this.http
      .get<{ data: Card[]; meta: Omit<CardPage, 'cards'> }>(`${API_BASE_URL}/cards`, { params })
      .pipe(
        map((response) => ({ ...response.meta, cards: response.data })),
        catchError((error: HttpErrorResponse) => throwError(() => toApiError(error))),
      );
  }

  /** The closed cards, most recently completed first — the History page. */
  listCompleted(): Observable<Card[]> {
    return this.http
      .get<{ data: Card[] }>(`${API_BASE_URL}/cards`, { params: { completed: 'true' } })
      .pipe(
        map((response) => response.data),
        catchError((error: HttpErrorResponse) => throwError(() => toApiError(error))),
      );
  }

  /** Saves an edit and returns the card as it now stands. */
  update(cardId: string, changes: CardEdit): Observable<Card> {
    return this.http
      .patch<{ data: Card }>(`${API_BASE_URL}/cards/${encodeURIComponent(cardId)}`, changes)
      .pipe(
        map((response) => response.data),
        catchError((error: HttpErrorResponse) => throwError(() => toApiError(error))),
      );
  }

  /** Adds a card and returns it, CardID included. */
  create(payload: NewCard): Observable<Card> {
    return this.http.post<{ data: Card }>(`${API_BASE_URL}/cards`, payload).pipe(
      map((response) => response.data),
      catchError((error: HttpErrorResponse) => throwError(() => toApiError(error))),
    );
  }
}
