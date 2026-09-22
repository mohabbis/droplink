import { formatBytes, formatEta, formatRate } from '../lib/format';

interface ProgressBarProps {
  bytes: number;
  total: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
  label: string;
  done?: boolean;
}

export function ProgressBar({ bytes, total, bytesPerSecond, etaSeconds, label, done }: ProgressBarProps) {
  const percent = total === 0 ? 100 : Math.floor((bytes / total) * 100);
  return (
    <div className={`progress${done ? ' progress--done' : ''}`}>
      <progress className="progress__track" max={100} value={percent} aria-label={label} aria-valuetext={`${percent}%`} />
      <div className="progress__meta">
        <span>
          {percent}% · {formatBytes(bytes)} of {formatBytes(total)}
        </span>
        {!done && (
          <span>
            {formatRate(bytesPerSecond)} · {formatEta(etaSeconds)}
          </span>
        )}
      </div>
    </div>
  );
}
