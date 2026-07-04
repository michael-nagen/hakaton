// ── Lesson Assistant — context builder ───────────────────────────────
//
// One clean function that turns the REAL runtime types (a LearningUnit + the
// current StepDescriptor) into the compact LessonContext the helper actions
// share. No duplicate lesson/step types are introduced.

import type { LearningUnit } from '../course-package';
import type { StepDescriptor } from '../lesson-runtime';
import type { LessonContext } from './lesson-assistant.types';

export function getCurrentLessonContext(params: {
  lesson: LearningUnit;
  currentStep?: StepDescriptor;
}): LessonContext {
  const { lesson, currentStep } = params;
  return {
    lessonTitle: lesson.title,
    lessonTopic: lesson.goal,
    // StepDescriptor has no explicit title; the question IS the material the
    // learner is working on, so it becomes the step content. Title stays
    // undefined rather than inventing one.
    currentStepTitle: undefined,
    currentStepContent: currentStep?.question,
  };
}
