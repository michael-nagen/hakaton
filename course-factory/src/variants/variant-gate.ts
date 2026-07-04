// ── Course Factory — variant-specific gates ──────────────────────────
//
// Each variant is checked against ITS OWN gate (not one global rule). Detail
// gates count per-unit content; guidance gates check the TeacherBrain actually
// carries the promised structure (advancement rule, step flow, brevity, …).
// A variant that fails its gate is reported as failed — never silently shipped.

import type { CoursePackage, LearningUnit } from '../../../src/course-package/course-package.types';
import type { CountRange, VariantSpec } from './variant-specs';

export interface GateResult {
  passed: boolean;
  reasons: string[];
}

function inRange(n: number, range: CountRange): boolean {
  return n >= range.min && n <= range.max;
}

/** Guidance-axis expectations, keyed by style. */
function checkGuidance(unit: LearningUnit, spec: VariantSpec, reasons: string[]): void {
  const tb = unit.teacherBrain;
  const seed = tb.systemPromptSeed ?? '';
  const id = unit.id;
  const guidelines = tb.guidelines ?? [];

  const hasAdvancementRule = /\badvanc/i.test(seed) || guidelines.some((g) => /\badvanc/i.test(g));
  const mentionsRedirect = /redirect/i.test(seed) || tb.constraints.some((c) => /redirect/i.test(c));
  const hasStepFlow =
    guidelines.filter((g) => /^step\s*\d/i.test(g.trim())).length >= 6 || /step 1|1\)/i.test(seed);

  switch (spec.guidanceStyle) {
    case 'free':
      // Free = intentionally light. Guard against accidental over-scripting.
      if (guidelines.length > 3) reasons.push(`${id}: free variant should stay light (<=3 guidelines, got ${guidelines.length})`);
      break;
    case 'free_plus':
      if (guidelines.length < 2) reasons.push(`${id}: medium_free needs at least 2 guidelines`);
      break;
    case 'guided':
      if (!hasAdvancementRule) reasons.push(`${id}: guided variant must state an advancement rule`);
      if (guidelines.length < 4) reasons.push(`${id}: guided variant needs an explicit flow (>=4 guidelines)`);
      break;
    case 'guided_rich':
      if (!hasAdvancementRule) reasons.push(`${id}: high_guided must state an advancement rule`);
      if (guidelines.length < 5) reasons.push(`${id}: high_guided needs a richer flow (>=5 guidelines)`);
      break;
    case 'very_guided':
      if (!hasAdvancementRule) reasons.push(`${id}: high_very_guided must state an advancement rule`);
      if (!mentionsRedirect) reasons.push(`${id}: high_very_guided must instruct redirecting off-topic questions`);
      if (!hasStepFlow) reasons.push(`${id}: high_very_guided must encode an ordered step-by-step flow`);
      break;
  }
}

/** Check one shaped variant against its own detail + guidance gate. */
export function checkVariantGate(course: CoursePackage, spec: VariantSpec): GateResult {
  const reasons: string[] = [];

  const minutes = course.metadata?.estimatedDurationMinutes;
  if (typeof minutes !== 'number' || minutes < spec.durationMin || minutes > spec.durationMax) {
    reasons.push(`duration ${minutes} outside ${spec.durationMin}-${spec.durationMax} min`);
  }

  if (!Array.isArray(course.units) || course.units.length === 0) {
    reasons.push('course has no units');
    return { passed: false, reasons };
  }

  for (const unit of course.units) {
    const c = unit.knowledgeBaseChunks?.length ?? 0;
    const q = unit.questions?.length ?? 0;
    const m = unit.commonMistakes?.length ?? 0;
    if (!inRange(c, spec.chunks)) reasons.push(`${unit.id}: ${c} KB chunks (need ${spec.chunks.min}-${spec.chunks.max})`);
    if (!inRange(q, spec.questions)) reasons.push(`${unit.id}: ${q} questions (need ${spec.questions.min}-${spec.questions.max})`);
    if (!inRange(m, spec.mistakes)) reasons.push(`${unit.id}: ${m} common mistakes (need ${spec.mistakes.min}-${spec.mistakes.max})`);
    for (const question of unit.questions ?? []) {
      const h = question.hints?.length ?? 0;
      if (h < spec.hintsPerQuestion) {
        reasons.push(`${unit.id}/${question.id}: ${h} hints (need >=${spec.hintsPerQuestion})`);
      }
    }
    checkGuidance(unit, spec, reasons);
  }

  return { passed: reasons.length === 0, reasons };
}
