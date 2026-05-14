/**
 * ReQuoteRepairModal — Add/remove items on an in-flight repair without
 * cancel-and-rebuild. Allowed only when the repair is in Pending Quote
 * or Quote Sent status (Approved+ repairs would invalidate the customer
 * agreement and must be cancel-and-rebuild instead).
 *
 * After save, the parent panel should re-issue the quote via the
 * standard sendRepairQuote flow — that sends the new customer-facing
 * REPAIR_QUOTE email with the updated item list.
 */
import { useEffect, useMemo, useState } from 'react';
import { X, Trash2, Plus, Search, Package, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { theme } from '../../styles/theme';
import { WriteButton } from './WriteButton';
import { ProcessingOverlay } from './ProcessingOverlay';
import { postReQuoteRepair } from '../../lib/api';
import { supabase } from '../../lib/supabase';

interface ItemRow {
  itemId: string;
  description: string | null;
  vendor: string | null;
  sidemark: string | null;
  location: string | null;
  status: string | null;
}

interface Props {
  tenantId: string;
  repairId: string;
  /** Current items on the repair — pre-loaded so the modal opens instantly. */
  currentItems: ItemRow[];
  onClose: () => void;
  onSuccess: () => void;
}

export function ReQuoteRepairModal({ tenantId, repairId, currentItems, onClose, onSuccess }: Props) {
  // Selected items (current + added - removed). Stored as ordered array
  // so the first item remains the "primary" for the email tokens.
  const [selectedIds, setSelectedIds] = useState<string[]>(() => currentItems.map(i => i.itemId));
  const [allInventory, setAllInventory] = useState<ItemRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Load all active inventory for this tenant once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('inventory')
        .select('item_id, description, vendor, sidemark, location, status')
        .eq('tenant_id', tenantId)
        .order('item_id');
      if (cancelled) return;
      if (err) {
        setError(`Failed to load inventory: ${err.message}`);
        setAllInventory([]);
        return;
      }
      const rows: ItemRow[] = (data ?? []).map(r => ({
        itemId:      String((r as { item_id: string }).item_id ?? ''),
        description: (r as { description: string | null }).description,
        vendor:      (r as { vendor: string | null }).vendor,
        sidemark:    (r as { sidemark: string | null }).sidemark,
        location:    (r as { location: string | null }).location,
        status:      (r as { status: string | null }).status,
      }));
      setAllInventory(rows);
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  // Map for fast lookup when rendering selected items.
  const inventoryByItemId = useMemo(() => {
    const m = new Map<string, ItemRow>();
    for (const it of currentItems) m.set(it.itemId, it);  // seed with what we already know
    for (const it of allInventory ?? []) m.set(it.itemId, it);
    return m;
  }, [currentItems, allInventory]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Filtered candidates for the "Add" picker — excludes already-selected
  // + filters by search term across item_id / description / sidemark.
  const candidates = useMemo(() => {
    if (!allInventory) return [];
    const q = search.trim().toLowerCase();
    return allInventory
      .filter(it => !selectedSet.has(it.itemId))
      .filter(it => {
        if (!q) return true;
        return (
          it.itemId.toLowerCase().includes(q) ||
          (it.description ?? '').toLowerCase().includes(q) ||
          (it.sidemark ?? '').toLowerCase().includes(q) ||
          (it.location ?? '').toLowerCase().includes(q) ||
          (it.vendor ?? '').toLowerCase().includes(q)
        );
      })
      .slice(0, 50);  // hard cap rendered rows for perf
  }, [allInventory, search, selectedSet]);

  // Track whether the list actually differs from what we started with.
  // The RPC enforces a non-empty array, so disable Save when empty.
  const hasChanges = useMemo(() => {
    if (selectedIds.length !== currentItems.length) return true;
    const orig = currentItems.map(i => i.itemId).join('|');
    const next = selectedIds.join('|');
    return orig !== next;
  }, [selectedIds, currentItems]);

  function removeItem(itemId: string) {
    setSelectedIds(prev => prev.filter(id => id !== itemId));
  }
  function addItem(itemId: string) {
    setSelectedIds(prev => prev.includes(itemId) ? prev : [...prev, itemId]);
  }

  async function handleSave() {
    if (selectedIds.length === 0) {
      setError('A repair must have at least one item.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const resp = await postReQuoteRepair({
        tenantId,
        repairId,
        newItemIds: selectedIds,
      });
      if (!resp.ok) {
        setError(resp.error || 'Re-quote failed.');
        return;
      }
      setSuccess(true);
      // Brief success state before closing — parent refetches the repair
      // so the items table reflects the new list immediately.
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 200 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 720, maxWidth: '95vw', maxHeight: '85vh', background: '#fff', borderRadius: 16,
        boxShadow: '0 8px 40px rgba(0,0,0,0.15)', zIndex: 201, display: 'flex', flexDirection: 'column',
        fontFamily: theme.typography.fontFamily, overflow: 'hidden',
      }}>
        <ProcessingOverlay
          visible={submitting}
          message="Updating the repair item list…"
          subMessage="Resetting quote so you can re-issue with the new items."
        />

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.colors.borderDefault}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Edit Repair Items</div>
            <div style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 2 }}>
              {repairId} — current: {currentItems.length} → new: {selectedIds.length}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px', flex: 1, overflowY: 'auto' }}>
          {success && (
            <div style={{ padding: 12, background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle2 size={16} color="#16A34A" />
              <span style={{ fontSize: 13, color: '#15803D' }}>Items updated — re-issue the quote from the repair panel.</span>
            </div>
          )}

          {error && (
            <div style={{ padding: 12, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={16} color="#DC2626" />
              <span style={{ fontSize: 13, color: '#991B1B' }}>{error}</span>
            </div>
          )}

          {/* Info banner — re-quote semantics. */}
          <div style={{ padding: 10, background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, marginBottom: 14, fontSize: 12, color: '#92400E' }}>
            Saving will reset the quote (clears the quoted amount + Quote Sent date) and flip status back to <strong>Pending Quote</strong>. You'll re-send the customer quote afterward from the repair panel.
          </div>

          {/* Selected items */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 8 }}>
              Repair items ({selectedIds.length})
            </div>
            {selectedIds.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', fontSize: 13, color: theme.colors.textMuted, background: theme.colors.bgSubtle, borderRadius: 8 }}>
                No items — add at least one below before saving.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, border: `1px solid ${theme.colors.borderDefault}`, borderRadius: 10, overflow: 'hidden' }}>
                {selectedIds.map((itemId, idx) => {
                  const it = inventoryByItemId.get(itemId);
                  return (
                    <div key={itemId} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 12px',
                      background: idx === 0 ? '#FFF7ED' : (idx % 2 === 0 ? '#fff' : theme.colors.bgSubtle),
                      borderBottom: idx < selectedIds.length - 1 ? `1px solid ${theme.colors.borderLight || '#f0f0f0'}` : undefined,
                    }}>
                      {idx === 0 && (
                        <span title="Primary item (used for email tokens)" style={{
                          fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                          background: theme.colors.orange, color: '#fff', flexShrink: 0,
                        }}>1st</span>
                      )}
                      <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, minWidth: 70 }}>{itemId}</span>
                      <span style={{ flex: 1, fontSize: 12, color: theme.colors.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {it?.description || '—'}
                        {it?.sidemark ? <span style={{ color: theme.colors.textMuted }}> · {it.sidemark}</span> : null}
                        {it?.location ? <span style={{ color: theme.colors.textMuted }}> · {it.location}</span> : null}
                      </span>
                      <button
                        onClick={() => removeItem(itemId)}
                        title="Remove this item"
                        style={{
                          background: 'none', border: `1px solid ${theme.colors.borderDefault}`,
                          borderRadius: 6, padding: '4px 6px', cursor: 'pointer',
                          color: '#DC2626', display: 'flex', alignItems: 'center',
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Add picker */}
          <div>
            <div style={{ fontSize: 12, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 8 }}>
              Add an item
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', border: `1px solid ${theme.colors.borderDefault}`, borderRadius: 8, marginBottom: 8 }}>
              <Search size={14} color={theme.colors.textMuted} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by item ID, description, sidemark, vendor, or location"
                style={{ border: 'none', outline: 'none', flex: 1, fontSize: 13, fontFamily: 'inherit' }}
              />
            </div>
            {allInventory === null ? (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 13, color: theme.colors.textMuted }}>Loading inventory…</div>
            ) : candidates.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 13, color: theme.colors.textMuted }}>
                {search ? `No matching inventory items for "${search}"` : 'No more inventory items to add'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0, border: `1px solid ${theme.colors.borderDefault}`, borderRadius: 10, overflow: 'hidden', maxHeight: 280, overflowY: 'auto' }}>
                {candidates.map((it, idx) => (
                  <div key={it.itemId} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '7px 12px',
                    background: idx % 2 === 0 ? '#fff' : theme.colors.bgSubtle,
                    borderBottom: idx < candidates.length - 1 ? `1px solid ${theme.colors.borderLight || '#f0f0f0'}` : undefined,
                  }}>
                    <Package size={14} color={theme.colors.textMuted} />
                    <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, minWidth: 70 }}>{it.itemId}</span>
                    <span style={{ flex: 1, fontSize: 12, color: theme.colors.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.description || '—'}
                      {it.sidemark ? <span style={{ color: theme.colors.textMuted }}> · {it.sidemark}</span> : null}
                      {it.location ? <span style={{ color: theme.colors.textMuted }}> · {it.location}</span> : null}
                      {it.status && it.status !== 'Active' ? <span style={{ color: '#B45309' }}> · {it.status}</span> : null}
                    </span>
                    <button
                      onClick={() => addItem(it.itemId)}
                      title="Add this item to the repair"
                      style={{
                        background: theme.colors.orange, border: 'none',
                        borderRadius: 6, padding: '4px 8px', cursor: 'pointer',
                        color: '#fff', display: 'flex', alignItems: 'center', gap: 4,
                        fontSize: 11, fontWeight: 600,
                      }}
                    >
                      <Plus size={12} /> Add
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px', borderTop: `1px solid ${theme.colors.borderDefault}`,
          display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0, background: theme.colors.bgSubtle,
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px', borderRadius: 8, border: `1px solid ${theme.colors.borderDefault}`,
              background: '#fff', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <WriteButton
            onClick={handleSave}
            disabled={!hasChanges || selectedIds.length === 0 || success}
            variant="primary"
            label={success ? 'Saved' : 'Save & Reset Quote'}
            loadingText="Saving…"
            successText="Saved"
          />
        </div>
      </div>
    </>
  );
}
