import type { ErrorCode } from '../../shared/protocol';

export type ErrorKind =
  | ErrorCode
  | 'unreachable'
  | 'room_expired'
  | 'connection_failed'
  | 'connection_timeout'
  | 'peer_left'
  | 'pairing_rejected'
  | 'unknown';

export interface AppError {
  kind: ErrorKind;
  title: string;
  detail: string;
  /** What the person can do next. */
  recovery: string;
}

const COPY: Record<ErrorKind, Omit<AppError, 'kind'>> = {
  invalid_code: {
    title: 'That code doesn’t look right',
    detail: 'Pairing codes are 6 letters and numbers, like K7Q-M4P.',
    recovery: 'Check the code shown on the other device and enter it again.',
  },
  room_not_found: {
    title: 'We couldn’t find that code',
    detail:
      'It may have expired, the other device may have closed it, or the service restarted since it was created.',
    recovery: 'Ask the other device to create a new code, then try again.',
  },
  room_full: {
    title: 'That code is already in use',
    detail: 'Another device has already joined this room.',
    recovery: 'Ask the other device to create a new code.',
  },
  rate_limited: {
    title: 'Too many attempts',
    detail: 'To protect pairing codes from guessing, attempts are limited.',
    recovery: 'Wait a minute, then try again.',
  },
  server_busy: {
    title: 'DropLink is busy',
    detail: 'The service couldn’t open a new room right now.',
    recovery: 'Try again in a moment.',
  },
  unreachable: {
    title: 'Can’t reach DropLink',
    detail: 'This device couldn’t connect to the pairing service.',
    recovery: 'Check your internet connection and try again. Some workplace networks block this kind of connection.',
  },
  room_expired: {
    title: 'The pairing code expired',
    detail: 'Codes only last a few minutes so they can’t be reused.',
    recovery: 'Create a new code and share it again.',
  },
  connection_failed: {
    title: 'The devices couldn’t connect',
    detail: 'Your networks may block direct device-to-device connections.',
    recovery:
      'Put both devices on the same Wi-Fi network, or turn off VPNs and try again. If it keeps failing, the site owner can add a TURN relay server.',
  },
  connection_timeout: {
    title: 'Connecting took too long',
    detail: 'The two devices found each other but couldn’t open a connection.',
    recovery:
      'Put both devices on the same Wi-Fi network, or turn off VPNs and try again. If it keeps failing, the site owner can add a TURN relay server.',
  },
  peer_left: {
    title: 'The other device left',
    detail: 'The connection closed before pairing finished.',
    recovery: 'Start again and share a new code.',
  },
  pairing_rejected: {
    title: 'Pairing cancelled',
    detail: 'The verification codes were not confirmed, so no connection was kept.',
    recovery: 'If the codes didn’t match, someone else may have used your link. Create a new code and share it privately.',
  },
  bad_message: {
    title: 'Something went wrong',
    detail: 'The pairing service rejected a message from this device.',
    recovery: 'Reload the page and try again.',
  },
  already_in_room: {
    title: 'Something went wrong',
    detail: 'This device is already in a room.',
    recovery: 'Reload the page and try again.',
  },
  not_in_room: {
    title: 'Something went wrong',
    detail: 'The pairing room closed unexpectedly.',
    recovery: 'Start again with a new code.',
  },
  unknown: {
    title: 'Something went wrong',
    detail: 'An unexpected error occurred.',
    recovery: 'Reload the page and try again.',
  },
};

export function appError(kind: ErrorKind): AppError {
  return { kind, ...COPY[kind] };
}
