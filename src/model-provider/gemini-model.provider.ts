// ── Model Provider — Gemini (user BYOK) ──────────────────────────────
//
// Implements the existing ModelProvider seam by calling Google's Generative
// Language API with a user-provided key. The key travels in the `x-goog-api-key`
// header (never in the URL, so it can't leak into referrers/logs) and is never
// logged or echoed in error messages.

import type { GenerateTextArgs, ModelProvider } from './model-provider.types';
import {
  assertWithinRateLimits,
  DEFAULT_AI_LIMITS,
  fetchWithTimeout,
  type AiLimits,
} from './limits';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Cheap/free-friendly default; UI may switch to flash or pro. */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';

/** Models the setup screen offers, cheapest first. */
export const GEMINI_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
] as const;

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  error?: { message?: string };
}

function extractText(data: GeminiResponse): string {
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? '').join('').trim();
}

async function callGemini(params: {
  apiKey: string;
  model: string;
  args: GenerateTextArgs;
  limits: AiLimits;
  maxOutputTokens: number;
}): Promise<string> {
  const { apiKey, model, args, limits, maxOutputTokens } = params;
  assertWithinRateLimits({ providerType: 'gemini_byok', limits });

  const body = {
    ...(args.system ? { system_instruction: { parts: [{ text: args.system }] } } : {}),
    contents: [{ role: 'user', parts: [{ text: args.prompt }] }],
    generationConfig: { maxOutputTokens },
  };

  const res = await fetchWithTimeout({
    url: `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`,
    timeoutMs: limits.timeoutMs,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    },
  });

  if (!res.ok) {
    // Surface status only — never the key or raw headers.
    const detail = await safeErrorMessage(res);
    throw new Error(`Gemini request failed (${res.status}). ${detail}`);
  }

  const data = (await res.json()) as GeminiResponse;
  const text = extractText(data);
  if (!text) throw new Error('Gemini returned an empty response.');
  return text;
}

/** Read a provider error message without leaking secrets; best-effort. */
async function safeErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as GeminiResponse;
    return data.error?.message ? `Provider says: ${data.error.message}` : '';
  } catch {
    return '';
  }
}

/** Create a Gemini-backed ModelProvider from a user key. */
export function createGeminiProvider(params: {
  apiKey: string;
  model?: string;
  limits?: AiLimits;
}): ModelProvider {
  const model = params.model ?? DEFAULT_GEMINI_MODEL;
  const limits = params.limits ?? DEFAULT_AI_LIMITS;
  return {
    name: 'gemini',
    modelName: model,
    generateText: (args) =>
      callGemini({ apiKey: params.apiKey, model, args, limits, maxOutputTokens: limits.maxTokensPerRequest }),
  };
}

/**
 * Validate a user's Gemini key with a tiny probe request. Returns a discriminated
 * result rather than throwing, so the UI can render idle/valid/invalid cleanly.
 * The key is never included in the returned message.
 */
export async function validateGeminiKey(params: {
  apiKey: string;
  model?: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const model = params.model ?? DEFAULT_GEMINI_MODEL;
  try {
    await callGemini({
      apiKey: params.apiKey,
      model,
      args: { prompt: 'ping' },
      limits: DEFAULT_AI_LIMITS,
      maxOutputTokens: 8,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Validation failed.' };
  }
}
