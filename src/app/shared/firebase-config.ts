/**
 * The Firebase web app's configuration.
 *
 * Every value here is public by design. The Firebase web SDK sends them to
 * Google from the browser, so they are visible in the network tab and in the
 * bundle no matter where they are kept — they identify the project, they do not
 * authorise anything. What actually guards the project is the FCM server key
 * (which lives only in the API's environment) and Firebase's own security
 * rules. So this file is committed, unlike the service account JSON.
 *
 * From: Firebase console → Project Settings → General → Your apps → Web.
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyC8gFSH9pQCC4fanxQz7HG5nWp1VCjdDss',
  authDomain: 'manageyourcard-a0c1a.firebaseapp.com',
  projectId: 'manageyourcard-a0c1a',
  storageBucket: 'manageyourcard-a0c1a.firebasestorage.app',
  messagingSenderId: '1051487653263',
  appId: '1:1051487653263:web:759e397b58ae1515ebcffa',
  measurementId: 'G-FZB4SFTZ96',
};

/**
 * The public half of the project's Web Push certificate key pair.
 *
 * Firebase console → Project Settings → Cloud Messaging → Web configuration →
 * Web Push certificates → "Generate key pair", then copy the "Key pair" value.
 *
 * Without it `getToken` fails: the browser's Push API requires a VAPID key to
 * identify who is sending, and Firebase will not substitute one. It is safe to
 * commit for the same reason as the config above — it is the public key.
 */
export const VAPID_PUBLIC_KEY =
  'BFnbu4IRdyHOCs7mCF4SvkAqODsfsozwHC3P5NloSu3YZJGZCKxTkCSYxaP6lwLU1Z-4_kQem43J6UeE48MybVI';

/** Whether push can be attempted at all. False until the VAPID key is filled in. */
export const isPushConfigured = (): boolean => VAPID_PUBLIC_KEY.length > 0;
