import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppIcon } from '../components/AppIcon';
import {
  getPrebuiltCourses,
  getPrebuiltCourseById,
  indexPrebuiltCourses,
} from '../course-package';
import type { CoursePackage, KnowledgeBaseChunk, LearningUnit } from '../course-package';
import { buildTutorContext } from '../tutor-runtime/build-tutor-context';
import { buildTutorPrompt } from '../tutor-runtime/build-tutor-prompt';
import { useAiProvider } from '../contexts/AiProviderContext';

// Focused MVP flow (no arbitrary generation on this screen):
//   Choose course → view details + units → select a unit → ask the tutor.
// The Tutor Runtime builds MINIMAL context for the selected unit and a mock
// ModelProvider answers. The Course Factory still exists in the codebase; it
// is simply no longer the visible flow. Styled with existing design tokens.

const SURFACE: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--maestro-ink-3)',
  borderRadius: 'var(--radius-l)',
  padding: 20,
};

const LABEL: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--fg-3)',
};

interface TutorTurn {
  unitId: string;
  userMessage: string;
  answer: string;
  usedChunks: KnowledgeBaseChunk[];
}

export function CourseDemoPage() {
  const navigate = useNavigate();
  const { activeModelProvider, providerError } = useAiProvider();

  // Index both prebuilt courses into the reusable-RAG index once, on first
  // render. Idempotent — safe under StrictMode double-invoke.
  const { indexedAssetCount, courseCount } = useMemo(() => indexPrebuiltCourses(), []);
  const courses = useMemo(() => getPrebuiltCourses(), []);

  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [message, setMessage] = useState('I am new to this — where should I start?');
  const [turn, setTurn] = useState<TutorTurn | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCourse: CoursePackage | undefined = selectedCourseId
    ? getPrebuiltCourseById({ courseId: selectedCourseId })
    : undefined;
  const selectedUnit: LearningUnit | undefined = selectedCourse?.units.find(
    (u) => u.id === selectedUnitId,
  );

  const chooseCourse = (courseId: string) => {
    setSelectedCourseId(courseId);
    setSelectedUnitId(null);
    setTurn(null);
    setError(null);
  };

  const chooseUnit = (unitId: string) => {
    setSelectedUnitId(unitId);
    setTurn(null);
    setError(null);
  };

  const goBack = () => {
    if (selectedCourse) {
      setSelectedCourseId(null);
      setSelectedUnitId(null);
      setTurn(null);
      setError(null);
    } else {
      navigate('/');
    }
  };

  // Build minimal context for the selected unit, render the prompt, and ask
  // the (mock) model. Never sends the whole course — only this unit's slice.
  const askTutor = async () => {
    if (!selectedCourse || !selectedUnit || !message.trim()) return;
    // Route through the provider selected in AI setup. No silent mock fallback:
    // if it can't be built (e.g. missing key), surface the reason. The mock is
    // only ever used when Built-in is selected (AiProviderContext maps it there).
    if (!activeModelProvider) {
      setError(providerError ?? 'No AI provider is ready. Open AI setup to connect one.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const context = buildTutorContext({
        coursePackage: selectedCourse,
        unitId: selectedUnit.id,
        userMessage: message,
        // Freedom mode defaults to "guided" inside the runtime.
      });
      const prompt = buildTutorPrompt({ context });
      const provider = activeModelProvider;
      const answer = await provider.generateText({
        prompt: prompt.userPrompt,
        system: prompt.systemPrompt,
      });
      setTurn({
        unitId: selectedUnit.id,
        userMessage: message,
        answer,
        usedChunks: context.relevantChunks,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ width: '100%', maxWidth: 980, margin: '0 auto', padding: 'clamp(20px,4vw,40px) clamp(16px,4vw,48px) 96px' }}>
      <button
        type="button"
        onClick={goBack}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 20 }}
      >
        <AppIcon name="chevronL" size={15} />
        {selectedCourse ? 'All courses' : 'Back to apps'}
      </button>

      {/* Header */}
      <p style={{ ...LABEL, letterSpacing: '0.08em', margin: '0 0 12px' }}>Courses · tutor</p>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, lineHeight: 1.1, letterSpacing: '-0.01em', margin: '0 0 10px', color: 'var(--fg-2)' }}>
        {selectedCourse ? selectedCourse.title : <>Choose a <em>course</em></>}
      </h1>
      <p style={{ fontFamily: 'var(--font-text)', fontSize: 14, lineHeight: 1.55, color: 'var(--fg-3)', margin: '0 0 24px', maxWidth: 620 }}>
        {selectedCourse
          ? selectedCourse.description
          : `Each course is prebuilt structured data with its own teaching brain and knowledge base. The tutor sends only one unit's slice to the model — ${courseCount} courses, ${indexedAssetCount} reusable assets indexed.`}
      </p>

      {/* Step 1 — choose a course */}
      {!selectedCourse && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {courses.map((course) => (
            <button
              key={course.id}
              type="button"
              onClick={() => chooseCourse(course.id)}
              style={{ ...SURFACE, textAlign: 'left', cursor: 'pointer', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: '18px', padding: '0 8px', borderRadius: 'var(--radius-xs)', background: 'var(--maestro-ink-3)', color: 'var(--fg-3)' }}>
                  {course.metadata.level}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
                  {course.units.length} units · ~{course.metadata.estimatedDurationMinutes} min
                </span>
              </span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, color: 'var(--fg-2)' }}>{course.title}</span>
              <span style={{ fontFamily: 'var(--font-text)', fontSize: 13, lineHeight: 1.5, color: 'var(--fg-3)' }}>{course.description}</span>
            </button>
          ))}
        </div>
      )}

      {/* Step 2+ — course details, unit selection, tutor */}
      {selectedCourse && (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Left: goal + units */}
          <div style={{ flex: '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={SURFACE}>
              <p style={{ ...LABEL, margin: '0 0 8px' }}>Course goal</p>
              <p style={{ fontFamily: 'var(--font-text)', fontSize: 14, lineHeight: 1.55, color: 'var(--fg-2)', margin: 0 }}>{selectedCourse.goal}</p>
            </div>

            <div>
              <p style={{ ...LABEL, margin: '0 0 12px' }}>Learning units · {selectedCourse.units.length}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {selectedCourse.units.map((unit) => {
                  const active = unit.id === selectedUnitId;
                  return (
                    <button
                      key={unit.id}
                      type="button"
                      onClick={() => chooseUnit(unit.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left',
                        background: 'var(--bg-surface)', borderRadius: 'var(--radius-m)', padding: '12px 14px',
                        color: 'inherit', fontFamily: 'inherit', cursor: 'pointer',
                        border: active ? '1px solid var(--maestro-paper-3)' : '1px solid var(--maestro-ink-3)',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: 28, height: 28, borderRadius: 8, background: 'var(--maestro-ink-3)', color: 'var(--maestro-paper-3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {unit.order}
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, color: 'var(--fg-2)' }}>{unit.title}</span>
                        <span style={{ fontFamily: 'var(--font-text)', fontSize: 12, color: 'var(--fg-3)' }}>{unit.goal}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: tutor panel for the selected unit */}
          <aside style={{ ...SURFACE, flex: '1 1 300px', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ ...LABEL, margin: 0 }}>Ask the tutor <span style={{ opacity: 0.6 }}>(mock model · guided)</span></p>

            {!selectedUnit && (
              <p style={{ fontFamily: 'var(--font-text)', fontSize: 13, lineHeight: 1.5, color: 'var(--fg-3)', margin: 0 }}>
                Select a unit on the left to start. The tutor teaches one unit at a time and only sees that unit's slice of the course.
              </p>
            )}

            {selectedUnit && (
              <>
                <div>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-2)', margin: '0 0 2px' }}>
                    Unit {selectedUnit.order}: {selectedUnit.title}
                  </p>
                  <p style={{ fontFamily: 'var(--font-text)', fontSize: 12, color: 'var(--fg-3)', margin: 0 }}>{selectedUnit.goal}</p>
                </div>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={LABEL}>Your message</span>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void askTutor(); }}
                    rows={3}
                    style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', background: 'var(--maestro-ink-2)', border: '1px solid var(--maestro-ink-3)', borderRadius: 'var(--radius-m)', padding: '10px 12px', color: 'var(--fg-1)', fontFamily: 'var(--font-text)', fontSize: 14, lineHeight: 1.5 }}
                  />
                </label>

                <button
                  type="button"
                  onClick={() => void askTutor()}
                  disabled={loading || !message.trim()}
                  style={{ alignSelf: 'flex-start', fontFamily: 'var(--font-ui)', fontSize: 14, padding: '10px 18px', borderRadius: 'var(--radius-pill)', border: '1px solid transparent', cursor: loading ? 'default' : 'pointer', background: 'var(--evergreen-500)', color: 'var(--evergreen-900)', opacity: loading || !message.trim() ? 0.6 : 1 }}
                >
                  {loading ? 'Thinking…' : 'Ask tutor'}
                </button>

                {error && (
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--sunset-500, #FF8B62)', margin: 0 }}>{error}</p>
                )}

                {turn && turn.unitId === selectedUnit.id && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--maestro-ink-3)', paddingTop: 14 }}>
                    <p style={{ fontFamily: 'var(--font-text)', fontSize: 14, lineHeight: 1.6, color: 'var(--fg-2)', margin: 0, whiteSpace: 'pre-wrap' }}>
                      {turn.answer}
                    </p>
                    {turn.usedChunks.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        <span style={{ ...LABEL, width: '100%' }}>Knowledge used ({turn.usedChunks.length})</span>
                        {turn.usedChunks.map((chunk) => (
                          <span key={chunk.id} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: '18px', padding: '0 8px', borderRadius: 'var(--radius-xs)', background: 'var(--maestro-ink-3)', color: 'var(--fg-3)' }}>
                            {chunk.title}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
