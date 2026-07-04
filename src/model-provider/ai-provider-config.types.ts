// ── AI Provider — config model ───────────────────────────────────────
//
// The serializable description of HOW the tutor should run. This is what the
// AI setup screen writes and what the config store persists (on-device). It is
// deliberately transport-agnostic: `createModelProviderFromConfig` turns one of
// these into a live ModelProvider, so adding a provider later never changes
// callers. All args are object-shaped — no positional parameters anywhere.

/** Which activation path the user chose for the AI tutor. */
export type AiProviderType =
  | 'gemini_byok'
  | 'openrouter_byok'
  | 'local_model'
  | 'custom';

/** Where a user-provided API key is kept. MVP only ever uses "local_device". */
export type ApiKeyStorage = 'local_device' | 'backend_encrypted' | 'none';

/**
 * A complete, persistable provider configuration. `apiKey` is only present for
 * BYOK/custom types and is stored on-device only (never sent to our backend).
 */
export type AiProviderConfig = {
  type: AiProviderType;
  displayName: string;
  enabled: boolean;
  /** Underlying model id, e.g. "gemini-2.5-flash-lite". */
  model?: string;
  apiKeyStorage?: ApiKeyStorage;
  /** User-provided key. Local-device only for MVP. */
  apiKey?: string;
  /** Base URL for OpenRouter/custom OpenAI-compatible endpoints. */
  baseUrl?: string;
};
