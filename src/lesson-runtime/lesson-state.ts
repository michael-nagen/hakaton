// ── Lesson Runtime — lesson session state ────────────────────────────
//
// The APP owns this state (promoted from teacher-harness/src/runtime).
// The model never sees or mutates it directly: it produces a TutorResponse,
// and the runtime decides the state transition (see lesson-actions.ts).
//
// A "lesson" is one LearningUnit; its "steps" are that unit's questions
// (see lesson-steps.ts). Kept framework-free (no React) so the same runtime
// can back the app, tests, and the offline harness.

import type { LearningUnit } from '../course-package';
import type { StudentLevel } from '../tutor-runtime';
import { buildLessonSteps } from './lesson-steps';

/** Where the learner is in the lesson lifecycle. */
export type LessonStatus = 'not_started' | 'in_progress' | 'completed';

/** One message in the lesson transcript. */
export interface LessonMessage {
  role: 'student' | 'tutor';
  content: string;
}

/**
 * The full lesson state the runtime tracks across turns for a single unit.
 * Serializable by design — this is exactly what the progress store persists.
 */
export interface LessonSessionState {
  courseId: string;
  unitId: string;
  status: LessonStatus;
  /** Ordered step ids (question ids, or a single synthetic id). */
  stepIds: string[];
  /** Index into stepIds of the step currently being worked. */
  currentStepIndex: number;
  /** Step ids the learner has completed. */
  completedStepIds: string[];
  /** How many student messages have been sent per step id. */
  attemptsByStep: Record<string, number>;
  /** Latest model estimate of the learner's level. */
  levelEstimate: StudentLevel;
  /** Full lesson transcript (student + tutor). */
  messages: LessonMessage[];
  /** Turn counter, incremented once per student message. */
  turnCount: number;
}

/**
 * Create a fresh lesson state for a unit, or rehydrate from a persisted state.
 * When `persisted` is supplied it is reconciled against the unit's current
 * steps so a course edit can never leave a dangling step index.
 */
export function initLessonState(params: {
  courseId: string;
  unit: LearningUnit;
  persisted?: LessonSessionState | null;
}): LessonSessionState {
  const { courseId, unit, persisted } = params;
  const stepIds = buildLessonSteps(unit).map((s) => s.id);

  if (persisted && persisted.unitId === unit.id) {
    // Reconcile persisted progress with the current step list.
    const completedStepIds = persisted.completedStepIds.filter((id) => stepIds.includes(id));
    const currentStepIndex = Math.min(
      Math.max(persisted.currentStepIndex, 0),
      Math.max(stepIds.length - 1, 0),
    );
    return {
      courseId,
      unitId: unit.id,
      status: persisted.status,
      stepIds,
      currentStepIndex,
      completedStepIds,
      attemptsByStep: { ...persisted.attemptsByStep },
      levelEstimate: persisted.levelEstimate,
      messages: [...persisted.messages],
      turnCount: persisted.turnCount,
    };
  }

  return {
    courseId,
    unitId: unit.id,
    status: 'not_started',
    stepIds,
    currentStepIndex: 0,
    completedStepIds: [],
    attemptsByStep: {},
    levelEstimate: 'beginner',
    messages: [],
    turnCount: 0,
  };
}

/** The step id currently being worked, or undefined if the lesson has no steps. */
export function currentStepId(state: LessonSessionState): string | undefined {
  return state.stepIds[state.currentStepIndex];
}
