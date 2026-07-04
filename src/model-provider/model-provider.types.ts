// ── Model Provider — types ───────────────────────────────────────────
//
// One narrow seam between the app and whatever generates text. Gemini,
// OpenRouter, local/WebLLM, and custom endpoints each implement this same
// interface without touching callers. Provider-neutral on purpose.

export interface GenerateTextArgs {
  /** The user/content prompt. */
  prompt: string;
  /** Optional system instruction (persona, rules, grounding). */
  system?: string;
}

export interface ModelProvider {
  /** Human-readable id, e.g. "gemini-1.5". */
  readonly name: string;
  /** Optional underlying model name, e.g. "gemini-1.5-flash". */
  readonly modelName?: string;
  generateText(args: GenerateTextArgs): Promise<string>;
}
