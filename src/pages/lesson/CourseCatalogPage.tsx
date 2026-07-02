// ── CourseCatalogPage — the learning surface entry (/courses) ─────────
//
// Lists prebuilt courses as cards with a per-course progress rollup, and links
// into the course player. Rendered inside AppShell (sidebar/topbar chrome).

import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppIcon } from '../../components/AppIcon';
import { useAiProvider } from '../../contexts/AiProviderContext';
import { getPrebuiltCourses } from '../../course-package';
import { loadCourseProgress } from '../../lesson-runtime';

const SURFACE: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--maestro-ink-3)',
  borderRadius: 'var(--radius-l)',
  padding: 20,
};

const LABEL: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--fg-3)',
};

const PILL: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  lineHeight: '18px',
  padding: '0 8px',
  borderRadius: 'var(--radius-xs)',
  background: 'var(--maestro-ink-3)',
  color: 'var(--fg-3)',
};

export function CourseCatalogPage() {
  const navigate = useNavigate();
  const { config } = useAiProvider();
  const courses = useMemo(() => getPrebuiltCourses(), []);

  return (
    <div style={{ width: '100%', maxWidth: 980, margin: '0 auto', padding: 'clamp(20px,4vw,40px) clamp(16px,4vw,48px) 96px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => navigate('/ai-setup')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 12, cursor: 'pointer', padding: 0 }}
        >
          <AppIcon name="chevronL" size={15} />
          AI guide
        </button>
        {/* Which AI is leading the lessons — set on Screen 1. */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
          Tutor: <span style={{ color: 'var(--fg-2)' }}>{config.displayName}</span>
          <Link to="/ai-setup" style={{ color: 'var(--evergreen-500)', textDecoration: 'none' }}>Change</Link>
        </span>
      </div>

      <p style={{ ...LABEL, margin: '0 0 12px' }}>Courses</p>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, lineHeight: 1.1, letterSpacing: '-0.01em', margin: '0 0 10px', color: 'var(--fg-2)' }}>
        Learn with an <em>AI tutor</em>
      </h1>
      <p style={{ fontFamily: 'var(--font-text)', fontSize: 14, lineHeight: 1.55, color: 'var(--fg-3)', margin: '0 0 24px', maxWidth: 620 }}>
        Prebuilt courses, each taught one lesson at a time by the AI provider you chose in AI setup. Pick a course to see its lessons.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {courses.map((course) => {
          const progress = loadCourseProgress({ courseId: course.id, units: course.units });
          const completed = course.units.filter((u) => progress[u.id]?.status === 'completed').length;
          return (
            <button
              key={course.id}
              type="button"
              onClick={() => navigate(`/courses/${course.id}`)}
              style={{ ...SURFACE, textAlign: 'left', cursor: 'pointer', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={PILL}>{course.metadata.level}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
                  {course.units.length} lessons · ~{course.metadata.estimatedDurationMinutes} min
                </span>
              </span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, color: 'var(--fg-2)' }}>{course.title}</span>
              <span style={{ fontFamily: 'var(--font-text)', fontSize: 13, lineHeight: 1.5, color: 'var(--fg-3)' }}>{course.description}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: completed > 0 ? 'var(--evergreen-500)' : 'var(--fg-3)' }}>
                {completed}/{course.units.length} complete
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
