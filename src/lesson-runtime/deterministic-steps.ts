// ── Lesson Runtime — deterministic steps ─────────────────────────────
//
// Helpers for the "deterministic_steps" lesson flow. Framework-free (no React)
// so the machine, the constrained context, and the in-step help prompt can be
// unit-tested and shared. The APP owns progression here — the model is only
// ever asked to help INSIDE the current step, using prepared content.

import type { DeterministicOpenCheck, DeterministicStep, LearningUnit } from '../course-package';
import type { LessonMessage } from './lesson-state';

/** Which kind of check a step ends in. */
export function getStepCheckKind(step: DeterministicStep): 'mcq' | 'open' {
  return step.open ? 'open' : 'mcq';
}

/** How many recent messages the in-step help model call may see (spec: 4–5). */
export const DETERMINISTIC_RECENT_MESSAGES_LIMIT = 5;

/** True when a unit carries a usable prepared deterministic teaching plan. */
export function hasDeterministicSteps(unit: LearningUnit): boolean {
  return Array.isArray(unit.deterministicSteps) && unit.deterministicSteps.length > 0;
}

/** The unit's prepared steps in order (empty array if it opted out). */
export function getDeterministicSteps(unit: LearningUnit): DeterministicStep[] {
  return unit.deterministicSteps ?? [];
}

/**
 * The MINIMAL context the in-step help model call is allowed to see. Per spec:
 * only the last 4–5 messages, a very short topics list, the lesson title, the
 * current step title, and the CURRENT step's prepared content — never other
 * steps, future content, or full history.
 */
export interface DeterministicStepContext {
  lessonTitle: string;
  /** A very short list of the lesson's step titles (orientation only). */
  lessonTopics: string[];
  currentStepTitle: string;
  /** The prepared content for THIS step only. */
  step: DeterministicStep;
  /** The last 4–5 conversation messages, oldest → newest. */
  recentMessages: LessonMessage[];
}

/**
 * Build the constrained per-step context. `recentMessages` is trimmed to the
 * window; `lessonTopics` is just the step titles so the model can stay oriented
 * without seeing any other step's actual teaching content.
 */
export function buildDeterministicStepContext(params: {
  unit: LearningUnit;
  step: DeterministicStep;
  recentMessages: LessonMessage[];
  recentLimit?: number;
}): DeterministicStepContext {
  const { unit, step, recentMessages } = params;
  const limit = params.recentLimit ?? DETERMINISTIC_RECENT_MESSAGES_LIMIT;
  return {
    lessonTitle: unit.title,
    lessonTopics: getDeterministicSteps(unit).map((s) => s.title),
    currentStepTitle: step.title,
    step,
    recentMessages: recentMessages.slice(-limit),
  };
}

function formatRecent(messages: LessonMessage[]): string {
  if (messages.length === 0) return '(no messages yet)';
  return messages.map((m) => `${m.role === 'student' ? 'Student' : 'Tutor'}: ${m.content}`).join('\n');
}

/**
 * The prompt for an in-step help turn. It hands the model ONLY the current
 * step's prepared content and pins it to that step: no future teaching, no
 * broad new questions, no advancing the learner. If the learner does not know,
 * the model gives a short direct explanation and keeps helping — it must not
 * block forever waiting for a perfect answer, and must not force exact wording.
 */
export function buildDeterministicHelpPrompt(params: {
  context: DeterministicStepContext;
  studentMessage: string;
}): string {
  const { context, studentMessage } = params;
  const { step } = context;
  return [
    'You are a patient tutor helping a beginner INSIDE one fixed lesson step.',
    'The lesson plan is prepared for you. You do NOT choose what comes next — the app controls progression.',
    '',
    'Rules:',
    '- Stay strictly inside the current step below. Do not teach or preview any other step or future topic.',
    '- Do not invent broad new questions or a new lesson plan.',
    '- Do not tell the learner to move on; you cannot advance the lesson.',
    '- Ground your help in the prepared content for THIS step.',
    '- If the learner says "I don\'t know" / "tell me" or is confused, give a short, direct explanation with the prepared example, then a gentle check — do not keep only asking questions.',
    '- Accept close-enough answers; never force exact wording, and never block waiting for a perfect answer.',
    '- Keep it short, simple, and encouraging.',
    '',
    `Lesson: ${context.lessonTitle}`,
    `Lesson steps (titles only, for orientation): ${context.lessonTopics.join(' · ')}`,
    `Current step: ${context.currentStepTitle}`,
    '',
    'Prepared content for THIS step only:',
    `- Explanation: ${step.intro}`,
    ...(step.example ? [`- Example: ${step.example}`] : []),
    ...(step.mcq
      ? [
          `- Question: ${step.mcq.question}`,
          `- Options: ${step.mcq.options.join(' | ')}`,
          `- Correct answer: ${step.mcq.correctAnswer}`,
        ]
      : []),
    ...(step.open ? [`- Question: ${step.open.question}`, `- Key idea: ${step.open.expectedIdea}`] : []),
    ...(step.summary ? [`- Summary: ${step.summary}`] : []),
    '',
    'Recent messages:',
    formatRecent(context.recentMessages),
    '',
    'Learner just said:',
    studentMessage,
  ].join('\n');
}

/**
 * The prompt for evaluating an OPEN-ended check. The model grades the learner's
 * free-text answer against the prepared rubric (expectedIdea / acceptableAnswers)
 * and responds inside the current step only: accept close-enough answers, correct
 * gently with the prepared hint if off, never require exact wording, and never
 * advance the lesson (the app controls progression). The rubric is model-side —
 * it is never shown to the learner.
 */
export function buildDeterministicOpenEvalPrompt(params: {
  context: DeterministicStepContext;
  open: DeterministicOpenCheck;
  studentAnswer: string;
}): string {
  const { context, open, studentAnswer } = params;
  return [
    "You are a patient tutor checking a beginner's short open answer INSIDE one fixed lesson step.",
    'The lesson plan is prepared for you. You do NOT decide what comes next — the app controls progression.',
    '',
    'Rules:',
    "- Judge whether the answer captures the key idea below. Accept close-enough answers; never require exact wording.",
    '- If it is close, confirm warmly in a sentence or two and briefly restate the idea in plain words.',
    "- If it is off, or the learner says they don't know, gently give the correct idea using the prepared hint — never scold.",
    '- Stay strictly inside this step. Do not teach other steps, do not ask a brand-new question, do not tell them to move on.',
    '- Keep it short, simple, and encouraging.',
    '',
    `Lesson: ${context.lessonTitle}`,
    `Current step: ${context.currentStepTitle}`,
    `The question asked: ${open.question}`,
    `Key idea a good answer shows: ${open.expectedIdea}`,
    ...(open.acceptableAnswers && open.acceptableAnswers.length
      ? [`Examples of acceptable answers: ${open.acceptableAnswers.join(' | ')}`]
      : []),
    `Prepared hint if they are off: ${open.hint}`,
    '',
    'Recent messages:',
    formatRecent(context.recentMessages),
    '',
    "The learner's answer:",
    studentAnswer,
  ].join('\n');
}

// ── Chat-injection helpers ───────────────────────────────────────────
//
// The deterministic flow is presented INSIDE the normal chat: the app injects a
// prepared tutor message when a step opens, then the learner chats normally.
// These pure helpers build that message and classify a free-text reply so the
// app (not the model) can drive progression deterministically. Kept pure so
// they are unit-tested directly.

/**
 * The visible teaching text shown when a step opens: the intro (+ optional
 * example) ONLY. The MCQ question, its options, and — critically — the correct
 * answer are NOT part of this text: the question/options are carried as
 * structured data and rendered as clickable choices, and the correct answer
 * stays internal until the learner answers. This is the "prepared deterministic
 * message" injected into the chat at the start of each step.
 */
export function buildDeterministicStepIntro(step: DeterministicStep): string {
  const lines: string[] = [step.intro];
  if (step.example) lines.push('', 'Example:', step.example);
  return lines.join('\n');
}

function normalizeReply(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function wordSet(text: string): Set<string> {
  return new Set(normalizeReply(text).split(/[^a-z0-9']+/).filter(Boolean));
}

/**
 * Deterministically match a free-text reply to one of the MCQ options. Longest
 * option is tried first so a short correct option that is a substring of a
 * longer (wrong) option cannot win by accident. Returns null when no option is
 * clearly named (the caller then routes the reply to in-step help).
 */
export function matchMcqOption(
  reply: string,
  options: string[],
): { index: number; option: string } | null {
  const t = normalizeReply(reply);
  if (!t) return null;
  const byLongest = options
    .map((option, index) => ({ option, index }))
    .sort((a, b) => normalizeReply(b.option).length - normalizeReply(a.option).length);
  for (const { option, index } of byLongest) {
    const n = normalizeReply(option);
    if (n && t.includes(n)) return { index, option };
  }
  return null;
}

const AFFIRM_WORDS = ['yes', 'yep', 'yeah', 'yup', 'sure', 'ok', 'okay', 'next', 'continue', 'ready', 'understood'];
const AFFIRM_PHRASES = ['got it', 'i understand', 'i get it', 'makes sense', 'move on', 'next step'];
const DONT_KNOW_PHRASES = ["i don't know", 'i dont know', "don't know", 'dont know', 'not sure', 'no idea', 'no clue', 'tell me'];

/** True when a checkpoint reply reads as "yes, I understood — move on". */
export function isAffirmativeReply(reply: string): boolean {
  const t = normalizeReply(reply);
  if (AFFIRM_PHRASES.some((p) => t.includes(p))) return true;
  const words = wordSet(reply);
  return AFFIRM_WORDS.some((w) => words.has(w));
}

/** True when a reply reads as "I don't know / just tell me". */
export function isDontKnowReply(reply: string): boolean {
  const t = normalizeReply(reply);
  if (DONT_KNOW_PHRASES.some((p) => t.includes(p))) return true;
  const words = wordSet(reply);
  return words.has('idk') || words.has('dunno');
}
