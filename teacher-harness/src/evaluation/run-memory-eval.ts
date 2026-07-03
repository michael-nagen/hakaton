// ── Teacher Harness — lesson-memory evaluation orchestrator ──────────
//
// Focused experiment: ONE model (real Llama 3.2 3B via the WebLLM bridge), ONE
// strategy (repair_pass), ONE lesson variant (high_very_guided), the SAME six
// scripted learner profiles, and the SAME scoring — the only variable is the
// MEMORY MODE rendered into the prompt.
//
// It reuses the lesson-variant resolver to locate the fixed high_very_guided
// CoursePackage from CourseFactory output, binds the shared profiles to it, and
// runs each memory mode as its own aggregate (reusing runCase/aggregateCombo).
// Per-turn artifacts include memory.sent-to-model.txt so we can verify what
// memory each mode actually sent.

import { getLocalModelById } from '../../../src/model-provider/local-model-catalog';
import { ArtifactStore } from '../harness/artifact-store';
import { LESSON_MEMORY_MODES, type LessonMemoryMode } from '../runtime/lesson-memory.types';
import { loadCoursePackage, type CourseSource } from '../loading/load-course-package';
import { renderScenarioMarkdown } from '../reporting/report-writer';
import { buildScenarioReport } from '../scoring/score-scenario';
import type { EvalCaseResult, EvalComboResult, EvalModelTarget, EvalTurnRecord } from './eval-types';
import { bindProfilesToVariant } from './lesson-variant-profiles';
import { createProviderForTarget, evalCallDelayMs, selectModelTargets } from './model-targets';
import { resolveLessonVariants } from './run-lesson-variant-eval';
import { aggregateCombo, loadCases, runCase } from './run-evaluation';

const FIXED_STRATEGY = 'repair_pass' as const;
const FIXED_VARIANT = 'high_very_guided';
const LLAMA_TARGET_ID = 'llama-better-offline';
const LLAMA_MODEL_NAME = getLocalModelById({ id: LLAMA_TARGET_ID })?.webllmModelId ?? 'Llama-3.2-3B-Instruct-q4f16_1-MLC';

/** Per-memory-mode result: the aggregate plus the run dirs it produced. */
export interface MemoryModeResult {
  memoryMode: LessonMemoryMode;
  combo: EvalComboResult;
  runDirs: string[];
}

export interface MemoryEvalRunOutput {
  model: EvalModelTarget;
  modelName: string;
  modelExecuted: boolean;
  strategy: typeof FIXED_STRATEGY;
  lessonVariant: string;
  variantCourseId: string | null;
  variantUnitId: string | null;
  variantResolved: boolean;
  variantNote: string;
  memoryModesEvaluated: LessonMemoryMode[];
  results: MemoryModeResult[];
  incompleteReason?: string;
}

export interface MemoryEvalRunInput {
  timestamp: string;
  verbose?: boolean;
}

/** Run the memory-mode experiment end to end. */
export async function runMemoryEvaluation(input: MemoryEvalRunInput): Promise<MemoryEvalRunOutput> {
  const log = (msg: string) => {
    if (input.verbose) console.log(msg);
  };

  const targets = selectModelTargets(LLAMA_TARGET_ID);
  const model = targets.requested.find((t) => t.id === LLAMA_TARGET_ID);
  if (!model) throw new Error(`Fixed model "${LLAMA_TARGET_ID}" not found in the catalog.`);

  // Locate the FIXED high_very_guided variant from CourseFactory output.
  const resolution = resolveLessonVariants();
  const variant = resolution.resolved.find((v) => v.variantId === FIXED_VARIANT);

  const base = {
    model,
    modelName: LLAMA_MODEL_NAME,
    strategy: FIXED_STRATEGY,
    lessonVariant: FIXED_VARIANT,
    memoryModesEvaluated: [...LESSON_MEMORY_MODES] as LessonMemoryMode[],
  };

  if (!variant) {
    return {
      ...base,
      modelExecuted: false,
      variantCourseId: null,
      variantUnitId: null,
      variantResolved: false,
      variantNote: `Fixed lesson variant "${FIXED_VARIANT}" not found under course-factory/output/variants/.`,
      results: [],
      incompleteReason: `Fixed lesson variant "${FIXED_VARIANT}" is unavailable — cannot run the memory experiment.`,
    };
  }

  const course: CourseSource = { source: 'file', path: variant.relPath, courseId: variant.courseId };
  // Confirm the course loads (fail loudly rather than silently skipping).
  loadCoursePackage(course);

  const provider = createProviderForTarget(model);
  const paceMs = evalCallDelayMs(model);
  let modelExecuted = false;
  let incompleteReason: string | undefined;
  const results: MemoryModeResult[] = [];

  for (const memoryMode of LESSON_MEMORY_MODES) {
    const cases = bindProfilesToVariant({
      variantId: `${FIXED_VARIANT}__${memoryMode}`,
      course,
      unitId: variant.selectedUnitId,
    });
    const loadedCases = loadCases(cases);

    log(`\n▶ memory mode ${memoryMode} — variant ${FIXED_VARIANT} unit ${variant.selectedUnitId}`);
    const allRecords: EvalTurnRecord[] = [];
    const perCase: EvalCaseResult[] = [];
    const runDirs: string[] = [];

    try {
      for (const loaded of loadedCases) {
        const { records, caseResult } = await runCase({ loaded, strategy: FIXED_STRATEGY, provider, paceMs, memoryMode });
        if (records.length > 0) modelExecuted = true;
        allRecords.push(...records);
        perCase.push(caseResult);
        runDirs.push(
          writeMemoryCaseArtifacts({ timestamp: input.timestamp, model, memoryMode, variant, loaded, records }),
        );
        log(
          `   ${caseResult.passedTurns === caseResult.totalTurns ? '✅' : '❌'} ${loaded.evalCase.id} — ${caseResult.passedTurns}/${caseResult.totalTurns} turns` +
            (caseResult.criticalIssues.length ? `, ${caseResult.criticalIssues.length} critical` : ''),
        );
      }
    } catch (err) {
      incompleteReason = `Memory mode "${memoryMode}" aborted: ${(err as Error).message}`;
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
    results.push({ memoryMode, combo, runDirs });
  }

  return {
    ...base,
    modelExecuted,
    variantCourseId: variant.courseId,
    variantUnitId: variant.selectedUnitId,
    variantResolved: true,
    variantNote: `Fixed lesson variant "${FIXED_VARIANT}" resolved to ${variant.courseId} / ${variant.selectedUnitId}.`,
    results,
    incompleteReason,
  };
}

/** Persist one memory-mode×profile case as a normal run dir + memory metadata + sent-memory. */
function writeMemoryCaseArtifacts(params: {
  timestamp: string;
  model: EvalModelTarget;
  memoryMode: LessonMemoryMode;
  variant: { variantId: string; courseId: string; selectedUnitId: string };
  loaded: ReturnType<typeof loadCases>[number];
  records: EvalTurnRecord[];
}): string {
  const { timestamp, model, memoryMode, variant, loaded, records } = params;
  const { evalCase, coursePackage, unit } = loaded;

  const store = new ArtifactStore({ scenarioId: `memory__${memoryMode}__${evalCase.id}`, timestamp });
  store.writeInputs({ scenario: evalCase, coursePackage, unit });
  store.writeRunMetadata({
    model: LLAMA_MODEL_NAME,
    strategy: FIXED_STRATEGY,
    lessonVariant: FIXED_VARIANT,
    memoryMode,
    realWebLLM: records.length > 0,
    fullArchiveSentToModel: false,
    courseSource: 'course-factory/output/',
    courseId: variant.courseId,
    unitId: variant.selectedUnitId,
  });

  records.forEach((rec, i) => {
    store.writeTurn({
      index: i + 1,
      context: { userMessage: rec.learnerMessage, unitId: variant.selectedUnitId },
      systemPrompt: '(prompt path omitted here; the exact memory block is in memory.sent-to-model.txt)',
      userPrompt: rec.learnerMessage,
      response: rec.tutorResponse,
      debug: {
        provider: model.kind,
        modelName: LLAMA_MODEL_NAME,
        strategy: FIXED_STRATEGY,
        memoryMode,
        telemetry: rec.telemetry,
        dimensions: rec.dimensions,
      },
      score: rec.base,
      memorySentToModel: rec.memorySentToModel ?? '',
    });
  });

  const report = buildScenarioReport({
    scenarioId: evalCase.id,
    scenarioTitle: `memory=${memoryMode} — ${evalCase.title}`,
    courseId: variant.courseId,
    unitId: variant.selectedUnitId,
    provider: model.kind,
    model: LLAMA_MODEL_NAME,
    freedomMode: evalCase.freedomMode,
    coursePackageValid: true,
    coursePackageValidationErrors: [],
    turnReports: records.map((r) => r.base),
    runDir: store.runDir,
    finishedAt: timestamp,
  });
  store.writeScenarioReport({ json: report, markdown: renderScenarioMarkdown(report) });
  return store.runDir;
}
