// ── Run step ──────────────────────────────────────────────────────────
//
// The single boring path every agent takes:
//   build prompt → model call → save raw → extract+parse JSON → save parsed.
// Fails loudly (and keeps the raw response) if the model didn't return JSON.

import type { ArtifactStore } from './artifact-store';
import type { ModelClient } from '../llm/model-provider.types';

export interface RunStepParams {
  client: ModelClient;
  store: ArtifactStore;
  /** Stable agent id, e.g. "01-input-normalizer". Drives logging + mock routing. */
  purpose: string;
  /** File name for the parsed artifact, e.g. "01-normalized-input.json". */
  artifactName: string;
  system: string;
  prompt: string;
}

/**
 * Pull the first JSON value out of a model response. Handles ```json fences
 * and leading prose by scanning for the first balanced {...} or [...].
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();

  // Try direct parse first (mock and json-mode responses).
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }

  // Strip a ```json ... ``` (or plain ```) fence.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* fall through */
    }
  }

  // Scan for the first balanced object/array.
  const start = trimmed.search(/[[{]/);
  if (start !== -1) {
    const open = trimmed[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          const candidate = trimmed.slice(start, i + 1);
          return JSON.parse(candidate); // throws → caller handles
        }
      }
    }
  }

  throw new Error('No JSON value found in model response.');
}

/**
 * Run one agent step and return the parsed JSON artifact. Saves rich debug
 * artifacts on EVERY step (success or failure) so real-model outputs can be
 * diagnosed: `<base>.prompt.txt`, `<base>.raw.txt`, `<base>.debug.json`.
 */
export async function runStep(params: RunStepParams): Promise<unknown> {
  const { client, store, purpose, artifactName, system, prompt } = params;
  store.log(`▶ ${purpose}: calling ${client.providerId} (${client.modelName ?? 'unknown model'})`);

  const base = artifactName.replace(/\.json$/, '');
  // Persist the exact prompt sent, for debugging.
  store.saveRaw(`${base}.prompt.txt`, `=== SYSTEM ===\n${system}\n\n=== USER ===\n${prompt}\n`);

  const result = await client.complete({ system, prompt, purpose });
  store.saveRaw(`${base}.raw.txt`, result.text);

  const writeDebug = (parseStatus: 'success' | 'failure'): void => {
    store.saveJson(`${base}.debug.json`, {
      purpose,
      provider: client.providerId,
      model: result.modelName ?? client.modelName ?? null,
      latencyMs: result.latencyMs,
      parseStatus,
      systemChars: system.length,
      promptChars: prompt.length,
      rawChars: result.text.length,
      artifacts: {
        prompt: `${base}.prompt.txt`,
        raw: `${base}.raw.txt`,
        parsed: parseStatus === 'success' ? artifactName : null,
      },
    });
  };

  let parsed: unknown;
  try {
    parsed = extractJson(result.text);
  } catch (e) {
    writeDebug('failure');
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(
      `${purpose}: failed to parse JSON from model response (${reason}). ` +
        `Raw response saved to ${base}.raw.txt (see ${base}.debug.json).`,
    );
  }

  store.saveJson(artifactName, parsed);
  writeDebug('success');
  store.log(`✔ ${purpose}: ${result.latencyMs}ms → ${artifactName}`);
  return parsed;
}
