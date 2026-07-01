// ── Model Provider — local model (runtime pending) ───────────────────
//
// Satisfies the ModelProvider seam so the offline path is a first-class citizen
// in config, the registry, and the tutor layer. On-device inference isn't wired
// up yet, so generateText throws a clear, typed, catchable error — it does NOT
// silently fall back to the mock. The UI/tutor flow catches it and shows a
// friendly message. When a real runtime (WebLLM/MLC/llama.cpp-wasm) lands, only
// this file changes; callers stay the same.

import type { ModelProvider } from './model-provider.types';
import { DEFAULT_LOCAL_MODEL_ID, getLocalModelById } from './local-model-catalog';

/**
 * Thrown when a local model is selected but no on-device inference runtime is
 * installed/implemented. Typed so the UI can recognize it and show guidance
 * rather than a generic failure. Safe to display — carries no secrets.
 */
export class LocalModelRuntimeNotImplementedError extends Error {
  /** The selected local model id, for messaging/telemetry. */
  readonly modelId: string;
  constructor(params: { modelId: string; message?: string }) {
    super(
      params.message ??
        'This offline model is selected, but local inference is not installed yet. ' +
          'Use Gemini/OpenRouter for now or switch back to Built-in AI.',
    );
    this.name = 'LocalModelRuntimeNotImplementedError';
    this.modelId = params.modelId;
  }
}

export function createLocalModelProvider(params: { modelId?: string }): ModelProvider {
  const modelId = params.modelId ?? DEFAULT_LOCAL_MODEL_ID;
  const model = getLocalModelById({ id: modelId });
  return {
    name: 'local',
    modelName: model?.displayName ?? modelId,
    async generateText() {
      throw new LocalModelRuntimeNotImplementedError({ modelId });
    },
  };
}
