// ── Model Provider — local model (placeholder) ───────────────────────
//
// Satisfies the ModelProvider seam so the offline path is a first-class citizen
// in config, the registry, and the tutor layer — but on-device inference isn't
// wired up yet. generateText throws a clear, catchable error so the UI can show
// an honest "coming soon" state instead of pretending to answer. When a real
// runtime (WebLLM/MLC/wasm) lands, only this file changes.

import type { ModelProvider } from './model-provider.types';
import { DEFAULT_LOCAL_MODEL_ID, getLocalModelById } from './local-model-catalog';

/** Thrown by the placeholder local provider. Recognizable + safe to display. */
export class LocalModelNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalModelNotReadyError';
  }
}

export function createLocalModelProvider(params: { modelId?: string }): ModelProvider {
  const modelId = params.modelId ?? DEFAULT_LOCAL_MODEL_ID;
  const model = getLocalModelById({ id: modelId });
  return {
    name: 'local',
    modelName: model?.displayName ?? modelId,
    async generateText() {
      throw new LocalModelNotReadyError(
        'Local on-device inference is not available yet. Choose Built-in AI, Gemini, or OpenRouter for now.',
      );
    },
  };
}
