// ── Agent 03 — Unit Splitter ─────────────────────────────────────────

import { runStep } from '../harness/run-step';
import { withSharedPrinciples } from '../prompts/shared-principles.prompt';
import { SYSTEM, buildUserPrompt } from '../prompts/unit-splitter.prompt';
import type { ModelClient } from '../llm/model-provider.types';
import type { ArtifactStore } from '../harness/artifact-store';

export function runUnitSplitterAgent(params: {
  client: ModelClient;
  store: ArtifactStore;
  normalizedInput: unknown;
  outcomeMap: unknown;
}): Promise<unknown> {
  return runStep({
    client: params.client,
    store: params.store,
    purpose: '03-unit-splitter',
    artifactName: '03-final-unit-plan.json',
    system: withSharedPrinciples(SYSTEM),
    prompt: buildUserPrompt({ normalizedInput: params.normalizedInput, outcomeMap: params.outcomeMap }),
  });
}
