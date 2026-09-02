import { el } from './dom.js';

export type ChatChannel = 'room' | 'team';

export interface ChatLine {
  name: string;
  text: string;
  channel: 'room' | 'team' | 'system';
  /** Set for the local player's own lines, so they read differently. */
  own?: boolean;
}

export interface ChatPanelOptions {
  send(text: string, channel: ChatChannel): void;
  /** Called whenever the composer opens or closes, so movement input can be released. */
  onFocusChange(focused: boolean): void;
}

/** How many lines are kept. Older ones are dropped rather than scrolled to. */
const HISTORY = 60;
/** How long a line stays visible after the composer closes. */
const FADE_SECONDS = 12;

/**
 * In-match chat.
 *
 * Two states, and the distinction is the whole design: **closed**, where recent lines fade over
 * the corner of the screen and every key still drives the kangaroo, and **open**, where a text
 * field has focus and the game must stop reading the keyboard. Getting that wrong means a player
 * types "hey" and hops three times, which is the single most common way in-game chat is broken.
 *
 * The panel never decides whether a message is acceptable. It sends what was typed and renders
 * what comes back; the server's `ChatGuard` is the only thing that filters, rate-limits or
 * refuses, and a rejection arrives here as an ordinary system line addressed only to the sender.
 */
export class ChatPanel {
  readonly element: HTMLElement;

  private log: HTMLElement;
  private form: HTMLFormElement;
  private input: HTMLInputElement;
  private channelButton: HTMLButtonElement;
  private lines: { node: HTMLElement; timer: ReturnType<typeof setTimeout> | null }[] = [];
  private channel: ChatChannel = 'room';
  private open = false;
  private options: ChatPanelOptions;

  constructor(options: ChatPanelOptions) {
    this.options = options;
    this.log = el('div', { class: 'kc-chat-log' });

    this.input = el('input', {
      class: 'kc-chat-input',
      type: 'text',
      maxLength: 140,
      placeholder: 'Say something…',
      autocomplete: 'off',
      // Stops a phone keyboard from "helpfully" capitalising and correcting player names.
      autocapitalize: 'off',
    }) as HTMLInputElement;
    // Set after construction: these two are typed as booleans on HTMLInputElement, and the
    // attribute helper only writes strings.
    this.input.spellcheck = false;

    this.channelButton = el('button', { class: 'kc-chat-channel', type: 'button' }, 'ALL') as HTMLButtonElement;
    this.channelButton.addEventListener('click', () => this.toggleChannel());

    this.form = el('form', { class: 'kc-chat-form' }, this.channelButton, this.input) as HTMLFormElement;
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submit();
    });

    // Keys typed into the composer must never reach the game. Stopping propagation on the input
    // is what separates "typing" from "playing" — the platform input layer listens on the window.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      this.input.addEventListener(type, (event) => {
        event.stopPropagation();
        if (type === 'keydown' && (event as KeyboardEvent).key === 'Escape') this.close();
      });
    }

    this.element = el('div', { class: 'kc-chat', dataset: { open: 'false', ui: 'true' } }, this.log, this.form);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Open the composer and take the keyboard. */
  focus(): void {
    if (this.open) return;
    this.open = true;
    this.element.dataset.open = 'true';
    this.holdVisible();
    this.input.focus();
    this.options.onFocusChange(true);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.element.dataset.open = 'false';
    for (const line of this.lines) this.armFade(line);
    this.input.blur();
    this.options.onFocusChange(false);
  }

  toggle(): void {
    if (this.open) this.close();
    else this.focus();
  }

  private toggleChannel(): void {
    this.channel = this.channel === 'room' ? 'team' : 'room';
    this.channelButton.textContent = this.channel === 'room' ? 'ALL' : 'TEAM';
    // Focus returns to the field: changing channel is part of composing, not a detour out of it.
    if (this.open) this.input.focus();
  }

  private submit(): void {
    const text = this.input.value.trim();
    this.input.value = '';
    if (text) this.options.send(text, this.channel);
    // Closed on send rather than left open, so the next key goes back to the game. A player who
    // wants to keep talking presses Enter again, which is one keystroke either way.
    this.close();
  }

  /** Add a line. `system` lines are local — a rejection notice, a round announcement. */
  push(line: ChatLine): void {
    const node = el(
      'div',
      { class: `kc-chat-line kc-chat-line--${line.channel}${line.own ? ' kc-chat-line--own' : ''}` },
      line.channel === 'system' ? null : el('b', {}, `${line.name}: `),
      el('span', {}, line.text),
    );
    this.log.append(node);
    const entry: { node: HTMLElement; timer: ReturnType<typeof setTimeout> | null } = { node, timer: null };
    this.lines.push(entry);
    if (!this.open) this.armFade(entry);

    while (this.lines.length > HISTORY) {
      const dropped = this.lines.shift();
      if (dropped?.timer) clearTimeout(dropped.timer);
      dropped?.node.remove();
    }
    this.log.scrollTop = this.log.scrollHeight;
  }

  /**
   * Fade a line out after a while.
   *
   * A timer plus a CSS transition rather than a per-frame opacity write: the panel would
   * otherwise need a hook into the render loop to do nothing for eleven seconds out of twelve.
   */
  private armFade(entry: { node: HTMLElement; timer: ReturnType<typeof setTimeout> | null }): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.node.style.opacity = '0';
      entry.timer = null;
    }, FADE_SECONDS * 1000);
  }

  /** Everything visible while the composer is open — reading is why it is open. */
  private holdVisible(): void {
    for (const line of this.lines) {
      if (line.timer) clearTimeout(line.timer);
      line.timer = null;
      line.node.style.opacity = '1';
    }
  }

  clear(): void {
    for (const line of this.lines) {
      if (line.timer) clearTimeout(line.timer);
      line.node.remove();
    }
    this.lines = [];
  }
}
