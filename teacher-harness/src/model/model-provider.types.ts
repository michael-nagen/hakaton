// ── Teacher Harness — model provider types ───────────────────────────
//
// The harness speaks to models through the SAME narrow seam the main app uses
// (`ModelProvider` from src/model-provider). We re-export it so harness code
// has one import site, and add the harness-side selection/config types.

import type { ModelProvider } from '../../../src/model-provider/model-provider.types';

export type { ModelProvider, GenerateTextArgs } from '../../../src/model-provider/model-provider.types';

/** Provider modes supported by the harness. Intentionally minimal for MVP. */
export type ProviderMode = 'mock' | 'openai-compatible';

/** Resolved provider configuration (from .env + scenario + CLI). */
export interface ProviderConfig {
  mode: ProviderMode;
  /** Model id for the openai-compatible mode. */
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

/** A provider plus the label we record in reports. */
export interface ResolvedProvider {
  provider: ModelProvider;
  mode: ProviderMode;
  /** Model name recorded in the report ("mock" for the offline mock). */
  modelName: string;
}
