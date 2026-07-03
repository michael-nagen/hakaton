// ── Teacher Harness — CLI argument parsing ───────────────────────────
//
// Tiny, dependency-free flag parser. Supports the commands the harness needs:
//   run    --scenario <path> [--mock] [--reset-memory]
//   batch  --scenarios <dir>  [--mock] [--reset-memory]
//   report --run <runs-dir>
//   memory --delete --run <run-dir>     delete ONLY memory artifacts of a run
//
// Kept minimal on purpose; if the surface grows, swap in a real arg library.

export type Command =
  | 'run'
  | 'batch'
  | 'report'
  | 'memory'
  | 'evaluate'
  | 'evaluate-lesson-variants'
  | 'evaluate-memory'
  | 'evaluate-prompts'
  | 'evaluate-judge'
  | 'evaluate-real-course'
  | 'config';

export interface CliArgs {
  command: Command;
  /** Path to a single scenario file (run, evaluate). */
  scenario?: string;
  /** Directory of scenario files (batch, evaluate). */
  scenariosDir?: string;
  /** Directory of run artifacts (report) or a single run dir (memory). */
  runsDir?: string;
  /** evaluate: model targets — "all" | "mock" | "proxies" | comma-list of ids. */
  models?: string;
  /** evaluate: strategies — "all" | comma-list of strategy ids. */
  strategies?: string;
  /** evaluate: built-in learner profiles — "all" | comma-list of profile ids. */
  profiles?: string;
  /** evaluate: report filename prefix (default "model-strategy-evaluation"). */
  reportPrefix?: string;
  /** run: lesson-memory mode rendered into the prompt (default structured_working_memory). */
  memoryMode?: string;
  /** run: tutor prompt variant rendered into the prompt (default full_current_prompt). */
  promptVariant?: string;
  /** evaluate-real-course: path to a real CoursePackage .final.json (relative to course-factory/output/ or absolute). */
  course?: string;
  /** evaluate-real-course: comma-separated unit ids to test (default: first two units). */
  units?: string;
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

const COMMANDS: readonly Command[] = [
  'run',
  'batch',
  'report',
  'memory',
  'evaluate',
  'evaluate-lesson-variants',
  'evaluate-memory',
  'evaluate-prompts',
  'evaluate-judge',
  'evaluate-real-course',
  'config',
];

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
        '  run      --scenario <path> [--mock] [--reset-memory] [--memory-mode <mode>] [--prompt-variant <v>]\n' +
        '  batch    --scenarios <dir> [--mock] [--reset-memory] [--memory-mode <mode>] [--prompt-variant <v>]\n' +
        '  report   --run <runs-dir>\n' +
        '  memory   --delete --run <run-dir>\n' +
        '  evaluate [--models all|mock|proxies|<ids>] [--strategies all|<ids>]\n' +
        '           [--profiles all|<ids>] [--scenario <path>] [--scenarios <dir>]\n' +
        '  evaluate-lesson-variants   (fixed: Llama 3.2 3B WebLLM + repair_pass; varies CoursePackage variant)\n' +
        '  evaluate-memory            (fixed: Llama 3.2 3B WebLLM + repair_pass + high_very_guided; varies memory mode)\n' +
        '  evaluate-prompts           (fixed baseline; varies tutor prompt variant across 12 learner profiles)\n' +
        '  evaluate-judge             (LLM-judge pass over the top-2 prompt variants; reuses prior tutor outputs)\n' +
        '  evaluate-real-course [--course <path>] [--units <id,id>]  (top-3 validation on a REAL course; real Llama tutor + OpenAI judge)\n' +
        '  config                     (print the resolved locked defaults; no Chrome/WebLLM/OpenAI/eval)',
    );
  }

  return {
    command,
    scenario: readFlag(rest, '--scenario'),
    scenariosDir: readFlag(rest, '--scenarios'),
    runsDir: readFlag(rest, '--run'),
    models: readFlag(rest, '--models'),
    strategies: readFlag(rest, '--strategies'),
    profiles: readFlag(rest, '--profiles'),
    reportPrefix: readFlag(rest, '--report-prefix'),
    memoryMode: readFlag(rest, '--memory-mode'),
    promptVariant: readFlag(rest, '--prompt-variant'),
    course: readFlag(rest, '--course'),
    units: readFlag(rest, '--units'),
    mock: rest.includes('--mock'),
    resetMemory: rest.includes('--reset-memory'),
    delete: rest.includes('--delete'),
  };
}
