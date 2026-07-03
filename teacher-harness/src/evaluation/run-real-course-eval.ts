// ── Teacher Harness — real-course top-2 validation ───────────────────
//
// Validates the top-2 tutor prompt variants (full_current_prompt vs
// structured_rules_prompt) on a REAL, non-placeholder CourseFactory course,
// under the same fixed runtime as the prompt-efficiency + judge runs
// (Llama-3.2-3B / repair_pass / last_messages_only(8) / completion disabled).
//
// Single-process pipeline: real local Llama WebLLM produces tutor outputs (via
// the hardened bridge), then the OpenAI judge scores each turn — no mock, no
// artifact round-trip. If no OpenAI judge is configured, or WebLLM never
// attaches, it reports honestly and never fabricates.

import { getLocalModelById } from '../../../src/model-provider/local-model-catalog';
import { LESSON_MEMORY_DEFAULTS } from '../runtime/lesson-memory.types';
import { loadCoursePackage, type CourseSource } from '../loading/load-course-package';
import { PROMPT_EVAL_PROFILE_TEMPLATES } from './prompt-eval-profiles';
import { bindPromptEvalProfiles } from './prompt-eval-profiles';
import { loadCases, runCase } from './run-evaluation';
import { closeEvalBridges, createProviderForTarget, evalCallDelayMs, selectModelTargets } from './model-targets';
import { buildUnitExcerpt, judgeTurn, resolveJudgeProvider } from './llm-judge';
import { REALISTIC_TOP3_VARIANTS, type JudgedPromptVariant, type JudgedTurn, type JudgeTurnInput } from './llm-judge.types';

const FIXED_STRATEGY = 'repair_pass' as const;
const FIXED_MEMORY_MODE = 'last_messages_only' as const;
const LLAMA_TARGET_ID = 'llama-better-offline';
const LLAMA_MODEL_NAME = getLocalModelById({ id: LLAMA_TARGET_ID })?.webllmModelId ?? 'Llama-3.2-3B-Instruct-q4f16_1-MLC';

export interface RealCourseUnitMeta {
  unitId: string;
  unitTitle: string;
}
export interface RealCourseEvalOutput {
  finishedAt: string;
  modelName: string;
  strategy: typeof FIXED_STRATEGY;
  memoryMode: typeof FIXED_MEMORY_MODE;
  lastMessagesLimit: number;
  courseId: string;
  courseTitle: string;
  isPlaceholder: boolean;
  units: RealCourseUnitMeta[];
  judgeAvailable: boolean;
  judgeModel?: string;
  judgeProviderKind?: string;
  modelExecuted: boolean;
  totalTurns: number;
  judgedOk: number;
  judgeFailed: number;
  repaired: number;
  /** Averaged prompt-size metrics per variant (real course). */
  promptSizes: Partial<Record<JudgedPromptVariant, { systemPromptChars: number; instructionChars: number; groundingChars: number }>>;
  /** Deterministic pass tally per variant (real course). */
  deterministic: Partial<Record<JudgedPromptVariant, { passedTurns: number; totalTurns: number }>>;
  results: JudgedTurn[];
  incompleteReason?: string;
}

export interface RealCourseEvalInput {
  timestamp: string;
  coursePath: string;
  courseId: string;
  unitIds: string[];
  verbose?: boolean;
}

export async function runRealCourseEvaluation(input: RealCourseEvalInput): Promise<RealCourseEvalOutput> {
  const log = (m: string) => input.verbose && console.log(m);
  const targets = selectModelTargets(LLAMA_TARGET_ID);
  const model = targets.requested.find((t) => t.id === LLAMA_TARGET_ID);
  if (!model) throw new Error(`Fixed model "${LLAMA_TARGET_ID}" not found.`);

  const course: CourseSource = { source: 'file', path: input.coursePath, courseId: input.courseId };
  const loadedPackage = loadCoursePackage(course);
  const pkg = loadedPackage.coursePackage as { title?: string; units?: Array<{ id: string; title?: string }> };
  const courseTitle = pkg.title ?? input.courseId;
  const unitTitleById = new Map((pkg.units ?? []).map((u) => [u.id, u.title ?? u.id]));
  const units: RealCourseUnitMeta[] = input.unitIds.map((id) => ({ unitId: id, unitTitle: unitTitleById.get(id) ?? id }));

  const base: RealCourseEvalOutput = {
    finishedAt: input.timestamp,
    modelName: LLAMA_MODEL_NAME,
    strategy: FIXED_STRATEGY,
    memoryMode: FIXED_MEMORY_MODE,
    lastMessagesLimit: LESSON_MEMORY_DEFAULTS.lastMessagesLimit,
    courseId: input.courseId,
    courseTitle,
    isPlaceholder: false,
    units,
    judgeAvailable: false,
    modelExecuted: false,
    totalTurns: 0,
    judgedOk: 0,
    judgeFailed: 0,
    repaired: 0,
    promptSizes: {},
    deterministic: {},
    results: [],
  };

  // Judge must be configured up-front — no point running WebLLM if we can't judge.
  const judge = resolveJudgeProvider();
  if (!judge.available || !judge.provider) {
    return { ...base, incompleteReason: judge.unavailableReason ?? 'LLM judge not configured.' };
  }
  log(`⚖️  judge: ${judge.modelName} [${judge.providerKind}]`);

  const provider = createProviderForTarget(model); // starts the WebLLM bridge + prints URL
  const paceMs = evalCallDelayMs(model);
  const judgeProvider = judge.provider;

  // ── Smoke gate: 1 real turn on the first unit before the full matrix ──
  try {
    const smokeCases = bindPromptEvalProfiles({ labelPrefix: 'smoke', course, unitId: input.unitIds[0] }).slice(0, 1);
    smokeCases[0].turns = smokeCases[0].turns.slice(0, 1);
    const smokeLoaded = loadCases(smokeCases)[0];
    log(`🔎 smoke: 1 real Llama turn on unit ${input.unitIds[0]}…`);
    const { records } = await runCase({
      loaded: smokeLoaded,
      strategy: FIXED_STRATEGY,
      provider,
      paceMs,
      memoryMode: FIXED_MEMORY_MODE,
      promptVariant: 'structured_rules_prompt',
    });
    if (records.length === 0) throw new Error('smoke produced no turns');
    log(`✅ smoke passed — starting the real-course matrix.`);
  } catch (err) {
    closeEvalBridges();
    return {
      ...base,
      judgeAvailable: true,
      judgeModel: judge.modelName,
      judgeProviderKind: judge.providerKind,
      incompleteReason: `Smoke test failed before the full run: ${(err as Error).message}. WebLLM bridge/tab likely not attached; no results fabricated.`,
    };
  }

  const results: JudgedTurn[] = [];
  const instrAcc: Record<string, { sys: number; instr: number; grnd: number; n: number }> = {};
  const detAcc: Record<string, { passed: number; total: number }> = {};
  let judgedOk = 0;
  let judgeFailed = 0;
  let repaired = 0;
  let modelExecuted = false;

  try {
    for (const unitId of input.unitIds) {
      for (const variant of REALISTIC_TOP3_VARIANTS) {
        const cases = bindPromptEvalProfiles({ labelPrefix: `${variant}__${unitId}`, course, unitId });
        const loadedCases = loadCases(cases);
        log(`\n▶ unit ${unitId} — ${variant} — ${loadedCases.length} profiles`);
        for (let i = 0; i < loadedCases.length; i += 1) {
          const lc = loadedCases[i];
          const template = PROMPT_EVAL_PROFILE_TEMPLATES[i];
          const unitExcerpt = buildUnitExcerpt(lc.unit as Parameters<typeof buildUnitExcerpt>[0]);
          const expectedByTurn = new Map(lc.evalCase.turns.map((t) => [t.id, t.expectedBehaviors ?? []]));

          const { records } = await runCase({
            loaded: lc,
            strategy: FIXED_STRATEGY,
            provider,
            paceMs,
            memoryMode: FIXED_MEMORY_MODE,
            promptVariant: variant,
          });
          if (records.length > 0) modelExecuted = true;

          for (const r of records) {
            // Deterministic tally + prompt sizes (real course).
            (detAcc[variant] ??= { passed: 0, total: 0 }).total += 1;
            if (r.passed) detAcc[variant].passed += 1;
            if (r.promptSizes) {
              const a = (instrAcc[variant] ??= { sys: 0, instr: 0, grnd: 0, n: 0 });
              a.sys += r.promptSizes.systemPromptChars;
              a.instr += r.promptSizes.instructionChars;
              a.grnd += r.promptSizes.groundingChars;
              a.n += 1;
            }
            const judgeInput: JudgeTurnInput = {
              promptVariant: variant,
              profileId: template.id,
              profileTitle: template.title,
              profileDescription: template.description,
              category: template.category,
              turnId: r.turnId,
              learnerMessage: r.learnerMessage,
              tutorResponse: r.tutorResponse,
              expectedBehaviors: expectedByTurn.get(r.turnId) ?? [],
              deterministicPassed: r.passed,
              deterministicScores: (r.dimensions as unknown as Record<string, unknown>) ?? null,
            };
            const jr = await judgeTurn(judgeProvider, judgeInput, unitExcerpt);
            results.push(jr);
            if (jr.ok) {
              judgedOk += 1;
              if (jr.repaired) repaired += 1;
              log(`   ${jr.score.pass ? '✅' : '❌'} ${variant}/${unitId}/${template.id}/${r.turnId} — overall ${jr.score.overallScore}/10${jr.repaired ? ' (repaired)' : ''}`);
            } else {
              judgeFailed += 1;
              log(`   ⚠️  ${variant}/${unitId}/${template.id}/${r.turnId} — ${jr.error}`);
            }
          }
        }
      }
    }
  } finally {
    closeEvalBridges();
  }

  const promptSizes: RealCourseEvalOutput['promptSizes'] = {};
  for (const v of REALISTIC_TOP3_VARIANTS) {
    const a = instrAcc[v];
    if (a && a.n) promptSizes[v] = { systemPromptChars: Math.round(a.sys / a.n), instructionChars: Math.round(a.instr / a.n), groundingChars: Math.round(a.grnd / a.n) };
  }
  const deterministic: RealCourseEvalOutput['deterministic'] = {};
  for (const v of REALISTIC_TOP3_VARIANTS) if (detAcc[v]) deterministic[v] = { passedTurns: detAcc[v].passed, totalTurns: detAcc[v].total };

  return {
    ...base,
    judgeAvailable: true,
    judgeModel: judge.modelName,
    judgeProviderKind: judge.providerKind,
    modelExecuted,
    totalTurns: results.length,
    judgedOk,
    judgeFailed,
    repaired,
    promptSizes,
    deterministic,
    results,
    incompleteReason: judgedOk === 0 ? 'No turns were judged.' : undefined,
  };
}
