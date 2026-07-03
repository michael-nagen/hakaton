// ── Teacher Harness — real-course top-2 validation report ────────────
//
// Turns a RealCourseEvalOutput into the required markdown + JSON validation
// report. Reuses buildJudgeReport for the core aggregation (dimensions, profile
// breakdown, deterministic-vs-judge disagreements, recommendation) and adds the
// real-course sections: course header, missed-mistake analysis (the prior
// weakness), drift / future-topic leakage, and personalization budget.
// Writes reports/real-course-top2-validation-<ts>.{json,md}. Never fabricates.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HARNESS_ROOT } from '../config/harness-config';
import { JUDGE_SCORE_DIMENSIONS, REALISTIC_TOP3_VARIANTS, type JudgedPromptVariant, type JudgedTurn } from './llm-judge.types';
import { buildJudgeReport, type JudgeReport } from './llm-judge-report';
import type { JudgeEvalOutput } from './run-llm-judge-eval';
import type { RealCourseEvalOutput } from './run-real-course-eval';

const DIM_LABELS: Record<string, string> = {
  groundedness: 'Groundedness',
  teachingClarity: 'Teaching clarity',
  brevityFocus: 'Brevity / focus',
  mistakeCorrection: 'Mistake correction',
  checkUnderstanding: 'Check-for-understanding',
  learnerHandling: 'Learner handling',
  noFutureLeakage: 'No future-topic leakage',
  productSuitability: 'Product suitability',
};

function personalizationLabel(chars: number): string {
  if (chars <= 0) return 'Low';
  if (chars < 800) return 'Moderate';
  if (chars < 1500) return 'High';
  return 'Very high';
}

interface MissedExample {
  variant: JudgedPromptVariant;
  profileId: string;
  turnId: string;
  learnerMessage: string;
  explanation: string;
}

export interface RealCourseReport {
  meta: {
    courseId: string;
    courseTitle: string;
    isPlaceholder: boolean;
    units: RealCourseEvalOutput['units'];
    whySelected: string;
    fixedRuntime: Record<string, string | number>;
  };
  judgeModel: string | null;
  modelExecuted: boolean;
  reused: boolean;
  totals: { totalTurns: number; judgedOk: number; judgeFailed: number; repaired: number };
  judge: JudgeReport;
  missedMistake: {
    byVariant: Partial<Record<JudgedPromptVariant, number>>;
    examples: MissedExample[];
  };
  drift: {
    byVariant: Partial<Record<JudgedPromptVariant, { future_topic_leakage: number; not_grounded: number; advanced_too_early: number; noFutureLeakageAvg: number; groundednessAvg: number }>>;
  };
  personalization: { structuredRoomChars: number; label: string };
  incompleteReason?: string;
}

/** Build a deterministic-comparison record from the real-course run (not the placeholder report). */
function realCourseDeterministic(output: RealCourseEvalOutput): Record<JudgedPromptVariant, Record<string, unknown>> {
  const out = {} as Record<JudgedPromptVariant, Record<string, unknown>>;
  const full = output.promptSizes.full_current_prompt?.instructionChars ?? 0;
  for (const v of REALISTIC_TOP3_VARIANTS) {
    if (!output.deterministic[v]) continue; // only variants actually run
    const det = output.deterministic[v];
    const instr = output.promptSizes[v]?.instructionChars ?? 0;
    const roomChars = Math.max(0, full - instr);
    out[v] = {
      promptVariant: v,
      score: det && det.totalTurns ? Math.round((det.passedTurns / det.totalTurns) * 1000) / 10 : 0,
      passedTurns: det?.passedTurns ?? 0,
      totalTurns: det?.totalTurns ?? 0,
      instructionChars: instr,
      systemPromptChars: output.promptSizes[v]?.systemPromptChars ?? 0,
      personalizationRoomChars: roomChars,
      personalizationRoom: personalizationLabel(roomChars),
    };
  }
  return out;
}

export function buildRealCourseReport(output: RealCourseEvalOutput): RealCourseReport {
  const deterministic = realCourseDeterministic(output);
  const judgeEvalOutput: JudgeEvalOutput = {
    finishedAt: output.finishedAt,
    judgeAvailable: output.judgeAvailable,
    judgeModel: output.judgeModel,
    judgeProviderKind: output.judgeProviderKind,
    judgeSource: 'judge-env',
    reusedArtifacts: false,
    totalTurns: output.totalTurns,
    judgedOk: output.judgedOk,
    judgeFailed: output.judgeFailed,
    repaired: output.repaired,
    results: output.results,
    incompleteReason: output.incompleteReason,
  };
  const judge = buildJudgeReport(judgeEvalOutput, deterministic, null);

  // Missed-mistake analysis (the prior weakness).
  const missedExamples: MissedExample[] = [];
  const missedByVariant: Partial<Record<JudgedPromptVariant, number>> = {};
  for (const r of output.results) {
    if (!r.ok) continue;
    if (r.score.failureTags.includes('missed_mistake')) {
      missedByVariant[r.input.promptVariant] = (missedByVariant[r.input.promptVariant] ?? 0) + 1;
      if (missedExamples.length < 10)
        missedExamples.push({ variant: r.input.promptVariant, profileId: r.input.profileId, turnId: r.input.turnId, learnerMessage: r.input.learnerMessage, explanation: r.score.explanation });
    }
  }

  // Drift / leakage per variant (tags + dimension averages).
  const drift: RealCourseReport['drift']['byVariant'] = {};
  for (const v of judge.variants) {
    drift[v.variant] = {
      future_topic_leakage: v.tagCounts.future_topic_leakage ?? 0,
      not_grounded: v.tagCounts.not_grounded ?? 0,
      advanced_too_early: v.tagCounts.advanced_too_early ?? 0,
      noFutureLeakageAvg: v.dimAverages.noFutureLeakage,
      groundednessAvg: v.dimAverages.groundedness,
    };
  }

  const structuredRoomChars = Number(deterministic.structured_rules_prompt?.personalizationRoomChars ?? 0);

  return {
    meta: {
      courseId: output.courseId,
      courseTitle: output.courseTitle,
      isPlaceholder: output.isPlaceholder,
      units: output.units,
      whySelected: 'Most complete real CourseFactory course in course-factory/output/ (real subject content, multiple units) — not the mock-demo placeholder.',
      fixedRuntime: {
        model: output.modelName,
        strategy: output.strategy,
        memoryMode: output.memoryMode,
        lastMessagesLimit: output.lastMessagesLimit,
        lessonCompletion: 'disabled',
        judge: output.judgeModel ?? 'n/a',
      },
    },
    judgeModel: output.judgeModel ?? null,
    modelExecuted: output.modelExecuted,
    reused: false,
    totals: { totalTurns: output.totalTurns, judgedOk: output.judgedOk, judgeFailed: output.judgeFailed, repaired: output.repaired },
    judge,
    missedMistake: { byVariant: missedByVariant, examples: missedExamples },
    drift: { byVariant: drift },
    personalization: { structuredRoomChars, label: personalizationLabel(structuredRoomChars) },
    incompleteReason: output.incompleteReason,
  };
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function renderRealCourseMarkdown(r: RealCourseReport): string {
  const L: string[] = [];
  L.push('# Real-Course Validation — Top-2 Tutor Prompt Variants');
  L.push('');
  L.push(`_Generated ${r.judge.finishedAt}_`);
  L.push('');

  // 1. Course used
  L.push('## 1. Course Used');
  L.push('');
  L.push(`- **Course:** \`${r.meta.courseId}\` — ${r.meta.courseTitle}`);
  L.push(`- **Real or placeholder:** ${r.meta.isPlaceholder ? 'PLACEHOLDER' : 'REAL CourseFactory course (not mock-demo)'}`);
  L.push(`- **Units tested:** ${r.meta.units.map((u) => `${u.unitId} (${u.unitTitle})`).join('; ')}`);
  L.push(`- **Why selected:** ${r.meta.whySelected}`);
  L.push(`- **Fixed runtime:** ${Object.entries(r.meta.fixedRuntime).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  L.push('');

  if (!r.judge.ran) {
    L.push('## ⚠️ Validation did not complete');
    L.push('');
    L.push(r.incompleteReason ?? r.judge.unavailableReason ?? 'Unknown reason.');
    if (r.judge.neededEnv?.length) {
      L.push('');
      L.push('Needed env:');
      L.push('```bash');
      for (const k of r.judge.neededEnv) L.push(`${k}=...`);
      L.push('```');
    }
    return L.join('\n');
  }

  const variantList = r.judge.variants; // canonical order (full → structured → compact)
  const full = variantList.find((v) => v.variant === 'full_current_prompt');
  const structured = variantList.find((v) => v.variant === 'structured_rules_prompt');
  const compact = variantList.find((v) => v.variant === 'compact_prompt');
  const det = r.judge.deterministic!;

  // 2. Executive summary
  const structuredTiesOrBeats = !!(structured && full && structured.overallAvg >= full.overallAvg);
  const compactCompetitive = !!(compact && full && structured && compact.overallAvg >= Math.min(full.overallAvg, structured.overallAvg));
  L.push('## 2. Executive Summary');
  L.push('');
  L.push(`- **Judge:** \`${r.judgeModel}\` — ${r.totals.judgedOk}/${r.totals.totalTurns} turns judged (${r.totals.repaired} repaired, ${r.totals.judgeFailed} failed). Real local Llama tutor outputs (no mock).`);
  L.push(`- **Deterministic winner:** ${r.judge.deterministicWinner}`);
  L.push(`- **OpenAI judge winner:** ${r.judge.judgeWinner} (${variantList.map((v) => `${v.variant} ${v.overallAvg}`).join(' vs ')})`);
  L.push(`- **Does structured_rules_prompt still tie or beat full?** ${structuredTiesOrBeats ? 'YES — ties or beats full on judge overall' : 'NO — full leads on this course'}.`);
  L.push(`- **Does compact_prompt become competitive?** ${compact ? (compactCompetitive ? 'YES — within/above the full–structured band' : 'Not quite — trails the leaders') : 'n/a (not evaluated)'}.`);
  L.push(`- **Safe to promote structured later?** ${structuredTiesOrBeats && structured!.criticalCount === 0 ? 'Looks safe on this course (evaluation only — not auto-promoted).' : 'Not yet — see criticals / dimension gaps.'}`);
  L.push('');

  // 3. Comparison table
  L.push('## 3. Comparison Table');
  L.push('');
  L.push('| Prompt Variant | Deterministic Score | OpenAI Judge Avg | Pass Rate | Critical Issues | Avg Response Length | Prompt Size (instr chars) | Personalization Room | Recommendation |');
  L.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |');
  const REC_LABEL: Record<string, string> = {
    full_current_prompt: 'Quality baseline',
    structured_rules_prompt: 'Leading compact default candidate',
    compact_prompt: 'Backup compact candidate',
  };
  for (const v of r.judge.variants) {
    const d = det[v.variant] ?? {};
    L.push(`| ${v.variant} | ${d.score ?? 'n/a'} | ${v.overallAvg}/10 | ${pct(v.passRate)} | ${v.criticalCount} | ${v.avgResponseWords} words | ${d.instructionChars ?? 'n/a'} | ${d.personalizationRoom ?? 'n/a'} | ${REC_LABEL[v.variant] ?? '—'} |`);
  }
  L.push('');

  // 4. Dimension breakdown (dynamic columns over the judged variants)
  L.push('## 4. Dimension Breakdown (avg judge score, 1–5)');
  L.push('');
  L.push(`| Dimension | ${variantList.map((v) => v.variant).join(' | ')} |`);
  L.push(`| --- | ${variantList.map(() => '---:').join(' | ')} |`);
  for (const d of JUDGE_SCORE_DIMENSIONS) L.push(`| ${DIM_LABELS[d]} | ${variantList.map((v) => v.dimAverages[d]).join(' | ')} |`);
  L.push(`| **Overall (1–10)** | ${variantList.map((v) => `**${v.overallAvg}**`).join(' | ')} |`);
  L.push('');

  // 5. Learner profile breakdown (dynamic columns)
  L.push('## 5. Learner Profile Breakdown (avg overall /10)');
  L.push('');
  L.push(`| Learner Profile | Category | ${variantList.map((v) => v.variant).join(' | ')} | Better |`);
  L.push(`| --- | --- | ${variantList.map(() => '---:').join(' | ')} | --- |`);
  for (const p of r.judge.profileBreakdown) {
    const cells = variantList.map((v) => p.overall[v.variant] ?? 'n/a').join(' | ');
    L.push(`| ${p.profileId} | ${p.category} | ${cells} | ${p.betterVariant} |`);
  }
  L.push('');

  // 6. Missed-mistake analysis
  L.push('## 6. Missed-Mistake Analysis (the prior weakness)');
  L.push('');
  L.push(`- \`missed_mistake\` tags — ${variantList.map((v) => `${v.variant}: ${r.missedMistake.byVariant[v.variant] ?? 0}`).join(', ')}.`);
  L.push(`- Mistake-correction dimension (1–5) — ${variantList.map((v) => `${v.variant}: ${v.dimAverages.mistakeCorrection}`).join(', ')}.`);
  if (full && structured) {
    const sMc = structured.dimAverages.mistakeCorrection;
    const fMc = full.dimAverages.mistakeCorrection;
    L.push(`- structured ${sMc > fMc ? 'IMPROVED' : sMc < fMc ? 'WORSENED' : 'MATCHED'} correction vs full (${sMc} vs ${fMc}).`);
  }
  if (r.missedMistake.examples.length) {
    L.push('');
    L.push('| Variant | Profile / Turn | Learner said | Judge note |');
    L.push('| --- | --- | --- | --- |');
    for (const e of r.missedMistake.examples) L.push(`| ${e.variant} | ${e.profileId}/${e.turnId} | ${e.learnerMessage.slice(0, 60).replace(/\|/g, '/')} | ${e.explanation.slice(0, 120).replace(/\|/g, '/')} |`);
  } else {
    L.push('- No `missed_mistake` cases flagged by the judge on this course.');
  }
  const totalMissed = variantList.reduce((a, v) => a + (r.missedMistake.byVariant[v.variant] ?? 0), 0);
  L.push(`- **Suggested fix:** ${totalMissed > 0 ? 'add a one-line "if the learner repeats a listed common mistake, correct it explicitly before moving on" reminder to the winning preamble, then re-judge.' : 'no correction fix needed on this course; re-check on a harder unit.'}`);
  L.push('');

  // 7. Drift / future-topic leakage
  L.push('## 7. Drift / Future-Topic Leakage');
  L.push('');
  L.push('| Variant | future_topic_leakage | not_grounded | advanced_too_early | noFutureLeakage (1–5) | groundedness (1–5) |');
  L.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const v of variantList) {
    const d = r.drift.byVariant[v.variant];
    if (d) L.push(`| ${v.variant} | ${d.future_topic_leakage} | ${d.not_grounded} | ${d.advanced_too_early} | ${d.noFutureLeakageAvg} | ${d.groundednessAvg} |`);
  }
  L.push('');
  const anyDrift = variantList.some((v) => {
    const d = r.drift.byVariant[v.variant];
    return d && (d.future_topic_leakage > 0 || d.not_grounded > 0 || d.advanced_too_early > 0);
  });
  L.push(`- **Verdict:** ${anyDrift ? 'some drift/leakage tags present — see table; inspect flagged turns.' : 'no future-topic leakage, ungrounded content, or premature advancement flagged by the judge.'}`);
  L.push('');

  // 8. Personalization budget
  L.push('## 8. Personalization Budget');
  L.push('');
  L.push(`- structured_rules_prompt frees **~${r.personalization.structuredRoomChars} instruction chars** vs full on this course (room: ${r.personalization.label}).`);
  L.push(`- ${r.personalization.structuredRoomChars >= 800 ? 'Enough budget for a small personalization block (learner level, pace, examples-vs-direct, 1–2 recent mistakes). Add incrementally and re-judge.' : 'Limited freed budget on this course — personalization gains are smaller here.'}`);
  L.push('');

  // 9. Recommendation
  L.push('## 9. Recommendation');
  L.push('');
  for (const rec of r.judge.recommendation) L.push(`- ${rec}`);
  L.push('- Run at least one more unit/course and a small human spot-check before any promotion.');
  L.push('');

  // 10. Limitations
  L.push('## 10. Limitations');
  L.push('');
  for (const l of r.judge.limitations) L.push(`- ${l}`);
  L.push('- This validation used real course content but still SCRIPTED learners and a single LLM judge — not a substitute for human/product testing.');
  L.push('');
  L.push('> Production Tutor prompt was NOT changed or promoted. Validation only.');
  return L.join('\n');
}

export function writeRealCourseReport(report: RealCourseReport): { jsonPath: string; mdPath: string } {
  const reportsDir = resolve(HARNESS_ROOT, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const stamp = report.judge.finishedAt.replace(/[:.]/g, '-');
  const jsonPath = resolve(reportsDir, `real-course-top2-validation-${stamp}.json`);
  const mdPath = resolve(reportsDir, `real-course-top2-validation-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(mdPath, `${renderRealCourseMarkdown(report)}\n`, 'utf8');
  return { jsonPath, mdPath };
}
