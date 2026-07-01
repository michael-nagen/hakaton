// ── Validation wrapper — the ONE place the factory touches the main app ──
//
// We reuse the app's dependency-free CoursePackage validator directly so the
// factory can never drift out of sync with the runtime contract. That schema
// module imports only TYPES from the app, so this creates no runtime coupling
// and the app never imports anything from course-factory.
//
// If this cross-package import ever becomes awkward (e.g. the app tree moves),
// switch to a mirrored copy of the validator — this wrapper is the only file
// that would need to change. Keep any mirror in sync with:
//   ../../../src/course-package/course-package.schema.ts
//   ../../../src/course-package/course-package.types.ts

import {
  validateCoursePackage as appValidate,
  assertCoursePackage as appAssert,
} from '../../../src/course-package/course-package.schema';
import type { CoursePackage } from '../../../src/course-package/course-package.types';
import type { ValidationReport } from './validation-report.types';

export type { CoursePackage } from '../../../src/course-package/course-package.types';

/** Structurally validate an unknown value against the CoursePackage contract. */
export function validateCoursePackage(value: unknown): ValidationReport {
  const { valid, errors } = appValidate(value);
  return { valid, errors };
}

/** Validate and narrow, throwing on failure. */
export function assertCoursePackage(value: unknown): CoursePackage {
  return appAssert(value);
}
