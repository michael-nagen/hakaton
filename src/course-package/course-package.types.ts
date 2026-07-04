// ── CoursePackage v1 — core data contract ────────────────────────────
//
// This is the shared contract consumed by:
//   • the frontend
//   • the Course Factory agents (future)
//   • the Tutor Runtime
//   • the reusable RAG / course composer (future)
//
// Keep this file free of runtime logic — types only. Validation lives in
// course-package.schema.ts and loading lives in course-package.loader.ts.

/** Semantic version of the package contract / content, e.g. "1.0.0". */
export type SemVer = string;

/** ISO-8601 timestamp string, e.g. "2026-06-30T12:00:00.000Z". */
export type IsoDateString = string;

export type CourseLevel = 'beginner' | 'intermediate' | 'advanced';

export type QuestionType = 'open' | 'short' | 'mcq';

// ── Teaching brain ───────────────────────────────────────────────────

/**
 * The "brain" that drives how the tutor teaches a single unit. This is the
 * personality + pedagogy layer that gets turned into a system prompt by the
 * Tutor Runtime. It is intentionally per-unit so different units can teach
 * with different styles.
 */
export interface TeacherBrain {
  /** Short persona description, e.g. "patient senior engineer". */
  persona: string;
  /** Tone of voice, e.g. "encouraging, concise, never condescending". */
  tone: string;
  /** What the tutor is trying to achieve in this unit. */
  objectives: string[];
  /** Things the tutor SHOULD do (positive guidance). */
  guidelines: string[];
  /** Things the tutor should NOT do (guardrails). */
  constraints: string[];
  /**
   * Optional hand-authored seed prepended to the generated system prompt.
   * Lets a course author inject extra instructions without code changes.
   */
  systemPromptSeed?: string;
}

// ── Knowledge base ───────────────────────────────────────────────────

/**
 * A single retrievable piece of source knowledge. Chunks are the unit of
 * retrieval for the Tutor Runtime today (keyword match) and for RAG later
 * (vector match). Each chunk carries its own unitId so the whole course can
 * be flattened into one index without losing provenance.
 */
export interface KnowledgeBaseChunk {
  id: string;
  /** Owning learning unit. */
  unitId: string;
  title: string;
  /** The actual knowledge text the model may ground its answer in. */
  content: string;
  /** Free-form tags used for retrieval / filtering. */
  tags: string[];
  /** Optional citation / origin of this chunk. */
  source?: string;
}

// ── Assessment ───────────────────────────────────────────────────────

export interface Hint {
  id: string;
  /** Reveal order — lower is shown first. */
  order: number;
  text: string;
}

export interface Question {
  id: string;
  prompt: string;
  type: QuestionType;
  /** Present for `mcq` questions; ignored otherwise. */
  options?: string[];
  /** Canonical answer (the correct option text for `mcq`). */
  answer: string;
  /** Progressive hints, surfaced one at a time by the runtime. */
  hints: Hint[];
  difficulty?: CourseLevel;
}

export interface CommonMistake {
  id: string;
  /** What the learner typically gets wrong. */
  mistake: string;
  /** How the tutor should correct / reframe it. */
  correction: string;
  /** Optional link back to the question this mistake relates to. */
  relatedQuestionId?: string;
}

// ── Deterministic teaching steps (opt-in, additive) ──────────────────
//
// When a unit carries `deterministicSteps`, the app can run it in the
// "deterministic_steps" lesson flow: the FULL teaching plan is authored here so
// a weak/local model never has to invent it. In that flow the model only
// explains, adapts, and helps the learner INSIDE the current step — the app
// (not the model) owns progression.
//
// This block is entirely OPTIONAL and purely additive: units without it behave
// exactly as before, and the deterministic flow falls back to the current
// question-driven flow when it is absent. Nothing here changes the existing
// `questions`/`knowledgeBaseChunks`/`teacherBrain` contract.

/** The prepared, deterministic MCQ shown inside one step. */
export interface DeterministicStepMcq {
  /** The question text shown to the learner. */
  question: string;
  /** Answer choices (at least 2). */
  options: string[];
  /** The correct choice — must be exactly one of `options`. */
  correctAnswer: string;
  /** Prepared feedback shown verbatim when the learner answers correctly. */
  feedbackCorrect: string;
  /** Prepared feedback shown verbatim when the learner answers incorrectly. */
  feedbackIncorrect: string;
}

/**
 * The prepared open-ended check for a step. The learner answers in free text and
 * the local model evaluates the answer against `expectedIdea` (a rubric), staying
 * inside the current step. `expectedIdea`, `acceptableAnswers`, and `hint` are
 * model-side only — they are NEVER rendered to the learner.
 */
export interface DeterministicOpenCheck {
  /** The open question prompt shown to the learner. */
  question: string;
  /** What a good answer should convey (the rubric the model grades against). */
  expectedIdea: string;
  /** Example answers that should be accepted (guidance for the model). */
  acceptableAnswers?: string[];
  /** Prepared gentle correction / hint the model uses if the learner is off. */
  hint: string;
}

/**
 * One deterministic teaching step/topic within a lesson. A lesson in
 * deterministic flow is exactly an ordered list of these (typically 3). Each is
 * fully prepared content the runtime plays in order, ending in EITHER an MCQ
 * (`mcq`) OR an open-ended check (`open`).
 */
export interface DeterministicStep {
  id: string;
  /** Short step title, e.g. "Printing text with print()". */
  title: string;
  /** Prepared intro/explanation shown when the step opens. */
  intro: string;
  /** Optional prepared worked example. */
  example?: string;
  /** Prepared MCQ check (present for MCQ steps). Exactly one of mcq/open. */
  mcq?: DeterministicStepMcq;
  /** Prepared open-ended check (present for open steps). Exactly one of mcq/open. */
  open?: DeterministicOpenCheck;
  /** Deterministic checkpoint prompt, e.g. "Did you understand?". */
  checkpointPrompt: string;
  /** Optional short recap shown before advancing to the next step. */
  summary?: string;
}

// ── Learning unit ────────────────────────────────────────────────────

/**
 * One teachable unit of a course. A unit is self-contained: it owns its
 * teaching brain, knowledge chunks, questions and common mistakes. This is
 * what the Tutor Runtime loads minimally — never the whole course.
 */
export interface LearningUnit {
  id: string;
  title: string;
  /** What the learner should be able to do after this unit. */
  goal: string;
  /** Position within the course (1-based). */
  order: number;
  teacherBrain: TeacherBrain;
  knowledgeBaseChunks: KnowledgeBaseChunk[];
  questions: Question[];
  commonMistakes: CommonMistake[];
  /**
   * Optional prepared lesson-opening message for the deterministic flow —
   * injected as the first tutor message before Step 1 (topic, why it matters,
   * the subtopics ahead, and the end goal). Additive/optional.
   */
  deterministicOverview?: string;
  /**
   * Optional prepared teaching plan for the "deterministic_steps" lesson flow.
   * Absent on legacy units → the deterministic flow falls back to the current
   * question-driven flow. Additive: does not affect the existing flow.
   */
  deterministicSteps?: DeterministicStep[];
}

// ── Course-level metadata ────────────────────────────────────────────

export interface CourseMetadata {
  author: string;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
  /** BCP-47 language tag, e.g. "en". */
  language: string;
  level: CourseLevel;
  tags: string[];
  estimatedDurationMinutes: number;
}

/**
 * Metadata reserved for the future reusable / RAG course composer. Today it
 * is purely descriptive; later it drives indexing and reuse decisions.
 */
export interface ReusableMetadata {
  /** Whether this package may be reused as a building block elsewhere. */
  reusable: boolean;
  /** Knowledge domain, e.g. "frontend", "data-engineering". */
  domain: string;
  /** High-level topics covered (used for matching during composition). */
  topics: string[];
  /** Course ids / topics assumed as prerequisite knowledge. */
  prerequisites: string[];
  /** Embedding model the chunks were (or will be) indexed with. */
  embeddingModel?: string;
  /** True once chunks have been pushed into a vector index. */
  ragIndexed: boolean;
}

// ── Root contract ────────────────────────────────────────────────────

export interface CoursePackage {
  id: string;
  title: string;
  description: string;
  /** The overarching outcome of the whole course. */
  goal: string;
  /** Contract/content version, e.g. "1.0.0". */
  version: SemVer;
  units: LearningUnit[];
  metadata: CourseMetadata;
  reusableMetadata: ReusableMetadata;
}
