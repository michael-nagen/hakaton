# Course Factory

An **offline, CLI-first CoursePackage authoring tool** for the Maestro-style
learning runtime.

The product principle:

> **A strong model prepares the course. A weak model teaches it.**

Expensive/agentic intelligence runs here, at *build time*, to produce a detailed,
runtime-ready `CoursePackage` JSON. At *learning time* the app's `TutorRuntime`
feeds a weak/cheap/mock model only a thin slice per turn (current unit +
TeacherBrain + 2–3 KB chunks + questions/hints + progress). The factory front-loads
all the teaching intelligence so the weak model only has to execute the lesson.

## Output contract

The **runtime artifact is always a schema-valid `CoursePackage` JSON**:
`output/<course-id>.final.json`. The Tutor Runtime / weak model consumes only
**structured data** — current unit, TeacherBrain, KB chunks, questions, hints,
common mistakes, and a short progress snapshot.

**Markdown is never a runtime artifact.** A Markdown lesson plan is only an
optional, human-readable *preview*, written separately to
`output/<course-id>.preview.md` (via `--preview` or `npm run preview`). Nothing
downstream ever reads it.

### Micro-lesson unit rules (enforced)

Every final unit is a real micro-lesson (not too broad, not too small) with an
explicit mastery gate. Checked **deterministically** before any final course is
written:

- one main learning outcome / one main concept
- **6–10 minutes** (target 7–8) — over 10 ⇒ split; under 6 ⇒ too small (unless the
  unit is explicitly `unitType: "bridge"`/`"review"`)
- **1–2 questions**, one of them a **mastery check** (id ends `-mastery`)
- **2–4 KB chunks**
- **at least 1 common mistake** (treated as an advancement blocker)
- a `teacherBrain.systemPromptSeed` that states an **advancement rule** (when the
  learner may advance)

**Mastery gate:** objectives are observable "Learner can …" capabilities;
guidelines make the tutor run the mastery check and refuse to advance while a
listed common mistake is unresolved; the seed carries the advance rule.

If a unit is too broad it is **split**; if too small it is **enriched or merged**
(same concept only) — never padded. A final CoursePackage is **never produced**
while any unit violates these limits.

## Language

**English only, for now.** All generated learner-facing content — titles, unit
titles/goals, KB chunks, questions, hints, answers, common mistakes, and
TeacherBrain text — is produced in English, regardless of the source material's
language. There is no language selector. Multilingual course generation is a
planned **future extension**, not implemented yet.

## What this is NOT

- Not the `TutorRuntime` (that's `src/tutor-runtime/`).
- Not the learner UI.
- Not a runtime model or a web app.
- The main app **does not depend on this project at runtime.** The only shared
  code is the app's dependency-free CoursePackage validator, which the factory
  *imports* (never the other way around).

## Install

```bash
cd course-factory
npm install
```

Requires Node 18+ (uses the built-in global `fetch`). Scripts run TypeScript
directly via `tsx` — no build step.

## Configure `.env`

Copy the template and fill it in (`.env` is gitignored — never commit a key):

```bash
cp .env.example .env
```

| Variable                  | Meaning |
|---------------------------|---------|
| `COURSE_FACTORY_PROVIDER` | `mock` \| `openai` \| `anthropic` |
| `COURSE_FACTORY_MODEL`    | model id (e.g. `gpt-4o`, `claude-opus-4-8`) |
| `COURSE_FACTORY_API_KEY`  | API key for the provider (empty for `mock`) |
| `COURSE_FACTORY_BASE_URL` | OpenAI-compatible base URL (e.g. `https://api.openai.com/v1`); optional for Anthropic |

- **`mock`** needs no key. It returns deterministic, schema-shaped **placeholder**
  content so you can exercise the whole harness offline. It does **not** produce
  real course quality.
- **`openai`** targets any OpenAI-compatible `/chat/completions` endpoint.
- **`anthropic`** targets the Anthropic Messages API.

## Create an input course folder

```
inputs/<my-course>/
  brief.md             # required — course brief (see inputs/example-course)
  raw-units.md         # optional — your rough units & outcomes
  source-materials.md  # optional — notes, definitions, examples
```

See `inputs/example-course/` for filled-in templates. The factory may split,
merge, and reorder your units so each final unit is a focused ~10-minute lesson.

### Input size limits

The factory sends your documents to the model **whole** — it does **not** chunk
them or do retrieval/RAG over your inputs. Keep them modest:

- **Comfortable:** total input under ~150 KB (roughly ~40k tokens).
- Above that, `plan`/`generate` print a **warning** (they do not stop) — large
  inputs may exceed the model's context window or be truncated by the provider,
  producing weaker courses.
- If your material is large, split it into several smaller courses or trim
  `source-materials.md` to the essentials. Robust large-document handling is not
  implemented.

## Commands

```bash
# 1. Plan only — normalize → map outcomes → propose final micro-lessons (steps 1–3)
npm run plan     -- --input inputs/example-course

# 2. Generate — full pipeline → output/<course-id>.final.json  (the runtime artifact)
npm run generate -- --input inputs/example-course
#    add --preview to ALSO write output/<course-id>.preview.md (human-readable only)
npm run generate -- --input inputs/example-course --preview

# 3. Validate an existing course against the app's CoursePackage schema
npm run validate -- --file output/example-course.final.json

# 4. Repair — validate, then fix up to 3 times; writes <file>.repaired.json if it passes
npm run repair   -- --file output/example-course.final.json

# 5. Register — explicitly wire a validated course into the app (see below)
npm run register -- --file output/example-course.final.json

# 6. Preview — render a Markdown preview from a final JSON (NOT the runtime artifact)
npm run preview  -- --file output/example-course.final.json

# type-check
npm run typecheck
```

Add `--mock` to `plan`/`generate`/`repair` to force the mock provider regardless
of `.env` (handy before you have a key):

```bash
npm run generate -- --input inputs/example-course --mock
```

### Run with your real API key

```bash
# .env
COURSE_FACTORY_PROVIDER=openai
COURSE_FACTORY_BASE_URL=https://api.openai.com/v1
COURSE_FACTORY_MODEL=gpt-4o
COURSE_FACTORY_API_KEY=sk-...

npm run generate -- --input inputs/my-course
```

## How generation works — two independent gates

`generate` must pass **both** gates before it writes a final course:

1. **Weak-model readiness gate (pedagogy + structure).** After the teaching
   artifacts are built (lesson designs, TeacherBrains, KB chunks, exercises), two
   checks run together:
   - a reviewer scores every unit for weak-model teachability (pass needs
     **≥ 8/10**, `safeForWeakModel`, **no blocking issues**);
   - a **deterministic structure check** (computed from the real artifacts, not the
     model's word) enforces the micro-lesson limits: **1–2 questions, 2–4 KB
     chunks, 6–10 min, ≥ 1 common mistake, and an advancement rule in the
     systemPromptSeed** per unit (a `bridge`/`review` unit may be under 6 min).

   If either fails, a separate **readiness-repair** step fixes the pedagogy and,
   when a unit is too broad, **splits it into more micro-lessons** (returning an
   updated unit plan). The reviewer + structure check re-run — up to **2** repair
   attempts.

2. **Schema validation gate (structure).** Only after readiness passes is the
   `CoursePackage` assembled and checked against the app's validator. Schema/JSON/
   reference problems are fixed by a *different* repair step — up to **3** attempts.

If readiness never passes, generation **stops before packaging**: no final course
is written, all artifacts + the final readiness report are saved, and the command
exits non-zero. Schema repair is never used to paper over pedagogy problems, and
vice versa.

## Artifacts

Every run creates a self-contained, debuggable folder:

```
runs/<timestamp>-<course>/
  00-input/                         # copied brief.md / raw-units.md / source-materials.md
  01-normalized-input.json
  02-outcome-map.json
  03-final-unit-plan.json
  03-final-unit-plan.repaired.attempt-N.json   # if readiness-repair split units
  04-lesson-designs.json
  05-teacher-brains.json
  06-knowledge-base-chunks.json
  07-exercises-and-hints.json
  08-weak-model-readiness-review.json          # readiness gate report (see "two gates")
  08b-readiness-repair.attempt-N.json          # pedagogy repairs, if the gate failed
  08-weak-model-readiness-review.attempt-N.json  # re-review after each repair
  08-weak-model-readiness-review.final.json    # the report the gate decision was made on
  09-course-package.draft.json
  10-validation-report.json         # schema; + .attempt-N.json per repair
  11-course-package.repaired.json   # only if a schema repair was needed
  12-course-package.final.json      # only if BOTH gates pass
  <step>.prompt.txt                 # full system+user prompt sent for each step
  <step>.raw.txt                    # raw model response for each step
  <step>.debug.json                 # per step: provider, model, latency, parse status, char counts
  run.log                           # command, provider/model, per-step latency, paths (never logs keys)
```

Every step writes `.prompt.txt` + `.raw.txt` + `.debug.json` **even on success**,
so bad outputs from a real model are easy to diagnose.

The final valid course is also copied to `output/<course-id>.final.json` (the
runtime artifact). With `--preview`, a human-readable `output/<course-id>.preview.md`
is written too — preview only, never consumed by the runtime.

If either gate fails after its repair attempts, **no final file is written** and
the command exits non-zero — failures are never dressed up as success.

## Registering a course into the main app

Registration is a **separate, explicit, safe** step — `generate` never registers
automatically.

```bash
npm run register -- --file output/course-js-promises-101.final.json
```

It will:

1. Re-validate the course.
2. Copy the JSON to `../src/course-package/prebuilt/<course-id>.json`.
3. Insert an `import` line and a `PREBUILT_COURSES` array entry into
   `../src/course-package/prebuilt/prebuilt-courses.ts`.

After that the app's existing `getPrebuiltCourses()` surfaces the course
automatically (e.g. on the `/simple-lesson-demo` page). `TutorRuntime` and the UI
are **not** modified.

It fails safely if: the JSON is invalid, the course id / file is already
registered (unless you pass `--overwrite`), or the registry file's format isn't
recognized.

## Schema notes

The factory targets the **existing** CoursePackage schema exactly and never
changes it. Several richer pedagogy ideas (e.g. `doNotTeachYet`, `advanceCriteria`,
response-to-mistakes) don't exist as schema fields, so they are encoded into
existing fields (mostly `teacherBrain`). See [`SCHEMA_NOTES.md`](./SCHEMA_NOTES.md).
