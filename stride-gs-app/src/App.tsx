import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth, type AuthUser } from './contexts/AuthContext';
import { AppLayout } from './components/layout/AppLayout';
import { Login } from './pages/Login';
import { LoadingScreen } from './components/shared/LoadingScreen';
import { AccessDenied } from './pages/AccessDenied';
import { SetNewPassword } from './components/shared/SetNewPassword';
import { Dashboard } from './pages/Dashboard';
import { Inventory } from './pages/Inventory';
const ItemPage = React.lazy(() => import('./pages/ItemPage').then(m => ({ default: m.ItemPage })));
import { Receiving } from './pages/Receiving';
import { Tasks } from './pages/Tasks';
import { Repairs } from './pages/Repairs';
import { WillCalls } from './pages/WillCalls';
import { Billing } from './pages/Billing';
import { Payments } from './pages/Payments';
import { Claims } from './pages/Claims';
import { Shipments } from './pages/Shipments';
import { Settings } from './pages/Settings';
import { Scanner } from './pages/Scanner';
import { Labels } from './pages/Labels';
import { Marketing } from './pages/Marketing';
const TaskPage = React.lazy(() => import('./pages/TaskPage').then(m => ({ default: m.TaskPage })));
const WillCallPage = React.lazy(() => import('./pages/WillCallPage').then(m => ({ default: m.WillCallPage })));
const RepairPage = React.lazy(() => import('./pages/RepairPage').then(m => ({ default: m.RepairPage })));
const ShipmentPage = React.lazy(() => import('./pages/ShipmentPage').then(m => ({ default: m.ShipmentPage })));
const OrderPage = React.lazy(() => import('./pages/OrderPage').then(m => ({ default: m.OrderPage })));
const DetailPanelMockup = React.lazy(() => import('./pages/DetailPanelMockup').then(m => ({ default: m.DetailPanelMockup })));
import { Orders } from './pages/Orders';
import { QuoteTool } from './pages/QuoteTool';
import { PriceList } from './pages/PriceList';
import { Intakes } from './pages/Intakes';
import { PublicRates } from './pages/PublicRates';
import { PublicPhotoGallery } from './pages/PublicPhotoGallery';
import { ClientIntake } from './pages/ClientIntake';
import { MessagesPage } from './components/messages/MessagesPage';

/** Route guard — redirects to dashboard if user's role is not in the allowed list */
function RoleGuard({ allowed, children }: { allowed: AuthUser['role'][]; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user || !allowed.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const { user, loading, accessDenied, deniedReason, passwordRecoveryMode, recoveryExpired } = useAuth();

  // Public routes — render without auth. Check hash before any auth gate.
  const ratesMatch = typeof window !== 'undefined'
    ? window.location.hash.match(/^#\/rates\/([A-Za-z0-9_-]+)/)
    : null;
  if (ratesMatch) return <PublicRates shareId={ratesMatch[1]} />;

  // Client intake wizard — public onboarding form gated only by the
  // magic linkId. Same pre-auth pattern as /rates.
  const intakeMatch = typeof window !== 'undefined'
    ? window.location.hash.match(/^#\/intake\/([A-Za-z0-9_-]+)/)
    : null;
  if (intakeMatch) return <ClientIntake linkId={intakeMatch[1]} />;

  // Public photo gallery — anyone with the link can view a snapshot of
  // selected photos for an entity (item / job). Anon Supabase reads gated
  // by RLS in 20260426100000_photo_shares.sql.
  const photoShareMatch = typeof window !== 'undefined'
    ? window.location.hash.match(/^#\/shared\/photos\/([A-Za-z0-9_-]+)/)
    : null;
  if (photoShareMatch) return <PublicPhotoGallery shareId={photoShareMatch[1]} />;

  // Auth check in progress
  if (loading) return <LoadingScreen />;

  // Password reset callback — show change-password form, or expired-link error
  if (passwordRecoveryMode || recoveryExpired) return <SetNewPassword />;

  // Supabase auth succeeded but user not in Users tab / deactivated
  if (accessDenied) return <AccessDenied reason={deniedReason} />;

  // Not logged in
  if (!user) return <Login />;

  // Authenticated — render app
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppLayout />}>
          {/* Open to all roles */}
          <Route path="/" element={<Dashboard />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/inventory/:itemId" element={<React.Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>Loading...</div>}><ItemPage /></React.Suspense>} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/tasks/:taskId" element={<React.Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>Loading...</div>}><TaskPage /></React.Suspense>} />
          <Route path="/repairs" element={<Repairs />} />
          <Route path="/repairs/:repairId" element={<React.Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>Loading...</div>}><RepairPage /></React.Suspense>} />
          <Route path="/will-calls" element={<WillCalls />} />
          <Route path="/will-calls/:wcNumber" element={<React.Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>Loading...</div>}><WillCallPage /></React.Suspense>} />
          <Route path="/shipments" element={<Shipments />} />
          <Route path="/shipments/:shipmentNo" element={<React.Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>Loading...</div>}><ShipmentPage /></React.Suspense>} />
          {/* Admin + staff only */}
          <Route path="/receiving" element={<RoleGuard allowed={['admin', 'staff']}><Receiving /></RoleGuard>} />
          <Route path="/scanner" element={<RoleGuard allowed={['admin', 'staff']}><Scanner /></RoleGuard>} />
          <Route path="/labels" element={<RoleGuard allowed={['admin', 'staff']}><Labels /></RoleGuard>} />
          {/* Admin + client only */}
          <Route path="/claims" element={<RoleGuard allowed={['admin', 'client']}><Claims /></RoleGuard>} />
          {/* Admin only */}
          <Route path="/orders" element={<RoleGuard allowed={['admin', 'client']}><Orders /></RoleGuard>} />
          <Route path="/orders/:orderId" element={<RoleGuard allowed={['admin', 'client']}><React.Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>Loading...</div>}><OrderPage /></React.Suspense></RoleGuard>} />
          <Route path="/billing" element={<RoleGuard allowed={['admin']}><Billing /></RoleGuard>} />
          <Route path="/payments" element={<RoleGuard allowed={['admin']}><Payments /></RoleGuard>} />
          <Route path="/marketing" element={<RoleGuard allowed={['admin']}><Marketing /></RoleGuard>} />
          <Route path="/quotes" element={<RoleGuard allowed={['admin']}><QuoteTool /></RoleGuard>} />
          <Route path="/price-list" element={<RoleGuard allowed={['admin']}><PriceList /></RoleGuard>} />
          <Route path="/intakes" element={<RoleGuard allowed={['admin']}><Intakes /></RoleGuard>} />
          <Route path="/settings" element={<RoleGuard allowed={['admin']}><Settings /></RoleGuard>} />
          {/* Session 70 follow-up — admin-only DetailHeader mockup for reviewing the proposed
              unified layout across all 7 detail panel types before mass adoption. */}
          <Route path="/mockup/panels" element={<RoleGuard allowed={['admin']}><React.Suspense fallback={<div style={{ padding: 20 }}>Loading mockup...</div>}><DetailPanelMockup /></React.Suspense></RoleGuard>} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
