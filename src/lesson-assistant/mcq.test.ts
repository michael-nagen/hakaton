// ── Lesson Assistant — MCQ tests ─────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { buildMcqPrompt, generateMcq, parseMcq } from './mcq';
import type { LessonContext, TutorAssistantProvider } from './lesson-assistant.types';
import type { LessonMessage } from '../lesson-runtime';

const CONTEXT: LessonContext = {
  lessonTitle: 'What a Variable Is',
  lessonTopic: 'A variable is a named placeholder for a value.',
  currentStepContent: 'Which statement best describes a variable?',
};

const VALID = JSON.stringify({
  question: 'What is a variable?',
  choices: ['A named box for a value', 'A type of loop', 'A print command'],
  correctIndex: 0,
  feedbackCorrect: 'Yes!',
  feedbackIncorrect: 'Think of a labelled box.',
});

describe('parseMcq', () => {
  it('parses a valid JSON MCQ (even wrapped in prose / fences)', () => {
    const mcq = parseMcq('```json\nHere:\n' + VALID + '\n```');
    expect(mcq).not.toBeNull();
    expect(mcq!.choices).toHaveLength(3);
    expect(mcq!.correctIndex).toBe(0);
    expect(mcq!.question).toContain('variable');
  });

  it('rejects fewer than 3 choices or an out-of-range correctIndex', () => {
    expect(parseMcq(JSON.stringify({ question: 'q', choices: ['a', 'b'], correctIndex: 0 }))).toBeNull();
    expect(parseMcq(JSON.stringify({ question: 'q', choices: ['a', 'b', 'c'], correctIndex: 9 }))).toBeNull();
  });

  it('defaults missing feedback and caps to 4 choices', () => {
    const mcq = parseMcq(JSON.stringify({ question: 'q', choices: ['a', 'b', 'c', 'd', 'e'], correctIndex: 1 }));
    expect(mcq!.choices).toHaveLength(4);
    expect(mcq!.feedbackCorrect.length).toBeGreaterThan(0);
    expect(mcq!.feedbackIncorrect.length).toBeGreaterThan(0);
  });

  it('returns null for non-JSON', () => {
    expect(parseMcq('sorry, no json here')).toBeNull();
  });
});

describe('buildMcqPrompt', () => {
  const msgs: LessonMessage[] = [{ role: 'tutor', content: 'hi' }, { role: 'student', content: 'ok' }];

  it('includes the step content + short topic and asks for JSON', () => {
    const p = buildMcqPrompt({ lessonContext: CONTEXT, recentMcqQuestions: [], recentMessages: msgs });
    expect(p).toContain(CONTEXT.currentStepContent!);
    expect(p).toContain('What a Variable Is');
    expect(p).toContain('JSON');
  });

  it('lists recent questions to avoid', () => {
    const p = buildMcqPrompt({ lessonContext: CONTEXT, recentMcqQuestions: ['Old Q1', 'Old Q2'], recentMessages: [] });
    expect(p).toContain('Old Q1');
    expect(p).toContain('Old Q2');
  });
});

describe('generateMcq', () => {
  it('calls the assistant provider and returns a parsed MCQ', async () => {
    let capturedPrompt = '';
    const assistant: TutorAssistantProvider = {
      complete: async ({ prompt }) => {
        capturedPrompt = prompt;
        return VALID;
      },
    };
    const mcq = await generateMcq({ assistant, lessonContext: CONTEXT, recentMcqQuestions: ['Prev question'] });
    expect(mcq.question).toBe('What is a variable?');
    expect(capturedPrompt).toContain('Prev question'); // avoid-repeat context forwarded
  });

  it('throws when the model reply cannot be parsed', async () => {
    const assistant: TutorAssistantProvider = { complete: async () => 'not json' };
    await expect(generateMcq({ assistant, lessonContext: CONTEXT })).rejects.toThrow();
  });
});
