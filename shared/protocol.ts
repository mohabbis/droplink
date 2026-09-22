/**
 * Signaling protocol between browsers and the DropLink signaling server.
 *
 * The server only ever sees room codes and WebRTC session setup (SDP and ICE
 * candidates). File names, sizes, and contents travel over the peer-to-peer
 * data channel and never reach the server.
 */

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Opaque WebRTC setup payload relayed verbatim to the other room member. */
export type SignalPayload =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'ice'; candidate: RTCIceCandidateLike | null };

export interface RTCIceCandidateLike {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export type ClientMessage =
  | { t: 'create' }
  | { t: 'join'; code: string }
  | { t: 'signal'; data: SignalPayload }
  | { t: 'leave' };

export type ErrorCode =
  | 'bad_message'
  | 'invalid_code'
  | 'room_not_found'
  | 'room_full'
  | 'already_in_room'
  | 'not_in_room'
  | 'rate_limited'
  | 'server_busy';

export type ServerMessage =
  | { t: 'welcome'; iceServers: IceServer[]; roomTtlMs: number }
  | { t: 'created'; code: string; expiresAt: number }
  | { t: 'joined'; code: string }
  | { t: 'peer-joined' }
  | { t: 'signal'; data: SignalPayload }
  | { t: 'peer-left' }
  | { t: 'room-expired' }
  | { t: 'error'; code: ErrorCode; message: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function isCandidate(v: unknown): v is RTCIceCandidateLike {
  if (!isObject(v) || typeof v.candidate !== 'string') return false;
  if (v.sdpMid != null && typeof v.sdpMid !== 'string') return false;
  if (v.sdpMLineIndex != null && typeof v.sdpMLineIndex !== 'number') return false;
  if (v.usernameFragment != null && typeof v.usernameFragment !== 'string') return false;
  return true;
}

export function isSignalPayload(v: unknown): v is SignalPayload {
  if (!isObject(v)) return false;
  switch (v.kind) {
    case 'offer':
    case 'answer':
      return typeof v.sdp === 'string' && v.sdp.length > 0;
    case 'ice':
      return v.candidate === null || isCandidate(v.candidate);
    default:
      return false;
  }
}

/** Parse and validate a raw client message. Returns null for anything malformed. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(v)) return null;
  switch (v.t) {
    case 'create':
    case 'leave':
      return { t: v.t };
    case 'join':
      return typeof v.code === 'string' && v.code.length <= 32 ? { t: 'join', code: v.code } : null;
    case 'signal':
      return isSignalPayload(v.data) ? { t: 'signal', data: v.data } : null;
    default:
      return null;
  }
}

/** Parse a server message on the client. Returns null for anything unexpected. */
export function parseServerMessage(raw: string): ServerMessage | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(v) || typeof v.t !== 'string') return null;
  switch (v.t) {
    case 'welcome':
      return Array.isArray(v.iceServers) && typeof v.roomTtlMs === 'number'
        ? (v as ServerMessage)
        : null;
    case 'created':
      return typeof v.code === 'string' && typeof v.expiresAt === 'number' ? (v as ServerMessage) : null;
    case 'joined':
      return typeof v.code === 'string' ? (v as ServerMessage) : null;
    case 'signal':
      return isSignalPayload(v.data) ? (v as ServerMessage) : null;
    case 'error':
      return typeof v.code === 'string' && typeof v.message === 'string' ? (v as ServerMessage) : null;
    case 'peer-joined':
    case 'peer-left':
    case 'room-expired':
      return { t: v.t };
    default:
      return null;
  }
}
