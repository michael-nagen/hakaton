// ── Tutor Runtime — run-turn adapter types ───────────────────────────
//
// Types for `runTutorTurn`, a thin orchestrator over the existing runtime
// (buildTutorContext → buildTutorPrompt → provider). It exists so a demo/test
// UI can run one turn and inspect debug info WITHOUT the core runtime having to
// know about latency, JSON parsing, or "actions". Keep this logic-free.

import type { CoursePackage } from '../course-package/course-package.types';
import type { ModelProvider } from '../model-provider/model-provider.types';
import type { FreedomMode, ProgressState } from './tutor-runtime.types';

export interface RunTutorTurnParams {
  coursePackage: CoursePackage;
  unitId: string;
  userMessage: string;
  provider: ModelProvider;
  /** Defaults to "guided" inside the runtime when omitted. */
  freedomMode?: FreedomMode;
  progress?: ProgressState;
  maxChunks?: number;
}

/** Outcome of attempting to read a structured JSON payload from the answer. */
export type JsonParseStatus = 'success' | 'failure' | 'not-json';

/**
 * Debug metadata derived around a single tutor turn. Fields the underlying
 * runtime does not model today (modelName, action) are optional/null so the UI
 * can show "n/a" honestly rather than inventing values.
 */
export interface TutorTurnDebug {
  /** Provider id used, e.g. "mock". */
  provider: string;
  /** Underlying model name if the provider exposes one; null otherwise. */
  modelName: string | null;
  /** Wall-clock time spent in the provider call, in milliseconds. */
  latencyMs: number;
  /** The unit the tutor taught this turn. */
  unit: { id: string; title: string };
  freedomMode: FreedomMode;
  /** IDs of the KB chunks that were actually sent to the model. */
  kbChunkIds: string[];
  /** An "action" field parsed from a JSON response, if the model returned one. */
  action: string | null;
  /** Whether the answer parsed as JSON ('not-json' when it clearly wasn't JSON). */
  jsonParse: JsonParseStatus;
}

export interface TutorTurnResult {
  /** The model's raw answer text. */
  answer: string;
  /** The exact system/user prompts sent (handy for inspection). */
  systemPrompt: string;
  userPrompt: string;
  debug: TutorTurnDebug;
}
