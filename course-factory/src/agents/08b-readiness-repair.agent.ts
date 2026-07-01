// ── Agent 08b — Readiness (pedagogy) Repair ──────────────────────────
//
// Separate from Agent 10 (ValidatorRepair): 08b fixes PEDAGOGY/quality so the
// readiness gate can pass; 10 fixes JSON/schema. The readiness loop lives in
// harness/run-course-factory.ts.

import { runStep } from '../harness/run-step';
import { withSharedPrinciples } from '../prompts/shared-principles.prompt';
import { SYSTEM, buildUserPrompt } from '../prompts/readiness-repair.prompt';
import type { ModelClient } from '../llm/model-provider.types';
import type { ArtifactStore } from '../harness/artifact-store';

export function runReadinessRepairAgent(params: {
  client: ModelClient;
  store: ArtifactStore;
  finalUnitPlan: unknown;
  lessonDesigns: unknown;
  teacherBrains: unknown;
  knowledgeBaseChunks: unknown;
  exercisesAndHints: unknown;
  readinessReview: unknown;
  /** Deterministic structure violations (too many Q/chunks, over 10 min). */
  structureIssues: string[];
  /** File name for this repair attempt's artifact. */
  artifactName: string;
}): Promise<unknown> {
  return runStep({
    client: params.client,
    store: params.store,
    purpose: '08b-readiness-repair',
    artifactName: params.artifactName,
    system: withSharedPrinciples(SYSTEM),
    prompt: buildUserPrompt({
      finalUnitPlan: params.finalUnitPlan,
      lessonDesigns: params.lessonDesigns,
      teacherBrains: params.teacherBrains,
      knowledgeBaseChunks: params.knowledgeBaseChunks,
      exercisesAndHints: params.exercisesAndHints,
      readinessReview: params.readinessReview,
      structureIssues: params.structureIssues,
    }),
  });
}
