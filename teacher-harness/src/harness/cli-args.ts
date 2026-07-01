// ── Teacher Harness — CLI argument parsing ───────────────────────────
//
// Tiny, dependency-free flag parser. Supports the commands the harness needs:
//   run    --scenario <path> [--mock]
//   batch  --scenarios <dir>  [--mock]
//   report --run <runs-dir>
//
// Kept minimal on purpose; if the surface grows, swap in a real arg library.

export type Command = 'run' | 'batch' | 'report';

export interface CliArgs {
  command: Command;
  /** Path to a single scenario file (run). */
  scenario?: string;
  /** Directory of scenario files (batch). */
  scenariosDir?: string;
  /** Directory of run artifacts (report). */
  runsDir?: string;
  /** Force the offline mock provider regardless of env/scenario. */
  mock: boolean;
}

const COMMANDS: readonly Command[] = ['run', 'batch', 'report'];

function readFlag(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) return undefined;
  return value;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const [rawCommand, ...rest] = argv;
  const command = COMMANDS.includes(rawCommand as Command) ? (rawCommand as Command) : undefined;
  if (!command) {
    throw new Error(
      `Unknown or missing command "${rawCommand ?? ''}". Usage:\n` +
        '  run    --scenario <path> [--mock]\n' +
        '  batch  --scenarios <dir> [--mock]\n' +
        '  report --run <runs-dir>',
    );
  }

  return {
    command,
    scenario: readFlag(rest, '--scenario'),
    scenariosDir: readFlag(rest, '--scenarios'),
    runsDir: readFlag(rest, '--run'),
    mock: rest.includes('--mock'),
  };
}
