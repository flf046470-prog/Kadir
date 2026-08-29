import type { ModeStateView, PlayerState, SimEvent } from '@kc/core';
import { clear, el, formatTime } from './dom.js';
import type { MobileInput } from '../platform/mobile/MobileInput.js';

export interface HudOptions {
  root: HTMLElement;
  platform: 'pc' | 'mobile' | 'vr';
  localId: string;
  onMenu(): void;
  onEmote(): void;
}

/**
 * In-match overlay: what you are, how long is left, who is winning, and — on touch — the
 * controls themselves. Everything else stays off screen; a chase reads better without clutter.
 */
export class Hud {
  readonly element: HTMLElement;
  private headline: HTMLElement;
  private timer: HTMLElement;
  private role: HTMLElement;
  private scores: HTMLElement;
  private status: HTMLElement;
  private chat: HTMLElement;
  private toast: HTMLElement;
  private chargeFill: HTMLElement;
  private touchLayer: HTMLElement | null = null;
  private stick: HTMLElement | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private options: HudOptions;

  constructor(options: HudOptions) {
    this.options = options;
    this.headline = el('div', { class: 'kc-headline' }, '');
    this.timer = el('div', { class: 'kc-timer' }, '');
    this.role = el('div', { class: 'kc-role kc-role--other' }, '');
    this.scores = el('div', { class: 'kc-scores' });
    this.status = el('div', { class: 'kc-status' }, '');
    this.chat = el('div', { class: 'kc-chat' });
    this.toast = el('div', { class: 'kc-toast kc-hidden' }, '');
    this.chargeFill = el('i');

    this.element = el(
      'div',
      { class: 'kc-hud' },
      el('div', { class: 'kc-hud-top' }, this.headline, this.timer, this.role),
      this.scores,
      this.status,
      this.chat,
      this.toast,
      el('div', { class: 'kc-charge' }, this.chargeFill),
      el(
        'div',
        { class: 'kc-topbar' },
        el('button', { class: 'kc-btn kc-btn--ghost', onClick: () => options.onMenu(), dataset: { ui: 'true' } }, 'Menu'),
      ),
    );
    options.root.append(this.element);
  }

  /** Touch controls live inside the HUD so they share its layout and safe-area handling. */
  attachTouchControls(input: MobileInput): void {
    if (this.options.platform !== 'mobile') return;
    this.stick = el('div', { class: 'kc-stick' }, el('i'));

    const makeButton = (label: string, key: 'jump' | 'grab' | 'interact' | 'emote' | 'punch', big = false): HTMLElement => {
      const node = el('div', {
        class: `kc-touchbtn${big ? ' kc-touchbtn--big' : ''}`,
        dataset: { ui: 'true' },
      }, label);
      const set = (value: boolean) => {
        input.buttons[key] = value;
        node.dataset.active = String(value);
      };
      node.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        node.setPointerCapture(event.pointerId);
        set(true);
      });
      node.addEventListener('pointerup', () => set(false));
      node.addEventListener('pointercancel', () => set(false));
      node.addEventListener('pointerleave', () => set(false));
      return node;
    };

    this.touchLayer = el(
      'div',
      { class: 'kc-touch' },
      this.stick,
      el(
        'div',
        { class: 'kc-touchbtns' },
        makeButton('GRAB', 'grab'),
        makeButton('HOP', 'jump', true),
        makeButton('PUNCH', 'punch'),
        makeButton('USE', 'interact'),
        makeButton('EMOTE', 'emote'),
      ),
    );
    this.element.append(this.touchLayer);

    input.onStickChange = (state) => {
      if (!this.stick) return;
      this.stick.style.opacity = state.active ? '1' : '0';
      if (!state.active) return;
      this.stick.style.left = `${state.originX}px`;
      this.stick.style.top = `${state.originY}px`;
      const knob = this.stick.firstElementChild as HTMLElement | null;
      if (knob) knob.style.transform = `translate(${state.x}px, ${state.y}px)`;
    };
  }

  update(state: ModeStateView, local: PlayerState | undefined): void {
    this.headline.textContent = state.headline;
    this.timer.textContent = state.phase === 'playing' ? formatTime(state.timeRemaining) : state.phase.toUpperCase();

    const role = local?.role ?? 'idle';
    this.role.textContent = roleLabel(role);
    this.role.className = `kc-role kc-role--${role === 'chaser' || role === 'infected' ? 'chaser' : role === 'runner' ? 'runner' : 'other'}`;

    // Short screens (landscape phones) only have room for a few rows.
    const limit = globalThis.innerHeight < 480 ? 4 : 6;
    const entries = Object.entries(state.scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
    clear(this.scores);
    for (const [id, score] of entries) {
      const name = id === this.options.localId ? 'You' : shortId(id);
      this.scores.append(el('div', {}, el('span', {}, name), el('span', {}, String(score))));
    }

    if (local) {
      this.chargeFill.style.width = `${Math.round(local.charge * 100)}%`;
      this.chargeFill.style.opacity = local.charge > 0.02 ? '1' : '0.15';
    }
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  pushChat(name: string, text: string): void {
    const line = el('span', {}, `${name}: ${text}`);
    this.chat.append(line);
    while (this.chat.childElementCount > 5) this.chat.firstElementChild?.remove();
    setTimeout(() => line.remove(), 12_000);
  }

  showToast(text: string, ms = 2200): void {
    this.toast.textContent = text;
    this.toast.classList.remove('kc-hidden');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.classList.add('kc-hidden'), ms);
  }

  /** Translate a gameplay event the local player is involved in into feedback. */
  handleEvent(event: SimEvent, localId: string): void {
    switch (event.type) {
      case 'tag':
        this.showToast(event.otherId === localId ? "You're IT!" : 'Tagged them!');
        break;
      case 'roleChange':
        if (event.playerId === localId) this.showToast(`You are now ${roleLabel(String(event.data))}`);
        break;
      case 'checkpoint':
        this.showToast(`Checkpoint ${Number(event.data) + 1}`, 1200);
        break;
      case 'lapComplete':
        this.showToast(`Finished in ${event.magnitude.toFixed(2)}s`, 3000);
        break;
      case 'punchHit':
        if (event.otherId === localId) this.showToast('Hit!', 700);
        break;
      default:
        break;
    }
  }

  setVisible(visible: boolean): void {
    this.element.classList.toggle('kc-hidden', !visible);
  }

  dispose(): void {
    this.element.remove();
  }
}

function roleLabel(role: string): string {
  switch (role) {
    case 'chaser':
      return 'CHASER';
    case 'infected':
      return 'INFECTED';
    case 'runner':
      return 'RUNNER';
    case 'racer':
      return 'RACER';
    case 'fighter':
      return 'FIGHTER';
    default:
      return 'WARM-UP';
  }
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 7)}…` : id;
}
