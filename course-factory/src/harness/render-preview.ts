// ── Preview renderer ──────────────────────────────────────────────────
//
// Renders a schema-valid CoursePackage into a human-readable Markdown preview.
// This is a PREVIEW artifact ONLY — the runtime/Tutor Runtime consumes the JSON,
// never this Markdown. Kept dependency-free.

import type { CoursePackage } from '../validation/validate-course-package';

export function renderCoursePreview(course: CoursePackage): string {
  const lines: string[] = [];
  const push = (s = ''): void => void lines.push(s);

  push(`# ${course.title} — preview`);
  push();
  push('> ⚠️ Human-readable PREVIEW only. The runtime artifact is the CoursePackage');
  push('> JSON — the Tutor Runtime / weak model consumes structured data, not this Markdown.');
  push();
  push(`**Course id:** \`${course.id}\``);
  push(`**Goal:** ${course.goal}`);
  push(`**Description:** ${course.description}`);
  push(`**Units:** ${course.units.length} · **Level:** ${course.metadata.level} · **~${course.metadata.estimatedDurationMinutes} min total**`);
  push();

  for (const unit of [...course.units].sort((a, b) => a.order - b.order)) {
    push('---');
    push(`## ${unit.order}. ${unit.title}`);
    push(`**Outcome (goal):** ${unit.goal}`);
    push(`_${unit.knowledgeBaseChunks.length} KB chunks · ${unit.questions.length} question(s) · ${unit.commonMistakes.length} common mistake(s)_`);
    push();

    const tb = unit.teacherBrain;
    push('**TeacherBrain**');
    push(`- persona: ${tb.persona}`);
    push(`- tone: ${tb.tone}`);
    if (tb.objectives.length) push(`- objectives: ${tb.objectives.join('; ')}`);
    if (tb.guidelines.length) push(`- guidelines: ${tb.guidelines.join('; ')}`);
    if (tb.constraints.length) push(`- constraints: ${tb.constraints.join('; ')}`);
    if (tb.systemPromptSeed) push(`- advance/seed: ${tb.systemPromptSeed}`);
    push();

    push('**Knowledge chunks**');
    for (const c of unit.knowledgeBaseChunks) push(`- **${c.title}** — ${c.content}`);
    push();

    push('**Questions**');
    for (const q of unit.questions) {
      push(`- (${q.type}) ${q.prompt}`);
      if (q.options?.length) push(`  - options: ${q.options.join(' / ')}`);
      push(`  - answer: ${q.answer}`);
      for (const h of [...q.hints].sort((a, b) => a.order - b.order)) push(`  - hint ${h.order}: ${h.text}`);
    }
    push();

    if (unit.commonMistakes.length) {
      push('**Common mistakes → correction**');
      for (const m of unit.commonMistakes) push(`- ${m.mistake} → ${m.correction}`);
      push();
    }
  }

  return lines.join('\n');
}
