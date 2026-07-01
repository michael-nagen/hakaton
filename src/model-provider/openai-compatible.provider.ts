// ── Model Provider — OpenAI-compatible base ──────────────────────────
//
// Both OpenRouter and the advanced "custom" provider speak the OpenAI
// chat/completions dialect, so the transport lives here once. Callers supply a
// base URL, key, model, and any extra headers. The key rides in the
// Authorization header and is never logged or placed in error messages.

import type { GenerateTextArgs, ModelProvider } from './model-provider.types';
import {
  assertWithinRateLimits,
  DEFAULT_AI_LIMITS,
  fetchWithTimeout,
  type AiLimits,
} from './limits';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

function toMessages(args: GenerateTextArgs) {
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (args.system) messages.push({ role: 'system', content: args.system });
  messages.push({ role: 'user', content: args.prompt });
  return messages;
}

async function safeErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as ChatCompletionResponse;
    return data.error?.message ? `Provider says: ${data.error.message}` : '';
  } catch {
    return '';
  }
}

async function callChatCompletions(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  args: GenerateTextArgs;
  providerType: string;
  extraHeaders?: Record<string, string>;
  limits: AiLimits;
}): Promise<string> {
  const { baseUrl, apiKey, model, args, providerType, extraHeaders, limits } = params;
  assertWithinRateLimits({ providerType, limits });

  const res = await fetchWithTimeout({
    url: `${baseUrl.replace(/\/$/, '')}/chat/completions`,
    timeoutMs: limits.timeoutMs,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify({
        model,
        messages: toMessages(args),
        max_tokens: limits.maxTokensPerRequest,
      }),
    },
  });

  if (!res.ok) {
    const detail = await safeErrorMessage(res);
    throw new Error(`${providerType} request failed (${res.status}). ${detail}`);
  }

  const data = (await res.json()) as ChatCompletionResponse;
  const text = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!text) throw new Error('Provider returned an empty response.');
  return text;
}

/** Build a ModelProvider that talks the OpenAI chat/completions dialect. */
export function createOpenAiCompatibleProvider(params: {
  name: string;
  providerType: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  extraHeaders?: Record<string, string>;
  limits?: AiLimits;
}): ModelProvider {
  const limits = params.limits ?? DEFAULT_AI_LIMITS;
  return {
    name: params.name,
    modelName: params.model,
    generateText: (args) =>
      callChatCompletions({
        baseUrl: params.baseUrl,
        apiKey: params.apiKey,
        model: params.model,
        args,
        providerType: params.providerType,
        extraHeaders: params.extraHeaders,
        limits,
      }),
  };
}

/**
 * Validate a key against an OpenAI-compatible endpoint with a 1-token probe.
 * Returns a discriminated result; never includes the key in the message.
 */
export async function validateOpenAiCompatibleKey(params: {
  providerType: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  extraHeaders?: Record<string, string>;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await callChatCompletions({
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      model: params.model,
      args: { prompt: 'ping' },
      providerType: params.providerType,
      extraHeaders: params.extraHeaders,
      limits: { ...DEFAULT_AI_LIMITS, maxTokensPerRequest: 8 },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Validation failed.' };
  }
}
