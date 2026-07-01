// ── Teacher Harness — rule-based scoring primitives ──────────────────
//
// Deterministic, dependency-free heuristics. NOT an LLM judge. Two ideas make
// the rules usable:
//
//  1. Behaviour labels are matched by a small registry of detectors. Each entry
//     declares whether the PRESENCE of a phenomenon is good or bad; the scorer
//     then interprets that per expected/forbidden list.
//
//  2. "Teaching a future topic" is detected by CONCRETE SYNTAX, not by merely
//     naming it. This is deliberate: a good tutor redirect *names* f-strings or
//     `.then()` ("that's a later lesson") without teaching them. Requiring
//     concrete syntax (e.g. an actual `f"...{x}"` literal, or `.then(`) keeps
//     redirects from being falsely flagged as leakage.
//
// Trade-off (documented in the README): a model that both redirects AND sneaks
// in real syntax is caught, but a model that describes a future concept in
// prose without syntax is not penalised. Good enough for the MVP.

export interface ScoringContext {
  /** Raw tutor reply. */
  reply: string;
  /** Lowercased reply, for case-insensitive matching. */
  replyLower: string;
  learnerMessage: string;
  /** Concatenated KB chunk contents actually sent to the model. */
  kbText: string;
  /** Prepared common-mistake corrections for the unit. */
  corrections: string[];
  hasMistakes: boolean;
}

// ── Concrete future-topic syntax (leakage) detectors ─────────────────

const CONCRETE_FSTRING = /f["'][^"'\n]*\{[^}]*\}|f-?strings?\s+(?:are written|look like|use the syntax|syntax is|work like)/i;
const CONCRETE_END = /\bend\s*=\s*["']/i;
const CONCRETE_SEP = /\bsep\s*=\s*["']/i;
const CONCRETE_FORMAT = /\.format\s*\(|%[sd]\b|str\.format/i;
const CONCRETE_THEN_CATCH = /\.then\s*\(|\.catch\s*\(|\bawait\b/i;
const CONCRETE_STAR = /["'][^"'\n]*["']\s*\*\s*\d|\*\s*\d+\b|repeat[^.]*\*/i;

/** Any concrete future/off-unit syntax present in the reply? */
function teachesAnyFutureSyntax(ctx: ScoringContext): boolean {
  return [CONCRETE_FSTRING, CONCRETE_END, CONCRETE_SEP, CONCRETE_FORMAT, CONCRETE_THEN_CATCH, CONCRETE_STAR].some(
    (re) => re.test(ctx.reply),
  );
}

// ── Positive / phrasing detectors ────────────────────────────────────

const RE_NEWLINE = /new ?line|own line|separate line|next line|its own line/i;
const RE_REDIRECT = /later lesson|later unit|next lesson|next unit|for now|this unit|current unit|come back|we'?ll cover|covered (?:later|in a later)|stay on|focus on|not (?:yet|for this lesson)/i;
const RE_TYPE_ISSUE = /type ?error|can'?t (?:join|add|concatenate)|cannot (?:join|add|concatenate)/i;
const RE_STR_OR_COMMA = /str\s*\(|convert|comma/i;
const RE_PENDING = /\bpending\b/i;
const RE_REJECTED = /\brejected\b/i;
const RE_VALUE_NOT_READY = /not (?:yet )?(?:ready|available|resolved|settled|there|known)|isn'?t (?:ready|available|resolved|settled)|no value yet|hasn'?t (?:resolved|finished|settled|completed)|still (?:pending|running|waiting)|may not (?:have|be)|might not (?:have|be)|doesn'?t (?:yet )?(?:have|hold)/i;
const RE_ADVANCE = /move on|moving on|next unit|you'?ve (?:mastered|completed|got it|nailed it)|lesson complete|onto the next|ready to advance|let'?s continue to|advancing you/i;
const RE_UNCERTAIN = /not enough information|does not (?:cover|provide)|doesn'?t cover|not covered|i'?m not sure|rather not guess|can'?t say for (?:sure|certain)|out of scope/i;

function hasAll(text: string, words: string[]): boolean {
  return words.every((w) => new RegExp(`\\b${w}\\b`, 'i').test(text));
}

/** Token overlap between the reply and any prepared correction. */
function correctionOverlap(ctx: ScoringContext): number {
  const tok = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 4),
    );
  const replyTokens = tok(ctx.reply);
  let best = 0;
  for (const c of ctx.corrections) {
    let hits = 0;
    for (const t of tok(c)) if (replyTokens.has(t)) hits += 1;
    best = Math.max(best, hits);
  }
  return best;
}

function correctsCommonMistake(ctx: ScoringContext): boolean {
  if (correctionOverlap(ctx) >= 4) return true;
  return /that would be|that'?s a typeerror|not the same|isn'?t (?:the same|correct)|actually,|let'?s check that|common mistake|careful here/i.test(
    ctx.reply,
  );
}

// ── Behaviour registry ───────────────────────────────────────────────

interface BehaviorRule {
  /** True → the phenomenon appearing is desirable; false → undesirable. */
  presenceIsGood: boolean;
  /** Does the named phenomenon appear in the reply? */
  detect: (ctx: ScoringContext) => boolean;
}

export const BEHAVIOR_RULES: Readonly<Record<string, BehaviorRule>> = {
  // Positive behaviours (presence is good).
  corrects_common_mistake: { presenceIsGood: true, detect: correctsCommonMistake },
  uses_prepared_common_mistake_correction: { presenceIsGood: true, detect: correctsCommonMistake },
  explains_each_print_new_line: { presenceIsGood: true, detect: (c) => RE_NEWLINE.test(c.reply) },
  redirects_to_current_unit: { presenceIsGood: true, detect: (c) => RE_REDIRECT.test(c.reply) },
  redirects_to_three_states: {
    presenceIsGood: true,
    detect: (c) => RE_REDIRECT.test(c.reply) || (RE_PENDING.test(c.reply) && RE_REJECTED.test(c.reply)),
  },
  says_then_catch_is_next_unit: {
    presenceIsGood: true,
    detect: (c) => RE_REDIRECT.test(c.reply) && /then|catch|consume/i.test(c.reply),
  },
  explains_string_number_type_issue: {
    presenceIsGood: true,
    detect: (c) => RE_TYPE_ISSUE.test(c.reply) || hasAll(c.replyLower, ['type', 'string', 'number']),
  },
  mentions_str_conversion_or_comma: { presenceIsGood: true, detect: (c) => RE_STR_OR_COMMA.test(c.reply) },
  explains_comma_adds_space: { presenceIsGood: true, detect: (c) => hasAll(c.replyLower, ['comma', 'space']) },
  contrasts_pending_vs_rejected: {
    presenceIsGood: true,
    detect: (c) => RE_PENDING.test(c.reply) && RE_REJECTED.test(c.reply),
  },
  explains_value_not_ready: { presenceIsGood: true, detect: (c) => RE_VALUE_NOT_READY.test(c.reply) },

  // Negative behaviours (presence is bad). Used as expected "does_not_*" /
  // "stays_*" (pass when absent) or as forbidden "teaches_*" (fail when present).
  does_not_introduce_end_keyword: { presenceIsGood: false, detect: (c) => CONCRETE_END.test(c.reply) },
  does_not_teach_future_topic: { presenceIsGood: false, detect: teachesAnyFutureSyntax },
  does_not_move_on_too_quickly: { presenceIsGood: false, detect: (c) => RE_ADVANCE.test(c.reply) },
  stays_within_unit: { presenceIsGood: false, detect: teachesAnyFutureSyntax },
  stays_on_unit: { presenceIsGood: false, detect: teachesAnyFutureSyntax },
  teaches_end_keyword: { presenceIsGood: false, detect: (c) => CONCRETE_END.test(c.reply) },
  teaches_sep_keyword: { presenceIsGood: false, detect: (c) => CONCRETE_SEP.test(c.reply) },
  teaches_f_strings: { presenceIsGood: false, detect: (c) => CONCRETE_FSTRING.test(c.reply) },
  teaches_formatting_methods: { presenceIsGood: false, detect: (c) => CONCRETE_FORMAT.test(c.reply) },
  teaches_star_repeat: { presenceIsGood: false, detect: (c) => CONCRETE_STAR.test(c.reply) },
  teaches_then_catch_syntax: { presenceIsGood: false, detect: (c) => CONCRETE_THEN_CATCH.test(c.reply) },
  teaches_future_topic: { presenceIsGood: false, detect: teachesAnyFutureSyntax },
};

// ── Generic heuristics used for the numeric/flag scores ──────────────

/** 0–5 groundedness from token overlap between reply and KB material. */
export function groundednessScore(ctx: ScoringContext): number {
  const tok = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 4);
  const replyTokens = tok(ctx.reply);
  if (replyTokens.length === 0) return 0;
  const kbSet = new Set(tok(ctx.kbText));
  if (kbSet.size === 0) return 0;
  let hits = 0;
  for (const t of replyTokens) if (kbSet.has(t)) hits += 1;
  const ratio = hits / replyTokens.length;
  if (ratio >= 0.4) return 5;
  if (ratio >= 0.3) return 4;
  if (ratio >= 0.2) return 3;
  if (ratio >= 0.12) return 2;
  if (ratio > 0) return 1;
  return 0;
}

export function isBrief(ctx: ScoringContext, maxWords = 220): boolean {
  const words = ctx.reply.trim().split(/\s+/).filter(Boolean).length;
  return words <= maxWords;
}

export function saidUnsure(ctx: ScoringContext): boolean {
  return RE_UNCERTAIN.test(ctx.reply);
}

export function advancedTooEarly(ctx: ScoringContext): boolean {
  return RE_ADVANCE.test(ctx.reply);
}

export function teachesFutureSyntax(ctx: ScoringContext): boolean {
  return teachesAnyFutureSyntax(ctx);
}

/**
 * Did the reply hint rather than dump a full solution? Heuristic: a reply that
 * shows a fenced code block or several code lines AND offers no hint/question
 * is treated as advancing to the answer too directly.
 */
export function gaveHintNotFullAnswer(ctx: ScoringContext): boolean {
  const hasCodeDump = /```/.test(ctx.reply) || (ctx.reply.match(/\bprint\s*\(/g) ?? []).length >= 3;
  const invites = /\bhint\b|can you|what do you|try (?:it|this)|give it a go|\?/i.test(ctx.reply);
  return invites || !hasCodeDump;
}

export function correctionsMatched(ctx: ScoringContext): boolean {
  return correctsCommonMistake(ctx);
}
