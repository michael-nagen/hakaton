// ── Teacher Harness — lesson action model ────────────────────────────
//
// Core principle of this whole harness: the MODEL DOES NOT EXECUTE ACTIONS.
// The model may *suggest* an action (parsed from an optional JSON envelope in
// its reply). The HARNESS validates that suggestion against the current lesson
// state and the set of actions enabled for the MVP, and only the harness
// applies any resulting state change.
//
// LESSON COMPLETION IS CURRENTLY DISABLED: while tutor quality and lesson flow
// are still being evaluated, the harness never marks a lesson completed and
// never unlocks a next lesson — `complete_lesson` stays in the vocabulary for
// future compatibility but is not executable. The MVP focuses on running tutor
// turns, maintaining lesson memory, scoring behavior, and saving artifacts.
//
// The action vocabulary is intentionally broader than what the MVP executes,
// so new actions can be enabled later without reshaping callers.

import type { LessonState } from './lesson-state.types';

/** All actions the design anticipates. Not all are executable in the MVP. */
export type LessonActionType =
  | 'respond'
  | 'give_hint'
  | 'ask_check_question'
  | 'complete_lesson'
  | 'open_next_lesson'
  | 'retrieve_course_context'
  | 'say_unsure';

/**
 * Actions the harness will actually execute in the MVP. Everything else is a
 * recognised-but-not-enabled action: the harness acknowledges the suggestion
 * but refuses to execute it, and says why.
 *
 * `complete_lesson` is deliberately ABSENT: completion is disabled while tutor
 * quality is being evaluated. Re-enabling it later is adding it back here plus
 * restoring its case in decideAction — nothing else changes.
 */
export const MVP_EXECUTABLE_ACTIONS: readonly LessonActionType[] = [
  'respond',
  'say_unsure',
];

const ALL_ACTIONS: readonly LessonActionType[] = [
  'respond',
  'give_hint',
  'ask_check_question',
  'complete_lesson',
  'open_next_lesson',
  'retrieve_course_context',
  'say_unsure',
];

export function isLessonActionType(value: string): value is LessonActionType {
  return (ALL_ACTIONS as readonly string[]).includes(value);
}

/** A validated intent produced by the model (never executed by the model). */
export interface SuggestedAction {
  type: LessonActionType;
  /** Optional free-text rationale the model attached to its suggestion. */
  reason?: string;
}

/** Outcome of the harness validating + (maybe) executing a suggested action. */
export interface ActionDecision {
  suggested: SuggestedAction;
  /** Whether the action is permitted in the current MVP + state. */
  allowed: boolean;
  /** Whether the harness actually applied a state change for it. */
  executed: boolean;
  /** Human-readable explanation, always populated for debugging. */
  reason: string;
  /** The lesson state after the harness applied any change (new object). */
  nextState: LessonState;
}

/**
 * Validate a model-suggested action against harness rules and apply any
 * allowed state transition. Pure: returns a NEW state, never mutates input.
 *
 * The harness is deliberately conservative — an unknown or not-yet-enabled
 * action is acknowledged but not executed, and the lesson keeps running.
 */
export function decideAction(params: {
  suggested: SuggestedAction;
  state: LessonState;
}): ActionDecision {
  const { suggested, state } = params;
  const next: LessonState = { ...state };

  // Completion is explicitly disabled (not merely "not yet enabled") — give it
  // a dedicated reason so reports/debug show WHY nothing happened.
  if (suggested.type === 'complete_lesson') {
    return {
      suggested,
      allowed: false,
      executed: false,
      reason:
        'Lesson completion is DISABLED in the current MVP: tutor quality and lesson flow are still being evaluated, so the harness never marks a lesson completed or opens the next one. The suggestion was recorded and ignored.',
      nextState: next,
    };
  }

  if (!MVP_EXECUTABLE_ACTIONS.includes(suggested.type)) {
    return {
      suggested,
      allowed: false,
      executed: false,
      reason: `Action "${suggested.type}" is recognised but not enabled for MVP execution. The harness ignored it and continued the lesson.`,
      nextState: next,
    };
  }

  switch (suggested.type) {
    case 'say_unsure': {
      next.lastTutorAction = 'say_unsure';
      return {
        suggested,
        allowed: true,
        executed: true,
        reason: 'Tutor expressed uncertainty rather than inventing an answer. No lesson flow change.',
        nextState: next,
      };
    }

    case 'respond':
    default: {
      next.lastTutorAction = 'respond';
      return {
        suggested,
        allowed: true,
        executed: true,
        reason: 'Ordinary tutor response. No lesson flow change.',
        nextState: next,
      };
    }
  }
}
