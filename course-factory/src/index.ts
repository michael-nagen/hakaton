// ── Course Factory — CLI entry point ─────────────────────────────────
//
//   plan     --input <folder> [--mock]   → steps 1–3, proposed unit plan
//   generate --input <folder> [--mock]   → full pipeline → output/<id>.final.json
//   validate --file <path>               → validate an existing course JSON
//   repair   --file <path> [--mock]      → validate + repair loop
//   register --file <path> [--overwrite] → wire a course into the app registry
//
// Strong model prepares the course; the weak runtime model only teaches it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCliArgs } from './harness/cli-args';
import { checkInputSize, loadCourseInput } from './harness/input-loader';
import type { CourseInput } from './harness/input-loader';
import { ArtifactStore } from './harness/artifact-store';
import { loadFactoryConfig } from './config/factory-config';
import { createModelClient } from './llm/model-client';
import { runGenerate, runPlan, repairUntilValid, readCourseId } from './harness/run-course-factory';
import { validateCoursePackage } from './validation/validate-course-package';
import type { CoursePackage } from './validation/validate-course-package';
import { renderCoursePreview } from './harness/render-preview';
import { registerCourse } from './registration/register-course';

const RUNS_ROOT = resolve(process.cwd(), 'runs');
const OUTPUT_ROOT = resolve(process.cwd(), 'output');

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));

  switch (args.command) {
    case 'plan':
      return cmdPlan(args.input, args.mock);
    case 'generate':
      return cmdGenerate(args.input, args.mock, args.preview);
    case 'validate':
      return cmdValidate(args.file);
    case 'repair':
      return cmdRepair(args.file, args.mock);
    case 'register':
      return cmdRegister(args.file, args.overwrite);
    case 'preview':
      return cmdPreview(args.file);
  }
}

function buildClientAndStore(label: string, forceMock: boolean): { client: ReturnType<typeof createModelClient>; store: ArtifactStore } {
  const config = loadFactoryConfig({ forceMock });
  const client = createModelClient(config);
  const store = new ArtifactStore({ runsRoot: RUNS_ROOT, label });
  store.log(`provider=${config.provider} model=${config.model || client.modelName || 'n/a'}`);
  return { client, store };
}

/** Non-blocking large-input warning (the factory sends documents whole). */
function warnIfLargeInput(store: ArtifactStore, input: CourseInput): void {
  const warning = checkInputSize(input);
  if (warning) {
    store.log(`⚠ ${warning.message}`);
    console.warn(`⚠ ${warning.message}`);
  }
}

async function cmdPlan(input: string | undefined, mock: boolean): Promise<void> {
  const courseInput = loadCourseInput(input);
  const { client, store } = buildClientAndStore(courseInput.name, mock);
  store.log(`command=plan input=${courseInput.dir}`);
  warnIfLargeInput(store, courseInput);
  store.copyInputs([
    { name: 'brief.md', content: courseInput.brief },
    { name: 'raw-units.md', content: courseInput.rawUnits },
    { name: 'source-materials.md', content: courseInput.sourceMaterials },
  ]);

  const { finalUnitPlan } = await runPlan({ client, store, input: courseInput });
  store.log(`artifacts → ${store.runDir}`);
  printUnitPlan(finalUnitPlan);
  console.log('\nPlan complete. Inspect artifacts under:', store.runDir);
}

async function cmdGenerate(input: string | undefined, mock: boolean, preview: boolean): Promise<void> {
  const courseInput = loadCourseInput(input);
  const { client, store } = buildClientAndStore(courseInput.name, mock);
  store.log(`command=generate input=${courseInput.dir}`);
  warnIfLargeInput(store, courseInput);
  store.copyInputs([
    { name: 'brief.md', content: courseInput.brief },
    { name: 'raw-units.md', content: courseInput.rawUnits },
    { name: 'source-materials.md', content: courseInput.sourceMaterials },
  ]);

  const result = await runGenerate({ client, store, input: courseInput });

  if (!result.readinessPassed) {
    console.error('\n✖ Weak-model readiness gate FAILED — the course is not teachable by a weak model.');
    console.error('  No final course was packaged. Reasons:');
    for (const r of result.readinessReasons) console.error(`  - ${r}`);
    console.error(`\nInspect artifacts (see 08-weak-model-readiness-review.final.json) under: ${store.runDir}`);
    process.exitCode = 1;
    return;
  }

  if (!result.valid) {
    console.error(`\n✖ Readiness passed but SCHEMA validation failed. Errors (${result.errors.length}):`);
    for (const e of result.errors) console.error(`  - ${e}`);
    console.error(`\nInspect artifacts under: ${store.runDir}`);
    process.exitCode = 1;
    return;
  }

  const outPath = resolve(OUTPUT_ROOT, `${result.courseId}.final.json`);
  writeJson(outPath, result.course);
  store.log(`final output → ${outPath}`);
  console.log(`\n✔ Generated a valid course: ${result.courseId}`);
  console.log(`  Final JSON (runtime artifact): ${outPath}`);

  if (preview) {
    const previewPath = resolve(OUTPUT_ROOT, `${result.courseId}.preview.md`);
    writeFileSync(previewPath, renderCoursePreview(result.course as CoursePackage), 'utf8');
    store.log(`preview → ${previewPath}`);
    console.log(`  Preview (human-readable, NOT runtime): ${previewPath}`);
  }
  console.log(`  Artifacts:  ${store.runDir}`);
  if (client.providerId === 'mock') {
    console.log('\n  NOTE: mock provider → placeholder content only. Configure .env for real generation.');
  }
  console.log(`\n  To register into the app:  npm run register -- --file output/${result.courseId}.final.json`);
}

function cmdValidate(file: string | undefined): void {
  const pkg = loadJsonFile(file);
  const report = validateCoursePackage(pkg);
  if (report.valid) {
    console.log(`✔ Valid CoursePackage: ${readCourseId(pkg, '(unknown id)')}`);
    return;
  }
  console.error(`✖ Invalid CoursePackage — ${report.errors.length} error(s):`);
  for (const e of report.errors) console.error(`  - ${e}`);
  process.exitCode = 1;
}

async function cmdRepair(file: string | undefined, mock: boolean): Promise<void> {
  const filePath = requireFile(file);
  const pkg = loadJsonFile(file);

  const initial = validateCoursePackage(pkg);
  if (initial.valid) {
    console.log(`✔ Already valid — nothing to repair: ${readCourseId(pkg, '(unknown id)')}`);
    return;
  }

  const courseId = readCourseId(pkg, 'repair');
  const { client, store } = buildClientAndStore(`${courseId}-repair`, mock);
  store.log(`command=repair file=${filePath}`);
  store.copyInputFile(filePath, 'input-course.json');

  const { course, report } = await repairUntilValid({ client, store, draft: pkg });
  if (!report.valid) {
    console.error(`\n✖ Could not repair to a valid course. Remaining errors (${report.errors.length}):`);
    for (const e of report.errors) console.error(`  - ${e}`);
    console.error(`\nInspect artifacts under: ${store.runDir}`);
    process.exitCode = 1;
    return;
  }

  const repairedPath = filePath.replace(/\.json$/i, '') + '.repaired.json';
  writeJson(repairedPath, course);
  store.log(`repaired output → ${repairedPath}`);
  console.log(`\n✔ Repaired to a valid course: ${readCourseId(course, courseId)}`);
  console.log(`  Repaired JSON: ${repairedPath}`);
}

function cmdPreview(file: string | undefined): void {
  requireFile(file);
  const pkg = loadJsonFile(file);
  const report = validateCoursePackage(pkg);
  if (!report.valid) {
    console.error(`✖ Refusing to preview an invalid CoursePackage — ${report.errors.length} error(s):`);
    for (const e of report.errors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }
  const courseId = readCourseId(pkg, 'course');
  const outPath = resolve(OUTPUT_ROOT, `${courseId}.preview.md`);
  writeFileSync(outPath, renderCoursePreview(pkg as CoursePackage), 'utf8');
  console.log(`✔ Wrote preview (human-readable, NOT the runtime artifact): ${outPath}`);
}

function cmdRegister(file: string | undefined, overwrite: boolean): void {
  requireFile(file);
  const result = registerCourse({ file: file as string, overwrite });
  console.log(`✔ ${result.message}`);
  console.log(`  JSON: ${result.jsonPath}`);
  console.log(`  Registry updated: ${result.registryUpdated ? 'yes' : 'no'}`);
  console.log('  The app now surfaces it via getPrebuiltCourses() (e.g. /simple-lesson-demo).');
}

// ── helpers ───────────────────────────────────────────────────────────

function requireFile(file: string | undefined): string {
  if (!file) throw new Error('Missing --file <path>.');
  const filePath = resolve(process.cwd(), file);
  if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return filePath;
}

function loadJsonFile(file: string | undefined): unknown {
  const filePath = requireFile(file);
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (e) {
    throw new Error(`File is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
}

function printUnitPlan(finalUnitPlan: unknown): void {
  const plan = finalUnitPlan as {
    courseId?: string;
    courseTitle?: string;
    finalUnits?: Array<{ unitId?: string; title?: string; outcome?: string; estimatedMinutes?: number }>;
    assumptions?: string[];
  };
  console.log('\n── Proposed unit plan ──');
  console.log(`Course: ${plan.courseTitle ?? '(untitled)'} [${plan.courseId ?? '?'}]`);
  for (const u of plan.finalUnits ?? []) {
    console.log(`  • [${u.unitId ?? '?'}] ${u.title ?? ''} (~${u.estimatedMinutes ?? '?'} min)`);
    if (u.outcome) console.log(`      outcome: ${u.outcome}`);
  }
  if (plan.assumptions?.length) {
    console.log('  Assumptions:');
    for (const a of plan.assumptions) console.log(`    - ${a}`);
  }
}

main().catch((err) => {
  console.error(`\n✖ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
