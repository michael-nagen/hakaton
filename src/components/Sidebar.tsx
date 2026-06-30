import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { AppIcon } from './AppIcon';
import { useAppShell } from '../contexts/AppShellContext';
import { NAV_A, NAV_B } from '../data/appsConfig';
import type { NavItem } from '../data/appsConfig';

interface SidebarProps {
  onLockedClick: (name: string) => void;
  onWorkspaceClick: () => void;
  onProfileClick: () => void;
}

export function Sidebar({ onLockedClick, onWorkspaceClick, onProfileClick }: SidebarProps) {
  const { collapsed, toggleCollapsed } = useAppShell();
  const navigate = useNavigate();
  const location = useLocation();
  const { appId } = useParams<{ appId: string }>();

  const activeId = appId === 'services' ? 'services' : (location.pathname === '/' ? 'home' : '');

  const handleNavClick = (item: NavItem) => {
    if (item.locked) { onLockedClick(item.name); return; }
    if (item.id === 'home') { navigate('/'); return; }
    if (item.id === 'services') { navigate('/app/services'); return; }
    // TODO: wire remaining nav items to their real routes
    console.log('[TODO] navigate to:', item.id);
  };

  const navBtnStyle = (item: NavItem, isActive: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    padding: collapsed ? '10px' : '9px 12px',
    borderRadius: 10,
    background: isActive ? 'var(--maestro-ink-2)' : 'transparent',
    border: 'none',
    color: item.locked ? 'var(--maestro-muted)' : (isActive ? 'var(--maestro-paper)' : 'var(--maestro-paper-3)'),
    cursor: item.locked ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
    justifyContent: collapsed ? 'center' : 'flex-start',
    textAlign: 'left',
  });

  return (
    <aside
      style={{
        position: 'sticky',
        top: 0,
        alignSelf: 'flex-start',
        height: '100vh',
        flexShrink: 0,
        width: collapsed ? 64 : 260,
        background: 'var(--maestro-ink)',
        borderRight: '1px solid var(--maestro-ink-3)',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 10px',
        transition: 'width var(--dur-base) var(--ease-out)',
        overflow: 'hidden',
        zIndex: 30,
      }}
    >
      {/* Brand row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          gap: 8,
          padding: collapsed ? '2px 0' : '2px 4px 2px 6px',
          marginBottom: 14,
          minHeight: 30,
        }}
      >
        <a
          href="/"
          onClick={(e) => { e.preventDefault(); if (collapsed) toggleCollapsed(); else navigate('/'); }}
          title={collapsed ? 'Expand sidebar' : 'Home'}
          style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', minWidth: 0 }}
        >
          <img src="/logo-mark-light.svg" alt="Maestro" style={{ width: 26, height: 'auto', flexShrink: 0, display: 'block' }} />
          {!collapsed && (
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, color: 'var(--maestro-paper-3)', whiteSpace: 'nowrap' }}>
              maestro
            </span>
          )}
        </a>
        {!collapsed && (
          <button
            className="nav-btn"
            type="button"
            onClick={toggleCollapsed}
            aria-label="Collapse sidebar"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 30, height: 30, borderRadius: 8,
              background: 'transparent', border: 'none',
              color: 'var(--maestro-muted)', cursor: 'pointer', flexShrink: 0, padding: 0,
            }}
          >
            <AppIcon name="panel" size={18} />
          </button>
        )}
      </div>

      {/* Workspace pill */}
      <button
        className="nav-btn"
        type="button"
        onClick={onWorkspaceClick}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, width: '100%',
          padding: collapsed ? '10px' : '10px 12px',
          borderRadius: 10,
          background: 'var(--maestro-ink-3)',
          border: '1px solid var(--maestro-ink-3)',
          color: 'var(--maestro-paper-3)',
          cursor: 'pointer', fontFamily: 'inherit',
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}
      >
        <AppIcon name="wrench" size={20} />
        {!collapsed && (
          <span style={{ fontFamily: 'var(--font-ui)', fontSize: 14 }}>LMS</span>
        )}
      </button>

      <div style={{ height: 1, background: 'var(--maestro-ink-3)', margin: '14px 6px' }} />

      {/* Nav groups */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0, overflow: 'hidden auto' }}>
        {NAV_A.map(item => (
          <button
            key={item.id}
            className="nav-btn"
            type="button"
            data-locked={item.locked ? 'true' : 'false'}
            onClick={() => handleNavClick(item)}
            title={item.name}
            style={navBtnStyle(item, item.id === activeId)}
          >
            <AppIcon name={item.icon} size={20} />
            {!collapsed && (
              <span style={{ flex: 1, fontFamily: 'var(--font-ui)', fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {item.name}
              </span>
            )}
            {!collapsed && item.locked && (
              <span style={{ display: 'inline-flex', width: 13, height: 13, flexShrink: 0, color: 'var(--maestro-muted)' }}>
                <AppIcon name="lock" size={13} />
              </span>
            )}
          </button>
        ))}

        <div style={{ height: 1, background: 'var(--maestro-ink-3)', margin: '14px 6px' }} />

        {NAV_B.map(item => (
          <button
            key={item.id}
            className="nav-btn"
            type="button"
            data-locked="true"
            onClick={() => handleNavClick(item)}
            title={item.name}
            style={navBtnStyle(item, false)}
          >
            <AppIcon name={item.icon} size={20} />
            {!collapsed && (
              <span style={{ flex: 1, fontFamily: 'var(--font-ui)', fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {item.name}
              </span>
            )}
            {!collapsed && (
              <span style={{ display: 'inline-flex', width: 13, height: 13, flexShrink: 0, color: 'var(--maestro-muted)' }}>
                <AppIcon name="lock" size={13} />
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Profile footer */}
      <button
        className="nav-btn"
        type="button"
        onClick={onProfileClick}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          padding: '8px', marginTop: 8, borderRadius: 10,
          background: 'transparent', border: 'none',
          cursor: 'pointer', fontFamily: 'inherit',
          justifyContent: collapsed ? 'center' : 'flex-start',
          textAlign: 'left',
        }}
      >
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, width: 30, height: 30, borderRadius: '50%',
          background: 'var(--maestro-ink-3)', color: 'var(--maestro-paper-3)',
          fontFamily: 'var(--font-mono)', fontSize: 12,
        }}>
          M
        </span>
        {!collapsed && (
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 1 }}>
            <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600, color: 'var(--maestro-paper-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Michael Nagen
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--maestro-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              michael.n@fellowship.mastersc…
            </span>
          </span>
        )}
      </button>
    </aside>
  );
}
