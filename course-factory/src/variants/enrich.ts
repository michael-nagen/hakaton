// ── Course Factory — deterministic, same-topic content shaping ───────
//
// Turns a base unit's content into the exact counts a variant's detail gate
// asks for. Two directions:
//   • trim  — keep the first N items (for low-detail variants)
//   • enrich — add MORE support for the SAME topic (never new topics):
//       - orientation / recap chunks derived from the unit goal
//       - worked-contrast chunks derived from the unit's own common mistakes
//       - extra progressive hints derived from KB titles + the goal
//       - a mastery-check question derived from the unit goal
//       - guard mistakes derived from the unit's own do-not-teach constraints
//
// Everything is deterministic and grounded in the unit's existing material, so
// a richer variant is genuinely "more prepared support", not padding with
// unrelated topics. Content quality is judged later by Teacher Harness, not here.

import type {
  CommonMistake,
  Hint,
  KnowledgeBaseChunk,
  LearningUnit,
  Question,
} from '../../../src/course-package/course-package.types';

/** First sentence (or the whole string) — used to summarise a mistake/goal. */
function firstSentence(text: string): string {
  const s = text.split(/(?<=[.!?])\s+/).filter(Boolean)[0] ?? text;
  return s.trim();
}

// ── Knowledge chunks ─────────────────────────────────────────────────

/**
 * Produce EXACTLY `target` chunks for a unit. Trims to the first `target` when
 * the base has too many; enriches with same-topic derived chunks when too few.
 * Derived chunks are clearly labelled ("Orientation", "Worked contrast", …).
 */
export function shapeChunks(unit: LearningUnit, target: number): KnowledgeBaseChunk[] {
  const base = unit.knowledgeBaseChunks ?? [];
  if (base.length >= target) return base.slice(0, target);

  const out: KnowledgeBaseChunk[] = [...base];
  const derived: Array<{ title: string; content: string; tags: string[] }> = [];

  // 1. Orientation from the unit goal.
  derived.push({
    title: 'Orientation: what this unit covers',
    content: `This unit focuses on one outcome: ${unit.goal} Keep every explanation anchored to that outcome.`,
    tags: ['orientation', 'goal'],
  });

  // 2. A worked-contrast chunk per prepared common mistake.
  for (const m of unit.commonMistakes ?? []) {
    derived.push({
      title: `Worked contrast: ${firstSentence(m.mistake)}`,
      content: `A common trap: ${m.mistake} The correct way to think about it: ${m.correction}`,
      tags: ['example', 'contrast', 'common-mistake'],
    });
  }

  // 3. A recap that ties the existing chunks together.
  const titles = base.map((c) => c.title).filter(Boolean);
  derived.push({
    title: 'Quick recap of the key points',
    content:
      titles.length > 0
        ? `Recap — the essentials of this unit are: ${titles.join('; ')}. Re-check these before moving on.`
        : `Recap — restate the unit outcome in your own words: ${unit.goal}`,
    tags: ['recap', 'mastery'],
  });

  let i = 0;
  while (out.length < target) {
    const src = derived[i % derived.length];
    const suffix = i < derived.length ? '' : `-${Math.floor(i / derived.length) + 1}`;
    out.push({
      id: `${unit.id}-kb-v${out.length + 1}${suffix}`,
      unitId: unit.id,
      title: src.title,
      content: src.content,
      tags: src.tags,
      source: 'variant-enrichment (same-topic, derived from unit material)',
    });
    i += 1;
  }
  return out;
}

// ── Hints ────────────────────────────────────────────────────────────

/** Ensure a question carries at least `min` progressive hints (ordered). */
export function shapeHints(question: Question, unit: LearningUnit, min: number): Hint[] {
  const base = [...(question.hints ?? [])].sort((a, b) => a.order - b.order);
  if (base.length >= min) return base;

  const out: Hint[] = [...base];
  const kbTitle = unit.knowledgeBaseChunks?.[0]?.title;
  const seeds: string[] = [
    kbTitle ? `Re-read the reference titled "${kbTitle}".` : `Re-read the unit's reference material.`,
    `Recall the unit goal: ${unit.goal}`,
    `Break the problem into one small step and check that step first.`,
  ];
  let i = 0;
  while (out.length < min) {
    out.push({
      id: `${question.id}-h-v${out.length + 1}`,
      order: out.length + 1,
      text: seeds[i % seeds.length],
    });
    i += 1;
  }
  return out;
}

// ── Questions ────────────────────────────────────────────────────────

/** Produce EXACTLY `target` questions; enrich with a mastery-check question. */
export function shapeQuestions(unit: LearningUnit, target: number, hintsMin: number): Question[] {
  const base = unit.questions ?? [];
  const shaped = base.slice(0, Math.min(base.length, target)).map((q) => ({
    ...q,
    hints: shapeHints(q, unit, hintsMin),
  }));
  if (shaped.length >= target) return shaped;

  let n = shaped.length;
  while (shaped.length < target) {
    n += 1;
    const q: Question = {
      id: `${unit.id}-q-v${n}`,
      prompt: `Mastery check: in your own words, ${unit.goal.replace(/\.$/, '')}?`,
      type: 'open',
      answer: `A correct answer restates the unit outcome: ${unit.goal}`,
      hints: [],
      difficulty: 'beginner',
    };
    q.hints = shapeHints(q, unit, hintsMin);
    shaped.push(q);
  }
  return shaped;
}

// ── Common mistakes ──────────────────────────────────────────────────

/** Pull "do not teach X" style topics out of the unit's own constraints. */
function futureTopicsFromConstraints(unit: LearningUnit): string[] {
  const out: string[] = [];
  for (const c of unit.teacherBrain?.constraints ?? []) {
    const m = c.match(/do not teach\s+([^.;(]+)/i) ?? c.match(/don'?t teach\s+([^.;(]+)/i);
    if (m) out.push(m[1].trim());
  }
  return out;
}

/** Produce `target` common mistakes; enrich with same-topic guard mistakes. */
export function shapeMistakes(unit: LearningUnit, target: number): CommonMistake[] {
  const base = unit.commonMistakes ?? [];
  if (base.length >= target) return base.slice(0, target);

  const out: CommonMistake[] = [...base];
  const derived: Array<{ mistake: string; correction: string }> = [];

  for (const topic of futureTopicsFromConstraints(unit)) {
    derived.push({
      mistake: `Jumping ahead to ${topic} before mastering this unit.`,
      correction: `That belongs to a later lesson. Stay with this unit's approach for now and redirect back to: ${unit.goal}`,
    });
  }
  derived.push({
    mistake: 'Rushing to the final answer without checking understanding.',
    correction: 'Pause and verify each step (and the unit goal) before moving on.',
  });
  derived.push({
    mistake: 'Restating the reference material without applying it to the question.',
    correction: 'Apply the idea to the concrete question rather than repeating the definition.',
  });

  let i = 0;
  while (out.length < target && i < derived.length * 3) {
    const src = derived[i % derived.length];
    const suffix = i < derived.length ? '' : `-${Math.floor(i / derived.length) + 1}`;
    // Skip if we somehow duplicated an identical mistake string.
    if (!out.some((m) => m.mistake === src.mistake)) {
      out.push({
        id: `${unit.id}-cm-v${out.length + 1}${suffix}`,
        mistake: src.mistake,
        correction: src.correction,
      });
    }
    i += 1;
  }
  return out;
}
