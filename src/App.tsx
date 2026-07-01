import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AppShell } from './layouts/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { AppDetailPage } from './pages/AppDetailPage';
import { CourseDemoPage } from './pages/CourseDemoPage';
import { CourseCatalogPage } from './pages/lesson/CourseCatalogPage';
import { CoursePlayerPage } from './pages/lesson/CoursePlayerPage';
import { TutorDemoPage } from './pages/TutorDemoPage';
import { SimpleLessonDemoPage } from './pages/SimpleLessonDemoPage';
import { AiSetupPage } from './pages/AiSetupPage';
import { AiProviderProvider } from './contexts/AiProviderContext';

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      // Real learning surface: catalog → course player (lesson list + player).
      { path: 'courses', element: <CourseCatalogPage /> },
      { path: 'courses/:courseId', element: <CoursePlayerPage /> },
      { path: 'course-demo', element: <CourseDemoPage /> },
      { path: 'app/:appId', element: <AppDetailPage /> },
    ],
  },
  // Standalone runtime test harness — deliberately outside AppShell so it has
  // no sidebar/topbar chrome and cannot affect the complex app UI.
  { path: '/tutor-demo', element: <TutorDemoPage /> },
  { path: '/simple-lesson-demo', element: <SimpleLessonDemoPage /> },
  // AI setup — standalone (no shell chrome), like the other demo harnesses.
  { path: '/ai-setup', element: <AiSetupPage /> },
]);

export default function App() {
  // AiProviderProvider wraps the whole app so every page (shell and standalone)
  // reads the same active provider from the on-device config store.
  return (
    <AiProviderProvider>
      <RouterProvider router={router} />
    </AiProviderProvider>
  );
}
