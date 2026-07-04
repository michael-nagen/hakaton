// ── Lesson Assistant — service ───────────────────────────────────────
//
// Centralizes the four helper actions. The UI/hook calls this; it fans out to
// the text provider (Explain / Example / Side question) and the video provider
// (Watch video). It owns NO lesson state and never touches progress — helper
// actions are read-only assists over the current context.

import {
  buildExplainSimplerPrompt,
  buildGiveExamplePrompt,
  buildChallengePrompt,
} from './lesson-assistant.prompts';
import type { LessonAssistantService, LessonVideoProvider, TutorAssistantProvider } from './lesson-assistant.types';

export function createLessonAssistantService(params: {
  assistant: TutorAssistantProvider;
  video: LessonVideoProvider;
}): LessonAssistantService {
  const { assistant, video } = params;
  return {
    explainSimpler: ({ lessonContext, lastThreeMessages, teachingPreference }) =>
      assistant.complete({ prompt: buildExplainSimplerPrompt({ lessonContext, lastThreeMessages, teachingPreference }) }),

    giveExample: ({ lessonContext, lastThreeMessages, teachingPreference }) =>
      assistant.complete({ prompt: buildGiveExamplePrompt({ lessonContext, lastThreeMessages, teachingPreference }) }),

    askChallenge: ({ lessonContext, transcript, studentAnswer, teachingPreference }) =>
      assistant.complete({ prompt: buildChallengePrompt({ lessonContext, transcript, studentAnswer, teachingPreference }) }),

    getRecommendedVideo: ({ lessonContext, teachingPreference }) => video.findRelevantVideo({ lessonContext, teachingPreference }),
  };
}
