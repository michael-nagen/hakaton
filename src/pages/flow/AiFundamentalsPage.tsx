// ── Pages 4 / 5 / 6 · Real course flow (Maestro UI) ───────────────────
// One component, three views, wired to the REAL course + lesson runtime:
//   • path      → Page 4: the course's real units as a locked spine
//   • syllabus  → Page 5: the selected unit's real steps as "parts"
//   • lesson    → Page 6: useLessonSession({ course, unit }) — real guided
//                 session (real transcript, progress, grading, completion)
//
// The course is the app's real CoursePackage (Python Variables Basics). All
// visible copy — course/unit titles, goals, objectives, current question,
// progress, completion — comes from the real data. The route stays
// `/learn/ai-fundamentals` (legacy id) so Page 3 links / routing are untouched.
//
// Main "Send answer" runs the real lesson turn (advances progress). The helper
// actions (Explain simpler / Give an example / Challenge me) call the tutor
// provider directly so they DON'T advance progress. Watch video / Take a break
// stay local. No JSON / CoursePackage raw data / TutorInput/TutorResponse is
// ever shown; tutor errors surface only as a friendly inline message.
//
// Lesson management is the deterministic prepared-steps flow (app-controlled
// progression). If a unit has no prepared deterministicSteps we fall back to the
// current question-driven flow so nothing breaks — but there is no user-facing
// choice: the lesson simply opens in the deterministic chat when it can.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getPrebuiltCourseById, getPrebuiltCourses, DEFAULT_COURSE_ID } from '../../course-package';
import type { CoursePackage, LearningUnit } from '../../course-package';
import { buildLessonSteps, hasDeterministicSteps, loadCourseProgress, loadProgress, clearProgress } from '../../lesson-runtime';
import { useLessonSession } from '../../hooks/useLessonSession';
import { useDeterministicChat } from '../../hooks/useDeterministicChat';
import type { ChatLessonCard, ChatMcqView, DeterministicChatMessage } from '../../hooks/useDeterministicChat';
import { useLessonAssistant } from '../../hooks/useLessonAssistant';
import {
  getCurrentLessonContext,
  CLASSIC_PERSONALIZATION_OPTIONS,
  CUSTOM_PREFERENCE_MAX_LENGTH,
  presetPreference,
  customPreference,
  loadTeachingPreference,
  saveTeachingPreference,
  clearTeachingPreference,
} from '../../lesson-assistant';
import type { RecommendedVideo, TeachingPreference } from '../../lesson-assistant';

const COURSE_ID = DEFAULT_COURSE_ID;

type View = 'path' | 'syllabus' | 'lesson';
type Role = 'tutor' | 'student';
interface Message {
  role: Role;
  text: string;
  /** Prepared MCQ carried by a deterministic tutor message (rendered inline). */
  mcq?: ChatMcqView;
  /** Prepared "mini lesson" card carried by a deterministic tutor message. */
  card?: ChatLessonCard;
}

// Friendly, non-technical copy for the helper/side tutor calls (never raw).
const TUTOR_FAIL_MESSAGE = 'The tutor had trouble responding. Please try again.';
const NO_PROVIDER_MESSAGE = 'Choose an AI guide first to start the conversation.';

const ROW = 84; // px per spine row (matches the design)

function titleCase(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// A short, human label for a step, grounded in the real question text (the data
// literally marks its second question "Mastery check:"). No invented topics.
function stepLabel(question: string): string {
  return /^\s*mastery check/i.test(question) ? 'Mastery check' : 'Practice question';
}

export function AiFundamentalsPage() {
  const navigate = useNavigate();
  const course = useMemo(() => getPrebuiltCourseById({ courseId: COURSE_ID }) ?? getPrebuiltCourses()[0], []);

  const [view, setView] = useState<View>('path');
  const [selectedUnitId, setSelectedUnitId] = useState<string>(course?.units[0]?.id ?? '');

  if (!course || course.units.length === 0) {
    return (
      <div className="mds" style={{ minHeight: '100vh', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <p style={{ fontFamily: 'var(--font-text)', fontSize: 16, color: 'var(--color-fg-secondary)' }}>No course is available yet.</p>
      </div>
    );
  }

  const unit = course.units.find((u) => u.id === selectedUnitId) ?? course.units[0];

  if (view === 'path') {
    return (
      <CoursePathView
        course={course}
        onBack={() => navigate('/paths')}
        onStartUnit={(unitId) => {
          setSelectedUnitId(unitId);
          setView('syllabus');
        }}
      />
    );
  }

  if (view === 'syllabus') {
    return (
      <LessonPartsView
        course={course}
        unit={unit}
        onBackToCourse={() => setView('path')}
        onStartLesson={() => setView('lesson')}
      />
    );
  }

  // The guided room runs the deterministic prepared-steps engine, falling back
  // to the current flow only when the unit has no prepared deterministic steps.
  return (
    <LessonRoom
      course={course}
      unit={unit}
      onBackToSyllabus={() => setView('syllabus')}
      onContinueNext={() => setView('path')}
    />
  );
}

// ── Shared spine list (Pages 4 & 5) ───────────────────────────────────

interface SpineItem {
  num: number;
  label: string;
  isDone: boolean;
  isReady: boolean;
  isLocked: boolean;
}

/** Done = completed; ready = first not-completed; everything after is locked. */
function buildSpine(entries: { label: string; completed: boolean }[]): SpineItem[] {
  const firstIncomplete = entries.findIndex((e) => !e.completed);
  return entries.map((e, i) => {
    const isDone = e.completed;
    const isReady = i === firstIncomplete;
    const isLocked = firstIncomplete !== -1 && i > firstIncomplete && !isDone;
    return { num: i + 1, label: `${i + 1}. ${e.label}`, isDone, isReady, isLocked };
  });
}

function SpineRow({ item, actionLabel, onAction }: { item: SpineItem; actionLabel?: string; onAction?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: ROW, position: 'relative' }}>
      <div style={{ width: 56, flex: 'none', display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', zIndex: 2 }}>
        {item.isDone && (
          <div style={{ width: 36, height: 36, borderRadius: 9999, background: '#0A0A0A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
        )}
        {item.isReady && (
          <div style={{ width: 36, height: 36, borderRadius: 9999, background: '#fff', border: '2px solid #0A0A0A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: '#0A0A0A' }}>
            {item.num}
          </div>
        )}
        {item.isLocked && (
          <div style={{ width: 36, height: 36, borderRadius: 9999, background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-fg-tertiary)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="11" width="16" height="9" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
          </div>
        )}
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '0 4px' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: item.isLocked ? 'var(--color-fg-tertiary)' : 'var(--color-fg)' }}>{item.label}</div>
          <div style={{ marginTop: 2, fontFamily: 'var(--font-text)', fontSize: 13, color: item.isReady ? 'var(--color-fg-secondary)' : 'var(--color-fg-tertiary)' }}>
            {item.isDone ? 'Completed' : item.isReady ? 'Ready' : 'Complete the previous step to unlock.'}
          </div>
        </div>
        {onAction && (
          <button
            type="button"
            className="mds-btn mds-btn-dark"
            onClick={onAction}
            style={{ flex: 'none', height: 40, padding: '0 20px', border: 'none', borderRadius: 9999, background: '#0A0A0A', color: '#fff', fontFamily: 'var(--font-text)', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer' }}
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function HeaderBand({ height, backLabel, onBack, eyebrow, title, subtitle, meta }: {
  height: number;
  backLabel: string;
  onBack: () => void;
  eyebrow?: string;
  title: string;
  subtitle: string;
  meta: string;
}) {
  return (
    <div style={{ position: 'relative', height, overflow: 'hidden', background: '#0A0A0A' }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'url(/assets/course-hero.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(10,10,10,0.84) 0%, rgba(10,10,10,0.38) 44%, rgba(10,10,10,0.06) 76%)', zIndex: 2 }} />
      <button
        type="button"
        onClick={onBack}
        style={{ position: 'absolute', top: 26, left: 40, zIndex: 3, display: 'inline-flex', alignItems: 'center', gap: 7, height: 36, padding: '0 16px 0 12px', borderRadius: 9999, background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.28)', color: '#fff', cursor: 'pointer', fontFamily: 'var(--font-text)', fontSize: 14, fontWeight: 500, backdropFilter: 'blur(6px)' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        {backLabel}
      </button>
      <div style={{ position: 'absolute', left: 44, bottom: 34, right: 44, zIndex: 3 }}>
        {eyebrow && <div style={{ fontFamily: 'var(--font-text)', fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.72)' }}>{eyebrow}</div>}
        <h2 style={{ margin: eyebrow ? '8px 0 0' : 0, fontFamily: 'var(--font-display)', fontSize: eyebrow ? 38 : 40, lineHeight: 1.06, fontWeight: 600, letterSpacing: '-0.7px', color: '#fff', textShadow: '0 2px 30px rgba(0,0,0,0.4)' }}>{title}</h2>
        <p style={{ margin: '12px 0 0', fontFamily: 'var(--font-text)', fontSize: 16, lineHeight: 1.45, fontWeight: 400, color: 'rgba(255,255,255,0.82)', maxWidth: 560 }}>{subtitle}</p>
        <p style={{ margin: '14px 0 0', fontFamily: 'var(--font-text)', fontSize: 13, fontWeight: 500, letterSpacing: '0.04em', color: 'rgba(255,255,255,0.7)' }}>{meta}</p>
      </div>
    </div>
  );
}

function ProgressStrip({ text, pct, level }: { text: string; pct: number; level: string }) {
  return (
    <>
      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <span style={{ fontFamily: 'var(--font-text)', fontSize: 14, fontWeight: 600, color: 'var(--color-fg)' }}>{text}</span>
        <span style={{ fontFamily: 'var(--font-text)', fontSize: 13, color: 'var(--color-fg-tertiary)' }}>{level}</span>
      </div>
      <div style={{ height: 6, borderRadius: 9999, background: 'var(--color-border)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: '#0A0A0A', borderRadius: 9999, transition: 'width 300ms cubic-bezier(0.2,0,0,1)' }} />
      </div>
    </>
  );
}

// ── Page 4 · Course path (real units) ─────────────────────────────────

function CoursePathView({ course, onBack, onStartUnit }: { course: CoursePackage; onBack: () => void; onStartUnit: (unitId: string) => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const level = titleCase(course.metadata.level);
  const perLesson = Math.max(1, Math.round(course.metadata.estimatedDurationMinutes / Math.max(course.units.length, 1)));

  // Start over: clear ONLY this course's per-lesson progress via the existing
  // progress-store helper. Providers, API keys, guide choice, and local model
  // downloads are untouched. Re-reads fresh on the next render (all not_started).
  const startOver = () => {
    for (const u of course.units) clearProgress({ courseId: course.id, unitId: u.id });
    setConfirmOpen(false);
  };

  const progress = loadCourseProgress({ courseId: course.id, units: course.units });
  const completedCount = course.units.filter((u) => progress[u.id]?.status === 'completed').length;
  const spine = buildSpine(course.units.map((u) => ({ label: u.title, completed: progress[u.id]?.status === 'completed' })));

  return (
    <div className="mds mds-scroll" style={{ minHeight: '100vh', overflowY: 'auto', background: 'var(--color-bg)' }}>
      <HeaderBand
        height={300}
        backLabel="Back"
        onBack={onBack}
        title={course.title}
        subtitle={course.description}
        meta={`${course.units.length} lessons&ensp;·&ensp;${level}&ensp;·&ensp;~${course.metadata.estimatedDurationMinutes} min`}
      />
      <div style={{ maxWidth: 660, margin: '0 auto', padding: '44px 40px 76px' }}>
        <ProgressStrip text={`${completedCount} / ${course.units.length} lessons completed`} pct={(completedCount / course.units.length) * 100} level={level} />
        <div style={{ margin: '14px 0 32px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <p style={{ margin: 0, fontFamily: 'var(--font-text)', fontSize: 14, lineHeight: 1.5, color: 'var(--color-fg-secondary)' }}>
            One step at a time. Each lesson unlocks the next.
          </p>
          <button
            type="button"
            className="mds-btn mds-btn-ghost"
            onClick={() => setConfirmOpen(true)}
            style={{ flex: 'none', height: 32, padding: '0 14px', borderRadius: 9999, border: '1px solid var(--color-border-strong)', background: 'transparent', color: 'var(--color-fg-secondary)', fontFamily: 'var(--font-text)', fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Start over
          </button>
        </div>
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', left: 27, top: 42, width: 2, height: (course.units.length - 1) * ROW, background: 'var(--color-border)' }} />
          <div style={{ position: 'absolute', left: 27, top: 42, width: 2, height: completedCount * ROW, background: '#0A0A0A', transition: 'height 300ms cubic-bezier(0.2,0,0,1)' }} />
          {spine.map((item, i) => (
            <SpineRow key={course.units[i].id} item={item} actionLabel="Start lesson" onAction={item.isReady ? () => onStartUnit(course.units[i].id) : undefined} />
          ))}
        </div>
        <p style={{ margin: '4px 0 0 60px', fontFamily: 'var(--font-text)', fontSize: 12, color: 'var(--color-fg-tertiary)' }}>~{perLesson} min per lesson</p>
      </div>

      {confirmOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ width: 400, maxWidth: '90%', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 24, boxShadow: 'var(--shadow-lg)', padding: 28 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, color: 'var(--color-fg)' }}>Start this course over?</div>
            <p style={{ margin: '10px 0 0', fontFamily: 'var(--font-text)', fontSize: 15, lineHeight: 1.5, color: 'var(--color-fg-secondary)' }}>
              This will clear your lesson progress and let you start from the beginning.
            </p>
            <div style={{ marginTop: 22, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="mds-btn mds-btn-ghost" onClick={() => setConfirmOpen(false)} style={{ height: 42, padding: '0 18px', borderRadius: 9999, border: '1px solid var(--color-border-strong)', background: 'transparent', color: 'var(--color-fg)', fontFamily: 'var(--font-text)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button type="button" className="mds-btn mds-btn-dark" onClick={startOver} style={{ height: 42, padding: '0 20px', borderRadius: 9999, border: 'none', background: '#0A0A0A', color: '#fff', fontFamily: 'var(--font-text)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Start over</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page 5 · Lesson parts (real steps) ────────────────────────────────

function LessonPartsView({ course, unit, onBackToCourse, onStartLesson }: { course: CoursePackage; unit: LearningUnit; onBackToCourse: () => void; onStartLesson: () => void }) {
  const level = titleCase(course.metadata.level);
  const steps = useMemo(() => buildLessonSteps(unit), [unit]);
  const persisted = loadProgress({ courseId: course.id, unitId: unit.id });
  const completed = new Set(persisted?.completedStepIds ?? []);
  const completedCount = steps.filter((s) => completed.has(s.id)).length;
  const spine = buildSpine(steps.map((s) => ({ label: stepLabel(s.question), completed: completed.has(s.id) })));

  // The step the "Start part" button enters. Normally the first not-yet-done
  // part; if every part is already done but the lesson isn't terminal (the local
  // tutor never marks lessons complete), keep the last part enterable so the
  // learner can resume the conversation instead of hitting a dead-end.
  const firstIncomplete = steps.findIndex((s) => !completed.has(s.id));
  const enterableIndex = firstIncomplete === -1 ? steps.length - 1 : firstIncomplete;
  const enterLabel = firstIncomplete === -1 ? 'Continue' : 'Start part';

  return (
    <div className="mds mds-scroll" style={{ minHeight: '100vh', overflowY: 'auto', background: 'var(--color-bg)' }}>
      <HeaderBand
        height={270}
        backLabel="Back to course"
        onBack={onBackToCourse}
        eyebrow={course.title}
        title={unit.title}
        subtitle={unit.goal}
        meta={`${steps.length} parts&ensp;·&ensp;${level}&ensp;·&ensp;Guided by your AI tutor`}
      />
      <div style={{ maxWidth: 660, margin: '0 auto', padding: '44px 40px 76px' }}>
        <ProgressStrip text={`${completedCount} / ${steps.length} parts completed`} pct={steps.length ? (completedCount / steps.length) * 100 : 0} level={level} />
        <p style={{ margin: '14px 0 32px', fontFamily: 'var(--font-text)', fontSize: 14, lineHeight: 1.5, color: 'var(--color-fg-secondary)' }}>
          Complete each part to unlock the next.
        </p>
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', left: 27, top: 42, width: 2, height: Math.max(0, steps.length - 1) * ROW, background: 'var(--color-border)' }} />
          <div style={{ position: 'absolute', left: 27, top: 42, width: 2, height: completedCount * ROW, background: '#0A0A0A', transition: 'height 300ms cubic-bezier(0.2,0,0,1)' }} />
          {spine.map((item, i) => (
            <SpineRow key={item.num} item={item} actionLabel={enterLabel} onAction={i === enterableIndex ? onStartLesson : undefined} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Page 6 · Guided room (real lesson session) ────────────────────────

function LessonRoom({ course, unit, onBackToSyllabus, onContinueNext }: {
  course: CoursePackage;
  unit: LearningUnit;
  onBackToSyllabus: () => void;
  onContinueNext: () => void;
}) {
  // Personalization (persisted on-device). Threaded into the ACTUAL selected
  // tutor prompt (via useLessonSession → runLessonTurn) AND the helper actions.
  const [preference, setPreference] = useState<TeachingPreference | null>(() => loadTeachingPreference());
  const [personalizeOpen, setPersonalizeOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const teachingPreference = preference ?? undefined;

  const session = useLessonSession({ course, unit, teachingPreference: preference });
  // Deterministic flow reuses THIS SAME guided room — only the chat engine
  // differs. Both hooks run unconditionally (hook rules); we pick which one
  // drives the UI. Deterministic is the ONLY lesson-management experience now;
  // we fall back to the current flow only when a unit has no prepared steps.
  const dChat = useDeterministicChat({ unit });
  const deterministicActive = hasDeterministicSteps(unit);
  // Helper actions run through the assistant service (prompts/AI/video live
  // there, not here). Main "Send answer" stays on the lesson runtime.
  const { service, ready } = useLessonAssistant();

  // The active chat engine, normalized so the room reads one shape either way.
  const engine = deterministicActive
    ? {
        messages: dChat.messages,
        loading: dChat.loading,
        error: dChat.error,
        dismissError: dChat.dismissError,
        providerReady: dChat.providerReady,
        send: dChat.sendStudentMessage,
        selectMcqOption: dChat.selectMcqOption,
        complete: dChat.status === 'completed',
        stepNumber: dChat.stepNumber,
        totalSteps: dChat.totalSteps,
        completedCount: dChat.completedCount,
        stepLabelText: dChat.currentStepTitle,
        currentStepTitle: dChat.currentStepTitle as string | undefined,
        currentStepContent: dChat.currentStepContent as string | undefined,
      }
    : {
        // The current flow has no MCQ messages; cast keeps one message type.
        messages: session.messages as DeterministicChatMessage[],
        loading: session.loading,
        error: session.error,
        dismissError: session.dismissError,
        providerReady: session.providerReady,
        send: session.sendStudentMessage,
        selectMcqOption: (_option: string) => {},
        complete: session.status === 'completed',
        stepNumber: session.currentStepNumber,
        totalSteps: session.totalSteps,
        completedCount: session.state.completedStepIds.length,
        stepLabelText: session.currentStep ? stepLabel(session.currentStep.question) : 'Wrap up',
        currentStepTitle: undefined as string | undefined,
        currentStepContent: session.currentStep?.question as string | undefined,
      };
  const providerReady = engine.providerReady;

  const [answer, setAnswer] = useState('');
  // Helper (Explain/Example) replies live as a local overlay so they never
  // advance the real lesson progress. Cleared when a real answer is sent.
  const [helperMessages, setHelperMessages] = useState<Message[]>([]);
  const [helperLoading, setHelperLoading] = useState(false);
  const [helperError, setHelperError] = useState<string | null>(null);

  const [breakOpen, setBreakOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [sideDraft, setSideDraft] = useState('');
  const [sideMessages, setSideMessages] = useState<Message[]>([]);
  const [sideLoading, setSideLoading] = useState(false);
  const [sideError, setSideError] = useState<string | null>(null);

  // Watch video state.
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [video, setVideo] = useState<RecommendedVideo | null>(null);

  const objectives = unit.teacherBrain.objectives;
  const goalsDone = Math.min(objectives.length, engine.completedCount);
  const lessonComplete = engine.complete;
  const currentQuestion = session.currentStep?.question ?? unit.goal;

  // Combined transcript for display: the active engine's transcript, or (current
  // flow only) the current question as the opening tutor message when empty. In
  // deterministic flow the engine already injects the prepared step message.
  // Non-advancing helper replies are appended after.
  const baseMessages: Message[] =
    engine.messages.length > 0
      ? engine.messages.map((m) => ({ role: m.role, text: m.content, mcq: m.mcq, card: m.card }))
      : deterministicActive
        ? []
        : [{ role: 'tutor', text: currentQuestion }];
  const displayMessages = baseMessages.concat(helperMessages);

  // Shared helper context: grounded in the CURRENT step only (deterministic mode
  // uses the prepared step's title/intro), plus ONLY the last three messages.
  const lessonContext = deterministicActive
    ? { lessonTitle: unit.title, lessonTopic: unit.goal, currentStepTitle: engine.currentStepTitle, currentStepContent: engine.currentStepContent, courseTitle: course.title }
    : { ...getCurrentLessonContext({ lesson: unit, currentStep: session.currentStep }), courseTitle: course.title };
  const lastThreeMessages = engine.messages.slice(-3);

  // Main answer → active engine turn (deterministic engine or lesson runtime).
  const onSend = async () => {
    const text = answer.trim();
    if (!text || engine.loading) return;
    const ok = await engine.send(text);
    if (ok) {
      setAnswer('');
      setHelperMessages([]); // keep the transcript coherent after a real turn
    }
  };

  // Explain / Give an example → assistant service, NO progress change (overlay).
  const runHelper = async (call: () => Promise<string>) => {
    if (helperLoading || engine.loading) return;
    if (!ready) {
      setHelperError(NO_PROVIDER_MESSAGE);
      return;
    }
    setHelperError(null);
    setHelperLoading(true);
    try {
      const text = await call();
      setHelperMessages((m) => m.concat({ role: 'tutor', text }));
    } catch {
      setHelperError(TUTOR_FAIL_MESSAGE);
    } finally {
      setHelperLoading(false);
    }
  };
  const explainSimpler = () => runHelper(() => service.explainSimpler({ lessonContext, lastThreeMessages, teachingPreference }));
  const giveExample = () => runHelper(() => service.giveExample({ lessonContext, lastThreeMessages, teachingPreference }));

  // Challenge me → challenge coach in the drawer. Asks one question at a time and
  // gives feedback on the learner's answer. It stays on the current step and
  // NEVER advances the main lesson or writes progress. `studentAnswer` is empty
  // for the opening turn (the coach asks the first question).
  const runChallengeTurn = async (studentAnswer: string) => {
    if (sideLoading) return;
    if (!ready) {
      setSideError(NO_PROVIDER_MESSAGE);
      return;
    }
    setSideError(null);
    const transcript = sideMessages.map((m) => ({ role: m.role, content: m.text }));
    if (studentAnswer) setSideMessages((m) => m.concat({ role: 'student', text: studentAnswer }));
    setSideLoading(true);
    try {
      const reply = await service.askChallenge({ lessonContext, transcript, studentAnswer, teachingPreference });
      setSideMessages((m) => m.concat({ role: 'tutor', text: reply }));
    } catch {
      setSideError(TUTOR_FAIL_MESSAGE);
    } finally {
      setSideLoading(false);
    }
  };
  // Opening the drawer starts the challenge (asks the first question) once.
  const openChallenge = () => {
    setSideOpen(true);
    if (sideMessages.length === 0 && !sideLoading) void runChallengeTurn('');
  };
  const sendChallenge = () => {
    const text = sideDraft.trim();
    if (!text) return;
    setSideDraft('');
    void runChallengeTurn(text);
  };

  // Watch video → assistant/video service; embed inline (no redirect). Loaded
  // once per lesson and cached so reopening is instant.
  const openVideo = async () => {
    setVideoOpen(true);
    if (video || videoLoading) return;
    setVideoError(null);
    setVideoLoading(true);
    try {
      const rec = await service.getRecommendedVideo({ lessonContext, teachingPreference });
      setVideo(rec);
    } catch (err) {
      setVideoError(
        err instanceof Error && err.name === 'VideoSearchNotConfiguredError'
          ? 'Video search is not configured.'
          : 'We could not find a video for this lesson right now. Please try again.',
      );
    } finally {
      setVideoLoading(false);
    }
  };

  // Personalization handlers. Changing the preference invalidates the cached
  // video so the next "Watch video" reflects the new style. None of this
  // touches lesson progress.
  const applyPreference = (p: TeachingPreference | null) => {
    setPreference(p);
    if (p) saveTeachingPreference(p);
    else clearTeachingPreference();
    setVideo(null); // preference changed → next "Watch video" re-fetches
    setVideoError(null);
  };
  const selectPreset = (id: string) => {
    const p = presetPreference(id);
    if (p) {
      applyPreference(p);
      setCustomDraft('');
    }
  };
  const saveCustom = () => {
    const p = customPreference(customDraft);
    if (p) {
      applyPreference(p);
      setPersonalizeOpen(false);
    }
  };
  const clearPersonalization = () => {
    applyPreference(null);
    setCustomDraft('');
  };

  return (
    <GuidedRoomView
      courseTitle={course.title}
      unitTitle={unit.title}
      stepLabelText={engine.stepLabelText}
      stepNumber={engine.stepNumber}
      totalSteps={engine.totalSteps}
      objectives={objectives}
      goalsDone={goalsDone}
      messages={displayMessages}
      answer={answer}
      onAnswer={setAnswer}
      onSend={onSend}
      onExplain={explainSimpler}
      onExample={giveExample}
      onSelectMcqOption={engine.selectMcqOption}
      loading={engine.loading || helperLoading}
      error={engine.error ?? helperError}
      onDismissError={() => {
        engine.dismissError();
        setHelperError(null);
      }}
      providerReady={providerReady}
      lessonComplete={lessonComplete}
      onBackToSyllabus={onBackToSyllabus}
      onContinueNext={onContinueNext}
      breakOpen={breakOpen}
      onOpenBreak={() => setBreakOpen(true)}
      onCloseBreak={() => setBreakOpen(false)}
      videoOpen={videoOpen}
      onOpenVideo={openVideo}
      onCloseVideo={() => setVideoOpen(false)}
      videoLoading={videoLoading}
      videoError={videoError}
      video={video}
      teachingPreference={preference}
      personalizeOpen={personalizeOpen}
      onOpenPersonalize={() => setPersonalizeOpen(true)}
      onClosePersonalize={() => setPersonalizeOpen(false)}
      customDraft={customDraft}
      onCustomDraft={setCustomDraft}
      onSelectPreset={selectPreset}
      onSaveCustom={saveCustom}
      onClearPersonalization={clearPersonalization}
      sideOpen={sideOpen}
      onOpenSide={openChallenge}
      onCloseSide={() => setSideOpen(false)}
      sideMessages={sideMessages}
      sideDraft={sideDraft}
      onSideDraft={setSideDraft}
      onSendSide={sendChallenge}
      sideLoading={sideLoading}
      sideError={sideError}
    />
  );
}

interface RoomProps {
  courseTitle: string;
  unitTitle: string;
  stepLabelText: string;
  stepNumber: number;
  totalSteps: number;
  objectives: string[];
  goalsDone: number;
  messages: Message[];
  answer: string;
  onAnswer: (v: string) => void;
  onSend: () => void;
  onExplain: () => void;
  onExample: () => void;
  onSelectMcqOption: (option: string) => void;
  loading: boolean;
  error: string | null;
  onDismissError: () => void;
  providerReady: boolean;
  lessonComplete: boolean;
  onBackToSyllabus: () => void;
  onContinueNext: () => void;
  breakOpen: boolean;
  onOpenBreak: () => void;
  onCloseBreak: () => void;
  videoOpen: boolean;
  onOpenVideo: () => void;
  onCloseVideo: () => void;
  videoLoading: boolean;
  videoError: string | null;
  video: RecommendedVideo | null;
  teachingPreference: TeachingPreference | null;
  personalizeOpen: boolean;
  onOpenPersonalize: () => void;
  onClosePersonalize: () => void;
  customDraft: string;
  onCustomDraft: (v: string) => void;
  onSelectPreset: (id: string) => void;
  onSaveCustom: () => void;
  onClearPersonalization: () => void;
  sideOpen: boolean;
  onOpenSide: () => void;
  onCloseSide: () => void;
  sideMessages: Message[];
  sideDraft: string;
  onSideDraft: (v: string) => void;
  onSendSide: () => void;
  sideLoading: boolean;
  sideError: string | null;
}

function GuidedRoomView(p: RoomProps) {
  const busy = p.loading || !p.providerReady;
  const sendDisabled = !p.answer.trim() || busy;
  const sideDisabled = !p.sideDraft.trim() || p.sideLoading || !p.providerReady;
  // Auto-scroll the chat to the newest message (student turn, tutor reply,
  // injected deterministic message, or next-step message). Applies to both flows.
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [p.messages.length, p.loading]);

  return (
    <div className="mds" style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)', position: 'relative', overflow: 'hidden' }}>
      {/* header */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '16px 28px', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
          <button
            type="button"
            className="mds-btn mds-btn-ghost"
            onClick={p.onBackToSyllabus}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 36, padding: '0 15px 0 11px', borderRadius: 9999, border: '1px solid var(--color-border-strong)', background: 'transparent', color: 'var(--color-fg)', fontFamily: 'var(--font-text)', fontSize: 14, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back to lesson path
          </button>
          <div style={{ fontFamily: 'var(--font-text)', fontSize: 14, fontWeight: 500, color: 'var(--color-fg-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {p.courseTitle}&ensp;·&ensp;{p.unitTitle}&ensp;·&ensp;<span style={{ color: 'var(--color-fg)', fontWeight: 600 }}>{p.stepLabelText}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 'none' }}>
          <button
            type="button"
            className="mds-btn mds-btn-ghost"
            onClick={p.onOpenBreak}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 36, padding: '0 15px', borderRadius: 9999, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-fg-secondary)', fontFamily: 'var(--font-text)', fontSize: 14, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', flex: 'none' }}
          >
            Take a break
          </button>
        </div>
      </div>

      {/* lesson goals strip (real objectives) */}
      <div style={{ flex: 'none', padding: '14px 28px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-muted)', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flex: 'none' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', color: 'var(--color-fg)' }}>Lesson goals</span>
          <span style={{ fontFamily: 'var(--font-text)', fontSize: 12, whiteSpace: 'nowrap', color: 'var(--color-fg-tertiary)' }}>{p.goalsDone} of {p.objectives.length}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {p.objectives.map((g, i) => {
            const done = i < p.goalsDone;
            const active = i === p.goalsDone;
            return (
              <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 32, padding: '5px 12px', borderRadius: 16, border: '1px solid var(--color-border)', background: 'var(--color-surface)', maxWidth: 360 }}>
                <span style={{ flex: 'none', width: 18, height: 18, borderRadius: 9999, border: `1.5px solid ${done || active ? '#0A0A0A' : 'var(--color-border-strong)'}`, background: done ? '#0A0A0A' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {done && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </span>
                <span style={{ fontFamily: 'var(--font-text)', fontSize: 13, fontWeight: 500, lineHeight: 1.35, color: done || active ? 'var(--color-fg)' : 'var(--color-fg-tertiary)' }}>{g}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* main region: centered chat + right-side drawer */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minHeight: 0 }}>
        <div style={{ width: '100%', maxWidth: 760, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ flex: 'none', padding: '16px 30px 0' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', height: 26, padding: '0 12px', borderRadius: 9999, background: 'var(--color-bg-subtle)', fontFamily: 'var(--font-text)', fontSize: 12, fontWeight: 600, letterSpacing: '0.02em', whiteSpace: 'nowrap', color: 'var(--color-fg-secondary)' }}>
              Step {p.stepNumber} of {p.totalSteps} · {p.stepLabelText}
            </span>
          </div>
          <div className="mds-scroll" style={{ flex: 1, overflowY: 'auto', padding: '18px 30px' }}>
            {p.messages.map((m, i) => (
              <ChatBubble key={i} message={m} onSelectMcqOption={p.onSelectMcqOption} />
            ))}
            {p.loading && (
              <div style={{ fontFamily: 'var(--font-text)', fontSize: 13, color: 'var(--color-fg-tertiary)', margin: '2px 0 8px 42px' }}>
                Tutor is thinking…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {!p.lessonComplete && (
            <div style={{ flex: 'none', borderTop: '1px solid var(--color-border)', padding: '16px 24px', background: 'var(--color-bg)' }}>
              <textarea
                value={p.answer}
                onChange={(e) => p.onAnswer(e.target.value)}
                placeholder="Type your answer here..."
                rows={2}
                disabled={busy}
                style={{ width: '100%', boxSizing: 'border-box', resize: 'none', border: '1px solid var(--color-border-input)', borderRadius: 12, padding: '11px 14px', fontFamily: 'var(--font-text)', fontSize: 15, lineHeight: 1.5, color: 'var(--color-fg)', background: '#fff', outline: 'none', opacity: busy ? 0.6 : 1 }}
              />
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    disabled={sendDisabled}
                    onClick={p.onSend}
                    style={{ height: 44, padding: '0 22px', border: 'none', borderRadius: 9999, background: sendDisabled ? '#E2E1DA' : '#0A0A0A', color: sendDisabled ? '#AAAAA5' : '#FFFFFF', fontFamily: 'var(--font-text)', fontSize: 15, fontWeight: 600, cursor: sendDisabled ? 'not-allowed' : 'pointer' }}
                  >
                    Send answer
                  </button>
                  <button type="button" disabled={busy} className="mds-btn mds-btn-ghost" onClick={p.onExplain} style={{ ...helperBtn, opacity: busy ? 0.5 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}>Explain simpler</button>
                  <button type="button" disabled={busy} className="mds-btn mds-btn-ghost" onClick={p.onExample} style={{ ...helperBtn, opacity: busy ? 0.5 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}>Give an example</button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button type="button" className="mds-btn mds-btn-ghost" onClick={p.onOpenSide} style={iconBtn}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="m2 17 10 5 10-5M2 12l10 5 10-5" /></svg>
                    Challenge me
                  </button>
                  <button type="button" className="mds-btn mds-btn-ghost" onClick={p.onOpenVideo} style={iconBtn}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="15" height="14" rx="2" /><path d="M17 9l5-3v12l-5-3" /></svg>
                    Watch video
                  </button>
                  <button
                    type="button"
                    className="mds-btn mds-btn-ghost"
                    onClick={p.onOpenPersonalize}
                    style={{ ...iconBtn, borderColor: p.teachingPreference ? 'var(--color-fg)' : 'var(--color-border)', color: p.teachingPreference ? 'var(--color-fg)' : 'var(--color-fg-secondary)' }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /><circle cx="12" cy="12" r="3.2" /></svg>
                    Personalize
                  </button>
                  {p.teachingPreference && (
                    <>
                      <span style={{ fontFamily: 'var(--font-text)', fontSize: 13, fontWeight: 600, color: 'var(--color-fg)', whiteSpace: 'nowrap' }}>
                        Active: {p.teachingPreference.label ?? 'Custom'}
                      </span>
                      <button
                        type="button"
                        onClick={p.onClearPersonalization}
                        style={{ background: 'transparent', border: 'none', padding: 0, color: 'var(--color-fg-tertiary)', fontFamily: 'var(--font-text)', fontSize: 13, textDecoration: 'underline', cursor: 'pointer' }}
                      >
                        Remove personalization
                      </button>
                    </>
                  )}
                </div>
              </div>
              {!p.providerReady && (
                <p style={{ margin: '10px 2px 0', fontFamily: 'var(--font-text)', fontSize: 13, color: 'var(--color-fg-tertiary)' }}>
                  {NO_PROVIDER_MESSAGE} <Link to="/guide" style={{ color: 'var(--color-fg)', textDecoration: 'underline' }}>Choose your AI guide</Link>.
                </p>
              )}
              {p.error && (
                <p style={{ margin: '10px 2px 0', fontFamily: 'var(--font-text)', fontSize: 13, color: 'var(--sunset-text)' }}>
                  {p.error}{' '}
                  <button type="button" onClick={p.onDismissError} style={{ background: 'transparent', border: 'none', padding: 0, color: 'var(--color-fg-tertiary)', fontFamily: 'var(--font-text)', fontSize: 13, textDecoration: 'underline', cursor: 'pointer' }}>Dismiss</button>
                </p>
              )}
            </div>
          )}

          {p.lessonComplete && (
            <div style={{ flex: 'none', borderTop: '1px solid var(--color-border)', padding: '18px 24px', background: 'var(--color-surface)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 9999, background: 'var(--success-tile)', color: 'var(--success-icon)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--color-fg)' }}>Lesson complete</div>
                  <div style={{ fontFamily: 'var(--font-text)', fontSize: 13, color: 'var(--color-fg-secondary)' }}>You finished: {p.unitTitle}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, flex: 'none' }}>
                <button type="button" className="mds-btn mds-btn-ghost" onClick={p.onBackToSyllabus} style={{ height: 42, padding: '0 18px', borderRadius: 9999, border: '1px solid var(--color-border-strong)', background: 'transparent', color: 'var(--color-fg)', fontFamily: 'var(--font-text)', fontSize: 14, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Back to lesson path</button>
                <button type="button" className="mds-btn mds-btn-dark" onClick={p.onContinueNext} style={{ height: 42, padding: '0 20px', borderRadius: 9999, border: 'none', background: '#0A0A0A', color: '#fff', fontFamily: 'var(--font-text)', fontSize: 14, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Continue to next lesson</button>
              </div>
            </div>
          )}
        </div>

        {/* side questions drawer */}
        {p.sideOpen && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 40, display: 'flex', justifyContent: 'flex-end' }}>
            <div onClick={p.onCloseSide} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.14)' }} />
            <div style={{ position: 'relative', width: 380, maxWidth: '88%', height: '100%', background: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ flex: 'none', padding: '18px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: 'var(--color-fg)' }}>Challenge me</div>
                  <div style={{ marginTop: 4, fontFamily: 'var(--font-text)', fontSize: 13, lineHeight: 1.45, color: 'var(--color-fg-secondary)' }}>Practice questions on this step. It won't move the lesson forward.</div>
                </div>
                <button type="button" className="mds-btn mds-btn-ghost" onClick={p.onCloseSide} style={closeBtn}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="mds-scroll" style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
                {p.sideMessages.length === 0 && !p.sideLoading && (
                  <div style={{ fontFamily: 'var(--font-text)', fontSize: 13, lineHeight: 1.5, color: 'var(--color-fg-secondary)' }}>
                    Answer each challenge in your own words. The coach gives quick feedback and keeps you on this step — your lesson progress won't change.
                  </div>
                )}
                {p.sideMessages.map((m, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: m.role === 'student' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
                    {m.role === 'tutor' ? (
                      <div style={{ maxWidth: '88%', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '14px 14px 14px 4px', padding: '10px 12px', fontFamily: 'var(--font-text)', fontSize: 13, lineHeight: 1.5, color: 'var(--color-fg)' }}>{m.text}</div>
                    ) : (
                      <div style={{ maxWidth: '88%', background: '#0A0A0A', color: '#fff', borderRadius: '14px 14px 4px 14px', padding: '10px 12px', fontFamily: 'var(--font-text)', fontSize: 13, lineHeight: 1.5 }}>{m.text}</div>
                    )}
                  </div>
                ))}
                {p.sideLoading && (
                  <div style={{ fontFamily: 'var(--font-text)', fontSize: 12, color: 'var(--color-fg-tertiary)' }}>Tutor is thinking…</div>
                )}
              </div>
              <div style={{ flex: 'none', borderTop: '1px solid var(--color-border)', padding: '14px 16px' }}>
                <input
                  value={p.sideDraft}
                  onChange={(e) => p.onSideDraft(e.target.value)}
                  placeholder="Type your answer..."
                  disabled={p.sideLoading || !p.providerReady}
                  style={{ width: '100%', boxSizing: 'border-box', height: 40, border: '1px solid var(--color-border-input)', borderRadius: 12, padding: '0 12px', fontFamily: 'var(--font-text)', fontSize: 14, color: 'var(--color-fg)', background: '#fff', outline: 'none', opacity: p.sideLoading || !p.providerReady ? 0.6 : 1 }}
                />
                <button
                  type="button"
                  disabled={sideDisabled}
                  onClick={p.onSendSide}
                  style={{ marginTop: 10, width: '100%', height: 38, border: 'none', borderRadius: 9999, background: sideDisabled ? '#E2E1DA' : '#0A0A0A', color: sideDisabled ? '#AAAAA5' : '#FFFFFF', fontFamily: 'var(--font-text)', fontSize: 13, fontWeight: 600, cursor: sideDisabled ? 'not-allowed' : 'pointer' }}
                >
                  Send answer
                </button>
                {!p.providerReady && (
                  <p style={{ margin: '8px 0 0', fontFamily: 'var(--font-text)', fontSize: 12, color: 'var(--color-fg-tertiary)' }}>{NO_PROVIDER_MESSAGE}</p>
                )}
                {p.sideError && (
                  <p style={{ margin: '8px 0 0', fontFamily: 'var(--font-text)', fontSize: 12, color: 'var(--sunset-text)' }}>{p.sideError}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* take a break modal */}
      {p.breakOpen && (
        <ModalScrim>
          <div style={{ width: 380, maxWidth: '86%', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 24, boxShadow: 'var(--shadow-lg)', padding: 32, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ width: 52, height: 52, borderRadius: 9999, background: 'var(--color-bg-subtle)', color: 'var(--color-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="8" y="4" width="3" height="16" rx="1.2" /><rect x="14" y="4" width="3" height="16" rx="1.2" /></svg>
            </span>
            <div style={{ marginTop: 18, fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--color-fg)' }}>Take a break</div>
            <div style={{ marginTop: 8, fontFamily: 'var(--font-text)', fontSize: 15, lineHeight: 1.5, color: 'var(--color-fg-secondary)' }}>
              Your progress is saved.
              <br />
              Come back when you're ready.
            </div>
            <button type="button" className="mds-btn mds-btn-dark" onClick={p.onCloseBreak} style={{ marginTop: 24, height: 46, padding: '0 26px', border: 'none', borderRadius: 9999, background: '#0A0A0A', color: '#fff', fontFamily: 'var(--font-text)', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
              Resume lesson
            </button>
          </div>
        </ModalScrim>
      )}

      {/* related video modal */}
      {p.videoOpen && (
        <ModalScrim>
          <div style={{ width: 560, maxWidth: '90%', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 24, boxShadow: 'var(--shadow-lg)', padding: 28 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, color: 'var(--color-fg)' }}>Related video</div>
                <div style={{ marginTop: 4, fontFamily: 'var(--font-text)', fontSize: 14, lineHeight: 1.45, color: 'var(--color-fg-secondary)' }}>Watch a short video that supports this lesson.</div>
              </div>
              <button type="button" className="mds-btn mds-btn-ghost" onClick={p.onCloseVideo} style={closeBtn}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div style={{ marginTop: 18, position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: 16, background: '#0A0A0A', border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {p.videoLoading && (
                <span style={{ fontFamily: 'var(--font-text)', fontSize: 14, color: 'rgba(255,255,255,0.8)' }}>Finding a relevant video…</span>
              )}
              {!p.videoLoading && p.videoError && (
                <span style={{ fontFamily: 'var(--font-text)', fontSize: 14, color: 'rgba(255,255,255,0.85)', padding: '0 24px', textAlign: 'center' }}>{p.videoError}</span>
              )}
              {/* A specific embeddable video → embed it inline. */}
              {!p.videoLoading && !p.videoError && p.video && p.video.embedUrl && (
                <iframe
                  key={p.video.embedUrl}
                  src={p.video.embedUrl}
                  title={p.video.title}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
                  allow="encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              )}
              {/* Keyless fallback → we can't embed a search page, so offer a
                  clear, topic-scoped link the learner can open on YouTube. */}
              {!p.videoLoading && !p.videoError && p.video && !p.video.embedUrl && p.video.watchUrl && (
                <div style={{ padding: '0 28px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
                  <span style={{ fontFamily: 'var(--font-text)', fontSize: 14, lineHeight: 1.5, color: 'rgba(255,255,255,0.85)' }}>
                    Open beginner-friendly videos for this lesson on YouTube.
                  </span>
                  <a
                    href={p.video.watchUrl}
                    target="lessonVideoTab"
                    rel="noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 44, padding: '0 22px', borderRadius: 9999, background: '#fff', color: '#0A0A0A', fontFamily: 'var(--font-text)', fontSize: 15, fontWeight: 600, textDecoration: 'none' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="15" height="14" rx="2" /><path d="M17 9l5-3v12l-5-3" /></svg>
                    Watch on YouTube
                  </a>
                </div>
              )}
            </div>
            <div style={{ marginTop: 12, textAlign: 'center', fontFamily: 'var(--font-text)', fontSize: 13, color: 'var(--color-fg-tertiary)' }}>
              {p.video && !p.videoLoading && !p.videoError ? p.video.title : 'A relevant lesson video for this topic.'}
            </div>
            {/* Always offer a direct "open on YouTube" link when we have one
                (also handy when the embedded player is restricted). */}
            {!p.videoLoading && !p.videoError && p.video?.embedUrl && p.video?.watchUrl && (
              <div style={{ marginTop: 6, textAlign: 'center' }}>
                <a
                  href={p.video.watchUrl}
                  target="lessonVideoTab"
                  rel="noreferrer"
                  style={{ fontFamily: 'var(--font-text)', fontSize: 13, color: 'var(--color-fg-secondary)', textDecoration: 'underline' }}
                >
                  Open on YouTube ↗
                </a>
              </div>
            )}
            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="mds-btn mds-btn-ghost" onClick={p.onCloseVideo} style={{ height: 44, padding: '0 24px', borderRadius: 9999, border: '1px solid var(--color-border-strong)', background: 'transparent', color: 'var(--color-fg)', fontFamily: 'var(--font-text)', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        </ModalScrim>
      )}

      {/* personalize modal */}
      {p.personalizeOpen && (
        <ModalScrim>
          <div style={{ width: 460, maxWidth: '92%', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 24, boxShadow: 'var(--shadow-lg)', padding: 28 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, color: 'var(--color-fg)' }}>How should the tutor teach you?</div>
                <div style={{ marginTop: 4, fontFamily: 'var(--font-text)', fontSize: 14, lineHeight: 1.45, color: 'var(--color-fg-secondary)' }}>Choose a teaching style. You can change or remove it anytime.</div>
              </div>
              <button type="button" className="mds-btn mds-btn-ghost" onClick={p.onClosePersonalize} style={closeBtn}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div style={{ marginTop: 18, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {CLASSIC_PERSONALIZATION_OPTIONS.map((opt) => {
                const selected = p.teachingPreference?.source === 'preset' && p.teachingPreference.presetId === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => p.onSelectPreset(opt.id)}
                    title={opt.instruction}
                    style={{ height: 34, padding: '0 14px', borderRadius: 9999, cursor: 'pointer', fontFamily: 'var(--font-text)', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', border: `1px solid ${selected ? '#0A0A0A' : 'var(--color-border-strong)'}`, background: selected ? '#0A0A0A' : 'transparent', color: selected ? '#fff' : 'var(--color-fg)' }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <label style={{ display: 'block', marginTop: 20, fontFamily: 'var(--font-text)', fontSize: 13, fontWeight: 600, color: 'var(--color-fg)' }}>
              Custom teaching preference
            </label>
            <input
              value={p.customDraft}
              maxLength={CUSTOM_PREFERENCE_MAX_LENGTH}
              onChange={(e) => p.onCustomDraft(e.target.value)}
              placeholder="Example: Use code examples and explain slowly"
              style={{ width: '100%', boxSizing: 'border-box', marginTop: 8, height: 40, border: '1px solid var(--color-border-input)', borderRadius: 12, padding: '0 12px', fontFamily: 'var(--font-text)', fontSize: 15, color: 'var(--color-fg)', background: '#fff', outline: 'none' }}
            />
            <div style={{ marginTop: 6, fontFamily: 'var(--font-text)', fontSize: 12, color: 'var(--color-fg-tertiary)' }}>{p.customDraft.length}/{CUSTOM_PREFERENCE_MAX_LENGTH}</div>

            <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <button
                type="button"
                onClick={p.onClearPersonalization}
                disabled={!p.teachingPreference}
                style={{ background: 'transparent', border: 'none', padding: 0, color: p.teachingPreference ? 'var(--color-fg-secondary)' : 'var(--color-fg-disabled)', fontFamily: 'var(--font-text)', fontSize: 14, textDecoration: 'underline', cursor: p.teachingPreference ? 'pointer' : 'not-allowed' }}
              >
                Remove personalization
              </button>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="mds-btn mds-btn-ghost" onClick={p.onClosePersonalize} style={{ height: 42, padding: '0 18px', borderRadius: 9999, border: '1px solid var(--color-border-strong)', background: 'transparent', color: 'var(--color-fg)', fontFamily: 'var(--font-text)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Done</button>
                <button
                  type="button"
                  disabled={!p.customDraft.trim()}
                  onClick={p.onSaveCustom}
                  style={{ height: 42, padding: '0 20px', borderRadius: 9999, border: 'none', background: p.customDraft.trim() ? '#0A0A0A' : '#E2E1DA', color: p.customDraft.trim() ? '#fff' : '#AAAAA5', fontFamily: 'var(--font-text)', fontSize: 14, fontWeight: 600, cursor: p.customDraft.trim() ? 'pointer' : 'not-allowed' }}
                >
                  Save custom
                </button>
              </div>
            </div>
          </div>
        </ModalScrim>
      )}
    </div>
  );
}

function ChatBubble({ message, onSelectMcqOption }: { message: Message; onSelectMcqOption?: (option: string) => void }) {
  if (message.role === 'student') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <div style={{ maxWidth: '80%', background: '#0A0A0A', color: '#fff', borderRadius: '16px 16px 4px 16px', padding: '14px 16px', fontFamily: 'var(--font-text)', fontSize: 15, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{message.text}</div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', maxWidth: '80%' }}>
        <span style={{ flex: 'none', width: 30, height: 30, borderRadius: 9999, background: 'var(--lavender-tile)', color: 'var(--lavender-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c.3 3.6 2.4 5.7 6 6-3.6.3-5.7 2.4-6 6-.3-3.6-2.4-5.7-6-6 3.6-.3 5.7-2.4 6-6z" /></svg>
        </span>
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '16px 16px 16px 4px', padding: '14px 16px', fontFamily: 'var(--font-text)', fontSize: 15, lineHeight: 1.55, color: 'var(--color-fg)' }}>
          {message.card ? (
            <ChatLessonCardView card={message.card} />
          ) : (
            <Paragraphs text={message.text} style={{ fontFamily: 'var(--font-text)', fontSize: 15, lineHeight: 1.55, color: 'var(--color-fg)' }} />
          )}
          {message.mcq && <ChatMcqChoices mcq={message.mcq} onSelect={onSelectMcqOption} />}
        </div>
      </div>
    </div>
  );
}

const CARD_LABEL: React.CSSProperties = {
  fontFamily: 'var(--font-text)',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--color-fg-tertiary)',
  margin: '0 0 4px',
};

/** Render text as spaced paragraphs, splitting on blank lines so long text isn't one dense block. */
function Paragraphs({ text, style }: { text: string; style: React.CSSProperties }) {
  const parts = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {parts.map((p, i) => (
        <div key={i} style={{ ...style, whiteSpace: 'pre-wrap' }}>{p}</div>
      ))}
    </div>
  );
}

/** Renders a prepared "mini lesson" card in the guided room: title + sections + code block. */
function ChatLessonCardView({ card }: { card: ChatLessonCard }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {(card.eyebrow || card.title) && (
        <div>
          {card.eyebrow && <div style={CARD_LABEL}>{card.eyebrow}</div>}
          {card.title && (
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, lineHeight: 1.25, color: 'var(--color-fg)' }}>{card.title}</div>
          )}
        </div>
      )}
      <div>
        {card.bodyLabel && <div style={CARD_LABEL}>{card.bodyLabel}</div>}
        <Paragraphs text={card.body} style={{ fontFamily: 'var(--font-text)', fontSize: 15, lineHeight: 1.55, color: 'var(--color-fg)' }} />
      </div>
      {card.example && (
        <div>
          <div style={CARD_LABEL}>Example</div>
          <pre style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13, lineHeight: 1.55, color: 'var(--color-fg)', background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '10px 12px', margin: 0, whiteSpace: 'pre-wrap', overflowX: 'auto' }}>{card.example}</pre>
        </div>
      )}
      {card.prompt && (
        <div>
          <div style={CARD_LABEL}>Try it</div>
          <div style={{ fontFamily: 'var(--font-text)', fontSize: 15, fontWeight: 600, lineHeight: 1.5, color: 'var(--color-fg)', borderLeft: '3px solid #0A0A0A', paddingLeft: 12 }}>{card.prompt}</div>
        </div>
      )}
    </div>
  );
}

/** Prepared MCQ rendered inline in the guided-room chat: question + choices. */
function ChatMcqChoices({ mcq, onSelect }: { mcq: ChatMcqView; onSelect?: (option: string) => void }) {
  const answered = Boolean(mcq.selectedOption);
  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={CARD_LABEL}>Quick check</div>
      <div style={{ fontFamily: 'var(--font-text)', fontSize: 14, fontWeight: 600, lineHeight: 1.45, color: 'var(--color-fg)' }}>{mcq.question}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {mcq.options.map((option) => {
          const isSelected = mcq.selectedOption === option;
          const isCorrect = mcq.correctOption === option;
          let borderColor = 'var(--color-border-strong)';
          let bg = 'var(--color-bg)';
          if (answered && isCorrect) { borderColor = 'var(--success-icon, #157347)'; bg = 'var(--success-tile, #eaf6ee)'; }
          else if (answered && isSelected && !isCorrect) { borderColor = 'var(--sunset-text, #b42318)'; }
          return (
            <button
              key={option}
              type="button"
              disabled={answered || !onSelect}
              onClick={() => onSelect?.(option)}
              style={{ textAlign: 'left', fontFamily: 'var(--font-text)', fontSize: 14, lineHeight: 1.45, padding: '10px 14px', borderRadius: 12, border: `1px solid ${borderColor}`, background: bg, color: 'var(--color-fg)', cursor: answered || !onSelect ? 'default' : 'pointer', opacity: answered && !isSelected && !isCorrect ? 0.6 : 1 }}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ModalScrim({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </div>
  );
}

const helperBtn: React.CSSProperties = { height: 44, padding: '0 16px', borderRadius: 9999, border: '1px solid var(--color-border-strong)', background: 'transparent', color: 'var(--color-fg)', fontFamily: 'var(--font-text)', fontSize: 14, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' };
const iconBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 15px', borderRadius: 9999, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-fg-secondary)', fontFamily: 'var(--font-text)', fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' };
const closeBtn: React.CSSProperties = { flex: 'none', width: 32, height: 32, borderRadius: 9999, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-fg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' };
