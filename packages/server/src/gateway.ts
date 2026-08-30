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

      if (isBinary) {
        if (!connection.playerId || !connection.room) return;
        connection.room.handleIntent(connection.playerId, new Uint8Array(data));
        return;
      }

      const message = decodeJson<ClientMessage>(data.toString('utf8'));
      if (!message) return;
      void handleControl(connection, client, message, config, accounts, rooms);
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

    const playerId = message.token ? accounts.verifyToken(message.token) : null;
    const profile = playerId
      ? await accounts.loadOrCreate(playerId, message.name)
      : (await accounts.createGuest(sanitizeName(message.name))).profile;

    const match = rooms.matchmake({
      modeId: message.modeId,
      roomCode: message.roomCode,
      createPrivate: message.roomCode === 'new-private',
    });
    if (!match.room) {
      send(client, { t: 'error', code: match.error === 'not-found' ? 'not-found' : 'full', message: match.error ?? 'no room' });
      connection.socket.close(4004, match.error ?? 'no-room');
      return;
    }

    connection.playerId = profile.playerId;
    connection.room = match.room;
    match.room.join(client, profile, message.platform, message.cosmetics ?? {}, message.crossPlay !== false);
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
    case 'chat':
      room.handleChat(playerId, String(message.text ?? ''), message.channel === 'team' ? 'team' : 'room');
      break;
    case 'voice':
      room.handleVoiceSignal(playerId, message.targetId, message.payload, message.kind);
      break;
    case 'moderate':
      room.handleModeration(playerId, message.action, message.targetId);
      break;
    case 'report':
      room.handleReport(playerId, message.targetId, message.reason);
      break;
    case 'vote':
      room.handleVote(playerId, message.modeId);
      break;
    case 'ready':
      room.handleReady(playerId, message.ready === true);
      break;
    case 'shop':
      room.handleShop(playerId, String(message.gadgetId ?? ''));
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
