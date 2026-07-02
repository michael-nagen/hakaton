import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
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
  // ── Main product: the 3-screen learning flow ──────────────────────────
  // 1) AI guide  2) lesson selection  3) tutor player. Kept standalone (no
  // dashboard chrome) so the experience stays simple: choose AI → choose
  // lesson → learn.
  { path: '/', element: <Navigate to="/ai-setup" replace /> },
  { path: '/ai-setup', element: <AiSetupPage /> },        // Screen 1
  { path: '/courses', element: <CourseCatalogPage /> },   // Screen 2 (catalog)
  { path: '/courses/:courseId', element: <CoursePlayerPage /> }, // Screen 2b + 3

  // ── Secondary / internal (not part of the main flow) ──────────────────
  // The apps dashboard is demoted to /apps; demo harnesses stay reachable by
  // URL for internal testing but are not surfaced in the product navigation.
  {
    element: <AppShell />,
    children: [
      { path: 'apps', element: <DashboardPage /> },
      { path: 'app/:appId', element: <AppDetailPage /> },
      { path: 'course-demo', element: <CourseDemoPage /> },
    ],
  },
  { path: '/tutor-demo', element: <TutorDemoPage /> },
  { path: '/simple-lesson-demo', element: <SimpleLessonDemoPage /> },
]);

export default function App() {
  // AiProviderProvider wraps the whole app so every screen reads the same active
  // provider from the on-device config store.
  return (
    <AiProviderProvider>
      <RouterProvider router={router} />
    </AiProviderProvider>
  );
}
