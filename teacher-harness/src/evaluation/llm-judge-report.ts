// ── Teacher Harness — LLM judge report (markdown + JSON) ─────────────
//
// Turns a JudgeEvalOutput (+ the deterministic run's ranking) into the required
// report: executive summary, comparison table, per-dimension breakdown,
// learner-profile breakdown, deterministic-vs-judge disagreement analysis,
// recommendation, and limitations. Writes
// reports/llm-judge-top2-evaluation-<ts>.{json,md}. Never fabricates: if the
// judge did not run, the report says so and lists the env vars to set.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HARNESS_ROOT } from '../config/harness-config';
import { JUDGE_SCORE_DIMENSIONS, JUDGED_PROMPT_VARIANTS, type JudgedPromptVariant, type JudgedTurn, type LlmJudgeScores } from './llm-judge.types';
import type { JudgeEvalOutput } from './run-llm-judge-eval';

const DIM_LABELS: Record<keyof LlmJudgeScores, string> = {
  groundedness: 'Groundedness',
  teachingClarity: 'Teaching clarity',
  brevityFocus: 'Brevity / focus',
  mistakeCorrection: 'Mistake correction',
  checkUnderstanding: 'Check-for-understanding',
  learnerHandling: 'Learner handling',
  noFutureLeakage: 'No future-topic leakage',
  productSuitability: 'Product suitability',
};

interface VariantAgg {
  variant: JudgedPromptVariant;
  judgedTurns: number;
  judgeFailed: number;
  dimAverages: Record<keyof LlmJudgeScores, number>;
  overallAvg: number;
  passRate: number;
  criticalCount: number;
  avgResponseWords: number;
  tagCounts: Record<string, number>;
}

function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}
function round(n: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function aggregateVariant(variant: JudgedPromptVariant, results: JudgedTurn[]): VariantAgg {
  const mine = results.filter((r) => r.input.promptVariant === variant);
  const ok = mine.filter((r): r is Extract<JudgedTurn, { ok: true }> => r.ok);
  const dimSums = {} as Record<keyof LlmJudgeScores, number>;
  for (const d of JUDGE_SCORE_DIMENSIONS) dimSums[d] = 0;
  let overallSum = 0;
  let passes = 0;
  let criticals = 0;
  const tagCounts: Record<string, number> = {};
  for (const r of ok) {
    for (const d of JUDGE_SCORE_DIMENSIONS) dimSums[d] += r.score.scores[d];
    overallSum += r.score.overallScore;
    if (r.score.pass) passes += 1;
    if (r.score.criticalIssue) criticals += 1;
    for (const t of r.score.failureTags) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
  }
  const n = ok.length || 1;
  const dimAverages = {} as Record<keyof LlmJudgeScores, number>;
  for (const d of JUDGE_SCORE_DIMENSIONS) dimAverages[d] = round(dimSums[d] / n);
  const words = mine.map((r) => wordCount(r.input.tutorResponse));
  return {
    variant,
    judgedTurns: ok.length,
    judgeFailed: mine.length - ok.length,
    dimAverages,
    overallAvg: round(overallSum / n),
    passRate: round(passes / n, 3),
    criticalCount: criticals,
    avgResponseWords: words.length ? round(words.reduce((a, b) => a + b, 0) / words.length, 1) : 0,
    tagCounts,
  };
}

interface ProfileComparison {
  profileId: string;
  category: string;
  overall: Record<JudgedPromptVariant, number | null>;
  betterVariant: JudgedPromptVariant | 'tie' | 'n/a';
}

function perProfile(results: JudgedTurn[]): ProfileComparison[] {
  const ids = [...new Set(results.map((r) => r.input.profileId))];
  return ids.map((profileId) => {
    const category = results.find((r) => r.input.profileId === profileId)?.input.category ?? 'unknown';
    const overall = {} as Record<JudgedPromptVariant, number | null>;
    for (const v of JUDGED_PROMPT_VARIANTS) {
      const ok = results.filter(
        (r): r is Extract<JudgedTurn, { ok: true }> => r.ok && r.input.profileId === profileId && r.input.promptVariant === v,
      );
      overall[v] = ok.length ? round(ok.reduce((a, r) => a + r.score.overallScore, 0) / ok.length) : null;
    }
    const [a, b] = JUDGED_PROMPT_VARIANTS;
    let betterVariant: ProfileComparison['betterVariant'] = 'n/a';
    if (overall[a] !== null && overall[b] !== null) {
      betterVariant = overall[a]! > overall[b]! ? a : overall[b]! > overall[a]! ? b : 'tie';
    }
    return { profileId, category, overall, betterVariant };
  });
}

interface Disagreement {
  kind: 'det_pass_judge_fail' | 'det_fail_judge_pass';
  promptVariant: JudgedPromptVariant;
  profileId: string;
  turnId: string;
  judgeOverall: number;
  tags: string[];
  explanation: string;
}

function disagreements(results: JudgedTurn[]): Disagreement[] {
  const out: Disagreement[] = [];
  for (const r of results) {
    if (!r.ok) continue;
    const det = r.input.deterministicPassed;
    if (det === null) continue;
    if (det && !r.score.pass) {
      out.push({ kind: 'det_pass_judge_fail', promptVariant: r.input.promptVariant, profileId: r.input.profileId, turnId: r.input.turnId, judgeOverall: r.score.overallScore, tags: r.score.failureTags, explanation: r.score.explanation });
    } else if (!det && r.score.pass) {
      out.push({ kind: 'det_fail_judge_pass', promptVariant: r.input.promptVariant, profileId: r.input.profileId, turnId: r.input.turnId, judgeOverall: r.score.overallScore, tags: r.score.failureTags, explanation: r.score.explanation });
    }
  }
  return out;
}

/** One persisted per-turn verdict — lets a later judge run compare per turn. */
export interface PersistedTurnVerdict {
  promptVariant: JudgedPromptVariant;
  profileId: string;
  turnId: string;
  overallScore: number;
  pass: boolean;
  criticalIssue: boolean;
  failureTags: string[];
}

/** Comparison of THIS judge against a prior judge run (different model). */
export interface CrossJudge {
  priorModel: string;
  priorOverallByVariant: Partial<Record<JudgedPromptVariant, number>>;
  currentOverallByVariant: Partial<Record<JudgedPromptVariant, number>>;
  priorWinner: JudgedPromptVariant | 'tie' | null;
  currentWinner: JudgedPromptVariant | 'tie' | null;
  judgesAgreeOnWinner: boolean | null;
  /** Prior judge's mean overall minus current judge's mean overall (positive = prior more lenient). */
  meanOverallDelta: number;
  priorLooksTooLenient: boolean;
  /** Turns the prior judge PASSED but this judge FAILED (prior lenient), if per-turn data exists for both. */
  priorPassCurrentFail: number | null;
  currentPassPriorFail: number | null;
  notes: string[];
}

export interface JudgeReport {
  finishedAt: string;
  judgeModel: string | null;
  judgeProviderKind: string | null;
  judgeSource: string | null;
  reusedArtifacts: boolean;
  artifactTimestamp: string | null;
  ran: boolean;
  unavailableReason?: string;
  neededEnv?: string[];
  totals: { totalTurns: number; judgedOk: number; judgeFailed: number; repaired: number };
  variants: VariantAgg[];
  deterministic: Record<JudgedPromptVariant, Record<string, unknown>> | null;
  profileBreakdown: ProfileComparison[];
  disagreements: Disagreement[];
  judgeWinner: JudgedPromptVariant | 'tie' | null;
  deterministicWinner: JudgedPromptVariant | null;
  agree: boolean | null;
  crossJudge: CrossJudge | null;
  perTurn: PersistedTurnVerdict[];
  recommendation: string[];
  limitations: string[];
}

/** Minimal shape read back from a prior judge report JSON for cross-judge comparison. */
export interface PriorJudgeSummary {
  judgeModel: string;
  variants: Array<{ variant: JudgedPromptVariant; overallAvg: number }>;
  judgeWinner: JudgedPromptVariant | 'tie' | null;
  perTurn?: PersistedTurnVerdict[];
}

function collectPerTurn(results: JudgedTurn[]): PersistedTurnVerdict[] {
  return results
    .filter((r): r is Extract<JudgedTurn, { ok: true }> => r.ok)
    .map((r) => ({
      promptVariant: r.input.promptVariant,
      profileId: r.input.profileId,
      turnId: r.input.turnId,
      overallScore: r.score.overallScore,
      pass: r.score.pass,
      criticalIssue: r.score.criticalIssue,
      failureTags: r.score.failureTags,
    }));
}

function buildCrossJudge(perTurn: PersistedTurnVerdict[], currentVariants: VariantAgg[], currentWinner: JudgedPromptVariant | 'tie' | null, prior: PriorJudgeSummary): CrossJudge {
  const priorOverallByVariant: Partial<Record<JudgedPromptVariant, number>> = {};
  for (const v of prior.variants) priorOverallByVariant[v.variant] = v.overallAvg;
  const currentOverallByVariant: Partial<Record<JudgedPromptVariant, number>> = {};
  for (const v of currentVariants) currentOverallByVariant[v.variant] = v.overallAvg;

  const priorMean = prior.variants.length ? prior.variants.reduce((a, v) => a + v.overallAvg, 0) / prior.variants.length : 0;
  const currentMean = currentVariants.length ? currentVariants.reduce((a, v) => a + v.overallAvg, 0) / currentVariants.length : 0;
  const meanOverallDelta = round(priorMean - currentMean);

  // Per-turn pass mismatch (only if the prior report persisted per-turn data).
  let priorPassCurrentFail: number | null = null;
  let currentPassPriorFail: number | null = null;
  if (prior.perTurn?.length) {
    const key = (t: { promptVariant: string; profileId: string; turnId: string }) => `${t.promptVariant}|${t.profileId}|${t.turnId}`;
    const priorByKey = new Map(prior.perTurn.map((t) => [key(t), t]));
    priorPassCurrentFail = 0;
    currentPassPriorFail = 0;
    for (const cur of perTurn) {
      const p = priorByKey.get(key(cur));
      if (!p) continue;
      if (p.pass && !cur.pass) priorPassCurrentFail += 1;
      if (!p.pass && cur.pass) currentPassPriorFail += 1;
    }
  }

  const judgesAgreeOnWinner =
    currentWinner && currentWinner !== 'tie' && prior.judgeWinner && prior.judgeWinner !== 'tie'
      ? currentWinner === prior.judgeWinner
      : null;

  // Prior looks too lenient if it scores markedly higher overall, or passes many turns this judge fails.
  const priorLooksTooLenient = meanOverallDelta >= 1.0 || (priorPassCurrentFail !== null && priorPassCurrentFail >= 5);

  const notes: string[] = [];
  notes.push(`Prior judge (${prior.judgeModel}) mean overall ${round(priorMean)}/10 vs this judge ${round(currentMean)}/10 (Δ ${meanOverallDelta}).`);
  if (priorPassCurrentFail !== null) notes.push(`Turns prior PASSED but this judge FAILED: ${priorPassCurrentFail}; opposite: ${currentPassPriorFail}.`);
  if (priorLooksTooLenient) notes.push(`⚠️ ${prior.judgeModel} appears TOO LENIENT relative to this judge — do not rely on it alone for the final decision.`);

  return {
    priorModel: prior.judgeModel,
    priorOverallByVariant,
    currentOverallByVariant,
    priorWinner: prior.judgeWinner,
    currentWinner,
    judgesAgreeOnWinner,
    meanOverallDelta,
    priorLooksTooLenient,
    priorPassCurrentFail,
    currentPassPriorFail,
    notes,
  };
}

export function buildJudgeReport(
  output: JudgeEvalOutput,
  deterministic: Record<JudgedPromptVariant, Record<string, unknown>> | null,
  prior?: PriorJudgeSummary | null,
): JudgeReport {
  const ran = output.judgeAvailable && output.judgedOk > 0;
  const variants = ran ? JUDGED_PROMPT_VARIANTS.map((v) => aggregateVariant(v, output.results)) : [];
  const perTurn = ran ? collectPerTurn(output.results) : [];

  const judgeWinner = ran
    ? (() => {
        const [a, b] = variants;
        if (!a || !b) return null;
        return a.overallAvg > b.overallAvg ? a.variant : b.overallAvg > a.overallAvg ? b.variant : 'tie';
      })()
    : null;

  const deterministicWinner = deterministic
    ? (() => {
        const [a, b] = JUDGED_PROMPT_VARIANTS;
        const sa = Number(deterministic[a]?.score ?? 0);
        const sb = Number(deterministic[b]?.score ?? 0);
        return sa >= sb ? a : b;
      })()
    : null;

  const agree = judgeWinner && judgeWinner !== 'tie' && deterministicWinner ? judgeWinner === deterministicWinner : null;

  const crossJudge = ran && prior ? buildCrossJudge(perTurn, variants, judgeWinner, prior) : null;

  const recommendation = buildRecommendation({ ran, variants, judgeWinner, deterministicWinner, agree, deterministic, crossJudge });

  return {
    finishedAt: output.finishedAt,
    judgeModel: output.judgeModel ?? null,
    judgeProviderKind: output.judgeProviderKind ?? null,
    judgeSource: output.judgeSource ?? null,
    reusedArtifacts: output.reusedArtifacts,
    artifactTimestamp: output.artifactTimestamp ?? null,
    ran,
    unavailableReason: output.judgeUnavailableReason ?? output.incompleteReason,
    neededEnv: output.neededEnv,
    totals: { totalTurns: output.totalTurns, judgedOk: output.judgedOk, judgeFailed: output.judgeFailed, repaired: output.repaired },
    variants,
    deterministic,
    profileBreakdown: ran ? perProfile(output.results) : [],
    disagreements: ran ? disagreements(output.results) : [],
    judgeWinner,
    deterministicWinner,
    agree,
    crossJudge,
    perTurn,
    recommendation,
    limitations: [
      'The judge is a single cloud LLM and may carry its own bias (e.g. favouring longer, more thorough answers).',
      'Learner turns are SCRIPTED (12 fixed profiles), not real users; multi-turn dynamics are approximated.',
      'The fixed lesson variant resolves to the PLACEHOLDER mock-demo course — absolute scores reflect placeholder text, not real-subject mastery. Read the ranking/agreement, not the raw numbers.',
      'An LLM judge is not a substitute for human review or real product testing.',
      'Re-run on a REAL CourseFactory course (and a second unit) before promoting either prompt as the default.',
    ],
  };
}

function buildRecommendation(params: {
  ran: boolean;
  variants: VariantAgg[];
  judgeWinner: JudgedPromptVariant | 'tie' | null;
  deterministicWinner: JudgedPromptVariant | null;
  agree: boolean | null;
  deterministic: Record<JudgedPromptVariant, Record<string, unknown>> | null;
  crossJudge: CrossJudge | null;
}): string[] {
  const { ran, variants, judgeWinner, deterministicWinner, agree, deterministic, crossJudge } = params;
  if (!ran) {
    return [
      'LLM judge did NOT run — no recommendation can be made from judge data. Configure the judge env vars and re-run.',
    ];
  }
  const full = variants.find((v) => v.variant === 'full_current_prompt');
  const structured = variants.find((v) => v.variant === 'structured_rules_prompt');
  const rec: string[] = [];
  const gap = full && structured ? round(full.overallAvg - structured.overallAvg) : 0;
  const structuredProductOk = structured ? structured.dimAverages.productSuitability >= 3.5 && structured.passRate >= 0.6 : false;

  if (agree === false) {
    rec.push(`Deterministic scorer preferred ${deterministicWinner}, but the LLM judge preferred ${judgeWinner} — treat the judge as the teaching-quality tie-breaker and weight it more heavily.`);
  } else if (agree === true) {
    rec.push(`Both the deterministic scorer and the LLM judge agree the strongest variant is ${judgeWinner}.`);
  }

  if (Math.abs(gap) <= 0.5 && structuredProductOk) {
    rec.push('The judge gap between the two prompts is small (≤0.5 overall) and structured_rules_prompt clears the product-suitability bar → promote structured_rules_prompt as the LOCAL-DEVICE DEFAULT CANDIDATE to free prompt budget for personalization.');
  } else if (gap > 0.5) {
    rec.push(`full_current_prompt leads by ${gap} judge points → keep it as the default candidate for now; consider merging structured_rules_prompt's structure + redirect discipline into it.`);
  } else {
    rec.push('Consider a merged prompt: structured_rules_prompt structure + a one-line redirect/mistake reminder, then re-judge.');
  }

  if (crossJudge) {
    rec.push(
      `This judge is the DECISION-MAKER; ${crossJudge.priorModel} is a secondary sanity check` +
        (crossJudge.priorLooksTooLenient ? ` and looks TOO LENIENT (Δ mean overall ${crossJudge.meanOverallDelta}) — discount it.` : '.'),
    );
    if (crossJudge.judgesAgreeOnWinner === true) rec.push(`Both judges agree the stronger prompt is ${judgeWinner}.`);
    else if (crossJudge.judgesAgreeOnWinner === false) rec.push(`Judges DISAGREE on the winner (${crossJudge.priorModel}: ${crossJudge.priorWinner}, this judge: ${judgeWinner}) — trust this judge.`);
  }

  rec.push(`structured_rules_prompt good enough for product use: ${structuredProductOk ? 'YES (on this placeholder course)' : 'NOT YET — see product-suitability score'}.`);
  rec.push('full_current_prompt remains the QUALITY BASELINE to beat until a compact prompt matches it on a real course.');
  if (deterministic) {
    const room = deterministic.structured_rules_prompt?.personalizationRoomChars;
    if (room) rec.push(`If promoted, structured_rules_prompt frees ~${room} instruction chars for a small personalization block — add incrementally and re-judge for regressions.`);
  }
  rec.push('Do NOT promote either prompt automatically — this is evaluation only. Next: re-run on a real CourseFactory course + a second unit, then a small human spot-check.');
  return rec;
}

// ── Markdown rendering ───────────────────────────────────────────────

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function renderJudgeMarkdown(r: JudgeReport): string {
  const lines: string[] = [];
  lines.push('# LLM Judge Evaluation — Top-2 Prompt Variants');
  lines.push('');
  lines.push(`_Generated ${r.finishedAt}_`);
  lines.push('');

  if (!r.ran) {
    lines.push('## ⚠️ LLM judge did not run');
    lines.push('');
    lines.push(r.unavailableReason ?? 'Unknown reason.');
    if (r.neededEnv?.length) {
      lines.push('');
      lines.push('Set these env vars (values are read from env / `.env`; secrets are never printed):');
      lines.push('```bash');
      for (const k of r.neededEnv) lines.push(`${k}=...`);
      lines.push('```');
    }
    lines.push('');
    lines.push(`Artifacts ${r.reusedArtifacts ? `were found (run ${r.artifactTimestamp}) and are ready to judge` : 'were NOT found'}. The judge pipeline is implemented and will run once credentials are provided.`);
    return lines.join('\n');
  }

  const full = r.variants.find((v) => v.variant === 'full_current_prompt')!;
  const structured = r.variants.find((v) => v.variant === 'structured_rules_prompt')!;

  // 1. Executive summary
  lines.push('## 1. Executive Summary');
  lines.push('');
  lines.push(`- **Judge model:** \`${r.judgeModel}\` (${r.judgeProviderKind ?? '?'}, source: ${r.judgeSource}) — reused prior tutor outputs from run \`${r.artifactTimestamp}\` (no local rerun).`);
  lines.push(`- **Judge calls:** ${r.totals.judgedOk}/${r.totals.totalTurns} succeeded (${r.totals.repaired} needed a JSON repair, ${r.totals.judgeFailed} judge_failed).`);
  lines.push(`- **Deterministic winner:** ${r.deterministicWinner}`);
  lines.push(`- **LLM judge winner:** ${r.judgeWinner} (full ${full.overallAvg}/10 vs structured ${structured.overallAvg}/10)`);
  lines.push(`- **Agreement with deterministic scorer:** ${r.agree === null ? 'n/a' : r.agree ? 'AGREE ✅' : 'DISAGREE ⚠️'}`);
  if (r.crossJudge) {
    lines.push(`- **vs secondary judge (${r.crossJudge.priorModel}):** winner ${r.crossJudge.judgesAgreeOnWinner === null ? 'n/a' : r.crossJudge.judgesAgreeOnWinner ? 'AGREE' : 'DISAGREE'}; secondary ${r.crossJudge.priorLooksTooLenient ? '**appears TOO LENIENT** (discounted)' : 'broadly consistent'} (Δ mean overall ${r.crossJudge.meanOverallDelta}).`);
  }
  lines.push(`- **Recommended default candidate:** ${r.recommendation[1] ?? r.recommendation[0]}`);
  lines.push('');

  // 2. Comparison table
  lines.push('## 2. Comparison Table');
  lines.push('');
  lines.push('| Prompt Variant | Deterministic Score | LLM Judge Avg | Judge Pass Rate | Critical (judge) | Avg Response (words) | Prompt Size (instr chars) | Personalization Room | Recommendation |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |');
  for (const v of r.variants) {
    const det = r.deterministic?.[v.variant] ?? {};
    const detScore = det.score ?? 'n/a';
    const instr = det.instructionChars ?? 'n/a';
    const room = det.personalizationRoom ?? 'n/a';
    const recCell = v.variant === r.judgeWinner ? 'Judge winner' : v.variant === 'structured_rules_prompt' ? 'Compact candidate' : '—';
    lines.push(`| ${v.variant} | ${detScore} | ${v.overallAvg}/10 | ${pct(v.passRate)} | ${v.criticalCount} | ${v.avgResponseWords} | ${instr} | ${room} | ${recCell} |`);
  }
  lines.push('');

  // 3. Dimension breakdown
  lines.push('## 3. Dimension Breakdown (avg judge score, 1–5)');
  lines.push('');
  lines.push(`| Dimension | full_current_prompt | structured_rules_prompt |`);
  lines.push('| --- | ---: | ---: |');
  for (const d of JUDGE_SCORE_DIMENSIONS) {
    lines.push(`| ${DIM_LABELS[d]} | ${full.dimAverages[d]} | ${structured.dimAverages[d]} |`);
  }
  lines.push(`| **Overall (1–10)** | **${full.overallAvg}** | **${structured.overallAvg}** |`);
  lines.push('');

  // 4. Learner profile breakdown
  lines.push('## 4. Learner Profile Breakdown (avg overall /10, better variant)');
  lines.push('');
  lines.push('| Learner Profile | Category | full | structured | Better |');
  lines.push('| --- | --- | ---: | ---: | --- |');
  for (const p of r.profileBreakdown) {
    lines.push(`| ${p.profileId} | ${p.category} | ${p.overall.full_current_prompt ?? 'n/a'} | ${p.overall.structured_rules_prompt ?? 'n/a'} | ${p.betterVariant} |`);
  }
  lines.push('');

  // 5. Disagreement analysis
  lines.push('## 5. Disagreement Analysis (deterministic vs LLM judge)');
  lines.push('');
  const detPassJudgeFail = r.disagreements.filter((d) => d.kind === 'det_pass_judge_fail');
  const detFailJudgePass = r.disagreements.filter((d) => d.kind === 'det_fail_judge_pass');
  lines.push(`- **Deterministic PASS but judge FAIL** (rules passed a weak response): ${detPassJudgeFail.length}`);
  lines.push(`- **Deterministic FAIL but judge PASS** (rules failed a good response): ${detFailJudgePass.length}`);
  lines.push('');
  const showcase = [...detPassJudgeFail, ...detFailJudgePass].slice(0, 12);
  if (showcase.length) {
    lines.push('| Case | Variant | Profile / Turn | Judge overall | Tags | Why |');
    lines.push('| --- | --- | --- | ---: | --- | --- |');
    for (const d of showcase) {
      const kind = d.kind === 'det_pass_judge_fail' ? 'rules-passed-weak' : 'rules-failed-good';
      lines.push(`| ${kind} | ${d.promptVariant} | ${d.profileId}/${d.turnId} | ${d.judgeOverall} | ${d.tags.join(', ') || '—'} | ${d.explanation.replace(/\|/g, '/')} |`);
    }
    lines.push('');
  }
  lines.push('**Teaching-quality issues the rules missed (judge failure tags, counts):**');
  lines.push('');
  for (const v of r.variants) {
    const tags = Object.entries(v.tagCounts).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}×${c}`);
    lines.push(`- ${v.variant}: ${tags.length ? tags.join(', ') : '(none)'}`);
  }
  lines.push('');

  // 5b. Judge-model comparison (deterministic vs flash-lite vs this judge)
  if (r.crossJudge) {
    const cj = r.crossJudge;
    lines.push('## 5b. Judge Model Comparison (leniency / bias check)');
    lines.push('');
    lines.push(`| Signal | ${cj.priorModel} (secondary) | ${r.judgeModel} (decision-maker) |`);
    lines.push('| --- | ---: | ---: |');
    for (const v of JUDGED_PROMPT_VARIANTS) {
      lines.push(`| ${v} overall /10 | ${cj.priorOverallByVariant[v] ?? 'n/a'} | ${cj.currentOverallByVariant[v] ?? 'n/a'} |`);
    }
    lines.push(`| winner | ${cj.priorWinner ?? 'n/a'} | ${cj.currentWinner ?? 'n/a'} |`);
    lines.push('');
    for (const n of cj.notes) lines.push(`- ${n}`);
    lines.push(`- **Judge leniency / model bias:** ${cj.priorLooksTooLenient ? `\`${cj.priorModel}\` is TOO LENIENT and MUST NOT be the final decision-maker; use \`${r.judgeModel}\`.` : `no strong leniency gap detected, but \`${r.judgeModel}\` remains the decision-maker.`}`);
    lines.push('');
  }

  // 6. Recommendation
  lines.push('## 6. Recommendation');
  lines.push('');
  for (const rec of r.recommendation) lines.push(`- ${rec}`);
  lines.push('');

  // 7. Limitations
  lines.push('## 7. Limitations');
  lines.push('');
  for (const l of r.limitations) lines.push(`- ${l}`);
  lines.push('');
  lines.push('> Production Tutor prompt was NOT modified or promoted. This is evaluation only.');
  return lines.join('\n');
}

/**
 * Load the newest prior judge report whose judge model DIFFERS from `currentModel`,
 * for the cross-judge (leniency) comparison. Returns null if none exists.
 */
export function readPriorJudgeReport(currentModel: string | null): PriorJudgeSummary | null {
  const reportsDir = resolve(HARNESS_ROOT, 'reports');
  if (!existsSync(reportsDir)) return null;
  const files = readdirSync(reportsDir)
    .filter((f) => f.startsWith('llm-judge-top2-evaluation-') && f.endsWith('.json'))
    .sort()
    .reverse();
  for (const f of files) {
    let parsed: Partial<JudgeReport> | null = null;
    try {
      parsed = JSON.parse(readFileSync(resolve(reportsDir, f), 'utf8')) as Partial<JudgeReport>;
    } catch {
      continue;
    }
    if (!parsed?.ran || !parsed.judgeModel || parsed.judgeModel === currentModel) continue;
    const variants = (parsed.variants ?? []).map((v) => ({ variant: v.variant, overallAvg: v.overallAvg }));
    if (!variants.length) continue;
    return {
      judgeModel: parsed.judgeModel,
      variants,
      judgeWinner: parsed.judgeWinner ?? null,
      perTurn: parsed.perTurn,
    };
  }
  return null;
}

export function writeJudgeReport(report: JudgeReport): { jsonPath: string; mdPath: string } {
  const reportsDir = resolve(HARNESS_ROOT, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const stamp = report.finishedAt.replace(/[:.]/g, '-');
  const jsonPath = resolve(reportsDir, `llm-judge-top2-evaluation-${stamp}.json`);
  const mdPath = resolve(reportsDir, `llm-judge-top2-evaluation-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(mdPath, `${renderJudgeMarkdown(report)}\n`, 'utf8');
  return { jsonPath, mdPath };
}
