// ── Lesson Runtime — personalization in the ACTUAL tutor prompt ───────
//
// Proves the teaching preference is appended to the real selected prompt
// (buildTutorResponseSystemPrompt — the one createTutorProvider/every strategy
// uses), not a parallel/new prompt, and that it is absent when cleared.

import { describe, expect, it } from 'vitest';
import type { LearningUnit } from '../course-package';
import type { StepDescriptor } from './lesson-steps';
import type { LessonSessionState } from './lesson-state';
import { toTutorInput } from './to-tutor-input';
import { buildTutorResponseSystemPrompt } from '../tutor-runtime';

// A sentinel unique to the real selected prompt — if this is present, we know we
// rendered the actual prompt (not a personalization-only replacement).
const SELECTED_PROMPT_SENTINEL = 'You are an autonomous, encouraging tutor';

const UNIT = {
  id: 'u1',
  title: 'What a Variable Is',
  goal: 'Explain that a variable is a named placeholder.',
  commonMistakes: [],
} as unknown as LearningUnit;

const STEP: StepDescriptor = { id: 'q1', question: 'What is a variable?', expectedUnderstanding: 'a named box', hints: [] };

function state(): LessonSessionState {
  return {
    courseId: 'c1',
    unitId: 'u1',
    status: 'in_progress',
    stepIds: ['q1'],
    currentStepIndex: 0,
    completedStepIds: [],
    attemptsByStep: {},
    levelEstimate: 'beginner',
    messages: [],
    turnCount: 1,
  };
}

describe('personalization in the selected tutor prompt', () => {
  const INSTRUCTION = 'Teach the student step by step. Break concepts into small parts.';

  it('appends the preference to the actual selected prompt (does not replace it)', () => {
    const input = toTutorInput({ unit: UNIT, step: STEP, state: state(), studentAnswer: 'a variable stores a value', teachingPreferenceInstruction: INSTRUCTION });
    const prompt = buildTutorResponseSystemPrompt(input);

    // Selected prompt is still there …
    expect(prompt).toContain(SELECTED_PROMPT_SENTINEL);
    expect(prompt).toContain('Current goal:');
    // … plus the appended personalization block with the style-only guard.
    expect(prompt).toContain('Teaching preference:');
    expect(prompt).toContain(INSTRUCTION);
    expect(prompt).toContain('Do not change the selected prompt.');
    expect(prompt).toContain('Do not change the lesson goal.');
  });

  it('omits the preference block entirely when there is none (cleared)', () => {
    const input = toTutorInput({ unit: UNIT, step: STEP, state: state(), studentAnswer: 'a variable stores a value' });
    const prompt = buildTutorResponseSystemPrompt(input);

    expect(prompt).toContain(SELECTED_PROMPT_SENTINEL); // selected prompt still works
    expect(prompt).not.toContain('Teaching preference');
  });

  it('toTutorInput sets lessonContext.teachingPreference only when an instruction is given', () => {
    const withPref = toTutorInput({ unit: UNIT, step: STEP, state: state(), studentAnswer: 'x', teachingPreferenceInstruction: INSTRUCTION });
    expect(withPref.lessonContext.teachingPreference?.instruction).toBe(INSTRUCTION);

    const without = toTutorInput({ unit: UNIT, step: STEP, state: state(), studentAnswer: 'x' });
    expect(without.lessonContext.teachingPreference).toBeUndefined();

    const blank = toTutorInput({ unit: UNIT, step: STEP, state: state(), studentAnswer: 'x', teachingPreferenceInstruction: '   ' });
    expect(blank.lessonContext.teachingPreference).toBeUndefined();
  });
});
