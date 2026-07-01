// ── Lesson Runtime — lesson steps ────────────────────────────────────
//
// A lesson (one LearningUnit) is worked as an ordered list of steps. Each step
// is one of the unit's questions, which maps cleanly onto TutorInput.lessonContext
// (currentQuestion / expectedUnderstanding / hints). Units with no questions fall
// back to a single synthetic step derived from the unit goal, so the player always
// has at least one step to run.

import type { LearningUnit } from '../course-package';

/** A single teachable step within a lesson. */
export interface StepDescriptor {
  id: string;
  /** The prompt the learner is working on this step. */
  question: string;
  /** The canonical understanding/answer the tutor grades against. */
  expectedUnderstanding: string;
  /** Progressive hints for this step, in reveal order. */
  hints: string[];
}

/** Build the ordered steps for a unit. Always returns at least one step. */
export function buildLessonSteps(unit: LearningUnit): StepDescriptor[] {
  if (unit.questions.length === 0) {
    return [
      {
        id: `${unit.id}-overview`,
        question: unit.goal,
        expectedUnderstanding: unit.goal,
        hints: [],
      },
    ];
  }

  return unit.questions.map((q) => ({
    id: q.id,
    question: q.prompt,
    expectedUnderstanding: q.answer,
    hints: [...q.hints].sort((a, b) => a.order - b.order).map((h) => h.text),
  }));
}
