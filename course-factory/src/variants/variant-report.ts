// ── Course Factory — variant manifest + generation report ────────────
//
// Builds the machine-readable manifest and the JSON/Markdown generation report.
// These DESCRIBE the generated variants; they never claim which teaches best —
// that is Teacher Harness's job, deliberately not done here.

import type { VariantSpec } from './variant-specs';

export interface VariantOutcome {
  spec: VariantSpec;
  file: string;
  status: 'success' | 'failed';
  /** Schema validity. */
  valid: boolean;
  schemaErrors: string[];
  /** Variant-gate result. */
  gatePassed: boolean;
  gateReasons: string[];
  /** Observed per-unit counts (first unit shown in tables; all kept here). */
  observed: {
    units: number;
    chunksPerUnit: number[];
    questionsPerUnit: number[];
    mistakesPerUnit: number[];
  };
}

export interface VariantManifest {
  courseId: string;
  baseCourseId: string;
  generatedAt: string;
  variantAxes: {
    lessonDetailLevel: string[];
    tutorGuidanceLevel: string[];
  };
  variants: Array<{
    variantId: string;
    variantName: string;
    file: string;
    status: 'success' | 'failed';
    lessonDetailLevel: string;
    tutorGuidanceLevel: string;
    intendedDurationMinutes: string;
    kbChunksPerUnit: string;
    questionsPerUnit: string;
    commonMistakesPerUnit: string;
    teacherBrainDetail: string;
    expectedContextSize: string;
    expectedStrength: string;
    expectedRisk: string[];
  }>;
}

function range(r: { min: number; max: number }): string {
  return r.min === r.max ? `${r.min}` : `${r.min}-${r.max}`;
}

export function buildManifest(params: {
  courseId: string;
  baseCourseId: string;
  generatedAt: string;
  outcomes: VariantOutcome[];
}): VariantManifest {
  const { courseId, baseCourseId, generatedAt, outcomes } = params;
  return {
    courseId,
    baseCourseId,
    generatedAt,
    variantAxes: {
      lessonDetailLevel: ['low', 'medium', 'high'],
      tutorGuidanceLevel: ['low', 'medium', 'high', 'very_high'],
    },
    variants: outcomes.map(({ spec, file, status }) => ({
      variantId: spec.variantId,
      variantName: spec.variantName,
      file,
      status,
      lessonDetailLevel: spec.lessonDetailLevel,
      tutorGuidanceLevel: spec.tutorGuidanceLevel,
      intendedDurationMinutes: `${spec.durationMin}-${spec.durationMax}`,
      kbChunksPerUnit: range(spec.chunks),
      questionsPerUnit: range(spec.questions),
      commonMistakesPerUnit: range(spec.mistakes),
      teacherBrainDetail: spec.teacherBrainDetail,
      expectedContextSize: spec.expectedContextSize,
      expectedStrength: spec.expectedStrength,
      expectedRisk: spec.expectedRisk,
    })),
  };
}

export interface GenerationReportJson {
  executiveSummary: string[];
  courseId: string;
  baseCourseId: string;
  generatedAt: string;
  provider: string;
  comparison: VariantManifest['variants'];
  outcomes: Array<{
    variantId: string;
    status: 'success' | 'failed';
    valid: boolean;
    schemaErrors: string[];
    gatePassed: boolean;
    gateReasons: string[];
    observed: VariantOutcome['observed'];
    whatChanged: string;
    whyItExists: string;
    expectedStrength: string;
    expectedRisk: string[];
  }>;
  warning: string;
  nextStep: string;
}

const WHAT_CHANGED: Record<string, string> = {
  minimal_free: 'Trimmed to the smallest package (2 chunks, 1 question, 1 mistake) with a short, free TeacherBrain.',
  medium_free: 'More prepared content (up to 3 chunks, 2 questions/mistakes) but the tutor stays natural/free.',
  medium_guided: 'Balanced content plus an explicit TeacherBrain: hinting, correction and advancement rules with a light flow.',
  high_guided: 'Richer content (up to 5 chunks, 3 questions, 3 mistakes) with worked examples/contrasts and stronger guidance.',
  high_very_guided: 'Richest content with a strict, ordered 8-step teaching flow and strict correction/redirect/advancement rules.',
};

const WHY_EXISTS: Record<string, string> = {
  minimal_free: 'Tests whether a (stronger) local model can teach well with minimal support and the smallest context.',
  medium_free: 'Tests whether more prepared detail helps while keeping tutor behaviour natural.',
  medium_guided: 'The balanced default candidate: structure without sounding scripted.',
  high_guided: 'Tests whether richer prepared material reduces weak-model hallucination.',
  high_very_guided: 'Tests whether very explicit step-by-step instruction prevents drift in weak models.',
};

export function buildGenerationReportJson(params: {
  courseId: string;
  baseCourseId: string;
  generatedAt: string;
  provider: string;
  manifest: VariantManifest;
  outcomes: VariantOutcome[];
}): GenerationReportJson {
  const { courseId, baseCourseId, generatedAt, provider, manifest, outcomes } = params;
  const successes = outcomes.filter((o) => o.status === 'success').length;

  return {
    executiveSummary: [
      `Generated ${outcomes.length} lesson-package variants from base course "${baseCourseId}" (${successes} succeeded).`,
      'Variants differ only along two axes: lesson detail level and tutor guidance level.',
      'No teaching-quality comparison has been performed — the next step is Teacher Harness evaluation.',
    ],
    courseId,
    baseCourseId,
    generatedAt,
    provider,
    comparison: manifest.variants,
    outcomes: outcomes.map((o) => ({
      variantId: o.spec.variantId,
      status: o.status,
      valid: o.valid,
      schemaErrors: o.schemaErrors,
      gatePassed: o.gatePassed,
      gateReasons: o.gateReasons,
      observed: o.observed,
      whatChanged: WHAT_CHANGED[o.spec.variantId] ?? '',
      whyItExists: WHY_EXISTS[o.spec.variantId] ?? '',
      expectedStrength: o.spec.expectedStrength,
      expectedRisk: o.spec.expectedRisk,
    })),
    warning:
      'Do NOT claim which variant teaches best yet. Only Teacher Harness evaluation against the chosen local/offline models can determine that.',
    nextStep:
      'Run these 5 variants through Teacher Harness against the chosen local/offline models and runtime strategies.',
  };
}

export function renderGenerationReportMarkdown(report: GenerationReportJson): string {
  const lines: string[] = [];
  lines.push(`# Variant generation report — ${report.courseId}`);
  lines.push('');
  lines.push(`- **Base course:** ${report.baseCourseId}`);
  lines.push(`- **Generated at:** ${report.generatedAt}`);
  lines.push(`- **Provider:** ${report.provider}`);
  lines.push('');
  lines.push('## 1. Executive summary');
  lines.push('');
  for (const s of report.executiveSummary) lines.push(`- ${s}`);
  lines.push('');
  lines.push('## 2. Comparison');
  lines.push('');
  lines.push(
    '| Variant | Lesson Detail | Tutor Guidance | Duration | KB/Unit | Q/Unit | Mistakes/Unit | TeacherBrain | Context | Expected Strength | Expected Risk |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const v of report.comparison) {
    lines.push(
      `| ${v.variantId} | ${v.lessonDetailLevel} | ${v.tutorGuidanceLevel} | ${v.intendedDurationMinutes} | ${v.kbChunksPerUnit} | ${v.questionsPerUnit} | ${v.commonMistakesPerUnit} | ${v.teacherBrainDetail} | ${v.expectedContextSize} | ${v.expectedStrength} | ${v.expectedRisk.join('; ')} |`,
    );
  }
  lines.push('');
  lines.push('## 3. Variants');
  lines.push('');
  for (const o of report.outcomes) {
    const badge = o.status === 'success' ? '✅' : '❌';
    lines.push(`### ${badge} ${o.variantId} (${o.status})`);
    lines.push('');
    lines.push(`- **What changed:** ${o.whatChanged}`);
    lines.push(`- **Why it exists:** ${o.whyItExists}`);
    lines.push(`- **Expected strengths:** ${o.expectedStrength}`);
    lines.push(`- **Expected risks:** ${o.expectedRisk.join('; ')}`);
    lines.push(
      `- **Observed:** ${o.observed.units} unit(s); chunks/unit ${o.observed.chunksPerUnit.join(',')}; questions/unit ${o.observed.questionsPerUnit.join(',')}; mistakes/unit ${o.observed.mistakesPerUnit.join(',')}`,
    );
    lines.push(`- **Schema valid:** ${o.valid ? 'yes' : `no (${o.schemaErrors.length} error(s))`}`);
    lines.push(`- **Gate:** ${o.gatePassed ? 'passed' : `FAILED — ${o.gateReasons.join('; ')}`}`);
    lines.push('');
  }
  lines.push('## 4. Important warning');
  lines.push('');
  lines.push(`> ${report.warning}`);
  lines.push('');
  lines.push('## 5. Next step');
  lines.push('');
  lines.push(report.nextStep);
  lines.push('');
  return lines.join('\n');
}
