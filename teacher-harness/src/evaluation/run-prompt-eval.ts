// ── Teacher Harness — tutor prompt-efficiency evaluation orchestrator ─
//
// Focused experiment: ONE model (real Llama 3.2 3B via the WebLLM bridge), ONE
// strategy (repair_pass), ONE lesson variant (high_very_guided), ONE memory
// mode (last_messages_only, window 8), the SAME 16 scripted learner profiles,
// and the SAME scoring — the only variable is the TUTOR PROMPT VARIANT (shape /
// length / instruction density), NOT teaching personality.
//
// Reuses the lesson-variant resolver to locate the fixed high_very_guided
// CoursePackage, binds the expanded profiles to it, and runs each prompt
// variant as its own aggregate (reusing runCase/aggregateCombo). Per-turn
// artifacts include prompt-variant.txt + prompt.txt so the exact prompt sent to
// the model is auditable.

import { getLocalModelById } from '../../../src/model-provider/local-model-catalog';
import { ArtifactStore } from '../harness/artifact-store';
import { LESSON_MEMORY_DEFAULTS } from '../runtime/lesson-memory.types';
import { TUTOR_PROMPT_VARIANTS, type TutorPromptVariant } from '../runtime/tutor-prompt-variants';
import { loadCoursePackage, type CourseSource } from '../loading/load-course-package';
import { renderScenarioMarkdown } from '../reporting/report-writer';
import { buildScenarioReport } from '../scoring/score-scenario';
import type { EvalCaseResult, EvalComboResult, EvalModelTarget, EvalTurnRecord } from './eval-types';
import type { EvalTurnOutcome } from './eval-strategies';
import { bindPromptEvalProfiles, PROMPT_EVAL_PROFILE_TEMPLATES } from './prompt-eval-profiles';
import { createProviderForTarget, evalCallDelayMs, selectModelTargets } from './model-targets';
import { resolveLessonVariants } from './run-lesson-variant-eval';
import { aggregateCombo, loadCases, runCase } from './run-evaluation';

const FIXED_STRATEGY = 'repair_pass' as const;
const FIXED_VARIANT = 'high_very_guided';
const FIXED_MEMORY_MODE = 'last_messages_only' as const;
const LLAMA_TARGET_ID = 'llama-better-offline';
const LLAMA_MODEL_NAME = getLocalModelById({ id: LLAMA_TARGET_ID })?.webllmModelId ?? 'Llama-3.2-3B-Instruct-q4f16_1-MLC';

export interface PromptModeResult {
  promptVariant: TutorPromptVariant;
  combo: EvalComboResult;
  /** Averaged prompt-size metrics for this variant. */
  promptSizes: { systemPromptChars: number; instructionChars: number; groundingChars: number; approxSystemTokens: number };
  runDirs: string[];
}

export interface PromptEvalRunOutput {
  model: EvalModelTarget;
  modelName: string;
  modelExecuted: boolean;
  strategy: typeof FIXED_STRATEGY;
  lessonVariant: string;
  memoryMode: typeof FIXED_MEMORY_MODE;
  lastMessagesLimit: number;
  variantCourseId: string | null;
  variantUnitId: string | null;
  profileCount: number;
  promptVariantsEvaluated: TutorPromptVariant[];
  results: PromptModeResult[];
  incompleteReason?: string;
}

export interface PromptEvalRunInput {
  timestamp: string;
  verbose?: boolean;
}

export async function runPromptEvaluation(input: PromptEvalRunInput): Promise<PromptEvalRunOutput> {
  const log = (msg: string) => {
    if (input.verbose) console.log(msg);
  };

  const targets = selectModelTargets(LLAMA_TARGET_ID);
  const model = targets.requested.find((t) => t.id === LLAMA_TARGET_ID);
  if (!model) throw new Error(`Fixed model "${LLAMA_TARGET_ID}" not found in the catalog.`);

  const resolution = resolveLessonVariants();
  const variant = resolution.resolved.find((v) => v.variantId === FIXED_VARIANT);

  const base = {
    model,
    modelName: LLAMA_MODEL_NAME,
    strategy: FIXED_STRATEGY,
    lessonVariant: FIXED_VARIANT,
    memoryMode: FIXED_MEMORY_MODE,
    lastMessagesLimit: LESSON_MEMORY_DEFAULTS.lastMessagesLimit,
    promptVariantsEvaluated: [...TUTOR_PROMPT_VARIANTS],
    profileCount: 0,
  };

  if (!variant) {
    return {
      ...base,
      modelExecuted: false,
      variantCourseId: null,
      variantUnitId: null,
      results: [],
      incompleteReason: `Fixed lesson variant "${FIXED_VARIANT}" not found under course-factory/output/variants/.`,
    };
  }

  const course: CourseSource = { source: 'file', path: variant.relPath, courseId: variant.courseId };
  loadCoursePackage(course);

  const provider = createProviderForTarget(model);
  const paceMs = evalCallDelayMs(model);
  let modelExecuted = false;
  let incompleteReason: string | undefined;
  const results: PromptModeResult[] = [];
  let profileCount = 0;

  // ── Smoke gate ──────────────────────────────────────────────────────
  // Run ONE case (structured_rules_prompt × the first profile) on the real
  // model first, in THIS SAME process + bridge + browser tab. If it hangs or
  // errors, abort before committing to the full matrix and report honestly —
  // no fabrication. If it passes, fall straight through to the full 5×N run
  // (no tab juggling: one continuous process, one persistent tab).
  const SMOKE_VARIANT: TutorPromptVariant = 'structured_rules_prompt';
  try {
    const smokeCase = bindPromptEvalProfiles({ labelPrefix: 'smoke', course, unitId: variant.selectedUnitId }).slice(0, 1);
    const smokeLoaded = loadCases(smokeCase);
    log(`\n🔎 smoke test: 1 case × ${SMOKE_VARIANT} on real ${LLAMA_MODEL_NAME}…`);
    const smokeStart = Date.now();
    const { records: smokeRecords, caseResult: smokeResult } = await runCase({
      loaded: smokeLoaded[0],
      strategy: FIXED_STRATEGY,
      provider,
      paceMs,
      memoryMode: FIXED_MEMORY_MODE,
      promptVariant: SMOKE_VARIANT,
    });
    if (smokeRecords.length === 0) throw new Error('smoke case produced no turns');
    modelExecuted = true;
    log(
      `✅ smoke passed in ${((Date.now() - smokeStart) / 1000).toFixed(1)}s ` +
        `(${smokeResult.passedTurns}/${smokeResult.totalTurns} turns) — starting the full run.`,
    );
  } catch (err) {
    incompleteReason =
      `Smoke test (1 case × ${SMOKE_VARIANT}) failed before the full run: ${(err as Error).message}. ` +
      'The full matrix was NOT started and no results were fabricated. Check the [bridge] job logs above: ' +
      'if the job was dispatched but never completed, the browser tab likely closed/backgrounded; keep the ' +
      'bridge tab open and visible, then re-run.';
    console.error(`   ✖ ${incompleteReason}`);
    return {
      ...base,
      profileCount: PROMPT_EVAL_PROFILE_TEMPLATES.length,
      modelExecuted,
      variantCourseId: variant.courseId,
      variantUnitId: variant.selectedUnitId,
      results: [],
      incompleteReason,
    };
  }

  for (const promptVariant of TUTOR_PROMPT_VARIANTS) {
    const cases = bindPromptEvalProfiles({
      labelPrefix: promptVariant,
      course,
      unitId: variant.selectedUnitId,
    });
    profileCount = cases.length;
    const loadedCases = loadCases(cases);

    log(`\n▶ prompt variant ${promptVariant} — ${cases.length} learner profiles`);
    const allRecords: EvalTurnRecord[] = [];
    const perCase: EvalCaseResult[] = [];
    const runDirs: string[] = [];

    try {
      for (const loaded of loadedCases) {
        const store = new ArtifactStore({
          scenarioId: `prompt__${promptVariant}__${loaded.evalCase.id}`,
          timestamp: input.timestamp,
        });
        store.writeInputs({ scenario: loaded.evalCase, coursePackage: loaded.coursePackage, unit: loaded.unit });

        const { records, caseResult } = await runCase({
          loaded,
          strategy: FIXED_STRATEGY,
          provider,
          paceMs,
          memoryMode: FIXED_MEMORY_MODE,
          promptVariant,
          onTurn: (turnIndex, outcome) => writePromptTurnArtifact(store, turnIndex, outcome),
        });
        if (records.length > 0) modelExecuted = true;
        allRecords.push(...records);
        perCase.push(caseResult);
        store.writeRunMetadata({
          model: LLAMA_MODEL_NAME,
          strategy: FIXED_STRATEGY,
          lessonVariant: FIXED_VARIANT,
          memoryMode: FIXED_MEMORY_MODE,
          lastMessagesLimit: LESSON_MEMORY_DEFAULTS.lastMessagesLimit,
          promptVariant,
          lessonCompletion: 'disabled',
          realWebLLM: records.length > 0,
          courseId: variant.courseId,
          unitId: variant.selectedUnitId,
        });
        const caseReport = buildScenarioReport({
          scenarioId: loaded.evalCase.id,
          scenarioTitle: `prompt=${promptVariant} — ${loaded.evalCase.title}`,
          courseId: variant.courseId,
          unitId: variant.selectedUnitId,
          provider: model.kind,
          model: LLAMA_MODEL_NAME,
          freedomMode: loaded.evalCase.freedomMode,
          coursePackageValid: true,
          coursePackageValidationErrors: [],
          turnReports: records.map((r) => r.base),
          runDir: store.runDir,
          finishedAt: input.timestamp,
        });
        store.writeScenarioReport({ json: caseReport, markdown: renderScenarioMarkdown(caseReport) });
        runDirs.push(store.runDir);
        log(
          `   ${caseResult.passedTurns === caseResult.totalTurns ? '✅' : '❌'} ${loaded.evalCase.id} — ${caseResult.passedTurns}/${caseResult.totalTurns} turns` +
            (caseResult.criticalIssues.length ? `, ${caseResult.criticalIssues.length} critical` : ''),
        );
      }
    } catch (err) {
      incompleteReason = `Prompt variant "${promptVariant}" aborted: ${(err as Error).message}`;
      console.error(`   ✖ ${incompleteReason}`);
      break;
    }

    const combo = aggregateCombo({
      target: model,
      strategy: FIXED_STRATEGY,
      records: allRecords,
      perCase,
      casesExpected: loadedCases.length,
    });
    results.push({ promptVariant, combo, promptSizes: averagePromptSizes(allRecords), runDirs });
  }

  return {
    ...base,
    profileCount,
    modelExecuted,
    variantCourseId: variant.courseId,
    variantUnitId: variant.selectedUnitId,
    results,
    incompleteReason,
  };
}

/** Persist one turn's memory + prompt-variant artifacts under the case run dir. */
function writePromptTurnArtifact(store: ArtifactStore, turnIndex: number, outcome: EvalTurnOutcome): void {
  const r = outcome.runtime;
  store.writeTurn({
    index: turnIndex,
    context: { userMessage: r.context.userMessage, unitId: r.context.unit.id },
    systemPrompt: r.systemPrompt,
    userPrompt: r.userPrompt,
    response: r.answer,
    debug: {
      provider: r.provider,
      modelName: r.modelName,
      promptVariant: r.promptVariant,
      promptSizes: r.promptSizes,
      telemetry: outcome.telemetry,
    },
    score: null,
    memorySentToModel: r.memorySentToModel,
    promptVariantInstructions: r.promptVariantInstructions,
  });
}

function averagePromptSizes(records: EvalTurnRecord[]): PromptModeResult['promptSizes'] {
  const sized = records.filter((r) => r.promptSizes);
  if (sized.length === 0) return { systemPromptChars: 0, instructionChars: 0, groundingChars: 0, approxSystemTokens: 0 };
  const sum = sized.reduce(
    (a, r) => ({
      sys: a.sys + (r.promptSizes?.systemPromptChars ?? 0),
      inst: a.inst + (r.promptSizes?.instructionChars ?? 0),
      grnd: a.grnd + (r.promptSizes?.groundingChars ?? 0),
    }),
    { sys: 0, inst: 0, grnd: 0 },
  );
  const systemPromptChars = Math.round(sum.sys / sized.length);
  return {
    systemPromptChars,
    instructionChars: Math.round(sum.inst / sized.length),
    groundingChars: Math.round(sum.grnd / sized.length),
    approxSystemTokens: Math.round(systemPromptChars / 4), // ~4 chars/token heuristic
  };
}
