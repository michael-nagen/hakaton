// ── Tutor Runtime — knowledge retrieval ──────────────────────────────
//
// MVP retrieval: keyword-overlap scoring between the user's message and each
// chunk's title/content/tags. Deterministic and dependency-free. When RAG
// arrives, only the body of `getRelevantChunksForUnit` changes (vector search)
// — its signature and return type stay the same.

import type { KnowledgeBaseChunk, LearningUnit } from '../course-package/course-package.types';
import type { ScoredChunk } from './tutor-runtime.types';

const DEFAULT_MAX_CHUNKS = 3;

/** Lowercase, strip punctuation, split into tokens of length >= 3. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

/** Tags weigh more than body words: an exact tag hit is a strong signal. */
function scoreChunk(chunk: KnowledgeBaseChunk, queryTokens: Set<string>): number {
  if (queryTokens.size === 0) return 0;

  const tagTokens = new Set(chunk.tags.flatMap((tag) => tokenize(tag)));
  const textTokens = new Set([...tokenize(chunk.title), ...tokenize(chunk.content)]);

  let score = 0;
  for (const token of queryTokens) {
    if (tagTokens.has(token)) score += 3;
    else if (textTokens.has(token)) score += 1;
  }
  return score;
}

/**
 * Return the top-N knowledge chunks for a unit, ranked by relevance to the
 * user's message. With an empty/irrelevant message it falls back to the unit's
 * first N chunks so the tutor always has *some* grounding material.
 */
export function getRelevantChunksForUnit(params: {
  unit: LearningUnit;
  userMessage: string;
  maxChunks?: number;
}): KnowledgeBaseChunk[] {
  const { unit, userMessage, maxChunks = DEFAULT_MAX_CHUNKS } = params;
  const chunks = unit.knowledgeBaseChunks;
  if (chunks.length === 0 || maxChunks <= 0) return [];

  const queryTokens = new Set(tokenize(userMessage));

  const scored: ScoredChunk[] = chunks.map((chunk) => ({
    chunk,
    score: scoreChunk(chunk, queryTokens),
  }));

  const anyMatch = scored.some((s) => s.score > 0);
  if (!anyMatch) {
    // No keyword signal — fall back to the unit's leading chunks.
    return chunks.slice(0, maxChunks);
  }

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChunks)
    .map((s) => s.chunk);
}
