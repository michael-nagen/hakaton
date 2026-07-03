// ── Teacher Harness — evaluation orchestrator ────────────────────────
//
// Runs the model × strategy × learner-case matrix. For every runnable model
// target and every strategy, each scripted case is replayed through the
// controlled loop (fresh state + fresh lesson memory per case), scored with
// the existing deterministic per-turn scorer plus the evaluation dimensions,
// and aggregated into one EvalComboResult per (model × strategy).
//
// The harness owns everything here: case order, strategy wrapping, guard,
// repair, memory, scoring. Unavailable models (the WebLLM ones) are carried
// through so the report states explicitly what did NOT run.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { getUnitById } from '../../../src/course-package/course-package.loader';
import type { CoursePackage, LearningUnit } from '../../../src/course-package/course-package.types';
import { loadCoursePackage } from '../loading/load-course-package';
import { loadScenario } from '../loading/load-scenario';
import { initLessonState, type LessonState } from '../runtime/lesson-state.types';
import { initLessonMemory } from '../runtime/lesson-memory';
import { LESSON_MEMORY_DEFAULTS, type LessonMemoryMode, type LessonSessionMemory } from '../runtime/lesson-memory.types';
import { LOCKED_TUTOR_CONFIG } from '../config/locked-config';
import { scoreTurn } from '../scoring/score-turn';
import { computeTurnDimensions } from './eval-dimensions';
import { ALL_EVAL_STRATEGIES, runEvalTurn } from './eval-strategies';
import { LEARNER_PROFILES, getProfilesByIds } from './learner-profiles';
import { createProviderForTarget, evalCallDelayMs, selectModelTargets } from './model-targets';
import type {
  EvalCase,
  EvalCaseResult,
  EvalComboResult,
  EvalModelTarget,
  EvalStrategyId,
  EvalTurnRecord,
} from './eval-types';

export interface EvaluationRunInput {
  /**
   * --models all | mock | proxies | comma-list of target ids. When OMITTED,
   * the default is the LOCKED model only (not the full matrix) — pass
   * `--models all` explicitly for the developer matrix.
   */
  models?: string;
  /** --strategies all | comma-list. Omitted → the LOCKED strategy only. */
  strategies?: string;
  /** --profiles all | comma-list of built-in profile ids. */
  profiles?: string;
  /** Memory mode to render (default: the locked last_messages_only). */
  memoryMode?: import('../runtime/lesson-memory.types').LessonMemoryMode;
  /** Optional scenario file or directory folded in as extra scripted cases. */
  scenarioPath?: string;
  scenariosDir?: string;
  verbose?: boolean;
}

export interface EvaluationRunOutput {
  targets: { requested: EvalModelTarget[]; runnable: EvalModelTarget[]; unavailable: EvalModelTarget[] };
  strategies: EvalStrategyId[];
  strategiesUnavailable: Array<{ id: string; reason: string }>;
  cases: EvalCase[];
  combos: EvalComboResult[];
  /** Combos that produced NO data (e.g. quota exhausted before the first case). */
  combosAborted: Array<{ modelLabel: string; strategy: EvalStrategyId; reason: string }>;
}

function resolveStrategies(selector: string | undefined): EvalStrategyId[] {
  if (!selector || selector === 'all') return [...ALL_EVAL_STRATEGIES];
  const ids = selector.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = ids.filter((id) => !(ALL_EVAL_STRATEGIES as readonly string[]).includes(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown strategy id(s): ${unknown.join(', ')}. Known: ${ALL_EVAL_STRATEGIES.join(', ')}`);
  }
  return ids as EvalStrategyId[];
}

function resolveCases(input: EvaluationRunInput): EvalCase[] {
  const cases: EvalCase[] =
    !input.profiles || input.profiles === 'all'
      ? [...LEARNER_PROFILES]
      : getProfilesByIds(input.profiles.split(',').map((s) => s.trim()).filter(Boolean));

  const scenarioFiles: string[] = [];
  if (input.scenarioPath) scenarioFiles.push(resolve(process.cwd(), input.scenarioPath));
  if (input.scenariosDir) {
    const dir = resolve(process.cwd(), input.scenariosDir);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      throw new Error(`--scenarios is not a directory: ${dir}`);
    }
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.scenario.json')).sort()) {
      scenarioFiles.push(resolve(dir, f));
    }
  }
  for (const file of scenarioFiles) {
    const { scenario } = loadScenario(file);
    cases.push({
      id: `scenario:${scenario.id}`,
      title: scenario.title,
      description: scenario.description ?? 'Imported scripted scenario.',
      kind: 'scenario',
      course: scenario.course,
      unitId: scenario.unitId,
      freedomMode: scenario.freedomMode,
      turns: scenario.turns,
    });
  }
  return cases;
}

export interface LoadedCase {
  evalCase: EvalCase;
  coursePackage: CoursePackage;
  unit: LearningUnit;
  courseId: string;
}

export function loadCases(cases: EvalCase[]): LoadedCase[] {
  const cache = new Map<string, ReturnType<typeof loadCoursePackage>>();
  return cases.map((evalCase) => {
    const key = JSON.stringify(evalCase.course);
    let loaded = cache.get(key);
    if (!loaded) {
      loaded = loadCoursePackage(evalCase.course);
      cache.set(key, loaded);
    }
    const unit = getUnitById({ coursePackage: loaded.coursePackage, unitId: evalCase.unitId });
    if (!unit) {
      throw new Error(`Case "${evalCase.id}": unit "${evalCase.unitId}" not found in course "${loaded.coursePackage.id}".`);
    }
    return {
      evalCase,
      coursePackage: loaded.coursePackage,
      unit,
      courseId: evalCase.course.courseId ?? loaded.coursePackage.id,
    };
  });
}

const CORRECTION_LABELS = ['corrects_common_mistake', 'uses_prepared_common_mistake_correction'];

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function rate(flags: boolean[]): number {
  return flags.length === 0 ? 0 : flags.filter(Boolean).length / flags.length;
}

function round(value: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Critical issues for one turn: the failures we consider learner-harmful. */
export function collectCriticalIssues(record: EvalTurnRecord): string[] {
  const critical: string[] = [];
  if (record.dimensions.futureTopicLeak) critical.push('future-topic syntax leaked to the learner');
  if (record.dimensions.forbiddenTopicLeak) critical.push('explicitly forbidden behaviour exhibited');
  if (record.dimensions.advancedTooEarly) critical.push('advanced/completed the lesson too early');
  if (record.tutorResponse.trim() === '') critical.push('empty tutor reply');
  return critical;
}

/** Aggregate all turn records of one (model × strategy) combination. */
export function aggregateCombo(params: {
  target: EvalModelTarget;
  strategy: EvalStrategyId;
  records: EvalTurnRecord[];
  perCase: EvalCaseResult[];
  casesExpected: number;
}): EvalComboResult {
  const { target, strategy, records, perCase, casesExpected } = params;
  const dims = records.map((r) => r.dimensions);
  const tel = records.map((r) => r.telemetry);

  const criticalPerTurn = records.map(collectCriticalIssues);
  const totalCritical = criticalPerTurn.reduce((a, c) => a + c.length, 0);
  const turnsWithCritical = criticalPerTurn.filter((c) => c.length > 0).length;

  const expectedResults = records.flatMap((r) => r.base.expectedBehaviorResults.filter((b) => !b.unscored));
  const correctionFlags = dims
    .map((d) => d.correctedCommonMistake)
    .filter((v): v is boolean => v !== null);
  const memoryFlags = dims.map((d) => d.usedLessonMemory).filter((v): v is boolean => v !== null);

  const passRate = rate(records.map((r) => r.passed));
  const futureLeakRate = rate(dims.map((d) => d.futureTopicLeak));
  const forbiddenLeakRate = rate(dims.map((d) => d.forbiddenTopicLeak));
  const advanceRate = rate(dims.map((d) => d.advancedTooEarly));
  const criticalTurnRate = records.length === 0 ? 0 : turnsWithCritical / records.length;
  const brevityBothOk = rate(dims.map((d) => d.brevityOk && !d.overExplained));
  const expectedPassRate =
    expectedResults.length === 0 ? 1 : rate(expectedResults.map((b) => b.passed));
  const avgGroundedness = mean(dims.map((d) => d.groundedness));
  const correctionRate = correctionFlags.length === 0 ? 1 : rate(correctionFlags);
  const hintOkRate = rate(dims.map((d) => d.hintNotFullAnswer));
  const warmthRate = rate(dims.map((d) => d.warmth));
  const overExplainRate = rate(dims.map((d) => d.overExplained));

  // Composite 0–100. Weights are a documented editorial choice:
  //   40 turn pass rate, 15 groundedness, 15 no future leakage,
  //   10 no critical turns, 10 brevity discipline, 10 expected behaviours.
  const compositeScore =
    passRate * 40 +
    (avgGroundedness / 5) * 15 +
    (1 - futureLeakRate) * 15 +
    (1 - criticalTurnRate) * 10 +
    brevityBothOk * 10 +
    expectedPassRate * 10;

  // Safety 0–100: leakage + forbidden behaviour + early advancement + criticals.
  const safetyScore =
    (1 - futureLeakRate) * 40 + (1 - forbiddenLeakRate) * 30 + (1 - advanceRate) * 20 + (1 - criticalTurnRate) * 10;

  // Teaching quality 0–100: contract behaviours + corrections + hint discipline
  // + tone/length discipline.
  const teachingScore =
    expectedPassRate * 45 + correctionRate * 25 + hintOkRate * 15 + warmthRate * 7.5 + (1 - overExplainRate) * 7.5;

  // Recurring issue patterns: normalised issue strings counted across turns.
  const issueCounts = new Map<string, number>();
  for (const r of records) {
    const all = [...r.issues, ...r.telemetry.guardIssuesFinal.map((i) => `guard(final): ${i.rule}`)];
    for (const raw of all) {
      const norm = raw.replace(/\(\d+(?:\.\d+)?\/5\)/g, '(n/5)').trim();
      issueCounts.set(norm, (issueCounts.get(norm) ?? 0) + 1);
    }
  }
  const recurringIssues = [...issueCounts.entries()]
    .map(([issue, count]) => ({ issue, count }))
    .filter((e) => e.count >= 2)
    .sort((a, b) => b.count - a.count);

  return {
    modelTargetId: target.id,
    modelLabel: target.label,
    providerMode: target.kind,
    isRealWebllm: target.isRealWebllm,
    qualitySignal: target.qualitySignal,
    strategy,
    partial: perCase.length < casesExpected,
    totals: {
      cases: perCase.length,
      casesExpected,
      turns: records.length,
      passedTurns: records.filter((r) => r.passed).length,
      failedTurns: records.filter((r) => !r.passed).length,
      criticalIssues: totalCritical,
      modelCalls: tel.reduce((a, t) => a + t.modelCalls, 0),
      repairs: tel.filter((t) => t.repaired).length,
      fallbacks: tel.filter((t) => t.fallbackUsed).length,
      criticReplacements: tel.filter((t) => t.criticReplaced).length,
    },
    averages: {
      latencyMs: round(mean(tel.map((t) => t.totalLatencyMs)), 1),
      callsPerTurn: round(mean(tel.map((t) => t.modelCalls)), 2),
      responseChars: round(mean(dims.map((d) => d.responseChars)), 1),
      responseWords: round(mean(dims.map((d) => d.responseWords)), 1),
      groundedness: round(avgGroundedness, 2),
    },
    rates: {
      passRate: round(passRate),
      futureTopicLeakRate: round(futureLeakRate),
      forbiddenLeakRate: round(forbiddenLeakRate),
      correctionRate: round(correctionRate),
      hintOkRate: round(hintOkRate),
      redirectRate: round(rate(dims.map((d) => d.redirected))),
      uncertaintyRate: round(rate(dims.map((d) => d.uncertaintySignaled))),
      brevityOkRate: round(rate(dims.map((d) => d.brevityOk))),
      overExplainRate: round(overExplainRate),
      warmthRate: round(warmthRate),
      advanceTooEarlyRate: round(advanceRate),
      memoryUseRate: round(memoryFlags.length === 0 ? 0 : rate(memoryFlags)),
      repetitionRate: round(rate(dims.map((d) => d.repetition))),
      groundedAnswerRate: round(rate(dims.map((d) => d.answersFromCourseMaterial))),
      expectedBehaviorPassRate: round(expectedPassRate),
    },
    compositeScore: round(compositeScore, 1),
    safetyScore: round(safetyScore, 1),
    teachingScore: round(teachingScore, 1),
    perCase,
    recurringIssues,
    turns: records,
  };
}

/** Run one case (fresh state + memory) under one strategy/provider. */
export async function runCase(params: {
  loaded: LoadedCase;
  strategy: EvalStrategyId;
  provider: ReturnType<typeof createProviderForTarget>;
  paceMs: number;
  /** Which memory representation to render into the prompt (default: structured). */
  memoryMode?: import('../runtime/lesson-memory.types').LessonMemoryMode;
  /** Which tutor prompt variant to render (default: full_current_prompt). */
  promptVariant?: import('../runtime/tutor-prompt-variants').TutorPromptVariant;
  /** Optional sink for per-turn prompt-variant artifacts (memory/prompt text). */
  onTurn?: (turnIndex: number, outcome: import('./eval-strategies').EvalTurnOutcome, loaded: LoadedCase) => void;
}): Promise<{ records: EvalTurnRecord[]; caseResult: EvalCaseResult }> {
  const { loaded, strategy, provider, paceMs, memoryMode, promptVariant } = params;
  const { evalCase, coursePackage, unit, courseId } = loaded;

  let state: LessonState = initLessonState({ courseId, unitId: evalCase.unitId });
  let memory: LessonSessionMemory = initLessonMemory({ courseId, unitId: evalCase.unitId, unit });

  const records: EvalTurnRecord[] = [];
  const previousTutorReplies: string[] = [];

  for (let i = 0; i < evalCase.turns.length; i += 1) {
    const turn = evalCase.turns[i];
    const memoryBefore = structuredClone(memory.working);

    const outcome = await runEvalTurn({
      strategy,
      turnId: turn.id,
      coursePackage,
      unit,
      unitId: evalCase.unitId,
      learnerMessage: turn.learnerMessage,
      provider,
      freedomMode: evalCase.freedomMode,
      state,
      memory,
      paceMs,
      memoryMode,
      promptVariant,
    });
    state = outcome.stateAfter;
    memory = outcome.memoryAfter;
    params.onTurn?.(i + 1, outcome, loaded);

    const base = scoreTurn({ turn, result: outcome });
    const dimensions = computeTurnDimensions({
      reply: outcome.runtime.answer,
      context: outcome.runtime.context,
      turnIndex: i,
      memoryBefore,
      previousTutorReplies,
      forbiddenExhibited: base.forbiddenBehaviorResults.some((r) => !r.unscored && !r.passed),
      mistakeRelevant: turn.expectedBehaviors.some((b) => CORRECTION_LABELS.includes(b)),
    });
    previousTutorReplies.push(outcome.runtime.answer);

    records.push({
      caseId: evalCase.id,
      turnId: turn.id,
      learnerMessage: turn.learnerMessage,
      tutorResponse: outcome.runtime.answer,
      passed: base.passed,
      issues: base.issues,
      base,
      dimensions,
      telemetry: outcome.telemetry,
      memorySentToModel: outcome.runtime.memorySentToModel,
      promptVariant: outcome.runtime.promptVariant,
      promptSizes: outcome.runtime.promptSizes,
    });
  }

  const criticalIssues = records.flatMap((r) =>
    collectCriticalIssues(r).map((c) => `${evalCase.id}/${r.turnId}: ${c}`),
  );
  return {
    records,
    caseResult: {
      caseId: evalCase.id,
      caseTitle: evalCase.title,
      totalTurns: records.length,
      passedTurns: records.filter((r) => r.passed).length,
      criticalIssues,
      failedTurnIds: records.filter((r) => !r.passed).map((r) => r.turnId),
    },
  };
}

export async function runEvaluation(input: EvaluationRunInput): Promise<EvaluationRunOutput> {
  const log = (msg: string) => {
    if (input.verbose) console.log(msg);
  };

  // LOCKED DEFAULT: with no explicit --models/--strategies, run ONLY the locked
  // best setup (Llama 3.2 3B + repair_pass) — not the full matrix. Developers
  // opt into the matrix explicitly with `--models all --strategies all`.
  const modelsSelector = input.models ?? LOCKED_TUTOR_CONFIG.modelTargetId;
  const strategiesSelector = input.strategies ?? LOCKED_TUTOR_CONFIG.strategy;
  const memoryMode: LessonMemoryMode = input.memoryMode ?? LESSON_MEMORY_DEFAULTS.mode;

  const targets = selectModelTargets(modelsSelector);
  const strategies = resolveStrategies(strategiesSelector);
  const cases = resolveCases(input);
  const loadedCases = loadCases(cases);

  if (!input.models && !input.strategies) {
    log(
      `  🔒 locked default: ${LOCKED_TUTOR_CONFIG.modelName} × ${LOCKED_TUTOR_CONFIG.strategy} × memory ${memoryMode}(${LESSON_MEMORY_DEFAULTS.lastMessagesLimit}). Pass --models all --strategies all for the developer matrix.`,
    );
  }

  // All five strategies are implemented in this lab; the field exists so a
  // future strategy can be declared without pretending it ran.
  const strategiesUnavailable: Array<{ id: string; reason: string }> = [];

  for (const t of targets.unavailable) log(`  ⛔ ${t.id} — not runnable: ${(t.unavailableReason ?? '').split('.')[0]}.`);

  const combos: EvalComboResult[] = [];
  const combosAborted: EvaluationRunOutput['combosAborted'] = [];
  for (const target of targets.runnable) {
    const provider = createProviderForTarget(target);
    const paceMs = evalCallDelayMs(target);
    if (paceMs > 0) log(`  ⏱ pacing ${target.id}: ${paceMs}ms between calls (TEACHER_HARNESS_EVAL_CALL_DELAY_MS to change)`);
    for (const strategy of strategies) {
      log(`\n▶ ${target.id} × ${strategy}`);
      const allRecords: EvalTurnRecord[] = [];
      const perCase: EvalCaseResult[] = [];
      // One combo failing (e.g. a provider quota exhausting mid-run despite
      // retries) must not lose the rest of the matrix: record and move on.
      try {
        for (const loaded of loadedCases) {
          const { records, caseResult } = await runCase({ loaded, strategy, provider, paceMs, memoryMode });
          allRecords.push(...records);
          perCase.push(caseResult);
          log(
            `   ${caseResult.passedTurns === caseResult.totalTurns ? '✅' : '❌'} ${loaded.evalCase.id} — ${caseResult.passedTurns}/${caseResult.totalTurns} turns` +
              (caseResult.criticalIssues.length ? `, ${caseResult.criticalIssues.length} critical` : ''),
          );
        }
      } catch (err) {
        console.error(
          `   ✖ ${target.id} × ${strategy} aborted after ${perCase.length}/${loadedCases.length} case(s): ${(err as Error).message}`,
        );
        if (perCase.length === 0) {
          // Nothing measurable — record the gap so the report can name it.
          combosAborted.push({ modelLabel: target.label, strategy, reason: (err as Error).message });
          continue;
        }
      }
      combos.push(
        aggregateCombo({ target, strategy, records: allRecords, perCase, casesExpected: loadedCases.length }),
      );
    }
  }

  return { targets, strategies, strategiesUnavailable, cases, combos, combosAborted };
}
