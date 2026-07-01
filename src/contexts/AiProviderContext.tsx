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

const STORAGE_KEY = 'maestro.aiProvider';

const DISPLAY_NAMES: Record<AiProviderType, string> = {
  built_in: 'Built-in AI',
  gemini_byok: 'Gemini (your key)',
  openrouter_byok: 'OpenRouter (your key)',
  local_model: 'Local model (offline)',
  custom: 'Custom provider',
};

/** The safe default: built-in, no key, works immediately. */
export function defaultAiProviderConfig(): AiProviderConfig {
  return { type: 'built_in', displayName: DISPLAY_NAMES.built_in, enabled: true };
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
}

const AiProviderContext = createContext<AiProviderContextValue | null>(null);

export function AiProviderProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AiProviderConfig>(() => loadConfig());

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
  };

  return <AiProviderContext.Provider value={value}>{children}</AiProviderContext.Provider>;
}

export function useAiProvider(): AiProviderContextValue {
  const ctx = useContext(AiProviderContext);
  if (!ctx) throw new Error('useAiProvider must be used within AiProviderProvider');
  return ctx;
}
