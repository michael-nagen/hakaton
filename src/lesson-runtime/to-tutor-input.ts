// ── Lesson Runtime — TutorInput mapping ──────────────────────────────
//
// Maps the app's lesson state + the current unit/step into the minimal,
// provider-agnostic TutorInput that activeTutorProvider.generateTutorResponse
// consumes. Never sends the whole course — only the current step's slice, per
// the Tutor Runtime contract.

import type { LearningUnit } from '../course-package';
import type { TutorInput } from '../tutor-runtime';
import type { LessonSessionState } from './lesson-state';
import type { StepDescriptor } from './lesson-steps';

/** How many recent messages to include as short-term memory for the model. */
const RECENT_MESSAGES_LIMIT = 5;

export function toTutorInput(params: {
  unit: LearningUnit;
  step: StepDescriptor;
  state: LessonSessionState;
  studentAnswer: string;
}): TutorInput {
  const { unit, step, state, studentAnswer } = params;

  const recentMessages = state.messages
    .slice(-RECENT_MESSAGES_LIMIT)
    .map((m) => ({ role: m.role, content: m.content }));

  return {
    lessonId: unit.id,
    stepId: step.id,
    studentAnswer,
    recentMessages,
    lessonContext: {
      title: unit.title,
      currentGoal: unit.goal,
      currentQuestion: step.question,
      expectedUnderstanding: step.expectedUnderstanding,
      hints: step.hints,
      commonMistakes: unit.commonMistakes.map((m) => m.mistake),
    },
    studentState: {
      levelEstimate: state.levelEstimate,
      attemptsOnCurrentStep: state.attemptsByStep[step.id] ?? 0,
    },
  };
}
