// ── CLI argument parsing ──────────────────────────────────────────────

export type Command = 'plan' | 'generate' | 'validate' | 'repair' | 'register' | 'preview';

export interface CliArgs {
  command: Command;
  /** --input <folder> (plan / generate) */
  input?: string;
  /** --file <path> (validate / repair / register / preview) */
  file?: string;
  /** --mock: force the mock provider regardless of .env */
  mock: boolean;
  /** --overwrite: allow register to replace an existing course file/entry */
  overwrite: boolean;
  /** --preview: also write a human-readable <id>.preview.md (generate) */
  preview: boolean;
}

const COMMANDS: readonly Command[] = ['plan', 'generate', 'validate', 'repair', 'register', 'preview'];

export function parseCliArgs(argv: string[]): CliArgs {
  const [command, ...rest] = argv;
  if (!command || !COMMANDS.includes(command as Command)) {
    throw new Error(
      `Unknown or missing command "${command ?? ''}". Use one of: ${COMMANDS.join(', ')}.\n` +
        'Examples:\n' +
        '  npm run plan     -- --input inputs/example-course\n' +
        '  npm run generate -- --input inputs/example-course\n' +
        '  npm run validate -- --file output/example-course.final.json\n' +
        '  npm run repair   -- --file output/example-course.final.json\n' +
        '  npm run register -- --file output/example-course.final.json\n' +
        '  npm run preview  -- --file output/example-course.final.json',
    );
  }

  const args: CliArgs = { command: command as Command, mock: false, overwrite: false, preview: false };
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    switch (token) {
      case '--input':
        args.input = rest[++i];
        break;
      case '--file':
        args.file = rest[++i];
        break;
      case '--mock':
        args.mock = true;
        break;
      case '--overwrite':
        args.overwrite = true;
        break;
      case '--preview':
        args.preview = true;
        break;
      default:
        throw new Error(`Unrecognized argument: "${token}".`);
    }
  }
  return args;
}
