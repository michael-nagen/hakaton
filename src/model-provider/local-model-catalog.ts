// ── Model Provider — local model catalog ─────────────────────────────
//
// Metadata for on-device models the offline path can offer. This is a catalog
// only — it does NOT run inference (see local-model.provider.ts). Kept runtime-
// agnostic (`format` stays open) so we're not locked into one local runtime.
// `downloadUrl` is nullable and `installStatus` is modelled up-front so real
// download/install state can be wired in later without reshaping callers.

export type LocalModelFormat = 'gguf' | 'mlc' | 'onnx' | 'litert' | 'gguf_or_runtime_specific' | 'other';

export type LocalModelFamily = 'gemma' | 'llama' | 'qwen' | 'other';

/**
 * Lifecycle of a local model on THIS device. Only `metadata_only` is reachable
 * today (no runtime); the rest exist so the UI and provider can grow into real
 * download/install handling without a type change.
 */
export type LocalModelInstallStatus =
  | 'not_installed'
  | 'metadata_only'
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
  minRamGb?: number;
  recommendedRamGb?: number;
  /** Human-readable quality note for the card. */
  qualityLabel: string;
  modelFamily: LocalModelFamily;
  /** Current install lifecycle state (metadata_only until a runtime exists). */
  installStatus: LocalModelInstallStatus;
  format: LocalModelFormat;
  /** Final download URL — intentionally null until a download strategy exists. */
  downloadUrl: string | null;
};

/**
 * Offered local models, lightest first. Sizes/RAM are representative Q4 figures
 * for UI copy. No download URLs yet — inference runtime is not implemented, so
 * every entry is `metadata_only`.
 */
export const LOCAL_MODEL_CATALOG: readonly LocalModelConfig[] = [
  {
    id: 'gemma-fast-offline',
    displayName: 'Gemma Fast Offline',
    shortLabel: 'Fast Offline',
    description: 'Small and fast local model for basic tutor flow.',
    estimatedSizeMb: 1000,
    minRamGb: 4,
    recommendedRamGb: 6,
    qualityLabel: 'Fastest',
    modelFamily: 'gemma',
    installStatus: 'metadata_only',
    format: 'gguf_or_runtime_specific',
    downloadUrl: null,
  },
  {
    id: 'llama-better-offline',
    displayName: 'Llama 3.2 3B Better Offline',
    shortLabel: 'Better Offline',
    description: 'Better English tutor quality, stronger device required.',
    estimatedSizeMb: 2200,
    minRamGb: 6,
    recommendedRamGb: 8,
    qualityLabel: 'Better tutor quality',
    modelFamily: 'llama',
    installStatus: 'metadata_only',
    format: 'gguf_or_runtime_specific',
    downloadUrl: null,
  },
];

export function getLocalModelById(params: { id: string }): LocalModelConfig | undefined {
  return LOCAL_MODEL_CATALOG.find((m) => m.id === params.id);
}

/** The default/lightest model id offered first. */
export const DEFAULT_LOCAL_MODEL_ID = LOCAL_MODEL_CATALOG[0]?.id ?? '';

/** Short human label for an install status, for status badges/cards. */
export function localInstallStatusLabel(status: LocalModelInstallStatus): string {
  switch (status) {
    case 'installed':
      return 'Installed';
    case 'downloading':
      return 'Downloading';
    case 'not_installed':
      return 'Not installed';
    case 'error':
      return 'Error';
    case 'runtime_missing':
    case 'metadata_only':
      return 'Runtime not installed yet';
  }
}
