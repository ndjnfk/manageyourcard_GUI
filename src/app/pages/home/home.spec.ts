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

    for (const id of ['hero', 'features', 'how-it-works', 'due-dates', 'reviews']) {
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

  it('opens and closes the mobile drawer from the hamburger', async () => {
    const fixture = TestBed.createComponent(Home);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const toggler = compiled.querySelector<HTMLButtonElement>('.navbar-toggler')!;
    const drawer = compiled.querySelector('#landingNav')!;

    expect(drawer.classList.contains('show')).toBe(false);
    expect(document.body.classList.contains('myc-no-scroll')).toBe(false);

    toggler.click();
    await fixture.whenStable();
    expect(drawer.classList.contains('show')).toBe(true);
    expect(toggler.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.classList.contains('myc-no-scroll')).toBe(true);

    // Tapping a link should dismiss the drawer, not leave it over the page.
    compiled.querySelector<HTMLAnchorElement>('#landingNav .nav-link')!.click();
    await fixture.whenStable();
    expect(drawer.classList.contains('show')).toBe(false);
    expect(document.body.classList.contains('myc-no-scroll')).toBe(false);
  });

  it('closes the drawer when the backdrop is clicked', async () => {
    const fixture = TestBed.createComponent(Home);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.navbar-toggler')!.click();
    await fixture.whenStable();

    compiled.querySelector<HTMLElement>('.offcanvas-backdrop')!.click();
    await fixture.whenStable();
    expect(compiled.querySelector('#landingNav')!.classList.contains('show')).toBe(false);
  });

  it('releases the body scroll lock when the page is destroyed', async () => {
    const fixture = TestBed.createComponent(Home);
    await fixture.whenStable();
    fixture.nativeElement.querySelector('.navbar-toggler').click();
    await fixture.whenStable();
    expect(document.body.classList.contains('myc-no-scroll')).toBe(true);

    fixture.destroy();
    expect(document.body.classList.contains('myc-no-scroll')).toBe(false);
  });

  it('renders the sample register for one shopkeeper only', async () => {
    const fixture = TestBed.createComponent(Home);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelectorAll('#due-dates tbody tr').length).toBe(3);
    expect(compiled.querySelector('#due-dates')?.textContent).toContain('SHOP001');
  });
});
