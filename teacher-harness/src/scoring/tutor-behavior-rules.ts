// ── Teacher Harness — tutor teaching-behavior detectors ──────────────
//
// Deterministic, dependency-free detectors for the GENERIC pedagogical
// behaviors tested by scenarios/tutor-behavior-repair.scenario.json — the
// stuck/hint/close-enough/partial/wrong/correct teaching loop. These are
// separate from the content-leakage detectors in scoring-rules.ts (which check
// "did the tutor teach future Python/JS syntax"): here we check HOW the tutor
// handled the learner, independent of subject matter.
//
// Two honesty rules keep these trustworthy:
//
//  1. STRUCTURAL behaviors (question count, hint-vs-dump, gave-an-explanation)
//     are detected reliably and are the ones the deterministic PASS/FAIL leans
//     on. They rarely false-fail a reasonable reply.
//
//  2. FUZZY behaviors ("accepted close enough", "gentle correction",
//     "confirmed understanding") CANNOT be judged well by regex. The detectors
//     here are deliberately LENIENT vocabulary checks — enough to catch a reply
//     that made no attempt, but the authoritative signal for these lives in the
//     optional LLM judge (src/llm-judge/tutor-behavior-judge.ts). Treat a fuzzy
//     detector's PASS as "plausible", not "confirmed".
//
// The registry is merged into BEHAVIOR_RULES in scoring-rules.ts, so scoreTurn
// picks these labels up with no change to the scorer itself.

import type { ScoringContext } from './scoring-rules';

/** Same BehaviorRule shape scoring-rules.ts declares (kept local to avoid a cycle). */
interface BehaviorRule {
  presenceIsGood: boolean;
  detect: (ctx: ScoringContext) => boolean;
}

// ── Structural detectors (reliable) ──────────────────────────────────

/** Count question marks — a proxy for "how many things is the learner asked at once". */
function questionCount(reply: string): number {
  return (reply.match(/\?/g) ?? []).length;
}

/** At most one question this turn (0 is fine — a plain confirmation asks nothing). */
export function asksAtMostOneQuestion(ctx: ScoringContext): boolean {
  return questionCount(ctx.reply) <= 1;
}

/** Two or more questions — piling on / overwhelming the learner. */
export function asksMultipleQuestions(ctx: ScoringContext): boolean {
  return questionCount(ctx.reply) >= 2;
}

/**
 * Did the reply HINT rather than dump the whole solution? Heuristic mirrors the
 * one in scoring-rules.ts: a fenced code block or several concrete code lines
 * with no invitation/question reads as handing over the full answer.
 */
export function givesHintNotFullAnswer(ctx: ScoringContext): boolean {
  const hasCodeDump = /```/.test(ctx.reply) || (ctx.reply.match(/\bprint\s*\(/g) ?? []).length >= 3;
  const invites = /\bhint\b|can you|what do you|try (?:it|this)|give it a go|\?/i.test(ctx.reply);
  return invites || !hasCodeDump;
}

/**
 * Did the reply actually EXPLAIN something (not just fire back another
 * question)? True when there is at least one declarative sentence of real
 * length. This is what "stuck learner → give a short explanation, stop asking
 * open-ended questions" needs: an all-questions reply fails it.
 */
export function givesDirectExplanation(ctx: ScoringContext): boolean {
  const sentences = ctx.reply
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.some((s) => !s.endsWith('?') && s.split(/\s+/).filter(Boolean).length >= 6);
}

// ── Fuzzy detectors (LENIENT — the LLM judge is authoritative) ───────

const RE_AFFIRMATION =
  /\b(right|correct|exactly|exactly right|yes|good|nice|great|well done|spot[- ]?on|that'?s it|you'?ve got it|good (?:job|start|thinking)|on the right track|perfect)\b/i;

const RE_SOFT_CORRECTION =
  /\b(not quite|not exactly|almost|close|close enough|actually|let'?s check|let'?s look|careful|think about|remember|good (?:try|start)|hmm|one small thing|nearly)\b/i;

/** Accepted a close-enough answer (some affirmation present). Lenient. */
export function acceptsCloseEnough(ctx: ScoringContext): boolean {
  return RE_AFFIRMATION.test(ctx.reply);
}

/** Corrected gently (a softening lead-in rather than a blunt "wrong"). Lenient. */
export function gentleCorrection(ctx: ScoringContext): boolean {
  return RE_SOFT_CORRECTION.test(ctx.reply);
}

/** Confirmed the learner is right before continuing. Lenient. */
export function confirmsUnderstanding(ctx: ScoringContext): boolean {
  return RE_AFFIRMATION.test(ctx.reply);
}

// ── Registry (merged into BEHAVIOR_RULES) ────────────────────────────

export const TUTOR_BEHAVIOR_RULES: Readonly<Record<string, BehaviorRule>> = {
  // Structural — trustworthy for deterministic PASS/FAIL.
  single_guiding_question: { presenceIsGood: true, detect: asksAtMostOneQuestion },
  asks_multiple_questions: { presenceIsGood: false, detect: asksMultipleQuestions },
  gives_hint_not_full_answer: { presenceIsGood: true, detect: givesHintNotFullAnswer },
  gives_full_answer: { presenceIsGood: false, detect: (c) => !givesHintNotFullAnswer(c) },
  direct_help_when_stuck: { presenceIsGood: true, detect: givesDirectExplanation },

  // Fuzzy — lenient; the LLM judge is the authoritative signal for these.
  accepts_close_enough: { presenceIsGood: true, detect: acceptsCloseEnough },
  gentle_correction: { presenceIsGood: true, detect: gentleCorrection },
  confirms_understanding: { presenceIsGood: true, detect: confirmsUnderstanding },
};

/** Behavior labels the LLM judge should own (deterministic detection is weak). */
export const FUZZY_BEHAVIOR_LABELS: readonly string[] = [
  'accepts_close_enough',
  'gentle_correction',
  'confirms_understanding',
];
