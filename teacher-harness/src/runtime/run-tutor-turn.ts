// ── Teacher Harness — controlled single-turn runner ──────────────────
//
// This is the harness operating the lesson loop for ONE turn. Order matters and
// it is the harness — never the model — that drives it:
//   1. build the minimal runtime context + prompt (via the adapter)
//   2. call the model to get tutor-facing text (+ an OPTIONAL action suggestion)
//   3. parse any suggested action out of the reply
//   4. validate + (maybe) execute that action against lesson state (harness owns this)
//   5. hand back everything the scorer and artifact store need
//
// The model produces text and can *ask* for an action; it does not get to
// change lesson flow. Step 4 is where the boundary is enforced.

import { runAdaptedTutorTurn, type AdaptedTurnResult } from './tutor-runtime-adapter';
import { decideAction, isLessonActionType, type ActionDecision, type SuggestedAction } from './lesson-actions';
import type { LessonState } from './lesson-state.types';
import { updateLessonMemory } from './lesson-memory';
import type { LessonMemoryConfig, LessonSessionMemory } from './lesson-memory.types';
import type { FreedomMode } from '../../../src/tutor-runtime/tutor-runtime.types';
import type { CoursePackage, LearningUnit } from '../../../src/course-package/course-package.types';
import type { ModelProvider } from '../model/model-provider.types';
import type { LessonMemoryMode } from './lesson-memory.types';
import type { TutorPromptVariant } from './tutor-prompt-variants';

/**
 * Try to read a structured action envelope from a model reply. Weak models
 * usually return plain prose, in which case we default to `respond`. A JSON
 * body like `{ "action": "complete_lesson", "message": "..." }` is honoured as
 * a *suggestion* only.
 */
export function parseSuggestedAction(answer: string): { suggested: SuggestedAction; parsedJson: boolean } {
  const trimmed = answer.trim().replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
    return { suggested: { type: 'respond' }, parsedJson: false };
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === 'object' && parsed !== null && 'action' in parsed) {
      const rawAction = String((parsed as { action: unknown }).action);
      const reason =
        'reason' in parsed && typeof (parsed as { reason: unknown }).reason === 'string'
          ? (parsed as { reason: string }).reason
          : undefined;
      if (isLessonActionType(rawAction)) {
        return { suggested: { type: rawAction, reason }, parsedJson: true };
      }
    }
    // JSON, but no recognised action — treat as an ordinary response.
    return { suggested: { type: 'respond' }, parsedJson: true };
  } catch {
    return { suggested: { type: 'respond' }, parsedJson: false };
  }
}

export interface HarnessTurnResult {
  turnId: string;
  learnerMessage: string;
  runtime: AdaptedTurnResult;
  /** Action the model suggested (defaults to `respond`). */
  suggestedAction: SuggestedAction;
  /** Whether the reply was structured JSON. */
  parsedJson: boolean;
  /** Harness decision: allowed? executed? why? */
  actionDecision: ActionDecision;
  /** Lesson state AFTER the harness applied this turn. */
  stateAfter: LessonState;
  /** Lesson session memory AFTER this turn's two messages were folded in. */
  memoryAfter: LessonSessionMemory;
}

/** Run one controlled tutor turn and return the harness-side outcome. */
export async function runHarnessTurn(params: {
  turnId: string;
  coursePackage: CoursePackage;
  unit: LearningUnit;
  unitId: string;
  learnerMessage: string;
  provider: ModelProvider;
  freedomMode: FreedomMode;
  state: LessonState;
  /** Lesson memory as of BEFORE this turn (prior turns only). */
  memory: LessonSessionMemory;
  memoryConfig?: Partial<LessonMemoryConfig>;
  /** Which memory representation to render into the prompt (default: structured). */
  memoryMode?: LessonMemoryMode;
  /** Which tutor prompt variant to render (default: full_current_prompt). */
  promptVariant?: TutorPromptVariant;
}): Promise<HarnessTurnResult> {
  const { turnId, coursePackage, unit, unitId, learnerMessage, provider, freedomMode, state, memory } = params;

  // The harness moves the lesson into "in_progress" on the first real turn.
  const working: LessonState = {
    ...state,
    turnCount: state.turnCount + 1,
    lessonStatus: state.lessonStatus === 'not_started' ? 'in_progress' : state.lessonStatus,
    currentStep: state.currentStep === 'intro' ? 'explanation' : state.currentStep,
  };

  const learnerCreatedAt = new Date().toISOString();

  // The model receives ONLY the compact working memory (prior turns) — never the
  // full archive. The current learner message is passed as the user turn.
  const runtime = await runAdaptedTutorTurn({
    coursePackage,
    unitId,
    userMessage: learnerMessage,
    provider,
    freedomMode,
    progress: {
      completedUnitIds: working.completedUnitIds,
      attempts: working.turnCount,
    },
    workingMemory: memory.working,
    memoryMode: params.memoryMode,
    memoryConfig: params.memoryConfig,
    promptVariant: params.promptVariant,
  });

  const tutorCreatedAt = new Date().toISOString();

  const { suggested, parsedJson } = parseSuggestedAction(runtime.answer);
  const actionDecision = decideAction({ suggested, state: working });

  // The harness folds this turn's two messages into its memory (deterministic).
  const memoryAfter = updateLessonMemory({
    memory,
    unit,
    turnId,
    learnerMessage,
    tutorResponse: runtime.answer,
    learnerCreatedAt,
    tutorCreatedAt,
    config: params.memoryConfig,
  });

  return {
    turnId,
    learnerMessage,
    runtime,
    suggestedAction: suggested,
    parsedJson,
    actionDecision,
    stateAfter: actionDecision.nextState,
    memoryAfter,
  };
}
