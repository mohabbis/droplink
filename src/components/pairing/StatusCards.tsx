import type { AppError } from '../../lib/errors';
import { AlertIcon } from '../icons';

export function ErrorCard({ error, onRetry }: { error: AppError; onRetry(): void }) {
  return (
    <section className="card error-card" role="alert" aria-labelledby="error-title">
      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <AlertIcon size={20} style={{ color: 'var(--danger)', flex: 'none', marginTop: 1 }} />
        <div>
          <h2 id="error-title" className="card__title">
            {error.title}
          </h2>
          <p className="card__lead">{error.detail}</p>
        </div>
      </div>
      <p style={{ marginTop: 14, fontSize: 14 }}>
        <strong>What to do:</strong> {error.recovery}
      </p>
      <button type="button" className="btn btn--primary" onClick={onRetry} style={{ marginTop: 16 }}>
        Start again
      </button>
    </section>
  );
}

export function DisconnectedCard({ peerLabel, onDone }: { peerLabel: string; onDone(): void }) {
  return (
    <section className="card" role="status" aria-labelledby="disconnected-title">
      <h2 id="disconnected-title" className="card__title">
        {peerLabel} disconnected
      </h2>
      <p className="card__lead">
        The connection has closed. Files you already received are still available below until you leave this page.
      </p>
      <button type="button" className="btn btn--primary" onClick={onDone} style={{ marginTop: 16 }}>
        Connect a device
      </button>
    </section>
  );
}

export function UnsupportedCard({ missing }: { missing: string[] }) {
  return (
    <section className="card error-card" role="alert" aria-labelledby="unsupported-title">
      <h2 id="unsupported-title" className="card__title">
        This browser can’t send files directly
      </h2>
      <p className="card__lead">DropLink needs {missing.join(', ')}, which aren’t available here.</p>
      <p style={{ marginTop: 14, fontSize: 14 }}>
        <strong>What to do:</strong> open this page in a current version of Chrome, Edge, Firefox, or Safari. If you
        opened it inside another app, use “Open in browser”.
      </p>
    </section>
  );
}
