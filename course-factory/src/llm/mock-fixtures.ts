// ── Mock fixtures ─────────────────────────────────────────────────────
//
// Deterministic, schema-shaped placeholder output per agent, so the WHOLE
// pipeline (plan → generate → package → validate → register) runs offline
// without an API key. Every fixture derives from one coherent MOCK_COURSE so
// ids line up and the packaged result passes the real validator.
//
// This is PLACEHOLDER content for proving harness mechanics — NOT real course
// quality. Real generation requires a strong model configured in `.env`.

import type { CoursePackage } from '../validation/validate-course-package';

const COURSE_ID = 'course-mock-demo';
const UNIT_1 = 'mock-unit-1';
const UNIT_2 = 'mock-unit-2';

// One valid CoursePackage that every fixture is projected from.
const MOCK_COURSE: CoursePackage = {
  id: COURSE_ID,
  title: 'Mock Demo Course (placeholder)',
  description: 'PLACEHOLDER course produced by the mock provider to prove the Course Factory pipeline runs offline. Not real content.',
  goal: 'Demonstrate that the Course Factory can produce a schema-valid CoursePackage end-to-end without an API key.',
  version: '1.0.0',
  units: [
    {
      id: UNIT_1,
      title: 'Mock Unit 1 (placeholder)',
      goal: 'Placeholder outcome: the learner can restate the single idea of this mock unit.',
      order: 1,
      teacherBrain: {
        persona: 'A placeholder tutor persona used only for mock runs.',
        tone: 'Neutral, clear, placeholder.',
        objectives: ['Placeholder objective: make the one idea of this unit clear.'],
        guidelines: [
          'Ground every answer in the provided knowledge chunks.',
          'Ask one short check question after explaining the idea.',
          'Do not teach content from later units (doNotTeachYet: mock-unit-2 topics).',
        ],
        constraints: [
          'This is placeholder content — do not present it as a real lesson.',
          'Stay within this unit; redirect off-topic questions back to the goal.',
        ],
        systemPromptSeed: 'You are teaching a placeholder mock unit. Advance the learner only after they answer the check question correctly.',
      },
      knowledgeBaseChunks: [
        {
          id: 'mock-kb-1-1',
          unitId: UNIT_1,
          title: 'Placeholder idea 1',
          content: 'This is a self-contained placeholder knowledge chunk for mock unit 1. It teaches exactly one idea so the runtime can send it on its own.',
          tags: ['placeholder', 'mock'],
          source: 'mock-provider',
        },
        {
          id: 'mock-kb-1-2',
          unitId: UNIT_1,
          title: 'Placeholder idea 2',
          content: 'A second short placeholder chunk for mock unit 1, again self-contained so a weak model can use it without other chunks.',
          tags: ['placeholder', 'mock'],
          source: 'mock-provider',
        },
      ],
      questions: [
        {
          id: 'mock-q-1-1',
          prompt: 'Placeholder open question: restate the one idea of this unit in your own words.',
          type: 'open',
          answer: 'Any restatement of the placeholder idea is acceptable in mock mode.',
          hints: [
            { id: 'mock-q-1-1-h-1', order: 1, text: 'Look at placeholder idea 1.' },
            { id: 'mock-q-1-1-h-2', order: 2, text: 'One sentence is enough.' },
          ],
          difficulty: 'beginner',
        },
        {
          id: 'mock-q-1-2',
          prompt: 'Placeholder multiple-choice: which option is the mock answer?',
          type: 'mcq',
          options: ['The mock answer', 'A distractor', 'Another distractor'],
          answer: 'The mock answer',
          hints: [{ id: 'mock-q-1-2-h-1', order: 1, text: 'It literally says "mock answer".' }],
          difficulty: 'beginner',
        },
      ],
      commonMistakes: [
        {
          id: 'mock-cm-1-1',
          mistake: 'Treating this placeholder content as a real lesson.',
          correction: 'Explain that mock output only proves the pipeline runs; real content needs a configured strong model.',
          relatedQuestionId: 'mock-q-1-1',
        },
      ],
    },
    {
      id: UNIT_2,
      title: 'Mock Unit 2 (placeholder)',
      goal: 'Placeholder outcome: the learner can name what this second mock unit builds toward.',
      order: 2,
      teacherBrain: {
        persona: 'A placeholder tutor persona for the second mock unit.',
        tone: 'Neutral, clear, placeholder.',
        objectives: ['Placeholder objective: connect unit 1 to unit 2.'],
        guidelines: [
          'Assume the learner completed mock unit 1.',
          'Ground answers in the provided chunks and ask one check question.',
        ],
        constraints: ['Placeholder content — not a real lesson.'],
        systemPromptSeed: 'You are teaching the second placeholder unit; briefly recall unit 1 before starting. Advance only once the learner answers the mastery check correctly and avoids the listed common mistake.',
      },
      knowledgeBaseChunks: [
        {
          id: 'mock-kb-2-1',
          unitId: UNIT_2,
          title: 'Placeholder idea 3',
          content: 'A self-contained placeholder knowledge chunk for mock unit 2, teaching a single follow-on idea.',
          tags: ['placeholder', 'mock'],
          source: 'mock-provider',
        },
        {
          id: 'mock-kb-2-2',
          unitId: UNIT_2,
          title: 'Placeholder idea 4',
          content: 'Another short, self-contained placeholder chunk for mock unit 2.',
          tags: ['placeholder', 'mock'],
          source: 'mock-provider',
        },
      ],
      questions: [
        {
          id: 'mock-q-2-1',
          prompt: 'Placeholder short question: what does mock unit 2 build toward?',
          type: 'short',
          answer: 'It builds toward demonstrating a two-unit mock course.',
          hints: [{ id: 'mock-q-2-1-h-1', order: 1, text: 'Think about the whole mock course.' }],
          difficulty: 'beginner',
        },
      ],
      commonMistakes: [
        {
          id: 'mock-cm-2-1',
          mistake: 'Skipping unit 1 context.',
          correction: 'Briefly recall the unit 1 idea before teaching unit 2.',
        },
      ],
    },
  ],
  metadata: {
    author: 'Course Factory (mock provider)',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    language: 'en',
    level: 'beginner',
    tags: ['placeholder', 'mock', 'demo'],
    estimatedDurationMinutes: 20,
  },
  reusableMetadata: {
    reusable: false,
    domain: 'demo',
    topics: ['placeholder'],
    prerequisites: [],
    embeddingModel: 'none',
    ragIndexed: false,
  },
};

// ── Per-agent projections of MOCK_COURSE (all ids consistent) ─────────

function normalizedInput(): unknown {
  return {
    courseTitle: MOCK_COURSE.title,
    targetLearner: 'Placeholder beginner learner.',
    level: 'beginner',
    teachingStyle: 'Practical, short, guided.',
    constraints: ['Placeholder run — mock provider.'],
    initialUnits: MOCK_COURSE.units.map((u) => ({ title: u.title, rawContent: [u.goal] })),
    requiredOutcomes: MOCK_COURSE.units.map((u) => u.goal),
    keyConcepts: ['placeholder'],
    examples: ['placeholder example'],
    commonMistakes: ['Treating placeholder as real content.'],
    sourceNotes: 'Generated by the mock provider.',
    avoid: ['Claiming this is real course quality.'],
    assumptions: ['Mock mode: input files are ignored; fixed 2-unit demo is produced.'],
  };
}

function outcomeMap(): unknown {
  return {
    courseOutcomes: MOCK_COURSE.units.map((u) => u.goal),
    outcomeMap: MOCK_COURSE.units.map((u) => ({ unitId: u.id, outcome: u.goal, tooBroad: false, mixedOutcomes: false })),
    warnings: [],
    suggestedChanges: [],
    assumptions: ['Mock mode fixture.'],
  };
}

function finalUnitPlan(): unknown {
  return {
    courseId: MOCK_COURSE.id,
    courseTitle: MOCK_COURSE.title,
    courseDescription: MOCK_COURSE.description,
    courseGoal: MOCK_COURSE.goal,
    domain: MOCK_COURSE.reusableMetadata.domain,
    level: MOCK_COURSE.metadata.level,
    coursePrerequisites: [],
    finalUnits: MOCK_COURSE.units.map((u) => ({
      unitId: u.id,
      title: u.title,
      order: u.order,
      outcome: u.goal,
      why: 'Placeholder rationale.',
      prerequisiteConcepts: u.order === 1 ? [] : [MOCK_COURSE.units[0].goal],
      doNotTeachYet: u.order === 1 ? ['mock-unit-2 topics'] : [],
      mainConcept: 'placeholder concept',
      estimatedMinutes: 8,
      plannedQuestionCount: u.order === 1 ? 2 : 1,
      sourceRefs: ['mock'],
    })),
    assumptions: ['Mock mode fixture: fixed 2-unit plan.'],
  };
}

function lessonDesigns(): unknown {
  return {
    lessonDesigns: MOCK_COURSE.units.map((u) => ({
      unitId: u.id,
      opening: `Placeholder opening for ${u.title}.`,
      coreExplanation: 'Placeholder core explanation.',
      example: 'Placeholder example.',
      guidedPractice: 'Placeholder guided practice.',
      understandingCheck: 'Placeholder understanding check.',
      summary: 'Placeholder summary.',
      nextStepBridge: 'Placeholder bridge to the next unit.',
    })),
  };
}

function teacherBrains(): unknown {
  return { teacherBrains: MOCK_COURSE.units.map((u) => ({ unitId: u.id, ...u.teacherBrain })) };
}

function knowledgeBaseChunks(): unknown {
  return {
    unitChunks: MOCK_COURSE.units.map((u) => ({
      unitId: u.id,
      chunks: u.knowledgeBaseChunks.map((c) => ({ id: c.id, title: c.title, content: c.content, tags: c.tags, source: c.source })),
    })),
  };
}

function exercisesAndHints(): unknown {
  return {
    unitExercises: MOCK_COURSE.units.map((u) => ({
      unitId: u.id,
      questions: u.questions,
      commonMistakes: u.commonMistakes,
    })),
  };
}

function readinessReview(): unknown {
  return {
    overallReadinessScore: 9,
    passesWeakModelReadiness: true,
    unitReviews: MOCK_COURSE.units.map((u) => ({
      unitId: u.id,
      readinessScore: 9,
      safeForWeakModel: true,
      blockingIssues: [],
      nonBlockingIssues: [],
      repairInstructions: [],
      missingTeachingSupport: [],
      modelWouldNeedToInvent: [],
    })),
  };
}

/** Mock 08b output: return the plan + four teaching artifacts unchanged (they already pass). */
function readinessRepair(): unknown {
  return {
    finalUnitPlan: finalUnitPlan(),
    lessonDesigns: (lessonDesigns() as { lessonDesigns: unknown }).lessonDesigns,
    teacherBrains: (teacherBrains() as { teacherBrains: unknown }).teacherBrains,
    knowledgeBaseChunks: knowledgeBaseChunks(),
    exercisesAndHints: exercisesAndHints(),
  };
}

/** The one fixture that MUST be a full valid CoursePackage. */
function coursePackage(): unknown {
  return MOCK_COURSE;
}

const FIXTURES: Record<string, () => unknown> = {
  '01-input-normalizer': normalizedInput,
  '02-outcome-mapper': outcomeMap,
  '03-unit-splitter': finalUnitPlan,
  '04-lesson-designer': lessonDesigns,
  '05-teacher-brain': teacherBrains,
  '06-knowledge-base-chunker': knowledgeBaseChunks,
  '07-exercise-and-hint': exercisesAndHints,
  '08-weak-model-readiness-reviewer': readinessReview,
  '08b-readiness-repair': readinessRepair,
  '09-course-packager': coursePackage,
  '10-validator-repair': coursePackage,
};

/** Return the mock completion text (JSON) for a given agent purpose. */
export function getMockCompletion(purpose: string): string {
  const build = FIXTURES[purpose];
  if (!build) {
    // Unknown purpose — return an empty object so parsing still succeeds.
    return JSON.stringify({ note: `No mock fixture for purpose "${purpose}".` });
  }
  return JSON.stringify(build(), null, 2);
}
