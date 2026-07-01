/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Default OpenRouter model slug for the tutor runtime. OpenRouter's free
   * models change over time, so this stays configurable rather than hardcoded.
   * Falls back to "openrouter/free" when unset.
   */
  readonly VITE_FREE_OPENROUTER_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
