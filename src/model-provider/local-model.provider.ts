// ── Model Provider — local model (runtime-seam backed) ───────────────
//
// Satisfies the ModelProvider seam for the offline path. It does NOT fake
// answers. generateText loads the model on demand through the local inference
// runtime (WebLLM), which downloads + caches the weights in the browser on first
// use and then runs fully on-device. Errors are typed + friendly so the UI/tutor
// can guide the user (e.g. WebGPU unavailable) without crashing.

import type { ModelProvider } from './model-provider.types';
import { DEFAULT_LOCAL_MODEL_ID, getLocalModelById } from './local-model-catalog';
import { localInferenceRuntime } from './local-inference-runtime';

/**
 * Kept for backward-compatibility of the public error surface. No longer thrown:
 * with WebLLM the runtime downloads weights on demand, so there is no separate
 * "file not downloaded" state to gate on.
 */
export class LocalModelFileNotDownloadedError extends Error {
  readonly modelId: string;
  constructor(params: { modelId: string }) {
    super('This offline model is not downloaded yet. Open AI setup to download it, or switch provider.');
    this.name = 'LocalModelFileNotDownloadedError';
    this.modelId = params.modelId;
  }
}

export function createLocalModelProvider(params: { modelId?: string }): ModelProvider {
  const modelId = params.modelId ?? DEFAULT_LOCAL_MODEL_ID;
  const model = getLocalModelById({ id: modelId });
  return {
    name: 'local',
    modelName: model?.displayName ?? modelId,
    async generateText(args) {
      // Load on demand: first call downloads + caches the weights via WebLLM,
      // later calls reuse the in-memory engine. Throws typed, friendly errors
      // (no WebGPU / no runtime mapping) rather than faking a response.
      await localInferenceRuntime.loadModel({ modelId });
      return localInferenceRuntime.generateText({ prompt: args.prompt, systemPrompt: args.system });
    },
  };
}
