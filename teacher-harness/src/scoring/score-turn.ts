// ── Teacher Harness — per-turn scoring ───────────────────────────────
//
// Turns a completed harness turn + its behaviour contract into a TurnReport.
// Combines two things: (1) generic numeric/flag scores about grounding, unit
// discipline, hints, advancement and brevity; (2) the scenario's explicit
// expected/forbidden behaviour labels evaluated via the rule registry.

import type { TutorContext } from '../../../src/tutor-runtime/tutor-runtime.types';
import type { HarnessTurnResult } from '../runtime/run-tutor-turn';
import type { ScenarioTurn } from '../loading/load-scenario';
import type { BehaviorResult, TurnReport, TurnScores } from '../reporting/report.types';
import {
  BEHAVIOR_RULES,
  advancedTooEarly,
  correctionsMatched,
  gaveHintNotFullAnswer,
  groundednessScore,
  isBrief,
  saidUnsure,
  teachesFutureSyntax,
  type ScoringContext,
} from './scoring-rules';

function buildScoringContext(reply: string, context: TutorContext): ScoringContext {
  const kbText = context.relevantChunks.map((c) => c.content).join('\n');
  const corrections = context.commonMistakes.map((m) => m.correction);
  return {
    reply,
    replyLower: reply.toLowerCase(),
    learnerMessage: context.userMessage,
    kbText,
    corrections,
    hasMistakes: corrections.length > 0,
  };
}

function evaluateExpected(label: string, ctx: ScoringContext): BehaviorResult {
  const rule = BEHAVIOR_RULES[label];
  if (!rule) {
    return { behavior: label, passed: true, unscored: true, note: 'no rule for this label — not scored' };
  }
  const present = rule.detect(ctx);
  const passed = rule.presenceIsGood ? present : !present;
  return { behavior: label, passed, unscored: false };
}

function evaluateForbidden(label: string, ctx: ScoringContext): BehaviorResult {
  const rule = BEHAVIOR_RULES[label];
  if (!rule) {
    return { behavior: label, passed: true, unscored: true, note: 'no rule for this label — not scored' };
  }
  // Forbidden means the phenomenon must be ABSENT.
  const present = rule.detect(ctx);
  return { behavior: label, passed: !present, unscored: false };
}

/** Score one turn against its expected/forbidden behaviour contract. */
export function scoreTurn(params: { turn: ScenarioTurn; result: HarnessTurnResult }): TurnReport {
  const { turn, result } = params;
  const reply = result.runtime.answer;
  const ctx = buildScoringContext(reply, result.runtime.context);

  const expectedBehaviorResults = turn.expectedBehaviors.map((b) => evaluateExpected(b, ctx));
  const forbiddenBehaviorResults = turn.forbiddenBehaviors.map((b) => evaluateForbidden(b, ctx));

  const introducedForbiddenTopic =
    forbiddenBehaviorResults.some((r) => !r.passed) || teachesFutureSyntax(ctx);
  const grounded = groundednessScore(ctx);

  const scores: TurnScores = {
    groundedness: grounded,
    staysOnUnit: !teachesFutureSyntax(ctx),
    introducedForbiddenTopic,
    handledCommonMistake: ctx.hasMistakes ? correctionsMatched(ctx) : true,
    gaveHintWhenAppropriate: gaveHintNotFullAnswer(ctx),
    didNotAdvanceTooEarly: !advancedTooEarly(ctx),
    brevity: isBrief(ctx),
    didNotInvent: grounded >= 1 || saidUnsure(ctx),
  };

  // Collect issues for easy debugging.
  const issues: string[] = [];
  for (const r of expectedBehaviorResults) {
    if (!r.passed) issues.push(`Expected behaviour not met: ${r.behavior}`);
  }
  for (const r of forbiddenBehaviorResults) {
    if (!r.passed) issues.push(`Forbidden behaviour exhibited: ${r.behavior}`);
  }
  if (scores.introducedForbiddenTopic && !forbiddenBehaviorResults.some((r) => !r.passed)) {
    issues.push('Reply contains concrete future/off-unit syntax (leakage) not covered by a forbidden label.');
  }
  if (scores.groundedness < 2) issues.push(`Low groundedness (${scores.groundedness}/5) against the unit material.`);
  if (!scores.brevity) issues.push('Reply is long for a tutor turn.');
  if (!scores.didNotInvent) issues.push('Reply is weakly grounded and did not signal uncertainty (possible invention).');

  // A turn passes only if every expected label is met AND no forbidden label is
  // exhibited AND no forbidden-topic leakage occurred. Soft signals (brevity,
  // hint style, groundedness) are recorded as issues but do not fail the turn.
  const allExpectedPass = expectedBehaviorResults.every((r) => r.passed);
  const noForbidden = forbiddenBehaviorResults.every((r) => r.passed);
  const passed = allExpectedPass && noForbidden && !introducedForbiddenTopic;

  const unscored = [...expectedBehaviorResults, ...forbiddenBehaviorResults]
    .filter((r) => r.unscored)
    .map((r) => r.behavior);
  const noteParts: string[] = [];
  if (unscored.length) noteParts.push(`Unscored labels (no rule): ${unscored.join(', ')}.`);
  noteParts.push(`Suggested action "${result.suggestedAction.type}" → ${result.actionDecision.reason}`);

  return {
    turnId: turn.id,
    learnerMessage: turn.learnerMessage,
    tutorResponse: reply,
    passed,
    scores,
    expectedBehaviorResults,
    forbiddenBehaviorResults,
    action: {
      suggested: result.suggestedAction.type,
      allowed: result.actionDecision.allowed,
      executed: result.actionDecision.executed,
      reason: result.actionDecision.reason,
    },
    issues,
    notes: noteParts.join(' '),
  };
}
