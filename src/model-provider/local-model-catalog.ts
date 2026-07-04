// ── Model Provider — local model catalog ─────────────────────────────
//
// Metadata for on-device models the offline path can offer. This is a catalog
// only — it does NOT run inference (see local-model.provider.ts) and does not
// itself hold download state (see local-model-state.ts). Kept runtime-agnostic
// so we're not locked into one local runtime. `downloadUrl` is nullable: until
// an official file URL is configured here, the UI shows "Download URL not
// configured yet" and downloads stay disabled. Adding a real URL later is a
// pure catalog change — no other code moves.

export type LocalModelFormat = 'gguf' | 'mlc' | 'onnx' | 'litert' | 'gguf_or_runtime_specific' | 'other';

export type LocalModelFamily = 'gemma' | 'llama' | 'qwen' | 'other';

/**
 * Lifecycle of a local model on THIS device. `download_url_missing` is the
 * baseline while no URL is configured; the rest are reached via the download
 * manager + persisted state. `runtime_missing` means the file is present but no
 * inference runtime exists yet.
 */
export type LocalModelInstallStatus =
  | 'not_installed'
  | 'download_url_missing'
  | 'downloading'
  | 'installed'
  | 'runtime_missing'
  | 'error';

export type LocalModelConfig = {
  id: string;
  displayName: string;
  /** Short chip label, e.g. "Fast Offline". */
  shortLabel: string;
  description: string;
  /** Approximate download size in MB. */
  estimatedSizeMb: number;
  minRamGb: number;
  recommendedRamGb: number;
  /** Human-readable quality note for the card. */
  qualityLabel: string;
  modelFamily: LocalModelFamily;
  /** Baseline status derived from config (download_url_missing until a URL is set). */
  installStatus: LocalModelInstallStatus;
  format: 'gguf_or_runtime_specific';
  /**
   * WebLLM (MLC) model id this maps to. When set, the on-device runtime
   * (WebLLM/WebGPU) can actually run it — WebLLM fetches + caches the weights
   * itself, so `downloadUrl` stays null and is unused for these models.
   */
  webllmModelId?: string;
  /** Final download URL — null until an official model file URL is configured. */
  downloadUrl: string | null;
  /** File name to store the download under. */
  fileName?: string;
  /** Optional integrity checksum for the downloaded file. */
  checksumSha256?: string | null;
  /** Target inference runtime, from the manifest (informational until a runtime ships). */
  runtime?: string;
  /** Provenance of the download URL — should be "approved" for anything shippable. */
  source?: string;
  /** License note; must be cleared before a real URL is shipped. */
  license?: string;
};

/**
 * Offered local models, lightest first. Sizes/RAM are representative Q4 figures
 * for UI copy. `downloadUrl` is intentionally null — we do not ship unofficial
 * model URLs. Set these to official URLs when chosen; nothing else changes.
 */
export const LOCAL_MODEL_CATALOG: readonly LocalModelConfig[] = [
  {
    id: 'gemma-fast-offline',
    displayName: 'Gemma 2 2B (offline)',
    shortLabel: 'Fast Offline',
    description: 'Small, fast on-device model (runs in-browser via WebGPU).',
    estimatedSizeMb: 1500,
    minRamGb: 4,
    recommendedRamGb: 6,
    qualityLabel: 'Fastest',
    modelFamily: 'gemma',
    installStatus: 'not_installed',
    format: 'gguf_or_runtime_specific',
    webllmModelId: 'gemma-2-2b-it-q4f16_1-MLC',
    downloadUrl: null,
    fileName: 'gemma-fast-offline.gguf',
    checksumSha256: null,
  },
  {
    id: 'llama-better-offline',
    displayName: 'Llama 3.2 3B (offline)',
    shortLabel: 'Better Offline',
    description: 'Better tutor quality; runs in-browser via WebGPU, stronger device required.',
    estimatedSizeMb: 2200,
    minRamGb: 6,
    recommendedRamGb: 8,
    qualityLabel: 'Better tutor quality',
    modelFamily: 'llama',
    installStatus: 'not_installed',
    format: 'gguf_or_runtime_specific',
    webllmModelId: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    downloadUrl: null,
    fileName: 'llama-3.2-3b-instruct-q4.gguf',
    checksumSha256: null,
  },
];

export function getLocalModelById(params: { id: string }): LocalModelConfig | undefined {
  return LOCAL_MODEL_CATALOG.find((m) => m.id === params.id);
}

/**
 * The default on-device model id.
 *
 * LOCKED DEFAULT (2026-07-02): evaluation on the local WebLLM path found
 * Llama 3.2 3B the best-performing local tutor model, so it is the default the
 * local provider uses when a session does not name one — NOT the lightest
 * (Gemma) entry. The catalog ORDER is unchanged (the UI still lists models
 * lightest-first); only the default the offline runtime resolves to changed.
 * This constant is read only by the local provider, never by the setup UI.
 * The full locked local-device setup lives in
 * src/lesson-runtime/local-tutor-defaults.ts.
 */
export const DEFAULT_LOCAL_MODEL_ID =
  LOCAL_MODEL_CATALOG.find((m) => m.id === 'llama-better-offline')?.id ?? LOCAL_MODEL_CATALOG[0]?.id ?? '';

/** Short human label for an install status, for status badges/cards. */
export function localInstallStatusLabel(status: LocalModelInstallStatus): string {
  switch (status) {
    case 'installed':
      return 'Downloaded';
    case 'downloading':
      return 'Downloading';
    case 'not_installed':
      return 'Not installed';
    case 'download_url_missing':
      return 'Download URL not configured yet';
    case 'runtime_missing':
      return 'Runtime not installed yet';
    case 'error':
      return 'Download failed';
  }
}
