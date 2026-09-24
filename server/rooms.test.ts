import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CODE_ALPHABET, CODE_LENGTH, PAIRING_WINDOW_MS } from '../shared/limits.js';
import type { ServerMessage } from '../shared/protocol.js';
import { RoomManager, type Member } from './rooms.js';

let nextId = 0;
function fakeMember(ip = '10.0.0.1'): Member & { inbox: ServerMessage[] } {
  const inbox: ServerMessage[] = [];
  return { id: `m${nextId++}`, ip, inbox, send: (m) => inbox.push(m) };
}

const TTL = 60_000;

describe('RoomManager', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('creates a room with a well-formed code and expiry', () => {
    const rooms = new RoomManager({ roomTtlMs: TTL, maxRooms: 10 });
    const r = rooms.create(fakeMember());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.code).toHaveLength(CODE_LENGTH);
    expect([...r.code].every((c) => CODE_ALPHABET.includes(c))).toBe(true);
    expect(r.expiresAt).toBe(Date.now() + TTL);
    expect(rooms.size).toBe(1);
  });

  it('retries on code collision', () => {
    // First two codes are all-'2', then the next is all-'3'.
    const seq = [...Array(CODE_LENGTH * 2).fill(0), ...Array(CODE_LENGTH).fill(1)];
    const rooms = new RoomManager({ roomTtlMs: TTL, maxRooms: 10, randomIndex: () => seq.shift() ?? 0 });
    const a = rooms.create(fakeMember('1.1.1.1'));
    const b = rooms.create(fakeMember('1.1.1.2'));
    expect(a.ok && a.code).toBe('222222');
    expect(b.ok && b.code).toBe('333333');
  });

  it('gives up with server_busy when every attempt collides', () => {
    const rooms = new RoomManager({ roomTtlMs: TTL, maxRooms: 10, randomIndex: () => 0 });
    rooms.create(fakeMember('1.1.1.1'));
    expect(rooms.create(fakeMember('1.1.1.2'))).toEqual({ ok: false, code: 'server_busy' });
  });

  it('enforces the global room cap', () => {
    const rooms = new RoomManager({ roomTtlMs: TTL, maxRooms: 1 });
    rooms.create(fakeMember('1.1.1.1'));
    expect(rooms.create(fakeMember('1.1.1.2'))).toEqual({ ok: false, code: 'server_busy' });
  });

  it('rate-limits room creation per IP', () => {
    const rooms = new RoomManager({ roomTtlMs: TTL, maxRooms: 100 });
    for (let i = 0; i < 10; i++) expect(rooms.create(fakeMember('9.9.9.9')).ok).toBe(true);
    expect(rooms.create(fakeMember('9.9.9.9'))).toEqual({ ok: false, code: 'rate_limited' });
    expect(rooms.create(fakeMember('8.8.8.8')).ok).toBe(true);
  });

  it('joins with a formatted, lowercase code and notifies the host', () => {
    const rooms = new RoomManager({ roomTtlMs: TTL, maxRooms: 10 });
    const host = fakeMember();
    const r = rooms.create(host);
    if (!r.ok) throw new Error('create failed');
    const formatted = `${r.code.slice(0, 3)}-${r.code.slice(3)}`.toLowerCase();
    expect(rooms.join(fakeMember('2.2.2.2'), formatted)).toEqual({ ok: true, code: r.code });
    expect(host.inbox).toContainEqual({ t: 'peer-joined' });
  });

  it('rejects malformed, unknown, and full rooms', () => {
    const rooms = new RoomManager({ roomTtlMs: TTL, maxRooms: 10 });
    const r = rooms.create(fakeMember());
    if (!r.ok) throw new Error('create failed');
    expect(rooms.join(fakeMember('2.2.2.2'), 'abc')).toEqual({ ok: false, code: 'invalid_code' });
    expect(rooms.join(fakeMember('2.2.2.3'), 'OOOOOO')).toEqual({ ok: false, code: 'invalid_code' });
    const unknown = r.code === '222222' ? '333333' : '222222';
    expect(rooms.join(fakeMember('2.2.2.4'), unknown)).toEqual({ ok: false, code: 'room_not_found' });
    expect(rooms.join(fakeMember('2.2.2.5'), r.code).ok).toBe(true);
    expect(rooms.join(fakeMember('2.2.2.6'), r.code)).toEqual({ ok: false, code: 'room_full' });
  });

  it('rate-limits join attempts per IP to slow down code guessing', () => {
    const rooms = new RoomManager({ roomTtlMs: TTL, maxRooms: 10 });
    for (let i = 0; i < 20; i++) rooms.join(fakeMember('6.6.6.6'), '222222');
    expect(rooms.join(fakeMember('6.6.6.6'), '222222')).toEqual({ ok: false, code: 'rate_limited' });
  });

  it('prevents a member from being in two rooms', () => {
    const rooms = new RoomManager({ roomTtlMs: TTL, maxRooms: 10 });
    const m = fakeMember();
    rooms.create(m);
    expect(rooms.create(m)).toEqual({ ok: false, code: 'already_in_room' });
  });

  it('relays signals only to the other member of the same room', () => {
    const rooms = new RoomManager({ roomTtlMs: TTL, maxRooms: 10 });
    const [h1, g1, h2, g2] = [fakeMember('1.0.0.1'), fakeMember('1.0.0.2'), fakeMember('1.0.0.3'), fakeMember('1.0.0.4')];
    const r1 = rooms.create(h1);
    const r2 = rooms.create(h2);
    if (!r1.ok || !r2.ok) throw new Error('create failed');
    rooms.join(g1, r1.code);
    rooms.join(g2, r2.code);
    const offer = { kind: 'offer', sdp: 'v=0' } as const;
    expect(rooms.relay(h1, offer).ok).toBe(true);
    expect(g1.inbox).toContainEqual({ t: 'signal', data: offer });
    expect(g2.inbox.some((m) => m.t === 'signal')).toBe(false);
    expect(h2.inbox.some((m) => m.t === 'signal')).toBe(false);
  });

  it('refuses to relay before a peer has joined', () => {
    const rooms = new RoomManager({ roomTtlMs: TTL, maxRooms: 10 });
    const host = fakeMember();
    rooms.create(host);
    expect(rooms.relay(host, { kind: 'ice', candidate: null })).toEqual({ ok: false, code: 'not_in_room' });
  });

  it('expires an unpaired room after the TTL', () => {
    const rooms = new RoomManager({ roomTtlMs: TTL, maxRooms: 10 });
    const host = fakeMember();
    const r = rooms.create(host);
    if (!r.ok) throw new Error('create failed');
    vi.advanceTimersByTime(TTL - 1);
    expect(rooms.hasRoom(r.code)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(rooms.hasRoom(r.code)).toBe(false);
    expect(host.inbox).toContainEqual({ t: 'room-expired' });
    expect(rooms.join(fakeMember('3.3.3.3'), r.code)).toEqual({ ok: false, code: 'room_not_found' });
  });

  it('switches to the pairing window once both devices are present', () => {
    const rooms = new RoomManager({ roomTtlMs: TTL, maxRooms: 10 });
    const host = fakeMember();
    const guest = fakeMember('4.4.4.4');
    const r = rooms.create(host);
    if (!r.ok) throw new Error('create failed');
    vi.advanceTimersByTime(TTL - 1000);
    rooms.join(guest, r.code);
    vi.advanceTimersByTime(1000);
    expect(rooms.hasRoom(r.code)).toBe(true);
    vi.advanceTimersByTime(PAIRING_WINDOW_MS);
    expect(rooms.hasRoom(r.code)).toBe(false);
    expect(guest.inbox).toContainEqual({ t: 'room-expired' });
  });

  it('closes the room and notifies the other device when one leaves', () => {
    const rooms = new RoomManager({ roomTtlMs: TTL, maxRooms: 10 });
    const host = fakeMember();
    const guest = fakeMember('5.5.5.5');
    const r = rooms.create(host);
    if (!r.ok) throw new Error('create failed');
    rooms.join(guest, r.code);
    rooms.leave(guest);
    expect(host.inbox).toContainEqual({ t: 'peer-left' });
    expect(rooms.size).toBe(0);
    // Leaving twice is harmless.
    rooms.leave(guest);
    rooms.leave(host);
  });
});
