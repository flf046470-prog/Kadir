import { COSMETIC_SLOTS } from '@kc/core';
import type { AnimalDef, CosmeticDef, CosmeticSlot, GameModeDef, MatchResult, PlayerProfile, Settings, StoreItem } from '@kc/core';
import { button, clear, el, formatPrice } from './dom.js';
import type { Api, ContentBundle, ProfileBundle } from '../net/Api.js';

export type ScreenId = 'name' | 'menu' | 'modes' | 'room' | 'customize' | 'store' | 'settings' | 'results' | 'tutorial' | 'none';

export interface ShellCallbacks {
  onQuickPlay(modeId: string): void;
  onPractice(modeId: string): void;
  onJoinRoom(code: string): void;
  onCreatePrivate(): void;
  onAnimalChanged(animalId: string): void;
  onCosmeticsChanged(cosmetics: Record<string, string>): void;
  onSettingsChanged(settings: Settings): void;
  onNameChanged(name: string): void;
  onResume(): void;
  onLeaveMatch(): void;
  onVoiceToggle(enabled: boolean): void;
}

export interface ShellOptions {
  root: HTMLElement;
  api: Api;
  callbacks: ShellCallbacks;
  platform: 'pc' | 'mobile' | 'vr';
  controlHints: { action: string; hint: string }[];
  devPurchases: boolean;
}

/**
 * Menus for PC and Mobile (VR gets world-space panels instead — see `VRPanels`).
 *
 * One responsive layout serves both: the same markup, sized by CSS, with 44 px minimum touch
 * targets everywhere so nothing needs a mouse.
 */
export class Shell {
  readonly element: HTMLElement;
  private screen: ScreenId = 'none';
  private options: ShellOptions;
  private content: ContentBundle | null = null;
  private profile: ProfileBundle | null = null;
  private settings: Settings;
  private currentModeId = 'kangaroo-chase';
  private notice = '';
  private noticeElement: HTMLElement | null = null;

  constructor(options: ShellOptions, settings: Settings) {
    this.options = options;
    this.settings = settings;
    this.element = el('div', { class: 'kc-root' });
    options.root.append(this.element);
  }

  setContent(content: ContentBundle): void {
    this.content = content;
    if (this.screen !== 'none') this.render();
  }

  setProfile(profile: ProfileBundle): void {
    this.profile = profile;
    if (this.screen !== 'none') this.render();
  }

  setSettings(settings: Settings): void {
    this.settings = settings;
  }

  /**
   * Update the status line in place rather than re-rendering the screen. A background event
   * (reconnect, room update) must never rebuild the DOM under a player's finger mid-tap.
   */
  setNotice(text: string): void {
    if (this.notice === text) return;
    this.notice = text;
    if (this.screen === 'none') return;
    if (this.noticeElement) {
      this.noticeElement.textContent = text;
      this.noticeElement.classList.toggle('kc-hidden', text === '');
    } else {
      this.render();
    }
  }

  show(screen: ScreenId): void {
    this.screen = screen;
    this.render();
  }

  get currentScreen(): ScreenId {
    return this.screen;
  }

  private render(): void {
    clear(this.element);
    this.noticeElement = null;
    if (this.screen === 'none') return;
    switch (this.screen) {
      case 'name':
        this.element.append(this.nameScreen());
        break;
      case 'menu':
        this.element.append(this.menuScreen());
        break;
      case 'modes':
        this.element.append(this.modesScreen());
        break;
      case 'room':
        this.element.append(this.roomScreen());
        break;
      case 'customize':
        this.element.append(this.customizeScreen());
        break;
      case 'store':
        this.element.append(this.storeScreen());
        break;
      case 'settings':
        this.element.append(this.settingsScreen());
        break;
      case 'tutorial':
        this.element.append(this.tutorialScreen());
        break;
      default:
        break;
    }
  }

  private header(title: string, subtitle?: string): HTMLElement {
    return el('div', {}, el('h1', { class: 'kc-title' }, title), subtitle ? el('p', { class: 'kc-subtitle' }, subtitle) : null);
  }

  private noticeNode(): HTMLElement {
    const node = el('p', { class: `kc-note${this.notice ? '' : ' kc-hidden'}` }, this.notice);
    this.noticeElement = node;
    return node;
  }

  private nameScreen(): HTMLElement {
    const input = el('input', { type: 'text', value: '', placeholder: 'Your name', maxLength: 16 }) as HTMLInputElement;
    const submit = (): void => {
      const name = input.value.trim() || 'Roo';
      this.options.callbacks.onNameChanged(name);
    };
    input.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') submit();
    });

    return el(
      'div',
      { class: 'kc-screen' },
      this.header('Kangaroo Chase', 'Hop, climb, chase. Pick a name to get started.'),
      el('div', { class: 'kc-panel' }, el('div', { class: 'kc-field' }, el('span', {}, 'Name'), input), button('Start', submit, 'primary')),
      this.noticeNode(),
    );
  }

  private menuScreen(): HTMLElement {
    const coins = this.profile?.profile.coins ?? 0;
    const level = this.profile?.profile.level ?? 1;
    const claimable = this.profile?.daily.some((d) => d.claimable) ?? false;

    return el(
      'div',
      { class: 'kc-screen' },
      this.header('Kangaroo Chase'),
      el(
        'div',
        { class: 'kc-row' },
        el('span', { class: 'kc-pill kc-currency' }, `🪙 ${coins}`),
        el('span', { class: 'kc-pill' }, `Lv ${level}`),
        claimable ? button('Claim daily reward', () => void this.claimDaily(), 'primary') : null,
      ),
      el(
        'div',
        { class: 'kc-menu' },
        button('Play', () => this.options.callbacks.onQuickPlay(this.currentModeId), 'primary'),
        button('Game modes', () => this.show('modes')),
        button('Private room', () => this.show('room')),
        button('Customise', () => this.show('customize')),
        button('Store', () => this.show('store')),
        button('Settings', () => this.show('settings')),
        button('How to play', () => this.show('tutorial')),
        button('Practice with bots', () => this.options.callbacks.onPractice(this.currentModeId)),
      ),
      this.noticeNode(),
      el('p', { class: 'kc-note' }, 'No loot boxes. No pay-to-win. Every animal moves exactly the same.'),
    );
  }

  private modesScreen(): HTMLElement {
    const modes = this.content?.modes ?? [];
    const grid = el('div', { class: 'kc-grid' });
    for (const mode of modes) {
      grid.append(this.modeCard(mode));
    }
    return el('div', { class: 'kc-screen' }, this.header('Game modes'), grid, button('Back', () => this.show('menu')));
  }

  private modeCard(mode: GameModeDef): HTMLElement {
    const selected = mode.id === this.currentModeId;
    return el(
      'div',
      { class: `kc-card${selected ? ' kc-card--selected' : ''}` },
      el('h3', {}, mode.name),
      el('p', {}, mode.description),
      el('span', { class: 'kc-tag' }, `${mode.minPlayers}-${mode.maxPlayers} players · ${Math.round(mode.roundSeconds / 60)} min`),
      button(selected ? 'Play now' : 'Select', () => {
        this.currentModeId = mode.id;
        if (selected) this.options.callbacks.onQuickPlay(mode.id);
        else this.render();
      }, selected ? 'primary' : 'ghost'),
    );
  }

  private roomScreen(): HTMLElement {
    const input = el('input', { type: 'text', placeholder: 'KANG-1234', maxLength: 9 }) as HTMLInputElement;
    input.addEventListener('input', () => {
      const cleaned = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      input.value = cleaned.length > 4 ? `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}` : cleaned;
    });

    return el(
      'div',
      { class: 'kc-screen' },
      this.header('Private room', 'Play with friends only. Share the code and they can hop straight in.'),
      el(
        'div',
        { class: 'kc-panel' },
        el('div', { class: 'kc-field' }, el('span', {}, 'Room code'), input),
        button('Join room', () => this.options.callbacks.onJoinRoom(input.value.trim()), 'primary'),
        el('hr', { style: { opacity: '0.15', width: '100%' } }),
        button('Create a private room', () => this.options.callbacks.onCreatePrivate()),
      ),
      this.noticeNode(),
      button('Back', () => this.show('menu')),
    );
  }

  private customizeScreen(): HTMLElement {
    const profile = this.profile?.profile;
    const animals = this.content?.animals ?? [];
    const grid = el('div', { class: 'kc-grid' });

    for (const animal of animals) {
      grid.append(this.animalCard(animal, profile));
    }

    const slotRow = el('div', { class: 'kc-row' });
    for (const slot of COSMETIC_SLOTS) {
      slotRow.append(button(slot, () => this.showCosmeticSlot(slot)));
    }

    return el(
      'div',
      { class: 'kc-screen' },
      this.header('Customise'),
      el('p', { class: 'kc-subtitle' }, 'Animals and cosmetics are looks only — they never change how you move.'),
      grid,
      el('h3', {}, 'Cosmetics'),
      slotRow,
      el('div', { id: 'kc-cosmetic-list', class: 'kc-grid' }),
      button('Back', () => this.show('menu')),
    );
  }

  private animalCard(animal: AnimalDef, profile: PlayerProfile | undefined): HTMLElement {
    const owned = profile?.ownedAnimals.includes(animal.id) ?? animal.unlock === 'free';
    const equipped = profile?.equipped.animalId === animal.id;
    const swatch = el('div', { class: 'kc-swatch' });
    swatch.style.background = `linear-gradient(135deg, #${animal.visual.body.toString(16).padStart(6, '0')}, #${animal.visual.accent
      .toString(16)
      .padStart(6, '0')})`;

    return el(
      'div',
      { class: `kc-card${equipped ? ' kc-card--selected' : ''}` },
      swatch,
      el('h3', {}, animal.name),
      el('p', {}, animal.description),
      owned
        ? button(equipped ? 'Equipped' : 'Equip', () => void this.equipAnimal(animal.id), equipped ? 'primary' : 'ghost')
        : button(`Unlock ${formatPrice(animal.priceCents)}`, () => this.show('store')),
    );
  }

  private showCosmeticSlot(slot: CosmeticSlot): void {
    const list = this.element.querySelector('#kc-cosmetic-list') as HTMLElement | null;
    if (!list) return;
    clear(list);

    const owned = this.profile?.profile.ownedCosmetics ?? [];
    const equipped = this.profile?.profile.equipped.cosmetics ?? {};
    const items = (this.content?.cosmetics ?? []).filter((c) => c.slot === slot);

    list.append(
      el('div', { class: 'kc-card' }, el('h3', {}, 'None'), button('Clear slot', () => void this.equipCosmetic(slot, null))),
    );
    for (const cosmetic of items) {
      list.append(this.cosmeticCard(cosmetic, owned.includes(cosmetic.id), equipped[slot] === cosmetic.id));
    }
  }

  private cosmeticCard(cosmetic: CosmeticDef, owned: boolean, equipped: boolean): HTMLElement {
    const swatch = el('div', { class: 'kc-swatch' });
    swatch.style.background = `#${cosmetic.visual.color.toString(16).padStart(6, '0')}`;
    return el(
      'div',
      { class: `kc-card${equipped ? ' kc-card--selected' : ''}` },
      swatch,
      el('h3', {}, cosmetic.name),
      el('span', { class: 'kc-tag' }, cosmetic.rarity),
      owned
        ? button(equipped ? 'Equipped' : 'Equip', () => void this.equipCosmetic(cosmetic.slot, cosmetic.id), equipped ? 'primary' : 'ghost')
        : cosmetic.priceCoins >= 0
          ? button(`🪙 ${cosmetic.priceCoins}`, () => this.show('store'))
          : button(formatPrice(cosmetic.priceCents), () => this.show('store')),
    );
  }

  private storeScreen(): HTMLElement {
    const items = this.content?.store ?? [];
    const grid = el('div', { class: 'kc-grid' });
    for (const item of items) grid.append(this.storeCard(item));

    return el(
      'div',
      { class: 'kc-screen' },
      this.header('Store', `🪙 ${this.profile?.profile.coins ?? 0} · everything here is cosmetic`),
      grid,
      el(
        'p',
        { class: 'kc-note' },
        'Fixed prices, no loot boxes, no randomised rewards. Most items can also be earned by playing.',
      ),
      this.noticeNode(),
      button('Back', () => this.show('menu')),
    );
  }

  private storeCard(item: StoreItem): HTMLElement {
    const profile = this.profile?.profile;
    const owned =
      profile !== undefined &&
      item.grants.every((id) => profile.ownedAnimals.includes(id) || profile.ownedCosmetics.includes(id));
    const canAfford = (profile?.coins ?? 0) >= item.priceCoins && item.priceCoins >= 0;

    return el(
      'div',
      { class: 'kc-card' },
      el('h3', {}, item.name),
      el('p', {}, item.description),
      item.tag ? el('span', { class: 'kc-tag' }, item.tag) : null,
      owned
        ? el('span', { class: 'kc-tag' }, 'Owned')
        : el(
            'div',
            { class: 'kc-row' },
            item.priceCoins >= 0
              ? (() => {
                  const btn = button(`🪙 ${item.priceCoins}`, () => void this.buyWithCoins(item.id));
                  btn.disabled = !canAfford;
                  return btn;
                })()
              : null,
            button(formatPrice(item.priceCents), () => void this.buyWithMoney(item.id), 'primary'),
          ),
    );
  }

  private settingsScreen(): HTMLElement {
    const s = this.settings;
    const panel = el('div', { class: 'kc-panel' });

    const slider = (label: string, value: number, min: number, max: number, step: number, apply: (v: number) => void): HTMLElement => {
      const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) }) as HTMLInputElement;
      const readout = el('span', {}, value.toFixed(2));
      input.addEventListener('input', () => {
        const v = Number.parseFloat(input.value);
        readout.textContent = v.toFixed(2);
        apply(v);
        this.options.callbacks.onSettingsChanged(this.settings);
      });
      return el('label', { class: 'kc-field' }, el('span', {}, label), input, readout);
    };

    const toggle = (label: string, value: boolean, apply: (v: boolean) => void): HTMLElement => {
      const input = el('input', { type: 'checkbox', checked: value }) as HTMLInputElement;
      input.addEventListener('change', () => {
        apply(input.checked);
        this.options.callbacks.onSettingsChanged(this.settings);
      });
      return el('label', { class: 'kc-field' }, el('span', {}, label), input);
    };

    const select = (label: string, value: string, options: string[], apply: (v: string) => void): HTMLElement => {
      const node = el('select', {}) as HTMLSelectElement;
      for (const option of options) {
        const opt = el('option', { value: option }, option);
        if (option === value) opt.selected = true;
        node.append(opt);
      }
      node.addEventListener('change', () => {
        apply(node.value);
        this.options.callbacks.onSettingsChanged(this.settings);
      });
      return el('label', { class: 'kc-field' }, el('span', {}, label), node);
    };

    panel.append(
      el('h3', {}, 'Graphics'),
      select('Quality', s.graphics.quality, ['auto', 'low', 'medium', 'high'], (v) => {
        s.graphics.quality = v as Settings['graphics']['quality'];
      }),
      toggle('Shadows', s.graphics.shadows, (v) => {
        s.graphics.shadows = v;
      }),
      slider('Render scale', s.graphics.renderScale, 0.5, 1.5, 0.05, (v) => {
        s.graphics.renderScale = v;
      }),
      slider('Draw distance', s.graphics.drawDistance, 40, 400, 10, (v) => {
        s.graphics.drawDistance = v;
      }),

      el('h3', {}, 'Audio'),
      slider('Master', s.audio.master, 0, 1, 0.05, (v) => {
        s.audio.master = v;
      }),
      slider('Effects', s.audio.sfx, 0, 1, 0.05, (v) => {
        s.audio.sfx = v;
      }),
      slider('Voice', s.audio.voice, 0, 1, 0.05, (v) => {
        s.audio.voice = v;
      }),
      toggle('Voice chat', s.voiceEnabled, (v) => {
        s.voiceEnabled = v;
        this.options.callbacks.onVoiceToggle(v);
      }),

      el('h3', {}, 'Comfort (VR)'),
      toggle('Snap turn', s.comfort.snapTurn, (v) => {
        s.comfort.snapTurn = v;
      }),
      slider('Snap angle', s.comfort.snapAngleDegrees, 15, 90, 5, (v) => {
        s.comfort.snapAngleDegrees = v;
      }),
      slider('Comfort vignette', s.comfort.vignette, 0, 1, 0.05, (v) => {
        s.comfort.vignette = v;
      }),
      slider('Height calibration (m, 0 = auto)', s.comfort.heightCalibration, 0, 2.2, 0.01, (v) => {
        s.comfort.heightCalibration = v;
      }),
      toggle('Seated mode', s.comfort.seated, (v) => {
        s.comfort.seated = v;
      }),
      select('Handedness', s.comfort.handedness, ['right', 'left'], (v) => {
        s.comfort.handedness = v as Settings['comfort']['handedness'];
      }),

      el('h3', {}, 'Controls'),
      slider('Look sensitivity', s.controls.lookSensitivity, 0.1, 4, 0.1, (v) => {
        s.controls.lookSensitivity = v;
      }),
      toggle('Invert Y', s.controls.invertY, (v) => {
        s.controls.invertY = v;
      }),
      slider('Joystick size', s.controls.joystickSize, 60, 220, 5, (v) => {
        s.controls.joystickSize = v;
      }),
      toggle('Gamepad', s.controls.gamepadEnabled, (v) => {
        s.controls.gamepadEnabled = v;
      }),

      el('h3', {}, 'Match'),
      toggle('Cross-play (mobile / PC / VR together)', s.crossPlay, (v) => {
        s.crossPlay = v;
      }),
      toggle('Reduce motion', s.reduceMotion, (v) => {
        s.reduceMotion = v;
      }),
    );

    return el('div', { class: 'kc-screen' }, this.header('Settings'), panel, button('Back', () => this.show('menu')));
  }

  private tutorialScreen(): HTMLElement {
    const list = el('div', { class: 'kc-panel' });
    for (const hint of this.options.controlHints) {
      list.append(el('div', { class: 'kc-field' }, el('span', {}, hint.action), el('strong', {}, hint.hint)));
    }
    return el(
      'div',
      { class: 'kc-screen' },
      this.header('How to play', 'Chasers tag runners. Get tagged and you become the chaser.'),
      list,
      el(
        'p',
        { class: 'kc-note' },
        this.options.platform === 'vr'
          ? 'In VR you move with your hands: grab a surface and pull, or shove off a wall. Momentum is kept when you let go.'
          : 'Hold the hop button to charge a longer jump. Hold grab near a wall, branch or rock to climb it.',
      ),
      button('Got it', () => this.show('menu'), 'primary'),
    );
  }

  /** Results overlay shown after a round. */
  showResults(result: MatchResult, rewards: Record<string, { coins: number; xp: number; achievements: string[] }>, localId: string): void {
    this.screen = 'results';
    clear(this.element);

    const table = el('table');
    table.append(
      el('tr', {}, el('th', {}, '#'), el('th', {}, 'Player'), el('th', {}, 'Score'), el('th', {}, 'Tags')),
    );
    for (const player of result.players) {
      const row = el(
        'tr',
        { class: player.playerId === localId ? 'me' : '' },
        el('td', {}, String(player.placement)),
        el('td', {}, player.name),
        el('td', {}, String(player.score)),
        el('td', {}, String(player.tags)),
      );
      table.append(row);
    }

    const reward = rewards[localId];
    this.element.append(
      el(
        'div',
        { class: 'kc-screen' },
        this.header(result.winnerIds.includes(localId) ? 'You win!' : 'Round over'),
        el('div', { class: 'kc-panel kc-results' }, table),
        reward
          ? el('p', { class: 'kc-note' }, `+${reward.coins} coins · +${reward.xp} XP${reward.achievements.length > 0 ? ` · ${reward.achievements.length} achievement(s) unlocked` : ''}`)
          : null,
        el('div', { class: 'kc-row' }, button('Play again', () => this.options.callbacks.onResume(), 'primary'), button('Menu', () => this.options.callbacks.onLeaveMatch())),
      ),
    );
  }

  hide(): void {
    this.screen = 'none';
    clear(this.element);
  }

  private async equipAnimal(animalId: string): Promise<void> {
    try {
      await this.options.api.equipAnimal(animalId);
      if (this.profile) this.profile.profile.equipped.animalId = animalId;
      this.options.callbacks.onAnimalChanged(animalId);
      this.notice = '';
    } catch (error) {
      this.notice = `Could not equip: ${(error as Error).message}`;
    }
    this.render();
  }

  private async equipCosmetic(slot: CosmeticSlot, cosmeticId: string | null): Promise<void> {
    try {
      const response = await this.options.api.equipCosmetic(slot, cosmeticId);
      if (this.profile) this.profile.profile.equipped = response.equipped;
      this.options.callbacks.onCosmeticsChanged(response.equipped.cosmetics as Record<string, string>);
      this.notice = '';
    } catch (error) {
      this.notice = `Could not equip: ${(error as Error).message}`;
    }
    this.render();
    this.showCosmeticSlot(slot);
  }

  private async buyWithCoins(itemId: string): Promise<void> {
    try {
      const response = await this.options.api.purchaseWithCoins(itemId);
      if (this.profile) this.profile.profile.coins = response.coins;
      this.notice = `Unlocked: ${response.granted.join(', ')}`;
      await this.refreshProfile();
    } catch (error) {
      this.notice = `Purchase failed: ${(error as Error).message}`;
      this.render();
    }
  }

  /**
   * Real-money purchase.
   *
   * In a store build this hands off to the platform billing SDK and passes the resulting receipt
   * to the server, which verifies it before granting anything. The dev receipt below only works
   * against a development server — production refuses it.
   */
  private async buyWithMoney(itemId: string): Promise<void> {
    if (!this.options.devPurchases) {
      this.notice = 'Purchases are handled by the platform store in the shipped app.';
      this.render();
      return;
    }
    try {
      const response = await this.options.api.purchase(itemId, `dev:${itemId}:${Date.now()}`);
      this.notice = `Unlocked: ${response.granted.join(', ')}`;
      await this.refreshProfile();
    } catch (error) {
      this.notice = `Purchase failed: ${(error as Error).message}`;
      this.render();
    }
  }

  private async claimDaily(): Promise<void> {
    try {
      const response = await this.options.api.claimDaily();
      this.notice = response.claim.ok ? `Day ${response.claim.streak} reward claimed!` : 'Already claimed today.';
      await this.refreshProfile();
    } catch (error) {
      this.notice = `Could not claim: ${(error as Error).message}`;
      this.render();
    }
  }

  private async refreshProfile(): Promise<void> {
    try {
      this.profile = await this.options.api.getProfile();
    } catch {
      // Keep the cached profile; the notice already explains what happened.
    }
    this.render();
  }
}
