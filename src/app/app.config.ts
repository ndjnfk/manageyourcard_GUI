import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners, isDevMode,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { routes } from './app.routes';
import { AdminAuth } from './admin/admin-auth';
import { authInterceptor } from './shared/auth-interceptor';
import { Auth } from './shared/auth';
import { provideServiceWorker } from '@angular/service-worker';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // withComponentInputBinding: hands route parameters to components as
    // signal inputs. Without it a `input.required<string>()` bound to a route
    // param is simply never set — and reading a required input that has not
    // been set throws, which is how the admin cards page failed to load at
    // all rather than loading the wrong shop.
    provideRouter(routes, withComponentInputBinding()),
    // withFetch: uses the Fetch API rather than XHR. It is the current default
    // recommendation, and it is what would let these requests be reused during
    // server-side rendering if this app ever grows one.
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    // Check the stored session tokens against the API before the router runs.
    // Returning the promise makes Angular wait, which is what lets the guards
    // in ./shared/guards answer synchronously — and what makes a signed-in
    // shopkeeper land on the dashboard rather than seeing the landing page
    // flash past first.
    //
    // Both are checked, in parallel: the shop and the admin are separate
    // sessions, and either, both or neither may be live in this browser.
    provideAppInitializer(() => {
      const auth = inject(Auth);
      const adminAuth = inject(AdminAuth);
      return Promise.all([auth.restore(), adminAuth.restore()]);
    }),
    // Resolved against the base href rather than passed as 'ngsw-worker.js'.
    // A bare name is resolved against the *page's* URL, not the base tag, so
    // opening /manageyourcard/cards/CRD-00001 directly — a bookmark, a link
    // from a reminder email — would ask for
    // /manageyourcard/cards/ngsw-worker.js and get a 404. That visit then has
    // no service worker at all: no offline, no install offer, and nothing to
    // say why.
    provideServiceWorker(new URL('ngsw-worker.js', document.baseURI).pathname, {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
