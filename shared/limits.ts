/** Limits shared by the signaling server and the client. */

/** Characters used in room codes. No 0/O, 1/I/L to avoid misreading. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 6;

/** Largest signaling message accepted, in bytes. SDP offers are usually 2–6 KB. */
export const MAX_SIGNAL_MESSAGE_BYTES = 32 * 1024;

/** Per-connection message budget: at most `count` messages per `windowMs`. */
export const MESSAGE_RATE = { count: 60, windowMs: 10_000 } as const;

/** Per-IP budgets for creating rooms and attempting joins (slows code guessing). */
export const CREATE_RATE = { count: 10, windowMs: 60_000 } as const;
export const JOIN_RATE = { count: 20, windowMs: 60_000 } as const;

/** A connection must create or join a room within this time or it is closed. */
export const IDLE_CONNECTION_MS = 30_000;

/** Once both devices are in a room, they have this long to finish connecting. */
export const PAIRING_WINDOW_MS = 120_000;
