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
  /** Final download URL — null until an official model file URL is configured. */
  downloadUrl: string | null;
  /** File name to store the download under. */
  fileName?: string;
  /** Optional integrity checksum for the downloaded file. */
  checksumSha256?: string | null;
};

/**
 * Offered local models, lightest first. Sizes/RAM are representative Q4 figures
 * for UI copy. `downloadUrl` is intentionally null — we do not ship unofficial
 * model URLs. Set these to official URLs when chosen; nothing else changes.
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
    installStatus: 'download_url_missing',
    format: 'gguf_or_runtime_specific',
    downloadUrl: null,
    fileName: 'gemma-fast-offline.gguf',
    checksumSha256: null,
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
    installStatus: 'download_url_missing',
    format: 'gguf_or_runtime_specific',
    downloadUrl: null,
    fileName: 'llama-3.2-3b-better-offline.gguf',
    checksumSha256: null,
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
