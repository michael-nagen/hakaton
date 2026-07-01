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
import { loadCourseProgress } from '../../lesson-runtime';
import type { LessonStatus } from '../../lesson-runtime';
import { useLessonSession } from '../../hooks/useLessonSession';

const SURFACE: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--maestro-ink-3)',
  borderRadius: 'var(--radius-l)',
  padding: 20,
};

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
      <div style={{ width: '100%', maxWidth: 980, margin: '0 auto', padding: 'clamp(20px,4vw,40px) clamp(16px,4vw,48px)' }}>
        <p style={{ fontFamily: 'var(--font-text)', fontSize: 14, color: 'var(--fg-2)' }}>Course not found.</p>
        <Link to="/courses" style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--fg-2)' }}>← All courses</Link>
      </div>
    );
  }

  // Active lesson → player view.
  if (activeUnit) {
    return (
      <LessonPlayer
        course={course}
        unit={activeUnit}
        onBackToLessons={() => setSearchParams({}, { replace: true })}
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
    <div style={{ width: '100%', maxWidth: 980, margin: '0 auto', padding: 'clamp(20px,4vw,40px) clamp(16px,4vw,48px) 96px' }}>
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
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: 30, height: 30, borderRadius: 8, background: 'var(--maestro-ink-3)', color: 'var(--maestro-paper-3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
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
    </div>
  );
}

// ── Lesson player ────────────────────────────────────────────────────

function LessonPlayer({
  course,
  unit,
  onBackToLessons,
}: {
  course: CoursePackage;
  unit: LearningUnit;
  onBackToLessons: () => void;
}) {
  const session = useLessonSession({ course, unit });
  const completedSteps = session.state.completedStepIds.length;
  const pct = session.totalSteps > 0 ? Math.round((completedSteps / session.totalSteps) * 100) : 0;
  const objectives = unit.teacherBrain.objectives.slice(0, 3);

  return (
    <div style={{ width: '100%', maxWidth: 820, margin: '0 auto', padding: 'clamp(20px,4vw,40px) clamp(16px,4vw,48px) 96px' }}>
      <button
        type="button"
        onClick={onBackToLessons}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 20 }}
      >
        <AppIcon name="chevronL" size={15} />
        {course.title} · lessons
      </button>

      {/* Provider status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: 'var(--font-mono)', fontSize: 11, padding: '4px 10px', borderRadius: 'var(--radius-pill)', background: 'var(--maestro-ink-2)', border: '1px solid var(--maestro-ink-3)', color: 'var(--fg-3)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: session.providerReady ? 'var(--evergreen-500)' : 'var(--sunset-500, #FF8B62)' }} />
          Tutor: {session.provider.displayName}
        </span>
        <Link to="/ai-setup" style={{ fontFamily: 'var(--font-ui)', fontSize: 12, padding: '5px 12px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--maestro-ink-3)', color: 'var(--fg-2)', textDecoration: 'none' }}>
          Open AI setup
        </Link>
      </div>

      <p style={{ ...LABEL, margin: '0 0 8px' }}>Lesson {unit.order}</p>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, lineHeight: 1.15, letterSpacing: '-0.01em', margin: '0 0 14px', color: 'var(--fg-2)' }}>
        {unit.title}
      </h1>

      {/* Learning goals */}
      <div style={{ ...SURFACE, marginBottom: 16 }}>
        <p style={{ ...LABEL, margin: '0 0 8px' }}>Learning goals</p>
        <p style={{ fontFamily: 'var(--font-text)', fontSize: 14, lineHeight: 1.55, color: 'var(--fg-2)', margin: objectives.length ? '0 0 10px' : 0 }}>{unit.goal}</p>
        {objectives.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {objectives.map((o, i) => (
              <li key={i} style={{ fontFamily: 'var(--font-text)', fontSize: 13, lineHeight: 1.5, color: 'var(--fg-3)' }}>{o}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Progress */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={LABEL}>Step {session.currentStepNumber} / {session.totalSteps}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>{pct}%</span>
        </div>
        <div style={{ height: 6, borderRadius: 999, background: 'var(--maestro-ink-3)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--evergreen-500)', transition: 'width 200ms ease' }} />
        </div>
      </div>

      <LessonChat
        messages={session.messages}
        loading={session.loading}
        error={session.error}
        onDismissError={session.dismissError}
        onSend={session.sendStudentMessage}
        providerReady={session.providerReady}
        completed={session.status === 'completed'}
      />
    </div>
  );
}
