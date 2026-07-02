// ── Model Provider — local model install state ───────────────────────
//
// Per-device, per-model download/install state. Small metadata only (status,
// byte counts, error, timestamp) — persisted in localStorage under
// `maestro.localModels.<modelId>`. The actual model BINARY never lives here; it
// goes to LocalModelStorage (IndexedDB). This split keeps localStorage tiny and
// avoids the "don't store large blobs in localStorage" trap.

import type { LocalModelConfig, LocalModelInstallStatus } from './local-model-catalog';

export type LocalModelState = {
  modelId: string;
  status: LocalModelInstallStatus;
  downloadedBytes?: number;
  totalBytes?: number;
  localPath?: string;
  errorMessage?: string;
  /** ISO timestamp of the last update. */
  updatedAt: string;
};

function storageKey(modelId: string): string {
  return `maestro.localModels.${modelId}`;
}

/** Read persisted state for a model, or null if none/unreadable. */
export function readLocalModelState(params: { modelId: string }): LocalModelState | null {
  try {
    const raw = localStorage.getItem(storageKey(params.modelId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalModelState;
    return parsed && typeof parsed.status === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** Persist state for a model (stamps updatedAt). Returns the written state. */
export function writeLocalModelState(params: {
  state: Omit<LocalModelState, 'updatedAt'>;
}): LocalModelState {
  const next: LocalModelState = { ...params.state, updatedAt: new Date().toISOString() };
  try {
    localStorage.setItem(storageKey(next.modelId), JSON.stringify(next));
  } catch {
    // Non-fatal: state stays in memory for this session.
  }
  return next;
}

/** Remove persisted state for a model. */
export function clearLocalModelState(params: { modelId: string }): void {
  try {
    localStorage.removeItem(storageKey(params.modelId));
  } catch {
    // ignore
  }
}

/**
 * The effective status to show, combining catalog config with persisted state:
 *   - runtime-managed (WebLLM) → not URL-gated: persisted status or 'not_installed'
 *   - file-based with no URL    → 'download_url_missing' (overrides stale state)
 *   - persisted state           → its status
 *   - otherwise                 → 'not_installed'
 */
export function effectiveInstallStatus(params: {
  model: LocalModelConfig;
  state: LocalModelState | null;
}): LocalModelInstallStatus {
  const runtimeManaged = !!params.model.webllmModelId;
  if (!runtimeManaged && !params.model.downloadUrl) return 'download_url_missing';
  return params.state?.status ?? 'not_installed';
}
