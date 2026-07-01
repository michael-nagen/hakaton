# Schema Notes

The Course Factory is **schema-first**: it targets the *existing* CoursePackage
contract exactly and never modifies it. This file records the real shapes (as of
inspection) and — importantly — where "desired" pedagogy fields that the schema
does **not** have are encoded instead.

Sources of truth (in the main app, imported by the factory's validator wrapper):
- `../src/course-package/course-package.types.ts`
- `../src/course-package/course-package.schema.ts` (dependency-free validator)

## Exact shapes

### CoursePackage (root)
`id, title, description, goal, version, units[], metadata, reusableMetadata`
— all top-level strings must be **non-empty**; `units` needs **≥ 1**.

### LearningUnit
`id, title, goal, order (number), teacherBrain, knowledgeBaseChunks[], questions[], commonMistakes[]`

### TeacherBrain
`persona, tone, objectives[], guidelines[], constraints[], systemPromptSeed?`
— **and nothing else.**

### KnowledgeBaseChunk
`id, unitId, title, content, tags[], source?`
— validator enforces `chunk.unitId === owning unit.id`.

### Question / Hint
`Question: id, prompt, type ('open'|'short'|'mcq'), options?, answer, hints[], difficulty?`
`Hint: id, order (number), text`
— for `mcq`: `options` needs **≥ 2** and `answer` must be **exactly one** option.

### CommonMistake
`id, mistake, correction, relatedQuestionId?`

### CourseMetadata
`author, createdAt, updatedAt, language, level ('beginner'|'intermediate'|'advanced'), tags[], estimatedDurationMinutes (number)`

### ReusableMetadata
`reusable (bool), domain, topics[], prerequisites[], embeddingModel?, ragIndexed (bool)`

## Fields the spec wanted that DON'T exist → how we encode them

The schema has **no** dedicated fields for the richer pedagogy the factory
produces. Rather than change the schema (explicitly out of scope), we encode the
information into existing fields so the weak runtime model still receives it:

| Desired idea            | Encoded into |
|-------------------------|--------------|
| `doNotTeachYet`         | `teacherBrain.constraints` (e.g. "Do not introduce X yet — that's unit N") and `teacherBrain.systemPromptSeed` |
| `advanceCriteria`       | `teacherBrain.systemPromptSeed` ("Advance only once the learner can …") |
| `responseToMistakes`    | `commonMistakes[].correction` (the operational response the tutor reads out) + `teacherBrain.systemPromptSeed` |
| `hintStrategy`          | `teacherBrain.guidelines` + the ordered `Question.hints[]` themselves (partial help before the answer) |
| `whenToSlowDown` / `whenToAskFollowUp` | `teacherBrain.guidelines` (as explicit "if … then …" steps) |
| `redirectRules`         | `teacherBrain.constraints` ("If asked about <later topic>, say it comes later and steer back to <goal>") |
| unit `lessonFlow` (opening/core/example/practice/check/summary/bridge) | design-time artifact (`04-lesson-designs.json`) only; distilled into `teacherBrain.systemPromptSeed` + `objectives`. Not persisted as a schema field. |
| `prerequisiteUnitIds` / `dependsOnConcepts` / `preparesForUnitIds` | course-level → `reusableMetadata.prerequisites`; unit-level → `teacherBrain` text |

## RAG / retrieval policy

The package is designed for **unit-level** retrieval (the runtime default). KB
chunks are authored to be short (~80–180 words) and self-contained so that the
2–3 chunks the runtime sends per turn each stand on their own. We deliberately do
**not** design for full-course retrieval, which would let a weak model jump ahead
or mix topics.

## Readiness report is factory-internal (not a CoursePackage field)

The weak-model readiness review (`08-weak-model-readiness-review*.json`:
`overallReadinessScore`, `passesWeakModelReadiness`, `unitReviews[]`) is a
**build-time quality gate**, not part of the CoursePackage contract. It is never
written into the final course and the app never sees it. The gate is enforced in
code (`evaluateReadinessGate` in `harness/run-course-factory.ts`): every unit must
score ≥ 8, be `safeForWeakModel`, and have no `blockingIssues`. Pedagogy repair
(agent 08b) and schema repair (agent 10) are deliberately separate steps.

## Output contract (JSON is the runtime artifact)

The only artifact the app / Tutor Runtime consumes is the schema-valid
`CoursePackage` **JSON** (`output/<course-id>.final.json`). Markdown is never a
runtime artifact — `output/<course-id>.preview.md` (from `--preview` / the
`preview` command) is a human-readable convenience only. Units are micro-lessons;
the harness enforces, deterministically (`evaluateStructureGate`), **1–2 questions,
2–4 KB chunks, 6–10 minutes, ≥ 1 common mistake, and an advancement rule in
`teacherBrain.systemPromptSeed`** per unit before writing any final course. The
**mastery / completion gate** is encoded with existing fields only: observable
`teacherBrain.objectives` ("Learner can …"), `guidelines` that run the mastery
check and block advancement on a listed mistake, the advancement rule in
`systemPromptSeed`, a mastery-check `question` (id suffix `-mastery`), and
`commonMistakes` as advancement blockers. The `bridge`/`review` unit type (used
only in the factory-internal plan, never in the CoursePackage) may run under 6 min.

## Validator reuse

`src/validation/validate-course-package.ts` imports `validateCoursePackage` /
`assertCoursePackage` directly from the app's `course-package.schema.ts`. That
module imports only *types*, so this creates **no runtime coupling** and the app
never imports the factory. If that cross-package import ever becomes awkward,
replace the wrapper's import with a mirrored copy of the validator — the wrapper
is the only file that would change. Keep any mirror in sync with the two source
files listed at the top.
