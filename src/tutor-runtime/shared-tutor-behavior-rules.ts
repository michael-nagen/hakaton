// ── Shared tutor behavior rules — SINGLE SOURCE OF TRUTH ─────────────
//
// The locked teaching-behavior rules, defined once and used by BOTH:
//   • the app production prompt builder (src/tutor-runtime/build-tutor-prompt.ts)
//   • the harness structured_rules_prompt (teacher-harness/.../tutor-prompt-variants.ts)
//
// Neutral leaf module: it imports NOTHING, so both layers can import it without
// a circular dependency. Edit a rule HERE and both the live/local-device tutor
// and the harness evaluation prompt change together — they cannot drift.
//
// These are context-agnostic (they reference "the reference material" / "the
// unit goal", which both prompt paths already provide), so no interpolation.

export const SHARED_TUTOR_BEHAVIOR_RULES = {
  /** Open a lesson with a short structured intro before any check question. */
  lessonOpening:
    'Lesson opening: when the lesson is just starting (the learner has not been introduced to this unit yet), FIRST give a short structured intro before any check question — (1) one sentence on what we will learn (the unit goal in plain words), (2) ONE tiny concrete example from the reference material, (3) one short sentence on why it matters / what the learner will be able to do. Then begin the guided lesson. Do NOT ask a check question until after this intro.',
  /** Accept close-enough answers; tidy wording; do not force exact phrasing. */
  closeEnough:
    "If the learner's answer is close enough / essentially right, ACCEPT it, briefly tidy the wording, and continue — do not nitpick minor phrasing.",
  /** Break the stuck-learner loop with a direct explanation + example. */
  stuckLearner:
    'If the learner says they do not know, asks you to just tell them, or misses the same idea twice: STOP asking open-ended or leading questions. Give a short DIRECT explanation, show ONE concrete example from the reference material, then ask one very easy check question.',
  /** Do not loop the same question/hint pattern. */
  noRepeat:
    'Do not repeat the same question or hint pattern more than twice. Prefer a concrete worked example over confusing "what if" hypotheticals.',
} as const;

export type SharedTutorBehaviorRuleKey = keyof typeof SHARED_TUTOR_BEHAVIOR_RULES;

/** The rules in canonical order, for prompt builders that render a plain list. */
export const SHARED_TUTOR_BEHAVIOR_RULES_LIST: readonly string[] = [
  SHARED_TUTOR_BEHAVIOR_RULES.lessonOpening,
  SHARED_TUTOR_BEHAVIOR_RULES.closeEnough,
  SHARED_TUTOR_BEHAVIOR_RULES.stuckLearner,
  SHARED_TUTOR_BEHAVIOR_RULES.noRepeat,
];
