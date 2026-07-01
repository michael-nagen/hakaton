// ── Model Provider — local model (runtime-seam backed) ───────────────
//
// Satisfies the ModelProvider seam for the offline path. It does NOT fake
// answers and does NOT fall back to the mock. generateText:
//   1. if the model file isn't downloaded → LocalModelFileNotDownloadedError
//   2. else ask the LocalInferenceRuntime to run it
//        • Noop runtime (today) → LocalModelRuntimeNotImplementedError
//        • a real runtime later → loads the downloaded file and generates
// Both errors are typed + friendly so the UI/tutor can guide the user without
// crashing. Wiring a real runtime is a swap in local-inference-runtime.ts — this
// file and all callers stay unchanged.

import type { ModelProvider } from './model-provider.types';
import { DEFAULT_LOCAL_MODEL_ID, getLocalModelById } from './local-model-catalog';
import { localModelStorage } from './local-model-storage';
import { readLocalModelState } from './local-model-state';
import { localInferenceRuntime, LocalModelRuntimeNotImplementedError } from './local-inference-runtime';

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

export function createLocalModelProvider(params: { modelId?: string }): ModelProvider {
  const modelId = params.modelId ?? DEFAULT_LOCAL_MODEL_ID;
  const model = getLocalModelById({ id: modelId });
  return {
    name: 'local',
    modelName: model?.displayName ?? modelId,
    async generateText(args) {
      const downloaded = await localModelStorage.hasModelFile({ modelId });
      if (!downloaded) throw new LocalModelFileNotDownloadedError({ modelId });

      // File present — hand off to the runtime seam. Noop reports unsupported,
      // so we surface the "runtime not connected" error rather than faking it.
      const supported = await localInferenceRuntime.isSupported({ modelId });
      if (!supported) throw new LocalModelRuntimeNotImplementedError({ modelId });

      const state = readLocalModelState({ modelId });
      await localInferenceRuntime.loadModel({ modelId, localPath: state?.localPath, fileName: model?.fileName });
      return localInferenceRuntime.generateText({ prompt: args.prompt, systemPrompt: args.system });
    },
  };
}
