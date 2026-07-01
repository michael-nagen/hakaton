import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getPrebuiltCourses,
  getPrebuiltCourseById,
} from '../course-package';
import { useAiProvider } from '../contexts/AiProviderContext';
import { FREEDOM_MODES, DEFAULT_FREEDOM_MODE, runTutorTurn } from '../tutor-runtime';
import type { FreedomMode, TutorTurnDebug } from '../tutor-runtime';

// Minimal STANDALONE demo/test harness for the existing Tutor Runtime.
// It is intentionally separate from the complex app UI (its own /tutor-demo
// route, no shell chrome) and reuses the real runtime + CoursePackage logic
// via the runTutorTurn adapter. No teaching logic lives here.

interface ChatTurn {
  role: 'user' | 'tutor';
  text: string;
}

const field: React.CSSProperties = {
  background: 'var(--maestro-ink-2)',
  border: '1px solid var(--maestro-ink-3)',
  borderRadius: 8,
  padding: '8px 10px',
  color: 'var(--fg-1)',
  fontFamily: 'var(--font-text)',
  fontSize: 14,
};

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--fg-3)',
};

export function TutorDemoPage() {
  const courses = useMemo(() => getPrebuiltCourses(), []);
  const { config, activeModelProvider, providerError } = useAiProvider();

  const [courseId, setCourseId] = useState(courses[0]?.id ?? '');
  const course = getPrebuiltCourseById({ courseId });
  const [unitId, setUnitId] = useState(course?.units[0]?.id ?? '');
  const [freedomMode, setFreedomMode] = useState<FreedomMode>(DEFAULT_FREEDOM_MODE);

  const [input, setInput] = useState('I am new to this — where should I start?');
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [debug, setDebug] = useState<TutorTurnDebug | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCourseChange = (id: string) => {
    setCourseId(id);
    const first = getPrebuiltCourseById({ courseId: id })?.units[0]?.id ?? '';
    setUnitId(first);
    setChat([]);
    setDebug(null);
    setError(null);
  };

  const onUnitChange = (id: string) => {
    setUnitId(id);
    setChat([]);
    setDebug(null);
    setError(null);
  };

  const send = async () => {
    const message = input.trim();
    if (!course || !unitId || !message || loading) return;
    // Route through the provider selected in AI setup. No silent mock fallback:
    // if it can't be built (e.g. missing key), surface the reason. The mock is
    // only ever used when Built-in is selected (AiProviderContext maps it there).
    if (!activeModelProvider) {
      setError(providerError ?? 'No AI provider is ready. Open AI setup to connect one.');
      return;
    }
    const provider = activeModelProvider;

    setChat((prev) => [...prev, { role: 'user', text: message }]);
    setInput('');
    setLoading(true);
    setError(null);
    try {
      const result = await runTutorTurn({
        coursePackage: course,
        unitId,
        userMessage: message,
        provider,
        freedomMode,
      });
      setChat((prev) => [...prev, { role: 'tutor', text: result.answer }]);
      setDebug(result.debug);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      data-theme="dark"
      style={{ minHeight: '100vh', background: 'var(--bg-page)', color: 'var(--fg-1)', fontFamily: 'var(--font-text)' }}
    >
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 20px 80px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <header>
          <p style={{ ...labelStyle, margin: '0 0 6px' }}>Tutor Runtime · demo harness</p>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, margin: 0, color: 'var(--fg-2)' }}>
            Runtime Demo
          </h1>
          <p style={{ fontSize: 13, color: 'var(--fg-3)', margin: '8px 0 0' }}>
            Standalone test page for the existing Tutor Runtime. Complex app lives at{' '}
            <a href="/" style={{ color: 'var(--evergreen-500)' }}>/</a>.
          </p>
        </header>

        {/* Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>Course</span>
            <select value={courseId} onChange={(e) => onCourseChange(e.target.value)} style={field}>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>Unit</span>
            <select value={unitId} onChange={(e) => onUnitChange(e.target.value)} style={field}>
              {course?.units.map((u) => (
                <option key={u.id} value={u.id}>{u.order}. {u.title}</option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>Provider</span>
            <div style={{ ...field, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {config.displayName}
              </span>
              <Link to="/ai-setup" style={{ color: 'var(--evergreen-500)', fontSize: 12, whiteSpace: 'nowrap' }}>
                change
              </Link>
            </div>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>Freedom mode</span>
            <select value={freedomMode} onChange={(e) => setFreedomMode(e.target.value as FreedomMode)} style={field}>
              {FREEDOM_MODES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Chat transcript */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 120, border: '1px solid var(--maestro-ink-3)', borderRadius: 12, padding: 16, background: 'var(--bg-surface)' }}>
          {chat.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--fg-3)', margin: 0 }}>
              Ask the tutor a question about the selected unit. Switching course or unit clears the conversation.
            </p>
          )}
          {chat.map((turn, i) => (
            <div key={i} style={{ alignSelf: turn.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
              <p style={{ ...labelStyle, margin: '0 0 3px', textAlign: turn.role === 'user' ? 'right' : 'left' }}>
                {turn.role === 'user' ? 'You' : 'Tutor'}
              </p>
              <div style={{
                background: turn.role === 'user' ? 'var(--maestro-ink-3)' : 'var(--maestro-ink-2)',
                border: '1px solid var(--maestro-ink-3)', borderRadius: 10, padding: '10px 12px',
                fontSize: 14, lineHeight: 1.55, color: 'var(--fg-2)', whiteSpace: 'pre-wrap',
              }}>
                {turn.text}
              </div>
            </div>
          ))}
          {loading && <p style={{ fontSize: 13, color: 'var(--fg-3)', margin: 0 }}>Tutor is thinking…</p>}
        </div>

        {/* Composer */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
            rows={2}
            placeholder="Type a message… (Enter to send, Shift+Enter for a new line)"
            style={{ ...field, flex: 1, resize: 'vertical', lineHeight: 1.5 }}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={loading || !input.trim()}
            style={{ fontFamily: 'var(--font-ui)', fontSize: 14, padding: '10px 20px', borderRadius: 'var(--radius-pill)', border: '1px solid transparent', cursor: loading ? 'default' : 'pointer', background: 'var(--evergreen-500)', color: 'var(--evergreen-900)', opacity: loading || !input.trim() ? 0.6 : 1 }}
          >
            Send
          </button>
        </div>

        {error && <p style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--sunset-500, #FF8B62)', margin: 0 }}>{error}</p>}
        {providerError && !error && (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-3)', margin: 0 }}>
            {providerError} Using the offline mock until you finish setup in{' '}
            <Link to="/ai-setup" style={{ color: 'var(--evergreen-500)' }}>AI setup</Link>.
          </p>
        )}

        {/* Debug panel */}
        {debug && (
          <div style={{ border: '1px solid var(--maestro-ink-3)', borderRadius: 12, padding: 16, background: 'var(--bg-surface)' }}>
            <p style={{ ...labelStyle, margin: '0 0 12px' }}>Debug · last turn</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px 24px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              <DebugRow label="Provider" value={debug.provider} />
              <DebugRow label="Model name" value={debug.modelName ?? 'n/a'} />
              <DebugRow label="Latency" value={`${debug.latencyMs} ms`} />
              <DebugRow label="Unit" value={debug.unit.title} />
              <DebugRow label="Freedom mode" value={debug.freedomMode} />
              <DebugRow label="Action" value={debug.action ?? 'n/a'} />
              <DebugRow label="JSON parse" value={debug.jsonParse} />
              <DebugRow
                label={`KB chunks sent (${debug.kbChunkIds.length})`}
                value={debug.kbChunkIds.length ? debug.kbChunkIds.join(', ') : 'none'}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <span style={{ color: 'var(--fg-3)' }}>{label}</span>
      <span style={{ color: 'var(--fg-2)', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}
