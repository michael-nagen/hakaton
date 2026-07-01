// ── Tutor Runtime — freedom mode ─────────────────────────────────────
//
// Freedom mode controls how tightly the tutor is bound to the unit's
// knowledge chunks. It only changes the *instructions* sent to the model, not
// which data is retrieved — so it stays a pure presentation concern.

import type { FreedomMode } from './tutor-runtime.types';

export const FREEDOM_MODES: readonly FreedomMode[] = ['strict', 'guided', 'open'];

export const DEFAULT_FREEDOM_MODE: FreedomMode = 'guided';

/** Narrow an arbitrary value to a FreedomMode, falling back to the default. */
export function resolveFreedomMode(value: string | undefined): FreedomMode {
  return FREEDOM_MODES.includes(value as FreedomMode) ? (value as FreedomMode) : DEFAULT_FREEDOM_MODE;
}

/**
 * The behavioural directive injected into the system prompt for each mode.
 * Kept as one line per mode so it reads cleanly inside the larger prompt.
 */
export function freedomModeDirective(mode: FreedomMode): string {
  switch (mode) {
    case 'strict':
      return 'Freedom mode: STRICT. Answer ONLY from the reference material above. If it does not cover the question, say so and steer back to the unit goal — do not introduce outside facts.';
    case 'open':
      return 'Freedom mode: OPEN. Converse freely and follow the learner where it helps, using the unit goal and reference material as a loose anchor rather than a hard boundary.';
    case 'guided':
    default:
      return 'Freedom mode: GUIDED. Lead with the reference material; you may add small clarifying context, but keep the learner focused on this unit and flag when you go beyond the provided material.';
  }
}
