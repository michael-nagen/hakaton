// ── Agent 09 — Course Packager ───────────────────────────────────────

import { runStep } from '../harness/run-step';
import { withSharedPrinciples } from '../prompts/shared-principles.prompt';
import { SYSTEM, buildUserPrompt } from '../prompts/course-packager.prompt';
import type { ModelClient } from '../llm/model-provider.types';
import type { ArtifactStore } from '../harness/artifact-store';

export function runCoursePackagerAgent(params: {
  client: ModelClient;
  store: ArtifactStore;
  finalUnitPlan: unknown;
  teacherBrains: unknown;
  knowledgeBaseChunks: unknown;
  exercisesAndHints: unknown;
  readinessReview: unknown;
}): Promise<unknown> {
  return runStep({
    client: params.client,
    store: params.store,
    purpose: '09-course-packager',
    artifactName: '09-course-package.draft.json',
    system: withSharedPrinciples(SYSTEM),
    prompt: buildUserPrompt({
      finalUnitPlan: params.finalUnitPlan,
      teacherBrains: params.teacherBrains,
      knowledgeBaseChunks: params.knowledgeBaseChunks,
      exercisesAndHints: params.exercisesAndHints,
      readinessReview: params.readinessReview,
    }),
  });
}
