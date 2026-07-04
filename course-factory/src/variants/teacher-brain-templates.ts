// ── Course Factory — TeacherBrain templates (guidance axis) ──────────
//
// Renders a unit's TeacherBrain at one of five guidance levels, using ONLY the
// existing schema fields (persona / tone / objectives / guidelines /
// constraints / systemPromptSeed). The "teaching flow" for the guided variants
// is encoded here — no new schema fields are introduced.
//
// The base unit's own do-not-teach constraints are always preserved (grounding)
// and expanded as guidance increases.

import type { LearningUnit, TeacherBrain } from '../../../src/course-package/course-package.types';
import type { GuidanceStyle } from './variant-specs';

/** Base do-not-teach / grounding constraints carried over from the source unit. */
function baseConstraints(unit: LearningUnit): string[] {
  return (unit.teacherBrain?.constraints ?? []).slice();
}

/** A short primary objective derived from the unit goal. */
function primaryObjective(unit: LearningUnit): string {
  return `Help the learner achieve this outcome: ${unit.goal}`;
}

/**
 * Build a TeacherBrain for `unit` at the given guidance style. Persona/tone are
 * kept close to the source but phrased for the level; objectives/guidelines/
 * constraints/seed carry the actual guidance load.
 */
export function buildTeacherBrain(unit: LearningUnit, style: GuidanceStyle): TeacherBrain {
  const persona = unit.teacherBrain?.persona || 'A patient tutor for this micro-lesson.';
  const grounding = baseConstraints(unit);
  const goal = unit.goal;

  switch (style) {
    case 'free': {
      return {
        persona,
        tone: 'concise, natural, encouraging',
        objectives: [primaryObjective(unit)],
        guidelines: [
          'Teach the unit outcome using the provided reference material.',
          'Answer the learner naturally and briefly.',
        ],
        constraints: [
          ...grounding.slice(0, 1),
          'Do not invent facts beyond the provided material.',
        ],
        systemPromptSeed:
          `You are a tutor for one small unit. Teach it from the provided reference material and answer the learner naturally. ` +
          `Stay on this unit's outcome (${goal}) and do not invent facts beyond the material.`,
      };
    }

    case 'free_plus': {
      return {
        persona,
        tone: 'natural, encouraging, lightly structured',
        objectives: [primaryObjective(unit), 'Confirm the learner understands before wrapping up.'],
        guidelines: [
          'Lead with the reference material, then explain in your own words.',
          'Watch for the listed common mistakes and correct them when they appear.',
          'Aim for understanding (mastery) of the outcome before finishing — but choose how to get there.',
        ],
        constraints: [
          ...grounding,
          'Do not invent facts beyond the provided material.',
        ],
        systemPromptSeed:
          `You are a tutor for one small unit (outcome: ${goal}). Lead with the reference material and correct the prepared common mistakes when they arise. ` +
          `Aim for the learner to master the outcome before finishing; you may choose how to phrase and sequence your explanation.`,
      };
    }

    case 'guided': {
      return {
        persona,
        tone: 'supportive, clear, still conversational',
        objectives: [
          primaryObjective(unit),
          'Surface and correct the prepared common mistakes.',
          'Confirm mastery on a check question before advancing.',
        ],
        guidelines: [
          'Introduce the topic briefly, then explain using the reference chunks.',
          'Give at least one concrete example.',
          'Ask a guided check question; reveal hints one at a time — never the full answer first.',
          'When the learner hits a listed common mistake, correct it using the prepared correction.',
          'Do not advance until the learner shows understanding on the check question.',
        ],
        constraints: [
          ...grounding,
          'Do not reveal a full answer before offering at least one hint.',
          'Do not introduce topics reserved for later units.',
        ],
        systemPromptSeed:
          `You are a guided tutor for one unit (outcome: ${goal}). Light flow: orient briefly → explain from the chunks → give an example → ask a guided check → correct any listed mistake → hint before answering. ` +
          `Advancement rule: only advance after the learner answers the check question correctly.`,
      };
    }

    case 'guided_rich': {
      return {
        persona,
        tone: 'supportive, thorough, still conversational',
        objectives: [
          primaryObjective(unit),
          'Surface, contrast and correct the prepared common mistakes.',
          'Support a confused learner with a simpler example.',
          'Confirm mastery on a check question before advancing.',
        ],
        guidelines: [
          'Introduce the topic briefly, then explain using the reference chunks.',
          'Give at least one worked example, and a contrast case for a common mistake.',
          'Ask a guided check question; escalate hints gradually and never give the full answer first.',
          'When the learner hits a listed common mistake, correct it using the prepared correction.',
          'If the learner is confused, slow down and re-explain with a simpler example.',
          'Do not advance until the learner shows understanding on the check question.',
        ],
        constraints: [
          ...grounding,
          'Never teach future-unit topics even if asked — redirect to the current unit.',
          'Do not give the final answer until at least one hint has been tried.',
          'Do not invent facts beyond the provided material.',
        ],
        systemPromptSeed:
          `You are a richly-guided tutor for one unit (outcome: ${goal}). Flow: orient → teach from the chunks → worked example → guided check → correct likely mistakes with contrast → hint before any answer → mastery check. ` +
          `Advancement rule: advance only after the mastery check is passed. If confused, re-explain more simply before advancing.`,
      };
    }

    case 'very_guided': {
      return {
        persona,
        tone: 'directive, precise, step-by-step (still respectful)',
        objectives: [
          primaryObjective(unit),
          'Follow the fixed teaching flow in order.',
          'Handle every prepared common mistake explicitly.',
          'Only suggest moving on after a passed mastery check.',
        ],
        guidelines: [
          'Step 1 — Open with a short orientation to the unit outcome.',
          'Step 2 — Teach the concept using the prepared reference chunks.',
          'Step 3 — Give exactly one clear example.',
          'Step 4 — Ask a guided check question.',
          'Step 5 — Respond to the likely common mistake using the prepared correction.',
          'Step 6 — Give a hint before giving any answer.',
          'Step 7 — Run a mastery check to confirm understanding.',
          'Step 8 — Only then suggest moving on.',
        ],
        constraints: [
          ...grounding,
          'Follow the teaching steps in order; do not skip ahead.',
          'Never answer a check question directly before the learner attempts it.',
          'Always give a hint before any answer.',
          'Redirect any off-topic or future-topic question back to this unit.',
          'Advance only after the mastery check is passed.',
          'Do not invent facts beyond the provided material.',
        ],
        systemPromptSeed:
          `You are a strictly-guided tutor for one unit (outcome: ${goal}). Follow this exact flow and do not skip steps: ` +
          `1) orient; 2) teach from the chunks; 3) one example; 4) guided check; 5) respond to the likely mistake; 6) hint before any answer; 7) mastery check; 8) only then suggest moving on. ` +
          `Strict rules: never answer a check before the learner tries; always hint before answering; redirect off-topic/future-topic questions back to this unit; advance only after the mastery check is passed.`,
      };
    }
  }
}
