// ── Lesson Runtime — flow-mode resolver tests ────────────────────────

import { describe, expect, it } from 'vitest';
import { DEFAULT_LESSON_FLOW_MODE, resolveLessonFlowMode } from './lesson-flow-mode';

describe('resolveLessonFlowMode', () => {
  it('defaults to "current" (safe, unchanged behavior)', () => {
    expect(DEFAULT_LESSON_FLOW_MODE).toBe('current');
    expect(resolveLessonFlowMode(undefined)).toBe('current');
    expect(resolveLessonFlowMode(null)).toBe('current');
    expect(resolveLessonFlowMode('nonsense')).toBe('current');
    expect(resolveLessonFlowMode('current')).toBe('current');
  });

  it('accepts the deterministic mode only for the exact string', () => {
    expect(resolveLessonFlowMode('deterministic_steps')).toBe('deterministic_steps');
    expect(resolveLessonFlowMode('DETERMINISTIC_STEPS')).toBe('current');
  });
});
