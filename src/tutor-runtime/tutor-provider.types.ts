// ── Tutor Runtime — TutorProvider seam ───────────────────────────────
//
// The ONE call the tutor/lesson flow makes: `generateTutorResponse(input)`.
// It is deliberately provider-agnostic — the caller neither knows nor cares
// whether the answer came from Gemini, OpenRouter, a local model, or the mock.
// A single generic implementation (create-tutor-provider.ts) sits over the
// low-level ModelProvider transport, so swapping providers never touches lesson
// logic. Input is kept minimal (never the whole course — only the current step).

export interface TutorInput {
  lessonId: string;
  stepId: string;
  studentAnswer: string;
  recentMessages: Array<{
    role: 'student' | 'tutor';
    content: string;
  }>;
  lessonContext: {
    title: string;
    currentGoal: string;
    currentQuestion: string;
    expectedUnderstanding: string;
    hints: string[];
    commonMistakes: string[];
    rubric?: string;
    /**
     * Course snippets retrieved BY THE RUNTIME (retrieval_first strategy).
     * The model never searches on its own — it only receives these.
     */
    referenceSnippets?: string[];
    /**
     * Extra per-turn instructions injected by the runtime (repair/critic
     * strategies), e.g. "rewrite the draft below without revealing the answer".
     */
    runtimeNotes?: string[];
    /**
     * Optional student teaching-style preference (personalization). Appended to
     * the ACTUAL selected prompt as a style-only block; never changes the lesson
     * goal, validation, or progression. Only the instruction text is needed
     * (kept primitive so the runtime does not depend on the assistant layer).
     */
    teachingPreference?: { instruction: string };
    /**
     * Whether the tutor may end the lesson. When false the "finish" action is
     * removed from the response schema so the model never tries to complete the
     * lesson (the runtime enforces the same rule). Defaults to enabled (absent).
     */
    completionEnabled?: boolean;
  };
  studentState: {
    levelEstimate: 'beginner' | 'intermediate' | 'advanced';
    attemptsOnCurrentStep: number;
    knownWeaknesses?: string[];
  };
}

export type TutorNextAction =
  | 'ask_question'
  | 'give_hint'
  | 'explain'
  | 'continue'
  | 'finish';

export type StudentLevel = 'beginner' | 'intermediate' | 'advanced';

export interface TutorResponse {
  messageToStudent: string;
  nextAction: TutorNextAction;
  studentLevelEstimate: StudentLevel;
  /** Model's confidence in its own assessment, 0–1. */
  confidence: number;
}

export interface TutorProvider {
  generateTutorResponse(input: TutorInput): Promise<TutorResponse>;
}
