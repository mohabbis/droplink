import type { ConnectionKind } from '../../lib/peer';
import { ConnectionBadge, connectionDescription } from '../ConnectionBadge';
import { DeviceIcon } from '../icons';

interface Props {
  peerLabel: string;
  sas: string;
  connection: ConnectionKind;
  onDisconnect(): void;
  busy: boolean;
}

export function PairedDevice({ peerLabel, sas, connection, onDisconnect, busy }: Props) {
  return (
    <section className="card" aria-labelledby="paired-title">
      <div className="card__header" style={{ marginBottom: 12 }}>
        <div className="device">
          <span className="device__icon">
            <DeviceIcon />
          </span>
          <div>
            <p className="small muted" id="paired-title">
              Connected to
            </p>
            <p className="device__name">{peerLabel}</p>
          </div>
        </div>
        <button
          type="button"
          className="btn btn--small btn--quiet btn--danger"
          onClick={() => {
            if (!busy || confirm('A transfer is in progress. Disconnect anyway?')) onDisconnect();
          }}
        >
          Disconnect
        </button>
      </div>
      <div className="stack" style={{ gap: 10 }}>
        <div>
          <ConnectionBadge kind={connection} />
        </div>
        <p className="small muted">{connectionDescription(connection)}</p>
        <dl className="meta-list">
          <dt>Verification code</dt>
          <dd style={{ fontFamily: 'var(--font-mono)' }}>{sas}</dd>
        </dl>
      </div>
    </section>
  );
}
