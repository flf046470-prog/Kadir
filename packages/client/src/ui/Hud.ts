import { GADGET_SLOTS, getGadget } from '@kc/core';
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
  /** Buy a gadget from the in-round shop. */
  onBuy?(gadgetId: string): void;
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
  /**
   * The gadget strip: round cash, the three slots, and any status effect running.
   *
   * The gadgets were fully simulated and bound to keys long before anything drew them, so a
   * player pressing F fired whichever slot happened to be selected, at a target they could not
   * see the cooldown for, holding cash they had no way to know about. A tool you cannot see the
   * state of is a tool you cannot use deliberately.
   */
  private gadgetBar: HTMLElement;
  /**
   * The in-round shop.
   *
   * Modes like The Hunt hand survivors cash and expect them to spend it mid-round. Every part of
   * that existed — the mode prices the stock, the server routes the buy, all three input layers
   * report the button — except a way to see the list, so the cash simply accumulated.
   */
  private shopPanel: HTMLElement;
  private shopOpen = false;
  private shopStock: { id: string; name: string; cost: number }[] = [];
  private cash = 0;
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
    this.gadgetBar = el('div', { class: 'kc-gadgets kc-hidden' });
    this.shopPanel = el('div', { class: 'kc-shop kc-hidden' });

    this.element = el(
      'div',
      { class: 'kc-hud' },
      el('div', { class: 'kc-hud-top' }, this.headline, this.timer, this.role),
      this.scores,
      this.status,
      this.chat.element,
      this.toast,
      el('div', { class: 'kc-charge' }, this.chargeFill),
      this.gadgetBar,
      this.shopPanel,
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
      this.cash = local.gadgets.cash;
      this.updateGadgets(local);
      if (this.shopOpen) this.renderShop();
    }
  }

  /**
   * Draw the gadget strip, or hide it in modes that have no gadgets at all.
   *
   * Everything here comes from the local player's own state, which the HUD is already handed —
   * no protocol change was needed to show any of it. It simply was never drawn.
   */
  private updateGadgets(local: PlayerState): void {
    const g = local.gadgets;
    const carrying = g.slots.some((id) => id !== null);
    const status = statusLabel(g);
    if (!carrying && g.cash === 0 && g.armour === 0 && !status) {
      this.gadgetBar.classList.add('kc-hidden');
      return;
    }
    this.gadgetBar.classList.remove('kc-hidden');
    clear(this.gadgetBar);

    if (g.cash > 0) this.gadgetBar.append(el('span', { class: 'kc-pill kc-currency' }, `🪙 ${g.cash}`));
    if (g.armour > 0) this.gadgetBar.append(el('span', { class: 'kc-pill' }, `🛡 ${Math.ceil(g.armour)}`));

    for (let i = 0; i < g.slots.length; i++) {
      const id = g.slots[i];
      if (!id) continue;
      const def = getGadget(id);
      const cooldown = g.cooldowns[id] ?? 0;
      const charges = g.charges[id];
      // A slot reads: name, then what stops you using it — the remaining cooldown if it is
      // recharging, otherwise how many uses are left. Both at once is noise.
      const detail = cooldown > 0.05 ? `${cooldown.toFixed(1)}s` : charges === undefined ? '' : `×${charges}`;
      this.gadgetBar.append(
        el(
          'span',
          {
            class: `kc-slot${i === g.selected ? ' kc-slot--on' : ''}${cooldown > 0.05 ? ' kc-slot--cooling' : ''}`,
            title: `${GADGET_SLOTS[i] ?? ''}`,
          },
          el('b', {}, def?.name ?? id),
          detail ? el('i', {}, detail) : null,
        ),
      );
    }

    if (status) this.gadgetBar.append(el('span', { class: 'kc-pill kc-pill--warn' }, status));
  }

  /** Current stock, pushed in whenever it changes. */
  setShop(stock: { id: string; name: string; cost: number }[]): void {
    this.shopStock = stock;
    if (this.shopOpen) this.renderShop();
  }

  /**
   * Open or close the shop.
   *
   * Refuses to open when there is nothing to sell, rather than showing an empty box: most modes
   * run no shop at all, and the button is on every platform's control list regardless.
   */
  toggleShop(): void {
    if (!this.shopOpen && this.shopStock.length === 0) return;
    this.shopOpen = !this.shopOpen;
    this.shopPanel.classList.toggle('kc-hidden', !this.shopOpen);
    if (this.shopOpen) this.renderShop();
  }

  get shopIsOpen(): boolean {
    return this.shopOpen;
  }

  private renderShop(): void {
    clear(this.shopPanel);
    this.shopPanel.append(el('div', { class: 'kc-shop-head' }, el('span', {}, 'Shop'), el('span', {}, `🪙 ${this.cash}`)));
    for (const item of this.shopStock) {
      const affordable = this.cash >= item.cost;
      const row = el(
        'button',
        {
          // Unaffordable rows stay visible and stay disabled: knowing what you are saving towards
          // is the point of having cash at all.
          class: `kc-shop-row${affordable ? '' : ' kc-shop-row--poor'}`,
          disabled: !affordable,
          dataset: { ui: 'true' },
          onClick: () => this.options.onBuy?.(item.id),
        },
        el('span', {}, item.name),
        el('b', {}, `🪙 ${item.cost}`),
      );
      this.shopPanel.append(row);
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

/** The one status effect worth shouting about, longest-lasting first. */
function statusLabel(g: PlayerState['gadgets']): string {
  if (g.frozen > 0) return `FROZEN ${g.frozen.toFixed(1)}s`;
  if (g.snared > 0) return `SNARED ${g.snared.toFixed(1)}s`;
  if (g.smoked > 0) return 'BLINDED';
  if (g.revealed > 0) return 'REVEALED';
  return '';
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 7)}…` : id;
}
