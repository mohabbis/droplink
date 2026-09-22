import { formatBytes } from '../lib/format';
import type { SessionActions } from '../state/actions';
import { activeTransfer, type SessionState } from '../state/types';
import { DropZone } from './DropZone';
import { FileRow } from './FileRow';
import { ArrowRightIcon, CloseIcon, DeviceIcon } from './icons';

/** Left column: choose files, review them, and send once paired. */
export function FilePanel({ state, actions }: { state: SessionState; actions: SessionActions }) {
  const { selected, phase } = state;
  const total = selected.reduce((n, s) => n + s.file.size, 0);
  const paired = phase.name === 'paired';
  const busy = activeTransfer(state);

  let sendHint: string | null = null;
  if (!paired) sendHint = 'Connect a device to send these files.';
  else if (busy) sendHint = 'Wait for the current transfer to finish.';

  return (
    <section className="card" aria-labelledby="files-title">
      <div className="card__header">
        <div>
          <h2 id="files-title" className="card__title">
            Files to send
          </h2>
          <p className="card__lead">
            {selected.length === 0
              ? 'Choose files now, then connect a device — or the other way round.'
              : `${selected.length} ${selected.length === 1 ? 'file' : 'files'} · ${formatBytes(total)}`}
          </p>
        </div>
        {selected.length > 0 && !busy && (
          <button type="button" className="btn btn--quiet btn--small" onClick={() => actions.clearFiles()}>
            Clear
          </button>
        )}
      </div>

      <div className="stack">
        {selected.length > 0 && (
          <ul className="file-list" aria-label="Selected files">
            {selected.map((s) => (
              <FileRow key={s.id} name={s.file.name} size={s.file.size}>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${s.file.name}`}
                  onClick={() => actions.removeFile(s.id)}
                  disabled={!!busy && busy.direction === 'out'}
                >
                  <CloseIcon size={16} />
                </button>
              </FileRow>
            ))}
          </ul>
        )}

        <DropZone compact={selected.length > 0} onFiles={(files) => actions.addFiles(files)} />

        {selected.length > 0 && (
          <div className="send-bar">
            {paired && (
              <div className="send-bar__route">
                <span className="muted">
                  {selected.length} {selected.length === 1 ? 'file' : 'files'}
                </span>
                <ArrowRightIcon size={16} className="muted" />
                <DeviceIcon size={16} className="muted" />
                <strong>{phase.peerLabel}</strong>
              </div>
            )}
            <button
              type="button"
              className="btn btn--primary btn--block"
              disabled={!paired || !!busy}
              onClick={() => actions.sendSelected()}
            >
              {paired ? `Send ${formatBytes(total)}` : 'Send'}
            </button>
            {sendHint && <p className="small muted">{sendHint}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
