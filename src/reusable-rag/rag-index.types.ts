// ── Reusable RAG — types ─────────────────────────────────────────────
//
// A reusable asset is any course fragment worth reusing later: a whole unit,
// a KB chunk, a question, a TeacherBrain, or a common mistake. The indexer
// flattens a CoursePackage into these, the search ranks them. No vector DB
// yet — in-memory + keyword scoring; the shapes are ready for embeddings.

/** What kind of course fragment an asset represents. */
export type ReusableAssetType =
  | 'unit'
  | 'kb-chunk'
  | 'question'
  | 'teacher-brain'
  | 'common-mistake';

/**
 * A single searchable, reusable piece of course content plus the metadata a
 * future composer/RAG layer needs to decide whether to reuse it.
 */
export interface ReusableAsset {
  id: string;
  type: ReusableAssetType;
  /** Course-level subject this asset belongs to, e.g. "rag". */
  topic: string;
  /** Skills the asset helps build (derived from tags/topics for now). */
  skills: string[];
  tags: string[];
  sourceCourseId: string;
  /** Owning unit, or null for course-level assets. */
  sourceUnitId: string | null;
  /** Concepts this asset relates to, used for loose graph-style reuse. */
  relatedConcepts: string[];
  estimatedMinutes: number;
  /** Short human label for the asset. */
  title: string;
  /** The searchable text body of the asset. */
  content: string;
}

export interface RagSearchResult {
  asset: ReusableAsset;
  /** Relevance score; higher is better. */
  score: number;
}

export interface SearchReusableAssetsOptions {
  query: string;
  /** Max results to return. Defaults to 10. */
  limit?: number;
  /** Index to search; defaults to the shared in-memory index. */
  index?: RagIndex;
}

export interface IndexCoursePackageOptions {
  coursePackage: import('../course-package/course-package.types').CoursePackage;
  /** Index to write into; defaults to the shared in-memory index. */
  index?: RagIndex;
}

/**
 * Minimal in-memory index contract. Swappable for a vector-backed store
 * later without changing the indexer/search call sites.
 */
export interface RagIndex {
  add(assets: ReusableAsset[]): void;
  all(): ReusableAsset[];
  clear(): void;
  size(): number;
}
