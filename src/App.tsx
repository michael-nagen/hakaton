import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AppShell } from './layouts/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { AppDetailPage } from './pages/AppDetailPage';
import { CourseCatalogPage } from './pages/lesson/CourseCatalogPage';
import { CoursePlayerPage } from './pages/lesson/CoursePlayerPage';
import { AiSetupPage } from './pages/AiSetupPage';
import { WelcomePage } from './pages/flow/WelcomePage';
import { ChooseGuidePage } from './pages/flow/ChooseGuidePage';
import { ChoosePathPage } from './pages/flow/ChoosePathPage';
import { AiFundamentalsPage } from './pages/flow/AiFundamentalsPage';
import { AiProviderProvider } from './contexts/AiProviderContext';

const router = createBrowserRouter([
  // ── Main product: the MVP learning flow (Maestro design) ──────────────
  // 1) Welcome  2) Choose AI guide  3) Choose your path (catalog)
  // 4) Course path  5) Lesson parts  6) Guided tutor room.
  // Pages 4–6 live inside one component (AiFundamentalsPage) with local view
  // state, exactly as the design models them.
  { path: '/', element: <WelcomePage /> },                     // Page 1
  { path: '/guide', element: <ChooseGuidePage /> },            // Page 2
  { path: '/paths', element: <ChoosePathPage /> },             // Page 3
  { path: '/learn/ai-fundamentals', element: <AiFundamentalsPage /> }, // Pages 4–6

  // ── Secondary / internal (not part of the main flow) ──────────────────
  // The earlier technical screens (provider setup, course player, apps
  // dashboard) are kept reachable by URL but are no longer the entry point.
  { path: '/ai-setup', element: <AiSetupPage /> },
  { path: '/courses', element: <CourseCatalogPage /> },
  { path: '/courses/:courseId', element: <CoursePlayerPage /> },
  {
    element: <AppShell />,
    children: [
      { path: 'apps', element: <DashboardPage /> },
      { path: 'app/:appId', element: <AppDetailPage /> },
    ],
  },
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
