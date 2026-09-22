/**
 * Messages exchanged over the peer-to-peer data channel. Control messages are
 * JSON strings; file bytes are sent as binary ArrayBuffer frames between a
 * `file-start` and `file-end` on the same ordered, reliable channel.
 */

export interface FileMeta {
  id: string;
  name: string;
  size: number;
  type: string;
}

export type WireMessage =
  | { t: 'hello'; v: 1; label: string }
  | { t: 'pair-confirm' }
  | { t: 'manifest'; transferId: string; files: FileMeta[] }
  | { t: 'accept'; transferId: string }
  | { t: 'decline'; transferId: string; reason?: 'busy' | 'user' }
  | { t: 'file-start'; transferId: string; fileId: string }
  | { t: 'file-end'; transferId: string; fileId: string; sha256: string }
  | { t: 'file-result'; transferId: string; fileId: string; ok: boolean }
  | { t: 'ack'; transferId: string; bytes: number }
  | { t: 'cancel'; transferId: string }
  | { t: 'complete'; transferId: string }
  | { t: 'bye' };

export const MAX_FILES_PER_TRANSFER = 500;
const MAX_NAME_LENGTH = 255;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v);
const isByteCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** Strip path separators and control characters so a peer cannot choose where a file lands. */
export function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim();
  const safe = cleaned.replace(/^\.+/, '_') || 'file';
  return safe.slice(0, MAX_NAME_LENGTH);
}

function parseFileMeta(v: unknown): FileMeta | null {
  if (!isObject(v) || !isId(v.id) || typeof v.name !== 'string' || !isByteCount(v.size)) return null;
  const type = typeof v.type === 'string' && v.type.length <= 255 ? v.type : '';
  return { id: v.id, name: sanitizeFileName(v.name), size: v.size, type };
}

/** Parse a control message from the peer. Anything malformed returns null and is ignored. */
export function parseWireMessage(raw: string): WireMessage | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(v)) return null;
  switch (v.t) {
    case 'hello':
      return typeof v.label === 'string'
        ? { t: 'hello', v: 1, label: v.label.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 60) } // eslint-disable-line no-control-regex
        : null;
    case 'pair-confirm':
    case 'bye':
      return { t: v.t };
    case 'manifest': {
      if (!isId(v.transferId) || !Array.isArray(v.files)) return null;
      if (v.files.length === 0 || v.files.length > MAX_FILES_PER_TRANSFER) return null;
      const files = v.files.map(parseFileMeta);
      if (files.some((f) => f === null)) return null;
      const ids = new Set(files.map((f) => f!.id));
      if (ids.size !== files.length) return null;
      return { t: 'manifest', transferId: v.transferId, files: files as FileMeta[] };
    }
    case 'accept':
    case 'cancel':
    case 'complete':
      return isId(v.transferId) ? { t: v.t, transferId: v.transferId } : null;
    case 'decline':
      return isId(v.transferId)
        ? { t: 'decline', transferId: v.transferId, reason: v.reason === 'busy' ? 'busy' : 'user' }
        : null;
    case 'file-start':
      return isId(v.transferId) && isId(v.fileId)
        ? { t: 'file-start', transferId: v.transferId, fileId: v.fileId }
        : null;
    case 'file-end':
      return isId(v.transferId) && isId(v.fileId) && typeof v.sha256 === 'string' && HEX64_RE.test(v.sha256)
        ? { t: 'file-end', transferId: v.transferId, fileId: v.fileId, sha256: v.sha256 }
        : null;
    case 'file-result':
      return isId(v.transferId) && isId(v.fileId) && typeof v.ok === 'boolean'
        ? { t: 'file-result', transferId: v.transferId, fileId: v.fileId, ok: v.ok }
        : null;
    case 'ack':
      return isId(v.transferId) && isByteCount(v.bytes) ? { t: 'ack', transferId: v.transferId, bytes: v.bytes } : null;
    default:
      return null;
  }
}

export function encodeWire(msg: WireMessage): string {
  return JSON.stringify(msg);
}

/** Random URL-safe id for transfers and files. */
export function randomId(bytes = 9): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
