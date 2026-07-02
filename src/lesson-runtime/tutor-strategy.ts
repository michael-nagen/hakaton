// ── Lesson Runtime — tutor runtime strategy ──────────────────────────
//
// The user-selectable way the RUNTIME wraps the model call for a tutor turn.
// The model never owns lesson actions, memory, retrieval, or tools — a strategy
// only changes what the runtime does around generateTutorResponse:
//
//   single_tutor    one call, current step context (existing behavior)
//   retrieval_first runtime retrieves allowed course snippets first
//   guarded_output  one call + deterministic guard; issues reported, not fixed
//   repair_pass     guard fails critically → one strict rewrite call
//   critic_checker  experimental: every answer gets a second checking pass
//
// Framework-free so the same definitions can back the app UI, the lesson
// runtime, and (later) the offline harness.

export type TutorRuntimeStrategy =
  | 'single_tutor'
  | 'retrieval_first'
  | 'guarded_output'
  | 'repair_pass'
  | 'critic_checker';

export const DEFAULT_TUTOR_STRATEGY: TutorRuntimeStrategy = 'single_tutor';

export interface TutorStrategyOption {
  id: TutorRuntimeStrategy;
  /** Short product label, e.g. "Single Tutor — fastest". */
  label: string;
  /** One-line explanation shown under the selected option. */
  description: string;
  /** Marked in the UI as experimental/slowest; never the default. */
  experimental?: boolean;
}

/** Product copy for the /ai-setup selector, in display order. */
export const TUTOR_STRATEGIES: readonly TutorStrategyOption[] = [
  {
    id: 'single_tutor',
    label: 'Single Tutor — fastest',
    description: 'Fastest mode. The model answers once using the current lesson context.',
  },
  {
    id: 'retrieval_first',
    label: 'Retrieval First — more grounded',
    description: 'Adds allowed course context before answering. Better grounding, slightly slower.',
  },
  {
    id: 'guarded_output',
    label: 'Guarded Output — detects issues',
    description: 'Checks the answer for future-topic leakage and unsafe advancement.',
  },
  {
    id: 'repair_pass',
    label: 'Repair Pass — safer, slower',
    description: 'If the first answer breaks rules, the tutor rewrites it before showing it.',
  },
  {
    id: 'critic_checker',
    label: 'Critic Checker — experimental, slowest',
    description: 'Experimental. Uses an extra checking pass. Slower and mainly for testing.',
    experimental: true,
  },
];

const ALL_STRATEGIES: readonly string[] = TUTOR_STRATEGIES.map((s) => s.id);

/** Coerce a persisted/unknown value to a valid strategy (default single_tutor). */
export function resolveTutorStrategy(value: unknown): TutorRuntimeStrategy {
  return typeof value === 'string' && ALL_STRATEGIES.includes(value)
    ? (value as TutorRuntimeStrategy)
    : DEFAULT_TUTOR_STRATEGY;
}
