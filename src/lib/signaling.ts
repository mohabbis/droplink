import {
  parseServerMessage,
  type ClientMessage,
  type ErrorCode,
  type IceServer,
  type ServerMessage,
  type SignalPayload,
} from '../../shared/protocol';

export type SignalingEvent =
  | { type: 'peer-joined' }
  | { type: 'signal'; data: SignalPayload }
  | { type: 'peer-left' }
  | { type: 'room-expired' }
  | { type: 'error'; code: ErrorCode; message: string }
  | { type: 'closed' };

export class SignalingError extends Error {
  constructor(
    readonly code: ErrorCode | 'unreachable',
    message: string,
  ) {
    super(message);
    this.name = 'SignalingError';
  }
}

const CONNECT_TIMEOUT_MS = 10_000;

export function defaultSignalingUrl(): string {
  const override = import.meta.env.VITE_SIGNALING_URL as string | undefined;
  if (override) return override;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/api/ws`;
}

/**
 * WebSocket client for the signaling server. Used only while the two devices
 * set up their peer connection; closed as soon as the data channel opens.
 */
export class SignalingClient {
  private pending: { resolve: (m: ServerMessage) => void; reject: (e: Error) => void; expect: ServerMessage['t'] } | null =
    null;
  private closedByUs = false;

  private constructor(
    private readonly ws: WebSocket,
    readonly iceServers: IceServer[],
    readonly roomTtlMs: number,
    private readonly onEvent: (e: SignalingEvent) => void,
  ) {
    ws.addEventListener('message', (ev) => this.handle(ev.data));
    ws.addEventListener('close', () => {
      this.pending?.reject(new SignalingError('unreachable', 'Lost connection to the DropLink service.'));
      this.pending = null;
      if (!this.closedByUs) this.onEvent({ type: 'closed' });
    });
  }

  static connect(url: string, onEvent: (e: SignalingEvent) => void): Promise<SignalingClient> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        reject(new SignalingError('unreachable', 'Could not reach the DropLink service.'));
        return;
      }
      const timer = setTimeout(() => {
        ws.close();
        reject(new SignalingError('unreachable', 'The DropLink service did not respond.'));
      }, CONNECT_TIMEOUT_MS);
      const onFirst = (ev: MessageEvent) => {
        const msg = typeof ev.data === 'string' ? parseServerMessage(ev.data) : null;
        clearTimeout(timer);
        ws.removeEventListener('message', onFirst);
        if (msg?.t !== 'welcome') {
          ws.close();
          reject(new SignalingError('unreachable', 'Unexpected response from the DropLink service.'));
          return;
        }
        resolve(new SignalingClient(ws, msg.iceServers, msg.roomTtlMs, onEvent));
      };
      ws.addEventListener('message', onFirst);
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new SignalingError('unreachable', 'Could not reach the DropLink service.'));
      });
    });
  }

  create(): Promise<{ code: string; expiresAt: number }> {
    return this.request({ t: 'create' }, 'created').then((m) => m as Extract<ServerMessage, { t: 'created' }>);
  }

  join(code: string): Promise<{ code: string }> {
    return this.request({ t: 'join', code }, 'joined').then((m) => m as Extract<ServerMessage, { t: 'joined' }>);
  }

  signal(data: SignalPayload): void {
    this.send({ t: 'signal', data });
  }

  /** Leave the room and close the socket. Safe to call more than once. */
  close(): void {
    if (this.closedByUs) return;
    this.closedByUs = true;
    if (this.ws.readyState === WebSocket.OPEN) this.send({ t: 'leave' });
    this.ws.close(1000);
  }

  private send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private request(msg: ClientMessage, expect: ServerMessage['t']): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState !== WebSocket.OPEN) {
        reject(new SignalingError('unreachable', 'Lost connection to the DropLink service.'));
        return;
      }
      this.pending = { resolve, reject, expect };
      this.send(msg);
    });
  }

  private handle(raw: unknown): void {
    const msg = typeof raw === 'string' ? parseServerMessage(raw) : null;
    if (!msg) return;
    if (this.pending) {
      if (msg.t === this.pending.expect) {
        this.pending.resolve(msg);
        this.pending = null;
        return;
      }
      if (msg.t === 'error') {
        this.pending.reject(new SignalingError(msg.code, msg.message));
        this.pending = null;
        return;
      }
    }
    switch (msg.t) {
      case 'peer-joined':
      case 'peer-left':
      case 'room-expired':
        this.onEvent({ type: msg.t });
        break;
      case 'signal':
        this.onEvent({ type: 'signal', data: msg.data });
        break;
      case 'error':
        this.onEvent({ type: 'error', code: msg.code, message: msg.message });
        break;
    }
  }
}
