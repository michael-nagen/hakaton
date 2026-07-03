# Locked Tutor Defaults (decision record)

_Decided after the prompt-efficiency, LLM-judge, and real-course evaluations. These are
the single internal deterministic defaults — NOT random, NOT user-chosen, and NOT exposed
in the learner UI. The production Tutor prompt is unchanged; nothing is promoted to
learner UI._

Source of truth: [`src/config/locked-config.ts`](../src/config/locked-config.ts) (`LOCKED_TUTOR_CONFIG`).

## Locked values

| Setting | Value | Role |
| --- | --- | --- |
| `promptVariant` | `structured_rules_prompt` | **Default** local-device Tutor prompt |
| `baselinePromptVariant` | `full_current_prompt` | Quality baseline to beat (not the default) |
| `backupPromptVariant` | `compact_prompt` | Backup compact candidate (not the default) |
| `lessonVariant` | `high_very_guided` | Lesson-generation style |
| `modelName` | `Llama-3.2-3B-Instruct-q4f16_1-MLC` | On-device tutor model |
| `strategy` | `repair_pass` | Runtime strategy |
| `memoryMode` | `last_messages_only` | Memory representation |
| `lastMessagesLimit` | `8` | Memory window |
| `lessonCompletion` | `disabled` (false) | Never auto-marks a lesson done |
| `judgeProvider` | `openai` | Default evaluation judge |

## Why

- `structured_rules_prompt` was the **leading local-device Tutor candidate**: on real
  CourseFactory content (Python variables, units 1–2) the OpenAI judge preferred it
  (8.03 vs 7.60), with equal pass rate and fewer/cleaner failure modes.
- It is **shorter and faster** than `full_current_prompt` (~631 vs ~1682 instruction
  chars) and leaves **~1,051 chars of personalization headroom**.
- `full_current_prompt` remains the **quality baseline**, not the default.
- `compact_prompt` is a **backup**; a partial 5-unit top-3 run hinted it is competitive
  (~8.18 vs structured ~8.27) but that run was stopped early — unconfirmed.

## Applied — stuck-learner rule (2026-07-03)

Manual testing found a **stuck-learner loop**: when the learner said "tell me" / "i don't
know" repeatedly, the tutor kept asking more leading questions instead of just explaining.

Minimal targeted change (NOT a redesign) — added two rules to `structured_rules_prompt`
(`src/runtime/tutor-prompt-variants.ts`):
- **Rule 7:** if the learner says they don't know, asks you to just tell them, or misses the
  same idea twice → STOP asking open-ended/leading questions; give a short direct
  explanation + ONE concrete example from the reference material, then one very easy check
  question.
- **Rule 8:** don't repeat the same question/hint pattern more than twice; prefer a concrete
  worked example over confusing "what if" hypotheticals.

Verified by a small targeted smoke (structured_rules_prompt, real Llama, variables unit 1,
stuck/vague/struggling profiles, OpenAI judge): the tutor now leads with a direct
explanation + concrete example ("labelled box", `x = 5`) and exits the loop — OpenAI judge
mostly 9–10/10, learner-handling 5/5. No broad matrix was run.

## TODO — still watch: `missed_mistake`

`missed_mistake` remains the broader weakness to monitor (rule 3 already covers correcting
listed mistakes; rule 7 now also forces a direct correction when the learner is stuck). If a
future check still shows misses, extend rule 3 minimally and re-judge a small subset — do
**not** do a broad prompt redesign.
