// ── Lesson Runtime — deterministic output guard ──────────────────────
//
// Pure, rule-based checks the RUNTIME runs over a TutorResponse before it
// reaches the learner. No LLM judging here — cheap string/token heuristics in
// the spirit of the offline harness's scoring rules, but tiny and app-owned so
// the app never depends on the teacher-harness CLI project.
//
// Used by the guarded_output / repair_pass / critic_checker strategies. The
// guard REPORTS; strategies decide what to do with the report.

import type { TutorResponse } from '../tutor-runtime';
import type { StepDescriptor } from './lesson-steps';

export interface GuardIssue {
  rule: 'answer_leak' | 'advance_without_engagement' | 'empty_reply' | 'too_long';
  severity: 'critical' | 'minor';
  detail: string;
}

export interface GuardReport {
  issues: GuardIssue[];
  hasCritical: boolean;
}

/** Lowercase word tokens of length ≥ 3 (same style as the runtime's retrieval). */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

const MAX_REPLY_CHARS = 1600;
const MIN_ENGAGED_ANSWER_CHARS = 12;
const ANSWER_LEAK_OVERLAP = 0.8;
const MIN_ANSWER_TOKENS_FOR_LEAK = 6;

/**
 * Check one tutor reply against deterministic lesson rules.
 * Critical rules:
 *  - answer_leak: claims to hint/ask but effectively dumps the canonical answer
 *  - advance_without_engagement: advances/finishes off a trivial student message
 * Minor rules (reported, never block): empty-ish formatting, excessive length.
 */
export function guardTutorResponse(params: {
  response: TutorResponse;
  step: StepDescriptor;
  studentAnswer: string;
}): GuardReport {
  const { response, step, studentAnswer } = params;
  const issues: GuardIssue[] = [];
  const reply = response.messageToStudent.trim();

  if (reply === '') {
    issues.push({ rule: 'empty_reply', severity: 'critical', detail: 'Tutor reply is empty.' });
  }

  // answer_leak — only when the tutor claims it is still guiding (hint/question)
  // but the reply contains (almost) the whole canonical answer.
  if (response.nextAction === 'give_hint' || response.nextAction === 'ask_question') {
    const answerTokens = tokens(step.expectedUnderstanding);
    if (answerTokens.length >= MIN_ANSWER_TOKENS_FOR_LEAK) {
      const replyTokens = new Set(tokens(reply));
      const present = answerTokens.filter((t) => replyTokens.has(t)).length;
      const overlap = present / answerTokens.length;
      if (overlap >= ANSWER_LEAK_OVERLAP) {
        issues.push({
          rule: 'answer_leak',
          severity: 'critical',
          detail: `Reply reveals ~${Math.round(overlap * 100)}% of the canonical answer while claiming to ${response.nextAction === 'give_hint' ? 'give a hint' : 'ask a question'}.`,
        });
      }
    }
  }

  // advance_without_engagement — advancing or finishing when the learner has
  // not actually said anything substantive this turn (e.g. "hi").
  if (
    (response.nextAction === 'continue' || response.nextAction === 'finish') &&
    studentAnswer.trim().length < MIN_ENGAGED_ANSWER_CHARS
  ) {
    issues.push({
      rule: 'advance_without_engagement',
      severity: 'critical',
      detail: `Tutor chose "${response.nextAction}" although the student's message was too short to demonstrate understanding.`,
    });
  }

  if (reply.length > MAX_REPLY_CHARS) {
    issues.push({
      rule: 'too_long',
      severity: 'minor',
      detail: `Reply is ${reply.length} characters (soft limit ${MAX_REPLY_CHARS}).`,
    });
  }

  return { issues, hasCritical: issues.some((i) => i.severity === 'critical') };
}
