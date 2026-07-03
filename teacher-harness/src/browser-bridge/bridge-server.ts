// ── Teacher Harness — WebLLM browser bridge ──────────────────────────
//
// The smallest possible runner for the REAL on-device models: WebLLM only
// executes inside a browser with WebGPU, so this module starts a tiny local
// HTTP server that (a) serves a self-driving page which loads the actual
// WebLLM model, and (b) exposes that page to the harness as a plain
// ModelProvider via a long-poll job queue:
//
//   harness generateText() → enqueue job ──▶ GET /job   (page long-polls)
//   harness result promise ◀── resolve  ──  POST /result (page posts answer)
//
// The port comes from the caller (default 5201, see model-targets.ts). WebLLM
// caches weights per browser origin, so re-runs on the same port skip the
// download (~2.2 GB for Llama 3.2 3B). Generation params mirror the app's
// local runtime (temperature 0.7).
//
// Dependency-free on purpose; sockets/timers are unref'd so a finished
// evaluation process can exit even though the server object still exists.

import { createServer, type Server, type ServerResponse } from 'node:http';
import type { GenerateTextArgs, ModelProvider } from '../model/model-provider.types';

const LONG_POLL_MS = 20_000;

/**
 * Per-job timeout. Default 900s (generous — a normal on-device generation is
 * 5–15s; the wide margin tolerates a large first prompt or a briefly throttled
 * background tab). Override with TEACHER_HARNESS_BRIDGE_JOB_TIMEOUT_MS.
 */
function jobTimeoutMs(): number {
  const raw = Number(process.env.TEACHER_HARNESS_BRIDGE_JOB_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 900_000;
}

/** How long generateText waits for the browser to attach + load the model. */
function readyTimeoutMs(): number {
  const raw = Number(process.env.TEACHER_HARNESS_BRIDGE_READY_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 20 * 60_000;
}

interface BridgeJob {
  id: number;
  system: string;
  prompt: string;
  maxTokens: number;
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface WebllmBridge {
  provider: ModelProvider;
  url: string;
  close(): void;
}

function pageHtml(params: { webllmModelId: string; label: string; sessionId: string }): string {
  // Kept as one template string so the whole runner stays in this file. The
  // page is fully self-driving: load model → report ready → long-poll jobs.
  //
  // The page carries the run's SESSION ID (embedded below + also read from its
  // own ?s= query) and tags every request with it. The server rejects requests
  // whose session id does not match the current run, so a stale tab left over
  // from a previous run can never attach to (or steal jobs from) a new run.
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Teacher Harness — WebLLM bridge</title>
<style>body{font-family:system-ui;margin:2rem;max-width:44rem}#log{white-space:pre-wrap;color:#333;font-size:.9rem}
.sid{color:#888;font-size:.8rem}</style>
</head><body>
<h2>Teacher Harness — WebLLM bridge</h2>
<p>Model: <b>${params.label}</b> (<code>${params.webllmModelId}</code>)</p>
<p class="sid">session: <code>${params.sessionId}</code></p>
<p>Leave this tab open. It loads the real on-device model and serves evaluation turns to the CLI.</p>
<div id="log">starting…</div>
<script type="module">
const SESSION = new URLSearchParams(location.search).get('s') || '${params.sessionId}';
const logEl = document.getElementById('log');
const lines = [];
function show(t){ lines.push(t); if (lines.length > 14) lines.shift(); logEl.textContent = lines.join('\\n'); }
function withSession(path){ return path + (path.includes('?') ? '&' : '?') + 's=' + encodeURIComponent(SESSION); }
async function post(path, body){ try { await fetch(withSession(path), {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...body, session: SESSION })}); } catch {} }
async function status(type, text){ show(text); await post('/status', {type, text}); }

try {
  if (!navigator.gpu) {
    await status('fatal', 'WebGPU is NOT available in this browser — the real model cannot run here.');
    throw new Error('no webgpu');
  }
  await status('loading', 'importing @mlc-ai/web-llm…');
  const webllm = await import('https://esm.run/@mlc-ai/web-llm');
  await status('loading', 'loading ${params.webllmModelId} (cached weights are reused; first download is ~2 GB)…');
  const engine = await webllm.CreateMLCEngine('${params.webllmModelId}', {
    initProgressCallback: (p) => { show(p.text); post('/status', {type:'progress', text: p.text}); },
  });
  await status('ready', 'model loaded — serving evaluation turns.');

  let done = 0;
  while (true) {
    let res;
    try { res = await fetch(withSession('/job')); } catch { await new Promise(r=>setTimeout(r,1000)); continue; }
    if (res.status === 204) continue;           // long-poll cycle, no job yet
    if (res.status === 410) { show('bridge closed by CLI — done.'); break; }
    if (res.status === 409) { show('stale session — a newer bridge run replaced this tab. Stopping; you can close this tab.'); break; }
    if (!res.ok) { await new Promise(r=>setTimeout(r,1000)); continue; }
    const job = await res.json();
    try {
      await post('/status', { type:'generating', jobId: job.id });
      const out = await engine.chat.completions.create({
        messages: [
          ...(job.system ? [{ role: 'system', content: job.system }] : []),
          { role: 'user', content: job.prompt },
        ],
        max_tokens: job.maxTokens,
        temperature: 0.7,
      });
      done += 1;
      show('turn ' + done + ' done (' + (out.usage?.completion_tokens ?? '?') + ' tokens)');
      await post('/result', { id: job.id, text: out.choices?.[0]?.message?.content ?? '' });
    } catch (e) {
      await post('/result', { id: job.id, error: String(e) });
    }
  }
} catch (e) {
  show('fatal: ' + e);
}
</script></body></html>`;
}

function readBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Start the bridge and return a ModelProvider whose generateText runs on the
 * REAL WebLLM model in whichever WebGPU browser opens `url`.
 */
export function startWebllmBridge(params: {
  webllmModelId: string;
  label: string;
  port: number;
  /**
   * Unique per-run id. Embedded in the page URL (?s=…) and required on every
   * /job, /result and /status request; requests with any other id are rejected
   * so a stale tab from a previous run can never attach to this run.
   */
  sessionId: string;
  onStatus?: (text: string) => void;
}): WebllmBridge {
  const { webllmModelId, label, port, sessionId, onStatus } = params;

  let nextJobId = 1;
  const queue: BridgeJob[] = [];
  const inFlight = new Map<number, BridgeJob>();
  let waitingPoll: ServerResponse | null = null;
  let closed = false;
  // One-shot lifecycle flags so each milestone is logged exactly once.
  let browserConnected = false;
  let loadingLogged = false;

  let readyResolve: () => void;
  let readyReject: (err: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  ready.catch(() => {}); // observed via generateText; avoid unhandled-rejection noise

  let browserSeen = false;

  function dispatch(): void {
    if (!waitingPoll || queue.length === 0) return;
    const job = queue.shift() as BridgeJob;
    inFlight.set(job.id, job);
    const res = waitingPoll;
    waitingPoll = null;
    onStatus?.(`▶ dispatched job #${job.id} to the browser (${job.prompt.length} prompt chars)`);
    sendJson(res, 200, { id: job.id, system: job.system, prompt: job.prompt, maxTokens: job.maxTokens });
  }

  const server: Server = createServer(async (req, res) => {
    const rawUrl = req.url ?? '/';
    const parsed = new URL(rawUrl, `http://localhost:${port}`);
    const path = parsed.pathname;
    const querySession = parsed.searchParams.get('s');

    if (req.method === 'GET' && (path === '/' || path.startsWith('/index'))) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(pageHtml({ webllmModelId, label, sessionId }));
      return;
    }
    if (req.method === 'GET' && path === '/job') {
      if (closed) return sendJson(res, 410, { closed: true });
      // Reject a stale tab (wrong/absent session id) so it stops polling and
      // never steals a job meant for this run's tab.
      if (querySession !== sessionId) {
        onStatus?.(`✗ rejected /job from a stale tab (session "${querySession ?? 'none'}" ≠ "${sessionId}")`);
        return sendJson(res, 409, { staleSession: true, expected: sessionId });
      }
      if (!browserConnected) {
        browserConnected = true;
        onStatus?.(`browser connected + polling /job (session ${sessionId})`);
      }
      // A page only polls for jobs once its model is loaded, so a poll is an
      // implicit ready signal (covers a page that loaded while a previous
      // server process on this port was down and missed the 'ready' POST).
      if (!browserSeen) {
        browserSeen = true;
        onStatus?.('model ready — browser is serving jobs');
      }
      readyResolve();
      // Only one page should serve jobs; a newer poll replaces the older one.
      if (waitingPoll) sendJson(waitingPoll, 204, {});
      waitingPoll = res;
      const timer = setTimeout(() => {
        if (waitingPoll === res) {
          waitingPoll = null;
          sendJson(res, 204, {});
        }
      }, LONG_POLL_MS);
      timer.unref();
      res.on('close', () => {
        clearTimeout(timer);
        if (waitingPoll === res) waitingPoll = null;
      });
      dispatch();
      return;
    }
    if (req.method === 'POST' && path === '/result') {
      const body = JSON.parse((await readBody(req)) || '{}') as { id?: number; text?: string; error?: string; session?: string };
      if (body.session !== sessionId) return sendJson(res, 409, { staleSession: true });
      const job = body.id !== undefined ? inFlight.get(body.id) : undefined;
      if (job) {
        inFlight.delete(job.id);
        clearTimeout(job.timer);
        if (typeof body.text === 'string' && !body.error) {
          onStatus?.(`✓ generation completed + result posted for job #${job.id} (${body.text.length} chars)`);
          job.resolve(body.text);
        } else {
          onStatus?.(`✗ job #${job.id} failed: ${body.error ?? 'empty reply'}`);
          job.reject(new Error(`WebLLM bridge generation failed: ${body.error ?? 'empty reply'}`));
        }
      }
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && path === '/status') {
      const body = JSON.parse((await readBody(req)) || '{}') as {
        type?: string;
        text?: string;
        session?: string;
        jobId?: number;
      };
      if (body.session !== sessionId) return sendJson(res, 409, { staleSession: true });
      if (!browserConnected) {
        browserConnected = true;
        onStatus?.(`browser connected (session ${sessionId})`);
      }
      if ((body.type === 'loading' || body.type === 'progress') && !loadingLogged) {
        loadingLogged = true;
        onStatus?.('model loading started (importing WebLLM + fetching/compiling weights)…');
      }
      if (body.type === 'generating') {
        onStatus?.(`generation started for job #${body.jobId ?? '?'}`);
      } else {
        onStatus?.(`${body.type ?? 'status'}: ${body.text ?? ''}`);
      }
      if (body.type === 'ready') {
        onStatus?.('model ready (browser reported load complete)');
        readyResolve();
      }
      if (body.type === 'fatal') readyReject(new Error(body.text ?? 'browser reported a fatal error'));
      sendJson(res, 200, { ok: true });
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  });

  // The server DOES hold the event loop open while the evaluation runs (the
  // whole run depends on it); commandEvaluate shuts it down via close() when
  // the matrix is done, which is what lets the process exit.
  server.listen(port, () => {
    onStatus?.(`bridge server started on port ${port} (session ${sessionId}) — waiting for a WebGPU browser to attach`);
  });
  server.on('error', (err) => {
    onStatus?.(`fatal: bridge server failed on port ${port}: ${err.message} (is something else using this port?)`);
    readyReject(new Error(`bridge server failed on port ${port}: ${err.message}`));
  });

  const url = `http://localhost:${port}/?s=${encodeURIComponent(sessionId)}`;

  async function awaitReady(): Promise<void> {
    const timeout = new Promise<never>((_, reject) => {
      const t = setTimeout(
        () =>
          reject(
            new Error(
              `No WebGPU browser attached to the bridge within ${Math.round(readyTimeoutMs() / 60000)} min. ` +
                `Open ${url} in Chrome/Edge (WebGPU required) and re-run.`,
            ),
          ),
        readyTimeoutMs(),
      );
      t.unref();
    });
    await Promise.race([ready, timeout]);
  }

  const provider: ModelProvider = {
    name: 'webllm-bridge',
    modelName: webllmModelId,
    async generateText(args: GenerateTextArgs): Promise<string> {
      if (closed) throw new Error('bridge is closed');
      await awaitReady();
      const timeoutMs = jobTimeoutMs();
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          inFlight.delete(job.id);
          onStatus?.(
            `✗ job #${job.id} timed out after ${timeoutMs / 1000}s — the browser tab did not return a result ` +
              '(is the bridge tab still open and visible?)',
          );
          reject(new Error(`WebLLM bridge job timed out after ${timeoutMs / 1000}s.`));
        }, timeoutMs);
        timer.unref();
        const job: BridgeJob = {
          id: nextJobId++,
          system: args.system ?? '',
          prompt: args.prompt,
          maxTokens: 800,
          resolve: (t) => { clearTimeout(timer); resolve(t); },
          reject: (e) => { clearTimeout(timer); reject(e); },
          timer,
        };
        queue.push(job);
        if (!waitingPoll) onStatus?.(`job #${job.id} queued — waiting for the browser tab at ${url} to poll…`);
        dispatch();
      });
    },
  };

  return {
    provider,
    url,
    close() {
      if (closed) return;
      closed = true;
      onStatus?.(`bridge closed by CLI (session ${sessionId})`);
      if (waitingPoll) sendJson(waitingPoll, 410, { closed: true });
      server.close();
      server.closeAllConnections();
    },
  };
}
