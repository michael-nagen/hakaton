// ── Teacher Harness — scripted learner profiles (prompt eval) ────────
//
// 12 deterministic scripted learner profiles for the prompt-efficiency
// experiment. Same rules as the other profile sets: NOT an autonomous LLM
// student, NO LLM-generated turns — fixed turns so results are repeatable, and
// the SAME turns run against every prompt variant (the only variable is the
// prompt). Turns are phrased for the placeholder mock unit's real framing ("the
// single idea", "this unit", "reference material") so grounding / correction /
// redirect / advancement are actually exercised. Behaviour labels are the
// topic-agnostic ones from scoring-rules.ts.
//
// `category` groups profiles for the report's learner-profile breakdown
// (confused / impatient / struggling / fast / off-topic-future / vague-minimal).

import type { CourseSource } from '../loading/load-course-package';
import type { EvalCase } from './eval-types';
import type { ScenarioTurn } from '../loading/load-scenario';

export type LearnerCategory =
  | 'confused'
  | 'impatient'
  | 'partial'
  | 'overconfident'
  | 'off_topic'
  | 'struggling'
  | 'shortcut'
  | 'future_topic'
  | 'vague'
  | 'minimal'
  | 'example'
  | 'fast';

interface ProfileTemplate {
  id: string;
  title: string;
  description: string;
  category: LearnerCategory;
  turns: ScenarioTurn[];
}

const NO_MOVE = ['does_not_move_on_too_quickly'];
const CORRECT = ['corrects_common_mistake'];
const REDIRECT = ['redirects_to_current_unit'];
const REDIRECT_OR_UNSURE = ['redirects_or_says_unsure'];

export const PROMPT_EVAL_PROFILE_TEMPLATES: readonly ProfileTemplate[] = [
  {
    id: 'confused-beginner',
    title: 'Confused Beginner',
    description: 'Basic misconception about what the unit asks.',
    category: 'confused',
    turns: [
      { id: 'cb-1', learnerMessage: "I don't get what this unit wants. Do I just copy the definition back?", expectedBehaviors: [...CORRECT, ...REDIRECT], forbiddenBehaviors: [] },
      { id: 'cb-2', learnerMessage: 'So the one idea is just whatever is written first? I repeat that?', expectedBehaviors: CORRECT, forbiddenBehaviors: [] },
      { id: 'cb-3', learnerMessage: 'Can you help me say the idea in my own words?', expectedBehaviors: NO_MOVE, forbiddenBehaviors: [] },
    ],
  },
  {
    id: 'impatient-learner',
    title: 'Impatient Learner',
    description: 'Wants the answer immediately and tries to skip ahead.',
    category: 'impatient',
    turns: [
      { id: 'im-1', learnerMessage: 'Just give me the answer to the check question so I can move on. No hints.', expectedBehaviors: NO_MOVE, forbiddenBehaviors: [] },
      { id: 'im-2', learnerMessage: "This is trivial, skip to the next unit. What's in unit 2?", expectedBehaviors: [...REDIRECT, ...NO_MOVE], forbiddenBehaviors: [] },
      { id: 'im-3', learnerMessage: "I've got it, mark me done and move on.", expectedBehaviors: NO_MOVE, forbiddenBehaviors: [] },
    ],
  },
  {
    id: 'partial-understanding',
    title: 'Partial Understanding Learner',
    description: 'Gives a half-correct answer; needs a small correction.',
    category: 'partial',
    turns: [
      { id: 'pu-1', learnerMessage: 'The idea is mostly the first point, and the second point is unrelated. Close?', expectedBehaviors: CORRECT, forbiddenBehaviors: [] },
      { id: 'pu-2', learnerMessage: 'So which part am I still missing?', expectedBehaviors: NO_MOVE, forbiddenBehaviors: [] },
      { id: 'pu-3', learnerMessage: 'Got it — both points tie together. Did I get the whole thing?', expectedBehaviors: NO_MOVE, forbiddenBehaviors: [] },
    ],
  },
  {
    id: 'overconfident-learner',
    title: 'Overconfident Learner',
    description: 'States wrong information confidently.',
    category: 'overconfident',
    turns: [
      { id: 'oc-1', learnerMessage: "I know this: the point is that the reference material is decoration you can ignore.", expectedBehaviors: CORRECT, forbiddenBehaviors: [] },
      { id: 'oc-2', learnerMessage: "No, I'm right — repeating the material exactly IS applying it.", expectedBehaviors: CORRECT, forbiddenBehaviors: [] },
      { id: 'oc-3', learnerMessage: 'Just confirm I nailed it and we can wrap up.', expectedBehaviors: NO_MOVE, forbiddenBehaviors: [] },
    ],
  },
  {
    id: 'curious-offtopic',
    title: 'Curious Off-topic Learner',
    description: 'Asks related but out-of-scope questions.',
    category: 'off_topic',
    turns: [
      { id: 'cu-1', learnerMessage: 'Interesting — how was this whole course generated? What model made it?', expectedBehaviors: REDIRECT_OR_UNSURE, forbiddenBehaviors: [] },
      { id: 'cu-2', learnerMessage: 'Can you teach me unit 2 instead? It sounds more useful.', expectedBehaviors: REDIRECT, forbiddenBehaviors: [] },
      { id: 'cu-3', learnerMessage: 'Unrelated: what should I study after this course?', expectedBehaviors: REDIRECT_OR_UNSURE, forbiddenBehaviors: [] },
    ],
  },
  {
    id: 'struggling-learner',
    title: 'Struggling Learner',
    description: 'Repeats the same mistake; must not be advanced early.',
    category: 'struggling',
    turns: [
      { id: 'st-1', learnerMessage: "I keep copying the text back and you say that's not it. I don't know what else to do.", expectedBehaviors: [...CORRECT, ...NO_MOVE], forbiddenBehaviors: [] },
      { id: 'st-2', learnerMessage: 'I tried again and still just repeated the definition. Why is that wrong?', expectedBehaviors: [...CORRECT, ...NO_MOVE], forbiddenBehaviors: [] },
      { id: 'st-3', learnerMessage: "I'm still not sure how to say it in my own words. Can you give me a hint?", expectedBehaviors: NO_MOVE, forbiddenBehaviors: [] },
      { id: 'st-4', learnerMessage: 'One more time slowly — what is the single idea?', expectedBehaviors: NO_MOVE, forbiddenBehaviors: [] },
    ],
  },
  {
    id: 'shortcut-seeker',
    title: 'Shortcut Seeker',
    description: 'Asks for a trick instead of understanding.',
    category: 'shortcut',
    turns: [
      { id: 'sh-1', learnerMessage: "Is there a trick or shortcut so I don't have to actually understand this unit?", expectedBehaviors: [...CORRECT, ...NO_MOVE], forbiddenBehaviors: [] },
      { id: 'sh-2', learnerMessage: 'Just tell me the exact words to write to pass the check.', expectedBehaviors: NO_MOVE, forbiddenBehaviors: [] },
    ],
  },
  {
    id: 'future-topic-puller',
    title: 'Future Topic Puller',
    description: 'Repeatedly asks about future material.',
    category: 'future_topic',
    turns: [
      { id: 'ft-1', learnerMessage: 'Can you teach me what unit 2 and unit 3 cover right now?', expectedBehaviors: REDIRECT, forbiddenBehaviors: [] },
      { id: 'ft-2', learnerMessage: 'Come on, just a preview of the advanced stuff later in the course?', expectedBehaviors: REDIRECT, forbiddenBehaviors: [] },
      { id: 'ft-3', learnerMessage: 'Fine. But is the next unit harder than this one?', expectedBehaviors: REDIRECT_OR_UNSURE, forbiddenBehaviors: [] },
    ],
  },
  {
    id: 'vague-learner',
    title: 'Vague Learner',
    description: 'Says "I don\'t get it" without specifics.',
    category: 'vague',
    turns: [
      { id: 'vg-1', learnerMessage: "I don't get it.", expectedBehaviors: NO_MOVE, forbiddenBehaviors: [] },
      { id: 'vg-2', learnerMessage: 'Still confused.', expectedBehaviors: NO_MOVE, forbiddenBehaviors: [] },
      { id: 'vg-3', learnerMessage: 'I guess a bit? Not really.', expectedBehaviors: NO_MOVE, forbiddenBehaviors: [] },
    ],
  },
  {
    id: 'minimal-learner',
    title: 'Silent / Minimal Learner',
    description: 'Replies with "ok", "yes", "maybe", very short answers.',
    category: 'minimal',
    turns: [
      { id: 'mn-1', learnerMessage: 'ok', expectedBehaviors: NO_MOVE, forbiddenBehaviors: [] },
      { id: 'mn-2', learnerMessage: 'yes', expectedBehaviors: NO_MOVE, forbiddenBehaviors: [] },
      { id: 'mn-3', learnerMessage: 'maybe', expectedBehaviors: NO_MOVE, forbiddenBehaviors: [] },
    ],
  },
  {
    id: 'example-requester',
    title: 'Example Requester',
    description: 'Keeps asking for another example.',
    category: 'example',
    turns: [
      { id: 'ex-1', learnerMessage: 'Can you give me an example of the idea in this unit?', expectedBehaviors: NO_MOVE, forbiddenBehaviors: [] },
      { id: 'ex-2', learnerMessage: 'Another example please?', expectedBehaviors: NO_MOVE, forbiddenBehaviors: [] },
      { id: 'ex-3', learnerMessage: 'One more, a different one?', expectedBehaviors: NO_MOVE, forbiddenBehaviors: [] },
    ],
  },
  {
    id: 'fast-learner',
    title: 'Fast Learner',
    description: 'Gives mostly correct answers; tests whether the tutor avoids over-explaining.',
    category: 'fast',
    turns: [
      { id: 'fa-1', learnerMessage: 'In my own words: the idea is to understand the one point and apply it to the question, not just repeat it. Right?', expectedBehaviors: NO_MOVE, forbiddenBehaviors: [] },
      { id: 'fa-2', learnerMessage: 'Great, and I can explain it back clearly. Anything I missed?', expectedBehaviors: NO_MOVE, forbiddenBehaviors: [] },
    ],
  },
];

/** Category lookup for the report's learner-profile breakdown. */
export const PROMPT_EVAL_PROFILE_CATEGORY: Readonly<Record<string, LearnerCategory>> = Object.fromEntries(
  PROMPT_EVAL_PROFILE_TEMPLATES.map((t) => [t.id, t.category]),
);

/** Bind all 16 profiles to a course + unit → EvalCases. */
export function bindPromptEvalProfiles(params: { labelPrefix: string; course: CourseSource; unitId: string }): EvalCase[] {
  const { labelPrefix, course, unitId } = params;
  return PROMPT_EVAL_PROFILE_TEMPLATES.map((tpl) => ({
    id: `${labelPrefix}:${tpl.id}`,
    title: tpl.title,
    description: tpl.description,
    kind: 'profile' as const,
    course,
    unitId,
    freedomMode: 'guided' as const,
    turns: tpl.turns,
  }));
}
