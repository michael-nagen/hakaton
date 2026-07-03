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

## TODO — next quality improvement: `missed_mistake`

The main remaining weakness across all evaluations is **`missed_mistake`**: when a learner
matches/repeats a listed common mistake, the tutor sometimes continues without correcting
it explicitly.

**Planned minimal change (NOT done yet — deliberately deferred to keep the locked default
identical to what was evaluated):** add ONE line to `structured_rules_prompt` such as
_"If the learner repeats a listed common mistake, correct that mistake explicitly before
continuing."_ Then re-judge a small targeted subset (structured_rules_prompt, a few
mistake-heavy profiles) rather than a full matrix.

Do **not** do a broad prompt redesign for this.
