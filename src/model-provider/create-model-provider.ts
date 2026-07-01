// ── Model Provider — config → transport factory ──────────────────────
//
// The single place that turns a persisted AiProviderConfig into a live
// ModelProvider. Everything upstream (config store, setup screen) deals only in
// config objects; everything downstream (tutor layer) deals only in the
// ModelProvider seam. Adding a provider = one new case here + its transport.

import type { AiProviderConfig } from './ai-provider-config.types';
import type { ModelProvider } from './model-provider.types';
import { mockModelProvider } from './mock-model.provider';
import { createGeminiProvider, DEFAULT_GEMINI_MODEL } from './gemini-model.provider';
import { createOpenRouterProvider, DEFAULT_OPENROUTER_FREE_MODEL } from './openrouter-model.provider';
import { createLocalModelProvider } from './local-model.provider';
import { createCustomProvider } from './custom-model.provider';

/**
 * Build a ModelProvider from config. Throws a clear error when a BYOK/custom
 * config is missing its key/URL, so the UI can prompt for setup rather than
 * failing deep in a request. Never logs or echoes the key.
 */
export function createModelProviderFromConfig(params: { config: AiProviderConfig }): ModelProvider {
  const { config } = params;
  switch (config.type) {
    case 'built_in':
      // Mock stands in for our own backend until a real built-in plan exists.
      return mockModelProvider;

    case 'gemini_byok': {
      if (!config.apiKey) throw new Error('Gemini provider selected but no API key is configured.');
      return createGeminiProvider({ apiKey: config.apiKey, model: config.model ?? DEFAULT_GEMINI_MODEL });
    }

    case 'openrouter_byok': {
      if (!config.apiKey) throw new Error('OpenRouter provider selected but no API key is configured.');
      return createOpenRouterProvider({
        apiKey: config.apiKey,
        model: config.model ?? DEFAULT_OPENROUTER_FREE_MODEL,
        baseUrl: config.baseUrl,
      });
    }

    case 'local_model':
      return createLocalModelProvider({ modelId: config.model });

    case 'custom': {
      if (!config.baseUrl) throw new Error('Custom provider selected but no base URL is configured.');
      if (!config.model) throw new Error('Custom provider selected but no model name is configured.');
      return createCustomProvider({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey ?? '',
        model: config.model,
        displayName: config.displayName,
      });
    }
  }
}
