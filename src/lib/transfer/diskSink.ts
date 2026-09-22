import type { FileSink } from './receiver';
import type { FileMeta } from './wire';

/** Minimal typings for the File System Access API (Chromium only, not in TS's DOM lib). */
interface WritableStream {
  write(data: Uint8Array<ArrayBuffer>): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}
interface FileHandle {
  createWritable(): Promise<WritableStream>;
}
interface DirectoryHandle {
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandle>;
}
interface PickerWindow {
  showSaveFilePicker(opts: { suggestedName: string }): Promise<FileHandle>;
  showDirectoryPicker(opts: { mode: 'readwrite' }): Promise<DirectoryHandle>;
}

export interface DiskTarget {
  /** Short description for the UI, e.g. "the folder you chose". */
  readonly description: string;
  sinkFor(meta: FileMeta): Promise<FileSink>;
}

class WritableSink implements FileSink {
  constructor(private readonly stream: WritableStream) {}
  write(chunk: Uint8Array): Promise<void> {
    return this.stream.write(chunk as Uint8Array<ArrayBuffer>);
  }
  async close(): Promise<null> {
    await this.stream.close();
    return null;
  }
  async abort(): Promise<void> {
    await this.stream.abort().catch(() => undefined);
  }
}

/** "photo.jpg" → "photo (2).jpg" */
export function numberedName(name: string, n: number): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
}

async function exists(dir: DirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask where to save incoming files. Must be called from a click handler.
 * One file → a save dialog; several → a folder picker. Returns null if the
 * person cancels the dialog.
 */
export async function pickDiskTarget(files: FileMeta[]): Promise<DiskTarget | null> {
  const w = window as unknown as PickerWindow;
  try {
    if (files.length === 1) {
      const handle = await w.showSaveFilePicker({ suggestedName: files[0].name });
      return {
        description: 'the location you chose',
        sinkFor: async () => new WritableSink(await handle.createWritable()),
      };
    }
    const dir = await w.showDirectoryPicker({ mode: 'readwrite' });
    const used = new Set<string>();
    return {
      description: 'the folder you chose',
      async sinkFor(meta) {
        let name = meta.name;
        for (let n = 2; used.has(name) || (await exists(dir, name)); n++) name = numberedName(meta.name, n);
        used.add(name);
        const handle = await dir.getFileHandle(name, { create: true });
        return new WritableSink(await handle.createWritable());
      },
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}
