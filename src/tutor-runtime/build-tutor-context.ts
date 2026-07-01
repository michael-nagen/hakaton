// ── Tutor Runtime — context assembly ─────────────────────────────────
//
// Assembles the minimal, single-unit context the model is allowed to see.
// Pulls the current unit out of the package, retrieves a handful of relevant
// chunks, and strips answer keys from questions before they leave the runtime.

import { getUnitById } from '../course-package/course-package.loader';
import type { CoursePackage, Question } from '../course-package/course-package.types';
import { getRelevantChunksForUnit } from './get-relevant-chunks-for-unit';
import { resolveFreedomMode } from './freedom-mode';
import type { FreedomMode, ProgressState, TutorContext, TutorQuestionRef } from './tutor-runtime.types';

/** Drop the answer; the model coaches, it does not get the answer key. */
function toQuestionRef(question: Question): TutorQuestionRef {
  return {
    id: question.id,
    prompt: question.prompt,
    hints: [...question.hints].sort((a, b) => a.order - b.order),
  };
}

/**
 * Build the minimal tutor context for one learning unit.
 *
 * Never includes other units, full chunk sets, or answer keys — only the
 * current unit's goal, brain, a few relevant chunks, coaching-safe questions,
 * common mistakes, a compact progress summary, and the user's message.
 */
export function buildTutorContext(params: {
  coursePackage: CoursePackage;
  unitId: string;
  userMessage: string;
  progress?: ProgressState;
  /** Defaults to "guided" when omitted or unrecognised. */
  freedomMode?: FreedomMode;
  maxChunks?: number;
}): TutorContext {
  const { coursePackage, unitId, userMessage, progress, freedomMode, maxChunks } = params;

  const unit = getUnitById({ coursePackage, unitId });
  if (!unit) {
    throw new Error(`Unit "${unitId}" not found in course "${coursePackage.id}".`);
  }

  const relevantChunks = getRelevantChunksForUnit({ unit, userMessage, maxChunks });

  return {
    course: { id: coursePackage.id, title: coursePackage.title },
    unit: { id: unit.id, title: unit.title, goal: unit.goal },
    teacherBrain: unit.teacherBrain,
    relevantChunks,
    relatedQuestions: unit.questions.map(toQuestionRef),
    commonMistakes: unit.commonMistakes,
    progress: progress ?? null,
    freedomMode: resolveFreedomMode(freedomMode),
    userMessage,
  };
}
