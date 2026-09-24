import type { IceServer, SignalPayload } from '../../shared/protocol';

export type ConnectionKind = 'direct' | 'relay' | 'unknown';

export interface PeerEvents {
  onSignal(data: SignalPayload): void;
  onChannelOpen(channel: RTCDataChannel): void;
  /** ICE could not find a working path, or an established connection was lost. */
  onFailed(): void;
}

/**
 * One RTCPeerConnection with a single ordered, reliable data channel.
 * The room creator makes the offer; the joiner answers.
 */
export class PeerLink {
  readonly pc: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private closed = false;

  constructor(
    private readonly role: 'host' | 'guest',
    iceServers: IceServer[],
    private readonly events: PeerEvents,
  ) {
    this.pc = new RTCPeerConnection({ iceServers });
    this.pc.addEventListener('icecandidate', (ev) => {
      const c = ev.candidate?.toJSON();
      this.events.onSignal({
        kind: 'ice',
        candidate:
          c && typeof c.candidate === 'string'
            ? {
                candidate: c.candidate,
                sdpMid: c.sdpMid ?? null,
                sdpMLineIndex: c.sdpMLineIndex ?? null,
                usernameFragment: c.usernameFragment ?? null,
              }
            : null,
      });
    });
    this.pc.addEventListener('connectionstatechange', () => {
      if (!this.closed && this.pc.connectionState === 'failed') this.events.onFailed();
    });
    if (role === 'guest') {
      this.pc.addEventListener('datachannel', (ev) => this.setupChannel(ev.channel));
    }
  }

  /** Host only: create the data channel and send the offer. */
  async start(): Promise<void> {
    if (this.role !== 'host') throw new Error('Only the host starts the connection');
    this.setupChannel(this.pc.createDataChannel('droplink', { ordered: true }));
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.events.onSignal({ kind: 'offer', sdp: offer.sdp ?? '' });
  }

  async handleSignal(data: SignalPayload): Promise<void> {
    if (this.closed) return;
    switch (data.kind) {
      case 'offer': {
        if (this.role !== 'guest') return;
        await this.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        await this.flushCandidates();
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.events.onSignal({ kind: 'answer', sdp: answer.sdp ?? '' });
        break;
      }
      case 'answer':
        if (this.role !== 'host') return;
        await this.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        await this.flushCandidates();
        break;
      case 'ice':
        if (!data.candidate) return;
        if (!this.pc.remoteDescription) {
          this.pendingCandidates.push(data.candidate);
          return;
        }
        await this.pc.addIceCandidate(data.candidate).catch(() => undefined);
        break;
    }
  }

  /** Whether the selected candidate pair goes through a TURN relay. */
  async connectionKind(): Promise<ConnectionKind> {
    try {
      const stats = await this.pc.getStats();
      let pairId: string | undefined;
      stats.forEach((s) => {
        if (s.type === 'transport' && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId;
      });
      let pair: RTCIceCandidatePairStats | undefined;
      stats.forEach((s) => {
        if (s.type !== 'candidate-pair') return;
        // Firefox has no transport.selectedCandidatePairId; it marks the pair as selected.
        if (s.id === pairId || (!pairId && (s as { selected?: boolean }).selected)) pair = s;
      });
      if (!pair) {
        stats.forEach((s) => {
          if (!pair && s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s;
        });
      }
      if (!pair) return 'unknown';
      const local = stats.get(pair.localCandidateId) as { candidateType?: string } | undefined;
      const remote = stats.get(pair.remoteCandidateId) as { candidateType?: string } | undefined;
      if (!local?.candidateType || !remote?.candidateType) return 'unknown';
      return local.candidateType === 'relay' || remote.candidateType === 'relay' ? 'relay' : 'direct';
    } catch {
      return 'unknown';
    }
  }

  /** The DTLS certificate fingerprints of both ends, used for the verification code. */
  fingerprints(): { local: string; remote: string } | null {
    const local = extractFingerprint(this.pc.localDescription?.sdp);
    const remote = extractFingerprint(this.pc.remoteDescription?.sdp);
    return local && remote ? { local, remote } : null;
  }

  close(): void {
    this.closed = true;
    try {
      this.channel?.close();
    } catch {
      /* already closed */
    }
    this.pc.close();
  }

  private setupChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.binaryType = 'arraybuffer';
    if (channel.readyState === 'open') this.events.onChannelOpen(channel);
    else channel.addEventListener('open', () => this.events.onChannelOpen(channel), { once: true });
  }

  private async flushCandidates(): Promise<void> {
    const pending = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const c of pending) await this.pc.addIceCandidate(c).catch(() => undefined);
  }
}

export function extractFingerprint(sdp: string | undefined): string | null {
  const m = sdp?.match(/^a=fingerprint:(\S+) ([0-9A-Fa-f:]+)\s*$/m);
  return m ? `${m[1].toLowerCase()} ${m[2].toUpperCase()}` : null;
}
