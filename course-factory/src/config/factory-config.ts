// ── Factory configuration ────────────────────────────────────────────
//
// Loads provider/model/key config from the environment. We parse a local
// `.env` file ourselves (no dependency) and let real environment variables
// win over file values. API keys are never logged.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type ProviderId = 'mock' | 'openai' | 'anthropic';

export interface FactoryConfig {
  provider: ProviderId;
  model: string;
  apiKey: string;
  baseUrl: string;
}

/** Minimal .env parser: `KEY=value` lines, `#` comments, ignores blanks/quotes. */
function parseDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
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

const KNOWN_PROVIDERS: readonly ProviderId[] = ['mock', 'openai', 'anthropic'];

/**
 * Resolve config from `.env` + process.env. `forceMock` (from the --mock flag)
 * overrides the provider so the harness can always run offline.
 */
export function loadFactoryConfig(options?: { forceMock?: boolean }): FactoryConfig {
  const fileEnv = parseDotEnv(resolve(process.cwd(), '.env'));
  const get = (key: string): string => (process.env[key] ?? fileEnv[key] ?? '').trim();

  let provider = (get('COURSE_FACTORY_PROVIDER') || 'mock') as ProviderId;
  if (options?.forceMock) provider = 'mock';
  if (!KNOWN_PROVIDERS.includes(provider)) {
    throw new Error(
      `COURSE_FACTORY_PROVIDER="${provider}" is not supported. Use one of: ${KNOWN_PROVIDERS.join(', ')}.`,
    );
  }

  return {
    provider,
    model: get('COURSE_FACTORY_MODEL'),
    apiKey: get('COURSE_FACTORY_API_KEY'),
    baseUrl: get('COURSE_FACTORY_BASE_URL'),
  };
}
