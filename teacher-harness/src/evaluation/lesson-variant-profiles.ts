// ── Teacher Harness — lesson-variant learner profiles ────────────────
//
// The lesson-variant experiment compares CoursePackage STYLES (detail +
// guidance) using ONE model (Llama 3.2 3B) and ONE strategy (repair_pass).
// The only variable is the package; everything else is fixed — including these
// scripted learner turns, which are applied identically to every variant.
//
// Why a separate profile set from learner-profiles.ts: the CourseFactory
// variant output under course-factory/output/variants/ is the "mock-demo"
// PLACEHOLDER course (its single idea is literally "restate the one idea of
// this mock unit"), not the Python-printing topic the other profiles assume.
// Reusing the Python turns would be topically broken against placeholder
// content and would measure noise. These turns instead engage the placeholder
// unit's real framing ("the single idea", "this unit", "restate") and its
// prepared common mistakes, so grounding / correction / redirect / advancement
// are actually exercised — and exercised the SAME way across all five variants,
// which is what makes the variant comparison fair.
//
// Behaviour labels are the topic-agnostic ones from scoring-rules.ts. Note that
// concrete future-topic-syntax leakage (f-strings, end=, .then) cannot occur on
// placeholder content — there is no such syntax to leak — so that dimension is
// near-zero here by construction (documented in the report's Limitations).

import type { CourseSource } from '../loading/load-course-package';
import type { EvalCase } from './eval-types';
import type { ScenarioTurn } from '../loading/load-scenario';

/** One learner profile as reusable turns, not yet bound to a course/unit. */
interface ProfileTemplate {
  id: string;
  title: string;
  description: string;
  turns: ScenarioTurn[];
}

/** The six scripted learner types, phrased for the placeholder mock unit. */
export const LESSON_VARIANT_PROFILE_TEMPLATES: readonly ProfileTemplate[] = [
  {
    id: 'confused-beginner',
    title: 'Confused Beginner',
    description: 'Misunderstands what the unit is even asking; makes a simple wrong assumption; needs gentle correction.',
    turns: [
      {
        id: 'cb-1',
        learnerMessage: "I don't really get what this unit wants. Is it just asking me to copy the definition back word for word?",
        expectedBehaviors: ['corrects_common_mistake', 'redirects_to_current_unit'],
        forbiddenBehaviors: [],
      },
      {
        id: 'cb-2',
        learnerMessage: 'So the single idea of this unit is... whatever is written first, right? I just repeat that?',
        expectedBehaviors: ['corrects_common_mistake'],
        forbiddenBehaviors: [],
      },
      {
        id: 'cb-3',
        learnerMessage: 'Okay. Can you help me say the one idea of this unit in my own words instead of just repeating it?',
        expectedBehaviors: ['does_not_move_on_too_quickly'],
        forbiddenBehaviors: [],
      },
    ],
  },
  {
    id: 'impatient-learner',
    title: 'Impatient Learner',
    description: 'Wants the answer to the check question immediately and tries to skip ahead to the next unit.',
    turns: [
      {
        id: 'im-1',
        learnerMessage: 'Just tell me the answer to the check question so I can move on. No hints, give me the answer.',
        expectedBehaviors: ['does_not_move_on_too_quickly'],
        forbiddenBehaviors: [],
      },
      {
        id: 'im-2',
        learnerMessage: "This is trivial. Can we skip to the next unit already? What's in unit 2?",
        expectedBehaviors: ['redirects_to_current_unit', 'does_not_move_on_too_quickly'],
        forbiddenBehaviors: [],
      },
      {
        id: 'im-3',
        learnerMessage: "Fine, whatever the one idea is, I've got it. Mark me done and move on.",
        expectedBehaviors: ['does_not_move_on_too_quickly'],
        forbiddenBehaviors: [],
      },
    ],
  },
  {
    id: 'partial-understanding',
    title: 'Partial Understanding Learner',
    description: 'Gives a half-correct restatement; needs a small targeted correction, not a full re-teach.',
    turns: [
      {
        id: 'pu-1',
        learnerMessage: 'I think the idea of this unit is mostly about the first point, and the second point is unrelated. Close?',
        expectedBehaviors: ['corrects_common_mistake'],
        forbiddenBehaviors: [],
      },
      {
        id: 'pu-2',
        learnerMessage: 'So I have part of it. Which part am I still missing for the single idea?',
        expectedBehaviors: ['does_not_move_on_too_quickly'],
        forbiddenBehaviors: [],
      },
      {
        id: 'pu-3',
        learnerMessage: 'Got it — the idea ties both points together. Did I finally get the whole thing?',
        expectedBehaviors: ['does_not_move_on_too_quickly'],
        forbiddenBehaviors: [],
      },
    ],
  },
  {
    id: 'overconfident-learner',
    title: 'Overconfident Learner',
    description: 'States the idea confidently but wrong; needs a clear correction without a lecture.',
    turns: [
      {
        id: 'oc-1',
        learnerMessage: "I already know this: the point of the unit is that the reference material is just decoration and you can ignore it. Obvious.",
        expectedBehaviors: ['corrects_common_mistake'],
        forbiddenBehaviors: [],
      },
      {
        id: 'oc-2',
        learnerMessage: "No, I'm right — restating the material exactly IS applying it. That's the whole point.",
        expectedBehaviors: ['corrects_common_mistake'],
        forbiddenBehaviors: [],
      },
      {
        id: 'oc-3',
        learnerMessage: 'Fine. Then just confirm I nailed it and we can wrap up this unit.',
        expectedBehaviors: ['does_not_move_on_too_quickly'],
        forbiddenBehaviors: [],
      },
    ],
  },
  {
    id: 'curious-offtopic',
    title: 'Curious / Off-topic Learner',
    description: 'Asks related-but-out-of-scope questions; tests whether the tutor redirects or honestly says it is out of scope.',
    turns: [
      {
        id: 'cu-1',
        learnerMessage: "This is interesting — how was this whole course actually generated? What model made it?",
        expectedBehaviors: ['redirects_or_says_unsure'],
        forbiddenBehaviors: [],
      },
      {
        id: 'cu-2',
        learnerMessage: 'Can you teach me the topic of unit 2 instead? It sounds more useful than this one.',
        expectedBehaviors: ['redirects_to_current_unit'],
        forbiddenBehaviors: [],
      },
      {
        id: 'cu-3',
        learnerMessage: 'Also, unrelated: what should I study after this whole course is done?',
        expectedBehaviors: ['redirects_or_says_unsure'],
        forbiddenBehaviors: [],
      },
    ],
  },
  {
    id: 'struggling-learner',
    title: 'Struggling Learner',
    description: 'Repeats the same mistake across turns; needs hints and patience, and must not be advanced early.',
    turns: [
      {
        id: 'st-1',
        learnerMessage: "I keep just copying the reference text back and you keep saying that's not it. I don't know what else to do.",
        expectedBehaviors: ['corrects_common_mistake', 'does_not_move_on_too_quickly'],
        forbiddenBehaviors: [],
      },
      {
        id: 'st-2',
        learnerMessage: "I tried again and I still just repeated the definition. Why is that wrong again?",
        expectedBehaviors: ['corrects_common_mistake', 'does_not_move_on_too_quickly'],
        forbiddenBehaviors: [],
      },
      {
        id: 'st-3',
        learnerMessage: "Okay so I should say it in my own words and connect it to the question — but I'm still not sure how. Can you give me a hint?",
        expectedBehaviors: ['does_not_move_on_too_quickly'],
        forbiddenBehaviors: [],
      },
      {
        id: 'st-4',
        learnerMessage: 'One more time, slowly please — what is the single idea and how do I show I understand it?',
        expectedBehaviors: ['does_not_move_on_too_quickly'],
        forbiddenBehaviors: [],
      },
    ],
  },
];

/** Bind the profile templates to a specific variant course + unit → EvalCases. */
export function bindProfilesToVariant(params: {
  variantId: string;
  course: CourseSource;
  unitId: string;
}): EvalCase[] {
  const { variantId, course, unitId } = params;
  return LESSON_VARIANT_PROFILE_TEMPLATES.map((tpl) => ({
    id: `${variantId}:${tpl.id}`,
    title: tpl.title,
    description: tpl.description,
    kind: 'profile' as const,
    course,
    unitId,
    freedomMode: 'guided' as const,
    turns: tpl.turns,
  }));
}
