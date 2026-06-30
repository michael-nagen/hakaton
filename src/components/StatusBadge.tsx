import { STATUS_CONFIG } from '../data/appsConfig';
import type { AppStatus } from '../data/appsConfig';

interface StatusBadgeProps {
  status: AppStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        lineHeight: '15px',
        padding: '1px 7px',
        borderRadius: 2,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        display: 'inline-flex',
        alignItems: 'center',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.border}`,
      }}
    >
      {cfg.label}
    </span>
  );
}
