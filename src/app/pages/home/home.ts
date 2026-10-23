import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Logo } from '../../shared/logo/logo';

interface Feature {
  readonly icon: 'cards' | 'calendar' | 'search' | 'bell';
  readonly title: string;
  readonly body: string;
  /** Full Bootstrap column classes — makes the grid read as a bento on desktop. */
  readonly span: string;
}

interface Step {
  readonly title: string;
  readonly body: string;
}

/** One of the three states a card can be in, derived from its due date. */
interface CardStatus {
  readonly label: string;
  readonly rule: string;
  readonly body: string;
  /** Bootstrap contextual colour class. */
  readonly tone: string;
}

/** A row of the sample register shown on the landing page. */
interface SampleCard {
  readonly cardNo: string;
  readonly customer: string;
  readonly due: string;
  readonly status: string;
  readonly tone: string;
}

@Component({
  selector: 'app-home',
  imports: [Logo, RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  protected readonly year = new Date().getFullYear();

  /**
   * Shown inline in the bar from lg up only. Phones get a Sign in button in
   * place of a menu — nobody is signed in here, and every one of these links
   * is a scroll away on the same page.
   */
  protected readonly navLinks = [
    { label: 'Features', href: '#features' },
    { label: 'How it works', href: '#how-it-works' },
    { label: 'Due dates', href: '#due-dates' },
  ];

  /**
   * Sample dashboard tiles. The numbers are internally consistent —
   * 174 active + 23 due this week + 17 expired = 214 total — so the preview
   * doesn't fall apart if someone actually adds it up.
   */
  protected readonly stats = [
    { value: '214', label: 'Total cards', tone: '' },
    { value: '174', label: 'Active', tone: 'text-success' },
    { value: '6', label: 'Due today', tone: 'text-warning' },
    { value: '23', label: 'Due this week', tone: 'text-warning' },
    { value: '17', label: 'Expired', tone: 'text-danger' },
    { value: '41', label: 'Upcoming renewals', tone: '' },
  ];

  protected readonly features: readonly Feature[] = [
    {
      icon: 'cards',
      title: 'Your whole register, in one place',
      body: 'Add every card you issue with the customer name, mobile number, issue date and due date. Two hundred cards or two thousand — editing one takes a tap, and only your shop can see them.',
      span: 'col-12 col-md-6 col-lg-7',
    },
    {
      icon: 'calendar',
      title: 'Due dates that find you',
      body: "Cards due today sit at the top, the next seven days come after, and anything overdue or expired stays red until you deal with it.",
      span: 'col-12 col-md-6 col-lg-5',
    },
    {
      icon: 'search',
      title: 'Find any card in seconds',
      body: 'Search by card number, customer name or mobile number — no scrolling through a register while somebody waits at the counter.',
      span: 'col-12 col-md-6 col-lg-5',
    },
    {
      icon: 'bell',
      title: 'Reminders before it slips',
      body: 'Reminders wait for you on the dashboard, and you can have them sent to your phone by SMS or WhatsApp so a renewal never depends on you remembering.',
      span: 'col-12 col-md-6 col-lg-7',
    },
  ];

  protected readonly steps: readonly Step[] = [
    {
      title: 'Sign in with your Shopkeeper ID',
      body: 'One ID per shop. You only ever see your own cards — every other shop stays invisible to you, and yours to them.',
    },
    {
      title: 'Add your cards',
      body: 'Card number, customer, mobile, issue date and due date. Add an expiry date and notes if you keep them; skip if you don\'t.',
    },
    {
      title: 'Renew and reset',
      body: "After a renewal or service, update the due date. The status recalculates itself against today's date — nothing to mark off by hand.",
    },
  ];

  protected readonly statuses: readonly CardStatus[] = [
    {
      label: 'Active',
      rule: 'Due date more than 7 days away',
      body: 'Nothing to do. The card sits quietly in your register until its date comes closer.',
      tone: 'text-success',
    },
    {
      label: 'Due soon',
      rule: 'Due within the next 7 days',
      body: 'Moves up the dashboard and starts reminding you, so you can call the customer before the date, not after.',
      tone: 'text-warning',
    },
    {
      label: 'Overdue / Expired',
      rule: 'Due date or expiry date has passed',
      body: 'Stays red on the dashboard until the card is renewed or you close it off. Nothing quietly disappears.',
      tone: 'text-danger',
    },
  ];

  protected readonly sampleCards: readonly SampleCard[] = [
    {
      cardNo: 'C001',
      customer: 'Rahul',
      due: '30 Jul 2026',
      status: 'Due soon',
      tone: 'text-bg-warning',
    },
    {
      cardNo: 'C002',
      customer: 'Amit',
      due: '25 Jul 2026',
      status: 'Overdue',
      tone: 'text-bg-danger',
    },
    {
      cardNo: 'C003',
      customer: 'Priya',
      due: '15 Aug 2026',
      status: 'Active',
      tone: 'text-bg-success',
    },
  ];
}
