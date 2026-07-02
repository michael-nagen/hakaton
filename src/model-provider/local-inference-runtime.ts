// ── Model Provider — local inference runtime (WebLLM) ────────────────
//
// The seam between "we have an offline model" and "we can actually run it
// on-device". Backed by WebLLM (@mlc-ai/web-llm), which runs quantized LLMs in
// the browser on WebGPU and fetches + caches the weights itself — so there is no
// manual .gguf download and no server round-trip at inference time.
//
// The heavy library is loaded with a DYNAMIC import inside loadModel(), so users
// on the cloud/built-in path never pay its bundle cost. Callers (the tutor/lesson
// layer) stay unchanged: they go through local-model.provider.ts → this seam.

import type { InitProgressReport, MLCEngineInterface } from '@mlc-ai/web-llm';
import { getLocalModelById } from './local-model-catalog';

/** Progress of a model warm-up/download (0..1 + a human status line). */
export interface LocalModelLoadProgress {
  progress: number;
  text: string;
}

export interface LocalInferenceRuntime {
  /** Can this runtime run the given model on this device right now? */
  isSupported(args: { modelId: string }): Promise<boolean>;
  /** Load (download + cache on first use) a model into the runtime. */
  loadModel(args: { modelId: string; onProgress?: (p: LocalModelLoadProgress) => void }): Promise<void>;
  /** Generate text from an already-loaded model. */
  generateText(args: { prompt: string; systemPrompt?: string; maxTokens?: number }): Promise<string>;
  /** Release the loaded engine (best-effort). */
  unload(): Promise<void>;
}

/**
 * The selected offline model has no on-device runtime mapping yet. Typed so the
 * UI/tutor can recognise it and guide the user instead of failing generically.
 */
export class LocalModelRuntimeNotImplementedError extends Error {
  readonly modelId: string;
  constructor(params: { modelId: string }) {
    super(
      'This offline model has no on-device runtime configured yet. ' +
        'Use Gemini/OpenRouter for now or switch back to Built-in AI.',
    );
    this.name = 'LocalModelRuntimeNotImplementedError';
    this.modelId = params.modelId;
  }
}

/** The browser can't run the offline model because WebGPU is unavailable. */
export class LocalModelWebGpuUnavailableError extends Error {
  constructor() {
    super(
      "This browser can't run the offline model — WebGPU is not available. " +
        'Use a recent Chrome or Edge (or enable WebGPU), or switch to Built-in, Gemini, or OpenRouter.',
    );
    this.name = 'LocalModelWebGpuUnavailableError';
  }
}

function webgpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && !!(navigator as { gpu?: unknown }).gpu;
}

/**
 * WebLLM-backed runtime. Keeps a single loaded engine and reuses it while the
 * same model stays selected; switching models unloads the previous engine first.
 */
class WebLLMLocalInferenceRuntime implements LocalInferenceRuntime {
  private engine: MLCEngineInterface | null = null;
  private loadedWebllmId: string | null = null;

  async isSupported({ modelId }: { modelId: string }): Promise<boolean> {
    const model = getLocalModelById({ id: modelId });
    return !!model?.webllmModelId && webgpuAvailable();
  }

  async loadModel({
    modelId,
    onProgress,
  }: {
    modelId: string;
    onProgress?: (p: LocalModelLoadProgress) => void;
  }): Promise<void> {
    const model = getLocalModelById({ id: modelId });
    if (!model?.webllmModelId) throw new LocalModelRuntimeNotImplementedError({ modelId });
    if (!webgpuAvailable()) throw new LocalModelWebGpuUnavailableError();

    // Already loaded this exact model — nothing to do.
    if (this.engine && this.loadedWebllmId === model.webllmModelId) return;

    // Different model was loaded — release it before loading the new one.
    if (this.engine) await this.unload();

    const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
    const engine = await CreateMLCEngine(model.webllmModelId, {
      initProgressCallback: (report: InitProgressReport) =>
        onProgress?.({ progress: report.progress ?? 0, text: report.text ?? '' }),
    });
    this.engine = engine;
    this.loadedWebllmId = model.webllmModelId;
  }

  async generateText({
    prompt,
    systemPrompt,
    maxTokens,
  }: {
    prompt: string;
    systemPrompt?: string;
    maxTokens?: number;
  }): Promise<string> {
    if (!this.engine) throw new Error('The offline model is not loaded.');
    const messages = systemPrompt
      ? ([
          { role: 'system' as const, content: systemPrompt },
          { role: 'user' as const, content: prompt },
        ])
      : ([{ role: 'user' as const, content: prompt }]);

    const reply = await this.engine.chat.completions.create({
      messages,
      max_tokens: maxTokens ?? 1024,
      temperature: 0.7,
    });
    return reply.choices[0]?.message?.content ?? '';
  }

  async unload(): Promise<void> {
    if (!this.engine) return;
    try {
      await this.engine.unload();
    } catch {
      // best-effort — the engine may already be gone
    }
    this.engine = null;
    this.loadedWebllmId = null;
  }
}

/**
 * The runtime the app uses. Swap the class here to change the local engine
 * (e.g. a native mobile runtime) — callers never change.
 */
export const localInferenceRuntime: LocalInferenceRuntime = new WebLLMLocalInferenceRuntime();
