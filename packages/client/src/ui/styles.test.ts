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
