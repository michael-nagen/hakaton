import { useEffect, useRef, useState } from 'react';
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
  getLocalModelById,
  buildOpenRouterAuthUrl,
  readOAuthCodeFromUrl,
  clearOAuthCodeFromUrl,
  exchangeOpenRouterCode,
  downloadLocalModel,
  localModelStorage,
  readLocalModelState,
  writeLocalModelState,
  clearLocalModelState,
  effectiveInstallStatus,
  loadLocalModelManifest,
  mergeManifestIntoCatalog,
  localInferenceRuntime,
} from '../model-provider';
import type { AiProviderType, LocalModelConfig, LocalModelInstallStatus, LocalModelState } from '../model-provider';

// Standalone AI setup screen. Goal: a near "one-click" connect flow per provider
// so users never need to understand API infrastructure — click connect, land on
// the exact external page, approve/copy, come back, paste/validate, done.
// BYOK keys are validated with a tiny probe and stored on-device only. Styled
// with the same design tokens as the other standalone pages (no CSS library).

const GEMINI_KEY_PAGE = 'https://aistudio.google.com/apikey';
const OPENROUTER_KEY_PAGE = 'https://openrouter.ai/settings/keys';

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

const disclosure: React.CSSProperties = { fontSize: 13, color: 'var(--fg-3)', margin: 0, lineHeight: 1.55 };

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
        whiteSpace: 'nowrap',
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

function ghostBtn(disabled = false): React.CSSProperties {
  return {
    fontFamily: 'var(--font-ui)',
    fontSize: 13,
    padding: '8px 14px',
    borderRadius: 'var(--radius-pill)',
    border: '1px solid var(--maestro-ink-3)',
    background: 'transparent',
    color: 'var(--fg-2)',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    textDecoration: 'none',
    display: 'inline-block',
  };
}

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
        ? '✓ Connected. Provider saved.'
        : v.message || 'Validation failed.';
  return <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color, margin: '6px 0 0' }}>{text}</p>;
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13, color: 'var(--fg-3)', lineHeight: 1.5 }}>
      <span
        style={{
          flex: '0 0 auto',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--evergreen-500)',
          border: '1px solid var(--maestro-ink-3)',
          borderRadius: 'var(--radius-pill)',
          padding: '0 7px',
        }}
      >
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
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
        gap: 12,
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

/** Human-readable status for the current provider config. */
function providerStatus(params: {
  type: AiProviderType;
  hasKey: boolean;
  error: string | null;
  localStatus?: LocalModelInstallStatus;
  localRuntimeReady?: boolean;
}): {
  label: string;
  tone: string;
} {
  if (params.error) return { label: 'Needs setup', tone: 'var(--sunset-500, #FF8B62)' };
  const warn = 'var(--sunset-500, #FF8B62)';
  switch (params.type) {
    case 'built_in':
      return { label: 'Ready', tone: 'var(--evergreen-500)' };
    case 'local_model':
      switch (params.localStatus) {
        case 'installed':
          return params.localRuntimeReady
            ? { label: 'Ready offline', tone: 'var(--evergreen-500)' }
            : { label: 'Installed · runtime not connected', tone: warn };
        case 'downloading':
          return { label: 'Downloading…', tone: 'var(--fg-3)' };
        case 'error':
          return { label: 'Download failed', tone: warn };
        case 'download_url_missing':
          return { label: 'Download URL not configured yet', tone: warn };
        default:
          return { label: 'Not downloaded yet', tone: warn };
      }
    case 'gemini_byok':
    case 'openrouter_byok':
      return params.hasKey
        ? { label: 'Connected', tone: 'var(--evergreen-500)' }
        : { label: 'Needs key', tone: warn };
    case 'custom':
      return { label: 'Connected', tone: 'var(--evergreen-500)' };
  }
}

export function AiSetupPage() {
  const { config, setAiProvider, clearAiProvider, activeModelProvider, providerError } = useAiProvider();
  const activeType: AiProviderType = config.type;

  // ── Gemini ─────────────────────────────────────────────────────────
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState<string>(DEFAULT_GEMINI_MODEL);
  const [geminiVal, setGeminiVal] = useState<Validation>(IDLE);
  const [geminiClipHint, setGeminiClipHint] = useState('');

  // ── OpenRouter ─────────────────────────────────────────────────────
  const [orKey, setOrKey] = useState('');
  const [orModel, setOrModel] = useState<string>(DEFAULT_OPENROUTER_FREE_MODEL);
  const [orVal, setOrVal] = useState<Validation>(IDLE);
  const [orClipHint, setOrClipHint] = useState('');
  const [orOAuth, setOrOAuth] = useState<Validation>(IDLE);

  // ── Custom (advanced) ──────────────────────────────────────────────
  const [showCustom, setShowCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [customVal, setCustomVal] = useState<Validation>(IDLE);

  // ── Test current provider ──────────────────────────────────────────
  const [testResult, setTestResult] = useState<Validation>(IDLE);

  // ── Local model download state (per model) ─────────────────────────
  // `models` starts from the static catalog and is overlaid with the approved
  // manifest (download URLs etc.) once it loads.
  const [models, setModels] = useState<LocalModelConfig[]>(() => LOCAL_MODEL_CATALOG.slice());
  const [localStates, setLocalStates] = useState<Record<string, LocalModelState>>({});
  const [runtimeReady, setRuntimeReady] = useState<Record<string, boolean>>({});
  const aborters = useRef<Record<string, AbortController>>({});

  // Load the controlled manifest, merge approved fields into the catalog, then
  // reconcile each model's persisted state with what's actually in storage.
  // Order matters: reconciliation must use the MERGED models so a configured
  // download URL correctly yields 'not_installed' rather than 'url missing'.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const manifest = await loadLocalModelManifest();
      if (cancelled) return;
      const merged = mergeManifestIntoCatalog({ manifest });
      setModels(merged);

      const ready: Record<string, boolean> = {};
      const entries: Record<string, LocalModelState> = {};
      for (const m of merged) {
        ready[m.id] = await localInferenceRuntime.isSupported({ modelId: m.id });
        const persisted = readLocalModelState({ modelId: m.id });
        let statusValue: LocalModelInstallStatus = effectiveInstallStatus({ model: m, state: persisted });
        // WebLLM models manage their own weights (no file in our storage) — trust
        // the persisted status. File-based models reconcile against IndexedDB.
        if (!m.webllmModelId) {
          const hasFile = await localModelStorage.hasModelFile({ modelId: m.id });
          if (hasFile) statusValue = 'installed';
          else if (statusValue === 'installed') statusValue = m.downloadUrl ? 'not_installed' : 'download_url_missing';
        }
        entries[m.id] = {
          modelId: m.id,
          status: statusValue,
          downloadedBytes: persisted?.downloadedBytes,
          totalBytes: persisted?.totalBytes,
          localPath: persisted?.localPath,
          errorMessage: persisted?.errorMessage,
          updatedAt: persisted?.updatedAt ?? '',
        };
      }
      if (!cancelled) {
        setRuntimeReady(ready);
        setLocalStates(entries);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const patchLocal = (modelId: string, patch: Partial<LocalModelState>) => {
    setLocalStates((prev) => {
      const base = prev[modelId] ?? { modelId, status: 'not_installed' as LocalModelInstallStatus, updatedAt: '' };
      return { ...prev, [modelId]: { ...base, ...patch } };
    });
  };

  // WebLLM models manage their own weights: "download" = warm up the runtime
  // (CreateMLCEngine), which fetches + caches the weights and reports progress.
  const warmUpLocalModel = async (model: LocalModelConfig) => {
    const totalBytes = Math.round(model.estimatedSizeMb * 1_000_000);
    patchLocal(model.id, { status: 'downloading', downloadedBytes: 0, totalBytes, errorMessage: undefined });
    writeLocalModelState({ state: { modelId: model.id, status: 'downloading', downloadedBytes: 0 } });
    try {
      await localInferenceRuntime.loadModel({
        modelId: model.id,
        onProgress: (p) =>
          patchLocal(model.id, {
            status: 'downloading',
            downloadedBytes: Math.round(p.progress * totalBytes),
            totalBytes,
          }),
      });
      patchLocal(model.id, { status: 'installed', downloadedBytes: totalBytes, totalBytes });
      writeLocalModelState({ state: { modelId: model.id, status: 'installed' } });
      setRuntimeReady((prev) => ({ ...prev, [model.id]: true }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Model load failed.';
      patchLocal(model.id, { status: 'error', errorMessage: message });
      writeLocalModelState({ state: { modelId: model.id, status: 'error', errorMessage: message } });
    }
  };

  const startDownload = async (model: LocalModelConfig) => {
    if (model.webllmModelId) {
      await warmUpLocalModel(model);
      return;
    }
    if (!model.downloadUrl) return;
    const controller = new AbortController();
    aborters.current[model.id] = controller;
    patchLocal(model.id, { status: 'downloading', downloadedBytes: 0, totalBytes: undefined, errorMessage: undefined });
    writeLocalModelState({ state: { modelId: model.id, status: 'downloading', downloadedBytes: 0 } });
    try {
      const result = await downloadLocalModel({
        model,
        signal: controller.signal,
        onProgress: (p) => patchLocal(model.id, { status: 'downloading', downloadedBytes: p.downloadedBytes, totalBytes: p.totalBytes }),
      });
      patchLocal(model.id, { status: 'installed', downloadedBytes: result.downloadedBytes, localPath: result.localPath });
      writeLocalModelState({
        state: { modelId: model.id, status: 'installed', downloadedBytes: result.downloadedBytes, localPath: result.localPath },
      });
    } catch (err) {
      if (controller.signal.aborted) {
        patchLocal(model.id, { status: 'not_installed', downloadedBytes: 0 });
        clearLocalModelState({ modelId: model.id });
      } else {
        const message = err instanceof Error ? err.message : 'Download failed.';
        patchLocal(model.id, { status: 'error', errorMessage: message });
        writeLocalModelState({ state: { modelId: model.id, status: 'error', errorMessage: message } });
      }
    } finally {
      delete aborters.current[model.id];
    }
  };

  const cancelDownload = (model: LocalModelConfig) => {
    aborters.current[model.id]?.abort();
  };

  const deleteDownload = async (model: LocalModelConfig) => {
    try {
      await localModelStorage.deleteModelFile({ modelId: model.id });
    } catch {
      // ignore — nothing to delete / storage unavailable
    }
    void localInferenceRuntime.unload();
    clearLocalModelState({ modelId: model.id });
    patchLocal(model.id, {
      status: model.downloadUrl || model.webllmModelId ? 'not_installed' : 'download_url_missing',
      downloadedBytes: 0,
      totalBytes: undefined,
      localPath: undefined,
      errorMessage: undefined,
    });
  };

  const localStatusOf = (model: LocalModelConfig): LocalModelInstallStatus =>
    localStates[model.id]?.status ?? effectiveInstallStatus({ model, state: null });

  // Complete an OpenRouter OAuth round-trip if we returned with ?code=...
  useEffect(() => {
    const code = readOAuthCodeFromUrl();
    if (!code) return;
    setOrOAuth({ status: 'validating', message: 'Completing OpenRouter sign-in…' });
    void (async () => {
      const exchanged = await exchangeOpenRouterCode({ code });
      clearOAuthCodeFromUrl();
      if (!exchanged.ok) {
        setOrOAuth({ status: 'invalid', message: exchanged.message });
        return;
      }
      const check = await validateOpenRouterKey({ apiKey: exchanged.key, model: orModel });
      if (check.ok) {
        setAiProvider({ type: 'openrouter_byok', apiKey: exchanged.key, model: orModel });
        setOrOAuth({ status: 'valid', message: '' });
      } else {
        setOrOAuth({ status: 'invalid', message: check.message });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Read the clipboard into a field; on failure, guide the user to paste manually. */
  const pasteFromClipboard = async (
    setKey: (v: string) => void,
    setHint: (v: string) => void,
  ) => {
    setHint('');
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        setKey(text.trim());
        setHint('Pasted from clipboard.');
      } else {
        setHint('Clipboard was empty — paste your key into the field below.');
      }
    } catch {
      setHint('Clipboard access was blocked — paste your key into the field below.');
    }
  };

  const connectGemini = async () => {
    const apiKey = geminiKey.trim();
    if (!apiKey) return;
    setGeminiVal({ status: 'validating', message: '' });
    const result = await validateGeminiKey({ apiKey, model: geminiModel });
    if (result.ok) {
      setAiProvider({ type: 'gemini_byok', apiKey, model: geminiModel });
      setGeminiVal({ status: 'valid', message: '' });
      setGeminiKey('');
      setGeminiClipHint('');
    } else {
      setGeminiVal({ status: 'invalid', message: result.message });
    }
  };

  const connectOpenRouterManual = async () => {
    const apiKey = orKey.trim();
    if (!apiKey) return;
    setOrVal({ status: 'validating', message: '' });
    const result = await validateOpenRouterKey({ apiKey, model: orModel });
    if (result.ok) {
      setAiProvider({ type: 'openrouter_byok', apiKey, model: orModel });
      setOrVal({ status: 'valid', message: '' });
      setOrKey('');
      setOrClipHint('');
    } else {
      setOrVal({ status: 'invalid', message: result.message });
    }
  };

  const connectOpenRouterOAuth = async () => {
    setOrOAuth({ status: 'validating', message: 'Redirecting to OpenRouter…' });
    try {
      const url = await buildOpenRouterAuthUrl();
      window.location.href = url;
    } catch {
      setOrOAuth({ status: 'invalid', message: 'Could not start OpenRouter sign-in. Try the manual key option below.' });
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

  const testCurrentProvider = async () => {
    if (!activeModelProvider) {
      setTestResult({ status: 'invalid', message: providerError ?? 'No provider is configured.' });
      return;
    }
    setTestResult({ status: 'validating', message: '' });
    try {
      const reply = await activeModelProvider.generateText({
        prompt: 'Reply with the single word OK.',
        system: 'You are a connectivity test. Answer briefly.',
      });
      setTestResult({
        status: 'valid',
        message: `✓ ${config.displayName} responded (${reply.trim().slice(0, 40) || 'ok'}).`,
      });
    } catch (err) {
      // Safe message only — provider errors never include the key.
      setTestResult({ status: 'invalid', message: err instanceof Error ? err.message : 'Test failed.' });
    }
  };

  const status = providerStatus({
    type: activeType,
    hasKey: Boolean(config.apiKey),
    error: providerError,
    localStatus: activeType === 'local_model' ? localStates[config.model ?? '']?.status : undefined,
    localRuntimeReady: activeType === 'local_model' ? runtimeReady[config.model ?? ''] : undefined,
  });

  // Status-bar labels: show the provider category and a human model name.
  const providerLabel = activeType === 'local_model' ? 'Local model' : config.displayName;
  const modelLabel =
    activeType === 'local_model'
      ? getLocalModelById({ id: config.model ?? '' })?.displayName ?? config.model ?? '—'
      : config.model ?? '—';

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
            Click connect, approve or copy your key on the provider's page, come back, and you're done. No infrastructure
            knowledge needed.
          </p>
        </header>

        {/* ── Provider status bar ── */}
        <section
          style={{
            border: '1px solid var(--maestro-ink-3)',
            borderRadius: 12,
            padding: 16,
            background: 'var(--bg-surface)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px 20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={labelStyle}>Current provider</span>
              <span style={{ fontSize: 14, color: 'var(--fg-1)' }}>{providerLabel}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={labelStyle}>Model</span>
              <span style={{ fontSize: 14, color: 'var(--fg-2)' }}>{modelLabel}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={labelStyle}>Status</span>
              <span style={{ fontSize: 14, color: status.tone }}>● {status.label}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              style={ghostBtn(testResult.status === 'validating')}
              disabled={testResult.status === 'validating'}
              onClick={() => void testCurrentProvider()}
            >
              {testResult.status === 'validating' ? 'Testing…' : 'Test current provider'}
            </button>
            <button type="button" style={ghostBtn()} onClick={clearAiProvider}>
              Reset to built-in
            </button>
            <Link to="/tutor-demo" style={{ color: 'var(--evergreen-500)', fontSize: 13 }}>
              Try the tutor →
            </Link>
          </div>
          {testResult.status !== 'idle' && testResult.status !== 'validating' && (
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                margin: 0,
                color: testResult.status === 'valid' ? 'var(--evergreen-500)' : 'var(--sunset-500, #FF8B62)',
              }}
            >
              {testResult.message}
            </p>
          )}
        </section>

        {/* ── Built-in ── */}
        <Card title="Use built-in AI" badge={{ text: 'Recommended', tone: 'var(--evergreen-500)' }} active={activeType === 'built_in'}>
          <p style={disclosure}>Start learning immediately. Limited free usage. Best for trying things out right away.</p>
          <div>
            <button type="button" style={primaryBtn(activeType === 'built_in')} disabled={activeType === 'built_in'} onClick={() => setAiProvider({ type: 'built_in' })}>
              {activeType === 'built_in' ? 'Selected' : 'Use built-in AI'}
            </button>
          </div>
        </Card>

        {/* ── Gemini (guided BYOK) ── */}
        <Card title="Connect Gemini" badge={{ text: 'Free', tone: 'var(--lavender-500, #B9A7FF)' }} active={activeType === 'gemini_byok'}>
          <p style={disclosure}>
            Use your own Gemini API key and free quota. Usage is counted by Google, not by us. Your key stays on this
            device and you can delete it anytime.
          </p>
          <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Step n={1}>Open the Gemini API key page and sign in with Google.</Step>
            <Step n={2}>Create or select an API key, then copy it.</Step>
            <Step n={3}>Come back here and click <strong>Paste from clipboard</strong>.</Step>
            <Step n={4}>Click <strong>Validate &amp; connect</strong>.</Step>
          </ol>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a href={GEMINI_KEY_PAGE} target="_blank" rel="noopener noreferrer" style={primaryBtn(false)}>
              Open Gemini key page ↗
            </a>
            <button type="button" style={ghostBtn()} onClick={() => void pasteFromClipboard(setGeminiKey, setGeminiClipHint)}>
              Paste from clipboard
            </button>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>Gemini API key</span>
            <input
              type="password"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder="Paste your Gemini API key (or use the button above)"
              style={field}
              autoComplete="off"
            />
          </label>
          {geminiClipHint && <p style={{ ...disclosure, fontSize: 12, margin: 0 }}>{geminiClipHint}</p>}
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
              Validate &amp; connect
            </button>
          </div>
          <ValidationLine v={geminiVal} />
        </Card>

        {/* ── OpenRouter (OAuth primary + manual fallback) ── */}
        <Card title="Connect OpenRouter" badge={{ text: 'Free', tone: 'var(--lavender-500, #B9A7FF)' }} active={activeType === 'openrouter_byok'}>
          <p style={disclosure}>
            Access many models (some free) with your own OpenRouter account. Usage is counted against your account. The
            fastest way is one-click sign-in — you approve on OpenRouter and we receive a key you control.
          </p>
          <div>
            <button type="button" style={primaryBtn(orOAuth.status === 'validating')} disabled={orOAuth.status === 'validating'} onClick={() => void connectOpenRouterOAuth()}>
              {orOAuth.status === 'validating' ? 'Connecting…' : 'Connect with OpenRouter (1-click) ↗'}
            </button>
          </div>
          <ValidationLine v={orOAuth} />

          <details>
            <summary style={{ ...labelStyle, cursor: 'pointer', color: 'var(--fg-3)' }}>Or connect with a key manually</summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
              <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Step n={1}>Open the OpenRouter keys page and sign in (or create an account).</Step>
                <Step n={2}>Create an API key and copy it.</Step>
                <Step n={3}>Come back, paste it, and click <strong>Validate &amp; connect</strong>.</Step>
              </ol>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a href={OPENROUTER_KEY_PAGE} target="_blank" rel="noopener noreferrer" style={ghostBtn()}>
                  Open OpenRouter keys page ↗
                </a>
                <button type="button" style={ghostBtn()} onClick={() => void pasteFromClipboard(setOrKey, setOrClipHint)}>
                  Paste from clipboard
                </button>
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={labelStyle}>OpenRouter API key</span>
                <input type="password" value={orKey} onChange={(e) => setOrKey(e.target.value)} placeholder="Paste your OpenRouter API key" style={field} autoComplete="off" />
              </label>
              {orClipHint && <p style={{ ...disclosure, fontSize: 12, margin: 0 }}>{orClipHint}</p>}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={labelStyle}>Model</span>
                <input value={orModel} onChange={(e) => setOrModel(e.target.value)} placeholder={DEFAULT_OPENROUTER_FREE_MODEL} style={field} />
              </label>
              <div>
                <button
                  type="button"
                  style={primaryBtn(!orKey.trim() || orVal.status === 'validating')}
                  disabled={!orKey.trim() || orVal.status === 'validating'}
                  onClick={() => void connectOpenRouterManual()}
                >
                  Validate &amp; connect
                </button>
              </div>
              <ValidationLine v={orVal} />
            </div>
          </details>
        </Card>

        {/* ── Local model (download + runtime pending) ── */}
        <Card title="Offline model" badge={{ text: 'Offline', tone: 'var(--sunset-500, #FF8B62)' }} active={activeType === 'local_model'}>
          <p style={disclosure}>
            Download a model to your device and run the tutor fully offline via WebGPU (WebLLM). The first download is
            large (~1.5–2.2 GB) and cached in your browser; it requires a recent Chrome or Edge with WebGPU. After that,
            responses are generated on-device — nothing leaves your machine.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
            {models.map((m) => {
              const selected = activeType === 'local_model' && config.model === m.id;
              const st = localStates[m.id];
              const status = localStatusOf(m);
              const doneMb = Math.round((st?.downloadedBytes ?? 0) / 1_000_000);
              const totalMb = st?.totalBytes ? Math.round(st.totalBytes / 1_000_000) : Math.round(m.estimatedSizeMb);
              const percent = st?.totalBytes ? Math.min(100, Math.round(((st.downloadedBytes ?? 0) / st.totalBytes) * 100)) : undefined;
              const ready = runtimeReady[m.id] === true;
              const badge =
                status === 'installed'
                  ? ready
                    ? { text: 'Ready offline', tone: 'var(--evergreen-500)' }
                    : { text: 'Downloaded', tone: 'var(--evergreen-500)' }
                  : status === 'downloading'
                    ? { text: 'Downloading', tone: 'var(--fg-3)' }
                    : status === 'error'
                      ? { text: 'Download failed', tone: 'var(--sunset-500, #FF8B62)' }
                      : status === 'download_url_missing'
                        ? { text: 'URL not configured', tone: 'var(--fg-3)' }
                        : { text: 'Not installed', tone: 'var(--fg-3)' };
              return (
                <div
                  key={m.id}
                  style={{
                    border: `1px solid ${selected ? 'var(--evergreen-500)' : 'var(--maestro-ink-3)'}`,
                    borderRadius: 10,
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 14, color: 'var(--fg-1)' }}>{m.shortLabel}</span>
                    <Badge text={badge.text} tone={badge.tone} />
                  </div>
                  <span style={{ fontSize: 13, color: 'var(--fg-2)' }}>{m.displayName}</span>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: 'var(--fg-3)' }}>
                    <li>~{(m.estimatedSizeMb / 1000).toFixed(1)} GB download</li>
                    <li>Recommended RAM: {m.minRamGb}–{m.recommendedRamGb} GB</li>
                    <li>Works offline: yes</li>
                    <li>{m.qualityLabel} · {m.description}</li>
                  </ul>

                  {/* Download state area */}
                  {status === 'download_url_missing' && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" style={ghostBtn(true)} disabled title="No official model file URL is configured yet">
                        Download URL not configured yet
                      </button>
                      <button
                        type="button"
                        style={ghostBtn(selected)}
                        disabled={selected}
                        onClick={() => setAiProvider({ type: 'local_model', model: m.id, displayName: m.displayName })}
                      >
                        {selected ? 'Selected' : 'Select'}
                      </button>
                    </div>
                  )}

                  {status === 'downloading' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-2)' }}>
                        Downloading… {percent !== undefined ? `${percent}%` : ''}
                      </span>
                      <div style={{ height: 6, borderRadius: 999, background: 'var(--maestro-ink-3)', overflow: 'hidden' }}>
                        <div style={{ width: `${percent ?? 8}%`, height: '100%', background: 'var(--evergreen-500)', transition: 'width var(--anim-fast, 120ms)' }} />
                      </div>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
                        {doneMb}MB / {totalMb}MB
                      </span>
                      <div>
                        <button type="button" style={ghostBtn()} onClick={() => cancelDownload(m)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {status === 'error' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--sunset-500, #FF8B62)' }}>
                        {st?.errorMessage ?? 'Download failed.'}
                      </span>
                      <div>
                        <button type="button" style={primaryBtn(false)} onClick={() => void startDownload(m)}>
                          Retry
                        </button>
                      </div>
                    </div>
                  )}

                  {status === 'installed' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: ready ? 'var(--evergreen-500)' : 'var(--fg-3)' }}>
                        {ready ? 'Ready offline' : 'Downloaded · runtime not connected yet'}
                      </span>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          style={primaryBtn(selected)}
                          disabled={selected}
                          onClick={() => setAiProvider({ type: 'local_model', model: m.id, displayName: m.displayName })}
                        >
                          {selected ? 'Selected' : 'Use this model'}
                        </button>
                        <button type="button" style={ghostBtn()} onClick={() => void deleteDownload(m)}>
                          Delete download
                        </button>
                      </div>
                    </div>
                  )}

                  {status === 'not_installed' && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" style={primaryBtn(false)} onClick={() => void startDownload(m)}>
                        Download model (~{(m.estimatedSizeMb / 1000).toFixed(1)} GB)
                      </button>
                      <button
                        type="button"
                        style={ghostBtn(selected)}
                        disabled={selected}
                        onClick={() => setAiProvider({ type: 'local_model', model: m.id, displayName: m.displayName })}
                      >
                        {selected ? 'Selected' : 'Select'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {/* ── Custom (advanced) ── */}
        <Card title="Custom provider" badge={{ text: 'Advanced', tone: 'var(--fg-3)' }} active={activeType === 'custom'}>
          <button type="button" style={ghostBtn()} onClick={() => setShowCustom((v) => !v)}>
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
                <button type="button" style={primaryBtn(customVal.status === 'validating')} disabled={customVal.status === 'validating'} onClick={() => void connectCustom()}>
                  Validate &amp; connect
                </button>
              </div>
              <ValidationLine v={customVal} />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
