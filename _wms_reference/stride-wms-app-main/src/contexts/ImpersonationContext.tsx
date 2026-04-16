import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface ImpersonationState {
  active: boolean;
  tenantId: string | null;
  tenantName: string | null;
  simulatedRole: string | null;
  logId: string | null;
}

interface ImpersonationContextType {
  /** Whether impersonation is currently active */
  active: boolean;
  /** The impersonated tenant ID (or null if not impersonating) */
  tenantId: string | null;
  /** The impersonated tenant name */
  tenantName: string | null;
  /** The role being simulated */
  simulatedRole: string | null;
  /** Start impersonating a tenant with a given role */
  startImpersonation: (tenantId: string, tenantName: string, role: string) => Promise<void>;
  /** Stop impersonation and return to admin_dev state */
  stopImpersonation: () => Promise<void>;
}

const STORAGE_KEY = 'stride-impersonation';

const ImpersonationContext = createContext<ImpersonationContextType | undefined>(undefined);

/** Exported for safe consumption by usePermissions without a hard provider requirement */
export { ImpersonationContext as __ImpersonationContext };

function loadPersistedState(): ImpersonationState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.active && parsed?.tenantId && parsed?.simulatedRole) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return { active: false, tenantId: null, tenantName: null, simulatedRole: null, logId: null };
}

function persistState(state: ImpersonationState) {
  try {
    if (state.active) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ImpersonationState>(loadPersistedState);

  // Persist state changes
  useEffect(() => {
    persistState(state);
  }, [state]);

  const startImpersonation = useCallback(async (tenantId: string, tenantName: string, role: string) => {
    // Log the impersonation start
    let logId: string | null = null;
    try {
      const { data, error } = await (supabase as any).rpc('rpc_log_impersonation_start', {
        p_target_tenant_id: tenantId,
        p_simulated_role: role,
      });
      if (!error && data) {
        logId = data;
      }
    } catch {
      // Non-blocking — audit logging is best-effort
    }

    const newState: ImpersonationState = {
      active: true,
      tenantId,
      tenantName,
      simulatedRole: role,
      logId,
    };
    setState(newState);
  }, []);

  const stopImpersonation = useCallback(async () => {
    // Log the impersonation end
    if (state.logId) {
      try {
        await (supabase as any).rpc('rpc_log_impersonation_end', {
          p_log_id: state.logId,
        });
      } catch {
        // Non-blocking
      }
    }

    setState({ active: false, tenantId: null, tenantName: null, simulatedRole: null, logId: null });
  }, [state.logId]);

  return (
    <ImpersonationContext.Provider
      value={{
        active: state.active,
        tenantId: state.tenantId,
        tenantName: state.tenantName,
        simulatedRole: state.simulatedRole,
        startImpersonation,
        stopImpersonation,
      }}
    >
      {children}
    </ImpersonationContext.Provider>
  );
}

export function useImpersonation() {
  const ctx = useContext(ImpersonationContext);
  if (!ctx) {
    throw new Error('useImpersonation must be used within ImpersonationProvider');
  }
  return ctx;
}
