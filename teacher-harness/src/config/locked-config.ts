// ── Teacher Harness — locked best configuration ──────────────────────
//
// The single source of truth for the best-known tutor setup discovered by the
// evaluation experiments (2026-07-02). The harness's normal/default path uses
// ONLY this configuration; the full model/strategy/memory/lesson matrices are
// developer-only and must be requested explicitly (e.g. `--models all`).
//
// This is the harness mirror of the app's src/lesson-runtime/local-tutor-defaults.ts
// (the local-device default). Keep the two in sync when the locked setup changes.

import type { EvalStrategyId } from '../evaluation/eval-types';
import type { LessonMemoryMode } from '../runtime/lesson-memory.types';

export interface LockedTutorConfig {
  /** Real WebLLM model id (on-device). */
  modelName: string;
  /** Model target id used on the evaluation CLI / alias. */
  modelTargetId: string;
  strategy: EvalStrategyId;
  /** Preferred CoursePackage variant/style for this local model. */
  lessonVariant: string;
  memoryMode: LessonMemoryMode;
  lastMessagesLimit: number;
  /** Lesson completion stays disabled — the harness never marks a lesson done. */
  lessonCompletion: 'disabled';
}

export const LOCKED_TUTOR_CONFIG: LockedTutorConfig = {
  modelName: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
  modelTargetId: 'llama-better-offline',
  strategy: 'repair_pass',
  lessonVariant: 'high_very_guided',
  memoryMode: 'last_messages_only',
  lastMessagesLimit: 8,
  lessonCompletion: 'disabled',
};

/** A flat metadata block for reports/artifacts, showing the locked setup. */
export function lockedConfigMetadata(): Record<string, string | number> {
  return {
    model: LOCKED_TUTOR_CONFIG.modelName,
    strategy: LOCKED_TUTOR_CONFIG.strategy,
    lessonVariant: LOCKED_TUTOR_CONFIG.lessonVariant,
    memoryMode: LOCKED_TUTOR_CONFIG.memoryMode,
    lastMessagesLimit: LOCKED_TUTOR_CONFIG.lastMessagesLimit,
    lessonCompletion: LOCKED_TUTOR_CONFIG.lessonCompletion,
  };
}
