// ── Teacher Harness — lesson-variant evaluation orchestrator ─────────
//
// Focused experiment: ONE model (real Llama 3.2 3B via the WebLLM browser
// bridge), ONE strategy (repair_pass), the SAME six scripted learner profiles,
// and the SAME scoring — the only variable is the CoursePackage VARIANT.
//
// Variants are taken from the CourseFactory output manifest at
// course-factory/output/variants/<courseId>/variant-manifest.json. The harness
// does NOT generate variants and does NOT touch CourseFactory; it only reads
// what CourseFactory already produced.
//
// Each (variant × profile) case runs through the same controlled loop the
// model×strategy lab uses (runCase → repair_pass → scoreTurn + dimensions),
// per-variant artifacts are written under teacher-harness/runs/, and the
// per-variant aggregates are handed to the lesson-variant report builder.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getLocalModelById } from '../../../src/model-provider/local-model-catalog';
import { HARNESS_ROOT } from '../config/harness-config';
import { ArtifactStore } from '../harness/artifact-store';
import { loadCoursePackage, type CourseSource } from '../loading/load-course-package';
import { renderScenarioMarkdown } from '../reporting/report-writer';
import { buildScenarioReport } from '../scoring/score-scenario';
import type { EvalCaseResult, EvalComboResult, EvalModelTarget, EvalTurnRecord } from './eval-types';
import { bindProfilesToVariant, LESSON_VARIANT_PROFILE_TEMPLATES } from './lesson-variant-profiles';
import { createProviderForTarget, evalCallDelayMs, selectModelTargets } from './model-targets';
import { aggregateCombo, loadCases, runCase } from './run-evaluation';

/** The five lesson variants this experiment compares, in the intended order. */
export const LESSON_VARIANT_ORDER: readonly string[] = [
  'minimal_free',
  'medium_free',
  'medium_guided',
  'high_guided',
  'high_very_guided',
];

const FIXED_STRATEGY = 'repair_pass' as const;
const LLAMA_TARGET_ID = 'llama-better-offline';
/** Real WebLLM model id for the fixed target (from the app catalog). */
const LLAMA_MODEL_NAME = getLocalModelById({ id: LLAMA_TARGET_ID })?.webllmModelId ?? 'Llama-3.2-3B-Instruct-q4f16_1-MLC';

/** Where CourseFactory writes its variant output (repo-root relative to HARNESS_ROOT). */
const VARIANTS_ROOT = resolve(HARNESS_ROOT, '..', 'course-factory', 'output', 'variants');

interface ManifestEntry {
  variantId: string;
  variantName: string;
  file: string;
  status?: string;
  lessonDetailLevel?: string;
  tutorGuidanceLevel?: string;
}

/** One resolved variant: its manifest metadata + file location. */
export interface ResolvedVariant {
  variantId: string;
  variantName: string;
  filePath: string;
  /** HARNESS_ROOT-relative path usable as a CourseSource. */
  relPath: string;
  courseId: string;
  availableUnitIds: string[];
  selectedUnitId: string;
  detailLevel?: string;
  guidanceLevel?: string;
}

export interface VariantMappingRow {
  variantId: string;
  found: boolean;
  file?: string;
  courseId?: string;
  availableUnitIds?: string[];
  selectedUnitId?: string;
  detailLevel?: string;
  guidanceLevel?: string;
  note: string;
}

/** Discover a variant manifest under course-factory/output/variants/<courseId>/. */
function findManifest(courseIdHint?: string): { dir: string; entries: ManifestEntry[] } | null {
  if (!existsSync(VARIANTS_ROOT)) return null;
  const courseDirs = readdirSync(VARIANTS_ROOT)
    .map((name) => resolve(VARIANTS_ROOT, name))
    .filter((p) => statSync(p).isDirectory());

  const candidates = courseIdHint
    ? courseDirs.filter((d) => d.endsWith(courseIdHint))
    : courseDirs;
  for (const dir of [...candidates, ...courseDirs]) {
    const manifestPath = resolve(dir, 'variant-manifest.json');
    if (existsSync(manifestPath)) {
      const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { variants?: ManifestEntry[] };
      if (Array.isArray(parsed.variants)) return { dir, entries: parsed.variants };
    }
  }
  return null;
}

/** Pick the unit to evaluate: prefer the first unit shared by all variants. */
function pickComparableUnit(resolved: Array<{ availableUnitIds: string[] }>): string | null {
  if (resolved.length === 0) return null;
  const [first, ...rest] = resolved;
  for (const unitId of first.availableUnitIds) {
    if (rest.every((r) => r.availableUnitIds.includes(unitId))) return unitId;
  }
  return first.availableUnitIds[0] ?? null;
}

export interface LessonVariantResolution {
  courseDir: string | null;
  usedFallback: boolean;
  mapping: VariantMappingRow[];
  resolved: ResolvedVariant[];
  /** The unit id evaluated across all variants (comparable topic). */
  unitId: string | null;
}

/** Map the requested variant ids to real CourseFactory files. Never invents. */
export function resolveLessonVariants(params?: { courseIdHint?: string }): LessonVariantResolution {
  const manifest = findManifest(params?.courseIdHint);
  if (!manifest) {
    return {
      courseDir: null,
      usedFallback: false,
      mapping: LESSON_VARIANT_ORDER.map((variantId) => ({
        variantId,
        found: false,
        note: `No variant-manifest.json found under ${VARIANTS_ROOT}.`,
      })),
      resolved: [],
      unitId: null,
    };
  }

  const byId = new Map(manifest.entries.map((e) => [e.variantId, e]));
  const resolved: ResolvedVariant[] = [];
  const mapping: VariantMappingRow[] = [];

  for (const variantId of LESSON_VARIANT_ORDER) {
    const entry = byId.get(variantId);
    if (!entry) {
      mapping.push({ variantId, found: false, note: 'Not present in the variant manifest.' });
      continue;
    }
    const filePath = resolve(manifest.dir, entry.file);
    if (!existsSync(filePath)) {
      mapping.push({ variantId, found: false, file: entry.file, note: 'Listed in manifest but file is missing.' });
      continue;
    }
    if (entry.status && entry.status !== 'success') {
      mapping.push({ variantId, found: false, file: entry.file, note: `Manifest status is "${entry.status}", not "success".` });
      continue;
    }
    const relPath = resolve(filePath).replace(`${resolve(HARNESS_ROOT)}/`, '');
    const loaded = loadCoursePackage({ source: 'file', path: relPath });
    const availableUnitIds = loaded.coursePackage.units.map((u) => u.id);
    resolved.push({
      variantId,
      variantName: entry.variantName,
      filePath,
      relPath,
      courseId: loaded.coursePackage.id,
      availableUnitIds,
      selectedUnitId: '', // filled after the comparable unit is chosen
      detailLevel: entry.lessonDetailLevel,
      guidanceLevel: entry.tutorGuidanceLevel,
    });
  }

  const unitId = pickComparableUnit(resolved);
  for (const r of resolved) {
    r.selectedUnitId = unitId && r.availableUnitIds.includes(unitId) ? unitId : (r.availableUnitIds[0] ?? '');
    const comparable = unitId ? r.availableUnitIds.includes(unitId) : false;
    mapping.push({
      variantId: r.variantId,
      found: true,
      file: resolve(r.filePath).replace(`${resolve(HARNESS_ROOT, '..')}/`, ''),
      courseId: r.courseId,
      availableUnitIds: r.availableUnitIds,
      selectedUnitId: r.selectedUnitId,
      detailLevel: r.detailLevel,
      guidanceLevel: r.guidanceLevel,
      note: comparable
        ? 'Topic comparable — same unit id present across variants.'
        : 'Selected unit differs from the shared unit; topic comparability is weaker for this variant.',
    });
  }
  // Keep mapping in the requested display order.
  mapping.sort((a, b) => LESSON_VARIANT_ORDER.indexOf(a.variantId) - LESSON_VARIANT_ORDER.indexOf(b.variantId));

  return { courseDir: manifest.dir, usedFallback: false, mapping, resolved, unitId };
}

/** Per-variant result: the aggregate plus the run dirs it produced. */
export interface LessonVariantResult {
  variantId: string;
  variantName: string;
  courseId: string;
  unitId: string;
  detailLevel?: string;
  guidanceLevel?: string;
  combo: EvalComboResult;
  runDirs: string[];
}

export interface LessonVariantRunOutput {
  model: EvalModelTarget;
  /** Resolved real WebLLM model id (from the app catalog). */
  modelName: string;
  modelExecuted: boolean;
  strategy: typeof FIXED_STRATEGY;
  resolution: LessonVariantResolution;
  results: LessonVariantResult[];
  /** Set when the run could not complete (e.g. the browser model never attached). */
  incompleteReason?: string;
}

export interface LessonVariantRunInput {
  timestamp: string;
  verbose?: boolean;
  courseIdHint?: string;
}

/** Run the lesson-variant experiment end to end. */
export async function runLessonVariantEvaluation(input: LessonVariantRunInput): Promise<LessonVariantRunOutput> {
  const log = (msg: string) => {
    if (input.verbose) console.log(msg);
  };

  // Fixed model: the real Llama 3.2 3B, activated via explicit selection so the
  // browser bridge starts (selectModelTargets flips webllm targets runnable).
  const targets = selectModelTargets(LLAMA_TARGET_ID);
  const model = targets.requested.find((t) => t.id === LLAMA_TARGET_ID);
  if (!model) throw new Error(`Fixed model "${LLAMA_TARGET_ID}" not found in the catalog.`);

  const resolution = resolveLessonVariants({ courseIdHint: input.courseIdHint });

  if (resolution.resolved.length === 0) {
    return {
      model,
      modelName: LLAMA_MODEL_NAME,
      modelExecuted: false,
      strategy: FIXED_STRATEGY,
      resolution,
      results: [],
      incompleteReason: `No usable lesson-variant CoursePackages found under ${VARIANTS_ROOT}.`,
    };
  }

  const provider = createProviderForTarget(model);
  const paceMs = evalCallDelayMs(model);
  let modelExecuted = false;
  let incompleteReason: string | undefined;
  const results: LessonVariantResult[] = [];

  for (const variant of resolution.resolved) {
    const course: CourseSource = { source: 'file', path: variant.relPath, courseId: variant.courseId };
    const cases = bindProfilesToVariant({ variantId: variant.variantId, course, unitId: variant.selectedUnitId });
    let loadedCases;
    try {
      loadedCases = loadCases(cases);
    } catch (err) {
      log(`  ⚠️ ${variant.variantId}: could not load cases — ${(err as Error).message}`);
      continue;
    }

    log(`\n▶ variant ${variant.variantId} (${variant.variantName}) — unit ${variant.selectedUnitId}`);
    const allRecords: EvalTurnRecord[] = [];
    const perCase: EvalCaseResult[] = [];
    const runDirs: string[] = [];

    try {
      for (const loaded of loadedCases) {
        const { records, caseResult } = await runCase({ loaded, strategy: FIXED_STRATEGY, provider, paceMs });
        if (records.length > 0) modelExecuted = true;
        allRecords.push(...records);
        perCase.push(caseResult);
        runDirs.push(
          writeVariantCaseArtifacts({
            timestamp: input.timestamp,
            model,
            variant,
            loaded,
            records,
          }),
        );
        log(
          `   ${caseResult.passedTurns === caseResult.totalTurns ? '✅' : '❌'} ${loaded.evalCase.id} — ${caseResult.passedTurns}/${caseResult.totalTurns} turns` +
            (caseResult.criticalIssues.length ? `, ${caseResult.criticalIssues.length} critical` : ''),
        );
      }
    } catch (err) {
      incompleteReason = `Variant "${variant.variantId}" aborted: ${(err as Error).message}`;
      console.error(`   ✖ ${incompleteReason}`);
      break;
    }

    const combo = aggregateCombo({
      target: model,
      strategy: FIXED_STRATEGY,
      records: allRecords,
      perCase,
      casesExpected: loadedCases.length,
    });
    results.push({
      variantId: variant.variantId,
      variantName: variant.variantName,
      courseId: variant.courseId,
      unitId: variant.selectedUnitId,
      detailLevel: variant.detailLevel,
      guidanceLevel: variant.guidanceLevel,
      combo,
      runDirs,
    });
  }

  return { model, modelName: LLAMA_MODEL_NAME, modelExecuted, strategy: FIXED_STRATEGY, resolution, results, incompleteReason };
}

/** Persist one variant×profile case's turns as a normal run dir + variant metadata. */
function writeVariantCaseArtifacts(params: {
  timestamp: string;
  model: EvalModelTarget;
  variant: ResolvedVariant;
  loaded: ReturnType<typeof loadCases>[number];
  records: EvalTurnRecord[];
}): string {
  const { timestamp, model, variant, loaded, records } = params;
  const { evalCase, coursePackage, unit } = loaded;

  const store = new ArtifactStore({ scenarioId: `lesson-variant__${evalCase.id}`, timestamp });
  store.writeInputs({ scenario: evalCase, coursePackage, unit });

  // The required run metadata block.
  writeFileSync(
    resolve(store.runDir, 'variant-run-metadata.json'),
    `${JSON.stringify(
      {
        model: LLAMA_MODEL_NAME,
        strategy: FIXED_STRATEGY,
        lessonVariant: variant.variantId,
        coursePackageVariant: variant.variantId,
        courseSource: 'course-factory/output/',
        realWebLLM: records.length > 0,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  records.forEach((rec, i) => {
    store.writeTurn({
      index: i + 1,
      context: { userMessage: rec.learnerMessage, unitId: variant.selectedUnitId },
      systemPrompt: '(prompt path omitted in variant artifacts to keep them compact)',
      userPrompt: rec.learnerMessage,
      response: rec.tutorResponse,
      debug: {
        provider: model.kind,
        modelName: LLAMA_MODEL_NAME,
        strategy: FIXED_STRATEGY,
        telemetry: rec.telemetry,
        dimensions: rec.dimensions,
      },
      score: rec.base,
    });
  });

  // A compact scenario-style report per case for eyeballing.
  const report = buildScenarioReport({
    scenarioId: evalCase.id,
    scenarioTitle: `${variant.variantName} — ${evalCase.title}`,
    courseId: variant.courseId,
    unitId: variant.selectedUnitId,
    provider: model.kind,
    model: LLAMA_MODEL_NAME,
    freedomMode: evalCase.freedomMode,
    coursePackageValid: true,
    coursePackageValidationErrors: [],
    turnReports: records.map((r) => r.base),
    runDir: store.runDir,
    finishedAt: timestamp,
  });
  store.writeScenarioReport({ json: report, markdown: renderScenarioMarkdown(report) });
  return store.runDir;
}

export { LESSON_VARIANT_PROFILE_TEMPLATES };
