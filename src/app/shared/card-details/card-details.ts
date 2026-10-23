import { DOCUMENT, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Card } from '../cards';

/**
 * Reads a plain YYYY-MM-DD into a local midnight Date.
 *
 * Deliberately not `new Date(value)`: that parses a bare date string as UTC
 * midnight, which for anyone west of Greenwich is the previous evening — and a
 * card would read as due a day early.
 */
function parseCalendarDate(value: string | null): Date | null {
  if (!value) return null;

  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;

  return new Date(year, month - 1, day);
}

/**
 * "Card details" — everything on a card, read-only.
 *
 * Exists because an expired card has no Edit button. That was a deliberate
 * choice — renewing an expired card would not revive it — but Edit was also
 * the only place the full record could be seen, so removing it left a card
 * whose customer name, note and dates could no longer be read at all. A shop
 * ringing a customer about a card that has run out needs exactly those, and
 * needs them without being able to change anything by accident.
 *
 * Nothing here writes. There is no form, no save, and no state to lose, which
 * is why the backdrop and Escape close it without a confirmation.
 *
 * Same native <dialog> shell as the add and edit forms — see .myc-dialog in
 * src/styles/_theme.scss.
 */
@Component({
  selector: 'app-card-details',
  imports: [DatePipe],
  templateUrl: './card-details.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardDetails {
  private readonly document = inject(DOCUMENT);

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly card = signal<Card | null>(null);

  /** The dates, parsed once, in the order a shopkeeper reads them. */
  protected readonly dates = computed(() => {
    const card = this.card();
    if (!card) return null;

    return {
      issued: parseCalendarDate(card.issueDate),
      due: parseCalendarDate(card.dueDate),
      expiry: parseCalendarDate(card.expiryDate),
      renewed: card.renewedAt ? new Date(card.renewedAt) : null,
      completed: card.completedAt ? new Date(card.completedAt) : null,
    };
  });

  /** Opens on a card. Called by the parent with the row that was tapped. */
  open(card: Card): void {
    this.card.set(card);

    this.dialog().nativeElement.showModal();
    this.document.body.classList.add('myc-no-scroll');
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }

  /** Fires for every close — the button, Escape, or the backdrop. */
  protected onClose(): void {
    this.document.body.classList.remove('myc-no-scroll');
  }

  protected onBackdropClick(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) {
      this.close();
    }
  }
}
