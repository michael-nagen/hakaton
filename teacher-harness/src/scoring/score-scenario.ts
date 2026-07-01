// ── Teacher Harness — scenario roll-up ───────────────────────────────
//
// Aggregates per-turn reports into a scenario verdict. A scenario passes only
// if every turn passed. Critical issues (forbidden-topic leakage, unmet
// expectations, an invalid course package) are surfaced at the top so a failing
// run is easy to triage.

import type { ScenarioReport, ScenarioReportSummary, TurnReport } from '../reporting/report.types';

export function summarizeScenario(turnReports: TurnReport[]): ScenarioReportSummary {
  const passedTurns = turnReports.filter((t) => t.passed).length;
  const failedTurns = turnReports.length - passedTurns;

  const criticalIssues: string[] = [];
  for (const t of turnReports) {
    if (t.scores.introducedForbiddenTopic) {
      criticalIssues.push(`${t.turnId}: introduced a forbidden/future topic.`);
    }
    for (const r of t.forbiddenBehaviorResults) {
      if (!r.passed) criticalIssues.push(`${t.turnId}: forbidden behaviour "${r.behavior}".`);
    }
    for (const r of t.expectedBehaviorResults) {
      if (!r.passed) criticalIssues.push(`${t.turnId}: missing expected behaviour "${r.behavior}".`);
    }
  }

  return { passedTurns, failedTurns, criticalIssues };
}

export function buildScenarioReport(params: {
  scenarioId: string;
  scenarioTitle: string;
  courseId: string;
  unitId: string;
  provider: string;
  model: string;
  freedomMode: string;
  coursePackageValid: boolean;
  coursePackageValidationErrors: string[];
  turnReports: TurnReport[];
  runDir: string;
  finishedAt: string;
}): ScenarioReport {
  const summary = summarizeScenario(params.turnReports);
  const passed = summary.failedTurns === 0 && params.turnReports.length > 0;

  return {
    scenarioId: params.scenarioId,
    scenarioTitle: params.scenarioTitle,
    courseId: params.courseId,
    unitId: params.unitId,
    provider: params.provider,
    model: params.model,
    freedomMode: params.freedomMode,
    passed,
    coursePackageValid: params.coursePackageValid,
    coursePackageValidationErrors: params.coursePackageValidationErrors,
    turnResults: params.turnReports,
    summary,
    runDir: params.runDir,
    finishedAt: params.finishedAt,
  };
}
