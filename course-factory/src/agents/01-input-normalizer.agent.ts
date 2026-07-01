// ── Agent 01 — Input Normalizer ──────────────────────────────────────

import { runStep } from '../harness/run-step';
import { withSharedPrinciples } from '../prompts/shared-principles.prompt';
import { SYSTEM, buildUserPrompt } from '../prompts/input-normalizer.prompt';
import type { ModelClient } from '../llm/model-provider.types';
import type { ArtifactStore } from '../harness/artifact-store';

export function runInputNormalizerAgent(params: {
  client: ModelClient;
  store: ArtifactStore;
  input: { brief: string; rawUnits: string; sourceMaterials: string };
}): Promise<unknown> {
  return runStep({
    client: params.client,
    store: params.store,
    purpose: '01-input-normalizer',
    artifactName: '01-normalized-input.json',
    system: withSharedPrinciples(SYSTEM),
    prompt: buildUserPrompt(params.input),
  });
}
