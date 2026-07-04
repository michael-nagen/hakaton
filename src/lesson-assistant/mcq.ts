// ── Lesson Assistant — MCQ (optional practice question) ──────────────
//
// A SEPARATE, user-triggered feature: generate one beginner-friendly multiple-
// choice question for the CURRENT lesson step, using the same provider seam as
// the other helpers (TutorAssistantProvider over the active/local ModelProvider).
// It never touches the deterministic lesson flow, progress, or the active model.
//
// Context sent to the model is deliberately minimal (see generateMcq):
//   current step content · last ≤2 MCQ questions (to avoid repeats) ·
//   very short lesson topic · last few messages (only if already available).
// The full lesson history is never sent.

import type { LessonMessage } from '../lesson-runtime';
import type { LessonContext, TutorAssistantProvider } from './lesson-assistant.types';

/** One generated multiple-choice question. `correctIndex` is used by the UI to
 *  check the learner's pick; it is never shown as part of the choices. */
export interface GeneratedMcq {
  question: string;
  /** 3–4 short answer choices. */
  choices: string[];
  /** 0-based index of the correct choice. */
  correctIndex: number;
  feedbackCorrect: string;
  feedbackIncorrect: string;
}

const DEFAULT_FEEDBACK_CORRECT = "Correct — nice work!";
const DEFAULT_FEEDBACK_INCORRECT = 'Not quite — review the idea and try the next one.';

function shortTopic(ctx: LessonContext): string {
  return [ctx.lessonTitle, ctx.lessonTopic].filter(Boolean).join(' — ');
}

function formatRecentMessages(messages: LessonMessage[]): string {
  if (messages.length === 0) return '(none)';
  return messages.map((m) => `${m.role === 'student' ? 'Student' : 'Tutor'}: ${m.content}`).join('\n');
}

export function buildMcqPrompt(params: {
  lessonContext: LessonContext;
  recentMcqQuestions: string[];
  recentMessages: LessonMessage[];
}): string {
  const { lessonContext, recentMcqQuestions, recentMessages } = params;
  const avoid = recentMcqQuestions.length ? recentMcqQuestions.map((q) => `- ${q}`).join('\n') : '(none)';
  return [
    'You are a tutor writing ONE simple multiple-choice practice question for a beginner.',
    'Base it ONLY on the current lesson step below. Do not ask about future or unrelated topics.',
    'Keep the question and every choice short and beginner-friendly.',
    'Provide 3 or 4 answer choices with exactly one correct choice.',
    'Do not repeat any of the recent questions listed.',
    '',
    'Reply with ONLY a single JSON object (no prose, no code fences) matching:',
    '{',
    '  "question": string,',
    '  "choices": string[],            // 3 or 4 short options',
    '  "correctIndex": number,         // 0-based index of the correct choice',
    '  "feedbackCorrect": string,      // one short encouraging sentence',
    '  "feedbackIncorrect": string     // one short sentence that guides without revealing the answer',
    '}',
    '',
    `Lesson topic (short): ${shortTopic(lessonContext)}`,
    `Current step material: ${lessonContext.currentStepContent ?? lessonContext.lessonTitle}`,
    'Recent questions to avoid:',
    avoid,
    'Recent conversation (context only):',
    formatRecentMessages(recentMessages),
  ].join('\n');
}

/** Extract the first balanced {...} object from a noisy string. */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Parse + validate a model reply into a GeneratedMcq, or null if unusable. */
export function parseMcq(raw: string): GeneratedMcq | null {
  const json = extractJsonObject(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  if (!json) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;

  const question = typeof o.question === 'string' ? o.question.trim() : '';
  if (!question) return null;

  let choices = Array.isArray(o.choices)
    ? o.choices.filter((c): c is string => typeof c === 'string' && c.trim() !== '').map((c) => c.trim())
    : [];
  if (choices.length > 4) choices = choices.slice(0, 4);
  if (choices.length < 3) return null;

  const correctIndex = typeof o.correctIndex === 'number' ? Math.trunc(o.correctIndex) : -1;
  if (correctIndex < 0 || correctIndex >= choices.length) return null;

  const feedbackCorrect = typeof o.feedbackCorrect === 'string' && o.feedbackCorrect.trim() ? o.feedbackCorrect.trim() : DEFAULT_FEEDBACK_CORRECT;
  const feedbackIncorrect =
    typeof o.feedbackIncorrect === 'string' && o.feedbackIncorrect.trim() ? o.feedbackIncorrect.trim() : DEFAULT_FEEDBACK_INCORRECT;

  return { question, choices, correctIndex, feedbackCorrect, feedbackIncorrect };
}

/** Generate one MCQ for the current step via the provided assistant provider. */
export async function generateMcq(params: {
  assistant: TutorAssistantProvider;
  lessonContext: LessonContext;
  /** Question text of the last ≤2 MCQs, to avoid repeats. */
  recentMcqQuestions?: string[];
  /** Last few messages, only if already available in the runtime. */
  recentMessages?: LessonMessage[];
}): Promise<GeneratedMcq> {
  const prompt = buildMcqPrompt({
    lessonContext: params.lessonContext,
    recentMcqQuestions: params.recentMcqQuestions ?? [],
    recentMessages: params.recentMessages ?? [],
  });
  const raw = await params.assistant.complete({ prompt });
  const parsed = parseMcq(raw);
  if (!parsed) throw new Error('MCQ_PARSE_FAILED');
  return parsed;
}
