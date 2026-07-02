// ── Teacher Harness — CLI argument parsing ───────────────────────────
//
// Tiny, dependency-free flag parser. Supports the commands the harness needs:
//   run    --scenario <path> [--mock] [--reset-memory]
//   batch  --scenarios <dir>  [--mock] [--reset-memory]
//   report --run <runs-dir>
//   memory --delete --run <run-dir>     delete ONLY memory artifacts of a run
//
// Kept minimal on purpose; if the surface grows, swap in a real arg library.

export type Command = 'run' | 'batch' | 'report' | 'memory';

export interface CliArgs {
  command: Command;
  /** Path to a single scenario file (run). */
  scenario?: string;
  /** Directory of scenario files (batch). */
  scenariosDir?: string;
  /** Directory of run artifacts (report) or a single run dir (memory). */
  runsDir?: string;
  /** Force the offline mock provider regardless of env/scenario. */
  mock: boolean;
  /**
   * Explicitly start from fresh lesson memory and record that in the run
   * (memory is ALWAYS fresh per run in the MVP; this flag documents it as an
   * artifact so the run is self-describing).
   */
  resetMemory: boolean;
  /** memory command: actually delete memory artifacts (safety switch). */
  delete: boolean;
}

const COMMANDS: readonly Command[] = ['run', 'batch', 'report', 'memory'];

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
        '  run    --scenario <path> [--mock] [--reset-memory]\n' +
        '  batch  --scenarios <dir> [--mock] [--reset-memory]\n' +
        '  report --run <runs-dir>\n' +
        '  memory --delete --run <run-dir>',
    );
  }

  return {
    command,
    scenario: readFlag(rest, '--scenario'),
    scenariosDir: readFlag(rest, '--scenarios'),
    runsDir: readFlag(rest, '--run'),
    mock: rest.includes('--mock'),
    resetMemory: rest.includes('--reset-memory'),
    delete: rest.includes('--delete'),
  };
}
