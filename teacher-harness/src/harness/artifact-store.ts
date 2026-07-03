// ── Teacher Harness — artifact store ─────────────────────────────────
//
// Everything a run produces lands on disk so failures are debuggable end to
// end: the exact course snapshot, the unit, and per turn the context, prompt,
// response, debug, and score. Layout (under teacher-harness/runs/<runId>/):
//
//   scenario.json  course-package.snapshot.json  unit.snapshot.json
//   turn-1/ { context.json prompt.txt response.txt debug.json score.json
//             memory.working.json  memory.archive.json }
//   ...
//   lesson-memory.final.json
//   scenario-report.json  scenario-report.md

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HARNESS_ROOT } from '../config/harness-config';

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(path: string, value: string): void {
  writeFileSync(path, value.endsWith('\n') ? value : `${value}\n`, 'utf8');
}

/** Filesystem-safe id fragment. */
function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

export class ArtifactStore {
  readonly runDir: string;

  constructor(params: { scenarioId: string; timestamp: string }) {
    const runId = `${slug(params.scenarioId)}__${slug(params.timestamp)}`;
    this.runDir = resolve(HARNESS_ROOT, 'runs', runId);
    mkdirSync(this.runDir, { recursive: true });
  }

  /** Persist the inputs to the run: scenario, full course, and target unit. */
  writeInputs(params: { scenario: unknown; coursePackage: unknown; unit: unknown }): void {
    writeJson(resolve(this.runDir, 'scenario.json'), params.scenario);
    writeJson(resolve(this.runDir, 'course-package.snapshot.json'), params.coursePackage);
    writeJson(resolve(this.runDir, 'unit.snapshot.json'), params.unit);
  }

  /** Persist a small run-metadata block (provider, model, memory mode, ...). */
  writeRunMetadata(meta: Record<string, unknown>): void {
    writeJson(resolve(this.runDir, 'run-metadata.json'), meta);
  }

  /** Persist all artifacts for a single turn under turn-<n>/. */
  writeTurn(params: {
    index: number;
    context: unknown;
    systemPrompt: string;
    userPrompt: string;
    response: string;
    debug: unknown;
    score: unknown;
    /** Compact working memory (what the model gets) after this turn. */
    workingMemory?: unknown;
    /** Full conversation archive after this turn. */
    archiveMemory?: unknown;
    /**
     * The EXACT memory block appended to the system prompt this turn (per the
     * selected memory mode). Saved verbatim so we can verify each mode really
     * sends different memory and that the full archive is never sent.
     */
    memorySentToModel?: string;
    /** The prompt-variant instruction preamble used this turn (the part that varies). */
    promptVariantInstructions?: string;
  }): void {
    const dir = resolve(this.runDir, `turn-${params.index}`);
    mkdirSync(dir, { recursive: true });
    writeJson(resolve(dir, 'context.json'), params.context);
    writeText(
      resolve(dir, 'prompt.txt'),
      `===== SYSTEM =====\n${params.systemPrompt}\n\n===== USER =====\n${params.userPrompt}`,
    );
    writeText(resolve(dir, 'response.txt'), params.response);
    writeJson(resolve(dir, 'debug.json'), params.debug);
    writeJson(resolve(dir, 'score.json'), params.score);
    if (params.workingMemory !== undefined) writeJson(resolve(dir, 'memory.working.json'), params.workingMemory);
    if (params.archiveMemory !== undefined) writeJson(resolve(dir, 'memory.archive.json'), params.archiveMemory);
    if (params.memorySentToModel !== undefined) {
      writeText(
        resolve(dir, 'memory.sent-to-model.txt'),
        params.memorySentToModel === ''
          ? '(no memory sent to the model this turn — memory mode "no_memory" or no prior memory)'
          : params.memorySentToModel,
      );
    }
    if (params.promptVariantInstructions !== undefined) {
      writeText(resolve(dir, 'prompt-variant.txt'), params.promptVariantInstructions);
    }
  }

  /** Persist the finalised lesson session memory (working + archive). */
  writeFinalMemory(memory: unknown): void {
    writeJson(resolve(this.runDir, 'lesson-memory.final.json'), memory);
  }

  /**
   * Record that this run explicitly started from fresh lesson memory
   * (--reset-memory). Memory is per-run in the MVP anyway; this artifact makes
   * the run self-describing.
   */
  writeMemoryReset(): void {
    writeJson(resolve(this.runDir, 'memory-reset.json'), {
      memoryMode: 'fresh',
      resetRequested: true,
      scope: 'lesson_session',
      note: 'Lesson memory is per-run in MVP. This run started from empty memory.',
    });
  }

  writeScenarioReport(params: { json: unknown; markdown: string }): void {
    writeJson(resolve(this.runDir, 'scenario-report.json'), params.json);
    writeText(resolve(this.runDir, 'scenario-report.md'), params.markdown);
  }
}
