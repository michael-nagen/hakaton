// ── Teacher Harness — deterministic mock tutor ───────────────────────
//
// An offline, deterministic ModelProvider used to prove the harness MECHANICS
// end-to-end without any network or real model. It is NOT a quality signal:
// it does not "understand" anything. It simply reads the structured prompt the
// Tutor Runtime already built (KB blocks, common mistakes, constraints, unit
// goal) and stitches a grounded, hint-first, redirect-aware reply out of that
// prepared material.
//
// Because it only ever repeats prepared course material and honours the
// "Never" constraints verbatim, it exercises the happy path of the scorer.
// Swap in `openai-compatible` to test whether a real weak model can do the
// same from the same prompt.

import type { GenerateTextArgs, ModelProvider } from './model-provider.types';

/** Topics that belong to LATER units — the tutor must redirect, not teach. */
const FUTURE_TOPIC_HINTS: Array<{ match: RegExp; label: string }> = [
  { match: /f-?string/i, label: 'f-strings' },
  { match: /\bsep\s*=/i, label: 'the sep= keyword' },
  { match: /\bend\s*=/i, label: 'the end= keyword' },
  { match: /\.format\s*\(|format method|%[sd]/i, label: 'string formatting methods' },
  { match: /\.then\s*\(|\.catch\s*\(|consume|await|async/i, label: 'consuming a promise with .then/.catch' },
];

interface ParsedPrompt {
  unitGoal: string | null;
  kbBlocks: string[];
  corrections: string[];
  learnerMessage: string;
}

/** Pull the pieces the runtime already laid out in the system/user prompt. */
function parsePrompt(system: string | undefined, user: string): ParsedPrompt {
  const sys = system ?? '';

  const goalMatch = sys.match(/Unit goal:\s*(.+)/);
  const unitGoal = goalMatch ? goalMatch[1].trim() : null;

  // KB blocks are rendered as "[KB1] Title\ncontent..." separated by blank lines.
  const kbBlocks = Array.from(sys.matchAll(/\[KB\d+\]\s*(.+?)\n([\s\S]*?)(?=\n\n|\n\[KB\d+\]|$)/g)).map(
    (m) => m[2].trim(),
  );

  // Common mistakes are rendered as "Correction: ..." lines.
  const corrections = Array.from(sys.matchAll(/Correction:\s*(.+)/g)).map((m) => m[1].trim());

  const learnerMatch = user.match(/Learner message:\s*([\s\S]+)$/);
  const learnerMessage = (learnerMatch ? learnerMatch[1] : user).trim();

  return { unitGoal, kbBlocks, corrections, learnerMessage };
}

/** First 1–2 sentences of a KB block, so the mock reply stays brief. */
function firstSentences(text: string, count = 2): string {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.slice(0, count).join(' ').trim();
}

/** Naive keyword overlap so the mock quotes the MOST relevant chunk first. */
function scoreOverlap(a: string, b: string): number {
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 3),
    );
  const at = tokens(a);
  const bt = tokens(b);
  let hits = 0;
  for (const t of at) if (bt.has(t)) hits += 1;
  return hits;
}

export function createMockTeacherProvider(): ModelProvider {
  return {
    name: 'mock',
    async generateText(args: GenerateTextArgs): Promise<string> {
      const { unitGoal, kbBlocks, corrections, learnerMessage } = parsePrompt(args.system, args.prompt);

      // Is the learner asking about a topic reserved for a later unit? If the
      // term does not appear in any prepared KB block, treat it as future/off
      // topic and redirect instead of teaching it.
      const kbText = kbBlocks.join('\n').toLowerCase();
      const futureTopic = FUTURE_TOPIC_HINTS.find(
        (t) => t.match.test(learnerMessage) && !t.match.test(kbText),
      );

      const lines: string[] = [];

      // 1. Correct a prepared common mistake if the learner's message matches
      //    the pattern one of them addresses (grounded, not invented).
      const relevantCorrection = corrections
        .map((c) => ({ c, score: scoreOverlap(c, learnerMessage) }))
        .sort((a, b) => b.score - a.score)
        .filter((x) => x.score > 0)[0]?.c;

      if (relevantCorrection && !futureTopic) {
        lines.push(`Let's check that idea. ${relevantCorrection}`);
      }

      // 2. Redirect future/off-topic questions back to the current unit.
      if (futureTopic) {
        lines.push(
          `Good question — ${futureTopic.label} is covered in a later lesson, so we won't use it here. For now let's stay on this unit${
            unitGoal ? `: ${unitGoal}` : '.'
          }`,
        );
      }

      // 3. Ground the explanation in the most relevant prepared KB chunk.
      const bestChunk = kbBlocks
        .map((b) => ({ b, score: scoreOverlap(b, learnerMessage) }))
        .sort((a, b) => b.score - a.score)[0]?.b;
      if (bestChunk) {
        lines.push(firstSentences(bestChunk));
      } else if (!futureTopic && !relevantCorrection) {
        // Nothing prepared supports this — say so instead of inventing.
        lines.push(
          'The course material for this unit does not cover that, so I would rather not guess. Can we look at what this unit does teach?',
        );
      }

      // 4. Nudge forward with a hint-style check question (never the answer).
      if (!futureTopic) {
        lines.push('Can you try it out and tell me what you expect to see? I can give a hint if you get stuck.');
      }

      return lines.join('\n\n');
    },
  };
}

export const mockTeacherProvider: ModelProvider = createMockTeacherProvider();
