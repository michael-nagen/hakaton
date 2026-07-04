// ── LessonChat — presentational lesson chat ──────────────────────────
//
// Pure UI: a transcript, an input, and a friendly error banner. It knows nothing
// about providers — it only calls `onSend`, which the hook wires to the active
// provider. `onSend` resolves true on success so the input clears only when the
// turn actually went through (a failed turn keeps the learner's text).

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LessonMessage } from '../lesson-runtime';
import type { ChatLessonCard, ChatMcqView } from '../hooks/useDeterministicChat';

/** A chat message that may carry a prepared MCQ and/or lesson card (deterministic flow only). */
export type ChatMessage = LessonMessage & { mcq?: ChatMcqView; card?: ChatLessonCard };

const SECTION_LABEL: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--fg-3)',
  margin: '0 0 4px',
};

/** Render text as spaced paragraphs, splitting on blank lines so long explanations don't read as one dense block. */
function Paragraphs({ text, style }: { text: string; style: React.CSSProperties }) {
  const parts = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {parts.map((p, i) => (
        <p key={i} style={{ ...style, margin: 0, whiteSpace: 'pre-wrap' }}>{p}</p>
      ))}
    </div>
  );
}

/** Renders a prepared "mini lesson" card: title + labelled sections + code block. */
function LessonCardBlock({ card }: { card: ChatLessonCard }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {(card.eyebrow || card.title) && (
        <div>
          {card.eyebrow && <p style={SECTION_LABEL}>{card.eyebrow}</p>}
          {card.title && (
            <p style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, lineHeight: 1.25, color: 'var(--fg-1)', margin: 0 }}>{card.title}</p>
          )}
        </div>
      )}
      <div>
        {card.bodyLabel && <p style={SECTION_LABEL}>{card.bodyLabel}</p>}
        <Paragraphs text={card.body} style={{ fontFamily: 'var(--font-text)', fontSize: 14, lineHeight: 1.6, color: 'var(--fg-2)' }} />
      </div>
      {card.example && (
        <div>
          <p style={SECTION_LABEL}>Example</p>
          <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.55, color: 'var(--fg-1)', background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 'var(--radius-m)', padding: '10px 12px', margin: 0, whiteSpace: 'pre-wrap', overflowX: 'auto' }}>{card.example}</pre>
        </div>
      )}
      {card.prompt && (
        <div>
          <p style={SECTION_LABEL}>Try it</p>
          <p style={{ fontFamily: 'var(--font-text)', fontSize: 14, fontWeight: 600, lineHeight: 1.5, color: 'var(--fg-1)', margin: 0, borderLeft: '2px solid var(--evergreen-500)', paddingLeft: 10 }}>{card.prompt}</p>
        </div>
      )}
    </div>
  );
}

const CARD: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-1)',
  borderRadius: 'var(--radius-l)',
  padding: 16,
};

const DANGER = 'var(--sunset-500)';

interface LessonChatProps {
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  onDismissError: () => void;
  onSend: (text: string) => Promise<boolean>;
  /** When false, input is disabled and a setup hint is shown. */
  providerReady: boolean;
  /** When true, the lesson is finished — show a done state instead of input. */
  completed: boolean;
  /** Answer a prepared MCQ by clicking a choice (deterministic flow only). */
  onSelectMcqOption?: (option: string) => void;
}

/** Prepared MCQ rendered inline in the chat: question + clickable choices. */
function McqBlock({ mcq, onSelect }: { mcq: ChatMcqView; onSelect?: (option: string) => void }) {
  const answered = Boolean(mcq.selectedOption);
  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={SECTION_LABEL}>Quick check</p>
      <p style={{ fontFamily: 'var(--font-text)', fontSize: 14, fontWeight: 600, lineHeight: 1.5, color: 'var(--fg-1)', margin: 0 }}>{mcq.question}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {mcq.options.map((option) => {
          const isSelected = mcq.selectedOption === option;
          const isCorrect = mcq.correctOption === option;
          let borderColor = 'var(--border-1)';
          let bg = 'var(--bg-surface)';
          if (answered && isCorrect) { borderColor = 'var(--evergreen-500)'; bg = 'var(--bg-wash)'; }
          else if (answered && isSelected && !isCorrect) { borderColor = 'var(--sunset-500)'; }
          return (
            <button
              key={option}
              type="button"
              disabled={answered || !onSelect}
              onClick={() => onSelect?.(option)}
              style={{ textAlign: 'left', fontFamily: 'var(--font-text)', fontSize: 13, lineHeight: 1.45, padding: '8px 12px', borderRadius: 'var(--radius-m)', border: `1px solid ${borderColor}`, background: bg, color: 'var(--fg-1)', cursor: answered || !onSelect ? 'default' : 'pointer', opacity: answered && !isSelected && !isCorrect ? 0.6 : 1 }}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function LessonChat({
  messages,
  loading,
  error,
  onDismissError,
  onSend,
  providerReady,
  completed,
  onSelectMcqOption,
}: LessonChatProps) {
  const [text, setText] = useState('');
  // Auto-scroll to the newest message whenever the transcript grows or the
  // tutor starts/stops thinking — used by BOTH flows (this component backs the
  // current flow too).
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, loading]);

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
        {messages.map((m, i) => {
          const isStudent = m.role === 'student';
          // Tutor: calm surface card. Student: brand accent (evergreen) with dark
          // green text for contrast — both drawn from the design tokens.
          const bubbleBg = isStudent ? 'var(--evergreen-500)' : 'var(--bg-wash)';
          const bubbleText = isStudent ? 'var(--evergreen-900)' : 'var(--fg-2)';
          const labelColor = isStudent ? 'var(--evergreen-900)' : 'var(--fg-3)';
          return (
            <div
              key={i}
              style={{
                alignSelf: isStudent ? 'flex-end' : 'flex-start',
                maxWidth: '86%',
                background: bubbleBg,
                border: `1px solid ${isStudent ? 'transparent' : 'var(--border-1)'}`,
                borderRadius: 'var(--radius-m)',
                padding: '10px 12px',
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: labelColor, opacity: isStudent ? 0.75 : 1 }}>
                {isStudent ? 'You' : 'Tutor'}
              </span>
              {m.card ? (
                <div style={{ marginTop: 6 }}>
                  <LessonCardBlock card={m.card} />
                </div>
              ) : (
                <div style={{ marginTop: 4 }}>
                  <Paragraphs text={m.content} style={{ fontFamily: 'var(--font-text)', fontSize: 14, lineHeight: 1.6, color: bubbleText }} />
                </div>
              )}
              {m.mcq && <McqBlock mcq={m.mcq} onSelect={onSelectMcqOption} />}
            </div>
          );
        })}
        {loading && (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-3)', margin: 0 }}>Tutor is thinking…</p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Friendly error banner */}
      {error && (
        <div style={{ ...CARD, borderColor: DANGER, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontFamily: 'var(--font-text)', fontSize: 13, lineHeight: 1.5, color: 'var(--fg-2)', margin: 0 }}>{error}</p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Link
              to="/ai-setup"
              style={{ fontFamily: 'var(--font-ui)', fontSize: 13, padding: '6px 14px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border-1)', color: 'var(--fg-2)', textDecoration: 'none' }}
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
              style={{ flex: 1, boxSizing: 'border-box', resize: 'vertical', background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 'var(--radius-m)', padding: '10px 12px', color: 'var(--fg-1)', fontFamily: 'var(--font-text)', fontSize: 14, lineHeight: 1.5, opacity: !providerReady ? 0.6 : 1 }}
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
