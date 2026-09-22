import type { SessionActions } from '../../state/actions';
import { activeTransfer, type SessionState } from '../../state/types';
import { Connecting } from './Connecting';
import { PairedDevice } from './PairedDevice';
import { StartPairing } from './StartPairing';
import { DisconnectedCard, ErrorCard, UnsupportedCard } from './StatusCards';
import { VerifyPairing } from './VerifyPairing';
import { WaitingForPeer } from './WaitingForPeer';

/** The right-hand panel: whatever the pairing lifecycle needs right now. */
export function PairingPanel({ state, actions }: { state: SessionState; actions: SessionActions }) {
  if (!state.support.ok) return <UnsupportedCard missing={state.support.missing} />;
  const p = state.phase;
  switch (p.name) {
    case 'idle':
    case 'creating':
      return (
        <StartPairing
          busy={p.name === 'creating' ? 'creating' : null}
          onCreate={() => void actions.createRoom()}
          onJoin={(code) => void actions.joinRoom(code)}
        />
      );
    case 'waiting':
      return <WaitingForPeer code={p.code} expiresAt={p.expiresAt} onCancel={() => actions.leave()} />;
    case 'joining':
      return <Connecting stage="joining" onCancel={() => actions.leave()} />;
    case 'connecting':
      return <Connecting stage="connecting" onCancel={() => actions.leave()} />;
    case 'verify':
      return (
        <VerifyPairing
          peerLabel={p.peerLabel}
          sas={p.sas}
          localConfirmed={p.localConfirmed}
          remoteConfirmed={p.remoteConfirmed}
          onConfirm={() => actions.confirmPairing()}
          onReject={() => actions.rejectPairing()}
        />
      );
    case 'paired':
      return (
        <PairedDevice
          peerLabel={p.peerLabel}
          sas={p.sas}
          connection={state.connection}
          busy={activeTransfer(state) !== undefined}
          onDisconnect={() => actions.leave()}
        />
      );
    case 'disconnected':
      return <DisconnectedCard peerLabel={p.peerLabel} onDone={() => actions.reset()} />;
    case 'error':
      return <ErrorCard error={p.error} onRetry={() => actions.reset()} />;
  }
}
