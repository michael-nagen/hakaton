// ── CoursePlayerPage — lesson list + lesson player (/courses/:courseId) ─
//
// One page, two views. Without a `?lesson=<unitId>` param it shows the course's
// lessons (units) as cards with status + Start/Continue. With a valid param it
// renders the lesson player, which runs the tutor via useLessonSession against
// the provider selected in /ai-setup. No provider is ever referenced here.

import { useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AppIcon } from '../../components/AppIcon';
import { LessonChat } from '../../components/LessonChat';
import { getPrebuiltCourseById } from '../../course-package';
import type { CoursePackage, LearningUnit } from '../../course-package';
import { hasDeterministicSteps, loadCourseProgress } from '../../lesson-runtime';
import type { LessonStatus } from '../../lesson-runtime';
import { useLessonSession } from '../../hooks/useLessonSession';
import { useDeterministicChat } from '../../hooks/useDeterministicChat';

const SURFACE: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-1)',
  borderRadius: 'var(--radius-l)',
  padding: 20,
};

// Full-viewport dark page wrapper, matching the rest of the product (AppShell,
// AI setup). The lesson screens live outside AppShell, so they opt into the same
// dark theme + page background here rather than floating on the light default.
function DarkPage({ maxWidth, children }: { maxWidth: number; children: React.ReactNode }) {
  return (
    <div data-theme="dark" style={{ minHeight: '100vh', background: 'var(--bg-page)', color: 'var(--fg-1)', fontFamily: 'var(--font-text)' }}>
      <div style={{ width: '100%', maxWidth, margin: '0 auto', padding: 'clamp(20px,4vw,40px) clamp(16px,4vw,48px) 96px' }}>
        {children}
      </div>
    </div>
  );
}

const LABEL: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--fg-3)',
};

const STATUS_TEXT: Record<LessonStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
};

const STATUS_ACTION: Record<LessonStatus, string> = {
  not_started: 'Start lesson',
  in_progress: 'Continue',
  completed: 'Review',
};

function statusColor(status: LessonStatus): string {
  if (status === 'completed') return 'var(--evergreen-500)';
  if (status === 'in_progress') return 'var(--maestro-paper-3)';
  return 'var(--fg-3)';
}

function estMinutesPerLesson(course: CoursePackage): number {
  return Math.max(1, Math.round(course.metadata.estimatedDurationMinutes / Math.max(course.units.length, 1)));
}

export function CoursePlayerPage() {
  const navigate = useNavigate();
  const { courseId } = useParams<{ courseId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const course = courseId ? getPrebuiltCourseById({ courseId }) : undefined;
  const lessonUnitId = searchParams.get('lesson');
  const activeUnit = course?.units.find((u) => u.id === lessonUnitId);

  if (!course) {
    return (
      <DarkPage maxWidth={980}>
        <p style={{ fontFamily: 'var(--font-text)', fontSize: 14, color: 'var(--fg-2)' }}>Course not found.</p>
        <Link to="/courses" style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--fg-2)' }}>← All courses</Link>
      </DarkPage>
    );
  }

  // Active lesson → player view.
  if (activeUnit) {
    return (
      <LessonPlayer
        course={course}
        unit={activeUnit}
        onBackToLessons={() => setSearchParams({}, { replace: true })}
        onOpenUnit={(unitId) => setSearchParams({ lesson: unitId })}
      />
    );
  }

  // Otherwise → lesson list view.
  return (
    <LessonList
      course={course}
      onBack={() => navigate('/courses')}
      onOpenLesson={(unitId) => setSearchParams({ lesson: unitId })}
    />
  );
}

// ── Lesson list ──────────────────────────────────────────────────────

function LessonList({
  course,
  onBack,
  onOpenLesson,
}: {
  course: CoursePackage;
  onBack: () => void;
  onOpenLesson: (unitId: string) => void;
}) {
  const progress = useMemo(
    () => loadCourseProgress({ courseId: course.id, units: course.units }),
    [course],
  );
  const perLesson = estMinutesPerLesson(course);

  return (
    <DarkPage maxWidth={980}>
      <button
        type="button"
        onClick={onBack}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 20 }}
      >
        <AppIcon name="chevronL" size={15} />
        All courses
      </button>

      <p style={{ ...LABEL, margin: '0 0 12px' }}>Course</p>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, lineHeight: 1.1, letterSpacing: '-0.01em', margin: '0 0 10px', color: 'var(--fg-2)' }}>
        {course.title}
      </h1>
      <p style={{ fontFamily: 'var(--font-text)', fontSize: 14, lineHeight: 1.55, color: 'var(--fg-3)', margin: '0 0 24px', maxWidth: 620 }}>
        {course.goal}
      </p>

      <p style={{ ...LABEL, margin: '0 0 12px' }}>Lessons · {course.units.length}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {course.units.map((unit) => {
          const status = progress[unit.id]?.status ?? 'not_started';
          return (
            <div
              key={unit.id}
              style={{ ...SURFACE, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: 30, height: 30, borderRadius: 8, background: 'var(--bg-wash)', color: 'var(--fg-1)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                {unit.order}
              </span>
              <div style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--fg-2)' }}>{unit.title}</span>
                <span style={{ fontFamily: 'var(--font-text)', fontSize: 13, lineHeight: 1.5, color: 'var(--fg-3)' }}>{unit.goal}</span>
                <span style={{ display: 'flex', gap: 12, marginTop: 2, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
                  <span>~{perLesson} min</span>
                  <span style={{ color: statusColor(status) }}>● {STATUS_TEXT[status]}</span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => onOpenLesson(unit.id)}
                style={{ fontFamily: 'var(--font-ui)', fontSize: 14, padding: '9px 18px', borderRadius: 'var(--radius-pill)', border: '1px solid transparent', cursor: 'pointer', background: 'var(--evergreen-500)', color: 'var(--evergreen-900)', whiteSpace: 'nowrap' }}
              >
                {STATUS_ACTION[status]}
              </button>
            </div>
          );
        })}
      </div>
    </DarkPage>
  );
}

// ── Lesson player ────────────────────────────────────────────────────

function LessonPlayer({
  course,
  unit,
  onBackToLessons,
  onOpenUnit,
}: {
  course: CoursePackage;
  unit: LearningUnit;
  onBackToLessons: () => void;
  onOpenUnit: (unitId: string) => void;
}) {
  const unitIndex = course.units.findIndex((u) => u.id === unit.id);
  const nextUnit = course.units[unitIndex + 1];
  const session = useLessonSession({ course, unit });
  // Deterministic flow reuses the SAME chat UI (LessonChat) — only the engine
  // differs. Both hooks run unconditionally (hook rules); we pick which drives.
  const dChat = useDeterministicChat({ unit });
  const objectives = unit.teacherBrain.objectives.slice(0, 3);

  // Deterministic prepared-steps is the ONLY lesson-management experience. We
  // fall back to the current flow only when a unit has no prepared steps, so the
  // player never breaks — but there is no user-facing choice.
  const deterministicActive = hasDeterministicSteps(unit);

  const completedSteps = deterministicActive ? dChat.completedCount : session.state.completedStepIds.length;
  const stepNumber = deterministicActive ? dChat.stepNumber : session.currentStepNumber;
  const totalSteps = deterministicActive ? dChat.totalSteps : session.totalSteps;
  const pct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  return (
    <DarkPage maxWidth={820}>
      {/* One compact top bar: where you are + which tutor is leading. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <button
          type="button"
          onClick={onBackToLessons}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 12, cursor: 'pointer', padding: 0 }}
        >
          <AppIcon name="chevronL" size={15} />
          {course.title} · lessons
        </button>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: session.providerReady ? 'var(--evergreen-500)' : 'var(--sunset-500)' }} />
          Tutor: <span style={{ color: 'var(--fg-2)' }}>{session.provider.displayName}</span>
          <Link to="/ai-setup" style={{ color: 'var(--evergreen-500)', textDecoration: 'none' }}>Change</Link>
        </span>
      </div>

      {/* Header: lesson number, title, one-line goal, and a slim progress bar. */}
      <p style={{ ...LABEL, margin: '0 0 8px' }}>Lesson {unit.order} of {course.units.length}</p>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, lineHeight: 1.15, letterSpacing: '-0.01em', margin: '0 0 10px', color: 'var(--fg-2)' }}>
        {unit.title}
      </h1>
      <p style={{ fontFamily: 'var(--font-text)', fontSize: 14, lineHeight: 1.55, color: 'var(--fg-3)', margin: '0 0 16px', maxWidth: 640 }}>
        {unit.goal}
      </p>

      {/* Progress + objectives — shared by both flows (each engine reports its
          own step counts). */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={LABEL}>Step {stepNumber} / {totalSteps}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>{pct}%</span>
        </div>
        <div style={{ height: 6, borderRadius: 999, background: 'var(--bg-wash)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--evergreen-500)', transition: 'width 200ms ease' }} />
        </div>
        {objectives.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary style={{ ...LABEL, cursor: 'pointer', listStyle: 'none' }}>What you'll be able to do ▾</summary>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {objectives.map((o, i) => (
                <li key={i} style={{ fontFamily: 'var(--font-text)', fontSize: 13, lineHeight: 1.5, color: 'var(--fg-3)' }}>{o}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* Fallback note: this lesson has no prepared deterministic steps yet → we
          run the current flow instead of breaking. */}
      {!deterministicActive && (
        <div style={{ ...SURFACE, marginBottom: 16, borderColor: 'var(--sunset-500)' }}>
          <p style={{ fontFamily: 'var(--font-text)', fontSize: 13, lineHeight: 1.5, color: 'var(--fg-2)', margin: 0 }}>
            This lesson has no deterministic step data yet — showing the current flow instead.
          </p>
        </div>
      )}

      {deterministicActive ? (
        <>
          {/* Which prepared step the learner is on — the deterministic messages
              themselves stream into the SAME chat below. */}
          {dChat.status !== 'completed' && (
            <div style={{ ...SURFACE, marginBottom: 16, borderColor: 'var(--evergreen-900)' }}>
              <p style={{ ...LABEL, margin: '0 0 8px' }}>Current step</p>
              <p style={{ fontFamily: 'var(--font-text)', fontSize: 15, lineHeight: 1.55, color: 'var(--fg-1)', margin: 0 }}>
                {dChat.currentStepTitle}
              </p>
            </div>
          )}

          <LessonChat
            messages={dChat.messages}
            loading={dChat.loading}
            error={dChat.error}
            onDismissError={dChat.dismissError}
            onSend={dChat.sendStudentMessage}
            providerReady={dChat.providerReady}
            completed={dChat.status === 'completed'}
            onSelectMcqOption={dChat.selectMcqOption}
          />

          {/* Next-lesson action once the deterministic lesson is finished. */}
          {dChat.status === 'completed' && (
            <div style={{ ...SURFACE, marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--font-text)', fontSize: 14, color: 'var(--fg-2)' }}>
                {nextUnit ? `Next up: ${nextUnit.title}` : '🎉 You finished the last lesson of this course!'}
              </span>
              {nextUnit ? (
                <button
                  type="button"
                  onClick={() => onOpenUnit(nextUnit.id)}
                  style={{ fontFamily: 'var(--font-ui)', fontSize: 14, padding: '9px 18px', borderRadius: 'var(--radius-pill)', border: '1px solid transparent', cursor: 'pointer', background: 'var(--evergreen-500)', color: 'var(--evergreen-900)', whiteSpace: 'nowrap' }}
                >
                  Continue to next lesson
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onBackToLessons}
                  style={{ fontFamily: 'var(--font-ui)', fontSize: 14, padding: '9px 18px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border-1)', cursor: 'pointer', background: 'transparent', color: 'var(--fg-2)', whiteSpace: 'nowrap' }}
                >
                  Back to all lessons
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          {/* The real generated question the learner is working on right now. */}
          {session.currentStep && session.status !== 'completed' && (
            <div style={{ ...SURFACE, marginBottom: 16, borderColor: 'var(--evergreen-900)' }}>
              <p style={{ ...LABEL, margin: '0 0 8px' }}>Current question</p>
              <p style={{ fontFamily: 'var(--font-text)', fontSize: 15, lineHeight: 1.55, color: 'var(--fg-1)', margin: 0 }}>
                {session.currentStep.question}
              </p>
            </div>
          )}

          <LessonChat
            messages={session.messages}
            loading={session.loading}
            error={session.error}
            onDismissError={session.dismissError}
            onSend={session.sendStudentMessage}
            providerReady={session.providerReady}
            completed={session.status === 'completed'}
          />
        </>
      )}
    </DarkPage>
  );
}
