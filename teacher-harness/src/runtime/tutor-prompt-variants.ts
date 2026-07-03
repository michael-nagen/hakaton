// ── Teacher Harness — tutor prompt variants (efficiency experiment) ──
//
// Five ways to phrase the SAME tutor job, differing only in length / structure
// / instruction density — NOT in teaching personality. Every variant keeps the
// same kind, calm, supportive, clear tone and the same job:
//   • teach from the prepared CoursePackage (grounding), stay in the current unit
//   • correct known mistakes, avoid future/off-topic material
//   • answer briefly, ask one check question, never advance/finish the lesson
//
// KEY DESIGN: the GROUNDING block (reference material + practice questions +
// common mistakes) is extracted verbatim from the app's real prompt
// (buildTutorPrompt) and reused byte-identically across all variants, so the
// ONLY thing that changes between variants is the instruction preamble. This
// keeps the experiment clean (grounding/model/memory/strategy fixed) and never
// modifies the production prompt builder.

import { buildTutorPrompt } from '../../../src/tutor-runtime/build-tutor-prompt';
import type { TutorContext } from '../../../src/tutor-runtime/tutor-runtime.types';
import { LOCKED_TUTOR_CONFIG } from '../config/locked-config';

export type TutorPromptVariant =
  | 'full_current_prompt'
  | 'compact_prompt'
  | 'ultra_compact_prompt'
  | 'structured_rules_prompt'
  | 'checklist_prompt';

export const TUTOR_PROMPT_VARIANTS: readonly TutorPromptVariant[] = [
  'full_current_prompt',
  'compact_prompt',
  'ultra_compact_prompt',
  'structured_rules_prompt',
  'checklist_prompt',
];

// The default prompt variant for the plain `run`/`batch` path is sourced from
// the single source of truth (LOCKED_TUTOR_CONFIG) so it can never drift from
// the locked decision (structured_rules_prompt). full_current_prompt is kept
// available as the explicit baseline; compact_prompt as the backup.
export const DEFAULT_TUTOR_PROMPT_VARIANT: TutorPromptVariant = LOCKED_TUTOR_CONFIG.promptVariant;

/** Coerce/validate a prompt-variant string; throws on an invalid value. */
export function resolveTutorPromptVariant(value: unknown): TutorPromptVariant {
  if (value === undefined || value === null) return DEFAULT_TUTOR_PROMPT_VARIANT;
  if (typeof value === 'string' && (TUTOR_PROMPT_VARIANTS as readonly string[]).includes(value)) {
    return value as TutorPromptVariant;
  }
  throw new Error(
    `Invalid prompt variant "${String(value)}". Valid variants: ${TUTOR_PROMPT_VARIANTS.join(', ')}.`,
  );
}

/**
 * Marker where the app's system prompt switches from INSTRUCTIONS to GROUNDING.
 * Everything from here on (reference material + questions + mistakes) is reused
 * unchanged by every variant.
 */
const GROUNDING_MARKER = 'Reference material (ground your answers';

interface SplitPrompt {
  /** The instruction preamble (persona + rules) — the part that varies. */
  instructions: string;
  /** The grounding block (reference material + questions + mistakes) — constant. */
  grounding: string;
  /** The user prompt (learner progress + message) — constant. */
  userPrompt: string;
}

/** Split the app's real prompt into instruction vs grounding halves. */
function splitAppPrompt(context: TutorContext): SplitPrompt {
  const app = buildTutorPrompt({ context });
  const idx = app.systemPrompt.indexOf(GROUNDING_MARKER);
  if (idx < 0) {
    // No grounding marker (no chunks): treat the whole thing as instructions.
    return { instructions: app.systemPrompt.trim(), grounding: '', userPrompt: app.userPrompt };
  }
  return {
    instructions: app.systemPrompt.slice(0, idx).trim(),
    grounding: app.systemPrompt.slice(idx).trim(),
    userPrompt: app.userPrompt,
  };
}

// ── Instruction preambles (the varying part) ─────────────────────────
//
// Each keeps the same supportive persona and the same job; they differ in
// length and structure only. They intentionally reference the unit goal so the
// tutor stays anchored even when the preamble is short.

function compactInstructions(context: TutorContext): string {
  const { course, unit } = context;
  return [
    `You are a kind, calm, supportive tutor for "${course.title}", teaching only the unit "${unit.title}".`,
    `Unit goal: ${unit.goal}`,
    'Teach only from the reference material below. Stay in this unit. If asked about future or off-topic material, gently say it comes later and steer back. Correct the listed common mistakes when they appear. Keep replies short and clear, end with one short check question, and never tell the learner the lesson is finished or to move on.',
  ].join('\n\n');
}

function ultraCompactInstructions(context: TutorContext): string {
  const { unit } = context;
  return [
    `Kind, supportive tutor. Teach only this unit (goal: ${unit.goal}) using the reference material below.`,
    'Stay on topic, correct mistakes, be brief, ask one check question, do not advance the lesson.',
  ].join('\n');
}

function structuredRulesInstructions(context: TutorContext): string {
  const { course, unit } = context;
  return [
    `You are a kind, calm, supportive, clear tutor for "${course.title}" — unit "${unit.title}" (goal: ${unit.goal}).`,
    'Lesson opening: when the lesson is just starting (the learner has not been introduced to this unit yet), FIRST give a short structured intro before any check question — (1) one sentence on what we will learn (the unit goal in plain words), (2) ONE tiny concrete example from the reference material, (3) one short sentence on why it matters / what the learner will be able to do. Then begin the guided lesson. Do NOT ask a check question until after this intro.',
    'Rules:',
    '1. Teach only from the reference material below; do not invent facts.',
    '2. Stay inside the current unit; redirect future or off-topic questions and say they come later.',
    '3. Correct the listed common mistakes when the learner shows them.',
    "4. If the learner's answer is close enough / essentially right, ACCEPT it, briefly tidy the wording, and continue — do not nitpick minor phrasing.",
    '5. Keep every answer short and clear; do not over-explain.',
    '6. After the intro, ask exactly one short check question per turn.',
    '7. Never advance, finish, or tell the learner to move on.',
    '8. If the learner says they do not know, asks you to just tell them, or misses the same idea twice: STOP asking open-ended or leading questions. Give a short DIRECT explanation, show ONE concrete example from the reference material, then ask one very easy check question.',
    '9. Do not repeat the same question or hint pattern more than twice. Prefer a concrete worked example over confusing "what if" hypotheticals.',
    'Stay warm and encouraging throughout.',
  ].join('\n');
}

function checklistInstructions(context: TutorContext): string {
  const { course, unit } = context;
  return [
    `You are a kind, calm, supportive, clear tutor for "${course.title}" — unit "${unit.title}" (goal: ${unit.goal}).`,
    'Before you answer, silently check (do NOT print this checklist):',
    '- Is this inside the current unit? If not, gently redirect and say it comes later.',
    '- Does the learner show a listed common mistake? If so, correct it kindly.',
    '- Can I answer using only the reference material below? If not, say you are not sure rather than invent.',
    '- Can I keep it short and end with one check question?',
    'Then reply briefly and warmly. Never advance or finish the lesson.',
  ].join('\n');
}

export interface BuiltVariantPrompt {
  variant: TutorPromptVariant;
  systemPrompt: string;
  userPrompt: string;
  /** The instruction preamble only (the part that varies) — for size metrics + artifacts. */
  instructions: string;
  /** The constant grounding block — for size metrics. */
  grounding: string;
}

/**
 * Build the system+user prompt for a given variant. `full_current_prompt`
 * returns the app's real prompt untouched; every other variant swaps in a
 * shorter instruction preamble while keeping the same grounding + user prompt.
 */
export function buildVariantPrompt(params: { context: TutorContext; variant: TutorPromptVariant }): BuiltVariantPrompt {
  const { context, variant } = params;
  const split = splitAppPrompt(context);

  if (variant === 'full_current_prompt') {
    const app = buildTutorPrompt({ context });
    return {
      variant,
      systemPrompt: app.systemPrompt,
      userPrompt: app.userPrompt,
      instructions: split.instructions,
      grounding: split.grounding,
    };
  }

  const instructions =
    variant === 'compact_prompt'
      ? compactInstructions(context)
      : variant === 'ultra_compact_prompt'
        ? ultraCompactInstructions(context)
        : variant === 'structured_rules_prompt'
          ? structuredRulesInstructions(context)
          : checklistInstructions(context);

  const systemPrompt = split.grounding ? `${instructions}\n\n${split.grounding}` : instructions;
  return { variant, systemPrompt, userPrompt: split.userPrompt, instructions, grounding: split.grounding };
}
