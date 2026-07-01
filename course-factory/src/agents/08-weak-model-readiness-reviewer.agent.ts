// ── Agent 08 — Weak-Model Readiness Reviewer ─────────────────────────

import { runStep } from '../harness/run-step';
import { withSharedPrinciples } from '../prompts/shared-principles.prompt';
import { SYSTEM, buildUserPrompt } from '../prompts/weak-model-readiness-reviewer.prompt';
import type { ModelClient } from '../llm/model-provider.types';
import type { ArtifactStore } from '../harness/artifact-store';

export function runWeakModelReadinessReviewerAgent(params: {
  client: ModelClient;
  store: ArtifactStore;
  finalUnitPlan: unknown;
  teacherBrains: unknown;
  knowledgeBaseChunks: unknown;
  exercisesAndHints: unknown;
  /** Override the artifact file name (e.g. per re-review attempt). */
  artifactName?: string;
}): Promise<unknown> {
  return runStep({
    client: params.client,
    store: params.store,
    purpose: '08-weak-model-readiness-reviewer',
    artifactName: params.artifactName ?? '08-weak-model-readiness-review.json',
    system: withSharedPrinciples(SYSTEM),
    prompt: buildUserPrompt({
      finalUnitPlan: params.finalUnitPlan,
      teacherBrains: params.teacherBrains,
      knowledgeBaseChunks: params.knowledgeBaseChunks,
      exercisesAndHints: params.exercisesAndHints,
    }),
  });
}
