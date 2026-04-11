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

/** Route guard — redirects to dashboard if user's role is not in the allowed list */
function RoleGuard({ allowed, children }: { allowed: AuthUser['role'][]; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user || !allowed.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const { user, loading, accessDenied, deniedReason, passwordRecoveryMode } = useAuth();

  // Auth check in progress
  if (loading) return <LoadingScreen />;

  // Password reset callback — show change-password form
  if (passwordRecoveryMode) return <SetNewPassword />;

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
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/repairs" element={<Repairs />} />
          <Route path="/will-calls" element={<WillCalls />} />
          <Route path="/shipments" element={<Shipments />} />
          {/* Admin + staff only */}
          <Route path="/receiving" element={<RoleGuard allowed={['admin', 'staff']}><Receiving /></RoleGuard>} />
          <Route path="/scanner" element={<RoleGuard allowed={['admin', 'staff']}><Scanner /></RoleGuard>} />
          <Route path="/labels" element={<RoleGuard allowed={['admin', 'staff']}><Labels /></RoleGuard>} />
          {/* Admin + client only */}
          <Route path="/claims" element={<RoleGuard allowed={['admin', 'client']}><Claims /></RoleGuard>} />
          {/* Admin only */}
          <Route path="/billing" element={<RoleGuard allowed={['admin']}><Billing /></RoleGuard>} />
          <Route path="/payments" element={<RoleGuard allowed={['admin']}><Payments /></RoleGuard>} />
          <Route path="/marketing" element={<RoleGuard allowed={['admin']}><Marketing /></RoleGuard>} />
          <Route path="/settings" element={<RoleGuard allowed={['admin']}><Settings /></RoleGuard>} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
