// ── Tutor Runtime — run-turn adapter ─────────────────────────────────
//
// A small wrapper that runs ONE tutor turn end-to-end using the existing
// runtime and a chosen ModelProvider, and collects debug info a demo UI wants
// (latency, KB chunk ids, model name, a parsed "action"). It adds no new
// teaching behaviour — it only orchestrates and measures. The core runtime
// stays unaware of these concerns.

import { buildTutorContext } from './build-tutor-context';
import { buildTutorPrompt } from './build-tutor-prompt';
import type {
  JsonParseStatus,
  RunTutorTurnParams,
  TutorTurnResult,
} from './run-tutor-turn.types';

/** High-resolution now(), falling back to Date.now() outside the browser. */
function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Try to read a structured payload from a model answer. Real providers may one
 * day return JSON like `{ "action": "ask_question", "message": "..." }`; the
 * mock returns plain prose. We strip an optional ```json fence, attempt a
 * parse, and report the outcome so the UI can display it honestly.
 */
function parseAction(answer: string): { action: string | null; jsonParse: JsonParseStatus } {
  const trimmed = answer.trim().replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');
  if (!looksLikeJson) return { action: null, jsonParse: 'not-json' };

  try {
    const parsed: unknown = JSON.parse(trimmed);
    const action =
      typeof parsed === 'object' && parsed !== null && 'action' in parsed
        ? String((parsed as { action: unknown }).action)
        : null;
    return { action, jsonParse: 'success' };
  } catch {
    return { action: null, jsonParse: 'failure' };
  }
}

/**
 * Run a single tutor turn: build minimal context for the unit, render the
 * prompt, call the provider (timed), and return the answer plus debug info.
 * Never sends the whole course — only the current unit's slice, exactly like
 * the rest of the runtime.
 */
export async function runTutorTurn(params: RunTutorTurnParams): Promise<TutorTurnResult> {
  const { coursePackage, unitId, userMessage, provider, freedomMode, progress, maxChunks } = params;

  const context = buildTutorContext({
    coursePackage,
    unitId,
    userMessage,
    freedomMode,
    progress,
    maxChunks,
  });
  const prompt = buildTutorPrompt({ context });

  const start = nowMs();
  const answer = await provider.generateText({
    prompt: prompt.userPrompt,
    system: prompt.systemPrompt,
  });
  const latencyMs = Math.round(nowMs() - start);

  const { action, jsonParse } = parseAction(answer);

  return {
    answer,
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    debug: {
      provider: provider.name,
      modelName: provider.modelName ?? null,
      latencyMs,
      unit: { id: context.unit.id, title: context.unit.title },
      freedomMode: context.freedomMode,
      kbChunkIds: context.relevantChunks.map((chunk) => chunk.id),
      action,
      jsonParse,
    },
  };
}
