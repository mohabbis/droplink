import type { ReactNode } from 'react';
import { AlertIcon, CheckIcon, InfoIcon } from './icons';

interface NoticeProps {
  tone: 'info' | 'warning' | 'danger' | 'success';
  title?: string;
  children?: ReactNode;
  /** Announce to screen readers. Use for status changes, not static hints. */
  live?: boolean;
}

export function Notice({ tone, title, children, live }: NoticeProps) {
  const Icon = tone === 'success' ? CheckIcon : tone === 'info' ? InfoIcon : AlertIcon;
  return (
    <div className={`notice notice--${tone}`} role={live ? (tone === 'danger' ? 'alert' : 'status') : undefined}>
      <Icon className="notice__icon" />
      <div>
        {title && <p className="notice__title">{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}
