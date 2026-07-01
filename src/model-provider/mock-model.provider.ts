// ── Model Provider — mock ────────────────────────────────────────────
//
// A deterministic, offline ModelProvider. It does NOT call any LLM — it
// produces a plausible tutor-style reply derived from the prompt so the demo
// flow runs end-to-end. Swap this for a real provider by implementing the
// same ModelProvider interface.

import type { GenerateTextArgs, ModelProvider } from './model-provider.types';

/** Pull the unit goal line out of a tutor system prompt, if present. */
function extractUnitGoal(system: string | undefined): string | null {
  if (!system) return null;
  const match = system.match(/Unit goal:\s*(.+)/);
  return match ? match[1].trim() : null;
}

/** Pull the learner's message out of a tutor user prompt, if present. */
function extractLearnerMessage(prompt: string): string {
  const match = prompt.match(/Learner message:\s*([\s\S]+)$/);
  return (match ? match[1] : prompt).trim();
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
