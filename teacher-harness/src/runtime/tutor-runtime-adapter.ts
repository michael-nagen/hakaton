// ── Teacher Harness — Tutor Runtime adapter ──────────────────────────
//
// The ONLY bridge between the harness and the main-app Tutor Runtime. It reuses
// the app's real `buildTutorContext` and `buildTutorPrompt` (so the harness
// tests the exact context/prompt the product ships) and calls the chosen
// provider. It differs from the app's own `runTutorTurn` only in that it also
// returns the full TutorContext, which the harness needs for scoring and
// artifacts. No teaching behaviour is added here.

import { buildTutorContext } from '../../../src/tutor-runtime/build-tutor-context';
import { buildTutorPrompt } from '../../../src/tutor-runtime/build-tutor-prompt';
import type { FreedomMode, ProgressState, TutorContext } from '../../../src/tutor-runtime/tutor-runtime.types';
import type { CoursePackage } from '../../../src/course-package/course-package.types';
import type { ModelProvider } from '../model/model-provider.types';
import { renderWorkingMemoryForPrompt } from './lesson-memory';
import type { LessonWorkingMemory } from './lesson-memory.types';

export interface AdaptedTurnParams {
  coursePackage: CoursePackage;
  unitId: string;
  userMessage: string;
  provider: ModelProvider;
  freedomMode?: FreedomMode;
  progress?: ProgressState;
  maxChunks?: number;
  /**
   * The compact lesson working memory to inject. This is the ONLY memory the
   * model receives — never the full archive. Omit for a memoryless turn.
   */
  workingMemory?: LessonWorkingMemory;
}

export interface AdaptedTurnResult {
  /** Full minimal context (KB chunks, mistakes, questions) — for scoring. */
  context: TutorContext;
  systemPrompt: string;
  userPrompt: string;
  /** The raw model answer. */
  answer: string;
  latencyMs: number;
  provider: string;
  modelName: string | null;
  kbChunkIds: string[];
}

/** Run one turn through the real runtime context/prompt path + the provider. */
export async function runAdaptedTutorTurn(params: AdaptedTurnParams): Promise<AdaptedTurnResult> {
  const { coursePackage, unitId, userMessage, provider, freedomMode, progress, maxChunks, workingMemory } = params;

  const context = buildTutorContext({ coursePackage, unitId, userMessage, freedomMode, progress, maxChunks });
  const prompt = buildTutorPrompt({ context });

  // The app's runtime builds the unit context/prompt untouched; the harness
  // then appends its own lesson working memory to the SYSTEM prompt. The learner
  // message stays the user turn. This is where "only the compact memory reaches
  // the model" is enforced — the full archive is never sent.
  const systemPrompt = workingMemory
    ? `${prompt.systemPrompt}\n\n${renderWorkingMemoryForPrompt(workingMemory)}`
    : prompt.systemPrompt;

  const start = Date.now();
  const answer = await provider.generateText({
    prompt: prompt.userPrompt,
    system: systemPrompt,
  });
  const latencyMs = Date.now() - start;

  return {
    context,
    systemPrompt,
    userPrompt: prompt.userPrompt,
    answer,
    latencyMs,
    provider: provider.name,
    modelName: provider.modelName ?? null,
    kbChunkIds: context.relevantChunks.map((chunk) => chunk.id),
  };
}
