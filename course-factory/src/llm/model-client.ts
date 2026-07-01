// ── Model client — provider abstraction ──────────────────────────────
//
// Builds a ModelClient for the configured provider. Only this file knows
// provider-specific request/response shapes. Uses the built-in global
// `fetch` (Node 18+), no HTTP dependency.

import type { FactoryConfig } from '../config/factory-config';
import type { CompleteArgs, CompleteResult, ModelClient } from './model-provider.types';
import { getMockCompletion } from './mock-fixtures';

/** Factory: pick a client based on config. */
export function createModelClient(config: FactoryConfig): ModelClient {
  switch (config.provider) {
    case 'mock':
      return new MockModelClient();
    case 'openai':
      return new OpenAiCompatibleClient(config);
    case 'anthropic':
      return new AnthropicClient(config);
    default:
      // Exhaustive — config loader already rejects unknown providers.
      throw new Error(`Unsupported provider: ${config.provider as string}`);
  }
}

// ── Mock ──────────────────────────────────────────────────────────────

class MockModelClient implements ModelClient {
  readonly providerId = 'mock';
  readonly modelName = 'mock-fixture';

  async complete(args: CompleteArgs): Promise<CompleteResult> {
    const start = Date.now();
    const text = getMockCompletion(args.purpose);
    return { text, latencyMs: Date.now() - start, modelName: this.modelName };
  }
}

// ── OpenAI-compatible ─────────────────────────────────────────────────

class OpenAiCompatibleClient implements ModelClient {
  readonly providerId = 'openai';
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: FactoryConfig) {
    if (!config.apiKey) throw new Error('COURSE_FACTORY_API_KEY is required for provider "openai".');
    if (!config.model) throw new Error('COURSE_FACTORY_MODEL is required for provider "openai".');
    this.apiKey = config.apiKey;
    this.modelName = config.model;
    this.baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  async complete(args: CompleteArgs): Promise<CompleteResult> {
    const start = Date.now();
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelName,
        temperature: 0.2,
        messages: [
          { role: 'system', content: args.system },
          { role: 'user', content: args.prompt },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenAI-compatible API error ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content ?? '';
    if (!text) throw new Error('OpenAI-compatible API returned an empty completion.');
    return { text, latencyMs: Date.now() - start, modelName: this.modelName };
  }
}

// ── Anthropic ─────────────────────────────────────────────────────────

class AnthropicClient implements ModelClient {
  readonly providerId = 'anthropic';
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: FactoryConfig) {
    if (!config.apiKey) throw new Error('COURSE_FACTORY_API_KEY is required for provider "anthropic".');
    if (!config.model) throw new Error('COURSE_FACTORY_MODEL is required for provider "anthropic".');
    this.apiKey = config.apiKey;
    this.modelName = config.model;
    this.baseUrl = (config.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  }

  async complete(args: CompleteArgs): Promise<CompleteResult> {
    const start = Date.now();
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.modelName,
        max_tokens: 8192,
        temperature: 0.2,
        system: args.system,
        messages: [{ role: 'user', content: args.prompt }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Anthropic API error ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
    }
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (data.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
    if (!text) throw new Error('Anthropic API returned an empty completion.');
    return { text, latencyMs: Date.now() - start, modelName: this.modelName };
  }
}
