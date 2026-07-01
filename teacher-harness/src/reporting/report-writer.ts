// ── Teacher Harness — report rendering ───────────────────────────────
//
// Renders a ScenarioReport (and a BatchReport) to human-readable Markdown, and
// writes batch summaries into teacher-harness/reports/. The JSON report is the
// machine-readable source of truth; Markdown is for eyeballs.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HARNESS_ROOT } from '../config/harness-config';
import type { BatchReport, ScenarioReport, TurnReport } from './report.types';

function checkbox(ok: boolean): string {
  return ok ? '✅' : '❌';
}

function renderTurn(turn: TurnReport): string {
  const s = turn.scores;
  const lines: string[] = [];
  lines.push(`### ${checkbox(turn.passed)} ${turn.turnId}`);
  lines.push('');
  lines.push(`**Learner:** ${turn.learnerMessage}`);
  lines.push('');
  lines.push('**Tutor response:**');
  lines.push('');
  lines.push('> ' + turn.tutorResponse.replace(/\n/g, '\n> '));
  lines.push('');
  lines.push('**Scores:**');
  lines.push('');
  lines.push(`- groundedness: ${s.groundedness}/5`);
  lines.push(`- staysOnUnit: ${checkbox(s.staysOnUnit)}`);
  lines.push(`- introducedForbiddenTopic: ${s.introducedForbiddenTopic ? '⚠️ yes' : 'no'}`);
  lines.push(`- handledCommonMistake: ${checkbox(s.handledCommonMistake)}`);
  lines.push(`- gaveHintWhenAppropriate: ${checkbox(s.gaveHintWhenAppropriate)}`);
  lines.push(`- didNotAdvanceTooEarly: ${checkbox(s.didNotAdvanceTooEarly)}`);
  lines.push(`- brevity: ${checkbox(s.brevity)}`);
  lines.push(`- didNotInvent: ${checkbox(s.didNotInvent)}`);
  lines.push('');
  if (turn.expectedBehaviorResults.length) {
    lines.push('**Expected behaviours:**');
    lines.push('');
    for (const r of turn.expectedBehaviorResults) {
      lines.push(`- ${checkbox(r.passed)} ${r.behavior}${r.unscored ? ' _(unscored)_' : ''}`);
    }
    lines.push('');
  }
  if (turn.forbiddenBehaviorResults.length) {
    lines.push('**Forbidden behaviours (must be absent):**');
    lines.push('');
    for (const r of turn.forbiddenBehaviorResults) {
      lines.push(`- ${checkbox(r.passed)} ${r.behavior}${r.unscored ? ' _(unscored)_' : ''}`);
    }
    lines.push('');
  }
  lines.push(
    `**Action:** suggested \`${turn.action.suggested}\` — allowed: ${turn.action.allowed}, executed: ${turn.action.executed}. ${turn.action.reason}`,
  );
  lines.push('');
  if (turn.issues.length) {
    lines.push('**Issues:**');
    lines.push('');
    for (const i of turn.issues) lines.push(`- ${i}`);
    lines.push('');
  }
  if (turn.notes) {
    lines.push(`**Notes:** ${turn.notes}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Render a full scenario report to Markdown. */
export function renderScenarioMarkdown(report: ScenarioReport): string {
  const lines: string[] = [];
  lines.push(`# ${checkbox(report.passed)} Scenario: ${report.scenarioTitle}`);
  lines.push('');
  lines.push(`- **Scenario id:** ${report.scenarioId}`);
  lines.push(`- **Course:** ${report.courseId}`);
  lines.push(`- **Unit:** ${report.unitId}`);
  lines.push(`- **Provider / model:** ${report.provider} / ${report.model}`);
  lines.push(`- **Freedom mode:** ${report.freedomMode}`);
  lines.push(
    `- **CoursePackage valid:** ${checkbox(report.coursePackageValid)}${
      report.coursePackageValid ? '' : ` (${report.coursePackageValidationErrors.length} errors)`
    }`,
  );
  lines.push(`- **Turns:** ${report.summary.passedTurns} passed / ${report.summary.failedTurns} failed`);
  lines.push(`- **Finished:** ${report.finishedAt}`);
  lines.push('');
  if (!report.coursePackageValid && report.coursePackageValidationErrors.length) {
    lines.push('## CoursePackage validation errors');
    lines.push('');
    for (const e of report.coursePackageValidationErrors.slice(0, 25)) lines.push(`- ${e}`);
    lines.push('');
  }
  if (report.summary.criticalIssues.length) {
    lines.push('## Critical issues');
    lines.push('');
    for (const c of report.summary.criticalIssues) lines.push(`- ${c}`);
    lines.push('');
  }
  lines.push('## Turns');
  lines.push('');
  for (const t of report.turnResults) {
    lines.push(renderTurn(t));
    lines.push('---');
    lines.push('');
  }
  return lines.join('\n');
}

/** Write a batch summary (json + md) into teacher-harness/reports/. */
export function writeBatchReport(report: BatchReport): { jsonPath: string; mdPath: string } {
  const reportsDir = resolve(HARNESS_ROOT, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const stamp = report.finishedAt.replace(/[^0-9A-Za-z]+/g, '-');
  const jsonPath = resolve(reportsDir, `batch-${stamp}.json`);
  const mdPath = resolve(reportsDir, `batch-${stamp}.md`);

  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const lines: string[] = [];
  lines.push(`# Batch report`);
  lines.push('');
  lines.push(`- **Finished:** ${report.finishedAt}`);
  lines.push(`- **Provider / model:** ${report.provider} / ${report.model}`);
  lines.push(
    `- **Scenarios:** ${report.passedScenarios} passed / ${report.failedScenarios} failed of ${report.totalScenarios}`,
  );
  lines.push('');
  lines.push('| Scenario | Result | Turns (pass/fail) | Run dir |');
  lines.push('| --- | --- | --- | --- |');
  for (const s of report.scenarios) {
    lines.push(
      `| ${s.scenarioId} | ${checkbox(s.passed)} | ${s.passedTurns}/${s.failedTurns} | ${s.runDir} |`,
    );
  }
  lines.push('');
  writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8');

  return { jsonPath, mdPath };
}
