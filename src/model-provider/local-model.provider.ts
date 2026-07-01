// ── Model Provider — local model (runtime pending) ───────────────────
//
// Satisfies the ModelProvider seam so the offline path is a first-class citizen.
// It does NOT run inference and does NOT fall back to the mock. generateText
// inspects storage and throws one of two typed, catchable errors so the UI/tutor
// can show precise guidance:
//   • file not downloaded yet  → LocalModelFileNotDownloadedError
//   • downloaded, no runtime   → LocalModelRuntimeNotImplementedError
// When a real runtime lands, replace the final throw with inference over the
// downloaded file — callers stay unchanged.

import type { ModelProvider } from './model-provider.types';
import { DEFAULT_LOCAL_MODEL_ID, getLocalModelById } from './local-model-catalog';
import { localModelStorage } from './local-model-storage';

/** Selected local model, but its file has not been downloaded yet. */
export class LocalModelFileNotDownloadedError extends Error {
  readonly modelId: string;
  constructor(params: { modelId: string }) {
    super(
      'This offline model is selected, but the model file is not downloaded yet. ' +
        'Open AI setup and download it, or switch to Gemini/OpenRouter/Built-in AI.',
    );
    this.name = 'LocalModelFileNotDownloadedError';
    this.modelId = params.modelId;
  }
}

/** File is downloaded, but no on-device inference runtime is implemented yet. */
export class LocalModelRuntimeNotImplementedError extends Error {
  readonly modelId: string;
  constructor(params: { modelId: string }) {
    super(
      'This offline model is downloaded, but local inference runtime is not implemented yet. ' +
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
      const downloaded = await localModelStorage.hasModelFile({ modelId });
      if (!downloaded) throw new LocalModelFileNotDownloadedError({ modelId });
      // File present, but inference isn't wired up — be honest, never fake it.
      throw new LocalModelRuntimeNotImplementedError({ modelId });
    },
  };
}
