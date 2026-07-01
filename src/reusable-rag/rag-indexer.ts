// ── Reusable RAG — indexer ───────────────────────────────────────────
//
// Flattens a CoursePackage into ReusableAssets and stores them in an
// in-memory index. `buildAssetsFromCoursePackage` is pure (easy to test);
// `indexCoursePackage` is the stateful convenience wrapper used by the demo.

import type {
  CoursePackage,
  LearningUnit,
} from '../course-package/course-package.types';
import type {
  IndexCoursePackageOptions,
  RagIndex,
  ReusableAsset,
} from './rag-index.types';

// Rough per-asset time estimates (minutes). Kept tiny and deterministic.
const MINUTES = { kbChunk: 3, question: 2, teacherBrain: 1, commonMistake: 1 } as const;

/** The course's primary topic, used to tag every asset from it. */
function courseTopic(coursePackage: CoursePackage): string {
  return coursePackage.reusableMetadata.topics[0] ?? coursePackage.title.toLowerCase();
}

/** De-duplicated, lowercased concept list for an asset. */
function concepts(...groups: string[][]): string[] {
  return [...new Set(groups.flat().map((c) => c.toLowerCase()).filter(Boolean))];
}

function unitAssets(params: {
  coursePackage: CoursePackage;
  unit: LearningUnit;
  topic: string;
}): ReusableAsset[] {
  const { coursePackage, unit, topic } = params;
  const courseId = coursePackage.id;
  const baseTags = coursePackage.metadata.tags;
  const assets: ReusableAsset[] = [];

  // The unit itself.
  assets.push({
    id: `asset:${unit.id}`,
    type: 'unit',
    topic,
    skills: baseTags,
    tags: baseTags,
    sourceCourseId: courseId,
    sourceUnitId: unit.id,
    relatedConcepts: concepts(baseTags, [topic]),
    estimatedMinutes: MINUTES.kbChunk * unit.knowledgeBaseChunks.length || MINUTES.kbChunk,
    title: unit.title,
    content: `${unit.title} — ${unit.goal}`,
  });

  // TeacherBrain.
  const brain = unit.teacherBrain;
  assets.push({
    id: `asset:${unit.id}:brain`,
    type: 'teacher-brain',
    topic,
    skills: baseTags,
    tags: [...baseTags, 'teacher-brain'],
    sourceCourseId: courseId,
    sourceUnitId: unit.id,
    relatedConcepts: concepts(brain.objectives, [topic]),
    estimatedMinutes: MINUTES.teacherBrain,
    title: `Teaching brain: ${unit.title}`,
    content: [brain.persona, brain.tone, ...brain.objectives, ...brain.guidelines].join(' '),
  });

  // KB chunks.
  for (const chunk of unit.knowledgeBaseChunks) {
    assets.push({
      id: `asset:${chunk.id}`,
      type: 'kb-chunk',
      topic,
      skills: chunk.tags,
      tags: chunk.tags,
      sourceCourseId: courseId,
      sourceUnitId: unit.id,
      relatedConcepts: concepts(chunk.tags, [topic]),
      estimatedMinutes: MINUTES.kbChunk,
      title: chunk.title,
      content: chunk.content,
    });
  }

  // Questions.
  for (const question of unit.questions) {
    assets.push({
      id: `asset:${question.id}`,
      type: 'question',
      topic,
      skills: baseTags,
      tags: [...baseTags, question.type],
      sourceCourseId: courseId,
      sourceUnitId: unit.id,
      relatedConcepts: concepts(baseTags, [topic]),
      estimatedMinutes: MINUTES.question,
      title: `Question (${question.type})`,
      content: question.prompt,
    });
  }

  // Common mistakes.
  for (const mistake of unit.commonMistakes) {
    assets.push({
      id: `asset:${mistake.id}`,
      type: 'common-mistake',
      topic,
      skills: baseTags,
      tags: [...baseTags, 'common-mistake'],
      sourceCourseId: courseId,
      sourceUnitId: unit.id,
      relatedConcepts: concepts(baseTags, [topic]),
      estimatedMinutes: MINUTES.commonMistake,
      title: 'Common mistake',
      content: `${mistake.mistake} → ${mistake.correction}`,
    });
  }

  return assets;
}

/**
 * Pure: flatten a CoursePackage into reusable assets. No state touched, so
 * this is safe to call for previewing what would be indexed.
 */
export function buildAssetsFromCoursePackage(params: {
  coursePackage: CoursePackage;
}): ReusableAsset[] {
  const { coursePackage } = params;
  const topic = courseTopic(coursePackage);
  return coursePackage.units.flatMap((unit) => unitAssets({ coursePackage, unit, topic }));
}

/** Simple in-memory index. De-dupes by asset id on insert. */
export function createRagIndex(): RagIndex {
  const store = new Map<string, ReusableAsset>();
  return {
    add(assets) {
      for (const asset of assets) store.set(asset.id, asset);
    },
    all() {
      return [...store.values()];
    },
    clear() {
      store.clear();
    },
    size() {
      return store.size;
    },
  };
}

/** Shared default index, so the demo flow can index then search without wiring. */
export const sharedRagIndex: RagIndex = createRagIndex();

/**
 * Flatten a CoursePackage into assets and add them to an index (the shared
 * one by default). Returns the assets that were indexed.
 */
export function indexCoursePackage(options: IndexCoursePackageOptions): ReusableAsset[] {
  const { coursePackage, index = sharedRagIndex } = options;
  const assets = buildAssetsFromCoursePackage({ coursePackage });
  index.add(assets);
  return assets;
}
