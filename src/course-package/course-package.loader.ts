// ── CoursePackage v1 — loader / helpers ──────────────────────────────
//
// Single source for reading course data. Today it loads bundled local JSON;
// swapping to an API/cloud source later means changing only `getCoursePackage`
// (e.g. fetch + assertCoursePackage) — every other helper stays the same.

import sampleCourse from './sample-course.json';
import { assertCoursePackage } from './course-package.schema';
import type {
  CoursePackage,
  KnowledgeBaseChunk,
  LearningUnit,
} from './course-package.types';

/** Validate the bundled JSON once at module load, then reuse it. */
const SAMPLE_COURSE: CoursePackage = assertCoursePackage(sampleCourse);

/** In-memory registry, keyed by course id. Replace with a fetch layer later. */
const COURSE_REGISTRY: ReadonlyMap<string, CoursePackage> = new Map([
  [SAMPLE_COURSE.id, SAMPLE_COURSE],
]);

/**
 * Get the default / current course package.
 *
 * Async on purpose: when this moves behind an API, the signature does not
 * change — callers already `await` it.
 */
export async function getCoursePackage(): Promise<CoursePackage> {
  return SAMPLE_COURSE;
}

/** Look up a course by id. Returns undefined if not found. */
export async function getCourseById(params: { courseId: string }): Promise<CoursePackage | undefined> {
  return COURSE_REGISTRY.get(params.courseId);
}

/** Find a unit within a given course package. Pure / synchronous. */
export function getUnitById(params: {
  coursePackage: CoursePackage;
  unitId: string;
}): LearningUnit | undefined {
  return params.coursePackage.units.find((unit) => unit.id === params.unitId);
}

/**
 * Get the knowledge chunks that belong to a unit. Chunks live on the unit,
 * so this is just the unit's chunks — but routing through one helper keeps
 * call sites stable if storage moves to a flat/indexed structure later.
 */
export function getKnowledgeChunksForUnit(params: {
  coursePackage: CoursePackage;
  unitId: string;
}): KnowledgeBaseChunk[] {
  const unit = getUnitById(params);
  return unit ? unit.knowledgeBaseChunks : [];
}
