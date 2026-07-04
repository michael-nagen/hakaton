// ── Tutor Runtime — main live prompt trimming policy ─────────────────
//
// Locks the focused/lightweight shape of the live tutor prompt for the small
// on-device model: capped hints/mistakes, mistake corrections preserved, and a
// recent-message window that is NOT silently re-truncated inside the builder.

import { describe, expect, it } from 'vitest';
import type { LearningUnit } from '../course-package';
import type { StepDescriptor } from '../lesson-runtime';
import { toTutorInput, DEFAULT_RECENT_MESSAGES_LIMIT } from '../lesson-runtime';
import type { LessonSessionState } from '../lesson-runtime';
import { buildTutorResponseSystemPrompt, buildTutorResponseUserPrompt } from './build-tutor-response-prompt';
import { LIVE_TUTOR_PROMPT_STYLE } from './live-tutor-prompt-style';
import { SHARED_TUTOR_BEHAVIOR_RULES } from './shared-tutor-behavior-rules';
import type { TutorInput } from './tutor-provider.types';

const UNIT = {
  id: 'u1',
  title: 'What a Variable Is',
  goal: 'Explain that a variable is a named placeholder.',
  commonMistakes: [
    { id: 'm1', mistake: 'Thinks a variable is the value itself', correction: 'It is a named box that holds a value' },
    { id: 'm2', mistake: 'Confuses = with equality', correction: '= assigns, == compares' },
    { id: 'm3', mistake: 'Believes names must be single letters', correction: 'Names can be descriptive words' },
    { id: 'm4', mistake: 'Thinks a variable cannot change', correction: 'Its value can be reassigned' },
  ],
} as unknown as LearningUnit;

const STEP: StepDescriptor = {
  id: 'q1',
  question: 'What is a variable?',
  expectedUnderstanding: 'a named box that holds a value',
  hints: ['hint one', 'hint two', 'hint three', 'hint four'],
};

function stateWith(messages: LessonSessionState['messages']): LessonSessionState {
  return {
    courseId: 'c1',
    unitId: 'u1',
    status: 'in_progress',
    stepIds: ['q1'],
    currentStepIndex: 0,
    completedStepIds: [],
    attemptsByStep: {},
    levelEstimate: 'beginner',
    messages,
    turnCount: 1,
  };
}

describe('main live tutor prompt trimming policy', () => {
  it('recent-message window defaults to 4', () => {
    expect(DEFAULT_RECENT_MESSAGES_LIMIT).toBe(4);
  });

  it('toTutorInput keeps mistake + correction and applies the default window of 4', () => {
    const messages = Array.from({ length: 6 }, (_, i) => ({
      role: (i % 2 === 0 ? 'student' : 'tutor') as 'student' | 'tutor',
      content: `m${i}`,
    }));
    const input = toTutorInput({ unit: UNIT, step: STEP, state: stateWith(messages), studentAnswer: 'x' });

    // Only the last 4 messages survive the single (runtime) trim.
    expect(input.recentMessages).toHaveLength(4);
    expect(input.recentMessages.map((m) => m.content)).toEqual(['m2', 'm3', 'm4', 'm5']);

    // Correction text is preserved (was previously dropped).
    expect(input.lessonContext.commonMistakes[0]).toContain('correction:');
    expect(input.lessonContext.commonMistakes[0]).toContain('It is a named box that holds a value');
  });

  it('system prompt caps hints and mistakes at 3 and includes correction text', () => {
    const input = toTutorInput({ unit: UNIT, step: STEP, state: stateWith([]), studentAnswer: 'x' });
    const system = buildTutorResponseSystemPrompt(input);

    // Hints: exactly 3 rendered (fourth dropped).
    expect(system).toContain('hint three');
    expect(system).not.toContain('hint four');

    // Mistakes: exactly 3 rendered (fourth dropped), with correction text present.
    expect(system).toContain('= assigns, == compares');
    expect(system).not.toContain('Its value can be reassigned');
  });

  it('both prompt styles keep the exact strict JSON contract and lesson context', () => {
    const input = toTutorInput({ unit: UNIT, step: STEP, state: stateWith([]), studentAnswer: 'x' });

    for (const style of ['current_json', 'structured_rules_json'] as const) {
      const system = buildTutorResponseSystemPrompt(input, style);
      // Strict JSON contract — identical in both styles.
      expect(system).toContain('Reply with ONLY a single JSON object');
      expect(system).toContain('"messageToStudent"');
      expect(system).toContain('"nextAction"');
      expect(system).toContain('"studentLevelEstimate"');
      expect(system).toContain('"confidence"');
      // Live lesson context is preserved in both styles.
      expect(system).toContain('Lesson: What a Variable Is');
      expect(system).toContain('Current goal:');
      expect(system).toContain('Current question:');
      expect(system).toContain('What the student should come to understand:');
      expect(system).toContain('hint one');
      expect(system).toContain('= assigns, == compares'); // mistake + correction
    }
  });

  it('current_json keeps the original opening; structured_rules_json swaps in the evaluated rules', () => {
    const input = toTutorInput({ unit: UNIT, step: STEP, state: stateWith([]), studentAnswer: 'x' });

    const current = buildTutorResponseSystemPrompt(input, 'current_json');
    expect(current).toContain('You are an autonomous, encouraging tutor');
    expect(current).not.toContain('Rules:');

    const structured = buildTutorResponseSystemPrompt(input, 'structured_rules_json');
    expect(structured).toContain('You are a kind, calm, supportive, clear tutor');
    expect(structured).toContain('Rules:');
    expect(structured).toContain(SHARED_TUTOR_BEHAVIOR_RULES.lessonOpening);
    expect(structured).toContain(SHARED_TUTOR_BEHAVIOR_RULES.closeEnough);
    expect(structured).toContain(SHARED_TUTOR_BEHAVIOR_RULES.stuckLearner);
    expect(structured).toContain(SHARED_TUTOR_BEHAVIOR_RULES.noRepeat);
  });

  it('defaults to current_json (safe rollback default)', () => {
    expect(LIVE_TUTOR_PROMPT_STYLE).toBe('current_json');
    const input = toTutorInput({ unit: UNIT, step: STEP, state: stateWith([]), studentAnswer: 'x' });
    // No explicit style → must equal the current_json rendering.
    expect(buildTutorResponseSystemPrompt(input)).toBe(
      buildTutorResponseSystemPrompt(input, 'current_json'),
    );
  });

  it('user prompt renders exactly the messages it receives (no silent re-truncation)', () => {
    // Simulate a runtime that (hypothetically) passed 6 messages: the builder must
    // render all 6 rather than re-slicing to 5 behind the caller's back.
    const input: TutorInput = {
      lessonId: 'u1',
      stepId: 'q1',
      studentAnswer: 'x',
      recentMessages: Array.from({ length: 6 }, (_, i) => ({
        role: (i % 2 === 0 ? 'student' : 'tutor') as 'student' | 'tutor',
        content: `line${i}`,
      })),
      lessonContext: {
        title: 'T',
        currentGoal: 'G',
        currentQuestion: 'Q',
        expectedUnderstanding: 'U',
        hints: [],
        commonMistakes: [],
      },
      studentState: { levelEstimate: 'beginner', attemptsOnCurrentStep: 1 },
    };
    const user = buildTutorResponseUserPrompt(input);
    for (let i = 0; i < 6; i += 1) expect(user).toContain(`line${i}`);
  });
});
