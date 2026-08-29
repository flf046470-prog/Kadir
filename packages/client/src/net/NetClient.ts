import type { InputIntent, PlayerSnapshot, SimEvent, ModeStateView, MatchResult } from '@kc/core';
import {
  PROTOCOL_VERSION,
  SlotTable,
  decodeJson,
  decodeSnapshot,
  encodeIntent,
  encodeJson,
} from '@kc/net';
import type { ClientHello, ClientMessage, Platform, RosterEntry, ServerMessage } from '@kc/net';

export interface NetHandlers {
  onWelcome(message: Extract<ServerMessage, { t: 'welcome' }>): void;
  onSnapshot(tick: number, players: PlayerSnapshot[]): void;
  onPlayerJoined(entry: RosterEntry): void;
  onPlayerLeft(playerId: string): void;
  onEvents(events: SimEvent[]): void;
  onModeState(state: ModeStateView): void;
  onResults(result: MatchResult, rewards: Record<string, { coins: number; xp: number; achievements: string[] }>): void;
  onChat(playerId: string, name: string, text: string): void;
  onVoiceSignal(fromId: string, payload: string, kind: 'offer' | 'answer' | 'ice' | 'leave'): void;
  onRoomState(state: Extract<ServerMessage, { t: 'room' }>): void;
  onError(code: string, message: string): void;
  onStatusChange(status: NetStatus): void;
}

export type NetStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface ConnectOptions {
  url: string;
  name: string;
  animalId: string;
  cosmetics: Record<string, string>;
  platform: Platform;
  token?: string;
  roomCode?: string;
  modeId?: string;
  crossPlay: boolean;
}

/**
 * WebSocket client.
 *
 * Two channels over one socket: binary frames carry intents up and delta snapshots down, JSON
 * carries the control plane. Reconnection is automatic with backoff, because a dropped phone
 * connection mid-chase should rejoin, not end the session.
 */
export class NetClient {
  private socket: WebSocket | null = null;
  private slots = new SlotTable();
  private baseline = new Map<string, PlayerSnapshot>();
  private handlers: NetHandlers;
  private options: ConnectOptions | null = null;
  private status: NetStatus = 'idle';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  private bytesIn = 0;
  private bytesOut = 0;
  private lastStatsAt = 0;
  private statsIn = 0;
  private statsOut = 0;

  constructor(handlers: NetHandlers) {
    this.handlers = handlers;
  }

  get currentStatus(): NetStatus {
    return this.status;
  }

  /** Bandwidth in bytes/second, refreshed once a second — surfaced in the debug overlay. */
  get bandwidth(): { in: number; out: number } {
    return { in: this.statsIn, out: this.statsOut };
  }

  connect(options: ConnectOptions): void {
    this.options = options;
    this.closedByUser = false;
    this.open();
  }

  private open(): void {
    const options = this.options;
    if (!options) return;
    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    const socket = new WebSocket(options.url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    this.slots = new SlotTable();
    this.baseline.clear();

    socket.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      const hello: ClientHello = {
        t: 'hello',
        protocol: PROTOCOL_VERSION,
        name: options.name,
        animalId: options.animalId,
        cosmetics: options.cosmetics,
        platform: options.platform,
        crossPlay: options.crossPlay,
        ...(options.token ? { token: options.token } : {}),
        ...(options.roomCode ? { roomCode: options.roomCode } : {}),
        ...(options.modeId ? { modeId: options.modeId } : {}),
      };
      this.sendJson(hello);
      this.setStatus('connected');
    });

    socket.addEventListener('message', (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.bytesIn += event.data.byteLength;
        this.handleBinary(new Uint8Array(event.data));
      } else {
        const text = String(event.data);
        this.bytesIn += text.length;
        this.handleJson(text);
      }
      this.updateStats();
    });

    socket.addEventListener('close', () => {
      this.socket = null;
      if (this.closedByUser) {
        this.setStatus('idle');
        return;
      }
      this.scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      // 'close' always follows; reconnection is handled there.
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectAttempts++;
    if (this.reconnectAttempts > 6) {
      this.setStatus('offline');
      return;
    }
    const delay = Math.min(8000, 400 * 2 ** (this.reconnectAttempts - 1));
    this.setStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private handleBinary(data: Uint8Array): void {
    try {
      const decoded = decodeSnapshot(data, this.slots, this.baseline);
      for (const player of decoded.players) this.baseline.set(player.id, player);
      this.handlers.onSnapshot(decoded.tick, decoded.players);
    } catch {
      // A corrupt frame is dropped; the next full snapshot re-syncs the baseline.
    }
  }

  private handleJson(raw: string): void {
    const message = decodeJson<ServerMessage>(raw);
    if (!message) return;
    switch (message.t) {
      case 'welcome':
        this.applySlots(message.slots);
        this.handlers.onWelcome(message);
        break;
      case 'joined':
        this.slots.assign(message.player.id);
        this.handlers.onPlayerJoined(message.player);
        break;
      case 'left':
        this.slots.release(message.playerId);
        this.baseline.delete(message.playerId);
        this.handlers.onPlayerLeft(message.playerId);
        break;
      case 'events':
        this.handlers.onEvents(message.events);
        break;
      case 'mode':
        this.handlers.onModeState(message.state);
        break;
      case 'results':
        this.handlers.onResults(message.result, message.rewards);
        break;
      case 'chat':
        this.handlers.onChat(message.playerId, message.name, message.text);
        break;
      case 'voice':
        this.handlers.onVoiceSignal(message.fromId, message.payload, message.kind);
        break;
      case 'room':
        this.handlers.onRoomState(message);
        break;
      case 'error':
        this.handlers.onError(message.code, message.message);
        break;
      default:
        break;
    }
  }

  /** Adopt the server's slot numbering verbatim: snapshots are addressed by slot. */
  private applySlots(entries: [string, number][]): void {
    this.slots = new SlotTable();
    for (const [id, slot] of entries) this.slots.setSlot(id, slot);
  }

  sendIntent(intent: InputIntent): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const bytes = encodeIntent(intent);
    this.bytesOut += bytes.byteLength;
    this.socket.send(bytes);
  }

  sendJson(message: ClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const text = encodeJson(message);
    this.bytesOut += text.length;
    this.socket.send(text);
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close(1000, 'client');
    this.socket = null;
    this.setStatus('idle');
  }

  private setStatus(status: NetStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.handlers.onStatusChange(status);
  }

  private updateStats(): void {
    const now = Date.now();
    if (now - this.lastStatsAt < 1000) return;
    this.statsIn = this.bytesIn;
    this.statsOut = this.bytesOut;
    this.bytesIn = 0;
    this.bytesOut = 0;
    this.lastStatsAt = now;
  }
}
