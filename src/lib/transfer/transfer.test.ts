import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TransferReceiver, MemorySink, type FileOutcome } from './receiver';
import { ChannelClosedError, sendFiles, type SendChannel } from './sender';
import { parseWireMessage, type FileMeta } from './wire';

/** In-memory data channel that drains its buffer only when told to. */
class FakeChannel implements SendChannel {
  readyState = 'open';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  maxBuffered = 0;
  delivered: Array<string | Uint8Array> = [];
  private listeners = new Map<string, Set<() => void>>();

  send(data: string | ArrayBuffer | ArrayBufferView<ArrayBuffer>): void {
    if (typeof data === 'string') {
      this.delivered.push(data);
      return;
    }
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.delivered.push(bytes.slice());
    this.bufferedAmount += bytes.byteLength;
    this.maxBuffered = Math.max(this.maxBuffered, this.bufferedAmount);
  }
  drain(): void {
    this.bufferedAmount = 0;
    this.emit('bufferedamountlow');
  }
  close(): void {
    this.readyState = 'closed';
    this.emit('close');
  }
  addEventListener(type: string, fn: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
  private emit(type: string): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
}

const randomBytes = (n: number, seed = 1) => {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x & 0xff;
  }
  return out;
};
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(cond: () => boolean) {
  for (let i = 0; i < 1000 && !cond(); i++) await tick();
  if (!cond()) throw new Error('condition not reached');
}

/** Feed everything the fake channel delivered into a receiver, as the session does. */
async function replay(channel: FakeChannel, receiver: TransferReceiver) {
  for (const item of channel.delivered) {
    if (typeof item !== 'string') {
      await receiver.chunk(item.slice().buffer);
      continue;
    }
    const msg = parseWireMessage(item);
    if (msg?.t === 'file-start') await receiver.fileStart(msg.fileId);
    if (msg?.t === 'file-end') await receiver.fileEnd(msg.fileId, msg.sha256);
  }
}

describe('sendFiles', () => {
  it('pauses at the high-water mark and resumes when the buffer drains', async () => {
    const channel = new FakeChannel();
    const data = randomBytes(10 * 1024);
    let sent = 0;
    const done = sendFiles(channel, 't1', [{ id: 'f1', blob: new Blob([data]) }], {
      chunkSize: 1024,
      highWaterMark: 3 * 1024,
      lowWaterMark: 512,
      onSent: (b) => (sent = b),
    });
    await until(() => channel.bufferedAmount > 3 * 1024);
    // Give the sender a chance to (incorrectly) keep going, then check it stopped.
    for (let i = 0; i < 10; i++) await tick();
    // Sender stopped once more than 3 KiB was queued.
    expect(channel.bufferedAmount).toBeGreaterThan(3 * 1024);
    expect(channel.bufferedAmount).toBeLessThanOrEqual(4 * 1024);
    expect(channel.bufferedAmountLowThreshold).toBe(512);
    const pausedAt = sent;
    while (sent < data.byteLength) {
      channel.drain();
      await tick();
      await tick();
    }
    await done;
    expect(pausedAt).toBeLessThan(data.byteLength);
    expect(channel.maxBuffered).toBeLessThanOrEqual(4 * 1024);
    expect(channel.listenerCount('bufferedamountlow')).toBe(0);
  });

  it('includes the SHA-256 of each file in file-end', async () => {
    const channel = new FakeChannel();
    const data = randomBytes(5000);
    await sendFiles(channel, 't1', [{ id: 'f1', blob: new Blob([data]) }], { chunkSize: 1024, highWaterMark: Infinity });
    const end = parseWireMessage(channel.delivered.at(-1) as string);
    expect(end).toEqual({ t: 'file-end', transferId: 't1', fileId: 'f1', sha256: sha(data) });
  });

  it('stops when aborted while waiting for the buffer', async () => {
    const channel = new FakeChannel();
    const ctrl = new AbortController();
    const p = sendFiles(channel, 't1', [{ id: 'f1', blob: new Blob([randomBytes(8192)]) }], {
      chunkSize: 1024,
      highWaterMark: 1024,
      signal: ctrl.signal,
    });
    await until(() => channel.bufferedAmount > 1024);
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('fails clearly when the channel closes mid-transfer', async () => {
    const channel = new FakeChannel();
    const p = sendFiles(channel, 't1', [{ id: 'f1', blob: new Blob([randomBytes(8192)]) }], {
      chunkSize: 1024,
      highWaterMark: 1024,
    });
    await until(() => channel.bufferedAmount > 1024);
    channel.close();
    await expect(p).rejects.toBeInstanceOf(ChannelClosedError);
  });
});

describe('TransferReceiver', () => {
  function setup(files: FileMeta[]) {
    const outcomes: FileOutcome[] = [];
    const progress: number[] = [];
    const errors: string[] = [];
    const receiver = new TransferReceiver('t1', files, async (m) => new MemorySink(m.type), {
      onProgress: (b) => progress.push(b),
      onFileStart: () => undefined,
      onFileVerifying: () => undefined,
      onFileDone: (o) => outcomes.push(o),
      onProtocolError: (e) => errors.push(e),
    });
    return { receiver, outcomes, progress, errors };
  }

  it('reassembles multiple files byte-for-byte and verifies them', async () => {
    const a = randomBytes(70_000, 3);
    const b = randomBytes(1, 4);
    const c = new Uint8Array(0);
    const channel = new FakeChannel();
    await sendFiles(
      channel,
      't1',
      [
        { id: 'a', blob: new Blob([a]) },
        { id: 'b', blob: new Blob([b]) },
        { id: 'c', blob: new Blob([c]) },
      ],
      { chunkSize: 16 * 1024, highWaterMark: Infinity },
    );
    const { receiver, outcomes, progress, errors } = setup([
      { id: 'a', name: 'a.bin', size: a.byteLength, type: '' },
      { id: 'b', name: 'b.bin', size: 1, type: '' },
      { id: 'c', name: 'empty.txt', size: 0, type: 'text/plain' },
    ]);
    await replay(channel, receiver);
    expect(errors).toEqual([]);
    expect(outcomes.map((o) => [o.fileId, o.ok])).toEqual([
      ['a', true],
      ['b', true],
      ['c', true],
    ]);
    expect(new Uint8Array(await outcomes[0].blob!.arrayBuffer())).toEqual(a);
    expect(outcomes[2].blob!.size).toBe(0);
    expect(progress.at(-1)).toBe(a.byteLength + 1);
    expect(receiver.done).toBe(true);
  });

  it('flags a checksum mismatch as a failed file', async () => {
    const data = randomBytes(4000);
    const { receiver, outcomes } = setup([{ id: 'a', name: 'a', size: 4000, type: '' }]);
    await receiver.fileStart('a');
    const corrupted = data.slice();
    corrupted[100] ^= 0xff;
    await receiver.chunk(corrupted.buffer);
    await receiver.fileEnd('a', sha(data));
    expect(outcomes).toEqual([{ fileId: 'a', ok: false, blob: null, error: expect.stringMatching(/checksum/i) }]);
  });

  it('flags a truncated file', async () => {
    const data = randomBytes(4000);
    const { receiver, outcomes } = setup([{ id: 'a', name: 'a', size: 5000, type: '' }]);
    await receiver.fileStart('a');
    await receiver.chunk(data.slice().buffer);
    await receiver.fileEnd('a', sha(data));
    expect(outcomes[0]).toMatchObject({ ok: false, error: expect.stringMatching(/incomplete/i) });
  });

  it('reports a protocol error for oversized or out-of-order data', async () => {
    const s1 = setup([{ id: 'a', name: 'a', size: 10, type: '' }]);
    await s1.receiver.fileStart('a');
    await s1.receiver.chunk(new Uint8Array(11).buffer);
    expect(s1.errors).toHaveLength(1);

    const s2 = setup([
      { id: 'a', name: 'a', size: 1, type: '' },
      { id: 'b', name: 'b', size: 1, type: '' },
    ]);
    await s2.receiver.fileStart('b');
    expect(s2.errors).toEqual(['Files arrived out of order.']);

    const s3 = setup([{ id: 'a', name: 'a', size: 1, type: '' }]);
    await s3.receiver.chunk(new Uint8Array(1).buffer);
    expect(s3.errors).toHaveLength(1);
  });

  it('discards partial data on abort', async () => {
    let aborted = false;
    const receiver = new TransferReceiver(
      't1',
      [{ id: 'a', name: 'a', size: 100, type: '' }],
      async () => ({ write: () => undefined, close: async () => null, abort: async () => void (aborted = true) }),
      { onProgress() {}, onFileStart() {}, onFileVerifying() {}, onFileDone() {}, onProtocolError() {} },
    );
    await receiver.fileStart('a');
    await receiver.chunk(new Uint8Array(10).buffer);
    await receiver.abort();
    expect(aborted).toBe(true);
  });
});
