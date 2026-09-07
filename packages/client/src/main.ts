import { sanitizeName } from '@kc/core';
import type { Settings } from '@kc/core';
import { Api, localContent } from './net/Api.js';
import { GameClient } from './game/GameClient.js';
import { MobileInput } from './platform/mobile/MobileInput.js';
import { PCInput } from './platform/pc/PCInput.js';
import { VRInput } from './platform/vr/VRInput.js';
import { detectDevice } from './platform/detect.js';
import { profileFor } from './platform/Platform.js';
import type { PlatformInput } from './platform/Platform.js';
import { Renderer } from './render/Renderer.js';
import { LocalStore } from './storage/LocalStore.js';
import { Hud } from './ui/Hud.js';
import { Shell } from './ui/Shell.js';
import { TuningStore } from './game/TuningStore.js';
import { VRMenu } from './ui/VRPanels.js';
import { button, el } from './ui/dom.js';
import { injectStyles } from './ui/styles.js';

/**
 * Application bootstrap.
 *
 * Detects the device, picks the matching platform layer, and wires the shared game client to
 * it. Everything below this file is platform-agnostic; everything platform-specific is chosen
 * exactly once, here.
 */
async function main(): Promise<void> {
  injectStyles();
  const root = document.getElementById('app');
  if (!root) throw new Error('missing #app');

  const store = new LocalStore();
  const settings: Settings = store.loadSettings();
  const device = await detectDevice();
  const api = new Api('');

  const quality = settings.graphics.quality === 'auto' ? device.suggestedQuality : settings.graphics.quality;
  const profile = profileFor(device.kind, quality, settings);

  const renderer = new Renderer({ container: root, platform: device.kind, profile, pixelRatio: device.devicePixelRatio });

  // Session: a guest account is created on first run and remembered locally.
  let session = store.loadSession();
  if (session) api.setToken(session.token);

  const shellRoot = el('div');
  root.append(shellRoot);

  const input: PlatformInput =
    device.kind === 'vr'
      ? new VRInput(renderer)
      : device.kind === 'mobile'
        ? new MobileInput(root)
        : new PCInput(renderer.renderer.domElement);

  // Created here rather than inside GameClient: tuning is a persisted user preference shared
  // with the menus, and the menus exist before the first match does.
  const tuning = new TuningStore();

  const shell = new Shell(
    {
      root: shellRoot,
      api,
      platform: device.kind,
      controlHints: () => input.controlHints,
      devPurchases: import.meta.env.DEV,
      tuning,
      canTune: () => game?.canTune ?? false,
      onTuningChanged: () => game?.applyTuning(),
      callbacks: {
        onQuickPlay: (modeId) => void startMatch({ modeId }),
        onPractice: (modeId) => startPractice(modeId),
        onJoinRoom: (code) => void startMatch({ roomCode: code }),
        onCreatePrivate: (modeConfig) =>
          void startMatch({ roomCode: 'new-private', ...(modeConfig === undefined ? {} : { modeConfig }) }),
        onAnimalChanged: (animalId) => game?.setAnimal(animalId),
        onCosmeticsChanged: (cosmetics) => game?.setCosmetics(cosmetics),
        onSettingsChanged: (next) => {
          store.saveSettings(next);
          game?.applySettings(next);
        },
        onNameChanged: (name) => void createSession(name),
        onPlayAgain: () => playAgain(),
        onLeaveMatch: () => {
          game?.disconnect();
          openMenu();
        },
        onVoiceToggle: (enabled) => {
          if (!game) return;
          if (enabled) void game.voice.enable();
          else game.voice.disable();
        },
      },
    },
    settings,
  );

  let game: GameClient | null = null;
  let hud: Hud | null = null;
  let vrMenu: VRMenu | null = null;
  let tuningMenu: VRMenu | null = null;
  /** Which way a tap on a tuning row moves the value. Flipped from a row in the panel. */
  let tuningStep = 1;

  const serverUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

  async function createSession(name: string): Promise<void> {
    const clean = sanitizeName(name);
    store.saveName(clean);
    try {
      const guest = await api.createGuest(clean);
      api.setToken(guest.token);
      session = { playerId: guest.playerId, token: guest.token };
      store.saveSession(session);
      await bootGame(clean);
    } catch (error) {
      // No server? Still let the player in — practice mode is fully offline.
      console.warn('[boot] guest creation failed, continuing offline:', (error as Error).message);
      session = { playerId: `local_${Math.random().toString(36).slice(2, 10)}`, token: '' };
      await bootGame(clean);
      shell.setOnline(false);
      shell.setNotice('Playing offline — the server could not be reached.');
    }
  }

  async function bootGame(name: string): Promise<void> {
    if (!session) return;

    let cosmetics: Record<string, string> = {};
    let animalId = 'kangaroo';
    try {
      const bundle = await api.getProfile();
      shell.setProfile(bundle);
      animalId = bundle.profile.equipped.animalId;
      cosmetics = bundle.profile.equipped.cosmetics as Record<string, string>;
    } catch {
      // Offline: fall back to the free animal and no cosmetics.
    }
    try {
      shell.setContent(await api.getContent());
    } catch {
      // The catalogue is compiled into this build and registers itself on import, so an
      // unreachable server means the menus have no *server* content — not that they have none.
      // Handing them the local copy is the difference between a game that looks offline and one
      // that looks broken: without it, Game modes and Customise render as a title and a Back
      // button, with nothing saying why.
      shell.setContent(localContent());
    }

    game = new GameClient({
      renderer,
      input,
      platform: device.kind,
      settings,
      profile: { playerId: session.playerId, name, animalId, cosmetics, ...(session.token ? { token: session.token } : {}) },
      profileForQuality: profile,
      tuning,
      callbacks: {
        onModeState: (state) => hud?.update(state, game?.localPlayer),
        onResults: (result, rewards) => {
          hud?.setVisible(false);
          shell.showResults(result, rewards, session?.playerId ?? '');
        },
        onNetStatus: (status) => hud?.setStatus(`${status} · ${Math.round(game?.stats.fps ?? 0)} fps`),
        onChat: (from, text, channel, own) => hud?.pushChat(from, text, channel, own),
        onNotice: (text) => shell.setNotice(text),
        onRoomState: (code, isPrivate, playerCount) =>
          hud?.setStatus(`${code}${isPrivate ? ' (private)' : ''} · ${playerCount} players`),
        onLocalEvent: (event) => hud?.handleEvent(event, session?.playerId ?? ''),
        onShopToggle: () => {
          hud?.setShop(game?.shopStock ?? []);
          hud?.toggleShop();
        },
      },
    });

    hud = new Hud({
      root: shellRoot,
      platform: device.kind,
      localId: session.playerId,
      onMenu: () => openMenu(),
      onEmote: () => undefined,
      onChat: (text, channel) => game?.sendChat(text, channel),
      onBuy: (gadgetId) => {
        game?.buy(gadgetId);
        hud?.setShop(game?.shopStock ?? []);
      },
      // While the composer has the keyboard the game must stop reading it, or typing "hey" hops
      // three times. The input layer is detached rather than filtered, so no key can leak through.
      onChatFocus: (focused) => game?.setInputSuspended(focused),
    });
    if (input instanceof MobileInput) hud.attachTouchControls(input);
    hud.setVisible(false);

    game.start();
    void game.audio.resume();

    if (device.kind === 'vr') setupVr();
    shell.show(store.tutorialSeen() ? 'menu' : 'tutorial');
    store.markTutorialSeen();
  }

  /**
   * Redraw the VR tuning page from the current values.
   *
   * Only the first nine tunables are offered here. The panel is a fixed-size quad and a row has
   * to stay big enough to hit with a controller ray, so the list is capped; `TUNABLES` is
   * ordered by how much each one changes the feel, and the export lives on the desktop panel
   * because that is where the numbers get pasted into the source anyway.
   */
  function drawTuning(): void {
    if (!tuningMenu || !game) return;
    const store = game.tuning;
    const rows = store.tunables.slice(0, 9).map((tunable) => ({
      id: tunable.field,
      label: tunable.label,
      // A marker beats a colour here: the panel is drawn at a distance on a low-DPI quad.
      value: `${store.isOverridden(tunable.field) ? '\u2022 ' : ''}${store.value(tunable.field)}`,
    }));

    tuningMenu.setContent(
      'Movement tuning',
      game.canTune
        ? `Tap a row to move it by ${tuningStep > 0 ? '+' : '-'}1 step · ${store.modifiedCount} changed`
        : 'Solo practice only — the server owns movement in a match',
      [
        ...rows.map((row) => ({ ...row, disabled: !game?.canTune })),
        { id: 'direction', label: 'Direction', value: tuningStep > 0 ? '+1 step' : '-1 step' },
        { id: 'reset', label: 'Reset all', disabled: store.modifiedCount === 0 },
        { id: 'back', label: 'Back' },
      ],
    );
  }

  function setupVr(): void {
    const vrInput = input as VRInput;
    vrMenu = new VRMenu({
      renderer,
      onSelect: (id) => {
        if (id === 'play') void startMatch({ modeId: 'kangaroo-chase' });
        else if (id === 'practice') startPractice('kangaroo-chase');
        else if (id === 'recenter') vrInput.recenter();
        else if (id === 'exit') void vrInput.exitVr();
        else if (id === 'tuning') {
          vrMenu?.hide();
          drawTuning();
          tuningMenu?.show();
          return;
        }
        vrMenu?.hide();
      },
    });
    vrMenu.setContent('Kangaroo Chase', 'Point and pull the trigger', [
      { id: 'play', label: 'Play' },
      { id: 'practice', label: 'Practice with bots' },
      { id: 'tuning', label: 'Movement tuning' },
      { id: 'recenter', label: 'Recentre view' },
      { id: 'exit', label: 'Leave VR' },
    ]);

    // Tuning is a separate panel rather than a sub-list of the main one, so leaving it does not
    // dump you back at the top of the menu after every single adjustment.
    tuningMenu = new VRMenu({
      renderer,
      onSelect: (id) => {
        if (id === 'back') {
          tuningMenu?.hide();
          vrMenu?.show();
          return;
        }
        if (id === 'direction') tuningStep = -tuningStep;
        else if (id === 'reset') game?.tuning.reset();
        else game?.tuning.nudge(id as Parameters<NonNullable<typeof game>['tuning']['nudge']>[0], tuningStep);
        game?.applyTuning();
        drawTuning();
      },
    });

    const enterButton = button(
      'Enter VR',
      () => {
        void vrInput.enterVr().then((ok) => {
          if (ok) {
            shell.hide();
            hud?.setVisible(false);
            vrMenu?.show();
          }
        });
      },
      'primary',
    );
    enterButton.style.position = 'absolute';
    enterButton.style.bottom = '24px';
    enterButton.style.left = '50%';
    enterButton.style.transform = 'translateX(-50%)';
    shellRoot.append(enterButton);

    vrInput.onSessionChange = (active) => {
      if (!active) {
        shell.show('menu');
        vrMenu?.hide();
      }
    };
  }

  async function startMatch(options: { modeId?: string; roomCode?: string; modeConfig?: unknown }): Promise<void> {
    if (!game) return;
    shell.hide();
    hud?.setVisible(true);
    resumeInput();
    await game.audio.resume();
    if (settings.voiceEnabled) void game.voice.enable();
    game.connect(serverUrl, options);
  }

  /**
   * "Play again" on the results screen.
   *
   * It used to call `closeMenu()`, which only hid the shell — so after a solo round it dropped
   * the player back into the *finished* simulation, clock at zero, nothing happening. That was
   * invisible while the results screen only ever appeared after a server match; it stopped being
   * invisible when solo rounds started reporting results too.
   *
   * Online the server owns what comes next, so closing the menu is still the right move there.
   */
  function playAgain(): void {
    if (game?.isSoloPractice) startPractice(game.currentModeId);
    else closeMenu();
  }

  function startPractice(modeId: string): void {
    if (!game) return;
    shell.hide();
    hud?.setVisible(true);
    resumeInput();
    void game.audio.resume();
    game.startSoloPractice(modeId);
  }

  function resumeInput(): void {
    if (input instanceof PCInput) input.requestPointerLock();
  }

  /**
   * Opening the menu must release the pointer lock, or every menu click is swallowed by the
   * locked canvas and the player is stuck in the game with a menu they cannot press.
   */
  function openMenu(): void {
    if (input instanceof PCInput) input.releasePointerLock();
    shell.show('menu');
    hud?.setVisible(false);
  }

  function closeMenu(): void {
    shell.hide();
    hud?.setVisible(true);
    resumeInput();
  }

  // VR needs its tracking updated inside the XR frame loop; hook it to the renderer's loop.
  if (device.kind === 'vr') {
    const vrInput = input as VRInput;
    let lastTime = performance.now();
    const originalLoop = renderer.setAnimationLoop.bind(renderer);
    renderer.setAnimationLoop = (loop) => {
      originalLoop((time, frame) => {
        const dt = Math.min(0.1, (time - lastTime) / 1000);
        lastTime = time;
        vrInput.updateTracking(dt, settings);
        vrMenu?.update();
        tuningMenu?.update();
        loop?.(time, frame);
      });
    };
  }

  document.addEventListener('keydown', (event) => {
    // Enter opens the chat composer, and T does the same — Enter is the reflex, T is the habit
    // from every other game. Both are ignored while a menu is up, where Enter means "confirm".
    if ((event.code === 'Enter' || event.code === 'KeyT') && shell.currentScreen === 'none' && hud) {
      event.preventDefault();
      hud.toggleChat();
      return;
    }
    if (event.code !== 'Escape') return;
    // Escape closes the composer before it opens the menu: the nearer thing first, which is what
    // a player pressing it while typing means.
    if (hud?.chatFocused) {
      hud.toggleChat();
      return;
    }
    if (shell.currentScreen === 'none') openMenu();
    else closeMenu();
  });

  const savedName = store.loadName();
  if (session && savedName) await bootGame(savedName);
  else shell.show('name');
}

/**
 * Register the service worker for offline start.
 *
 * Deliberately fired after `main()` has resolved and never awaited: a WebXR PWA launches
 * straight into immersive mode, so anything on the critical path counts against Meta's
 * startup-time requirement. Registration failing is not fatal — it only costs offline start.
 */
function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  // file:// (the Steam shell's fallback) cannot host a worker, and dev servers do not need one.
  if (!location.protocol.startsWith('http')) return;
  navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
    console.warn('[pwa] service worker registration failed:', error);
  });
}

main().then(registerServiceWorker).catch((error: unknown) => {
  console.error(error);
  const root = document.getElementById('app');
  if (root) {
    root.innerHTML =
      '<div style="padding:32px;font:15px system-ui;color:#f2f7f0">Kangaroo Chase failed to start. Check the console for details.</div>';
  }
});
