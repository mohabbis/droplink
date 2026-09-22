import type { SessionActions } from '../state/actions';
import type { SessionState } from '../state/types';
import { FilePanel } from './FilePanel';
import { DropMark, LockIcon } from './icons';
import { PairingPanel } from './pairing/PairingPanel';
import { TransferList } from './transfers/TransferList';

/** The whole page, driven entirely by session state. */
export function Screen({ state, actions }: { state: SessionState; actions: SessionActions }) {
  return (
    <div className="app">
      <header className="header">
        <div className="header__inner">
          <div className="brand">
            <span className="brand__mark">
              <DropMark size={16} />
            </span>
            DropLink
          </div>
          <p className="header__note">
            <LockIcon size={15} />
            <span>End-to-end encrypted · No uploads</span>
          </p>
        </div>
      </header>

      <main className="main" id="main">
        <div className="intro">
          <h1>Send files directly</h1>
          <p>
            Move files from one device to another over an encrypted peer-to-peer connection. They never pass through or
            get stored on our servers.
          </p>
        </div>

        <div className="grid">
          <div className="column">
            <FilePanel state={state} actions={actions} />
          </div>
          <div className="column">
            <PairingPanel state={state} actions={actions} />
            <TransferList state={state} actions={actions} />
          </div>
        </div>
      </main>

      <footer className="footer">
        <div className="footer__inner">
          <span>
            You are <strong style={{ fontWeight: 560 }}>{state.deviceLabel}</strong>
          </span>
          <span>No accounts. No tracking. Rooms close as soon as devices connect.</span>
        </div>
      </footer>
    </div>
  );
}
