import { describe, expect, it } from 'vitest';
import { chunkSizeFor, DEFAULT_CHUNK_SIZE, readChunks } from './chunker';

async function collect(blob: Blob, size: number, block?: number) {
  const out: Uint8Array[] = [];
  for await (const c of readChunks(blob, size, block)) out.push(c.slice());
  return out;
}

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

describe('readChunks', () => {
  it('yields nothing for an empty file', async () => {
    expect(await collect(new Blob([]), 4)).toEqual([]);
  });

  it('splits exact multiples without a trailing empty chunk', async () => {
    const chunks = await collect(new Blob([bytes(12)]), 4);
    expect(chunks.map((c) => c.byteLength)).toEqual([4, 4, 4]);
  });

  it('emits a short final chunk and preserves every byte in order', async () => {
    const data = bytes(10_000);
    const chunks = await collect(new Blob([data]), 1024, 3000);
    expect(chunks.map((c) => c.byteLength)).toEqual([...Array(9).fill(1024), 784]);
    const joined = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
    let off = 0;
    for (const c of chunks) {
      joined.set(c, off);
      off += c.byteLength;
    }
    expect(joined).toEqual(data);
  });

  it('rejects a non-positive chunk size', async () => {
    await expect(collect(new Blob([bytes(3)]), 0)).rejects.toThrow(RangeError);
  });
});

describe('chunkSizeFor', () => {
  it('uses the default when the browser does not report a limit', () => {
    expect(chunkSizeFor(undefined)).toBe(DEFAULT_CHUNK_SIZE);
    expect(chunkSizeFor(Infinity)).toBe(DEFAULT_CHUNK_SIZE);
  });
  it('respects a smaller SCTP max message size', () => {
    expect(chunkSizeFor(32 * 1024)).toBe(32 * 1024);
    expect(chunkSizeFor(1024 * 1024)).toBe(DEFAULT_CHUNK_SIZE);
  });
});
