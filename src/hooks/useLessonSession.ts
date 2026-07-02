// ── useLessonSession — provider-agnostic lesson binding ──────────────
//
// Binds the framework-free lesson runtime to React and to the ACTIVE provider
// selected in /ai-setup (via AiProviderContext). The page that uses this hook
// never learns which provider is running — it only calls sendStudentMessage().
// Switching provider in /ai-setup transparently changes what the lesson uses,
// because activeTutorProvider comes straight from context.
//
// The lesson page must never crash: transport failures (missing/bad key, local
// model not downloaded, runtime missing, network) are caught here and turned
// into a friendly message with an "Open AI setup" affordance.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CoursePackage, LearningUnit } from '../course-package';
import { useAiProvider } from '../contexts/AiProviderContext';
import type { AiProviderConfig } from '../model-provider';
import {
  buildLessonSteps,
  initLessonState,
  loadProgress,
  runLessonTurn,
  saveProgress,
  clearProgress,
} from '../lesson-runtime';
import type { LessonMessage, LessonSessionState, LessonStatus, StepDescriptor } from '../lesson-runtime';

// Typed errors whose own message is authored to be safe + friendly to display,
// so the lesson shows the SAME copy as the rest of the app (one source of truth)
// instead of a divergent, hand-maintained string.
const DISPLAY_SAFE_ERRORS = new Set([
  'LocalModelFileNotDownloadedError',
  'LocalModelRuntimeNotReadyError',
  'LocalModelRuntimeNotImplementedError',
  'LocalModelWebGpuUnavailableError',
  'RateLimitError',
]);

/** Turn any thrown error into a safe, user-facing message (never leaks secrets). */
function friendlyError(err: unknown): string {
  if (err instanceof Error && DISPLAY_SAFE_ERRORS.has(err.name) && err.message) {
    return err.message;
  }
  // Unknown/transport errors (bad key, network): keep it friendly, no raw internals.
  return 'The tutor could not respond right now. This can happen with a missing or invalid API key or a network issue — open AI setup to check your provider, or try again.';
}

export interface UseLessonSession {
  state: LessonSessionState;
  messages: LessonMessage[];
  status: LessonStatus;
  /** 1-based step position for display, clamped to totalSteps. */
  currentStepNumber: number;
  totalSteps: number;
  currentStep: StepDescriptor | undefined;
  /** Send the learner's message; resolves true if a tutor reply was applied. */
  sendStudentMessage: (text: string) => Promise<boolean>;
  loading: boolean;
  /** Friendly error for the last failed turn, or null. */
  error: string | null;
  dismissError: () => void;
  /** True when a provider transport is built and ready to call. */
  providerReady: boolean;
  /** Active provider config (for the status label). */
  provider: AiProviderConfig;
  resetLesson: () => void;
}

export function useLessonSession(params: {
  course: CoursePackage;
  unit: LearningUnit;
}): UseLessonSession {
  const { course, unit } = params;
  const { activeTutorProvider, providerError, config, tutorStrategy } = useAiProvider();

  const [state, setState] = useState<LessonSessionState>(() =>
    initLessonState({
      courseId: course.id,
      unit,
      persisted: loadProgress({ courseId: course.id, unitId: unit.id }),
    }),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-hydrate when the selected lesson changes (same page, different unit).
  useEffect(() => {
    setState(
      initLessonState({
        courseId: course.id,
        unit,
        persisted: loadProgress({ courseId: course.id, unitId: unit.id }),
      }),
    );
    setError(null);
  }, [course.id, unit]);

  // Keep the latest state readable inside the async send callback.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const providerReady = activeTutorProvider !== null;

  const sendStudentMessage = useCallback(
    async (text: string): Promise<boolean> => {
      const answer = text.trim();
      if (!answer || loading) return false;
      if (!activeTutorProvider) {
        setError(providerError ?? 'No AI provider is ready. Open AI setup to connect one.');
        return false;
      }

      setLoading(true);
      setError(null);
      try {
        const result = await runLessonTurn({
          unit,
          state: stateRef.current,
          studentAnswer: answer,
          tutorProvider: activeTutorProvider,
          // How the runtime wraps the call — selected in /ai-setup. The page
          // stays provider- AND strategy-agnostic; it only sends messages.
          strategy: tutorStrategy,
        });
        setState(result.state);
        saveProgress(result.state);
        return true;
      } catch (e) {
        setError(friendlyError(e));
        return false;
      } finally {
        setLoading(false);
      }
    },
    [activeTutorProvider, providerError, unit, loading, tutorStrategy],
  );

  const resetLesson = useCallback(() => {
    clearProgress({ courseId: course.id, unitId: unit.id });
    setState(initLessonState({ courseId: course.id, unit }));
    setError(null);
  }, [course.id, unit]);

  const totalSteps = state.stepIds.length;
  const currentStep = buildLessonSteps(unit)[state.currentStepIndex];
  const currentStepNumber = Math.min(state.currentStepIndex + 1, totalSteps);

  return {
    state,
    messages: state.messages,
    status: state.status,
    currentStepNumber,
    totalSteps,
    currentStep,
    sendStudentMessage,
    loading,
    error,
    dismissError: () => setError(null),
    providerReady,
    provider: config,
    resetLesson,
  };
}
