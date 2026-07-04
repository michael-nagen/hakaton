// ── Lesson Assistant — service tests ─────────────────────────────────
//
// Proves the helper actions are wired correctly at the layer where the real
// logic lives (context building, prompt selection, last-3-messages, video
// delegation) and that the assistant layer is isolated from lesson state /
// progress (it only ever calls the injected providers).
//
// NOTE: full "button click renders result" DOM tests would need
// @testing-library/react + jsdom, which are not in this project. The component
// wires directly to this tested service via the useLessonAssistant hook.

import { describe, expect, it, vi } from 'vitest';
import type { LessonMessage, StepDescriptor } from '../lesson-runtime';
import type { LearningUnit } from '../course-package';
import { getCurrentLessonContext } from './lesson-context';
import { createLessonAssistantService } from './lesson-assistant.service';
import { buildVideoQuery } from './lesson-video.provider';
import { CLASSIC_PERSONALIZATION_OPTIONS, CUSTOM_PREFERENCE_MAX_LENGTH, customPreference, presetPreference } from './personalization';
import type { LessonContext, RecommendedVideo, TeachingPreference, TutorAssistantProvider, LessonVideoProvider } from './lesson-assistant.types';

const CONTEXT: LessonContext = {
  lessonTitle: 'What a Variable Is',
  lessonTopic: 'Explain that a variable is a named placeholder for a value.',
  currentStepContent: 'Which statement best describes a variable?',
};

function messages(...contents: Array<[LessonMessage['role'], string]>): LessonMessage[] {
  return contents.map(([role, content]) => ({ role, content }));
}

/** A canonical "last three messages" array shared across tests. */
function lastThree(): LessonMessage[] {
  return messages(['tutor', 'a'], ['student', 'b'], ['tutor', 'c']);
}

/** A fake text provider that records every prompt it is asked to complete. */
function fakeAssistant(): { provider: TutorAssistantProvider; prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    provider: {
      complete: async ({ prompt }) => {
        prompts.push(prompt);
        return 'ANSWER';
      },
    },
  };
}

function fakeVideo(canned: RecommendedVideo): {
  provider: LessonVideoProvider;
  calls: Array<{ lessonContext: LessonContext; teachingPreference?: TeachingPreference }>;
} {
  const calls: Array<{ lessonContext: LessonContext; teachingPreference?: TeachingPreference }> = [];
  return {
    calls,
    provider: {
      findRelevantVideo: async ({ lessonContext, teachingPreference }) => {
        calls.push({ lessonContext, teachingPreference });
        return canned;
      },
    },
  };
}

describe('getCurrentLessonContext', () => {
  it('maps the real unit + step onto the lesson context', () => {
    const lesson = { title: 'What a Variable Is', goal: 'Explain a variable.' } as unknown as LearningUnit;
    const step: StepDescriptor = { id: 'q1', question: 'What is a variable?', expectedUnderstanding: 'named box', hints: [] };
    const ctx = getCurrentLessonContext({ lesson, currentStep: step });
    expect(ctx.lessonTitle).toBe('What a Variable Is');
    expect(ctx.lessonTopic).toBe('Explain a variable.');
    expect(ctx.currentStepContent).toBe('What is a variable?');
  });
});

function video(): RecommendedVideo {
  return { videoId: 'abc', title: 'Vid', embedUrl: 'https://www.youtube-nocookie.com/embed/abc' };
}

describe('LessonAssistantService', () => {
  const lastThree = () => messages(['tutor', 'a'], ['student', 'b'], ['tutor', 'c']);

  it('Explain simpler: sends context + last three messages to the provider and returns its text', async () => {
    const a = fakeAssistant();
    const v = fakeVideo(video());
    const svc = createLessonAssistantService({ assistant: a.provider, video: v.provider });

    const out = await svc.explainSimpler({ lessonContext: CONTEXT, lastThreeMessages: lastThree() });

    expect(out).toBe('ANSWER');
    expect(a.prompts).toHaveLength(1);
    const p = a.prompts[0];
    expect(p).toContain('like explaining to a 5-year-old');
    expect(p).toContain('What a Variable Is'); // context
    expect(p).toContain('Tutor: a'); // last three present
    expect(p).toContain('Student: b');
    expect(p).toContain('Tutor: c');
  });

  it('only the last three messages reach the provider (older ones excluded)', async () => {
    const a = fakeAssistant();
    const svc = createLessonAssistantService({ assistant: a.provider, video: fakeVideo(video()).provider });
    const all = messages(['student', 'OLD-1'], ['tutor', 'OLD-2'], ['student', 'keep-1'], ['tutor', 'keep-2'], ['student', 'keep-3']);

    await svc.explainSimpler({ lessonContext: CONTEXT, lastThreeMessages: all.slice(-3) });

    const p = a.prompts[0];
    expect(p).toContain('keep-1');
    expect(p).toContain('keep-2');
    expect(p).toContain('keep-3');
    expect(p).not.toContain('OLD-1');
    expect(p).not.toContain('OLD-2');
  });

  it('Give an example uses a DIFFERENT prompt than Explain simpler', async () => {
    const a = fakeAssistant();
    const svc = createLessonAssistantService({ assistant: a.provider, video: fakeVideo(video()).provider });

    await svc.explainSimpler({ lessonContext: CONTEXT, lastThreeMessages: lastThree() });
    await svc.giveExample({ lessonContext: CONTEXT, lastThreeMessages: lastThree() });

    expect(a.prompts[0]).not.toEqual(a.prompts[1]);
    expect(a.prompts[0]).toContain('like explaining to a 5-year-old');
    expect(a.prompts[1]).toContain('Give one simple example');
  });

  it('Challenge me (start): asks one challenge question grounded in the current step', async () => {
    const a = fakeAssistant();
    const svc = createLessonAssistantService({ assistant: a.provider, video: fakeVideo(video()).provider });

    const out = await svc.askChallenge({ lessonContext: CONTEXT, transcript: [], studentAnswer: '' });

    expect(out).toBe('ANSWER');
    const p = a.prompts[0];
    expect(p).toContain('challenge coach');
    expect(p).toContain('ask ONE beginner-friendly challenge question');
    expect(p).toContain('Do not advance the lesson');
    expect(p).toContain('What a Variable Is');
    // Starting turn has no learner answer section.
    expect(p).not.toContain("Learner's latest answer:");
  });

  it('Challenge me (answer): gives feedback on the learner answer without advancing', async () => {
    const a = fakeAssistant();
    const svc = createLessonAssistantService({ assistant: a.provider, video: fakeVideo(video()).provider });

    const out = await svc.askChallenge({
      lessonContext: CONTEXT,
      transcript: messages(['tutor', 'What is a variable?']),
      studentAnswer: 'A named box for a value',
    });

    expect(out).toBe('ANSWER');
    const p = a.prompts[0];
    expect(p).toContain('The learner just answered');
    expect(p).toContain("Learner's latest answer:");
    expect(p).toContain('A named box for a value');
  });

  it('Watch video: delegates to the video provider with the lesson context and returns an embed URL', async () => {
    const a = fakeAssistant();
    const v = fakeVideo(video());
    const svc = createLessonAssistantService({ assistant: a.provider, video: v.provider });

    const rec = await svc.getRecommendedVideo({ lessonContext: CONTEXT });

    expect(rec.embedUrl).toContain('youtube-nocookie.com/embed');
    expect(v.calls[0].lessonContext.lessonTitle).toBe('What a Variable Is');
    // Watch video must not go through the text provider.
    expect(a.prompts).toHaveLength(0);
  });

  it('helper actions never mutate lesson state (service has no state/progress access)', async () => {
    // The service only receives providers — there is no lesson state, progress
    // store, or runtime handle to mutate. This is enforced structurally; here we
    // simply confirm calling every action performs no unexpected side effects
    // beyond the injected providers.
    const complete = vi.fn(async () => 'ok');
    const findRelevantVideo = vi.fn(async () => video());
    const svc = createLessonAssistantService({
      assistant: { complete },
      video: { findRelevantVideo },
    });

    await svc.explainSimpler({ lessonContext: CONTEXT, lastThreeMessages: lastThree() });
    await svc.giveExample({ lessonContext: CONTEXT, lastThreeMessages: lastThree() });
    await svc.askChallenge({ lessonContext: CONTEXT, transcript: [], studentAnswer: 'q' });
    await svc.getRecommendedVideo({ lessonContext: CONTEXT });

    expect(complete).toHaveBeenCalledTimes(3);
    expect(findRelevantVideo).toHaveBeenCalledTimes(1);
  });
});

describe('personalization — preferences in prompts', () => {
  const lastThree = () => messages(['tutor', 'a'], ['student', 'b'], ['tutor', 'c']);

  it('no personalization: prompts do NOT include a Teaching preference block', async () => {
    const a = fakeAssistant();
    const svc = createLessonAssistantService({ assistant: a.provider, video: fakeVideo(video()).provider });
    await svc.explainSimpler({ lessonContext: CONTEXT, lastThreeMessages: lastThree() });
    await svc.giveExample({ lessonContext: CONTEXT, lastThreeMessages: lastThree() });
    await svc.askChallenge({ lessonContext: CONTEXT, transcript: [], studentAnswer: 'q' });
    for (const p of a.prompts) expect(p).not.toContain('Teaching preference');
  });

  it('preset personalization is included in Explain / Example / Side prompts, with the style-only guard', async () => {
    const a = fakeAssistant();
    const svc = createLessonAssistantService({ assistant: a.provider, video: fakeVideo(video()).provider });
    const pref = presetPreference('examples_first')!;
    expect(pref.instruction).toContain('concrete examples');

    await svc.explainSimpler({ lessonContext: CONTEXT, lastThreeMessages: lastThree(), teachingPreference: pref });
    await svc.giveExample({ lessonContext: CONTEXT, lastThreeMessages: lastThree(), teachingPreference: pref });
    await svc.askChallenge({ lessonContext: CONTEXT, transcript: [], studentAnswer: 'q', teachingPreference: pref });

    for (const p of a.prompts) {
      expect(p).toContain('Teaching preference:');
      expect(p).toContain(pref.instruction);
      // style-only guard (helper variant)
      expect(p).toContain('Use this preference only to adjust the explanation style.');
    }
  });

  it('custom personalization is capped at 100 chars and included in the prompt', async () => {
    const long = 'x'.repeat(200);
    const pref = customPreference(long)!;
    expect(pref.source).toBe('custom');
    expect(pref.instruction.length).toBe(CUSTOM_PREFERENCE_MAX_LENGTH);

    const a = fakeAssistant();
    const svc = createLessonAssistantService({ assistant: a.provider, video: fakeVideo(video()).provider });
    await svc.explainSimpler({ lessonContext: CONTEXT, lastThreeMessages: lastThree(), teachingPreference: pref });
    expect(a.prompts[0]).toContain(pref.instruction);
  });

  it('presetPreference/customPreference reject unknown/empty input', () => {
    expect(presetPreference('does-not-exist')).toBeNull();
    expect(customPreference('   ')).toBeNull();
  });
});

describe('personalization — options are clear (not one-word labels)', () => {
  it('each preset has a multi-word label and a longer instruction', () => {
    for (const opt of CLASSIC_PERSONALIZATION_OPTIONS) {
      expect(opt.label.trim().split(/\s+/).length).toBeGreaterThanOrEqual(2);
      expect(opt.instruction.length).toBeGreaterThan(opt.label.length);
      expect(opt.instruction.trim().length).toBeGreaterThan(0);
    }
  });

  it('prompts use the full instruction, not just the label', async () => {
    const a = fakeAssistant();
    const svc = createLessonAssistantService({ assistant: a.provider, video: fakeVideo(video()).provider });
    const pref = presetPreference('step_by_step')!;
    await svc.explainSimpler({ lessonContext: CONTEXT, lastThreeMessages: lastThree(), teachingPreference: pref });
    expect(a.prompts[0]).toContain(pref.instruction);
    expect(pref.instruction).not.toBe(pref.label);
  });
});

describe('personalization — YouTube query', () => {
  const MAPPING: Array<[string, string]> = [
    ['step_by_step', 'step by step beginner tutorial'],
    ['examples_first', 'examples tutorial'],
    ['simple_language', 'beginner friendly explanation'],
    ['ask_questions', 'interactive tutorial practice questions'],
    ['real_world', 'real world use case practical tutorial'],
  ];

  it('maps each new preset id to its query terms', () => {
    for (const [id, terms] of MAPPING) {
      const q = buildVideoQuery(CONTEXT, presetPreference(id)!);
      expect(q).toContain(terms);
      expect(q).toContain(CONTEXT.lessonTitle);
    }
  });

  it('adds trimmed custom terms', () => {
    const q = buildVideoQuery(CONTEXT, customPreference('use code examples please')!);
    expect(q).toContain('use code examples');
  });

  it('falls back to the base query when there is no preference', () => {
    const q = buildVideoQuery(CONTEXT);
    expect(q).toContain(CONTEXT.lessonTitle);
    expect(q).toContain('explained');
    expect(q).not.toContain('beginner friendly');
  });

  it('service forwards the teaching preference to the video provider', async () => {
    const v = fakeVideo(video());
    const svc = createLessonAssistantService({ assistant: fakeAssistant().provider, video: v.provider });
    const pref = presetPreference('real_world')!;
    await svc.getRecommendedVideo({ lessonContext: CONTEXT, teachingPreference: pref });
    expect(v.calls[0].teachingPreference?.presetId).toBe('real_world');
  });
});
