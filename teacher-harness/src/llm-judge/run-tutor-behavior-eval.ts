// ── Teacher Harness — tutor-behavior eval runner ────────────────────
//
// Standalone runner for the teaching-behavior test. It drives the REAL runtime
// path used by the rest of the harness — buildTutorContext + buildVariantPrompt
// (default: the locked structured_rules_prompt) + the deterministic scorer —
// against a chosen provider, then OPTIONALLY runs the LLM behavior judge for
// the fuzzy criteria. Output is a per-turn PASS/FAIL with reasons and a small
// prompt-improvement suggestion; a JSON + Markdown report is written under
// teacher-harness/reports/tutor-behavior/.
//
// Run it directly (no npm script needed — kept isolated inside teacher-harness):
//   npx tsx src/llm-judge/run-tutor-behavior-eval.ts                 # mock provider, deterministic only
//   npx tsx src/llm-judge/run-tutor-behavior-eval.ts --judge         # + LLM judge (needs TEACHER_HARNESS_JUDGE_* env)
//   npx tsx src/llm-judge/run-tutor-behavior-eval.ts --openai --judge# real weak-model proxy + judge
//   npx tsx src/llm-judge/run-tutor-behavior-eval.ts --webllm --judge# REAL on-device Llama via the browser bridge
//
// FIDELITY: this tests the on-device model teaching from the REAL course
// context under the shared behavior rules (structured_rules_prompt). It is NOT
// a byte-identical replay of the live lesson request, which uses the JSON
// envelope prompt (build-tutor-response-prompt.ts) + the repair_pass strategy.
// The banner below states this on every run so results are not over-read.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getUnitById } from '../../../src/course-package/course-package.loader';
import type { LearningUnit } from '../../../src/course-package/course-package.types';
import { HARNESS_ROOT, resolveProviderConfig } from '../config/harness-config';
import { lockedConfigMetadata } from '../config/locked-config';
import { buildUnitExcerpt } from '../evaluation/llm-judge';
import {
  closeEvalBridges,
  createProviderForTarget,
  selectModelTargets,
  withRetry,
} from '../evaluation/model-targets';
import { loadCoursePackage } from '../loading/load-course-package';
import { loadScenario, type Scenario, type ScenarioTurn } from '../loading/load-scenario';
import { createMockTeacherProvider } from '../model/mock-teacher-provider';
import type { ModelProvider } from '../model/model-provider.types';
import { resolveProvider } from '../model/model-client';
import { finalizeLessonMemory, initLessonMemory } from '../runtime/lesson-memory';
import type { LessonSessionMemory } from '../runtime/lesson-memory.types';
import { initLessonState, type LessonState } from '../runtime/lesson-state.types';
import { runHarnessTurn } from '../runtime/run-tutor-turn';
import { DEFAULT_TUTOR_PROMPT_VARIANT } from '../runtime/tutor-prompt-variants';
import { scoreTurn } from '../scoring/score-turn';
import type { TurnReport } from '../reporting/report.types';
import { judgeBehaviorTurn, resolveJudgeProvider } from './tutor-behavior-judge';
import {
  BEHAVIOR_JUDGE_CRITERIA,
  type BehaviorJudgeInput,
  type JudgedBehaviorTurn,
} from './tutor-behavior-judge.types';

const DEFAULT_SCENARIO = 'scenarios/tutor-behavior-repair.scenario.json';

interface CliOptions {
  scenarioPath: string;
  provider: 'mock' | 'openai' | 'webllm';
  judge: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  let scenarioPath = DEFAULT_SCENARIO;
  let provider: CliOptions['provider'] = 'mock';
  let judge = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--judge') judge = true;
    else if (arg === '--mock') provider = 'mock';
    else if (arg === '--openai') provider = 'openai';
    else if (arg === '--webllm') provider = 'webllm';
    else if (arg === '--scenario') scenarioPath = argv[++i] ?? scenarioPath;
    else if (arg.startsWith('--scenario=')) scenarioPath = arg.slice('--scenario='.length);
  }
  return { scenarioPath, provider, judge };
}

/** Per-turn situation metadata, derived from the scripted turn id. */
function situationFor(turnId: string): { situation: string; askedToBeTold: boolean } {
  if (turnId.includes('stuck')) return { situation: 'learner is stuck (said they do not know)', askedToBeTold: false };
  if (turnId.includes('tell-me')) return { situation: 'learner explicitly asked to be told the answer', askedToBeTold: true };
  if (turnId.includes('close-enough')) return { situation: 'learner gave an essentially-correct answer with loose wording', askedToBeTold: false };
  if (turnId.includes('partial')) return { situation: 'learner gave a partially correct answer (missing the reason)', askedToBeTold: false };
  if (turnId.includes('wrong')) return { situation: 'learner gave a wrong answer (a common mistake)', askedToBeTold: false };
  if (turnId.includes('hint')) return { situation: 'learner asked for a hint', askedToBeTold: false };
  if (turnId.includes('correct')) return { situation: 'learner gave a fully correct answer', askedToBeTold: false };
  return { situation: 'general lesson turn', askedToBeTold: false };
}

/** Build the runnable provider for the requested mode. Throws with a clear hint. */
function buildProvider(mode: CliOptions['provider']): { provider: ModelProvider; label: string; isRealModel: boolean } {
  if (mode === 'mock') {
    return { provider: createMockTeacherProvider(), label: 'mock (mechanics baseline — NOT a quality signal)', isRealModel: false };
  }
  if (mode === 'openai') {
    const config = resolveProviderConfig();
    const resolved = resolveProvider({
      mode: 'openai-compatible',
      model: config.model,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
    });
    return { provider: withRetry(resolved.provider), label: `openai-compatible proxy (${resolved.modelName}) — real LLM, NOT on-device`, isRealModel: true };
  }
  // webllm — reuse the exact bridge wiring the evaluate command uses.
  const { runnable } = selectModelTargets('llama-better-offline');
  const target = runnable.find((t) => t.kind === 'webllm');
  if (!target) throw new Error('No runnable WebLLM target found (expected the locked llama-better-offline catalog entry).');
  return { provider: createProviderForTarget(target), label: `REAL on-device WebLLM (${target.label})`, isRealModel: true };
}

type CriterionKey = (typeof BEHAVIOR_JUDGE_CRITERIA)[number];

interface CombinedTurn {
  turnId: string;
  learnerMessage: string;
  tutorResponse: string;
  deterministicPassed: boolean;
  deterministicIssues: string[];
  judged?: JudgedBehaviorTurn;
  combinedPassed: boolean;
}

function main(): Promise<void> {
  return run();
}

async function run(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const { scenario }: { scenario: Scenario } = loadScenario(opts.scenarioPath);
  const promptVariant = DEFAULT_TUTOR_PROMPT_VARIANT;

  // ── Provider + course + unit ──
  const { provider, label: providerLabel, isRealModel } = buildProvider(opts.provider);
  const loaded = loadCoursePackage(scenario.course);
  const courseId = scenario.course.courseId ?? loaded.coursePackage.id;
  const unit = getUnitById({ coursePackage: loaded.coursePackage, unitId: scenario.unitId });
  if (!unit) {
    throw new Error(`Unit "${scenario.unitId}" not found in course "${loaded.coursePackage.id}".`);
  }
  const unitExcerpt = buildUnitExcerpt(unit as unknown as Parameters<typeof buildUnitExcerpt>[0]);

  // ── Optional judge ──
  const judge = opts.judge ? resolveJudgeProvider() : undefined;
  if (opts.judge && judge && !judge.available) {
    console.log(`\n⚠️  LLM judge requested but unavailable: ${judge.unavailableReason}\n    Falling back to deterministic-only.\n`);
  }
  const judgeActive = Boolean(opts.judge && judge?.available && judge.provider);

  // ── Banner (fidelity honesty) ──
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log(' Tutor teaching-behavior evaluation');
  console.log('════════════════════════════════════════════════════════════════════');
  console.log(` Scenario     : ${scenario.id} (${scenario.turns.length} turns)`);
  console.log(` Course/unit  : ${courseId} / ${scenario.unitId}`);
  console.log(` Provider     : ${providerLabel}`);
  console.log(` Prompt       : ${promptVariant} (locked default: ${lockedConfigMetadata().promptVariant})`);
  console.log(` LLM judge    : ${judgeActive ? `ON (${judge?.modelName})` : 'off'}`);
  console.log(' Fidelity     : real buildTutorContext + shared behavior rules, on-device model via bridge when --webllm.');
  console.log('                NOT a byte-identical replay of the live JSON-envelope lesson request (build-tutor-response-prompt.ts).');
  if (!isRealModel) console.log(' NOTE         : mock is a mechanics baseline; PASS/FAIL here proves plumbing, not tutor quality.');
  console.log('════════════════════════════════════════════════════════════════════\n');

  // ── Run each turn through the real runtime path ──
  let state: LessonState = initLessonState({ courseId, unitId: scenario.unitId });
  let memory: LessonSessionMemory = initLessonMemory({ courseId, unitId: scenario.unitId, unit });

  const combined: CombinedTurn[] = [];
  const suggestions: string[] = [];

  try {
    for (const turn of scenario.turns as ScenarioTurn[]) {
      const result = await runHarnessTurn({
        turnId: turn.id,
        coursePackage: loaded.coursePackage,
        unit: unit as LearningUnit,
        unitId: scenario.unitId,
        learnerMessage: turn.learnerMessage,
        provider,
        freedomMode: scenario.freedomMode,
        state,
        memory,
        promptVariant,
      });
      state = result.stateAfter;
      memory = result.memoryAfter;

      const scored: TurnReport = scoreTurn({ turn, result });

      let judged: JudgedBehaviorTurn | undefined;
      if (judgeActive && judge?.provider) {
        const { situation, askedToBeTold } = situationFor(turn.id);
        const judgeInput: BehaviorJudgeInput = {
          turnId: turn.id,
          situation,
          learnerMessage: turn.learnerMessage,
          tutorResponse: result.runtime.answer,
          learnerAskedToBeTold: askedToBeTold,
          unitExcerpt,
          expectedBehaviors: turn.expectedBehaviors,
        };
        judged = await judgeBehaviorTurn(judge.provider, judgeInput);
      }

      // Combined verdict: deterministic must pass; if the judge ran and returned
      // a verdict, it must also pass. A judge ERROR does not fail the turn (it is
      // reported as unavailable for that turn).
      const judgePassed = !judged ? true : judged.ok ? judged.result.pass : true;
      const combinedPassed = scored.passed && judgePassed;

      combined.push({
        turnId: turn.id,
        learnerMessage: turn.learnerMessage,
        tutorResponse: result.runtime.answer,
        deterministicPassed: scored.passed,
        deterministicIssues: scored.issues,
        judged,
        combinedPassed,
      });

      if (judged?.ok && judged.result.suggestion) suggestions.push(`${turn.id}: ${judged.result.suggestion}`);

      // ── Console output for this turn ──
      console.log(`${combinedPassed ? '✅ PASS' : '❌ FAIL'}  ${turn.id}`);
      console.log(`   learner : ${turn.learnerMessage}`);
      console.log(`   tutor   : ${truncate(result.runtime.answer, 240)}`);
      console.log(`   rules   : ${scored.passed ? 'pass' : 'FAIL'}${scored.issues.length ? ` — ${scored.issues.join('; ')}` : ''}`);
      if (judged) {
        if (judged.ok) {
          const fails = BEHAVIOR_JUDGE_CRITERIA.filter((c) => judged!.ok && judged!.result.criteria[c as CriterionKey].verdict === 'fail');
          if (fails.length === 0) {
            console.log('   judge   : pass (no behavior criterion failed)');
          } else {
            console.log(`   judge   : FAIL — ${fails.map((c) => `${c}: ${judged!.ok ? judged!.result.criteria[c as CriterionKey].reason : ''}`).join(' | ')}`);
          }
        } else {
          console.log(`   judge   : unavailable (${judged.error})`);
        }
      }
      console.log('');
    }
  } finally {
    // Always tear down a WebLLM bridge so the process can exit.
    if (opts.provider === 'webllm') closeEvalBridges();
  }

  memory = finalizeLessonMemory(memory);

  // ── Summary ──
  const passed = combined.filter((t) => t.combinedPassed).length;
  const failed = combined.length - passed;
  console.log('────────────────────────────────────────────────────────────────────');
  console.log(` RESULT: ${passed}/${combined.length} turns passed, ${failed} failed.`);
  if (suggestions.length) {
    console.log(' Prompt-improvement suggestions (from the judge):');
    for (const s of suggestions) console.log(`   • ${s}`);
  }
  console.log('────────────────────────────────────────────────────────────────────\n');

  // ── Write reports (JSON + Markdown) ──
  const timestamp = new Date().toISOString();
  const safeTs = timestamp.replace(/[:.]/g, '-');
  const reportDir = resolve(HARNESS_ROOT, 'reports', 'tutor-behavior', safeTs);
  mkdirSync(reportDir, { recursive: true });

  const jsonReport = {
    scenarioId: scenario.id,
    courseId,
    unitId: scenario.unitId,
    provider: providerLabel,
    promptVariant,
    judge: judgeActive ? { model: judge?.modelName, source: judge?.source } : null,
    fidelityNote:
      'Real buildTutorContext + shared behavior rules under structured_rules_prompt. NOT the live JSON-envelope prompt (build-tutor-response-prompt.ts) nor the repair_pass strategy.',
    summary: { total: combined.length, passed, failed },
    turns: combined,
    suggestions,
    finishedAt: timestamp,
  };
  writeFileSync(resolve(reportDir, 'report.json'), JSON.stringify(jsonReport, null, 2), 'utf8');
  writeFileSync(resolve(reportDir, 'report.md'), renderMarkdown(jsonReport), 'utf8');
  console.log(`Report written to ${reportDir}\n`);
}

function truncate(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : `${one.slice(0, max)}…`;
}

function renderMarkdown(r: {
  scenarioId: string;
  provider: string;
  promptVariant: string;
  judge: { model?: string } | null;
  fidelityNote: string;
  summary: { total: number; passed: number; failed: number };
  turns: CombinedTurn[];
  suggestions: string[];
}): string {
  const lines: string[] = [];
  lines.push(`# Tutor behavior evaluation — ${r.scenarioId}`, '');
  lines.push(`- Provider: ${r.provider}`);
  lines.push(`- Prompt variant: ${r.promptVariant}`);
  lines.push(`- LLM judge: ${r.judge ? r.judge.model : 'off'}`);
  lines.push(`- Result: **${r.summary.passed}/${r.summary.total} passed**, ${r.summary.failed} failed`);
  lines.push('', `> Fidelity: ${r.fidelityNote}`, '');
  for (const t of r.turns) {
    lines.push(`## ${t.combinedPassed ? '✅' : '❌'} ${t.turnId}`);
    lines.push(`- Learner: ${t.learnerMessage}`);
    lines.push(`- Tutor: ${truncate(t.tutorResponse, 500)}`);
    lines.push(`- Deterministic: ${t.deterministicPassed ? 'pass' : 'FAIL'}${t.deterministicIssues.length ? ` — ${t.deterministicIssues.join('; ')}` : ''}`);
    if (t.judged) {
      if (t.judged.ok) {
        const fails = BEHAVIOR_JUDGE_CRITERIA.filter((c) => t.judged!.ok && t.judged!.result.criteria[c].verdict === 'fail');
        lines.push(`- Judge: ${fails.length ? `FAIL — ${fails.join(', ')}` : 'pass'}`);
        if (t.judged.result.suggestion) lines.push(`- Suggestion: ${t.judged.result.suggestion}`);
      } else {
        lines.push(`- Judge: unavailable (${t.judged.error})`);
      }
    }
    lines.push('');
  }
  if (r.suggestions.length) {
    lines.push('## Prompt-improvement suggestions', '');
    for (const s of r.suggestions) lines.push(`- ${s}`);
  }
  return lines.join('\n');
}

main().catch((err) => {
  console.error(`\n✗ tutor-behavior eval failed: ${(err as Error).message}\n`);
  process.exitCode = 1;
});
