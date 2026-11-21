import { markInput } from '../platform/activeInput.js';
/**
 * Playing the whole game from a controller.
 *
 * A pad already drove a match (`PCInput.readGamepad`), and nothing else: no pad button opened the
 * menu (Start and Back/Share were bound to nothing), and no pad input reached a menu at all, so a
 * player holding only a controller — the whole audience of a console store, Xbox controllers on
 * Windows, a DualSense on a TV — could not get past the name screen, and once in a round could not
 * pause it. Worse, a menu opened by keyboard over a match still fed the pad to the simulation, so
 * the face button that would confirm a menu row jumped the player behind it.
 *
 * The rule here is the one console certification asks for: every screen can be reached and left
 * with the D-pad or left stick, A/Cross to choose, B/Circle to go back, Start/Options to pause.
 * The pure half (edge detection with key repeat, and spatial choice of the next control) has a
 * right answer and is unit tested; the DOM half only reads the page.
 */

/** Standard Gamepad mapping indices (W3C): the same on an Xbox pad and a DualSense. */
export const PAD = {
  confirm: 0, // A / Cross
  back: 1, // B / Circle
  menu: 9, // Start / Options
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;

export type PadAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'menu';

/** What a pad looks like this frame, reduced to what navigation reads. */
export interface PadSnapshot {
  pressed: (index: number) => boolean;
  axes: readonly number[];
}

/** Stick deflection that counts as a direction. Past the game's dead zone, so a resting stick drifts nowhere. */
export const NAV_STICK = 0.55;
/** A held direction repeats after this long, then every `REPEAT_EVERY`, as a held arrow key does. */
export const REPEAT_AFTER = 0.4;
export const REPEAT_EVERY = 0.12;

const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
type Direction = (typeof DIRECTIONS)[number];

/**
 * Turns pad state into navigation actions: a button counts on the frame it goes down, a direction
 * on the frame it starts and then on a repeat while held.
 */
export class PadEdges {
  private held = new Set<string>();
  private heldDir: Direction | null = null;
  private dirTime = 0;
  private nextRepeat = 0;

  /** Forget everything held: the next press counts even if a button was already down. */
  reset(): void {
    this.held.clear();
    this.heldDir = null;
  }

  /**
   * Swallow whatever is down right now without acting on it. Called when a screen opens, so the
   * press that opened it (Start, or A on the previous screen) is not read again by the new one.
   */
  absorb(pad: PadSnapshot): void {
    for (const name of ['confirm', 'back', 'menu'] as const) {
      if (pad.pressed(PAD[name])) this.held.add(name);
    }
    this.heldDir = directionOf(pad);
    this.dirTime = 0;
    this.nextRepeat = REPEAT_AFTER;
  }

  update(pad: PadSnapshot, dt: number): PadAction[] {
    const out: PadAction[] = [];
    for (const name of ['confirm', 'back', 'menu'] as const) {
      const down = pad.pressed(PAD[name]);
      if (down && !this.held.has(name)) out.push(name);
      if (down) this.held.add(name);
      else this.held.delete(name);
    }
    const dir = directionOf(pad);
    if (dir !== this.heldDir) {
      this.heldDir = dir;
      this.dirTime = 0;
      this.nextRepeat = REPEAT_AFTER;
      if (dir) out.push(dir);
    } else if (dir) {
      this.dirTime += dt;
      if (this.dirTime >= this.nextRepeat) {
        this.nextRepeat += REPEAT_EVERY;
        out.push(dir);
      }
    }
    return out;
  }
}

/** The one direction a pad is pushing, D-pad first, else the left stick's larger axis. */
export function directionOf(pad: PadSnapshot): Direction | null {
  if (pad.pressed(PAD.up)) return 'up';
  if (pad.pressed(PAD.down)) return 'down';
  if (pad.pressed(PAD.left)) return 'left';
  if (pad.pressed(PAD.right)) return 'right';
  const x = pad.axes[0] ?? 0;
  const y = pad.axes[1] ?? 0;
  if (Math.max(Math.abs(x), Math.abs(y)) < NAV_STICK) return null;
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'down' : 'up';
}

export interface NavRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The control to move to from `from` in direction `dir`, or -1 if there is none that way.
 *
 * A candidate must lie that way from the current control's centre. It is scored by the gaps
 * between the two boxes' edges, not their centres: the gap along the direction counts once and
 * the sideways gap three times, so moving down a column stays in the column. Centre distance
 * fails on a settings screen, where a slider is a wide bar beside its label: its centre sits far
 * off to the side of a checkbox above it, so Down skipped every slider on the screen (measured in
 * `check:pad`: fifteen presses, no slider). Ties go to the nearer centre, then page order.
 */
export function pickNext(from: NavRect, candidates: readonly NavRect[], dir: Direction): number {
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const cx = c.left + c.width / 2;
    const cy = c.top + c.height / 2;
    const vertical = dir === 'up' || dir === 'down';
    const sign = dir === 'down' || dir === 'right' ? 1 : -1;
    const centreAlong = (vertical ? cy - fy : cx - fx) * sign;
    if (centreAlong <= 1) continue;
    const alongGap = Math.max(
      0,
      vertical
        ? sign > 0
          ? c.top - (from.top + from.height)
          : from.top - (c.top + c.height)
        : sign > 0
          ? c.left - (from.left + from.width)
          : from.left - (c.left + c.width),
    );
    const acrossGap = vertical
      ? Math.max(0, c.left - (from.left + from.width), from.left - (c.left + c.width))
      : Math.max(0, c.top - (from.top + from.height), from.top - (c.top + c.height));
    const centreAcross = Math.abs(vertical ? cx - fx : cy - fy);
    const score = alongGap + acrossGap * 3 + centreAlong * 0.05 + centreAcross * 0.05;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Read the first connected pad, or null. */
export function readPad(nav: Navigator = navigator): PadSnapshot | null {
  const pads = nav.getGamepads?.() ?? [];
  const pad = [...pads].find((p) => p?.connected);
  if (!pad) return null;
  return { pressed: (i) => pad.buttons[i]?.pressed === true, axes: pad.axes };
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
export const PAD_FOCUS_CLASS = 'kc-pad-focus';

export interface PadNavHooks {
  /** The element holding the current screen, or null when no menu is up. */
  root(): HTMLElement | null;
  /** Start/Options: open the menu during play, or close it (as Escape does). */
  onMenu(): void;
  /** B/Circle on a screen with no Back button of its own. */
  onBack(): void;
}

/**
 * Moves focus around the current screen with the pad. Runs off its own animation frame so it
 * works before a match exists — the name screen and main menu come before `GameClient`.
 */
export class PadMenuNavigator {
  private edges = new PadEdges();
  private last = 0;
  private raf = 0;
  private lastRoot: HTMLElement | null = null;
  private lastScreen: Element | null = null;

  constructor(private readonly hooks: PadNavHooks) {}

  start(): void {
    const tick = (time: number): void => {
      const dt = this.last ? Math.min(0.1, (time - this.last) / 1000) : 0;
      this.last = time;
      this.poll(dt);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    // A mouse back in use takes the highlight away, so a pointer and a pad never both show a focus.
    window.addEventListener('mousemove', () => this.clearHighlight(), { passive: true });
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  /** One frame of navigation. Public for the browser check, which steps it with a stubbed pad. */
  poll(dt: number): void {
    const pad = readPad();
    if (!pad) {
      this.edges.reset();
      return;
    }
    const root = this.hooks.root();
    const screen = root?.firstElementChild ?? null;
    if (root !== this.lastRoot || screen !== this.lastScreen) {
      // A new screen: what is held now opened it, and must not act on it too.
      this.lastRoot = root;
      this.lastScreen = screen;
      this.edges.absorb(pad);
      if (root) this.focusDefault(root);
      return;
    }
    for (const action of this.edges.update(pad, dt)) {
      markInput('pad');
      this.act(action, root);
    }
  }

  private act(action: PadAction, root: HTMLElement | null): void {
    if (action === 'menu') {
      this.hooks.onMenu();
      return;
    }
    if (!root) return;
    const focused = this.focusedIn(root);
    if (!focused) {
      this.focusDefault(root);
      return;
    }
    if (action === 'confirm') {
      focused.click();
      return;
    }
    if (action === 'back') {
      const back = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent?.trim() === 'Back' && visible(b),
      );
      if (back) back.click();
      else this.hooks.onBack();
      return;
    }
    if ((action === 'left' || action === 'right') && adjust(focused, action === 'right' ? 1 : -1)) return;
    const controls = this.controls(root);
    const next = pickNext(focused.getBoundingClientRect(), controls.map((c) => c.getBoundingClientRect()), action);
    if (next >= 0) this.focus(controls[next]);
  }

  /**
   * Labels of the controls on the current screen the D-pad cannot reach from the focused one (or
   * the default), walking the same `pickNext` graph `act` does. For `check:pad`; reads only.
   */
  unreachable(): string[] {
    const root = this.hooks.root();
    if (!root) return [];
    const controls = this.controls(root);
    const rects = controls.map((c) => c.getBoundingClientRect());
    const start = this.focusedIn(root) ?? controls.find((c) => c.classList.contains('kc-btn--primary')) ?? controls[0];
    if (!start) return [];
    const seen = new Set([controls.indexOf(start)]);
    const queue = [controls.indexOf(start)];
    while (queue.length) {
      const at = queue.shift() as number;
      for (const dir of DIRECTIONS) {
        const next = pickNext(rects[at], rects, dir);
        if (next >= 0 && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return controls
      .filter((_, i) => !seen.has(i))
      .map((c) => (c.textContent?.trim() || c.getAttribute('aria-label') || c.tagName).slice(0, 40));
  }

  private controls(root: HTMLElement): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
  }

  private focusedIn(root: HTMLElement): HTMLElement | null {
    const active = document.activeElement;
    return active instanceof HTMLElement && root.contains(active) && visible(active) ? active : null;
  }

  private focusDefault(root: HTMLElement): void {
    const controls = this.controls(root);
    const primary = controls.find((c) => c.classList.contains('kc-btn--primary'));
    const first = primary ?? controls[0];
    if (first) this.focus(first);
  }

  private focus(target: HTMLElement): void {
    this.clearHighlight();
    target.classList.add(PAD_FOCUS_CLASS);
    target.focus({ preventScroll: false });
    target.scrollIntoView?.({ block: 'nearest' });
  }

  private clearHighlight(): void {
    for (const el of document.querySelectorAll(`.${PAD_FOCUS_CLASS}`)) el.classList.remove(PAD_FOCUS_CLASS);
  }
}

function visible(el: HTMLElement): boolean {
  return el.offsetParent !== null || el.getClientRects().length > 0;
}

/** Left/right on a slider or a drop-down changes its value; returns whether it did. */
function adjust(el: HTMLElement, step: 1 | -1): boolean {
  if (el instanceof HTMLInputElement && el.type === 'range') {
    if (step > 0) el.stepUp();
    else el.stepDown();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (el instanceof HTMLSelectElement && el.options.length > 0) {
    el.selectedIndex = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + step));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  return false;
}
