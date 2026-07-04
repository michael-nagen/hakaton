// ── Lesson Assistant — types ─────────────────────────────────────────
//
// The narrow contracts the helper actions (Explain simpler / Give an example /
// Side questions / Watch video) depend on. These are provider-agnostic on
// purpose: the UI talks to a LessonAssistantService, the service talks to a
// TutorAssistantProvider (text) and a LessonVideoProvider (video), and each of
// those is backed by the app's existing ModelProvider / a YouTube adapter.
//
// LessonMessage is reused from the lesson runtime (no duplicate message type).

import type { LessonMessage } from '../lesson-runtime';

/** The current lesson context every helper action is grounded in. */
export interface LessonContext {
  lessonTitle: string;
  lessonTopic?: string;
  currentStepTitle?: string;
  currentStepContent?: string;
  /** The parent course title (e.g. "Python First Steps") — used to keep the
   * video query on-topic (so a print() lesson finds Python videos, not any
   * "print" video). Optional so existing callers are unaffected. */
  courseTitle?: string;
}

/**
 * How the student wants to be taught. Affects STYLE only (added to prompts and
 * lightly to the video query) — never the lesson topic or the task. Optional
 * everywhere so existing behavior is unchanged when absent.
 */
export interface TeachingPreference {
  source: 'preset' | 'custom';
  instruction: string;
  /** Short display label (preset name, or a generic label for custom). */
  label?: string;
  /** Preset id, when source === 'preset' — used for the video-query mapping. */
  presetId?: string;
}

/** A video (or, as a keyless fallback, a link) the app surfaces for a lesson. */
export interface RecommendedVideo {
  /** YouTube video id when known (empty for the keyless fallback link). */
  videoId: string;
  title: string;
  channelTitle?: string;
  thumbnailUrl?: string;
  /** The URL to load in an <iframe> — an embed URL, not a watch page. Empty
   * for the fallback (a search page cannot be embedded); the UI then offers
   * `watchUrl` as a clickable link instead. */
  embedUrl: string;
  /** A direct link the learner can click to open the video/results on YouTube
   * in a new tab. Always set — a watch page when a real video was found, or a
   * topic-scoped search page for the keyless fallback. */
  watchUrl?: string;
  /** True when this is the keyless/best-effort fallback (a topic-scoped link,
   * not a specific embeddable video). The UI shows a clickable link, not an
   * iframe. */
  isFallback?: boolean;
}

/** The one low-level call the text helpers make: prompt in, plain text out. */
export interface TutorAssistantProvider {
  complete(input: { prompt: string; context?: unknown }): Promise<string>;
}

/** Finds a relevant video for a lesson (behind an interface; UI never calls YouTube). */
export interface LessonVideoProvider {
  findRelevantVideo(input: { lessonContext: LessonContext; teachingPreference?: TeachingPreference }): Promise<RecommendedVideo>;
}

/** The single service the UI/hook uses for all helper actions. */
export interface LessonAssistantService {
  explainSimpler(input: {
    lessonContext: LessonContext;
    lastThreeMessages: LessonMessage[];
    teachingPreference?: TeachingPreference;
  }): Promise<string>;
  giveExample(input: {
    lessonContext: LessonContext;
    lastThreeMessages: LessonMessage[];
    teachingPreference?: TeachingPreference;
  }): Promise<string>;
  /**
   * "Challenge me" — the challenge coach for the current step. Asks one practice
   * question at a time and gives feedback; never advances the main lesson.
   * `studentAnswer` is empty when starting (the coach asks the first question).
   */
  askChallenge(input: {
    lessonContext: LessonContext;
    transcript: LessonMessage[];
    studentAnswer: string;
    teachingPreference?: TeachingPreference;
  }): Promise<string>;
  getRecommendedVideo(input: { lessonContext: LessonContext; teachingPreference?: TeachingPreference }): Promise<RecommendedVideo>;
}
