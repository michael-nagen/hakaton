// ── Teacher Harness — CoursePackage loading ──────────────────────────
//
// Loads a CoursePackage two ways:
//   1. by file path (primary)  — read JSON, validate with the app validator
//   2. by registered course id — look the id up in the harness COURSE_REGISTRY,
//                                then load its file path
//
// Validation reuses the app's own `validateCoursePackage` so the harness tests
// exactly the contract the runtime enforces — it does not define its own.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { validateCoursePackage } from '../../../src/course-package/course-package.schema';
import type { CoursePackage } from '../../../src/course-package/course-package.types';
import { COURSE_REGISTRY, HARNESS_ROOT } from '../config/harness-config';

export interface LoadedCoursePackage {
  coursePackage: CoursePackage;
  /** Absolute path the package was read from. */
  sourcePath: string;
  /** Whether the app validator considered it structurally valid. */
  valid: boolean;
  /** Validation errors, if any (non-fatal — surfaced in reports). */
  validationErrors: string[];
}

/** Resolve a (possibly relative) course file path against the harness root. */
function resolveCoursePath(path: string): string {
  return isAbsolute(path) ? path : resolve(HARNESS_ROOT, path);
}

export type CourseSource =
  | { source: 'file'; path: string; courseId?: string }
  | { source: 'id'; courseId: string; path?: string };

/**
 * Load + validate a CoursePackage from a scenario's `course` block.
 *
 * Validation errors do NOT throw: a broken package is itself a finding the
 * harness should report. Only a genuinely unreadable/absent file throws.
 */
export function loadCoursePackage(course: CourseSource): LoadedCoursePackage {
  let path: string;

  if (course.source === 'id') {
    const registered = COURSE_REGISTRY[course.courseId];
    if (!registered) {
      throw new Error(
        `Unknown registered course id "${course.courseId}". Known ids: ${
          Object.keys(COURSE_REGISTRY).join(', ') || '(none)'
        }. Prefer { "source": "file", "path": "..." }.`,
      );
    }
    path = resolveCoursePath(registered);
  } else {
    path = resolveCoursePath(course.path);
  }

  if (!existsSync(path)) {
    throw new Error(`CoursePackage file not found: ${path}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`CoursePackage at ${path} is not valid JSON: ${(err as Error).message}`);
  }

  const { valid, errors } = validateCoursePackage(parsed);
  return {
    coursePackage: parsed as CoursePackage,
    sourcePath: path,
    valid,
    validationErrors: errors,
  };
}
