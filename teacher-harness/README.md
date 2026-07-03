# Teacher / Lesson Harness

A separate, top-level CLI tool that **operates the lesson loop** for a generated
`CoursePackage` and reports whether a weak/cheap/local/mock tutor model can
actually *teach* it using only the minimal Tutor Runtime context.

It is not a course generator, not a UI, and not a multi-agent teacher. It is the
controlled runner that closes the loop:

```
raw material → Course Factory → CoursePackage JSON → Tutor Runtime
             → weak model → Teacher/Lesson Harness run → artifacts + report
```

## The core principle

**The harness operates the model — the model does not operate the harness.**

| Layer | Responsibility |
| --- | --- |
| **Lesson Harness** (this tool) | Owns lesson state, flow, allowed actions, context selection, validation, scoring, artifacts, reports. Deterministic controller. |
| **Tutor Agent / Model** | Produces tutor-facing text. *May suggest* a validated instructional action. Does **not** execute actions, unlock lessons, mark completion, or freely search the course. |
| **Course Knowledge / RAG** | A service/tool boundary called *by the harness* (stubbed for MVP). Never an autonomous agent. |
| **Rule-based scorer** | Deterministic checks. Not an LLM judge. |

The harness owns `LessonState` (`src/runtime/lesson-state.types.ts`). The model
can only *suggest* an action; the harness validates and executes it
(`src/runtime/lesson-actions.ts`). For the MVP the only executable actions are
`respond`, `say_unsure`, and `complete_lesson`; the wider vocabulary
(`give_hint`, `ask_check_question`, `open_next_lesson`, `retrieve_course_context`)
is defined but recognised-not-executed, so it can be enabled later without
reshaping callers.

## What it reuses from the main app

The harness depends **one-way** on the main app runtime and never the reverse.
It reuses the *real* runtime so it tests exactly what ships:

- `buildTutorContext` + `buildTutorPrompt` (`src/tutor-runtime/…`) — minimal,
  single-unit context and the model-ready prompt.
- `validateCoursePackage` (`src/course-package/course-package.schema.ts`) — the
  same structural validation the app enforces.
- `getUnitById` (`src/course-package/course-package.loader.ts`).
- The `ModelProvider` interface (`src/model-provider/model-provider.types.ts`).

The only harness-side adapters are: a thin turn adapter that also returns the
`TutorContext` (needed for scoring/artifacts), a deterministic mock tutor, and a
small self-contained OpenAI-compatible client (the app's own client is not
reused because it pulls in browser-only rate-limit state).

## Install

```bash
cd teacher-harness
npm install
```

Requires Node 18+ (uses global `fetch`). TypeScript runs directly via `tsx`.

## Locked default configuration

The evaluation experiments settled on one best-known setup, now the default
(`src/config/locked-config.ts`):

| Field | Locked value |
| --- | --- |
| Model | `Llama-3.2-3B-Instruct-q4f16_1-MLC` (real WebLLM) |
| Runtime strategy | `repair_pass` |
| Lesson variant/style | `high_very_guided` |
| Memory mode | `last_messages_only` |
| Last messages limit | `8` |
| Lesson completion | disabled |

Consequences: the default lesson-memory is `last_messages_only(8)`
(`LESSON_MEMORY_DEFAULTS`), and bare `npm run evaluate` runs ONLY the locked
combo (Llama × repair_pass) rather than the full matrix. The other models,
strategies, memory modes and lesson variants remain available for developer
experiments and to reproduce historical reports — request them explicitly
(e.g. `--models all --strategies all`, `--memory-mode structured_working_memory`).
The app's matching local-device default lives in
`src/lesson-runtime/local-tutor-defaults.ts`.

## Commands

Run one scenario against the offline mock:

```bash
npm run run -- --scenario scenarios/example-python-printing.scenario.json --mock
```

Run one scenario (provider resolved from `.env` / scenario):

```bash
npm run run -- --scenario scenarios/example-js-promises.scenario.json
```

Run every `*.scenario.json` in a directory:

```bash
npm run batch -- --scenarios scenarios --mock
```

Re-summarise existing run artifacts:

```bash
npm run report -- --run runs
```

Run the internal model × strategy × learner-profile evaluation lab
(reports land in `reports/model-strategy-evaluation-<timestamp>.{json,md}`):

```bash
# full matrix: all runnable models, all 5 strategies, all 6 scripted learner
# profiles, plus every *.scenario.json in scenarios/ as extra cases
npm run evaluate -- --scenarios scenarios --models all --strategies all

# cheap offline mechanics check
npm run evaluate -- --models mock --strategies all --profiles all

# one combination
npm run evaluate -- --models proxy:gemini-flash-lite-latest --strategies repair_pass --profiles struggling-learner

# the REAL on-device Llama 3.2 3B against all strategies (opens a browser bridge)
npm run evaluate:llama
```

Notes on honesty: the app's two real offline models (Gemma 2 2B, Llama 3.2 3B)
run on WebLLM/WebGPU **in a browser only**. Selecting one explicitly (e.g.
`--models llama_3_2_3b` or `npm run evaluate:llama`) starts a local **browser
bridge**: the CLI prints a URL, you open it in Chrome/Edge (WebGPU), and the
page runs the actual on-device model for every turn — the report then says
"Actual <model> was tested". Broad selectors (`--models all|mock|proxies`) do
NOT run the WebLLM models; they list them as "not evaluated" so nothing
on-device is faked. Cloud models on the configured openai-compatible endpoint
run as clearly labelled proxies. See `docs/webllm-browser-evaluation.md` for the
bridge details, port/cache notes, and a manual fallback checklist. Proxy model
list is overridable via `TEACHER_HARNESS_EVAL_PROXY_MODELS`.

Typecheck:

```bash
npm run typecheck
```

Exit code is non-zero when any scenario fails (`evaluate` always exits 0 when
the evaluation itself completes — a failing tutor is a result, not an error),
so this composes in CI.

## Providers

Configured via `.env` (copy `.env.example`). **Never commit a real key** — `.env`
is gitignored.

```
TEACHER_HARNESS_PROVIDER=   # "mock" (default) | "openai-compatible"
TEACHER_HARNESS_MODEL=      # e.g. gpt-4o-mini, llama-3.1-8b-instruct
TEACHER_HARNESS_API_KEY=
TEACHER_HARNESS_BASE_URL=   # e.g. https://api.openai.com/v1
```

Provider precedence (highest first): `--mock` → `TEACHER_HARNESS_PROVIDER`
(global override) → the scenario's `provider` field → `mock`.

- **mock** — deterministic, offline. Stitches a grounded, hint-first,
  redirect-aware reply out of the *prepared* prompt material. It proves harness
  **mechanics**; it is **not** a quality signal.
- **openai-compatible** — a small fetch client for testing real weak/cheap
  models. The key rides in the `Authorization` header and is never logged.

## Scenarios

A scenario is a scripted learner session (`scenarios/*.scenario.json`):

```jsonc
{
  "id": "python-printing-unit-1-basic",
  "title": "…",
  "course": { "source": "file", "path": "../course-factory/output/course-python-print-101.final.json", "courseId": "course-python-print-101" },
  "unitId": "py-print-unit-1-print-and-newline",
  "freedomMode": "guided",
  "provider": "mock",
  "turns": [
    {
      "id": "turn-1",
      "learnerMessage": "…",
      "expectedBehaviors": ["corrects_common_mistake", "explains_each_print_new_line"],
      "forbiddenBehaviors": ["teaches_f_strings", "teaches_end_keyword"]
    }
  ]
}
```

Course loading supports two sources:

- `{ "source": "file", "path": "…" }` — **primary**; paths resolve relative to
  the `teacher-harness/` root (or absolute).
- `{ "source": "id", "courseId": "…" }` — looks the id up in the harness
  `COURSE_REGISTRY` (`src/config/harness-config.ts`) and loads its file.

Included example scenarios:

| File | Course | Unit | Covers |
| --- | --- | --- | --- |
| `example-python-printing.scenario.json` | Python print (factory output) | unit 1 | newline mistake correction, f-string redirect, `end=` redirect |
| `example-python-plus-str.scenario.json` | Python print (factory output) | unit 3 | `str + number` type error, `str()`/comma fix, refuses f-strings & `*` |
| `example-js-promises.scenario.json` | JS Promises (fixture) | unit 1 | pending-vs-rejected contrast, "value already there" correction, defers `.then/.catch` |

> The JS Promises course lives in `fixtures/course-js-promises-101.json`. It is a
> hand-authored **test fixture** (the Course Factory has no JS output yet); the
> harness never generates courses.

## Scoring

Rule-based and deterministic (`src/scoring/…`). Per turn it records:

- `groundedness` (0–5) — token overlap with the unit's KB material
- `staysOnUnit`, `introducedForbiddenTopic`
- `handledCommonMistake`
- `gaveHintWhenAppropriate`
- `didNotAdvanceTooEarly`
- `brevity`, `didNotInvent`

plus each scenario's explicit `expectedBehaviors` / `forbiddenBehaviors` labels.

A turn **passes** only if every expected label is met, no forbidden label is
exhibited, and no concrete future-topic syntax leaked. Soft signals (brevity,
hint style, low groundedness) are recorded as `issues` but do not fail the turn.

**Key design choice — teaching vs. naming.** Future-topic *leakage* is detected
by **concrete syntax** (an actual `f"…{x}"` literal, `end="…"`, `.then(`, …),
not by merely mentioning the term. This lets a good redirect *name* a future
topic ("f-strings are a later lesson") without being penalised. The trade-off:
a model that describes a future concept in prose without syntax is not flagged.

## Lesson memory

Minimal memory for the **current lesson run only** — no database, no vectors, no
memory agent, no LLM summariser. The harness owns both layers; the model owns
none of it. Types live in `src/runtime/lesson-memory.types.ts`, logic in
`src/runtime/lesson-memory.ts`.

- **Lesson Working Memory** — the COMPACT view injected into the tutor prompt on
  every turn: a progress checklist (seeded from the unit's objectives), what the
  learner appears to know, what's still not proven, corrected mistakes, hints
  already given, questions attempted, a learner status, the **last N messages**,
  and a deterministic summary of older history. This is the *only* memory the
  weak model receives — never the whole transcript.
- **Conversation Archive Memory** — the FULL internal record (every learner/tutor
  message with role, turn id, timestamp), plus deterministic per-chunk summaries
  and a final lesson summary. Saved as artifacts and used to recompute the
  working memory. Never sent to the model.

All updates are **deterministic/rule-based** (keyword overlap against the unit's
objectives, common-mistake corrections, question prompts and hints). The prompt
block states plainly that the memory is authoritative, that the model must not
rely on hidden memory, and must not invent missing history.

Tunable defaults (`LESSON_MEMORY_DEFAULTS`, override per turn via `memoryConfig`):

```ts
{ lastMessagesLimit: 10, summarizeEveryMessages: 10 }
```

`lastMessagesLimit` = how many recent messages are kept verbatim in working
memory; older ones collapse into `olderHistorySummary`. `summarizeEveryMessages`
= how often a deterministic chunk summary is appended to the archive.

> The working memory sent on turn *T* reflects turns *1…T-1*; the current
> learner message is the user turn. Each `turn-N/memory.*.json` artifact is the
> memory state **after** that turn, while `turn-N/prompt.txt` shows the memory
> that was actually **sent** (the pre-turn state).

## Artifacts

Every run writes to `runs/<scenarioId>__<timestamp>/`:

```
scenario.json
course-package.snapshot.json
unit.snapshot.json
turn-N/ { context.json  prompt.txt  response.txt  debug.json  score.json
          memory.working.json  memory.archive.json }
lesson-memory.final.json
scenario-report.json
scenario-report.md
```

Batch summaries land in `reports/`. When a tutor fails you can see exactly
where — course content, runtime context, prompt, model response, scoring rule,
provider behaviour, action validation, or lesson-state transition.

## Limitations (MVP)

- The mock proves mechanics, not teaching quality — use `openai-compatible` for
  real signal.
- Scoring is keyword/regex heuristics, not an LLM judge; expect occasional
  false negatives on unusual phrasings.
- Course knowledge retrieval beyond the current unit is a stubbed boundary
  (`retrieve_course_context`), not a real RAG service yet.
- `open_next_lesson` and other future actions are validated-but-not-executed.
- Lesson memory is per-run only — there is **no durable learner memory** across
  lessons/sessions. Checklist/knows/status updates are keyword-overlap heuristics,
  so a KB-echoing mock can inflate "covered/mastered"; and `learnerStatus` tracks
  the *current* message, so a late misconception can read as `struggling` even
  when earlier objectives were mastered. Summaries are deterministic, not LLM.
