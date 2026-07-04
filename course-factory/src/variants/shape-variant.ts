// ── Course Factory — variant shaper ──────────────────────────────────
//
// Deep-clones the base CoursePackage and reshapes every unit to a variant's
// detail gate (content counts) and guidance style (TeacherBrain), then stamps
// variant metadata. The base is never mutated. Output is a plain object that is
// then schema-validated + gate-checked by the caller.

import type {
  CoursePackage,
  LearningUnit,
} from '../../../src/course-package/course-package.types';
import { shapeChunks, shapeMistakes, shapeQuestions } from './enrich';
import { buildTeacherBrain } from './teacher-brain-templates';
import type { VariantSpec } from './variant-specs';

/** Extra, schema-tolerated metadata keys that self-identify the variant. */
export interface VariantMetadataExtra {
  variantId: string;
  lessonDetailLevel: string;
  tutorGuidanceLevel: string;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function slugFromId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

/** Reshape one unit to the variant's detail + guidance. */
function shapeUnit(unit: LearningUnit, spec: VariantSpec): LearningUnit {
  const questions = shapeQuestions(unit, spec.questions.target, spec.hintsPerQuestion);
  const knowledgeBaseChunks = shapeChunks(unit, spec.chunks.target);
  const commonMistakes = shapeMistakes(unit, spec.mistakes.target);
  const teacherBrain = buildTeacherBrain(unit, spec.guidanceStyle);

  return {
    ...unit,
    teacherBrain,
    knowledgeBaseChunks,
    questions,
    commonMistakes,
  };
}

/**
 * Produce a variant CoursePackage from `base`. Returns a plain object (cast to
 * CoursePackage) whose metadata carries the variant tags + self-identifying
 * keys. Pure with respect to `base`.
 */
export function shapeVariant(params: {
  base: CoursePackage;
  spec: VariantSpec;
  generatedAt: string;
}): CoursePackage {
  const { base, spec, generatedAt } = params;
  const clone = deepClone(base);

  const units = clone.units.map((u) => shapeUnit(u, spec));

  const variantSlug = spec.tagSlug;
  const id = `${base.id}-${variantSlug}`;
  const title = `${base.title} — ${spec.variantName}`;

  // Preserve base tags but drop any prior variant marker, then add ours.
  const baseTags = (base.metadata.tags ?? []).filter(
    (t) => t !== 'lesson-variant' && !t.endsWith('-free') && !t.endsWith('-guided'),
  );
  const tags = [...baseTags, 'lesson-variant', variantSlug];

  // The app validator only checks known metadata keys, so these extra keys are
  // schema-safe and make each file self-describing.
  const metadata = {
    ...clone.metadata,
    updatedAt: generatedAt,
    tags,
    estimatedDurationMinutes: spec.durationTarget,
    variantId: spec.variantId,
    lessonDetailLevel: spec.lessonDetailLevel,
    tutorGuidanceLevel: spec.tutorGuidanceLevel,
  } as CoursePackage['metadata'] & VariantMetadataExtra;

  return {
    ...clone,
    id,
    title,
    units,
    metadata,
  };
}

export { slugFromId };
