import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ServerMessage } from '../shared/protocol.js';
import { MAX_SIGNAL_MESSAGE_BYTES } from '../shared/limits.js';
import { attachSignaling, type Signaling } from './signaling.js';

interface Client {
  ws: WebSocket;
  next(t?: ServerMessage['t']): Promise<ServerMessage>;
  send(msg: unknown): void;
  closed: Promise<number>;
}

let server: Server;
let signaling: Signaling;
let url: string;

async function connect(): Promise<Client> {
  const ws = new WebSocket(url);
  const queue: ServerMessage[] = [];
  const waiters: Array<() => void> = [];
  ws.on('message', (raw) => {
    queue.push(JSON.parse(raw.toString()));
    waiters.splice(0).forEach((w) => w());
  });
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  const next = async (t?: ServerMessage['t']): Promise<ServerMessage> => {
    for (;;) {
      const i = queue.findIndex((m) => !t || m.t === t);
      if (i >= 0) return queue.splice(i, 1)[0];
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };
  return { ws, next, send: (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)), closed };
}

beforeEach(async () => {
  server = createServer();
  signaling = attachSignaling(server, {
    iceServers: [{ urls: 'stun:example.test' }],
    roomTtlMs: 60_000,
    maxRooms: 10,
    trustProxy: false,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/ws`;
});

afterEach(async () => {
  signaling.close();
  await new Promise((resolve) => server.close(resolve));
});

describe('signaling server', () => {
  it('pairs two clients and relays offer/answer between them', async () => {
    const a = await connect();
    expect(await a.next('welcome')).toEqual({ t: 'welcome', iceServers: [{ urls: 'stun:example.test' }], roomTtlMs: 60_000 });
    a.send({ t: 'create' });
    const created = await a.next('created');
    if (created.t !== 'created') throw new Error();

    const b = await connect();
    b.send({ t: 'join', code: created.code });
    expect(await b.next('joined')).toEqual({ t: 'joined', code: created.code });
    expect(await a.next('peer-joined')).toEqual({ t: 'peer-joined' });

    a.send({ t: 'signal', data: { kind: 'offer', sdp: 'offer-sdp' } });
    expect(await b.next('signal')).toEqual({ t: 'signal', data: { kind: 'offer', sdp: 'offer-sdp' } });
    b.send({ t: 'signal', data: { kind: 'answer', sdp: 'answer-sdp' } });
    expect(await a.next('signal')).toEqual({ t: 'signal', data: { kind: 'answer', sdp: 'answer-sdp' } });

    b.send({ t: 'leave' });
    expect(await a.next('peer-left')).toEqual({ t: 'peer-left' });
    expect(signaling.rooms.size).toBe(0);
    a.ws.close();
  });

  it('reports an unknown room', async () => {
    const b = await connect();
    b.send({ t: 'join', code: '222-222' });
    const err = await b.next('error');
    expect(err).toMatchObject({ t: 'error', code: 'room_not_found' });
    b.ws.close();
  });

  it('rejects malformed messages without closing the connection', async () => {
    const c = await connect();
    c.send('not json');
    expect(await c.next('error')).toMatchObject({ code: 'bad_message' });
    c.send({ t: 'signal', data: { kind: 'offer' } });
    expect(await c.next('error')).toMatchObject({ code: 'bad_message' });
    c.send({ t: 'create' });
    expect((await c.next('created')).t).toBe('created');
    c.ws.close();
  });

  it('closes connections that send oversized messages', async () => {
    const c = await connect();
    c.send({ t: 'signal', data: { kind: 'offer', sdp: 'x'.repeat(MAX_SIGNAL_MESSAGE_BYTES + 1) } });
    expect(await c.closed).toBe(1009);
  });

  it('notifies the host when the guest disconnects abruptly', async () => {
    const a = await connect();
    a.send({ t: 'create' });
    const created = await a.next('created');
    if (created.t !== 'created') throw new Error();
    const b = await connect();
    b.send({ t: 'join', code: created.code });
    await b.next('joined');
    b.ws.terminate();
    expect(await a.next('peer-left')).toEqual({ t: 'peer-left' });
    a.ws.close();
  });
});
