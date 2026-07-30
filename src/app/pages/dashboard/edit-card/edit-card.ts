import { DOCUMENT, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiError } from '../../../shared/api';
import { Card, Cards } from '../../../shared/cards';
import { Toasts } from '../../../shared/toast';

type FieldKey = 'customerName' | 'notes' | 'completed' | 'newDueDate';

/**
 * How far out the quick renewal buttons push the due date. These are the
 * intervals a shop actually sells; anything else is typed into the date field.
 */
const RENEW_IN: readonly { readonly label: string; readonly months: number }[] = [
  { label: '6 months', months: 6 },
  { label: '1 year', months: 12 },
  { label: '2 years', months: 24 },
];

/**
 * Adds `months` to a YYYY-MM-DD date, clamping to the end of the month.
 *
 * Without the clamp, 31 January plus one month is 3 March — JavaScript rolls
 * the overflow forward. A card renewed on the 31st falls due on the last day
 * of the target month, which is what a shopkeeper means.
 */
function addMonths(value: string, months: number): string {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;

  const target = new Date(year, month - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));

  return [
    target.getFullYear(),
    String(target.getMonth() + 1).padStart(2, '0'),
    String(target.getDate()).padStart(2, '0'),
  ].join('-');
}

/** Tomorrow, relative to a YYYY-MM-DD date — the earliest a renewal can land. */
function dayAfter(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;

  const next = new Date(year, month - 1, day + 1);
  return [
    next.getFullYear(),
    String(next.getMonth() + 1).padStart(2, '0'),
    String(next.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * "Edit card" — corrects a customer's name or the notes on a card, and closes
 * the card when the work is done.
 *
 * What it deliberately cannot change: the card number, the dates and the
 * customer's mobile. A card number is the link to the piece of plastic in the
 * customer's wallet, and moving a due date is a renewal — a thing that happens,
 * with its own meaning — rather than a correction. Those are shown here as
 * context, not as inputs.
 *
 * Completing is the important one. A shopkeeper who has finished with a card
 * shouldn't have to keep seeing it: closing takes it out of the register and
 * the counts entirely and files it under History.
 *
 * Same native <dialog> shell as the add form — see .myc-dialog in
 * src/styles/_theme.scss.
 */
@Component({
  selector: 'app-edit-card',
  imports: [DatePipe, ReactiveFormsModule],
  templateUrl: './edit-card.html',
  styleUrl: './edit-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditCard {
  private readonly fb = inject(FormBuilder);
  private readonly cards = inject(Cards);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toasts = inject(Toasts);
  private readonly document = inject(DOCUMENT);

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  /** Emitted with the saved card, so the register can replace its copy. */
  readonly saved = output<Card>();

  /** The card being edited — also what the read-only context lines render. */
  protected readonly card = signal<Card | null>(null);

  protected readonly saving = signal(false);

  protected readonly formError = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    customerName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    notes: ['', [Validators.maxLength(200)]],
    completed: [false],
    /**
     * Empty means "not renewing this time". Filling it in is the renewal — the
     * due date moves and the card is stamped as renewed on save.
     */
    newDueDate: [''],
  });

  protected readonly renewIn = RENEW_IN;

  /** Mirrors the toggle so the template can react to it without a getter. */
  protected readonly completed = signal(false);

  /** Floors the renewal picker: a renewal has to move the date forward. */
  protected readonly minNewDueDate = signal('');

  /** True once a new due date is filled in, so the panel can show it is armed. */
  protected readonly renewing = signal(false);

  constructor() {
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.formError.set(null));

    this.form.controls.completed.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((completed) => this.completed.set(completed));

    this.form.controls.newDueDate.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.renewing.set(!!value));
  }

  /** Sets the new due date to the current one plus a common service interval. */
  protected renewFor(months: number): void {
    const card = this.card();
    if (!card) return;

    // Measured from the current due date, not from today: renewing a card that
    // came due last week gives another full term from when it lapsed, which is
    // how a service interval is actually sold.
    this.form.controls.newDueDate.setValue(addMonths(card.dueDate, months));
    this.form.controls.newDueDate.markAsTouched();
  }

  /** Cancels a renewal that was started but not wanted. */
  protected clearRenewal(): void {
    this.form.controls.newDueDate.setValue('');
  }

  /** Opens the dialog on a card. Called by the parent with the row that was tapped. */
  open(card: Card): void {
    this.card.set(card);
    this.saving.set(false);
    this.formError.set(null);

    const completed = card.status === 'Completed';
    this.form.reset(
      {
        customerName: card.customerName,
        notes: card.notes ?? '',
        completed,
        // Blank: opening the dialog is not renewing. The shopkeeper has to
        // ask for a renewal, or a stray save would move a due date they never
        // touched.
        newDueDate: '',
      },
      // A reset is not an edit — nothing downstream should treat the card's
      // own values as something the shopkeeper just typed.
      { emitEvent: false },
    );
    this.completed.set(completed);
    this.renewing.set(false);
    this.minNewDueDate.set(dayAfter(card.dueDate));

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
    if (event.target === this.dialog().nativeElement && !this.saving()) {
      this.close();
    }
  }

  protected control(key: FieldKey) {
    return this.form.controls[key];
  }

  protected showError(key: FieldKey): boolean {
    const control = this.control(key);
    return control.invalid && control.touched;
  }

  protected errorFor(key: FieldKey): string {
    const errors = this.control(key).errors;
    if (!errors) return '';

    if (typeof errors['server'] === 'string') return errors['server'];
    if (errors['required']) return 'Customer name is required.';
    if (errors['notLater']) {
      return 'A renewal has to move the due date forward.';
    }
    if (errors['minlength']) return 'That looks too short.';
    if (errors['maxlength']) return 'That is longer than we can store.';

    return 'Check this field.';
  }

  protected onSubmit(): void {
    const card = this.card();
    if (this.saving() || !card) return;

    this.formError.set(null);
    this.checkRenewal(card.dueDate);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.document
        .getElementById(
          this.form.controls.newDueDate.invalid ? 'edit-newDueDate' : 'edit-customerName',
        )
        ?.focus();
      return;
    }

    const value = this.form.getRawValue();

    this.saving.set(true);
    this.cards
      .update(card.cardId, {
        customerName: value.customerName.trim(),
        // null rather than '' — the API reads null as "clear this note" and an
        // absent key as "leave it alone", so an empty box has to be explicit.
        notes: value.notes.trim() || null,
        completed: value.completed,
        // Omitted entirely when blank: sending it would ask for a renewal
        // nobody requested.
        ...(value.newDueDate ? { newDueDate: value.newDueDate } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.saving.set(false);
          // What changed decides what is said. "Card updated" after closing a
          // card would be true and useless — the shopkeeper wants to know the
          // card has left their register.
          if (value.newDueDate) {
            this.toasts.success('Card renewed', `${updated.cardNumber} is now due ${updated.dueDate}.`);
          } else if (updated.status === 'Completed') {
            this.toasts.success('Card completed', `${updated.cardNumber} has moved to History.`);
          } else if (card.status === 'Completed') {
            this.toasts.info('Card reopened', `${updated.cardNumber} is back in your register.`);
          } else {
            this.toasts.success('Card updated', `Saved ${updated.cardNumber}.`);
          }
          this.saved.emit(updated);
          this.close();
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.showFailure(error);
        },
      });
  }

  /**
   * A renewal has to move the due date forward. Checked here rather than as a
   * validator on the control because it compares against the card being
   * edited, which the control knows nothing about.
   *
   * ISO dates compare correctly as plain strings — YYYY-MM-DD sorts the same
   * lexically as it does chronologically, which is the point of the format.
   */
  private checkRenewal(currentDueDate: string): void {
    const { newDueDate } = this.form.getRawValue();
    if (!newDueDate || newDueDate > currentDueDate) return;

    const control = this.form.controls.newDueDate;
    control.setErrors({ ...(control.errors ?? {}), notLater: true });
    control.markAsTouched();
  }

  private showFailure(error: unknown): void {
    if (!(error instanceof ApiError) || !error.hasFieldErrors) {
      this.formError.set(
        error instanceof ApiError
          ? error.message
          : 'Could not save the card. Please try again in a moment.',
      );
      return;
    }

    for (const [field, message] of Object.entries(error.fieldErrors)) {
      const control = this.form.controls[field as FieldKey];
      if (!control) continue;

      control.setErrors({ ...(control.errors ?? {}), server: message });
      control.markAsTouched();
    }
  }
}
