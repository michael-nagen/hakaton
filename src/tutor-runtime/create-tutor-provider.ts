// ── Tutor Runtime — generic TutorProvider ────────────────────────────
//
// ONE implementation of TutorProvider, parameterized by a ModelProvider
// transport. It renders the prompt, calls generateText, and normalizes the
// reply into a TutorResponse with JSON repair + one stricter retry + a safe
// fallback. All named providers (Gemini/OpenRouter/Local/Custom/Built-in) are
// just this wired to a different transport — so lesson logic never changes when
// the provider changes.

import type { AiProviderConfig, ModelProvider } from '../model-provider';
import {
  createModelProviderFromConfig,
  createGeminiProvider,
  createOpenRouterProvider,
  createLocalModelProvider,
  createCustomProvider,
  mockModelProvider,
} from '../model-provider';
import {
  buildTutorResponseSystemPrompt,
  buildTutorResponseUserPrompt,
} from './build-tutor-response-prompt';
import { fallbackTutorResponse, tryParseTutorResponse } from './parse-tutor-response';
import type { TutorInput, TutorProvider, TutorResponse } from './tutor-provider.types';

const STRICTER_RETRY_SUFFIX =
  '\n\nIMPORTANT: Your previous reply was not valid JSON. Reply with ONLY the JSON object described above — no prose, no markdown, no code fences.';

/**
 * Build a TutorProvider over any ModelProvider. The transport can throw (bad
 * key, timeout, local-not-ready); we let those propagate so the UI can show a
 * real error — but a *malformed* answer never crashes the lesson, it falls back.
 */
export function createTutorProvider(params: { modelProvider: ModelProvider }): TutorProvider {
  const { modelProvider } = params;

  return {
    async generateTutorResponse(input: TutorInput): Promise<TutorResponse> {
      const system = buildTutorResponseSystemPrompt(input);
      const userPrompt = buildTutorResponseUserPrompt(input);

      const first = await modelProvider.generateText({ prompt: userPrompt, system });
      const parsed = tryParseTutorResponse(first);
      if (parsed) return parsed;

      // Retry once with a stricter instruction before giving up.
      const second = await modelProvider.generateText({
        prompt: userPrompt,
        system: system + STRICTER_RETRY_SUFFIX,
      });
      const reparsed = tryParseTutorResponse(second);
      if (reparsed) return reparsed;

      // Still unusable — never crash the lesson.
      return fallbackTutorResponse();
    },
  };
}

/** Build a TutorProvider straight from a persisted config (config → transport → tutor). */
export function createTutorProviderFromConfig(params: { config: AiProviderConfig }): TutorProvider {
  return createTutorProvider({ modelProvider: createModelProviderFromConfig({ config: params.config }) });
}

// ── Named factories (spec fidelity) ──────────────────────────────────
// Thin wrappers so provider intent reads clearly at call sites. Each is the
// generic tutor provider over the matching transport.

export function createBuiltInTutorProvider(): TutorProvider {
  return createTutorProvider({ modelProvider: mockModelProvider });
}

export function createGeminiTutorProvider(params: { apiKey: string; model?: string }): TutorProvider {
  return createTutorProvider({ modelProvider: createGeminiProvider(params) });
}

export function createOpenRouterTutorProvider(params: {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}): TutorProvider {
  return createTutorProvider({ modelProvider: createOpenRouterProvider(params) });
}

export function createLocalModelTutorProvider(params: { modelId?: string }): TutorProvider {
  return createTutorProvider({ modelProvider: createLocalModelProvider(params) });
}

export function createCustomTutorProvider(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  displayName?: string;
}): TutorProvider {
  return createTutorProvider({ modelProvider: createCustomProvider(params) });
}
