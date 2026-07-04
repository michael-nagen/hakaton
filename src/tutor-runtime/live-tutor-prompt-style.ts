// ── Live tutor prompt style — REVERSIBLE EXPERIMENT TOGGLE ───────────
//
// WHY THIS EXISTS
// The teacher-harness efficiency experiment found `structured_rules_prompt`
// (numbered teaching rules + the shared behavior rules) to be the strongest
// instruction shape. That experiment runs on the harness prompt path
// (build-tutor-prompt.ts, PLAIN TEXT). This toggle lets us try the SAME
// teaching rules inside the LIVE app prompt — which must stay STRICT JSON —
// without deleting or rewriting the current live prompt. It is a controlled A/B
// so we can switch back instantly if the new style teaches worse.
//
// THE TWO STYLES
//   • "current_json"          → the existing live app prompt, unchanged. This is
//                               the persona line + lesson context + strict JSON
//                               schema that shipped before this experiment.
//   • "structured_rules_json" → the SAME live lesson context and the SAME strict
//                               JSON schema, but the opening instruction block is
//                               replaced with the evaluated structured teaching
//                               rules (adapted from the harness
//                               structured_rules_prompt, minus the plain-text /
//                               "never advance" bits the live JSON schema owns).
//
// HOW TO SWITCH
//   Change LIVE_TUTOR_PROMPT_STYLE below to "structured_rules_json".
//   Both the local and cloud paths pick it up automatically (the prompt builder
//   defaults to this constant).
//
// HOW TO ROLL BACK
//   Set LIVE_TUTOR_PROMPT_STYLE back to "current_json" (the default). Nothing
//   else needs to change — the current prompt logic is never removed, so this is
//   a one-line, zero-risk revert.
//
// GUARANTEES (do not break)
//   • The strict JSON contract is identical in BOTH styles
//     (messageToStudent · nextAction · studentLevelEstimate · confidence).
//   • Runtime flow, repair_pass, model defaults, UI, deterministic_steps,
//     CourseFactory, and the (eval-only) judge are all untouched.

export type LiveTutorPromptStyle = 'current_json' | 'structured_rules_json';

/**
 * The active live tutor prompt style. Default is "current_json" — do NOT flip
 * this to "structured_rules_json" unless you are intentionally running the
 * experiment. Rolling back = setting this to "current_json".
 */
export const LIVE_TUTOR_PROMPT_STYLE: LiveTutorPromptStyle = 'current_json';
