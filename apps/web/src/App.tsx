import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { useSession } from './lib/session';
import { AuditPage } from './pages/admin/AuditPage';
import { CheckpointsPage } from './pages/admin/CheckpointsPage';
import { NumberingPage } from './pages/admin/NumberingPage';
import { RolesPage } from './pages/admin/RolesPage';
import { SharingPage } from './pages/admin/SharingPage';
import { UserFormPage, UsersPage } from './pages/admin/UsersPage';
import { DashboardPage } from './pages/DashboardPage';
import { InboxPage } from './pages/flow/InboxPage';
import { InboxReviewPage } from './pages/flow/InboxReviewPage';
import { TrackerPage } from './pages/flow/TrackerPage';
import { VendorPosPage } from './pages/flow/VendorPosPage';
import { FreightDetailPage } from './pages/freight/FreightDetailPage';
import { FreightListPage, FreightNewPage } from './pages/freight/FreightListPage';
import { MailboxPage } from './pages/freight/MailboxPage';
import { DocumentFormPage } from './pages/DocumentFormPage';
import { DocumentListPage } from './pages/DocumentListPage';
import { HomePage } from './pages/HomePage';
import { ChangePasswordPage, LoginPage } from './pages/LoginPage';
import { MasterFormPage } from './pages/MasterFormPage';
import { MasterListPage } from './pages/MasterListPage';
import { BuyersPage } from './pages/mis/BuyersPage';
import { DocumentationPage } from './pages/mis/DocumentationPage';
import { FinancialPage } from './pages/mis/FinancialPage';
import { LogisticsPage } from './pages/mis/LogisticsPage';
import { OrdersPage } from './pages/mis/OrdersPage';
import { ProductsPage } from './pages/mis/ProductsPage';
import { ReportsPage } from './pages/mis/ReportsPage';
import { TradePage } from './pages/mis/TradePage';
import { OrderPlanningPage } from './pages/OrderPlanningPage';
import { ProformaReportsPage } from './pages/ProformaReportsPage';
import { RecycleBinPage } from './pages/RecycleBinPage';
import { ShipmentsPage } from './pages/ShipmentsPage';

const NotFound = () => <div className="p-6 text-slate-500">Page not found. Press Ctrl+K to find a screen.</div>;

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/mis', element: <DashboardPage /> },
      { path: '/mis/trade', element: <TradePage /> },
      { path: '/mis/buyers', element: <BuyersPage /> },
      { path: '/mis/orders', element: <OrdersPage /> },
      { path: '/mis/logistics', element: <LogisticsPage /> },
      { path: '/mis/financial', element: <FinancialPage /> },
      { path: '/mis/products', element: <ProductsPage /> },
      { path: '/mis/documentation', element: <DocumentationPage /> },
      { path: '/mis/reports', element: <ReportsPage /> },
      { path: '/shipments', element: <ShipmentsPage /> },
      { path: '/inbox', element: <InboxPage /> },
      { path: '/inbox/:id', element: <InboxReviewPage /> },
      { path: '/tracker', element: <TrackerPage /> },
      { path: '/vendor-pos', element: <VendorPosPage /> },
      { path: '/freight', element: <FreightListPage /> },
      { path: '/freight/new', element: <FreightNewPage /> },
      { path: '/freight/mailbox', element: <MailboxPage /> },
      { path: '/freight/:id', element: <FreightDetailPage /> },
      { path: '/plan/:piId', element: <OrderPlanningPage /> },
      { path: '/d/:doc', element: <DocumentListPage /> },
      { path: '/d/:doc/:id', element: <DocumentFormPage /> },
      { path: '/reports/proforma', element: <ProformaReportsPage /> },
      { path: '/m/:entity', element: <MasterListPage /> },
      { path: '/m/:entity/:id', element: <MasterFormPage /> },
      { path: '/admin/users', element: <UsersPage /> },
      { path: '/admin/users/:id', element: <UserFormPage /> },
      { path: '/admin/roles', element: <RolesPage /> },
      { path: '/admin/sharing', element: <SharingPage /> },
      { path: '/admin/numbering', element: <NumberingPage /> },
      { path: '/admin/audit', element: <AuditPage /> },
      { path: '/admin/checkpoints', element: <CheckpointsPage /> },
      { path: '/recycle-bin', element: <RecycleBinPage /> },
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
