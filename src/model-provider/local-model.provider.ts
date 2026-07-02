// ── Model Provider — local model (runtime-seam backed) ───────────────
//
// Satisfies the ModelProvider seam for the offline path. It does NOT fake
// answers and it never triggers a surprise multi-GB download mid-lesson.
// generateText distinguishes the three local states explicitly:
//   1. weights not in the browser cache      → LocalModelFileNotDownloadedError
//      ("not downloaded yet" — download happens only from AI setup)
//   2. downloaded but runtime can't run here → LocalModelRuntimeNotReadyError
//      (e.g. WebGPU unavailable in this browser)
//   3. downloaded + runtime ready            → load from cache and generate
// All errors are typed + friendly so the UI/tutor guides the user, no crash.

import type { ModelProvider } from './model-provider.types';
import { DEFAULT_LOCAL_MODEL_ID, getLocalModelById } from './local-model-catalog';
import { localInferenceRuntime } from './local-inference-runtime';

/** The selected offline model's weights are not in this browser's storage. */
export class LocalModelFileNotDownloadedError extends Error {
  readonly modelId: string;
  constructor(params: { modelId: string }) {
    super(
      'This model is not downloaded yet. Open AI setup and download it once — ' +
        'after that it stays on this device — or switch to Built-in, Gemini, or OpenRouter.',
    );
    this.name = 'LocalModelFileNotDownloadedError';
    this.modelId = params.modelId;
  }
}

/** The model IS downloaded, but this browser can't run it (e.g. no WebGPU). */
export class LocalModelRuntimeNotReadyError extends Error {
  readonly modelId: string;
  constructor(params: { modelId: string }) {
    super(
      'This model is downloaded, but the local runtime is not ready — this browser has no WebGPU. ' +
        'Use a recent Chrome or Edge, or switch to Built-in, Gemini, or OpenRouter.',
    );
    this.name = 'LocalModelRuntimeNotReadyError';
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
      // State 1 — not downloaded. Downloading is an explicit AI-setup action,
      // never a side effect of sending a chat message.
      const downloaded = await localInferenceRuntime.isModelDownloaded({ modelId });
      if (!downloaded) throw new LocalModelFileNotDownloadedError({ modelId });

      // State 2 — downloaded but the runtime can't run on this device.
      const supported = await localInferenceRuntime.isSupported({ modelId });
      if (!supported) throw new LocalModelRuntimeNotReadyError({ modelId });

      // State 3 — load from the persistent cache (fast after first use) and run.
      await localInferenceRuntime.loadModel({ modelId });
      return localInferenceRuntime.generateText({ prompt: args.prompt, systemPrompt: args.system });
    },
  };
}
