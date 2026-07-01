// ── Teacher Harness — scenario loading ───────────────────────────────
//
// A scenario is a scripted learner session: which course/unit, which provider
// and freedom mode, and an ordered list of learner turns each carrying the
// behaviours we expect (and forbid) in the tutor's reply. This module reads and
// structurally checks scenario JSON so the runner can trust its shape.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { FreedomMode } from '../../../src/tutor-runtime/tutor-runtime.types';
import { HARNESS_ROOT } from '../config/harness-config';
import type { CourseSource } from './load-course-package';

/** One scripted learner turn plus the behaviour contract for the reply. */
export interface ScenarioTurn {
  id: string;
  learnerMessage: string;
  /** Behaviour labels the tutor reply SHOULD satisfy. */
  expectedBehaviors: string[];
  /** Behaviour labels the tutor reply MUST NOT exhibit. */
  forbiddenBehaviors: string[];
}

export interface Scenario {
  id: string;
  title: string;
  course: CourseSource;
  unitId: string;
  freedomMode: FreedomMode;
  /** Provider hint from the scenario ("mock" | "openai-compatible"). */
  provider?: string;
  description?: string;
  turns: ScenarioTurn[];
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function parseCourse(raw: unknown, scenarioPath: string): CourseSource {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${scenarioPath}: "course" must be an object.`);
  }
  const c = raw as Record<string, unknown>;
  const source = c.source === 'id' ? 'id' : 'file';
  const courseId = typeof c.courseId === 'string' ? c.courseId : undefined;
  const path = typeof c.path === 'string' ? c.path : undefined;

  if (source === 'file') {
    if (!path) throw new Error(`${scenarioPath}: course.source "file" requires "path".`);
    return { source: 'file', path, courseId };
  }
  if (!courseId) throw new Error(`${scenarioPath}: course.source "id" requires "courseId".`);
  return { source: 'id', courseId, path };
}

const FREEDOM_MODES: readonly FreedomMode[] = ['strict', 'guided', 'open'];

/** Read + validate a scenario file. Throws on any structural problem. */
export function loadScenario(scenarioPath: string): { scenario: Scenario; sourcePath: string } {
  const abs = isAbsolute(scenarioPath) ? scenarioPath : resolve(process.cwd(), scenarioPath);
  if (!existsSync(abs)) throw new Error(`Scenario file not found: ${abs}`);

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (err) {
    throw new Error(`Scenario at ${abs} is not valid JSON: ${(err as Error).message}`);
  }

  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${abs}: scenario must be a JSON object.`);
  }
  const s = raw as Record<string, unknown>;

  if (typeof s.id !== 'string' || !s.id) throw new Error(`${abs}: scenario needs a non-empty "id".`);
  if (typeof s.unitId !== 'string' || !s.unitId) throw new Error(`${abs}: scenario needs "unitId".`);
  if (!Array.isArray(s.turns) || s.turns.length === 0) {
    throw new Error(`${abs}: scenario needs a non-empty "turns" array.`);
  }

  const freedomMode: FreedomMode = FREEDOM_MODES.includes(s.freedomMode as FreedomMode)
    ? (s.freedomMode as FreedomMode)
    : 'guided';

  const turns: ScenarioTurn[] = s.turns.map((t, i) => {
    if (typeof t !== 'object' || t === null) throw new Error(`${abs}: turns[${i}] must be an object.`);
    const turn = t as Record<string, unknown>;
    if (typeof turn.learnerMessage !== 'string' || !turn.learnerMessage) {
      throw new Error(`${abs}: turns[${i}] needs a "learnerMessage".`);
    }
    return {
      id: typeof turn.id === 'string' ? turn.id : `turn-${i + 1}`,
      learnerMessage: turn.learnerMessage,
      expectedBehaviors: asStringArray(turn.expectedBehaviors),
      forbiddenBehaviors: asStringArray(turn.forbiddenBehaviors),
    };
  });

  const scenario: Scenario = {
    id: s.id,
    title: typeof s.title === 'string' ? s.title : s.id,
    course: parseCourse(s.course, abs),
    unitId: s.unitId,
    freedomMode,
    provider: typeof s.provider === 'string' ? s.provider : undefined,
    description: typeof s.description === 'string' ? s.description : undefined,
    turns,
  };

  return { scenario, sourcePath: abs };
}
