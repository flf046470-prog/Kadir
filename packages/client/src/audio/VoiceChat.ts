import { proximityGainAt } from '@kc/core';
import type { AudioSystem } from './AudioSystem.js';

export type SignalKind = 'offer' | 'answer' | 'ice' | 'leave';

export interface VoiceSignalSender {
  (targetId: string, payload: string, kind: SignalKind): void;
}

/** How many not-yet-answerable signals to hold while the microphone is still opening. */
const MAX_PENDING_SIGNALS = 32;

interface Peer {
  connection: RTCPeerConnection;
  panner: PannerNode | null;
  /** Proximity falloff, applied on top of the panner. See `updatePositions`. */
  proximity: GainNode | null;
  element: HTMLAudioElement | null;
  polite: boolean;
  makingOffer: boolean;
}

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * Spatial voice chat over a WebRTC mesh.
 *
 * Audio is peer-to-peer — the server only relays signalling and never sees or stores voice.
 * Each remote stream runs through a `PannerNode` positioned at that player's avatar, so someone
 * chasing you *sounds* like they are behind you. A mesh is the right shape up to ~16 players;
 * beyond that this class is the seam where an SFU would slot in.
 */
export class VoiceChat {
  private peers = new Map<string, Peer>();
  /** Applied to peers that connect later, so the preference survives a reconnect. */
  private panningModel: PanningModelType = 'HRTF';
  /** One promise chain per peer, so signals are handled in the order the wire delivered them. */
  private signalChain = new Map<string, Promise<void>>();
  /**
   * Signals that arrived before the microphone was ready, kept so they can be answered.
   *
   * Dropping them was the last and worst of the three ways voice failed to connect. Asking for
   * the microphone is slow and joining a match is fast, so the other player's offer routinely
   * landed in the gap — and an offer refused here is never sent again, because the offerer has no
   * idea it was thrown away. Its ICE candidates then arrived a moment later, once the microphone
   * *was* ready, and built a peer connection with no remote description at all: the state we
   * measured, with one peer stuck in "stable", no answer ever sent, and
   * `addIceCandidate: The remote description was null` in the log.
   *
   * Capped, because this is a buffer fed by another client. 32 is far more than a negotiation
   * needs and small enough that a peer spraying signals at a player who never grants a microphone
   * costs nothing.
   */
  private pendingSignals: { fromId: string; payload: string; kind: SignalKind }[] = [];
  private localStream: MediaStream | null = null;
  private enabled = false;
  private muted = false;
  /**
   * Whether the gate currently lets audio out.
   *
   * Separate from `muted` because they mean different things to a player: mute is a switch you
   * threw, this is the push-to-talk key or the voice gate deciding moment to moment. Both end at
   * the same `track.enabled`, and the HUD shows them differently.
   */
  private transmitting = false;
  /** The input the player picked, so re-opening the microphone keeps it. */
  private deviceId = '';
  private localId = '';
  private blocked = new Set<string>();
  /**
   * Local microphone loudness, 0..1.
   *
   * Measured here rather than in the renderer because this is the only place that holds the
   * local stream. It drives the avatar's jaw for *everyone* — the value travels in the intent,
   * so a listener whose peer connection to this player failed still sees the right mouth.
   */
  private analyser: AnalyserNode | null = null;
  private analyserSource: MediaStreamAudioSourceNode | null = null;
  /** The gate itself: 1 while transmitting, 0 otherwise. See `startLevelMeter` for why. */
  private gateGain: GainNode | null = null;
  private gateDestination: MediaStreamAudioDestinationNode | null = null;
  private levelBuffer = new Uint8Array(new ArrayBuffer(0));
  private smoothedLevel = 0;

  constructor(
    private readonly audio: AudioSystem,
    private readonly send: VoiceSignalSender,
  ) {}

  get isEnabled(): boolean {
    return this.enabled;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get peerCount(): number {
    return this.peers.size;
  }

  setLocalId(id: string): void {
    this.localId = id;
  }

  /** Is the gate letting audio out this instant? */
  get isTransmitting(): boolean {
    return this.transmitting;
  }

  /** Which input is open, or '' for the system default. */
  get inputDeviceId(): string {
    return this.deviceId;
  }

  /** Ask for the microphone. Must follow a user gesture; failure is non-fatal. */
  async enable(deviceId = this.deviceId): Promise<boolean> {
    if (this.enabled) return true;
    try {
      this.deviceId = deviceId;
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // `exact` would reject outright when the chosen headset is unplugged. A preference
          // falls back to the system default instead, which is the behaviour a player wants from
          // a device they picked once and forgot about.
          ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
        },
        video: false,
      });
      this.enabled = true;
      // Shut until something asks for it. Opening a microphone is not consent to broadcast from
      // it, and the frame loop turns the gate on within a tick of the player earning it.
      this.transmitting = false;
      this.applyTrackState();
      this.startLevelMeter();
      this.flushPendingSignals();
      return true;
    } catch (error) {
      console.warn('[voice] microphone unavailable:', (error as Error).message);
      this.enabled = false;
      // Nothing can ever be answered without a microphone, so holding these would only leak.
      this.pendingSignals = [];
      return false;
    }
  }

  /** Replay whatever arrived while the microphone was opening, in the order it arrived. */
  private flushPendingSignals(): void {
    const queued = this.pendingSignals;
    this.pendingSignals = [];
    for (const signal of queued) void this.handleSignal(signal.fromId, signal.payload, signal.kind);
  }

  disable(): void {
    for (const [id] of this.peers) this.closePeer(id);
    this.pendingSignals = [];
    this.stopLevelMeter();
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    this.enabled = false;
    // Or re-enabling would come back mid-transmission, on a gate nobody reopened.
    this.transmitting = false;
  }

  /**
   * Build the local microphone graph: a measuring tap and a gate, in that order.
   *
   *     getUserMedia -> source -+-> analyser                      (always live)
   *                             +-> gateGain -> destination -> the track peers receive
   *
   * The shape matters, and it was measured rather than guessed. The obvious gate is
   * `track.enabled = false` on the microphone track, and in Chromium that makes an analyser
   * reading the same track return exactly 0.000 — so an open mic would deadlock on itself: gate
   * shut, meter silent, nothing to open the gate with, forever. The same measurement with a gain
   * node at 0 leaves the analyser reading 0.76 while the outbound track carries silence, which is
   * the behaviour this needs. It also kills lip sync for a push-to-talk player mid-word, since
   * the jaw is driven from the same meter.
   *
   * Non-fatal on failure: without an AudioContext there is no gate node, so `applyTrackState`
   * falls back to `track.enabled` — push-to-talk still works exactly, and open mic degrades to
   * the Talk key, which is stated in the settings panel rather than hidden.
   */
  private startLevelMeter(): void {
    const context = this.audio.context;
    if (!context || !this.localStream) return;
    try {
      this.analyserSource = context.createMediaStreamSource(this.localStream);
      this.analyser = context.createAnalyser();
      // 512 is enough resolution for an amplitude envelope and cheap to read every frame.
      this.analyser.fftSize = 512;
      this.levelBuffer = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
      this.analyserSource.connect(this.analyser);
      // The analyser is deliberately not connected onward: that branch is for measurement, and
      // routing the microphone to the speakers is how you give someone feedback howl in a headset.

      this.gateGain = context.createGain();
      this.gateGain.gain.value = 0;
      this.gateDestination = context.createMediaStreamDestination();
      this.analyserSource.connect(this.gateGain);
      this.gateGain.connect(this.gateDestination);
      this.applyTrackState();
    } catch (error) {
      console.warn('[voice] level meter unavailable:', (error as Error).message);
      this.analyser = null;
      this.gateGain = null;
      this.gateDestination = null;
    }
  }

  /**
   * The track peers should receive: the gated one when the graph built, the raw one otherwise.
   *
   * Every place that hands a track to a peer connection goes through here, so there is exactly
   * one answer to "what do other people hear" and no path that accidentally sends the ungated
   * microphone.
   */
  private outboundTracks(): MediaStreamTrack[] {
    const gated = this.gateDestination?.stream.getAudioTracks() ?? [];
    if (gated.length > 0) return gated;
    return this.localStream?.getAudioTracks() ?? [];
  }

  private stopLevelMeter(): void {
    this.analyserSource?.disconnect();
    this.analyser?.disconnect();
    this.gateGain?.disconnect();
    this.gateDestination?.disconnect();
    this.gateDestination?.stream.getTracks().forEach((track) => track.stop());
    this.analyserSource = null;
    this.analyser = null;
    this.gateGain = null;
    this.gateDestination = null;
    this.smoothedLevel = 0;
  }

  /**
   * Current mic loudness, 0..1, smoothed.
   *
   * RMS of the time-domain samples rather than a peak, because a peak follows consonants and
   * makes the jaw snap; RMS follows the envelope of speech, which is what a mouth does. Returns
   * 0 while muted or disabled, so a muted player's avatar keeps its mouth shut.
   */
  get level(): number {
    if (!this.analyser || this.muted || !this.enabled) {
      this.smoothedLevel = 0;
      return 0;
    }
    this.analyser.getByteTimeDomainData(this.levelBuffer);
    let sum = 0;
    for (const sample of this.levelBuffer) {
      const centred = (sample - 128) / 128;
      sum += centred * centred;
    }
    const rms = Math.sqrt(sum / Math.max(1, this.levelBuffer.length));
    // Speech RMS sits well below 1; scale it into a usable range and clamp.
    const scaled = Math.min(1, rms * 4);
    // Asymmetric smoothing: open quickly, close slowly. A mouth that shuts between syllables
    // reads as a glitch, and one that opens late reads as bad sync.
    const rate = scaled > this.smoothedLevel ? 0.55 : 0.15;
    this.smoothedLevel += (scaled - this.smoothedLevel) * rate;
    return this.smoothedLevel;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyTrackState();
  }

  /**
   * Open or close the gate. Driven every frame from the client's `MicGate`.
   *
   * `track.enabled = false` is the right lever rather than removing the track or renegotiating:
   * it makes the sender transmit silence immediately, with no round trip to the peer and nothing
   * for a peer to get wrong, and flipping it back is equally instant — which matters, because the
   * time between pressing push-to-talk and being audible is the time a player loses their first
   * word in.
   */
  setTransmitting(on: boolean): void {
    if (this.transmitting === on) return;
    this.transmitting = on;
    this.applyTrackState();
  }

  /**
   * Swap to a different microphone, keeping every peer connection up.
   *
   * `replaceTrack` on each sender rather than tearing the call down: renegotiating would drop
   * audio for a second or two on every peer, and the player is most likely doing this *because*
   * nobody can hear them.
   */
  async setInputDevice(deviceId: string): Promise<boolean> {
    if (deviceId === this.deviceId && this.localStream) return true;
    this.deviceId = deviceId;
    if (!this.enabled) return true;

    let replacement: MediaStream;
    try {
      replacement = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
        },
        video: false,
      });
    } catch (error) {
      console.warn('[voice] could not open that microphone:', (error as Error).message);
      return false;
    }

    const track = replacement.getAudioTracks()[0];
    if (!track) {
      replacement.getTracks().forEach((t) => t.stop());
      return false;
    }

    const previous = this.localStream;
    this.localStream = replacement;

    // Rebuilt *before* the senders are repointed, and in this order for a reason: the meter and
    // the gate are one graph hanging off the old stream's source node, so tearing it down also
    // destroys the gated track the peers are currently sending. Repointing them at
    // `replacement`'s own track instead would hand every peer the ungated microphone.
    this.stopLevelMeter();
    this.startLevelMeter();

    const outbound = this.outboundTracks()[0] ?? track;
    for (const peer of this.peers.values()) {
      for (const sender of peer.connection.getSenders()) {
        if (sender.track?.kind === 'audio') void sender.replaceTrack(outbound).catch(() => undefined);
      }
    }

    previous?.getTracks().forEach((t) => t.stop());
    return true;
  }

  /**
   * The microphones this browser will admit to having.
   *
   * Labels are empty until permission has been granted at least once, which is why the settings
   * panel offers this only after voice has been switched on — a list of four blank entries is
   * worse than no list.
   */
  static async listInputs(): Promise<{ deviceId: string; label: string }[]> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((device) => device.kind === 'audioinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${index + 1}`,
        }));
    } catch {
      return [];
    }
  }

  /**
   * Mute and the gate both land here; either one closed means silence on the wire.
   *
   * Mute additionally cuts the raw track. The gate cannot — that would blind the meter it is
   * driven by — but mute has no such problem, because a muted player's meter reads 0 anyway and
   * their gate is held shut regardless. So the one control a player reaches for when they need to
   * be *certain* gets the hard cut at the source as well as the gain, and no single failure in
   * the graph can leak it.
   */
  private applyTrackState(): void {
    const live = this.transmitting && !this.muted;
    if (this.gateGain) {
      const context = this.audio.context;
      const now = context?.currentTime ?? 0;
      // A short ramp rather than a step: a gain that jumps between 0 and 1 mid-waveform clicks,
      // and 12 ms is below the threshold where anyone hears it as a fade-in on their first word.
      this.gateGain.gain.cancelScheduledValues(now);
      this.gateGain.gain.setValueAtTime(this.gateGain.gain.value, now);
      this.gateGain.gain.linearRampToValueAtTime(live ? 1 : 0, now + 0.012);
    }
    this.localStream?.getAudioTracks().forEach((track) => {
      // Without the gain node this is the only gate there is; with it, this is mute's hard cut.
      track.enabled = this.gateGain ? !this.muted : live;
    });
  }

  setBlocked(ids: Iterable<string>): void {
    this.blocked = new Set(ids);
    for (const id of this.blocked) this.closePeer(id);
  }

  /** Start a connection to a peer. The lower id makes the offer, so both sides never do. */
  async connectTo(peerId: string): Promise<void> {
    if (!this.enabled || this.blocked.has(peerId) || this.peers.has(peerId)) return;
    const peer = this.createPeer(peerId);
    if (this.localId < peerId) {
      await this.makeOffer(peerId, peer);
    }
  }

  /**
   * Call everyone already here.
   *
   * The microphone is asked for while the match is being joined, and `getUserMedia` takes long
   * enough that the roster almost always lands first. Every `connectTo` fired from that roster
   * then returned immediately at `!this.enabled`, and nothing ever tried again — so a player who
   * joined a room that already had people in it was permanently silent to all of them, while
   * anyone arriving *after* their microphone was ready connected fine. Measured: two clients in
   * one private room, zero peer connections on the joining side.
   *
   * Reconnecting the whole roster once the microphone is live fixes that, and the same call
   * covers switching voice on from the settings panel mid-match, which was broken in exactly the
   * same way and for the same reason.
   */
  connectToAll(peerIds: Iterable<string>): void {
    if (!this.enabled) return;
    for (const id of peerIds) void this.connectTo(id);
  }

  private createPeer(peerId: string): Peer {
    const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer: Peer = { connection, panner: null, proximity: null, element: null, polite: this.localId > peerId, makingOffer: false };
    this.peers.set(peerId, peer);

    // The gated track, never the raw microphone — see `outboundTracks`.
    const outbound = this.outboundTracks();
    const stream = this.gateDestination?.stream ?? this.localStream;
    for (const track of outbound) {
      if (stream) connection.addTrack(track, stream);
    }

    connection.addEventListener('icecandidate', (event) => {
      if (event.candidate) this.send(peerId, JSON.stringify(event.candidate), 'ice');
    });

    connection.addEventListener('track', (event) => {
      const [stream] = event.streams;
      if (stream) this.attachRemoteStream(peerId, stream);
    });

    connection.addEventListener('connectionstatechange', () => {
      if (connection.connectionState === 'failed' || connection.connectionState === 'closed') {
        this.closePeer(peerId);
      }
    });

    return peer;
  }

  private async makeOffer(peerId: string, peer: Peer): Promise<void> {
    try {
      peer.makingOffer = true;
      const offer = await peer.connection.createOffer();
      await peer.connection.setLocalDescription(offer);
      this.send(peerId, JSON.stringify(offer), 'offer');
    } catch (error) {
      console.warn('[voice] offer failed:', (error as Error).message);
    } finally {
      peer.makingOffer = false;
    }
  }

  /**
   * Handle an incoming signal. Uses the "perfect negotiation" pattern so a glare (both sides
   * offering at once) resolves deterministically instead of deadlocking the call.
   */
  /**
   * Handle a signal, strictly after the previous one from the same peer has finished.
   *
   * Signals arrive on one websocket and so arrive in order, but handling them did not stay in
   * order: the caller fires `void handleSignal(...)` per message, and each one awaits. An `ice`
   * landing while `setRemoteDescription(offer)` was still in flight therefore ran *first*, threw
   * `Failed to execute 'addIceCandidate': The remote description was null`, and the candidate was
   * dropped — there is no retry, so on a connection with few candidates that alone can mean the
   * call never completes. Observed in a two-client run: two candidates lost that way, no answer
   * ever sent, both peers stuck.
   *
   * A promise chain per peer restores the ordering the wire already had. It is per peer rather
   * than global so one slow negotiation cannot hold up an unrelated one.
   */
  handleSignal(fromId: string, payload: string, kind: SignalKind): Promise<void> {
    // Held rather than dropped while the microphone is still opening — see `pendingSignals`.
    // "leave" is the exception: it needs no microphone and tearing a peer down is always safe.
    if (!this.enabled && kind !== 'leave') {
      if (this.pendingSignals.length < MAX_PENDING_SIGNALS) this.pendingSignals.push({ fromId, payload, kind });
      return Promise.resolve();
    }
    const previous = this.signalChain.get(fromId) ?? Promise.resolve();
    const next = previous.then(() => this.processSignal(fromId, payload, kind));
    // The chain must survive a rejection, or one bad signal wedges every later one from that peer.
    this.signalChain.set(
      fromId,
      next.catch(() => undefined),
    );
    return next;
  }

  private async processSignal(
    fromId: string,
    payload: string,
    kind: SignalKind,
  ): Promise<void> {
    if (this.blocked.has(fromId)) return;
    if (kind === 'leave') {
      this.closePeer(fromId);
      return;
    }
    if (!this.enabled) return;

    let peer = this.peers.get(fromId);
    if (!peer) peer = this.createPeer(fromId);

    try {
      const data = JSON.parse(payload) as RTCSessionDescriptionInit | RTCIceCandidateInit;
      if (kind === 'ice') {
        await peer.connection.addIceCandidate(data as RTCIceCandidateInit);
        return;
      }

      const description = data as RTCSessionDescriptionInit;
      const offerCollision =
        description.type === 'offer' && (peer.makingOffer || peer.connection.signalingState !== 'stable');
      if (offerCollision && !peer.polite) return;

      await peer.connection.setRemoteDescription(description);
      if (description.type === 'offer') {
        const answer = await peer.connection.createAnswer();
        await peer.connection.setLocalDescription(answer);
        this.send(fromId, JSON.stringify(answer), 'answer');
      }
    } catch (error) {
      console.warn('[voice] signal failed:', (error as Error).message);
    }
  }

  private attachRemoteStream(peerId: string, stream: MediaStream): void {
    const peer = this.peers.get(peerId);
    const ctx = this.audio.context;
    const bus = this.audio.voiceBus;
    if (!peer || !ctx || !bus) return;

    // Chrome only pumps a remote stream through WebAudio once it is attached to a media element,
    // so keep a muted <audio> alive alongside the graph.
    const element = document.createElement('audio');
    element.srcObject = stream;
    element.muted = true;
    element.autoplay = true;
    void element.play().catch(() => undefined);
    peer.element = element;

    const source = ctx.createMediaStreamSource(stream);
    const panner = ctx.createPanner();
    panner.panningModel = this.panningModel;
    panner.distanceModel = 'inverse';
    panner.refDistance = 4;
    panner.maxDistance = 45;
    panner.rolloffFactor = 1.6;
    const proximity = ctx.createGain();
    proximity.gain.value = 1;
    source.connect(panner);
    panner.connect(proximity);
    proximity.connect(bus);
    peer.panner = panner;
    peer.proximity = proximity;
  }

  /**
   * How a voice is placed in the stereo field — **not** whether distance still quietens it.
   *
   * `audio.spatialVoice` was declared, defaulted on, merged from storage and read by nothing. The
   * obvious reading of "spatial voice: off" is to bypass the panner, and that would be a cheat:
   * `refDistance`/`rolloffFactor` on this node are the *only* thing attenuating a distant player,
   * because `proximityGain` in `social.ts` is exported, documented, unit tested and called by
   * nobody. Turning the panner off would let anyone hear the whole map at full volume.
   *
   * So the switch does what it can safely do: HRTF convolution, which is the 3D cue, against plain
   * equal-power stereo. That is a real accessibility and CPU option — HRTF is tiring for some
   * listeners and fights a hearing aid — and it cannot become an advantage, because every distance
   * term is untouched.
   */
  setSpatial(spatial: boolean): void {
    this.panningModel = spatial ? 'HRTF' : 'equalpower';
    for (const peer of this.peers.values()) {
      if (peer.panner) peer.panner.panningModel = this.panningModel;
    }
  }

  /**
   * Called every frame with each speaker's world position, and the listener's.
   *
   * The panner places a voice; this decides whether it carries. `proximityGainAt` is the game's
   * own rule — full volume to `VOICE_NEAR`, silence past `VOICE_FAR`, linear between — and it was
   * exported, documented, unit tested and called by nobody, so the only falloff was the panner's
   * inverse curve out to 45 m. Two players forty metres apart could hold a conversation on a map
   * whose whole subject is breaking line of sight.
   *
   * This makes an honest client obey the documented rule. It does **not** make proximity voice
   * enforceable: this is a WebRTC mesh, every peer already receives every stream, and a modified
   * client can simply not turn its own gain down. Enforcing it means putting the server in the
   * audio path — the SFU already listed as a known gap.
   */
  updatePositions(
    positions: Map<string, { x: number; y: number; z: number }>,
    listener?: { x: number; y: number; z: number },
  ): void {
    const ctx = this.audio.context;
    for (const [id, peer] of this.peers) {
      const position = positions.get(id);
      if (!peer.panner || !position) continue;
      peer.panner.positionX.value = position.x;
      peer.panner.positionY.value = position.y;
      peer.panner.positionZ.value = position.z;
      if (!peer.proximity || !listener || !ctx) continue;
      const distance = Math.hypot(position.x - listener.x, position.y - listener.y, position.z - listener.z);
      // Ramped rather than assigned: a gain that steps every frame as someone walks clicks.
      peer.proximity.gain.setTargetAtTime(proximityGainAt(distance), ctx.currentTime, 0.05);
    }
  }

  closePeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.connection.close();
    peer.panner?.disconnect();
    if (peer.element) {
      peer.element.srcObject = null;
      peer.element.remove();
    }
    this.peers.delete(peerId);
    // Dropped with the peer: a chain kept past the connection it ordered would make the next call
    // to that player wait on signals for a connection that no longer exists.
    this.signalChain.delete(peerId);
  }

  dispose(): void {
    this.disable();
  }
}
