// ── Teacher Harness — lesson-session memory (manager) ────────────────
//
// Deterministic, dependency-free management of the two memory layers. No LLM,
// no database — every update is rule-based so runs are reproducible and cheap.
//
// Flow (owned entirely by the harness):
//   initLessonMemory()          → seed the checklist from the unit's objectives
//   renderWorkingMemoryForPrompt → the compact block injected into the prompt
//   updateLessonMemory()        → append the turn's two messages + recompute
//   finalizeLessonMemory()      → deterministic end-of-lesson summary

import type { LearningUnit } from '../../../src/course-package/course-package.types';
import {
  LESSON_MEMORY_DEFAULTS,
  type ConversationArchiveMemory,
  type LearnerStatus,
  type LessonMemoryConfig,
  type LessonMemoryMessage,
  type LessonMemoryMode,
  type LessonProgressChecklistItem,
  type LessonSessionMemory,
  type LessonWorkingMemory,
} from './lesson-memory.types';

// ── Text helpers (shared, deterministic) ─────────────────────────────

const STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'your', 'have', 'will', 'what',
  'when', 'each', 'they', 'them', 'then', 'into', 'about', 'which', 'while',
  'does', 'their', 'there', 'here', 'just', 'like', 'some', 'only', 'also',
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 4 && !STOPWORDS.has(t)),
  );
}

function overlapCount(a: string, b: string): number {
  const at = tokens(a);
  const bt = tokens(b);
  let hits = 0;
  for (const t of at) if (bt.has(t)) hits += 1;
  return hits;
}

/** Does `text` meaningfully reference `label`? */
function mentions(label: string, text: string, threshold = 2): boolean {
  return overlapCount(label, text) >= threshold;
}

function firstFewWords(text: string, count = 8): string {
  const words = text.trim().split(/\s+/);
  const head = words.slice(0, count).join(' ');
  return words.length > count ? `${head}…` : head;
}

function firstSentence(text: string): string {
  const s = text.split(/(?<=[.!?])\s+/).filter(Boolean)[0] ?? text;
  return s.trim();
}

function pushUnique(list: string[], value: string): void {
  if (value && !list.includes(value)) list.push(value);
}

// ── Initialisation ───────────────────────────────────────────────────

/** Build the initial checklist from the unit's teaching objectives. */
function seedChecklist(unit: LearningUnit): LessonProgressChecklistItem[] {
  const objectives = unit.teacherBrain.objectives ?? [];
  return objectives.map((label, i) => ({
    id: `obj-${i + 1}`,
    label,
    status: 'not_started' as const,
  }));
}

export function initLessonMemory(params: {
  courseId: string;
  unitId: string;
  unit: LearningUnit;
}): LessonSessionMemory {
  const { courseId, unitId, unit } = params;
  const progressChecklist = seedChecklist(unit);
  return {
    working: {
      courseId,
      unitId,
      progressChecklist,
      learnerKnows: [],
      learnerStillNeeds: progressChecklist.map((i) => i.label),
      correctedMistakes: [],
      hintsGiven: [],
      questionsAttempted: [],
      learnerStatus: 'unknown',
      olderHistorySummary: '',
      lastMessages: [],
    },
    archive: {
      courseId,
      unitId,
      allMessages: [],
      chunkSummaries: [],
    },
  };
}

// ── Prompt rendering ─────────────────────────────────────────────────

function renderChecklist(items: LessonProgressChecklistItem[]): string {
  if (items.length === 0) return '- (no tracked objectives for this unit)';
  return items
    .map((i) => `- [${i.status}] ${i.label}${i.evidence ? ` (evidence: ${i.evidence})` : ''}`)
    .join('\n');
}

function renderMessages(messages: LessonMemoryMessage[]): string {
  if (messages.length === 0) return '- (no earlier messages — this is the start of the lesson)';
  return messages.map((m) => `- ${m.role} (${m.turnId}): ${m.content}`).join('\n');
}

/**
 * Render the compact working memory into the block injected into the tutor
 * prompt. States plainly that this is the ONLY memory the model has.
 */
export function renderWorkingMemoryForPrompt(working: LessonWorkingMemory): string {
  const lines: string[] = [];
  lines.push('LESSON WORKING MEMORY (authoritative — this is the ONLY lesson memory you have):');
  lines.push('- Treat this block as the authoritative record of the lesson so far.');
  lines.push('- Do NOT rely on any hidden or remembered context beyond this block and the current message.');
  lines.push('- Do NOT invent history, progress, or prior answers that are not recorded here.');
  lines.push('- Use the recent messages and the summary to continue the lesson coherently.');
  lines.push('');
  lines.push('Progress checklist:');
  lines.push(renderChecklist(working.progressChecklist));
  lines.push('');
  lines.push(`Learner appears to know: ${working.learnerKnows.join('; ') || '(nothing proven yet)'}`);
  lines.push(`Still needs / not yet proven: ${working.learnerStillNeeds.join('; ') || '(none)'}`);
  lines.push(`Corrected mistakes so far: ${working.correctedMistakes.join('; ') || '(none)'}`);
  lines.push(`Hints already given (do not repeat verbatim): ${working.hintsGiven.join('; ') || '(none)'}`);
  lines.push(`Questions already attempted: ${working.questionsAttempted.join('; ') || '(none)'}`);
  lines.push(`Learner status: ${working.learnerStatus}`);
  lines.push('');
  lines.push(`Summary of earlier history: ${working.olderHistorySummary || '(nothing before the recent messages)'}`);
  lines.push('');
  lines.push('Recent conversation (most recent last):');
  lines.push(renderMessages(working.lastMessages));
  return lines.join('\n');
}

// ── Per-mode renderers ───────────────────────────────────────────────
//
// Each renderer takes the SAME computed working memory and chooses which slice
// to expose. None of them ever renders the full archive. The shared preamble
// keeps the "this block is authoritative, do not invent history" framing that
// the structured mode already used, so switching modes changes the CONTENT of
// the memory block, not the surrounding tutor instructions.

const MEMORY_PREAMBLE = [
  '- Treat this block as the authoritative record of the lesson so far.',
  '- Do NOT rely on any hidden or remembered context beyond this block and the current message.',
  '- Do NOT invent history, progress, or prior answers that are not recorded here.',
];

/** Mode: last_messages_only — just the last N verbatim messages. */
function renderLastMessagesOnly(working: LessonWorkingMemory, limit: number): string {
  const lines: string[] = [];
  lines.push('LESSON MEMORY — RECENT MESSAGES ONLY (authoritative; the ONLY lesson memory you have):');
  lines.push(...MEMORY_PREAMBLE);
  lines.push('');
  lines.push('Recent conversation (most recent last):');
  lines.push(renderMessages(working.lastMessages.slice(-limit)));
  return lines.join('\n');
}

/**
 * Build the compact deterministic summary shared by summary_only and
 * summary_plus_last_messages: what has been explained, mistakes corrected,
 * hints/questions used, what the learner still needs, and status. No raw
 * messages, no checklist rows, no archive.
 */
function renderCompactSummaryBody(working: LessonWorkingMemory): string[] {
  const lines: string[] = [];
  lines.push(`Already explained / learner appears to know: ${working.learnerKnows.join('; ') || '(nothing proven yet)'}`);
  lines.push(`Mistakes already corrected: ${working.correctedMistakes.join('; ') || '(none)'}`);
  lines.push(`Hints already used (do not repeat verbatim): ${working.hintsGiven.join('; ') || '(none)'}`);
  lines.push(`Questions already attempted: ${working.questionsAttempted.join('; ') || '(none)'}`);
  lines.push(`Learner still seems to need: ${working.learnerStillNeeds.join('; ') || '(none)'}`);
  lines.push(`Learner status: ${working.learnerStatus}`);
  if (working.olderHistorySummary) lines.push(`Earlier history: ${working.olderHistorySummary}`);
  return lines;
}

/** Mode: summary_only — compact summary, no raw messages or checklist. */
function renderSummaryOnly(working: LessonWorkingMemory): string {
  const lines: string[] = [];
  lines.push('LESSON MEMORY — COMPACT SUMMARY ONLY (authoritative; the ONLY lesson memory you have):');
  lines.push(...MEMORY_PREAMBLE);
  lines.push('');
  lines.push(...renderCompactSummaryBody(working));
  return lines.join('\n');
}

/** Mode: summary_plus_last_messages — compact summary + last N messages. */
function renderSummaryPlusLastMessages(working: LessonWorkingMemory, limit: number): string {
  const lines: string[] = [];
  lines.push('LESSON MEMORY — SUMMARY + RECENT MESSAGES (authoritative; the ONLY lesson memory you have):');
  lines.push(...MEMORY_PREAMBLE);
  lines.push('');
  lines.push(...renderCompactSummaryBody(working));
  lines.push('');
  lines.push('Recent conversation (most recent last):');
  lines.push(renderMessages(working.lastMessages.slice(-limit)));
  return lines.join('\n');
}

/**
 * THE single place that decides what memory text reaches the model. Returns an
 * empty string for `no_memory` (nothing is appended to the prompt). The full
 * conversation archive is never rendered by any branch.
 */
export function renderMemoryForPrompt(params: {
  working: LessonWorkingMemory;
  mode: LessonMemoryMode;
  config?: Partial<LessonMemoryConfig>;
}): string {
  const cfg: LessonMemoryConfig = { ...LESSON_MEMORY_DEFAULTS, ...params.config };
  switch (params.mode) {
    case 'no_memory':
      return '';
    case 'last_messages_only':
      return renderLastMessagesOnly(params.working, cfg.lastMessagesLimit);
    case 'summary_only':
      return renderSummaryOnly(params.working);
    case 'summary_plus_last_messages':
      return renderSummaryPlusLastMessages(params.working, cfg.lastMessagesLimit);
    case 'structured_working_memory':
      return renderWorkingMemoryForPrompt(params.working);
  }
}

// ── Deterministic update ─────────────────────────────────────────────

function coveredCount(items: LessonProgressChecklistItem[]): number {
  return items.filter((i) => i.status === 'covered' || i.status === 'mastered').length;
}

/** Advance a checklist item's status based on who referenced it this turn. */
function advanceChecklist(
  items: LessonProgressChecklistItem[],
  learnerMessage: string,
  tutorResponse: string,
  turnId: string,
): void {
  for (const item of items) {
    const tutorMention = mentions(item.label, tutorResponse);
    const learnerMention = mentions(item.label, learnerMessage);
    if (tutorMention && (item.status === 'not_started' || item.status === 'in_progress')) {
      item.status = 'covered';
      item.evidence = turnId;
    } else if (learnerMention && item.status === 'not_started') {
      item.status = 'in_progress';
      item.evidence = turnId;
    }
  }
}

/** Detect corrected mistakes: tutor reply strongly overlaps a prepared correction. */
function detectCorrectedMistakes(unit: LearningUnit, tutorResponse: string): string[] {
  const found: string[] = [];
  for (const m of unit.commonMistakes ?? []) {
    if (overlapCount(tutorResponse, m.correction) >= 4) {
      found.push(`${m.id}: ${firstSentence(m.correction)}`);
    }
  }
  return found;
}

/** Detect which prepared hints the tutor surfaced (reply overlaps a hint's text). */
function detectHintsGiven(unit: LearningUnit, tutorResponse: string): string[] {
  const found: string[] = [];
  for (const q of unit.questions ?? []) {
    for (const h of q.hints ?? []) {
      if (overlapCount(tutorResponse, h.text) >= 3) found.push(`${q.id} hint ${h.order}`);
    }
  }
  return found;
}

/** Detect which questions the learner engaged with (message overlaps a prompt). */
function detectQuestionsAttempted(unit: LearningUnit, learnerMessage: string): string[] {
  const found: string[] = [];
  for (const q of unit.questions ?? []) {
    if (overlapCount(learnerMessage, q.prompt) >= 2) found.push(q.id);
  }
  return found;
}

/** Did the learner's message itself exhibit a prepared misconception? */
function learnerExhibitedMistake(unit: LearningUnit, learnerMessage: string): boolean {
  return (unit.commonMistakes ?? []).some((m) => overlapCount(learnerMessage, m.mistake) >= 3);
}

function computeLearnerStatus(params: {
  items: LessonProgressChecklistItem[];
  prevCovered: number;
  exhibitedMistake: boolean;
  previous: LearnerStatus;
}): LearnerStatus {
  const { items, prevCovered, exhibitedMistake, previous } = params;
  const total = items.length;
  const covered = coveredCount(items);
  const ratio = total > 0 ? covered / total : 0;

  if (ratio >= 0.8 && !exhibitedMistake) return 'ready_to_continue';
  if (exhibitedMistake) return 'struggling';
  if (covered > prevCovered) return 'improving';
  return previous === 'unknown' && covered > 0 ? 'improving' : previous;
}

/** Deterministic summary of the messages older than the last-N window. */
function summarizeOlderHistory(
  older: LessonMemoryMessage[],
  lastMessagesLimit: number,
  coveredLabels: string[],
): string {
  if (older.length === 0) return '';
  const learnerTopics = older
    .filter((m) => m.role === 'learner')
    .slice(-3)
    .map((m) => firstFewWords(m.content));
  const coverage = coveredLabels.slice(0, 3).join('; ') || 'the unit basics';
  return (
    `Earlier in this lesson (${older.length} message(s) before the last ${lastMessagesLimit}): ` +
    `learner raised — ${learnerTopics.join(' | ') || '(various points)'}. ` +
    `Tutor has been covering: ${coverage}.`
  );
}

/**
 * Append the turn's learner + tutor messages to the archive and recompute the
 * compact working memory. Pure-ish: mutates and returns the same memory object
 * for convenience; callers treat the return value as the new state.
 */
export function updateLessonMemory(params: {
  memory: LessonSessionMemory;
  unit: LearningUnit;
  turnId: string;
  learnerMessage: string;
  tutorResponse: string;
  learnerCreatedAt: string;
  tutorCreatedAt: string;
  config?: Partial<LessonMemoryConfig>;
}): LessonSessionMemory {
  const cfg: LessonMemoryConfig = { ...LESSON_MEMORY_DEFAULTS, ...params.config };
  const { memory, unit, turnId, learnerMessage, tutorResponse } = params;
  const { working, archive } = memory;

  const prevCovered = coveredCount(working.progressChecklist);

  // 1. Append both messages to the archive.
  const learnerMsg: LessonMemoryMessage = {
    role: 'learner',
    turnId,
    content: learnerMessage,
    createdAt: params.learnerCreatedAt,
  };
  const tutorMsg: LessonMemoryMessage = {
    role: 'tutor',
    turnId,
    content: tutorResponse,
    createdAt: params.tutorCreatedAt,
  };
  archive.allMessages.push(learnerMsg, tutorMsg);

  // 2. Emit a deterministic chunk summary each time we cross a chunk boundary.
  const boundary = cfg.summarizeEveryMessages;
  const prevLen = archive.allMessages.length - 2;
  for (let n = prevLen + 1; n <= archive.allMessages.length; n += 1) {
    if (boundary > 0 && n % boundary === 0) {
      const chunk = archive.allMessages.slice(n - boundary, n);
      const learnerBits = chunk
        .filter((m) => m.role === 'learner')
        .map((m) => firstFewWords(m.content, 6));
      archive.chunkSummaries.push(
        `Messages ${n - boundary + 1}-${n}: learner — ${learnerBits.join(' | ') || '(no learner messages)'}.`,
      );
    }
  }

  // 3. Update checklist + derived fields deterministically.
  advanceChecklist(working.progressChecklist, learnerMessage, tutorResponse, turnId);

  for (const c of detectCorrectedMistakes(unit, tutorResponse)) pushUnique(working.correctedMistakes, c);
  for (const h of detectHintsGiven(unit, tutorResponse)) pushUnique(working.hintsGiven, h);
  for (const q of detectQuestionsAttempted(unit, learnerMessage)) pushUnique(working.questionsAttempted, q);

  const exhibitedMistake = learnerExhibitedMistake(unit, learnerMessage);
  working.learnerStatus = computeLearnerStatus({
    items: working.progressChecklist,
    prevCovered,
    exhibitedMistake,
    previous: working.learnerStatus,
  });

  // Promote fully-covered items to mastered once the learner is ready.
  if (working.learnerStatus === 'ready_to_continue') {
    for (const item of working.progressChecklist) {
      if (item.status === 'covered') item.status = 'mastered';
    }
  }

  // 4. Recompute knows / still-needs from the checklist (idempotent).
  working.learnerKnows = working.progressChecklist
    .filter((i) => i.status === 'covered' || i.status === 'mastered')
    .map((i) => i.label);
  working.learnerStillNeeds = working.progressChecklist
    .filter((i) => i.status !== 'covered' && i.status !== 'mastered')
    .map((i) => i.label);

  // 5. Recompute the last-N window and the older-history summary.
  const limit = cfg.lastMessagesLimit;
  working.lastMessages = archive.allMessages.slice(-limit);
  const older = archive.allMessages.slice(0, Math.max(0, archive.allMessages.length - limit));
  working.olderHistorySummary = summarizeOlderHistory(older, limit, working.learnerKnows);

  return memory;
}

/** Set a deterministic end-of-lesson summary on the archive. */
export function finalizeLessonMemory(memory: LessonSessionMemory): LessonSessionMemory {
  const { working, archive } = memory;
  const total = working.progressChecklist.length;
  const covered = coveredCount(working.progressChecklist);
  archive.finalSummary =
    `Lesson ${working.unitId} (${working.courseId}): ${covered}/${total} objectives covered/mastered; ` +
    `${archive.allMessages.length} messages; ` +
    `corrected mistakes: ${working.correctedMistakes.length}; ` +
    `hints given: ${working.hintsGiven.length}; ` +
    `final learner status: ${working.learnerStatus}.`;
  return memory;
}
