// ── Model client abstraction ─────────────────────────────────────────
//
// One tiny interface every agent uses. Only the model-client layer knows
// provider-specific details (OpenAI vs Anthropic vs mock). Agents just call
// `complete()` and get text back.

export interface CompleteArgs {
  /** System instruction (persona + task framing). */
  system: string;
  /** The user prompt (the actual input for this step). */
  prompt: string;
  /**
   * Stable id of the calling agent, e.g. "01-input-normalizer". Used for
   * logging and for routing the mock provider to the right fixture. Real
   * providers ignore it beyond logging.
   */
  purpose: string;
}

export interface CompleteResult {
  /** Raw text returned by the model (may be JSON, possibly fenced). */
  text: string;
  /** Provider call latency in milliseconds. */
  latencyMs: number;
  /** Model name actually used, if known. */
  modelName: string | null;
}

export interface ModelClient {
  readonly providerId: string;
  readonly modelName: string | null;
  complete(args: CompleteArgs): Promise<CompleteResult>;
}
