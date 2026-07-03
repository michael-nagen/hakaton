# Evaluating the real WebLLM local models (Gemma 2 2B / Llama 3.2 3B)

## TL;DR — the automated browser bridge (implemented)

The harness can now run the REAL on-device models through the full evaluation
matrix, via a tiny local browser bridge:

```bash
# Llama 3.2 3B against all strategies + all scripted profiles + scenarios:
npm run evaluate:llama
# equivalently:
npm run evaluate -- --scenarios scenarios --models llama_3_2_3b --strategies all
```

When you select a WebLLM target explicitly, the CLI prints a URL (default
`http://localhost:5201/`). **Open it in Chrome or Edge (WebGPU required).** The
page loads the actual model (first run downloads ~2 GB and caches it for that
origin; later runs are instant) and then serves each evaluation turn to the CLI
over a long-poll queue. Generation uses the app's local-runtime settings
(temperature 0.7, max 800 tokens). The report is written only after real turns
run, and it states "Actual <model> was tested."

Notes:
- Broad selectors (`--models all|mock|proxies`) still DO NOT run the WebLLM
  models — they list them as "not evaluated". Only an explicit id/alias
  activates the bridge, so nothing on-device is ever faked implicitly.
- Aliases: `llama_3_2_3b` → Llama 3.2 3B, `gemma_2_2b` → Gemma 2 2B.
- Port: defaults to 5201 to avoid the app's Vite dev server on 5199. To reuse
  weights already cached by the app, stop the dev server and set
  `TEACHER_HARNESS_BRIDGE_PORT=5199`.
- Keep the browser tab open and focused for the whole run; on-device latency is
  ~5–11 s per turn, so the full matrix takes a while.
- Bridge implementation: `teacher-harness/src/browser-bridge/bridge-server.ts`.

## Why the CLI cannot do it alone (what the bridge solves)

The app's two offline model options run on **WebLLM** (`@mlc-ai/web-llm`), which
executes quantized models on **WebGPU inside a browser** and caches the weights
in browser storage. There is no Node runtime for these models in this repo, so
`npm run evaluate` **cannot execute them** and never pretends to: they appear in
every evaluation report under "Models NOT evaluated".

- Catalog entries: `src/model-provider/local-model-catalog.ts`
  (`gemma-2-2b-it-q4f16_1-MLC`, `Llama-3.2-3B-Instruct-q4f16_1-MLC`)
- Browser runtime seam: `src/model-provider/local-inference-runtime.ts`

## Adapter boundary for a future browser runner

The evaluation lab talks to models exclusively through the app's narrow
`ModelProvider` seam:

```ts
interface ModelProvider {
  readonly name: string;
  readonly modelName?: string;
  generateText(args: { prompt: string; system?: string }): Promise<string>;
}
```

Everything else (strategies, guard, repair, memory, scoring, reporting) is
provider-agnostic. To evaluate the real local models, implement ONE of:

1. **Browser bridge (recommended):** a small dev-only page that loads WebLLM,
   exposes `generateText` over a local WebSocket/HTTP port, plus a harness-side
   `ModelProvider` that forwards to it. Register it as a new target in
   `teacher-harness/src/evaluation/model-targets.ts` — no other file changes.
2. **Headless browser runner:** drive the same page with Playwright/Chrome
   (WebGPU flags required) and proxy `generateText` through it.

Latency measured through a bridge includes on-device inference time, which is
the number the cloud proxies cannot give you.

## Manual browser evaluation checklist (bridge-free fallback)

Run the app (`npm run dev`), download a local model from the AI setup screen,
then for **each model** and **each strategy-relevant behaviour** below, use the
scripted learner turns from
`teacher-harness/src/evaluation/learner-profiles.ts` verbatim (copy/paste the
`learnerMessage` strings in order) into the lesson chat for
`course-python-print-101` unit 1, and record:

| # | Check | Pass looks like |
| - | ----- | --------------- |
| 1 | Newline mistake corrected (confused-beginner cb-1) | Says each print() ends on its own line; no `end=` |
| 2 | f-string request redirected (impatient im-1) | Names f-strings as a later lesson; shows NO `f"..."` syntax |
| 3 | `end=''` request redirected (impatient im-2) | Does not show `end=` syntax |
| 4 | Off-topic (JS console.log, cu-1) | Redirects or honestly says it's outside this course |
| 5 | Not-covered question (cu-3, "history of the newline") | Says the material doesn't cover it; does not invent |
| 6 | Struggling learner not advanced (st-2..st-4) | No "let's move on / you've mastered it" while mistakes repeat |
| 7 | Brevity | Replies ≤ ~220 words, no multi-code-block dumps |
| 8 | Memory | Later turns reference earlier corrections instead of repeating them |
| 9 | Latency | Note seconds per reply (this is the real on-device number) |

Record results per model × strategy and compare them against the CLI report for
the cloud proxies. Divergence between proxy and on-device behaviour is exactly
the data the automated report says it cannot provide.
