// ── Orchestrator ──────────────────────────────────────────────────────
//
// Sequences the agents. `plan` runs steps 1–3; `generate` runs the full pipeline
// with TWO independent gates:
//   • Readiness gate (pedagogy)  — reviewer(08) + readiness-repair(08b), ≤2 tries
//   • Schema gate (structure)    — packager(09) + validator-repair(10),   ≤3 tries
// A final course is written only when BOTH pass. Deterministic, no hidden state —
// every step's artifact is on disk before the next runs.

import type { ModelClient } from '../llm/model-provider.types';
import type { ArtifactStore } from './artifact-store';
import type { CourseInput } from './input-loader';
import type { ValidationReport } from '../validation/validation-report.types';
import { validateCoursePackage } from '../validation/validate-course-package';

import { runInputNormalizerAgent } from '../agents/01-input-normalizer.agent';
import { runOutcomeMapperAgent } from '../agents/02-outcome-mapper.agent';
import { runUnitSplitterAgent } from '../agents/03-unit-splitter.agent';
import { runLessonDesignerAgent } from '../agents/04-lesson-designer.agent';
import { runTeacherBrainAgent } from '../agents/05-teacher-brain.agent';
import { runKnowledgeBaseChunkerAgent } from '../agents/06-knowledge-base-chunker.agent';
import { runExerciseAndHintAgent } from '../agents/07-exercise-and-hint.agent';
import { runWeakModelReadinessReviewerAgent } from '../agents/08-weak-model-readiness-reviewer.agent';
import { runReadinessRepairAgent } from '../agents/08b-readiness-repair.agent';
import { runCoursePackagerAgent } from '../agents/09-course-packager.agent';
import { runValidatorRepairAgent } from '../agents/10-validator-repair.agent';

const MAX_REPAIR_ATTEMPTS = 3; // schema repair
const MAX_READINESS_REPAIRS = 2; // pedagogy repair
const MIN_UNIT_READINESS = 8;

// Micro-lesson structural limits (enforced deterministically, per unit).
const MIN_QUESTIONS = 1;
const MAX_QUESTIONS = 2;
const MIN_CHUNKS = 2;
const MAX_CHUNKS = 4;
const MIN_MINUTES = 6; // below this a unit is too small (unless it's a bridge/review unit)
const MAX_MINUTES = 10;
const MIN_MISTAKES = 1; // every real lesson needs at least one misconception to guard against
// Unit types (from the factory-internal plan, NOT the CoursePackage schema) that
// are allowed to be shorter than MIN_MINUTES.
const SHORT_UNIT_TYPES = new Set(['bridge', 'review']);

export interface PlanResult {
  normalizedInput: unknown;
  outcomeMap: unknown;
  finalUnitPlan: unknown;
}

export interface ReadinessGateResult {
  passed: boolean;
  /** Human-readable reasons the gate failed (empty when passed). */
  reasons: string[];
}

export interface GenerateResult {
  courseId: string;
  /** The packaged course, or null if readiness failed before packaging. */
  course: unknown;
  /** Pedagogy gate. */
  readinessPassed: boolean;
  readinessReasons: string[];
  /** Schema gate. Only meaningful when readinessPassed is true. */
  valid: boolean;
  errors: string[];
}

/** Best-effort course id from a (possibly invalid) package, for naming/logs. */
export function readCourseId(pkg: unknown, fallback: string): string {
  if (pkg && typeof pkg === 'object') {
    const obj = pkg as { id?: unknown; courseId?: unknown };
    const id = typeof obj.id === 'string' ? obj.id : typeof obj.courseId === 'string' ? obj.courseId : '';
    if (id.trim()) return id.trim();
  }
  return fallback;
}

/**
 * Decide the readiness gate DETERMINISTICALLY from the reviewer's report — never
 * trust the model's own boolean alone. Passes iff every unit scores >= 8, every
 * unit is safeForWeakModel, no unit has blocking issues, AND the report's own
 * passesWeakModelReadiness flag is true.
 */
export function evaluateReadinessGate(report: unknown): ReadinessGateResult {
  if (!report || typeof report !== 'object') {
    return { passed: false, reasons: ['readiness report is not an object'] };
  }
  const r = report as { passesWeakModelReadiness?: unknown; unitReviews?: unknown };
  if (!Array.isArray(r.unitReviews) || r.unitReviews.length === 0) {
    return { passed: false, reasons: ['readiness report has no unitReviews'] };
  }

  const reasons: string[] = [];
  for (const raw of r.unitReviews as unknown[]) {
    const u = (raw ?? {}) as Record<string, unknown>;
    const id = typeof u.unitId === 'string' ? u.unitId : '(unknown unit)';
    const score = typeof u.readinessScore === 'number' ? u.readinessScore : -1;
    if (score < MIN_UNIT_READINESS) reasons.push(`${id}: readinessScore ${score} < ${MIN_UNIT_READINESS}`);
    if (u.safeForWeakModel !== true) reasons.push(`${id}: safeForWeakModel is not true`);
    const blocking = Array.isArray(u.blockingIssues) ? u.blockingIssues : [];
    if (blocking.length > 0) reasons.push(`${id}: ${blocking.length} blocking issue(s)`);
  }
  if (r.passesWeakModelReadiness !== true) reasons.push('passesWeakModelReadiness is not true');

  return { passed: reasons.length === 0, reasons };
}

/** Count items keyed by unitId from an { [wrapperKey]: [{ unitId, [itemsKey]: [] }] } artifact. */
function countByUnit(artifact: unknown, wrapperKey: string, itemsKey: string): Map<string, number> {
  const out = new Map<string, number>();
  const arr = (artifact as Record<string, unknown> | null)?.[wrapperKey];
  if (Array.isArray(arr)) {
    for (const raw of arr) {
      const entry = (raw ?? {}) as Record<string, unknown>;
      const id = typeof entry.unitId === 'string' ? entry.unitId : '';
      const items = entry[itemsKey];
      if (id) out.set(id, Array.isArray(items) ? items.length : 0);
    }
  }
  return out;
}

/** Map unitId → systemPromptSeed from the teacher-brains artifact ({ teacherBrains: [...] }). */
function seedByUnit(teacherBrains: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const arr = (teacherBrains as { teacherBrains?: unknown } | null)?.teacherBrains;
  if (Array.isArray(arr)) {
    for (const raw of arr) {
      const e = (raw ?? {}) as Record<string, unknown>;
      const id = typeof e.unitId === 'string' ? e.unitId : '';
      if (id) out.set(id, typeof e.systemPromptSeed === 'string' ? e.systemPromptSeed : '');
    }
  }
  return out;
}

/** A systemPromptSeed carries an advancement rule if it mentions when to "advance". */
function hasAdvancementRule(seed: string): boolean {
  return /\badvanc/i.test(seed);
}

/**
 * DETERMINISTIC structural gate for micro-lessons, computed from the ACTUAL
 * artifacts (not the model's self-report). Per unit, enforces both the upper
 * bound (not too broad) AND the lower bound (not too small) plus a mastery gate:
 *   • estimatedMinutes in 6–10 (a "bridge"/"review" unit may be shorter than 6)
 *   • 1–2 questions
 *   • 2–4 KB chunks
 *   • at least 1 common mistake (advancement blocker)
 *   • a systemPromptSeed that states an advancement rule
 * A final CoursePackage is never produced while any unit violates these.
 */
export function evaluateStructureGate(params: {
  finalUnitPlan: unknown;
  knowledgeBaseChunks: unknown;
  exercisesAndHints: unknown;
  teacherBrains: unknown;
}): ReadinessGateResult {
  const units = (params.finalUnitPlan as { finalUnits?: unknown } | null)?.finalUnits;
  if (!Array.isArray(units) || units.length === 0) {
    return { passed: false, reasons: ['final unit plan has no finalUnits'] };
  }
  const chunkCounts = countByUnit(params.knowledgeBaseChunks, 'unitChunks', 'chunks');
  const questionCounts = countByUnit(params.exercisesAndHints, 'unitExercises', 'questions');
  const mistakeCounts = countByUnit(params.exercisesAndHints, 'unitExercises', 'commonMistakes');
  const seeds = seedByUnit(params.teacherBrains);

  const reasons: string[] = [];
  for (const raw of units as unknown[]) {
    const u = (raw ?? {}) as Record<string, unknown>;
    const id = typeof u.unitId === 'string' ? u.unitId : '(unknown unit)';
    const minutes = typeof u.estimatedMinutes === 'number' ? u.estimatedMinutes : Number.NaN;
    const unitType = typeof u.unitType === 'string' ? u.unitType.toLowerCase() : '';
    const isShortAllowed = SHORT_UNIT_TYPES.has(unitType);
    const q = questionCounts.get(id) ?? 0;
    const c = chunkCounts.get(id) ?? 0;
    const m = mistakeCounts.get(id) ?? 0;
    const seed = seeds.get(id) ?? '';

    if (!(minutes <= MAX_MINUTES)) reasons.push(`${id}: estimatedMinutes ${u.estimatedMinutes} exceeds ${MAX_MINUTES} (split it)`);
    if (!isShortAllowed && !(minutes >= MIN_MINUTES)) reasons.push(`${id}: estimatedMinutes ${u.estimatedMinutes} under ${MIN_MINUTES} (too small — enrich or merge; mark unitType "bridge"/"review" if intentional)`);
    if (q < MIN_QUESTIONS || q > MAX_QUESTIONS) reasons.push(`${id}: ${q} questions (must be ${MIN_QUESTIONS}–${MAX_QUESTIONS}; >2 means too broad — split it)`);
    if (c < MIN_CHUNKS || c > MAX_CHUNKS) reasons.push(`${id}: ${c} KB chunks (must be ${MIN_CHUNKS}–${MAX_CHUNKS})`);
    if (m < MIN_MISTAKES) reasons.push(`${id}: ${m} common mistakes (need at least ${MIN_MISTAKES} advancement blocker)`);
    if (!hasAdvancementRule(seed)) reasons.push(`${id}: systemPromptSeed has no advancement rule (must state when the learner may advance)`);
  }
  return { passed: reasons.length === 0, reasons };
}

/** Both gates must pass: model-judged readiness AND deterministic micro-lesson structure. */
export function combineGates(
  review: unknown,
  structureInputs: {
    finalUnitPlan: unknown;
    knowledgeBaseChunks: unknown;
    exercisesAndHints: unknown;
    teacherBrains: unknown;
  },
): ReadinessGateResult {
  const structure = evaluateStructureGate(structureInputs);
  const readiness = evaluateReadinessGate(review);
  return {
    passed: structure.passed && readiness.passed,
    reasons: [...structure.reasons, ...readiness.reasons],
  };
}

/** Steps 1–3 only. Returns the proposed unit plan. */
export async function runPlan(params: {
  client: ModelClient;
  store: ArtifactStore;
  input: CourseInput;
}): Promise<PlanResult> {
  const { client, store, input } = params;
  const normalizedInput = await runInputNormalizerAgent({
    client,
    store,
    input: { brief: input.brief, rawUnits: input.rawUnits, sourceMaterials: input.sourceMaterials },
  });
  const outcomeMap = await runOutcomeMapperAgent({ client, store, normalizedInput });
  const finalUnitPlan = await runUnitSplitterAgent({ client, store, normalizedInput, outcomeMap });
  return { normalizedInput, outcomeMap, finalUnitPlan };
}

/** Full pipeline: readiness gate (+repair), then schema packaging + validate/repair. */
export async function runGenerate(params: {
  client: ModelClient;
  store: ArtifactStore;
  input: CourseInput;
}): Promise<GenerateResult> {
  const { client, store, input } = params;

  let finalUnitPlan = (await runPlan(params)).finalUnitPlan;

  // Teaching artifacts (04–07).
  let lessonDesigns = await runLessonDesignerAgent({ client, store, finalUnitPlan });
  let teacherBrains = await runTeacherBrainAgent({ client, store, finalUnitPlan, lessonDesigns });
  let knowledgeBaseChunks = await runKnowledgeBaseChunkerAgent({ client, store, finalUnitPlan, lessonDesigns });
  let exercisesAndHints = await runExerciseAndHintAgent({ client, store, finalUnitPlan, lessonDesigns });

  // ── Gate 1: pedagogy readiness (model) + micro-lesson structure (deterministic) ──
  // Both must pass. Repair may SPLIT too-broad units (returns a new finalUnitPlan).
  let review = await runWeakModelReadinessReviewerAgent({
    client,
    store,
    finalUnitPlan,
    teacherBrains,
    knowledgeBaseChunks,
    exercisesAndHints,
  });
  let gate = combineGates(review, { finalUnitPlan, knowledgeBaseChunks, exercisesAndHints, teacherBrains });
  store.log(gate.passed ? '✔ readiness + structure gates passed' : `✖ readiness/structure failed: ${gate.reasons.join('; ')}`);

  for (let attempt = 1; !gate.passed && attempt <= MAX_READINESS_REPAIRS; attempt++) {
    store.log(`↻ readiness (pedagogy) repair attempt ${attempt}/${MAX_READINESS_REPAIRS} — splits too-broad units`);
    const repaired = (await runReadinessRepairAgent({
      client,
      store,
      finalUnitPlan,
      lessonDesigns,
      teacherBrains,
      knowledgeBaseChunks,
      exercisesAndHints,
      readinessReview: review,
      structureIssues: gate.reasons,
      artifactName: `08b-readiness-repair.attempt-${attempt}.json`,
    })) as {
      finalUnitPlan?: unknown;
      lessonDesigns?: unknown;
      teacherBrains?: unknown;
      knowledgeBaseChunks?: unknown;
      exercisesAndHints?: unknown;
    };

    // Fold repaired artifacts back (repair may have split units → new finalUnitPlan).
    if (repaired.finalUnitPlan !== undefined) {
      finalUnitPlan = repaired.finalUnitPlan;
      store.saveJson(`03-final-unit-plan.repaired.attempt-${attempt}.json`, finalUnitPlan);
    }
    if (repaired.lessonDesigns !== undefined) lessonDesigns = { lessonDesigns: repaired.lessonDesigns };
    if (repaired.teacherBrains !== undefined) teacherBrains = { teacherBrains: repaired.teacherBrains };
    if (repaired.knowledgeBaseChunks !== undefined) knowledgeBaseChunks = repaired.knowledgeBaseChunks;
    if (repaired.exercisesAndHints !== undefined) exercisesAndHints = repaired.exercisesAndHints;

    review = await runWeakModelReadinessReviewerAgent({
      client,
      store,
      finalUnitPlan,
      teacherBrains,
      knowledgeBaseChunks,
      exercisesAndHints,
      artifactName: `08-weak-model-readiness-review.attempt-${attempt}.json`,
    });
    gate = combineGates(review, { finalUnitPlan, knowledgeBaseChunks, exercisesAndHints, teacherBrains });
    store.log(
      gate.passed
        ? `✔ gates passed after repair attempt ${attempt}`
        : `✖ still failing after attempt ${attempt}: ${gate.reasons.join('; ')}`,
    );
  }

  store.saveJson('08-weak-model-readiness-review.final.json', review);

  if (!gate.passed) {
    store.log('✖ readiness/structure gate failed after repairs — NOT packaging a final course');
    return {
      courseId: readCourseId(finalUnitPlan, input.name),
      course: null,
      readinessPassed: false,
      readinessReasons: gate.reasons,
      valid: false,
      errors: [],
    };
  }

  // ── Gate 2: schema (structure). Package, then validate/repair. ──
  const draft = await runCoursePackagerAgent({
    client,
    store,
    finalUnitPlan,
    teacherBrains,
    knowledgeBaseChunks,
    exercisesAndHints,
    readinessReview: review,
  });

  const { course, report } = await repairUntilValid({ client, store, draft });
  const courseId = readCourseId(course, input.name);

  if (report.valid) {
    store.saveJson('12-course-package.final.json', course);
    store.log(`✔ schema validation passed — final package ready (${courseId})`);
  } else {
    store.log('✖ schema validation still failing after repair — NOT writing a final package');
  }

  return {
    courseId,
    course,
    readinessPassed: true,
    readinessReasons: [],
    valid: report.valid,
    errors: report.errors,
  };
}

/**
 * SCHEMA repair only: validate, then repair up to MAX_REPAIR_ATTEMPTS times.
 * Fixes JSON/schema/reference issues — never pedagogy. Saves the validation
 * report and each repair attempt.
 */
export async function repairUntilValid(params: {
  client: ModelClient;
  store: ArtifactStore;
  draft: unknown;
}): Promise<{ course: unknown; report: ValidationReport }> {
  const { client, store, draft } = params;

  let current = draft;
  let report = validateCoursePackage(current);
  store.saveJson('10-validation-report.json', report);
  store.log(report.valid ? '✔ draft valid on first check' : `✖ draft invalid: ${report.errors.length} error(s)`);

  let attempt = 0;
  while (!report.valid && attempt < MAX_REPAIR_ATTEMPTS) {
    attempt++;
    store.log(`↻ schema repair attempt ${attempt}/${MAX_REPAIR_ATTEMPTS}`);
    const repaired = await runValidatorRepairAgent({
      client,
      store,
      draft: current,
      errors: report.errors,
      artifactName: `11-course-package.repaired.attempt-${attempt}.json`,
    });
    current = repaired;
    report = validateCoursePackage(current);
    store.saveJson(`10-validation-report.attempt-${attempt}.json`, report);
    store.log(
      report.valid
        ? `✔ schema repair attempt ${attempt} produced a valid package`
        : `✖ still invalid after attempt ${attempt}: ${report.errors.length} error(s)`,
    );
  }

  if (report.valid && attempt > 0) store.saveJson('11-course-package.repaired.json', current);
  return { course: current, report };
}
