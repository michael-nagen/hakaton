// ── Lesson Assistant — personalization presets + builders ────────────
//
// The five classic teaching styles + helpers that turn a preset id or custom
// text into a TeachingPreference. Framework-free so the service, the video
// query builder, and the UI all share one source of truth.

import type { TeachingPreference } from './lesson-assistant.types';

export interface PersonalizationPreset {
  id: string;
  label: string;
  instruction: string;
}

export const CLASSIC_PERSONALIZATION_OPTIONS: readonly PersonalizationPreset[] = [
  {
    id: 'step_by_step',
    label: 'Step by step',
    instruction: 'Teach the student step by step. Break concepts into small parts and avoid jumping ahead.',
  },
  {
    id: 'examples_first',
    label: 'Examples first',
    instruction: 'Teach with concrete examples before abstract explanations.',
  },
  {
    id: 'simple_language',
    label: 'Simple language',
    instruction: 'Use simple beginner-friendly language and explain new terms clearly.',
  },
  {
    id: 'ask_questions',
    label: 'Ask me questions',
    instruction: 'Teach by asking short guiding questions and checking understanding.',
  },
  {
    id: 'real_world',
    label: 'Real world use',
    instruction: 'Connect the concept to practical real-world use cases.',
  },
];

/** Max length of a custom teaching preference. */
export const CUSTOM_PREFERENCE_MAX_LENGTH = 100;

/** Build a TeachingPreference from a preset id, or null if unknown. */
export function presetPreference(id: string): TeachingPreference | null {
  const preset = CLASSIC_PERSONALIZATION_OPTIONS.find((o) => o.id === id);
  if (!preset) return null;
  return { source: 'preset', instruction: preset.instruction, label: preset.label, presetId: preset.id };
}

/** Build a TeachingPreference from free text (trimmed, capped), or null if empty. */
export function customPreference(text: string): TeachingPreference | null {
  const instruction = text.trim().slice(0, CUSTOM_PREFERENCE_MAX_LENGTH);
  if (!instruction) return null;
  return { source: 'custom', instruction, label: 'Custom' };
}
