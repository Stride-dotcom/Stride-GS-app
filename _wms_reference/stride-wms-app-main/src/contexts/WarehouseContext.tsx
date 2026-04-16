import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Warehouse } from '@/hooks/useWarehouses';

// Legacy localStorage key (kept only for one-time migration).
const LEGACY_STORAGE_KEY = 'stride.selectedWarehouseId';
const DEFAULT_WAREHOUSE_PREF_KEY = 'default_warehouse';

interface WarehouseContextType {
  selectedWarehouseId: string | null;
  setSelectedWarehouseId: (id: string | null) => void;
  warehouses: Warehouse[];
  loading: boolean;
  /**
   * True when user has access to multiple warehouses but has not picked a default yet.
   * Intended for showing an interstitial picker.
   */
  needsWarehouseSelection: boolean;
}

const WarehouseContext = createContext<WarehouseContextType | undefined>(undefined);

export function WarehouseProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedId, setSelectedIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsWarehouseSelection, setNeedsWarehouseSelection] = useState(false);

  const persistDefaultWarehouse = useCallback(async (id: string | null) => {
    if (!profile?.id) return;
    try {
      if (!id) {
        await (supabase.from('user_preferences') as any)
          .delete()
          .eq('user_id', profile.id)
          .eq('preference_key', DEFAULT_WAREHOUSE_PREF_KEY);
        return;
      }

      await (supabase.from('user_preferences') as any).upsert(
        {
          user_id: profile.id,
          preference_key: DEFAULT_WAREHOUSE_PREF_KEY,
          preference_value: { warehouseId: id },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,preference_key' }
      );
    } catch (err) {
      console.error('[WarehouseContext] Error persisting default warehouse:', err);
    }
  }, [profile?.id]);

  const setSelectedWarehouseId = useCallback((id: string | null) => {
    setSelectedIdState(id);
    setNeedsWarehouseSelection(false);
    // Best-effort: persist server-side so it carries across devices.
    void persistDefaultWarehouse(id);
  }, [persistDefaultWarehouse]);

  // Fetch warehouses when authenticated
  useEffect(() => {
    if (!profile?.tenant_id || !profile?.id) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchWarehouses = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('warehouses')
          .select('*')
          .is('deleted_at', null)
          .order('name');

        if (error) throw error;
        if (cancelled) return;

        const whs = data || [];
        setWarehouses(whs);

        const isValidWarehouseId = (id: string | null) => !!id && whs.some((w) => w.id === id);

        // Load server-side default warehouse preference.
        let preferredId: string | null = null;
        try {
          const { data: prefRow, error: prefError } = await (supabase.from('user_preferences') as any)
            .select('preference_value')
            .eq('user_id', profile.id)
            .eq('preference_key', DEFAULT_WAREHOUSE_PREF_KEY)
            .maybeSingle();

          if (!prefError && prefRow?.preference_value) {
            const pv = prefRow.preference_value as Record<string, unknown>;
            const candidate =
              (pv.warehouseId as string | undefined) ||
              (pv.warehouse_id as string | undefined) ||
              (pv.id as string | undefined);
            preferredId = typeof candidate === 'string' ? candidate : null;
          }
        } catch (err) {
          console.error('[WarehouseContext] Error fetching default warehouse preference:', err);
        }

        // One-time migration from legacy localStorage value.
        const legacyId = typeof window !== 'undefined' ? localStorage.getItem(LEGACY_STORAGE_KEY) : null;

        const selected =
          isValidWarehouseId(preferredId)
            ? preferredId
            : isValidWarehouseId(legacyId)
              ? legacyId
              : whs.length === 1
                ? whs[0].id
                : null;

        if (selected) {
          setSelectedIdState(selected);
          setNeedsWarehouseSelection(false);

          // If we used legacy localStorage and there is no valid server preference yet, persist it.
          if (!isValidWarehouseId(preferredId) && isValidWarehouseId(legacyId)) {
            localStorage.removeItem(LEGACY_STORAGE_KEY);
            void persistDefaultWarehouse(selected);
          }

          // If only one warehouse exists, persist it as default (helps new accounts and new devices).
          if (whs.length === 1 && !isValidWarehouseId(preferredId)) {
            void persistDefaultWarehouse(selected);
          }
        } else {
          // If a preferred id exists but is invalid, clear it so user can pick a new one.
          if (preferredId) {
            void persistDefaultWarehouse(null);
          }
          setSelectedIdState(null);
          setNeedsWarehouseSelection(whs.length > 1);
        }
      } catch (err) {
        console.error('[WarehouseContext] Error fetching warehouses:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchWarehouses();
    return () => {
      cancelled = true;
    };
  }, [profile?.tenant_id, profile?.id, persistDefaultWarehouse, setSelectedWarehouseId]);

  return (
    <WarehouseContext.Provider
      value={{
        selectedWarehouseId: selectedId,
        setSelectedWarehouseId,
        warehouses,
        loading,
        needsWarehouseSelection,
      }}
    >
      {children}
    </WarehouseContext.Provider>
  );
}

export function useSelectedWarehouse() {
  const context = useContext(WarehouseContext);
  if (context === undefined) {
    throw new Error('useSelectedWarehouse must be used within a WarehouseProvider');
  }
  return context;
}
