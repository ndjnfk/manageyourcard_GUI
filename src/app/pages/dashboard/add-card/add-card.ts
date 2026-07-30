import { DOCUMENT } from '@angular/common';
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
import { mobileValidator } from '../../../shared/validators';

type FieldKey =
  | 'customerName'
  | 'customerMobile'
  | 'issueDate'
  | 'dueDate'
  | 'expiryDate'
  | 'notes';

/**
 * Today as a plain YYYY-MM-DD, in the shopkeeper's own timezone.
 *
 * Deliberately not toISOString().slice(0, 10): that is UTC, and for anyone east
 * of London it reads as yesterday for part of the day — so a card issued this
 * morning would be dated the day before.
 */
function todayValue(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * "Add new card" — the dialog the shopkeeper fills in at the counter.
 *
 * The fields are the Cards schema minus everything the shopkeeper does not
 * supply: the CardID and the card number are both assigned when the card is
 * created, the ShopkeeperID comes from the session, and the Status is derived
 * from the dates. The card number in particular is deliberately not asked for
 * — a number typed at a busy counter is exactly the thing that gets repeated.
 *
 * Built on the native <dialog> element rather than a hand-rolled overlay: the
 * browser gives focus trapping, Escape to close, inertness of the page behind
 * and a ::backdrop for free, and all four are things a bespoke modal usually
 * gets wrong. Bootstrap's JS is not loaded in this project, so its modal was
 * never an option anyway.
 *
 * The parent opens it by calling `open()` and listens to `created`.
 */
@Component({
  selector: 'app-add-card',
  imports: [ReactiveFormsModule],
  templateUrl: './add-card.html',
  styleUrl: './add-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddCard {
  private readonly fb = inject(FormBuilder);
  private readonly cards = inject(Cards);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toasts = inject(Toasts);
  private readonly document = inject(DOCUMENT);

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  /** Emitted once the API has stored the card, so the register can take it. */
  readonly created = output<Card>();

  protected readonly saving = signal(false);

  /**
   * Caps the issue date input at today, so the browser's own picker won't offer
   * a future date. Refreshed each time the dialog opens rather than fixed at
   * construction — the dashboard can sit open across midnight.
   */
  protected readonly maxIssueDate = signal(todayValue());

  /**
   * Floors the due and expiry pickers at the issue date, so neither can be set
   * before the card existed. Mirrors the check in `checkDates` — the picker
   * stops the mistake, the check catches it if they type instead.
   */
  protected readonly minLaterDate = signal(todayValue());

  /** A failure that belongs to no single field. Field errors go under theirs. */
  protected readonly formError = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    customerName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    customerMobile: ['', [Validators.required, mobileValidator]],
    issueDate: [todayValue(), [Validators.required]],
    // Defaults to today, not a year out. A default in a different year is
    // invisible in a date input — it reads as "30 Jul" at a glance — and it is
    // the shopkeeper who knows the real interval anyway.
    dueDate: [todayValue(), [Validators.required]],
    // Optional: plenty of cards have a renewal date but no hard expiry.
    expiryDate: [''],
    notes: ['', [Validators.maxLength(200)]],
  });

  constructor() {
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.formError.set(null));

    this.form.controls.issueDate.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((issueDate) => this.minLaterDate.set(issueDate));
  }

  open(): void {
    this.reset();
    this.dialog().nativeElement.showModal();
    // showModal alone leaves the page behind scrollable on iOS, which drags
    // the sheet around under the shopkeeper's finger.
    this.document.body.classList.add('myc-no-scroll');
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }

  /**
   * Fires for every close — the button, Escape, or a click on the backdrop.
   * The scroll lock is released here so no path can leave the page stuck.
   */
  protected onClose(): void {
    this.document.body.classList.remove('myc-no-scroll');
  }

  /**
   * A click that lands on the dialog element itself is a click on the backdrop:
   * the dialog's own content sits in children, so anything hitting the element
   * missed the card. Dismissing on it is what people expect of an overlay.
   */
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

    // The API's own words win: it knows things this form cannot — that this
    // card number is already in the register, say.
    if (typeof errors['server'] === 'string') return errors['server'];

    if (errors['required']) {
      return (
        {
          customerName: 'Customer name is required.',
          customerMobile: 'Mobile number is required.',
          issueDate: 'Issue date is required.',
          dueDate: 'Due date is required.',
          expiryDate: '',
          notes: '',
        } as Record<FieldKey, string>
      )[key];
    }
    if (errors['mobile']) {
      return 'Enter a 10-digit mobile number starting 6, 7, 8 or 9.';
    }
    if (errors['beforeIssue']) {
      return 'This cannot be before the issue date.';
    }
    if (errors['future']) {
      return 'A card cannot be issued in the future. Check the year.';
    }
    if (errors['minlength']) return 'That looks too short.';
    if (errors['maxlength']) return 'That is longer than we can store.';

    return 'Check this field.';
  }

  protected onSubmit(): void {
    if (this.saving()) return;

    this.formError.set(null);
    this.checkDates();

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.focusFirstInvalid();
      return;
    }

    const value = this.form.getRawValue();

    this.saving.set(true);
    this.cards
      .create({
        customerName: value.customerName.trim(),
        customerMobile: value.customerMobile.trim(),
        issueDate: value.issueDate,
        dueDate: value.dueDate,
        ...(value.expiryDate ? { expiryDate: value.expiryDate } : {}),
        ...(value.notes.trim() ? { notes: value.notes.trim() } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (card) => {
          this.saving.set(false);
          this.toasts.success(
            'Card added',
            `${card.cardNumber} for ${card.customerName}, due ${card.dueDate}.`,
          );
          this.created.emit(card);
          this.close();
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.showFailure(error);
        },
      });
  }

  /**
   * The date checks that no single control can make on its own — two of them
   * compare fields, and the third compares against today.
   *
   * Run at submit rather than on every keystroke: a half-typed date is nearly
   * always out of order, and flagging it while they type is just nagging.
   */
  private checkDates(): void {
    const { issueDate, dueDate, expiryDate } = this.form.getRawValue();
    if (!issueDate) return;

    // A card is issued when the customer is at the counter, so the issue date
    // is today or earlier. Mistyping the year is easy in a date input, and it
    // is invisible afterwards — the card simply reads as having a year still
    // to run when it does not.
    if (issueDate > todayValue()) {
      this.fail('issueDate', 'future');
    }

    // ISO dates compare correctly as plain strings — YYYY-MM-DD sorts the same
    // lexically as it does chronologically, which is the point of the format.
    for (const [key, value] of [
      ['dueDate', dueDate],
      ['expiryDate', expiryDate],
    ] as const) {
      if (!value || value >= issueDate) continue;

      this.fail(key, 'beforeIssue');
    }
  }

  /** Marks a control failed without dropping the errors already on it. */
  private fail(key: FieldKey, error: string): void {
    const control = this.control(key);
    control.setErrors({ ...(control.errors ?? {}), [error]: true });
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

    this.focusFirstInvalid();
  }

  private focusFirstInvalid(): void {
    const order: FieldKey[] = [
      'customerName',
      'customerMobile',
      'issueDate',
      'dueDate',
      'expiryDate',
    ];
    const first = order.find((key) => this.control(key).invalid);
    if (!first) return;

    this.document.getElementById(`card-${first}`)?.focus();
  }

  /** Back to a blank card, so reopening never shows the last one's details. */
  private reset(): void {
    const today = todayValue();

    this.saving.set(false);
    this.formError.set(null);
    this.maxIssueDate.set(today);
    this.minLaterDate.set(today);

    // emitEvent: false because a reset is not an edit — nothing downstream
    // should treat these defaults as something the shopkeeper typed.
    this.form.reset(
      {
        customerName: '',
        customerMobile: '',
        issueDate: today,
        dueDate: today,
        expiryDate: '',
        notes: '',
      },
      { emitEvent: false },
    );
  }
}
