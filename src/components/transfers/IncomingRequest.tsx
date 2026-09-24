import { formatBytes } from '../../lib/format';
import type { Transfer } from '../../state/types';
import { FileRow } from '../FileRow';
import { Notice } from '../Notice';

/** Above this, holding everything in memory risks crashing the tab on phones and low-RAM devices. */
export const LARGE_TRANSFER_BYTES = 1.5e9;

interface Props {
  transfer: Transfer;
  peerLabel: string;
  canSaveToDisk: boolean;
  onAccept(toDisk: boolean): void;
  onDecline(): void;
}

export function IncomingRequest({ transfer, peerLabel, canSaveToDisk, onAccept, onDecline }: Props) {
  const n = transfer.files.length;
  const large = transfer.totalBytes > LARGE_TRANSFER_BYTES;
  return (
    <div className="transfer" role="alert" aria-labelledby={`incoming-${transfer.id}`}>
      <div>
        <p className="transfer__title" id={`incoming-${transfer.id}`}>
          {peerLabel} wants to send you {n} {n === 1 ? 'file' : 'files'}
        </p>
        <p className="transfer__status">{formatBytes(transfer.totalBytes)} total · Nothing is saved until you accept</p>
      </div>
      <ul className="file-list" aria-label="Incoming files">
        {transfer.files.map((f) => (
          <FileRow key={f.id} name={f.name} size={f.size} />
        ))}
      </ul>
      {large && !canSaveToDisk && (
        <Notice tone="warning" title="This is a large transfer">
          This browser keeps received files in memory until you download them. Files this large may fail on devices with
          little memory. For big transfers, use Chrome or Edge on a computer, which can save straight to disk.
        </Notice>
      )}
      {large && canSaveToDisk && (
        <Notice tone="info">For large transfers, “Save to a folder” writes straight to disk and uses less memory.</Notice>
      )}
      {transfer.error && <Notice tone="danger">{transfer.error}</Notice>}
      <div className="row">
        <button type="button" className="btn btn--primary" onClick={() => onAccept(false)}>
          Accept
        </button>
        {canSaveToDisk && (
          <button type="button" className="btn" onClick={() => onAccept(true)}>
            {n === 1 ? 'Save to…' : 'Save to a folder…'}
          </button>
        )}
        <button type="button" className="btn btn--quiet" onClick={onDecline}>
          Decline
        </button>
      </div>
    </div>
  );
}
