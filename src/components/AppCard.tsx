import { AppIcon } from './AppIcon';
import { StatusBadge } from './StatusBadge';
import { ACCENTS } from '../data/appsConfig';
import type { AppItem, Layout } from '../data/appsConfig';

interface AppCardProps {
  app: AppItem;
  layout: Layout;
  showDescriptions?: boolean;
  showStatusBadges?: boolean;
  onOpen: () => void;
  onMenu: (e: React.MouseEvent) => void;
}

export function AppCard({ app, layout, showDescriptions = true, showStatusBadges = true, onOpen, onMenu }: AppCardProps) {
  const acc = ACCENTS[app.accent];
  const showBadge = showStatusBadges && !!app.status;
  const showDesc = showDescriptions && !!app.description;

  if (layout === 'track') {
    return (
      <button
        className="app-card"
        type="button"
        disabled={app.disabled}
        onClick={app.disabled ? undefined : onOpen}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          width: '100%',
          textAlign: 'left',
          background: 'var(--bg-surface)',
          border: '1px solid var(--maestro-ink-3)',
          borderRadius: 'var(--radius-l)',
          padding: '15px 16px',
          color: 'inherit',
          fontFamily: 'inherit',
        }}
      >
        {/* Icon tile */}
        <span style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, width: 44, height: 44, borderRadius: 10,
          background: acc.tile, color: acc.fg,
        }}>
          <AppIcon name={app.icon} size={22} />
        </span>

        {/* Text */}
        <span style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-3)' }}>{app.code}</span>
            <span style={{ color: 'var(--fg-3)', opacity: 0.5 }}>·</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--fg-2)' }}>{app.title}</span>
            {showBadge && <StatusBadge status={app.status!} />}
          </span>
          {showDesc && (
            <span style={{ fontFamily: 'var(--font-text)', fontSize: 13, lineHeight: 1.5, color: 'var(--fg-3)' }}>
              {app.description}
            </span>
          )}
        </span>

        {/* Kebab menu */}
        <span
          role="button"
          tabIndex={0}
          className="kebab-btn"
          onClick={(e) => { e.stopPropagation(); onMenu(e); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onMenu(e as unknown as React.MouseEvent); } }}
          aria-label="More options"
          style={{
            flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 30, height: 30, borderRadius: 8, color: 'var(--fg-3)', cursor: 'pointer',
          }}
        >
          <AppIcon name="dots" size={18} />
        </span>
      </button>
    );
  }

  if (layout === 'grid') {
    return (
      <button
        className="app-card"
        type="button"
        disabled={app.disabled}
        onClick={app.disabled ? undefined : onOpen}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          textAlign: 'left',
          background: 'var(--bg-surface)',
          border: '1px solid var(--maestro-ink-3)',
          borderRadius: 'var(--radius-l)',
          padding: 18,
          color: 'inherit',
          fontFamily: 'inherit',
          minHeight: 158,
        }}
      >
        {/* Top row: icon + badge */}
        <span style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <span style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, width: 44, height: 44, borderRadius: 10,
            background: acc.tile, color: acc.fg,
          }}>
            <AppIcon name={app.icon} size={22} />
          </span>
          {showBadge && <StatusBadge status={app.status!} />}
        </span>

        {/* Text */}
        <span style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', letterSpacing: '0.04em' }}>{app.code}</span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 17, lineHeight: 1.2, color: 'var(--fg-2)' }}>{app.title}</span>
          {showDesc && (
            <span style={{ fontFamily: 'var(--font-text)', fontSize: 13, lineHeight: 1.5, color: 'var(--fg-3)' }}>
              {app.description}
            </span>
          )}
        </span>

        {/* Open label */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.03em', color: 'var(--fg-3)' }}>
          {app.disabled ? 'Unavailable' : 'Open'}
          <AppIcon name="arrow" size={14} />
        </span>
      </button>
    );
  }

  // Compact layout
  return (
    <button
      className="app-card"
      type="button"
      disabled={app.disabled}
      onClick={app.disabled ? undefined : onOpen}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        textAlign: 'left',
        background: 'var(--bg-surface)',
        border: '1px solid var(--maestro-ink-3)',
        borderRadius: 'var(--radius-m)',
        padding: '10px 12px',
        color: 'inherit',
        fontFamily: 'inherit',
      }}
    >
      <span style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, width: 34, height: 34, borderRadius: 8,
        background: acc.tile, color: acc.fg,
      }}>
        <AppIcon name={app.icon} size={18} />
      </span>

      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, color: 'var(--fg-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {app.title}
        </span>
        {showBadge && <StatusBadge status={app.status!} />}
      </span>

      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', flexShrink: 0 }}>{app.code}</span>
    </button>
  );
}
