import { Link, useNavigate } from 'react-router-dom';
import { AppCard } from '../components/AppCard';
import { AppIcon } from '../components/AppIcon';
import { useAppShell } from '../contexts/AppShellContext';
import { SECTIONS } from '../data/appsConfig';
import type { Layout } from '../data/appsConfig';

const LAYOUTS: { key: Layout; label: string }[] = [
  { key: 'track',   label: 'Track' },
  { key: 'grid',    label: 'Grid' },
  { key: 'compact', label: 'Compact' },
];

export function DashboardPage() {
  const navigate = useNavigate();
  const { layout, setLayout, showToast } = useAppShell();

  const handleOpenApp = (appId: string, title: string, disabled?: boolean) => {
    if (disabled) return;
    // The Courses tile opens the real learning surface (catalog → lessons → player).
    if (appId === 'course-factory') {
      navigate('/courses');
      return;
    }
    navigate(`/app/${appId}`);
    console.log('[TODO] open app:', appId, title);
  };

  const handleMenu = (appId: string, title: string) => {
    console.log('[TODO] context menu for:', appId);
    showToast(`"${title}" options — TODO: context menu`);
  };

  const segBase: React.CSSProperties = {
    fontFamily: 'var(--font-ui)',
    fontSize: 13,
    padding: '6px 16px',
    borderRadius: 'var(--radius-pill)',
    border: 'none',
    background: 'transparent',
    color: 'var(--fg-3)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
  const segActive: React.CSSProperties = {
    background: 'var(--maestro-paper-3)',
    color: 'var(--maestro-ink)',
  };

  const gridCols = layout === 'grid'
    ? 'repeat(auto-fill, minmax(238px, 1fr))'
    : 'repeat(auto-fill, minmax(278px, 1fr))';

  return (
    <div style={{ width: '100%', maxWidth: 980, margin: '0 auto', padding: 'clamp(20px, 4vw, 40px) clamp(16px, 4vw, 48px) 96px' }}>
      {/* Page header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '20px 24px', marginBottom: 24 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-3)', margin: '0 0 12px' }}>
            Your workspace
          </p>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 34, lineHeight: 1.1, letterSpacing: '-0.01em', margin: 0, color: 'var(--fg-2)' }}>
            Apps &amp; <em>tools</em>
          </h1>
          <p style={{ fontFamily: 'var(--font-text)', fontSize: 14, lineHeight: 1.55, color: 'var(--fg-3)', margin: '14px 0 0', maxWidth: 520 }}>
            Everything you need to learn and build, in one place. Pick a tool to jump in.
          </p>
          <Link
            to="/ai-setup"
            style={{
              display: 'inline-block',
              marginTop: 14,
              fontFamily: 'var(--font-ui)',
              fontSize: 13,
              padding: '8px 16px',
              borderRadius: 'var(--radius-pill)',
              border: '1px solid var(--maestro-ink-3)',
              color: 'var(--fg-2)',
              textDecoration: 'none',
            }}
          >
            ⚙ Set up your AI tutor
          </Link>
        </div>

        {/* Layout switcher */}
        <div
          role="tablist"
          aria-label="Layout"
          style={{
            display: 'inline-flex',
            background: 'var(--maestro-ink-2)',
            border: '1px solid var(--maestro-ink-3)',
            borderRadius: 'var(--radius-pill)',
            padding: 3,
            gap: 2,
          }}
        >
          {LAYOUTS.map(({ key, label }) => (
            <button
              key={key}
              className="seg-btn"
              type="button"
              role="tab"
              aria-selected={layout === key}
              onClick={() => setLayout(key)}
              style={layout === key ? { ...segBase, ...segActive } : segBase}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Sections */}
      {SECTIONS.map(section => (
        <div key={section.id}>
          {/* Section divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '36px 0 18px' }}>
            <div style={{ flex: 1, borderTop: '1px dashed var(--maestro-ink-3)' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>
              <span style={{ color: 'var(--fg-2)' }}>{section.label}</span>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>{section.apps.length} tools</span>
            </div>
            <div style={{ flex: 1, borderTop: '1px dashed var(--maestro-ink-3)' }} />
          </div>

          {/* Cards */}
          {layout === 'track' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {section.apps.map(app => (
                <AppCard
                  key={app.id}
                  app={app}
                  layout="track"
                  onOpen={() => handleOpenApp(app.id, app.title, app.disabled)}
                  onMenu={(e) => { e.stopPropagation(); handleMenu(app.id, app.title); }}
                />
              ))}
            </div>
          )}

          {layout === 'grid' && (
            <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 12 }}>
              {section.apps.map(app => (
                <AppCard
                  key={app.id}
                  app={app}
                  layout="grid"
                  onOpen={() => handleOpenApp(app.id, app.title, app.disabled)}
                  onMenu={(e) => { e.stopPropagation(); handleMenu(app.id, app.title); }}
                />
              ))}
            </div>
          )}

          {layout === 'compact' && (
            <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 8 }}>
              {section.apps.map(app => (
                <AppCard
                  key={app.id}
                  app={app}
                  layout="compact"
                  onOpen={() => handleOpenApp(app.id, app.title, app.disabled)}
                  onMenu={(e) => { e.stopPropagation(); handleMenu(app.id, app.title); }}
                />
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Empty state — shown if SECTIONS is empty */}
      {SECTIONS.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '72px 24px', border: '1px dashed var(--maestro-ink-3)', borderRadius: 'var(--radius-l)', background: 'var(--bg-surface)', marginTop: 40 }}>
          <span style={{ display: 'inline-flex', color: 'var(--fg-3)', marginBottom: 14 }}>
            <AppIcon name="inbox" size={28} />
          </span>
          <p style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--fg-2)', margin: '0 0 6px' }}>No apps yet</p>
          <p style={{ fontFamily: 'var(--font-text)', fontSize: 13, lineHeight: 1.5, color: 'var(--fg-3)', margin: 0, maxWidth: 320 }}>
            Add apps to SECTIONS in <code>src/data/appsConfig.ts</code> to populate the dashboard.
          </p>
        </div>
      )}
    </div>
  );
}
