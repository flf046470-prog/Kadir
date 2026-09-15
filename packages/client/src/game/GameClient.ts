import * as THREE from 'three';
import {
  Bot,
  Buttons,
  Simulation,
  TICK_DT,
  botName,
  buildJungleWorld,
  createIntent,
  getAnimal,
  makeRaycastResult,
  snapshotPlayer,
  zoneAt,
} from '@kc/core';
import type {
  InputIntent,
  LevelDef,
  MatchResult,
  ModeStateView,
  PlayerSnapshot,
  PlayerState,
  Settings,
  SimEvent,
} from '@kc/core';
import { InterpolationBuffer, PredictionBuffer } from '@kc/net';
import type { LobbyPlayer, Platform, RosterEntry } from '@kc/net';
import { TuningStore } from './TuningStore.js';
import { AudioSystem } from '../audio/AudioSystem.js';
import { VoiceChat } from '../audio/VoiceChat.js';
import { NetClient } from '../net/NetClient.js';
import type { NetStatus } from '../net/NetClient.js';
import { Avatar } from '../render/Avatar.js';
import { AssetLibrary } from '../render/AssetLibrary.js';
import { Vignette } from '../render/Vignette.js';
import { LevelRenderer } from '../render/LevelRenderer.js';
import { Renderer } from '../render/Renderer.js';
import type { PerformanceProfile, PlatformInput } from '../platform/Platform.js';

export interface GameCallbacks {
  onModeState(state: ModeStateView): void;
  onResults(result: MatchResult, rewards: Record<string, { coins: number; xp: number; achievements: string[] }>): void;
  onNetStatus(status: NetStatus): void;
  onChat(name: string, text: string, channel: 'room' | 'team' | 'system', own: boolean): void;
  onNotice(text: string): void;
  /**
   * The room changed: someone joined, left, voted or pressed Ready.
   *
   * `lobby` is the whole list rather than a count, because a count cannot answer what a player
   * sharing a room code actually wants to know — whether their friend arrived.
   */
  onRoomState(code: string, isPrivate: boolean, lobby: LobbyPlayer[]): void;
  onLocalEvent(event: SimEvent): void;
  /** The shop button was pressed. Opening a panel is a local decision, not a simulated one. */
  onShopToggle(): void;
}

export interface GameClientOptions {
  renderer: Renderer;
  input: PlatformInput;
  platform: Platform;
  settings: Settings;
  profile: { playerId: string; name: string; animalId: string; cosmetics: Record<string, string>; token?: string };
  callbacks: GameCallbacks;
  profileForQuality: PerformanceProfile;
  /** Shared with the menus: tuning is a persisted user preference, not per-match state. */
  tuning: TuningStore;
}

interface RemotePlayer {
  avatar: Avatar;
  entry: RosterEntry;
}

const CAMERA_DISTANCE = 5.4;
const CAMERA_HEIGHT = 1.35;

/**
 * The client game loop.
 *
 * Runs the *same* `Simulation` class the server runs, one instance holding only the local
 * player: local input is predicted immediately, snapshots rewind and replay it, and every other
 * player is drawn from the interpolation buffer. Offline it drops into a solo practice match
 * with bots — the exact same code path, minus the socket.
 */
export class GameClient {
  readonly renderer: Renderer;
  readonly audio = new AudioSystem();
  readonly voice: VoiceChat;
  readonly net: NetClient;

  private level: LevelDef;
  private levelRenderer: LevelRenderer;
  private sim: Simulation;
  private input: PlatformInput;
  private settings: Settings;
  private callbacks: GameCallbacks;
  private options: GameClientOptions;

  private localId: string;
  private localAvatar: Avatar | null = null;
  /**
   * Authored models, shared across every avatar in the session.
   *
   * One library per client, not per avatar: it caches by URL, so a room of sixteen kangaroos
   * downloads and uploads one mesh rather than sixteen.
   */
  private assets = new AssetLibrary();
  /** VR comfort vignette. Only constructed in VR; null elsewhere. */
  private vignette: Vignette | null = null;
  private remotes = new Map<string, RemotePlayer>();
  private interpolation = new InterpolationBuffer();
  private prediction = new PredictionBuffer();
  private intent: InputIntent = createIntent();
  /** True while a text field owns the keyboard; see `setInputSuspended`. */
  private inputSuspended = false;

  private accumulator = 0;
  private lastFrameTime = 0;
  private running = false;
  private online = false;
  private cameraYaw = 0;
  private cameraPitch = 0;
  private raycastResult = makeRaycastResult();
  private tmpVec = new THREE.Vector3();
  private tmpVec2 = new THREE.Vector3();
  private bots: Bot[] = [];
  /** Live movement tuning. Only ever applied in solo practice — see `applyTuning`. */
  readonly tuning: TuningStore;
  private soloPractice = false;
  /** Guards the one-shot results callback: `finished()` stays true for every tick after the end. */
  private soloResultsSent = false;
  /**
   * What the in-round shop is selling.
   *
   * Solo reads it straight off the local simulation; online it arrives in a `gear` message,
   * because the mode prices the stock and the mode lives on the server.
   */
  private shop: { id: string; name: string; cost: number }[] = [];
  /** Previous frame's shop button, so the panel toggles on the press rather than every tick. */
  private shopHeld = false;
  /** Eased zone darkness, so fog and light never jump in a single frame. */
  private darkness = 0;
  private modeId = 'kangaroo-chase';
  private roomCode = '';
  /** Everyone in the room and whether they have pressed Ready. Empty in solo practice. */
  private lobby: LobbyPlayer[] = [];
  private ready = false;

  /** Debug/perf counters surfaced by the HUD. */
  readonly stats = { fps: 0, ping: 0, players: 0, tick: 0 };

  constructor(options: GameClientOptions) {
    this.options = options;
    this.renderer = options.renderer;
    this.input = options.input;
    this.settings = options.settings;
    this.callbacks = options.callbacks;
    this.localId = options.profile.playerId;
    this.tuning = options.tuning;

    this.level = buildJungleWorld();
    this.levelRenderer = new LevelRenderer(this.level, options.profileForQuality, this.assets);
    this.renderer.scene.add(this.levelRenderer.group);
    this.renderer.applyLevel(this.level);

    this.sim = new Simulation({ level: this.level, modeId: this.modeId });
    this.audio.applySettings(this.settings);

    this.voice = new VoiceChat(this.audio, (targetId, payload, kind) => {
      this.net.sendJson({ t: 'voice', targetId, payload, kind });
    });

    this.net = new NetClient({
      onWelcome: (message) => this.handleWelcome(message),
      onSnapshot: (tick, players) => this.handleSnapshot(tick, players),
      onPlayerJoined: (entry) => this.addRemote(entry),
      onPlayerLeft: (playerId) => this.removeRemote(playerId),
      onEvents: (events) => this.handleEvents(events),
      onModeState: (state) => {
        this.callbacks.onModeState(state);
        this.levelRenderer.setCheckpointsVisible(state.modeId === 'parkour');
      },
      onGear: (gear) => {
        this.shop = gear.shop;
      },
      onResults: (result, rewards) => this.callbacks.onResults(result, rewards),
      onChat: (playerId, name, text, channel) =>
        this.callbacks.onChat(name, text, channel, playerId === this.localId),
      onChatRejected: (message) => this.callbacks.onChat('', message, 'system', true),
      onVoiceSignal: (fromId, payload, kind) => void this.voice.handleSignal(fromId, payload, kind),
      onRoomState: (state) => {
        this.roomCode = state.roomCode;
        // `?? []` because the wire is not a type system. A server older than the lobby list sends
        // this message without `players`, and the client reading `.length` off it threw a page
        // error that killed the frame loop — the whole game, for a field that is only decoration.
        // Caught for real: a stale server left running on the smoke test's port did exactly this.
        this.lobby = state.players ?? [];
        this.callbacks.onRoomState(state.roomCode, state.isPrivate, this.lobby);
      },
      onError: (code, message) => this.callbacks.onNotice(`${code}: ${message}`),
      onStatusChange: (status) => {
        this.online = status === 'connected';
        this.callbacks.onNetStatus(status);
        if (status === 'offline') this.startSoloPractice();
      },
    });
  }

  get currentRoomCode(): string {
    return this.roomCode;
  }

  /** Everyone in the room, with their ready state. */
  get lobbyPlayers(): readonly LobbyPlayer[] {
    return this.lobby;
  }

  get isReady(): boolean {
    return this.ready;
  }

  /**
   * Say whether this player is ready.
   *
   * Sent rather than assumed: the server owns `ready` and echoes it back to everyone in the next
   * room broadcast, so the local list is never the source of truth for the local player either.
   */
  setReady(ready: boolean): void {
    if (!this.online) return;
    this.ready = ready;
    this.net.sendJson({ t: 'ready', ready });
  }

  get localPlayer(): PlayerState | undefined {
    return this.sim.players.get(this.localId);
  }

  get modeState(): ModeStateView {
    return this.sim.mode.state();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.input.start();
    this.lastFrameTime = performance.now();
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    this.input.stop();
  }

  connect(serverUrl: string, options: { roomCode?: string; modeId?: string; modeConfig?: unknown } = {}): void {
    this.modeId = options.modeId ?? this.modeId;
    this.net.connect({
      url: serverUrl,
      name: this.options.profile.name,
      animalId: this.options.profile.animalId,
      cosmetics: this.options.profile.cosmetics,
      platform: this.options.platform,
      crossPlay: this.settings.crossPlay,
      ...(this.options.profile.token ? { token: this.options.profile.token } : {}),
      ...(options.roomCode ? { roomCode: options.roomCode } : {}),
      ...(options.modeId ? { modeId: options.modeId } : {}),
      ...(options.modeConfig === undefined ? {} : { modeConfig: options.modeConfig }),
    });
  }

  disconnect(): void {
    this.net.disconnect();
    this.voice.disable();
  }

  /**
   * Leave the round deliberately, as opposed to losing the connection.
   *
   * `disconnect` alone is not enough for a solo round, which has no socket to close: without
   * clearing `soloPractice` the player is still, as far as every other part of the client is
   * concerned, inside a practice match — so "Play again" on the next results screen would restart
   * a round they had already walked out of, and the tuning panel would stay editable in a menu
   * that no longer belongs to a match.
   *
   * `NetClient.disconnect` sets status `idle` rather than `offline`, which matters here: `offline`
   * is the signal that starts solo practice automatically as a fallback, and a deliberate exit
   * that immediately dropped the player into a *new* round would be its own bug.
   *
   * The simulation keeps ticking, and that is deliberate — it is what the camera looks at behind
   * the menu. Stopping it would freeze the whole screen, since the render loop and the fixed step
   * share a frame.
   */
  /**
   * Switch voice on, and then call everyone who is already here.
   *
   * The second half is the part that was missing everywhere `voice.enable()` was called directly.
   * Asking for the microphone is slow — a permission check and a device open — while joining a
   * match is fast, so the roster reliably arrives first and every `connectTo` it fires is refused
   * for having no microphone yet. Nothing retried, so a player who joined an occupied room stayed
   * silent to everyone in it for the whole match, and toggling voice on from Settings mid-match
   * did nothing at all.
   *
   * Awaiting the microphone before connecting to the match would also fix it and would be worse:
   * a permission prompt is open-ended, and nobody should be held out of a round waiting for one.
   */
  async enableVoice(): Promise<void> {
    const ready = await this.voice.enable();
    if (!ready || !this.online) return;
    this.voice.connectToAll(this.remotes.keys());
  }

  leaveMatch(): void {
    this.disconnect();
    this.soloPractice = false;
    this.soloResultsSent = false;
  }

  applySettings(settings: Settings): void {
    this.settings = settings;
    this.audio.applySettings(settings);
    this.renderer.applySettings(settings);
  }

  /** Solo practice: the same simulation, filled with bots, no socket required. */
  startSoloPractice(modeId = this.modeId, botCount = 5): void {
    this.modeId = modeId;
    this.sim = new Simulation({ level: this.level, modeId, seed: 1234 });
    this.bots = [];
    this.clearRemotes();

    this.sim.addPlayer({
      id: this.localId,
      name: this.options.profile.name,
      animalId: this.options.profile.animalId,
    });
    this.ensureLocalAvatar();

    for (let i = 0; i < botCount; i++) {
      const id = `bot${i}`;
      this.sim.addPlayer({ id, name: botName(i), animalId: BOT_ANIMALS[i % BOT_ANIMALS.length] as string });
      this.bots.push(new Bot(id, { skill: 0.45 + (i % 4) * 0.15, seed: 900 + i * 17 }));
      this.addRemote({
        id,
        name: botName(i),
        animalId: BOT_ANIMALS[i % BOT_ANIMALS.length] as string,
        cosmetics: {},
        platform: 'pc',
        slot: i + 1,
      });
    }
    this.levelRenderer.setCheckpointsVisible(modeId === 'parkour');
    this.soloPractice = true;
    this.soloResultsSent = false;
    this.applyTuning();
    this.callbacks.onNotice('Solo practice — bots only. Reconnecting in the background.');
  }

  /**
   * End a solo round properly.
   *
   * In a real match the results screen is driven by a message from the server. Solo practice has
   * no server, so nothing ever fired it: the round simply stopped, the HUD sat on "ENDED", and
   * the only way out was the pause menu. That is most of a four-minute round ending in nothing,
   * and it is now the ordinary way to play with no connection.
   *
   * Rewards are deliberately empty. Coins and XP are granted by the server from the server's own
   * result — a client that awarded itself currency would be the one hole the whole economy is
   * built to avoid — so a solo round shows the scoreboard and pays nothing, which is honest.
   */
  private reportSoloResults(): void {
    if (this.soloResultsSent || !this.sim.finished()) return;
    this.soloResultsSent = true;
    this.callbacks.onResults(this.sim.results(), {});
  }

  /** What the in-round shop is selling right now. Empty in modes that run no shop. */
  get shopStock(): { id: string; name: string; cost: number }[] {
    return this.shop;
  }

  /**
   * Ask to buy a gadget.
   *
   * Solo applies it to the local simulation, which is the only authority there. Online it asks
   * the server and waits: the mode owns the round cash, so it is the only thing that can decide
   * whether the buy happens. A client that granted itself the item would be predicting a
   * purchase the server may refuse.
   */
  buy(gadgetId: string): void {
    if (this.soloPractice) {
      this.sim.purchase(this.localId, gadgetId);
      this.shop = this.sim.shopStock();
    } else {
      this.net.sendJson({ t: 'shop', gadgetId });
    }
  }

  /** True while this is a local round against bots rather than a server match. */
  get isSoloPractice(): boolean {
    return this.soloPractice;
  }

  /** The mode currently being played, so the menus can start another round of the same thing. */
  get currentModeId(): string {
    return this.modeId;
  }

  /** True while movement tuning may be edited: solo practice, where nobody else is affected. */
  get canTune(): boolean {
    return this.soloPractice;
  }

  /**
   * Push the tuned movement values into the running simulation.
   *
   * Refused outside solo practice. In a networked match the server owns every config and
   * re-sends it with each snapshot, so a tuned client would predict movement the server never
   * performs — the visible result is rubber-banding, not an advantage.
   */
  applyTuning(): void {
    if (!this.soloPractice) return;
    this.tuning.applyTo(this.sim);
  }

  private handleWelcome(message: { playerId: string; serverTick: number; modeId: string; players: RosterEntry[]; roomCode: string; isPrivate: boolean; levelSeed: number }): void {
    // A real match starts: the server owns the configs from here on.
    this.soloPractice = false;
    this.soloResultsSent = false;
    this.localId = message.playerId;
    this.modeId = message.modeId;
    this.roomCode = message.roomCode;
    this.bots = [];

    // Rebuild the local simulation to match the server's world and clock exactly.
    this.sim = new Simulation({ level: this.level, modeId: message.modeId, seed: message.levelSeed });
    this.sim.tick = message.serverTick;
    this.prediction.clear();
    this.interpolation.clear();
    this.clearRemotes();

    this.sim.addPlayer({
      id: this.localId,
      name: this.options.profile.name,
      animalId: this.options.profile.animalId,
    });
    this.ensureLocalAvatar();

    for (const entry of message.players) {
      if (entry.id === this.localId) continue;
      this.addRemote(entry);
    }
    this.voice.setLocalId(this.localId);
    // The welcome roster carries no ready flags — it is the match roster, not the lobby list —
    // so everyone starts shown as not ready and the next `room` broadcast corrects it.
    this.lobby = message.players.map((p) => ({ id: p.id, name: p.name, animalId: p.animalId, ready: false }));
    this.callbacks.onRoomState(message.roomCode, message.isPrivate, this.lobby);
  }

  private handleSnapshot(tick: number, players: PlayerSnapshot[]): void {
    this.stats.tick = tick;
    const remotes: PlayerSnapshot[] = [];
    for (const snapshot of players) {
      if (snapshot.id === this.localId) {
        const local = this.sim.players.get(this.localId);
        if (local) this.prediction.reconcile(this.sim, local, snapshot, tick);
      } else {
        remotes.push(snapshot);
      }
    }
    this.interpolation.push(tick, remotes);
  }

  private handleEvents(events: SimEvent[]): void {
    for (const event of events) {
      const isLocal = event.playerId === this.localId;
      this.audio.handleEvent(event, isLocal);
      if (isLocal || event.otherId === this.localId) {
        this.callbacks.onLocalEvent(event);
        this.playHaptics(event, isLocal);
      }
    }
  }

  /**
   * Translate a gameplay event into controller feedback.
   *
   * Only events involving the local player reach here, so a busy room cannot buzz the
   * controllers on everyone else's landings.
   */
  private playHaptics(event: SimEvent, isLocal: boolean): void {
    const feedback = this.input.feedback?.bind(this.input);
    if (!feedback) return;

    switch (event.type) {
      case 'land':
        // Landing happens on every hop, so only a genuinely hard one gets the heavy pulse.
        feedback(event.magnitude > 12 ? 'hardLand' : 'land', 'both', Math.min(1, event.magnitude / 14));
        break;
      case 'grab':
        feedback('grab');
        break;
      case 'release':
        feedback('release');
        break;
      case 'punch':
      case 'punchHit':
        feedback('punch', 'both', Math.min(1, event.magnitude / 6));
        break;
      case 'tag':
        // Being tagged is the moment that most needs to be felt, and it is easy to miss
        // visually when the tagger comes from behind.
        feedback(isLocal ? 'tag' : 'tagged');
        break;
      case 'stagger':
        feedback('hardLand', 'both', 0.6);
        break;
      default:
        break;
    }
  }

  private ensureLocalAvatar(): void {
    this.localAvatar?.dispose();
    const avatar = new Avatar(this.options.profile.animalId, this.options.profileForQuality.shadows);
    // A headset tracks a head and two hands. Legs would be a guess, and the local player's own are
    // the ones they see by looking down.
    avatar.setLegless(this.options.platform === 'vr');
    avatar.setCosmetics(this.options.profile.cosmetics);
    // The local player's own nameplate is hidden; remote players keep theirs.
    avatar.setName(this.options.profile.name, '#ffd166', false);
    this.renderer.scene.add(avatar.group);
    this.localAvatar = avatar;
    this.upgradeToModel(avatar);
  }

  private addRemote(entry: RosterEntry): void {
    if (entry.id === this.localId || this.remotes.has(entry.id)) return;
    const avatar = new Avatar(entry.animalId, this.options.profileForQuality.shadows);
    // Decided by the platform *that player* is on, not the one watching: a VR player has no
    // tracked legs whoever is looking at them, and the roster carries the platform for exactly
    // this kind of question.
    avatar.setLegless(entry.platform === 'vr');
    avatar.setCosmetics(entry.cosmetics);
    avatar.setName(entry.name);
    this.renderer.scene.add(avatar.group);
    this.remotes.set(entry.id, { avatar, entry });
    this.upgradeToModel(avatar);
    if (this.online && this.voice.isEnabled) void this.voice.connectTo(entry.id);
  }

  /**
   * Load this animal's authored model, if there is one, and hand it to the avatar.
   *
   * Fire-and-forget on purpose. The avatar is already built, already in the scene and already
   * being drawn by the time this resolves — a player must appear the instant they join, not once
   * a few hundred kilobytes have arrived over someone's phone connection. If the file is missing,
   * slow or broken, the procedural body is what stays on screen and nothing about the match
   * changes; models are visual only.
   *
   * The avatar can be disposed while the download is in flight (a player leaves, or the local
   * player swaps animal mid-lobby), so the result is dropped unless the avatar is still the one
   * in play — otherwise a dead avatar gets a model and an animation mixer that nothing ever
   * updates or frees.
   */
  private upgradeToModel(avatar: Avatar): void {
    const ref = getAnimal(avatar.animalId)?.model;
    if (!ref) return;
    void this.assets
      .load(ref)
      .then((loaded) => {
        if (!loaded) return;
        const live = avatar === this.localAvatar || [...this.remotes.values()].some((r) => r.avatar === avatar);
        if (!live) return;
        avatar.attachModel(loaded);
      })
      .catch(() => {
        /* AssetLibrary already logs once per URL; a second message per player would be noise. */
      });
  }

  private removeRemote(playerId: string): void {
    const remote = this.remotes.get(playerId);
    if (!remote) return;
    remote.avatar.dispose();
    this.remotes.delete(playerId);
    this.voice.closePeer(playerId);
  }

  private clearRemotes(): void {
    for (const [, remote] of this.remotes) remote.avatar.dispose();
    this.remotes.clear();
  }

  private frame(time: number): void {
    if (!this.running) return;
    const dtMs = Math.min(100, time - this.lastFrameTime);
    this.lastFrameTime = time;
    const dt = dtMs / 1000;
    this.stats.fps = this.stats.fps * 0.9 + (1000 / Math.max(1, dtMs)) * 0.1;

    this.renderer.governFrame(dtMs, time);
    if (this.inputSuspended) {
      // Look is still sampled so the camera does not lurch when the composer closes; movement
      // and buttons stay zeroed by `setInputSuspended`.
      this.intent.tick = this.sim.tick;
    } else {
      this.input.sample(this.intent, dt, this.settings);
    }
    // Mic loudness rides the intent so every viewer sees the same mouth on the same tick. The
    // platform layer owns the Talk button; this only supplies the level behind it.
    this.intent.voice = this.inputSuspended ? 0 : this.voice.level;

    // Fixed-step simulation with a bounded catch-up, so a hitch cannot spiral.
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= TICK_DT && steps < 5) {
      this.accumulator -= TICK_DT;
      steps++;
      this.stepSimulation();
    }

    this.updateAvatars(dt);
    this.updateCamera(dt);
    this.updateZone(dt);
    this.levelRenderer.animate(time / 1000);

    const local = this.localPlayer;
    if (local) this.renderer.updateShadowFocus(local.position.x, local.position.z);

    this.stats.players = this.remotes.size + 1;
    this.renderer.render();
  }

  private stepSimulation(): void {
    const tick = this.sim.tick + 1;
    this.intent.tick = tick;

    // The shop button opens a panel, which is a local action — the bit is in the intent because
    // every platform already reports it there, not because the simulation does anything with it.
    const shopPressed = (this.intent.buttons & Buttons.Shop) !== 0;
    if (shopPressed && !this.shopHeld) this.callbacks.onShopToggle();
    this.shopHeld = shopPressed;

    this.sim.setIntent(this.localId, this.intent, false);
    if (this.online) {
      this.prediction.record(tick, this.intent);
      this.net.sendIntent(this.intent);
    } else {
      // Offline: drive the bots so practice behaves like a real match.
      for (const bot of this.bots) {
        const self = this.sim.players.get(bot.playerId);
        if (!self) continue;
        this.sim.setIntent(bot.playerId, bot.think(self, this.sim.players.values(), this.level, TICK_DT), false);
      }
    }

    this.sim.step();

    if (!this.online) {
      const events = this.sim.events.drain();
      this.handleEvents(events);
      this.callbacks.onModeState(this.sim.mode.state());
      this.shop = this.sim.shopStock();
      this.reportSoloResults();
    } else {
      this.sim.events.drain();
    }
    this.prediction.decaySmoothing();
  }

  private updateAvatars(dt: number): void {
    const cameraPosition = this.renderer.camera.getWorldPosition(this.tmpVec2);
    const local = this.localPlayer;

    if (local && this.localAvatar) {
      const snapshot = snapshotPlayer(local);
      snapshot.x += this.prediction.smoothingOffset.x;
      snapshot.y += this.prediction.smoothingOffset.y;
      snapshot.z += this.prediction.smoothingOffset.z;
      this.localAvatar.update(snapshot, dt, cameraPosition);
      this.localAvatar.setRole(local.role);
      // In VR the player *is* the avatar; hide the head so it never blocks the view.
      this.localAvatar.group.visible = this.input.kind !== 'vr';
    }

    const voicePositions = new Map<string, { x: number; y: number; z: number }>();
    const detailBudget = this.options.profileForQuality.maxDetailedPlayers;
    let rendered = 0;

    if (this.online) {
      for (const [id, remote] of this.remotes) {
        const sample = this.interpolation.sample(id);
        if (!sample) {
          remote.avatar.group.visible = false;
          continue;
        }
        remote.avatar.group.visible = true;
        remote.avatar.update(sample, dt, cameraPosition);
        remote.avatar.setRole(sample.role);
        remote.avatar.setDetailed(rendered++ < detailBudget);
        voicePositions.set(id, { x: sample.x, y: sample.y + 1.2, z: sample.z });
      }
    } else {
      for (const [id, remote] of this.remotes) {
        const player = this.sim.players.get(id);
        if (!player) continue;
        remote.avatar.group.visible = true;
        remote.avatar.update(snapshotPlayer(player), dt, cameraPosition);
        remote.avatar.setRole(player.role);
        remote.avatar.setDetailed(rendered++ < detailBudget);
      }
    }

    this.voice.updatePositions(voicePositions);
  }

  /**
   * Camera. VR puts the rig at the player's feet and lets the headset own the view; flat
   * platforms use a spring arm that pulls in when geometry would clip it.
   */
  /**
   * Tell the renderer and the audio system where the player is standing.
   *
   * This is the call that was missing entirely. Every level declares zones — the jungle has three,
   * each with an `ambience` kind and a `darkness` documented as a "0..1 fog/darkness hint for the
   * client" — and no client code ever asked which one a player was in. The cave was lit exactly
   * like the clearing, and the `music` bus the ambience belonged on had nothing connected to it.
   *
   * Darkness is eased rather than set: `zoneAt` already fades the weight across the outer fifth of
   * a zone, but a player can also be teleported to a spawn, and a fog density that jumps in one
   * frame reads as a glitch. The ambience bed is switched rather than eased because it crossfades
   * itself over a second and a bed that eased *as well* would double the transition.
   */
  private updateZone(dt: number): void {
    const local = this.localPlayer;
    if (!local) return;

    const sample = zoneAt(this.level, local.position);
    this.audio.setAmbience(sample?.zone.ambience ?? null);

    const target = sample ? sample.zone.darkness * sample.weight : 0;
    this.darkness += (target - this.darkness) * Math.min(1, dt * 2.2);
    this.renderer.setDarkness(this.darkness);
  }

  private updateCamera(dt: number): void {
    const local = this.localPlayer;
    if (!local) return;

    const px = local.position.x + this.prediction.smoothingOffset.x;
    const py = local.position.y + this.prediction.smoothingOffset.y;
    const pz = local.position.z + this.prediction.smoothingOffset.z;

    if (this.input.kind === 'vr') {
      this.renderer.rig.position.set(px, py, pz);
      this.audio.updateListener({ x: px, y: py + 1.6, z: pz }, { x: Math.sin(local.yaw), y: 0, z: Math.cos(local.yaw) });

      // Comfort vignette. Built on first VR frame rather than in the constructor because the
      // platform is only known once input is wired, and it must never exist on PC/Mobile.
      this.vignette ??= new Vignette(this.renderer.camera);
      const turning = Math.abs(local.yaw - this.cameraYaw) > 0.004;
      this.cameraYaw = local.yaw;
      this.vignette.update(dt, {
        speed: Math.hypot(local.velocity.x, local.velocity.z),
        turning,
        airborne: !local.grounded,
        strength: this.settings.comfort.vignette,
      });
      return;
    }

    this.cameraYaw = local.yaw;
    this.cameraPitch += (local.pitch - this.cameraPitch) * Math.min(1, dt * 14);

    const headY = py + local.height * 0.85;
    const cosPitch = Math.cos(this.cameraPitch);
    const dirX = Math.sin(this.cameraYaw) * cosPitch;
    const dirZ = Math.cos(this.cameraYaw) * cosPitch;
    const dirY = Math.sin(this.cameraPitch);

    let distance = CAMERA_DISTANCE;
    // Keep the camera out of walls: cast backwards from the head and pull in on a hit.
    this.sim.world.raycast(
      this.raycastResult,
      { x: px, y: headY, z: pz },
      { x: -dirX, y: -dirY + 0.12, z: -dirZ },
      CAMERA_DISTANCE + 0.4,
    );
    if (this.raycastResult.hit) distance = Math.max(1.2, this.raycastResult.distance - 0.35);

    this.tmpVec.set(px - dirX * distance, headY - dirY * distance + CAMERA_HEIGHT * 0.25, pz - dirZ * distance);
    this.renderer.camera.position.lerp(this.tmpVec, Math.min(1, dt * 16));
    this.renderer.camera.lookAt(px, headY + 0.1, pz);
    this.renderer.rig.position.set(0, 0, 0);

    this.audio.updateListener(
      { x: this.renderer.camera.position.x, y: this.renderer.camera.position.y, z: this.renderer.camera.position.z },
      { x: dirX, y: dirY, z: dirZ },
    );
  }

  /** Change the local player's animal without a round trip; the server validates ownership. */
  setAnimal(animalId: string): void {
    this.options.profile.animalId = animalId;
    const local = this.localPlayer;
    if (local) local.animalId = animalId;
    this.ensureLocalAvatar();
    this.net.sendJson({ t: 'equip', animalId });
  }

  setCosmetics(cosmetics: Record<string, string>): void {
    this.options.profile.cosmetics = cosmetics;
    this.localAvatar?.setCosmetics(cosmetics);
  }

  sendChat(text: string, channel: 'room' | 'team' = 'room'): void {
    this.net.sendJson({ t: 'chat', text, channel });
  }

  /**
   * Stop feeding input to the simulation while a text field has the keyboard.
   *
   * The intent is zeroed rather than merely ignored: a key held when the composer opened would
   * otherwise stay held in the last-sent intent, and the player would walk into a wall for as
   * long as they typed.
   */
  setInputSuspended(suspended: boolean): void {
    this.inputSuspended = suspended;
    if (!suspended) return;
    this.intent.moveX = 0;
    this.intent.moveZ = 0;
    this.intent.buttons = 0;
    this.intent.voice = 0;
  }

  voteMode(modeId: string): void {
    this.net.sendJson({ t: 'vote', modeId });
  }

  dispose(): void {
    this.stop();
    this.disconnect();
    this.clearRemotes();
    this.localAvatar?.dispose();
    this.vignette?.dispose();
    this.vignette = null;
    this.levelRenderer.dispose();
    this.audio.dispose();
    this.voice.dispose();
  }
}

const BOT_ANIMALS = ['kangaroo', 'fox', 'wolf', 'frog', 'penguin', 'tiger'];
