import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { sanitizeName } from '@kc/core';
import { PROTOCOL_VERSION, decodeJson } from '@kc/net';
import type { ClientMessage, ServerMessage } from '@kc/net';
import type { AccountService } from './accounts.js';
import type { ServerConfig } from './config.js';
import type { RoomManager } from './rooms.js';
import type { ClientSocket, Room } from './room.js';

interface Connection {
  socket: WebSocket;
  playerId: string | null;
  room: Room | null;
  /** Token-bucket rate limiting: a flooding client is disconnected, not merely ignored. */
  budget: number;
  lastRefill: number;
}

/**
 * WebSocket gateway.
 *
 * Binary frames are gameplay intents (hot path). Text frames are control-plane JSON. A
 * connection must say hello before anything else, and every message is rate limited.
 */
export function attachGateway(server: Server, config: ServerConfig, accounts: AccountService, rooms: RoomManager): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

  wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
    if (!originAllowed(config, request)) {
      socket.close(4003, 'origin');
      return;
    }

    const connection: Connection = { socket, playerId: null, room: null, budget: config.messageRateLimit, lastRefill: Date.now() };
    const client = wrapSocket(socket);

    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (!consumeBudget(connection, config)) {
        send(client, { t: 'error', code: 'rate-limit', message: 'Too many messages' });
        socket.close(4008, 'rate-limit');
        return;
      }

      // Nothing a single socket does may end the process. Every room on this box shares one
      // Node process and one tick loop, so an exception escaping here is not one player's bug —
      // it is every player in every match losing their game at once.
      //
      // This is not hypothetical caution. `{"t":"chat","text":{"toString":"not a function"}}`
      // used to be a complete remote kill: `String(...)` throws `TypeError: Cannot convert
      // object to primitive value` for such an object, the throw crossed an `async` boundary as
      // an unhandled rejection, and Node exits on those. The individual coercions below are
      // total now, but the point of a boundary is that it holds for the mistakes not yet found.
      try {
        if (isBinary) {
          if (!connection.playerId || !connection.room) return;
          connection.room.handleIntent(connection.playerId, new Uint8Array(data));
          return;
        }

        const message = decodeJson<ClientMessage>(data.toString('utf8'));
        if (!message || typeof message !== 'object') return;
        // `handleControl` is async, so a synchronous throw inside it arrives as a rejected
        // promise; `void` would discard it and Node would terminate on the unhandled rejection.
        handleControl(connection, client, message, config, accounts, rooms).catch((err) => {
          dropMisbehaving(connection, client, err);
        });
      } catch (err) {
        dropMisbehaving(connection, client, err);
      }
    });

    socket.on('close', () => {
      if (connection.room && connection.playerId) connection.room.leave(connection.playerId);
      connection.room = null;
    });

    socket.on('error', () => {
      socket.close();
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.readyState === socket.OPEN) socket.ping();
    }
  }, 20_000);
  heartbeat.unref?.();
  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}

/**
 * Close one socket after its message threw, and leave everyone else playing.
 *
 * Logged rather than silent: a client that provokes an exception is either broken or hostile,
 * and an operator who cannot see that has no way to tell the two apart.
 */
function dropMisbehaving(connection: Connection, client: ClientSocket, err: unknown): void {
  console.error(`gateway: dropping a connection after an error handling its message: ${String((err as Error)?.message ?? err)}`);
  try {
    send(client, { t: 'error', code: 'bad-request', message: 'Malformed message' });
    connection.socket.close(4009, 'bad-message');
  } catch {
    // The socket was already gone. Nothing left to do, and certainly nothing worth throwing over.
  }
}

/**
 * A string, from anything at all, without ever throwing.
 *
 * `String(x)` looks like a total function and is not: for an object whose `toString` is not
 * callable, `valueOf` returns the object itself, no primitive is available, and the spec requires
 * a `TypeError`. `{"toString": "not a function"}` is eleven bytes of JSON that any client can
 * send, and it used to take the whole server down.
 *
 * Objects and arrays are not stringified into something that looks like content — they were never
 * a string, and turning `{}` into `"[object Object]"` puts a value in the chat log that no player
 * typed. Anything that is not already a primitive becomes empty and is then rejected downstream.
 */
export function text(value: unknown, max = 512): string {
  if (typeof value === 'string') return value.slice(0, max);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value).slice(0, max) : '';
  if (typeof value === 'boolean' || typeof value === 'bigint') return String(value).slice(0, max);
  return '';
}

/** One of a fixed set, or the fallback. Keeps an untyped wire value out of a typed parameter. */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

const VOICE_KINDS = ['offer', 'answer', 'ice', 'leave'] as const;
const MODERATION_ACTIONS = ['mute', 'unmute', 'block', 'unblock'] as const;

/**
 * A cosmetics map that is actually a map of strings.
 *
 * This one is spread into player state and echoed to every other client, so it is the field a
 * hostile client would most like to control. Two things matter: the values must be strings (an
 * object here would reach other players' renderers), and the keys must not be `__proto__` or
 * `constructor`, which are how a plain-looking JSON object turns into a change every object in
 * the process can see. `Object.create(null)` would not help — it is the *destination* of a later
 * spread or assignment that matters — so the keys are filtered explicitly.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function cosmetics(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  let count = 0;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key) || key.length > 64) continue;
    if (typeof raw !== 'string') continue;
    out[key] = raw.slice(0, 64);
    if (++count >= 32) break; // a slot list, not a data store
  }
  return out;
}

async function handleControl(
  connection: Connection,
  client: ClientSocket,
  message: ClientMessage,
  config: ServerConfig,
  accounts: AccountService,
  rooms: RoomManager,
): Promise<void> {
  if (message.t === 'hello') {
    if (connection.playerId) return; // hello is only valid once
    if (message.protocol !== PROTOCOL_VERSION) {
      send(client, { t: 'error', code: 'protocol', message: `Server speaks protocol ${PROTOCOL_VERSION}` });
      connection.socket.close(4001, 'protocol');
      return;
    }

    // Hello carries the most untyped fields of any message, and each one reaches code that
    // assumes a string: `sanitizeName` trims, `matchmake` upper-cases a room code, and both
    // throw on an object. They are coerced here so no later caller has to wonder.
    const token = text(message.token, 4096);
    const name = text(message.name, 64);
    const roomCode = text(message.roomCode, 32);

    const playerId = token ? accounts.verifyToken(token) : null;
    const profile = playerId
      ? await accounts.loadOrCreate(playerId, name)
      : (await accounts.createGuest(sanitizeName(name))).profile;

    const modeId = text(message.modeId, 64);
    const match = rooms.matchmake({
      // Absent must stay absent: `matchmake` defaults a missing mode to kangaroo-chase, but an
      // empty string is a mode id it will look up and fail to find.
      ...(modeId ? { modeId } : {}),
      roomCode,
      // Passed through raw; `matchmake` sanitises, and only for a private room.
      ...(message.modeConfig === undefined ? {} : { modeConfig: message.modeConfig }),
    });
    if (!match.room) {
      send(client, { t: 'error', code: match.error === 'not-found' ? 'not-found' : 'full', message: match.error ?? 'no room' });
      connection.socket.close(4004, match.error ?? 'no-room');
      return;
    }

    connection.playerId = profile.playerId;
    connection.room = match.room;
    match.room.join(
      client,
      profile,
      oneOf(message.platform, ['pc', 'mobile', 'vr'] as const, 'pc'),
      cosmetics(message.cosmetics),
      message.crossPlay !== false,
    );
    void config;
    return;
  }

  if (!connection.playerId || !connection.room) return;
  const room = connection.room;
  const playerId = connection.playerId;

  switch (message.t) {
    case 'leave':
      room.leave(playerId);
      connection.room = null;
      connection.socket.close(1000, 'left');
      break;
    // Every field below arrives from a client that may be lying about its type as well as its
    // contents. The handlers all declare `string` parameters and TypeScript believes them,
    // because `ClientMessage` says so — but nothing on the wire enforces a declared type, so
    // this is the line where a claimed string has to become an actual one.
    case 'chat':
      room.handleChat(playerId, text(message.text, 2000), oneOf(message.channel, ['room', 'team'] as const, 'room'));
      break;
    case 'voice':
      // The payload is opaque SDP/ICE and is only relayed, but it is relayed *to another player*,
      // so it still has to be a string before it leaves. 16 KB is far above any real candidate.
      room.handleVoiceSignal(
        playerId,
        text(message.targetId, 64),
        text(message.payload, 16_000),
        oneOf(message.kind, VOICE_KINDS, 'leave'),
      );
      break;
    case 'moderate':
      room.handleModeration(playerId, oneOf(message.action, MODERATION_ACTIONS, 'mute'), text(message.targetId, 64));
      break;
    case 'report':
      room.handleReport(playerId, text(message.targetId, 64), text(message.reason, 500));
      break;
    case 'vote':
      room.handleVote(playerId, text(message.modeId, 64));
      break;
    case 'ready':
      room.handleReady(playerId, message.ready === true);
      break;
    case 'shop':
      room.handleShop(playerId, text(message.gadgetId, 64));
      break;
    case 'equip':
      // Equipping mid-match only affects the visual roster; inventory changes go through HTTP,
      // where they are validated against the owned inventory.
      break;
    default:
      break;
  }
}

function wrapSocket(socket: WebSocket): ClientSocket {
  return {
    sendJson(message: ServerMessage): void {
      if (socket.readyState !== socket.OPEN) return;
      socket.send(JSON.stringify(message));
    },
    sendBinary(data: Uint8Array): void {
      if (socket.readyState !== socket.OPEN) return;
      socket.send(data, { binary: true });
    },
    close(code?: number, reason?: string): void {
      socket.close(code ?? 1000, reason ?? '');
    },
  };
}

function send(client: ClientSocket, message: ServerMessage): void {
  client.sendJson(message);
}

function consumeBudget(connection: Connection, config: ServerConfig): boolean {
  const now = Date.now();
  const elapsed = (now - connection.lastRefill) / 1000;
  if (elapsed > 0) {
    connection.budget = Math.min(config.messageRateLimit, connection.budget + elapsed * config.messageRateLimit);
    connection.lastRefill = now;
  }
  if (connection.budget < 1) return false;
  connection.budget -= 1;
  return true;
}

function originAllowed(config: ServerConfig, request: IncomingMessage): boolean {
  if (config.allowedOrigins.length === 0) return true;
  const origin = request.headers.origin;
  if (!origin) return true; // native clients (Quest APK, mobile shell) send no Origin
  return config.allowedOrigins.includes(origin);
}
