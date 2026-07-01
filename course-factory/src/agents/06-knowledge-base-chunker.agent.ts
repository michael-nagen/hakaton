// ── Agent 06 — KnowledgeBase Chunker ─────────────────────────────────

import { runStep } from '../harness/run-step';
import { withSharedPrinciples } from '../prompts/shared-principles.prompt';
import { SYSTEM, buildUserPrompt } from '../prompts/knowledge-base-chunker.prompt';
import type { ModelClient } from '../llm/model-provider.types';
import type { ArtifactStore } from '../harness/artifact-store';

export function runKnowledgeBaseChunkerAgent(params: {
  client: ModelClient;
  store: ArtifactStore;
  finalUnitPlan: unknown;
  lessonDesigns: unknown;
}): Promise<unknown> {
  return runStep({
    client: params.client,
    store: params.store,
    purpose: '06-knowledge-base-chunker',
    artifactName: '06-knowledge-base-chunks.json',
    system: withSharedPrinciples(SYSTEM),
    prompt: buildUserPrompt({ finalUnitPlan: params.finalUnitPlan, lessonDesigns: params.lessonDesigns }),
  });
}
