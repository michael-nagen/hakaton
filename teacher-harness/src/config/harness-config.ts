// ── Teacher Harness — configuration ──────────────────────────────────
//
// Resolves runtime config from (in priority order): CLI flags, environment
// variables, then a local `.env` file. Also holds the small course-id → path
// registry the harness uses to support "load by registered course id" on top
// of the primary "load by file path" flow.
//
// Dependency-free on purpose: a tiny .env reader keeps the harness install
// light and avoids adding a runtime dependency just to read four keys.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProviderConfig, ProviderMode } from '../model/model-provider.types';

/** Absolute path to the teacher-harness project root (one level above src/). */
export const HARNESS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Registry mapping a registered course id to a CoursePackage file, resolved
 * relative to HARNESS_ROOT. File-path loading is the primary path; this exists
 * so scenarios can also say `"source": "id"` for known courses. Extend freely.
 */
export const COURSE_REGISTRY: Readonly<Record<string, string>> = {
  'course-python-print-101': '../course-factory/output/course-python-print-101.final.json',
  'course-js-promises-101': 'fixtures/course-js-promises-101.json',
};

/** Parse a minimal KEY=VALUE .env file. Ignores comments and blank lines. */
function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip surrounding quotes if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/** Read a value from process.env first, then the .env file. */
function readValue(env: Record<string, string>, key: string): string | undefined {
  const fromProcess = process.env[key];
  if (fromProcess !== undefined && fromProcess !== '') return fromProcess;
  const fromFile = env[key];
  return fromFile !== undefined && fromFile !== '' ? fromFile : undefined;
}

/**
 * Read a single config value from process.env, then the HARNESS_ROOT/.env file.
 * Public helper so other modules (e.g. the LLM judge) can read their own env
 * keys with the same process-env-then-.env precedence, without printing values.
 */
export function readHarnessEnvValue(key: string): string | undefined {
  return readValue(parseEnvFile(resolve(HARNESS_ROOT, '.env')), key);
}

/**
 * Resolve the provider configuration.
 *
 * Precedence for the mode (highest first):
 *   1. `--mock` (forceMock) — always the offline mock
 *   2. TEACHER_HARNESS_PROVIDER — a global override so you can point every
 *      scenario at a real model without editing scenario files
 *   3. the scenario file's own `provider` — a per-scenario default
 *   4. "mock"
 */
export function resolveProviderConfig(params?: {
  forceMock?: boolean;
  scenarioProvider?: string;
}): ProviderConfig {
  const env = parseEnvFile(resolve(HARNESS_ROOT, '.env'));

  const rawMode = params?.forceMock
    ? 'mock'
    : readValue(env, 'TEACHER_HARNESS_PROVIDER') ?? params?.scenarioProvider ?? 'mock';

  const mode: ProviderMode = rawMode === 'openai-compatible' ? 'openai-compatible' : 'mock';

  return {
    mode,
    model: readValue(env, 'TEACHER_HARNESS_MODEL'),
    apiKey: readValue(env, 'TEACHER_HARNESS_API_KEY'),
    baseUrl: readValue(env, 'TEACHER_HARNESS_BASE_URL'),
  };
}
