import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { AppIcon } from './AppIcon';
import { findApp } from '../data/appsConfig';

interface TopbarProps {
  onSearch: () => void;
}

interface Crumb {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  isCurrent: boolean;
}

export function Topbar({ onSearch }: TopbarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { appId } = useParams<{ appId: string }>();

  const isHome = location.pathname === '/';

  let crumbs: Crumb[];
  if (isHome) {
    crumbs = [
      { label: 'Programs', onClick: (e) => { e.preventDefault(); console.log('[TODO] navigate to Programs'); }, isCurrent: false },
      { label: 'Apps', onClick: (e) => e.preventDefault(), isCurrent: true },
    ];
  } else {
    const meta = appId ? findApp(appId) : null;
    const title = meta?.app.title ?? appId ?? 'App';
    crumbs = [
      { label: 'Programs', onClick: (e) => { e.preventDefault(); console.log('[TODO] navigate to Programs'); }, isCurrent: false },
      { label: 'Apps', onClick: (e) => { e.preventDefault(); navigate('/'); }, isCurrent: false },
      { label: title, onClick: (e) => e.preventDefault(), isCurrent: true },
    ];
  }

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
        padding: '0 clamp(16px, 4vw, 40px)',
        background: 'rgba(10,10,10,0.72)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderBottom: '1px solid var(--maestro-ink-3)',
        zIndex: 20,
      }}
    >
      <nav style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 13, minWidth: 0, overflow: 'hidden' }}>
        {crumbs.map((crumb, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {i > 0 && (
              <span style={{ display: 'inline-flex', width: 14, height: 14, color: 'var(--maestro-ink-3)', flexShrink: 0 }}>
                <AppIcon name="chevronR" size={14} />
              </span>
            )}
            <a
              href="#"
              onClick={crumb.onClick}
              style={{
                color: crumb.isCurrent ? 'var(--fg-1)' : 'var(--fg-3)',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {crumb.label}
            </a>
          </span>
        ))}
      </nav>

      <button
        className="kebab-btn"
        type="button"
        onClick={onSearch}
        aria-label="Search"
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 34, height: 34, borderRadius: 8,
          background: 'transparent', border: 'none',
          color: 'var(--fg-3)', cursor: 'pointer', flexShrink: 0,
        }}
      >
        <AppIcon name="search" size={18} />
      </button>
    </header>
  );
}
