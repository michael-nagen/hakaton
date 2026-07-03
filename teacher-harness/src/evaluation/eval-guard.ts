// ── Teacher Harness — deterministic evaluation guard ─────────────────
//
// Rule-based checks the STRATEGY LAYER runs over a tutor reply before it is
// accepted (guarded_output / repair_pass / critic_checker). No LLM judging —
// the same dependency-free primitives the scorer uses, applied pre-acceptance
// instead of post-hoc. Critical issues are the ones a repair pass is allowed
// to act on; minor issues are recorded only.

import type { TutorContext } from '../../../src/tutor-runtime/tutor-runtime.types';
import {
  advancedTooEarly,
  groundednessScore,
  isBrief,
  saidUnsure,
  teachesFutureSyntax,
  type ScoringContext,
} from '../scoring/scoring-rules';
import type { EvalGuardIssue } from './eval-types';

/** Build the same scoring context shape the per-turn scorer uses. */
export function buildEvalScoringContext(reply: string, context: TutorContext): ScoringContext {
  return {
    reply,
    replyLower: reply.toLowerCase(),
    learnerMessage: context.userMessage,
    kbText: context.relevantChunks.map((c) => c.content).join('\n'),
    corrections: context.commonMistakes.map((m) => m.correction),
    hasMistakes: context.commonMistakes.length > 0,
  };
}

export interface EvalGuardReport {
  issues: EvalGuardIssue[];
  hasCritical: boolean;
}

/** Check one candidate reply against deterministic lesson rules. */
export function guardEvalReply(params: { reply: string; context: TutorContext }): EvalGuardReport {
  const { reply, context } = params;
  const ctx = buildEvalScoringContext(reply, context);
  const issues: EvalGuardIssue[] = [];

  if (reply.trim() === '') {
    issues.push({ rule: 'empty_reply', severity: 'critical', detail: 'Tutor reply is empty.' });
  }

  if (teachesFutureSyntax(ctx)) {
    issues.push({
      rule: 'future_topic_leak',
      severity: 'critical',
      detail: 'Reply contains concrete future/off-unit syntax (e.g. end=, sep=, f-strings, .format, .then, * repeat).',
    });
  }

  if (advancedTooEarly(ctx)) {
    issues.push({
      rule: 'advanced_too_early',
      severity: 'critical',
      detail: 'Reply advances/completes the lesson ("move on", "you\'ve mastered", ...) — completion is harness-owned and disabled.',
    });
  }

  if (!isBrief(ctx)) {
    issues.push({
      rule: 'too_long',
      severity: 'minor',
      detail: 'Reply exceeds the soft tutor-turn length budget (220 words).',
    });
  }

  if (groundednessScore(ctx) < 2 && !saidUnsure(ctx) && reply.trim() !== '') {
    issues.push({
      rule: 'weak_grounding_no_unsure',
      severity: 'minor',
      detail: 'Reply overlaps the unit material weakly and does not signal uncertainty (possible invention).',
    });
  }

  return { issues, hasCritical: issues.some((i) => i.severity === 'critical') };
}
