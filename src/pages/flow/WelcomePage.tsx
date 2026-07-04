// ── Page 1 · Welcome ──────────────────────────────────────────────────
// Cinematic full-bleed welcome. One action: Start Learning → Choose AI Guide.
// Ported from the "Welcome Screen" design (desktop variant). The hero photo
// is loaded from /assets if present; a dark cinematic gradient stands in when
// it isn't, so the visual direction holds either way.

import { useNavigate } from 'react-router-dom';

export function WelcomePage() {
  const navigate = useNavigate();

  return (
    <div
      className="mds"
      style={{
        position: 'relative',
        minHeight: '100vh',
        width: '100%',
        overflow: 'hidden',
        background: '#0A0A0A',
      }}
    >
      {/* Hero image (falls back to the dark base bg if the file is absent) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'url(/assets/hero-dawn-wide.svg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      {/* Cinematic scrims (from the design) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(74deg, rgba(10,10,10,0.86) 0%, rgba(10,10,10,0.5) 30%, rgba(10,10,10,0.08) 58%, rgba(10,10,10,0) 76%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to top, rgba(10,10,10,0.5) 0%, rgba(10,10,10,0) 32%)',
        }}
      />

      {/* Wordmark */}
      <div style={{ position: 'absolute', top: 40, left: 64, zIndex: 3 }}>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: '0.34em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.8)',
          }}
        >
          Maestro
        </span>
      </div>

      {/* Headline + CTA */}
      <div
        style={{
          position: 'absolute',
          left: 64,
          bottom: 80,
          maxWidth: 560,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          zIndex: 3,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontSize: 64,
            lineHeight: 1.0,
            fontWeight: 600,
            letterSpacing: '-1.4px',
            color: '#ffffff',
            textShadow: '0 2px 40px rgba(0,0,0,0.32)',
          }}
        >
          Become Anything
        </h1>
        <p
          style={{
            margin: '20px 0 0',
            fontFamily: 'var(--font-text)',
            fontSize: 21,
            lineHeight: 1.3,
            fontWeight: 500,
            color: 'rgba(255,255,255,0.94)',
          }}
        >
          A step toward a new future
        </p>
        <p
          style={{
            margin: '12px 0 0',
            fontFamily: 'var(--font-text)',
            fontSize: 16,
            lineHeight: 1.55,
            fontWeight: 400,
            color: 'rgba(255,255,255,0.72)',
          }}
        >
          A free AI-based degree.
          <br />
          The first step starts here.
        </p>
        <button
          type="button"
          className="mds-btn"
          onClick={() => navigate('/guide')}
          style={{
            marginTop: 32,
            height: 54,
            padding: '0 36px',
            border: 'none',
            borderRadius: 9999,
            background: '#FFFFFF',
            color: '#0A0A0A',
            fontFamily: 'var(--font-text)',
            fontSize: 16,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 8px 30px rgba(0,0,0,0.24)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#ECEBE4')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#FFFFFF')}
        >
          Start Learning
        </button>
      </div>
    </div>
  );
}
