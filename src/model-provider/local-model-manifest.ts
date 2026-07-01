// ── Model Provider — local model manifest ────────────────────────────
//
// A controlled, app-owned manifest of APPROVED local models (served from
// public/local-models.manifest.json). It is the single source of truth for
// download-critical fields (URL, fileName, checksum, size). The app NEVER
// discovers or accepts arbitrary model URLs — only what's listed here. Adding a
// real, license-cleared URL is a manifest edit; no code changes.

import { LOCAL_MODEL_CATALOG, type LocalModelConfig } from './local-model-catalog';

export interface LocalModelManifestEntry {
  id: string;
  displayName: string;
  runtime: string;
  format: string;
  fileName: string;
  /** Approved download URL, or null until one is chosen + license-cleared. */
  downloadUrl: string | null;
  source: string;
  license: string;
  estimatedSizeMb: number;
  checksumSha256: string | null;
}

export interface LocalModelManifest {
  version: number;
  models: LocalModelManifestEntry[];
}

const MANIFEST_URL = '/local-models.manifest.json';

/** Fetch the manifest. Returns null on any failure (UI falls back to the static catalog). */
export async function loadLocalModelManifest(): Promise<LocalModelManifest | null> {
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
    if (!res.ok) return null;
    const data = (await res.json()) as LocalModelManifest;
    return Array.isArray(data?.models) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Overlay approved manifest fields onto the static catalog (which carries the
 * UI-only fields: RAM, quality, description). The manifest is authoritative for
 * download config; presentation stays from the catalog. Entries not in the
 * manifest keep their catalog defaults.
 */
export function mergeManifestIntoCatalog(params: { manifest: LocalModelManifest | null }): LocalModelConfig[] {
  const { manifest } = params;
  return LOCAL_MODEL_CATALOG.map((base) => {
    const entry = manifest?.models.find((m) => m.id === base.id);
    if (!entry) return base;
    return {
      ...base,
      displayName: entry.displayName || base.displayName,
      fileName: entry.fileName || base.fileName,
      downloadUrl: entry.downloadUrl,
      checksumSha256: entry.checksumSha256,
      estimatedSizeMb: entry.estimatedSizeMb || base.estimatedSizeMb,
      installStatus: entry.downloadUrl ? 'not_installed' : 'download_url_missing',
      runtime: entry.runtime,
      source: entry.source,
      license: entry.license,
    };
  });
}
