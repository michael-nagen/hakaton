// ── Model Provider — local model download manager ────────────────────
//
// Downloads a catalog-defined model file and stores it via LocalModelStorage.
// Pure logic, no UI. Security: it only ever downloads `model.downloadUrl` from a
// LocalModelConfig — never an arbitrary user-supplied URL. Streams the response
// (ReadableStream) so the UI can show real progress, falling back to a plain
// blob read when streaming isn't available. Cancellable via AbortSignal.

import type { LocalModelConfig } from './local-model-catalog';
import { localModelStorage, type LocalModelStorage } from './local-model-storage';

export interface DownloadProgress {
  downloadedBytes: number;
  totalBytes?: number;
  percent?: number;
}

export interface DownloadResult {
  modelId: string;
  localPath?: string;
  downloadedBytes: number;
}

/** Thrown when a model has no configured download URL. Safe to display. */
export class DownloadUrlNotConfiguredError extends Error {
  constructor() {
    super('Download URL not configured yet.');
    this.name = 'DownloadUrlNotConfiguredError';
  }
}

/**
 * Download a model file and persist it. Reports progress when Content-Length +
 * streaming are available. Rejects with an AbortError if `signal` aborts, or a
 * friendly Error on network/HTTP failure — callers surface these without
 * crashing. Does NOT flip any install state; the caller owns persistence.
 */
export async function downloadLocalModel(params: {
  model: LocalModelConfig;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
  storage?: LocalModelStorage;
}): Promise<DownloadResult> {
  const { model, onProgress, signal } = params;
  const storage = params.storage ?? localModelStorage;

  if (!model.downloadUrl) throw new DownloadUrlNotConfiguredError();

  const res = await fetch(model.downloadUrl, { signal });
  if (!res.ok) throw new Error(`Download failed (status ${res.status}).`);

  const lengthHeader = res.headers.get('content-length');
  const totalBytes = lengthHeader ? Number(lengthHeader) || undefined : undefined;
  const fileName = model.fileName ?? `${model.id}.bin`;

  const chunks: BlobPart[] = [];
  let downloadedBytes = 0;

  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        downloadedBytes += value.byteLength;
        onProgress?.({
          downloadedBytes,
          totalBytes,
          percent: totalBytes ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : undefined,
        });
      }
    }
  } else {
    // No streaming support — fall back to a single blob read (no live progress).
    const blob = await res.blob();
    downloadedBytes = blob.size;
    chunks.push(blob);
    onProgress?.({ downloadedBytes, totalBytes: downloadedBytes, percent: 100 });
  }

  const blob = new Blob(chunks);

  // Validate completeness when the server told us the size.
  if (totalBytes !== undefined && blob.size !== totalBytes) {
    throw new Error(`Download incomplete (${blob.size} of ${totalBytes} bytes). Please retry.`);
  }

  // Verify integrity when a checksum is configured — reject a corrupted file
  // BEFORE it is stored, so we never persist a bad model.
  if (model.checksumSha256) {
    const actual = await sha256Hex(blob);
    if (actual.toLowerCase() !== model.checksumSha256.toLowerCase()) {
      throw new Error('Downloaded file failed checksum verification. Please retry.');
    }
  }

  const saved = await storage.saveModelFile({ modelId: model.id, fileName, blob });
  return { modelId: model.id, localPath: saved.localPath, downloadedBytes: blob.size || downloadedBytes };
}

/** SHA-256 of a blob as a lowercase hex string. */
async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
