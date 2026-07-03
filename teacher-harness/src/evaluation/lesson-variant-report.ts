// ── Teacher Harness — lesson-variant report builder + writer ─────────
//
// Renders the focused lesson-variant experiment (Llama 3.2 3B + repair_pass,
// varying only the CoursePackage style) into a dedicated report:
//   reports/lesson-variant-evaluation-<timestamp>.{json,md}
//
// Everything is derived deterministically from the measured aggregates — no
// LLM writes this report. Ranking uses the same composite score as the
// model×strategy lab so the two are comparable.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HARNESS_ROOT } from '../config/harness-config';
import type { EvalComboResult } from './eval-types';
import type { LessonVariantResult, LessonVariantRunOutput } from './run-lesson-variant-eval';

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

interface VariantRankRow {
  rank: number;
  variantId: string;
  variantName: string;
  detailLevel?: string;
  guidanceLevel?: string;
  score: number;
  passedTurns: number;
  totalTurns: number;
  criticalIssues: number;
  avgLatencyMs: number;
  avgWords: number;
  repairs: number;
  notes: string;
}

export interface LessonVariantReport {
  finishedAt: string;
  status: {
    realWebLLM: boolean;
    modelExecuted: boolean;
    model: string;
    strategy: string;
    completed: boolean;
    incompleteReason?: string;
    statement: string;
  };
  metadata: {
    coursePackageVariant: 'course-factory-output-variants';
    courseSource: string;
    scoringMethod: 'deterministic_rules_no_llm_judge';
    isPlaceholderCourse: boolean;
  };
  variantMapping: LessonVariantRunOutput['resolution']['mapping'];
  evaluatedVariants: string[];
  missingVariants: string[];
  ranking: VariantRankRow[];
  recommendations: {
    best: VariantRankRow | null;
    secondBest: VariantRankRow | null;
    whyBest: string[];
    whySecond: string[];
    mostCompatibleStyle: string;
  };
  whatHurtQuality: Array<{ cause: string; evidence: string[] }>;
  fixNext: string[];
  limitations: string[];
  perVariant: Array<{
    variantId: string;
    variantName: string;
    courseId: string;
    unitId: string;
    combo: EvalComboResult;
    runDirs: string[];
  }>;
}

function variantNotes(r: LessonVariantResult): string {
  const c = r.combo;
  const parts: string[] = [];
  if (c.rates.futureTopicLeakRate > 0) parts.push(`leaks (${pct(c.rates.futureTopicLeakRate)})`);
  if (c.totals.criticalIssues === 0) parts.push('0 critical');
  if (c.rates.advanceTooEarlyRate > 0) parts.push(`advances early (${pct(c.rates.advanceTooEarlyRate)})`);
  if (c.rates.overExplainRate >= 0.3) parts.push('over-explains');
  if (c.averages.groundedness >= 3.5) parts.push('well grounded');
  else if (c.averages.groundedness < 2.5) parts.push('weak grounding');
  if (c.totals.repairs > 0) parts.push(`${c.totals.repairs} repair(s)`);
  if (parts.length === 0) parts.push('balanced');
  return parts.join('; ');
}

/** Best/worst learner case for a combo, by per-case pass ratio. */
function caseExtremes(combo: EvalComboResult): { best: string; worst: string } {
  const sorted = [...combo.perCase].sort(
    (a, b) => b.passedTurns / Math.max(1, b.totalTurns) - a.passedTurns / Math.max(1, a.totalTurns),
  );
  const fmt = (c: (typeof sorted)[number]) => `${c.caseTitle} (${c.passedTurns}/${c.totalTurns})`;
  return { best: sorted.length ? fmt(sorted[0]) : 'n/a', worst: sorted.length ? fmt(sorted[sorted.length - 1]) : 'n/a' };
}

function analyzeCauses(results: LessonVariantResult[]): Array<{ cause: string; evidence: string[] }> {
  const buckets: Array<{ cause: string; evidence: string[] }> = [];
  const add = (cause: string, evidence: string[]) => {
    if (evidence.length) buckets.push({ cause, evidence });
  };
  const byGuidance = (needle: string) => results.filter((r) => (r.guidanceLevel ?? '').includes(needle));

  // Lesson too free / too little guidance.
  const freeAdvance = results
    .filter((r) => (r.guidanceLevel === 'low') && (r.combo.rates.advanceTooEarlyRate > 0 || r.combo.totals.criticalIssues > 0))
    .map((r) => `${r.variantId}: ${r.combo.totals.criticalIssues} critical, advances early ${pct(r.combo.rates.advanceTooEarlyRate)} — low-guidance package`);
  add('Lesson too free / too little guidance (weak drift & advancement control)', freeAdvance);

  // Lesson too detailed / too much context.
  const detailedVerbose = results
    .filter((r) => (r.detailLevel === 'high') && (r.combo.rates.overExplainRate >= 0.25 || r.combo.averages.responseWords > 110))
    .map((r) => `${r.variantId}: over-explains ${pct(r.combo.rates.overExplainRate)}, avg ${Math.round(r.combo.averages.responseWords)} words — high-detail package`);
  add('Lesson too detailed / too much context (verbosity, over-explaining)', detailedVerbose);

  // Weak grounding (context too small or too noisy).
  const weakGround = results
    .filter((r) => r.combo.averages.groundedness < 2.5)
    .map((r) => `${r.variantId}: avg groundedness ${r.combo.averages.groundedness}/5`);
  add('Grounding gaps (context too small, or too noisy to retrieve from)', weakGround);

  // Weak common-mistake handling.
  const weakCorrection = results
    .filter((r) => r.combo.rates.correctionRate < 0.75)
    .map((r) => `${r.variantId}: used a prepared correction in only ${pct(r.combo.rates.correctionRate)} of relevant turns`);
  add('Weak common-mistake handling (prepared corrections not used)', weakCorrection);

  // Repetition.
  const rep = results
    .filter((r) => r.combo.rates.repetitionRate >= 0.2)
    .map((r) => `${r.variantId}: ${pct(r.combo.rates.repetitionRate)} of replies repeat an earlier reply`);
  add('Repetition across turns', rep);

  // Robotic / over-controlled (very-high guidance).
  const robotic = byGuidance('very_high')
    .filter((r) => r.combo.averages.responseWords > 110 || r.combo.rates.warmthRate < 0.3)
    .map((r) => `${r.variantId}: avg ${Math.round(r.combo.averages.responseWords)} words, warmth ${pct(r.combo.rates.warmthRate)} — very-high guidance may over-control`);
  add('Lesson too guided / over-controlled (robotic, verbose)', robotic);

  return buckets;
}

function buildFixNext(best: LessonVariantResult | undefined, causes: Array<{ cause: string }>): string[] {
  const fired = (needle: string) => causes.some((c) => c.cause.toLowerCase().includes(needle));
  const fixes: string[] = [];
  if (best) {
    fixes.push(
      `Prefer the "${best.variantId}" lesson style (detail=${best.detailLevel ?? '?'}, guidance=${best.guidanceLevel ?? '?'}) as the default for this local model, and add a CourseFactory preset that emits it.`,
    );
  }
  if (fired('too free')) fixes.push('Raise the minimum guidance level: add explicit hint/correction/advancement rules to the TeacherBrain so a weak model does not drift or advance early.');
  if (fired('too detailed') || fired('over-controlled')) fixes.push('Cap KB chunk count/length for weak models — reduce answer-key and guideline verbosity so the tutor stops over-explaining.');
  if (fired('grounding')) fixes.push('Tune KB chunk size/tags so the deterministic retriever matches learner phrasing (too few chunks starves grounding; too many add noise).');
  if (fired('common-mistake')) fixes.push('Add one canonical phrasing per common mistake so a weak model can quote the correction reliably.');
  if (fired('repetition')) fixes.push('Feed the "already covered / already hinted" lesson-memory fields into a do-not-repeat instruction.');
  fixes.push('Keep lesson completion disabled and let the harness own advancement; add "never announce moving on" phrasing to constraints.');
  fixes.push('Re-run this experiment on a REAL (non-placeholder) CourseFactory course and a second unit before locking in the winning style.');
  return fixes;
}

export function buildLessonVariantReport(output: LessonVariantRunOutput, finishedAt: string): LessonVariantReport {
  const evaluated = output.results.map((r) => r.variantId);
  const missing = output.resolution.mapping.filter((m) => !m.found).map((m) => m.variantId);
  const modelExecuted = output.modelExecuted;
  const completed = modelExecuted && output.results.length > 0 && !output.incompleteReason;

  // Placeholder detection: the mock-demo variant course is a placeholder.
  const isPlaceholder = output.results.some((r) => /mock|placeholder/i.test(r.courseId));

  const sorted = [...output.results].sort((a, b) => b.combo.compositeScore - a.combo.compositeScore);
  const ranking: VariantRankRow[] = sorted.map((r, i) => ({
    rank: i + 1,
    variantId: r.variantId,
    variantName: r.variantName,
    detailLevel: r.detailLevel,
    guidanceLevel: r.guidanceLevel,
    score: r.combo.compositeScore,
    passedTurns: r.combo.totals.passedTurns,
    totalTurns: r.combo.totals.turns,
    criticalIssues: r.combo.totals.criticalIssues,
    avgLatencyMs: r.combo.averages.latencyMs,
    avgWords: r.combo.averages.responseWords,
    repairs: r.combo.totals.repairs,
    notes: variantNotes(r),
  }));

  const best = sorted[0];
  const second = sorted[1];
  const causes = analyzeCauses(output.results);

  const whyBest: string[] = [];
  if (best && modelExecuted) {
    const ext = caseExtremes(best.combo);
    whyBest.push(
      `Pass rate ${pct(best.combo.rates.passRate)}, ${best.combo.totals.criticalIssues} critical issue(s), groundedness ${best.combo.averages.groundedness}/5, future-topic leakage ${pct(best.combo.rates.futureTopicLeakRate)}, avg ${Math.round(best.combo.averages.responseWords)} words at ${seconds(best.combo.averages.latencyMs)}/turn.`,
      `Handled best: ${ext.best}. Still struggled with: ${ext.worst}.`,
      `Style: lesson detail=${best.detailLevel ?? '?'}, tutor guidance=${best.guidanceLevel ?? '?'}.`,
    );
  }
  const whySecond: string[] = [];
  if (second && modelExecuted) {
    const ext = caseExtremes(second.combo);
    whySecond.push(
      `Pass rate ${pct(second.combo.rates.passRate)}, ${second.combo.totals.criticalIssues} critical, groundedness ${second.combo.averages.groundedness}/5, avg ${Math.round(second.combo.averages.responseWords)} words at ${seconds(second.combo.averages.latencyMs)}/turn.`,
      best
        ? `vs the winner: ${second.combo.compositeScore >= best.combo.compositeScore - 3 ? 'nearly tied' : 'clearly behind'}; ${second.combo.averages.latencyMs < best.combo.averages.latencyMs ? 'faster' : 'slower'}, ${second.combo.totals.criticalIssues <= best.combo.totals.criticalIssues ? 'no more critical issues' : 'more critical issues'}.`
        : '',
      `Handled best: ${ext.best}. Struggled with: ${ext.worst}.`,
    );
  }

  const statement = modelExecuted
    ? 'Actual Llama 3.2 3B (WebLLM) was tested for every lesson variant.'
    : 'Actual Llama 3.2 3B could not be executed from this runner. No quality verdict.';

  const limitations: string[] = [
    `This experiment evaluates ONLY ${output.modelName} — no other model was run.`,
    `Only the ${output.strategy} strategy was used — strategies were not compared.`,
    isPlaceholder
      ? 'IMPORTANT: the CourseFactory variant output is the PLACEHOLDER "mock-demo" course (its unit goal is literally "restate the single idea of this mock unit"). The DETAIL and GUIDANCE axes differ for real (2→6 KB chunks, 1→4 mistakes, free→rigid TeacherBrain), so the variant RANKING is meaningful, but absolute teaching-quality numbers reflect structure/guidance handling on placeholder text, not mastery of a real subject. Re-run on a real course before locking anything in.'
      : 'Evaluated against real (non-placeholder) CourseFactory content.',
    'On placeholder content there is no concrete future-topic syntax to leak (no f-strings/end=/.then), so the future-topic-leakage dimension is near-zero here by construction — do not read a low leakage rate as proof the package prevents leakage.',
    'Learner turns are SCRIPTED and do not adapt to the tutor; multi-turn recovery is only approximated.',
    'Scoring is deterministic regex/token-overlap heuristics (no LLM judge): false negatives (prose teaching without trigger vocabulary) and false positives (valid replies outside the detectors\' vocabulary) both occur.',
    'Latency is REAL on-device inference on this machine\'s GPU; other hardware will differ, and pacing waits are excluded.',
    'Results may not generalise to other topics or units; unit choice was the first unit shared across variants.',
    ...(missing.length ? [`Variants not evaluated (missing/failed in CourseFactory output): ${missing.join(', ')}.`] : []),
    ...(output.incompleteReason ? [`Run did not fully complete: ${output.incompleteReason}`] : []),
  ];

  return {
    finishedAt,
    status: {
      realWebLLM: modelExecuted,
      modelExecuted,
      model: output.modelName,
      strategy: output.strategy,
      completed,
      incompleteReason: output.incompleteReason,
      statement,
    },
    metadata: {
      coursePackageVariant: 'course-factory-output-variants',
      courseSource: 'course-factory/output/variants/',
      scoringMethod: 'deterministic_rules_no_llm_judge',
      isPlaceholderCourse: isPlaceholder,
    },
    variantMapping: output.resolution.mapping,
    evaluatedVariants: evaluated,
    missingVariants: missing,
    ranking,
    recommendations: {
      best: ranking[0] ?? null,
      secondBest: ranking[1] ?? null,
      whyBest,
      whySecond,
      mostCompatibleStyle: best
        ? `detail=${best.detailLevel ?? '?'} + guidance=${best.guidanceLevel ?? '?'} ("${best.variantId}")`
        : 'n/a',
    },
    whatHurtQuality: causes,
    fixNext: buildFixNext(best, causes),
    limitations,
    perVariant: output.results.map((r) => ({
      variantId: r.variantId,
      variantName: r.variantName,
      courseId: r.courseId,
      unitId: r.unitId,
      combo: r.combo,
      runDirs: r.runDirs,
    })),
  };
}

// ── Markdown rendering ───────────────────────────────────────────────

export function renderLessonVariantMarkdown(report: LessonVariantReport): string {
  const L: string[] = [];
  const rec = report.recommendations;

  L.push('# Lesson-Variant Tutor-Quality Evaluation');
  L.push('');
  L.push(`- **Finished:** ${report.finishedAt}`);
  L.push(`- **Model (fixed):** ${report.status.model}`);
  L.push(`- **Strategy (fixed):** \`${report.status.strategy}\``);
  L.push(`- **Course source:** ${report.metadata.courseSource}`);
  L.push(`- **Scoring:** ${report.metadata.scoringMethod}`);
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
    L.push(
      '> ⚠️ **Placeholder content.** The only CourseFactory variant output available is the "mock-demo" placeholder ' +
        'course. The variant STRUCTURE (detail + guidance) differs for real, so the ranking is meaningful, but the ' +
        'absolute numbers are about how the model handles each package STYLE, not mastery of a real subject. See §7.',
    );
    L.push('');
  }

  // 1. Executive summary
  L.push('## 1. Executive Summary');
  L.push('');
  L.push(`- **Best lesson variant:** ${rec.best ? `\`${rec.best.variantId}\` (${rec.best.variantName}) — score ${rec.best.score}` : 'n/a'}`);
  L.push(`- **Second-best lesson variant:** ${rec.secondBest ? `\`${rec.secondBest.variantId}\` (${rec.secondBest.variantName}) — score ${rec.secondBest.score}` : 'n/a'}`);
  L.push(`- **Real Llama 3.2 3B WebLLM used:** ${report.status.realWebLLM ? 'YES' : '**NO**'}`);
  L.push(`- **Strategy used:** \`${report.status.strategy}\` (fixed)`);
  L.push(`- **Most compatible lesson style for this model:** ${rec.mostCompatibleStyle}`);
  L.push('');

  // 2. Comparison table
  L.push('## 2. Comparison Table');
  L.push('');
  L.push('| Rank | Lesson Variant | Detail | Guidance | Score | Passed Turns | Critical Issues | Avg Latency | Avg Length | Repairs | Notes |');
  L.push('| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const r of report.ranking) {
    L.push(
      `| ${r.rank} | \`${r.variantId}\` | ${r.detailLevel ?? '?'} | ${r.guidanceLevel ?? '?'} | ${r.score} | ${r.passedTurns}/${r.totalTurns} | ${r.criticalIssues} | ${seconds(r.avgLatencyMs)} | ${Math.round(r.avgWords)} words | ${r.repairs} | ${r.notes} |`,
    );
  }
  L.push('');
  L.push('Composite score (0–100) = 40·turn-pass-rate + 15·groundedness + 15·no-future-leakage + 10·no-critical-turns + 10·brevity-discipline + 10·expected-behaviours (same scale as the model×strategy lab).');
  L.push('');

  // Variant → file mapping
  L.push('### Variant → file mapping');
  L.push('');
  L.push('| Variant | Found | File | Course id | Selected unit | Comparable |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for (const m of report.variantMapping) {
    L.push(
      `| \`${m.variantId}\` | ${m.found ? '✅' : '❌'} | ${m.file ?? '—'} | ${m.courseId ?? '—'} | ${m.selectedUnitId ?? '—'} | ${m.note} |`,
    );
  }
  L.push('');

  // 3. Best variant recommendation
  L.push('## 3. Best Lesson Variant Recommendation');
  L.push('');
  if (rec.best && report.status.modelExecuted) {
    L.push(`**\`${rec.best.variantId}\` (${rec.best.variantName})** — score ${rec.best.score}.`);
    L.push('');
    for (const w of rec.whyBest) L.push(`- ${w}`);
    const bestCombo = report.perVariant.find((v) => v.variantId === rec.best?.variantId)?.combo;
    const shouldPrefer = bestCombo && bestCombo.totals.criticalIssues === 0 && bestCombo.rates.passRate >= 0.7;
    L.push(`- **Should this become the preferred CoursePackage style?** ${shouldPrefer ? 'Yes for this local model — it had the best score with no critical issues. Confirm on a real (non-placeholder) course first.' : 'Lean yes, but validate on real content — the margin and/or failure profile is not yet decisive.'}`);
    L.push('- **What should change in CourseFactory later if this holds:** add a preset that emits this detail/guidance combination by default for weak/local target models.');
    L.push('');
  } else {
    L.push('_No verdict — the real model was not executed._');
    L.push('');
  }

  // 4. Second-best
  L.push('## 4. Second-best Variant');
  L.push('');
  if (rec.secondBest && report.status.modelExecuted) {
    L.push(`**\`${rec.secondBest.variantId}\` (${rec.secondBest.variantName})** — score ${rec.secondBest.score}.`);
    L.push('');
    for (const w of rec.whySecond) L.push(`- ${w}`);
    L.push(`- **Good fallback?** ${rec.secondBest.criticalIssues === 0 ? 'Yes — a viable alternative if the winner is too slow or verbose in practice.' : 'Only with caution — it still produced critical issues.'}`);
    L.push('');
  } else {
    L.push('_No verdict — the real model was not executed._');
    L.push('');
  }

  // 5. What hurt quality
  L.push('## 5. What Hurt Lesson Quality');
  L.push('');
  if (report.whatHurtQuality.length === 0) {
    L.push('_No systematic lesson-design problem was detected by the deterministic analyzers in this run._');
    L.push('');
  }
  for (const c of report.whatHurtQuality) {
    L.push(`### ${c.cause}`);
    L.push('');
    for (const e of c.evidence) L.push(`- ${e}`);
    L.push('');
  }
  L.push('### Recurring issue patterns (per variant)');
  L.push('');
  for (const v of report.perVariant) {
    if (v.combo.recurringIssues.length === 0) continue;
    L.push(`- **\`${v.variantId}\`**: ${v.combo.recurringIssues.map((i) => `${i.issue} (×${i.count})`).join('; ')}`);
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

  // Appendix: per-variant detail + run dirs
  L.push('## Appendix — Per-variant detail');
  L.push('');
  for (const v of report.perVariant) {
    const c = v.combo;
    L.push(`### \`${v.variantId}\` — ${v.variantName}`);
    L.push('');
    L.push(`- Course/unit: ${v.courseId} / ${v.unitId}`);
    L.push(`- Pass ${c.totals.passedTurns}/${c.totals.turns}; critical ${c.totals.criticalIssues}; repairs ${c.totals.repairs}; fallbacks ${c.totals.fallbacks}.`);
    L.push(`- Groundedness ${c.averages.groundedness}/5; grounded-answer rate ${pct(c.rates.groundedAnswerRate)}; correction rate ${pct(c.rates.correctionRate)}; redirect rate ${pct(c.rates.redirectRate)}; uncertainty rate ${pct(c.rates.uncertaintyRate)}.`);
    L.push(`- Brevity-ok ${pct(c.rates.brevityOkRate)}; over-explain ${pct(c.rates.overExplainRate)}; warmth ${pct(c.rates.warmthRate)}; advance-early ${pct(c.rates.advanceTooEarlyRate)}; memory-use ${pct(c.rates.memoryUseRate)}; repetition ${pct(c.rates.repetitionRate)}.`);
    L.push(`- Per-case: ${c.perCase.map((p) => `${p.caseTitle} ${p.passedTurns}/${p.totalTurns}`).join(' · ')}`);
    L.push(`- Run dirs: ${v.runDirs.length ? v.runDirs.map((d) => d.replace(`${resolve(HARNESS_ROOT)}/`, '')).join(', ') : '(none)'}`);
    L.push('');
  }
  L.push('_Full per-turn transcripts, dimensions and telemetry are in the JSON report next to this file and in each run dir._');
  L.push('');
  return L.join('\n');
}

export function writeLessonVariantReport(report: LessonVariantReport): { jsonPath: string; mdPath: string } {
  const reportsDir = resolve(HARNESS_ROOT, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const stamp = report.finishedAt.replace(/[^0-9A-Za-z]+/g, '-');
  const jsonPath = resolve(reportsDir, `lesson-variant-evaluation-${stamp}.json`);
  const mdPath = resolve(reportsDir, `lesson-variant-evaluation-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(mdPath, `${renderLessonVariantMarkdown(report)}\n`, 'utf8');
  return { jsonPath, mdPath };
}
