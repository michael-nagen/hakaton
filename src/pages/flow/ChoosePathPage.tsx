// ── Page 3 · Choose Your Path (course catalog) ────────────────────────
// A cinematic header band, then a calm course listing grouped by field. Only
// "AI Fundamentals" is active in this prototype — it opens the course path.
// Every other card stays visible but inactive (no navigation, no hover lift).
//
// Ported from the "Choose Your Path" design.

import { useNavigate } from 'react-router-dom';

interface Course {
  title: string;
  desc: string;
  lessons: number;
  active?: boolean;
}

const SECTIONS: { name: string; count: string; tile: string; tileColor: string; icon: React.ReactNode; courses: Course[] }[] = [
  {
    name: 'Business Management',
    count: '4 courses',
    tile: 'var(--evergreen-tile)',
    tileColor: 'var(--evergreen-text)',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17l6-6 4 4 8-8" />
        <path d="M17 7h4v4" />
      </svg>
    ),
    courses: [
      { title: 'Business Foundations', desc: 'Learn how businesses create value, serve customers, and grow.', lessons: 6 },
      { title: 'Marketing Basics', desc: 'Understand customers, positioning, and how products reach the market.', lessons: 5 },
      { title: 'Finance for Founders', desc: 'Learn the basics of money, pricing, profit, and cash flow.', lessons: 6 },
      { title: 'Leadership & Teams', desc: 'Learn how to work with people, make decisions, and lead with clarity.', lessons: 5 },
    ],
  },
  {
    name: 'AI Engineering',
    count: '4 courses',
    tile: 'var(--lavender-tile)',
    tileColor: 'var(--lavender-text)',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2c.3 3.6 2.4 5.7 6 6-3.6.3-5.7 2.4-6 6-.3-3.6-2.4-5.7-6-6 3.6-.3 5.7-2.4 6-6z" />
      </svg>
    ),
    courses: [
      { title: 'Python Variables Basics', desc: 'Learn what a variable is, how to name one, assign a value with =, and print it.', lessons: 4, active: true },
      { title: 'Prompt Engineering', desc: 'Learn how to communicate clearly with AI models and shape better outputs.', lessons: 5 },
      { title: 'AI Product Building', desc: 'Learn how to turn an AI idea into a working product experience.', lessons: 6 },
      { title: 'Local AI & Open Models', desc: 'Learn how local models work and how to use them in real products.', lessons: 5 },
    ],
  },
];

export function ChoosePathPage() {
  const navigate = useNavigate();

  return (
    <div className="mds mds-scroll" style={{ minHeight: '100vh', overflowY: 'auto', background: 'var(--color-bg)' }}>
      {/* HEADER BAND */}
      <div style={{ position: 'relative', height: 330, overflow: 'hidden', background: '#0A0A0A' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: 'url(/assets/catalog-daylight.svg)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to top, rgba(10,10,10,0.82) 0%, rgba(10,10,10,0.4) 34%, rgba(10,10,10,0) 66%)',
            zIndex: 2,
          }}
        />
        <div style={{ position: 'absolute', top: 30, left: 56, display: 'flex', alignItems: 'center', gap: 10, zIndex: 3 }}>
          <div style={{ width: 26, height: 26, borderRadius: 8, background: 'rgba(255,255,255,0.94)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 11, height: 11, borderRadius: 3, background: '#0A0A0A' }} />
          </div>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.92)' }}>
            Maestro
          </span>
        </div>
        <div style={{ position: 'absolute', left: 56, bottom: 40, right: 56, zIndex: 3 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 44, lineHeight: 1.04, fontWeight: 600, letterSpacing: '-1px', color: '#ffffff', textShadow: '0 2px 34px rgba(0,0,0,0.35)' }}>
            Choose Your Path
          </h2>
          <p style={{ margin: '16px 0 0', fontFamily: 'var(--font-text)', fontSize: 19, lineHeight: 1.4, fontWeight: 500, color: 'rgba(255,255,255,0.9)' }}>
            Choose the future you want to build.
          </p>
          <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-text)', fontSize: 16, lineHeight: 1.45, fontWeight: 400, color: 'rgba(255,255,255,0.72)' }}>
            Pick a field and begin your first course.
          </p>
        </div>
      </div>

      {/* CATALOG BODY */}
      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '56px 40px 76px', display: 'flex', flexDirection: 'column', gap: 64 }}>
        {SECTIONS.map((section) => (
          <section key={section.name}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
              <div style={{ flex: 'none', width: 40, height: 40, borderRadius: 12, background: section.tile, color: section.tileColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {section.icon}
              </div>
              <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--color-fg)' }}>{section.name}</h3>
              <span style={{ fontFamily: 'var(--font-text)', fontSize: 14, whiteSpace: 'nowrap', color: 'var(--color-fg-tertiary)' }}>{section.count}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 20 }}>
              {section.courses.map((course) => (
                <CourseCard
                  key={course.title}
                  course={course}
                  onOpen={course.active ? () => navigate('/learn/ai-fundamentals') : undefined}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function CourseCard({ course, onOpen }: { course: Course; onOpen?: () => void }) {
  const active = Boolean(onOpen);
  return (
    <div
      className={active ? 'mds-card' : undefined}
      onClick={onOpen}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 16,
        padding: 24,
        cursor: active ? 'pointer' : 'default',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 172,
        boxSizing: 'border-box',
        opacity: active ? 1 : 0.55,
      }}
    >
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--color-fg)' }}>{course.title}</div>
      <div style={{ marginTop: 8, fontFamily: 'var(--font-text)', fontSize: 14, lineHeight: 1.5, color: 'var(--color-fg-secondary)' }}>{course.desc}</div>
      <div style={{ marginTop: 'auto', paddingTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontFamily: 'var(--font-text)', fontSize: 13, color: 'var(--color-fg-tertiary)' }}>
          {course.lessons} lessons&ensp;·&ensp;Beginner
        </span>
        <span
          style={{
            flex: 'none',
            height: 34,
            padding: '0 16px',
            display: 'inline-flex',
            alignItems: 'center',
            borderRadius: 9999,
            border: '1px solid var(--color-border-strong)',
            color: 'var(--color-fg)',
            fontFamily: 'var(--font-text)',
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          {active ? 'Open Course' : 'Coming soon'}
        </span>
      </div>
    </div>
  );
}
