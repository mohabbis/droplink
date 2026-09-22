import { normalizeCode } from '../../shared/codes';
import { deviceLabel } from '../lib/device';
import { appError, type ErrorKind } from '../lib/errors';
import { PeerLink } from '../lib/peer';
import { verificationCode } from '../lib/sas';
import { defaultSignalingUrl, SignalingClient, SignalingError, type SignalingEvent } from '../lib/signaling';
import { checkSupport, type SupportReport } from '../lib/support';
import { chunkSizeFor } from '../lib/transfer/chunker';
import { pickDiskTarget, type DiskTarget } from '../lib/transfer/diskSink';
import { ProgressTracker } from '../lib/transfer/progress';
import { MemorySink, TransferReceiver, type FileOutcome } from '../lib/transfer/receiver';
import { ChannelClosedError, sendFiles, type OutgoingFile } from '../lib/transfer/sender';
import { encodeWire, parseWireMessage, randomId, type FileMeta, type WireMessage } from '../lib/transfer/wire';
import {
  activeTransfer,
  type Phase,
  type Role,
  type SelectedFile,
  type SessionState,
  type Transfer,
  type TransferFile,
} from './types';

/** Give up if the data channel hasn't opened this long after both devices joined. */
const CONNECT_TIMEOUT_MS = 30_000;
/** After our data channel opens, the peer's `hello` must arrive within this time. */
const HELLO_TIMEOUT_MS = 10_000;
/** Receiver confirms progress to the sender every this many bytes. */
const ACK_INTERVAL_BYTES = 1024 * 1024;
/** Re-render progress at most this often. */
const PROGRESS_RENDER_MS = 120;

interface Outgoing {
  transferId: string;
  files: OutgoingFile[];
  abort: AbortController;
  tracker: ProgressTracker;
  pendingResults: Set<string>;
}

interface Incoming {
  transferId: string;
  manifest: FileMeta[];
  receiver: TransferReceiver | null;
  tracker: ProgressTracker;
  lastAck: number;
}

export interface SessionOptions {
  signalingUrl?: string;
  support?: SupportReport;
  label?: string;
}

/**
 * Owns the whole lifecycle of one DropLink session: pairing through the
 * signaling server, the peer connection, and file transfers in both directions.
 * React subscribes via `subscribe` / `getSnapshot` (useSyncExternalStore).
 */
export class DropLinkSession {
  private state: SessionState;
  private readonly listeners = new Set<() => void>();
  private readonly signalingUrl: string;

  private sig: SignalingClient | null = null;
  private peer: PeerLink | null = null;
  private channel: RTCDataChannel | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private progressTimer: ReturnType<typeof setTimeout> | null = null;
  private outgoing: Outgoing | null = null;
  private incoming: Incoming | null = null;
  private objectUrls: string[] = [];
  /** Incremented on every teardown so callbacks from an old attempt are ignored. */
  private generation = 0;

  constructor(opts: SessionOptions = {}) {
    this.signalingUrl = opts.signalingUrl ?? defaultSignalingUrl();
    this.state = {
      support: opts.support ?? checkSupport(),
      deviceLabel: opts.label ?? deviceLabel(),
      phase: { name: 'idle' },
      selected: [],
      connection: 'unknown',
      transfers: [],
    };
  }

  // ---- store plumbing -----------------------------------------------------

  getSnapshot = (): SessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private setPhase(phase: Phase): void {
    this.set({ phase });
  }

  private updateTransfer(id: string, fn: (t: Transfer) => Transfer): void {
    this.set({ transfers: this.state.transfers.map((t) => (t.id === id ? fn(t) : t)) });
  }

  private updateFile(transferId: string, fileId: string, patch: Partial<TransferFile>): void {
    this.updateTransfer(transferId, (t) => ({
      ...t,
      files: t.files.map((f) => (f.id === fileId ? { ...f, ...patch } : f)),
    }));
  }

  // ---- file selection -----------------------------------------------------

  addFiles(files: Iterable<File>): void {
    const seen = new Set(this.state.selected.map((s) => `${s.file.name}|${s.file.size}|${s.file.lastModified}`));
    const added: SelectedFile[] = [];
    for (const file of files) {
      const key = `${file.name}|${file.size}|${file.lastModified}`;
      if (seen.has(key)) continue;
      seen.add(key);
      added.push({ id: randomId(), file });
    }
    if (added.length) this.set({ selected: [...this.state.selected, ...added] });
  }

  removeFile(id: string): void {
    this.set({ selected: this.state.selected.filter((s) => s.id !== id) });
  }

  clearFiles(): void {
    this.set({ selected: [] });
  }

  // ---- pairing ------------------------------------------------------------

  async createRoom(): Promise<void> {
    if (!this.state.support.ok) return;
    const gen = this.restart();
    this.setPhase({ name: 'creating' });
    try {
      const sig = await this.connectSignaling(gen);
      if (!sig) return;
      const { code } = await sig.create();
      if (gen !== this.generation) return;
      // Expiry is computed locally so a skewed server clock can't distort the countdown.
      this.setPhase({ name: 'waiting', code, expiresAt: Date.now() + sig.roomTtlMs });
    } catch (err) {
      if (gen === this.generation) this.fail(errorKindOf(err));
    }
  }

  async joinRoom(rawCode: string): Promise<void> {
    if (!this.state.support.ok) return;
    const code = normalizeCode(rawCode);
    const gen = this.restart();
    if (!code) {
      this.fail('invalid_code');
      return;
    }
    this.setPhase({ name: 'joining', code });
    try {
      const sig = await this.connectSignaling(gen);
      if (!sig) return;
      await sig.join(code);
      if (gen !== this.generation) return;
      this.startPeer(gen, 'guest');
    } catch (err) {
      if (gen === this.generation) this.fail(errorKindOf(err));
    }
  }

  /** Both people must confirm the verification code before files can be sent. */
  confirmPairing(): void {
    const p = this.state.phase;
    if (p.name !== 'verify' || p.localConfirmed || !p.sas) return;
    this.sendWire({ t: 'pair-confirm' });
    this.setPhase({ ...p, localConfirmed: true });
    this.maybePaired();
  }

  rejectPairing(): void {
    if (this.state.phase.name !== 'verify') return;
    this.sendWire({ t: 'bye' });
    this.teardown();
    this.fail('pairing_rejected');
  }

  /** Disconnect and return to the start screen. Selected files are kept. */
  leave(): void {
    this.sendWire({ t: 'bye' });
    this.teardown();
    this.revokeUrls();
    this.set({ phase: { name: 'idle' }, transfers: [], connection: 'unknown' });
  }

  // ---- transfers ----------------------------------------------------------

  /** Offer the selected files to the paired device. */
  sendSelected(): void {
    if (this.state.phase.name !== 'paired' || activeTransfer(this.state) || !this.state.selected.length) return;
    const transferId = randomId();
    const selected = this.state.selected;
    const files: TransferFile[] = selected.map((s) => ({
      id: s.id,
      name: s.file.name,
      size: s.file.size,
      type: s.file.type,
      status: 'queued',
    }));
    const totalBytes = files.reduce((n, f) => n + f.size, 0);
    this.outgoing = {
      transferId,
      files: selected.map((s) => ({ id: s.id, blob: s.file })),
      abort: new AbortController(),
      tracker: new ProgressTracker(totalBytes),
      pendingResults: new Set(files.map((f) => f.id)),
    };
    this.addTransfer({
      id: transferId,
      direction: 'out',
      status: 'awaiting-accept',
      files,
      totalBytes,
      bytes: 0,
      bytesPerSecond: 0,
      etaSeconds: null,
    });
    this.sendWire({
      t: 'manifest',
      transferId,
      files: files.map(({ id, name, size, type }) => ({ id, name, size, type })),
    });
  }

  /** Accept an incoming offer. With `toDisk`, asks where to save first (Chromium only). */
  async acceptIncoming(toDisk = false): Promise<void> {
    const inc = this.incoming;
    const t = inc && this.state.transfers.find((x) => x.id === inc.transferId);
    if (!inc || !t || t.status !== 'incoming') return;

    let target: DiskTarget | null = null;
    if (toDisk) {
      try {
        target = await pickDiskTarget(inc.manifest);
      } catch {
        this.updateTransfer(t.id, (x) => ({ ...x, error: 'This browser couldn’t open a save location. Try saving to Downloads instead.' }));
        return;
      }
      if (!target) return; // dialog dismissed; the offer stays open
      if (this.incoming !== inc) return;
    }

    const transferId = inc.transferId;
    inc.receiver = new TransferReceiver(
      transferId,
      inc.manifest,
      (meta) => (target ? target.sinkFor(meta) : Promise.resolve(new MemorySink(meta.type))),
      {
        onProgress: (bytes) => {
          inc.tracker.update(bytes);
          if (bytes - inc.lastAck >= ACK_INTERVAL_BYTES) {
            inc.lastAck = bytes;
            this.sendWire({ t: 'ack', transferId, bytes });
          }
          this.scheduleProgress();
        },
        onFileStart: (fileId) => this.updateFile(transferId, fileId, { status: 'active' }),
        onFileVerifying: (fileId) => this.updateFile(transferId, fileId, { status: 'verifying' }),
        onFileDone: (outcome) => this.onIncomingFileDone(inc, outcome, target !== null),
        onProtocolError: (message) => this.abortTransfer(transferId, message),
      },
    );
    this.updateTransfer(transferId, (x) => ({
      ...x,
      status: 'transferring',
      error: undefined,
      saveTarget: target?.description,
    }));
    this.sendWire({ t: 'accept', transferId });
  }

  declineIncoming(): void {
    const inc = this.incoming;
    if (!inc) return;
    this.incoming = null;
    this.sendWire({ t: 'decline', transferId: inc.transferId, reason: 'user' });
    this.updateTransfer(inc.transferId, (t) => ({ ...t, status: 'declined', declineReason: 'user' }));
  }

  /** Cancel whichever transfer is in progress, in either direction. */
  cancelTransfer(): void {
    const t = activeTransfer(this.state);
    if (!t) return;
    this.sendWire({ t: 'cancel', transferId: t.id });
    this.stopTransfer(t.id);
    this.updateTransfer(t.id, (x) => ({ ...x, status: 'cancelled', cancelledBy: 'me' }));
  }

  /** Remove finished transfers from the list and release their memory. */
  clearFinished(): void {
    const keep = this.state.transfers.filter((t) => t === activeTransfer(this.state));
    const dropped = this.state.transfers.filter((t) => !keep.includes(t));
    for (const t of dropped) for (const f of t.files) if (f.url) URL.revokeObjectURL(f.url);
    this.objectUrls = this.objectUrls.filter((u) => !dropped.some((t) => t.files.some((f) => f.url === u)));
    this.set({ transfers: keep });
  }

  // ---- internals: signaling & connection --------------------------------------

  private async connectSignaling(gen: number): Promise<SignalingClient | null> {
    const sig = await SignalingClient.connect(this.signalingUrl, (e) => this.onSignalingEvent(gen, e));
    if (gen !== this.generation) {
      sig.close();
      return null;
    }
    this.sig = sig;
    return sig;
  }

  private onSignalingEvent(gen: number, e: SignalingEvent): void {
    if (gen !== this.generation || this.channel) return; // signaling no longer matters once connected
    switch (e.type) {
      case 'peer-joined':
        this.startPeer(gen, 'host');
        break;
      case 'signal':
        this.peer?.handleSignal(e.data).catch(() => this.fail('connection_failed'));
        break;
      case 'peer-left':
        this.fail('peer_left');
        break;
      case 'room-expired':
        this.fail(this.state.phase.name === 'waiting' ? 'room_expired' : 'connection_timeout');
        break;
      case 'error':
        this.fail(e.code);
        break;
      case 'closed':
        this.fail('unreachable');
        break;
    }
  }

  private startPeer(gen: number, role: Role): void {
    if (!this.sig) return;
    this.setPhase({ name: 'connecting', role });
    const peer = new PeerLink(role, this.sig.iceServers, {
      onSignal: (data) => {
        if (gen === this.generation) this.sig?.signal(data);
      },
      onChannelOpen: (channel) => {
        if (gen === this.generation) void this.onChannelOpen(gen, channel);
      },
      onFailed: () => {
        if (gen !== this.generation) return;
        if (this.channel) this.onPeerGone();
        else this.fail('connection_failed');
      },
    });
    this.peer = peer;
    this.connectTimer = setTimeout(() => {
      if (gen === this.generation && !this.channel) this.fail('connection_timeout');
    }, CONNECT_TIMEOUT_MS);
    if (role === 'host') peer.start().catch(() => this.fail('connection_failed'));
  }

  private async onChannelOpen(gen: number, channel: RTCDataChannel): Promise<void> {
    this.clearConnectTimer();
    this.channel = channel;
    // Keep the signaling room open until the peer's `hello` arrives over the data
    // channel. Leaving earlier makes the server announce `peer-left` while the
    // other side's channel may still be opening, which would abort its pairing.
    this.connectTimer = setTimeout(() => {
      if (gen === this.generation && this.sig) this.fail('connection_timeout');
    }, HELLO_TIMEOUT_MS);

    channel.addEventListener('message', (ev) => {
      if (gen !== this.generation) return;
      if (typeof ev.data === 'string') {
        const msg = parseWireMessage(ev.data);
        if (msg) this.onWire(msg);
      } else if (ev.data instanceof ArrayBuffer) {
        void this.incoming?.receiver?.chunk(ev.data);
      }
    });
    channel.addEventListener('close', () => {
      if (gen === this.generation) this.onPeerGone();
    });

    this.setPhase({ name: 'verify', peerLabel: null, sas: null, localConfirmed: false, remoteConfirmed: false });
    this.sendWire({ t: 'hello', v: 1, label: this.state.deviceLabel });

    const fp = this.peer?.fingerprints();
    if (!fp) {
      this.teardown();
      this.fail('connection_failed');
      return;
    }
    const sas = await verificationCode(fp.local, fp.remote);
    if (gen !== this.generation) return;
    const p = this.state.phase;
    if (p.name === 'verify') this.setPhase({ ...p, sas });

    const kind = (await this.peer?.connectionKind()) ?? 'unknown';
    if (gen === this.generation) this.set({ connection: kind });
  }

  private maybePaired(): void {
    const p = this.state.phase;
    if (p.name === 'verify' && p.localConfirmed && p.remoteConfirmed && p.sas) {
      this.setPhase({ name: 'paired', peerLabel: p.peerLabel ?? 'Other device', sas: p.sas });
    }
  }

  /** The data channel closed or the connection failed after it was established. */
  private onPeerGone(): void {
    const p = this.state.phase;
    const peerLabel = p.name === 'paired' ? p.peerLabel : p.name === 'verify' ? (p.peerLabel ?? 'Other device') : null;
    const t = activeTransfer(this.state);
    if (t) {
      this.stopTransfer(t.id);
      this.updateTransfer(t.id, (x) => ({ ...x, status: 'failed', error: 'The other device disconnected.' }));
    }
    const wasPaired = p.name === 'paired';
    this.teardown();
    if (wasPaired && peerLabel) this.setPhase({ name: 'disconnected', peerLabel });
    else if (p.name !== 'idle' && p.name !== 'error' && p.name !== 'disconnected') this.fail('peer_left');
  }

  // ---- internals: data channel messages -----------------------------------

  private onWire(msg: WireMessage): void {
    const phase = this.state.phase;
    switch (msg.t) {
      case 'hello':
        if (phase.name !== 'verify') return;
        // Both data channels are open now; the room is no longer needed, so leave
        // it and the server forgets both devices.
        this.clearConnectTimer();
        this.sig?.close();
        this.sig = null;
        this.setPhase({ ...phase, peerLabel: msg.label || 'Other device' });
        return;
      case 'pair-confirm':
        if (phase.name === 'verify') {
          this.setPhase({ ...phase, remoteConfirmed: true });
          this.maybePaired();
        }
        return;
      case 'bye':
        this.onPeerGone();
        return;
    }
    // Everything below requires a confirmed pairing.
    if (phase.name !== 'paired') {
      if (msg.t === 'manifest') this.sendWire({ t: 'decline', transferId: msg.transferId, reason: 'user' });
      return;
    }
    switch (msg.t) {
      case 'manifest':
        this.onManifest(msg.transferId, msg.files);
        break;
      case 'accept':
        if (this.outgoing?.transferId === msg.transferId) void this.runSend(this.outgoing);
        break;
      case 'decline':
        if (this.outgoing?.transferId === msg.transferId) {
          this.outgoing = null;
          this.updateTransfer(msg.transferId, (t) => ({ ...t, status: 'declined', declineReason: msg.reason }));
        }
        break;
      case 'ack':
        if (this.outgoing?.transferId === msg.transferId) {
          this.outgoing.tracker.update(msg.bytes);
          this.scheduleProgress();
        }
        break;
      case 'file-result':
        this.onFileResult(msg.transferId, msg.fileId, msg.ok);
        break;
      case 'file-start':
        if (this.incoming?.transferId === msg.transferId) void this.incoming.receiver?.fileStart(msg.fileId);
        break;
      case 'file-end':
        if (this.incoming?.transferId === msg.transferId) void this.incoming.receiver?.fileEnd(msg.fileId, msg.sha256);
        break;
      case 'complete':
        if (this.incoming?.transferId === msg.transferId) void this.finishIncoming(this.incoming);
        break;
      case 'cancel': {
        const t = this.state.transfers.find((x) => x.id === msg.transferId);
        if (t && (t.status === 'transferring' || t.status === 'awaiting-accept' || t.status === 'incoming')) {
          this.stopTransfer(t.id);
          this.updateTransfer(t.id, (x) => ({ ...x, status: 'cancelled', cancelledBy: 'peer' }));
        }
        break;
      }
    }
  }

  private onManifest(transferId: string, files: FileMeta[]): void {
    if (activeTransfer(this.state) || this.state.transfers.some((t) => t.id === transferId)) {
      this.sendWire({ t: 'decline', transferId, reason: 'busy' });
      return;
    }
    const totalBytes = files.reduce((n, f) => n + f.size, 0);
    this.incoming = { transferId, manifest: files, receiver: null, tracker: new ProgressTracker(totalBytes), lastAck: 0 };
    this.addTransfer({
      id: transferId,
      direction: 'in',
      status: 'incoming',
      files: files.map((f) => ({ ...f, status: 'queued' })),
      totalBytes,
      bytes: 0,
      bytesPerSecond: 0,
      etaSeconds: null,
    });
  }

  private async runSend(out: Outgoing): Promise<void> {
    const channel = this.channel;
    if (!channel) return;
    this.updateTransfer(out.transferId, (t) => ({ ...t, status: 'transferring' }));
    try {
      await sendFiles(channel, out.transferId, out.files, {
        chunkSize: chunkSizeFor(this.peer?.pc.sctp?.maxMessageSize),
        signal: out.abort.signal,
        onFileStart: (id) => this.updateFile(out.transferId, id, { status: 'active' }),
        onFileSent: (id) => this.updateFile(out.transferId, id, { status: 'verifying' }),
      });
      this.sendWire({ t: 'complete', transferId: out.transferId });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof ChannelClosedError ? 'The other device disconnected.' : 'Sending failed.';
      this.abortTransfer(out.transferId, message);
    }
  }

  private onFileResult(transferId: string, fileId: string, ok: boolean): void {
    const out = this.outgoing;
    if (!out || out.transferId !== transferId || !out.pendingResults.delete(fileId)) return;
    this.updateFile(transferId, fileId, ok ? { status: 'done' } : { status: 'failed', error: 'The other device couldn’t verify this file.' });
    if (out.pendingResults.size === 0) {
      this.outgoing = null;
      this.flushProgress();
      this.updateTransfer(transferId, (t) => ({ ...t, status: 'complete', bytes: t.totalBytes, etaSeconds: 0 }));
      // Files were delivered; clear the selection so they aren't sent twice by accident.
      const sent = new Set(out.files.map((f) => f.id));
      this.set({ selected: this.state.selected.filter((s) => !sent.has(s.id)) });
    }
  }

  private onIncomingFileDone(inc: Incoming, outcome: FileOutcome, savedToDisk: boolean): void {
    let url: string | undefined;
    if (outcome.ok && outcome.blob) {
      url = URL.createObjectURL(outcome.blob);
      this.objectUrls.push(url);
    }
    this.updateFile(inc.transferId, outcome.fileId, {
      status: outcome.ok ? 'done' : 'failed',
      url,
      savedToDisk: outcome.ok && savedToDisk,
      error: outcome.error,
    });
    this.sendWire({ t: 'ack', transferId: inc.transferId, bytes: inc.tracker.snapshot().bytes });
    this.sendWire({ t: 'file-result', transferId: inc.transferId, fileId: outcome.fileId, ok: outcome.ok });
  }

  private async finishIncoming(inc: Incoming): Promise<void> {
    await inc.receiver?.drain();
    if (this.incoming !== inc) return;
    this.incoming = null;
    this.flushProgress();
    const t = this.state.transfers.find((x) => x.id === inc.transferId);
    if (!t || t.status !== 'transferring') return;
    const allFailed = t.files.every((f) => f.status === 'failed');
    this.updateTransfer(inc.transferId, (x) => ({
      ...x,
      status: allFailed ? 'failed' : 'complete',
      error: allFailed ? 'No files could be verified.' : x.error,
      etaSeconds: 0,
    }));
  }

  /** Cancel a transfer because something went wrong, telling the other device. */
  private abortTransfer(transferId: string, message: string): void {
    this.sendWire({ t: 'cancel', transferId });
    this.stopTransfer(transferId);
    this.updateTransfer(transferId, (t) => ({ ...t, status: 'failed', error: message }));
  }

  /** Stop local work for a transfer (sender loop or receiver writes). */
  private stopTransfer(transferId: string): void {
    if (this.outgoing?.transferId === transferId) {
      this.outgoing.abort.abort();
      this.outgoing = null;
    }
    if (this.incoming?.transferId === transferId) {
      void this.incoming.receiver?.abort();
      this.incoming = null;
    }
  }

  private addTransfer(t: Transfer): void {
    this.set({ transfers: [t, ...this.state.transfers] });
  }

  // ---- internals: progress rendering --------------------------------------

  private scheduleProgress(): void {
    if (this.progressTimer) return;
    this.progressTimer = setTimeout(() => {
      this.progressTimer = null;
      this.flushProgress();
    }, PROGRESS_RENDER_MS);
  }

  private flushProgress(): void {
    for (const src of [this.outgoing, this.incoming]) {
      if (!src) continue;
      const s = src.tracker.snapshot();
      this.updateTransfer(src.transferId, (t) =>
        t.status === 'transferring' ? { ...t, bytes: s.bytes, bytesPerSecond: s.bytesPerSecond, etaSeconds: s.etaSeconds } : t,
      );
    }
  }

  // ---- internals: lifecycle -----------------------------------------------

  private sendWire(msg: WireMessage): void {
    if (this.channel?.readyState === 'open') this.channel.send(encodeWire(msg));
  }

  /** Tear down any previous attempt and start a new generation. */
  private restart(): number {
    this.teardown();
    // Earlier transfers stay listed so received files remain downloadable.
    this.set({ connection: 'unknown' });
    return this.generation;
  }

  private teardown(): void {
    this.generation += 1;
    this.clearConnectTimer();
    if (this.progressTimer) clearTimeout(this.progressTimer);
    this.progressTimer = null;
    this.outgoing?.abort.abort();
    this.outgoing = null;
    void this.incoming?.receiver?.abort();
    this.incoming = null;
    this.sig?.close();
    this.sig = null;
    this.peer?.close();
    this.peer = null;
    this.channel = null;
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private revokeUrls(): void {
    for (const u of this.objectUrls) URL.revokeObjectURL(u);
    this.objectUrls = [];
  }

  private fail(kind: ErrorKind): void {
    this.teardown();
    this.setPhase({ name: 'error', error: appError(kind) });
  }

  /** Return to the start screen after an error or disconnect, keeping received files. */
  reset(): void {
    this.teardown();
    this.setPhase({ name: 'idle' });
  }

  /** Release everything (page unload). */
  dispose(): void {
    this.sendWire({ t: 'bye' });
    this.teardown();
    this.revokeUrls();
  }
}

function errorKindOf(err: unknown): ErrorKind {
  if (err instanceof SignalingError) return err.code;
  return 'unknown';
}
