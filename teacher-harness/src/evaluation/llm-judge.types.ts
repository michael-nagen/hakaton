// ── Teacher Harness — LLM judge types ────────────────────────────────
//
// A second evaluation pass: a STRONG cloud model reads each tutor turn and
// scores teaching quality on an 8-dimension 1–5 rubric (plus an overall 1–10,
// pass/critical flags, failure tags, and a short explanation). This is separate
// from — and complementary to — the deterministic regex/overlap scorer: the
// judge catches teaching-quality issues that rules miss, and vice-versa.
//
// The judge NEVER uses the local Llama tutor model (that would grade its own
// work). Output is strict JSON, validated against LlmJudgeTurnScore.

/** The two prompt variants under comparison (top-2 from the deterministic run). */
export type JudgedPromptVariant = 'full_current_prompt' | 'structured_rules_prompt';

export const JUDGED_PROMPT_VARIANTS: readonly JudgedPromptVariant[] = [
  'full_current_prompt',
  'structured_rules_prompt',
];

/** The eight 1–5 rubric dimensions. */
export interface LlmJudgeScores {
  /** Did the tutor stay inside the current unit / CoursePackage? */
  groundedness: number;
  /** Was the explanation clear and understandable? */
  teachingClarity: number;
  /** Did the tutor avoid over-explaining? */
  brevityFocus: number;
  /** If the learner made a mistake, did the tutor correct it well? */
  mistakeCorrection: number;
  /** Did the tutor ask a useful small check question when appropriate? */
  checkUnderstanding: number;
  /** Did the tutor handle this learner type well? */
  learnerHandling: number;
  /** Did the tutor avoid teaching material outside the current lesson? */
  noFutureLeakage: number;
  /** Is this good enough for a local-device learning product? */
  productSuitability: number;
}

export const JUDGE_SCORE_DIMENSIONS: readonly (keyof LlmJudgeScores)[] = [
  'groundedness',
  'teachingClarity',
  'brevityFocus',
  'mistakeCorrection',
  'checkUnderstanding',
  'learnerHandling',
  'noFutureLeakage',
  'productSuitability',
];

/** The closed set of failure/quality tags the judge may attach. */
export const JUDGE_FAILURE_TAGS = [
  'over_explained',
  'too_vague',
  'missed_mistake',
  'future_topic_leakage',
  'not_grounded',
  'advanced_too_early',
  'did_not_answer',
  'too_long',
  'too_short',
  'poor_check_question',
  'good_teaching',
  'good_product_answer',
] as const;

export type JudgeFailureTag = (typeof JUDGE_FAILURE_TAGS)[number];

/** A single validated judge verdict for one tutor turn. */
export interface LlmJudgeTurnScore {
  promptVariant: JudgedPromptVariant;
  profileId: string;
  turnId: string;
  scores: LlmJudgeScores;
  /** 1–10 overall teaching-quality score. */
  overallScore: number;
  pass: boolean;
  criticalIssue: boolean;
  failureTags: JudgeFailureTag[];
  explanation: string;
}

/** What the judge is asked to grade for one turn (assembled from artifacts). */
export interface JudgeTurnInput {
  promptVariant: JudgedPromptVariant;
  profileId: string;
  profileTitle: string;
  profileDescription: string;
  category: string;
  turnId: string;
  learnerMessage: string;
  tutorResponse: string;
  /** Expected behaviours for this turn (from the scripted profile), if any. */
  expectedBehaviors: string[];
  /** Deterministic scorer's pass/fail for this turn, if available. */
  deterministicPassed: boolean | null;
  /** Deterministic scorer's raw dimension scores for this turn, if available. */
  deterministicScores: Record<string, unknown> | null;
}

/** Judge result for one turn: either a validated score or a recorded failure. */
export type JudgedTurn =
  | { ok: true; input: JudgeTurnInput; score: LlmJudgeTurnScore; repaired: boolean }
  | { ok: false; input: JudgeTurnInput; error: string };
