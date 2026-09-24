import { createSha256, type IncrementalHash } from './hash';
import type { FileMeta } from './wire';

/** Where received bytes go: memory (Blob) or a file on disk. */
export interface FileSink {
  write(chunk: Uint8Array): void | Promise<void>;
  /** Finish the file. Returns a Blob for in-memory sinks, null when written to disk. */
  close(): Promise<Blob | null>;
  abort(): Promise<void>;
}

export class MemorySink implements FileSink {
  private parts: BlobPart[] = [];
  constructor(private readonly type: string) {}
  write(chunk: Uint8Array): void {
    this.parts.push(chunk as Uint8Array<ArrayBuffer>);
  }
  async close(): Promise<Blob> {
    const blob = new Blob(this.parts, { type: this.type || 'application/octet-stream' });
    this.parts = [];
    return blob;
  }
  async abort(): Promise<void> {
    this.parts = [];
  }
}

export interface FileOutcome {
  fileId: string;
  ok: boolean;
  blob: Blob | null;
  error?: string;
}

export interface ReceiverEvents {
  /** Cumulative bytes received for the whole transfer. */
  onProgress(bytes: number): void;
  onFileStart(fileId: string): void;
  onFileVerifying(fileId: string): void;
  onFileDone(outcome: FileOutcome): void;
  /** Protocol violation from the peer. The transfer should be cancelled. */
  onProtocolError(message: string): void;
}

interface ActiveFile {
  meta: FileMeta;
  sink: FileSink;
  hash: IncrementalHash;
  received: number;
}

/**
 * Reassembles files from the data channel. Messages are processed strictly in
 * arrival order through a promise queue so async disk writes stay ordered.
 */
export class TransferReceiver {
  private readonly files: Map<string, FileMeta>;
  private readonly order: string[];
  private nextIndex = 0;
  private active: ActiveFile | null = null;
  private total = 0;
  private queue: Promise<void> = Promise.resolve();
  private failed = false;
  private stopped = false;

  constructor(
    readonly transferId: string,
    manifest: FileMeta[],
    private readonly createSink: (meta: FileMeta) => Promise<FileSink>,
    private readonly events: ReceiverEvents,
  ) {
    this.files = new Map(manifest.map((f) => [f.id, f]));
    this.order = manifest.map((f) => f.id);
  }

  get done(): boolean {
    return this.nextIndex >= this.order.length && this.active === null;
  }

  fileStart(fileId: string): Promise<void> {
    return this.enqueue(async () => {
      const expected = this.order[this.nextIndex];
      if (this.active || fileId !== expected) {
        return this.protocolError('Files arrived out of order.');
      }
      const meta = this.files.get(fileId)!;
      this.active = { meta, sink: await this.createSink(meta), hash: await createSha256(), received: 0 };
      this.events.onFileStart(fileId);
    });
  }

  chunk(data: ArrayBuffer): Promise<void> {
    return this.enqueue(async () => {
      const file = this.active;
      if (!file) return this.protocolError('Received data outside of a file.');
      const bytes = new Uint8Array(data);
      if (file.received + bytes.byteLength > file.meta.size) {
        return this.protocolError(`More data than expected for ${file.meta.name}.`);
      }
      file.hash.update(bytes);
      await file.sink.write(bytes);
      file.received += bytes.byteLength;
      this.total += bytes.byteLength;
      this.events.onProgress(this.total);
    });
  }

  fileEnd(fileId: string, sha256: string): Promise<void> {
    return this.enqueue(async () => {
      const file = this.active;
      if (!file || file.meta.id !== fileId) return this.protocolError('Unexpected end of file.');
      this.active = null;
      this.nextIndex += 1;
      this.events.onFileVerifying(fileId);
      if (file.received !== file.meta.size) {
        await file.sink.abort();
        this.events.onFileDone({ fileId, ok: false, blob: null, error: 'The file arrived incomplete.' });
        return;
      }
      if (file.hash.digest() !== sha256) {
        await file.sink.abort();
        this.events.onFileDone({
          fileId,
          ok: false,
          blob: null,
          error: 'Checksum mismatch — the file was corrupted in transit.',
        });
        return;
      }
      const blob = await file.sink.close();
      this.events.onFileDone({ fileId, ok: true, blob });
    });
  }

  /** Resolves once every message received so far has been processed. */
  drain(): Promise<void> {
    return this.queue;
  }

  /** Stop and discard any partially received file. */
  async abort(): Promise<void> {
    this.stopped = true;
    const file = this.active;
    this.active = null;
    await this.queue.catch(() => undefined);
    await file?.sink.abort().catch(() => undefined);
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (this.stopped || this.failed) return;
      try {
        await task();
      } catch (err) {
        this.protocolError(err instanceof Error ? err.message : 'Could not save the file.');
      }
    });
    return this.queue;
  }

  private protocolError(message: string): void {
    if (this.failed) return;
    this.failed = true;
    this.events.onProtocolError(message);
  }
}
