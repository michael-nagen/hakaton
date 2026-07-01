// ── Lesson Runtime — progress persistence ────────────────────────────
//
// Isolated persistence layer for lesson progress. localStorage today (matching
// how AiProviderContext and local-model-state already persist on-device), but
// deliberately kept behind a small module so it can move to a backend later
// without touching the runtime, the hook, or the pages.
//
// Stored value === the full LessonSessionState, which already carries everything
// the spec requires: courseId, unitId, current step (index + stepIds),
// completedStepIds, messages, attemptsByStep, levelEstimate, status.

import type { LearningUnit } from '../course-package';
import type { LessonSessionState, LessonStatus } from './lesson-state';

const PREFIX = 'maestro.progress';

function keyFor(courseId: string, unitId: string): string {
  return `${PREFIX}.${courseId}.${unitId}`;
}

/** Load persisted state for a single lesson, or null if none/unreadable. */
export function loadProgress(params: {
  courseId: string;
  unitId: string;
}): LessonSessionState | null {
  try {
    const raw = localStorage.getItem(keyFor(params.courseId, params.unitId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LessonSessionState;
    // Minimal shape guard — treat anything malformed as "no progress".
    if (!parsed || parsed.courseId !== params.courseId || parsed.unitId !== params.unitId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Persist state for a single lesson. Non-fatal on failure. */
export function saveProgress(state: LessonSessionState): void {
  try {
    localStorage.setItem(keyFor(state.courseId, state.unitId), JSON.stringify(state));
  } catch {
    // Non-fatal: state still lives in memory for this session.
  }
}

/** Remove persisted state for a single lesson. */
export function clearProgress(params: { courseId: string; unitId: string }): void {
  try {
    localStorage.removeItem(keyFor(params.courseId, params.unitId));
  } catch {
    // ignore
  }
}

export interface LessonProgressSummary {
  status: LessonStatus;
  completedStepCount: number;
}

/** Per-unit status rollup for rendering lesson cards / course progress. */
export function loadCourseProgress(params: {
  courseId: string;
  units: LearningUnit[];
}): Record<string, LessonProgressSummary> {
  const summary: Record<string, LessonProgressSummary> = {};
  for (const unit of params.units) {
    const persisted = loadProgress({ courseId: params.courseId, unitId: unit.id });
    summary[unit.id] = {
      status: persisted?.status ?? 'not_started',
      completedStepCount: persisted?.completedStepIds.length ?? 0,
    };
  }
  return summary;
}
