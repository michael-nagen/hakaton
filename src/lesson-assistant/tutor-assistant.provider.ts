// ── Lesson Assistant — TutorAssistantProvider over the app's ModelProvider ─
//
// The text helper actions need a plain "prompt in → text out" seam. The app
// already has exactly that: ModelProvider.generateText. This adapter wraps the
// active ModelProvider so the assistant layer never re-invents a provider or
// touches the tutor JSON contract (helper replies are free-form text).

import type { ModelProvider } from '../model-provider';
import type { TutorAssistantProvider } from './lesson-assistant.types';

export function createModelTutorAssistantProvider(params: { modelProvider: ModelProvider }): TutorAssistantProvider {
  return {
    complete: ({ prompt }) => params.modelProvider.generateText({ prompt }),
  };
}
