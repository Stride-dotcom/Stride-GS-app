import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useSubscriptionGateContext } from '@/components/subscription/SubscriptionGate';
import { isSubscriptionAccessBlocked, useSubscriptionGate } from '@/hooks/useSubscriptionGate';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const contextGate = useSubscriptionGateContext();
  const { data: queryGate, isLoading: gateLoading } = useSubscriptionGate();
  const gate = queryGate ?? contextGate;

  if (loading || (user && gateLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  const path = location.pathname;
  const allowlistedWhileBlocked =
    path === '/subscription/update-payment' ||
    path.startsWith('/subscription/update-payment/');

  if (isSubscriptionAccessBlocked(gate) && !allowlistedWhileBlocked) {
    return <Navigate to="/subscription/update-payment" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
