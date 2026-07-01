// ── LessonChat — presentational lesson chat ──────────────────────────
//
// Pure UI: a transcript, an input, and a friendly error banner. It knows nothing
// about providers — it only calls `onSend`, which the hook wires to the active
// provider. `onSend` resolves true on success so the input clears only when the
// turn actually went through (a failed turn keeps the learner's text).

import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { LessonMessage } from '../lesson-runtime';

const CARD: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--maestro-ink-3)',
  borderRadius: 'var(--radius-l)',
  padding: 16,
};

const DANGER = 'var(--sunset-500, #FF8B62)';

interface LessonChatProps {
  messages: LessonMessage[];
  loading: boolean;
  error: string | null;
  onDismissError: () => void;
  onSend: (text: string) => Promise<boolean>;
  /** When false, input is disabled and a setup hint is shown. */
  providerReady: boolean;
  /** When true, the lesson is finished — show a done state instead of input. */
  completed: boolean;
}

export function LessonChat({
  messages,
  loading,
  error,
  onDismissError,
  onSend,
  providerReady,
  completed,
}: LessonChatProps) {
  const [text, setText] = useState('');

  const submit = async () => {
    if (!text.trim() || loading) return;
    const ok = await onSend(text);
    if (ok) setText('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Transcript */}
      <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 200 }}>
        {messages.length === 0 && (
          <p style={{ fontFamily: 'var(--font-text)', fontSize: 13, lineHeight: 1.5, color: 'var(--fg-3)', margin: 0 }}>
            Say hello or answer the question above to begin. The tutor teaches one step at a time.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === 'student' ? 'flex-end' : 'flex-start',
              maxWidth: '86%',
              background: m.role === 'student' ? 'var(--maestro-ink-3)' : 'var(--maestro-ink-2)',
              border: '1px solid var(--maestro-ink-3)',
              borderRadius: 'var(--radius-m)',
              padding: '10px 12px',
            }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>
              {m.role === 'student' ? 'You' : 'Tutor'}
            </span>
            <p style={{ fontFamily: 'var(--font-text)', fontSize: 14, lineHeight: 1.6, color: 'var(--fg-2)', margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>
              {m.content}
            </p>
          </div>
        ))}
        {loading && (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-3)', margin: 0 }}>Tutor is thinking…</p>
        )}
      </div>

      {/* Friendly error banner */}
      {error && (
        <div style={{ ...CARD, borderColor: DANGER, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontFamily: 'var(--font-text)', fontSize: 13, lineHeight: 1.5, color: 'var(--fg-2)', margin: 0 }}>{error}</p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Link
              to="/ai-setup"
              style={{ fontFamily: 'var(--font-ui)', fontSize: 13, padding: '6px 14px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--maestro-ink-3)', color: 'var(--fg-2)', textDecoration: 'none' }}
            >
              Open AI setup
            </Link>
            <button
              type="button"
              onClick={onDismissError}
              style={{ background: 'transparent', border: 'none', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 12, cursor: 'pointer', padding: 0 }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Input / done state */}
      {completed ? (
        <div style={{ ...CARD, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: 'var(--evergreen-500)' }}>✓ Lesson complete</span>
          <span style={{ fontFamily: 'var(--font-text)', fontSize: 13, color: 'var(--fg-3)' }}>Nice work — pick another lesson to keep going.</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!providerReady && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: DANGER, margin: 0 }}>
              No AI provider is ready. <Link to="/ai-setup" style={{ color: 'var(--fg-2)' }}>Open AI setup</Link> to connect one.
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={2}
              placeholder="Type your answer or question…"
              disabled={!providerReady || loading}
              style={{ flex: 1, boxSizing: 'border-box', resize: 'vertical', background: 'var(--maestro-ink-2)', border: '1px solid var(--maestro-ink-3)', borderRadius: 'var(--radius-m)', padding: '10px 12px', color: 'var(--fg-1)', fontFamily: 'var(--font-text)', fontSize: 14, lineHeight: 1.5, opacity: !providerReady ? 0.6 : 1 }}
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!providerReady || loading || !text.trim()}
              style={{ fontFamily: 'var(--font-ui)', fontSize: 14, padding: '10px 18px', borderRadius: 'var(--radius-pill)', border: '1px solid transparent', cursor: loading ? 'default' : 'pointer', background: 'var(--evergreen-500)', color: 'var(--evergreen-900)', opacity: !providerReady || loading || !text.trim() ? 0.6 : 1, whiteSpace: 'nowrap' }}
            >
              {loading ? 'Thinking…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
