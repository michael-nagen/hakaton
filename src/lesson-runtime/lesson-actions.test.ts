// ── Lesson Runtime — completion-toggle tests ─────────────────────────
//
// Covers the "keep the lesson open" option: with completion disabled, no
// tutor action may ever move the lesson into the terminal `completed` status,
// and the "finish" tool is removed from the model's response schema.

import { describe, expect, it } from 'vitest';
import { applyTutorAction } from './lesson-actions';
import type { LessonSessionState } from './lesson-state';
import { buildTutorResponseSystemPrompt } from '../tutor-runtime';
import type { TutorInput, TutorResponse } from '../tutor-runtime';

function stateAt(index: number): LessonSessionState {
  return {
    courseId: 'c1',
    unitId: 'u1',
    status: 'in_progress',
    stepIds: ['q1', 'q2'],
    currentStepIndex: index,
    completedStepIds: [],
    attemptsByStep: {},
    levelEstimate: 'beginner',
    messages: [],
    turnCount: 1,
  };
}

function response(nextAction: TutorResponse['nextAction']): TutorResponse {
  return { messageToStudent: 'ok', nextAction, studentLevelEstimate: 'beginner', confidence: 0.5 };
}

describe('applyTutorAction — completion enabled (default)', () => {
  it('"finish" completes the lesson', () => {
    const next = applyTutorAction({ state: stateAt(0), response: response('finish') });
    expect(next.status).toBe('completed');
    expect(next.completedStepIds).toEqual(['q1', 'q2']);
  });

  it('"continue" on the last step completes the lesson', () => {
    const next = applyTutorAction({ state: stateAt(1), response: response('continue') });
    expect(next.status).toBe('completed');
  });
});

describe('applyTutorAction — completion disabled (stays open)', () => {
  it('"finish" never completes; the lesson stays in progress on the last step', () => {
    const next = applyTutorAction({ state: stateAt(0), response: response('finish'), allowCompletion: false });
    expect(next.status).toBe('in_progress');
    expect(next.currentStepIndex).toBe(1); // clamped to the last step, not beyond
  });

  it('"continue" on the last step never completes', () => {
    const next = applyTutorAction({ state: stateAt(1), response: response('continue'), allowCompletion: false });
    expect(next.status).toBe('in_progress');
    expect(next.completedStepIds).toContain('q2'); // work still recorded
  });

  it('"continue" on a middle step still advances normally', () => {
    const next = applyTutorAction({ state: stateAt(0), response: response('continue'), allowCompletion: false });
    expect(next.status).toBe('in_progress');
    expect(next.currentStepIndex).toBe(1);
  });
});

describe('buildTutorResponseSystemPrompt — completion toggle', () => {
  const baseInput: TutorInput = {
    lessonId: 'u1',
    stepId: 'q1',
    studentAnswer: 'hi',
    recentMessages: [],
    lessonContext: {
      title: 'T',
      currentGoal: 'G',
      currentQuestion: 'Q',
      expectedUnderstanding: 'E',
      hints: [],
      commonMistakes: [],
    },
    studentState: { levelEstimate: 'beginner', attemptsOnCurrentStep: 0 },
  };

  it('offers "finish" by default', () => {
    const prompt = buildTutorResponseSystemPrompt(baseInput);
    expect(prompt).toContain('"finish"');
  });

  it('drops "finish" and warns when completion is disabled', () => {
    const prompt = buildTutorResponseSystemPrompt({
      ...baseInput,
      lessonContext: { ...baseInput.lessonContext, completionEnabled: false },
    });
    expect(prompt).not.toContain('"finish"');
    expect(prompt).toContain('Lesson completion is disabled');
  });
});
