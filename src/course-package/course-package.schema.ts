// ── CoursePackage v1 — runtime validation ────────────────────────────
//
// A dependency-free validator so the contract can be checked at the edge
// (e.g. right after loading local JSON, or later after an API/cloud fetch)
// without pulling in a schema library for the MVP. If we adopt zod/valibot
// later, only this file needs to change — callers use `validateCoursePackage`
// and `assertCoursePackage`.

import type {
  CommonMistake,
  CourseLevel,
  CourseMetadata,
  CoursePackage,
  DeterministicOpenCheck,
  DeterministicStep,
  DeterministicStepMcq,
  Hint,
  KnowledgeBaseChunk,
  LearningUnit,
  Question,
  QuestionType,
  ReusableMetadata,
  TeacherBrain,
} from './course-package.types';

export interface ValidationResult {
  valid: boolean;
  /** Dot-paths + message for each problem, e.g. "units[0].goal: required". */
  errors: string[];
}

const COURSE_LEVELS: readonly CourseLevel[] = ['beginner', 'intermediate', 'advanced'];
const QUESTION_TYPES: readonly QuestionType[] = ['open', 'short', 'mcq'];

// ── Small primitive checkers (collect errors, never throw) ────────────

class Validator {
  readonly errors: string[] = [];

  isString(value: unknown, path: string): value is string {
    if (typeof value !== 'string' || value.length === 0) {
      this.errors.push(`${path}: expected a non-empty string`);
      return false;
    }
    return true;
  }

  isNumber(value: unknown, path: string): value is number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      this.errors.push(`${path}: expected a number`);
      return false;
    }
    return true;
  }

  isBoolean(value: unknown, path: string): value is boolean {
    if (typeof value !== 'boolean') {
      this.errors.push(`${path}: expected a boolean`);
      return false;
    }
    return true;
  }

  isStringArray(value: unknown, path: string): value is string[] {
    if (!Array.isArray(value)) {
      this.errors.push(`${path}: expected an array of strings`);
      return false;
    }
    value.forEach((item, i) => this.isString(item, `${path}[${i}]`));
    return true;
  }

  isOneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): value is T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      this.errors.push(`${path}: expected one of ${allowed.join(' | ')}`);
      return false;
    }
    return true;
  }

  isObject(value: unknown, path: string): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.errors.push(`${path}: expected an object`);
      return false;
    }
    return true;
  }

  isArray(value: unknown, path: string): value is unknown[] {
    if (!Array.isArray(value)) {
      this.errors.push(`${path}: expected an array`);
      return false;
    }
    return true;
  }
}

// ── Node validators ──────────────────────────────────────────────────

function validateTeacherBrain(v: Validator, value: unknown, path: string): void {
  if (!v.isObject(value, path)) return;
  const tb = value as Partial<TeacherBrain>;
  v.isString(tb.persona, `${path}.persona`);
  v.isString(tb.tone, `${path}.tone`);
  v.isStringArray(tb.objectives, `${path}.objectives`);
  v.isStringArray(tb.guidelines, `${path}.guidelines`);
  v.isStringArray(tb.constraints, `${path}.constraints`);
  if (tb.systemPromptSeed !== undefined) v.isString(tb.systemPromptSeed, `${path}.systemPromptSeed`);
}

function validateChunk(v: Validator, value: unknown, path: string, unitId: string): void {
  if (!v.isObject(value, path)) return;
  const c = value as Partial<KnowledgeBaseChunk>;
  v.isString(c.id, `${path}.id`);
  if (v.isString(c.unitId, `${path}.unitId`) && c.unitId !== unitId) {
    v.errors.push(`${path}.unitId: must match owning unit "${unitId}"`);
  }
  v.isString(c.title, `${path}.title`);
  v.isString(c.content, `${path}.content`);
  v.isStringArray(c.tags, `${path}.tags`);
  if (c.source !== undefined) v.isString(c.source, `${path}.source`);
}

function validateHint(v: Validator, value: unknown, path: string): void {
  if (!v.isObject(value, path)) return;
  const h = value as Partial<Hint>;
  v.isString(h.id, `${path}.id`);
  v.isNumber(h.order, `${path}.order`);
  v.isString(h.text, `${path}.text`);
}

function validateQuestion(v: Validator, value: unknown, path: string): void {
  if (!v.isObject(value, path)) return;
  const q = value as Partial<Question>;
  v.isString(q.id, `${path}.id`);
  v.isString(q.prompt, `${path}.prompt`);
  const isMcq = v.isOneOf(q.type, QUESTION_TYPES, `${path}.type`) && q.type === 'mcq';
  v.isString(q.answer, `${path}.answer`);
  if (isMcq) {
    if (v.isStringArray(q.options, `${path}.options`)) {
      if ((q.options as string[]).length < 2) v.errors.push(`${path}.options: mcq needs at least 2 options`);
      if (typeof q.answer === 'string' && !(q.options as string[]).includes(q.answer)) {
        v.errors.push(`${path}.answer: must be one of options for mcq`);
      }
    }
  }
  if (v.isArray(q.hints, `${path}.hints`)) {
    (q.hints as unknown[]).forEach((h, i) => validateHint(v, h, `${path}.hints[${i}]`));
  }
  if (q.difficulty !== undefined) v.isOneOf(q.difficulty, COURSE_LEVELS, `${path}.difficulty`);
}

function validateCommonMistake(v: Validator, value: unknown, path: string): void {
  if (!v.isObject(value, path)) return;
  const m = value as Partial<CommonMistake>;
  v.isString(m.id, `${path}.id`);
  v.isString(m.mistake, `${path}.mistake`);
  v.isString(m.correction, `${path}.correction`);
  if (m.relatedQuestionId !== undefined) v.isString(m.relatedQuestionId, `${path}.relatedQuestionId`);
}

function validateDeterministicMcq(v: Validator, value: unknown, path: string): void {
  if (!v.isObject(value, path)) return;
  const m = value as Partial<DeterministicStepMcq>;
  v.isString(m.question, `${path}.question`);
  if (v.isStringArray(m.options, `${path}.options`)) {
    if ((m.options as string[]).length < 2) v.errors.push(`${path}.options: needs at least 2 options`);
    if (v.isString(m.correctAnswer, `${path}.correctAnswer`) && !(m.options as string[]).includes(m.correctAnswer as string)) {
      v.errors.push(`${path}.correctAnswer: must be one of options`);
    }
  } else {
    // options invalid → still surface a correctAnswer problem if it is missing.
    v.isString(m.correctAnswer, `${path}.correctAnswer`);
  }
  v.isString(m.feedbackCorrect, `${path}.feedbackCorrect`);
  v.isString(m.feedbackIncorrect, `${path}.feedbackIncorrect`);
}

function validateDeterministicOpenCheck(v: Validator, value: unknown, path: string): void {
  if (!v.isObject(value, path)) return;
  const o = value as Partial<DeterministicOpenCheck>;
  v.isString(o.question, `${path}.question`);
  v.isString(o.expectedIdea, `${path}.expectedIdea`);
  v.isString(o.hint, `${path}.hint`);
  if (o.acceptableAnswers !== undefined) v.isStringArray(o.acceptableAnswers, `${path}.acceptableAnswers`);
}

function validateDeterministicStep(v: Validator, value: unknown, path: string): void {
  if (!v.isObject(value, path)) return;
  const s = value as Partial<DeterministicStep>;
  v.isString(s.id, `${path}.id`);
  v.isString(s.title, `${path}.title`);
  v.isString(s.intro, `${path}.intro`);
  if (s.example !== undefined) v.isString(s.example, `${path}.example`);
  // A step ends in EITHER an MCQ or an open check — validate whichever is
  // present, and require exactly one.
  if (s.mcq !== undefined) validateDeterministicMcq(v, s.mcq, `${path}.mcq`);
  if (s.open !== undefined) validateDeterministicOpenCheck(v, s.open, `${path}.open`);
  if (s.mcq === undefined && s.open === undefined) {
    v.errors.push(`${path}: needs either an "mcq" or an "open" check`);
  }
  v.isString(s.checkpointPrompt, `${path}.checkpointPrompt`);
  if (s.summary !== undefined) v.isString(s.summary, `${path}.summary`);
}

function validateUnit(v: Validator, value: unknown, path: string): void {
  if (!v.isObject(value, path)) return;
  const u = value as Partial<LearningUnit>;
  const unitId = typeof u.id === 'string' ? u.id : '';
  v.isString(u.id, `${path}.id`);
  v.isString(u.title, `${path}.title`);
  v.isString(u.goal, `${path}.goal`);
  v.isNumber(u.order, `${path}.order`);
  validateTeacherBrain(v, u.teacherBrain, `${path}.teacherBrain`);
  if (v.isArray(u.knowledgeBaseChunks, `${path}.knowledgeBaseChunks`)) {
    (u.knowledgeBaseChunks as unknown[]).forEach((c, i) =>
      validateChunk(v, c, `${path}.knowledgeBaseChunks[${i}]`, unitId),
    );
  }
  if (v.isArray(u.questions, `${path}.questions`)) {
    (u.questions as unknown[]).forEach((q, i) => validateQuestion(v, q, `${path}.questions[${i}]`));
  }
  if (v.isArray(u.commonMistakes, `${path}.commonMistakes`)) {
    (u.commonMistakes as unknown[]).forEach((m, i) =>
      validateCommonMistake(v, m, `${path}.commonMistakes[${i}]`),
    );
  }
  if (u.deterministicOverview !== undefined) v.isString(u.deterministicOverview, `${path}.deterministicOverview`);
  // Optional + additive: only validated when the unit opts into the
  // deterministic flow. Absent → legacy unit, nothing to check.
  if (u.deterministicSteps !== undefined && v.isArray(u.deterministicSteps, `${path}.deterministicSteps`)) {
    (u.deterministicSteps as unknown[]).forEach((s, i) =>
      validateDeterministicStep(v, s, `${path}.deterministicSteps[${i}]`),
    );
  }
}

function validateMetadata(v: Validator, value: unknown, path: string): void {
  if (!v.isObject(value, path)) return;
  const m = value as Partial<CourseMetadata>;
  v.isString(m.author, `${path}.author`);
  v.isString(m.createdAt, `${path}.createdAt`);
  v.isString(m.updatedAt, `${path}.updatedAt`);
  v.isString(m.language, `${path}.language`);
  v.isOneOf(m.level, COURSE_LEVELS, `${path}.level`);
  v.isStringArray(m.tags, `${path}.tags`);
  v.isNumber(m.estimatedDurationMinutes, `${path}.estimatedDurationMinutes`);
}

function validateReusableMetadata(v: Validator, value: unknown, path: string): void {
  if (!v.isObject(value, path)) return;
  const r = value as Partial<ReusableMetadata>;
  v.isBoolean(r.reusable, `${path}.reusable`);
  v.isString(r.domain, `${path}.domain`);
  v.isStringArray(r.topics, `${path}.topics`);
  v.isStringArray(r.prerequisites, `${path}.prerequisites`);
  v.isBoolean(r.ragIndexed, `${path}.ragIndexed`);
  if (r.embeddingModel !== undefined) v.isString(r.embeddingModel, `${path}.embeddingModel`);
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Structurally validate an unknown value against the CoursePackage v1
 * contract. Never throws — returns a list of human-readable problems so
 * callers can decide how strict to be.
 */
export function validateCoursePackage(value: unknown): ValidationResult {
  const v = new Validator();
  const root = '$';
  if (!v.isObject(value, root)) return { valid: false, errors: v.errors };

  const pkg = value as Partial<CoursePackage>;
  v.isString(pkg.id, `${root}.id`);
  v.isString(pkg.title, `${root}.title`);
  v.isString(pkg.description, `${root}.description`);
  v.isString(pkg.goal, `${root}.goal`);
  v.isString(pkg.version, `${root}.version`);

  if (v.isArray(pkg.units, `${root}.units`)) {
    if ((pkg.units as unknown[]).length === 0) v.errors.push(`${root}.units: at least one unit is required`);
    (pkg.units as unknown[]).forEach((u, i) => validateUnit(v, u, `${root}.units[${i}]`));
  }
  validateMetadata(v, pkg.metadata, `${root}.metadata`);
  validateReusableMetadata(v, pkg.reusableMetadata, `${root}.reusableMetadata`);

  return { valid: v.errors.length === 0, errors: v.errors };
}

/**
 * Validate and narrow the type, throwing on failure. Use at trust
 * boundaries where an invalid package is a hard error (e.g. app startup).
 */
export function assertCoursePackage(value: unknown): CoursePackage {
  const { valid, errors } = validateCoursePackage(value);
  if (!valid) {
    throw new Error(`Invalid CoursePackage:\n - ${errors.join('\n - ')}`);
  }
  return value as CoursePackage;
}
