// ── CoursePackage — deterministic-steps validation tests ─────────────
//
// The deterministicSteps block is additive + optional. These tests lock in:
//  • a package with NO deterministicSteps is still valid (backward-compatible),
//  • a well-formed deterministicSteps block validates,
//  • a broken MCQ (correctAnswer not among options) is rejected,
//  • the shipped active course validates with its new steps.

import { describe, expect, it } from 'vitest';
import { validateCoursePackage } from './course-package.schema';
import activeCourse from './course-python-first-steps.final.json';

function baseUnit(): Record<string, unknown> {
  return {
    id: 'u1',
    title: 'U1',
    goal: 'g',
    order: 1,
    teacherBrain: { persona: 'p', tone: 't', objectives: ['o'], guidelines: ['gl'], constraints: ['c'] },
    knowledgeBaseChunks: [],
    questions: [],
    commonMistakes: [],
  };
}

function pkg(unit: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'c1',
    title: 'C1',
    description: 'd',
    goal: 'g',
    version: '1.0.0',
    units: [unit],
    metadata: { author: 'a', createdAt: 'x', updatedAt: 'x', language: 'en', level: 'beginner', tags: ['t'], estimatedDurationMinutes: 5 },
    reusableMetadata: { reusable: true, domain: 'd', topics: ['t'], prerequisites: [], ragIndexed: false },
  };
}

const goodStep = {
  id: 's1',
  title: 'Step 1',
  intro: 'intro',
  example: 'ex',
  mcq: { question: 'q?', options: ['a', 'b'], correctAnswer: 'a', feedbackCorrect: 'yes', feedbackIncorrect: 'no' },
  checkpointPrompt: 'Did you understand?',
  summary: 'sum',
};

describe('deterministicSteps validation', () => {
  it('a unit with no deterministicSteps is still valid (backward compatible)', () => {
    expect(validateCoursePackage(pkg(baseUnit())).valid).toBe(true);
  });

  it('a well-formed deterministicSteps block is valid', () => {
    const unit = { ...baseUnit(), deterministicSteps: [goodStep] };
    expect(validateCoursePackage(pkg(unit)).valid).toBe(true);
  });

  it('rejects an MCQ whose correctAnswer is not one of the options', () => {
    const bad = { ...goodStep, mcq: { ...goodStep.mcq, correctAnswer: 'z' } };
    const result = validateCoursePackage(pkg({ ...baseUnit(), deterministicSteps: [bad] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('correctAnswer'))).toBe(true);
  });

  it('an open-ended check is valid', () => {
    const openStep = {
      id: 's-open',
      title: 'Open step',
      intro: 'intro',
      open: { question: 'why?', expectedIdea: 'the idea', acceptableAnswers: ['ok'], hint: 'a hint' },
      checkpointPrompt: 'Shall we continue?',
    };
    expect(validateCoursePackage(pkg({ ...baseUnit(), deterministicSteps: [openStep] })).valid).toBe(true);
  });

  it('rejects a step that has neither an mcq nor an open check', () => {
    const noCheck = { id: 's', title: 'T', intro: 'i', checkpointPrompt: 'c' };
    const result = validateCoursePackage(pkg({ ...baseUnit(), deterministicSteps: [noCheck] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('mcq') && e.includes('open'))).toBe(true);
  });

  it('accepts a lesson-opening overview string', () => {
    const unit = { ...baseUnit(), deterministicOverview: 'Today we will learn...', deterministicSteps: [goodStep] };
    expect(validateCoursePackage(pkg(unit)).valid).toBe(true);
  });

  it('the shipped active course validates with its deterministic steps', () => {
    const result = validateCoursePackage(activeCourse);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('every shipped lesson has an opening overview and each step has exactly one check', () => {
    for (const unit of (activeCourse as { units: Array<Record<string, any>> }).units) {
      expect(typeof unit.deterministicOverview).toBe('string');
      expect((unit.deterministicOverview as string).length).toBeGreaterThan(0);
      for (const step of unit.deterministicSteps ?? []) {
        expect(Boolean(step.mcq) !== Boolean(step.open)).toBe(true); // exactly one
      }
    }
  });

  it('no MCQ step reveals its correct answer in the visible pre-answer text', () => {
    // Visible BEFORE the learner answers = intro + example + the MCQ question.
    // The correct answer must not appear there (it may appear in feedback, which
    // is only shown after answering). Open steps have no single correct literal.
    const offenders: string[] = [];
    for (const unit of (activeCourse as { units: Array<{ deterministicSteps?: Array<Record<string, any>> }> }).units) {
      for (const step of unit.deterministicSteps ?? []) {
        if (!step.mcq) continue;
        const visible = `${step.intro} ${step.example ?? ''} ${step.mcq.question}`;
        if (visible.includes(step.mcq.correctAnswer)) offenders.push(`${step.id} → "${step.mcq.correctAnswer}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no open step leaks its rubric (expectedIdea / acceptableAnswers / hint) into visible text', () => {
    // Visible = intro + example + the open question. The rubric is model-side only.
    const offenders: string[] = [];
    for (const unit of (activeCourse as { units: Array<{ deterministicSteps?: Array<Record<string, any>> }> }).units) {
      for (const step of unit.deterministicSteps ?? []) {
        if (!step.open) continue;
        const visible = `${step.intro} ${step.example ?? ''} ${step.open.question}`;
        const leaks = [step.open.expectedIdea, step.open.hint, ...(step.open.acceptableAnswers ?? [])];
        for (const secret of leaks) {
          if (secret && visible.includes(secret)) offenders.push(`${step.id} → "${secret}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
