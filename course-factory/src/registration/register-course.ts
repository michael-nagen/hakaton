// ── Registration — safe, explicit, never automatic ──────────────────
//
// Copies a validated final course JSON into the app's prebuilt folder and wires
// it into the registry (src/course-package/prebuilt/prebuilt-courses.ts) by
// inserting an import line + an array entry. Fails safely on: invalid JSON,
// duplicate id/file, existing file without --overwrite, or an unrecognized
// registry format. Touches nothing else in the app.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCoursePackage } from '../validation/validate-course-package';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// registration → src → course-factory → repo root, then into the app.
const PREBUILT_DIR = resolve(MODULE_DIR, '../../..', 'src/course-package/prebuilt');
const REGISTRY_FILE = resolve(PREBUILT_DIR, 'prebuilt-courses.ts');

export interface RegisterResult {
  courseId: string;
  jsonPath: string;
  registryUpdated: boolean;
  message: string;
}

/** Turn a course id slug into a safe JS identifier, e.g. course-js-101 → courseJs101. */
function toIdentifier(courseId: string): string {
  const camel = courseId
    .replace(/[^a-zA-Z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/[^a-zA-Z0-9]/g, '');
  const ident = /^[a-zA-Z_$]/.test(camel) ? camel : `course_${camel}`;
  return ident || 'course_registered';
}

export function registerCourse(params: { file: string; overwrite: boolean }): RegisterResult {
  const filePath = resolve(process.cwd(), params.file);
  if (!existsSync(filePath)) throw new Error(`Course file not found: ${filePath}`);

  // 1. Parse + validate before touching the app.
  let pkg: unknown;
  try {
    pkg = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (e) {
    throw new Error(`Course file is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const report = validateCoursePackage(pkg);
  if (!report.valid) {
    throw new Error(`Refusing to register an invalid CoursePackage:\n - ${report.errors.join('\n - ')}`);
  }
  const courseId = (pkg as { id: string }).id;
  const varName = toIdentifier(courseId);
  const jsonFileName = `${courseId}.json`;
  const destJson = resolve(PREBUILT_DIR, jsonFileName);

  if (!existsSync(REGISTRY_FILE)) {
    throw new Error(`Registry not found at ${REGISTRY_FILE} — cannot register.`);
  }
  const registry = readFileSync(REGISTRY_FILE, 'utf8');

  // 2. Duplicate detection (id / file / registry entry).
  const alreadyImported =
    registry.includes(`from './${jsonFileName}'`) || registry.includes(`assertCoursePackage(${varName})`);
  const fileExists = existsSync(destJson);
  if ((alreadyImported || fileExists) && !params.overwrite) {
    throw new Error(
      `Course "${courseId}" appears to be already registered ` +
        `(${fileExists ? 'json file exists' : ''}${fileExists && alreadyImported ? ' + ' : ''}${alreadyImported ? 'registry entry exists' : ''}). ` +
        'Pass --overwrite to replace it.',
    );
  }

  // 3. Copy the JSON in.
  copyFileSync(filePath, destJson);

  // 4. Update the registry unless the entry already exists (overwrite case).
  let registryUpdated = false;
  if (!alreadyImported) {
    const updated = insertIntoRegistry(registry, { varName, jsonFileName });
    writeFileSync(REGISTRY_FILE, updated, 'utf8');
    registryUpdated = true;
  }

  return {
    courseId,
    jsonPath: destJson,
    registryUpdated,
    message: registryUpdated
      ? `Registered "${courseId}": copied JSON and updated the prebuilt registry.`
      : `Overwrote JSON for "${courseId}"; registry entry already present (left as-is).`,
  };
}

/** Insert the import line + array entry, or throw if the format isn't recognized. */
function insertIntoRegistry(source: string, params: { varName: string; jsonFileName: string }): string {
  const { varName, jsonFileName } = params;

  // Anchor 1: existing `import <x> from './<y>.json';` lines — insert after the last.
  const importRe = /import\s+\w+\s+from\s+'\.\/[^']+\.json';/g;
  const importMatches = [...source.matchAll(importRe)];
  if (importMatches.length === 0) {
    throw new Error('Unrecognized registry format: no existing `import … from \'./*.json\';` lines found.');
  }
  const lastImport = importMatches[importMatches.length - 1];
  const importInsertAt = lastImport.index! + lastImport[0].length;
  const importLine = `\nimport ${varName} from './${jsonFileName}';`;

  let out = source.slice(0, importInsertAt) + importLine + source.slice(importInsertAt);

  // Anchor 2: the PREBUILT_COURSES array literal — insert an entry before its `];`.
  const arrMarker = 'const PREBUILT_COURSES';
  const markerAt = out.indexOf(arrMarker);
  if (markerAt === -1) throw new Error('Unrecognized registry format: `const PREBUILT_COURSES` not found.');
  const openAt = out.indexOf('[', markerAt);
  const closeAt = out.indexOf('];', openAt);
  if (openAt === -1 || closeAt === -1) {
    throw new Error('Unrecognized registry format: could not locate the PREBUILT_COURSES array literal.');
  }
  const entry = `  assertCoursePackage(${varName}),\n`;
  out = out.slice(0, closeAt) + entry + out.slice(closeAt);

  return out;
}
