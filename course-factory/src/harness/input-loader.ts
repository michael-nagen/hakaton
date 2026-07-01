// ── Input loader ──────────────────────────────────────────────────────
//
// Reads the three markdown files that describe a course. `brief.md` is
// required; the others are optional but strongly recommended. Fails clearly.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

export interface CourseInput {
  /** Absolute path to the input folder. */
  dir: string;
  /** Folder name, used to seed the run id. */
  name: string;
  brief: string;
  rawUnits: string;
  sourceMaterials: string;
}

// The factory sends inputs to the model WHOLE (no chunking / RAG). Warn — but do
// not block — once combined inputs get large enough to risk context limits.
const WARN_CHARS = 150_000; // ~40k tokens at ~4 chars/token

export interface InputSizeWarning {
  totalChars: number;
  approxTokens: number;
  message: string;
}

/**
 * Estimate combined input size. Returns a warning when it's large enough to risk
 * exceeding the model's context window (the factory does no chunking). Never throws.
 */
export function checkInputSize(input: CourseInput): InputSizeWarning | null {
  const totalChars = input.brief.length + input.rawUnits.length + input.sourceMaterials.length;
  if (totalChars <= WARN_CHARS) return null;
  const approxTokens = Math.round(totalChars / 4);
  return {
    totalChars,
    approxTokens,
    message:
      `Large input: ~${Math.round(totalChars / 1000)} KB (~${approxTokens} tokens). ` +
      'The factory sends documents whole (no chunking/RAG), so this may exceed the ' +
      "model's context window or be truncated. Consider splitting into smaller " +
      'courses or trimming source-materials.md.',
  };
}

function readOptional(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

export function loadCourseInput(inputPath: string | undefined): CourseInput {
  if (!inputPath) throw new Error('Missing --input <folder>. Example: --input inputs/example-course');

  const dir = resolve(process.cwd(), inputPath);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`Input folder not found: ${dir}`);
  }

  const briefPath = resolve(dir, 'brief.md');
  if (!existsSync(briefPath)) {
    throw new Error(`Required file missing: ${briefPath}\nEvery input folder needs at least a brief.md.`);
  }

  return {
    dir,
    name: basename(dir),
    brief: readFileSync(briefPath, 'utf8'),
    rawUnits: readOptional(resolve(dir, 'raw-units.md')),
    sourceMaterials: readOptional(resolve(dir, 'source-materials.md')),
  };
}
