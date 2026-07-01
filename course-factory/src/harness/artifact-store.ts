// ── Artifact store ────────────────────────────────────────────────────
//
// Every run gets its own folder under runs/. All intermediate artifacts and
// raw model responses land there so a failed step is fully debuggable. Also
// owns run.log. Never logs API keys (callers must not pass secrets in).

import { appendFileSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'course';
}

/** `YYYY-MM-DD-HHMMSS` from the current time. */
function timestamp(): string {
  const iso = new Date().toISOString(); // 2026-07-01T10:30:00.000Z
  return `${iso.slice(0, 10)}-${iso.slice(11, 19).replace(/:/g, '')}`;
}

export class ArtifactStore {
  readonly runDir: string;
  private readonly logPath: string;

  constructor(params: { runsRoot: string; label: string }) {
    this.runDir = resolve(params.runsRoot, `${timestamp()}-${slugify(params.label)}`);
    mkdirSync(this.runDir, { recursive: true });
    this.logPath = resolve(this.runDir, 'run.log');
  }

  /** Copy the raw input markdown files into 00-input/ for provenance. */
  copyInputs(files: { name: string; content: string }[]): void {
    const inputDir = resolve(this.runDir, '00-input');
    mkdirSync(inputDir, { recursive: true });
    for (const f of files) writeFileSync(resolve(inputDir, f.name), f.content, 'utf8');
  }

  /** Copy an existing file into the run folder under 00-input/. */
  copyInputFile(sourcePath: string, destName: string): void {
    const inputDir = resolve(this.runDir, '00-input');
    mkdirSync(inputDir, { recursive: true });
    if (existsSync(sourcePath)) copyFileSync(sourcePath, resolve(inputDir, destName));
  }

  saveJson(name: string, value: unknown): string {
    const path = resolve(this.runDir, name);
    writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
    return path;
  }

  saveRaw(name: string, text: string): string {
    const path = resolve(this.runDir, name);
    writeFileSync(path, text, 'utf8');
    return path;
  }

  log(message: string): void {
    const line = `[${new Date().toISOString()}] ${message}`;
    appendFileSync(this.logPath, `${line}\n`, 'utf8');
    // Mirror to console so a live run is followable.
    console.log(line);
  }
}
