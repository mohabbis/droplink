import { DeviceIcon } from '../icons';

interface Props {
  peerLabel: string | null;
  sas: string | null;
  localConfirmed: boolean;
  remoteConfirmed: boolean;
  onConfirm(): void;
  onReject(): void;
}

export function VerifyPairing({ peerLabel, sas, localConfirmed, remoteConfirmed, onConfirm, onReject }: Props) {
  return (
    <section className="card" aria-labelledby="verify-title">
      <h2 id="verify-title" className="card__title">
        Confirm it’s the right device
      </h2>
      <p className="card__lead">Check that both screens show the same code before you continue.</p>

      <div className="stack" style={{ marginTop: 16 }}>
        <div className="device">
          <span className="device__icon">
            <DeviceIcon />
          </span>
          <div>
            <p className="device__name">{peerLabel ?? 'Other device'}</p>
            <p className="small muted">{remoteConfirmed ? 'Has confirmed the code' : 'Wants to connect'}</p>
          </div>
        </div>

        <div className="sas" aria-label={sas ? `Verification code ${sas.replace(/\D/g, '').split('').join(' ')}` : 'Generating code'}>
          {sas ?? '··· ···'}
        </div>

        {localConfirmed ? (
          <div className="status-line" role="status">
            <span className="pulse-dot" aria-hidden="true" />
            Waiting for the other device to confirm…
          </div>
        ) : (
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={onConfirm} disabled={!sas}>
              Codes match
            </button>
            <button type="button" className="btn" onClick={onReject}>
              They don’t match
            </button>
          </div>
        )}
        <p className="small muted">
          The code is derived from this connection’s encryption keys. If the codes differ, something is intercepting the
          connection — cancel and start again.
        </p>
      </div>
    </section>
  );
}
