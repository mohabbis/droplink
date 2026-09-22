import { readChunks } from './chunker';
import { createSha256 } from './hash';
import { encodeWire, type WireMessage } from './wire';

/** The subset of RTCDataChannel the sender needs; lets tests use a fake. */
export interface SendChannel {
  readonly readyState: string;
  readonly bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  send(data: string | ArrayBuffer | ArrayBufferView<ArrayBuffer>): void;
  addEventListener(type: 'bufferedamountlow' | 'close', listener: () => void): void;
  removeEventListener(type: 'bufferedamountlow' | 'close', listener: () => void): void;
}

export interface OutgoingFile {
  id: string;
  blob: Blob;
}

export interface SendOptions {
  chunkSize: number;
  /** Pause sending while more than this many bytes are queued in the channel. */
  highWaterMark?: number;
  /** Resume once the queue drains below this. */
  lowWaterMark?: number;
  signal?: AbortSignal;
  /** Called with the cumulative number of bytes handed to the channel. */
  onSent?: (bytes: number) => void;
  onFileStart?: (fileId: string) => void;
  /** All bytes of a file are queued; the receiver will confirm with `file-result`. */
  onFileSent?: (fileId: string) => void;
}

export const HIGH_WATER_MARK = 4 * 1024 * 1024;
export const LOW_WATER_MARK = 1024 * 1024;

export class ChannelClosedError extends Error {
  constructor() {
    super('The connection closed during the transfer.');
    this.name = 'ChannelClosedError';
  }
}

function abortError(): DOMException {
  return new DOMException('Transfer cancelled', 'AbortError');
}

/** Wait until the channel's send buffer drains below the low-water mark. */
function waitForDrain(channel: SendChannel, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      channel.removeEventListener('bufferedamountlow', onLow);
      channel.removeEventListener('close', onClose);
      signal?.removeEventListener('abort', onAbort);
    };
    const onLow = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new ChannelClosedError());
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    channel.addEventListener('bufferedamountlow', onLow);
    channel.addEventListener('close', onClose);
    signal?.addEventListener('abort', onAbort);
  });
}

/**
 * Stream files over the data channel with backpressure. Emits `file-start`,
 * binary chunks, and `file-end` (with the SHA-256) for each file in order.
 * Resolves once every byte has been handed to the channel.
 */
export async function sendFiles(
  channel: SendChannel,
  transferId: string,
  files: OutgoingFile[],
  opts: SendOptions,
): Promise<void> {
  const high = opts.highWaterMark ?? HIGH_WATER_MARK;
  channel.bufferedAmountLowThreshold = opts.lowWaterMark ?? LOW_WATER_MARK;
  const control = (msg: WireMessage) => channel.send(encodeWire(msg));
  let sent = 0;

  for (const file of files) {
    if (opts.signal?.aborted) throw abortError();
    const hash = await createSha256();
    control({ t: 'file-start', transferId, fileId: file.id });
    opts.onFileStart?.(file.id);
    for await (const chunk of readChunks(file.blob, opts.chunkSize)) {
      if (opts.signal?.aborted) throw abortError();
      if (channel.readyState !== 'open') throw new ChannelClosedError();
      if (channel.bufferedAmount > high) await waitForDrain(channel, opts.signal);
      hash.update(chunk);
      // Copy so the channel owns an exact-length buffer (chunk is a view into a larger block).
      channel.send(chunk.slice());
      sent += chunk.byteLength;
      opts.onSent?.(sent);
    }
    control({ t: 'file-end', transferId, fileId: file.id, sha256: hash.digest() });
    opts.onFileSent?.(file.id);
  }
}
