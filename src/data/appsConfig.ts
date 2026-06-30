// ── Types ────────────────────────────────────────────────────────────
export type AppStatus = 'new' | 'beta' | 'updated' | 'locked' | 'maintenance';
export type Accent = 'evergreen' | 'lavender' | 'sunset';
export type Layout = 'track' | 'grid' | 'compact';

export interface AppItem {
  id: string;
  code: string;
  title: string;
  icon: string;
  accent: Accent;
  description?: string;
  status?: AppStatus;
  disabled?: boolean;
}

export interface AppSection {
  id: string;
  label: string;
  apps: AppItem[];
}

export interface ScreenLink {
  icon: string;
  title: string;
  desc: string;
}

export interface ScreenContent {
  introHeading: string;
  intro: string;
  primary: string;
  secondary?: string;
  links: ScreenLink[];
}

export interface NavItem {
  id: string;
  name: string;
  icon: string;
  locked?: boolean;
}

// ── Accent color config ──────────────────────────────────────────────
export const ACCENTS: Record<Accent, { tile: string; fg: string }> = {
  evergreen: { tile: 'rgba(165,219,109,0.14)', fg: '#CEF585' },
  lavender:  { tile: 'rgba(128,143,240,0.16)', fg: '#A6B2F7' },
  sunset:    { tile: 'rgba(236,103,61,0.16)',  fg: '#FF8B62' },
};

// ── Status badge config ──────────────────────────────────────────────
export const STATUS_CONFIG: Record<AppStatus, { label: string; bg: string; color: string; border: string }> = {
  new:         { label: 'New',         bg: '#CEF585',                    color: '#1A3426',          border: 'transparent' },
  beta:        { label: 'Beta',        bg: 'rgba(128,143,240,0.18)',     color: '#A6B2F7',          border: 'rgba(128,143,240,0.45)' },
  updated:     { label: 'Updated',     bg: 'rgba(236,103,61,0.16)',      color: '#FF8B62',          border: 'rgba(236,103,61,0.45)' },
  locked:      { label: 'Locked',      bg: 'transparent',                color: 'var(--fg-3)',      border: 'var(--maestro-ink-3)' },
  maintenance: { label: 'Maintenance', bg: 'transparent',                color: 'var(--fg-3)',      border: 'var(--maestro-ink-3)' },
};

// ── App catalogue ────────────────────────────────────────────────────
// To add a new app: add an object to the appropriate section's `apps` array.
// To add a new section: add a new object to SECTIONS with `id`, `label`, and `apps`.
export const SECTIONS: AppSection[] = [
  {
    id: 'learn',
    label: 'Learn',
    apps: [
      { id: 'course-player', code: 'PLAY', title: 'Course player', icon: 'graduation', accent: 'lavender',  description: 'Pick up where you left off in your current track.' },
      { id: 'assignments',   code: 'WORK', title: 'Assignments',   icon: 'clipboard',  accent: 'sunset',    description: 'Submit work and follow feedback from reviewers.', status: 'updated' },
      { id: 'library',       code: 'LIB',  title: 'Library',       icon: 'book',       accent: 'evergreen', description: 'Readings, references and saved resources.' },
    ],
  },
  {
    id: 'build',
    label: 'Build',
    apps: [
      { id: 'studio',   code: 'STD', title: 'Studio',   icon: 'palette',  accent: 'evergreen', description: 'Your project workspace for built work.' },
      { id: 'sandbox',  code: 'LAB', title: 'Sandbox',  icon: 'flask',    accent: 'lavender',  description: 'Experiment freely — nothing here is graded.', status: 'beta' },
      { id: 'ai-tutor', code: 'AI',  title: 'AI tutor', icon: 'sparkles', accent: 'sunset',    description: 'Ask anything, get unstuck, go deeper.', status: 'new' },
    ],
  },
  {
    id: 'connect',
    label: 'Connect',
    apps: [
      { id: 'cohort',     code: 'CHT', title: 'Cohort',     icon: 'users',    accent: 'lavender',  description: 'Your people — message and meet your peers.' },
      { id: 'mentorship', code: 'MTR', title: 'Mentorship', icon: 'compass',  accent: 'evergreen' },
      { id: 'events',     code: 'EVT', title: 'Events',     icon: 'calendar', accent: 'sunset',    description: 'Workshops, critiques and studio hours.' },
    ],
  },
  {
    id: 'records',
    label: 'Records',
    apps: [
      { id: 'transcript', code: 'TRN', title: 'Transcript', icon: 'file', accent: 'lavender', description: 'Your verified record of progress.',               status: 'locked',      disabled: true },
      { id: 'billing',    code: 'BIL', title: 'Billing',    icon: 'card', accent: 'sunset',   description: 'Temporarily offline while we make updates.', status: 'maintenance', disabled: true },
    ],
  },
];

// ── Per-app detail screen content ────────────────────────────────────
// To add a new app screen: add an entry with the same key as the app's `id`.
export const SCREEN_CONTENT: Record<string, ScreenContent> = {
  'course-player': {
    introHeading: 'Pick up where you left off',
    intro: 'Resume your current lesson and keep your momentum going.',
    primary: 'Continue lesson',
    links: [
      { icon: 'bookpair',  title: 'Syllabus',   desc: 'The full path for this track' },
      { icon: 'file',      title: 'Notes',      desc: 'Your highlights and saved notes' },
      { icon: 'download',  title: 'Downloads',  desc: 'Offline materials' },
    ],
  },
  'assignments': {
    introHeading: 'Your open work',
    intro: 'Track what is due, submit deliverables and read reviewer feedback in one place.',
    primary: 'View tasks',
    links: [
      { icon: 'clipboard',  title: 'Open tasks', desc: 'What needs your attention' },
      { icon: 'file',       title: 'Submitted',  desc: 'Everything you have turned in' },
      { icon: 'discussion', title: 'Feedback',   desc: 'Notes from your reviewers' },
    ],
  },
  'library': {
    introHeading: 'Find something to read',
    intro: 'Curated readings, references and the things you have saved for later.',
    primary: 'Browse library',
    links: [
      { icon: 'bookpair', title: 'Reading lists',   desc: 'Curated by your mentors' },
      { icon: 'book',     title: 'Saved',           desc: 'Your bookmarked resources' },
      { icon: 'compass',  title: 'Recently viewed', desc: 'Jump back in' },
    ],
  },
  'studio': {
    introHeading: 'Open your workspace',
    intro: 'Your studio is where built work lives — files, builds and everything in progress.',
    primary: 'Open studio',
    links: [
      { icon: 'folder', title: 'Files',  desc: 'Your working directory' },
      { icon: 'play',   title: 'Builds', desc: 'Recent runs and previews' },
      { icon: 'users',  title: 'Share',  desc: 'Invite people to collaborate' },
    ],
  },
  'sandbox': {
    introHeading: 'Try something out',
    intro: 'A free space to experiment — nothing here is graded, so go wide.',
    primary: 'New sandbox',
    links: [
      { icon: 'flask',   title: 'Recent',    desc: 'Pick up an experiment' },
      { icon: 'folder',  title: 'Templates', desc: 'Start from a scaffold' },
      { icon: 'file',    title: 'Docs',      desc: 'How the sandbox works' },
    ],
  },
  'ai-tutor': {
    introHeading: 'Ask anything',
    intro: 'Get unstuck, go deeper on an idea, or talk through your work with your tutor.',
    primary: 'Start a chat',
    links: [
      { icon: 'sparkles',   title: 'New chat', desc: 'Begin a fresh conversation' },
      { icon: 'discussion', title: 'History',  desc: 'Revisit past chats' },
      { icon: 'file',       title: 'Prompts',  desc: 'Starting points to try' },
    ],
  },
  'cohort': {
    introHeading: 'Your people',
    intro: 'Message your peers, find your channels and see what the cohort is up to.',
    primary: 'Open cohort',
    links: [
      { icon: 'users',      title: 'Members',  desc: 'Who is in your cohort' },
      { icon: 'discussion', title: 'Channels', desc: 'Conversations by topic' },
      { icon: 'calendar',   title: 'Calendar', desc: 'Shared cohort events' },
    ],
  },
  'mentorship': {
    introHeading: 'Meet your mentor',
    intro: 'Book time, prepare topics and keep notes from every session.',
    primary: 'Book a session',
    links: [
      { icon: 'calendar', title: 'Upcoming', desc: 'Your next sessions' },
      { icon: 'users',    title: 'Mentors',  desc: 'Browse and request' },
      { icon: 'file',     title: 'Notes',    desc: 'Session takeaways' },
    ],
  },
  'events': {
    introHeading: 'What is coming up',
    intro: 'Workshops, critiques and studio hours — see what is on and register.',
    primary: 'See schedule',
    links: [
      { icon: 'calendar',  title: 'This week', desc: 'Happening now' },
      { icon: 'clipboard', title: 'Register',  desc: 'Save your spot' },
      { icon: 'compass',   title: 'Past',      desc: 'Recordings and recaps' },
    ],
  },
  'services': {
    introHeading: 'How can we help?',
    intro: 'Help, support and account services for your Maestro workspace.',
    primary: 'Contact support',
    links: [
      { icon: 'book',       title: 'Help center', desc: 'Guides and FAQs' },
      { icon: 'discussion', title: 'Tickets',     desc: 'Your support requests' },
      { icon: 'wrench',     title: 'Status',      desc: 'System and account status' },
    ],
  },
};

// ── Sidebar navigation ───────────────────────────────────────────────
// NAV_A: primary nav (home, learn, services)
// NAV_B: secondary locked nav (shown below divider)
export const NAV_A: NavItem[] = [
  { id: 'home',     name: 'Home',     icon: 'home' },
  { id: 'learn',    name: 'Learn',    icon: 'bookpair', locked: true },
  { id: 'services', name: 'Services', icon: 'help' },
];

export const NAV_B: NavItem[] = [
  { id: 'practice',     name: 'Practice',     icon: 'atom',       locked: true },
  { id: 'projects',     name: 'Projects',     icon: 'folder',     locked: true },
  { id: 'discussions',  name: 'Discussions',  icon: 'discussion', locked: true },
  { id: 'leaderboards', name: 'Leaderboards', icon: 'trophy',     locked: true },
  { id: 'community',    name: 'Community',    icon: 'globe',      locked: true },
  { id: 'shop',         name: 'Shop',         icon: 'store',      locked: true },
];

// ── Helpers ──────────────────────────────────────────────────────────
export function findApp(id: string): { app: AppItem; sectionLabel: string } | null {
  for (const section of SECTIONS) {
    const app = section.apps.find(a => a.id === id);
    if (app) return { app, sectionLabel: section.label };
  }
  if (id === 'services') {
    return {
      app: { id: 'services', code: 'SVC', title: 'Services', icon: 'help', accent: 'lavender', description: 'Help, support and account services for your Maestro workspace.' },
      sectionLabel: 'Support',
    };
  }
  return null;
}
