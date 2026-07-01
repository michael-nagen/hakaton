// ── Model Provider — mock ────────────────────────────────────────────
//
// A deterministic, offline ModelProvider. It does NOT call any LLM — it
// produces a plausible tutor-style reply derived from the prompt so the demo
// flow runs end-to-end. Swap this for a real provider by implementing the
// same ModelProvider interface.
//
// It serves two prompt shapes without changing the ModelProvider seam:
//   • Structured tutor path (create-tutor-provider): the system prompt asks for
//     a strict TutorResponse JSON. The mock returns that JSON with a simple,
//     DETERMINISTIC progression rule so Built-in can actually guide a learner
//     through a lesson and complete it (short/greeting → engage; a substantive
//     answer or repeated attempts → advance the step).
//   • Text path (runTutorTurn / buildTutorPrompt): returns a plain prose reply,
//     unchanged, so the existing demo pages keep working.

import type { GenerateTextArgs, ModelProvider } from './model-provider.types';

/** The structured path asks for a TutorResponse JSON; detect that schema block. */
function isStructuredResponsePrompt(system: string | undefined): boolean {
  return !!system && system.includes('"nextAction"');
}

/** Pull a `Label: value` line out of a prompt, if present. */
function extractLine(text: string | undefined, label: string): string | null {
  if (!text) return null;
  const match = text.match(new RegExp(`${label}:\\s*(.+)`));
  return match ? match[1].trim() : null;
}

/** Pull the learner's message out of a tutor user prompt (text path). */
function extractLearnerMessage(prompt: string): string {
  const match = prompt.match(/Learner message:\s*([\s\S]+)$/);
  return (match ? match[1] : prompt).trim();
}

/** Pull the learner's latest answer out of a structured user prompt. */
function extractLatestAnswer(prompt: string): string {
  const match = prompt.match(/Student's latest answer:\s*([\s\S]+)$/);
  return (match ? match[1] : prompt).trim();
}

function extractAttempts(prompt: string): number {
  const match = prompt.match(/Attempts on this step:\s*(\d+)/);
  return match ? Number(match[1]) : 0;
}

/** Build a deterministic structured TutorResponse JSON string. */
function mockStructuredResponse(prompt: string, system: string | undefined): string {
  const question = extractLine(system, 'Current question') ?? 'this step';
  const goal = extractLine(system, 'Current goal');
  const answer = extractLatestAnswer(prompt);
  const answerLen = answer.replace(/\s+/g, ' ').trim().length;
  const attempts = extractAttempts(prompt);

  const greetingOnly = /^(hi|hello|hey|start|begin|ready|ok|okay)\b/i.test(answer) || answerLen < 6;
  const substantive = answerLen >= 20;

  let nextAction: 'ask_question' | 'give_hint' | 'continue';
  let message: string;
  if (greetingOnly && attempts <= 1) {
    nextAction = 'ask_question';
    message = `[mock tutor] Let's begin. ${question} Share your first thoughts.`;
  } else if (substantive || attempts >= 2) {
    nextAction = 'continue';
    message = `[mock tutor] Nice — that shows the right idea. Let's move on to the next step.`;
  } else {
    nextAction = 'give_hint';
    message = `[mock tutor] Good start. Hint: think about "${goal ?? question}", then add a little more detail.`;
  }

  const level = answerLen >= 80 ? 'advanced' : answerLen >= 25 ? 'intermediate' : 'beginner';

  return JSON.stringify({
    messageToStudent: message,
    nextAction,
    studentLevelEstimate: level,
    confidence: 0.6,
  });
}

/** Pull the unit goal line out of a tutor system prompt, if present (text path). */
function extractUnitGoal(system: string | undefined): string | null {
  return extractLine(system, 'Unit goal');
}

/**
 * Create a mock provider. The reply is deterministic given the same inputs,
 * so it is safe to assert on in tests/demos.
 */
export function createMockModelProvider(): ModelProvider {
  return {
    name: 'mock',
    async generateText(args: GenerateTextArgs): Promise<string> {
      const { prompt, system } = args;

      if (isStructuredResponsePrompt(system)) {
        return mockStructuredResponse(prompt, system);
      }

      const goal = extractUnitGoal(system);
      const learnerMessage = extractLearnerMessage(prompt);

      const lines = [
        `[mock-tutor] Thanks for your message: "${learnerMessage}".`,
        goal
          ? `Let's connect this to the unit goal — ${goal}`
          : `Let's work through this step by step.`,
        `(This is a deterministic mock response. Plug in a real ModelProvider to get a live answer.)`,
      ];
      return lines.join('\n');
    },
  };
}

/** Shared default instance for convenience in the demo flow. */
export const mockModelProvider: ModelProvider = createMockModelProvider();
