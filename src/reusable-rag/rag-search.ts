// ── Reusable RAG — search ────────────────────────────────────────────
//
// Keyword-overlap search over the in-memory index. Deterministic and
// dependency-free. When embeddings arrive, only `scoreAsset` / the ranking
// changes — the `searchReusableAssets` signature stays the same.

import { sharedRagIndex } from './rag-indexer';
import type {
  ReusableAsset,
  RagSearchResult,
  SearchReusableAssetsOptions,
} from './rag-index.types';

const DEFAULT_LIMIT = 10;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

/** Tags/topic/skills weigh more than free-text body, like the tutor retrieval. */
function scoreAsset(asset: ReusableAsset, queryTokens: Set<string>): number {
  if (queryTokens.size === 0) return 0;

  const strong = new Set(
    [asset.topic, ...asset.tags, ...asset.skills, ...asset.relatedConcepts].flatMap(tokenize),
  );
  const body = new Set([...tokenize(asset.title), ...tokenize(asset.content)]);

  let score = 0;
  for (const token of queryTokens) {
    if (strong.has(token)) score += 3;
    else if (body.has(token)) score += 1;
  }
  return score;
}

/**
 * Search reusable assets by relevance to a query. Returns matches only
 * (score > 0), highest first, capped at `limit`. An empty/blank query
 * returns nothing rather than the whole index.
 */
export function searchReusableAssets(options: SearchReusableAssetsOptions): RagSearchResult[] {
  const { query, limit = DEFAULT_LIMIT, index = sharedRagIndex } = options;
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return [];

  return index
    .all()
    .map((asset) => ({ asset, score: scoreAsset(asset, queryTokens) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
