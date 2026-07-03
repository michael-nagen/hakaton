// ── Teacher Harness — memory-mode report builder + writer ────────────
//
// Renders the memory-mode experiment (Llama 3.2 3B + repair_pass +
// high_very_guided, varying only the lesson-memory mode) into a dedicated
// report: reports/memory-evaluation-<timestamp>.{json,md}. Derived
// deterministically from the measured aggregates — no LLM writes this report.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HARNESS_ROOT } from '../config/harness-config';
import type { EvalComboResult } from './eval-types';
import type { LessonMemoryMode } from '../runtime/lesson-memory.types';
import type { MemoryEvalRunOutput, MemoryModeResult } from './run-memory-eval';

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

interface MemoryRankRow {
  rank: number;
  memoryMode: LessonMemoryMode;
  score: number;
  passedTurns: number;
  totalTurns: number;
  criticalIssues: number;
  avgLatencyMs: number;
  avgWords: number;
  repairs: number;
  notes: string;
}

export interface MemoryEvalReport {
  finishedAt: string;
  status: {
    realWebLLM: boolean;
    modelExecuted: boolean;
    completed: boolean;
    model: string;
    strategy: string;
    lessonVariant: string;
    incompleteReason?: string;
    statement: string;
  };
  metadata: {
    courseSource: string;
    courseId: string | null;
    unitId: string | null;
    scoringMethod: 'deterministic_rules_no_llm_judge';
    fullArchiveSentToModel: false;
    isPlaceholderCourse: boolean;
  };
  memoryModesEvaluated: LessonMemoryMode[];
  ranking: MemoryRankRow[];
  recommendations: {
    best: MemoryRankRow | null;
    secondBest: MemoryRankRow | null;
    whyBest: string[];
    whySecond: string[];
    recommendedMemoryAmount: string;
    lastMessagesVsSummaryVsStructured: string;
  };
  whatHurtQuality: Array<{ cause: string; evidence: string[] }>;
  fixNext: string[];
  limitations: string[];
  perMode: Array<{ memoryMode: LessonMemoryMode; combo: EvalComboResult; runDirs: string[] }>;
}

function modeNotes(r: MemoryModeResult): string {
  const c = r.combo;
  const parts: string[] = [];
  if (c.totals.criticalIssues === 0) parts.push('0 critical');
  else parts.push(`${c.totals.criticalIssues} critical`);
  if (r.memoryMode === 'no_memory') parts.push('no prior context');
  if (c.rates.repetitionRate >= 0.2) parts.push(`repeats (${pct(c.rates.repetitionRate)})`);
  if (c.rates.overExplainRate >= 0.3) parts.push('over-explains');
  if (c.averages.groundedness >= 3.5) parts.push('well grounded');
  else if (c.averages.groundedness < 2.5) parts.push('weak grounding');
  if (c.rates.memoryUseRate >= 0.5) parts.push(`uses memory (${pct(c.rates.memoryUseRate)})`);
  return parts.join('; ');
}

function caseExtremes(combo: EvalComboResult): { best: string; worst: string } {
  const sorted = [...combo.perCase].sort(
    (a, b) => b.passedTurns / Math.max(1, b.totalTurns) - a.passedTurns / Math.max(1, a.totalTurns),
  );
  const fmt = (c: (typeof sorted)[number]) => `${c.caseTitle} (${c.passedTurns}/${c.totalTurns})`;
  return { best: sorted.length ? fmt(sorted[0]) : 'n/a', worst: sorted.length ? fmt(sorted[sorted.length - 1]) : 'n/a' };
}

function analyzeCauses(results: MemoryModeResult[]): Array<{ cause: string; evidence: string[] }> {
  const buckets: Array<{ cause: string; evidence: string[] }> = [];
  const add = (cause: string, evidence: string[]) => {
    if (evidence.length) buckets.push({ cause, evidence });
  };
  const by = (mode: LessonMemoryMode) => results.find((r) => r.memoryMode === mode);

  // Too little memory — no_memory / summary loss vs the richer modes.
  const noMem = by('no_memory');
  if (noMem) {
    const richer = results.filter((r) => r.memoryMode !== 'no_memory');
    const bestRicher = [...richer].sort((a, b) => b.combo.compositeScore - a.combo.compositeScore)[0];
    if (bestRicher && bestRicher.combo.compositeScore - noMem.combo.compositeScore >= 3) {
      add('Too little memory (forgetting prior context hurts)', [
        `no_memory scored ${noMem.combo.compositeScore} vs ${bestRicher.memoryMode} ${bestRicher.combo.compositeScore}; memory-use in no_memory ${pct(noMem.combo.rates.memoryUseRate)}.`,
      ]);
    }
  }

  // Too much memory — structured worst / noisiest.
  const structured = by('structured_working_memory');
  if (structured) {
    const leaner = results.filter((r) => r.memoryMode !== 'structured_working_memory' && r.memoryMode !== 'no_memory');
    const bestLeaner = [...leaner].sort((a, b) => b.combo.compositeScore - a.combo.compositeScore)[0];
    if (bestLeaner && bestLeaner.combo.compositeScore - structured.combo.compositeScore >= 3) {
      add('Too much memory / structured checklist too noisy', [
        `structured_working_memory scored ${structured.combo.compositeScore} vs leaner ${bestLeaner.memoryMode} ${bestLeaner.combo.compositeScore}; structured avg ${Math.round(structured.combo.averages.responseWords)} words, over-explain ${pct(structured.combo.rates.overExplainRate)}.`,
      ]);
    }
  }

  // Raw chat history too noisy.
  const lastOnly = by('last_messages_only');
  if (lastOnly && (lastOnly.combo.rates.repetitionRate >= 0.2 || lastOnly.combo.rates.overExplainRate >= 0.3)) {
    add('Raw last-messages window too noisy', [
      `last_messages_only: repetition ${pct(lastOnly.combo.rates.repetitionRate)}, over-explain ${pct(lastOnly.combo.rates.overExplainRate)}.`,
    ]);
  }

  // Summary too lossy.
  const summaryOnly = by('summary_only');
  const summaryPlus = by('summary_plus_last_messages');
  if (summaryOnly && summaryPlus && summaryPlus.combo.compositeScore - summaryOnly.combo.compositeScore >= 3) {
    add('Summary alone too lossy (loses recency)', [
      `summary_only ${summaryOnly.combo.compositeScore} vs summary_plus_last_messages ${summaryPlus.combo.compositeScore} — adding recent messages helped.`,
    ]);
  }

  // Memory made the model repeat / over-explain (any mode).
  const repeaters = results.filter((r) => r.combo.rates.repetitionRate >= 0.2);
  add('Memory encouraged repetition', repeaters.map((r) => `${r.memoryMode}: repetition ${pct(r.combo.rates.repetitionRate)}`));

  // Failed to preserve mistakes (correction rate low).
  const weakCorrection = results.filter((r) => r.combo.rates.correctionRate < 0.75);
  add('Memory did not preserve learner mistakes well', weakCorrection.map((r) => `${r.memoryMode}: correction rate ${pct(r.combo.rates.correctionRate)}`));

  return buckets;
}

function buildFixNext(best: MemoryModeResult | undefined): string[] {
  const fixes: string[] = [];
  if (best) {
    fixes.push(`Adopt "${best.memoryMode}" as the default lesson-memory mode for this local model (it scored highest with the fixed baseline).`);
  }
  fixes.push('Tune lastMessagesLimit (currently 10): try 6 and 8 to see whether a shorter recency window reduces repetition without losing coherence.');
  fixes.push('Tune the deterministic summary length/fields — drop any structured field that did not change scores (candidate: the full checklist rows).');
  fixes.push('If structured memory underperformed, simplify it toward the winning mode rather than adding more fields.');
  fixes.push('Re-run on a REAL (non-placeholder) CourseFactory course and a second unit before locking the default.');
  fixes.push('Only after runtime quality is good: consider durable/DB-backed memory — NOT now (out of scope, no DB in this harness).');
  return fixes;
}

export function buildMemoryEvalReport(output: MemoryEvalRunOutput, finishedAt: string): MemoryEvalReport {
  const modelExecuted = output.modelExecuted;
  const completed = modelExecuted && output.results.length > 0 && !output.incompleteReason;
  const isPlaceholder = /mock|placeholder/i.test(output.variantCourseId ?? '');

  const sorted = [...output.results].sort((a, b) => b.combo.compositeScore - a.combo.compositeScore);
  const ranking: MemoryRankRow[] = sorted.map((r, i) => ({
    rank: i + 1,
    memoryMode: r.memoryMode,
    score: r.combo.compositeScore,
    passedTurns: r.combo.totals.passedTurns,
    totalTurns: r.combo.totals.turns,
    criticalIssues: r.combo.totals.criticalIssues,
    avgLatencyMs: r.combo.averages.latencyMs,
    avgWords: r.combo.averages.responseWords,
    repairs: r.combo.totals.repairs,
    notes: modeNotes(r),
  }));

  const best = sorted[0];
  const second = sorted[1];
  const causes = analyzeCauses(output.results);

  const whyBest: string[] = [];
  if (best && modelExecuted) {
    const ext = caseExtremes(best.combo);
    whyBest.push(
      `Pass rate ${pct(best.combo.rates.passRate)}, ${best.combo.totals.criticalIssues} critical, groundedness ${best.combo.averages.groundedness}/5, avg ${Math.round(best.combo.averages.responseWords)} words at ${seconds(best.combo.averages.latencyMs)}/turn, repetition ${pct(best.combo.rates.repetitionRate)}, memory-use ${pct(best.combo.rates.memoryUseRate)}.`,
      `Handled best: ${ext.best}. Still struggled with: ${ext.worst}.`,
    );
  }
  const whySecond: string[] = [];
  if (second && modelExecuted) {
    const ext = caseExtremes(second.combo);
    whySecond.push(
      `Pass rate ${pct(second.combo.rates.passRate)}, ${second.combo.totals.criticalIssues} critical, avg ${Math.round(second.combo.averages.responseWords)} words at ${seconds(second.combo.averages.latencyMs)}/turn.`,
      best ? `vs the winner: ${second.combo.compositeScore >= best.combo.compositeScore - 3 ? 'nearly tied' : 'behind'}; would be preferable if ${second.combo.averages.latencyMs < best.combo.averages.latencyMs ? 'lower latency' : 'its shorter memory block'} matters more in practice.` : '',
      `Handled best: ${ext.best}. Struggled with: ${ext.worst}.`,
    );
  }

  const amount = best
    ? best.memoryMode === 'no_memory'
      ? 'Surprisingly, NO prior memory scored best here — but treat this cautiously on placeholder content.'
      : best.memoryMode === 'summary_only'
        ? 'A compact summary is enough; raw messages and the full structured checklist did not help this weak model.'
        : best.memoryMode === 'last_messages_only'
          ? 'Recent verbatim messages are enough; the structured checklist added noise without benefit.'
          : best.memoryMode === 'summary_plus_last_messages'
            ? 'A compact summary PLUS the last few messages is the sweet spot — recency + gist, without the full checklist.'
            : 'The full structured working memory remains best — the extra structure earns its keep for this model.'
    : 'n/a';

  const lastVsSummaryVsStructured = best
    ? best.memoryMode === 'summary_plus_last_messages'
      ? 'Send BOTH a compact summary and the last few messages.'
      : best.memoryMode === 'summary_only'
        ? 'Send a compact SUMMARY (not raw messages, not the full checklist).'
        : best.memoryMode === 'last_messages_only'
          ? 'Send only the LAST MESSAGES.'
          : best.memoryMode === 'structured_working_memory'
            ? 'Keep the full STRUCTURED checklist.'
            : 'Send NO memory (verify on real content before trusting this).'
    : 'n/a';

  const statement = modelExecuted
    ? 'Actual Llama 3.2 3B (WebLLM) was tested for every memory mode.'
    : 'Actual Llama 3.2 3B could not be executed from this runner. No quality verdict.';

  const limitations: string[] = [
    'This experiment evaluates ONLY lesson-SESSION memory representations — no durable learner memory, no DB, no vector memory.',
    `Fixed baseline: model ${output.modelName}, strategy ${output.strategy}, lesson variant ${output.lessonVariant} — none of these were varied.`,
    isPlaceholder
      ? 'IMPORTANT: the fixed lesson variant resolves to the PLACEHOLDER "mock-demo" course, so absolute numbers reflect how memory shapes behaviour on placeholder text, not real-subject mastery. The relative memory-mode ranking is the signal; re-run on a real course before locking the default.'
      : 'Evaluated against real (non-placeholder) content.',
    'Learner turns are SCRIPTED and do not adapt to the tutor; multi-turn memory benefits are only approximated.',
    'Scoring is deterministic regex/token-overlap heuristics (no LLM judge): false positives/negatives occur; "memory use" and "repetition" are rough proxies.',
    'Latency is REAL on-device inference on this machine\'s GPU; other hardware differs, and pacing waits are excluded.',
    'Results may change with another lesson topic or a longer conversation (only a few turns per profile here).',
    'The full conversation archive was NEVER sent to the model in any mode (verified via per-turn memory.sent-to-model.txt).',
    ...(output.incompleteReason ? [`Run did not fully complete: ${output.incompleteReason}`] : []),
  ];

  return {
    finishedAt,
    status: {
      realWebLLM: modelExecuted,
      modelExecuted,
      completed,
      model: output.modelName,
      strategy: output.strategy,
      lessonVariant: output.lessonVariant,
      incompleteReason: output.incompleteReason,
      statement,
    },
    metadata: {
      courseSource: 'course-factory/output/variants/',
      courseId: output.variantCourseId,
      unitId: output.variantUnitId,
      scoringMethod: 'deterministic_rules_no_llm_judge',
      fullArchiveSentToModel: false,
      isPlaceholderCourse: isPlaceholder,
    },
    memoryModesEvaluated: output.memoryModesEvaluated,
    ranking,
    recommendations: {
      best: ranking[0] ?? null,
      secondBest: ranking[1] ?? null,
      whyBest,
      whySecond,
      recommendedMemoryAmount: amount,
      lastMessagesVsSummaryVsStructured: lastVsSummaryVsStructured,
    },
    whatHurtQuality: causes,
    fixNext: buildFixNext(best),
    limitations,
    perMode: output.results.map((r) => ({ memoryMode: r.memoryMode, combo: r.combo, runDirs: r.runDirs })),
  };
}

// ── Markdown rendering ───────────────────────────────────────────────

export function renderMemoryEvalMarkdown(report: MemoryEvalReport): string {
  const L: string[] = [];
  const rec = report.recommendations;

  L.push('# Lesson-Memory Mode Evaluation');
  L.push('');
  L.push(`- **Finished:** ${report.finishedAt}`);
  L.push(`- **Model (fixed):** ${report.status.model}`);
  L.push(`- **Strategy (fixed):** \`${report.status.strategy}\``);
  L.push(`- **Lesson variant (fixed):** \`${report.status.lessonVariant}\``);
  L.push(`- **Course source:** ${report.metadata.courseSource} (${report.metadata.courseId ?? 'n/a'} / ${report.metadata.unitId ?? 'n/a'})`);
  L.push(`- **Scoring:** ${report.metadata.scoringMethod}`);
  L.push(`- **Full archive sent to model:** ${report.metadata.fullArchiveSentToModel ? 'yes' : 'NO (only the selected memory representation)'}`);
  L.push('');

  L.push('## Execution status');
  L.push('');
  L.push(`**${report.status.statement}**`);
  L.push('');
  if (!report.status.completed) {
    L.push(`> ⚠️ The run did not fully complete.${report.status.incompleteReason ? ` ${report.status.incompleteReason}` : ''}`);
    L.push('');
  }
  if (report.metadata.isPlaceholderCourse) {
    L.push('> ⚠️ **Placeholder content.** The fixed lesson variant resolves to the "mock-demo" placeholder course, so absolute numbers reflect memory\'s effect on placeholder text. The memory-mode RANKING is the signal; see §7.');
    L.push('');
  }

  // 1. Executive summary
  L.push('## 1. Executive Summary');
  L.push('');
  L.push(`- **Best memory mode:** ${rec.best ? `\`${rec.best.memoryMode}\` — score ${rec.best.score}` : 'n/a'}`);
  L.push(`- **Second-best memory mode:** ${rec.secondBest ? `\`${rec.secondBest.memoryMode}\` — score ${rec.secondBest.score}` : 'n/a'}`);
  L.push(`- **Real Llama 3.2 3B WebLLM used:** ${report.status.realWebLLM ? 'YES' : '**NO**'}`);
  L.push(`- **Strategy used:** \`${report.status.strategy}\` (fixed)`);
  L.push(`- **Lesson variant used:** \`${report.status.lessonVariant}\` (fixed)`);
  L.push(`- **How much memory is recommended:** ${rec.recommendedMemoryAmount}`);
  L.push('');

  // 2. Comparison table
  L.push('## 2. Comparison Table');
  L.push('');
  L.push('| Rank | Memory Mode | Score | Passed Turns | Critical Issues | Avg Latency | Avg Length | Repairs | Notes |');
  L.push('| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const r of report.ranking) {
    L.push(
      `| ${r.rank} | \`${r.memoryMode}\` | ${r.score} | ${r.passedTurns}/${r.totalTurns} | ${r.criticalIssues} | ${seconds(r.avgLatencyMs)} | ${Math.round(r.avgWords)} words | ${r.repairs} | ${r.notes} |`,
    );
  }
  L.push('');
  L.push('Composite score (0–100) = 40·turn-pass-rate + 15·groundedness + 15·no-future-leakage + 10·no-critical-turns + 10·brevity-discipline + 10·expected-behaviours (same scale as the other labs).');
  L.push('');

  // 3. Best memory recommendation
  L.push('## 3. Best Memory Recommendation');
  L.push('');
  if (rec.best && report.status.modelExecuted) {
    L.push(`**\`${rec.best.memoryMode}\`** — score ${rec.best.score}.`);
    L.push('');
    for (const w of rec.whyBest) L.push(`- ${w}`);
    const bestCombo = report.perMode.find((m) => m.memoryMode === rec.best?.memoryMode)?.combo;
    const shouldDefault = bestCombo && bestCombo.totals.criticalIssues === 0 && bestCombo.rates.passRate >= 0.7;
    L.push(`- **Should this become the default memory mode?** ${shouldDefault ? 'Yes for this local model — best score, no critical issues. Confirm on a real (non-placeholder) course first.' : 'Lean yes, but validate on real content — the margin/failure profile is not yet decisive.'}`);
    L.push(`- **Last messages, summary, both, or structured checklist?** ${rec.lastMessagesVsSummaryVsStructured}`);
    L.push('');
  } else {
    L.push('_No verdict — the real model was not executed._');
    L.push('');
  }

  // 4. Second-best
  L.push('## 4. Second-best Memory Mode');
  L.push('');
  if (rec.secondBest && report.status.modelExecuted) {
    L.push(`**\`${rec.secondBest.memoryMode}\`** — score ${rec.secondBest.score}.`);
    L.push('');
    for (const w of rec.whySecond) L.push(`- ${w}`);
    L.push('');
  } else {
    L.push('_No verdict — the real model was not executed._');
    L.push('');
  }

  // 5. What hurt memory quality
  L.push('## 5. What Hurt Memory Quality');
  L.push('');
  if (report.whatHurtQuality.length === 0) {
    L.push('_No systematic memory-design problem was detected by the deterministic analyzers in this run._');
    L.push('');
  }
  for (const c of report.whatHurtQuality) {
    L.push(`### ${c.cause}`);
    L.push('');
    for (const e of c.evidence) L.push(`- ${e}`);
    L.push('');
  }
  L.push('### Recurring issue patterns (per memory mode)');
  L.push('');
  for (const m of report.perMode) {
    if (m.combo.recurringIssues.length === 0) continue;
    L.push(`- **\`${m.memoryMode}\`**: ${m.combo.recurringIssues.map((i) => `${i.issue} (×${i.count})`).join('; ')}`);
  }
  L.push('');

  // 6. What to fix next
  L.push('## 6. What To Fix Next');
  L.push('');
  for (const f of report.fixNext) L.push(`- ${f}`);
  L.push('');

  // 7. Limitations
  L.push('## 7. Limitations');
  L.push('');
  for (const l of report.limitations) L.push(`- ${l}`);
  L.push('');

  // Appendix
  L.push('## Appendix — Per-memory-mode detail');
  L.push('');
  for (const m of report.perMode) {
    const c = m.combo;
    L.push(`### \`${m.memoryMode}\``);
    L.push('');
    L.push(`- Pass ${c.totals.passedTurns}/${c.totals.turns}; critical ${c.totals.criticalIssues}; repairs ${c.totals.repairs}; fallbacks ${c.totals.fallbacks}.`);
    L.push(`- Groundedness ${c.averages.groundedness}/5; grounded-answer ${pct(c.rates.groundedAnswerRate)}; correction ${pct(c.rates.correctionRate)}; redirect ${pct(c.rates.redirectRate)}; uncertainty ${pct(c.rates.uncertaintyRate)}.`);
    L.push(`- Brevity-ok ${pct(c.rates.brevityOkRate)}; over-explain ${pct(c.rates.overExplainRate)}; warmth ${pct(c.rates.warmthRate)}; advance-early ${pct(c.rates.advanceTooEarlyRate)}; memory-use ${pct(c.rates.memoryUseRate)}; repetition ${pct(c.rates.repetitionRate)}.`);
    L.push(`- Per-case: ${c.perCase.map((p) => `${p.caseTitle} ${p.passedTurns}/${p.totalTurns}`).join(' · ')}`);
    L.push(`- Run dirs: ${m.runDirs.length ? m.runDirs.map((d) => d.replace(`${resolve(HARNESS_ROOT)}/`, '')).join(', ') : '(none)'}`);
    L.push('');
  }
  L.push('_Each run dir has per-turn `memory.sent-to-model.txt` showing the exact memory block sent; the full archive is never included._');
  L.push('');
  return L.join('\n');
}

export function writeMemoryEvalReport(report: MemoryEvalReport): { jsonPath: string; mdPath: string } {
  const reportsDir = resolve(HARNESS_ROOT, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const stamp = report.finishedAt.replace(/[^0-9A-Za-z]+/g, '-');
  const jsonPath = resolve(reportsDir, `memory-evaluation-${stamp}.json`);
  const mdPath = resolve(reportsDir, `memory-evaluation-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(mdPath, `${renderMemoryEvalMarkdown(report)}\n`, 'utf8');
  return { jsonPath, mdPath };
}
