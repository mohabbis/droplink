import { useState, type FormEvent } from 'react';
import { normalizeCode } from '../../../shared/codes';
import { LinkIcon } from '../icons';

interface Props {
  onCreate(): void;
  onJoin(code: string): void;
  busy?: 'creating' | null;
}

export function StartPairing({ onCreate, onJoin, busy }: Props) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const normalized = normalizeCode(code);
    if (!normalized) {
      setError('Enter the 6-character code shown on the other device, like K7Q-M4P.');
      return;
    }
    setError(null);
    onJoin(normalized);
  };

  return (
    <section className="card" aria-labelledby="pair-title">
      <h2 id="pair-title" className="card__title">
        Connect a device
      </h2>
      <p className="card__lead">Both devices need this page open. Pairing takes a few seconds.</p>

      <div style={{ marginTop: 18 }}>
        <button type="button" className="btn btn--primary btn--block" onClick={onCreate} disabled={busy === 'creating'}>
          {busy === 'creating' ? <span className="spinner" aria-hidden="true" /> : <LinkIcon />}
          {busy === 'creating' ? 'Creating code…' : 'Create a pairing code'}
        </button>
        <p className="small muted" style={{ marginTop: 8 }}>
          You’ll get a code and a link to open on the other device.
        </p>
      </div>

      <div className="divider">or</div>

      <form onSubmit={submit} noValidate>
        <label className="field-label" htmlFor="join-code">
          Enter a code from another device
        </label>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input
            id="join-code"
            className="code-input"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              if (error) setError(null);
            }}
            placeholder="K7Q-M4P"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            maxLength={9}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'join-code-error' : undefined}
          />
          <button type="submit" className="btn">
            Join
          </button>
        </div>
        {error && (
          <p id="join-code-error" className="field-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
