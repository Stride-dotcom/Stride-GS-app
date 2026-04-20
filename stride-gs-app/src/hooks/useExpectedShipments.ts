/**
 * useExpectedShipments — Supabase-backed CRUD for the Expected calendar.
 *
 * Session 72 Phase 3: moved from per-user localStorage to the shared
 * public.expected_shipments table so a shipment one user logs is visible
 * to the rest of the team and persists across devices.
 *
 * RLS (see migration 20260418000000_expected_shipments.sql):
 *   - admin / staff → full CRUD
 *   - client role   → CRUD limited to rows where tenant_id matches the
 *                     user's JWT clientSheetId
 *
 * Realtime: public.expected_shipments is in the Realtime publication; we
 * subscribe on mount so another tab's add / update / delete propagates
 * to this tab within ~1s without a refresh (matches the Phase 2 pattern
 * for other entities).
 *
 * Soft delete: remove() flips status to 'cancelled' rather than deleting
 * the row. The cancelled rows are filtered out of the default list by
 * only querying status = 'expected'.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export interface ExpectedShipment {
  id: string;
  tenantId: string;           // clientSheetId of the client the shipment is for
  clientName: string;         // denormalized for display (may drift, refresh on read)
  vendor?: string;
  carrier?: string;
  tracking?: string;
  expectedDate: string;       // YYYY-MM-DD
  pieces?: number;
  notes?: string;
  status: 'expected' | 'received' | 'cancelled';
  createdBy: string | null;   // auth.users.id
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;

  // Back-compat aliases so older consumers that used the localStorage
  // field names keep working without a rename sweep:
  client: string;             // alias of clientName
  clientSheetId?: string;     // alias of tenantId
}

interface DbRow {
  id: string;
  tenant_id: string;
  client_name: string | null;
  vendor: string | null;
  carrier: string | null;
  tracking: string | null;
  expected_date: string;
  pieces: number | null;
  notes: string | null;
  status: 'expected' | 'received' | 'cancelled';
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

function rowToShipment(r: DbRow): ExpectedShipment {
  const clientName = r.client_name ?? '';
  return {
    id: r.id,
    tenantId: r.tenant_id,
    clientName,
    vendor: r.vendor ?? undefined,
    carrier: r.carrier ?? undefined,
    tracking: r.tracking ?? undefined,
    expectedDate: r.expected_date,
    pieces: r.pieces ?? undefined,
    notes: r.notes ?? undefined,
    status: r.status,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    // back-compat aliases
    client: clientName,
    clientSheetId: r.tenant_id,
  };
}

type AddPayload = {
  client: string;             // clientName (display)
  clientSheetId?: string;     // tenant_id — required server-side, validated below
  vendor?: string;
  carrier?: string;
  tracking?: string;
  expectedDate: string;
  pieces?: number;
  notes?: string;
};

type UpdatePayload = Partial<AddPayload>;

export interface UseExpectedShipmentsResult {
  items: ExpectedShipment[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  add: (entry: AddPayload) => Promise<ExpectedShipment | null>;
  update: (id: string, patch: UpdatePayload) => Promise<boolean>;
  /** Soft delete — flips status to 'cancelled'. */
  remove: (id: string) => Promise<boolean>;
}

// ─── Cross-instance sync bus ────────────────────────────────────────────────
// Problem: ExpectedCalendar and useCalendarEvents each call this hook, so
// there are TWO independent `items` states. When one instance runs add(),
// its optimistic update is invisible to the other until Supabase Realtime
// echoes back (1-2s round trip). The user sees stale calendar views and
// thinks they need to refresh.
//
// Fix: broadcast mutations through a module-level bus so every mounted
// instance mirrors the change instantly. Supabase Realtime is still the
// authoritative source for CROSS-CLIENT updates (another user's write);
// this bus handles SAME-CLIENT cross-instance coherence.
type BusEvent =
  | { type: 'add';    item: ExpectedShipment }
  | { type: 'update'; item: ExpectedShipment }
  | { type: 'remove'; id: string };
const syncBus = new EventTarget();
function broadcast(evt: BusEvent): void {
  syncBus.dispatchEvent(new CustomEvent<BusEvent>('change', { detail: evt }));
}

export function useExpectedShipments(): UseExpectedShipmentsResult {
  const { user } = useAuth();
  const [items, setItems] = useState<ExpectedShipment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const doFetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('expected_shipments')
        .select('*')
        .eq('status', 'expected')
        .order('expected_date', { ascending: true });
      if (!mountedRef.current) return;
      if (err) {
        setError(err.message);
        setItems([]);
      } else {
        setItems((data as DbRow[] | null ?? []).map(rowToShipment));
      }
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { doFetch(); }, [doFetch]);

  // Subscribe every instance to the module-level bus so same-session mutations
  // sync across all mount points instantly — no Realtime round trip.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<BusEvent>).detail;
      if (!detail) return;
      setItems(prev => {
        if (detail.type === 'add') {
          if (prev.some(p => p.id === detail.item.id)) return prev;
          return [...prev, detail.item].sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
        }
        if (detail.type === 'update') {
          return prev.map(p => (p.id === detail.item.id ? detail.item : p))
                     .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
        }
        // remove
        return prev.filter(p => p.id !== detail.id);
      });
    };
    syncBus.addEventListener('change', handler);
    return () => syncBus.removeEventListener('change', handler);
  }, []);

  // Realtime: refresh on any INSERT/UPDATE/DELETE across all tabs.
  useEffect(() => {
    const channel = supabase
      .channel('expected_shipments_realtime')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'expected_shipments' },
        () => { doFetch(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [doFetch]);

  const add = useCallback(async (entry: AddPayload): Promise<ExpectedShipment | null> => {
    // v2: tenant_id is allowed to be empty string when an admin/staff user
    // adds a "call-in" shipment for which the real client isn't yet known.
    // The RLS `exp_ship_insert_staff` policy only checks role, not tenant,
    // so an empty string satisfies the policy AND the NOT NULL constraint.
    // Client-role users still need a bound tenant — RLS enforces that.
    const tenantId = entry.clientSheetId ?? '';
    const insertRow = {
      tenant_id: tenantId,
      client_name: entry.client,
      vendor: entry.vendor ?? null,
      carrier: entry.carrier ?? null,
      tracking: entry.tracking ?? null,
      expected_date: entry.expectedDate,
      pieces: entry.pieces ?? null,
      notes: entry.notes ?? null,
      created_by: user?.email ? null : null, // auth.users.id not directly available; left null and name-tagged below
      created_by_name: user?.displayName || user?.email || null,
    };
    const { data, error: err } = await supabase
      .from('expected_shipments')
      .insert(insertRow)
      .select('*')
      .single();
    if (err || !data) {
      setError(err?.message ?? 'Insert failed');
      return null;
    }
    const created = rowToShipment(data as DbRow);
    // Broadcast to the module bus — every other mounted instance of this
    // hook (e.g. useCalendarEvents) receives the new row immediately and
    // updates its local `items`, so the calendar grid reflects the
    // addition without waiting on the Supabase Realtime echo. The local
    // listener picks this up too, so we don't double-setItems here.
    broadcast({ type: 'add', item: created });
    return created;
  }, [user?.displayName, user?.email]);

  const update = useCallback(async (id: string, patch: UpdatePayload): Promise<boolean> => {
    const updateRow: Record<string, unknown> = {};
    if (patch.client !== undefined) updateRow.client_name = patch.client;
    if (patch.clientSheetId !== undefined) updateRow.tenant_id = patch.clientSheetId;
    if (patch.vendor !== undefined) updateRow.vendor = patch.vendor ?? null;
    if (patch.carrier !== undefined) updateRow.carrier = patch.carrier ?? null;
    if (patch.tracking !== undefined) updateRow.tracking = patch.tracking ?? null;
    if (patch.expectedDate !== undefined) updateRow.expected_date = patch.expectedDate;
    if (patch.pieces !== undefined) updateRow.pieces = patch.pieces ?? null;
    if (patch.notes !== undefined) updateRow.notes = patch.notes ?? null;
    if (Object.keys(updateRow).length === 0) return true;

    // Broadcast the optimistic patch to every hook instance. The local
    // bus listener merges into its own `items`, so the calendar view
    // updates in lockstep with the panel that made the edit.
    const existing = items.find(it => it.id === id);
    if (existing) {
      const merged: ExpectedShipment = {
        ...existing,
        client: patch.client ?? existing.client,
        clientName: patch.client ?? existing.clientName,
        clientSheetId: patch.clientSheetId ?? existing.clientSheetId,
        tenantId: patch.clientSheetId ?? existing.tenantId,
        vendor: patch.vendor !== undefined ? patch.vendor : existing.vendor,
        carrier: patch.carrier !== undefined ? patch.carrier : existing.carrier,
        tracking: patch.tracking !== undefined ? patch.tracking : existing.tracking,
        expectedDate: patch.expectedDate ?? existing.expectedDate,
        pieces: patch.pieces !== undefined ? patch.pieces : existing.pieces,
        notes: patch.notes !== undefined ? patch.notes : existing.notes,
      };
      broadcast({ type: 'update', item: merged });
    }

    const { error: err } = await supabase
      .from('expected_shipments')
      .update(updateRow)
      .eq('id', id);
    if (err) {
      setError(err.message);
      doFetch(); // reconcile
      return false;
    }
    return true;
  }, [doFetch, items]);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    // Soft delete — flip status to 'cancelled'
    // Broadcast the remove so every instance (including the calendar's
    // useCalendarEvents) drops the row from its local cache instantly.
    broadcast({ type: 'remove', id });
    const { error: err } = await supabase
      .from('expected_shipments')
      .update({ status: 'cancelled' })
      .eq('id', id);
    if (err) {
      setError(err.message);
      doFetch();
      return false;
    }
    return true;
  }, [doFetch]);

  return { items, loading, error, refetch: doFetch, add, update, remove };
}
