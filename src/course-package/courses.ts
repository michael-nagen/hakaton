// ── Real courses — the app's source of truth ─────────────────────────
//
// Loads every real CoursePackage JSON that lives in this folder
// (src/course-package/*.final.json) and validates it once at module load.
// There are NO demo/sample/placeholder courses: whatever *.final.json files are
// here ARE the catalog. To add a course, copy its "<course-id>.final.json" into
// this folder — it is picked up automatically, no code change needed.

import { assertCoursePackage } from './course-package.schema';
import type { CoursePackage, LearningUnit } from './course-package.types';
import { indexCoursePackage } from '../reusable-rag/rag-indexer';

// ── Runtime-agnostic folder scan ─────────────────────────────────────
// In the app, Vite eagerly bundles every *.final.json at build time via
// import.meta.glob. That API does not exist under plain Node, where the
// teacher-harness CLI (tsx) imports this module through the tutor runtime —
// there we do the same "whatever *.final.json files are here ARE the catalog"
// scan with Node built-ins (obtained via process.getBuiltinModule so the
// browser bundle carries no node imports). Both branches yield the same shape.

/** Minimal structural types so this file typechecks with AND without @types/node. */
interface NodeFsLike {
  readdirSync(path: string): string[];
  readFileSync(path: string, encoding: 'utf8'): string;
}
interface NodeUrlLike {
  fileURLToPath(url: string): string;
}
interface NodePathLike {
  join(...parts: string[]): string;
  dirname(path: string): string;
}

function loadCourseJsonModules(): Record<string, { default: unknown }> {
  // Vite/Vitest define import.meta.env; plain Node (tsx) does not. Inside a
  // Vite-powered runtime, import.meta.glob must be called BY FULL NAME so the
  // transform can statically replace it.
  const isViteRuntime = typeof (import.meta as { env?: unknown }).env !== 'undefined';
  if (isViteRuntime) {
    // @ts-ignore -- glob is typed only where vite/client types are loaded (app tsconfig).
    return import.meta.glob('./*.final.json', { eager: true }) as Record<string, { default: unknown }>;
  }

  const getBuiltin = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } })
    .process?.getBuiltinModule;
  if (!getBuiltin) throw new Error('No course loader available: neither Vite glob nor Node built-ins.');
  const fs = getBuiltin('node:fs') as NodeFsLike;
  const url = getBuiltin('node:url') as NodeUrlLike;
  const path = getBuiltin('node:path') as NodePathLike;

  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const result: Record<string, { default: unknown }> = {};
  for (const name of fs.readdirSync(here)) {
    if (name.endsWith('.final.json')) {
      result[`./${name}`] = { default: JSON.parse(fs.readFileSync(path.join(here, name), 'utf8')) };
    }
  }
  return result;
}

const modules = loadCourseJsonModules();

/** All real courses, validated, in stable (filename) order. */
const REAL_COURSES: readonly CoursePackage[] = Object.keys(modules)
  .sort()
  .map((path) => assertCoursePackage(modules[path].default));

const REGISTRY: ReadonlyMap<string, CoursePackage> = new Map(
  REAL_COURSES.map((course) => [course.id, course]),
);

/** All available courses, in display order. */
export function getPrebuiltCourses(): readonly CoursePackage[] {
  return REAL_COURSES;
}

/** Look up a course by id. Returns undefined if not found. */
export function getPrebuiltCourseById(params: { courseId: string }): CoursePackage | undefined {
  return REGISTRY.get(params.courseId);
}

/** Look up a single unit within a course. Returns undefined if not found. */
export function getPrebuiltUnitById(params: {
  courseId: string;
  unitId: string;
}): LearningUnit | undefined {
  return getPrebuiltCourseById({ courseId: params.courseId })?.units.find(
    (unit) => unit.id === params.unitId,
  );
}

let indexResult: { indexedAssetCount: number; courseCount: number } | null = null;

/**
 * Flatten all courses into the shared reusable-RAG index. Idempotent and cached
 * across mounts. Returns the number of reusable assets indexed.
 */
export function indexPrebuiltCourses(): { indexedAssetCount: number; courseCount: number } {
  if (!indexResult) {
    const indexedAssetCount = REAL_COURSES.reduce(
      (total, coursePackage) => total + indexCoursePackage({ coursePackage }).length,
      0,
    );
    indexResult = { indexedAssetCount, courseCount: REAL_COURSES.length };
  }
  return indexResult;
}
