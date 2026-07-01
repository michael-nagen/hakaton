// ── Tutor Runtime — response parsing & repair ────────────────────────
//
// Providers are asked to return a TutorResponse as JSON, but models are not
// perfectly reliable. This module turns a raw model string into a valid
// TutorResponse without ever throwing to the lesson: strip fences → parse →
// coerce/validate fields → fall back to a safe response. Generalizes the small
// `parseAction` helper that used to live in run-tutor-turn.ts.

import type {
  StudentLevel,
  TutorNextAction,
  TutorResponse,
} from './tutor-provider.types';

const NEXT_ACTIONS: readonly TutorNextAction[] = [
  'ask_question',
  'give_hint',
  'explain',
  'continue',
  'finish',
];
const LEVELS: readonly StudentLevel[] = ['beginner', 'intermediate', 'advanced'];

/** A neutral, useful response used when the model output can't be trusted. */
export function fallbackTutorResponse(params?: { level?: StudentLevel; message?: string }): TutorResponse {
  return {
    messageToStudent:
      params?.message ??
      "Let's take this one step at a time. Can you tell me a bit more about what you're thinking so far?",
    nextAction: 'give_hint',
    studentLevelEstimate: params?.level ?? 'beginner',
    confidence: 0.3,
  };
}

/** Remove an optional ```json … ``` fence and surrounding whitespace. */
function stripFence(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
}

/**
 * Extract the first balanced {...} object from a noisy string (models often
 * wrap JSON in prose). Returns null if none found.
 */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function coerceLevel(value: unknown): StudentLevel | null {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value)
    ? (value as StudentLevel)
    : null;
}

function coerceAction(value: unknown): TutorNextAction | null {
  return typeof value === 'string' && (NEXT_ACTIONS as readonly string[]).includes(value)
    ? (value as TutorNextAction)
    : null;
}

function coerceConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

/**
 * Try to build a valid TutorResponse from a raw model string. Returns null when
 * the output isn't usable (no JSON, or missing the message) so the caller can
 * decide whether to retry or fall back.
 */
export function tryParseTutorResponse(raw: string): TutorResponse | null {
  const candidate = extractJsonObject(stripFence(raw));
  if (!candidate) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const obj = parsed as Record<string, unknown>;
  const message = obj.messageToStudent;
  if (typeof message !== 'string' || message.trim() === '') return null;

  return {
    messageToStudent: message.trim(),
    nextAction: coerceAction(obj.nextAction) ?? 'explain',
    studentLevelEstimate: coerceLevel(obj.studentLevelEstimate) ?? 'beginner',
    confidence: coerceConfidence(obj.confidence),
  };
}
