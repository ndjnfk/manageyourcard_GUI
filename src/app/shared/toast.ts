import { Injectable, signal } from '@angular/core';

/**
 * What kind of thing happened. Each picks its own icon and colour — see
 * ./toast/toast-host.
 */
export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
  /** Optional second line — the detail under the message. */
  readonly detail?: string;
}

/** How long each kind stays. Errors linger; there is usually more to read. */
const LIFETIME_MS: Readonly<Record<ToastKind, number>> = {
  success: 2600,
  info: 3000,
  error: 5000,
};

/**
 * Brief confirmations, shown centred over the page.
 *
 * For things that have *happened* — a card saved, a session ended. Not for
 * validation: a message about a field belongs under that field, where the
 * field is, and would be gone before it could be acted on here.
 *
 * The service holds no view of its own. `ToastHost` renders whatever is in
 * `toasts()`, and is mounted once at the app root so every page — shop side
 * and admin panel alike — gets it without wiring anything up.
 */
@Injectable({ providedIn: 'root' })
export class Toasts {
  private readonly items = signal<readonly Toast[]>([]);

  readonly toasts = this.items.asReadonly();

  /** Incrementing rather than random: the list tracks by it, and it must be stable. */
  private nextId = 1;

  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  success(message: string, detail?: string): void {
    this.show('success', message, detail);
  }

  error(message: string, detail?: string): void {
    this.show('error', message, detail);
  }

  info(message: string, detail?: string): void {
    this.show('info', message, detail);
  }

  show(kind: ToastKind, message: string, detail?: string): void {
    const id = this.nextId++;

    this.items.update((current) => [...current, { id, kind, message, detail }]);

    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), LIFETIME_MS[kind]),
    );
  }

  /**
   * Removes one, whether it timed out or was dismissed by hand. Clearing the
   * timer matters for the second case — otherwise it fires later against an id
   * that is already gone.
   */
  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }

    this.items.update((current) => current.filter((toast) => toast.id !== id));
  }
}
