import type { MatchResult, ModeStateView, SimEvent } from '@kc/core';

export type Platform = 'pc' | 'mobile' | 'vr';

/** Control plane — infrequent, so JSON is the right trade (debuggable, versionable). */
export interface ClientHello {
  t: 'hello';
  protocol: number;
  name: string;
  animalId: string;
  cosmetics: Record<string, string>;
  platform: Platform;
  /** Join a specific room, or omit for matchmaking. */
  roomCode?: string;
  modeId?: string;
  /**
   * House rules for a player-authored variant, sent when creating a private room.
   *
   * Deliberately `unknown` on the wire: the server sanitises it into a `ModeConfig`, and typing
   * it here would invite a client to believe its shape was trusted.
   */
  modeConfig?: unknown;
  /**
   * Which map to play, when this hello ends up *creating* a room.
   *
   * Ignored when joining an existing one, which is already playing whatever it is playing — so
   * this can never move a player who is already in a match. An unknown id falls back to the
   * rotation rather than failing the join, because a client older than a map must still connect.
   */
  levelId?: string;
  /** Opaque session token issued by the account service; the server resolves the player id. */
  token?: string;
  crossPlay: boolean;
}

export interface ClientLeave {
  t: 'leave';
}

export interface ClientChat {
  t: 'chat';
  text: string;
  /** Omitted means the whole room. `team` reaches only players sharing your role. */
  channel?: 'room' | 'team';
}

export interface ClientEquip {
  t: 'equip';
  animalId?: string;
  slot?: string;
  cosmeticId?: string | null;
}

export interface ClientVoiceSignal {
  t: 'voice';
  targetId: string;
  /** Opaque WebRTC SDP/ICE payload; the server only relays it. */
  payload: string;
  kind: 'offer' | 'answer' | 'ice' | 'leave';
}

export interface ClientVote {
  t: 'vote';
  modeId: string;
}

export interface ClientReport {
  t: 'report';
  targetId: string;
  reason: string;
}

export interface ClientModeration {
  t: 'moderate';
  action: 'mute' | 'unmute' | 'block' | 'unblock';
  targetId: string;
}

export interface ClientReady {
  t: 'ready';
  ready: boolean;
}

/** Buy a gadget from the in-round shop with round cash. Modes without a shop ignore it. */
export interface ClientShop {
  t: 'shop';
  gadgetId: string;
}

export type ClientMessage =
  | ClientHello
  | ClientLeave
  | ClientChat
  | ClientEquip
  | ClientVoiceSignal
  | ClientVote
  | ClientReport
  | ClientModeration
  | ClientReady
  | ClientShop;

export interface ServerWelcome {
  t: 'welcome';
  playerId: string;
  roomCode: string;
  isPrivate: boolean;
  levelId: string;
  levelSeed: number;
  levelFingerprint: string;
  modeId: string;
  tickRate: number;
  serverTick: number;
  /** Slot assignments so the client can decode snapshots immediately. */
  slots: [string, number][];
  players: RosterEntry[];
}

export interface RosterEntry {
  id: string;
  name: string;
  animalId: string;
  cosmetics: Record<string, string>;
  platform: Platform;
  slot: number;
}

export interface ServerPlayerJoined {
  t: 'joined';
  player: RosterEntry;
}

export interface ServerPlayerLeft {
  t: 'left';
  playerId: string;
}

export interface ServerEvents {
  t: 'events';
  events: SimEvent[];
}

export interface ServerModeState {
  t: 'mode';
  state: ModeStateView;
}

export interface ServerResults {
  t: 'results';
  result: MatchResult;
  /** Per-player rewards, computed server-side. */
  rewards: Record<string, { coins: number; xp: number; achievements: string[] }>;
}

export interface ServerChat {
  t: 'chat';
  playerId: string;
  name: string;
  text: string;
  channel: 'room' | 'team' | 'system';
}

/**
 * Why a message of yours was not sent. Delivered only to the sender.
 *
 * Everyone else sees nothing at all: telling a room that someone's message was filtered is
 * itself a delivered message, and a reliable way to make the filter into a game.
 */
export interface ServerChatRejected {
  t: 'chat-rejected';
  reason: string;
  message: string;
}

export interface ServerVoiceSignal {
  t: 'voice';
  fromId: string;
  payload: string;
  kind: 'offer' | 'answer' | 'ice' | 'leave';
}

/**
 * The player's own equipment, sent only to them.
 *
 * Cash and remaining charges are private: broadcasting them would tell the hunter exactly what
 * every survivor can still afford. What everyone *can* see — armour, the gadget in hand — travels
 * in the snapshot instead.
 */
export interface ServerGear {
  t: 'gear';
  cash: number;
  slots: (string | null)[];
  selected: number;
  charges: Record<string, number>;
  /** Priced stock for the in-round shop, empty in modes that do not run one. */
  shop: { id: string; name: string; cost: number }[];
}

export interface ServerError {
  t: 'error';
  code: 'protocol' | 'full' | 'banned' | 'rate-limit' | 'bad-request' | 'not-found' | 'name-rejected';
  message: string;
}

/**
 * One row of the lobby list.
 *
 * Deliberately smaller than `RosterEntry`: the lobby needs to say who is here and whether they
 * are ready, and nothing about cosmetics or slots belongs on a message that is rebroadcast every
 * time somebody presses a button.
 */
export interface LobbyPlayer {
  id: string;
  name: string;
  animalId: string;
  ready: boolean;
}

export interface ServerRoomState {
  t: 'room';
  roomCode: string;
  isPrivate: boolean;
  modeId: string;
  playerCount: number;
  maxPlayers: number;
  votes: Record<string, number>;
  /**
   * Everyone in the room, with their ready state.
   *
   * Added because `playerCount` alone cannot answer the question a lobby exists to answer: a
   * player who shares a room code wants to see their friend arrive by name, not watch a number
   * change from 1 to 2 and hope. The server already tracked `ready` per client — `handleReady`
   * wrote it on every request — but nothing ever read the field or sent it anywhere, so the
   * ready button was wired end to end into a value no one could see.
   */
  players: LobbyPlayer[];
}

export type ServerMessage =
  | ServerWelcome
  | ServerPlayerJoined
  | ServerPlayerLeft
  | ServerEvents
  | ServerModeState
  | ServerResults
  | ServerChat
  | ServerChatRejected
  | ServerGear
  | ServerVoiceSignal
  | ServerError
  | ServerRoomState;

export function encodeJson(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

export function decodeJson<T extends ClientMessage | ServerMessage>(raw: string): T | null {
  try {
    const parsed = JSON.parse(raw) as T;
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as { t?: unknown }).t !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}
