import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The native Android shell around the same Angular build.
 *
 * The web app and the app in the Play Store are one codebase: `ng build`
 * produces the assets, `npx cap sync` copies them into the native project. There
 * is no second implementation to keep in step.
 */
const config: CapacitorConfig = {
  /**
   * Must match `package_name` in google-services.json exactly.
   *
   * This is not a naming preference — it is how Firebase decides whether a push
   * is for this app. A mismatch does not fail loudly: registration appears to
   * succeed and no notification is ever delivered.
   */
  appId: 'com.manageyourcard.android',

  appName: 'manageyourcard',

  /** Angular's build output. `cap sync` copies this into the APK. */
  webDir: 'dist/manageYourCardGUI/browser',

  android: {
    /**
     * Lets the app call the development API over plain http.
     *
     * ⚠️ Set this back to `false` once the API is served over https.
     *
     * Capacitor serves the bundled assets from `https://localhost` — Android's
     * `androidScheme` defaults to https — so a request to
     * `http://192.168.29.179:3333` is mixed content, and Android's web view
     * blocks it outright. The symptom is a request that never reaches the
     * server at all, which the app reports as "could not reach the server":
     * indistinguishable from the API being down, and not explained by anything
     * in the API's log, because nothing arrives there.
     *
     * The alternative, setting `androidScheme: 'http'`, cures the mixed content
     * by making the whole app origin insecure — which is worse, since several
     * web platform APIs are restricted to secure contexts.
     *
     * With a production API on https this flag is unnecessary, and leaving it
     * on would let a misconfigured http URL keep working in a release build.
     */
    allowMixedContent: true,
  },

  plugins: {
    PushNotifications: {
      /**
       * Ask for permission when the shopkeeper turns notifications on, not when
       * the app first opens.
       *
       * Android 13+ requires a runtime permission for notifications, and a
       * prompt on first launch — before anyone knows what the app does — is the
       * one people dismiss. The settings toggle asks in context.
       */
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
