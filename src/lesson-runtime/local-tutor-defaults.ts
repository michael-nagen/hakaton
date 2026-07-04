// ── Lesson Runtime — local-device tutor defaults (app runtime) ───────
//
// How the LOCAL / on-device (WebLLM) tutor is configured by default in the app.
// The shared runtime values (model/strategy/memory/lessonVariant/completion) are
// imported from the SINGLE SOURCE OF TRUTH — ./shared-local-tutor-defaults.ts —
// which the teacher-harness locked config also imports, so app + harness can
// never drift. Only the app-specific catalog wiring (localModelId) lives here.
//
// SCOPE / WIRING STATUS (read this before assuming behaviour):
//   • `localModelId` IS wired: the local provider resolves to it (see
//     model-provider/local-model-catalog.ts → DEFAULT_LOCAL_MODEL_ID = Llama 3.2 3B).
//   • `strategy`, `memoryMode`, `lastMessagesLimit`, `lessonCompletionEnabled`
//     are ALSO wired now: `resolveLocalRuntimeSettings()` applies them whenever
//     the active provider is the local model, and `useLessonSession` feeds the
//     result into `runLessonTurn`. On the local path these OVERRIDE the
//     /ai-setup selector (which is intentionally not exposed per-local). Other
//     providers (cloud/BYOK) pass through the caller's settings unchanged, so
//     the cloud path stays separate.
//
// This module is framework-free data + a pure resolver only. It adds NO UI, NO
// database, NO durable memory, and does NOT change the Tutor prompt. The app's
// memory model is already "last messages only" (see to-tutor-input.ts — the
// model only ever receives the last N messages, never a checklist or archive);
// the live local path uses the same focused window as the cloud path (4), which
// intentionally diverges from the harness memory-experiment window.

import { DEFAULT_LOCAL_MODEL_ID } from '../model-provider/local-model-catalog';
// Import the type from its concrete source file, NOT the model-provider barrel,
// so this module (and its shared defaults) stays importable from the Node
// teacher-harness without pulling in browser-only model-provider code.
import type { AiProviderType } from '../model-provider/ai-provider-config.types';
import { DEFAULT_RECENT_MESSAGES_LIMIT } from './to-tutor-input';
import type { TutorRuntimeStrategy } from './tutor-strategy';
import { SHARED_LOCAL_TUTOR_DEFAULTS } from './shared-local-tutor-defaults';

/** The lesson-memory representation the local path should send to the model. */
export type LocalTutorMemoryMode =
  | 'no_memory'
  | 'last_messages_only'
  | 'summary_only'
  | 'summary_plus_last_messages'
  | 'structured_working_memory';

export interface LocalDeviceTutorDefaults {
  /** Catalog id of the default on-device model. */
  localModelId: string;
  /** WebLLM (MLC) model id that the on-device runtime actually loads. */
  webllmModelId: string;
  /** How the runtime wraps the model call. */
  strategy: TutorRuntimeStrategy;
  /** Preferred CoursePackage variant/style to author for this local model. */
  lessonVariant: string;
  /** Which lesson-memory representation the model receives. */
  memoryMode: LocalTutorMemoryMode;
  /** How many recent messages the model receives (role + short content). */
  lastMessagesLimit: number;
  /** Locked OFF: the local tutor never marks a lesson complete for now. */
  lessonCompletionEnabled: boolean;
}

/**
 * The locked best-known configuration for the LOCAL / on-device tutor path.
 * The shared runtime values (model/strategy/memory/lessonVariant/completion)
 * come from the SINGLE SOURCE OF TRUTH — src/lesson-runtime/shared-local-tutor-defaults.ts
 * — which the teacher-harness locked config also imports, so they cannot drift.
 * Only `localModelId` is app-specific (the catalog id the local provider wires to).
 */
export const LOCAL_DEVICE_TUTOR_DEFAULTS: LocalDeviceTutorDefaults = {
  localModelId: DEFAULT_LOCAL_MODEL_ID,
  webllmModelId: SHARED_LOCAL_TUTOR_DEFAULTS.model,
  strategy: SHARED_LOCAL_TUTOR_DEFAULTS.strategy,
  lessonVariant: SHARED_LOCAL_TUTOR_DEFAULTS.lessonVariant,
  memoryMode: SHARED_LOCAL_TUTOR_DEFAULTS.memoryMode,
  // The LIVE on-device tutor uses the app's focused window (4), NOT the harness
  // memory-experiment window (SHARED_LOCAL_TUTOR_DEFAULTS.lastMessagesLimit). The
  // live main prompt already carries a strict JSON contract and Llama 3.2 3B is
  // small, so we keep recent-message context lightweight and consistent with the
  // cloud path. The harness memory experiment stays untouched in its own config.
  lastMessagesLimit: DEFAULT_RECENT_MESSAGES_LIMIT,
  lessonCompletionEnabled: SHARED_LOCAL_TUTOR_DEFAULTS.lessonCompletion,
};

/** The effective per-turn runtime settings after applying the local-device lock. */
export interface ResolvedRuntimeSettings {
  strategy: TutorRuntimeStrategy;
  /** False disables lesson completion (the tutor can never finish the lesson). */
  allowCompletion: boolean;
  /** Recent-messages window sent to the model. */
  recentMessagesLimit: number;
  /** True when the locked local-device defaults were applied (provider is local). */
  isLocalDeviceDefault: boolean;
}

/**
 * Resolve the runtime settings for one lesson turn.
 *
 * On the LOCAL / on-device path (provider === 'local_model') the locked
 * defaults are applied automatically and take precedence over the caller's
 * (/ai-setup) selections — the local tutor is not a user-tunable surface yet.
 * Every other provider passes through the caller's chosen settings unchanged,
 * so the cloud/BYOK path is unaffected.
 */
export function resolveLocalRuntimeSettings(params: {
  providerType: AiProviderType;
  /** The caller's (context) strategy — used for non-local providers. */
  selectedStrategy: TutorRuntimeStrategy;
  /** The caller's (context) completion preference — used for non-local providers. */
  selectedCompletionEnabled: boolean;
}): ResolvedRuntimeSettings {
  if (params.providerType === 'local_model') {
    return {
      strategy: LOCAL_DEVICE_TUTOR_DEFAULTS.strategy,
      allowCompletion: LOCAL_DEVICE_TUTOR_DEFAULTS.lessonCompletionEnabled,
      recentMessagesLimit: LOCAL_DEVICE_TUTOR_DEFAULTS.lastMessagesLimit,
      isLocalDeviceDefault: true,
    };
  }
  return {
    strategy: params.selectedStrategy,
    allowCompletion: params.selectedCompletionEnabled,
    recentMessagesLimit: DEFAULT_RECENT_MESSAGES_LIMIT,
    isLocalDeviceDefault: false,
  };
}
