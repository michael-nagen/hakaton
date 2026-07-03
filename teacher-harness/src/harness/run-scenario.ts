// ── Teacher Harness — scenario runner (the lesson loop) ──────────────
//
// This is the controlled runner. It owns the loop and the ordering:
//   load course → validate → select unit → init lesson state →
//   for each scripted turn: build context/prompt → call model →
//   validate + execute any suggested action → score → persist →
//   summarise → write reports.
//
// The model only produces tutor text within this loop; the harness owns state,
// flow, action execution, scoring and artifacts.

import { getUnitById } from '../../../src/course-package/course-package.loader';
import { resolveProviderConfig } from '../config/harness-config';
import { loadCoursePackage } from '../loading/load-course-package';
import { loadScenario, type Scenario } from '../loading/load-scenario';
import { resolveProvider } from '../model/model-client';
import { initLessonState, type LessonState } from '../runtime/lesson-state.types';
import { finalizeLessonMemory, initLessonMemory } from '../runtime/lesson-memory';
import { LESSON_MEMORY_DEFAULTS, type LessonMemoryMode, type LessonSessionMemory } from '../runtime/lesson-memory.types';
import { MVP_EXECUTABLE_ACTIONS } from '../runtime/lesson-actions';
import { lockedConfigMetadata } from '../config/locked-config';
import { DEFAULT_TUTOR_PROMPT_VARIANT, type TutorPromptVariant } from '../runtime/tutor-prompt-variants';
import { runHarnessTurn } from '../runtime/run-tutor-turn';
import { buildScenarioReport } from '../scoring/score-scenario';
import { scoreTurn } from '../scoring/score-turn';
import { ArtifactStore } from './artifact-store';
import { renderScenarioMarkdown } from '../reporting/report-writer';
import type { ScenarioReport } from '../reporting/report.types';

export interface RunScenarioOptions {
  scenarioPath: string;
  forceMock?: boolean;
  /** Timestamp used for the run id; injected so batch runs share a clock. */
  timestamp?: string;
  /** Emit progress lines to the console. */
  verbose?: boolean;
  /**
   * Explicitly requested fresh memory (--reset-memory). Memory is ALWAYS fresh
   * per run in the MVP — prior run artifacts are never loaded as active memory —
   * so this only records the request as a memory-reset.json artifact.
   */
  resetMemory?: boolean;
  /** Which lesson-memory representation to render into the prompt (default: structured). */
  memoryMode?: LessonMemoryMode;
  /** Which tutor prompt variant to render (default: full_current_prompt). */
  promptVariant?: TutorPromptVariant;
}

export async function runScenario(options: RunScenarioOptions): Promise<ScenarioReport> {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const memoryMode: LessonMemoryMode = options.memoryMode ?? LESSON_MEMORY_DEFAULTS.mode;
  const promptVariant: TutorPromptVariant = options.promptVariant ?? DEFAULT_TUTOR_PROMPT_VARIANT;
  const { scenario }: { scenario: Scenario } = loadScenario(options.scenarioPath);

  const log = (msg: string) => {
    if (options.verbose) console.log(msg);
  };

  // 1. Provider (mock by default; --mock or env/scenario can change it).
  const providerConfig = resolveProviderConfig({
    forceMock: options.forceMock,
    scenarioProvider: scenario.provider,
  });
  const resolved = resolveProvider(providerConfig);

  // 2. Load + validate the CoursePackage (validation errors are reported, not thrown).
  const loaded = loadCoursePackage(scenario.course);
  const courseId = scenario.course.courseId ?? loaded.coursePackage.id;
  if (!loaded.valid) {
    log(`  ⚠️ CoursePackage failed validation with ${loaded.validationErrors.length} error(s).`);
  }

  // 3. Select the requested unit.
  const unit = getUnitById({ coursePackage: loaded.coursePackage, unitId: scenario.unitId });
  if (!unit) {
    throw new Error(
      `Unit "${scenario.unitId}" not found in course "${loaded.coursePackage.id}". Available: ${loaded.coursePackage.units
        .map((u) => u.id)
        .join(', ')}`,
    );
  }

  // 4. Initialise lesson state + lesson-session memory (both owned by the
  //    harness). ALWAYS fresh: nothing from previous runs is ever loaded.
  let state: LessonState = initLessonState({ courseId, unitId: scenario.unitId });
  let memory: LessonSessionMemory = initLessonMemory({ courseId, unitId: scenario.unitId, unit });

  // 5. Persist inputs up front so a crash mid-run is still debuggable.
  const store = new ArtifactStore({ scenarioId: scenario.id, timestamp });
  store.writeInputs({ scenario, coursePackage: loaded.coursePackage, unit });
  store.writeRunMetadata({
    // What THIS run actually did (the plain `run` path is a single model call;
    // runtime strategies are exercised by the `evaluate*` commands).
    actual: {
      provider: resolved.mode,
      model: resolved.modelName,
      strategy: 'single_tutor',
      memoryMode,
      promptVariant,
      lastMessagesLimit: LESSON_MEMORY_DEFAULTS.lastMessagesLimit,
      // Completion is never executable in the harness (see MVP_EXECUTABLE_ACTIONS).
      lessonCompletion: MVP_EXECUTABLE_ACTIONS.includes('complete_lesson') ? 'enabled' : 'disabled',
      freedomMode: scenario.freedomMode,
      courseId,
      unitId: scenario.unitId,
    },
    // The locked best-known configuration this harness defaults to going forward.
    lockedDefault: lockedConfigMetadata(),
  });
  if (options.resetMemory) {
    store.writeMemoryReset();
    log('  ↺ memory reset requested — run starts from empty lesson memory (recorded in memory-reset.json).');
  }

  log(`▶ ${scenario.id} — unit ${scenario.unitId} — provider ${resolved.mode}/${resolved.modelName} — memory ${memoryMode} — prompt ${promptVariant}`);

  // 6. Run each scripted turn through the controlled loop.
  const turnReports = [];
  for (let i = 0; i < scenario.turns.length; i += 1) {
    const turn = scenario.turns[i];
    const result = await runHarnessTurn({
      turnId: turn.id,
      coursePackage: loaded.coursePackage,
      unit,
      unitId: scenario.unitId,
      learnerMessage: turn.learnerMessage,
      provider: resolved.provider,
      freedomMode: scenario.freedomMode,
      state,
      memory, // compact working memory (prior turns) is sent to the model
      memoryMode, // which representation of that memory is rendered into the prompt
      promptVariant, // which tutor prompt shape is rendered into the prompt
    });
    state = result.stateAfter; // harness advances its own state
    memory = result.memoryAfter; // harness folds this turn into its memory

    const turnReport = scoreTurn({ turn, result });
    turnReports.push(turnReport);

    store.writeTurn({
      index: i + 1,
      context: result.runtime.context,
      systemPrompt: result.runtime.systemPrompt,
      userPrompt: result.runtime.userPrompt,
      response: result.runtime.answer,
      debug: {
        provider: result.runtime.provider,
        modelName: result.runtime.modelName,
        latencyMs: result.runtime.latencyMs,
        kbChunkIds: result.runtime.kbChunkIds,
        parsedJson: result.parsedJson,
        suggestedAction: result.suggestedAction,
        actionDecision: {
          allowed: result.actionDecision.allowed,
          executed: result.actionDecision.executed,
          reason: result.actionDecision.reason,
        },
        lessonStateAfter: state,
        memoryMode: result.runtime.memoryMode,
        promptVariant: result.runtime.promptVariant,
        promptSizes: result.runtime.promptSizes,
      },
      score: turnReport,
      workingMemory: memory.working,
      archiveMemory: memory.archive,
      memorySentToModel: result.runtime.memorySentToModel,
      promptVariantInstructions: result.runtime.promptVariantInstructions,
    });

    log(`   ${turnReport.passed ? '✅' : '❌'} ${turn.id}${turnReport.issues.length ? ` — ${turnReport.issues.length} issue(s)` : ''}`);
  }

  // 7. Finalise the lesson memory (deterministic summary) and persist it.
  memory = finalizeLessonMemory(memory);
  store.writeFinalMemory(memory);

  // 8. Summarise + write reports.
  const report = buildScenarioReport({
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    courseId,
    unitId: scenario.unitId,
    provider: resolved.mode,
    model: resolved.modelName,
    freedomMode: scenario.freedomMode,
    coursePackageValid: loaded.valid,
    coursePackageValidationErrors: loaded.validationErrors,
    turnReports,
    runDir: store.runDir,
    finishedAt: timestamp,
  });

  store.writeScenarioReport({ json: report, markdown: renderScenarioMarkdown(report) });

  return report;
}
