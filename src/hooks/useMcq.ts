// ── useMcq — optional MCQ practice question (local model path) ────────
//
// Separate from the deterministic lesson flow. Builds an MCQ generator over the
// ACTIVE ModelProvider (the local model when Local AI is selected) and keeps the
// small amount of state the UI needs. Tracks the last 2 generated questions so
// the next one avoids repeats. Never touches lesson progress.

import { useMemo, useRef, useState } from 'react';
import { useAiProvider } from '../contexts/AiProviderContext';
import { createModelTutorAssistantProvider, generateMcq } from '../lesson-assistant';
import type { GeneratedMcq, LessonContext } from '../lesson-assistant';
import type { LessonMessage } from '../lesson-runtime';

export interface UseMcq {
  mcq: GeneratedMcq | null;
  loading: boolean;
  error: string | null;
  /** True when a model provider is configured. */
  ready: boolean;
  /** Generate a fresh MCQ for the current step (avoids the last 2). */
  generate: (input: { lessonContext: LessonContext; recentMessages?: LessonMessage[] }) => Promise<void>;
  /** Clear the current MCQ (does not clear the avoid-repeat history). */
  reset: () => void;
}

const GENERIC_ERROR = 'Could not generate a practice question. Please try again.';
const NO_PROVIDER_ERROR = 'Choose an AI guide first to generate a practice question.';

export function useMcq(): UseMcq {
  const { activeModelProvider } = useAiProvider();
  const ready = activeModelProvider !== null;

  const assistant = useMemo(
    () => (activeModelProvider ? createModelTutorAssistantProvider({ modelProvider: activeModelProvider }) : null),
    [activeModelProvider],
  );

  const [mcq, setMcq] = useState<GeneratedMcq | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Question text of the last ≤2 MCQs, to avoid repeats across generations.
  const recentQuestions = useRef<string[]>([]);

  const generate: UseMcq['generate'] = async ({ lessonContext, recentMessages }) => {
    if (loading) return;
    if (!assistant) {
      setError(NO_PROVIDER_ERROR);
      return;
    }
    setError(null);
    setLoading(true);
    setMcq(null);
    try {
      const result = await generateMcq({
        assistant,
        lessonContext,
        recentMcqQuestions: recentQuestions.current,
        recentMessages,
      });
      setMcq(result);
      recentQuestions.current = [...recentQuestions.current, result.question].slice(-2);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setMcq(null);
    setError(null);
  };

  return { mcq, loading, error, ready, generate, reset };
}
