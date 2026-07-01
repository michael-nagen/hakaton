// ── AI Provider — safety & cost limits ───────────────────────────────
//
// Shared guardrails so a single lesson can't accidentally run up a user's BYOK
// quota (or hang forever). Two kinds of limits live here:
//   1. Request-level: `timeoutMs`, `maxTokensPerRequest` — passed into transports.
//   2. Rate-level: per-minute and per-day counters, keyed by provider type.
//
// Rate state is intentionally lightweight: an in-memory sliding window for the
// per-minute cap, and a localStorage day-counter for the per-day cap so it
// survives reloads. This is defence-in-depth, not billing-grade accounting.

export interface AiLimits {
  maxMessagesPerLesson: number;
  maxTokensPerRequest: number;
  maxRequestsPerMinute: number;
  maxRequestsPerDayPerProvider: number;
  timeoutMs: number;
}

export const DEFAULT_AI_LIMITS: AiLimits = {
  maxMessagesPerLesson: 40,
  maxTokensPerRequest: 1024,
  maxRequestsPerMinute: 20,
  maxRequestsPerDayPerProvider: 500,
  timeoutMs: 30_000,
};

/** Thrown when a provider call is blocked by a rate/cost limit. Message is safe to show. */
export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

// In-memory per-minute window: provider type -> recent request timestamps (ms).
const minuteWindow = new Map<string, number[]>();

function todayKey(providerType: string): string {
  // Date-only key so the counter resets each calendar day (local time).
  const now = new Date();
  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  return `maestro.ai.rate.${providerType}.${day}`;
}

function readDayCount(providerType: string): number {
  try {
    const raw = localStorage.getItem(todayKey(providerType));
    const n = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeDayCount(providerType: string, count: number): void {
  try {
    localStorage.setItem(todayKey(providerType), String(count));
  } catch {
    // localStorage unavailable (private mode etc.) — degrade gracefully; the
    // in-memory per-minute window still applies.
  }
}

/**
 * Register one request against the limits for a provider type. Throws
 * RateLimitError if the per-minute or per-day cap is exceeded. Call this right
 * before making a network request in a transport.
 */
export function assertWithinRateLimits(params: {
  providerType: string;
  limits?: AiLimits;
}): void {
  const { providerType } = params;
  const limits = params.limits ?? DEFAULT_AI_LIMITS;
  const now = Date.now();

  const recent = (minuteWindow.get(providerType) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= limits.maxRequestsPerMinute) {
    throw new RateLimitError('Too many requests this minute. Please wait a moment and try again.');
  }

  const dayCount = readDayCount(providerType);
  if (dayCount >= limits.maxRequestsPerDayPerProvider) {
    throw new RateLimitError('Daily request limit reached for this provider. Try again tomorrow or switch providers.');
  }

  recent.push(now);
  minuteWindow.set(providerType, recent);
  writeDayCount(providerType, dayCount + 1);
}

/**
 * Wrap a fetch with an abort-based timeout. Returns the Response; throws a
 * plain Error with a safe message on timeout. Never includes headers/keys.
 */
export async function fetchWithTimeout(params: {
  url: string;
  init: RequestInit;
  timeoutMs?: number;
}): Promise<Response> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_AI_LIMITS.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(params.url, { ...params.init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw new Error('Network request failed. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
}
