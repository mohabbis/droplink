import { formatBytes } from '../../lib/format';
import type { Transfer, TransferFile } from '../../state/types';
import { FileRow } from '../FileRow';
import { AlertIcon, CheckIcon, DownloadIcon, FileIcon } from '../icons';
import { Notice } from '../Notice';
import { ProgressBar } from '../ProgressBar';

interface Props {
  transfer: Transfer;
  peerLabel: string;
  onCancel(): void;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function headline(t: Transfer, peer: string): string {
  const files = plural(t.files.length, 'file');
  const out = t.direction === 'out';
  switch (t.status) {
    case 'awaiting-accept':
      return `Waiting for ${peer} to accept`;
    case 'incoming':
      return `${peer} wants to send you ${files}`;
    case 'transferring':
      return out ? `Sending ${files} to ${peer}` : `Receiving ${files} from ${peer}`;
    case 'complete': {
      const failed = t.files.filter((f) => f.status === 'failed').length;
      if (failed) return `${out ? 'Sent' : 'Received'} ${t.files.length - failed} of ${files}`;
      return out ? `Sent ${files}` : `Received ${files}`;
    }
    case 'declined':
      if (out) return t.declineReason === 'busy' ? `${peer} is busy with another transfer` : `${peer} declined`;
      return 'You declined';
    case 'cancelled':
      return t.cancelledBy === 'peer' ? `${peer} cancelled the transfer` : 'You cancelled the transfer';
    case 'failed':
      return out ? 'Sending failed' : 'Receiving failed';
  }
}

function fileMeta(f: TransferFile, t: Transfer): string {
  const size = formatBytes(f.size);
  if (f.status === 'failed') return f.error ?? 'Failed';
  if (t.status === 'cancelled' || t.status === 'failed' || t.status === 'declined') {
    return f.status === 'done' ? `${size} · ${t.direction === 'in' ? 'Verified' : 'Delivered'}` : size;
  }
  switch (f.status) {
    case 'queued':
      return `${size} · Waiting`;
    case 'active':
      return `${size} · ${t.direction === 'out' ? 'Sending' : 'Receiving'}…`;
    case 'verifying':
      return `${size} · Verifying…`;
    case 'done':
      if (t.direction === 'out') return `${size} · Delivered and verified`;
      return f.savedToDisk ? `${size} · Verified, saved` : `${size} · Verified`;
  }
}

function FileStatusIcon({ status }: { status: TransferFile['status'] }) {
  if (status === 'done') return <CheckIcon size={16} className="status-icon--done" />;
  if (status === 'failed') return <AlertIcon size={16} className="status-icon--failed" />;
  if (status === 'active' || status === 'verifying') return <span className="spinner" aria-hidden="true" />;
  return <FileIcon size={16} />;
}

export function downloadAll(files: TransferFile[]): void {
  // Browsers may ask once to allow multiple downloads.
  files.forEach((f, i) => {
    if (!f.url) return;
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = f.url!;
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }, i * 250);
  });
}

export function TransferItem({ transfer: t, peerLabel, onCancel }: Props) {
  const active = t.status === 'transferring' || t.status === 'awaiting-accept';
  const downloadable = t.files.filter((f) => f.url);
  const title = headline(t, peerLabel);

  return (
    <div className="transfer" aria-labelledby={`transfer-${t.id}`}>
      <div className="transfer__head">
        <div>
          <p className="transfer__title" id={`transfer-${t.id}`}>
            {title}
          </p>
          <p className="transfer__status">
            {plural(t.files.length, 'file')} · {formatBytes(t.totalBytes)}
            {t.saveTarget && t.direction === 'in' ? ` · Saving to ${t.saveTarget}` : ''}
          </p>
        </div>
        {active && (
          <button type="button" className="btn btn--small" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>

      {/* Announce status changes (not every progress tick) to screen readers. */}
      <p className="visually-hidden" role="status">
        {title}
      </p>

      {(t.status === 'transferring' || t.status === 'complete') && (
        <ProgressBar
          label={t.direction === 'out' ? 'Sending progress' : 'Receiving progress'}
          bytes={t.status === 'complete' ? t.totalBytes : t.bytes}
          total={t.totalBytes}
          bytesPerSecond={t.bytesPerSecond}
          etaSeconds={t.etaSeconds}
          done={t.status === 'complete'}
        />
      )}

      {t.status === 'awaiting-accept' && (
        <div className="status-line">
          <span className="pulse-dot" aria-hidden="true" />
          Nothing is sent until they accept.
        </div>
      )}

      {t.error && t.status === 'failed' && (
        <Notice tone="danger" title={t.error}>
          {t.direction === 'out'
            ? 'Reconnect and send the files again. Transfers can’t resume where they stopped.'
            : 'Ask the sender to try again. Transfers can’t resume where they stopped.'}
        </Notice>
      )}

      <ul className="file-list" aria-label={t.direction === 'out' ? 'Sent files' : 'Received files'}>
        {t.files.map((f) => (
          <FileRow
            key={f.id}
            name={f.name}
            size={f.size}
            meta={fileMeta(f, t)}
            error={f.status === 'failed'}
            icon={<FileStatusIcon status={f.status} />}
          >
            {f.url && (
              <a className="btn btn--small" href={f.url} download={f.name} aria-label={`Download ${f.name}`}>
                <DownloadIcon size={16} />
                Download
              </a>
            )}
          </FileRow>
        ))}
      </ul>

      {downloadable.length > 1 && (
        <button type="button" className="btn" onClick={() => downloadAll(downloadable)} style={{ alignSelf: 'flex-start' }}>
          <DownloadIcon size={16} />
          Download all ({downloadable.length})
        </button>
      )}
    </div>
  );
}
