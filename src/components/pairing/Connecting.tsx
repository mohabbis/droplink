import { CheckIcon } from '../icons';

type Stage = 'joining' | 'connecting' | 'securing';

const STEPS: Array<{ id: Stage; label: string }> = [
  { id: 'joining', label: 'Finding the other device' },
  { id: 'connecting', label: 'Opening a direct connection' },
  { id: 'securing', label: 'Securing the connection' },
];

export function Connecting({ stage, onCancel }: { stage: Stage; onCancel(): void }) {
  const current = STEPS.findIndex((s) => s.id === stage);
  return (
    <section className="card" aria-labelledby="connecting-title">
      <h2 id="connecting-title" className="card__title">
        Connecting…
      </h2>
      <p className="card__lead">Keep this page open on both devices.</p>
      <ol className="steps" style={{ marginTop: 16 }} aria-label="Connection progress">
        {STEPS.map((s, i) => {
          const state = i < current ? 'done' : i === current ? 'current' : 'todo';
          return (
            <li key={s.id} className={`step step--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              <span className={`step__marker${state === 'todo' ? ' step__marker--todo' : ''}`}>
                {state === 'done' && <CheckIcon size={16} />}
                {state === 'current' && <span className="spinner" aria-hidden="true" />}
              </span>
              {s.label}
              {state === 'done' && <span className="visually-hidden"> (done)</span>}
            </li>
          );
        })}
      </ol>
      <p className="visually-hidden" role="status">
        {STEPS[current]?.label}
      </p>
      <button type="button" className="btn btn--quiet" onClick={onCancel} style={{ marginTop: 14 }}>
        Cancel
      </button>
    </section>
  );
}
