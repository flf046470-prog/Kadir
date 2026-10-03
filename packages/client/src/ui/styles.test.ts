import { describe, expect, it } from 'vitest';

import { UI_CSS } from './styles.js';

/**
 * The stylesheet, checked for being a stylesheet.
 *
 * `UI_CSS` is a template literal, so a single stray backtick inside a CSS comment ends the string
 * early and turns the rest of the file into code. That has happened twice: both times the build
 * succeeded, the types checked, and the app threw `ReferenceError` on boot with a blank screen —
 * a failure a long way from its cause. Braces and a few load-bearing rules are enough to catch a
 * truncated stylesheet the moment it happens.
 */
describe('UI_CSS', () => {
  it('is not truncated', () => {
    // A cut string loses its closing braces long before it loses its opening ones.
    const open = (UI_CSS.match(/\{/g) ?? []).length;
    const close = (UI_CSS.match(/\}/g) ?? []).length;
    expect(close, `${open} "{" against ${close} "}"`).toBe(open);
    expect(UI_CSS.length).toBeGreaterThan(4000);
  });

  it('carries no backtick, which would have ended it early', () => {
    expect(UI_CSS).not.toContain('`');
  });

  it('has no unclosed comment', () => {
    expect((UI_CSS.match(/\/\*/g) ?? []).length).toBe((UI_CSS.match(/\*\//g) ?? []).length);
  });

  /**
   * The HUD is transparent to pointer events so the canvas under it can be swiped, and the
   * property inherits — so every control inside it is dead unless this rule takes them back.
   * Twice now that rule has been missing for some element or other, and each time the control
   * rendered perfectly and did nothing.
   */
  it('gives every interactive thing in the HUD its pointer events back', () => {
    expect(UI_CSS).toMatch(/\.kc-hud button,\s*\.kc-hud input,\s*\.kc-hud \[data-ui\]\s*\{[^}]*pointer-events:\s*auto/);
  });

  it('still keeps the HUD itself transparent to them', () => {
    expect(UI_CSS).toMatch(/\.kc-hud \{[^}]*pointer-events:\s*none/);
  });

  it('ends with the last media query closed', () => {
    expect(UI_CSS.trimEnd().endsWith('}')).toBe(true);
  });
});

/**
 * The centre column, checked for staying a column.
 *
 * The headline, clock, role badge and tally, the bout panel and the toast each used to position
 * themselves: the first group in normal flow at the top, the bout panel at `top: 24%`, the toast
 * at `top: 22%`. A screenshot of a real Conversion Duel bout at 560x360 showed all three inside
 * ten pixels of each other — "KANGAROO 1" behind "FIGHT · Bounce" behind a "Hit!" toast, none of
 * them readable. Every test passed; the data was correct; it was the pixels that were wrong.
 *
 * The lesson is in the units. The top group's height is content-driven and measured in pixels — it
 * grows the moment a mode publishes a tally — so a percentage that clears it on one screen sits on
 * top of it on another. They are siblings in one flex column now, which the layout engine cannot
 * overlap, and these guard the arrangement rather than any particular number.
 */
describe('the HUD centre column', () => {
  it('lays its children out in flow rather than stacking them', () => {
    expect(UI_CSS).toMatch(/\.kc-hud-centre\s*\{[^}]*flex-direction:\s*column/);
    expect(UI_CSS).toMatch(/\.kc-hud-centre\s*\{[^}]*position:\s*absolute/);
  });

  it('takes the absolute positioning off everything inside it', () => {
    /**
     * The actual regression. Any one of these going back to `position: absolute` re-creates the
     * pile-up, and it would look fine at whatever window size it was checked at.
     */
    for (const selector of ['.kc-hud-top', '.kc-bout', '.kc-toast']) {
      const rule = UI_CSS.match(new RegExp(`\\${selector}\\s*\\{[^}]*\\}`));
      expect(rule, `no rule for ${selector}`).not.toBeNull();
      expect(rule?.[0], `${selector} is positioned independently again`).not.toMatch(/position:\s*absolute/);
      expect(rule?.[0], `${selector} sets its own vertical anchor again`).not.toMatch(/(^|[^-])top:\s*\d/);
    }
  });

  it('keeps the column clear of the corner panels', () => {
    // Scores sit top-right and the menu top-left, both of them content-width; the column has to
    // stay narrow enough not to slide under either.
    expect(UI_CSS).toMatch(/\.kc-hud-centre\s*\{[^}]*max-width:/);
  });
});
