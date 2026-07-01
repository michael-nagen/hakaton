// ── Agent 05 — TeacherBrain ──────────────────────────────────────────

import { runStep } from '../harness/run-step';
import { withSharedPrinciples } from '../prompts/shared-principles.prompt';
import { SYSTEM, buildUserPrompt } from '../prompts/teacher-brain.prompt';
import type { ModelClient } from '../llm/model-provider.types';
import type { ArtifactStore } from '../harness/artifact-store';

export function runTeacherBrainAgent(params: {
  client: ModelClient;
  store: ArtifactStore;
  finalUnitPlan: unknown;
  lessonDesigns: unknown;
}): Promise<unknown> {
  return runStep({
    client: params.client,
    store: params.store,
    purpose: '05-teacher-brain',
    artifactName: '05-teacher-brains.json',
    system: withSharedPrinciples(SYSTEM),
    prompt: buildUserPrompt({ finalUnitPlan: params.finalUnitPlan, lessonDesigns: params.lessonDesigns }),
  });
}
