import type { SimEvent, SurfaceMaterial, Settings, ZoneDef } from '@kc/core';

export type AmbienceKind = ZoneDef['ambience'];

/**
 * One filtered-noise bed per zone kind.
 *
 * `centre` and `q` are what a space sounds like: a cave is a narrow low band that rings, open
 * jungle is wide and airy, a canyon sits between them with more air movement. `drift` is how fast
 * the filter wanders, which is the only thing stopping a one-second noise buffer from ticking
 * audibly once a second.
 */
const AMBIENCE: Record<AmbienceKind, { centre: number; q: number; drift: number; gain: number }> = {
  jungle: { centre: 1500, q: 0.6, drift: 0.07, gain: 0.05 },
  cave: { centre: 190, q: 3.2, drift: 0.03, gain: 0.08 },
  canyon: { centre: 700, q: 1.1, drift: 0.11, gain: 0.055 },
  waterfall: { centre: 2600, q: 0.45, drift: 0.19, gain: 0.09 },
  village: { centre: 1100, q: 0.8, drift: 0.05, gain: 0.04 },
  lobby: { centre: 800, q: 0.9, drift: 0.04, gain: 0.03 },
};

/**
 * Procedural audio.
 *
 * Every sound is synthesised at runtime rather than streamed: the whole game ships with zero
 * audio downloads, sounds scale continuously with impact speed and material (a hard landing on
 * rock genuinely sounds different from a soft one on foliage), and there is nothing to
 * decode on a low-memory phone. An asset pack can replace this later without touching callers —
 * `play()` is the only surface.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Record<'sfx' | 'music' | 'voice', GainNode> | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private settings: Settings | null = null;
  private muted = false;
  private lastPlayAt = new Map<string, number>();
  /** The running ambience bed, if any, kept so it can be faded out when the zone changes. */
  private ambience: { source: AudioBufferSourceNode; lfo: OscillatorNode; gain: GainNode } | null = null;
  private ambienceKind: AmbienceKind | null = null;

  /** Must be called from a user gesture — browsers refuse to start audio otherwise. */
  async resume(): Promise<void> {
    if (!this.ctx) this.init();
    if (this.ctx?.state === 'suspended') await this.ctx.resume();

    /**
     * Start the bed the player is already standing in.
     *
     * Audio may only begin on a user gesture, but the zone is decided the moment the world is
     * built — so the first `setAmbience` lands before there is any context to play it on and only
     * records the kind. Without this the bed for the spawn zone never starts, and the first thing
     * a player ever hears is whatever zone they walk into *next*.
     */
    if (this.ambienceKind && !this.ambience) {
      const pending = this.ambienceKind;
      this.ambienceKind = null;
      this.setAmbience(pending);
    }
  }

  private init(): void {
    const Ctor = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);

    const makeBus = (value: number): GainNode => {
      const gain = ctx.createGain();
      gain.gain.value = value;
      gain.connect(this.master as GainNode);
      return gain;
    };
    this.buses = { sfx: makeBus(1), music: makeBus(0.5), voice: makeBus(1) };

    // One second of white noise, reused by every impact and whoosh.
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  get voiceBus(): GainNode | null {
    return this.buses?.voice ?? null;
  }

  applySettings(settings: Settings): void {
    this.settings = settings;
    if (!this.master || !this.buses) return;
    this.master.gain.value = settings.audio.master;
    this.buses.sfx.gain.value = settings.audio.sfx;
    this.buses.music.gain.value = settings.audio.music;
    this.buses.voice.gain.value = settings.audio.voice;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : (this.settings?.audio.master ?? 0.9);
  }

  /** Move the listener with the camera so spatial audio matches what the player sees. */
  updateListener(position: { x: number; y: number; z: number }, forward: { x: number; y: number; z: number }): void {
    const listener = this.ctx?.listener;
    if (!listener) return;
    if (listener.positionX) {
      listener.positionX.value = position.x;
      listener.positionY.value = position.y;
      listener.positionZ.value = position.z;
      listener.forwardX.value = forward.x;
      listener.forwardY.value = forward.y;
      listener.forwardZ.value = forward.z;
      listener.upX.value = 0;
      listener.upY.value = 1;
      listener.upZ.value = 0;
    } else {
      // Safari still ships the deprecated API.
      listener.setPosition?.(position.x, position.y, position.z);
      listener.setOrientation?.(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  /** Translate a simulation event into sound. This is the only mapping the game needs. */
  handleEvent(event: SimEvent, isLocalPlayer: boolean): void {
    const at = event.position;
    switch (event.type) {
      case 'jump':
        this.hop(at, event.magnitude, event.material);
        break;
      case 'land':
        this.land(at, event.magnitude, event.material);
        break;
      case 'wallBounce':
        this.impact(at, Math.min(1, event.magnitude / 14), 320);
        break;
      case 'grab':
        this.click(at, event.material === 'wood' ? 520 : 380);
        break;
      case 'release':
        this.click(at, 240, 0.05);
        break;
      case 'climbLaunch':
        this.whoosh(at, 0.5);
        break;
      case 'tag':
        this.tag(at, isLocalPlayer);
        break;
      case 'punchHit':
        this.impact(at, Math.min(1, event.magnitude / 20), event.data === 'head' ? 180 : 120);
        break;
      case 'stagger':
        this.impact(at, 0.5, 90);
        break;
      case 'checkpoint':
        this.chime(at, 660);
        break;
      case 'lapComplete':
        this.chime(at, 880, 3);
        break;
      case 'emote':
        this.chime(at, 520, 2);
        break;
      case 'respawn':
        this.chime(at, 300, 2);
        break;
      default:
        break;
    }
  }

  private panner(at: { x: number; y: number; z: number }): PannerNode | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 3;
    panner.maxDistance = 90;
    panner.rolloffFactor = 1.1;
    panner.positionX.value = at.x;
    panner.positionY.value = at.y;
    panner.positionZ.value = at.z;
    return panner;
  }

  /**
   * Move to a zone's ambience bed, crossfading from whatever was playing.
   *
   * The game had no ambience and no music at all. The `music` bus existed, sat at gain 0.5, and
   * had nothing connected to it — so the Settings screen's music slider controlled silence — while
   * every level declared zones carrying an `ambience` kind that no client code ever read.
   *
   * Each bed is filtered noise with a slow wandering filter, which is what a room *sounds* like:
   * the cave is a narrow low band with a long tail, the jungle a wide airy one, the canyon a
   * mid-band with more movement in it. Synthesised rather than streamed for the same reason
   * everything else here is — no downloads, nothing to decode on a phone, and no licence to
   * record in `assets/packs.json`.
   *
   * Passing the same kind twice does nothing, so this is safe to call every frame.
   */
  setAmbience(kind: AmbienceKind | null): void {
    if (kind === this.ambienceKind) return;
    const ctx = this.ctx;
    const bus = this.buses?.music;
    if (!ctx || !bus) {
      // Remembered anyway: audio starts on a user gesture, and the zone the player spawned in is
      // decided before that. Without this the first bed is the one they walk into, not the one
      // they start in.
      this.ambienceKind = kind;
      return;
    }

    this.ambienceKind = kind;
    this.stopAmbience(ctx);
    if (!kind) return;

    const bed = AMBIENCE[kind];
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = bed.centre;
    filter.Q.value = bed.q;

    // A slow wander across the band, so the bed never settles into an audible loop point. The
    // noise buffer is one second long and would otherwise tick once a second.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = bed.drift;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = bed.centre * 0.45;
    lfo.connect(lfoGain).connect(filter.frequency);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(bed.gain, ctx.currentTime + 1.4);

    source.connect(filter).connect(gain).connect(bus);
    source.start();
    lfo.start();
    this.ambience = { source, lfo, gain };
  }

  get currentAmbience(): AmbienceKind | null {
    return this.ambienceKind;
  }

  /** Fade the running bed out and let it stop itself, so a zone change never clicks. */
  private stopAmbience(ctx: AudioContext): void {
    const running = this.ambience;
    this.ambience = null;
    if (!running) return;

    const end = ctx.currentTime + 1.2;
    running.gain.gain.cancelScheduledValues(ctx.currentTime);
    running.gain.gain.setValueAtTime(Math.max(0.0001, running.gain.gain.value), ctx.currentTime);
    running.gain.gain.exponentialRampToValueAtTime(0.0001, end);
    running.source.stop(end + 0.05);
    running.lfo.stop(end + 0.05);
  }

  /** Rate-limit identical sounds so a crowded room cannot produce a wall of noise. */
  private throttle(key: string, minGapMs: number): boolean {
    const now = performance.now();
    const last = this.lastPlayAt.get(key) ?? -Infinity;
    if (now - last < minGapMs) return false;
    this.lastPlayAt.set(key, now);
    return true;
  }

  private hop(at: { x: number; y: number; z: number }, charge: number, material?: SurfaceMaterial): void {
    const ctx = this.ctx;
    const bus = this.buses?.sfx;
    if (!ctx || !bus || this.muted || !this.throttle('hop', 40)) return;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    const base = 220 + charge * 120 + materialPitch(material);
    osc.frequency.setValueAtTime(base, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(base * 2.1, ctx.currentTime + 0.14);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18 + charge * 0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);

    const panner = this.panner(at);
    osc.connect(gain);
    if (panner) {
      gain.connect(panner);
      panner.connect(bus);
    } else {
      gain.connect(bus);
    }
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
  }

  private land(at: { x: number; y: number; z: number }, speed: number, material?: SurfaceMaterial): void {
    const strength = Math.min(1, speed / 20);
    this.impact(at, 0.25 + strength * 0.75, 60 + materialPitch(material));
  }

  private impact(at: { x: number; y: number; z: number }, strength: number, frequency: number): void {
    const ctx = this.ctx;
    const bus = this.buses?.sfx;
    if (!ctx || !bus || !this.noiseBuffer || this.muted || !this.throttle(`impact${Math.round(frequency)}`, 30)) return;

    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(frequency * 12, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, frequency * 2), ctx.currentTime + 0.16);
    filter.Q.value = 1.2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.05 + strength * 0.35, ctx.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18 + strength * 0.12);

    const panner = this.panner(at);
    source.connect(filter);
    filter.connect(gain);
    if (panner) {
      gain.connect(panner);
      panner.connect(bus);
    } else {
      gain.connect(bus);
    }
    source.start();
    source.stop(ctx.currentTime + 0.35);
  }

  private click(at: { x: number; y: number; z: number }, frequency: number, duration = 0.08): void {
    const ctx = this.ctx;
    const bus = this.buses?.sfx;
    if (!ctx || !bus || this.muted || !this.throttle(`click${frequency}`, 25)) return;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    const panner = this.panner(at);
    osc.connect(gain);
    if (panner) {
      gain.connect(panner);
      panner.connect(bus);
    } else {
      gain.connect(bus);
    }
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  private whoosh(at: { x: number; y: number; z: number }, strength: number): void {
    const ctx = this.ctx;
    const bus = this.buses?.sfx;
    if (!ctx || !bus || !this.noiseBuffer || this.muted) return;

    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(400, ctx.currentTime);
    filter.frequency.linearRampToValueAtTime(1800, ctx.currentTime + 0.25);
    filter.Q.value = 2.5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.1 * strength, ctx.currentTime + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32);

    const panner = this.panner(at);
    source.connect(filter);
    filter.connect(gain);
    if (panner) {
      gain.connect(panner);
      panner.connect(bus);
    } else {
      gain.connect(bus);
    }
    source.start();
    source.stop(ctx.currentTime + 0.34);
  }

  private chime(at: { x: number; y: number; z: number }, frequency: number, notes = 1): void {
    const ctx = this.ctx;
    const bus = this.buses?.sfx;
    if (!ctx || !bus || this.muted) return;
    for (let i = 0; i < notes; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency * (1 + i * 0.26);
      const start = ctx.currentTime + i * 0.09;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      const panner = this.panner(at);
      osc.connect(gain);
      if (panner) {
        gain.connect(panner);
        panner.connect(bus);
      } else {
        gain.connect(bus);
      }
      osc.start(start);
      osc.stop(start + 0.3);
    }
  }

  /** Being tagged is the loudest moment in the game — it must be unmistakable. */
  private tag(at: { x: number; y: number; z: number }, isLocalPlayer: boolean): void {
    this.impact(at, 1, 200);
    this.chime(at, isLocalPlayer ? 320 : 520, isLocalPlayer ? 2 : 3);
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.buses = null;
  }
}

function materialPitch(material?: SurfaceMaterial): number {
  switch (material) {
    case 'rock':
    case 'stone':
      return 40;
    case 'wood':
      return 10;
    case 'foliage':
      return -20;
    case 'water':
      return -35;
    case 'sand':
      return -15;
    case 'metal':
      return 90;
    // Ice rings higher and harder than rock; snow swallows the impact almost entirely.
    case 'ice':
      return 70;
    case 'snow':
      return -45;
    default:
      return 0;
  }
}
