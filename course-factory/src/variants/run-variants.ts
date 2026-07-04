// ── Course Factory — variant generation orchestrator ────────────────
//
// Builds ONE base CoursePackage from the raw input (via the normal pipeline),
// then deterministically shapes it into the 5 detail×guidance variants. Each
// variant is schema-validated and checked against its own gate; results, a
// manifest, and a generation report are written under
// output/variants/<course-id>/. No evaluation of teaching quality is done here.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadFactoryConfig } from '../config/factory-config';
import { createModelClient } from '../llm/model-client';
import { ArtifactStore } from '../harness/artifact-store';
import { loadCourseInput } from '../harness/input-loader';
import { renderCoursePreview } from '../harness/render-preview';
import { runGenerate } from '../harness/run-course-factory';
import { validateCoursePackage } from '../validation/validate-course-package';
import type { CoursePackage } from '../../../src/course-package/course-package.types';
import { shapeVariant } from './shape-variant';
import { checkVariantGate } from './variant-gate';
import { VARIANT_SPECS, getVariantSpec, type VariantSpec } from './variant-specs';
import {
  buildGenerationReportJson,
  buildManifest,
  renderGenerationReportMarkdown,
  type VariantOutcome,
} from './variant-report';

const OUTPUT_ROOT = resolve(process.cwd(), 'output');
const RUNS_ROOT = resolve(process.cwd(), 'runs');

export interface RunVariantsOptions {
  input: string | undefined;
  forceMock: boolean;
  /** When set, only this one variant is generated (no manifest/report rewrite). */
  onlyVariant?: string;
  withPreviews?: boolean;
}

export interface RunVariantsResult {
  outDir: string;
  courseId: string;
  provider: string;
  outcomes: VariantOutcome[];
  manifestPath?: string;
  reportJsonPath?: string;
  reportMdPath?: string;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function observe(course: CoursePackage): VariantOutcome['observed'] {
  return {
    units: course.units.length,
    chunksPerUnit: course.units.map((u) => u.knowledgeBaseChunks?.length ?? 0),
    questionsPerUnit: course.units.map((u) => u.questions?.length ?? 0),
    mistakesPerUnit: course.units.map((u) => u.commonMistakes?.length ?? 0),
  };
}

/** Shape → validate → gate → write one variant file. Returns its outcome. */
function generateOneVariant(params: {
  base: CoursePackage;
  spec: VariantSpec;
  generatedAt: string;
  outDir: string;
  withPreviews: boolean;
}): VariantOutcome {
  const { base, spec, generatedAt, outDir, withPreviews } = params;
  const file = `${spec.variantId}.final.json`;

  const variant = shapeVariant({ base, spec, generatedAt });
  const validation = validateCoursePackage(variant);
  const gate = checkVariantGate(variant, spec);
  const status: 'success' | 'failed' = validation.valid && gate.passed ? 'success' : 'failed';

  // Always write the artifact (even when failed) so it can be inspected, but
  // failed ones are clearly marked in the manifest/report and via a tag.
  if (status === 'failed') {
    variant.metadata.tags = [...(variant.metadata.tags ?? []), 'variant-gate-failed'];
  }
  writeJson(resolve(outDir, file), variant);

  if (withPreviews && validation.valid) {
    const previewPath = resolve(outDir, 'previews', `${spec.variantId}.preview.md`);
    mkdirSync(resolve(previewPath, '..'), { recursive: true });
    writeFileSync(previewPath, renderCoursePreview(variant), 'utf8');
  }

  return {
    spec,
    file,
    status,
    valid: validation.valid,
    schemaErrors: validation.errors,
    gatePassed: gate.passed,
    gateReasons: gate.reasons,
    observed: observe(variant),
  };
}

/** Build the base CoursePackage from the input via the normal pipeline. */
async function buildBase(input: string | undefined, forceMock: boolean): Promise<{ base: CoursePackage; provider: string; courseId: string }> {
  const courseInput = loadCourseInput(input);
  const config = loadFactoryConfig({ forceMock });
  const client = createModelClient(config);
  const store = new ArtifactStore({ runsRoot: RUNS_ROOT, label: `${courseInput.name}-variants-base` });
  store.log(`variant base build — provider=${config.provider} input=${courseInput.dir}`);

  const result = await runGenerate({ client, store, input: courseInput });
  if (!result.readinessPassed) {
    throw new Error(`Base course failed the readiness gate — cannot build variants. Reasons: ${result.readinessReasons.join('; ')}`);
  }
  if (!result.valid) {
    throw new Error(`Base course failed schema validation — cannot build variants. Errors: ${result.errors.join('; ')}`);
  }
  return { base: result.course as CoursePackage, provider: config.provider, courseId: result.courseId };
}

export async function runVariants(options: RunVariantsOptions): Promise<RunVariantsResult> {
  const generatedAt = new Date().toISOString();
  const { base, provider, courseId } = await buildBase(options.input, options.forceMock);
  const outDir = resolve(OUTPUT_ROOT, 'variants', courseId);
  mkdirSync(outDir, { recursive: true });

  // Single-variant mode: shape/write just the requested one, no manifest rewrite.
  if (options.onlyVariant) {
    const spec = getVariantSpec(options.onlyVariant);
    if (!spec) {
      throw new Error(`Unknown variant "${options.onlyVariant}". Known: ${VARIANT_SPECS.map((v) => v.variantId).join(', ')}`);
    }
    const outcome = generateOneVariant({ base, spec, generatedAt, outDir, withPreviews: options.withPreviews ?? false });
    return { outDir, courseId, provider, outcomes: [outcome] };
  }

  const outcomes = VARIANT_SPECS.map((spec) =>
    generateOneVariant({ base, spec, generatedAt, outDir, withPreviews: options.withPreviews ?? false }),
  );

  const manifest = buildManifest({ courseId, baseCourseId: base.id, generatedAt, outcomes });
  const manifestPath = resolve(outDir, 'variant-manifest.json');
  writeJson(manifestPath, manifest);

  const reportJson = buildGenerationReportJson({ courseId, baseCourseId: base.id, generatedAt, provider, manifest, outcomes });
  const reportJsonPath = resolve(outDir, 'variant-generation-report.json');
  const reportMdPath = resolve(outDir, 'variant-generation-report.md');
  writeJson(reportJsonPath, reportJson);
  writeFileSync(reportMdPath, renderGenerationReportMarkdown(reportJson), 'utf8');

  return { outDir, courseId, provider, outcomes, manifestPath, reportJsonPath, reportMdPath };
}
