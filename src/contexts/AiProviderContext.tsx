// ── AI Provider — config store ───────────────────────────────────────
//
// The single source of truth for "how does the tutor run right now?". Holds the
// active AiProviderConfig, persists it on-device (localStorage), and derives the
// live ModelProvider + TutorProvider from it. Any page reads the active provider
// from here, so switching provider never touches lesson logic.
//
// Security (MVP): API keys live ONLY in localStorage on the user's device (never
// sent to our backend) and are never logged. clearAiProvider() deletes them.
//
// ⚠️ localStorage is an MVP choice, NOT a production-grade secret store: it is
// plaintext, readable by any script on this origin (so an XSS bug would leak the
// key), and not encrypted at rest. This is acceptable for BYOK where the key is
// the user's own low-privilege free-tier key and never leaves their device.
// Production hardening (Phase 3) should move to an encrypted vault / OAuth-PKCE
// (OpenRouter) / backend-brokered short-lived tokens — tracked in the plan.

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AiProviderConfig, AiProviderType, ModelProvider } from '../model-provider';
import { createModelProviderFromConfig } from '../model-provider';
import { createTutorProvider } from '../tutor-runtime';
import type { TutorProvider } from '../tutor-runtime';
import { resolveTutorStrategy } from '../lesson-runtime/tutor-strategy';
import type { TutorRuntimeStrategy } from '../lesson-runtime/tutor-strategy';
import { resolveLessonFlowMode } from '../lesson-runtime/lesson-flow-mode';
import type { LessonFlowMode } from '../lesson-runtime/lesson-flow-mode';

const STORAGE_KEY = 'maestro.aiProvider';
const STRATEGY_STORAGE_KEY = 'maestro.tutorStrategy';
const COMPLETION_STORAGE_KEY = 'maestro.lessonCompletion';
const FLOW_MODE_STORAGE_KEY = 'maestro.lessonFlowMode';

const DISPLAY_NAMES: Record<AiProviderType, string> = {
  gemini_byok: 'Gemini (your key)',
  openrouter_byok: 'OpenRouter (your key)',
  local_model: 'Local model (offline)',
  custom: 'Custom provider',
};

/**
 * The default: Gemini BYOK with no key yet. There is no mock/offline fallback —
 * the tutor only runs on a real provider, so this reads as "needs setup" on the
 * AI setup screen until the user connects one.
 */
export function defaultAiProviderConfig(): AiProviderConfig {
  return { type: 'gemini_byok', displayName: DISPLAY_NAMES.gemini_byok, enabled: true };
}

function loadConfig(): AiProviderConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultAiProviderConfig();
    const parsed = JSON.parse(raw) as Partial<AiProviderConfig>;
    if (!parsed.type || !(parsed.type in DISPLAY_NAMES)) return defaultAiProviderConfig();
    return {
      type: parsed.type,
      displayName: parsed.displayName ?? DISPLAY_NAMES[parsed.type],
      enabled: parsed.enabled ?? true,
      model: parsed.model,
      apiKeyStorage: parsed.apiKeyStorage,
      apiKey: parsed.apiKey,
      baseUrl: parsed.baseUrl,
    };
  } catch {
    return defaultAiProviderConfig();
  }
}

function persist(config: AiProviderConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Non-fatal: config still lives in memory for this session.
  }
}

/** Object-arg mutation, per spec: setAiProvider({ type, apiKey, model, ... }). */
export interface SetAiProviderArgs {
  type: AiProviderType;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  displayName?: string;
}

interface AiProviderContextValue {
  config: AiProviderConfig;
  setAiProvider: (args: SetAiProviderArgs) => void;
  clearAiProvider: () => void;
  /** Live transport for the active config, or null if it can't be built (e.g. missing key). */
  activeModelProvider: ModelProvider | null;
  /** Live tutor seam for the active config, or null if the transport can't be built. */
  activeTutorProvider: TutorProvider | null;
  /** Set when the active config is incomplete/invalid (safe message, no secrets). */
  providerError: string | null;
  /** How the lesson runtime wraps the model call (persisted; default single_tutor). */
  tutorStrategy: TutorRuntimeStrategy;
  setTutorStrategy: (strategy: TutorRuntimeStrategy) => void;
  /**
   * Whether the tutor may finish a lesson (persisted; default true). When false
   * the lesson stays open forever — no "finish" tool, no "completed" state.
   */
  lessonCompletionEnabled: boolean;
  setLessonCompletionEnabled: (enabled: boolean) => void;
  /**
   * Which lesson experience the player runs (persisted; default 'current').
   * 'deterministic_steps' opts into the app-controlled prepared-step flow;
   * lessons without deterministic data fall back to the current flow.
   */
  lessonFlowMode: LessonFlowMode;
  setLessonFlowMode: (mode: LessonFlowMode) => void;
}

const AiProviderContext = createContext<AiProviderContextValue | null>(null);

export function AiProviderProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AiProviderConfig>(() => loadConfig());
  const [tutorStrategy, setTutorStrategyState] = useState<TutorRuntimeStrategy>(() => {
    try {
      return resolveTutorStrategy(localStorage.getItem(STRATEGY_STORAGE_KEY));
    } catch {
      return resolveTutorStrategy(undefined);
    }
  });

  const setTutorStrategy = useCallback((strategy: TutorRuntimeStrategy) => {
    const next = resolveTutorStrategy(strategy);
    setTutorStrategyState(next);
    try {
      localStorage.setItem(STRATEGY_STORAGE_KEY, next);
    } catch {
      // Non-fatal: strategy still lives in memory for this session.
    }
  }, []);

  // Lesson completion is enabled unless the user explicitly turned it off
  // (persisted as the string 'false'); any other/absent value means enabled.
  const [lessonCompletionEnabled, setCompletionState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COMPLETION_STORAGE_KEY) !== 'false';
    } catch {
      return true;
    }
  });

  const setLessonCompletionEnabled = useCallback((enabled: boolean) => {
    setCompletionState(enabled);
    try {
      localStorage.setItem(COMPLETION_STORAGE_KEY, String(enabled));
    } catch {
      // Non-fatal: the choice still lives in memory for this session.
    }
  }, []);

  // Lesson flow mode — persisted like the other small runtime prefs. Default
  // 'current' so behavior is unchanged until the user opts into the new flow.
  const [lessonFlowMode, setFlowModeState] = useState<LessonFlowMode>(() => {
    try {
      return resolveLessonFlowMode(localStorage.getItem(FLOW_MODE_STORAGE_KEY));
    } catch {
      return resolveLessonFlowMode(undefined);
    }
  });

  const setLessonFlowMode = useCallback((mode: LessonFlowMode) => {
    const next = resolveLessonFlowMode(mode);
    setFlowModeState(next);
    try {
      localStorage.setItem(FLOW_MODE_STORAGE_KEY, next);
    } catch {
      // Non-fatal: the choice still lives in memory for this session.
    }
  }, []);

  const setAiProvider = useCallback((args: SetAiProviderArgs) => {
    const next: AiProviderConfig = {
      type: args.type,
      displayName: args.displayName ?? DISPLAY_NAMES[args.type],
      enabled: true,
      model: args.model,
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
      // Any user-provided key is kept on-device only.
      apiKeyStorage: args.apiKey ? 'local_device' : 'none',
    };
    setConfig(next);
    persist(next);
  }, []);

  const clearAiProvider = useCallback(() => {
    const next = defaultAiProviderConfig();
    setConfig(next);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const { activeModelProvider, activeTutorProvider, providerError } = useMemo(() => {
    try {
      const modelProvider = createModelProviderFromConfig({ config });
      return {
        activeModelProvider: modelProvider,
        activeTutorProvider: createTutorProvider({ modelProvider }),
        providerError: null as string | null,
      };
    } catch (err) {
      return {
        activeModelProvider: null,
        activeTutorProvider: null,
        providerError: err instanceof Error ? err.message : 'Provider is not fully configured.',
      };
    }
  }, [config]);

  const value: AiProviderContextValue = {
    config,
    setAiProvider,
    clearAiProvider,
    activeModelProvider,
    activeTutorProvider,
    providerError,
    tutorStrategy,
    setTutorStrategy,
    lessonCompletionEnabled,
    setLessonCompletionEnabled,
    lessonFlowMode,
    setLessonFlowMode,
  };

  return <AiProviderContext.Provider value={value}>{children}</AiProviderContext.Provider>;
}

export function useAiProvider(): AiProviderContextValue {
  const ctx = useContext(AiProviderContext);
  if (!ctx) throw new Error('useAiProvider must be used within AiProviderProvider');
  return ctx;
}
