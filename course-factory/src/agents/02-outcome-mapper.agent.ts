// ── Agent 02 — Outcome Mapper ────────────────────────────────────────

import { runStep } from '../harness/run-step';
import { withSharedPrinciples } from '../prompts/shared-principles.prompt';
import { SYSTEM, buildUserPrompt } from '../prompts/outcome-mapper.prompt';
import type { ModelClient } from '../llm/model-provider.types';
import type { ArtifactStore } from '../harness/artifact-store';

export function runOutcomeMapperAgent(params: {
  client: ModelClient;
  store: ArtifactStore;
  normalizedInput: unknown;
}): Promise<unknown> {
  return runStep({
    client: params.client,
    store: params.store,
    purpose: '02-outcome-mapper',
    artifactName: '02-outcome-map.json',
    system: withSharedPrinciples(SYSTEM),
    prompt: buildUserPrompt({ normalizedInput: params.normalizedInput }),
  });
}
