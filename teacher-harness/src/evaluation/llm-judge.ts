// ── Teacher Harness — LLM judge (provider + prompt + validation) ─────
//
// Resolves a STRONG cloud judge from env (TEACHER_HARNESS_JUDGE_* first, then
// the harness's main openai-compatible config), builds the rubric prompt, calls
// the judge, and validates the strict-JSON verdict. On invalid JSON it retries
// ONCE with a repair prompt; if still invalid the turn is marked judge_failed.
//
// Hard rule: the judge is NEVER the local Llama tutor model — a model must not
// grade its own output. The key is read from env and never printed.

import { readHarnessEnvValue, resolveProviderConfig } from '../config/harness-config';
import { LOCAL_MODEL_CATALOG } from '../../../src/model-provider/local-model-catalog';
import { resolveProvider } from '../model/model-client';
import { withRetry } from './model-targets';
import type { ModelProvider } from '../model/model-provider.types';
import {
  JUDGE_FAILURE_TAGS,
  JUDGE_SCORE_DIMENSIONS,
  type JudgedTurn,
  type JudgeFailureTag,
  type JudgeTurnInput,
  type LlmJudgeScores,
  type LlmJudgeTurnScore,
} from './llm-judge.types';

/** The env keys the judge reads, in the order documented to the user. */
export const JUDGE_ENV_KEYS = {
  provider: 'TEACHER_HARNESS_JUDGE_PROVIDER',
  model: 'TEACHER_HARNESS_JUDGE_MODEL',
  apiKey: 'TEACHER_HARNESS_JUDGE_API_KEY',
  baseUrl: 'TEACHER_HARNESS_JUDGE_BASE_URL',
} as const;

export interface ResolvedJudge {
  available: boolean;
  /** The judge model id (safe to display — not a secret). */
  modelName?: string;
  /** Provider family actually used ('openai' | 'openai-compatible'). */
  providerKind?: 'openai' | 'openai-compatible';
  /** Where the config came from, for the report ('judge-env' | 'harness-fallback'). */
  source?: 'judge-env' | 'harness-fallback';
  provider?: ModelProvider;
  /** Why the judge cannot run (missing creds / disallowed model). */
  unavailableReason?: string;
  /** Exactly which env vars to set, when unavailable. */
  neededEnv?: string[];
}

/** OpenAI defaults so only the API key is required for the OpenAI judge. */
const OPENAI_DEFAULT_MODEL = 'gpt-4.1-mini';
const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

const LOCAL_TUTOR_MODEL_IDS = new Set(
  LOCAL_MODEL_CATALOG.map((m) => m.webllmModelId).filter((x): x is string => Boolean(x)),
);

/**
 * Resolve the judge provider from env. Prefers the dedicated JUDGE_* keys; if
 * those are absent, falls back to the harness's main openai-compatible config
 * (so an already-working Gemini/OpenAI endpoint is reused). Returns an
 * unavailable result (never throws) when credentials are missing, so the
 * caller can report exactly what to set.
 */
export function resolveJudgeProvider(): ResolvedJudge {
  const judgeProvider = readHarnessEnvValue(JUDGE_ENV_KEYS.provider);
  const judgeModel = readHarnessEnvValue(JUDGE_ENV_KEYS.model);
  const judgeApiKey = readHarnessEnvValue(JUDGE_ENV_KEYS.apiKey);
  const judgeBaseUrl = readHarnessEnvValue(JUDGE_ENV_KEYS.baseUrl);

  const usingJudgeEnv = Boolean(judgeProvider || judgeModel || judgeApiKey || judgeBaseUrl);
  const source: ResolvedJudge['source'] = usingJudgeEnv ? 'judge-env' : 'harness-fallback';
  const neededEnv = [JUDGE_ENV_KEYS.provider, JUDGE_ENV_KEYS.model, JUDGE_ENV_KEYS.apiKey, JUDGE_ENV_KEYS.baseUrl];

  let providerKind: 'openai' | 'openai-compatible';
  let model: string | undefined;
  let apiKey: string | undefined;
  let baseUrl: string | undefined;

  if (judgeProvider === 'openai') {
    // Explicit OpenAI judge: use ONLY the JUDGE_* creds — never silently fall
    // back to the harness's (Gemini) key/endpoint. Only the API key is required.
    providerKind = 'openai';
    model = judgeModel ?? OPENAI_DEFAULT_MODEL;
    apiKey = judgeApiKey;
    baseUrl = judgeBaseUrl ?? OPENAI_DEFAULT_BASE_URL;
    if (!apiKey) {
      return {
        available: false,
        providerKind,
        source,
        modelName: model,
        unavailableReason:
          `OpenAI judge requested (${JUDGE_ENV_KEYS.provider}=openai) but ${JUDGE_ENV_KEYS.apiKey} is not set. ` +
          `Paste your OpenAI key into teacher-harness/.env as ${JUDGE_ENV_KEYS.apiKey}=... ` +
          `(model defaults to ${OPENAI_DEFAULT_MODEL}; base URL defaults to ${OPENAI_DEFAULT_BASE_URL}). ` +
          'It will NOT fall back to the Gemini endpoint.',
        neededEnv: [`${JUDGE_ENV_KEYS.provider}=openai`, `${JUDGE_ENV_KEYS.model} (optional, default ${OPENAI_DEFAULT_MODEL})`, JUDGE_ENV_KEYS.apiKey],
      };
    }
  } else if (judgeProvider === 'openai-compatible' || judgeProvider === undefined) {
    // openai-compatible: each JUDGE_* key falls back INDEPENDENTLY to its main
    // counterpart, so you can override just the model while reusing the
    // configured endpoint + key (this is how the Gemini flash-lite judge runs).
    const fallback = resolveProviderConfig();
    providerKind = 'openai-compatible';
    model = judgeModel ?? fallback.model;
    apiKey = judgeApiKey ?? fallback.apiKey;
    baseUrl = judgeBaseUrl ?? fallback.baseUrl;
    const mainIsOpenAiCompat = fallback.mode === 'openai-compatible';
    if ((!judgeProvider && !mainIsOpenAiCompat) || !model || !apiKey || !baseUrl) {
      return {
        available: false,
        providerKind,
        source,
        unavailableReason:
          'No LLM judge is configured. Either set an OpenAI judge ' +
          `(${JUDGE_ENV_KEYS.provider}=openai + ${JUDGE_ENV_KEYS.apiKey}), an OpenAI-compatible judge ` +
          `(${JUDGE_ENV_KEYS.provider}=openai-compatible + ${JUDGE_ENV_KEYS.model} + ${JUDGE_ENV_KEYS.apiKey} + ${JUDGE_ENV_KEYS.baseUrl}), ` +
          'or configure the harness default provider (TEACHER_HARNESS_PROVIDER=openai-compatible + MODEL/API_KEY/BASE_URL).',
        neededEnv,
      };
    }
  } else {
    return {
      available: false,
      source,
      unavailableReason: `Unsupported ${JUDGE_ENV_KEYS.provider}="${judgeProvider}". Use "openai" or "openai-compatible".`,
      neededEnv,
    };
  }

  // A model must never grade its own output.
  if (LOCAL_TUTOR_MODEL_IDS.has(model)) {
    return {
      available: false,
      providerKind,
      source,
      modelName: model,
      unavailableReason: `Judge model "${model}" is the local tutor model — a model cannot judge its own output. Configure a different ${JUDGE_ENV_KEYS.model}.`,
      neededEnv,
    };
  }

  // OpenAI and OpenAI-compatible both use the same client; request strict JSON.
  const resolved = resolveProvider({ mode: 'openai-compatible', model, apiKey, baseUrl, jsonMode: true });
  return {
    available: true,
    modelName: model,
    providerKind,
    source,
    provider: withRetry(resolved.provider),
  };
}

// ── Prompt building ──────────────────────────────────────────────────

const RUBRIC = `You are a strict but fair EXPERT TEACHING EVALUATOR for a local-device AI tutor.
You read ONE tutor turn and judge whether it is genuinely good teaching — not just whether it matched keywords.

Score each dimension 1-5 (5 = excellent, 1 = poor):
- groundedness: stayed inside THIS unit's material; no invented facts.
- teachingClarity: clear, understandable explanation for this learner.
- brevityFocus: focused; did NOT over-explain or pad.
- mistakeCorrection: if the learner showed a mistake/misconception, corrected it well (5 if none was needed and none was wrongly invented).
- checkUnderstanding: asked a useful, small check question when appropriate.
- learnerHandling: handled THIS learner type well (confused/impatient/vague/struggling/off-topic/fast/etc.).
- noFutureLeakage: did NOT teach material outside the current lesson/unit.
- productSuitability: good enough to ship in a local-device learning product.

Also produce:
- overallScore: 1-10 holistic teaching quality.
- pass: true if this turn is acceptable teaching for the product.
- criticalIssue: true only for serious failures (ungrounded, leaked future topics, refused to help, or actively misleading).
- failureTags: zero or more from EXACTLY this set: ${JUDGE_FAILURE_TAGS.join(', ')}. Use good_teaching / good_product_answer for strong turns.
- explanation: ONE or TWO sentences, concrete.

Return STRICT JSON ONLY, no prose, no markdown fences, matching:
{"scores":{"groundedness":int,"teachingClarity":int,"brevityFocus":int,"mistakeCorrection":int,"checkUnderstanding":int,"learnerHandling":int,"noFutureLeakage":int,"productSuitability":int},"overallScore":int,"pass":bool,"criticalIssue":bool,"failureTags":[string],"explanation":string}`;

/** Compact excerpt of the unit's teaching material, capped so the prompt stays small. */
export function buildUnitExcerpt(unit: {
  title?: string;
  goal?: string;
  knowledgeBaseChunks?: Array<{ title?: string; content?: string }>;
  questions?: Array<{ prompt?: string; question?: string }>;
  commonMistakes?: Array<{ mistake?: string; correction?: string }>;
}): string {
  const parts: string[] = [];
  if (unit.title) parts.push(`UNIT: ${unit.title}`);
  if (unit.goal) parts.push(`GOAL: ${unit.goal}`);
  const chunks = (unit.knowledgeBaseChunks ?? []).slice(0, 6);
  if (chunks.length) {
    parts.push(
      'REFERENCE MATERIAL:\n' +
        chunks.map((c, i) => `  ${i + 1}. ${c.title ?? ''}: ${(c.content ?? '').slice(0, 240)}`).join('\n'),
    );
  }
  const mistakes = (unit.commonMistakes ?? []).slice(0, 5);
  if (mistakes.length) {
    parts.push(
      'KNOWN COMMON MISTAKES (tutor should correct these):\n' +
        mistakes.map((m, i) => `  ${i + 1}. ${m.mistake ?? ''} → ${m.correction ?? ''}`).join('\n'),
    );
  }
  const qs = (unit.questions ?? []).slice(0, 3);
  if (qs.length) {
    parts.push('PRACTICE QUESTIONS:\n' + qs.map((q, i) => `  ${i + 1}. ${q.prompt ?? q.question ?? ''}`).join('\n'));
  }
  return parts.join('\n\n');
}

export function buildJudgePrompt(input: JudgeTurnInput, unitExcerpt: string): { system: string; user: string } {
  const det =
    input.deterministicPassed === null
      ? 'not available'
      : `${input.deterministicPassed ? 'PASS' : 'FAIL'}${input.deterministicScores ? ` (raw: ${JSON.stringify(input.deterministicScores)})` : ''}`;
  const user = [
    '=== CURRENT UNIT (the only material the tutor may teach) ===',
    unitExcerpt || '(no unit material captured)',
    '',
    '=== LEARNER PROFILE ===',
    `Type: ${input.profileTitle} (category: ${input.category})`,
    `Behaviour: ${input.profileDescription}`,
    '',
    '=== THIS TURN ===',
    `Prompt variant under test: ${input.promptVariant}`,
    `Expected tutor behaviours this turn: ${input.expectedBehaviors.length ? input.expectedBehaviors.join(', ') : '(none specified)'}`,
    `Deterministic scorer result: ${det}`,
    '',
    `LEARNER said: ${input.learnerMessage}`,
    '',
    `TUTOR replied: ${input.tutorResponse}`,
    '',
    'Judge the TUTOR reply now. Return strict JSON only.',
  ].join('\n');
  return { system: RUBRIC, user };
}

// ── Validation ───────────────────────────────────────────────────────

function clampInt(v: unknown, lo: number, hi: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/** Extract the first JSON object from a model reply (tolerates ```json fences / stray prose). */
function extractJsonObject(raw: string): unknown {
  const fenced = raw.replace(/```(?:json)?/gi, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('no JSON object found in judge reply');
  return JSON.parse(fenced.slice(start, end + 1));
}

/** Validate + coerce a raw judge reply into a LlmJudgeTurnScore, or throw. */
export function parseJudgeReply(raw: string, input: JudgeTurnInput): LlmJudgeTurnScore {
  const obj = extractJsonObject(raw) as Record<string, unknown>;
  const rawScores = (obj.scores ?? {}) as Record<string, unknown>;

  const scores = {} as LlmJudgeScores;
  for (const dim of JUDGE_SCORE_DIMENSIONS) {
    const v = clampInt(rawScores[dim], 1, 5);
    if (v === null) throw new Error(`invalid/missing score dimension "${dim}"`);
    scores[dim] = v;
  }

  const overallScore = clampInt(obj.overallScore, 1, 10);
  if (overallScore === null) throw new Error('invalid/missing overallScore');

  if (typeof obj.pass !== 'boolean') throw new Error('invalid/missing pass');
  if (typeof obj.criticalIssue !== 'boolean') throw new Error('invalid/missing criticalIssue');

  const allowed = new Set<string>(JUDGE_FAILURE_TAGS);
  const failureTags = Array.isArray(obj.failureTags)
    ? (obj.failureTags.filter((t): t is JudgeFailureTag => typeof t === 'string' && allowed.has(t)) as JudgeFailureTag[])
    : [];

  const explanation = typeof obj.explanation === 'string' ? obj.explanation.trim().slice(0, 600) : '';

  return {
    promptVariant: input.promptVariant,
    profileId: input.profileId,
    turnId: input.turnId,
    scores,
    overallScore,
    pass: obj.pass,
    criticalIssue: obj.criticalIssue,
    failureTags,
    explanation,
  };
}

/**
 * Judge one turn: call → validate; on invalid JSON, retry ONCE with a repair
 * prompt; if still invalid, return a recorded failure (never throws).
 */
export async function judgeTurn(provider: ModelProvider, input: JudgeTurnInput, unitExcerpt: string): Promise<JudgedTurn> {
  const { system, user } = buildJudgePrompt(input, unitExcerpt);
  let firstErr = '';
  try {
    const raw = await provider.generateText({ system, prompt: user });
    return { ok: true, input, score: parseJudgeReply(raw, input), repaired: false };
  } catch (err) {
    firstErr = (err as Error).message;
  }

  // One repair attempt — re-issue with an explicit "return ONLY valid JSON" nudge.
  try {
    const repairUser = `${user}\n\nYour previous reply was not valid JSON (${firstErr}). Return ONLY the JSON object, nothing else.`;
    const raw = await provider.generateText({ system, prompt: repairUser });
    return { ok: true, input, score: parseJudgeReply(raw, input), repaired: true };
  } catch (err) {
    return { ok: false, input, error: `judge_failed: ${firstErr} | repair: ${(err as Error).message}` };
  }
}
