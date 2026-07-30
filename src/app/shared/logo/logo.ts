import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Brand wordmark: "Manage" and "Card" in a high-contrast serif, "Your" in a
 * flowing script that carries the theme gradient.
 *
 * Wordmark only — the card mark lives in public/logo.svg and is used as the
 * favicon, deliberately not shown beside the text.
 *
 *   <app-logo />            navbar — fluid, noticeably larger on laptops
 *   <app-logo size="sm" />  footers, dense toolbars
 *   <app-logo size="lg" />  hero, login and splash screens
 */
@Component({
  selector: 'app-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="logo" [class]="'logo--' + size()">
      <span class="logo__serif">Manage</span
      ><span class="logo__script">Your</span
      ><span class="logo__serif">Card</span>
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
      line-height: 1;
    }

    .logo {
      display: inline-flex;
      align-items: baseline;
      line-height: 1;
      white-space: nowrap;
      /* Fluid by default: ~1.05rem on a phone, ~1.4rem on a laptop. */
      font-size: clamp(1.05rem, 0.85rem + 0.55vw, 1.4rem);
    }

    .logo--sm {
      font-size: 1rem;
    }

    .logo--lg {
      font-size: clamp(1.6rem, 1rem + 2.4vw, 2.75rem);
    }

    /* Inherits colour so the wordmark works on any surface — white on the dark
       canvas, dark if it is ever dropped onto a light background. */
    .logo__serif {
      font-family: "Playfair Display", Georgia, "Times New Roman", serif;
      font-weight: 700;
      letter-spacing: -0.005em;
    }

    .logo__script {
      font-family: "Great Vibes", "Segoe Script", "Snell Roundhand", cursive;
      font-weight: 400;
      /* Scripts render optically smaller than a serif at the same size. */
      font-size: 1.3em;
      /* background-clip: text paints the gradient inside this box and then
         clips it to the glyphs, so the box must have real height — as a flex
         item this is a block box, and line-height:0 would collapse it to
         nothing and make the text disappear. Nudge the baseline with a
         transform instead. */
      line-height: 1;
      transform: translateY(0.07em);
      margin-inline: 0.04em;
      background: var(--myc-gradient-primary, linear-gradient(135deg, #c13af5, #7b2ff7));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      -webkit-text-fill-color: transparent;
    }

    /* If the browser can't clip a background to text, fall back to a solid
       accent rather than leaving transparent (invisible) glyphs. */
    @supports not ((background-clip: text) or (-webkit-background-clip: text)) {
      .logo__script {
        background: none;
        color: var(--myc-violet-bright, #a855f7);
        -webkit-text-fill-color: currentColor;
      }
    }
  `,
})
export class Logo {
  /** Preset scale. `md` is fluid and grows with the viewport. */
  readonly size = input<'sm' | 'md' | 'lg'>('md');
}
