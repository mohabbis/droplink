import type { ReactNode } from 'react';
import { formatBytes } from '../lib/format';
import { FileIcon } from './icons';

interface FileRowProps {
  name: string;
  size: number;
  meta?: ReactNode;
  error?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

export function FileRow({ name, size, meta, error, icon, children }: FileRowProps) {
  return (
    <li className="file-row">
      <span className="file-row__icon">{icon ?? <FileIcon size={16} />}</span>
      <div className="file-row__body">
        <p className="file-row__name" title={name}>
          {name}
        </p>
        <p className={`file-row__meta${error ? ' file-row__meta--error' : ''}`}>{meta ?? formatBytes(size)}</p>
      </div>
      {children}
    </li>
  );
}
