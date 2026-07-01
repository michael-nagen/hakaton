// ── Prebuilt courses — registry + helpers ────────────────────────────
//
// The focused MVP teaches from two hand-authored CoursePackages instead of
// generating one from a prompt. This module is the single source for those
// packages: it validates the bundled JSON once, exposes lookup helpers, and
// indexes both courses into the shared reusable-RAG index.
//
// The "expensive intelligence at build time, cheap learning at runtime" idea
// lives here: the courses are structured data, and the Tutor Runtime only ever
// reads a slice of them per turn.

import bizCourse from './biz-course.json';
import awsCourse from './aws-course.json';
import { assertCoursePackage } from '../course-package.schema';
import type { CoursePackage, LearningUnit } from '../course-package.types';
import { indexCoursePackage } from '../../reusable-rag/rag-indexer';

// Validate the bundled JSON once at module load, then reuse the narrowed value.
const PREBUILT_COURSES: readonly CoursePackage[] = [
  assertCoursePackage(bizCourse),
  assertCoursePackage(awsCourse),
];

const PREBUILT_REGISTRY: ReadonlyMap<string, CoursePackage> = new Map(
  PREBUILT_COURSES.map((course) => [course.id, course]),
);

/** All prebuilt courses, in display order. */
export function getPrebuiltCourses(): readonly CoursePackage[] {
  return PREBUILT_COURSES;
}

/** Look up a prebuilt course by id. Returns undefined if not found. */
export function getPrebuiltCourseById(params: { courseId: string }): CoursePackage | undefined {
  return PREBUILT_REGISTRY.get(params.courseId);
}

/** Look up a single unit within a prebuilt course. Returns undefined if not found. */
export function getPrebuiltUnitById(params: {
  courseId: string;
  unitId: string;
}): LearningUnit | undefined {
  const course = getPrebuiltCourseById({ courseId: params.courseId });
  return course?.units.find((unit) => unit.id === params.unitId);
}

let indexResult: { indexedAssetCount: number; courseCount: number } | null = null;

/**
 * Flatten both prebuilt courses into the shared reusable-RAG index. Idempotent:
 * the index de-dupes by asset id, and this cached result avoids redundant work
 * across mounts. Returns the number of reusable assets indexed.
 */
export function indexPrebuiltCourses(): { indexedAssetCount: number; courseCount: number } {
  if (!indexResult) {
    const indexedAssetCount = PREBUILT_COURSES.reduce(
      (total, coursePackage) => total + indexCoursePackage({ coursePackage }).length,
      0,
    );
    indexResult = { indexedAssetCount, courseCount: PREBUILT_COURSES.length };
  }
  return indexResult;
}
