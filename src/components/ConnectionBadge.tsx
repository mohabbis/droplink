import type { ConnectionKind } from '../lib/peer';

const COPY: Record<ConnectionKind, { label: string; title: string }> = {
  direct: {
    label: 'Direct connection',
    title: 'Files travel straight between the two devices, encrypted.',
  },
  relay: {
    label: 'Relayed connection',
    title:
      'A direct path wasn’t possible, so encrypted data passes through a TURN relay server. The relay cannot read your files.',
  },
  unknown: {
    label: 'Encrypted connection',
    title: 'Connected and encrypted. The connection type could not be determined.',
  },
};

export function ConnectionBadge({ kind }: { kind: ConnectionKind }) {
  const { label, title } = COPY[kind];
  return (
    <span className={`badge badge--${kind}`} title={title}>
      <span className="badge__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function connectionDescription(kind: ConnectionKind): string {
  return COPY[kind].title;
}
