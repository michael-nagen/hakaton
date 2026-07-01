// ── Agent 04 — Lesson Designer ───────────────────────────────────────

import { runStep } from '../harness/run-step';
import { withSharedPrinciples } from '../prompts/shared-principles.prompt';
import { SYSTEM, buildUserPrompt } from '../prompts/lesson-designer.prompt';
import type { ModelClient } from '../llm/model-provider.types';
import type { ArtifactStore } from '../harness/artifact-store';

export function runLessonDesignerAgent(params: {
  client: ModelClient;
  store: ArtifactStore;
  finalUnitPlan: unknown;
}): Promise<unknown> {
  return runStep({
    client: params.client,
    store: params.store,
    purpose: '04-lesson-designer',
    artifactName: '04-lesson-designs.json',
    system: withSharedPrinciples(SYSTEM),
    prompt: buildUserPrompt({ finalUnitPlan: params.finalUnitPlan }),
  });
}
