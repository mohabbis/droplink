import type { SessionActions } from '../../state/actions';
import { FINAL_STATUSES, type SessionState } from '../../state/types';
import { IncomingRequest } from './IncomingRequest';
import { TransferItem } from './TransferItem';

export function TransferList({ state, actions }: { state: SessionState; actions: SessionActions }) {
  if (state.transfers.length === 0) return null;
  const p = state.phase;
  const peerLabel = p.name === 'paired' || p.name === 'disconnected' ? p.peerLabel : 'The other device';
  const hasFinished = state.transfers.some((t) => FINAL_STATUSES.has(t.status));

  return (
    <section className="card" aria-labelledby="transfers-title">
      <div className="card__header">
        <h2 id="transfers-title" className="card__title">
          Transfers
        </h2>
        {hasFinished && (
          <button type="button" className="btn btn--quiet btn--small" onClick={() => actions.clearFinished()}>
            Clear finished
          </button>
        )}
      </div>
      <div>
        {state.transfers.map((t) =>
          t.status === 'incoming' ? (
            <IncomingRequest
              key={t.id}
              transfer={t}
              peerLabel={peerLabel}
              canSaveToDisk={state.support.canSaveToDisk}
              onAccept={(toDisk) => void actions.acceptIncoming(toDisk)}
              onDecline={() => actions.declineIncoming()}
            />
          ) : (
            <TransferItem key={t.id} transfer={t} peerLabel={peerLabel} onCancel={() => actions.cancelTransfer()} />
          ),
        )}
      </div>
    </section>
  );
}
