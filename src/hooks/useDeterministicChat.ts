// ── useDeterministicChat — deterministic flow, presented AS chat ──────
//
// The deterministic_steps flow reuses the normal chat experience. This hook
// exposes a chat-shaped surface (a message transcript + a sendStudentMessage
// that returns Promise<boolean>) so the SAME chat UI that backs the current
// flow (LessonChat / GuidedRoomView) can render it unchanged.
//
// What differs from the current flow is only WHERE the content comes from and
// WHO controls progression:
//   • A prepared lesson-opening message (unit.deterministicOverview) is injected
//     first, then each step's prepared teaching message.
//   • MCQ steps attach the question + options as structured data (no answer
//     shown); the learner clicks a choice or types, and the app grades it
//     deterministically. OPEN steps show an open question; the learner types and
//     the LOCAL MODEL evaluates the answer against the prepared rubric, staying
//     inside the current step.
//   • The app — not the model — advances steps. The model only ever helps /
//     evaluates within the current step (buildDeterministicStepContext-scoped).
//
// Progress is in-memory for this first version (per spec) and never touches the
// current-flow progress store.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DeterministicStep, LearningUnit } from '../course-package';
import { useAiProvider } from '../contexts/AiProviderContext';
import {
  buildDeterministicHelpPrompt,
  buildDeterministicOpenEvalPrompt,
  buildDeterministicStepContext,
  buildDeterministicStepIntro,
  getDeterministicSteps,
  getStepCheckKind,
  isAffirmativeReply,
  isDontKnowReply,
  matchMcqOption,
} from '../lesson-runtime';
import type { LessonMessage } from '../lesson-runtime';

/** 'answer' = awaiting the check answer; 'checkpoint' = awaiting "shall we continue?". */
type Phase = 'answer' | 'checkpoint' | 'completed';

/**
 * The MCQ attached to a prepared tutor message so the chat UI can render it as
 * clickable choices. `question` + `options` are visible; `correctOption` is only
 * populated AFTER the learner answers (so the answer is never shown up front).
 */
export interface ChatMcqView {
  question: string;
  options: string[];
  /** Set once answered — the choice the learner made. */
  selectedOption?: string;
  /** Revealed only once answered — used purely for post-answer coloring. */
  correctOption?: string;
}

/**
 * A structured "mini lesson" card attached to a prepared tutor message so the
 * chat can render section labels + a code block instead of one plain block.
 * IMPORTANT: this holds only LEARNER-VISIBLE teaching text. Open-check internals
 * (expectedIdea / acceptableAnswers / hint) are never placed here.
 */
export interface ChatLessonCard {
  /** Small label above the title, e.g. "Lesson". */
  eyebrow?: string;
  /** Heading, e.g. the step title or the lesson name. */
  title?: string;
  /** Label above the body, e.g. "What you'll learn" (omit for the overview). */
  bodyLabel?: string;
  /** The teaching explanation / overview text. */
  body: string;
  /** Optional worked example — rendered as a code block. */
  example?: string;
  /** Optional open-ended question — rendered under a "Try it" label. */
  prompt?: string;
}

/** A chat message that may carry a prepared MCQ and/or a lesson card (deterministic flow only). */
export type DeterministicChatMessage = LessonMessage & { mcq?: ChatMcqView; card?: ChatLessonCard };

const NO_PROVIDER_HELP = 'Choose an AI guide first to get help on this step.';
const HELP_FAILED = 'The tutor could not respond right now. Try again in a moment.';
const COMPLETE_MESSAGE = "🎉 That's the whole lesson — great work! When you're ready, continue to the next lesson.";

/**
 * The prepared message shown when a step opens. `content` is the plain-text
 * version (kept for the model's transcript/context and as a fallback); `card`
 * carries the same LEARNER-VISIBLE teaching text in a structured, sectioned
 * form for nicer rendering. MCQ steps carry the question/options as `mcq`
 * (clickable choices); open steps put the question in `card.prompt`. The open
 * rubric is NEVER included here.
 */
function stepMessage(step: DeterministicStep): DeterministicChatMessage {
  const intro = buildDeterministicStepIntro(step);
  const card: ChatLessonCard = {
    title: step.title,
    bodyLabel: "What you'll learn",
    body: step.intro,
    example: step.example,
  };
  if (getStepCheckKind(step) === 'open' && step.open) {
    card.prompt = step.open.question;
    return { role: 'tutor', content: `${intro}\n\n${step.open.question}`, card };
  }
  return {
    role: 'tutor',
    content: intro,
    card,
    mcq: step.mcq ? { question: step.mcq.question, options: step.mcq.options } : undefined,
  };
}

/** Build the opening transcript: prepared overview card (if any) + step 1. */
function initialMessages(unit: LearningUnit, steps: DeterministicStep[]): DeterministicChatMessage[] {
  const msgs: DeterministicChatMessage[] = [];
  if (unit.deterministicOverview) {
    msgs.push({
      role: 'tutor',
      content: unit.deterministicOverview,
      card: { eyebrow: 'Lesson', title: unit.title, body: unit.deterministicOverview },
    });
  }
  if (steps.length) msgs.push(stepMessage(steps[0]));
  return msgs;
}

export interface UseDeterministicChat {
  messages: DeterministicChatMessage[];
  loading: boolean;
  error: string | null;
  dismissError: () => void;
  /** True when a model provider is configured (in-step help/eval can run). */
  providerReady: boolean;
  /** Send the learner's typed message; resolves true when it was accepted. */
  sendStudentMessage: (text: string) => Promise<boolean>;
  /** Answer the current step's MCQ by clicking a choice. */
  selectMcqOption: (option: string) => void;
  status: 'in_progress' | 'completed';
  stepNumber: number;
  totalSteps: number;
  /** Deterministic steps completed so far (for progress / goals display). */
  completedCount: number;
  currentStepTitle: string;
  currentStepContent: string;
}

export function useDeterministicChat(params: { unit: LearningUnit }): UseDeterministicChat {
  const { unit } = params;
  const { activeModelProvider } = useAiProvider();

  const steps = useMemo(() => getDeterministicSteps(unit), [unit]);

  const [messages, setMessages] = useState<DeterministicChatMessage[]>(() => initialMessages(unit, steps));
  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('answer');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs mirror state so the async send handler reads current values (not stale
  // closure values) between awaits and across click/type entry points.
  const messagesRef = useRef(messages);
  const stepIndexRef = useRef(stepIndex);
  const phaseRef = useRef(phase);
  const loadingRef = useRef(loading);
  messagesRef.current = messages;
  stepIndexRef.current = stepIndex;
  phaseRef.current = phase;
  loadingRef.current = loading;

  // Restart cleanly when the unit changes (same page, different lesson).
  useEffect(() => {
    const first = initialMessages(unit, steps);
    setMessages(first);
    messagesRef.current = first;
    setStepIndex(0);
    stepIndexRef.current = 0;
    setPhase('answer');
    phaseRef.current = 'answer';
    setError(null);
  }, [unit, steps]);

  const commit = useCallback((next: DeterministicChatMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  /** Mark the current step's (last unanswered) MCQ message as answered. */
  const markMcqAnswered = useCallback(
    (list: DeterministicChatMessage[], selectedOption: string, correctOption: string): DeterministicChatMessage[] => {
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        if (m.mcq && !m.mcq.selectedOption) {
          const copy = list.slice();
          copy[i] = { ...m, mcq: { ...m.mcq, selectedOption, correctOption } };
          return copy;
        }
      }
      return list;
    },
    [],
  );

  /** Call the model for a prompt about the current step; append its reply. Returns success. */
  const runModelTurn = useCallback(
    async (prompt: string): Promise<boolean> => {
      if (!activeModelProvider) {
        setError(NO_PROVIDER_HELP);
        return false;
      }
      setLoading(true);
      loadingRef.current = true;
      setError(null);
      try {
        const reply = await activeModelProvider.generateText({ prompt });
        commit([...messagesRef.current, { role: 'tutor', content: reply.trim() }]);
        return true;
      } catch {
        setError(HELP_FAILED);
        return false;
      } finally {
        setLoading(false);
        loadingRef.current = false;
      }
    },
    [activeModelProvider, commit],
  );

  /** In-step help (free confusion / questions) — never advances the step. */
  const runHelp = useCallback(
    (studentText: string): Promise<boolean> => {
      const step = steps[stepIndexRef.current];
      if (!step) return Promise.resolve(false);
      const context = buildDeterministicStepContext({ unit, step, recentMessages: messagesRef.current });
      return runModelTurn(buildDeterministicHelpPrompt({ context, studentMessage: studentText }));
    },
    [runModelTurn, steps, unit],
  );

  /** Advance to the next step (injecting its prepared message) or complete. */
  const advance = useCallback(() => {
    const next = stepIndexRef.current + 1;
    if (next < steps.length) {
      setStepIndex(next);
      stepIndexRef.current = next;
      setPhase('answer');
      phaseRef.current = 'answer';
      commit([...messagesRef.current, stepMessage(steps[next])]);
    } else {
      setPhase('completed');
      phaseRef.current = 'completed';
      commit([...messagesRef.current, { role: 'tutor', content: COMPLETE_MESSAGE }]);
    }
  }, [commit, steps]);

  /** Move to the checkpoint (prepared "shall we continue?" prompt). */
  const goToCheckpoint = useCallback(
    (step: DeterministicStep) => {
      commit([...messagesRef.current, { role: 'tutor', content: step.checkpointPrompt }]);
      setPhase('checkpoint');
      phaseRef.current = 'checkpoint';
    },
    [commit],
  );

  /**
   * Apply a chosen MCQ answer (from a click or a matched typed reply). Correct →
   * lock the choice, inject prepared correct feedback (+ summary) + checkpoint.
   * Incorrect → inject prepared incorrect feedback and stay so the learner can
   * try another choice. The correct answer is only revealed here, never up front.
   */
  const applyMcqAnswer = useCallback(
    (option: string, opts: { addStudentBubble: boolean }) => {
      const step = steps[stepIndexRef.current];
      if (!step || !step.mcq) return;
      let working = messagesRef.current;
      if (opts.addStudentBubble) working = [...working, { role: 'student', content: option }];

      const correct = option === step.mcq.correctAnswer;
      if (correct) {
        working = markMcqAnswered(working, option, step.mcq.correctAnswer);
        const parts = [step.mcq.feedbackCorrect];
        if (step.summary) parts.push(step.summary);
        parts.push(step.checkpointPrompt);
        commit([...working, { role: 'tutor', content: parts.join('\n\n') }]);
        setPhase('checkpoint');
        phaseRef.current = 'checkpoint';
      } else {
        commit([...working, { role: 'tutor', content: step.mcq.feedbackIncorrect }]);
        // stay on 'answer' — choices remain active so the learner can retry.
      }
    },
    [commit, markMcqAnswered, steps],
  );

  const selectMcqOption = useCallback(
    (option: string) => {
      if (loadingRef.current || phaseRef.current !== 'answer') return;
      const step = steps[stepIndexRef.current];
      if (!step || !step.mcq || !step.mcq.options.includes(option)) return;
      setError(null);
      applyMcqAnswer(option, { addStudentBubble: true });
    },
    [applyMcqAnswer, steps],
  );

  const sendStudentMessage = useCallback(
    async (text: string): Promise<boolean> => {
      const t = text.trim();
      if (!t || loadingRef.current) return false;
      const step = steps[stepIndexRef.current];
      if (!step || phaseRef.current === 'completed') return false;

      // Record the learner's turn first so it's part of the transcript + context.
      commit([...messagesRef.current, { role: 'student', content: t }]);
      setError(null);

      if (phaseRef.current === 'answer') {
        // OPEN step → the model evaluates the answer against the rubric, then the
        // app shows the checkpoint (progression stays app-controlled).
        if (getStepCheckKind(step) === 'open' && step.open) {
          const context = buildDeterministicStepContext({ unit, step, recentMessages: messagesRef.current });
          const ok = await runModelTurn(buildDeterministicOpenEvalPrompt({ context, open: step.open, studentAnswer: t }));
          if (ok) goToCheckpoint(step);
          return true;
        }

        // MCQ step: a question ("…?") is never treated as an answer — route to help.
        const opt = t.includes('?') ? null : matchMcqOption(t, step.mcq?.options ?? []);
        if (opt) {
          applyMcqAnswer(opt.option, { addStudentBubble: false });
          return true;
        }
        if (isDontKnowReply(t)) {
          // Don't block: give a short direct explanation, then move to checkpoint.
          const ok = await runHelp(t);
          if (ok) goToCheckpoint(step);
          return true;
        }
        // A general question / confusion → help inside this step, stay put.
        await runHelp(t);
        return true;
      }

      // phase === 'checkpoint'
      if (isAffirmativeReply(t)) {
        advance();
        return true;
      }
      // "No" / "another example" / a question at the checkpoint → help, stay put.
      await runHelp(t);
      return true;
    },
    [advance, applyMcqAnswer, commit, goToCheckpoint, runHelp, runModelTurn, steps, unit],
  );

  const completedCount = phase === 'completed' ? steps.length : stepIndex;
  const currentStep = steps[Math.min(stepIndex, Math.max(steps.length - 1, 0))];

  return {
    messages,
    loading,
    error,
    dismissError: () => setError(null),
    providerReady: activeModelProvider !== null,
    sendStudentMessage,
    selectMcqOption,
    status: phase === 'completed' ? 'completed' : 'in_progress',
    stepNumber: Math.min(stepIndex + 1, steps.length),
    totalSteps: steps.length,
    completedCount,
    currentStepTitle: currentStep?.title ?? unit.title,
    currentStepContent: currentStep?.intro ?? unit.goal,
  };
}
