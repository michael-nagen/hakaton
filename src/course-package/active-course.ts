// ── Active default course — single source of truth ───────────────────
//
// The one active beginner course the app + harness default to. Change it HERE
// and every connected default path follows (app flow page, course loader
// default, harness real-course validation default). Other *.final.json files
// under this folder still load as catalog entries, but this is THE default.
//
// The course itself is authored in the locked high_very_guided lesson style
// (see teacher-harness/docs/tutor-defaults-decision.md).

export const DEFAULT_COURSE_ID = 'course-python-first-steps';

/** Filename of the default course package (bundled here for the app; also in course-factory/output/). */
export const DEFAULT_COURSE_FILE = 'course-python-first-steps.final.json';

/** Locked lesson-generation style the default course is authored in. */
export const DEFAULT_LESSON_VARIANT = 'high_very_guided';
