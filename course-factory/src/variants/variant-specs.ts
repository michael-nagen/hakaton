// ── Course Factory — variant specifications ──────────────────────────
//
// Five CoursePackage variants generated from the SAME base course. They differ
// on exactly two axes and nothing else (no RAG / runtime strategy / provider /
// schema differences):
//
//   A. Lesson detail level   — how much prepared content per unit
//   B. Tutor guidance level  — how explicit / step-by-step the TeacherBrain is
//
// The purpose is to later ask (via Teacher Harness — NOT here): which
// combination of detail + guidance teaches best with weak/local tutor models.

export type LessonDetailLevel = 'low' | 'medium' | 'high';
export type TutorGuidanceLevel = 'low' | 'medium' | 'high' | 'very_high';

/** Which TeacherBrain template to render (guidance axis). */
export type GuidanceStyle = 'free' | 'free_plus' | 'guided' | 'guided_rich' | 'very_guided';

/** A min/max window plus the value the shaper aims for. */
export interface CountRange {
  min: number;
  max: number;
  target: number;
}

export interface VariantSpec {
  variantId: 'minimal_free' | 'medium_free' | 'medium_guided' | 'high_guided' | 'high_very_guided';
  variantName: string;
  lessonDetailLevel: LessonDetailLevel;
  tutorGuidanceLevel: TutorGuidanceLevel;
  guidanceStyle: GuidanceStyle;
  /** Course-level duration window (metadata.estimatedDurationMinutes). */
  durationMin: number;
  durationMax: number;
  durationTarget: number;
  /** Per-unit content windows. */
  chunks: CountRange;
  questions: CountRange;
  mistakes: CountRange;
  /** Minimum hints each question must carry. */
  hintsPerQuestion: number;
  /** Human label for the TeacherBrain richness. */
  teacherBrainDetail: string;
  expectedContextSize: string;
  expectedStrength: string;
  expectedRisk: string[];
  /** metadata.tags slug, e.g. "minimal-free". */
  tagSlug: string;
}

export const VARIANT_SPECS: readonly VariantSpec[] = [
  {
    variantId: 'minimal_free',
    variantName: 'Minimal Detail + Free Tutor',
    lessonDetailLevel: 'low',
    tutorGuidanceLevel: 'low',
    guidanceStyle: 'free',
    durationMin: 6,
    durationMax: 8,
    durationTarget: 7,
    chunks: { min: 2, max: 2, target: 2 },
    questions: { min: 1, max: 1, target: 1 },
    mistakes: { min: 1, max: 1, target: 1 },
    hintsPerQuestion: 1,
    teacherBrainDetail: 'low',
    expectedContextSize: 'low',
    expectedStrength: 'fast and natural; smallest context',
    expectedRisk: [
      'too little guidance',
      'possible hallucination',
      'may skip mastery checks',
      'may over-teach future topics',
    ],
    tagSlug: 'minimal-free',
  },
  {
    variantId: 'medium_free',
    variantName: 'Medium Detail + Free Tutor',
    lessonDetailLevel: 'medium',
    tutorGuidanceLevel: 'low',
    guidanceStyle: 'free_plus',
    durationMin: 8,
    durationMax: 12,
    durationTarget: 10,
    chunks: { min: 2, max: 4, target: 3 },
    questions: { min: 1, max: 2, target: 2 },
    mistakes: { min: 1, max: 2, target: 2 },
    hintsPerQuestion: 1,
    teacherBrainDetail: 'medium',
    expectedContextSize: 'low-medium',
    expectedStrength: 'more prepared content while staying natural',
    expectedRisk: ['inconsistent style between responses', 'may still advance too early'],
    tagSlug: 'medium-free',
  },
  {
    variantId: 'medium_guided',
    variantName: 'Medium Detail + Guided Tutor',
    lessonDetailLevel: 'medium',
    tutorGuidanceLevel: 'medium',
    guidanceStyle: 'guided',
    durationMin: 10,
    durationMax: 12,
    durationTarget: 11,
    chunks: { min: 3, max: 4, target: 4 },
    questions: { min: 2, max: 2, target: 2 },
    mistakes: { min: 2, max: 2, target: 2 },
    hintsPerQuestion: 2,
    teacherBrainDetail: 'medium-high',
    expectedContextSize: 'medium',
    expectedStrength: 'balanced default: structure without sounding scripted',
    expectedRisk: ['may still be too light for struggling learners', 'may need a repair pass if rules ignored'],
    tagSlug: 'medium-guided',
  },
  {
    variantId: 'high_guided',
    variantName: 'High Detail + Guided Tutor',
    lessonDetailLevel: 'high',
    tutorGuidanceLevel: 'high',
    guidanceStyle: 'guided_rich',
    durationMin: 12,
    durationMax: 15,
    durationTarget: 13,
    chunks: { min: 4, max: 6, target: 5 },
    questions: { min: 2, max: 3, target: 3 },
    mistakes: { min: 3, max: 3, target: 3 },
    hintsPerQuestion: 2,
    teacherBrainDetail: 'high',
    expectedContextSize: 'high',
    expectedStrength: 'richest support; likely lowest hallucination for weak models',
    expectedRisk: ['larger context', 'slower responses', 'risk of over-explaining'],
    tagSlug: 'high-guided',
  },
  {
    variantId: 'high_very_guided',
    variantName: 'High Detail + Very Guided Tutor',
    lessonDetailLevel: 'high',
    tutorGuidanceLevel: 'very_high',
    guidanceStyle: 'very_guided',
    durationMin: 12,
    durationMax: 15,
    durationTarget: 14,
    chunks: { min: 4, max: 6, target: 6 },
    questions: { min: 2, max: 3, target: 3 },
    mistakes: { min: 3, max: 4, target: 4 },
    hintsPerQuestion: 3,
    teacherBrainDetail: 'very-high',
    expectedContextSize: 'high',
    expectedStrength: 'most controlled; strongest drift prevention',
    expectedRisk: ['may sound robotic', 'may over-control the tutor', 'largest context'],
    tagSlug: 'high-very-guided',
  },
];

/**
 * The default lesson-generation style. Locked to high_very_guided after Teacher
 * Harness evaluation: its strict ordered teaching flow + correction/redirect
 * rules give the weak local Llama tutor the best grounded, low-drift behaviour.
 * Other variants remain available as explicit developer options (--variant).
 */
export const DEFAULT_LESSON_VARIANT: VariantSpec['variantId'] = 'high_very_guided';

export function getVariantSpec(variantId: string): VariantSpec | undefined {
  return VARIANT_SPECS.find((v) => v.variantId === variantId);
}
