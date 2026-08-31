import type { ModeStateView, PlayerState, SimEvent } from '@kc/core';
import { clear, el, formatTime } from './dom.js';
import type { MobileButtonState, MobileInput } from '../platform/mobile/MobileInput.js';
import { ChatPanel } from './ChatPanel.js';

export interface HudOptions {
  root: HTMLElement;
  platform: 'pc' | 'mobile' | 'vr';
  localId: string;
  onMenu(): void;
  onEmote(): void;
  /** Send a chat line. Absent in contexts with no server to send it to. */
  onChat?(text: string, channel: 'room' | 'team'): void;
  /**
   * The composer took or released the keyboard.
   *
   * The game must stop reading keys while it has focus, or typing "hey" hops three times — the
   * single most common way in-game chat is broken.
   */
  onChatFocus?(focused: boolean): void;
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
  private chat: ChatPanel;
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
    this.chat = new ChatPanel({
      send: (text, channel) => options.onChat?.(text, channel),
      onFocusChange: (focused) => options.onChatFocus?.(focused),
    });
    this.toast = el('div', { class: 'kc-toast kc-hidden' }, '');
    this.chargeFill = el('i');

    this.element = el(
      'div',
      { class: 'kc-hud' },
      el('div', { class: 'kc-hud-top' }, this.headline, this.timer, this.role),
      this.scores,
      this.status,
      this.chat.element,
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

    const makeButton = (label: string, key: keyof MobileButtonState, big = false): HTMLElement => {
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
      // Second cluster, top-right: the equipment controls. Kept apart from the movement pad so a
      // thumb reaching for HOP mid-chase cannot fire a freeze gun by accident.
      el(
        'div',
        { class: 'kc-touchbtns kc-touchbtns--gear' },
        makeButton('🎙', 'talk'),
        // Not a MobileButtonState key: this opens a text field rather than pressing a game
        // button, so it is a plain tap handler.
        (() => {
          const node = el('div', { class: 'kc-touchbtn', dataset: { ui: 'true' } }, '💬');
          node.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            this.chat.toggle();
          });
          return node;
        })(),
        makeButton('SHOP', 'shop'),
        makeButton('NEXT', 'cycle'),
        makeButton('FIRE', 'gadget', true),
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

  pushChat(name: string, text: string, channel: 'room' | 'team' | 'system' = 'room', own = false): void {
    this.chat.push({ name, text, channel, own });
  }

  /** Open or close the composer. Bound to Enter on PC and to a button on touch. */
  toggleChat(): void {
    this.chat.toggle();
  }

  get chatFocused(): boolean {
    return this.chat.isOpen;
  }

  clearChat(): void {
    this.chat.clear();
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
