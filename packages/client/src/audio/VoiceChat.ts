import type { AudioSystem } from './AudioSystem.js';

export interface VoiceSignalSender {
  (targetId: string, payload: string, kind: 'offer' | 'answer' | 'ice' | 'leave'): void;
}

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
      return true;
    } catch (error) {
      console.warn('[voice] microphone unavailable:', (error as Error).message);
      this.enabled = false;
      return false;
    }
  }

  disable(): void {
    for (const [id] of this.peers) this.closePeer(id);
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
  async handleSignal(fromId: string, payload: string, kind: 'offer' | 'answer' | 'ice' | 'leave'): Promise<void> {
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
  }

  dispose(): void {
    this.disable();
  }
}
