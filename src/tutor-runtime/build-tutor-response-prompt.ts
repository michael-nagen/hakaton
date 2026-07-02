// ── Tutor Runtime — TutorInput → prompt ──────────────────────────────
//
// Renders a TutorInput into a system + user prompt that instructs the model to
// reply with a TutorResponse as strict JSON. Mirrors the style of
// build-tutor-prompt.ts (plain text sections, no LLM call). Sends only the
// current step's context — never the whole course.

import type { TutorInput } from './tutor-provider.types';

function renderList(label: string, items: string[]): string {
  const clean = items.filter((i) => i.trim() !== '');
  if (clean.length === 0) return '';
  return `${label}:\n${clean.map((i) => `- ${i}`).join('\n')}`;
}

const RESPONSE_SCHEMA_INSTRUCTION = [
  'Reply with ONLY a single JSON object (no prose, no code fences) matching:',
  '{',
  '  "messageToStudent": string,  // what the student sees',
  '  "nextAction": "ask_question" | "give_hint" | "explain" | "continue" | "finish",',
  '  "studentLevelEstimate": "beginner" | "intermediate" | "advanced",',
  '  "confidence": number  // 0..1, your confidence in the level estimate',
  '}',
].join('\n');

export function buildTutorResponseSystemPrompt(input: TutorInput): string {
  const { lessonContext } = input;
  const sections: string[] = [
    'You are an autonomous, encouraging tutor. Teach one step at a time; never reveal full answers up front — guide with questions and progressive hints.',
    `Lesson: ${lessonContext.title}`,
    `Current goal: ${lessonContext.currentGoal}`,
    `Current question: ${lessonContext.currentQuestion}`,
    `What the student should come to understand: ${lessonContext.expectedUnderstanding}`,
  ];

  const hints = renderList('Hints you may reveal gradually', lessonContext.hints);
  if (hints) sections.push(hints);

  const mistakes = renderList('Common mistakes to watch for and gently pre-empt', lessonContext.commonMistakes);
  if (mistakes) sections.push(mistakes);

  if (lessonContext.rubric) sections.push(`Rubric for judging the answer:\n${lessonContext.rubric}`);

  // Runtime-provided extras (both optional — absent for single_tutor, so that
  // strategy's prompt is byte-identical to the pre-strategy behavior).
  const snippets = renderList(
    'Reference material (retrieved by the lesson runtime — ground your answer in it)',
    lessonContext.referenceSnippets ?? [],
  );
  if (snippets) sections.push(snippets);

  const notes = renderList('Runtime instructions for THIS reply (must follow)', lessonContext.runtimeNotes ?? []);
  if (notes) sections.push(notes);

  sections.push(RESPONSE_SCHEMA_INSTRUCTION);
  return sections.join('\n\n');
}

export function buildTutorResponseUserPrompt(input: TutorInput): string {
  const { studentState, recentMessages } = input;
  const history = recentMessages
    .slice(-5)
    .map((m) => `${m.role === 'student' ? 'Student' : 'Tutor'}: ${m.content}`)
    .join('\n');

  const parts: string[] = [
    `Student level (current estimate): ${studentState.levelEstimate}. Attempts on this step: ${studentState.attemptsOnCurrentStep}.`,
  ];
  if (studentState.knownWeaknesses?.length) {
    parts.push(`Known weaknesses: ${studentState.knownWeaknesses.join(', ')}.`);
  }
  if (history) parts.push(`Recent conversation:\n${history}`);
  parts.push(`Student's latest answer: ${input.studentAnswer}`);
  return parts.join('\n\n');
}
