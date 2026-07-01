import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAiProvider } from '../contexts/AiProviderContext';
import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODELS,
  validateGeminiKey,
  DEFAULT_OPENROUTER_FREE_MODEL,
  validateOpenRouterKey,
  validateCustomKey,
  LOCAL_MODEL_CATALOG,
} from '../model-provider';
import type { AiProviderType } from '../model-provider';

// Standalone AI setup screen. Lets the user choose how the tutor runs and (for
// BYOK/custom) paste + validate a key that is stored on-device only. Styled with
// the same design tokens as the other standalone pages — no CSS library.

type ValStatus = 'idle' | 'validating' | 'valid' | 'invalid';
interface Validation {
  status: ValStatus;
  message: string;
}
const IDLE: Validation = { status: 'idle', message: '' };

const field: React.CSSProperties = {
  background: 'var(--maestro-ink-2)',
  border: '1px solid var(--maestro-ink-3)',
  borderRadius: 8,
  padding: '9px 11px',
  color: 'var(--fg-1)',
  fontFamily: 'var(--font-text)',
  fontSize: 14,
  width: '100%',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--fg-3)',
};

function Badge({ text, tone }: { text: string; tone: string }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: tone,
        border: `1px solid ${tone}`,
        borderRadius: 'var(--radius-pill)',
        padding: '2px 8px',
      }}
    >
      {text}
    </span>
  );
}

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    fontFamily: 'var(--font-ui)',
    fontSize: 14,
    padding: '9px 18px',
    borderRadius: 'var(--radius-pill)',
    border: '1px solid transparent',
    cursor: disabled ? 'default' : 'pointer',
    background: 'var(--evergreen-500)',
    color: 'var(--evergreen-900)',
    opacity: disabled ? 0.55 : 1,
  };
}

const ghostBtn: React.CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 13,
  padding: '8px 14px',
  borderRadius: 'var(--radius-pill)',
  border: '1px solid var(--maestro-ink-3)',
  background: 'transparent',
  color: 'var(--fg-2)',
  cursor: 'pointer',
};

function ValidationLine({ v }: { v: Validation }) {
  if (v.status === 'idle') return null;
  const color =
    v.status === 'valid'
      ? 'var(--evergreen-500)'
      : v.status === 'invalid'
        ? 'var(--sunset-500, #FF8B62)'
        : 'var(--fg-3)';
  const text =
    v.status === 'validating'
      ? 'Validating…'
      : v.status === 'valid'
        ? 'Key validated. Provider saved.'
        : v.message || 'Validation failed.';
  return <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color, margin: '6px 0 0' }}>{text}</p>;
}

function Card({
  title,
  badge,
  children,
  active,
}: {
  title: string;
  badge: { text: string; tone: string };
  children: React.ReactNode;
  active: boolean;
}) {
  return (
    <section
      style={{
        border: `1px solid ${active ? 'var(--evergreen-500)' : 'var(--maestro-ink-3)'}`,
        borderRadius: 12,
        padding: 18,
        background: 'var(--bg-surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Badge text={badge.text} tone={badge.tone} />
        <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 17, margin: 0, color: 'var(--fg-1)' }}>
          {title}
        </h2>
        {active && <span style={{ ...labelStyle, color: 'var(--evergreen-500)' }}>· active</span>}
      </div>
      {children}
    </section>
  );
}

export function AiSetupPage() {
  const { config, setAiProvider, clearAiProvider } = useAiProvider();
  const activeType: AiProviderType = config.type;

  // Gemini section state
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState<string>(DEFAULT_GEMINI_MODEL);
  const [geminiVal, setGeminiVal] = useState<Validation>(IDLE);

  // OpenRouter section state
  const [orKey, setOrKey] = useState('');
  const [orModel, setOrModel] = useState<string>(DEFAULT_OPENROUTER_FREE_MODEL);
  const [orVal, setOrVal] = useState<Validation>(IDLE);

  // Custom section state
  const [showCustom, setShowCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [customVal, setCustomVal] = useState<Validation>(IDLE);

  const connectGemini = async () => {
    const apiKey = geminiKey.trim();
    if (!apiKey) return;
    setGeminiVal({ status: 'validating', message: '' });
    const result = await validateGeminiKey({ apiKey, model: geminiModel });
    if (result.ok) {
      setAiProvider({ type: 'gemini_byok', apiKey, model: geminiModel });
      setGeminiVal({ status: 'valid', message: '' });
      setGeminiKey('');
    } else {
      setGeminiVal({ status: 'invalid', message: result.message });
    }
  };

  const connectOpenRouter = async () => {
    const apiKey = orKey.trim();
    if (!apiKey) return;
    setOrVal({ status: 'validating', message: '' });
    const result = await validateOpenRouterKey({ apiKey, model: orModel });
    if (result.ok) {
      setAiProvider({ type: 'openrouter_byok', apiKey, model: orModel });
      setOrVal({ status: 'valid', message: '' });
      setOrKey('');
    } else {
      setOrVal({ status: 'invalid', message: result.message });
    }
  };

  const connectCustom = async () => {
    const baseUrl = customBaseUrl.trim();
    const model = customModel.trim();
    if (!baseUrl || !model) {
      setCustomVal({ status: 'invalid', message: 'Base URL and model name are required.' });
      return;
    }
    setCustomVal({ status: 'validating', message: '' });
    const result = await validateCustomKey({ baseUrl, apiKey: customKey.trim(), model });
    if (result.ok) {
      setAiProvider({
        type: 'custom',
        apiKey: customKey.trim() || undefined,
        model,
        baseUrl,
        displayName: customName.trim() || 'Custom provider',
      });
      setCustomVal({ status: 'valid', message: '' });
      setCustomKey('');
    } else {
      setCustomVal({ status: 'invalid', message: result.message });
    }
  };

  const useBuiltIn = () => {
    setAiProvider({ type: 'built_in' });
  };

  const selectLocal = (modelId: string) => {
    setAiProvider({ type: 'local_model', model: modelId });
  };

  const disclosure: React.CSSProperties = { fontSize: 13, color: 'var(--fg-3)', margin: 0, lineHeight: 1.55 };

  return (
    <div
      data-theme="dark"
      style={{ minHeight: '100vh', background: 'var(--bg-page)', color: 'var(--fg-1)', fontFamily: 'var(--font-text)' }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 20px 80px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <header>
          <p style={{ ...labelStyle, margin: '0 0 6px' }}>AI setup</p>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, margin: 0, color: 'var(--fg-2)' }}>
            Choose how to power your AI tutor
          </h1>
          <p style={{ ...disclosure, margin: '8px 0 0' }}>
            You can start with cloud AI, connect your own free API key, or download a local model for offline learning.
          </p>
          <p style={{ ...labelStyle, margin: '10px 0 0' }}>
            Currently active: <span style={{ color: 'var(--evergreen-500)' }}>{config.displayName}</span>
            {config.model ? ` · ${config.model}` : ''}
          </p>
        </header>

        {/* Built-in */}
        <Card title="Use built-in AI" badge={{ text: 'Recommended', tone: 'var(--evergreen-500)' }} active={activeType === 'built_in'}>
          <p style={disclosure}>Start learning immediately. Limited free usage. Best for trying things out right away.</p>
          <div>
            <button type="button" style={primaryBtn(activeType === 'built_in')} disabled={activeType === 'built_in'} onClick={useBuiltIn}>
              {activeType === 'built_in' ? 'Selected' : 'Use built-in AI'}
            </button>
          </div>
        </Card>

        {/* Gemini */}
        <Card title="Connect Gemini" badge={{ text: 'Free', tone: 'var(--lavender-500, #B9A7FF)' }} active={activeType === 'gemini_byok'}>
          <p style={disclosure}>
            Use your own Gemini API key and free quota. Your usage is counted by Google, not by us. The key belongs to
            you, stays on this device, and you can delete it anytime. Best for high-quality tutoring without downloading a
            model.
          </p>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>Gemini API key</span>
            <input
              type="password"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder="Paste your Gemini API key"
              style={field}
              autoComplete="off"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>Model (default is cheapest)</span>
            <select value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)} style={field}>
              {GEMINI_MODELS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <div>
            <button
              type="button"
              style={primaryBtn(!geminiKey.trim() || geminiVal.status === 'validating')}
              disabled={!geminiKey.trim() || geminiVal.status === 'validating'}
              onClick={() => void connectGemini()}
            >
              Validate &amp; connect Gemini
            </button>
          </div>
          <ValidationLine v={geminiVal} />
        </Card>

        {/* OpenRouter */}
        <Card title="Connect OpenRouter" badge={{ text: 'Free', tone: 'var(--lavender-500, #B9A7FF)' }} active={activeType === 'openrouter_byok'}>
          <p style={disclosure}>
            Use free OpenRouter models with your own account. OpenRouter gives access to many models; some are free with
            usage limits. Usage is counted against your OpenRouter account. Good for trying multiple models without
            downloading anything.
          </p>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>OpenRouter API key</span>
            <input
              type="password"
              value={orKey}
              onChange={(e) => setOrKey(e.target.value)}
              placeholder="Paste your OpenRouter API key"
              style={field}
              autoComplete="off"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>Model</span>
            <input value={orModel} onChange={(e) => setOrModel(e.target.value)} placeholder={DEFAULT_OPENROUTER_FREE_MODEL} style={field} />
          </label>
          <div>
            <button
              type="button"
              style={primaryBtn(!orKey.trim() || orVal.status === 'validating')}
              disabled={!orKey.trim() || orVal.status === 'validating'}
              onClick={() => void connectOpenRouter()}
            >
              Validate &amp; connect OpenRouter
            </button>
          </div>
          <ValidationLine v={orVal} />
        </Card>

        {/* Local model */}
        <Card title="Offline model" badge={{ text: 'Offline', tone: 'var(--sunset-500, #FF8B62)' }} active={activeType === 'local_model'}>
          <p style={disclosure}>
            Download a free local model and run the tutor on your phone. Works without internet, but requires a large
            download (roughly 1GB–3GB) and a strong device. Performance depends on your phone.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {LOCAL_MODEL_CATALOG.map((m) => (
              <div
                key={m.id}
                style={{ border: '1px solid var(--maestro-ink-3)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}
              >
                <span style={{ fontSize: 14, color: 'var(--fg-1)' }}>{m.displayName}</span>
                <span style={{ ...labelStyle, textTransform: 'none', letterSpacing: 0 }}>
                  Download ~{(m.sizeMb / 1000).toFixed(1)}GB · storage ~{Math.ceil(m.sizeMb / 1000) + 1}GB · min RAM {m.minRamGb ?? '?'}GB ·
                  recommended {m.recommendedRamGb ?? '?'}GB · works offline · format {m.format}
                </span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button type="button" style={ghostBtn} onClick={() => selectLocal(m.id)}>
                    {activeType === 'local_model' && config.model === m.id ? 'Selected' : 'Select this model'}
                  </button>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
                    Download &amp; on-device inference — coming soon
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Custom (advanced) */}
        <Card title="Custom provider" badge={{ text: 'Advanced', tone: 'var(--fg-3)' }} active={activeType === 'custom'}>
          <button type="button" style={ghostBtn} onClick={() => setShowCustom((v) => !v)}>
            {showCustom ? 'Hide advanced' : 'Add another provider manually'}
          </button>
          {showCustom && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
              <p style={disclosure}>Point the tutor at any OpenAI-compatible endpoint (Groq, a gateway, a local server).</p>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={labelStyle}>Provider name</span>
                <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="e.g. Groq" style={field} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={labelStyle}>Base URL</span>
                <input value={customBaseUrl} onChange={(e) => setCustomBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" style={field} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={labelStyle}>API key (optional)</span>
                <input type="password" value={customKey} onChange={(e) => setCustomKey(e.target.value)} placeholder="Paste key" style={field} autoComplete="off" />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={labelStyle}>Model name</span>
                <input value={customModel} onChange={(e) => setCustomModel(e.target.value)} placeholder="e.g. llama-3.1-8b-instant" style={field} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={labelStyle}>Request format</span>
                <select style={field} defaultValue="openai_chat">
                  <option value="openai_chat">OpenAI chat/completions</option>
                </select>
              </label>
              <div>
                <button
                  type="button"
                  style={primaryBtn(customVal.status === 'validating')}
                  disabled={customVal.status === 'validating'}
                  onClick={() => void connectCustom()}
                >
                  Validate &amp; connect
                </button>
              </div>
              <ValidationLine v={customVal} />
            </div>
          )}
        </Card>

        {/* Footer actions */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" style={ghostBtn} onClick={clearAiProvider}>
            Delete key &amp; reset to built-in
          </button>
          <Link to="/tutor-demo" style={{ color: 'var(--evergreen-500)', fontSize: 13 }}>
            Try the tutor →
          </Link>
        </div>
      </div>
    </div>
  );
}
