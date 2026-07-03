// ── Teacher Harness — scripted learner profiles ──────────────────────
//
// Six SCRIPTED learner types (not autonomous LLM student agents). Each profile
// is an ordered list of learner turns plus the behaviour contract we expect
// from the tutor, all bound to unit 1 of the python-print fixture course
// (print() + "each print ends on a new line"). The turns deliberately probe
// different failure modes:
//
//   confused-beginner      wrong basic mental model → gentle correction
//   impatient-learner      wants answers now, asks future topics → redirects
//   partial-understanding  half-correct → small correction, not a lecture
//   overconfident-learner  confidently wrong → firm correction, no over-explaining
//   curious-offtopic       related but out-of-scope → redirect or honest "not covered"
//   struggling-learner     repeats the same mistake → hints, never advanced early
//
// Behaviour labels reference the rule registry in scoring/scoring-rules.ts.
// Unknown labels would be recorded as unscored, so stick to registered ones.

import type { EvalCase } from './eval-types';

const COURSE = {
  source: 'file' as const,
  path: 'fixtures/course-python-print-101.json',
  courseId: 'course-python-print-101',
};
const UNIT_ID = 'py-print-unit-1-print-and-newline';

/** Forbidden future-topic labels shared by most unit-1 turns. */
const NO_FUTURE = ['teaches_end_keyword', 'teaches_sep_keyword', 'teaches_f_strings'];

export const LEARNER_PROFILES: readonly EvalCase[] = [
  {
    id: 'confused-beginner',
    title: 'Confused Beginner',
    description:
      'Misunderstands the basic idea (thinks output stays on one line), makes simple wrong assumptions, needs gentle correction.',
    kind: 'profile',
    course: COURSE,
    unitId: UNIT_ID,
    freedomMode: 'guided',
    turns: [
      {
        id: 'cb-1',
        learnerMessage:
          'So print just keeps putting everything on the same line until I tell it to stop, right?',
        expectedBehaviors: ['corrects_common_mistake', 'explains_each_print_new_line'],
        forbiddenBehaviors: NO_FUTURE,
      },
      {
        id: 'cb-2',
        learnerMessage:
          'Oh. So print("hi") and print("there") gives me two lines? I thought Python decides that by itself somehow.',
        expectedBehaviors: ['explains_each_print_new_line'],
        forbiddenBehaviors: NO_FUTURE,
      },
      {
        id: 'cb-3',
        learnerMessage: 'What does print actually do with the thing inside the parentheses?',
        expectedBehaviors: [],
        forbiddenBehaviors: NO_FUTURE,
      },
      {
        id: 'cb-4',
        learnerMessage:
          'I think I get it now: every print starts... I mean ends with a new line? Is that it?',
        expectedBehaviors: ['explains_each_print_new_line', 'does_not_move_on_too_quickly'],
        forbiddenBehaviors: NO_FUTURE,
      },
    ],
  },
  {
    id: 'impatient-learner',
    title: 'Impatient Learner',
    description:
      'Wants the answer immediately, tries to skip ahead, asks future-topic questions (f-strings, end=, next units).',
    kind: 'profile',
    course: COURSE,
    unitId: UNIT_ID,
    freedomMode: 'guided',
    turns: [
      {
        id: 'im-1',
        learnerMessage:
          'Skip the baby steps and just tell me the fastest way to print stuff. How do f-strings work?',
        expectedBehaviors: ['redirects_to_current_unit', 'does_not_teach_future_topic'],
        forbiddenBehaviors: ['teaches_f_strings'],
      },
      {
        id: 'im-2',
        learnerMessage:
          "Fine. Can I at least use end='' to keep everything on one line? Just show me quickly.",
        expectedBehaviors: ['redirects_to_current_unit', 'does_not_introduce_end_keyword'],
        forbiddenBehaviors: ['teaches_end_keyword', 'teaches_sep_keyword'],
      },
      {
        id: 'im-3',
        learnerMessage: "This is slow. What's in the next unit? Teach me the comma thing now.",
        expectedBehaviors: ['redirects_to_current_unit', 'stays_within_unit'],
        forbiddenBehaviors: NO_FUTURE,
      },
      {
        id: 'im-4',
        learnerMessage:
          'Ok whatever. print("a") then print("b") — same line, yes or no? One-word answer please.',
        expectedBehaviors: ['explains_each_print_new_line'],
        forbiddenBehaviors: NO_FUTURE,
      },
    ],
  },
  {
    id: 'partial-understanding',
    title: 'Partial Understanding Learner',
    description:
      'Gives half-correct answers; needs a small targeted correction, not a full lecture.',
    kind: 'profile',
    course: COURSE,
    unitId: UNIT_ID,
    freedomMode: 'guided',
    turns: [
      {
        id: 'pu-1',
        learnerMessage:
          'print("one") then print("two") gives two lines because print adds a space... I mean a new line at the end. Right?',
        expectedBehaviors: ['explains_each_print_new_line'],
        forbiddenBehaviors: NO_FUTURE,
      },
      {
        id: 'pu-2',
        learnerMessage: 'So the new line comes at the START of each print, before the value?',
        expectedBehaviors: ['explains_each_print_new_line'],
        forbiddenBehaviors: NO_FUTURE,
      },
      {
        id: 'pu-3',
        learnerMessage:
          'Got it — print shows the value, then moves to a new line. Did I get it right this time?',
        expectedBehaviors: ['does_not_move_on_too_quickly'],
        forbiddenBehaviors: NO_FUTURE,
      },
    ],
  },
  {
    id: 'overconfident-learner',
    title: 'Overconfident Learner',
    description:
      'States wrong things confidently; needs a clear correction without over-explaining.',
    kind: 'profile',
    course: COURSE,
    unitId: UNIT_ID,
    freedomMode: 'guided',
    turns: [
      {
        id: 'oc-1',
        learnerMessage:
          "I'm certain print(\"a\") and print(\"b\") print on the same line — I've done this plenty of times before.",
        expectedBehaviors: ['corrects_common_mistake', 'explains_each_print_new_line'],
        forbiddenBehaviors: NO_FUTURE,
      },
      {
        id: 'oc-2',
        learnerMessage:
          "No, you're wrong. Python only makes a new line if you write \\n yourself. Everyone knows that.",
        expectedBehaviors: ['explains_each_print_new_line'],
        forbiddenBehaviors: NO_FUTURE,
      },
      {
        id: 'oc-3',
        learnerMessage:
          'Fine. But print definitely needs a string — printing a number crashes it. True.',
        expectedBehaviors: [],
        forbiddenBehaviors: [...NO_FUTURE, 'teaches_formatting_methods'],
      },
    ],
  },
  {
    id: 'curious-offtopic',
    title: 'Curious / Off-topic Learner',
    description:
      'Asks related but out-of-scope questions; tests whether the tutor redirects properly or honestly says the material does not cover it.',
    kind: 'profile',
    course: COURSE,
    unitId: UNIT_ID,
    freedomMode: 'guided',
    turns: [
      {
        id: 'cu-1',
        learnerMessage: 'This is cool. How would I do the same thing in JavaScript with console.log?',
        expectedBehaviors: ['redirects_or_says_unsure'],
        forbiddenBehaviors: ['teaches_then_catch_syntax'],
      },
      {
        id: 'cu-2',
        learnerMessage: 'Can print also read what the user types? Like an input() thing?',
        expectedBehaviors: ['redirects_or_says_unsure'],
        forbiddenBehaviors: NO_FUTURE,
      },
      {
        id: 'cu-3',
        learnerMessage:
          'Why does Python even add the newline by default? Who decided that? Tell me the whole history.',
        expectedBehaviors: ['redirects_or_says_unsure'],
        forbiddenBehaviors: NO_FUTURE,
      },
    ],
  },
  {
    id: 'struggling-learner',
    title: 'Struggling Learner',
    description:
      'Repeats the same mistake; needs hints and patience, and must not be advanced too early.',
    kind: 'profile',
    course: COURSE,
    unitId: UNIT_ID,
    freedomMode: 'guided',
    turns: [
      {
        id: 'st-1',
        learnerMessage:
          'I wrote print("a") and print("b") but they came out on different lines. I expected one line. What did I break?',
        expectedBehaviors: ['corrects_common_mistake', 'explains_each_print_new_line'],
        forbiddenBehaviors: NO_FUTURE,
      },
      {
        id: 'st-2',
        learnerMessage:
          "I still don't get it. I ran it again and it's STILL two lines. Is my Python installation broken?",
        expectedBehaviors: ['explains_each_print_new_line', 'does_not_move_on_too_quickly'],
        forbiddenBehaviors: NO_FUTURE,
      },
      {
        id: 'st-3',
        learnerMessage:
          'So next time it will be one line? I still think two prints share a line unless I add something special.',
        expectedBehaviors: ['corrects_common_mistake', 'does_not_move_on_too_quickly'],
        forbiddenBehaviors: NO_FUTURE,
      },
      {
        id: 'st-4',
        learnerMessage: 'Maybe explain it one more time, slowly. Why two lines?',
        expectedBehaviors: ['explains_each_print_new_line', 'does_not_move_on_too_quickly'],
        forbiddenBehaviors: NO_FUTURE,
      },
    ],
  },
];

export function getProfilesByIds(ids: string[]): EvalCase[] {
  const known = new Map(LEARNER_PROFILES.map((p) => [p.id, p]));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length > 0) {
    throw new Error(
      `Unknown learner profile(s): ${missing.join(', ')}. Available: ${LEARNER_PROFILES.map((p) => p.id).join(', ')}`,
    );
  }
  return ids.map((id) => known.get(id) as EvalCase);
}
