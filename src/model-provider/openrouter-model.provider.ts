// ── Model Provider — OpenRouter (user BYOK) ──────────────────────────
//
// OpenRouter is OpenAI-compatible, so this is a thin wrapper over the shared
// chat/completions transport with OpenRouter's recommended headers. The default
// free model is configurable (env), because OpenRouter's free slugs change.

import type { ModelProvider } from './model-provider.types';
import type { AiLimits } from './limits';
import {
  createOpenAiCompatibleProvider,
  validateOpenAiCompatibleKey,
} from './openai-compatible.provider';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Default free model. OpenRouter's free ":free" slugs rotate over time, so this
 * is configurable via VITE_FREE_OPENROUTER_MODEL rather than hardcoded forever.
 */
export const DEFAULT_OPENROUTER_FREE_MODEL =
  import.meta.env.VITE_FREE_OPENROUTER_MODEL ?? 'openrouter/free';

// OpenRouter uses these for attribution/ranking. Safe, non-secret headers.
function openRouterHeaders(): Record<string, string> {
  const referer =
    typeof window !== 'undefined' && window.location ? window.location.origin : 'https://localhost';
  return { 'HTTP-Referer': referer, 'X-Title': 'Maestro Tutor' };
}

export function createOpenRouterProvider(params: {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  limits?: AiLimits;
}): ModelProvider {
  return createOpenAiCompatibleProvider({
    name: 'openrouter',
    providerType: 'openrouter_byok',
    baseUrl: params.baseUrl ?? OPENROUTER_BASE_URL,
    apiKey: params.apiKey,
    model: params.model ?? DEFAULT_OPENROUTER_FREE_MODEL,
    extraHeaders: openRouterHeaders(),
    limits: params.limits,
  });
}

export function validateOpenRouterKey(params: {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  return validateOpenAiCompatibleKey({
    providerType: 'openrouter_byok',
    baseUrl: params.baseUrl ?? OPENROUTER_BASE_URL,
    apiKey: params.apiKey,
    model: params.model ?? DEFAULT_OPENROUTER_FREE_MODEL,
    extraHeaders: openRouterHeaders(),
  });
}
