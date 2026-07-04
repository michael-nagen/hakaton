// ── Lesson Assistant — prompt builders ───────────────────────────────
//
// Prompts live here (not in a React component). Each builder renders the exact
// requested template with the current lesson context + the last three messages.

import type { LessonMessage } from '../lesson-runtime';
import type { LessonContext, TeachingPreference } from './lesson-assistant.types';

/**
 * The optional "Teaching preference" block. Style-only guidance; empty when
 * there is no personalization so prompts are byte-identical to before.
 */
export function preferenceLines(pref?: TeachingPreference): string[] {
  if (!pref || !pref.instruction.trim()) return [];
  return [
    '',
    'Teaching preference:',
    pref.instruction.trim(),
    '',
    'Use this preference only to adjust the explanation style.',
    'Keep the answer focused on the current lesson context.',
  ];
}

/** Render the lesson context as a short, model-friendly block. */
export function formatLessonContext(c: LessonContext): string {
  const lines = [`Lesson: ${c.lessonTitle}`];
  if (c.lessonTopic) lines.push(`Topic: ${c.lessonTopic}`);
  if (c.currentStepTitle) lines.push(`Current step: ${c.currentStepTitle}`);
  if (c.currentStepContent) lines.push(`Current material: ${c.currentStepContent}`);
  return lines.join('\n');
}

/** Render up to the last three messages as a short transcript. */
export function formatLastMessages(messages: LessonMessage[]): string {
  if (messages.length === 0) return '(no messages yet)';
  return messages.map((m) => `${m.role === 'student' ? 'Student' : 'Tutor'}: ${m.content}`).join('\n');
}

export function buildExplainSimplerPrompt(input: {
  lessonContext: LessonContext;
  lastThreeMessages: LessonMessage[];
  teachingPreference?: TeachingPreference;
}): string {
  return [
    'You are a helpful tutor.',
    'Explain the current idea in a very simple way, like explaining to a 5-year-old.',
    'Use simple words.',
    'Keep it short.',
    'Do not add new advanced concepts.',
    ...preferenceLines(input.teachingPreference),
    '',
    'Current lesson context:',
    formatLessonContext(input.lessonContext),
    '',
    'Last 3 messages:',
    formatLastMessages(input.lastThreeMessages),
  ].join('\n');
}

export function buildGiveExamplePrompt(input: {
  lessonContext: LessonContext;
  lastThreeMessages: LessonMessage[];
  teachingPreference?: TeachingPreference;
}): string {
  return [
    'You are a helpful tutor.',
    'Give one simple example that explains the current idea.',
    'Make the example concrete and easy to understand.',
    'Keep it short.',
    ...preferenceLines(input.teachingPreference),
    '',
    'Current lesson context:',
    formatLessonContext(input.lessonContext),
    '',
    'Last 3 messages:',
    formatLastMessages(input.lastThreeMessages),
  ].join('\n');
}

/**
 * "Challenge me" — a focused challenge coach for the CURRENT step. Unlike the
 * old side-question prompt (which answered whatever the learner asked), this
 * asks the learner one practice question at a time and gives short feedback. It
 * never advances the main lesson or teaches future topics.
 *
 * The same builder handles both turns:
 *   • starting  (no transcript, empty answer) → ask ONE challenge question.
 *   • answering (learner just replied)        → give feedback, maybe follow up.
 */
export function buildChallengePrompt(input: {
  lessonContext: LessonContext;
  /** The challenge conversation so far (this side panel only, not the lesson). */
  transcript: LessonMessage[];
  /** The learner's latest answer; empty string when starting the challenge. */
  studentAnswer: string;
  teachingPreference?: TeachingPreference;
}): string {
  const starting = input.studentAnswer.trim() === '' && input.transcript.length === 0;
  return [
    'You are a friendly challenge coach inside a learning app.',
    'Run a short practice challenge about the CURRENT lesson step only.',
    starting
      ? 'Start now: ask ONE beginner-friendly challenge question about the current step. Ask only the question — do not give the answer and do not add feedback yet.'
      : 'The learner just answered your last challenge question. Give SHORT feedback first: if it is wrong, correct it gently; if it is close or essentially right, accept it and tidy the wording. Then you MAY ask ONE short follow-up challenge question about the same current step.',
    'Rules:',
    '- Ask only one question at a time.',
    '- Stay strictly on the current lesson / current step. Do not teach or preview future topics.',
    '- Do not advance the lesson or tell the learner to move on.',
    '- Do not reveal a hidden or correct answer until the learner has answered and your feedback needs it.',
    '- Keep it short, simple, and encouraging.',
    ...preferenceLines(input.teachingPreference),
    '',
    'Current lesson context:',
    formatLessonContext(input.lessonContext),
    '',
    'Challenge so far:',
    formatLastMessages(input.transcript),
    ...(input.studentAnswer.trim() ? ['', "Learner's latest answer:", input.studentAnswer.trim()] : []),
  ].join('\n');
}
