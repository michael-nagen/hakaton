// ── Model Provider — types ───────────────────────────────────────────
//
// One narrow seam between the app and whatever generates text. Today only a
// mock implements it; later Gemini/Groq/OpenRouter/local/WebLLM can implement
// the same interface without touching callers. Provider-neutral on purpose.

export interface GenerateTextArgs {
  /** The user/content prompt. */
  prompt: string;
  /** Optional system instruction (persona, rules, grounding). */
  system?: string;
}

export interface ModelProvider {
  /** Human-readable id, e.g. "mock", "gemini-1.5". */
  readonly name: string;
  /** Optional underlying model name, e.g. "gemini-1.5-flash". Undefined for the mock. */
  readonly modelName?: string;
  generateText(args: GenerateTextArgs): Promise<string>;
}

/**
 * A selectable provider entry for UIs (e.g. the tutor demo). Keeping the id and
 * label separate from the provider instance lets a picker render options without
 * instantiating a provider until it is chosen.
 */
export interface ModelProviderOption {
  /** Stable id used as a select value, e.g. "mock". */
  id: string;
  /** Human-readable label for the option. */
  label: string;
  provider: ModelProvider;
}
