// ── Tutor Runtime — TutorInput → prompt ──────────────────────────────
//
// Renders a TutorInput into a system + user prompt that instructs the model to
// reply with a TutorResponse as strict JSON. Mirrors the style of
// build-tutor-prompt.ts (plain text sections, no LLM call). Sends only the
// current step's context — never the whole course.

import type { TutorInput } from './tutor-provider.types';
import { SHARED_TUTOR_BEHAVIOR_RULES } from './shared-tutor-behavior-rules';
import { LIVE_TUTOR_PROMPT_STYLE } from './live-tutor-prompt-style';
import type { LiveTutorPromptStyle } from './live-tutor-prompt-style';

function renderList(label: string, items: string[]): string {
  const clean = items.filter((i) => i.trim() !== '');
  if (clean.length === 0) return '';
  return `${label}:\n${clean.map((i) => `- ${i}`).join('\n')}`;
}

/**
 * The OPENING instruction block — the only part that differs between styles.
 * Everything after it (lesson context + hints + mistakes + preference + JSON
 * schema) is shared verbatim, mirroring the harness approach of varying only the
 * instruction preamble while keeping the grounding constant.
 */
function openingInstructions(style: LiveTutorPromptStyle): string[] {
  if (style === 'structured_rules_json') {
    // Adapted from the evaluated harness `structured_rules_prompt`. Rules that
    // only make sense for the harness's plain-text, completion-off setup are
    // intentionally NOT copied here (see note below) because the live app owns
    // progression through the JSON `nextAction` + the completionEnabled block.
    return [
      'You are a kind, calm, supportive, clear tutor. Teach one step at a time; never reveal the full answer up front — guide with questions and progressive hints.',
      SHARED_TUTOR_BEHAVIOR_RULES.lessonOpening,
      'Rules:',
      '1. Teach only from the lesson context provided here; do not invent facts.',
      '2. Stay inside the current step and unit goal; if asked about future or off-topic material, gently say it comes later and steer back.',
      '3. Correct the listed common mistakes when the learner shows them.',
      `4. ${SHARED_TUTOR_BEHAVIOR_RULES.closeEnough}`,
      '5. Keep every answer short and clear; do not over-explain.',
      '6. After the intro, ask exactly one short check question per turn.',
      `7. ${SHARED_TUTOR_BEHAVIOR_RULES.stuckLearner}`,
      `8. ${SHARED_TUTOR_BEHAVIOR_RULES.noRepeat}`,
      'Stay warm and encouraging throughout.',
    ];
  }
  // "current_json" — the existing live prompt opening, unchanged.
  return [
    'You are an autonomous, encouraging tutor. Teach one step at a time; never reveal full answers up front — guide with questions and progressive hints.',
  ];
}

/**
 * The strict JSON schema instruction. When completion is disabled, "finish" is
 * dropped from the allowed actions so the model is never offered the tool to end
 * the lesson.
 */
function responseSchemaInstruction(completionEnabled: boolean): string {
  const actions = completionEnabled
    ? '"ask_question" | "give_hint" | "explain" | "continue" | "finish"'
    : '"ask_question" | "give_hint" | "explain" | "continue"';
  return [
    'Reply with ONLY a single JSON object (no prose, no code fences) matching:',
    '{',
    '  "messageToStudent": string,  // what the student sees',
    `  "nextAction": ${actions},`,
    '  "studentLevelEstimate": "beginner" | "intermediate" | "advanced",',
    '  "confidence": number  // 0..1, your confidence in the level estimate',
    '}',
  ].join('\n');
}

export function buildTutorResponseSystemPrompt(
  input: TutorInput,
  style: LiveTutorPromptStyle = LIVE_TUTOR_PROMPT_STYLE,
): string {
  const { lessonContext } = input;
  const sections: string[] = [
    ...openingInstructions(style),
    `Lesson: ${lessonContext.title}`,
    `Current goal: ${lessonContext.currentGoal}`,
    `Current question: ${lessonContext.currentQuestion}`,
    `What the student should come to understand: ${lessonContext.expectedUnderstanding}`,
  ];

  // Cap long lists so the main prompt stays focused for the small local model.
  const hints = renderList('Hints you may reveal gradually', lessonContext.hints.slice(0, 3));
  if (hints) sections.push(hints);

  const mistakes = renderList(
    'Common mistakes to watch for and gently pre-empt',
    lessonContext.commonMistakes.slice(0, 3),
  );
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

  // Personalization (style only). Appended to THIS selected prompt when present;
  // it must not change the goal, validation, or progression.
  const preference = lessonContext.teachingPreference?.instruction.trim();
  if (preference) {
    sections.push(
      [
        'Teaching preference:',
        preference,
        '',
        'Use this preference only to adjust teaching style.',
        'Do not change the selected prompt.',
        'Do not change the lesson goal.',
        'Do not skip required checks.',
        'Do not reveal answers too early unless the selected lesson prompt allows it.',
      ].join('\n'),
    );
  }

  // Completion disabled: tell the model plainly, on top of dropping "finish"
  // from the schema below, so it keeps guiding instead of wrapping up.
  const completionEnabled = lessonContext.completionEnabled !== false;
  if (!completionEnabled) {
    sections.push(
      'Lesson completion is disabled: never end the lesson or announce that it is over. Keep guiding the student with questions and hints, one step at a time.',
    );
  }

  sections.push(responseSchemaInstruction(completionEnabled));
  return sections.join('\n\n');
}

export function buildTutorResponseUserPrompt(input: TutorInput): string {
  const { studentState, recentMessages } = input;
  // Render exactly the window the runtime already trimmed to (no second silent
  // truncation) so the configured recent-message limit matches what the model sees.
  const history = recentMessages
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
