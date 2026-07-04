// ── useLessonAssistant — bind the helper-action service to the active provider ─
//
// Keeps the heavy logic (prompts, provider calls, video search) OUT of the
// lesson-player component. The component calls these thin handlers; each returns
// text/video from the LessonAssistantService, which is built over the ACTIVE
// ModelProvider (selected on the Choose-AI-Guide screen) + the YouTube provider.
//
// `ready` is false when no provider is configured; the text actions then reject
// with NO_PROVIDER so the UI can show a friendly "choose a guide first" message.
// Video search does not need a model provider, so it always works.

import { useMemo } from 'react';
import { useAiProvider } from '../contexts/AiProviderContext';
import {
  createLessonAssistantService,
  createModelTutorAssistantProvider,
  createYouTubeLessonVideoProvider,
} from '../lesson-assistant';
import type { LessonAssistantService, TutorAssistantProvider } from '../lesson-assistant';

export const NO_PROVIDER = 'NO_PROVIDER';

export interface UseLessonAssistant {
  service: LessonAssistantService;
  /** True when a model provider is configured (text actions can run). */
  ready: boolean;
}

export function useLessonAssistant(): UseLessonAssistant {
  const { activeModelProvider } = useAiProvider();

  return useMemo(() => {
    const assistant: TutorAssistantProvider = activeModelProvider
      ? createModelTutorAssistantProvider({ modelProvider: activeModelProvider })
      : { complete: () => Promise.reject(new Error(NO_PROVIDER)) };
    const service = createLessonAssistantService({
      assistant,
      video: createYouTubeLessonVideoProvider(),
    });
    return { service, ready: activeModelProvider !== null };
  }, [activeModelProvider]);
}
