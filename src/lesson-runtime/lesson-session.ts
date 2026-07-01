// ── Lesson Runtime — session orchestrator ────────────────────────────
//
// One student turn, end to end, over the STRUCTURED tutor path:
//   student answer → TutorInput → tutorProvider.generateTutorResponse
//   → append transcript → apply progression → new state.
//
// It depends only on the provider-agnostic TutorProvider seam, so the same turn
// runs against Built-in / Gemini / OpenRouter / Local without change. Transport
// errors (bad key, local-not-ready, network) propagate to the caller, which maps
// them to friendly UI text; a malformed model reply never crashes here because
// createTutorProvider already falls back to a safe TutorResponse.

import type { LearningUnit } from '../course-package';
import type { TutorProvider, TutorResponse } from '../tutor-runtime';
import { applyTutorAction } from './lesson-actions';
import { buildLessonSteps } from './lesson-steps';
import type { LessonSessionState } from './lesson-state';
import { currentStepId } from './lesson-state';
import { toTutorInput } from './to-tutor-input';

export interface RunLessonTurnResult {
  state: LessonSessionState;
  response: TutorResponse;
}

export async function runLessonTurn(params: {
  unit: LearningUnit;
  state: LessonSessionState;
  studentAnswer: string;
  tutorProvider: TutorProvider;
}): Promise<RunLessonTurnResult> {
  const { unit, tutorProvider } = params;
  const studentAnswer = params.studentAnswer.trim();

  const steps = buildLessonSteps(unit);
  const stepId = currentStepId(params.state) ?? steps[0].id;
  const step = steps.find((s) => s.id === stepId) ?? steps[0];

  // Record the student's turn first, so it becomes part of recentMessages and
  // the attempt count reflects this attempt when the model reads it.
  const preState: LessonSessionState = {
    ...params.state,
    status: params.state.status === 'completed' ? 'completed' : 'in_progress',
    turnCount: params.state.turnCount + 1,
    attemptsByStep: {
      ...params.state.attemptsByStep,
      [step.id]: (params.state.attemptsByStep[step.id] ?? 0) + 1,
    },
    messages: [...params.state.messages, { role: 'student', content: studentAnswer }],
  };

  const input = toTutorInput({ unit, step, state: preState, studentAnswer });
  const response = await tutorProvider.generateTutorResponse(input);

  const withTutorMessage: LessonSessionState = {
    ...preState,
    messages: [...preState.messages, { role: 'tutor', content: response.messageToStudent }],
  };

  const state = applyTutorAction({ state: withTutorMessage, response });
  return { state, response };
}
