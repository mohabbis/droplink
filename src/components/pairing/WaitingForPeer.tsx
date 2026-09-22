import { useEffect, useState } from 'react';
import { formatCode } from '../../../shared/codes';
import { formatCountdown } from '../../lib/format';
import { CheckIcon, CopyIcon, ShareIcon } from '../icons';

interface Props {
  code: string;
  expiresAt: number;
  onCancel(): void;
}

export function shareLink(code: string, loc: Pick<Location, 'origin' | 'pathname'> = location): string {
  // The code lives in the fragment, which browsers never send to the server.
  return `${loc.origin}${loc.pathname}#join=${code}`;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function WaitingForPeer({ code, expiresAt, onCancel }: Props) {
  const link = shareLink(code);
  const now = useNow(1000);
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator.share === 'function';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard blocked; the link is still visible to copy by hand. */
    }
  };

  return (
    <section className="card" aria-labelledby="waiting-title">
      <div className="card__header">
        <div>
          <h2 id="waiting-title" className="card__title">
            Open this on the other device
          </h2>
          <p className="card__lead">Enter the code at the same site, or open the link.</p>
        </div>
      </div>

      <div className="stack">
        <div className="code-display" aria-label={`Pairing code ${[...code].join(' ')}`}>
          {formatCode(code)}
        </div>

        <div className="link-box">
          <span className="link-box__url" title={link}>
            {link}
          </span>
          <button type="button" className="btn btn--small" onClick={copy} aria-live="polite">
            {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
            {copied ? 'Copied' : 'Copy link'}
          </button>
          {canShare && (
            <button
              type="button"
              className="icon-btn"
              aria-label="Share link"
              onClick={() => navigator.share({ title: 'DropLink', text: 'Open this to connect:', url: link }).catch(() => {})}
            >
              <ShareIcon size={16} />
            </button>
          )}
        </div>

        <div className="status-line" role="status">
          <span className="pulse-dot" aria-hidden="true" />
          <span>
            Waiting for the other device… <span className="small">Code expires in {formatCountdown(expiresAt - now)}</span>
          </span>
        </div>

        <button type="button" className="btn btn--quiet" onClick={onCancel} style={{ alignSelf: 'flex-start' }}>
          Cancel
        </button>
      </div>
    </section>
  );
}
