// ── Model Provider — Custom (advanced BYOK) ──────────────────────────
//
// Escape hatch for providers we haven't wired up explicitly. Defaults to the
// OpenAI-compatible chat/completions dialect (the most common shape), so a user
// can point it at Groq, a local server, a company gateway, etc. Kept minimal on
// purpose — the value is that the architecture stays open, not that this covers
// every dialect.

import type { ModelProvider } from './model-provider.types';
import type { AiLimits } from './limits';
import {
  createOpenAiCompatibleProvider,
  validateOpenAiCompatibleKey,
} from './openai-compatible.provider';

/** Request formats we know how to speak. Room to grow without breaking callers. */
export type CustomRequestFormat = 'openai_chat';

export function createCustomProvider(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  displayName?: string;
  requestFormat?: CustomRequestFormat;
  limits?: AiLimits;
}): ModelProvider {
  // Only openai_chat is supported today; the field exists so more can be added.
  return createOpenAiCompatibleProvider({
    name: params.displayName ?? 'custom',
    providerType: 'custom',
    baseUrl: params.baseUrl,
    apiKey: params.apiKey,
    model: params.model,
    limits: params.limits,
  });
}

export function validateCustomKey(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  return validateOpenAiCompatibleKey({
    providerType: 'custom',
    baseUrl: params.baseUrl,
    apiKey: params.apiKey,
    model: params.model,
  });
}
