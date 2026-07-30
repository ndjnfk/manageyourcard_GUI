import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { canInstall, onInstallChange, showInstallPrompt } from './install-prompt';

/**
 * "Get app" — installing manageyourcard to the home screen or desktop.
 *
 * The listening happens in ./install-prompt, which main.ts calls before Angular
 * boots. It has to: `beforeinstallprompt` fires once and early, and this
 * service is only constructed when something injects it — which is the
 * signed-in shell, a lazily loaded chunk that does not exist yet when the
 * event fires. Listening here would miss it every time.
 *
 * So this is only the Angular-facing half: a signal that follows the answer,
 * for templates to read.
 */
@Injectable({ providedIn: 'root' })
export class Install {
  /** True only when the browser has offered a prompt we can still fire. */
  readonly canInstall = signal(canInstall());

  constructor() {
    const stop = onInstallChange(() => this.canInstall.set(canInstall()));
    inject(DestroyRef).onDestroy(stop);
  }

  /**
   * Shows the browser's install dialog. Must be called straight from a click —
   * browsers only honour it while the user gesture is still live.
   */
  promptInstall(): Promise<boolean> {
    return showInstallPrompt();
  }
}
