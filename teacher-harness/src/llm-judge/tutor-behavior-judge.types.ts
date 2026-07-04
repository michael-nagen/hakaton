// ── Teacher Harness — tutor-behavior LLM judge types ────────────────
//
// A per-turn, per-behavior LLM judge focused ONLY on the teaching-behavior
// contract (stuck→hint, close-enough acceptance, gentle correction, one
// question, staying on the step). It is separate from the 8-dimension quality
// judge in src/evaluation/llm-judge.ts: that one grades overall teaching
// quality; this one adjudicates the specific fuzzy behaviors regex cannot.
//
// EVAL-ONLY. The judge is a strong cloud model and is NEVER wired into the
// tutor runtime — it only reads finished tutor turns and returns verdicts.

/** The behaviors the LLM judge adjudicates for one turn. */
export const BEHAVIOR_JUDGE_CRITERIA = [
  'hintNotFullAnswer',
  'directHelpWhenStuck',
  'acceptsCloseEnough',
  'gentleCorrection',
  'oneQuestionOnly',
  'staysOnStep',
  'noFutureContent',
  'notTooStrictOnWording',
  'notAdvancingTooEarly',
] as const;

export type BehaviorJudgeCriterion = (typeof BEHAVIOR_JUDGE_CRITERIA)[number];

/** A verdict is pass/fail, or n/a when the criterion does not apply this turn. */
export type CriterionVerdict = 'pass' | 'fail' | 'na';

export interface CriterionResult {
  verdict: CriterionVerdict;
  /** One short concrete sentence — why pass/fail/na. */
  reason: string;
}

/** What the judge is asked to grade for one turn. */
export interface BehaviorJudgeInput {
  turnId: string;
  /** Short tag describing the learner situation this turn (stuck / wrong / correct / …). */
  situation: string;
  learnerMessage: string;
  tutorResponse: string;
  /** True when the learner explicitly asked to be told the answer (turn-2). */
  learnerAskedToBeTold: boolean;
  /** Compact unit material the tutor was allowed to teach from. */
  unitExcerpt: string;
  /** The deterministic scorer's expected-behavior labels for this turn. */
  expectedBehaviors: string[];
}

/** The judge's validated verdict for one turn. */
export interface BehaviorJudgeTurnResult {
  turnId: string;
  /** Per-criterion verdicts (only relevant criteria are pass/fail; rest na). */
  criteria: Record<BehaviorJudgeCriterion, CriterionResult>;
  /** Did the turn meet the behavior contract overall (judge's holistic call)? */
  pass: boolean;
  /** One small, concrete prompt-improvement suggestion (empty if none). */
  suggestion: string;
}

/** Judge outcome for one turn: a validated result or a recorded failure. */
export type JudgedBehaviorTurn =
  | { ok: true; turnId: string; result: BehaviorJudgeTurnResult; repaired: boolean }
  | { ok: false; turnId: string; error: string };
