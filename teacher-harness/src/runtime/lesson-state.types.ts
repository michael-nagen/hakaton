// ── Teacher Harness — lesson state (owned by the harness) ────────────
//
// The HARNESS owns this state. The model never sees or mutates it directly.
// The model only produces tutor text and MAY suggest an action; the harness
// decides whether the suggestion is allowed and applies any state change.
//
// Kept intentionally small for the MVP but shaped so more fields/steps can be
// added later without breaking callers.

import type { LessonActionType } from './lesson-actions';

/** Where the learner is in the lesson lifecycle. */
export type LessonStatus = 'not_started' | 'in_progress' | 'completed';

/**
 * Coarse pedagogical step within a lesson. Advisory in the MVP (we do not run
 * a step engine yet) but defined so future harness logic can gate actions on
 * it (e.g. only allow `complete_lesson` once `currentStep === 'wrap_up'`).
 */
export type LessonStep = 'intro' | 'explanation' | 'practice' | 'check' | 'wrap_up';

/**
 * The full lesson state the harness tracks across a scenario run. This is the
 * "controlled runner" memory — flow, progress, and the last action the harness
 * actually executed on behalf of a model suggestion.
 */
export interface LessonState {
  courseId: string;
  unitId: string;
  lessonStatus: LessonStatus;
  currentStep: LessonStep;
  /** Units completed before this lesson (drives the runtime progress hint). */
  completedUnitIds: string[];
  /** Concept ids the learner has demonstrably mastered (future scoring input). */
  masteredConceptIds: string[];
  /** Ids of common mistakes observed so far this lesson. */
  mistakesSeen: string[];
  /** The last action the HARNESS executed (not merely what the model asked). */
  lastTutorAction: LessonActionType;
  /** Turn counter, 1-based, incremented by the harness each turn. */
  turnCount: number;
}

/** Create a fresh lesson state for a scenario run. */
export function initLessonState(params: {
  courseId: string;
  unitId: string;
  completedUnitIds?: string[];
}): LessonState {
  return {
    courseId: params.courseId,
    unitId: params.unitId,
    lessonStatus: 'not_started',
    currentStep: 'intro',
    completedUnitIds: params.completedUnitIds ?? [],
    masteredConceptIds: [],
    mistakesSeen: [],
    lastTutorAction: 'respond',
    turnCount: 0,
  };
}
