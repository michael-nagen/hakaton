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

/**
 * Default short-term memory window (recent messages) for the model. This IS the
 * app's memory model: the tutor only ever receives the last N role-tagged
 * messages — never a structured checklist, never a full archive — so the app
 * path is inherently "last messages only".
 *
 * Set to 4 on purpose: the live tutor prompt already carries a strict JSON
 * contract and the default on-device model (Llama 3.2 3B) is small, so the main
 * prompt is kept focused and lightweight. This is the SINGLE live-app window —
 * both the cloud/BYOK path and the local path use it (see local-tutor-defaults.ts).
 * It intentionally diverges from the teacher-harness memory-experiment window,
 * which stays in shared-local-tutor-defaults.ts.
 */
export const DEFAULT_RECENT_MESSAGES_LIMIT = 4;

export function toTutorInput(params: {
  unit: LearningUnit;
  step: StepDescriptor;
  state: LessonSessionState;
  studentAnswer: string;
  /** When false, the tutor is told it may not finish the lesson. */
  allowCompletion?: boolean;
  /** How many recent messages to send (default 4; both cloud and local use 4). */
  recentMessagesLimit?: number;
  /** Optional personalization instruction (style only), appended to the prompt. */
  teachingPreferenceInstruction?: string;
}): TutorInput {
  const { unit, step, state, studentAnswer, allowCompletion = true } = params;
  const recentMessagesLimit = params.recentMessagesLimit ?? DEFAULT_RECENT_MESSAGES_LIMIT;
  const teachingPreferenceInstruction = params.teachingPreferenceInstruction?.trim();

  const recentMessages = state.messages
    .slice(-recentMessagesLimit)
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
      // Keep both the mistake AND its correction so the live tutor can pre-empt
      // it accurately (the correction text was previously dropped).
      commonMistakes: unit.commonMistakes.map((m) =>
        m.correction?.trim() ? `${m.mistake} (correction: ${m.correction})` : m.mistake,
      ),
      completionEnabled: allowCompletion,
      ...(teachingPreferenceInstruction ? { teachingPreference: { instruction: teachingPreferenceInstruction } } : {}),
    },
    studentState: {
      levelEstimate: state.levelEstimate,
      attemptsOnCurrentStep: state.attemptsByStep[step.id] ?? 0,
    },
  };
}
