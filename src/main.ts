import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { captureInstallPrompt } from './app/shared/install-prompt';

// Before the app boots, not after. `beforeinstallprompt` fires once and early;
// a listener attached later — when a component that injects it finally loads —
// misses it, and the install offer is gone for the rest of the visit.
captureInstallPrompt();

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
