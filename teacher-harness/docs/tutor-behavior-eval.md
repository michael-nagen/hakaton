# Tutor teaching-behavior evaluation

A small, isolated eval that tests **one thing**: does the tutor exhibit the right
*teaching behavior* on a fixed set of learner situations — regardless of subject
matter or general model intelligence?

It lives entirely inside `teacher-harness/`:

| File | Role |
|---|---|
| `scenarios/tutor-behavior-repair.scenario.json` | 7 scripted learner turns (stuck / tell-me / close-enough / partial / wrong / hint / correct) on the unit-1 print() question. |
| `src/scoring/tutor-behavior-rules.ts` | Deterministic behavior detectors, merged into the scorer's `BEHAVIOR_RULES`. |
| `src/llm-judge/tutor-behavior-judge.ts` + `.types.ts` | Optional LLM judge for the fuzzy behaviors regex can't grade. |
| `src/llm-judge/run-tutor-behavior-eval.ts` | The runner (real runtime path → deterministic score → optional judge → PASS/FAIL + report). |

## What it checks

- Stuck → short hint/explanation, not endless open-ended questions (`direct_help_when_stuck`).
- Doesn't hand over the full answer early — *unless the learner explicitly asks* (`gives_hint_not_full_answer`, turn-2 exempt).
- Accepts close-enough answers, tidies wording, doesn't force exact phrasing (`accepts_close_enough`, judge: `notTooStrictOnWording`).
- Corrects wrong answers gently (`gentle_correction`).
- Asks only one guiding question (`single_guiding_question` / forbidden `asks_multiple_questions`).
- Stays on the current step; no future syntax (`stays_on_unit`, `teaches_*` forbidden).
- Doesn't advance too early (`does_not_move_on_too_quickly`).

**Deterministic vs judge:** structural behaviors (question count, hint-vs-dump,
gave-an-explanation, future-syntax leakage) are scored by regex and are the
trustworthy part of the deterministic PASS/FAIL. Fuzzy behaviors
(close-enough acceptance, gentle correction, not-too-strict-on-wording) are
**lenient** in the deterministic layer and are authoritatively judged by the
optional LLM pass. The two are complementary — e.g. the regex counts literal
`?`, the judge counts *conceptual* questions.

## How to run

From `teacher-harness/`:

```bash
# Deterministic only, offline mock (proves the wiring; NOT a quality signal)
npx tsx src/llm-judge/run-tutor-behavior-eval.ts

# + LLM judge (needs judge creds, see below)
npx tsx src/llm-judge/run-tutor-behavior-eval.ts --judge

# Real weak-model proxy over the openai-compatible endpoint + judge
npx tsx src/llm-judge/run-tutor-behavior-eval.ts --openai --judge

# REAL on-device model (Llama 3.2 3B) via the WebLLM browser bridge + judge
npx tsx src/llm-judge/run-tutor-behavior-eval.ts --webllm --judge
```

Reports (JSON + Markdown) are written to `reports/tutor-behavior/<timestamp>/`.

### Running the real on-device model (`--webllm`)

WebLLM only runs in a browser with WebGPU — there is no Node runtime for it. The
runner starts a local bridge and prints a URL:

1. Run with `--webllm`. It prints `OPEN THIS IN A WEBGPU BROWSER: http://localhost:5201/?s=...`.
2. Open that URL in Chrome or Edge. The tab loads the real `Llama-3.2-3B-Instruct-q4f16_1-MLC`
   (first load downloads ~2 GB, cached per origin afterwards) and then serves turns to the CLI.
3. The CLI drives the 7 turns through the browser tab and scores each. Leave the tab open and visible.

This IS the actual selected on-device model (from `SHARED_LOCAL_TUTOR_DEFAULTS`),
running genuine WebLLM/WebGPU inference — not a proxy.

### LLM judge credentials (eval-only)

The judge reuses the harness's existing judge resolver (`src/evaluation/llm-judge.ts`).
Set in `teacher-harness/.env` (never printed, never wired into the tutor runtime):

```
TEACHER_HARNESS_JUDGE_PROVIDER=openai
TEACHER_HARNESS_JUDGE_API_KEY=sk-...
# optional: TEACHER_HARNESS_JUDGE_MODEL=gpt-4o-mini (default gpt-4.1-mini)
```

If no judge creds are configured, `--judge` prints why and falls back to
deterministic-only. The judge can **never** be the local tutor model (a model
must not grade its own output).

## Fidelity — what is real vs simulated

This eval drives the **real runtime context path** (`buildTutorContext` +
`buildVariantPrompt`, default `structured_rules_prompt`) and the **real
on-device model** (with `--webllm`), teaching from the **real course context**
under the **shared behavior rules** (`shared-tutor-behavior-rules.ts`).

It is **not** a byte-identical replay of the live lesson request. The live app
lesson flow (`lesson-session.ts`) uses the **JSON-envelope prompt**
(`build-tutor-response-prompt.ts`, `TutorInput` → `messageToStudent`/`nextAction`)
and the `repair_pass` strategy wrapper. This harness path uses the free-text
`buildTutorPrompt`/variant path and a single `generateText` call. Treat results
as a faithful test of *on-device teaching behavior under the shared rules*, not
as the exact production request. The runner prints this caveat on every run.
