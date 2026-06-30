import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AppShell } from './layouts/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { AppDetailPage } from './pages/AppDetailPage';

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'app/:appId', element: <AppDetailPage /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
