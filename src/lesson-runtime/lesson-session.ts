// ── Lesson Runtime — session orchestrator ────────────────────────────
//
// One student turn, end to end, over the STRUCTURED tutor path:
//   student answer → TutorInput → tutorProvider.generateTutorResponse
//   → append transcript → apply progression → new state.
//
// The RUNTIME owns memory, retrieval, guarding, repair, and lesson-state
// transitions. The user-selected TutorRuntimeStrategy only changes how this
// function wraps the provider call:
//   single_tutor    – one call (default; identical to pre-strategy behavior)
//   retrieval_first – runtime retrieves unit snippets and hands them to the model
//   guarded_output  – one call + deterministic guard; issues reported, answer kept
//   repair_pass     – guard fails critically → ONE strict rewrite call; if the
//                     rewrite still fails, a safe deterministic fallback is shown
//   critic_checker  – experimental: every answer gets a second checking pass
//
// It depends only on the provider-agnostic TutorProvider seam, so the same turn
// runs against Built-in / Gemini / OpenRouter / Local without change. Transport
// errors propagate to the caller; malformed model replies never crash because
// createTutorProvider already falls back to a safe TutorResponse.

import type { LearningUnit } from '../course-package';
import type { TutorInput, TutorProvider, TutorResponse } from '../tutor-runtime';
import { fallbackTutorResponse, getRelevantChunksForUnit } from '../tutor-runtime';
import { applyTutorAction } from './lesson-actions';
import { buildLessonSteps } from './lesson-steps';
import type { StepDescriptor } from './lesson-steps';
import type { LessonSessionState } from './lesson-state';
import { currentStepId } from './lesson-state';
import { toTutorInput } from './to-tutor-input';
import { guardTutorResponse } from './tutor-guard';
import type { GuardReport } from './tutor-guard';
import { DEFAULT_TUTOR_STRATEGY } from './tutor-strategy';
import type { TutorRuntimeStrategy } from './tutor-strategy';

export interface RunLessonTurnResult {
  state: LessonSessionState;
  response: TutorResponse;
  /** Strategy the runtime actually applied for this turn. */
  strategy: TutorRuntimeStrategy;
  /** Guard report for the FINAL answer (guarded/repair/critic strategies only). */
  guard?: GuardReport;
  /** True when repair/critic replaced the model's first draft. */
  revised?: boolean;
}

/** Extend an input with runtime-injected per-turn instructions. */
function withRuntimeNotes(input: TutorInput, notes: string[]): TutorInput {
  return {
    ...input,
    lessonContext: { ...input.lessonContext, runtimeNotes: notes },
  };
}

/** Ask the SAME provider to rewrite a draft that broke deterministic rules. */
async function requestRewrite(params: {
  tutorProvider: TutorProvider;
  input: TutorInput;
  draft: TutorResponse;
  problems: string[];
}): Promise<TutorResponse> {
  const { tutorProvider, input, draft, problems } = params;
  return tutorProvider.generateTutorResponse(
    withRuntimeNotes(input, [
      'REWRITE REQUIRED — your previous draft (below) broke lesson rules and was NOT shown to the student.',
      ...problems.map((p) => `Rule broken: ${p}`),
      'Rewrite the reply so it follows every rule: never reveal the canonical answer while hinting; only choose "continue" or "finish" when the student has demonstrated the expected understanding this turn.',
      `Previous draft (do not repeat it verbatim): ${draft.messageToStudent}`,
    ]),
  );
}

/** Experimental critic pass: a second call that reviews (and may improve) the draft. */
async function requestCriticReview(params: {
  tutorProvider: TutorProvider;
  input: TutorInput;
  draft: TutorResponse;
}): Promise<TutorResponse> {
  const { tutorProvider, input, draft } = params;
  return tutorProvider.generateTutorResponse(
    withRuntimeNotes(input, [
      'CRITIC CHECK — you are reviewing a draft tutor reply (below) before it reaches the student.',
      'If the draft follows the lesson rules, return it (lightly polished) as messageToStudent with the same nextAction.',
      'If it reveals the canonical answer while hinting, or advances the student without demonstrated understanding, return a corrected reply instead.',
      `Draft under review: ${draft.messageToStudent} (draft nextAction: ${draft.nextAction})`,
    ]),
  );
}

export async function runLessonTurn(params: {
  unit: LearningUnit;
  state: LessonSessionState;
  studentAnswer: string;
  tutorProvider: TutorProvider;
  strategy?: TutorRuntimeStrategy;
}): Promise<RunLessonTurnResult> {
  const { unit, tutorProvider } = params;
  const strategy = params.strategy ?? DEFAULT_TUTOR_STRATEGY;
  const studentAnswer = params.studentAnswer.trim();

  const steps = buildLessonSteps(unit);
  const stepId = currentStepId(params.state) ?? steps[0].id;
  const step: StepDescriptor = steps.find((s) => s.id === stepId) ?? steps[0];

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

  let input = toTutorInput({ unit, step, state: preState, studentAnswer });

  // retrieval_first — the RUNTIME retrieves allowed unit snippets (deterministic
  // keyword match over the CoursePackage; the model never searches on its own).
  if (strategy === 'retrieval_first') {
    const chunks = getRelevantChunksForUnit({ unit, userMessage: studentAnswer, maxChunks: 3 });
    input = {
      ...input,
      lessonContext: {
        ...input.lessonContext,
        referenceSnippets: chunks.map((c) => `${c.title}: ${c.content}`),
      },
    };
  }

  let response = await tutorProvider.generateTutorResponse(input);
  let guard: GuardReport | undefined;
  let revised = false;

  if (strategy === 'guarded_output' || strategy === 'repair_pass' || strategy === 'critic_checker') {
    guard = guardTutorResponse({ response, step, studentAnswer });

    if (strategy === 'guarded_output' && guard.hasCritical) {
      // Report only — never auto-repair in this mode. Safe to log (no secrets).
      console.warn('[tutor-guard]', guard.issues.map((i) => `${i.rule}: ${i.detail}`));
    }

    if (strategy === 'repair_pass' && guard.hasCritical) {
      const repairedDraft = await requestRewrite({
        tutorProvider,
        input,
        draft: response,
        problems: guard.issues.filter((i) => i.severity === 'critical').map((i) => i.detail),
      });
      const repairedGuard = guardTutorResponse({ response: repairedDraft, step, studentAnswer });
      // Show the repaired answer only if it now passes; otherwise a safe,
      // deterministic fallback — a rule-breaking reply never reaches the learner.
      if (repairedGuard.hasCritical) {
        response = fallbackTutorResponse();
        guard = guardTutorResponse({ response, step, studentAnswer });
      } else {
        response = repairedDraft;
        guard = repairedGuard;
      }
      revised = true;
    }

    if (strategy === 'critic_checker') {
      const criticDraft = await requestCriticReview({ tutorProvider, input, draft: response });
      const criticGuard = guardTutorResponse({ response: criticDraft, step, studentAnswer });
      if (!criticGuard.hasCritical) {
        revised = criticDraft.messageToStudent !== response.messageToStudent;
        response = criticDraft;
        guard = criticGuard;
      } else if (guard.hasCritical) {
        // Both the draft and the critic output break critical rules → fallback.
        response = fallbackTutorResponse();
        guard = guardTutorResponse({ response, step, studentAnswer });
        revised = true;
      }
      // else: keep the original (it passed); critic output was worse — ignore it.
    }
  }

  const withTutorMessage: LessonSessionState = {
    ...preState,
    messages: [...preState.messages, { role: 'tutor', content: response.messageToStudent }],
  };

  const state = applyTutorAction({ state: withTutorMessage, response });
  return { state, response, strategy, guard, revised };
}
