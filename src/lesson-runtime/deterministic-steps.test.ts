// ── Lesson Runtime — deterministic steps tests ───────────────────────
//
// Covers the two guarantees the deterministic flow relies on:
//  1) the model only ever sees the CURRENT step (never future step content),
//  2) the recent-messages window is trimmed to the last few messages.

import { describe, expect, it } from 'vitest';
import type { DeterministicStep, LearningUnit } from '../course-package';
import {
  buildDeterministicHelpPrompt,
  buildDeterministicOpenEvalPrompt,
  buildDeterministicStepContext,
  buildDeterministicStepIntro,
  getDeterministicSteps,
  getStepCheckKind,
  hasDeterministicSteps,
  isAffirmativeReply,
  isDontKnowReply,
  matchMcqOption,
} from './deterministic-steps';
import type { LessonMessage } from './lesson-state';

function step(n: number): DeterministicStep {
  return {
    id: `s${n}`,
    title: `Step ${n} title`,
    intro: `Step ${n} intro text`,
    example: `example-${n}`,
    mcq: {
      question: `Step ${n} question?`,
      options: [`opt${n}a`, `opt${n}b`],
      correctAnswer: `opt${n}a`,
      feedbackCorrect: `good-${n}`,
      feedbackIncorrect: `try-again-${n}`,
    },
    checkpointPrompt: 'Did you understand?',
    summary: `Step ${n} summary`,
  };
}

const unit: LearningUnit = {
  id: 'u1',
  title: 'Lesson One',
  goal: 'goal',
  order: 1,
  teacherBrain: { persona: 'p', tone: 't', objectives: [], guidelines: [], constraints: [] },
  knowledgeBaseChunks: [],
  questions: [],
  commonMistakes: [],
  deterministicSteps: [step(1), step(2), step(3)],
};

const legacyUnit: LearningUnit = { ...unit, deterministicSteps: undefined };

describe('hasDeterministicSteps / getDeterministicSteps', () => {
  it('detects prepared steps and returns them', () => {
    expect(hasDeterministicSteps(unit)).toBe(true);
    expect(getDeterministicSteps(unit)).toHaveLength(3);
  });

  it('treats a legacy unit (no steps) as opted out', () => {
    expect(hasDeterministicSteps(legacyUnit)).toBe(false);
    expect(getDeterministicSteps(legacyUnit)).toEqual([]);
  });
});

describe('buildDeterministicStepContext', () => {
  it('lists all step titles for orientation but carries only the current step', () => {
    const ctx = buildDeterministicStepContext({ unit, step: step(2), recentMessages: [] });
    expect(ctx.lessonTopics).toEqual(['Step 1 title', 'Step 2 title', 'Step 3 title']);
    expect(ctx.currentStepTitle).toBe('Step 2 title');
    expect(ctx.step.id).toBe('s2');
  });

  it('trims recent messages to the window (last 5 by default)', () => {
    const messages: LessonMessage[] = Array.from({ length: 9 }, (_, i) => ({
      role: i % 2 === 0 ? 'student' : 'tutor',
      content: `m${i}`,
    }));
    const ctx = buildDeterministicStepContext({ unit, step: step(1), recentMessages: messages });
    expect(ctx.recentMessages).toHaveLength(5);
    expect(ctx.recentMessages[0].content).toBe('m4');
    expect(ctx.recentMessages[4].content).toBe('m8');
  });
});

describe('buildDeterministicStepIntro', () => {
  it('includes the teaching text (intro + example)', () => {
    const msg = buildDeterministicStepIntro(step(1));
    expect(msg).toContain('Step 1 intro text');
    expect(msg).toContain('Example:');
    expect(msg).toContain('example-1');
  });

  it('does NOT reveal the question, the options, or the correct answer', () => {
    // The MCQ (question + options) is rendered as structured UI, and the correct
    // answer must never appear in the visible step message.
    const msg = buildDeterministicStepIntro(step(1));
    expect(msg).not.toContain('Step 1 question?');
    expect(msg).not.toContain('opt1a');
    expect(msg).not.toContain('opt1b');
    expect(msg.toLowerCase()).not.toContain('correct answer');
  });

  it('does NOT reveal an open check\'s rubric (expectedIdea / acceptableAnswers / hint)', () => {
    // The visible teaching text is intro (+ example) only. The open-check rubric
    // is model-side and must never leak into what the learner sees.
    const openStep: DeterministicStep = {
      id: 'so',
      title: 'Open',
      intro: 'Open intro text',
      example: 'open-example',
      open: {
        question: 'What does output mean?',
        expectedIdea: 'SECRET_EXPECTED_IDEA',
        acceptableAnswers: ['SECRET_ACCEPTABLE'],
        hint: 'SECRET_HINT',
      },
      checkpointPrompt: 'ok?',
    };
    const msg = buildDeterministicStepIntro(openStep);
    expect(msg).toContain('Open intro text');
    expect(msg).not.toContain('SECRET_EXPECTED_IDEA');
    expect(msg).not.toContain('SECRET_ACCEPTABLE');
    expect(msg).not.toContain('SECRET_HINT');
  });
});

describe('matchMcqOption', () => {
  it('matches the option named in a free-text reply', () => {
    expect(matchMcqOption('I think opt1a', ['opt1a', 'opt1b'])).toEqual({ index: 0, option: 'opt1a' });
    expect(matchMcqOption('opt1b', ['opt1a', 'opt1b'])).toEqual({ index: 1, option: 'opt1b' });
  });

  it('prefers the longest option so a short option that is a substring of a longer one does not win', () => {
    // "Hi" is a substring of "print Hi" — a reply of "print Hi" must match the longer one.
    const options = ['Hi', '"Hi"', 'print Hi'];
    expect(matchMcqOption('print Hi', options)).toEqual({ index: 2, option: 'print Hi' });
    expect(matchMcqOption('hi', options)).toEqual({ index: 0, option: 'Hi' });
  });

  it('returns null when no option is named', () => {
    expect(matchMcqOption('what does this mean', ['opt1a', 'opt1b'])).toBeNull();
    expect(matchMcqOption('   ', ['opt1a', 'opt1b'])).toBeNull();
  });
});

describe('isAffirmativeReply / isDontKnowReply', () => {
  it('detects affirmative checkpoint replies', () => {
    for (const t of ['yes', 'Yes!', 'got it', 'I understand', 'ok next', 'makes sense']) {
      expect(isAffirmativeReply(t)).toBe(true);
    }
    expect(isAffirmativeReply('no')).toBe(false);
    expect(isAffirmativeReply('not really')).toBe(false);
  });

  it('detects "I don\'t know" replies', () => {
    for (const t of ["I don't know", 'idk', 'no idea', 'tell me', 'dunno']) {
      expect(isDontKnowReply(t)).toBe(true);
    }
    expect(isDontKnowReply('the answer is 7')).toBe(false);
  });
});

describe('getStepCheckKind', () => {
  it('is "mcq" for a step with an mcq, "open" for a step with an open check', () => {
    expect(getStepCheckKind(step(1))).toBe('mcq');
    const openStep: DeterministicStep = {
      id: 'so',
      title: 'Open',
      intro: 'intro',
      open: { question: 'why?', expectedIdea: 'the key idea', hint: 'the hint' },
      checkpointPrompt: 'ok?',
    };
    expect(getStepCheckKind(openStep)).toBe('open');
  });
});

describe('buildDeterministicOpenEvalPrompt', () => {
  it('grades against the rubric, stays in-step, and never advances', () => {
    const context = buildDeterministicStepContext({ unit, step: step(1), recentMessages: [] });
    const prompt = buildDeterministicOpenEvalPrompt({
      context,
      open: { question: 'Why does output matter?', expectedIdea: 'programs must show results', acceptableAnswers: ['to show results'], hint: 'output shows results' },
      studentAnswer: 'so the user can see stuff',
    });
    expect(prompt).toContain('programs must show results'); // rubric present for the model
    expect(prompt).toContain('so the user can see stuff'); // learner answer present
    expect(prompt).toContain('do not tell them to move on'); // app owns progression
    expect(prompt).toContain('Accept close-enough answers');
  });
});

describe('buildDeterministicHelpPrompt', () => {
  it('includes the current step content but NOT any other step content', () => {
    const context = buildDeterministicStepContext({ unit, step: step(2), recentMessages: [] });
    const prompt = buildDeterministicHelpPrompt({ context, studentMessage: 'I dont know' });

    // Current step's teaching content is present.
    expect(prompt).toContain('Step 2 intro text');
    expect(prompt).toContain('Step 2 question?');
    expect(prompt).toContain('example-2');

    // Other steps' teaching content must never leak in.
    expect(prompt).not.toContain('Step 1 intro text');
    expect(prompt).not.toContain('Step 3 intro text');
    expect(prompt).not.toContain('Step 1 question?');
    expect(prompt).not.toContain('Step 3 question?');

    // Step titles (orientation only) are allowed.
    expect(prompt).toContain('Step 1 title');
    // And the in-step guardrail is stated.
    expect(prompt).toContain('Stay strictly inside the current step');
  });
});
