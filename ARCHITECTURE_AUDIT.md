# Phase 0 — Architecture Audit

_Maestro Dashboard · learning-flow integration · audit date 2026-07-01_

This report is grounded in the actual source. No code was written. It ends with a
phased implementation plan that **reuses** existing modules rather than rebuilding them.

---

## 1. Existing architecture — the flow today

The project is a **"strong-model build → weak-model teach"** system split across three
code homes:

| Home | Kind | Role |
|------|------|------|
| `course-factory/` | standalone Node CLI | Generates schema-valid `CoursePackage` JSON offline using strong models + two quality gates |
| `src/` | React/Vite app | Runtime: picks a prebuilt course, runs a per-turn tutor against a configurable model provider |
| `teacher-harness/` | standalone Node CLI | Offline evaluation: drives the full lesson loop and scores whether a weak model can teach a course |

### The intended flow, and where it actually connects

```
Course generation            Lesson package                Tutor                       Provider                 Model
─────────────────            ──────────────                ─────                       ────────                 ─────
course-factory/ CLI   ──►    CoursePackage JSON     ──►    tutor-runtime          ──►  model-provider     ──►   mock / Gemini /
(10 agents, 2 gates)         (units, teacherBrain,         buildTutorContext →         createModelProvider      OpenRouter / custom /
      │                       KB chunks, questions,        buildTutorPrompt →          FromConfig()             local (stub)
      │                       commonMistakes)              provider.generateText
      ▼                            │                            ▲
 npm run register             src/course-package/              │
 (copies JSON into            prebuilt/*.json  ──────► runTutorTurn()  ◄── pages call THIS
 src/.../prebuilt,            + prebuilt-courses.ts    (one turn: context→prompt→
 edits registry)             getPrebuiltCourses()      call→parse action→debug)
```

**Concrete runtime call chain** (what actually fires when a user chats in a demo page):

```
Page (TutorDemoPage / SimpleLessonDemoPage)
  └─ runTutorTurn({ coursePackage, unitId, userMessage, provider, freedomMode })   [src/tutor-runtime/run-tutor-turn.ts:51]
       ├─ buildTutorContext(...)   → single-unit slice + top-N KB chunks (keyword scored)   [build-tutor-context.ts:29]
       ├─ buildTutorPrompt(...)    → { systemPrompt, userPrompt }                            [build-tutor-prompt.ts:110]
       ├─ provider.generateText({ prompt, system })  → raw string                           [model-provider.types.ts]
       └─ parseAction(answer)      → { action, jsonParse } debug metadata
```

Provider selection is entirely config-driven:

```
AiProviderContext (loads localStorage 'maestro.aiProvider', default built_in)   [AiProviderContext.tsx]
  └─ createModelProviderFromConfig({ config })   [create-model-provider.ts:23]
       switch(config.type):
         built_in        → mockModelProvider                  (complete)
         gemini_byok     → createGeminiProvider               (complete)
         openrouter_byok → createOpenRouterProvider           (complete, +PKCE OAuth)
         custom          → createCustomProvider               (complete, OpenAI-compatible)
         local_model     → createLocalModelProvider           (download works; INFERENCE is a no-op stub)
```

### The single most important structural fact

There are **two parallel, non-interoperable tutor abstractions**, and the UI only uses one:

| | Path A — used by pages | Path B — built but unused in UI |
|---|---|---|
| Entry | `runTutorTurn({ coursePackage, unitId, userMessage, provider })` | `activeTutorProvider.generateTutorResponse(TutorInput)` |
| Input | whole `CoursePackage` + `unitId` + freedomMode + optional `ProgressState` | flat `TutorInput` (lessonId, studentAnswer, recentMessages, lessonContext, studentState) |
| Output | `{ answer: string, systemPrompt, userPrompt, debug }` (raw text) | `{ messageToStudent, nextAction, studentLevelEstimate, confidence }` (structured, JSON-repaired) |
| Consumes a `ModelProvider`? | yes, passed in directly | yes, wrapped by `createTutorProvider` |
| Used by | `TutorDemoPage`, `SimpleLessonDemoPage`; `CourseDemoPage` inlines the two build steps | **created in `AiProviderContext` (line 124) but consumed by zero pages** |

Verified: `grep` shows `activeTutorProvider` / `generateTutorResponse` referenced only inside
`create-tutor-provider.ts` and `AiProviderContext.tsx` — never in `src/pages/`.

---

## 2. What already exists (reusable modules)

### Model provider layer — `src/model-provider/` — **KEEP UNCHANGED**

| Module | Responsibility | State | Keep? |
|--------|----------------|-------|-------|
| `model-provider.types.ts` | Core seam: `ModelProvider { name, modelName?, generateText({prompt,system?}) }` | Complete | ✅ unchanged |
| `ai-provider-config.types.ts` | Serializable `AiProviderConfig` (persisted) | Complete | ✅ |
| `create-model-provider.ts` | Single factory config→provider (5 kinds) | Complete | ✅ |
| `mock/gemini/openrouter/openai-compatible/custom .provider.ts` | Backend transports | Complete | ✅ |
| `openrouter-oauth.ts` | PKCE one-click connect | Complete | ✅ |
| `limits.ts` | Rate/token/day caps, `RateLimitError` | Complete | ✅ |
| `local-model-catalog / manifest / storage / state / download-manager` | On-device model download + IndexedDB storage + progress state | Complete | ✅ |
| `local-inference-runtime.ts` | On-device inference seam | **Stub (Noop)** — download works, running does not | ✅ keep seam; out of scope to fill now |
| `AiProviderContext.tsx` | React context: config store + derives `activeModelProvider`/`activeTutorProvider` | Complete | ✅ (will finally consume Path B) |

### Tutor runtime — `src/tutor-runtime/` — **KEEP; this is the integration backbone**

| Module | Responsibility | State |
|--------|----------------|-------|
| `run-tutor-turn.ts` | Orchestrate ONE turn (context→prompt→call→parse, with debug) | Complete |
| `create-tutor-provider.ts` | Wrap any `ModelProvider` into structured `TutorProvider` (JSON repair + retry + fallback) | Complete, **UI-orphaned** |
| `build-tutor-context.ts` | Extract single-unit slice, strip answer keys, pick chunks | Complete |
| `build-tutor-prompt.ts` | Render system/user prompt from context + teacherBrain | Complete |
| `build-tutor-response-prompt.ts` / `parse-tutor-response.ts` | JSON-schema prompt + robust parse/repair (Path B) | Complete |
| `get-relevant-chunks-for-unit.ts` | Keyword-scored unit-level retrieval (vector-ready seam) | Complete MVP |
| `freedom-mode.ts` | strict / guided / open prompt directive | Complete |

### Course package — `src/course-package/` — **KEEP UNCHANGED**

- `course-package.types.ts` — full contract: `CoursePackage → LearningUnit → { teacherBrain, knowledgeBaseChunks, questions(+hints), commonMistakes }`. Complete, stable.
- `course-package.schema.ts` — dependency-free validator (`validateCoursePackage`, `assertCoursePackage`). Complete. **Imported directly by the factory** → zero schema drift.
- `course-package.loader.ts` — `getCoursePackage / getCourseById / getUnitById / getKnowledgeChunksForUnit`. Async-ready for a future cloud fetch.
- `prebuilt/prebuilt-courses.ts` — validates + exposes `biz-course.json`, `aws-course.json`; `getPrebuiltCourses()`, `getPrebuiltCourseById()`, `indexPrebuiltCourses()`.

### Reusable RAG — `src/reusable-rag/` — **KEEP**

- Flattens courses into `ReusableAsset[]`, keyword search (`searchReusableAssets`), swappable index. Complete MVP. Currently only wired in `CourseDemoPage`.

### UI shell / config — **KEEP**

- `AppShell` + `AppShellContext` (sidebar/topbar/toast/layout), `Sidebar/Topbar/AppCard/StatusBadge/Toast`, `appsConfig.ts` (dashboard tiles by section). Solid; most app tiles are stubs by design.

### Course factory — `course-factory/` — **KEEP as-is (standalone)**

- 10 agents + deterministic packager, two gates (pedagogy+structure, then schema), up to 5 repair attempts, full per-run audit trail.
- Output = valid `CoursePackage` JSON; `npm run register` copies it into `src/course-package/prebuilt/` and edits the registry. Integration is **wired and intentional** (manual, safe).

### Teacher harness — `teacher-harness/` — **KEEP the CLI; HARVEST its lesson model**

- One-way dependency: imports the app's `buildTutorContext`, `buildTutorPrompt`, `validateCoursePackage`, `ModelProvider`. Never exported back.
- **Owns the lesson loop the app is missing** (see §3): `LessonState`, `LessonSessionMemory` (working + archive), `lesson-actions` (validated action vocabulary + state transitions).

---

## 3. Missing integration points (grounded, not guessed)

The app can run **one isolated tutor turn**. It cannot run **a lesson**. Precisely missing:

1. **Student progress / lesson state in the app.**
   `ProgressState` is a defined type but **no page constructs, passes, or persists it** (verified: zero `ProgressState` references in `src/pages/`). `runTutorTurn`'s `progress` arg is always omitted. There is no "which units are complete / mastery / current step" model in `src/`. It exists only in `teacher-harness/src/runtime/lesson-state.types.ts`.

2. **Lesson session memory in the app.**
   The two-layer working/archive memory (what the model sees vs. full transcript) exists only in `teacher-harness/src/runtime/lesson-memory.ts`. In the app, chat is ephemeral `useState` that resets on unit change; only the last ~5 raw messages ever reach the model, with no deterministic summary or "hints already given / misconceptions corrected" tracking.

3. **Lesson actions / advancement in the app.**
   Deciding "can the learner complete this unit / advance" lives only in `teacher-harness/src/runtime/lesson-actions.ts`. The app parses an `action` string for debug display but never acts on it.

4. **A real Lesson Player surface.**
   There are three throwaway demo routes but no single, shell-integrated, stateful lesson experience: pick course → see units with progress → run a stateful multi-turn unit → mark complete → advance. The dashboard "Courses" tile (`course-factory` id, added in the working tree) points at `/course-demo`, the weakest of the three demos.

5. **The structured tutor path is unused.**
   `generateTutorResponse` (with `nextAction`/`confidence`) is exactly what a stateful player needs to drive advancement — but nothing consumes it. This is missing *wiring*, not missing code.

6. **Persistence.**
   Only AI-provider config and local-model download state persist. No student progress store (localStorage/IndexedDB) exists.

---

## 4. Redundant / duplicated systems

1. **Two tutor entry points (real duplication of intent).** `runTutorTurn` (Path A, text-only, used) vs. `createTutorProvider().generateTutorResponse` (Path B, structured, orphaned). Two prompt builders (`build-tutor-prompt` vs. `build-tutor-response-prompt`) and two parse helpers. **Recommendation:** standardize the app on the structured Path B for the real player (its `nextAction` drives advancement); keep `runTutorTurn` as the debug/inspection harness. Do not delete either yet — converge callers first.

2. **Three near-duplicate demo pages.** `TutorDemoPage`, `SimpleLessonDemoPage`, `CourseDemoPage` re-implement the same course-select → unit-select → chat loop with copy-pasted provider fallback (`activeModelProvider ?? mockModelProvider`), chat state, and send logic. `CourseDemoPage` additionally bypasses `runTutorTurn` by calling `buildTutorContext`+`buildTutorPrompt` inline. **Recommendation:** extract one `useLessonSession` hook + a `<LessonChat>` component; reduce the three demos to thin wrappers (or one dev-only debug route), and build the real player on the shared hook.

3. **Lesson-loop logic duplicated across the boundary.** `LessonState` / `LessonSessionMemory` / `lesson-actions` live only in the harness; a tiny `parseAction`/`parseSuggestedAction` (~25 lines) is duplicated between app and harness. **Recommendation:** promote the lesson model into a shared `src/lesson-runtime/` that both the app and the harness import (harness keeps scoring/reporting/CLI). Extract the shared action parser into `src/tutor-runtime/`.

4. **Provider fallback repeated.** `activeModelProvider ?? mockModelProvider` appears in all three pages. Fold into the shared hook / context.

5. **Build cruft (non-architectural).** Three untracked `vite.config.ts.timestamp-*.mjs` files in root — safe to delete/gitignore.

---

## 5. Recommended architecture (maximize reuse)

Introduce exactly one new shared layer and one real surface; reuse everything else.

```
                         ┌─────────────────────────────────────────────┐
                         │  src/lesson-runtime/   (NEW — promoted from   │
                         │  teacher-harness lesson model)                │
                         │   • lesson-state.ts     (LessonState)         │
                         │   • lesson-memory.ts    (working + archive)   │
                         │   • lesson-actions.ts   (validate + advance)  │
                         │   • lesson-session.ts   (orchestrates a turn: │
                         │       memory→context→prompt→provider→parse→   │
                         │       action→next state)                      │
                         └───────────────┬─────────────────────────────┘
              reuses ▲                    │ reuses
   ┌─────────────────┴───────┐           ▼
   │ src/tutor-runtime/       │   ┌──────────────────────────┐
   │ buildTutorContext        │   │ src/model-provider/       │
   │ buildTutorPrompt         │   │ createModelProviderFrom-  │
   │ parse-tutor-response     │   │ Config (via AiProvider-   │
   │ createTutorProvider (B)  │   │ Context.activeModel-      │
   └──────────────────────────┘   │ Provider)                 │
              ▲                     └──────────────────────────┘
              │ reuses
   ┌──────────┴───────────────┐
   │ src/course-package/       │  getPrebuiltCourses / getUnitById / schema
   └───────────────────────────┘

  UI:  src/pages/lesson/  (NEW real surface, inside AppShell)
        CourseCatalogPage → CoursePlayerPage(courseId/unitId)
        built on  useLessonSession()  +  <LessonChat/>  (NEW shared)
        progress persisted via  src/lesson-runtime/progress-store.ts (localStorage)
  Demos: collapse to one dev-only /debug/tutor route (keeps runTutorTurn inspector)
```

Principles:
- **New code is glue + one UI surface.** Teaching logic, providers, course schema, RAG — all reused unchanged.
- **`src/lesson-runtime/` is the app's version of what the harness already proved.** The harness then imports it instead of owning it, eliminating the cross-boundary duplication and guaranteeing the eval loop matches the shipped loop.
- **Standardize on the structured tutor (Path B)** for the player; `runTutorTurn` remains the debug lens.
- **Persistence stays local-first** (localStorage), mirroring how `AiProviderContext` and local-model state already work.

---

## 6. Implementation plan (phased — only after this audit)

### Phase 1 — Promote the lesson model into the app
- **New:** `src/lesson-runtime/lesson-state.ts`, `lesson-memory.ts`, `lesson-actions.ts`, `index.ts` (ported from `teacher-harness/src/runtime/*`, framework-free).
- **New:** `src/tutor-runtime/parse-tutor-action.ts` (extract the shared action parser).
- **Modify:** `src/tutor-runtime/run-tutor-turn.ts` and `teacher-harness/src/runtime/run-tutor-turn.ts` to use the shared parser.
- **Reuse:** `build-tutor-context`, `build-tutor-prompt`, `course-package/*`.
- **Outcome:** app owns `LessonState` + memory + action rules; no framework/UI yet.

### Phase 2 — Lesson session orchestrator + provider wiring
- **New:** `src/lesson-runtime/lesson-session.ts` — runs a stateful turn: render working memory → `buildTutorContext` (with real `ProgressState` derived from `LessonState`) → structured tutor call via `createTutorProvider` (Path B) → apply `lesson-actions` → update memory/state.
- **New:** `src/lesson-runtime/progress-store.ts` — localStorage persistence (`maestro.progress.<courseId>`), same pattern as `local-model-state.ts`.
- **Modify:** `AiProviderContext` consumers begin using `activeTutorProvider` (finally wiring Path B).
- **Reuse:** `create-tutor-provider`, `parse-tutor-response`, `limits`.
- **Outcome:** a headless, testable, stateful lesson engine in the app.

### Phase 3 — Shared UI hook + component
- **New:** `src/hooks/useLessonSession.ts` (React binding over `lesson-session` + `progress-store`), `src/components/LessonChat.tsx`.
- **Refactor:** the three demo pages to consume the hook; collapse to a single `/debug/tutor` inspector route (keeps `runTutorTurn` + debug panel).
- **Reuse:** existing chat UI patterns, `AppShellContext` toast.
- **Outcome:** one source of truth for lesson chat; duplication removed.

### Phase 4 — Real Course surface inside the shell
- **New:** `src/pages/lesson/CourseCatalogPage.tsx` (lists `getPrebuiltCourses()` with per-course progress) and `CoursePlayerPage.tsx` (unit list + progress + stateful `<LessonChat>` + complete/advance).
- **Modify:** `src/App.tsx` add `/courses` and `/courses/:courseId` **inside `AppShell`**; repoint the dashboard "Courses" tile from `/course-demo` to `/courses`.
- **Reuse:** `AppShell`, `AppCard`, `StatusBadge`, `appsConfig`.
- **Outcome:** the end-to-end learning flow (catalog → stateful lesson → progress → advance) is a first-class app feature.

### Phase 5 — Close the loop with the harness (+ cleanup)
- **Modify:** `teacher-harness/src/runtime/*` to import `src/lesson-runtime/*` instead of owning it; harness keeps scoring/reporting/CLI only.
- **Cleanup:** delete orphaned demo routes if fully replaced; remove root `vite.config.ts.timestamp-*.mjs`; optionally decide the fate of the now-redundant `runTutorTurn` (keep as debug).
- **Outcome:** eval loop == shipped loop; single lesson-runtime; no cross-boundary duplication.

_Local on-device inference (`local-inference-runtime.ts`) remains a deliberate stub and is out of scope for the learning-flow integration._
