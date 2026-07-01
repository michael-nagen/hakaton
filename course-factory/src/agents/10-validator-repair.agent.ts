// ── Agent 10 — Validator Repair (single repair call) ─────────────────
//
// One repair model call: takes a failing draft + validator errors, returns a
// corrected CoursePackage. The validate→repair→revalidate LOOP lives in
// harness/run-course-factory.ts (repairUntilValid), which owns artifact naming
// and the attempt cap; both `generate` and `repair` reuse it.

import { runStep } from '../harness/run-step';
import { withSharedPrinciples } from '../prompts/shared-principles.prompt';
import { SYSTEM, buildUserPrompt } from '../prompts/validator-repair.prompt';
import type { ModelClient } from '../llm/model-provider.types';
import type { ArtifactStore } from '../harness/artifact-store';

export function runValidatorRepairAgent(params: {
  client: ModelClient;
  store: ArtifactStore;
  draft: unknown;
  errors: string[];
  /** File name for this repair attempt's artifact. */
  artifactName: string;
}): Promise<unknown> {
  return runStep({
    client: params.client,
    store: params.store,
    purpose: '10-validator-repair',
    artifactName: params.artifactName,
    system: withSharedPrinciples(SYSTEM),
    prompt: buildUserPrompt({ draft: params.draft, errors: params.errors }),
  });
}
