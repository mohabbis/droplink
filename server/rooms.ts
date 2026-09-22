import { randomInt } from 'node:crypto';
import { generateCode, normalizeCode } from '../shared/codes.js';
import { CREATE_RATE, JOIN_RATE, PAIRING_WINDOW_MS } from '../shared/limits.js';
import type { ErrorCode, ServerMessage, SignalPayload } from '../shared/protocol.js';
import { RateLimiter } from './rateLimit.js';

/** A connected client, independent of the transport (WebSocket in production, fakes in tests). */
export interface Member {
  readonly id: string;
  readonly ip: string;
  send(msg: ServerMessage): void;
}

interface Room {
  code: string;
  host: Member;
  guest: Member | null;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

export type Result<T> = ({ ok: true } & T) | { ok: false; code: ErrorCode };

export interface RoomManagerOptions {
  roomTtlMs: number;
  maxRooms: number;
  /** Random integer in [0, max). Injected so tests can force collisions. */
  randomIndex?: (max: number) => number;
}

const MAX_CODE_ATTEMPTS = 10;

/**
 * Holds temporary two-person rooms in memory. A room exists only while its
 * devices are setting up a peer connection; nothing is persisted.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly memberRoom = new Map<string, Room>();
  private readonly createLimiter = new RateLimiter(CREATE_RATE.count, CREATE_RATE.windowMs);
  private readonly joinLimiter = new RateLimiter(JOIN_RATE.count, JOIN_RATE.windowMs);
  private readonly randomIndex: (max: number) => number;

  constructor(private readonly opts: RoomManagerOptions) {
    this.randomIndex = opts.randomIndex ?? ((max) => randomInt(max));
  }

  get size(): number {
    return this.rooms.size;
  }

  hasRoom(code: string): boolean {
    return this.rooms.has(code);
  }

  create(member: Member): Result<{ code: string; expiresAt: number }> {
    if (this.memberRoom.has(member.id)) return { ok: false, code: 'already_in_room' };
    if (!this.createLimiter.hit(member.ip)) return { ok: false, code: 'rate_limited' };
    if (this.rooms.size >= this.opts.maxRooms) return { ok: false, code: 'server_busy' };

    let code: string | null = null;
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
      const candidate = generateCode(this.randomIndex);
      if (!this.rooms.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (code === null) return { ok: false, code: 'server_busy' };

    const expiresAt = Date.now() + this.opts.roomTtlMs;
    const room: Room = {
      code,
      host: member,
      guest: null,
      expiresAt,
      timer: setTimeout(() => this.expire(code), this.opts.roomTtlMs),
    };
    this.rooms.set(code, room);
    this.memberRoom.set(member.id, room);
    return { ok: true, code, expiresAt };
  }

  join(member: Member, rawCode: string): Result<{ code: string }> {
    if (this.memberRoom.has(member.id)) return { ok: false, code: 'already_in_room' };
    // Rate-limit before revealing whether a code exists, so guessing is slow.
    if (!this.joinLimiter.hit(member.ip)) return { ok: false, code: 'rate_limited' };
    const code = normalizeCode(rawCode);
    if (code === null) return { ok: false, code: 'invalid_code' };
    const room = this.rooms.get(code);
    if (!room) return { ok: false, code: 'room_not_found' };
    if (room.guest) return { ok: false, code: 'room_full' };

    room.guest = member;
    this.memberRoom.set(member.id, room);
    // Both devices are present: give them a bounded window to finish connecting.
    clearTimeout(room.timer);
    room.expiresAt = Date.now() + PAIRING_WINDOW_MS;
    room.timer = setTimeout(() => this.expire(code), PAIRING_WINDOW_MS);
    room.host.send({ t: 'peer-joined' });
    return { ok: true, code };
  }

  /** Forward WebRTC setup data to the other member of the sender's room. */
  relay(member: Member, data: SignalPayload): Result<object> {
    const room = this.memberRoom.get(member.id);
    if (!room) return { ok: false, code: 'not_in_room' };
    const other = room.host.id === member.id ? room.guest : room.host;
    if (!other) return { ok: false, code: 'not_in_room' };
    other.send({ t: 'signal', data });
    return { ok: true };
  }

  /** Remove a member (explicit leave or disconnect). Closes the room and tells the other device. */
  leave(member: Member): void {
    const room = this.memberRoom.get(member.id);
    if (!room) return;
    const other = room.host.id === member.id ? room.guest : room.host;
    this.destroy(room);
    other?.send({ t: 'peer-left' });
  }

  private expire(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    this.destroy(room);
    room.host.send({ t: 'room-expired' });
    room.guest?.send({ t: 'room-expired' });
  }

  private destroy(room: Room): void {
    clearTimeout(room.timer);
    this.rooms.delete(room.code);
    this.memberRoom.delete(room.host.id);
    if (room.guest) this.memberRoom.delete(room.guest.id);
  }

  /** Close every room (server shutdown). */
  closeAll(): void {
    for (const room of [...this.rooms.values()]) this.expire(room.code);
  }
}
