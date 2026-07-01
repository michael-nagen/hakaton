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
