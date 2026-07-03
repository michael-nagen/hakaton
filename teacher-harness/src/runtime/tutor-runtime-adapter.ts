// ── Teacher Harness — Tutor Runtime adapter ──────────────────────────
//
// The ONLY bridge between the harness and the main-app Tutor Runtime. It reuses
// the app's real `buildTutorContext` and `buildTutorPrompt` (so the harness
// tests the exact context/prompt the product ships) and calls the chosen
// provider. It differs from the app's own `runTutorTurn` only in that it also
// returns the full TutorContext, which the harness needs for scoring and
// artifacts. No teaching behaviour is added here.

import { buildTutorContext } from '../../../src/tutor-runtime/build-tutor-context';
import type { FreedomMode, ProgressState, TutorContext } from '../../../src/tutor-runtime/tutor-runtime.types';
import type { CoursePackage } from '../../../src/course-package/course-package.types';
import type { ModelProvider } from '../model/model-provider.types';
import { renderMemoryForPrompt } from './lesson-memory';
import { LESSON_MEMORY_DEFAULTS, type LessonMemoryConfig, type LessonMemoryMode, type LessonWorkingMemory } from './lesson-memory.types';
import {
  buildVariantPrompt,
  DEFAULT_TUTOR_PROMPT_VARIANT,
  type TutorPromptVariant,
} from './tutor-prompt-variants';

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
  /**
   * Which memory representation to render (default: structured_working_memory).
   * `no_memory` renders nothing regardless of `workingMemory`.
   */
  memoryMode?: LessonMemoryMode;
  memoryConfig?: Partial<LessonMemoryConfig>;
  /** Which tutor prompt variant to render (default: full_current_prompt). */
  promptVariant?: TutorPromptVariant;
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
  /** Which memory mode was rendered this turn. */
  memoryMode: LessonMemoryMode;
  /** The EXACT memory block appended to the system prompt (empty for no_memory). */
  memorySentToModel: string;
  /** Which prompt variant was rendered this turn. */
  promptVariant: TutorPromptVariant;
  /** The variant's instruction preamble only (the part that differs) — for artifacts + size metrics. */
  promptVariantInstructions: string;
  /** Character counts for prompt-size analysis. */
  promptSizes: { systemPromptChars: number; instructionChars: number; groundingChars: number };
}

/** Run one turn through the real runtime context/prompt path + the provider. */
export async function runAdaptedTutorTurn(params: AdaptedTurnParams): Promise<AdaptedTurnResult> {
  const { coursePackage, unitId, userMessage, provider, freedomMode, progress, maxChunks, workingMemory } = params;
  const memoryMode: LessonMemoryMode = params.memoryMode ?? LESSON_MEMORY_DEFAULTS.mode;
  const promptVariant: TutorPromptVariant = params.promptVariant ?? DEFAULT_TUTOR_PROMPT_VARIANT;

  const context = buildTutorContext({ coursePackage, unitId, userMessage, freedomMode, progress, maxChunks });
  // The prompt-variant builder produces the system+user prompt. For
  // full_current_prompt it IS the app's real prompt; other variants swap only
  // the instruction preamble while keeping identical grounding + user prompt.
  const prompt = buildVariantPrompt({ context, variant: promptVariant });

  // The harness then appends ONLY the selected memory representation to the
  // SYSTEM prompt. renderMemoryForPrompt is the single place that decides what
  // memory text is sent — and it never renders the full archive. `no_memory`
  // (or no working memory) appends nothing.
  const memorySentToModel = workingMemory
    ? renderMemoryForPrompt({ working: workingMemory, mode: memoryMode, config: params.memoryConfig })
    : '';
  const systemPrompt = memorySentToModel
    ? `${prompt.systemPrompt}\n\n${memorySentToModel}`
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
    memoryMode,
    memorySentToModel,
    promptVariant,
    promptVariantInstructions: prompt.instructions,
    promptSizes: {
      systemPromptChars: systemPrompt.length,
      instructionChars: prompt.instructions.length,
      groundingChars: prompt.grounding.length,
    },
  };
}
