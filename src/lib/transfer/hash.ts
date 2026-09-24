import { createSHA256 } from 'hash-wasm';

export interface IncrementalHash {
  update(data: Uint8Array): void;
  /** Lowercase hex SHA-256 of everything passed to update(). */
  digest(): string;
}

/**
 * Streaming SHA-256. WebCrypto's digest() needs the whole input at once, which
 * does not work for multi-gigabyte files, so this uses a WASM implementation.
 */
export async function createSha256(): Promise<IncrementalHash> {
  const hasher = await createSHA256();
  hasher.init();
  return {
    update: (data) => {
      hasher.update(data);
    },
    digest: () => hasher.digest('hex'),
  };
}
