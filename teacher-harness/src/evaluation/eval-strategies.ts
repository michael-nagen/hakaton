// ── Teacher Harness — strategy executor (evaluation lab) ─────────────
//
// Runs ONE tutor turn under a selected runtime strategy, mirroring the app's
// lesson-runtime semantics over the harness's context/prompt path:
//
//   single_tutor     one call, default context (the harness's existing path)
//   retrieval_first  deterministic retrieval widened (more unit chunks) before
//                    the single call — the model never searches on its own
//   guarded_output   one call + deterministic guard; issues RECORDED, reply kept
//   repair_pass      guard fails critically → ONE strict rewrite call; if the
//                    rewrite still fails, a deterministic safe fallback is used
//   critic_checker   experimental: every draft gets a second checking call
//
// The HARNESS owns the loop, guard, repair, memory and state — the model only
// produces text. This file exists inside teacher-harness only; it is a
// re-implementation of the app strategies for CLI evaluation (documented in
// the report's Limitations), not a change to the app.

import { runAdaptedTutorTurn, type AdaptedTurnResult } from '../runtime/tutor-runtime-adapter';
import { parseSuggestedAction } from '../runtime/run-tutor-turn';
import { decideAction } from '../runtime/lesson-actions';
import { updateLessonMemory } from '../runtime/lesson-memory';
import type { LessonSessionMemory } from '../runtime/lesson-memory.types';
import type { LessonState } from '../runtime/lesson-state.types';
import type { CoursePackage, LearningUnit } from '../../../src/course-package/course-package.types';
import type { FreedomMode, TutorContext } from '../../../src/tutor-runtime/tutor-runtime.types';
import type { LessonMemoryMode } from '../runtime/lesson-memory.types';
import type { TutorPromptVariant } from '../runtime/tutor-prompt-variants';
import type { ModelProvider } from '../model/model-provider.types';
import type { HarnessTurnResult } from '../runtime/run-tutor-turn';
import { guardEvalReply } from './eval-guard';
import type { EvalStrategyId, EvalTurnTelemetry } from './eval-types';

export const ALL_EVAL_STRATEGIES: readonly EvalStrategyId[] = [
  'single_tutor',
  'retrieval_first',
  'guarded_output',
  'repair_pass',
  'critic_checker',
];

/** retrieval_first widens the deterministic retrieval window. */
const RETRIEVAL_FIRST_MAX_CHUNKS = 6;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Deterministic safe reply used when repair cannot produce a rule-clean answer. */
function safeFallbackReply(context: TutorContext): string {
  const firstChunk = context.relevantChunks[0];
  const grounding = firstChunk ? ` ${firstChunk.content.split(/(?<=[.!?])\s+/)[0] ?? ''}` : '';
  return (
    `Let's stay focused on this unit: ${context.unit.goal}${grounding}` +
    ' Can you try a small example and tell me what you expect to see? I can give a hint if you get stuck.'
  );
}

function rewriteSystemAddendum(problems: string[], draft: string): string {
  return [
    '',
    'REWRITE REQUIRED — your previous draft (below) broke lesson rules and was NOT shown to the learner.',
    ...problems.map((p) => `Rule broken: ${p}`),
    'Rewrite the reply so it follows every rule: never use syntax reserved for later units, never declare the lesson complete or advance the learner, stay grounded in the reference material, and keep it brief.',
    `Previous draft (do not repeat it verbatim): ${draft}`,
  ].join('\n');
}

function criticSystemAddendum(draft: string): string {
  return [
    '',
    'CRITIC CHECK — you are reviewing a draft tutor reply (below) before it reaches the learner.',
    'If the draft follows the lesson rules (no future-unit syntax, no advancing/completing the lesson, grounded in the reference material, brief), return it lightly polished.',
    'If it breaks a rule, return a corrected reply instead. Return ONLY the reply text.',
    `Draft under review: ${draft}`,
  ].join('\n');
}

export interface EvalTurnOutcome extends HarnessTurnResult {
  telemetry: EvalTurnTelemetry;
}

/** Run one controlled tutor turn under a strategy and fold memory/state. */
export async function runEvalTurn(params: {
  strategy: EvalStrategyId;
  turnId: string;
  coursePackage: CoursePackage;
  unit: LearningUnit;
  unitId: string;
  learnerMessage: string;
  provider: ModelProvider;
  freedomMode: FreedomMode;
  state: LessonState;
  memory: LessonSessionMemory;
  /**
   * Minimum ms to wait BEFORE each model call (rate-limit pacing for cloud
   * endpoints). Applied outside the latency measurements on purpose.
   */
  paceMs?: number;
  /** Which memory representation to render into the prompt (default: structured). */
  memoryMode?: LessonMemoryMode;
  /** Which tutor prompt variant to render (default: full_current_prompt). */
  promptVariant?: TutorPromptVariant;
}): Promise<EvalTurnOutcome> {
  const { strategy, turnId, coursePackage, unit, unitId, learnerMessage, provider, freedomMode, state, memory } =
    params;
  const paceMs = params.paceMs ?? 0;

  // Harness advances its own state (same transition as run-tutor-turn.ts).
  const working: LessonState = {
    ...state,
    turnCount: state.turnCount + 1,
    lessonStatus: state.lessonStatus === 'not_started' ? 'in_progress' : state.lessonStatus,
    currentStep: state.currentStep === 'intro' ? 'explanation' : state.currentStep,
  };

  const learnerCreatedAt = new Date().toISOString();
  const latenciesMs: number[] = [];

  // ── Call 1: the strategy's base call ────────────────────────────────
  if (paceMs > 0) await sleep(paceMs);
  const first = await runAdaptedTutorTurn({
    coursePackage,
    unitId,
    userMessage: learnerMessage,
    provider,
    freedomMode,
    progress: { completedUnitIds: working.completedUnitIds, attempts: working.turnCount },
    workingMemory: memory.working,
    memoryMode: params.memoryMode,
    promptVariant: params.promptVariant,
    maxChunks: strategy === 'retrieval_first' ? RETRIEVAL_FIRST_MAX_CHUNKS : undefined,
  });
  latenciesMs.push(first.latencyMs);

  let finalAnswer = first.answer;
  let repaired = false;
  let fallbackUsed = false;
  let criticReplaced = false;

  const guardsStrategy = strategy === 'guarded_output' || strategy === 'repair_pass' || strategy === 'critic_checker';
  const firstGuard = guardsStrategy
    ? guardEvalReply({ reply: first.answer, context: first.context })
    : { issues: [], hasCritical: false };
  let finalGuard = firstGuard;

  // ── repair_pass: one strict rewrite when the draft breaks critical rules ──
  if (strategy === 'repair_pass' && firstGuard.hasCritical) {
    const problems = firstGuard.issues.filter((i) => i.severity === 'critical').map((i) => i.detail);
    if (paceMs > 0) await sleep(paceMs);
    const started = Date.now();
    const rewritten = await provider.generateText({
      prompt: first.userPrompt,
      system: first.systemPrompt + rewriteSystemAddendum(problems, first.answer),
    });
    latenciesMs.push(Date.now() - started);

    const rewrittenGuard = guardEvalReply({ reply: rewritten, context: first.context });
    if (rewrittenGuard.hasCritical) {
      finalAnswer = safeFallbackReply(first.context);
      finalGuard = guardEvalReply({ reply: finalAnswer, context: first.context });
      fallbackUsed = true;
    } else {
      finalAnswer = rewritten;
      finalGuard = rewrittenGuard;
    }
    repaired = true;
  }

  // ── critic_checker (experimental): always a second checking call ────
  if (strategy === 'critic_checker') {
    if (paceMs > 0) await sleep(paceMs);
    const started = Date.now();
    const criticDraft = await provider.generateText({
      prompt: first.userPrompt,
      system: first.systemPrompt + criticSystemAddendum(first.answer),
    });
    latenciesMs.push(Date.now() - started);

    const criticGuard = guardEvalReply({ reply: criticDraft, context: first.context });
    if (!criticGuard.hasCritical) {
      criticReplaced = criticDraft.trim() !== first.answer.trim();
      finalAnswer = criticDraft;
      finalGuard = criticGuard;
    } else if (firstGuard.hasCritical) {
      // Both drafts break critical rules → deterministic fallback.
      finalAnswer = safeFallbackReply(first.context);
      finalGuard = guardEvalReply({ reply: finalAnswer, context: first.context });
      fallbackUsed = true;
      criticReplaced = true;
    }
    // else: keep the original (it passed); the critic draft was worse.
  }

  const tutorCreatedAt = new Date().toISOString();

  // ── Harness-owned action decision + memory fold (on the FINAL answer) ──
  const { suggested, parsedJson } = parseSuggestedAction(finalAnswer);
  const actionDecision = decideAction({ suggested, state: working });
  const memoryAfter = updateLessonMemory({
    memory,
    unit,
    turnId,
    learnerMessage,
    tutorResponse: finalAnswer,
    learnerCreatedAt,
    tutorCreatedAt,
  });

  const totalLatencyMs = latenciesMs.reduce((a, b) => a + b, 0);
  const runtime: AdaptedTurnResult = {
    ...first,
    answer: finalAnswer,
    latencyMs: totalLatencyMs,
  };

  return {
    turnId,
    learnerMessage,
    runtime,
    suggestedAction: suggested,
    parsedJson,
    actionDecision,
    stateAfter: actionDecision.nextState,
    memoryAfter,
    telemetry: {
      strategy,
      modelCalls: latenciesMs.length,
      latenciesMs,
      totalLatencyMs,
      repaired,
      fallbackUsed,
      criticReplaced,
      guardIssuesFirstDraft: firstGuard.issues,
      guardIssuesFinal: finalGuard.issues,
    },
  };
}
