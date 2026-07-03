// ── Teacher Harness — evaluation report builder + writer ─────────────
//
// Turns the raw matrix output into the final research report:
// ranking, best-two recommendation, "what hurt tutor quality" cause analysis,
// fix-next list, CoursePackage notes and limitations. All of it is derived
// deterministically from the measured aggregates — no LLM writes this report.
//
// Output: reports/model-strategy-evaluation-<timestamp>.{json,md}

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HARNESS_ROOT } from '../config/harness-config';
import { lockedConfigMetadata } from '../config/locked-config';
import type { EvaluationRunOutput } from './run-evaluation';
import type {
  EvalComboResult,
  EvalRankingRow,
  EvaluationReport,
} from './eval-types';

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** Short human note for a ranking row, derived from its aggregates. */
function comboNotes(combo: EvalComboResult, context: { fastestId: string; safestId: string }): string {
  const parts: string[] = [];
  const key = `${combo.modelTargetId}×${combo.strategy}`;
  if (combo.partial) {
    parts.push(
      `PARTIAL — only ${combo.totals.cases}/${combo.totals.casesExpected} cases ran (provider quota); excluded from recommendations`,
    );
  }
  if (!combo.qualitySignal) parts.push('mechanics baseline, not a quality signal');
  if (key === context.safestId) parts.push('safest');
  if (key === context.fastestId) parts.push('fastest');
  if (combo.rates.futureTopicLeakRate > 0) parts.push(`leaks future topics (${pct(combo.rates.futureTopicLeakRate)})`);
  if (combo.totals.repairs > 0) parts.push(`${combo.totals.repairs} draft(s) repaired`);
  if (combo.totals.fallbacks > 0) parts.push(`${combo.totals.fallbacks} deterministic fallback(s)`);
  if (combo.rates.overExplainRate >= 0.3) parts.push('over-explains');
  if (combo.averages.callsPerTurn > 1.5) parts.push('2 calls/turn — slow');
  if (parts.length === 0) parts.push(combo.rates.passRate === 1 ? 'clean run' : 'mixed results');
  return parts.join('; ');
}

function comboKey(c: EvalComboResult): string {
  return `${c.modelTargetId}×${c.strategy}`;
}

function toRow(combo: EvalComboResult, rank: number, notes: string): EvalRankingRow {
  return {
    rank,
    modelLabel: combo.modelLabel,
    strategy: combo.strategy,
    score: combo.compositeScore,
    passedTurns: combo.totals.passedTurns,
    totalTurns: combo.totals.turns,
    criticalIssues: combo.totals.criticalIssues,
    avgLatencyMs: combo.averages.latencyMs,
    notes,
  };
}

/** Best/worst learner case for one combo, by per-case pass ratio. */
function caseExtremes(combo: EvalComboResult): { best: string; worst: string } {
  const sorted = [...combo.perCase].sort(
    (a, b) => b.passedTurns / Math.max(1, b.totalTurns) - a.passedTurns / Math.max(1, a.totalTurns),
  );
  const fmt = (c: (typeof sorted)[number]) => `${c.caseTitle} (${c.passedTurns}/${c.totalTurns})`;
  return { best: sorted.length ? fmt(sorted[0]) : 'n/a', worst: sorted.length ? fmt(sorted[sorted.length - 1]) : 'n/a' };
}

/** Evidence-driven "what hurt tutor quality" buckets over the quality-signal combos. */
function analyzeCauses(combos: EvalComboResult[]): Array<{ cause: string; evidence: string[] }> {
  const quality = combos.filter((c) => c.qualitySignal);
  const pool = quality.length > 0 ? quality : combos;
  const buckets: Array<{ cause: string; evidence: string[] }> = [];
  const add = (cause: string, evidence: string[]) => {
    if (evidence.length > 0) buckets.push({ cause, evidence });
  };

  add(
    'Model leaks future topics (prompt constraints alone do not hold)',
    pool
      .filter((c) => c.rates.futureTopicLeakRate > 0)
      .map((c) => `${comboKey(c)}: leaked concrete future-unit syntax in ${pct(c.rates.futureTopicLeakRate)} of turns`),
  );

  add(
    'Model over-explains (long replies, multiple code blocks)',
    pool
      .filter((c) => c.rates.overExplainRate >= 0.2)
      .map(
        (c) =>
          `${comboKey(c)}: over-explained in ${pct(c.rates.overExplainRate)} of turns (avg ${Math.round(c.averages.responseWords)} words)`,
      ),
  );

  // Missing/weak retrieval: compare groundedness of retrieval_first vs single_tutor per model.
  const retrievalEvidence: string[] = [];
  for (const model of new Set(pool.map((c) => c.modelTargetId))) {
    const single = pool.find((c) => c.modelTargetId === model && c.strategy === 'single_tutor');
    const retr = pool.find((c) => c.modelTargetId === model && c.strategy === 'retrieval_first');
    if (single && retr) {
      const delta = retr.averages.groundedness - single.averages.groundedness;
      if (Math.abs(delta) >= 0.3) {
        retrievalEvidence.push(
          `${model}: widening deterministic retrieval moved avg groundedness from ${single.averages.groundedness} to ${retr.averages.groundedness}`,
        );
      }
    }
  }
  const weakGrounding = pool.filter((c) => c.averages.groundedness < 2.5);
  add('Retrieval/grounding gaps (answers drift from course material)', [
    ...retrievalEvidence,
    ...weakGrounding.map((c) => `${comboKey(c)}: avg groundedness only ${c.averages.groundedness}/5`),
  ]);

  add(
    'Weak lesson-memory use (tutor rarely references what already happened)',
    pool
      .filter((c) => c.rates.memoryUseRate < 0.3 && c.totals.turns > 0)
      .map((c) => `${comboKey(c)}: visible memory use in only ${pct(c.rates.memoryUseRate)} of follow-up turns`),
  );

  add(
    'Repetition across turns (same explanation replayed)',
    pool
      .filter((c) => c.rates.repetitionRate >= 0.2)
      .map((c) => `${comboKey(c)}: ${pct(c.rates.repetitionRate)} of replies substantially repeat an earlier reply`),
  );

  add(
    'Weak common-mistake handling (prepared corrections not used)',
    pool
      .filter((c) => c.rates.correctionRate < 0.75)
      .map((c) => `${comboKey(c)}: used a prepared correction in only ${pct(c.rates.correctionRate)} of relevant turns`),
  );

  add(
    'Advancing too early (praise/advance language before mastery is proven)',
    pool
      .filter((c) => c.rates.advanceTooEarlyRate > 0)
      .map((c) => `${comboKey(c)}: advance-style language in ${pct(c.rates.advanceTooEarlyRate)} of turns`),
  );

  return buckets;
}

function buildFixNext(causes: Array<{ cause: string; evidence: string[] }>, webllmRan: boolean): string[] {
  const fired = (needle: string) => causes.some((c) => c.cause.toLowerCase().includes(needle));
  const fixes: string[] = [];
  if (fired('leaks future topics')) {
    fixes.push(
      'Strengthen future-topic guardrails: keep repair_pass (or at least guarded_output) on for critical leak rules, and add explicit "never show end=/sep=/f-string syntax" examples to the unit constraints.',
    );
  }
  if (fired('over-explains')) {
    fixes.push('Add a hard reply-length instruction to the prompt (e.g. "at most 4 sentences unless asked") and test a compact CoursePackage variant with shorter KB chunks.');
  }
  if (fired('grounding')) {
    fixes.push('Make deterministic retrieval standard (retrieval_first behaviour) and consider tagging chunks so the keyword retriever matches learner phrasing better.');
  }
  if (fired('memory')) {
    fixes.push('Improve the lesson working-memory summary: surface "already corrected X, already gave hint Y" more prominently so weak models actually reference it.');
  }
  if (fired('repetition')) {
    fixes.push('Feed the "hints already given / mistakes already corrected" memory fields into a do-not-repeat instruction.');
  }
  if (fired('common-mistake')) {
    fixes.push('Improve common-mistake examples in the CoursePackage (one canonical phrasing per mistake) so corrections are easier for a weak model to quote.');
  }
  if (fired('advancing')) {
    fixes.push('Keep lesson completion disabled and add "never announce moving on" phrasing to constraints; let the harness own all advancement.');
  }
  fixes.push('Use repair_pass only for critical failures (leak/advance), not for style issues — it doubles latency when it fires.');
  if (!webllmRan) {
    fixes.push(
      'Build the browser-based WebLLM runner (see docs/webllm-browser-evaluation.md) and re-run this exact matrix against the REAL Gemma 2 2B and Llama 3.2 3B before deciding anything final about the local models.',
    );
  }
  fixes.push('Re-run with a second, harder lesson unit (e.g. the + / str() unit) to check the findings generalise beyond unit 1.');
  return fixes;
}

function buildCoursePackageNotes(combos: EvalComboResult[]): string[] {
  const quality = combos.filter((c) => c.qualitySignal);
  const pool = quality.length > 0 ? quality : combos;
  const avgWords = pool.length ? pool.reduce((a, c) => a + c.averages.responseWords, 0) / pool.length : 0;
  const avgGrounded = pool.length ? pool.reduce((a, c) => a + c.averages.groundedness, 0) / pool.length : 0;
  const anyLeak = pool.some((c) => c.rates.futureTopicLeakRate > 0);

  const notes: string[] = [];
  notes.push(
    'Variants worth testing later (do NOT build yet): detailed package (current), compact package (short chunks, 1–2 sentences each), scaffolded package (explicit step ladder per objective), question-first package (lead with the check question), strict micro-lesson package (one objective, one chunk, one question per unit).',
  );
  if (avgGrounded >= 3.5) {
    notes.push(
      `Observed groundedness is healthy (avg ${avgGrounded.toFixed(1)}/5), so the current package is not obviously too noisy for retrieval — the "too detailed" hypothesis is NOT strongly supported by this run.`,
    );
  } else {
    notes.push(
      `Observed groundedness is mediocre (avg ${avgGrounded.toFixed(1)}/5) — consistent with the package being too detailed/noisy for keyword retrieval; the compact variant is the first one to test.`,
    );
  }
  if (avgWords > 120) {
    notes.push(
      `Replies average ${Math.round(avgWords)} words — long KB chunks appear to invite long answers; a compact variant with shorter chunks is likely to reduce over-explaining.`,
    );
  }
  if (anyLeak) {
    notes.push(
      'Future-topic leakage occurred even though constraints name the forbidden syntax — a strict micro-lesson variant (future topics simply absent from the package text) would test whether leakage comes from the package mentioning them at all.',
    );
  }
  notes.push(
    'Unit 1 is narrow (print + newline), so "lesson too broad" could not really be falsified here; test a broader unit before concluding anything about unit size.',
  );
  notes.push('Report metadata carries coursePackageVariant: "current_detailed" so later variant runs can be diffed.');
  return notes;
}

export function buildEvaluationReport(output: EvaluationRunOutput, finishedAt: string): EvaluationReport {
  const { combos } = output;
  const webllmActuallyRan = combos.some((c) => c.isRealWebllm);

  const sorted = [...combos].sort((a, b) => b.compositeScore - a.compositeScore);
  // Recommendations come only from COMPLETE quality-signal combos: the mock
  // proves mechanics, and a partial combo's score is not comparable.
  const quality = sorted.filter((c) => c.qualitySignal && !c.partial);
  const recPool = quality.length > 0 ? quality : sorted.filter((c) => !c.partial);

  const fastest = [...recPool].sort((a, b) => a.averages.latencyMs - b.averages.latencyMs)[0];
  const safest = [...recPool].sort((a, b) => b.safetyScore - a.safetyScore || a.averages.latencyMs - b.averages.latencyMs)[0];
  const bestTeaching = [...recPool].sort((a, b) => b.teachingScore - a.teachingScore)[0];
  const noteContext = {
    fastestId: fastest ? comboKey(fastest) : '',
    safestId: safest ? comboKey(safest) : '',
  };

  const ranking = sorted.map((c, i) => toRow(c, i + 1, comboNotes(c, noteContext)));
  const rowFor = (c: EvalComboResult | undefined) =>
    c ? ranking.find((r) => r.modelLabel === c.modelLabel && r.strategy === c.strategy) ?? null : null;

  const best = recPool[0];
  const secondBest = recPool[1];

  const whyTopTwo: string[] = [];
  if (best) {
    const ext = caseExtremes(best);
    whyTopTwo.push(
      `Best — ${best.modelLabel} × ${best.strategy} (score ${best.compositeScore}): pass rate ${pct(best.rates.passRate)}, ` +
        `future-topic leakage ${pct(best.rates.futureTopicLeakRate)}, groundedness ${best.averages.groundedness}/5, ` +
        `avg latency ${seconds(best.averages.latencyMs)} at ${best.averages.callsPerTurn} call(s)/turn. ` +
        `Handled best: ${ext.best}. Struggled most: ${ext.worst}.`,
    );
  }
  if (secondBest) {
    const ext = caseExtremes(secondBest);
    whyTopTwo.push(
      `Second — ${secondBest.modelLabel} × ${secondBest.strategy} (score ${secondBest.compositeScore}): pass rate ${pct(secondBest.rates.passRate)}, ` +
        `leakage ${pct(secondBest.rates.futureTopicLeakRate)}, groundedness ${secondBest.averages.groundedness}/5, ` +
        `avg latency ${seconds(secondBest.averages.latencyMs)}. ` +
        `Handled best: ${ext.best}. Struggled most: ${ext.worst}.`,
    );
  }
  if (quality.length === 0) {
    whyTopTwo.push(
      'CAVEAT: only the deterministic mock ran, so this ranking proves harness mechanics, not model quality. Configure the openai-compatible endpoint or build the browser WebLLM runner for a real signal.',
    );
  }

  const whatFailed = sorted
    .flatMap((c) => c.perCase.flatMap((p) => p.criticalIssues.map((ci) => `${comboKey(c)} — ${ci}`)))
    .slice(0, 30);

  const causes = analyzeCauses(combos);

  const partialCombos = sorted.filter((c) => c.partial);
  const limitations: string[] = [
    ...(output.combosAborted.length
      ? [
          `${output.combosAborted.length} combination(s) produced NO data because the provider refused every call (${output.combosAborted
            .map((c) => `${c.modelLabel} × ${c.strategy}`)
            .join('; ')}; first error: ${output.combosAborted[0].reason}). They are absent from the table — that model×strategy is UNMEASURED, not bad.`,
        ]
      : []),
    ...(partialCombos.length
      ? [
          `Provider quota/rate limits aborted ${partialCombos.length} combination(s) mid-run (${partialCombos
            .map((c) => `${c.modelLabel} × ${c.strategy}: ${c.totals.cases}/${c.totals.casesExpected} cases`)
            .join('; ')}). These appear in the table marked PARTIAL and are excluded from recommendations — re-run them when the quota resets before drawing conclusions about that model.`,
        ]
      : []),
    webllmActuallyRan
      ? 'Real WebLLM on-device inference was executed via the local browser bridge (temperature 0.7, max 800 tokens — matching the app\'s local runtime settings). Results for the bridged model are REAL model quality, measured on this machine\'s GPU.'
      : 'True WebLLM local-browser model evaluation cannot run from the Node CLI yet: WebLLM needs a browser with WebGPU. The Gemma 2 2B and Llama 3.2 3B results are therefore ABSENT — nothing in this report measures those two models.',
    output.targets.runnable.some((t) => t.kind === 'openai-compatible')
      ? 'Cloud models on the configured openai-compatible endpoint were used as clearly labelled proxies. They indicate how the STRATEGIES behave with a real LLM, not how the on-device models will behave.'
      : 'No openai-compatible proxy was available/selected, so no real-LLM signal is present in this run.',
    'All learners are SCRIPTED profiles (fixed turns). Learner reactions do not adapt to the tutor, so multi-turn recovery behaviour is only approximated.',
    'Scoring is deterministic regex/token-overlap heuristics, not an LLM judge: prose that teaches a future topic WITHOUT concrete syntax is not flagged (false negative), and phrasing outside the detectors\' vocabulary can fail a turn unfairly (false positive). Warmth/over-explaining/memory-use are rough proxies.',
    webllmActuallyRan
      ? 'Latency is measured wall-clock: for the bridged WebLLM model this is REAL on-device inference time on this machine (other hardware will differ); rate-limit pacing waits are excluded.'
      : 'Latency is measured wall-clock of the providers that ran: near zero for the mock, network latency for cloud proxies. On-device WebLLM latency will be significantly higher than the cloud numbers and is NOT represented here.',
    'The five strategies are harness-side re-implementations that mirror the app\'s lesson-runtime semantics over the harness prompt path; they are not the app code paths themselves.',
    'retrieval_first in this lab means "widened deterministic retrieval" (6 chunks vs 3). Unit 1 has only 2 chunks, so its effect is limited on this fixture; test on a chunk-richer unit for a real read.',
  ];

  return {
    finishedAt,
    metadata: {
      coursePackageVariant: 'current_detailed',
      scoringMethod: 'deterministic_rules_no_llm_judge',
      latencySource: 'measured_wall_clock_of_available_providers',
      webllmActuallyRan,
      harnessVersion: '0.1.0',
      lockedConfig: lockedConfigMetadata(),
    },
    modelTargets: output.targets.requested,
    strategiesEvaluated: output.strategies,
    strategiesUnavailable: output.strategiesUnavailable,
    cases: output.cases.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      kind: c.kind,
      turnCount: c.turns.length,
    })),
    combos,
    combosAborted: output.combosAborted,
    ranking,
    recommendations: {
      best: rowFor(best),
      secondBest: rowFor(secondBest),
      safest: rowFor(safest),
      fastest: rowFor(fastest),
      bestTeaching: rowFor(bestTeaching),
      whyTopTwo,
      whatFailed,
      fixNext: buildFixNext(causes, webllmActuallyRan),
    },
    whatHurtTutorQuality: causes,
    coursePackageNotes: buildCoursePackageNotes(combos),
    limitations,
  };
}

// ── Markdown rendering ───────────────────────────────────────────────

function recommendationBlock(report: EvaluationReport, row: EvalRankingRow | null, title: string): string[] {
  if (!row) return [`### ${title}`, '', '_No combination available._', ''];
  const combo = report.combos.find((c) => c.modelLabel === row.modelLabel && c.strategy === row.strategy);
  if (!combo) return [`### ${title}`, '', '_Not found._', ''];
  const ext = caseExtremes(combo);
  const failures = combo.perCase.flatMap((p) => p.criticalIssues);
  const tooSlow = combo.averages.latencyMs > 6000 || combo.averages.callsPerTurn > 1.5;
  const suitable = combo.qualitySignal && combo.rates.futureTopicLeakRate === 0 && combo.rates.passRate >= 0.85;
  const suitability = !combo.qualitySignal
    ? 'No — this is the deterministic mock (mechanics baseline only).'
    : combo.isRealWebllm
      ? suitable
        ? 'Plausibly yes — this IS the real on-device model; validate latency/UX in the app before shipping.'
        : 'Not yet — see failures above (and this IS the real on-device model, so these are real failures).'
      : suitable
        ? 'The STRATEGY looks shippable, but this ran on a cloud proxy — confirm on the real WebLLM models first.'
        : 'Not yet — see failures above, and this is a proxy result, not the on-device model.';
  return [
    `### ${title}: ${row.modelLabel} × \`${row.strategy}\` — score ${row.score}`,
    '',
    `- **Why it worked:** pass rate ${pct(combo.rates.passRate)}, expected-behaviour pass ${pct(combo.rates.expectedBehaviorPassRate)}, groundedness ${combo.averages.groundedness}/5, future-topic leakage ${pct(combo.rates.futureTopicLeakRate)}, ${combo.totals.repairs} repair(s), ${combo.totals.fallbacks} fallback(s).`,
    `- **Where it failed:** ${failures.length ? failures.slice(0, 5).join('; ') : `no critical failures; ${combo.totals.failedTurns} turn(s) failed on behaviour-contract details`}.`,
    `- **Handled best:** ${ext.best}.`,
    `- **Struggled with:** ${ext.worst}.`,
    `- **Suitable for the real app now?** ${suitability}`,
    `- **Too slow for real use?** avg ${seconds(combo.averages.latencyMs)} at ${combo.averages.callsPerTurn} call(s)/turn — ${
      combo.isRealWebllm
        ? tooSlow
          ? 'this is REAL on-device latency and it is slow; consider a faster strategy or model.'
          : 'this is REAL on-device latency and looks acceptable.'
        : tooSlow
          ? 'borderline/slow; on-device it would be slower still.'
          : 'fine for cloud; expect noticeably higher latency on-device.'
    }`,
    '',
  ];
}

export function renderEvaluationMarkdown(report: EvaluationReport): string {
  const L: string[] = [];
  const rec = report.recommendations;

  L.push('# Model × Strategy Tutor-Quality Evaluation');
  L.push('');
  L.push(`- **Finished:** ${report.finishedAt}`);
  L.push(`- **CoursePackage variant:** \`${report.metadata.coursePackageVariant}\``);
  L.push(`- **Scoring:** ${report.metadata.scoringMethod}`);
  L.push(`- **Real WebLLM models executed:** ${report.metadata.webllmActuallyRan ? 'YES' : '**NO** (see Limitations)'}`);
  L.push('');

  // Execution status — one unambiguous statement per requested on-device model.
  const webllmRequested = report.modelTargets.filter((t) => t.kind === 'webllm');
  if (webllmRequested.length) {
    L.push('## Execution status');
    L.push('');
    for (const t of webllmRequested) {
      const ran = report.combos.some((c) => c.modelTargetId === t.id && c.totals.turns > 0);
      L.push(
        ran
          ? `- **Actual ${t.label} was tested** (real WebLLM inference via the browser bridge).`
          : `- **Actual ${t.label} could not be executed from this runner. No quality verdict.**`,
      );
    }
    L.push('');
  }

  // 1. Executive summary
  L.push('## 1. Executive Summary');
  L.push('');
  if (!report.metadata.webllmActuallyRan) {
    L.push(
      '> **True WebLLM local-browser model evaluation cannot run from the Node CLI yet.** ' +
        'The two real offline options (Gemma 2 2B, Llama 3.2 3B) run on WebLLM/WebGPU inside a browser only. ' +
        'This report compares the runtime STRATEGIES using the providers that can run here, clearly labelled; ' +
        'no Gemma/Llama quality claim is made. See §7 and docs/webllm-browser-evaluation.md.',
    );
    L.push('');
  }
  L.push(`- **Best option:** ${rec.best ? `${rec.best.modelLabel} × \`${rec.best.strategy}\` (score ${rec.best.score})` : 'n/a'}`);
  L.push(
    `- **Second-best option:** ${rec.secondBest ? `${rec.secondBest.modelLabel} × \`${rec.secondBest.strategy}\` (score ${rec.secondBest.score})` : 'n/a'}`,
  );
  L.push(`- **Safest strategy:** ${rec.safest ? `\`${rec.safest.strategy}\` on ${rec.safest.modelLabel}` : 'n/a'}`);
  L.push(`- **Fastest strategy:** ${rec.fastest ? `\`${rec.fastest.strategy}\` on ${rec.fastest.modelLabel} (avg ${seconds(rec.fastest.avgLatencyMs)})` : 'n/a'}`);
  L.push(`- **Best teaching quality:** ${rec.bestTeaching ? `\`${rec.bestTeaching.strategy}\` on ${rec.bestTeaching.modelLabel}` : 'n/a'}`);
  L.push(
    report.metadata.webllmActuallyRan
      ? '- **What to test next:** the compact CoursePackage variant on the winning strategy, then a second, harder unit; later, the other on-device model for comparison.'
      : '- **What to test next:** run this exact matrix in a browser against the real WebLLM models, then test the compact CoursePackage variant.',
  );
  L.push('');
  L.push('**Why these two were selected:**');
  L.push('');
  for (const w of rec.whyTopTwo) L.push(`- ${w}`);
  L.push('');

  // 2. Comparison table
  L.push('## 2. Comparison Table');
  L.push('');
  L.push('| Rank | Model | Strategy | Score | Passed Turns | Critical Issues | Avg Latency | Notes |');
  L.push('| ---: | --- | --- | ---: | ---: | ---: | ---: | --- |');
  for (const r of report.ranking) {
    L.push(
      `| ${r.rank} | ${r.modelLabel} | \`${r.strategy}\` | ${r.score} | ${r.passedTurns}/${r.totalTurns} | ${r.criticalIssues} | ${seconds(r.avgLatencyMs)} | ${r.notes} |`,
    );
  }
  L.push('');
  L.push('Composite score (0–100) = 40·turn-pass-rate + 15·groundedness + 15·no-future-leakage + 10·no-critical-turns + 10·brevity-discipline + 10·expected-behaviours.');
  L.push('');

  if (report.combosAborted.length) {
    L.push('### Combinations with NO data (provider refused every call)');
    L.push('');
    for (const c of report.combosAborted) L.push(`- **${c.modelLabel} × \`${c.strategy}\`** — ${c.reason}`);
    L.push('');
  }

  // Models not evaluated
  const unavailable = report.modelTargets.filter((t) => !t.available);
  if (unavailable.length) {
    L.push('### Models NOT evaluated');
    L.push('');
    for (const t of unavailable) L.push(`- **${t.label}** — ${t.unavailableReason}`);
    L.push('');
  }
  const proxies = report.modelTargets.filter((t) => t.available && t.proxyNote);
  if (proxies.length) {
    L.push('### Proxy disclaimer');
    L.push('');
    for (const t of proxies) L.push(`- **${t.label}** — ${t.proxyNote}`);
    L.push('');
  }

  // 3. Best two recommendations
  L.push('## 3. Best Two Recommendations');
  L.push('');
  L.push(...recommendationBlock(report, rec.best, 'Best option'));
  L.push(...recommendationBlock(report, rec.secondBest, 'Second-best option'));

  if (rec.whatFailed.length) {
    L.push('### What failed (critical issues across all combinations)');
    L.push('');
    for (const f of rec.whatFailed) L.push(`- ${f}`);
    L.push('');
  }

  // 4. What hurt tutor quality
  L.push('## 4. What Hurt Tutor Quality');
  L.push('');
  if (report.whatHurtTutorQuality.length === 0) {
    L.push('_No systematic quality-hurting pattern was detected by the deterministic analyzers in this run._');
  }
  for (const c of report.whatHurtTutorQuality) {
    L.push(`### ${c.cause}`);
    L.push('');
    for (const e of c.evidence) L.push(`- ${e}`);
    L.push('');
  }
  L.push('### Recurring issue patterns (per combination)');
  L.push('');
  for (const combo of report.combos) {
    if (combo.recurringIssues.length === 0) continue;
    L.push(`- **${combo.modelLabel} × \`${combo.strategy}\`**: ${combo.recurringIssues.map((i) => `${i.issue} (×${i.count})`).join('; ')}`);
  }
  L.push('');

  // 5. Fix next
  L.push('## 5. What To Fix Next');
  L.push('');
  for (const f of rec.fixNext) L.push(`- ${f}`);
  L.push('');

  // CoursePackage section (explicitly requested)
  L.push('## 6. Possible CoursePackage changes to test later');
  L.push('');
  for (const n of report.coursePackageNotes) L.push(`- ${n}`);
  L.push('');

  // 6/7. Limitations
  L.push('## 7. Limitations');
  L.push('');
  for (const l of report.limitations) L.push(`- ${l}`);
  L.push('');

  // Appendix: cases + per-profile outcomes
  L.push('## Appendix A — Learner cases');
  L.push('');
  for (const c of report.cases) L.push(`- **${c.id}** (${c.kind}, ${c.turnCount} turns): ${c.description}`);
  L.push('');
  L.push('## Appendix B — Per-case pass rates by combination');
  L.push('');
  const caseIds = report.cases.map((c) => c.id);
  L.push(`| Model × Strategy | ${caseIds.join(' | ')} |`);
  L.push(`| --- | ${caseIds.map(() => '---:').join(' | ')} |`);
  for (const combo of report.combos) {
    const cells = caseIds.map((id) => {
      const p = combo.perCase.find((x) => x.caseId === id);
      return p ? `${p.passedTurns}/${p.totalTurns}` : '—';
    });
    L.push(`| ${combo.modelLabel} × \`${combo.strategy}\` | ${cells.join(' | ')} |`);
  }
  L.push('');
  L.push('_Full per-turn transcripts, dimensions and telemetry are in the JSON report next to this file._');
  L.push('');
  return L.join('\n');
}

/** Write the evaluation report pair into teacher-harness/reports/. */
export function writeEvaluationReport(
  report: EvaluationReport,
  filePrefix = 'model-strategy-evaluation',
): { jsonPath: string; mdPath: string } {
  const reportsDir = resolve(HARNESS_ROOT, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const stamp = report.finishedAt.replace(/[^0-9A-Za-z]+/g, '-');
  const jsonPath = resolve(reportsDir, `${filePrefix}-${stamp}.json`);
  const mdPath = resolve(reportsDir, `${filePrefix}-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(mdPath, `${renderEvaluationMarkdown(report)}\n`, 'utf8');
  return { jsonPath, mdPath };
}
