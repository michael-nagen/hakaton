// ── Lesson Assistant — YouTube video provider ────────────────────────
//
// Finds a relevant lesson video behind the LessonVideoProvider interface, so
// the UI only ever asks for "a video for this lesson".
//
//   • With VITE_YOUTUBE_API_KEY set → the YouTube Data API v3 returns a precise
//     top embeddable video (real id, title, channel, thumbnail); the UI embeds
//     https://www.youtube.com/embed/<videoId> and offers a "watch on YouTube"
//     link.
//   • Without a key (or if the search fails) → we NEVER leave the learner with
//     nothing. We return a topic-scoped FALLBACK: a direct YouTube search link
//     the learner can click (isFallback:true, no embed). It is grounded in the
//     lesson topic (e.g. a print() lesson → "python print function …"), never a
//     generic "python" link.
//
// Set VITE_YOUTUBE_API_KEY (see .env.example) to enable the embedded search.

import type { LessonContext, LessonVideoProvider, RecommendedVideo, TeachingPreference } from './lesson-assistant.types';

const EMBED = 'https://www.youtube.com/embed';
const WATCH = 'https://www.youtube.com/watch?v=';
const SEARCH = 'https://www.youtube.com/results?search_query=';

/** Kept for backward compatibility. No longer thrown — the provider now returns
 * a usable fallback link instead of failing when no API key is configured. */
export class VideoSearchNotConfiguredError extends Error {
  constructor() {
    super('Video search is not configured.');
    this.name = 'VideoSearchNotConfiguredError';
  }
}

// Simple, safe search-term nudges per preset. Style only — never replaces the
// topic terms; just appended.
const PRESET_VIDEO_TERMS: Record<string, string> = {
  step_by_step: 'step by step beginner tutorial',
  examples_first: 'examples tutorial',
  simple_language: 'beginner friendly explanation',
  ask_questions: 'interactive tutorial practice questions',
  real_world: 'real world use case practical tutorial',
};

/** Preference-derived extra query terms (kept short + reasonable). */
function preferenceTerms(pref?: TeachingPreference): string {
  if (!pref) return '';
  if (pref.source === 'preset' && pref.presetId) return PRESET_VIDEO_TERMS[pref.presetId] ?? '';
  // Custom: append only the first few words so the query stays reasonable.
  return pref.instruction.trim().split(/\s+/).slice(0, 6).join(' ');
}

function readApiKey(): string | undefined {
  try {
    return (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_YOUTUBE_API_KEY || undefined;
  } catch {
    return undefined;
  }
}

/** Build a compact, relevant search query from the lesson context + preference. */
export function buildVideoQuery(ctx: LessonContext, teachingPreference?: TeachingPreference): string {
  // Keep the step content short so the query stays focused.
  const stepBit = ctx.currentStepContent ? ctx.currentStepContent.split(/\s+/).slice(0, 10).join(' ') : '';
  // Lead with the course title (e.g. "Python First Steps") when available so a
  // topic like print() finds Python videos rather than any "print" video.
  const base = [ctx.courseTitle, ctx.lessonTitle, ctx.lessonTopic, ctx.currentStepTitle, stepBit]
    .filter(Boolean)
    .join(' ')
    .trim();
  return `${base} explained for beginners ${preferenceTerms(teachingPreference)}`.replace(/\s+/g, ' ').trim();
}

/**
 * A tighter, topic-aware query for the keyless FALLBACK link. It leans on the
 * lesson subject (print / numbers / variables) plus the course title so the
 * search lands on focused beginner videos — not a generic Python playlist.
 */
export function buildFallbackVideoQuery(ctx: LessonContext): string {
  const hay = `${ctx.lessonTitle} ${ctx.lessonTopic ?? ''} ${ctx.currentStepTitle ?? ''} ${ctx.currentStepContent ?? ''}`.toLowerCase();
  const course = ctx.courseTitle && /python/i.test(ctx.courseTitle) ? 'python' : ctx.courseTitle ?? '';
  const lead = course || 'python';
  if (/\bprint\b|output|hello|"?text"?/.test(hay)) return `${lead} print function output for beginners tutorial`;
  if (/variable/.test(hay)) return `${lead} variables for beginners tutorial`;
  if (/number|integer|float|math/.test(hay)) return `${lead} printing numbers for beginners tutorial`;
  // Grounded in the actual lesson title so it still matches the topic.
  return `${lead} ${ctx.lessonTitle} for beginners tutorial`.replace(/\s+/g, ' ').trim();
}

/** The always-usable fallback: a direct, topic-scoped YouTube search link. */
export function buildFallbackVideo(ctx: LessonContext): RecommendedVideo {
  const query = buildFallbackVideoQuery(ctx);
  return {
    videoId: '',
    title: `Beginner videos for: ${ctx.lessonTitle}`,
    embedUrl: '',
    watchUrl: `${SEARCH}${encodeURIComponent(query)}`,
    isFallback: true,
  };
}

interface YouTubeSearchResponse {
  items?: Array<{
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      channelTitle?: string;
      thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
    };
  }>;
}

export function createYouTubeLessonVideoProvider(): LessonVideoProvider {
  return {
    async findRelevantVideo({ lessonContext, teachingPreference }): Promise<RecommendedVideo> {
      const apiKey = readApiKey();
      // No key → don't fake a selected video, but still hand the learner a
      // topic-scoped link they can click.
      if (!apiKey) return buildFallbackVideo(lessonContext);

      try {
        const query = buildVideoQuery(lessonContext, teachingPreference);
        // Precise selection via the YouTube Data API (top embeddable video).
        const url =
          'https://www.googleapis.com/youtube/v3/search' +
          `?part=snippet&type=video&videoEmbeddable=true&maxResults=1&safeSearch=strict` +
          `&q=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url);
        if (!res.ok) return buildFallbackVideo(lessonContext);
        const data = (await res.json()) as YouTubeSearchResponse;
        const item = data.items?.[0];
        const videoId = item?.id?.videoId;
        if (!videoId) return buildFallbackVideo(lessonContext);
        return {
          videoId,
          title: item?.snippet?.title ?? lessonContext.lessonTitle,
          channelTitle: item?.snippet?.channelTitle,
          thumbnailUrl: item?.snippet?.thumbnails?.medium?.url ?? item?.snippet?.thumbnails?.default?.url,
          // The UI embeds this in an <iframe>; a real, specific video id.
          embedUrl: `${EMBED}/${videoId}`,
          watchUrl: `${WATCH}${videoId}`,
        };
      } catch {
        // Network / parsing failure → still give the learner something useful.
        return buildFallbackVideo(lessonContext);
      }
    },
  };
}
