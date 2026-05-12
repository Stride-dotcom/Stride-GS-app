/**
 * DtOrderReleasePanel — inline "select items to release" panel for the
 * DT order detail page. Mirrors the WC release UX from
 * WillCallDetailPanel (the per-item checkbox list + dynamic count
 * button), wired to a Supabase-direct write path instead of the
 * legacy GAS-authoritative `postProcessWcRelease` round-trip.
 *
 * Architecture (2026-05-12 — first surface to flip):
 *   • React → supabase.from('inventory').update({ status, release_date })
 *     on the selected rows. Supabase is now AUTHORITATIVE for inventory
 *     status on this path. Realtime fires update events; OrderPage's
 *     inventoryStatuses subscription updates the Status column, the
 *     "Release Items..." button hides when all rows are Released, and
 *     any open ItemDetailPanel / Inventory page reflects the change
 *     without a manual refetch.
 *   • React → entity_audit_log insert for the order's Activity tab.
 *   • React → fire-and-forget supabase.functions.invoke(
 *       'push-inventory-release-to-sheet') to mirror the change into
 *     the per-tenant Inventory sheet. On failure the edge function
 *     drops a `gs_sync_events` row with action_type =
 *     'mirror_inventory_release', which surfaces in the Failed
 *     Operations drawer with a working retry.
 *
 * No optimistic patches — Supabase realtime is the update mechanism.
 *
 * Will Call release stays on the legacy GAS-authoritative path until
 * its own migration. Inventory page release (Inventory.tsx) likewise
 * unchanged; that gets flipped in a follow-up PR.
 */
import { useMemo, useState } from 'react';
import { CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { theme } from '../../styles/theme';
import { WriteButton } from './WriteButton';
import { logDtOrderAudit } from '../../lib/dtOrderAudit';

export interface ReleasableItem {
  /** UUID FK on dt_order_items pointing at public.inventory.id. */
  inventoryId: string;
  /** Human-readable Item ID (used in the sheet + status events). */
  itemId: string;
  /** Description for the checkbox label. */
  description: string;
}

interface Props {
  orderId: string;
  /** Tenant context — required for the edge-function payload and the
   *  audit entry. The button gate in the parent guards against
   *  rendering this panel when tenantId is missing. */
  tenantId: string;
  /** DT's Finished timestamp on the order — used as the default
   *  Release Date when present (so a manual release after DT
   *  Finished stamps the same date the auto-release would have).
   *  Falls back to today. ISO date or timestamp; parsed to YYYY-MM-DD. */
  defaultReleaseDateSource: string | null;
  /** Items eligible for release — pre-filtered to those with
   *  inventory_id linkage AND not already Released. */
  items: ReleasableItem[];
  /** Auth context for audit attribution. */
  performedBy: string | null;
  /** Called when the panel should collapse (Cancel button or success). */
  onClose: () => void;
}

export function DtOrderReleasePanel({
  orderId, tenantId, defaultReleaseDateSource, items, performedBy, onClose,
}: Props) {
  const allIds = useMemo(() => items.map(it => it.inventoryId), [items]);

  // Default: all items selected. Matches the WC "Release Some..."
  // pattern — picker opens with everything ticked so the operator
  // can deselect rather than re-pick from scratch.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(allIds));
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const releaseDate = useMemo(() => {
    if (defaultReleaseDateSource) {
      // Parse ISO timestamp / date to YYYY-MM-DD in local time.
      const d = new Date(defaultReleaseDateSource);
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    return new Date().toISOString().slice(0, 10);
  }, [defaultReleaseDateSource]);

  const toggle = (inventoryId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(inventoryId)) next.delete(inventoryId);
      else next.add(inventoryId);
      return next;
    });
  };

  const handleRelease = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setReleasing(true);
    setError(null);

    try {
      // 1. SUPABASE = authoritative write. Idempotent guard so a
      //    double-fire (e.g. concurrent auto-release) silently no-ops
      //    on already-Released rows instead of re-stamping the date.
      const { error: updErr } = await supabase
        .from('inventory')
        .update({ status: 'Released', release_date: releaseDate })
        .eq('tenant_id', tenantId)
        .in('id', ids)
        .neq('status', 'Released');
      if (updErr) throw new Error(updErr.message);

      // 2. Activity-tab audit entry. Source='app' marks this as a
      //    manual operator action (vs 'dt_finished' for the upcoming
      //    auto-release path).
      const releasedItemIds = items
        .filter(it => selected.has(it.inventoryId))
        .map(it => it.itemId);
      void logDtOrderAudit({
        orderId,
        tenantId,
        action: 'release_items',
        changes: {
          inventoryIds: ids,
          itemIds: releasedItemIds,
          releaseDate,
          releasedCount: ids.length,
          source: 'manual',
        },
        performedBy,
      });

      // 3. Fire-and-forget sheet mirror. On GAS failure the edge
      //    function writes a gs_sync_events row that lands in the
      //    Failed Operations drawer with a working retry button —
      //    no need to await here.
      void supabase.functions
        .invoke('push-inventory-release-to-sheet', {
          body: {
            tenantId,
            inventoryIds: ids,
            itemIds: releasedItemIds,
            releaseDate,
            requestedBy: performedBy ?? '',
          },
        })
        .catch(err => console.warn('[release-panel] sheet mirror invoke failed:', err));

      // Supabase realtime will refresh inventoryStatuses + the items
      // table + the parent's button gate. Nothing else to do here.
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReleasing(false);
    }
  };

  if (items.length === 0) return null;

  return (
    <div style={{
      border: `1px solid ${theme.colors.orange}`,
      borderRadius: 10,
      padding: 14,
      marginBottom: 14,
      background: '#FFFBF5',
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
        Select items to release:
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        {items.map(it => {
          const checked = selected.has(it.inventoryId);
          return (
            <label
              key={it.inventoryId}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 12, cursor: 'pointer',
                padding: '4px 6px', borderRadius: 6,
                background: checked ? '#F0FDF4' : 'transparent',
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(it.inventoryId)}
                style={{ accentColor: '#15803D' }}
              />
              <span style={{ fontWeight: 600 }}>{it.itemId}</span>
              {it.description && (
                <span style={{
                  color: theme.colors.textMuted,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  flex: 1, minWidth: 0,
                }}>
                  {it.description}
                </span>
              )}
            </label>
          );
        })}
      </div>

      {error && (
        <div style={{
          marginBottom: 10, padding: '8px 12px',
          background: '#FEF2F2', border: '1px solid #FECACA',
          borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <AlertTriangle size={13} color="#DC2626" />
          <span style={{ fontSize: 12, color: '#991B1B' }}>{error}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onClose}
          disabled={releasing}
          style={{
            flex: 1, padding: '8px', fontSize: 12, fontWeight: 500,
            border: `1px solid ${theme.colors.border}`, borderRadius: 8,
            background: '#fff', cursor: releasing ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Cancel
        </button>
        <WriteButton
          label={releasing
            ? 'Releasing...'
            : `Release ${selected.size} Item${selected.size !== 1 ? 's' : ''}`}
          variant="primary"
          icon={releasing
            ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
            : <CheckCircle2 size={13} />}
          disabled={selected.size === 0 || releasing}
          style={{
            flex: 2, background: '#15803D',
            opacity: (selected.size === 0 || releasing) ? 0.6 : 1,
          }}
          onClick={handleRelease}
        />
      </div>
    </div>
  );
}
