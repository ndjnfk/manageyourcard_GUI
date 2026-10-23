import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Home } from './home';

describe('Home (landing page)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Home],
      // The hero's "Open your dashboard" CTA is a routerLink, which injects Router.
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('renders the hero headline', async () => {
    const fixture = TestBed.createComponent(Home);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('card renewal');
  });

  it('renders every landing section the nav links to', async () => {
    const fixture = TestBed.createComponent(Home);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    for (const id of ['hero', 'features', 'how-it-works', 'due-dates']) {
      expect(compiled.querySelector(`#${id}`)).toBeTruthy();
    }
  });

  it('shows the three card states a due date can produce', async () => {
    const fixture = TestBed.createComponent(Home);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const text = compiled.querySelector('#due-dates')?.textContent ?? '';

    expect(text).toContain('Active');
    expect(text).toContain('Due soon');
    expect(text).toContain('Overdue');
  });

  // Nobody is signed in on this page, so the header offers a way in and
  // nothing else — no hamburger, and no drawer behind it to get stranded open.
  it('offers a sign in link in place of a mobile menu', async () => {
    const fixture = TestBed.createComponent(Home);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const header = compiled.querySelector('header')!;

    expect(header.querySelector('.navbar-toggler')).toBeNull();
    expect(compiled.querySelector('.offcanvas')).toBeNull();
    expect(
      [...header.querySelectorAll('a')].some((a) => a.textContent?.trim() === 'Sign in'),
    ).toBe(true);
  });

  it('keeps the footer to the two links the page cannot scroll to', async () => {
    const fixture = TestBed.createComponent(Home);
    await fixture.whenStable();
    const links = fixture.nativeElement.querySelectorAll('footer nav a') as NodeListOf<HTMLElement>;

    expect([...links].map((a) => a.textContent?.trim())).toEqual(['Login', 'Register']);
  });
});
