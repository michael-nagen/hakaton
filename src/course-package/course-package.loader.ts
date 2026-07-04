// ── CoursePackage v1 — loader / helpers ──────────────────────────────
//
// Single source for reading course data. Today it loads bundled local JSON;
// swapping to an API/cloud source later means changing only `getCoursePackage`
// (e.g. fetch + assertCoursePackage) — every other helper stays the same.

import { getPrebuiltCourseById, getPrebuiltCourses } from './courses';
import { DEFAULT_COURSE_ID } from './active-course';
import type {
  CoursePackage,
  KnowledgeBaseChunk,
  LearningUnit,
} from './course-package.types';

/**
 * Get the default / current course package: the active default course
 * (DEFAULT_COURSE_ID), falling back to the first real course if it is absent.
 *
 * Async on purpose: when this moves behind an API, the signature does not
 * change — callers already `await` it.
 */
export async function getCoursePackage(): Promise<CoursePackage> {
  const active = getPrebuiltCourseById({ courseId: DEFAULT_COURSE_ID });
  if (active) return active;
  const [first] = getPrebuiltCourses();
  if (!first) throw new Error('No courses are available.');
  return first;
}

/** Look up a course by id. Returns undefined if not found. */
export async function getCourseById(params: { courseId: string }): Promise<CoursePackage | undefined> {
  return getPrebuiltCourseById(params);
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
