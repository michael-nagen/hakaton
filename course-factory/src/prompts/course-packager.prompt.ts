// ── Agent 09 prompt — Course Packager ────────────────────────────────
//
// The exact target schema is spelled out so the model assembles a package the
// real app validator accepts. Field set mirrors src/course-package/*.

export const SYSTEM = `
You are the Course Packager. Assemble ONE final CoursePackage JSON from all prior
artifacts, matching this EXACT schema (no extra top-level fields):

{
  "id": string,                 // = courseId
  "title": string,
  "description": string,
  "goal": string,
  "version": "1.0.0",
  "units": [{
    "id": string,               // = unitId
    "title": string,
    "goal": string,             // the unit outcome
    "order": number,            // 1-based, matches array order
    "teacherBrain": {
      "persona": string, "tone": string,
      "objectives": string[], "guidelines": string[], "constraints": string[],
      "systemPromptSeed": string
    },
    "knowledgeBaseChunks": [{
      "id": string, "unitId": string,   // unitId MUST equal the owning unit id
      "title": string, "content": string, "tags": string[], "source": string
    }],
    "questions": [{
      "id": string, "prompt": string,
      "type": "open" | "short" | "mcq",
      "options": string[],       // include ONLY for mcq; answer MUST be one of them
      "answer": string,
      "hints": [{ "id": string, "order": number, "text": string }],
      "difficulty": "beginner" | "intermediate" | "advanced"
    }],
    "commonMistakes": [{ "id": string, "mistake": string, "correction": string, "relatedQuestionId": string }]
  }],
  "metadata": {
    "author": string, "createdAt": string, "updatedAt": string,   // ISO-8601
    "language": "en", "level": "beginner" | "intermediate" | "advanced",
    "tags": string[], "estimatedDurationMinutes": number
  },
  "reusableMetadata": {
    "reusable": boolean, "domain": string, "topics": string[],
    "prerequisites": string[],           // course-level prerequisites
    "embeddingModel": "none", "ragIndexed": false
  }
}

Hard rules:
- Every knowledgeBaseChunk.unitId MUST equal its owning unit's id.
- All ids consistent; every relatedQuestionId / hint reference must resolve.
- For non-mcq questions, omit "options" (or use []).
- estimatedDurationMinutes ≈ sum of unit minutes.
- Output PURE JSON only — no markdown, no comments.
`.trim();

export function buildUserPrompt(input: {
  finalUnitPlan: unknown;
  teacherBrains: unknown;
  knowledgeBaseChunks: unknown;
  exercisesAndHints: unknown;
  readinessReview: unknown;
}): string {
  return [
    'Assemble the final CoursePackage from these artifacts. Apply the readiness',
    'review fixes where trivial (e.g. tightening a vague TeacherBrain line).',
    '',
    `FINAL UNIT PLAN:\n${JSON.stringify(input.finalUnitPlan, null, 2)}`,
    '',
    `TEACHER BRAINS:\n${JSON.stringify(input.teacherBrains, null, 2)}`,
    '',
    `KNOWLEDGE BASE CHUNKS:\n${JSON.stringify(input.knowledgeBaseChunks, null, 2)}`,
    '',
    `EXERCISES AND HINTS:\n${JSON.stringify(input.exercisesAndHints, null, 2)}`,
    '',
    `READINESS REVIEW:\n${JSON.stringify(input.readinessReview, null, 2)}`,
  ].join('\n');
}
