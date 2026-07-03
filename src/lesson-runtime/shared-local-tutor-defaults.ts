// ── Shared local-device tutor defaults — SINGLE SOURCE OF TRUTH ──────
//
// The one place that defines the runtime defaults shared by BOTH the app's
// local-device tutor path (src/lesson-runtime/local-tutor-defaults.ts) and the
// teacher-harness locked config (teacher-harness/src/config/locked-config.ts).
//
// Neutral leaf module: it imports NOTHING, so both layers can import it without
// a circular dependency. The harness (which already imports from src/) reads
// these values instead of keeping its own copy — so the shared runtime defaults
// live in exactly one place and cannot drift.
//
// Harness-only fields (promptVariant / baselinePromptVariant / backupPromptVariant
// / judgeProvider) stay in the harness config; they are NOT runtime defaults and
// are NOT part of this shared config. Discovered by the teacher-harness
// evaluation experiments (2026-07); see teacher-harness/docs/tutor-defaults-decision.md.

export const SHARED_LOCAL_TUTOR_DEFAULTS = {
  /** WebLLM (MLC) model id the on-device tutor loads. */
  model: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
  /** How the runtime wraps the model call. */
  strategy: 'repair_pass',
  /** Lesson-memory representation sent to the model. */
  memoryMode: 'last_messages_only',
  /** Recent-messages window sent to the model. */
  lastMessagesLimit: 8,
  /** Preferred CoursePackage lesson-generation style. */
  lessonVariant: 'high_very_guided',
  /** Locked OFF: the tutor never auto-marks a lesson complete. */
  lessonCompletion: false,
} as const;

export type SharedLocalTutorDefaults = typeof SHARED_LOCAL_TUTOR_DEFAULTS;

/** Absolute-ish module id for reports/verification (no secrets). */
export const SHARED_DEFAULTS_SOURCE = 'src/lesson-runtime/shared-local-tutor-defaults.ts';
