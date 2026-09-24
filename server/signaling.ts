import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { IDLE_CONNECTION_MS, MAX_SIGNAL_MESSAGE_BYTES, MESSAGE_RATE } from '../shared/limits.js';
import { parseClientMessage, type ErrorCode, type ServerMessage } from '../shared/protocol.js';
import type { ServerConfig } from './config.js';
import { RateLimiter } from './rateLimit.js';
import { RoomManager, type Member } from './rooms.js';

const ERROR_TEXT: Record<ErrorCode, string> = {
  bad_message: 'The server could not understand a message.',
  invalid_code: 'That code is not valid. Codes are 6 letters and numbers.',
  room_not_found: 'No open room matches that code. It may have expired or already closed.',
  room_full: 'That room already has two devices.',
  already_in_room: 'This device is already in a room.',
  not_in_room: 'This device is not in a room.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  server_busy: 'The service is busy right now. Try again shortly.',
};

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export interface Signaling {
  wss: WebSocketServer;
  rooms: RoomManager;
  close(): void;
}

/**
 * Attach the DropLink signaling endpoint to an HTTP server. Every WebSocket
 * upgrade on that server is treated as a signaling connection; route to it
 * with a path such as `/api/ws`.
 */
export function attachSignaling(server: Server, config: ServerConfig, rooms?: RoomManager): Signaling {
  const manager = rooms ?? new RoomManager({ roomTtlMs: config.roomTtlMs, maxRooms: config.maxRooms });
  const wss = new WebSocketServer({ server, maxPayload: MAX_SIGNAL_MESSAGE_BYTES });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const limiter = new RateLimiter(MESSAGE_RATE.count, MESSAGE_RATE.windowMs);
    const send = (msg: ServerMessage) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };
    const fail = (code: ErrorCode) => send({ t: 'error', code, message: ERROR_TEXT[code] });
    const member: Member = { id: randomUUID(), ip: clientIp(req, config.trustProxy), send };

    // Connections that never create or join a room are closed.
    const idleTimer = setTimeout(() => ws.close(4000, 'idle'), IDLE_CONNECTION_MS);

    send({ t: 'welcome', iceServers: config.iceServers, roomTtlMs: config.roomTtlMs });

    ws.on('message', (raw, isBinary) => {
      if (!limiter.hit(member.id)) {
        fail('rate_limited');
        ws.close(4008, 'rate limited');
        return;
      }
      const msg = isBinary ? null : parseClientMessage(raw.toString());
      if (!msg) {
        fail('bad_message');
        return;
      }
      switch (msg.t) {
        case 'create': {
          const r = manager.create(member);
          if (r.ok) {
            clearTimeout(idleTimer);
            send({ t: 'created', code: r.code, expiresAt: r.expiresAt });
          } else fail(r.code);
          break;
        }
        case 'join': {
          const r = manager.join(member, msg.code);
          if (r.ok) {
            clearTimeout(idleTimer);
            send({ t: 'joined', code: r.code });
          } else fail(r.code);
          break;
        }
        case 'signal': {
          const r = manager.relay(member, msg.data);
          if (!r.ok) fail(r.code);
          break;
        }
        case 'leave':
          manager.leave(member);
          ws.close(1000, 'left');
          break;
      }
    });

    ws.on('close', () => {
      clearTimeout(idleTimer);
      manager.leave(member);
    });
    ws.on('error', () => ws.terminate());
  });

  // Detect dead connections (mobile devices going to sleep, dropped networks).
  const alive = new WeakMap<WebSocket, boolean>();
  wss.on('connection', (ws) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, 25_000);
  heartbeat.unref();

  return {
    wss,
    rooms: manager,
    close() {
      clearInterval(heartbeat);
      manager.closeAll();
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
