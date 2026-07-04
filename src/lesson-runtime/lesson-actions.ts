// ── Lesson Runtime — action / progression logic ──────────────────────
//
// The runtime — not the model — owns lesson progression. The model returns a
// structured TutorResponse whose `nextAction` is a *suggestion*; this pure
// function decides the resulting state transition. Rules (per spec):
//
//   ask_question | give_hint | explain → stay on the current step
//   continue                           → complete current step, advance;
//                                        past the last step ⇒ lesson completed
//   finish                             → complete all steps, lesson completed
//
// When `allowCompletion` is false the lesson can never reach the terminal
// `completed` status: any transition that would complete it is downgraded to
// `in_progress` (staying on the last step), so the lesson stays open forever.
// This mirrors the harness's "lesson completion disabled" mode as a user option.
//
// Returns a NEW state; never mutates its input.

import type { TutorResponse } from '../tutor-runtime';
import type { LessonSessionState } from './lesson-state';
import { currentStepId } from './lesson-state';

function withStepCompleted(
  completed: string[],
  stepId: string | undefined,
): string[] {
  if (!stepId || completed.includes(stepId)) return completed;
  return [...completed, stepId];
}

export function applyTutorAction(params: {
  state: LessonSessionState;
  response: TutorResponse;
  /** When false, the lesson can never reach `completed` (stays open forever). */
  allowCompletion?: boolean;
}): LessonSessionState {
  const { state, response, allowCompletion = true } = params;

  // The model's level estimate always feeds forward (cheap, always useful).
  const base: LessonSessionState = {
    ...state,
    levelEstimate: response.studentLevelEstimate,
  };

  const next = decideNextState({ base, action: response.nextAction });

  // Completion disabled → never let the lesson terminate. Keep every completed
  // step (so progress still reflects the work) but hold the learner on the last
  // step in `in_progress`, so the input never turns into a "done" state.
  if (!allowCompletion && next.status === 'completed') {
    return {
      ...next,
      status: 'in_progress',
      currentStepIndex: Math.min(next.currentStepIndex, Math.max(base.stepIds.length - 1, 0)),
    };
  }

  return next;
}

/** Pure step/status transition for an action, ignoring the completion toggle. */
function decideNextState(params: {
  base: LessonSessionState;
  action: TutorResponse['nextAction'];
}): LessonSessionState {
  const { base, action } = params;

  switch (action) {
    case 'finish': {
      return {
        ...base,
        completedStepIds: [...base.stepIds],
        currentStepIndex: Math.max(base.stepIds.length - 1, 0),
        status: 'completed',
      };
    }

    case 'continue': {
      const completedStepIds = withStepCompleted(base.completedStepIds, currentStepId(base));
      const isLastStep = base.currentStepIndex >= base.stepIds.length - 1;
      if (isLastStep) {
        // Advancing past the final step finishes the lesson.
        return { ...base, completedStepIds, status: 'completed' };
      }
      return {
        ...base,
        completedStepIds,
        currentStepIndex: base.currentStepIndex + 1,
        status: 'in_progress',
      };
    }

    case 'ask_question':
    case 'give_hint':
    case 'explain':
    default: {
      // Stay on the current step; the lesson is underway.
      return { ...base, status: base.status === 'completed' ? 'completed' : 'in_progress' };
    }
  }
}
