import { useMemo, useState } from 'react';
import { getPrebuiltCourses } from '../course-package';
import type { CoursePackage, LearningUnit } from '../course-package/course-package.types';
import { useAiProvider } from '../contexts/AiProviderContext';
import { DEFAULT_FREEDOM_MODE, runTutorTurn } from '../tutor-runtime';
import type { TutorTurnDebug } from '../tutor-runtime';

// Minimal STANDALONE lesson demo. Deliberately additive and separate from the
// complex app UI (no AppShell/Sidebar/Dashboard). It reuses the existing
// CoursePackage registry, the MockProvider, and the real Tutor Runtime
// (runTutorTurn → buildTutorContext → buildTutorPrompt → provider.generateText).
// No teaching logic and no product polish live here — it is a plain, readable
// three-step flow: pick a course → pick a unit → chat with the tutor.

interface ChatMessage {
  role: 'user' | 'tutor';
  text: string;
}

// Bare-bones styling using existing CSS variables where handy. Intentionally
// not polished — just readable.
const page: React.CSSProperties = {
  minHeight: '100vh',
  background: 'var(--bg-page, #111)',
  color: 'var(--fg-1, #eee)',
  fontFamily: 'var(--font-text, system-ui, sans-serif)',
};
const wrap: React.CSSProperties = {
  maxWidth: 760,
  margin: '0 auto',
  padding: '24px 16px 64px',
};
const card: React.CSSProperties = {
  border: '1px solid var(--maestro-ink-3, #333)',
  borderRadius: 8,
  padding: 16,
  marginBottom: 12,
  background: 'var(--bg-surface, #1a1a1a)',
};
const btn: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 14,
  padding: '8px 14px',
  borderRadius: 6,
  border: '1px solid var(--maestro-ink-3, #444)',
  background: 'var(--evergreen-500, #2e7d5b)',
  color: 'var(--evergreen-900, #fff)',
  cursor: 'pointer',
};
const linkBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--evergreen-500, #4caf82)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 13,
  padding: 0,
};
const input: React.CSSProperties = {
  flex: 1,
  fontFamily: 'inherit',
  fontSize: 14,
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--maestro-ink-3, #444)',
  background: 'var(--maestro-ink-2, #222)',
  color: 'inherit',
};

export function SimpleLessonDemoPage() {
  const courses = useMemo(() => getPrebuiltCourses(), []);
  const { activeModelProvider, providerError } = useAiProvider();

  const [course, setCourse] = useState<CoursePackage | null>(null);
  const [unit, setUnit] = useState<LearningUnit | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<TutorTurnDebug | null>(null);

  const resetToCourses = () => {
    setCourse(null);
    setUnit(null);
    setChat([]);
    setError(null);
    setDebug(null);
  };

  const resetToUnits = () => {
    setUnit(null);
    setChat([]);
    setError(null);
    setDebug(null);
  };

  const send = async () => {
    const text = message.trim();
    if (!course || !unit || !text || loading) return;

    // Use the provider selected in AI setup. No silent mock fallback: if it
    // can't be built (e.g. missing key), surface the reason. The mock is only
    // ever used when Built-in is selected (AiProviderContext maps it there).
    if (!activeModelProvider) {
      setError(providerError ?? 'No AI provider is ready. Open AI setup to connect one.');
      return;
    }
    const provider = activeModelProvider;

    setChat((prev) => [...prev, { role: 'user', text }]);
    setMessage('');
    setLoading(true);
    setError(null);
    try {
      const result = await runTutorTurn({
        coursePackage: course,
        unitId: unit.id,
        userMessage: text,
        provider,
        freedomMode: DEFAULT_FREEDOM_MODE, // default: guided
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
    <div data-theme="dark" style={page}>
      <div style={wrap}>
        <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>Simple Lesson Demo</h1>
        <p style={{ fontSize: 13, color: 'var(--fg-3, #999)', margin: '0 0 20px' }}>
          Minimal standalone demo of prebuilt courses + the Tutor Runtime (MockProvider).
          The full app lives at <a href="/" style={{ color: 'var(--evergreen-500, #4caf82)' }}>/</a>.
        </p>

        {/* Step 1 — Course selection */}
        {!course && (
          <section>
            <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>1 · Choose a course</h2>
            {courses.length === 0 && <p>No prebuilt courses found.</p>}
            {courses.map((c) => (
              <div key={c.id} style={card}>
                <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>{c.title}</h3>
                {c.description && (
                  <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--fg-3, #999)' }}>
                    {c.description}
                  </p>
                )}
                <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--fg-3, #999)' }}>
                  {c.units.length} unit{c.units.length === 1 ? '' : 's'}
                </p>
                <button type="button" style={btn} onClick={() => setCourse(c)}>
                  Open course
                </button>
              </div>
            ))}
          </section>
        )}

        {/* Step 2 — Unit selection */}
        {course && !unit && (
          <section>
            <button type="button" style={{ ...linkBtn, marginBottom: 12 }} onClick={resetToCourses}>
              ← All courses
            </button>
            <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>2 · {course.title}</h2>
            <p style={{ fontSize: 13, color: 'var(--fg-3, #999)', margin: '0 0 12px' }}>
              Choose a learning unit
            </p>
            {course.units.length === 0 && <p>This course has no units.</p>}
            {[...course.units]
              .sort((a, b) => a.order - b.order)
              .map((u) => (
                <div key={u.id} style={card}>
                  <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>
                    {u.order}. {u.title}
                  </h3>
                  {u.goal && (
                    <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--fg-3, #999)' }}>
                      {u.goal}
                    </p>
                  )}
                  <button type="button" style={btn} onClick={() => setUnit(u)}>
                    Start lesson
                  </button>
                </div>
              ))}
          </section>
        )}

        {/* Step 3 — Lesson screen */}
        {course && unit && (
          <section>
            <button type="button" style={{ ...linkBtn, marginBottom: 12 }} onClick={resetToUnits}>
              ← Units in {course.title}
            </button>
            <h2 style={{ fontSize: 16, margin: '0 0 2px' }}>{course.title}</h2>
            <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>
              {unit.order}. {unit.title}
            </h3>
            {unit.goal && (
              <p style={{ fontSize: 13, color: 'var(--fg-3, #999)', margin: '0 0 16px' }}>
                Goal: {unit.goal}
              </p>
            )}

            {/* Chat area */}
            <div style={{ ...card, minHeight: 160, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {chat.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--fg-3, #999)', margin: 0 }}>
                  Ask the tutor something to get started.
                </p>
              )}
              {chat.map((m, i) => (
                <div key={i}>
                  <div style={{ fontSize: 11, color: 'var(--fg-3, #999)', marginBottom: 2 }}>
                    {m.role === 'user' ? 'You' : 'Tutor'}
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.text}</div>
                </div>
              ))}
              {loading && (
                <p style={{ fontSize: 13, color: 'var(--fg-3, #999)', margin: 0 }}>Tutor is thinking…</p>
              )}
            </div>

            {/* Composer */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <input
                style={input}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="Type a message…"
              />
              <button
                type="button"
                style={{ ...btn, opacity: loading || !message.trim() ? 0.6 : 1 }}
                disabled={loading || !message.trim()}
                onClick={() => void send()}
              >
                Send
              </button>
            </div>

            {error && (
              <p style={{ fontSize: 13, color: 'var(--sunset-500, #ff8b62)', marginTop: 12 }}>{error}</p>
            )}

            {/* Optional minimal debug */}
            <details style={{ marginTop: 20, fontSize: 12, color: 'var(--fg-3, #999)' }}>
              <summary style={{ cursor: 'pointer' }}>Debug</summary>
              <div style={{ fontFamily: 'var(--font-mono, monospace)', marginTop: 8, lineHeight: 1.7 }}>
                <div>course id: {course.id}</div>
                <div>unit id: {unit.id}</div>
                <div>freedom mode: {debug?.freedomMode ?? DEFAULT_FREEDOM_MODE}</div>
                <div>provider: {debug?.provider ?? 'mock'}</div>
                <div>
                  KB chunk ids:{' '}
                  {debug ? (debug.kbChunkIds.length ? debug.kbChunkIds.join(', ') : 'none') : '—'}
                </div>
              </div>
            </details>
          </section>
        )}
      </div>
    </div>
  );
}
