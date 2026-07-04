// ── Teacher Harness — tutor-behavior LLM judge ──────────────────────
//
// Optional second pass over the deterministic scorer. A STRONG cloud model
// reads one finished tutor turn and adjudicates the fuzzy teaching behaviors
// regex cannot judge well — "accepted a close-enough answer", "corrected
// gently", "not too strict on exact wording". Returns strict JSON; on invalid
// JSON it retries ONCE with a repair nudge, else records a judge failure.
//
// EVAL-ONLY. Provider resolution is REUSED from src/evaluation/llm-judge.ts, so
// the same guardrails apply: creds come from TEACHER_HARNESS_JUDGE_* env, the
// key is never printed, and the judge can NEVER be the local Llama tutor model
// (a model must not grade its own output). Nothing here touches the tutor
// runtime — it only reads turns that already happened.

import { resolveJudgeProvider, type ResolvedJudge } from '../evaluation/llm-judge';
import type { ModelProvider } from '../model/model-provider.types';
import {
  BEHAVIOR_JUDGE_CRITERIA,
  type BehaviorJudgeCriterion,
  type BehaviorJudgeInput,
  type BehaviorJudgeTurnResult,
  type CriterionResult,
  type CriterionVerdict,
  type JudgedBehaviorTurn,
} from './tutor-behavior-judge.types';

export { resolveJudgeProvider, type ResolvedJudge };

// ── Rubric ───────────────────────────────────────────────────────────

const RUBRIC = `You are a STRICT but FAIR teaching-behavior evaluator for a beginner AI tutor.
You read ONE tutor turn and judge ONLY its teaching BEHAVIOR — not writing style, not general intelligence.
Judge conceptual understanding, not exact wording.

For each criterion decide: "pass", "fail", or "na" (not applicable this turn). Use "na" freely — only judge what applies.

Criteria:
- hintNotFullAnswer: The tutor gave a hint / partial guidance rather than handing over the whole answer. "na" if the learner explicitly asked to be told the answer.
- directHelpWhenStuck: When the learner is stuck ("I don't know" / "just tell me" / asks for a hint), the tutor gave a SHORT direct explanation or a concrete example instead of only firing back more open-ended questions. "na" if the learner was not stuck.
- acceptsCloseEnough: When the learner's answer was essentially right, the tutor ACCEPTED it, tidied the wording if needed, and moved on — did NOT nitpick minor phrasing. "na" if the answer was not close/correct.
- gentleCorrection: When the learner was wrong, the tutor corrected KINDLY (acknowledged the attempt, no harshness). "na" if nothing was wrong.
- oneQuestionOnly: The tutor asked at most ONE guiding question (0 or 1). Fail if it stacked multiple questions.
- staysOnStep: The tutor stayed on the current unit/step and did not wander off-topic.
- noFutureContent: The tutor did NOT teach syntax or content from later lessons (for this unit: no end=, sep=, f-strings, commas, +, str(), *).
- notTooStrictOnWording: The tutor judged the idea, not exact phrasing — did not reject an essentially-correct answer over wording. "na" if wording strictness never came up.
- notAdvancingTooEarly: The tutor did NOT declare the lesson done / tell the learner to move on / jump ahead.

Also produce:
- pass: true if the turn meets the behavior contract for THIS learner situation overall.
- suggestion: ONE short, concrete prompt-improvement idea IF a behavior failed (else empty string). Aim it at the tutor's system prompt, not the learner.

Return STRICT JSON ONLY (no prose, no markdown fences) matching:
{"criteria":{"hintNotFullAnswer":{"verdict":"pass|fail|na","reason":string},"directHelpWhenStuck":{"verdict":"pass|fail|na","reason":string},"acceptsCloseEnough":{"verdict":"pass|fail|na","reason":string},"gentleCorrection":{"verdict":"pass|fail|na","reason":string},"oneQuestionOnly":{"verdict":"pass|fail|na","reason":string},"staysOnStep":{"verdict":"pass|fail|na","reason":string},"noFutureContent":{"verdict":"pass|fail|na","reason":string},"notTooStrictOnWording":{"verdict":"pass|fail|na","reason":string},"notAdvancingTooEarly":{"verdict":"pass|fail|na","reason":string}},"pass":bool,"suggestion":string}`;

function buildUserPrompt(input: BehaviorJudgeInput): string {
  return [
    '=== CURRENT UNIT (the only material the tutor may teach) ===',
    input.unitExcerpt || '(no unit material captured)',
    '',
    '=== THIS TURN ===',
    `Learner situation: ${input.situation}`,
    `Learner explicitly asked to be told the answer: ${input.learnerAskedToBeTold ? 'yes' : 'no'}`,
    `Expected tutor behaviours this turn: ${input.expectedBehaviors.length ? input.expectedBehaviors.join(', ') : '(none specified)'}`,
    '',
    `LEARNER said: ${input.learnerMessage}`,
    '',
    `TUTOR replied: ${input.tutorResponse}`,
    '',
    'Judge the TUTOR reply now. Return strict JSON only.',
  ].join('\n');
}

// ── Validation ───────────────────────────────────────────────────────

/** Extract the first JSON object from a reply (tolerates fences / stray prose). */
function extractJsonObject(raw: string): unknown {
  const fenced = raw.replace(/```(?:json)?/gi, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('no JSON object found in judge reply');
  return JSON.parse(fenced.slice(start, end + 1));
}

function coerceVerdict(value: unknown): CriterionVerdict {
  return value === 'pass' || value === 'fail' || value === 'na' ? value : 'na';
}

function parseReply(raw: string, input: BehaviorJudgeInput): BehaviorJudgeTurnResult {
  const obj = extractJsonObject(raw) as Record<string, unknown>;
  const rawCriteria = (obj.criteria ?? {}) as Record<string, unknown>;

  const criteria = {} as Record<BehaviorJudgeCriterion, CriterionResult>;
  for (const key of BEHAVIOR_JUDGE_CRITERIA) {
    const entry = (rawCriteria[key] ?? {}) as Record<string, unknown>;
    criteria[key] = {
      verdict: coerceVerdict(entry.verdict),
      reason: typeof entry.reason === 'string' ? entry.reason.trim().slice(0, 400) : '',
    };
  }

  // Trust the model's holistic `pass` when present; otherwise derive it (no
  // applicable criterion failed).
  const pass =
    typeof obj.pass === 'boolean'
      ? obj.pass
      : !Object.values(criteria).some((c) => c.verdict === 'fail');

  const suggestion = typeof obj.suggestion === 'string' ? obj.suggestion.trim().slice(0, 400) : '';

  return { turnId: input.turnId, criteria, pass, suggestion };
}

// ── Judge one turn ───────────────────────────────────────────────────

/**
 * Judge one turn: call → validate; on invalid JSON, retry ONCE with a repair
 * nudge; if still invalid, return a recorded failure (never throws).
 */
export async function judgeBehaviorTurn(
  provider: ModelProvider,
  input: BehaviorJudgeInput,
): Promise<JudgedBehaviorTurn> {
  const user = buildUserPrompt(input);
  let firstErr = '';
  try {
    const raw = await provider.generateText({ system: RUBRIC, prompt: user });
    return { ok: true, turnId: input.turnId, result: parseReply(raw, input), repaired: false };
  } catch (err) {
    firstErr = (err as Error).message;
  }

  try {
    const repairUser = `${user}\n\nYour previous reply was not valid JSON (${firstErr}). Return ONLY the JSON object, nothing else.`;
    const raw = await provider.generateText({ system: RUBRIC, prompt: repairUser });
    return { ok: true, turnId: input.turnId, result: parseReply(raw, input), repaired: true };
  } catch (err) {
    return { ok: false, turnId: input.turnId, error: `judge_failed: ${firstErr} | repair: ${(err as Error).message}` };
  }
}
