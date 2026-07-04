// ── Lesson Runtime — lesson flow mode ────────────────────────────────
//
// Which lesson experience the player runs. Additive + opt-in:
//
//   'current'             – the existing question-driven, model-led flow
//                           (unchanged; the default).
//   'deterministic_steps' – the new app-controlled flow that walks a unit's
//                           prepared `deterministicSteps` in order. The model
//                           only explains/adapts INSIDE the current step; the
//                           runtime owns progression.
//
// If 'deterministic_steps' is selected but a unit has no deterministic step
// data, the player falls back to the current flow (never crashes).

export type LessonFlowMode = 'current' | 'deterministic_steps';

/** The safe default — the current, already-shipped behavior. */
export const DEFAULT_LESSON_FLOW_MODE: LessonFlowMode = 'current';

/** Coerce any stored/unknown value to a valid mode (default 'current'). */
export function resolveLessonFlowMode(value: unknown): LessonFlowMode {
  return value === 'deterministic_steps' ? 'deterministic_steps' : DEFAULT_LESSON_FLOW_MODE;
}
