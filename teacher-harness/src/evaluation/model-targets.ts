// ── Teacher Harness — evaluation model targets ───────────────────────
//
// Enumerates every model the evaluation KNOWS ABOUT and is honest about which
// ones this Node CLI can actually execute:
//
//   • The app's two real local/offline options (Gemma 2 2B, Llama 3.2 3B) are
//     read from the app's own catalog. They run on WebLLM (WebGPU) INSIDE A
//     BROWSER — there is no Node runtime for them in this repo, so they are
//     listed as unavailable with a reason, never faked. The adapter boundary
//     for a future browser runner is the plain ModelProvider interface: a
//     browser page that implements generateText() over WebLLM can be plugged
//     in here without touching the rest of the evaluation.
//
//   • The deterministic mock always runs (mechanics baseline, NOT a quality
//     signal — it was built to satisfy the scorer).
//
//   • Cloud models on the configured openai-compatible endpoint run as clearly
//     labelled PROXIES: real LLM behaviour under each strategy, but not the
//     on-device models and not on-device latency.

import { LOCAL_MODEL_CATALOG } from '../../../src/model-provider/local-model-catalog';
import { startWebllmBridge, type WebllmBridge } from '../browser-bridge/bridge-server';
import { resolveProviderConfig } from '../config/harness-config';
import { resolveProvider } from '../model/model-client';
import { createMockTeacherProvider } from '../model/mock-teacher-provider';
import type { GenerateTextArgs, ModelProvider } from '../model/model-provider.types';
import type { EvalModelTarget } from './eval-types';

const WEBLLM_UNAVAILABLE_REASON =
  'Runs on WebLLM (WebGPU) inside a browser only — never executed implicitly. To run the REAL model, ' +
  'select it explicitly (e.g. --models llama_3_2_3b): the harness starts a local bridge and prints a URL ' +
  'to open in a WebGPU browser. See docs/webllm-browser-evaluation.md.';

/** Friendly CLI aliases for the real on-device models. */
const MODEL_ALIASES: Readonly<Record<string, string>> = {
  llama_3_2_3b: 'llama-better-offline',
  'llama-3.2-3b': 'llama-better-offline',
  gemma_2_2b: 'gemma-fast-offline',
  'gemma-2-2b': 'gemma-fast-offline',
};

/**
 * Bridge port. 5201 by default — deliberately NOT the app's pinned 5199, which
 * the Vite dev server usually occupies. If the dev server is stopped, set
 * TEACHER_HARNESS_BRIDGE_PORT=5199 to reuse the app origin's cached weights
 * (WebLLM caches per browser origin); otherwise the first bridge run downloads
 * the model once and caches it for the bridge's own origin.
 */
function bridgePort(): number {
  const raw = Number(process.env.TEACHER_HARNESS_BRIDGE_PORT);
  return Number.isFinite(raw) && raw > 0 ? raw : 5201;
}

// Open bridges, so a finished evaluation can shut them down.
const openBridges: WebllmBridge[] = [];

export function closeEvalBridges(): void {
  for (const b of openBridges.splice(0)) b.close();
}

/** Weak-ish default proxy; overridable via TEACHER_HARNESS_EVAL_PROXY_MODELS. */
const DEFAULT_PROXY_MODELS = ['gemini-flash-lite-latest'];

const RETRYABLE = /\b(429|500|502|503|504)\b|rate.?limit|overloaded|timeout|aborted/i;
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];

/**
 * Minimum spacing between cloud calls so free-tier RPM limits are respected.
 * Overridable via TEACHER_HARNESS_EVAL_CALL_DELAY_MS.
 */
const DEFAULT_CALL_DELAY_MS = 4_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Minimum spacing between model calls for a target, applied by the strategy
 * layer BEFORE each call (so measured latency stays pure inference+network).
 * Cloud endpoints get a free-tier-friendly default; mock needs none.
 */
export function evalCallDelayMs(target: EvalModelTarget): number {
  if (target.kind !== 'openai-compatible') return 0;
  const raw = Number(process.env.TEACHER_HARNESS_EVAL_CALL_DELAY_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_CALL_DELAY_MS;
}

/** Wrap a provider with retry-on-transient-error so long matrix runs survive 429s. */
export function withRetry(provider: ModelProvider): ModelProvider {
  return {
    name: provider.name,
    modelName: provider.modelName,
    async generateText(args: GenerateTextArgs): Promise<string> {
      let lastError: Error | undefined;
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
        try {
          return await provider.generateText(args);
        } catch (err) {
          lastError = err as Error;
          if (attempt === RETRY_DELAYS_MS.length || !RETRYABLE.test(lastError.message)) throw lastError;
          await sleep(RETRY_DELAYS_MS[attempt]);
        }
      }
      throw lastError ?? new Error('generateText failed');
    },
  };
}

/** Read the proxy model list (comma-separated) from env, else the default. */
function proxyModelIds(): string[] {
  const raw = process.env.TEACHER_HARNESS_EVAL_PROXY_MODELS;
  if (!raw) return [...DEFAULT_PROXY_MODELS];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Build the full target list: WebLLM (unavailable), mock, and cloud proxies. */
export function listEvalModelTargets(): EvalModelTarget[] {
  const targets: EvalModelTarget[] = [];

  // 1. The two REAL local model options, straight from the app catalog.
  for (const m of LOCAL_MODEL_CATALOG) {
    targets.push({
      id: m.id,
      label: `${m.displayName} — WebLLM id ${m.webllmModelId ?? 'n/a'}`,
      kind: 'webllm',
      available: false,
      unavailableReason: WEBLLM_UNAVAILABLE_REASON,
      qualitySignal: true,
      isRealWebllm: true,
    });
  }

  // 2. Deterministic mock — always runnable, mechanics only.
  targets.push({
    id: 'mock',
    label: 'Deterministic mock tutor (mechanics baseline)',
    kind: 'mock',
    available: true,
    qualitySignal: false,
    isRealWebllm: false,
  });

  // 3. Cloud proxies over the configured openai-compatible endpoint.
  const config = resolveProviderConfig();
  const cloudReady = Boolean(config.apiKey && config.baseUrl);
  const proxies = new Set(proxyModelIds());
  if (config.model) proxies.add(config.model); // the endpoint's configured default model
  for (const model of proxies) {
    targets.push({
      id: `proxy:${model}`,
      label: `${model} (cloud proxy — NOT WebLLM)`,
      kind: 'openai-compatible',
      available: cloudReady,
      unavailableReason: cloudReady
        ? undefined
        : 'openai-compatible endpoint not configured (TEACHER_HARNESS_API_KEY / TEACHER_HARNESS_BASE_URL).',
      qualitySignal: true,
      isRealWebllm: false,
      proxyNote:
        'Cloud model over the openai-compatible endpoint. A real LLM quality signal for strategy comparison, ' +
        'but NOT the on-device Gemma/Llama WebLLM models and NOT on-device latency.',
      openAiModel: model,
    });
  }

  return targets;
}

/** Instantiate a runnable provider for an available target. */
export function createProviderForTarget(target: EvalModelTarget): ModelProvider {
  if (!target.available) {
    throw new Error(`Model target "${target.id}" is not runnable from this CLI: ${target.unavailableReason}`);
  }
  if (target.kind === 'mock') return createMockTeacherProvider();

  if (target.kind === 'webllm') {
    const catalogEntry = LOCAL_MODEL_CATALOG.find((m) => m.id === target.id);
    if (!catalogEntry?.webllmModelId) {
      throw new Error(`No WebLLM model id configured for "${target.id}" in the app catalog.`);
    }
    const bridge = startWebllmBridge({
      webllmModelId: catalogEntry.webllmModelId,
      label: catalogEntry.displayName,
      port: bridgePort(),
      onStatus: (text) => console.log(`  [bridge] ${text}`),
    });
    openBridges.push(bridge);
    console.log(
      `\n  🌉 WebLLM bridge for ${catalogEntry.displayName} is up.\n` +
        `     OPEN THIS IN A WEBGPU BROWSER (Chrome/Edge): ${bridge.url}\n` +
        `     The page loads the REAL on-device model (cached weights on this origin are reused) and then serves turns.\n`,
    );
    return bridge.provider;
  }

  const config = resolveProviderConfig();
  const resolved = resolveProvider({
    mode: 'openai-compatible',
    model: target.openAiModel,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });
  return withRetry(resolved.provider);
}

/**
 * Resolve a --models selector into targets.
 *
 * WebLLM targets stay non-runnable in the broad selectors ('all'/'mock'/
 * 'proxies') — they are listed as "not evaluated" for honesty. Selecting one
 * EXPLICITLY (by id or alias, e.g. --models llama_3_2_3b) activates the real
 * browser bridge for it. In explicit mode only the named targets are included,
 * so a Llama-only report is not cluttered with Gemma/proxy rows.
 */
export function selectModelTargets(selector: string | undefined): {
  requested: EvalModelTarget[];
  runnable: EvalModelTarget[];
  unavailable: EvalModelTarget[];
} {
  const all = listEvalModelTargets();
  const wanted =
    !selector || selector === 'all'
      ? all
      : selector === 'mock'
        ? all.filter((t) => t.kind === 'mock' || t.kind === 'webllm')
        : selector === 'proxies'
          ? all.filter((t) => t.kind === 'openai-compatible' || t.kind === 'webllm')
          : (() => {
              const ids = selector
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
                .map((id) => MODEL_ALIASES[id] ?? id);
              const byId = new Map(all.map((t) => [t.id, t]));
              const missing = ids.filter((id) => !byId.has(id));
              if (missing.length > 0) {
                throw new Error(
                  `Unknown model target(s): ${missing.join(', ')}. Known: ${[...byId.keys(), ...Object.keys(MODEL_ALIASES)].join(', ')}`,
                );
              }
              return ids.map((id) => {
                const t = byId.get(id) as EvalModelTarget;
                if (t.kind !== 'webllm') return t;
                // Explicit selection → run the REAL model via the browser bridge.
                return {
                  ...t,
                  available: true,
                  unavailableReason: undefined,
                  proxyNote: undefined,
                };
              });
            })();

  return {
    requested: wanted,
    runnable: wanted.filter((t) => t.available),
    unavailable: wanted.filter((t) => !t.available),
  };
}
