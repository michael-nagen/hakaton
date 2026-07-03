// ── Teacher Harness — evaluation lab types ───────────────────────────
//
// Shapes for the internal model × strategy × learner-profile evaluation.
// This is a research/evaluation surface only: nothing here is imported by the
// learner app. The harness owns strategy selection, guarding, repair, memory,
// scoring and reporting; the model only ever produces text.

import type { CourseSource } from '../loading/load-course-package';
import type { FreedomMode } from '../../../src/tutor-runtime/tutor-runtime.types';
import type { TutorRuntimeStrategy } from '../../../src/lesson-runtime/tutor-strategy';
import type { ScenarioTurn } from '../loading/load-scenario';
import type { TurnReport } from '../reporting/report.types';

// Re-export so evaluation modules have one import site for the strategy union.
export type EvalStrategyId = TutorRuntimeStrategy;

/** One scripted learner case (a built-in profile or an imported scenario). */
export interface EvalCase {
  /** e.g. "confused-beginner" or "scenario:python-printing-unit-1-basic". */
  id: string;
  title: string;
  description: string;
  /** "profile" = built-in scripted learner; "scenario" = existing scenario file. */
  kind: 'profile' | 'scenario';
  course: CourseSource;
  unitId: string;
  freedomMode: FreedomMode;
  turns: ScenarioTurn[];
}

/** How a model target can (or cannot) be executed by this Node CLI. */
export type EvalModelKind = 'webllm' | 'mock' | 'openai-compatible';

export interface EvalModelTarget {
  /** Stable id used on the CLI, e.g. "gemma-fast-offline" or "proxy:gemini-flash-lite-latest". */
  id: string;
  label: string;
  kind: EvalModelKind;
  /** Can this process actually call the model right now? */
  available: boolean;
  /** Why not (webllm targets, missing API config, ...). */
  unavailableReason?: string;
  /**
   * True only when results from this target are a real quality signal about a
   * language model. The deterministic mock proves mechanics, not quality.
   */
  qualitySignal: boolean;
  /** True when this target IS one of the app's real on-device WebLLM models. */
  isRealWebllm: boolean;
  /** Present on cloud stand-ins: an honest note that this is NOT the WebLLM model. */
  proxyNote?: string;
  /** openai-compatible model name (kind === 'openai-compatible'). */
  openAiModel?: string;
}

/** Guard issues found by the deterministic evaluation guard. */
export interface EvalGuardIssue {
  rule: 'future_topic_leak' | 'advanced_too_early' | 'empty_reply' | 'too_long' | 'weak_grounding_no_unsure';
  severity: 'critical' | 'minor';
  detail: string;
}

/** What the strategy layer did around the model call(s) for one turn. */
export interface EvalTurnTelemetry {
  strategy: EvalStrategyId;
  modelCalls: number;
  latenciesMs: number[];
  totalLatencyMs: number;
  /** repair_pass replaced the first draft with a rewrite. */
  repaired: boolean;
  /** The deterministic safe fallback replaced every model draft. */
  fallbackUsed: boolean;
  /** critic_checker replaced the draft with the critic's version. */
  criticReplaced: boolean;
  guardIssuesFirstDraft: EvalGuardIssue[];
  guardIssuesFinal: EvalGuardIssue[];
}

/** Extra per-turn dimensions on top of the base TurnReport scores. */
export interface EvalTurnDimensions {
  groundedness: number;
  /** groundedness >= 3 → answered from course material rather than general knowledge. */
  answersFromCourseMaterial: boolean;
  futureTopicLeak: boolean;
  /** A behaviour the scenario explicitly forbade was exhibited. */
  forbiddenTopicLeak: boolean;
  /** null = no prepared mistake was relevant this turn. */
  correctedCommonMistake: boolean | null;
  hintNotFullAnswer: boolean;
  redirected: boolean;
  uncertaintySignaled: boolean;
  brevityOk: boolean;
  overExplained: boolean;
  warmth: boolean;
  advancedTooEarly: boolean;
  /** null on the first turn (nothing to remember yet). */
  usedLessonMemory: boolean | null;
  /** Reply substantially repeats an earlier tutor reply in this case. */
  repetition: boolean;
  responseChars: number;
  responseWords: number;
}

/** Full record of one evaluated turn (kept in the JSON report). */
export interface EvalTurnRecord {
  caseId: string;
  turnId: string;
  learnerMessage: string;
  tutorResponse: string;
  passed: boolean;
  issues: string[];
  base: TurnReport;
  dimensions: EvalTurnDimensions;
  telemetry: EvalTurnTelemetry;
  /** The exact memory block sent to the model this turn (for artifacts). */
  memorySentToModel?: string;
  /** Which tutor prompt variant was rendered this turn. */
  promptVariant?: string;
  /** Prompt-size metrics for the prompt-efficiency experiment. */
  promptSizes?: { systemPromptChars: number; instructionChars: number; groundingChars: number };
}

export interface EvalCaseResult {
  caseId: string;
  caseTitle: string;
  totalTurns: number;
  passedTurns: number;
  criticalIssues: string[];
  failedTurnIds: string[];
}

/** Aggregate for one (model target × strategy) combination. */
export interface EvalComboResult {
  modelTargetId: string;
  modelLabel: string;
  providerMode: string;
  isRealWebllm: boolean;
  qualitySignal: boolean;
  strategy: EvalStrategyId;
  /**
   * True when the combo did not complete every case (e.g. provider quota
   * exhausted mid-run). Partial combos stay in the table for transparency but
   * are excluded from recommendations.
   */
  partial: boolean;
  totals: {
    cases: number;
    casesExpected: number;
    turns: number;
    passedTurns: number;
    failedTurns: number;
    criticalIssues: number;
    modelCalls: number;
    repairs: number;
    fallbacks: number;
    criticReplacements: number;
  };
  averages: {
    latencyMs: number;
    callsPerTurn: number;
    responseChars: number;
    responseWords: number;
    groundedness: number;
  };
  rates: {
    passRate: number;
    futureTopicLeakRate: number;
    forbiddenLeakRate: number;
    correctionRate: number; // over turns where a prepared mistake was relevant
    hintOkRate: number;
    redirectRate: number;
    uncertaintyRate: number;
    brevityOkRate: number;
    overExplainRate: number;
    warmthRate: number;
    advanceTooEarlyRate: number;
    memoryUseRate: number; // over turns after the first
    repetitionRate: number;
    groundedAnswerRate: number;
    expectedBehaviorPassRate: number;
  };
  /** 0–100 composite (weights documented in eval-report.ts + the MD report). */
  compositeScore: number;
  /** 0–100: leakage + critical-issue avoidance. */
  safetyScore: number;
  /** 0–100: expected behaviours + corrections + hint discipline. */
  teachingScore: number;
  perCase: EvalCaseResult[];
  recurringIssues: Array<{ issue: string; count: number }>;
  turns: EvalTurnRecord[];
}

export interface EvalRankingRow {
  rank: number;
  modelLabel: string;
  strategy: EvalStrategyId;
  score: number;
  passedTurns: number;
  totalTurns: number;
  criticalIssues: number;
  avgLatencyMs: number;
  notes: string;
}

export interface EvaluationReport {
  finishedAt: string;
  metadata: {
    coursePackageVariant: 'current_detailed';
    scoringMethod: 'deterministic_rules_no_llm_judge';
    latencySource: 'measured_wall_clock_of_available_providers';
    /** The headline honesty flag: did the real WebLLM browser models run? */
    webllmActuallyRan: boolean;
    harnessVersion: string;
    /** The locked best configuration this harness defaults to. */
    lockedConfig: Record<string, string | number>;
  };
  modelTargets: EvalModelTarget[];
  strategiesEvaluated: EvalStrategyId[];
  strategiesUnavailable: Array<{ id: string; reason: string }>;
  cases: Array<{ id: string; title: string; description: string; kind: string; turnCount: number }>;
  combos: EvalComboResult[];
  /** Combos that produced no data at all (quota/transport failure) — named, not hidden. */
  combosAborted: Array<{ modelLabel: string; strategy: string; reason: string }>;
  ranking: EvalRankingRow[];
  recommendations: {
    best: EvalRankingRow | null;
    secondBest: EvalRankingRow | null;
    safest: EvalRankingRow | null;
    fastest: EvalRankingRow | null;
    bestTeaching: EvalRankingRow | null;
    whyTopTwo: string[];
    whatFailed: string[];
    fixNext: string[];
  };
  whatHurtTutorQuality: Array<{ cause: string; evidence: string[] }>;
  coursePackageNotes: string[];
  limitations: string[];
}
