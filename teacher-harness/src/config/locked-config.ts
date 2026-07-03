// ── Teacher Harness — locked best configuration ──────────────────────
//
// The best-known tutor setup discovered by the evaluation experiments (2026-07).
// The harness's normal/default path uses ONLY this configuration; the full
// model/strategy/memory/lesson matrices are developer-only and must be requested
// explicitly (e.g. `--models all`).
//
// The SHARED runtime values (model/strategy/memory/lessonVariant/completion) are
// imported from the SINGLE SOURCE OF TRUTH — the app's
// src/lesson-runtime/shared-local-tutor-defaults.ts — NOT re-declared here, so
// app + harness can never drift. This module only adds harness-specific fields
// (catalog id, prompt variants, judge provider).

import type { EvalStrategyId } from '../evaluation/eval-types';
import type { LessonMemoryMode } from '../runtime/lesson-memory.types';
import type { TutorPromptVariant } from '../runtime/tutor-prompt-variants';
import { SHARED_LOCAL_TUTOR_DEFAULTS } from '../../../src/lesson-runtime/shared-local-tutor-defaults';

export interface LockedTutorConfig {
  /** Real WebLLM model id (on-device) — from the shared source of truth. */
  modelName: string;
  /** Model target id used on the evaluation CLI / alias (harness-specific). */
  modelTargetId: string;
  strategy: EvalStrategyId;
  /** Preferred CoursePackage variant/style for this local model. */
  lessonVariant: string;
  memoryMode: LessonMemoryMode;
  lastMessagesLimit: number;
  /** Lesson completion stays OFF (false) — the harness never marks a lesson done. */
  lessonCompletion: boolean;
  /**
   * The chosen local-device Tutor prompt DEFAULT. Locked deterministically
   * after evaluation: structured_rules_prompt won the real-course OpenAI-judge
   * comparison while being far shorter than the full prompt. This is the single
   * internal default path — NOT exposed in the learner UI, NOT the production
   * prompt (which is unchanged).
   */
  promptVariant: TutorPromptVariant;
  /** Quality baseline to beat — NOT the default. */
  baselinePromptVariant: TutorPromptVariant;
  /** Backup compact candidate — NOT the default (promising but unconfirmed at 5 units). */
  backupPromptVariant: TutorPromptVariant;
  /** Default judge provider for evaluation (OpenAI). Eval-only, not runtime. */
  judgeProvider: 'openai';
}

export const LOCKED_TUTOR_CONFIG: LockedTutorConfig = {
  // ── Shared runtime defaults (single source of truth; not re-declared) ──
  modelName: SHARED_LOCAL_TUTOR_DEFAULTS.model,
  strategy: SHARED_LOCAL_TUTOR_DEFAULTS.strategy,
  lessonVariant: SHARED_LOCAL_TUTOR_DEFAULTS.lessonVariant,
  memoryMode: SHARED_LOCAL_TUTOR_DEFAULTS.memoryMode,
  lastMessagesLimit: SHARED_LOCAL_TUTOR_DEFAULTS.lastMessagesLimit,
  lessonCompletion: SHARED_LOCAL_TUTOR_DEFAULTS.lessonCompletion,
  // ── Harness-specific fields ──
  modelTargetId: 'llama-better-offline',
  promptVariant: 'structured_rules_prompt',
  baselinePromptVariant: 'full_current_prompt',
  backupPromptVariant: 'compact_prompt',
  judgeProvider: 'openai',
};

/** A flat metadata block for reports/artifacts, showing the locked setup. */
export function lockedConfigMetadata(): Record<string, string | number> {
  return {
    model: LOCKED_TUTOR_CONFIG.modelName,
    strategy: LOCKED_TUTOR_CONFIG.strategy,
    lessonVariant: LOCKED_TUTOR_CONFIG.lessonVariant,
    memoryMode: LOCKED_TUTOR_CONFIG.memoryMode,
    lastMessagesLimit: LOCKED_TUTOR_CONFIG.lastMessagesLimit,
    // Rendered as a string for report/artifact blocks (source value is boolean).
    lessonCompletion: LOCKED_TUTOR_CONFIG.lessonCompletion ? 'enabled' : 'disabled',
    promptVariant: LOCKED_TUTOR_CONFIG.promptVariant,
    baselinePromptVariant: LOCKED_TUTOR_CONFIG.baselinePromptVariant,
    backupPromptVariant: LOCKED_TUTOR_CONFIG.backupPromptVariant,
    judgeProvider: LOCKED_TUTOR_CONFIG.judgeProvider,
  };
}
