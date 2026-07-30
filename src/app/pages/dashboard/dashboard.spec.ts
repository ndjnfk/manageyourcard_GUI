import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Dashboard } from './dashboard';

describe('Dashboard', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Dashboard],
      // The brand and the sign-out link are routerLinks, which inject Router.
      providers: [provideRouter([])],
    }).compileComponents();
  });

  /** Text of the tile whose label matches, e.g. "Due today" → its whole tile. */
  function tileText(host: HTMLElement, label: string): string {
    const tile = [...host.querySelectorAll('.stat')].find((el) =>
      el.textContent?.includes(label),
    );
    return tile?.textContent ?? '';
  }

  it('shows all six headline counts', async () => {
    const fixture = TestBed.createComponent(Dashboard);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    for (const label of [
      'Total cards',
      'Active cards',
      'Due today',
      'Due this week',
      'Expired',
      'Upcoming renewals',
    ]) {
      expect(compiled.textContent).toContain(label);
    }
    expect(compiled.querySelectorAll('.stat').length).toBe(6);
  });

  /**
   * The four state buckets are disjoint by construction, so they have to add up
   * to the total — a preview whose numbers don't reconcile is worse than none.
   */
  it('splits the register into buckets that sum to the total', async () => {
    const fixture = TestBed.createComponent(Dashboard);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const valueOf = (label: string) =>
      Number(tileText(compiled, label).trim().match(/^\d+/)?.[0] ?? NaN);

    const total = valueOf('Total cards');
    const parts =
      valueOf('Active cards') + valueOf('Due today') + valueOf('Due this week') + valueOf('Expired');

    expect(total).toBeGreaterThan(0);
    expect(parts).toBe(total);
  });

  it('filters the register when a stat tile is tapped', async () => {
    const fixture = TestBed.createComponent(Dashboard);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const all = compiled.querySelectorAll('.card-tile').length;
    const expiredTile = [...compiled.querySelectorAll<HTMLButtonElement>('.stat')].find((el) =>
      el.textContent?.includes('Expired'),
    )!;

    expiredTile.click();
    await fixture.whenStable();

    const shown = compiled.querySelectorAll('.card-tile');
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(all);
    // Every card left standing is an overdue one.
    for (const card of shown) {
      expect(card.textContent).toContain('overdue');
    }
  });

  it('searches by card number, customer name and mobile number', async () => {
    const fixture = TestBed.createComponent(Dashboard);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const search = compiled.querySelector<HTMLInputElement>('.myc-field__input')!;

    for (const term of ['C001', 'rahul', '98765']) {
      search.value = term;
      search.dispatchEvent(new Event('input'));
      await fixture.whenStable();

      const shown = compiled.querySelectorAll('.card-tile');
      expect(shown.length).toBe(1);
      expect(shown[0].textContent).toContain('Rahul Deshmukh');
    }
  });

  it('offers a way back when a search matches nothing', async () => {
    const fixture = TestBed.createComponent(Dashboard);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const search = compiled.querySelector<HTMLInputElement>('.myc-field__input')!;

    search.value = 'no such customer';
    search.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(compiled.querySelectorAll('.card-tile').length).toBe(0);

    const reset = [...compiled.querySelectorAll<HTMLButtonElement>('button')].find(
      (el) => el.textContent?.trim() === 'Show all cards',
    )!;
    reset.click();
    await fixture.whenStable();
    expect(compiled.querySelectorAll('.card-tile').length).toBeGreaterThan(0);
  });

  it('opens and closes the mobile drawer', async () => {
    const fixture = TestBed.createComponent(Dashboard);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const toggler = compiled.querySelector<HTMLButtonElement>('[aria-controls="dashNav"]')!;
    const drawer = compiled.querySelector('#dashNav')!;

    expect(drawer.classList.contains('show')).toBe(false);

    toggler.click();
    await fixture.whenStable();
    expect(drawer.classList.contains('show')).toBe(true);
    expect(document.body.classList.contains('myc-no-scroll')).toBe(true);

    compiled.querySelector<HTMLElement>('.offcanvas-backdrop')!.click();
    await fixture.whenStable();
    expect(drawer.classList.contains('show')).toBe(false);
    expect(document.body.classList.contains('myc-no-scroll')).toBe(false);
  });

  it('releases the body scroll lock when the page is destroyed', async () => {
    const fixture = TestBed.createComponent(Dashboard);
    await fixture.whenStable();
    fixture.nativeElement.querySelector('[aria-controls="dashNav"]').click();
    await fixture.whenStable();
    expect(document.body.classList.contains('myc-no-scroll')).toBe(true);

    fixture.destroy();
    expect(document.body.classList.contains('myc-no-scroll')).toBe(false);
  });

  it('keeps every card scoped to the signed-in shopkeeper', async () => {
    const fixture = TestBed.createComponent(Dashboard);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('SHOP001');
  });
});
