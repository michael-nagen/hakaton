// ── Teacher Harness — per-turn evaluation dimensions ─────────────────
//
// Deterministic heuristics for the evaluation-only dimensions that the base
// per-turn scorer does not cover (warmth, over-explaining, repetition, memory
// use, ...). Same philosophy as scoring-rules.ts: cheap, dependency-free,
// documented trade-offs; NOT an LLM judge. False positives/negatives are
// listed in the report's Limitations section.

import type { TutorContext } from '../../../src/tutor-runtime/tutor-runtime.types';
import type { LessonWorkingMemory } from '../runtime/lesson-memory.types';
import {
  advancedTooEarly,
  correctionsMatched,
  gaveHintNotFullAnswer,
  groundednessScore,
  isBrief,
  saidUnsure,
  teachesFutureSyntax,
} from '../scoring/scoring-rules';
import { buildEvalScoringContext } from './eval-guard';
import type { EvalTurnDimensions } from './eval-types';

const RE_WARMTH =
  /\b(great|nice|good (?:question|thinking|try|catch|start)|well done|no worries|that'?s (?:okay|ok|totally fine|a (?:very )?common)|you'?re (?:close|almost|nearly)|don'?t worry|happy to|exactly|almost there|keep going|good effort|nice work)\b/i;

const RE_REDIRECT_DIM =
  /later lesson|later unit|next lesson|next unit|for now|this unit|current unit|come back|we'?ll cover|covered (?:later|in a later)|stay on|focus on|not (?:yet|for this lesson)/i;

const RE_MEMORY_REFERENCE =
  /\b(earlier|before|as (?:we|you) (?:said|saw|discussed|covered)|you (?:mentioned|asked|said|already)|last (?:time|question|answer)|we (?:already|just) (?:covered|saw|discussed)|again|still)\b/i;

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 4),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hits = 0;
  for (const t of a) if (b.has(t)) hits += 1;
  return hits / (a.size + b.size - hits);
}

/** Reply substantially repeats an earlier tutor reply in this case (Jaccard ≥ 0.55). */
function isRepetition(reply: string, previousTutorReplies: string[]): boolean {
  const rt = tokenSet(reply);
  return previousTutorReplies.some((prev) => jaccard(rt, tokenSet(prev)) >= 0.55);
}

/**
 * Over-explaining heuristic: notably long, or several code blocks, or many
 * paragraphs. Deliberately stricter than the pass/fail brevity budget.
 */
function isOverExplained(reply: string): boolean {
  const wordCount = words(reply).length;
  const codeFences = (reply.match(/```/g) ?? []).length / 2;
  const paragraphs = reply.split(/\n\s*\n/).filter((p) => p.trim()).length;
  return wordCount > 160 || codeFences >= 2 || paragraphs > 5;
}

/**
 * Did the reply visibly use the lesson memory? Two signals: an explicit
 * back-reference phrase, or reusing content tokens from earlier learner
 * messages that are NOT in the current message. Null on the first turn.
 */
function usedLessonMemory(params: {
  reply: string;
  turnIndex: number;
  memoryBefore: LessonWorkingMemory;
  currentLearnerMessage: string;
}): boolean | null {
  const { reply, turnIndex, memoryBefore, currentLearnerMessage } = params;
  if (turnIndex === 0) return null;
  if (RE_MEMORY_REFERENCE.test(reply)) return true;

  const currentTokens = tokenSet(currentLearnerMessage);
  const replyTokens = tokenSet(reply);
  const earlierLearnerText = memoryBefore.lastMessages
    .filter((m) => m.role === 'learner')
    .map((m) => m.content)
    .join(' ');
  let hits = 0;
  for (const t of tokenSet(earlierLearnerText)) {
    if (replyTokens.has(t) && !currentTokens.has(t)) hits += 1;
  }
  return hits >= 3;
}

export function computeTurnDimensions(params: {
  reply: string;
  context: TutorContext;
  turnIndex: number;
  /** Working memory BEFORE this turn was folded in. */
  memoryBefore: LessonWorkingMemory;
  previousTutorReplies: string[];
  /** From the base scorer: a forbidden behaviour label was exhibited. */
  forbiddenExhibited: boolean;
  /** Was a prepared common mistake relevant to this learner message? */
  mistakeRelevant: boolean;
}): EvalTurnDimensions {
  const { reply, context, turnIndex, memoryBefore, previousTutorReplies, forbiddenExhibited, mistakeRelevant } =
    params;
  const ctx = buildEvalScoringContext(reply, context);
  const grounded = groundednessScore(ctx);

  return {
    groundedness: grounded,
    answersFromCourseMaterial: grounded >= 3,
    futureTopicLeak: teachesFutureSyntax(ctx),
    forbiddenTopicLeak: forbiddenExhibited,
    correctedCommonMistake: mistakeRelevant ? correctionsMatched(ctx) : null,
    hintNotFullAnswer: gaveHintNotFullAnswer(ctx),
    redirected: RE_REDIRECT_DIM.test(reply),
    uncertaintySignaled: saidUnsure(ctx),
    brevityOk: isBrief(ctx),
    overExplained: isOverExplained(reply),
    warmth: RE_WARMTH.test(reply),
    advancedTooEarly: advancedTooEarly(ctx),
    usedLessonMemory: usedLessonMemory({
      reply,
      turnIndex,
      memoryBefore,
      currentLearnerMessage: context.userMessage,
    }),
    repetition: isRepetition(reply, previousTutorReplies),
    responseChars: reply.length,
    responseWords: words(reply).length,
  };
}
