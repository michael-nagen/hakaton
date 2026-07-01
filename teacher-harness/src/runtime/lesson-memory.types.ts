// ── Teacher Harness — lesson-session memory (types) ──────────────────
//
// Minimal memory for the CURRENT lesson run only. There are deliberately two
// layers, both owned by the harness (the model owns none of it):
//
//   • Lesson Working Memory  — the COMPACT view passed into the tutor prompt on
//     every turn. The weak model never receives the whole transcript.
//   • Conversation Archive   — the FULL internal record for the lesson run,
//     saved as artifacts and used to recompute the working memory.
//
// This is NOT durable learner memory: it lives for one lesson run, has no
// database, no vectors, no memory agent, and no LLM summariser. Summaries are
// deterministic/rule-based.

/** One message in the lesson transcript. */
export interface LessonMemoryMessage {
  role: 'learner' | 'tutor';
  turnId: string;
  content: string;
  createdAt: string;
}

/** A single checklist row describing coverage of one learning target. */
export interface LessonProgressChecklistItem {
  id: string;
  label: string;
  status: 'not_started' | 'in_progress' | 'covered' | 'mastered' | 'needs_review';
  /** Short pointer to the evidence, e.g. the turn id that advanced it. */
  evidence?: string;
}

export type LearnerStatus = 'unknown' | 'struggling' | 'improving' | 'ready_to_continue';

/**
 * The compact memory sent to the model. Everything here is authoritative for
 * the model — it should not assume any hidden/remembered context beyond this.
 */
export interface LessonWorkingMemory {
  courseId: string;
  unitId: string;
  progressChecklist: LessonProgressChecklistItem[];
  /** What the learner appears to know already. */
  learnerKnows: string[];
  /** What is still not proven/mastered. */
  learnerStillNeeds: string[];
  /** Misconceptions the tutor has corrected this lesson. */
  correctedMistakes: string[];
  /** Hints already surfaced (so the tutor does not repeat them). */
  hintsGiven: string[];
  /** Practice questions the learner has already engaged with. */
  questionsAttempted: string[];
  learnerStatus: LearnerStatus;
  /** Deterministic summary of history older than the last N messages. */
  olderHistorySummary: string;
  /** The last N conversation messages, verbatim. */
  lastMessages: LessonMemoryMessage[];
}

/** The full internal record for the lesson run (artifact + working-memory source). */
export interface ConversationArchiveMemory {
  courseId: string;
  unitId: string;
  allMessages: LessonMemoryMessage[];
  /** Deterministic per-chunk summaries produced every few messages. */
  chunkSummaries: string[];
  /** Deterministic end-of-lesson summary, set on finalisation. */
  finalSummary?: string;
}

/** The two layers bundled together for one lesson run. */
export interface LessonSessionMemory {
  working: LessonWorkingMemory;
  archive: ConversationArchiveMemory;
}

/** Tunable knobs — kept configurable so we can adjust window sizes later. */
export interface LessonMemoryConfig {
  /** How many recent messages the working memory keeps verbatim. */
  lastMessagesLimit: number;
  /** Produce a chunk summary every this-many archived messages. */
  summarizeEveryMessages: number;
}

export const LESSON_MEMORY_DEFAULTS: LessonMemoryConfig = {
  lastMessagesLimit: 10,
  summarizeEveryMessages: 10,
};
