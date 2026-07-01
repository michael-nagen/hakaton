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
}): LessonSessionState {
  const { state, response } = params;

  // The model's level estimate always feeds forward (cheap, always useful).
  const base: LessonSessionState = {
    ...state,
    levelEstimate: response.studentLevelEstimate,
  };

  switch (response.nextAction) {
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
