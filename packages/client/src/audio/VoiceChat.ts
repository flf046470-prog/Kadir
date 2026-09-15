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

  /** Ask for the microphone. Must follow a user gesture; failure is non-fatal. */
  async enable(): Promise<boolean> {
    if (this.enabled) return true;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      this.enabled = true;
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
  }

  /**
   * Attach an analyser to the local microphone.
   *
   * Non-fatal on failure: a missing AudioContext costs lip sync, not voice, and a browser that
   * refuses the node should not take the microphone down with it.
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
      // Deliberately not connected onward: this branch is for measurement, and routing the
      // microphone to the speakers is how you give someone feedback howl in a headset.
    } catch (error) {
      console.warn('[voice] level meter unavailable:', (error as Error).message);
      this.analyser = null;
    }
  }

  private stopLevelMeter(): void {
    this.analyserSource?.disconnect();
    this.analyser?.disconnect();
    this.analyserSource = null;
    this.analyser = null;
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
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
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
    const peer: Peer = { connection, panner: null, element: null, polite: this.localId > peerId, makingOffer: false };
    this.peers.set(peerId, peer);

    for (const track of this.localStream?.getTracks() ?? []) {
      connection.addTrack(track, this.localStream as MediaStream);
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
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 4;
    panner.maxDistance = 45;
    panner.rolloffFactor = 1.6;
    source.connect(panner);
    panner.connect(bus);
    peer.panner = panner;
  }

  /** Called every frame with each speaker's world position. Distance does the rest. */
  updatePositions(positions: Map<string, { x: number; y: number; z: number }>): void {
    for (const [id, peer] of this.peers) {
      const position = positions.get(id);
      if (!peer.panner || !position) continue;
      peer.panner.positionX.value = position.x;
      peer.panner.positionY.value = position.y;
      peer.panner.positionZ.value = position.z;
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
