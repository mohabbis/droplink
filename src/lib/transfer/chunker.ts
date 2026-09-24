/** Default data-channel message size. 64 KiB is safe across current Chrome, Firefox, and Safari. */
export const DEFAULT_CHUNK_SIZE = 64 * 1024;

/** How much of the file to read from disk at once; split into chunks afterwards. */
const READ_BLOCK_SIZE = 1024 * 1024;

/** Pick the chunk size for a connection, honoring the SCTP max message size when the browser reports it. */
export function chunkSizeFor(maxMessageSize: number | null | undefined): number {
  if (!maxMessageSize || !Number.isFinite(maxMessageSize) || maxMessageSize <= 0) return DEFAULT_CHUNK_SIZE;
  return Math.max(16 * 1024, Math.min(DEFAULT_CHUNK_SIZE, Math.floor(maxMessageSize)));
}

/**
 * Read a Blob/File in fixed-size chunks without loading it all into memory.
 * The final chunk may be shorter; an empty blob yields nothing.
 */
export async function* readChunks(
  blob: Blob,
  chunkSize = DEFAULT_CHUNK_SIZE,
  readBlockSize = READ_BLOCK_SIZE,
): AsyncGenerator<Uint8Array> {
  if (chunkSize <= 0) throw new RangeError('chunkSize must be positive');
  const block = Math.max(chunkSize, Math.floor(readBlockSize / chunkSize) * chunkSize);
  for (let offset = 0; offset < blob.size; offset += block) {
    const buf = new Uint8Array(await blob.slice(offset, Math.min(offset + block, blob.size)).arrayBuffer());
    for (let i = 0; i < buf.byteLength; i += chunkSize) {
      yield buf.subarray(i, Math.min(i + chunkSize, buf.byteLength));
    }
  }
}
