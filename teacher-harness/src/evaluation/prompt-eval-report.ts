// ── Teacher Harness — prompt-efficiency report builder + writer ──────
//
// Renders the prompt-efficiency experiment (Llama 3.2 3B + repair_pass +
// high_very_guided + last_messages_only(8), varying only the tutor prompt
// variant) into reports/prompt-efficiency-evaluation-<timestamp>.{json,md}.
// Deterministic — no LLM writes this report.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HARNESS_ROOT } from '../config/harness-config';
import type { EvalComboResult } from './eval-types';
import type { TutorPromptVariant } from '../runtime/tutor-prompt-variants';
import { PROMPT_EVAL_PROFILE_CATEGORY, type LearnerCategory } from './prompt-eval-profiles';
import type { PromptEvalRunOutput, PromptModeResult } from './run-prompt-eval';

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** Personalization room bucket from how much shorter the instructions are than the full prompt. */
function personalizationRoom(instructionChars: number, fullInstructionChars: number): string {
  if (fullInstructionChars <= 0) return 'Unknown';
  const saved = fullInstructionChars - instructionChars;
  const ratio = saved / fullInstructionChars;
  if (instructionChars >= fullInstructionChars) return 'Low';
  if (ratio >= 0.7) return 'Very high';
  if (ratio >= 0.45) return 'High';
  if (ratio >= 0.2) return 'Medium';
  return 'Low';
}

interface PromptRankRow {
  rank: number;
  promptVariant: TutorPromptVariant;
  score: number;
  passedTurns: number;
  totalTurns: number;
  criticalIssues: number;
  avgWords: number;
  avgLatencyMs: number;
  systemPromptChars: number;
  instructionChars: number;
  approxSystemTokens: number;
  personalizationRoom: string;
  personalizationRoomChars: number;
  repairs: number;
  notes: string;
}

export interface PromptEvalReport {
  finishedAt: string;
  status: {
    realWebLLM: boolean;
    modelExecuted: boolean;
    completed: boolean;
    model: string;
    strategy: string;
    lessonVariant: string;
    memoryMode: string;
    lastMessagesLimit: number;
    profileCount: number;
    incompleteReason?: string;
    statement: string;
  };
  metadata: {
    courseSource: string;
    courseId: string | null;
    unitId: string | null;
    scoringMethod: 'deterministic_rules_no_llm_judge';
    isPlaceholderCourse: boolean;
    productionPromptReplaced: false;
  };
  promptVariantsEvaluated: TutorPromptVariant[];
  ranking: PromptRankRow[];
  learnerBreakdown: {
    bestForConfused: string;
    bestForImpatient: string;
    bestForStruggling: string;
    overExplainedMostToFast: string;
    driftedMostOffTopicFuture: string;
    bestForVagueMinimal: string;
    perCategory: Array<{ category: LearnerCategory; bestVariant: string; bestPassRate: number }>;
  };
  recommendations: {
    best: PromptRankRow | null;
    secondBest: PromptRankRow | null;
    shortestAcceptable: PromptRankRow | null;
    whyBest: string[];
    canShortenSafely: boolean;
    personalizationBudget: string[];
  };
  whatHurtQuality: Array<{ cause: string; evidence: string[] }>;
  fixNext: string[];
  limitations: string[];
  perVariant: Array<{ promptVariant: TutorPromptVariant; combo: EvalComboResult; promptSizes: PromptModeResult['promptSizes']; runDirCount: number }>;
}

/** profileId from a caseId of the form "<promptVariant>:<profileId>". */
function profileIdOf(caseId: string): string {
  const idx = caseId.indexOf(':');
  return idx >= 0 ? caseId.slice(idx + 1) : caseId;
}

/** Pass ratio for one combo restricted to cases whose profile is in `categories`. */
function passRateForCategories(combo: EvalComboResult, categories: LearnerCategory[]): number {
  const set = new Set(categories);
  const cases = combo.perCase.filter((c) => set.has(PROMPT_EVAL_PROFILE_CATEGORY[profileIdOf(c.caseId)]));
  const total = cases.reduce((a, c) => a + c.totalTurns, 0);
  const passed = cases.reduce((a, c) => a + c.passedTurns, 0);
  return total === 0 ? 0 : passed / total;
}

/** Over-explain rate for one combo restricted to a category (fast learners). */
function overExplainForCategory(result: PromptModeResult, category: LearnerCategory): number {
  const ids = new Set(
    result.combo.perCase.map((c) => c.caseId).filter((id) => PROMPT_EVAL_PROFILE_CATEGORY[profileIdOf(id)] === category),
  );
  const turns = result.combo.turns.filter((t) => ids.has(t.caseId));
  if (turns.length === 0) return 0;
  return turns.filter((t) => t.dimensions.overExplained).length / turns.length;
}

/** Future/off-topic leak+drift rate for one combo (redirect misses + leakage). */
function driftForOffTopic(result: PromptModeResult): number {
  const cats: LearnerCategory[] = ['off_topic', 'future_topic'];
  const set = new Set(cats);
  const ids = new Set(
    result.combo.perCase.map((c) => c.caseId).filter((id) => set.has(PROMPT_EVAL_PROFILE_CATEGORY[profileIdOf(id)])),
  );
  const turns = result.combo.turns.filter((t) => ids.has(t.caseId));
  if (turns.length === 0) return 0;
  const drifted = turns.filter((t) => t.dimensions.futureTopicLeak || t.dimensions.forbiddenTopicLeak || !t.passed).length;
  return drifted / turns.length;
}

function bestVariantForCategories(results: PromptModeResult[], categories: LearnerCategory[]): { variant: string; rate: number } {
  let best = { variant: 'n/a', rate: -1 };
  for (const r of results) {
    const rate = passRateForCategories(r.combo, categories);
    if (rate > best.rate) best = { variant: r.promptVariant, rate };
  }
  return best;
}

function variantNotes(r: PromptModeResult, fullInstructionChars: number): string {
  const c = r.combo;
  const parts: string[] = [];
  parts.push(c.totals.criticalIssues === 0 ? '0 critical' : `${c.totals.criticalIssues} critical`);
  const room = personalizationRoom(r.promptSizes.instructionChars, fullInstructionChars);
  if (room === 'Very high') parts.push('very short prompt');
  if (c.rates.overExplainRate >= 0.3) parts.push('over-explains');
  if (c.averages.groundedness < 2.5) parts.push('weak grounding');
  else if (c.averages.groundedness >= 3.5) parts.push('well grounded');
  if (c.rates.futureTopicLeakRate > 0) parts.push(`leaks (${pct(c.rates.futureTopicLeakRate)})`);
  return parts.join('; ');
}

function analyzeCauses(results: PromptModeResult[], fullInstructionChars: number): Array<{ cause: string; evidence: string[] }> {
  const buckets: Array<{ cause: string; evidence: string[] }> = [];
  const add = (cause: string, evidence: string[]) => {
    if (evidence.length) buckets.push({ cause, evidence });
  };
  const short = results.filter((r) => personalizationRoom(r.promptSizes.instructionChars, fullInstructionChars) === 'Very high');
  add('Prompt too short (under-specified → weaker discipline)', short
    .filter((r) => r.combo.totals.criticalIssues > 0 || r.combo.rates.passRate < 0.7)
    .map((r) => `${r.promptVariant}: ${r.combo.totals.criticalIssues} critical, pass ${pct(r.combo.rates.passRate)} at only ${r.promptSizes.instructionChars} instruction chars`));
  add('Prompt too verbose (large budget, little quality gain)', results
    .filter((r) => r.promptSizes.instructionChars >= fullInstructionChars && r.combo.rates.overExplainRate >= 0.25)
    .map((r) => `${r.promptVariant}: ${r.promptSizes.instructionChars} instruction chars, over-explains ${pct(r.combo.rates.overExplainRate)}`));
  add('Weak common-mistake correction', results
    .filter((r) => r.combo.rates.correctionRate < 0.75)
    .map((r) => `${r.promptVariant}: correction rate ${pct(r.combo.rates.correctionRate)}`));
  add('Too much lecture behavior (over-explaining)', results
    .filter((r) => r.combo.rates.overExplainRate >= 0.3)
    .map((r) => `${r.promptVariant}: over-explain ${pct(r.combo.rates.overExplainRate)}, avg ${Math.round(r.combo.averages.responseWords)} words`));
  add('Weak redirect discipline (off-topic/future drift)', results
    .filter((r) => driftForOffTopic(r) >= 0.34)
    .map((r) => `${r.promptVariant}: off-topic/future drift ${pct(driftForOffTopic(r))}`));
  add('Repair pass needed too often', results
    .filter((r) => r.combo.totals.repairs >= Math.ceil(r.combo.totals.turns * 0.25))
    .map((r) => `${r.promptVariant}: ${r.combo.totals.repairs} repairs over ${r.combo.totals.turns} turns`));
  return buckets;
}

export function buildPromptEvalReport(output: PromptEvalRunOutput, finishedAt: string): PromptEvalReport {
  const modelExecuted = output.modelExecuted;
  const completed = modelExecuted && output.results.length > 0 && !output.incompleteReason;
  const isPlaceholder = /mock|placeholder/i.test(output.variantCourseId ?? '');

  const full = output.results.find((r) => r.promptVariant === 'full_current_prompt');
  const fullInstructionChars = full?.promptSizes.instructionChars ?? 0;

  const sorted = [...output.results].sort((a, b) => b.combo.compositeScore - a.combo.compositeScore);
  const ranking: PromptRankRow[] = sorted.map((r, i) => ({
    rank: i + 1,
    promptVariant: r.promptVariant,
    score: r.combo.compositeScore,
    passedTurns: r.combo.totals.passedTurns,
    totalTurns: r.combo.totals.turns,
    criticalIssues: r.combo.totals.criticalIssues,
    avgWords: r.combo.averages.responseWords,
    avgLatencyMs: r.combo.averages.latencyMs,
    systemPromptChars: r.promptSizes.systemPromptChars,
    instructionChars: r.promptSizes.instructionChars,
    approxSystemTokens: r.promptSizes.approxSystemTokens,
    personalizationRoom: personalizationRoom(r.promptSizes.instructionChars, fullInstructionChars),
    personalizationRoomChars: Math.max(0, fullInstructionChars - r.promptSizes.instructionChars),
    repairs: r.combo.totals.repairs,
    notes: variantNotes(r, fullInstructionChars),
  }));

  const best = sorted[0];
  const second = sorted[1];

  // "Acceptable" = 0 critical issues AND pass rate >= 70%. Shortest such by instruction chars.
  const acceptable = sorted.filter((r) => r.combo.totals.criticalIssues === 0 && r.combo.rates.passRate >= 0.7);
  const shortestAcceptable = [...acceptable].sort((a, b) => a.promptSizes.instructionChars - b.promptSizes.instructionChars)[0];

  const rowFor = (r?: PromptModeResult) => (r ? ranking.find((x) => x.promptVariant === r.promptVariant) ?? null : null);

  // Learner-profile breakdown.
  const bestConfused = bestVariantForCategories(output.results, ['confused']);
  const bestImpatient = bestVariantForCategories(output.results, ['impatient']);
  const bestStruggling = bestVariantForCategories(output.results, ['struggling']);
  const bestVagueMinimal = bestVariantForCategories(output.results, ['vague', 'minimal']);
  const overExplainFast = [...output.results]
    .map((r) => ({ v: r.promptVariant, rate: overExplainForCategory(r, 'fast') }))
    .sort((a, b) => b.rate - a.rate)[0];
  const driftOffTopic = [...output.results]
    .map((r) => ({ v: r.promptVariant, rate: driftForOffTopic(r) }))
    .sort((a, b) => b.rate - a.rate)[0];

  const allCategories = [...new Set(Object.values(PROMPT_EVAL_PROFILE_CATEGORY))];
  const perCategory = allCategories.map((category) => {
    const b = bestVariantForCategories(output.results, [category]);
    return { category, bestVariant: b.variant, bestPassRate: Math.round(b.rate * 100) / 100 };
  });

  const causes = analyzeCauses(output.results, fullInstructionChars);

  const whyBest: string[] = [];
  if (best && modelExecuted) {
    whyBest.push(
      `Score ${best.combo.compositeScore}, pass ${pct(best.combo.rates.passRate)}, ${best.combo.totals.criticalIssues} critical, groundedness ${best.combo.averages.groundedness}/5, avg ${Math.round(best.combo.averages.responseWords)} words at ${seconds(best.combo.averages.latencyMs)}/turn.`,
      `Prompt size: ${best.promptSizes.instructionChars} instruction chars (~${best.promptSizes.approxSystemTokens} system tokens total); personalization room vs full: ${personalizationRoom(best.promptSizes.instructionChars, fullInstructionChars)}.`,
    );
  }

  const canShortenSafely = Boolean(
    shortestAcceptable && full && shortestAcceptable.promptSizes.instructionChars < fullInstructionChars,
  );

  const personalizationBudget: string[] = [];
  if (best && full) {
    const room = ranking.find((r) => r.promptVariant === best.promptVariant)?.personalizationRoomChars ?? 0;
    personalizationBudget.push(
      `The winner frees ~${room} instruction chars vs the full prompt (~${Math.round(room / 4)} tokens) for future personalization.`,
      'Fields that could fit later (small, high-value): learner level (beginner/intermediate), preferred pace, "wants examples" vs "wants direct answers", 1–2 recent repeated mistakes, confidence estimate, tone/language preference.',
      'Do NOT add yet: full learner history, long free-text notes, multi-lesson memory, or anything that re-inflates the prompt past the full-prompt size — that would erase the efficiency gain.',
    );
  }

  const statement = modelExecuted
    ? 'Actual Llama 3.2 3B (WebLLM) was tested for every prompt variant.'
    : 'Actual Llama 3.2 3B could not be executed from this runner. No quality verdict.';

  const limitations: string[] = [
    `This experiment varies ONLY the tutor prompt shape/length. Fixed: model ${output.modelName}, strategy ${output.strategy}, lesson variant ${output.lessonVariant}, memory ${output.memoryMode}(${output.lastMessagesLimit}), completion disabled.`,
    'All variants keep the SAME kind/calm/supportive personality — this is prompt efficiency, not personality comparison.',
    isPlaceholder
      ? 'IMPORTANT: the fixed lesson variant resolves to the PLACEHOLDER "mock-demo" course, so absolute numbers reflect prompt behaviour on placeholder text, not real-subject mastery. The prompt-variant ranking is the signal; re-run on a real course before locking a default.'
      : 'Evaluated against real (non-placeholder) content.',
    'Learner turns are SCRIPTED (16 fixed profiles) and do not adapt to the tutor; multi-turn effects are approximated.',
    'Scoring is deterministic regex/token-overlap heuristics (no LLM judge): false positives/negatives occur; warmth/over-explaining are rough proxies.',
    'On placeholder content there is little concrete future-topic syntax to leak, so leakage is low by construction — read redirect behaviour, not raw leakage, for off-topic discipline.',
    'Latency is REAL on-device inference on this machine\'s GPU; other hardware differs; pacing waits excluded.',
    'Token counts are a ~4-chars/token heuristic, not a real tokenizer.',
    'PRODUCTION TUTOR PROMPT WAS NOT REPLACED — variants live only in teacher-harness; the app still uses its own prompt.',
    ...(output.incompleteReason ? [`Run did not fully complete: ${output.incompleteReason}`] : []),
  ];

  const fixNext = [
    best ? `Adopt "${best.promptVariant}" as the candidate local-device tutor prompt (pending your approval — not auto-promoted).` : 'No winner — model did not run.',
    second && best ? `Consider merging the best parts of "${best.promptVariant}" and "${second.promptVariant}" (e.g. structure + a one-line redirect reminder).` : '',
    'Reserve the freed prompt budget for a small personalization block (see §6) — add it incrementally and re-run this eval to confirm no quality regression.',
    'Re-run on a REAL (non-placeholder) CourseFactory course and a second unit before locking the default prompt.',
    'If the shortest acceptable prompt holds up on real content, test trimming the last-messages window further to free even more budget.',
  ].filter(Boolean);

  return {
    finishedAt,
    status: {
      realWebLLM: modelExecuted,
      modelExecuted,
      completed,
      model: output.modelName,
      strategy: output.strategy,
      lessonVariant: output.lessonVariant,
      memoryMode: output.memoryMode,
      lastMessagesLimit: output.lastMessagesLimit,
      profileCount: output.profileCount,
      incompleteReason: output.incompleteReason,
      statement,
    },
    metadata: {
      courseSource: 'course-factory/output/variants/',
      courseId: output.variantCourseId,
      unitId: output.variantUnitId,
      scoringMethod: 'deterministic_rules_no_llm_judge',
      isPlaceholderCourse: isPlaceholder,
      productionPromptReplaced: false,
    },
    promptVariantsEvaluated: output.promptVariantsEvaluated,
    ranking,
    learnerBreakdown: {
      bestForConfused: `${bestConfused.variant} (${pct(bestConfused.rate)})`,
      bestForImpatient: `${bestImpatient.variant} (${pct(bestImpatient.rate)})`,
      bestForStruggling: `${bestStruggling.variant} (${pct(bestStruggling.rate)})`,
      overExplainedMostToFast: overExplainFast ? `${overExplainFast.v} (${pct(overExplainFast.rate)})` : 'n/a',
      driftedMostOffTopicFuture: driftOffTopic ? `${driftOffTopic.v} (${pct(driftOffTopic.rate)})` : 'n/a',
      bestForVagueMinimal: `${bestVagueMinimal.variant} (${pct(bestVagueMinimal.rate)})`,
      perCategory,
    },
    recommendations: {
      best: rowFor(best),
      secondBest: rowFor(second),
      shortestAcceptable: rowFor(shortestAcceptable),
      whyBest,
      canShortenSafely,
      personalizationBudget,
    },
    whatHurtQuality: causes,
    fixNext,
    limitations,
    perVariant: output.results.map((r) => ({
      promptVariant: r.promptVariant,
      combo: r.combo,
      promptSizes: r.promptSizes,
      runDirCount: r.runDirs.length,
    })),
  };
}

// ── Markdown ─────────────────────────────────────────────────────────

export function renderPromptEvalMarkdown(report: PromptEvalReport): string {
  const L: string[] = [];
  const rec = report.recommendations;

  L.push('# Tutor Prompt-Efficiency Evaluation');
  L.push('');
  L.push(`- **Finished:** ${report.finishedAt}`);
  L.push(`- **Model (fixed):** ${report.status.model}`);
  L.push(`- **Strategy (fixed):** \`${report.status.strategy}\``);
  L.push(`- **Lesson variant (fixed):** \`${report.status.lessonVariant}\``);
  L.push(`- **Memory (fixed):** \`${report.status.memoryMode}\`(${report.status.lastMessagesLimit})`);
  L.push(`- **Learner profiles:** ${report.status.profileCount}`);
  L.push(`- **Scoring:** ${report.metadata.scoringMethod}`);
  L.push(`- **Production prompt replaced:** ${report.metadata.productionPromptReplaced ? 'yes' : 'NO (variants live only in teacher-harness)'}`);
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
    L.push('> ⚠️ **Placeholder content.** The fixed lesson variant resolves to the "mock-demo" placeholder course; the prompt-variant RANKING is the signal, not absolute mastery. See §7.');
    L.push('');
  }

  // 1. Executive summary
  L.push('## 1. Executive Summary');
  L.push('');
  L.push(`- **Best overall prompt:** ${rec.best ? `\`${rec.best.promptVariant}\` — score ${rec.best.score}` : 'n/a'}`);
  L.push(`- **Second-best prompt:** ${rec.secondBest ? `\`${rec.secondBest.promptVariant}\` — score ${rec.secondBest.score}` : 'n/a'}`);
  L.push(`- **Shortest acceptable prompt:** ${rec.shortestAcceptable ? `\`${rec.shortestAcceptable.promptVariant}\` (${rec.shortestAcceptable.instructionChars} instruction chars, 0 critical, pass ${rec.shortestAcceptable.passedTurns}/${rec.shortestAcceptable.totalTurns})` : 'none met the bar'}`);
  L.push(`- **Can the prompt be shortened safely?** ${rec.canShortenSafely ? 'Yes — a shorter variant matched the quality bar (0 critical, ≥70% pass).' : 'Not clearly — shortening cost quality in this run.'}`);
  L.push(`- **Room for personalization?** ${rec.best && rec.best.personalizationRoom !== 'Low' ? `Yes — the winner leaves ~${rec.best.personalizationRoomChars} instruction chars of headroom vs the full prompt.` : 'Limited — the winner is near the full-prompt size.'}`);
  L.push('');

  // 2. Comparison table
  L.push('## 2. Comparison Table');
  L.push('');
  L.push('| Rank | Prompt Variant | Score | Passed Turns | Critical Issues | Avg Response Length | Prompt Size (sys / instr) | ~Tokens | Personalization Room | Notes |');
  L.push('| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |');
  for (const r of report.ranking) {
    L.push(
      `| ${r.rank} | \`${r.promptVariant}\` | ${r.score} | ${r.passedTurns}/${r.totalTurns} | ${r.criticalIssues} | ${Math.round(r.avgWords)} words | ${r.systemPromptChars} / ${r.instructionChars} chars | ~${r.approxSystemTokens} | ${r.personalizationRoom} | ${r.notes} |`,
    );
  }
  L.push('');
  L.push('"Prompt Size" is the average full system prompt chars / the instruction-preamble chars (the part that varies; grounding is identical across variants). Composite score is the same 0–100 scale as the other labs.');
  L.push('');

  // 3. Learner profile breakdown
  const b = report.learnerBreakdown;
  L.push('## 3. Learner Profile Breakdown');
  L.push('');
  L.push(`- **Best for confused learners:** ${b.bestForConfused}`);
  L.push(`- **Best for impatient learners:** ${b.bestForImpatient}`);
  L.push(`- **Best for struggling learners:** ${b.bestForStruggling}`);
  L.push(`- **Over-explained most to fast learners:** ${b.overExplainedMostToFast}`);
  L.push(`- **Drifted most with off-topic/future-topic learners:** ${b.driftedMostOffTopicFuture}`);
  L.push(`- **Best for vague/minimal replies:** ${b.bestForVagueMinimal}`);
  L.push('');
  L.push('Best prompt variant per learner category (by pass rate):');
  L.push('');
  L.push('| Category | Best variant | Pass rate |');
  L.push('| --- | --- | ---: |');
  for (const c of b.perCategory) L.push(`| ${c.category} | \`${c.bestVariant}\` | ${pct(c.bestPassRate)} |`);
  L.push('');

  // 4. Best prompt recommendation
  L.push('## 4. Best Prompt Recommendation');
  L.push('');
  if (rec.best && report.status.modelExecuted) {
    L.push(`**\`${rec.best.promptVariant}\`** — score ${rec.best.score}.`);
    L.push('');
    for (const w of rec.whyBest) L.push(`- ${w}`);
    const bestCombo = report.perVariant.find((v) => v.promptVariant === rec.best?.promptVariant)?.combo;
    const shippable = bestCombo && bestCombo.totals.criticalIssues === 0 && bestCombo.rates.passRate >= 0.7;
    L.push(`- **Should it become the local-device default?** ${shippable ? 'Strong candidate — but NOT auto-promoted; awaiting your approval, and confirm on a real course first.' : 'Not yet — validate on real content; the failure profile is not decisive.'}`);
    L.push(`- **Short enough for personalization?** ${rec.best.personalizationRoom !== 'Low' ? `Yes (${rec.best.personalizationRoom.toLowerCase()} room, ~${rec.best.personalizationRoomChars} chars freed).` : 'Limited room.'}`);
    L.push(`- **What it still fails on:** ${bestCombo ? `${bestCombo.totals.failedTurns} failed turn(s); correction rate ${pct(bestCombo.rates.correctionRate)}, over-explain ${pct(bestCombo.rates.overExplainRate)}.` : 'n/a'}`);
    L.push('');
  } else {
    L.push('_No verdict — the real model was not executed._');
    L.push('');
  }

  // 5. Shortest acceptable prompt
  L.push('## 5. Shortest Acceptable Prompt');
  L.push('');
  if (rec.shortestAcceptable) {
    L.push(
      `**\`${rec.shortestAcceptable.promptVariant}\`** — ${rec.shortestAcceptable.instructionChars} instruction chars (~${rec.shortestAcceptable.approxSystemTokens} system tokens), 0 critical issues, pass ${rec.shortestAcceptable.passedTurns}/${rec.shortestAcceptable.totalTurns}. This is the most prompt budget we can save while staying acceptable.`,
    );
  } else {
    L.push('_No variant met the "0 critical + ≥70% pass" bar, so no shortest-acceptable prompt is recommended from this run._');
  }
  L.push('');

  // 6. Personalization budget
  L.push('## 6. Personalization Budget Potential');
  L.push('');
  for (const p of rec.personalizationBudget) L.push(`- ${p}`);
  if (rec.personalizationBudget.length === 0) L.push('_No verdict — the real model was not executed._');
  L.push('');

  // 7. What hurt quality
  L.push('## 7. What Hurt Quality');
  L.push('');
  if (report.whatHurtQuality.length === 0) L.push('_No systematic prompt-level problem detected by the deterministic analyzers._');
  for (const c of report.whatHurtQuality) {
    L.push(`### ${c.cause}`);
    L.push('');
    for (const e of c.evidence) L.push(`- ${e}`);
    L.push('');
  }
  L.push('### Recurring issue patterns (per prompt variant)');
  L.push('');
  for (const v of report.perVariant) {
    if (v.combo.recurringIssues.length === 0) continue;
    L.push(`- **\`${v.promptVariant}\`**: ${v.combo.recurringIssues.map((i) => `${i.issue} (×${i.count})`).join('; ')}`);
  }
  L.push('');

  // 8. What to test next
  L.push('## 8. What To Test Next');
  L.push('');
  for (const f of report.fixNext) L.push(`- ${f}`);
  L.push('');

  // 9. Limitations
  L.push('## 9. Limitations');
  L.push('');
  for (const l of report.limitations) L.push(`- ${l}`);
  L.push('');

  // Appendix
  L.push('## Appendix — Per-variant detail');
  L.push('');
  for (const v of report.perVariant) {
    const c = v.combo;
    L.push(`### \`${v.promptVariant}\``);
    L.push('');
    L.push(`- Prompt size: system ${v.promptSizes.systemPromptChars} chars, instructions ${v.promptSizes.instructionChars} chars, grounding ${v.promptSizes.groundingChars} chars (~${v.promptSizes.approxSystemTokens} system tokens).`);
    L.push(`- Pass ${c.totals.passedTurns}/${c.totals.turns}; critical ${c.totals.criticalIssues}; repairs ${c.totals.repairs}; fallbacks ${c.totals.fallbacks}.`);
    L.push(`- Groundedness ${c.averages.groundedness}/5; correction ${pct(c.rates.correctionRate)}; redirect ${pct(c.rates.redirectRate)}; brevity-ok ${pct(c.rates.brevityOkRate)}; over-explain ${pct(c.rates.overExplainRate)}; warmth ${pct(c.rates.warmthRate)}; advance-early ${pct(c.rates.advanceTooEarlyRate)}.`);
    L.push(`- Avg ${Math.round(c.averages.responseWords)} words at ${seconds(c.averages.latencyMs)}/turn; ${v.runDirCount} case run dirs.`);
    L.push('');
  }
  L.push('_Each case run dir has per-turn `prompt-variant.txt` (the instruction preamble) and `prompt.txt` (the exact prompt sent). Grounding + memory are identical across variants; only the instruction preamble differs._');
  L.push('');
  return L.join('\n');
}

export function writePromptEvalReport(report: PromptEvalReport): { jsonPath: string; mdPath: string } {
  const reportsDir = resolve(HARNESS_ROOT, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const stamp = report.finishedAt.replace(/[^0-9A-Za-z]+/g, '-');
  const jsonPath = resolve(reportsDir, `prompt-efficiency-evaluation-${stamp}.json`);
  const mdPath = resolve(reportsDir, `prompt-efficiency-evaluation-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(mdPath, `${renderPromptEvalMarkdown(report)}\n`, 'utf8');
  return { jsonPath, mdPath };
}
