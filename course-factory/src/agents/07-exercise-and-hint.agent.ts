// ── Agent 07 — Exercise & Hint ───────────────────────────────────────

import { runStep } from '../harness/run-step';
import { withSharedPrinciples } from '../prompts/shared-principles.prompt';
import { SYSTEM, buildUserPrompt } from '../prompts/exercise-and-hint.prompt';
import type { ModelClient } from '../llm/model-provider.types';
import type { ArtifactStore } from '../harness/artifact-store';

export function runExerciseAndHintAgent(params: {
  client: ModelClient;
  store: ArtifactStore;
  finalUnitPlan: unknown;
  lessonDesigns: unknown;
}): Promise<unknown> {
  return runStep({
    client: params.client,
    store: params.store,
    purpose: '07-exercise-and-hint',
    artifactName: '07-exercises-and-hints.json',
    system: withSharedPrinciples(SYSTEM),
    prompt: buildUserPrompt({ finalUnitPlan: params.finalUnitPlan, lessonDesigns: params.lessonDesigns }),
  });
}
