// ── Model Provider — registry ────────────────────────────────────────
//
// Lists the providers that can be used WITHOUT per-user configuration — today
// just the built-in (mock) provider. BYOK/custom providers are not registered
// here: they need a user key/URL and are built on demand from an
// AiProviderConfig via `createModelProviderFromConfig`. The AI setup screen owns
// their option metadata (labels + copy). This keeps the seam clean: config in,
// ModelProvider out, no caller changes when a new provider is added.

import { mockModelProvider } from './mock-model.provider';
import type { ModelProviderOption } from './model-provider.types';

const PROVIDER_OPTIONS: readonly ModelProviderOption[] = [
  { id: 'built_in', label: 'Built-in AI (offline demo)', provider: mockModelProvider },
];

/** All selectable model providers, in display order. */
export function getModelProviders(): readonly ModelProviderOption[] {
  return PROVIDER_OPTIONS;
}

/** Look up a provider option by id. Returns undefined if not registered. */
export function getModelProviderById(params: { id: string }): ModelProviderOption | undefined {
  return PROVIDER_OPTIONS.find((option) => option.id === params.id);
}
