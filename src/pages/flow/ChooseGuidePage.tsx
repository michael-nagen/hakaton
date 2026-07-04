// ── Page 2 · Choose AI Guide ──────────────────────────────────────────
// Pick a tutor (not "configure a model"). Only the selected card reveals its
// setup. This screen now connects to the EXISTING provider system instead of
// mock state:
//   • Gemini      → validateGeminiKey + setAiProvider (gemini_byok)
//   • OpenRouter  → validateOpenRouterKey + setAiProvider (openrouter_byok)
//   • Local AI    → the single MVP local model (Llama) via the existing
//                   local-inference runtime (detect → download → use).
// No new storage/validation/runtime is invented — everything routes through
// useAiProvider() and the model-provider module. No raw provider errors, no
// JSON, no technical runtime details surface in the UI.
//
// Visual design is unchanged from the imported "Choose AI Guide" design.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAiProvider } from '../../contexts/AiProviderContext';
import { GEMINI_KEY_PAGE } from '../AiSetupPage';
import {
  DEFAULT_GEMINI_MODEL,
  validateGeminiKey,
  DEFAULT_OPENROUTER_FREE_MODEL,
  validateOpenRouterKey,
  LOCAL_MODEL_CATALOG,
  localInferenceRuntime,
} from '../../model-provider';

type Guide = 'local' | 'gemini' | 'other';
type Check = 'idle' | 'validating' | 'ok' | 'error';
// Local AI lifecycle as shown on this card (kept intentionally non-technical).
type LocalState = 'checking' | 'ready' | 'not_downloaded' | 'downloading' | 'unsupported' | 'error';

// The single MVP local model. Identified from the existing catalog by family so
// we never hard-code a runtime id here; there is no local model picker.
const LLAMA = LOCAL_MODEL_CATALOG.find((m) => m.modelFamily === 'llama') ?? LOCAL_MODEL_CATALOG[0];

const OTHER_MODELS = ['Llama 3.1 70B', 'Mistral Large', 'Qwen 2.5 72B', 'Gemma 2 27B'];

export function ChooseGuidePage() {
  const navigate = useNavigate();
  const { setAiProvider } = useAiProvider();

  const [selected, setSelected] = useState<Guide | null>(null);
  const [ready, setReady] = useState<Guide | null>(null);

  const [geminiKey, setGeminiKey] = useState('');
  const [geminiVal, setGeminiVal] = useState<Check>('idle');

  const [otherKey, setOtherKey] = useState('');
  const [otherModel, setOtherModel] = useState('');
  const [otherVal, setOtherVal] = useState<Check>('idle');

  const [localState, setLocalState] = useState<LocalState>('checking');
  const [localProgress, setLocalProgress] = useState(0);

  // Detect the local model once, using the existing runtime probes:
  //   isSupported     → WebGPU present + a runnable model
  //   isModelDownloaded → weights already cached in this browser
  // Runs on mount so the Local card shows the right state as soon as it opens.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const supported = await localInferenceRuntime.isSupported({ modelId: LLAMA.id });
        if (cancelled) return;
        if (!supported) {
          setLocalState('unsupported');
          return;
        }
        const downloaded = await localInferenceRuntime.isModelDownloaded({ modelId: LLAMA.id });
        if (cancelled) return;
        setLocalState(downloaded ? 'ready' : 'not_downloaded');
      } catch {
        if (!cancelled) setLocalState('unsupported');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const select = (g: Guide) => setSelected(g);

  const geminiOk = geminiKey.trim().length > 0;
  const otherOk = otherKey.trim().length > 0 && otherModel.length > 0;
  const ctaReady = ready != null && ready === selected;

  // ── Gemini: reuse existing validation + storage ─────────────────────
  const confirmGemini = async () => {
    if (!geminiOk || geminiVal === 'validating') return;
    setGeminiVal('validating');
    const result = await validateGeminiKey({ apiKey: geminiKey.trim(), model: DEFAULT_GEMINI_MODEL });
    if (result.ok) {
      setAiProvider({ type: 'gemini_byok', apiKey: geminiKey.trim(), model: DEFAULT_GEMINI_MODEL });
      setGeminiVal('ok');
      setSelected('gemini');
      setReady('gemini');
    } else {
      setGeminiVal('error');
    }
  };

  // ── OpenRouter: reuse existing validation + storage ─────────────────
  // NOTE: the app has no curated OpenRouter model list, so the key is validated
  // and saved against the app's existing default model. The dropdown choice is
  // a display-only gate for now (a real model list is a next step).
  const confirmOther = async () => {
    if (!otherOk || otherVal === 'validating') return;
    setOtherVal('validating');
    const result = await validateOpenRouterKey({ apiKey: otherKey.trim(), model: DEFAULT_OPENROUTER_FREE_MODEL });
    if (result.ok) {
      setAiProvider({ type: 'openrouter_byok', apiKey: otherKey.trim(), model: DEFAULT_OPENROUTER_FREE_MODEL });
      setOtherVal('ok');
      setSelected('other');
      setReady('other');
    } else {
      setOtherVal('error');
    }
  };

  // ── Local AI: reuse existing download runtime (no new system) ───────
  const downloadLocal = async () => {
    setLocalState('downloading');
    setLocalProgress(0);
    try {
      // loadModel warms up the WebLLM engine, which fetches + caches the weights
      // and reports progress — the same call the existing setup screen uses.
      await localInferenceRuntime.loadModel({
        modelId: LLAMA.id,
        onProgress: (p) => setLocalProgress(Math.round((p.progress ?? 0) * 100)),
      });
      setLocalState('ready');
    } catch {
      setLocalState('error');
    }
  };

  const useLocal = () => {
    setAiProvider({ type: 'local_model', model: LLAMA.id, displayName: LLAMA.displayName });
    setSelected('local');
    setReady('local');
  };

  return (
    <div className="mds" style={{ minHeight: '100vh', display: 'flex', background: '#0A0A0A' }}>
      {/* LEFT: cinematic path image + scrim + headline */}
      <div style={{ position: 'relative', flex: '0 0 43%', overflow: 'hidden', minHeight: '100vh', background: '#0A0A0A' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: 'url(/assets/path-dawn.svg)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div style={{ position: 'absolute', top: 36, left: 44, zIndex: 3 }}>
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: '0.34em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.82)',
            }}
          >
            Maestro
          </span>
        </div>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(to top, rgba(10,10,10,0.86) 0%, rgba(10,10,10,0.5) 26%, rgba(10,10,10,0.12) 50%, rgba(10,10,10,0) 72%)',
            zIndex: 2,
          }}
        />
        <div style={{ position: 'absolute', left: 44, right: 44, bottom: 52, zIndex: 3 }}>
          <h2
            style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: 44,
              lineHeight: 1.04,
              fontWeight: 600,
              letterSpacing: '-1px',
              color: '#ffffff',
              textShadow: '0 2px 34px rgba(0,0,0,0.35)',
            }}
          >
            Choose Your
            <br />
            AI Guide
          </h2>
          <p
            style={{
              margin: '20px 0 0',
              fontFamily: 'var(--font-text)',
              fontSize: 18,
              lineHeight: 1.45,
              fontWeight: 500,
              color: 'rgba(255,255,255,0.86)',
              maxWidth: 360,
            }}
          >
            Every path begins with the right guide.
          </p>
        </div>
      </div>

      {/* RIGHT: calm selection surface */}
      <div
        className="mds-scroll"
        style={{
          flex: 1,
          minHeight: '100vh',
          overflowY: 'auto',
          background: 'var(--color-bg)',
          boxSizing: 'border-box',
          padding: '52px 56px 40px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <p
          style={{
            margin: '0 0 4px',
            fontFamily: 'var(--font-display)',
            fontSize: 22,
            lineHeight: 1.3,
            fontWeight: 600,
            color: 'var(--color-fg)',
          }}
        >
          Who will guide you?
        </p>
        <p
          style={{
            margin: '0 0 28px',
            fontFamily: 'var(--font-text)',
            fontSize: 16,
            lineHeight: 1.5,
            color: 'var(--color-fg-secondary)',
          }}
        >
          Pick the tutor that will lead your lessons step by step.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Local AI */}
          <GuideCard selected={selected === 'local'} onClick={() => select('local')}>
            <CardHead
              tile="var(--evergreen-tile)"
              tileColor="var(--evergreen-text)"
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="12" rx="2" />
                  <path d="M8 20h8M12 16v4" />
                </svg>
              }
              title="Local AI"
              desc="Use a local model on this computer."
              sub="Works offline after setup."
              selected={selected === 'local'}
            />
            <Collapse open={selected === 'local'}>
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
                <LocalSetup
                  state={localState}
                  progress={localProgress}
                  isReady={ready === 'local'}
                  onDownload={downloadLocal}
                  onUse={useLocal}
                />
              </div>
            </Collapse>
          </GuideCard>

          {/* Gemini */}
          <GuideCard selected={selected === 'gemini'} onClick={() => select('gemini')}>
            <CardHead
              tile="var(--lavender-tile)"
              tileColor="var(--lavender-text)"
              icon={<SparkleIcon />}
              title="Gemini"
              desc="Use a free key from Google AI Studio."
              selected={selected === 'gemini'}
            />
            <Collapse open={selected === 'gemini'}>
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
                <p style={{ margin: '0 0 12px', fontFamily: 'var(--font-text)', fontSize: 13, lineHeight: 1.5, color: 'var(--color-fg-tertiary)' }}>
                  Create a free key, then paste it here.
                </p>
                <input
                  onClick={(e) => e.stopPropagation()}
                  value={geminiKey}
                  onChange={(e) => {
                    setGeminiKey(e.target.value);
                    if (geminiVal !== 'idle') setGeminiVal('idle');
                  }}
                  placeholder="Paste your Gemini API key"
                  style={inputStyle}
                />
                <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="mds-btn mds-btn-ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(GEMINI_KEY_PAGE, '_blank', 'noopener,noreferrer');
                    }}
                    style={ghostBtn}
                  >
                    Get free key
                  </button>
                  <button
                    type="button"
                    disabled={!geminiOk || geminiVal === 'validating'}
                    onClick={(e) => {
                      e.stopPropagation();
                      void confirmGemini();
                    }}
                    style={confirmBtn(geminiOk && geminiVal !== 'validating')}
                  >
                    {geminiVal === 'validating' ? 'Checking…' : 'Use Gemini'}
                  </button>
                  {ready === 'gemini' && <ReadyPill />}
                </div>
                <StatusLine check={geminiVal} errorText="That key didn't work — check it and try again." />
              </div>
            </Collapse>
          </GuideCard>

          {/* OpenRouter / Other API */}
          <GuideCard selected={selected === 'other'} onClick={() => select('other')}>
            <CardHead
              tile="var(--sunset-tile)"
              tileColor="var(--sunset-text)"
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="m15.5 8.5-2 5-5 2 2-5 5-2z" />
                </svg>
              }
              title="OpenRouter / Other API"
              desc="Use your own API key and choose a model."
              selected={selected === 'other'}
            />
            <Collapse open={selected === 'other'}>
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input
                  onClick={(e) => e.stopPropagation()}
                  value={otherKey}
                  onChange={(e) => {
                    setOtherKey(e.target.value);
                    if (otherVal !== 'idle') setOtherVal('idle');
                  }}
                  placeholder="Paste your API key"
                  style={inputStyle}
                />
                <select
                  onClick={(e) => e.stopPropagation()}
                  value={otherModel}
                  onChange={(e) => {
                    setOtherModel(e.target.value);
                    if (otherVal !== 'idle') setOtherVal('idle');
                  }}
                  style={{ ...inputStyle, color: otherModel ? 'var(--color-fg)' : 'var(--color-fg-tertiary)' }}
                >
                  <option value="" disabled>
                    Choose model
                  </option>
                  {OTHER_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    disabled={!otherOk || otherVal === 'validating'}
                    onClick={(e) => {
                      e.stopPropagation();
                      void confirmOther();
                    }}
                    style={confirmBtn(otherOk && otherVal !== 'validating')}
                  >
                    {otherVal === 'validating' ? 'Checking…' : 'Use this model'}
                  </button>
                  {ready === 'other' && <ReadyPill />}
                </div>
                <StatusLine check={otherVal} errorText="That key didn't work — check it and try again." />
              </div>
            </Collapse>
          </GuideCard>
        </div>

        {/* CTA */}
        <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {selected && !ctaReady && (
            <p style={{ margin: 0, fontFamily: 'var(--font-text)', fontSize: 14, color: 'var(--color-fg-tertiary)' }}>
              Finish setting up your guide to continue.
            </p>
          )}
          <button
            type="button"
            className="mds-btn"
            disabled={!ctaReady}
            onClick={() => ctaReady && navigate('/paths')}
            style={{
              height: 48,
              padding: '0 26px',
              alignSelf: 'flex-start',
              border: 'none',
              borderRadius: 9999,
              background: ctaReady ? '#0A0A0A' : '#E2E1DA',
              color: ctaReady ? '#FFFFFF' : '#AAAAA5',
              fontFamily: 'var(--font-text)',
              fontSize: 16,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              cursor: ctaReady ? 'pointer' : 'not-allowed',
            }}
          >
            Continue to Learning Paths
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Local AI setup states (no picker — single MVP model) ──────────────

function LocalSetup({
  state,
  progress,
  isReady,
  onDownload,
  onUse,
}: {
  state: LocalState;
  progress: number;
  isReady: boolean;
  onDownload: () => void;
  onUse: () => void;
}) {
  if (state === 'checking') {
    return <span style={{ fontFamily: 'var(--font-text)', fontSize: 14, color: 'var(--color-fg-secondary)' }}>Checking your device…</span>;
  }

  if (state === 'unsupported') {
    return <span style={{ fontFamily: 'var(--font-text)', fontSize: 14, color: 'var(--color-fg-secondary)' }}>Local AI is not supported on this computer.</span>;
  }

  if (state === 'downloading') {
    const pct = Math.max(4, Math.min(100, progress));
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontFamily: 'var(--font-text)', fontSize: 14, fontWeight: 500, color: 'var(--color-fg)' }}>
          Downloading Local AI…{progress > 0 ? ` ${pct}%` : ''}
        </span>
        <div style={{ height: 6, borderRadius: 9999, background: 'var(--color-border)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: '#0A0A0A', borderRadius: 9999, transition: 'width 200ms cubic-bezier(0.2,0,0,1)' }} />
        </div>
        <span style={{ fontFamily: 'var(--font-text)', fontSize: 13, color: 'var(--color-fg-tertiary)' }}>This can take a little while the first time.</span>
      </div>
    );
  }

  if (state === 'ready') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <CheckDisc />
          <span style={{ fontFamily: 'var(--font-text)', fontSize: 14, fontWeight: 500, color: 'var(--color-fg)' }}>Local model ready</span>
        </span>
        <button type="button" onClick={(e) => { e.stopPropagation(); onUse(); }} style={confirmBtn(true)}>
          Use Local AI
        </button>
        {isReady && <ReadyPill />}
      </div>
    );
  }

  // 'not_downloaded' or 'error'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontFamily: 'var(--font-text)', fontSize: 14, color: 'var(--color-fg-secondary)' }}>
        {state === 'error' ? "That didn't finish — please try the download again." : 'Llama is not downloaded yet.'}
      </span>
      <div>
        <button type="button" onClick={(e) => { e.stopPropagation(); onDownload(); }} style={confirmBtn(true)}>
          Download Local AI
        </button>
      </div>
    </div>
  );
}

// ── Small building blocks ─────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  height: 40,
  border: '1px solid var(--color-border-input)',
  borderRadius: 12,
  padding: '0 12px',
  fontFamily: 'var(--font-text)',
  fontSize: 15,
  color: 'var(--color-fg)',
  background: '#fff',
  outline: 'none',
};

const ghostBtn: React.CSSProperties = {
  height: 40,
  padding: '0 16px',
  borderRadius: 9999,
  border: '1px solid var(--color-border-strong)',
  background: 'transparent',
  color: 'var(--color-fg)',
  fontFamily: 'var(--font-text)',
  fontSize: 14,
  fontWeight: 500,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

function confirmBtn(ok: boolean): React.CSSProperties {
  return {
    height: 40,
    padding: '0 18px',
    borderRadius: 9999,
    border: 'none',
    background: ok ? '#0A0A0A' : '#E2E1DA',
    color: ok ? '#FFFFFF' : '#AAAAA5',
    fontFamily: 'var(--font-text)',
    fontSize: 14,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    cursor: ok ? 'pointer' : 'not-allowed',
  };
}

// Friendly, non-technical validation feedback — never shows the raw error.
function StatusLine({ check, errorText }: { check: Check; errorText: string }) {
  if (check === 'idle') return null;
  if (check === 'validating') {
    return <p style={{ margin: '10px 0 0', fontFamily: 'var(--font-text)', fontSize: 13, color: 'var(--color-fg-tertiary)' }}>Checking your key…</p>;
  }
  if (check === 'ok') {
    return <p style={{ margin: '10px 0 0', fontFamily: 'var(--font-text)', fontSize: 13, fontWeight: 500, color: 'var(--success-text)' }}>Connected.</p>;
  }
  return <p style={{ margin: '10px 0 0', fontFamily: 'var(--font-text)', fontSize: 13, color: 'var(--sunset-text)' }}>{errorText}</p>;
}

function GuideCard({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClick}
      className="mds-card"
      style={{
        background: 'var(--color-surface)',
        border: `1px solid ${selected ? '#0A0A0A' : 'var(--color-border)'}`,
        borderRadius: 16,
        padding: 20,
        cursor: 'pointer',
        boxShadow: selected ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
      }}
    >
      {children}
    </div>
  );
}

function CardHead({
  tile,
  tileColor,
  icon,
  title,
  desc,
  sub,
  selected,
}: {
  tile: string;
  tileColor: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  sub?: string;
  selected: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ flex: 'none', width: 44, height: 44, borderRadius: 12, background: tile, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tileColor }}>
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600, color: 'var(--color-fg)' }}>{title}</div>
        <div style={{ marginTop: 3, fontFamily: 'var(--font-text)', fontSize: 14, lineHeight: 1.45, color: 'var(--color-fg-secondary)' }}>{desc}</div>
        {sub && <div style={{ marginTop: 2, fontFamily: 'var(--font-text)', fontSize: 13, color: 'var(--color-fg-tertiary)' }}>{sub}</div>}
      </div>
      <div
        style={{
          flex: 'none',
          marginTop: 2,
          width: 20,
          height: 20,
          borderRadius: 9999,
          border: `1.5px solid ${selected ? '#0A0A0A' : 'var(--color-border-strong)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected && <div style={{ width: 10, height: 10, borderRadius: 9999, background: '#0A0A0A' }} />}
      </div>
    </div>
  );
}

// Grid-rows collapse to mirror the design's smooth open/close animation.
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 220ms cubic-bezier(0.2,0,0,1)' }}>
      <div style={{ overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

function CheckDisc() {
  return (
    <span style={{ flex: 'none', width: 22, height: 22, borderRadius: 9999, background: 'var(--success-tile)', color: 'var(--success-icon)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  );
}

function ReadyPill() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginLeft: 2 }}>
      <span style={{ flex: 'none', width: 20, height: 20, borderRadius: 9999, background: 'var(--success-tile)', color: 'var(--success-icon)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <span style={{ fontFamily: 'var(--font-text)', fontSize: 13, fontWeight: 500, color: 'var(--color-fg)' }}>Ready</span>
    </span>
  );
}

function SparkleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2c.3 3.6 2.4 5.7 6 6-3.6.3-5.7 2.4-6 6-.3-3.6-2.4-5.7-6-6 3.6-.3 5.7-2.4 6-6z" />
    </svg>
  );
}
