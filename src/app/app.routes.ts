import { Routes } from '@angular/router';
import { adminGuard, adminGuestGuard } from './admin/admin-guards';
import { authGuard, guestGuard } from './shared/guards';

export const routes: Routes = [
  {
    path: '',
    // Public landing page — what visitors see before signing in. A shopkeeper
    // who is already signed in is sent to their dashboard instead: their
    // session has no expiry, so this is where they land every time until they
    // sign out themselves.
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/home/home').then((m) => m.Home),
    title: 'manageyourcard — card renewal & due date tracking for shops',
  },
  {
    path: 'dashboard',
    // Signed-in view: the shopkeeper's own register and its due-date counts.
    canActivate: [authGuard],
    loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.Dashboard),
    title: 'Dashboard — manageyourcard',
  },
  {
    path: 'cards',
    // The whole live register: searchable, filterable and paged. The dashboard
    // shows what needs doing today; this is where you find one card.
    canActivate: [authGuard],
    loadComponent: () => import('./pages/cards/cards-page').then((m) => m.CardsPage),
    title: 'All cards — manageyourcard',
  },
  {
    path: 'cards/:cardId',
    // One card in full, with Call and Edit. Declared after 'cards' so the
    // register listing is not swallowed by the parameter segment.
    //
    // A page rather than a dialog, because the dashboard's panels name a
    // customer and carry no actions: tapping one has to land somewhere that
    // does, and somewhere that survives a reload or a shared link.
    canActivate: [authGuard],
    loadComponent: () => import('./pages/card-detail/card-detail').then((m) => m.CardDetail),
    title: 'Card — manageyourcard',
  },
  {
    path: 'history',
    // Cards the shop has finished with. Signed-in only, like the dashboard —
    // it is the same register, just the closed end of it.
    canActivate: [authGuard],
    loadComponent: () => import('./pages/history/history').then((m) => m.History),
    title: 'History — manageyourcard',
  },
  {
    path: 'notifications',
    // What the bell in the app bar opens: the reminders that have gone out.
    // A record rather than a delivery — see ./shared/inbox.
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/notifications/notifications').then((m) => m.Notifications),
    title: 'Notifications — manageyourcard',
  },
  {
    path: 'profile',
    // The shop's own details and photo. Signed-in only.
    canActivate: [authGuard],
    loadComponent: () => import('./pages/profile/profile').then((m) => m.Profile),
    title: 'Profile — manageyourcard',
  },
  {
    path: 'login',
    // Sign-in for a shop that has already registered. Nothing to do here if
    // they already are.
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
    title: 'Sign in — manageyourcard',
  },
  {
    path: 'register',
    // Sign-up: creates the Shopkeeper record every card is later filed under.
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/register/register').then((m) => m.Register),
    title: 'Register your shop — manageyourcard',
  },
  /*
  |----------------------------------------------------------------------------
  | Admin panel
  |----------------------------------------------------------------------------
  |
  | Its own guards, its own session and its own token. Being signed in as a
  | shop says nothing about being an admin, and vice versa — the two can be
  | signed in at once in the same browser.
  */
  {
    path: 'admin/login',
    canActivate: [adminGuestGuard],
    loadComponent: () => import('./admin/login/admin-login').then((m) => m.AdminLogin),
    title: 'Admin sign in — manageyourcard',
  },
  {
    path: 'admin',
    canActivate: [adminGuard],
    loadComponent: () => import('./admin/dashboard/admin-dashboard').then((m) => m.AdminDashboard),
    title: 'Admin — manageyourcard',
  },
  {
    path: 'admin/shopkeepers',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./admin/shopkeepers/admin-shopkeepers').then((m) => m.AdminShopkeepers),
    title: 'Shopkeepers — manageyourcard admin',
  },
  {
    path: 'admin/shopkeepers/:shopkeeperId/cards',
    canActivate: [adminGuard],
    loadComponent: () => import('./admin/cards/admin-cards').then((m) => m.AdminCards),
    title: 'Shop cards — manageyourcard admin',
  },

  { path: '**', redirectTo: '' },
];
