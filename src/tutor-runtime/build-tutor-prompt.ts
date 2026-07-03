// ── Tutor Runtime — prompt rendering ─────────────────────────────────
//
// Turns a TutorContext into a provider-neutral, model-ready prompt. No LLM
// is called here — this only renders text. Output is a system message
// (persona + pedagogy + grounding) and a user message (progress + question).

import type {
  ProgressState,
  TutorContext,
  TutorPrompt,
  TutorQuestionRef,
} from './tutor-runtime.types';
import type { CommonMistake, KnowledgeBaseChunk } from '../course-package/course-package.types';
import { freedomModeDirective } from './freedom-mode';
import { SHARED_TUTOR_BEHAVIOR_RULES_LIST } from './shared-tutor-behavior-rules';

function renderList(label: string, items: string[]): string {
  if (items.length === 0) return '';
  const lines = items.map((item) => `- ${item}`).join('\n');
  return `${label}:\n${lines}`;
}

function renderChunks(chunks: KnowledgeBaseChunk[]): string {
  if (chunks.length === 0) return 'No reference material was retrieved for this turn.';
  return chunks
    .map((chunk, i) => `[KB${i + 1}] ${chunk.title}\n${chunk.content}`)
    .join('\n\n');
}

function renderQuestions(questions: TutorQuestionRef[]): string {
  if (questions.length === 0) return '';
  const blocks = questions.map((q) => {
    const hints = q.hints.map((h) => `    hint ${h.order}: ${h.text}`).join('\n');
    return `- (${q.id}) ${q.prompt}${hints ? `\n${hints}` : ''}`;
  });
  return `Practice questions you may use (reveal hints gradually, never the full answer up front):\n${blocks.join('\n')}`;
}

function renderMistakes(mistakes: CommonMistake[]): string {
  if (mistakes.length === 0) return '';
  const lines = mistakes.map((m) => `- Mistake: ${m.mistake}\n  Correction: ${m.correction}`);
  return `Common mistakes to watch for and gently pre-empt:\n${lines.join('\n')}`;
}

function renderProgress(progress: ProgressState | null): string {
  if (!progress) return 'No prior progress recorded — treat this as a fresh start.';
  const parts: string[] = [];
  if (progress.completedUnitIds?.length) {
    parts.push(`Completed units: ${progress.completedUnitIds.join(', ')}.`);
  }
  if (typeof progress.attempts === 'number') parts.push(`Attempts on this unit: ${progress.attempts}.`);
  if (typeof progress.mastery === 'number') {
    parts.push(`Estimated mastery: ${Math.round(progress.mastery * 100)}%.`);
  }
  if (progress.note) parts.push(`Note: ${progress.note}`);
  return parts.length ? parts.join(' ') : 'Progress state provided but empty.';
}

/** Build the system message: who the tutor is + how to teach + grounding. */
function buildSystemPrompt(context: TutorContext): string {
  const { teacherBrain: brain, course, unit } = context;

  const sections: string[] = [];

  if (brain.systemPromptSeed) sections.push(brain.systemPromptSeed);

  sections.push(
    `You are an autonomous tutor for the course "${course.title}".`,
    `You are teaching ONE unit: "${unit.title}".`,
    `Unit goal: ${unit.goal}`,
    `Persona: ${brain.persona}`,
    `Tone: ${brain.tone}`,
  );

  const objectives = renderList('Your objectives for this unit', brain.objectives);
  if (objectives) sections.push(objectives);

  const guidelines = renderList('Always', brain.guidelines);
  if (guidelines) sections.push(guidelines);

  const constraints = renderList('Never', brain.constraints);
  if (constraints) sections.push(constraints);

  // Locked teaching-behavior rules (shared with the harness structured_rules_prompt
  // via ./shared-tutor-behavior-rules.ts): structured lesson opening, close-enough
  // acceptance, stuck-learner repair, no-repeat.
  sections.push(renderList('Teaching behavior (always follow)', [...SHARED_TUTOR_BEHAVIOR_RULES_LIST]));

  sections.push(freedomModeDirective(context.freedomMode));

  sections.push(
    `Reference material (ground your answers in this; do not invent facts beyond it):\n${renderChunks(context.relevantChunks)}`,
  );

  const questions = renderQuestions(context.relatedQuestions);
  if (questions) sections.push(questions);

  const mistakes = renderMistakes(context.commonMistakes);
  if (mistakes) sections.push(mistakes);

  return sections.join('\n\n');
}

/** Build the user message: compact progress + the learner's actual message. */
function buildUserPrompt(context: TutorContext): string {
  return [
    `Learner progress: ${renderProgress(context.progress)}`,
    `Learner message: ${context.userMessage}`,
  ].join('\n\n');
}

/**
 * Render a model-ready prompt from a TutorContext. Returns both the split
 * system/user strings and the canonical `messages` array — no model call.
 */
export function buildTutorPrompt(params: { context: TutorContext }): TutorPrompt {
  const { context } = params;
  const systemPrompt = buildSystemPrompt(context);
  const userPrompt = buildUserPrompt(context);

  return {
    systemPrompt,
    userPrompt,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };
}
