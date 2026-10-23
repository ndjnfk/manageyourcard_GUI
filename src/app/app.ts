import { Component, effect, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Auth } from './shared/auth';
import { Inbox } from './shared/inbox';
import { Push } from './shared/push';
import { ToastHost } from './shared/toast/toast-host';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastHost],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly auth = inject(Auth);
  private readonly push = inject(Push);
  private readonly inbox = inject(Inbox);

  protected readonly title = signal('manageyourcard');

  constructor() {
    /**
     * Re-registers this browser's push token whenever a shop signs in.
     *
     * FCM rotates tokens on its own schedule, and a rotated token that was
     * never sent up leaves the server pushing to an address that no longer
     * resolves — notifications just stop, with nothing anywhere explaining
     * why. Registering again on every sign-in is what keeps the stored token
     * current.
     *
     * It also re-points this device at whoever has just signed in, which
     * matters on a shared computer: without it the browser would keep
     * receiving the *previous* shop's notifications, customer names included.
     *
     * Deliberately not awaited and never prompts — `refresh` does nothing at
     * all unless permission has already been granted, so signing in stays as
     * fast as it was and nobody is asked for anything they did not go looking
     * for.
     */
    effect(() => {
      if (!this.auth.signedIn()) {
        // Signing out has to empty the badge as well as the session. The list
        // belongs to one shop, and a count left over from the last one would
        // sit on the app bar of whoever signs in next.
        this.inbox.clear();
        return;
      }

      void this.push.refresh();

      // Just the count — the notifications page loads the bodies when it opens.
      void this.inbox.refreshCount();
    });
  }
}
