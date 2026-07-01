// ── Model Provider — local inference runtime seam ────────────────────
//
// The seam between "we have a downloaded model file" and "we can actually run
// it on-device". Today only a Noop runtime exists (no engine bundled), so it
// reports unsupported and throws a typed error. Later, WebLLMRuntime /
// LlamaCppRuntime / NativeMobileRuntime can implement this same interface and be
// swapped in via `localInferenceRuntime` — lesson/tutor logic never changes.

export interface LocalInferenceRuntime {
  /** Can this runtime run the given model on this device right now? */
  isSupported(args: { modelId: string }): Promise<boolean>;
  /** Load a downloaded model file into the runtime. */
  loadModel(args: { modelId: string; localPath?: string; fileName?: string }): Promise<void>;
  /** Generate text from an already-loaded model. */
  generateText(args: { prompt: string; systemPrompt?: string; maxTokens?: number }): Promise<string>;
}

/**
 * File is downloaded, but no on-device inference runtime is connected yet.
 * Typed so the UI/tutor can recognize it and show guidance rather than a generic
 * failure. Safe to display — carries no secrets.
 */
export class LocalModelRuntimeNotImplementedError extends Error {
  readonly modelId: string;
  constructor(params: { modelId: string }) {
    super(
      'This offline model is downloaded, but the local inference runtime is not connected yet. ' +
        'Use Gemini/OpenRouter for now or switch back to Built-in AI.',
    );
    this.name = 'LocalModelRuntimeNotImplementedError';
    this.modelId = params.modelId;
  }
}

/**
 * Placeholder runtime: nothing is bundled, so it is never supported and refuses
 * to load/generate. This keeps the app honest — a downloaded model does not
 * pretend to answer until a real engine is wired in.
 */
export class NoopLocalInferenceRuntime implements LocalInferenceRuntime {
  async isSupported(): Promise<boolean> {
    return false;
  }
  async loadModel(args: { modelId: string }): Promise<void> {
    throw new LocalModelRuntimeNotImplementedError({ modelId: args.modelId });
  }
  async generateText(): Promise<string> {
    throw new LocalModelRuntimeNotImplementedError({ modelId: 'unknown' });
  }
}

/**
 * The runtime the app uses. Swap this for a real implementation
 * (WebLLMRuntime, …) to enable on-device inference — no caller changes needed.
 */
export const localInferenceRuntime: LocalInferenceRuntime = new NoopLocalInferenceRuntime();
