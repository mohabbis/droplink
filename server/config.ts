import type { IceServer } from '../shared/protocol.js';

export interface ServerConfig {
  iceServers: IceServer[];
  roomTtlMs: number;
  maxRooms: number;
  /** Trust X-Forwarded-For for client IPs (true behind Vercel or a reverse proxy). */
  trustProxy: boolean;
}

export const DEFAULT_ICE_SERVERS: IceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

function isIceServer(v: unknown): v is IceServer {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  const urlsOk =
    typeof s.urls === 'string' || (Array.isArray(s.urls) && s.urls.every((u) => typeof u === 'string'));
  return (
    urlsOk &&
    (s.username === undefined || typeof s.username === 'string') &&
    (s.credential === undefined || typeof s.credential === 'string')
  );
}

export function parseIceServers(raw: string | undefined): IceServer[] {
  if (raw === undefined || raw.trim() === '') return DEFAULT_ICE_SERVERS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('ICE_SERVERS must be a JSON array of RTCIceServer objects');
  }
  if (!Array.isArray(parsed) || !parsed.every(isIceServer)) {
    throw new Error('ICE_SERVERS must be a JSON array of RTCIceServer objects');
  }
  return parsed;
}

function positiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    iceServers: parseIceServers(env.ICE_SERVERS),
    roomTtlMs: positiveInt(env.ROOM_TTL_SECONDS, 270, 'ROOM_TTL_SECONDS') * 1000,
    maxRooms: positiveInt(env.MAX_ROOMS, 1000, 'MAX_ROOMS'),
    trustProxy: env.VERCEL === '1' || env.TRUST_PROXY === '1',
  };
}
