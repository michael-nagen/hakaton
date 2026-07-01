// ── Teacher Harness — report shapes ──────────────────────────────────
//
// The stable contract for what a run produces. Rule-based today; the shape is
// kept simple so a richer scorer (or, later, an LLM judge) can populate the
// same fields without breaking report readers.

/** Generic per-turn scores. Numbers are 0–5; the rest are pass/fail flags. */
export interface TurnScores {
  /** How well the reply is grounded in the provided unit material (0–5). */
  groundedness: number;
  /** Did the reply stay within the current unit (no forbidden teaching)? */
  staysOnUnit: boolean;
  /** Did the reply teach something the constraints forbid? */
  introducedForbiddenTopic: boolean;
  /** Did the reply recognise/correct a prepared common mistake (when relevant)? */
  handledCommonMistake: boolean;
  /** Did the reply hint rather than dump a full answer, when appropriate? */
  gaveHintWhenAppropriate: boolean;
  /** Did the reply avoid advancing the lesson too early? */
  didNotAdvanceTooEarly: boolean;
  /** Was the reply short enough for a tutor interaction? */
  brevity: boolean;
  /** If material was missing, did the reply avoid inventing (said unsure)? */
  didNotInvent: boolean;
}

/** Result of checking one expected/forbidden behaviour label against a reply. */
export interface BehaviorResult {
  behavior: string;
  /** For expected behaviours: satisfied? For forbidden: NOT violated? */
  passed: boolean;
  /** True when no rule exists for this label (recorded, not counted as fail). */
  unscored: boolean;
  note?: string;
}

export interface TurnReport {
  turnId: string;
  learnerMessage: string;
  tutorResponse: string;
  passed: boolean;
  scores: TurnScores;
  expectedBehaviorResults: BehaviorResult[];
  forbiddenBehaviorResults: BehaviorResult[];
  /** Action the model suggested and what the harness did about it. */
  action: {
    suggested: string;
    allowed: boolean;
    executed: boolean;
    reason: string;
  };
  issues: string[];
  notes: string;
}

export interface ScenarioReportSummary {
  passedTurns: number;
  failedTurns: number;
  criticalIssues: string[];
}

export interface ScenarioReport {
  scenarioId: string;
  scenarioTitle: string;
  courseId: string;
  unitId: string;
  provider: string;
  model: string;
  freedomMode: string;
  passed: boolean;
  /** Course-package validation carried through from loading. */
  coursePackageValid: boolean;
  coursePackageValidationErrors: string[];
  turnResults: TurnReport[];
  summary: ScenarioReportSummary;
  /** Absolute path to the run artifact directory. */
  runDir: string;
  finishedAt: string;
}

/** Roll-up across many scenarios for a batch run. */
export interface BatchReport {
  finishedAt: string;
  provider: string;
  model: string;
  totalScenarios: number;
  passedScenarios: number;
  failedScenarios: number;
  scenarios: Array<{
    scenarioId: string;
    passed: boolean;
    passedTurns: number;
    failedTurns: number;
    runDir: string;
  }>;
}
