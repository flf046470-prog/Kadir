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
  /** Say whether this player is ready. Absent where there is no server to tell. */
  onReady?(ready: boolean): void;
  /**
   * A panel that needs the mouse cursor opened or closed.
   *
   * Desktop holds pointer lock for the whole match, and under pointer lock there is no cursor:
   * every mouse event goes to the lock target, so a panel drawn over the canvas cannot be clicked
   * at all. Measured with a real browser-level click at the button's own coordinates — zero of
   * them reached the handler while locked, and the identical click landed the moment the lock was
   * released. That silently made the in-round shop unusable on desktop for its whole life: the
   * button opened it, the rows rendered, the prices were right, and nothing could be bought.
   */
  onCursorNeeded?(needed: boolean): void;
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
  /** Population by role, for modes where the balance is the score. */
  private tally: HTMLElement;
  /** The local player's fight: opponent and clock. */
  private bout: HTMLElement;
  private timer: HTMLElement;
  private role: HTMLElement;
  private scores: HTMLElement;
  private status: HTMLElement;
  /**
   * Whether the room can hear you, on screen, at all times.
   *
   * Not decoration. Push-to-talk and an open mic both leave a player guessing about the one thing
   * they cannot check for themselves, and the guess that costs something is always the same
   * direction — believing you are muted when you are not.
   */
  private micPill: HTMLElement;
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
  /**
   * The lobby: who is in this room, and who has pressed Ready.
   *
   * A room code on its own is only half of sharing a game. The host reads out four characters and
   * then both people stare at a status line that says "2 players", with no way to tell whether the
   * second one is the friend they invited or a stranger matchmaking dropped in — and no way at all
   * to say "I'm here, go". The server already stored a `ready` flag per client and had done since
   * the protocol was written; nothing read it, nothing sent it, and no screen could show it.
   */
  private lobbyPanel: HTMLElement;
  private lobbyOpen = false;
  private lobbyPlayers: { id: string; name: string; animalId: string; ready: boolean }[] = [];
  private lobbyCode = '';
  private lobbyPrivate = false;
  private lobbyReady = false;
  private lobbyButton: HTMLButtonElement;
  private shopStock: { id: string; name: string; cost: number }[] = [];
  private cash = 0;
  private touchLayer: HTMLElement | null = null;
  private stick: HTMLElement | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private options: HudOptions;

  constructor(options: HudOptions) {
    this.options = options;
    this.headline = el('div', { class: 'kc-headline' }, '');
    // Hidden until a mode publishes one. `el` sets no display, so `hidden` is what keeps these out
    // of the layout in every mode that is not a duel.
    this.tally = el('div', { class: 'kc-tally' });
    this.tally.hidden = true;
    this.bout = el('div', { class: 'kc-bout' });
    this.bout.hidden = true;
    this.timer = el('div', { class: 'kc-timer' }, '');
    this.role = el('div', { class: 'kc-role kc-role--other' }, '');
    this.scores = el('div', { class: 'kc-scores' });
    this.status = el('div', { class: 'kc-status' }, '');
    this.micPill = el('div', { class: 'kc-mic-pill', hidden: true }, '🎙');
    this.chat = new ChatPanel({
      send: (text, channel) => options.onChat?.(text, channel),
      onFocusChange: (focused) => options.onChatFocus?.(focused),
    });
    this.toast = el('div', { class: 'kc-toast kc-hidden' }, '');
    this.chargeFill = el('i');
    this.gadgetBar = el('div', { class: 'kc-gadgets kc-hidden' });
    // `data-ui` on the panel, not just on its rows: a thumb landing on the padding or the header
    // would otherwise fall through to the movement layer and start steering the player mid-purchase.
    this.shopPanel = el('div', { class: 'kc-shop kc-hidden', dataset: { ui: 'true' } });
    this.lobbyPanel = el('div', { class: 'kc-lobby kc-hidden', dataset: { ui: 'true' } });
    this.lobbyButton = el(
      'button',
      {
        class: 'kc-btn kc-btn--ghost kc-hidden',
        onClick: () => this.toggleLobby(),
        dataset: { ui: 'true' },
      },
      'Players',
    );

    this.element = el(
      'div',
      { class: 'kc-hud' },
      /**
       * One centre column, not three things racing for the same pixels.
       *
       * The headline, clock, role badge and tally, the bout panel and the toast were each
       * positioned independently — the first group in normal flow near the top, the bout panel at
       * `top: 24%`, the toast at `top: 22%`. On a 560x360 window that puts all three inside ten
       * pixels of each other, and a screenshot of a real bout showed exactly that: "KANGAROO 1"
       * behind "FIGHT · Bounce" behind a "Hit!" toast, none of them readable.
       *
       * Percentages were never going to fix it. The top group's height is content-driven and
       * measured in pixels — it grows when a mode publishes a tally — so any percentage that
       * clears it on one screen overlaps it on another. Stacking them in a single flex column
       * hands the problem to the layout engine, which cannot overlap siblings in flow.
       */
      el(
        'div',
        { class: 'kc-hud-centre' },
        el('div', { class: 'kc-hud-top' }, this.headline, this.timer, this.role, this.tally),
        this.bout,
        this.toast,
      ),
      this.scores,
      this.status,
      this.chat.element,
      el('div', { class: 'kc-charge' }, this.chargeFill),
      this.gadgetBar,
      this.shopPanel,
      this.lobbyPanel,
      el(
        'div',
        { class: 'kc-topbar' },
        el('button', { class: 'kc-btn kc-btn--ghost', onClick: () => options.onMenu(), dataset: { ui: 'true' } }, 'Menu'),
        // Hidden until a room broadcast arrives, so solo practice — which has no lobby — does not
        // show a button that opens an empty panel.
        this.lobbyButton,
        this.micPill,
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
        input.setButton(key, value);
        node.dataset.active = String(value);
      };
      node.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        set(true);
        // Capture keeps the release ours when the thumb slides off the button, but it is allowed
        // to fail (no active pointer for that id) and a press must never be lost to that.
        try {
          node.setPointerCapture(event.pointerId);
        } catch {
          /* the button still releases on pointerup or pointerleave */
        }
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

    this.updateTally(state);
    this.updateBout(state);

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
    this.syncCursor();
  }

  get shopIsOpen(): boolean {
    return this.shopOpen;
  }

  /**
   * The room changed. Keeps the panel live while it is open.
   *
   * The Players button appears only once a room broadcast has arrived, so solo practice — which
   * has no room and no lobby — never shows a control that opens an empty box.
   */
  setLobby(code: string, isPrivate: boolean, players: { id: string; name: string; animalId: string; ready: boolean }[]): void {
    this.lobbyCode = code;
    this.lobbyPrivate = isPrivate;
    this.lobbyPlayers = players;
    // The server is the authority on who is ready, including about this player: a local flag that
    // disagreed with the broadcast would let the button lie after a dropped message.
    this.lobbyReady = players.find((p) => p.id === this.options.localId)?.ready ?? this.lobbyReady;
    this.lobbyButton.classList.remove('kc-hidden');
    this.lobbyButton.textContent = `Players ${players.length}`;
    if (this.lobbyOpen) this.renderLobby();
  }

  /**
   * Open or close the player list.
   *
   * Refuses to open when there is no room, the way the shop refuses to open with nothing to sell.
   * Solo practice has no lobby at all, and the empty panel it used to show read as a real one: a
   * box headed "Room · public · 0/0 ready", no players under it, and an "I'm ready" button that
   * did nothing because `setReady` returns early with no connection. Caught by looking at a
   * screenshot of it — the Players button was correctly hidden, and Tab opened it anyway.
   */
  toggleLobby(): void {
    if (!this.lobbyOpen && this.lobbyPlayers.length === 0) return;
    this.lobbyOpen = !this.lobbyOpen;
    this.lobbyPanel.classList.toggle('kc-hidden', !this.lobbyOpen);
    if (this.lobbyOpen) this.renderLobby();
    this.syncCursor();
  }

  /**
   * Ask for the cursor while any pointer-driven panel is open, and give it back when none is.
   *
   * Asked as one combined state rather than per panel, because two panels can be open at once and
   * closing one must not take the cursor away from the other.
   */
  private syncCursor(): void {
    this.options.onCursorNeeded?.(this.shopOpen || this.lobbyOpen);
  }

  get lobbyIsOpen(): boolean {
    return this.lobbyOpen;
  }

  private renderLobby(): void {
    clear(this.lobbyPanel);
    const readyCount = this.lobbyPlayers.filter((p) => p.ready).length;
    this.lobbyPanel.append(
      el(
        'div',
        { class: 'kc-lobby-head' },
        el('strong', {}, this.lobbyCode || 'Room'),
        el('span', { class: 'kc-pill' }, this.lobbyPrivate ? 'private' : 'public'),
        el('span', { class: 'kc-lobby-count' }, `${readyCount}/${this.lobbyPlayers.length} ready`),
        el(
          'button',
          { class: 'kc-shop-close', dataset: { ui: 'true' }, ariaLabel: 'Close players', onClick: () => this.toggleLobby() },
          '✕',
        ),
      ),
    );

    for (const player of this.lobbyPlayers) {
      const you = player.id === this.options.localId;
      this.lobbyPanel.append(
        el(
          'div',
          { class: `kc-lobby-row${player.ready ? ' kc-lobby-row--ready' : ''}` },
          el('span', { class: 'kc-lobby-tick' }, player.ready ? '✓' : '·'),
          el('span', { class: 'kc-lobby-name' }, you ? `${player.name} (you)` : player.name),
          el('span', { class: 'kc-lobby-animal' }, player.animalId),
        ),
      );
    }

    if (this.options.onReady) {
      this.lobbyPanel.append(
        el(
          'button',
          {
            class: `kc-btn ${this.lobbyReady ? 'kc-btn--ghost' : 'kc-btn--primary'}`,
            dataset: { ui: 'true' },
            onClick: () => {
              // Sent, then re-rendered from the echo. The button reflects what the server agreed
              // to rather than what was clicked, so a lost message shows as an unchanged button
              // instead of a tick nobody else can see.
              this.lobbyReady = !this.lobbyReady;
              this.options.onReady?.(this.lobbyReady);
              this.renderLobby();
            },
          },
          this.lobbyReady ? "Not ready" : "I'm ready",
        ),
      );
    }
  }

  private renderShop(): void {
    clear(this.shopPanel);
    // The close button is not a convenience. On a landscape phone the panel can sit over the
    // gear cluster, so the button that opened the shop is the one it covers — without an exit of
    // its own the player would be stuck looking at a price list.
    this.shopPanel.append(
      el(
        'div',
        { class: 'kc-shop-head' },
        el('span', {}, 'Shop'),
        el('span', {}, `🪙 ${this.cash}`),
        el('button', { class: 'kc-shop-close', dataset: { ui: 'true' }, ariaLabel: 'Close shop', onClick: () => this.toggleShop() }, '✕'),
      ),
    );
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

  /**
   * Show what the microphone is doing.
   *
   * Three states, because the fourth — voice off entirely — is not worth a permanent badge and
   * hides the pill instead. Live is the one that has to be unmissable; a muted pill is a
   * reassurance, and a live pill is a warning, so only one of them animates.
   */
  setMicState(enabled: boolean, open: boolean, muted: boolean): void {
    this.micPill.hidden = !enabled;
    if (!enabled) return;
    this.micPill.classList.toggle('is-live', open && !muted);
    this.micPill.classList.toggle('is-muted', muted);
    this.micPill.textContent = muted ? '🔇' : '🎙';
    this.micPill.title = muted ? 'Microphone muted' : open ? 'Live — the room can hear you' : 'Microphone idle';
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

  /**
   * How many players are on each side.
   *
   * Conversion Duel swings its population back and forth all round as bouts resolve, and the
   * headline cannot carry it: the instant a catch happens the headline becomes "X caught Y!" and
   * what everyone is playing for leaves the screen. Fighters are counted separately rather than
   * folded into a side, because for the twenty seconds of a bout they are on neither.
   */
  private updateTally(state: ModeStateView): void {
    const tally = state.tally;
    if (!tally) {
      this.tally.hidden = true;
      return;
    }
    this.tally.hidden = false;
    clear(this.tally);
    for (const [role, label] of [['chaser', 'KANGAROO'], ['runner', 'HUMAN'], ['fighter', 'IN THE RING']] as const) {
      const count = tally[role] ?? 0;
      if (count === 0 && role === 'fighter') continue;
      this.tally.append(
        el('span', { class: `kc-tally-item kc-tally--${role}` }, `${label} ${count}`),
      );
    }
  }

  /**
   * The local player's fight.
   *
   * A catch in Conversion Duel starts a twenty-second boxing match, and until this existed the
   * client was told nothing about it: the mode emitted a `roundState` event announcing the bout
   * and no handler anywhere matched it. Two players were pulled a metre and a half apart with no
   * opponent name, no clock, and no indication that the teleport was a fight rather than a bug.
   *
   * Only the local player's bout is shown. The view broadcasts every running bout because it is
   * sent to the whole room, but a player fighting for their species does not need a list of other
   * people's fights on top of their own.
   */
  private updateBout(state: ModeStateView): void {
    const mine = state.bouts?.find((b) => b.a === this.options.localId || b.b === this.options.localId);
    if (!mine) {
      this.bout.hidden = true;
      return;
    }
    const opponent = mine.a === this.options.localId ? mine.bName : mine.aName;
    this.bout.hidden = false;
    clear(this.bout);
    this.bout.append(
      el('span', { class: 'kc-bout-label' }, `FIGHT · ${opponent}`),
      el('span', { class: 'kc-bout-clock' }, mine.remaining.toFixed(1)),
    );
  }

  /** Translate a gameplay event the local player is involved in into feedback. */
  handleEvent(event: SimEvent, localId: string): void {
    switch (event.type) {
      case 'tag':
        this.showToast(event.otherId === localId ? "You're IT!" : 'Tagged them!');
        break;
      case 'roleChange': {
        // Conversion Duel sends `converted:<species>` here rather than a bare role, so the label
        // lookup fell through to "WARM-UP" and told a player who had just lost a fight for their
        // species that they were now warming up.
        const data = String(event.data);
        if (data.startsWith('converted:')) {
          const species = data.slice('converted:'.length);
          this.showToast(
            event.playerId === localId
              ? `You have been converted — you are a ${species} now`
              : `Converted to ${species}`,
            2600,
          );
        } else if (event.playerId === localId) {
          this.showToast(`You are now ${roleLabel(data)}`);
        }
        break;
      }
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
