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

/**
 * Which lesson-session memory representation is RENDERED into the tutor prompt.
 * This changes ONLY what the model receives — never how the harness computes or
 * archives memory internally. The full archive is never sent in any mode.
 *
 *   no_memory                  — no prior lesson memory at all
 *   last_messages_only         — only the last N verbatim messages
 *   summary_only               — only a compact deterministic summary
 *   summary_plus_last_messages — compact summary + last N messages
 *   structured_working_memory  — the full structured working memory (default/current)
 */
export type LessonMemoryMode =
  | 'no_memory'
  | 'last_messages_only'
  | 'summary_only'
  | 'summary_plus_last_messages'
  | 'structured_working_memory';

export const LESSON_MEMORY_MODES: readonly LessonMemoryMode[] = [
  'no_memory',
  'last_messages_only',
  'summary_only',
  'summary_plus_last_messages',
  'structured_working_memory',
];

/** Tunable knobs — kept configurable so we can adjust window sizes later. */
export interface LessonMemoryConfig {
  /** Which memory representation is rendered into the prompt. */
  mode: LessonMemoryMode;
  /** How many recent messages the working memory keeps verbatim. */
  lastMessagesLimit: number;
  /** Produce a chunk summary every this-many archived messages. */
  summarizeEveryMessages: number;
}

/**
 * LOCKED DEFAULT (2026-07-02): the memory experiment on the fixed baseline
 * (Llama 3.2 3B + repair_pass + high_very_guided) found `last_messages_only`
 * with an 8-message window best, so it is now the default the harness uses
 * unless a developer explicitly overrides it. Other modes remain available for
 * developer experiments and to reproduce historical reports.
 */
export const LESSON_MEMORY_DEFAULTS: LessonMemoryConfig = {
  mode: 'last_messages_only',
  lastMessagesLimit: 8,
  summarizeEveryMessages: 10,
};

/** Coerce an unknown value to a valid memory mode; throws on an invalid string. */
export function resolveLessonMemoryMode(value: unknown): LessonMemoryMode {
  if (value === undefined || value === null) return LESSON_MEMORY_DEFAULTS.mode;
  if (typeof value === 'string' && (LESSON_MEMORY_MODES as readonly string[]).includes(value)) {
    return value as LessonMemoryMode;
  }
  throw new Error(
    `Invalid memory mode "${String(value)}". Valid modes: ${LESSON_MEMORY_MODES.join(', ')}.`,
  );
}
