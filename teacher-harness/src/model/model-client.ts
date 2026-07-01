// ── Teacher Harness — model client / provider factory ────────────────
//
// Resolves a ProviderConfig into a concrete ModelProvider. Two modes:
//   • mock              — offline, deterministic (default; proves mechanics)
//   • openai-compatible — a small, self-contained fetch client
//
// We deliberately DO NOT reuse the main app's openai-compatible provider here:
// that module pulls in browser-only rate-limit state (localStorage), which does
// not belong in a Node CLI. Keeping a tiny client here honours the one-way
// dependency rule and avoids dragging browser concerns into the harness.

import type { GenerateTextArgs, ModelProvider, ProviderConfig, ResolvedProvider } from './model-provider.types';
import { createMockTeacherProvider } from './mock-teacher-provider';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TOKENS = 800;

/** Minimal OpenAI-compatible chat client. The key is never logged. */
function createOpenAiCompatibleProvider(params: {
  model: string;
  apiKey: string;
  baseUrl: string;
}): ModelProvider {
  const baseUrl = params.baseUrl.replace(/\/$/, '');
  return {
    name: 'openai-compatible',
    modelName: params.model,
    async generateText(args: GenerateTextArgs): Promise<string> {
      const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
      if (args.system) messages.push({ role: 'system', content: args.system });
      messages.push({ role: 'user', content: args.prompt });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${params.apiKey}`,
          },
          body: JSON.stringify({ model: params.model, messages, max_tokens: MAX_TOKENS }),
          signal: controller.signal,
        });

        if (!res.ok) {
          let detail = '';
          try {
            const data = (await res.json()) as ChatCompletionResponse;
            if (data.error?.message) detail = ` Provider says: ${data.error.message}`;
          } catch {
            /* ignore body parse errors */
          }
          throw new Error(`openai-compatible request failed (${res.status}).${detail}`);
        }

        const data = (await res.json()) as ChatCompletionResponse;
        const text = data.choices?.[0]?.message?.content?.trim() ?? '';
        if (!text) throw new Error('Provider returned an empty response.');
        return text;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Build the provider described by `config`, validating required fields. */
export function resolveProvider(config: ProviderConfig): ResolvedProvider {
  if (config.mode === 'mock') {
    return { provider: createMockTeacherProvider(), mode: 'mock', modelName: 'mock' };
  }

  // openai-compatible
  const missing: string[] = [];
  if (!config.model) missing.push('TEACHER_HARNESS_MODEL');
  if (!config.apiKey) missing.push('TEACHER_HARNESS_API_KEY');
  if (!config.baseUrl) missing.push('TEACHER_HARNESS_BASE_URL');
  if (missing.length > 0) {
    throw new Error(
      `openai-compatible provider needs: ${missing.join(', ')}. Set them in teacher-harness/.env or use --mock.`,
    );
  }

  const provider = createOpenAiCompatibleProvider({
    model: config.model as string,
    apiKey: config.apiKey as string,
    baseUrl: config.baseUrl as string,
  });
  return { provider, mode: 'openai-compatible', modelName: config.model as string };
}
