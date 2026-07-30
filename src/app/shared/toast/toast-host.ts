import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Toasts } from '../toast';

/**
 * Renders whatever is in the Toasts service, centred over the page.
 *
 * Mounted once at the app root, so every page — the shop app and the admin
 * panel alike — gets it without wiring anything up. It has no inputs and no
 * state of its own: anything that wants to say something injects Toasts and
 * calls it.
 */
@Component({
  selector: 'app-toast-host',
  imports: [],
  templateUrl: './toast-host.html',
  styleUrl: './toast-host.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToastHost {
  private readonly toasts = inject(Toasts);

  protected readonly items = this.toasts.toasts;

  protected dismiss(id: number): void {
    this.toasts.dismiss(id);
  }
}
