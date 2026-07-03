// ── Teacher Harness — CLI entrypoint ─────────────────────────────────
//
// Commands:
//   run      --scenario <path> [--mock] [--reset-memory]   run one scenario
//   batch    --scenarios <dir>  [--mock] [--reset-memory]  run every *.scenario.json in a dir
//   report   --run <runs-dir>             re-summarise existing run artifacts
//   memory   --delete --run <run-dir>     delete ONLY a run's memory artifacts
//   evaluate [--models ...] [--strategies ...] [--profiles ...] [--scenarios <dir>]
//            internal research lab: model × strategy × learner-profile matrix
//
// Exit code is non-zero when any scenario fails, so this composes in CI.

import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { HARNESS_ROOT } from './config/harness-config';
import { parseCliArgs, type CliArgs } from './harness/cli-args';
import { runScenario } from './harness/run-scenario';
import { writeBatchReport } from './reporting/report-writer';
import type { BatchReport, ScenarioReport } from './reporting/report.types';
import { runEvaluation } from './evaluation/run-evaluation';
import { buildEvaluationReport, writeEvaluationReport } from './evaluation/eval-report';
import { closeEvalBridges } from './evaluation/model-targets';
import { runLessonVariantEvaluation } from './evaluation/run-lesson-variant-eval';
import { buildLessonVariantReport, writeLessonVariantReport } from './evaluation/lesson-variant-report';
import { runMemoryEvaluation } from './evaluation/run-memory-eval';
import { buildMemoryEvalReport, writeMemoryEvalReport } from './evaluation/memory-eval-report';
import { runPromptEvaluation } from './evaluation/run-prompt-eval';
import { buildPromptEvalReport, writePromptEvalReport } from './evaluation/prompt-eval-report';
import { readLatestDeterministic, runLlmJudgeEvaluation } from './evaluation/run-llm-judge-eval';
import { buildJudgeReport, readPriorJudgeReport, writeJudgeReport } from './evaluation/llm-judge-report';
import { runRealCourseEvaluation } from './evaluation/run-real-course-eval';
import { buildRealCourseReport, writeRealCourseReport } from './evaluation/real-course-report';
import { LESSON_MEMORY_DEFAULTS, resolveLessonMemoryMode } from './runtime/lesson-memory.types';
import { resolveTutorPromptVariant } from './runtime/tutor-prompt-variants';
import { LOCKED_TUTOR_CONFIG } from './config/locked-config';

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

async function commandRun(
  scenarioPath: string | undefined,
  mock: boolean,
  resetMemory: boolean,
  memoryModeRaw: string | undefined,
  promptVariantRaw: string | undefined,
): Promise<void> {
  if (!scenarioPath) fail('run requires --scenario <path>');
  const memoryMode = resolveLessonMemoryMode(memoryModeRaw);
  const promptVariant = resolveTutorPromptVariant(promptVariantRaw);
  const report = await runScenario({
    scenarioPath: scenarioPath as string,
    forceMock: mock,
    resetMemory,
    memoryMode,
    promptVariant,
    verbose: true,
  });

  console.log(`\n${report.passed ? '✅ PASS' : '❌ FAIL'} — ${report.scenarioId}`);
  console.log(`   turns: ${report.summary.passedTurns} passed / ${report.summary.failedTurns} failed`);
  if (report.summary.criticalIssues.length) {
    console.log('   critical issues:');
    for (const c of report.summary.criticalIssues) console.log(`     - ${c}`);
  }
  console.log(`   artifacts: ${report.runDir}`);
  process.exit(report.passed ? 0 : 1);
}

async function commandBatch(
  scenariosDir: string | undefined,
  mock: boolean,
  resetMemory: boolean,
  memoryModeRaw: string | undefined,
  promptVariantRaw: string | undefined,
): Promise<void> {
  if (!scenariosDir) fail('batch requires --scenarios <dir>');
  const memoryMode = resolveLessonMemoryMode(memoryModeRaw);
  const promptVariant = resolveTutorPromptVariant(promptVariantRaw);
  const dir = resolve(process.cwd(), scenariosDir as string);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`Not a directory: ${dir}`);

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.scenario.json'))
    .sort()
    .map((f) => resolve(dir, f));
  if (files.length === 0) fail(`No *.scenario.json files in ${dir}`);

  const timestamp = new Date().toISOString();
  const reports: ScenarioReport[] = [];
  for (const file of files) {
    console.log(`\n=== ${file} ===`);
    try {
      reports.push(await runScenario({ scenarioPath: file, forceMock: mock, resetMemory, memoryMode, promptVariant, timestamp, verbose: true }));
    } catch (err) {
      console.error(`   ✖ scenario errored: ${(err as Error).message}`);
    }
  }

  const passedScenarios = reports.filter((r) => r.passed).length;
  const batch: BatchReport = {
    finishedAt: timestamp,
    provider: reports[0]?.provider ?? (mock ? 'mock' : 'unknown'),
    model: reports[0]?.model ?? (mock ? 'mock' : 'unknown'),
    totalScenarios: reports.length,
    passedScenarios,
    failedScenarios: reports.length - passedScenarios,
    scenarios: reports.map((r) => ({
      scenarioId: r.scenarioId,
      passed: r.passed,
      passedTurns: r.summary.passedTurns,
      failedTurns: r.summary.failedTurns,
      runDir: r.runDir,
    })),
  };

  const { jsonPath, mdPath } = writeBatchReport(batch);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Batch: ${passedScenarios}/${reports.length} scenarios passed.`);
  console.log(`Report: ${mdPath}`);
  console.log(`        ${jsonPath}`);
  process.exit(batch.failedScenarios === 0 ? 0 : 1);
}

/** Re-read scenario-report.json files under a runs dir and print a table. */
function commandReport(runsDir: string | undefined): void {
  if (!runsDir) fail('report requires --run <runs-dir>');
  const dir = resolve(process.cwd(), runsDir as string);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`Not a directory: ${dir}`);

  const runDirs = readdirSync(dir)
    .map((name) => resolve(dir, name))
    .filter((p) => statSync(p).isDirectory() && existsSync(resolve(p, 'scenario-report.json')));

  if (runDirs.length === 0) fail(`No scenario-report.json found under ${dir}`);

  console.log(`\nRuns under ${dir}:\n`);
  let passed = 0;
  for (const runDir of runDirs) {
    const report = JSON.parse(readFileSync(resolve(runDir, 'scenario-report.json'), 'utf8')) as ScenarioReport;
    if (report.passed) passed += 1;
    console.log(
      `${report.passed ? '✅' : '❌'} ${report.scenarioId}  (${report.summary.passedTurns}/${
        report.summary.passedTurns + report.summary.failedTurns
      } turns)  ${report.provider}/${report.model}`,
    );
  }
  console.log(`\n${passed}/${runDirs.length} runs passed.`);
}

/**
 * Delete ONLY the lesson-memory artifacts of one run (harness-created,
 * per-run session memory — NOT durable learner memory, and NOT a DB):
 *   turn-N/memory.working.json, turn-N/memory.archive.json,
 *   lesson-memory.final.json, memory-reset.json
 * Everything else (scenario, course snapshots, prompts/responses/scores,
 * reports) is deliberately left untouched.
 */
function commandMemory(runDir: string | undefined, doDelete: boolean): void {
  if (!runDir) fail('memory requires --run <run-dir>');
  if (!doDelete) fail('memory currently supports only deletion — pass --delete to confirm.');
  const dir = resolve(process.cwd(), runDir as string);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`Not a directory: ${dir}`);

  const targets: string[] = [resolve(dir, 'lesson-memory.final.json'), resolve(dir, 'memory-reset.json')];
  for (const entry of readdirSync(dir)) {
    if (/^turn-\d+$/.test(entry) && statSync(resolve(dir, entry)).isDirectory()) {
      targets.push(resolve(dir, entry, 'memory.working.json'));
      targets.push(resolve(dir, entry, 'memory.archive.json'));
    }
  }

  let deleted = 0;
  for (const target of targets) {
    if (existsSync(target)) {
      rmSync(target);
      console.log(`  🗑 deleted ${target}`);
      deleted += 1;
    }
  }
  console.log(
    deleted === 0
      ? `No memory artifacts found under ${dir} — nothing deleted.`
      : `Deleted ${deleted} memory artifact(s) from ${dir}. Scenario, snapshots, prompts, scores and reports were left untouched.`,
  );
}

/**
 * Internal evaluation lab: run the model × strategy × learner-profile matrix
 * and write reports/model-strategy-evaluation-<timestamp>.{json,md}. Exit code
 * stays 0 as long as the evaluation itself completed — a failing tutor is a
 * RESULT here, not an error.
 */
async function commandEvaluate(args: CliArgs): Promise<void> {
  const finishedAt = new Date().toISOString();
  let output;
  try {
    output = await runEvaluation({
      models: args.models,
      strategies: args.strategies,
      profiles: args.profiles,
      memoryMode: args.memoryMode ? resolveLessonMemoryMode(args.memoryMode) : undefined,
      scenarioPath: args.scenario,
      scenariosDir: args.scenariosDir,
      verbose: true,
    });
  } finally {
    closeEvalBridges();
  }
  const report = buildEvaluationReport(output, finishedAt);
  const { jsonPath, mdPath } = writeEvaluationReport(report, args.reportPrefix);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Evaluated ${output.combos.length} model×strategy combination(s) over ${output.cases.length} learner case(s).`);
  console.log(`Real WebLLM models executed: ${report.metadata.webllmActuallyRan ? 'yes' : 'NO (see Limitations in the report)'}`);
  const best = report.recommendations.best;
  const second = report.recommendations.secondBest;
  if (best) console.log(`Best option:        ${best.modelLabel} × ${best.strategy} (score ${best.score})`);
  if (second) console.log(`Second-best option: ${second.modelLabel} × ${second.strategy} (score ${second.score})`);
  console.log(`Report: ${mdPath}`);
  console.log(`        ${jsonPath}`);
}

/**
 * Focused lesson-variant experiment: fixed model (real Llama 3.2 3B via the
 * WebLLM browser bridge) + fixed strategy (repair_pass), varying only the
 * CoursePackage variant. Writes reports/lesson-variant-evaluation-<ts>.{json,md}.
 * Exit stays 0 when the evaluation itself completes.
 */
async function commandEvaluateLessonVariants(): Promise<void> {
  const finishedAt = new Date().toISOString();
  let output;
  try {
    output = await runLessonVariantEvaluation({ timestamp: finishedAt, verbose: true });
  } finally {
    closeEvalBridges();
  }
  const report = buildLessonVariantReport(output, finishedAt);
  const { jsonPath, mdPath } = writeLessonVariantReport(report);

  console.log(`\n${'='.repeat(60)}`);
  console.log(report.status.statement);
  console.log(`Variants evaluated: ${report.evaluatedVariants.join(', ') || '(none)'}`);
  if (report.missingVariants.length) console.log(`Variants missing:   ${report.missingVariants.join(', ')}`);
  if (report.recommendations.best) {
    console.log(`Best variant:        ${report.recommendations.best.variantId} (score ${report.recommendations.best.score})`);
  }
  if (report.recommendations.secondBest) {
    console.log(`Second-best variant: ${report.recommendations.secondBest.variantId} (score ${report.recommendations.secondBest.score})`);
  }
  console.log(`Report: ${mdPath}`);
  console.log(`        ${jsonPath}`);
}

/**
 * Focused lesson-memory experiment: fixed model (real Llama 3.2 3B via the
 * WebLLM bridge) + repair_pass + high_very_guided, varying only the memory
 * mode. Writes reports/memory-evaluation-<ts>.{json,md}.
 */
async function commandEvaluateMemory(): Promise<void> {
  const finishedAt = new Date().toISOString();
  let output;
  try {
    output = await runMemoryEvaluation({ timestamp: finishedAt, verbose: true });
  } finally {
    closeEvalBridges();
  }
  const report = buildMemoryEvalReport(output, finishedAt);
  const { jsonPath, mdPath } = writeMemoryEvalReport(report);

  console.log(`\n${'='.repeat(60)}`);
  console.log(report.status.statement);
  const best = report.recommendations.best;
  const second = report.recommendations.secondBest;
  if (best) console.log(`Best memory mode:        ${best.memoryMode} (score ${best.score})`);
  if (second) console.log(`Second-best memory mode: ${second.memoryMode} (score ${second.score})`);
  console.log(`Report: ${mdPath}`);
  console.log(`        ${jsonPath}`);
}

/**
 * Focused tutor prompt-efficiency experiment: fixed model (real Llama 3.2 3B
 * via the WebLLM bridge) + repair_pass + high_very_guided + last_messages_only(8),
 * varying only the tutor prompt variant across 16 scripted learner profiles.
 * Writes reports/prompt-efficiency-evaluation-<ts>.{json,md}.
 */
async function commandEvaluatePrompts(): Promise<void> {
  const finishedAt = new Date().toISOString();
  let output;
  try {
    output = await runPromptEvaluation({ timestamp: finishedAt, verbose: true });
  } finally {
    closeEvalBridges();
  }
  const report = buildPromptEvalReport(output, finishedAt);
  const { jsonPath, mdPath } = writePromptEvalReport(report);

  console.log(`\n${'='.repeat(60)}`);
  console.log(report.status.statement);
  const best = report.recommendations.best;
  const second = report.recommendations.secondBest;
  const shortest = report.recommendations.shortestAcceptable;
  if (best) console.log(`Best prompt:            ${best.promptVariant} (score ${best.score})`);
  if (second) console.log(`Second-best prompt:     ${second.promptVariant} (score ${second.score})`);
  if (shortest) console.log(`Shortest acceptable:    ${shortest.promptVariant} (${shortest.instructionChars} instruction chars)`);
  console.log('Production tutor prompt NOT replaced (variants live only in teacher-harness).');
  console.log(`Report: ${mdPath}`);
  console.log(`        ${jsonPath}`);
}

/**
 * Second-pass LLM-judge comparison of the top-2 prompt variants
 * (full_current_prompt vs structured_rules_prompt). Reuses the tutor outputs
 * from the latest prompt-efficiency run (no local rerun) and layers a strong
 * cloud judge on top. Writes reports/llm-judge-top2-evaluation-<ts>.{json,md}.
 * Never fabricates: if the judge has no credentials, the report says exactly
 * which env vars to set. Production Tutor prompt is NOT touched or promoted.
 */
async function commandEvaluateJudge(): Promise<void> {
  const finishedAt = new Date().toISOString();
  const output = await runLlmJudgeEvaluation({ timestamp: finishedAt, verbose: true });
  // Cross-judge comparison against the newest prior judge run of a DIFFERENT model
  // (e.g. OpenAI as decision-maker vs the earlier Gemini flash-lite sanity check).
  const prior = readPriorJudgeReport(output.judgeModel ?? null);
  const report = buildJudgeReport(output, readLatestDeterministic(), prior);
  const { jsonPath, mdPath } = writeJudgeReport(report);

  console.log(`\n${'='.repeat(60)}`);
  if (!report.ran) {
    console.log('LLM judge did NOT run.');
    console.log(report.unavailableReason ?? 'Unknown reason.');
    if (report.neededEnv?.length) console.log(`Set: ${report.neededEnv.join(', ')}`);
  } else {
    console.log(`Judge model:            ${report.judgeModel} (${report.judgeSource})`);
    console.log(`Judge calls:            ${report.totals.judgedOk}/${report.totals.totalTurns} ok (${report.totals.repaired} repaired, ${report.totals.judgeFailed} failed)`);
    console.log(`Deterministic winner:   ${report.deterministicWinner}`);
    console.log(`LLM judge winner:       ${report.judgeWinner}`);
    console.log(`Agreement (vs rules):   ${report.agree === null ? 'n/a' : report.agree ? 'AGREE' : 'DISAGREE'}`);
    if (report.crossJudge) {
      console.log(`Secondary judge:        ${report.crossJudge.priorModel} — winner ${report.crossJudge.judgesAgreeOnWinner === null ? 'n/a' : report.crossJudge.judgesAgreeOnWinner ? 'AGREE' : 'DISAGREE'}${report.crossJudge.priorLooksTooLenient ? ' (TOO LENIENT — discounted)' : ''}`);
    }
    console.log('Production tutor prompt NOT promoted (evaluation only).');
  }
  console.log(`Report: ${mdPath}`);
  console.log(`        ${jsonPath}`);
}

/**
 * Real-course validation of the top-2 prompt variants: real local Llama WebLLM
 * tutor + OpenAI judge on a REAL (non-placeholder) CourseFactory course. Fixed
 * runtime (repair_pass / last_messages_only(8) / completion disabled). Writes
 * reports/real-course-top2-validation-<ts>.{json,md}. Production prompt untouched.
 */
async function commandEvaluateRealCourse(course: string | undefined, unitsCsv: string | undefined): Promise<void> {
  const outputDir = resolve(HARNESS_ROOT, '..', 'course-factory', 'output');
  const DEFAULT_COURSE = 'course-python-variables-101.final.json';
  const coursePath = course
    ? (existsSync(course) ? course : resolve(outputDir, course))
    : resolve(outputDir, DEFAULT_COURSE);

  if (!existsSync(coursePath)) {
    fail(
      `Real course not found: ${coursePath}. Available under course-factory/output/: ` +
        `${existsSync(outputDir) ? readdirSync(outputDir).filter((f) => f.endsWith('.final.json')).join(', ') || '(none)' : '(dir missing)'}.`,
    );
    return;
  }

  const pkg = JSON.parse(readFileSync(coursePath, 'utf8')) as { courseId?: string; id?: string; title?: string; units?: Array<{ id: string }> };
  const courseId = pkg.courseId ?? pkg.id ?? 'unknown-course';
  const allUnitIds = (pkg.units ?? []).map((u) => u.id);
  if (allUnitIds.length === 0) fail(`Course ${courseId} has no units.`);
  // Guard against silently validating the placeholder mock-demo course.
  if (/mock[-_]?demo|placeholder/i.test(courseId)) {
    fail(`Refusing to run REAL-course validation on the placeholder course "${courseId}". Pass a real course via --course.`);
    return;
  }
  const unitIds = unitsCsv
    ? unitsCsv.split(',').map((s) => s.trim()).filter(Boolean)
    : allUnitIds.slice(0, 2); // default: first two units (second unit if available)

  console.log(`\n🎓 Real-course validation — ${courseId} — units: ${unitIds.join(', ')}`);
  const finishedAt = new Date().toISOString();
  const output = await runRealCourseEvaluation({ timestamp: finishedAt, coursePath, courseId, unitIds, verbose: true });
  const report = buildRealCourseReport(output);
  const { jsonPath, mdPath } = writeRealCourseReport(report);

  console.log(`\n${'='.repeat(60)}`);
  if (!report.judge.ran) {
    console.log(`Validation did NOT complete: ${output.incompleteReason ?? report.judge.unavailableReason ?? 'unknown'}`);
  } else {
    const full = report.judge.variants.find((v) => v.variant === 'full_current_prompt');
    const structured = report.judge.variants.find((v) => v.variant === 'structured_rules_prompt');
    console.log(`Course:                 ${courseId} (units ${unitIds.join(', ')})`);
    console.log(`Judge:                  ${report.judgeModel} — ${report.totals.judgedOk}/${report.totals.totalTurns} ok (${report.totals.judgeFailed} failed)`);
    console.log(`Deterministic winner:   ${report.judge.deterministicWinner}`);
    console.log(`OpenAI judge winner:    ${report.judge.judgeWinner} (full ${full?.overallAvg}/10 vs structured ${structured?.overallAvg}/10)`);
    console.log('Production tutor prompt NOT promoted (validation only).');
  }
  console.log(`Report: ${mdPath}`);
  console.log(`        ${jsonPath}`);
}

/**
 * Config verification — print the resolved locked defaults from the single
 * source of truth (LOCKED_TUTOR_CONFIG) and confirm the judge is eval-only.
 * Pure config resolution: NO Chrome, NO WebLLM, NO OpenAI call, NO evaluation.
 */
function commandConfig(): void {
  const c = LOCKED_TUTOR_CONFIG;
  // Cross-check the resolvers that connected paths actually use resolve to the lock.
  const resolvedPromptDefault = resolveTutorPromptVariant(undefined);
  const resolvedMemory = LESSON_MEMORY_DEFAULTS;
  const lines = [
    `promptVariant = ${c.promptVariant}`,
    `baselinePromptVariant = ${c.baselinePromptVariant}`,
    `backupPromptVariant = ${c.backupPromptVariant}`,
    `lessonVariant = ${c.lessonVariant}`,
    `model = ${c.modelName}`,
    `strategy = ${c.strategy}`,
    `memoryMode = ${c.memoryMode}`,
    `lastMessagesLimit = ${c.lastMessagesLimit}`,
    `lessonCompletion = ${c.lessonCompletion === 'disabled' ? 'false' : 'true'}`,
    `judge = eval-only, not default runtime (run \`npm run evaluate:judge\`; provider default ${c.judgeProvider})`,
  ];
  console.log('\nTeacher Harness — resolved locked defaults (source: src/config/locked-config.ts)\n');
  console.log(lines.join('\n'));

  // Consistency guards: the connected resolvers must agree with the lock.
  const problems: string[] = [];
  if (resolvedPromptDefault !== c.promptVariant) problems.push(`plain-run prompt default resolves to "${resolvedPromptDefault}", expected "${c.promptVariant}"`);
  if (resolvedMemory.mode !== c.memoryMode) problems.push(`memory default mode "${resolvedMemory.mode}" != locked "${c.memoryMode}"`);
  if (resolvedMemory.lastMessagesLimit !== c.lastMessagesLimit) problems.push(`memory limit ${resolvedMemory.lastMessagesLimit} != locked ${c.lastMessagesLimit}`);
  console.log('');
  if (problems.length === 0) {
    console.log('✅ connected resolvers agree with the locked defaults.');
  } else {
    console.log('❌ config drift detected:');
    for (const p of problems) console.log(`   - ${p}`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  switch (args.command) {
    case 'run':
      await commandRun(args.scenario, args.mock, args.resetMemory, args.memoryMode, args.promptVariant);
      break;
    case 'batch':
      await commandBatch(args.scenariosDir, args.mock, args.resetMemory, args.memoryMode, args.promptVariant);
      break;
    case 'report':
      commandReport(args.runsDir);
      break;
    case 'memory':
      commandMemory(args.runsDir, args.delete);
      break;
    case 'evaluate':
      await commandEvaluate(args);
      break;
    case 'evaluate-lesson-variants':
      await commandEvaluateLessonVariants();
      break;
    case 'evaluate-memory':
      await commandEvaluateMemory();
      break;
    case 'evaluate-prompts':
      await commandEvaluatePrompts();
      break;
    case 'evaluate-judge':
      await commandEvaluateJudge();
      break;
    case 'evaluate-real-course':
      await commandEvaluateRealCourse(args.course, args.units);
      break;
    case 'config':
      commandConfig();
      break;
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
