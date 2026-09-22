import type { AppError } from '../lib/errors';
import type { ConnectionKind } from '../lib/peer';
import type { SupportReport } from '../lib/support';

export type Role = 'host' | 'guest';

export type Phase =
  | { name: 'idle' }
  | { name: 'creating' }
  | { name: 'waiting'; code: string; expiresAt: number }
  | { name: 'joining'; code: string }
  | { name: 'connecting'; role: Role }
  | {
      name: 'verify';
      peerLabel: string | null;
      sas: string | null;
      localConfirmed: boolean;
      remoteConfirmed: boolean;
    }
  | { name: 'paired'; peerLabel: string; sas: string }
  | { name: 'disconnected'; peerLabel: string }
  | { name: 'error'; error: AppError };

export interface SelectedFile {
  id: string;
  file: File;
}

export type FileStatus = 'queued' | 'active' | 'verifying' | 'done' | 'failed';

export interface TransferFile {
  id: string;
  name: string;
  size: number;
  type: string;
  status: FileStatus;
  /** Object URL for downloading a received file kept in memory. */
  url?: string;
  savedToDisk?: boolean;
  error?: string;
}

export type TransferStatus =
  | 'awaiting-accept' // outgoing: waiting for the receiver
  | 'incoming' // incoming: waiting for this device to accept
  | 'transferring'
  | 'complete'
  | 'declined'
  | 'cancelled'
  | 'failed';

export interface Transfer {
  id: string;
  direction: 'out' | 'in';
  status: TransferStatus;
  files: TransferFile[];
  totalBytes: number;
  bytes: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
  cancelledBy?: 'me' | 'peer';
  declineReason?: 'busy' | 'user';
  error?: string;
  /** Where incoming files are being written, when saving straight to disk. */
  saveTarget?: string;
}

export interface SessionState {
  support: SupportReport;
  deviceLabel: string;
  phase: Phase;
  selected: SelectedFile[];
  connection: ConnectionKind;
  /** Newest first. */
  transfers: Transfer[];
}

export const FINAL_STATUSES: ReadonlySet<TransferStatus> = new Set(['complete', 'declined', 'cancelled', 'failed']);

export function activeTransfer(state: Pick<SessionState, 'transfers'>): Transfer | undefined {
  return state.transfers.find((t) => !FINAL_STATUSES.has(t.status));
}
