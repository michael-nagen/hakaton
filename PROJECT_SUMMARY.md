# Maestro — Project Summary

_A "strong model builds the course, a weak model teaches it" learning system._

## The core idea

The whole project rests on one product principle:

> **A strong (expensive, agentic) model prepares the course in advance. A weak
> (cheap / local / on-device) model teaches it at runtime.**

All the pedagogical intelligence is front-loaded at **build time** into a
schema-valid `CoursePackage` JSON. At **learning time** the runtime feeds the
weak model only a thin slice per turn — the current unit, its TeacherBrain, 2–3
knowledge chunks, the relevant questions/hints, and a short progress snapshot.
The weak model never has to design a syllabus, invent content, or search the
whole course; it only has to *execute* a lesson that was already engineered.

## The three code homes

| Home | Kind | Role |
|------|------|------|
| `course-factory/` | Standalone Node CLI | Generates schema-valid `CoursePackage` JSON offline using strong models + two quality gates. |
| `src/` | React / Vite web app | The runtime: pick a course, run a stateful, per-turn tutor against a configurable model provider (mock / Gemini / OpenRouter / custom / on-device local). |
| `teacher-harness/` | Standalone Node CLI | Offline evaluation lab: drives the full lesson loop and scores whether a weak model can actually *teach* a given course. |

The intended flow end-to-end:

```
raw material → course-factory → CoursePackage JSON → tutor-runtime
             → weak model → teacher-harness run → artifacts + report
```

## 1. Course Factory (`course-factory/`)

An offline, CLI-first CoursePackage authoring tool. It runs a pipeline of
**10 agents + a deterministic packager**, guarded by **two independent gates**,
to turn a rough author brief into a runtime-ready course.

**Pipeline (agents 01–10):**

1. **Input Normalizer** — turns a brief + rough units + source notes into one clean structured source object.
2. **Outcome Mapper** — converts material into measurable learning outcomes and flags "too broad" / "mixed outcomes".
3. **Unit Splitter** — produces the FINAL list of **micro-lessons** (6–10 min, one outcome, one concept each).
4. **Lesson Designer** — designs a concrete ~10-minute teaching flow per unit.
5. **TeacherBrain** — writes the operational "how to teach" brain a weak model can follow literally.
6. **KnowledgeBase Chunker** — writes 2–4 self-contained knowledge chunks per unit.
7. **Exercise & Hint** — writes 1–2 questions per unit (one mastery check), progressive hints, and common mistakes.
8. **Weak-Model Readiness Reviewer** — a strict quality gate scoring each unit's weak-model teachability (needs ≥ 8/10).
8b. **Readiness Repair** — fixes pedagogy/structure and **splits** over-broad units when a gate fails.
9. **Course Packager** — assembles the final `CoursePackage` JSON in the app's exact schema.
10. **Validator Repair** — fixes only schema/JSON errors when validation fails.

**Two gates before any final course is written:**

1. **Weak-model readiness gate** (pedagogy + a deterministic micro-lesson structure check: 1–2 questions, 2–4 KB chunks, 6–10 min, ≥ 1 common mistake, an advancement rule). Up to **2** repair attempts.
2. **Schema validation gate** (structure). Up to **3** repair attempts by a *different* repair step.

If readiness never passes, generation **stops before packaging** — failures are
never dressed up as success.

**Micro-lesson rules (enforced):** every final unit has one main outcome, one
concept, 6–10 minutes (target 7–8), 1–2 questions (one mastery check ending
`-mastery`), 2–4 KB chunks, ≥ 1 common mistake (advancement blocker), and a
`systemPromptSeed` carrying an explicit advancement rule.

**Language:** English only for now. All learner-facing content is produced in
English regardless of the source material's language.

**Variants:** `generate:variants` builds one base package, then deterministically
shapes it into **5 lesson variants** differing on two axes only — lesson detail
(`minimal`→`high`) × tutor guidance (`free`→`very_guided`): `minimal_free`,
`medium_free`, `medium_guided`, `high_guided`, `high_very_guided`.

**Output:** `output/<course-id>.final.json` (the runtime artifact). Markdown is
only ever an optional human-readable preview, never consumed by the runtime.
`npm run register` explicitly wires a validated course into the app.

## 2. The Runtime App (`src/`)

A React/Vite app. Provider selection is entirely config-driven via
`AiProviderContext` + `createModelProviderFromConfig`:

- `built_in` → mock provider (complete)
- `gemini_byok` → Gemini (complete)
- `openrouter_byok` → OpenRouter (complete, PKCE OAuth)
- `custom` → OpenAI-compatible (complete)
- `local_model` → on-device WebLLM (download works; inference behind a seam)

**Key layers:**

- **`model-provider/`** — the core `ModelProvider` seam (`generateText({ prompt, system })`), all transports, rate limits, and on-device model download/storage/state.
- **`tutor-runtime/`** — turns a `CoursePackage` + unit into a model-ready prompt and parses the reply. Two paths exist:
  - **Path A** `runTutorTurn` — one text-only turn (debug/inspection lens).
  - **Path B** `createTutorProvider().generateTutorResponse` — the structured JSON path (`messageToStudent` · `nextAction` · `studentLevelEstimate` · `confidence`) that drives lesson advancement.
- **`lesson-runtime/`** — the app's stateful lesson model (state, memory, actions, session), promoted from the harness so the eval loop matches the shipped loop. Holds the **local-device tutor defaults**.
- **`lesson-assistant/`** — side-panel learner tools ("explain simpler", "give an example", "challenge me") + personalization (style-only teaching preferences).
- **`course-package/`** — the dependency-free `CoursePackage` schema + validator + loader (imported by the factory → zero schema drift).
- **`reusable-rag/`** — keyword search over flattened course assets (vector-ready seam).

**Main learning flow (routes):** Welcome → Choose AI guide → Choose your path
(catalog) → AI Fundamentals player (course path → lesson parts → guided tutor
room). Provider setup, course player, and the apps dashboard remain reachable
by URL as secondary/internal screens.

**Locked local-device defaults** (single source of truth,
`shared-local-tutor-defaults.ts`, shared with the harness so they can't drift):

| Field | Value |
|---|---|
| Model | `Llama-3.2-3B-Instruct-q4f16_1-MLC` (WebLLM/WebGPU) |
| Runtime strategy | `repair_pass` |
| Lesson variant | `high_very_guided` |
| Memory mode | `last_messages_only` |
| Lesson completion | disabled |

## 3. Teacher / Lesson Harness (`teacher-harness/`)

An offline CLI that **operates the lesson loop** and reports whether a
weak/cheap/local/mock tutor model can actually teach a generated course.

**Core principle: the harness operates the model — the model does not operate
the harness.** The harness owns `LessonState`, allowed actions, context
selection, scoring, and reporting. The model only produces tutor text and *may
suggest* a validated action; it never executes actions, unlocks lessons, or
freely searches the course.

**What it reuses (one-way dependency on `src/`):** `buildTutorContext`,
`buildTutorPrompt`, `validateCoursePackage`, `getUnitById`, and the
`ModelProvider` interface — so it tests exactly what ships.

**Scoring** is rule-based and deterministic (groundedness, staysOnUnit,
handledCommonMistake, gaveHintWhenAppropriate, didNotAdvanceTooEarly, brevity,
didNotInvent) plus each scenario's `expectedBehaviors` / `forbiddenBehaviors`.
Future-topic leakage is detected by **concrete syntax**, not by merely naming a
topic — so a good redirect ("f-strings come later") is not penalised.

**LLM judge** (optional, eval-only): a **strong cloud** model grades each tutor
turn on 8 dimensions. Hard rule — the judge is never the local tutor model (a
model must not grade its own output).

**Prompt variants experiment:** five ways to phrase the same tutor job, differing
only in the instruction preamble while the grounding block stays byte-identical.
The evaluation locked in `structured_rules_prompt` as the strongest instruction
shape; its behavior rules live in a single shared module used by both the app
prompt builder and the harness.

**Real on-device evaluation:** the two real offline models (Gemma 2 2B, Llama
3.2 3B) run on WebLLM/WebGPU **in a browser only** via a local browser bridge —
broad selectors never fake on-device runs; cloud models run as clearly labelled
proxies.

**Lesson memory:** per-run only (no DB, no vectors, no LLM summariser). Two
deterministic layers — a compact **working memory** injected into every prompt,
and a full internal **archive** never sent to the model.

## Status & known gaps

- On-device local inference (`local-inference-runtime.ts`) is a deliberate stub — download works, running in the app is out of scope for the current integration.
- The live app prompt style is `current_json` by default; `structured_rules_json` is a reversible A/B toggle.
- Lesson memory is per-run only — there is no durable cross-session learner memory yet.
- Course knowledge retrieval beyond the current unit is a stubbed boundary, not a real RAG service yet.

## Tech stack

React 18 + React Router 6, Vite 5, TypeScript 5, Vitest for tests,
`@mlc-ai/web-llm` for on-device inference. The two CLIs run TypeScript directly
via `tsx` (Node 18+), no build step.
