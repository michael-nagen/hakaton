import { useParams, useNavigate } from 'react-router-dom';
import { AppIcon } from '../components/AppIcon';
import { StatusBadge } from '../components/StatusBadge';
import { useAppShell } from '../contexts/AppShellContext';
import { findApp, ACCENTS, SCREEN_CONTENT } from '../data/appsConfig';
import { useState } from 'react';

type Tab = 'overview' | 'activity' | 'resources';

const BTN_BASE: React.CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 14,
  padding: '10px 18px',
  borderRadius: 'var(--radius-pill)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  whiteSpace: 'nowrap',
  border: '1px solid transparent',
};

export function AppDetailPage() {
  const { appId } = useParams<{ appId: string }>();
  const navigate = useNavigate();
  const { showToast } = useAppShell();
  const [tab, setTab] = useState<Tab>('overview');

  const meta = appId ? findApp(appId) : null;

  if (!meta) {
    return (
      <div style={{ width: '100%', maxWidth: 980, margin: '0 auto', padding: 'clamp(20px,4vw,40px) clamp(16px,4vw,48px) 96px' }}>
        <button
          type="button"
          onClick={() => navigate('/')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 20 }}
        >
          <AppIcon name="chevronL" size={15} />Back to apps
        </button>
        <p style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>App not found.</p>
      </div>
    );
  }

  const { app, sectionLabel } = meta;
  const acc = ACCENTS[app.accent];
  const content = SCREEN_CONTENT[app.id] ?? {
    introHeading: `Get started with ${app.title}`,
    intro: `Open ${app.title} to begin.`,
    primary: `Open ${app.title}`,
    links: [],
  };

  const handlePrimary = () => {
    console.log('[TODO] primary action:', app.id, content.primary);
    showToast(`${app.title} · ${content.primary} — TODO: not wired up yet`);
  };
  const handleSecondary = () => {
    console.log('[TODO] settings for:', app.id);
    showToast(`${app.title} settings — TODO: not wired up yet`);
  };
  const handleLink = (title: string) => {
    console.log('[TODO] navigate to:', title);
    showToast(`${title} — TODO: not wired up yet`);
  };

  const tabBase: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    padding: '10px 2px',
    marginRight: 22,
    marginBottom: -1,
    cursor: 'pointer',
    color: 'var(--fg-3)',
    fontFamily: 'var(--font-ui)',
    fontSize: 14,
  };
  const tabActive: React.CSSProperties = {
    color: 'var(--fg-1)',
    borderBottom: '2px solid var(--maestro-paper-3)',
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'activity', label: 'Activity' },
    { key: 'resources', label: 'Resources' },
  ];

  return (
    <div style={{ width: '100%', maxWidth: 980, margin: '0 auto', padding: 'clamp(20px,4vw,40px) clamp(16px,4vw,48px) 96px' }}>
      {/* Back button */}
      <button
        type="button"
        onClick={() => navigate('/')}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 20 }}
      >
        <AppIcon name="chevronL" size={15} />Back to apps
      </button>

      {/* App header */}
      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', minWidth: 0 }}>
          {/* Icon tile */}
          <span style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, width: 56, height: 56, borderRadius: 12,
            background: acc.tile, color: acc.fg,
          }}>
            <AppIcon name={app.icon} size={28} />
          </span>

          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-3)' }}>{app.code}</span>
              {app.status && <StatusBadge status={app.status} />}
            </div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, lineHeight: 1.1, letterSpacing: '-0.01em', margin: '0 0 8px', color: 'var(--fg-2)' }}>
              {app.title}
            </h1>
            {app.description && (
              <p style={{ fontFamily: 'var(--font-text)', fontSize: 15, lineHeight: 1.55, color: 'var(--fg-3)', margin: 0, maxWidth: 540 }}>
                {app.description}
              </p>
            )}
          </div>
        </div>

        {/* CTA buttons */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            className="action-btn secondary"
            type="button"
            onClick={handleSecondary}
            style={{ ...BTN_BASE, background: 'transparent', color: 'var(--fg-1)', border: '1px solid var(--maestro-ink-3)' }}
          >
            {content.secondary ?? 'Settings'}
          </button>
          <button
            className="action-btn accent"
            type="button"
            onClick={handlePrimary}
            style={{ ...BTN_BASE, background: 'var(--evergreen-500)', color: 'var(--evergreen-900)' }}
          >
            {content.primary}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--maestro-ink-3)', margin: '26px 0 24px' }}>
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            className="tab-btn"
            type="button"
            onClick={() => setTab(key)}
            style={tab === key ? { ...tabBase, ...tabActive } : tabBase}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === 'overview' && (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Main column */}
          <div style={{ flex: '1 1 360px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Intro card */}
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--maestro-ink-3)', borderRadius: 'var(--radius-l)', padding: 24 }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, margin: '0 0 8px', color: 'var(--fg-2)' }}>
                {content.introHeading}
              </h2>
              <p style={{ fontFamily: 'var(--font-text)', fontSize: 14, lineHeight: 1.55, color: 'var(--fg-3)', margin: '0 0 18px', maxWidth: 440 }}>
                {content.intro}
              </p>
              <button
                className="action-btn primary"
                type="button"
                onClick={handlePrimary}
                style={{ ...BTN_BASE, background: 'var(--maestro-paper-3)', color: 'var(--maestro-ink)' }}
              >
                {content.primary}
                <AppIcon name="arrow" size={15} />
              </button>
            </div>

            {/* What's inside */}
            {content.links.length > 0 && (
              <div>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-3)', margin: '0 0 12px' }}>
                  What's inside
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {content.links.map((link, i) => (
                    <button
                      key={i}
                      className="app-card"
                      type="button"
                      onClick={() => handleLink(link.title)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14, width: '100%',
                        textAlign: 'left', background: 'var(--bg-surface)',
                        border: '1px solid var(--maestro-ink-3)', borderRadius: 'var(--radius-m)',
                        padding: '12px 14px', color: 'inherit', fontFamily: 'inherit',
                      }}
                    >
                      <span style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, width: 34, height: 34, borderRadius: 8,
                        background: 'var(--maestro-ink-3)', color: 'var(--maestro-paper-3)',
                      }}>
                        <AppIcon name={link.icon} size={18} />
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, color: 'var(--fg-2)' }}>{link.title}</span>
                        <span style={{ fontFamily: 'var(--font-text)', fontSize: 12, color: 'var(--fg-3)' }}>{link.desc}</span>
                      </span>
                      <span style={{ display: 'inline-flex', color: 'var(--fg-3)', flexShrink: 0 }}>
                        <AppIcon name="chevronR" size={16} />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* About aside */}
          <aside style={{
            flex: '1 1 240px', maxWidth: 320,
            background: 'var(--bg-surface)', border: '1px solid var(--maestro-ink-3)',
            borderRadius: 'var(--radius-l)', padding: 20,
            display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-3)', margin: 0 }}>
              About
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-text)', fontSize: 13 }}>Area</span>
                <span style={{ color: 'var(--fg-2)', fontFamily: 'var(--font-text)', fontSize: 13 }}>{sectionLabel}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-text)', fontSize: 13 }}>Status</span>
                <span style={{ color: 'var(--fg-2)', fontFamily: 'var(--font-text)', fontSize: 13 }}>
                  {app.status ? app.status.charAt(0).toUpperCase() + app.status.slice(1) : 'Available'}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: '1px solid var(--maestro-ink-3)', paddingTop: 14 }}>
              {[sectionLabel.toLowerCase(), 'lms'].map(tag => (
                <span
                  key={tag}
                  style={{
                    fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: '18px',
                    padding: '0 8px', borderRadius: 'var(--radius-xs)',
                    background: 'var(--maestro-ink-3)', color: 'var(--fg-3)',
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </aside>
        </div>
      )}

      {/* Empty state for Activity / Resources tabs */}
      {tab !== 'overview' && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', textAlign: 'center',
          padding: '72px 24px',
          border: '1px dashed var(--maestro-ink-3)', borderRadius: 'var(--radius-l)',
          background: 'var(--bg-surface)',
        }}>
          <span style={{ display: 'inline-flex', color: 'var(--fg-3)', marginBottom: 14 }}>
            <AppIcon name="inbox" size={28} />
          </span>
          <p style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--fg-2)', margin: '0 0 6px' }}>
            Nothing here yet
          </p>
          <p style={{ fontFamily: 'var(--font-text)', fontSize: 13, lineHeight: 1.5, color: 'var(--fg-3)', margin: 0, maxWidth: 320 }}>
            Start with a single idea — this space fills in as you go.
          </p>
        </div>
      )}
    </div>
  );
}
