// ── Tutor Runtime — types ────────────────────────────────────────────
//
// The runtime does NOT create courses. It takes a CoursePackage + where the
// learner is + what they said, and produces the *minimal* context and a
// model-ready prompt. Guiding rule: never send the whole course to the model.

import type {
  CommonMistake,
  Hint,
  KnowledgeBaseChunk,
  Question,
  TeacherBrain,
} from '../course-package/course-package.types';

/**
 * Lightweight, optional record of where the learner is. Kept small on
 * purpose — only what helps the model adapt, nothing the model must store.
 */
export interface ProgressState {
  /** Units the learner has already completed. */
  completedUnitIds?: string[];
  /** Attempts made on the current unit's questions. */
  attempts?: number;
  /** Rough self-/system-assessed mastery 0–1 for the current unit. */
  mastery?: number;
  /** Optional free-text note, e.g. "struggled with .catch()". */
  note?: string;
}

/**
 * How much latitude the tutor has relative to the course material:
 *   - `strict`: stay strictly within the provided chunks; no outside facts.
 *   - `guided`: lead with the chunks, may add small clarifying context.
 *   - `open`: free conversation, using the unit only as a loose anchor.
 */
export type FreedomMode = 'strict' | 'guided' | 'open';

/** A question trimmed for the model: prompt + hints, without the answer key. */
export interface TutorQuestionRef {
  id: string;
  prompt: string;
  hints: Hint[];
}

/**
 * The minimal, self-contained context for teaching ONE unit. This is the
 * only course-derived data that should ever reach the model.
 */
export interface TutorContext {
  course: { id: string; title: string };
  unit: { id: string; title: string; goal: string };
  teacherBrain: TeacherBrain;
  /** 2–3 most relevant knowledge chunks for the user's message. */
  relevantChunks: KnowledgeBaseChunk[];
  /** Related questions (answers withheld) the tutor may draw on. */
  relatedQuestions: TutorQuestionRef[];
  /** Common mistakes worth pre-empting in this unit. */
  commonMistakes: CommonMistake[];
  /** Compact progress summary, or null when none was provided. */
  progress: ProgressState | null;
  /** How tightly the tutor must stick to the course material. */
  freedomMode: FreedomMode;
  /** The learner's current message. */
  userMessage: string;
}

/** A chat message in the provider-neutral shape the runtime emits. */
export interface PromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Model-ready prompt. `messages` is the canonical form; `systemPrompt` /
 * `userPrompt` are split out for convenience and easy logging/inspection.
 */
export interface TutorPrompt {
  systemPrompt: string;
  userPrompt: string;
  messages: PromptMessage[];
}

/** A scored chunk, used internally by retrieval and exposed for debugging. */
export interface ScoredChunk {
  chunk: KnowledgeBaseChunk;
  score: number;
}
