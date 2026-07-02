// ── Lesson Runtime — strategy behavior tests ─────────────────────────
//
// Pure-runtime tests (no DOM): the strategy layer wraps a mocked TutorProvider,
// so we can assert exactly what each strategy sends to the model and what it
// lets through to the learner. Run with `npm test` (vitest, node environment).

import { describe, expect, it, vi } from 'vitest';
import type { LearningUnit } from '../course-package';
import type { TutorInput, TutorProvider, TutorResponse } from '../tutor-runtime';
import { runLessonTurn } from './lesson-session';
import { initLessonState } from './lesson-state';
import { guardTutorResponse } from './tutor-guard';
import { buildLessonSteps } from './lesson-steps';
import { DEFAULT_TUTOR_STRATEGY, resolveTutorStrategy } from './tutor-strategy';

// ── Fixtures ─────────────────────────────────────────────────────────

const ANSWER = 'renting servers and storage from another company instead of buying hardware';

const UNIT: LearningUnit = {
  id: 'u1',
  title: 'What the cloud is',
  goal: 'Explain what cloud computing means.',
  order: 1,
  teacherBrain: {
    persona: 'patient tutor',
    tone: 'friendly',
    objectives: ['Understand renting vs owning'],
    guidelines: [],
    constraints: [],
  },
  knowledgeBaseChunks: [
    {
      id: 'kb1',
      unitId: 'u1',
      title: 'Renting vs owning',
      content: 'Cloud computing means renting servers on demand instead of owning them.',
      tags: ['cloud', 'renting'],
    },
  ],
  questions: [
    { id: 'q1', prompt: 'What does cloud computing mean?', type: 'open', answer: ANSWER, hints: [] },
    { id: 'q2', prompt: 'Name one benefit of on-demand resources.', type: 'open', answer: 'elasticity and pay as you go pricing model', hints: [] },
  ],
  commonMistakes: [],
};

const GOOD: TutorResponse = {
  messageToStudent: 'Good thinking — can you connect that to renting vs owning?',
  nextAction: 'ask_question',
  studentLevelEstimate: 'beginner',
  confidence: 0.7,
};

/** A reply that dumps the canonical answer while claiming to "hint" (leak). */
const LEAKY: TutorResponse = {
  messageToStudent: `Here's a hint: it is ${ANSWER}.`,
  nextAction: 'give_hint',
  studentLevelEstimate: 'beginner',
  confidence: 0.9,
};

function freshState() {
  return initLessonState({ courseId: 'c1', unit: UNIT });
}

/** Mock provider that returns queued responses and records every TutorInput. */
function mockProvider(queue: TutorResponse[]): TutorProvider & { inputs: TutorInput[] } {
  const inputs: TutorInput[] = [];
  return {
    inputs,
    async generateTutorResponse(input: TutorInput) {
      inputs.push(input);
      const next = queue.shift();
      if (!next) throw new Error('mock queue empty');
      return next;
    },
  };
}

// ── Strategy meta ────────────────────────────────────────────────────

describe('resolveTutorStrategy', () => {
  it('defaults to single_tutor', () => {
    expect(DEFAULT_TUTOR_STRATEGY).toBe('single_tutor');
    expect(resolveTutorStrategy(undefined)).toBe('single_tutor');
    expect(resolveTutorStrategy(null)).toBe('single_tutor');
    expect(resolveTutorStrategy('nonsense')).toBe('single_tutor');
  });

  it('accepts every declared strategy', () => {
    for (const id of ['single_tutor', 'retrieval_first', 'guarded_output', 'repair_pass', 'critic_checker']) {
      expect(resolveTutorStrategy(id)).toBe(id);
    }
  });
});

// ── Guard rules ──────────────────────────────────────────────────────

describe('guardTutorResponse', () => {
  const step = buildLessonSteps(UNIT)[0];

  it('passes a clean guiding reply', () => {
    const report = guardTutorResponse({ response: GOOD, step, studentAnswer: 'I think it is about renting.' });
    expect(report.hasCritical).toBe(false);
  });

  it('flags answer leakage while hinting as critical', () => {
    const report = guardTutorResponse({ response: LEAKY, step, studentAnswer: 'no idea' });
    expect(report.hasCritical).toBe(true);
    expect(report.issues.map((i) => i.rule)).toContain('answer_leak');
  });

  it('flags advancing on a trivial student message as critical', () => {
    const report = guardTutorResponse({
      response: { ...GOOD, nextAction: 'continue' },
      step,
      studentAnswer: 'hi',
    });
    expect(report.issues.map((i) => i.rule)).toContain('advance_without_engagement');
    expect(report.hasCritical).toBe(true);
  });
});

// ── Strategies through runLessonTurn ─────────────────────────────────

describe('runLessonTurn strategies', () => {
  it('single_tutor preserves existing behavior (no runtime extras in the input)', async () => {
    const provider = mockProvider([{ ...GOOD, nextAction: 'continue' }]);
    const result = await runLessonTurn({
      unit: UNIT,
      state: freshState(),
      studentAnswer: 'It means renting servers on demand instead of buying them.',
      tutorProvider: provider,
    });
    expect(result.strategy).toBe('single_tutor');
    expect(provider.inputs).toHaveLength(1);
    expect(provider.inputs[0].lessonContext.referenceSnippets).toBeUndefined();
    expect(provider.inputs[0].lessonContext.runtimeNotes).toBeUndefined();
    expect(result.guard).toBeUndefined();
    // continue → step advanced, existing progression intact
    expect(result.state.currentStepIndex).toBe(1);
    expect(result.state.completedStepIds).toContain('q1');
    expect(result.state.messages[result.state.messages.length - 1]?.content).toBe(GOOD.messageToStudent);
  });

  it('retrieval_first hands runtime-retrieved snippets to the model', async () => {
    const provider = mockProvider([GOOD]);
    await runLessonTurn({
      unit: UNIT,
      state: freshState(),
      studentAnswer: 'Something about renting servers in the cloud?',
      tutorProvider: provider,
      strategy: 'retrieval_first',
    });
    const snippets = provider.inputs[0].lessonContext.referenceSnippets;
    expect(snippets).toBeDefined();
    expect(snippets![0]).toContain('Renting vs owning');
  });

  it('guarded_output reports issues but does not change the answer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = mockProvider([LEAKY]);
    const result = await runLessonTurn({
      unit: UNIT,
      state: freshState(),
      studentAnswer: 'no idea',
      tutorProvider: provider,
      strategy: 'guarded_output',
    });
    expect(result.guard?.hasCritical).toBe(true);
    expect(result.response.messageToStudent).toBe(LEAKY.messageToStudent); // reported, not repaired
    expect(provider.inputs).toHaveLength(1); // never a second call
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('repair_pass rewrites a failing answer and returns the repaired one', async () => {
    const provider = mockProvider([LEAKY, GOOD]);
    const result = await runLessonTurn({
      unit: UNIT,
      state: freshState(),
      studentAnswer: 'no idea',
      tutorProvider: provider,
      strategy: 'repair_pass',
    });
    expect(provider.inputs).toHaveLength(2);
    // The rewrite call carries runtime instructions + the broken draft.
    const notes = provider.inputs[1].lessonContext.runtimeNotes?.join('\n') ?? '';
    expect(notes).toContain('REWRITE REQUIRED');
    expect(notes).toContain(LEAKY.messageToStudent);
    expect(result.revised).toBe(true);
    expect(result.response.messageToStudent).toBe(GOOD.messageToStudent);
    expect(result.guard?.hasCritical).toBe(false);
    // The repaired answer is what lands in the transcript (saved state).
    expect(result.state.messages[result.state.messages.length - 1]?.content).toBe(GOOD.messageToStudent);
  });

  it('repair_pass falls back safely when the rewrite also fails', async () => {
    const provider = mockProvider([LEAKY, LEAKY]);
    const result = await runLessonTurn({
      unit: UNIT,
      state: freshState(),
      studentAnswer: 'no idea',
      tutorProvider: provider,
      strategy: 'repair_pass',
    });
    expect(result.revised).toBe(true);
    // Neither leaky draft reached the learner.
    expect(result.response.messageToStudent).not.toBe(LEAKY.messageToStudent);
    expect(result.guard?.hasCritical).toBe(false);
  });

  it('critic_checker runs a second checking pass and keeps a passing result', async () => {
    const polished = { ...GOOD, messageToStudent: 'Polished: what would renting mean here?' };
    const provider = mockProvider([GOOD, polished]);
    const result = await runLessonTurn({
      unit: UNIT,
      state: freshState(),
      studentAnswer: 'maybe renting?',
      tutorProvider: provider,
      strategy: 'critic_checker',
    });
    expect(provider.inputs).toHaveLength(2);
    expect(provider.inputs[1].lessonContext.runtimeNotes?.join('\n')).toContain('CRITIC CHECK');
    expect(result.response.messageToStudent).toBe(polished.messageToStudent);
  });
});
