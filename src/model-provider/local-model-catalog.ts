// ── Model Provider — local model catalog ─────────────────────────────
//
// Metadata for on-device models the offline path can offer. This is a catalog
// only — it does NOT run inference (see local-model.provider.ts). Kept runtime-
// agnostic (`format` can be gguf/mlc/onnx/litert/other) so we're not locked into
// one local runtime. Download URLs are placeholders until real inference lands.

export type LocalModelFormat = 'gguf' | 'mlc' | 'onnx' | 'litert' | 'other';

export type LocalModelConfig = {
  id: string;
  displayName: string;
  downloadUrl: string;
  sizeMb: number;
  minRamGb?: number;
  recommendedRamGb?: number;
  format: LocalModelFormat;
};

/**
 * First candidates, cheapest first. Sizes/RAM are representative Q4 figures for
 * UI copy. Swap/extend freely — nothing else hardcodes these.
 */
export const LOCAL_MODEL_CATALOG: readonly LocalModelConfig[] = [
  {
    id: 'gemma-3-1b-q4',
    displayName: 'Gemma 3 1B (Q4) — small',
    downloadUrl: '',
    sizeMb: 900,
    minRamGb: 3,
    recommendedRamGb: 4,
    format: 'gguf',
  },
  {
    id: 'qwen-4b-q4',
    displayName: 'Qwen 4B (Q4) — better',
    downloadUrl: '',
    sizeMb: 2600,
    minRamGb: 6,
    recommendedRamGb: 8,
    format: 'gguf',
  },
];

export function getLocalModelById(params: { id: string }): LocalModelConfig | undefined {
  return LOCAL_MODEL_CATALOG.find((m) => m.id === params.id);
}

/** The default/small model id offered first. */
export const DEFAULT_LOCAL_MODEL_ID = LOCAL_MODEL_CATALOG[0]?.id ?? '';
