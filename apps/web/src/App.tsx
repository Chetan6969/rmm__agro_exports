import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { useSession } from './lib/session';
import { AuditPage } from './pages/admin/AuditPage';
import { NumberingPage } from './pages/admin/NumberingPage';
import { RolesPage } from './pages/admin/RolesPage';
import { SharingPage } from './pages/admin/SharingPage';
import { UserFormPage, UsersPage } from './pages/admin/UsersPage';
import { HomePage } from './pages/HomePage';
import { ChangePasswordPage, LoginPage } from './pages/LoginPage';
import { MasterFormPage } from './pages/MasterFormPage';
import { MasterListPage } from './pages/MasterListPage';

const NotFound = () => <div className="p-6 text-slate-500">Page not found. Press Ctrl+K to find a screen.</div>;

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/m/:entity', element: <MasterListPage /> },
      { path: '/m/:entity/:id', element: <MasterFormPage /> },
      { path: '/admin/users', element: <UsersPage /> },
      { path: '/admin/users/:id', element: <UserFormPage /> },
      { path: '/admin/roles', element: <RolesPage /> },
      { path: '/admin/sharing', element: <SharingPage /> },
      { path: '/admin/numbering', element: <NumberingPage /> },
      { path: '/admin/audit', element: <AuditPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export function App() {
  const { session, loading, offline } = useSession();
  if (offline) return <Spinner label="Cannot reach the server. Retrying…" />;
  if (loading) return <Spinner label="Starting…" />;
  if (!session) return <LoginPage />;
  if (session.mustChangePassword) return <ChangePasswordPage forced />;
  return <RouterProvider router={router} />;
}
