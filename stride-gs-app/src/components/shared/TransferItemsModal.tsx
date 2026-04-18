import React, { useState, useMemo } from 'react';
import { X, Search, ArrowRight, Check, Loader2, AlertTriangle, CheckCircle } from 'lucide-react';
import { theme } from '../../styles/theme';
import { AutocompleteSelect } from './AutocompleteSelect';
import { WriteButton } from './WriteButton';
import { useInventory } from '../../hooks/useInventory';
import { useClients } from '../../hooks/useClients';
import { isApiConfigured, postTransferItems, type TransferItemsResponse } from '../../lib/api';
import type { InventoryItem } from '../../lib/types';

interface Props {
  onClose: () => void;
  /** Called after a successful transfer so the parent can refresh its data */
  onSuccess?: () => void;
  sourceClientName: string;
  sourceClientSheetId: string;
  /** Optional pre-selected item IDs (e.g. from detail panel) */
  preSelectedItemIds?: string[];
  /** Full item object — when provided (detail panel flow), skips item picker and shows confirmation card */
  preSelectedItem?: any;
  // Phase 2C — optimistic patch (source items change to Transferred status)
  applyItemPatch?: (itemId: string, patch: Partial<InventoryItem>) => void;
  clearItemPatch?: (itemId: string) => void;
}

export function TransferItemsModal({
  onClose,
  onSuccess,
  sourceClientName,
  sourceClientSheetId,
  preSelectedItemIds = [],
  preSelectedItem,
  applyItemPatch,
  clearItemPatch,
}: Props) {
  // When preSelectedItem is provided we skip the item picker entirely
  const singleItemMode = !!preSelectedItem;
  const apiConfigured = isApiConfigured();

  // Live data
  const { items: allItems }             = useInventory(apiConfigured);
  const { apiClients }                  = useClients(apiConfigured);

  const [targetClientName, setTargetClientName] = useState('');
  const [searchTerm, setSearchTerm]             = useState('');
  const [selectedIds, setSelectedIds]           = useState<Set<string>>(new Set(preSelectedItemIds));

  // v38.25.0: Transfer Date — defaults to today, allows past dates (backfill)
  const todayIso = new Date().toISOString().slice(0, 10);
  const [transferDate, setTransferDate] = useState<string>(todayIso);

  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<TransferItemsResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Source items: only Active items belonging to the source client
  // Note: InventoryItem.clientId === clientSheetId (mapped in useInventory)
  const sourceItems = useMemo(
    () => allItems.filter(i => i.clientId === sourceClientSheetId && i.status === 'Active'),
    [allItems, sourceClientSheetId]
  );

  // Destination clients: all other active clients
  const destClients = useMemo(
    () => apiClients.filter(c => c.spreadsheetId !== sourceClientSheetId && c.active),
    [apiClients, sourceClientSheetId]
  );

  const filteredItems = useMemo(() => {
    if (!searchTerm) return sourceItems;
    const q = searchTerm.toLowerCase();
    return sourceItems.filter(i =>
      i.itemId.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q) ||
      i.vendor.toLowerCase().includes(q)
    );
  }, [sourceItems, searchTerm]);

  const toggleItem = (id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const destClient = destClients.find(c => c.name === targetClientName);
  const canSubmit  = !!destClient && selectedIds.size > 0 && !loading;

  const handleTransfer = async () => {
    if (!canSubmit || !destClient) return;
    setLoading(true);
    setErrorMsg('');
    setResult(null);

    if (!apiConfigured) {
      // Demo mode fallback
      await new Promise(r => setTimeout(r, 900));
      setResult({
        success: true,
        copiedItems:       selectedIds.size,
        voidedLedgerRows:  Math.floor(selectedIds.size * 1.5),
        createdLedgerRows: Math.floor(selectedIds.size * 1.5),
        tasksTransferred:  0,
        repairsTransferred: 0,
        emailSent: false,
        warnings: ['Demo mode — no actual transfer performed'],
      });
      setLoading(false);
      return;
    }

    // Phase 2C: optimistic patch — source items change to "Transferred" status
    // This makes them disappear from the Active filter on the Inventory table instantly.
    const itemIdsArr = [...selectedIds];
    itemIdsArr.forEach(id => applyItemPatch?.(id, { status: 'Transferred' }));

    const { data, error } = await postTransferItems(
      { destinationClientSheetId: destClient.spreadsheetId, itemIds: itemIdsArr, transferDate },
      sourceClientSheetId
    );

    setLoading(false);

    if (error || !data?.success) {
      // Rollback optimistic patches
      itemIdsArr.forEach(id => clearItemPatch?.(id));
      setErrorMsg(data?.error || error || 'Transfer failed. Please try again.');
      return;
    }

    // Server confirmed — patches will naturally expire or be overwritten by refetch
    setResult(data);
    onSuccess?.();
  };

  const input: React.CSSProperties = {
    width: '100%', padding: '9px 12px', fontSize: 13,
    border: `1px solid ${theme.colors.border}`, borderRadius: 8,
    outline: 'none', fontFamily: 'inherit',
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 200 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 600, maxWidth: '95vw', maxHeight: '90vh', background: '#fff', borderRadius: 20,
        boxShadow: '0 24px 60px rgba(0,0,0,0.25)', zIndex: 201, display: 'flex', flexDirection: 'column',
        fontFamily: theme.typography.fontFamily, overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Transfer Items</div>
            <div style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 2 }}>
              Move items from {sourceClientName} to another client
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted }}>
            <X size={18} />
          </button>
        </div>

        {/* Success card */}
        {result?.success ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12 }}>
              <CheckCircle size={40} color="#22c55e" />
              <div style={{ fontSize: 18, fontWeight: 700 }}>Transfer Complete</div>
              <div style={{ fontSize: 13, color: theme.colors.textSecondary }}>
                {result.copiedItems} item{result.copiedItems !== 1 ? 's' : ''} transferred to <strong>{targetClientName}</strong>
              </div>
            </div>

            <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { label: 'Items Transferred', value: result.copiedItems ?? 0 },
                { label: 'Billing Rows Moved', value: result.createdLedgerRows ?? 0 },
                { label: 'Tasks Transferred', value: result.tasksTransferred ?? 0 },
                { label: 'Repairs Transferred', value: result.repairsTransferred ?? 0 },
              ].map(({ label, value }) => (
                <div key={label} style={{ background: theme.colors.bgSubtle, borderRadius: 10, padding: '12px 14px', border: `1px solid ${theme.colors.border}` }}>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
                  <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>

            {result.emailSent && (
              <div style={{ marginTop: 12, fontSize: 12, color: '#22c55e', display: 'flex', gap: 6, alignItems: 'center' }}>
                <CheckCircle size={13} /> Transfer notification sent to {targetClientName}
              </div>
            )}

            {result.warnings?.length ? (
              <div style={{ marginTop: 12, background: '#fefce8', border: '1px solid #fef08a', borderRadius: 8, padding: '10px 12px' }}>
                {result.warnings.map((w, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#854d0e', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />{w}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          /* Form */
          <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
            {/* Transfer direction */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: 14, background: theme.colors.bgSubtle, borderRadius: 10, border: `1px solid ${theme.colors.border}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>From</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{sourceClientName}</div>
              </div>
              <ArrowRight size={20} color={theme.colors.orange} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>To *</div>
                <AutocompleteSelect
                  value={targetClientName}
                  onChange={setTargetClientName}
                  placeholder="Select destination client…"
                  options={destClients.map(c => ({ value: c.name, label: c.name }))}
                  disabled={loading}
                  style={{ width: '100%', marginTop: 2 }}
                />
              </div>
            </div>

            {/* v38.25.0: Transfer Date — billing cutover */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16, padding: 12, background: '#FEF3EE', borderRadius: 10, border: `1px solid #FED7AA` }}>
              <div style={{ flexShrink: 0, marginTop: 2 }}>
                <AlertTriangle size={16} color="#B45309" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#92400E', marginBottom: 4 }}>Transfer Date (storage billing cutover)</div>
                <input
                  type="date"
                  value={transferDate}
                  max={todayIso}
                  onChange={(e) => setTransferDate(e.target.value)}
                  disabled={loading}
                  style={{
                    padding: '7px 10px', fontSize: 13,
                    border: `1px solid ${theme.colors.border}`,
                    borderRadius: 6, outline: 'none', fontFamily: 'inherit',
                    background: '#fff',
                  }}
                />
                <div style={{ fontSize: 10, color: '#92400E', marginTop: 6, lineHeight: 1.4 }}>
                  Source bills storage through {transferDate ? new Date(transferDate + 'T00:00:00').toLocaleDateString('en-US') : 'this date'} (day before cutover).
                  Destination bills from {transferDate ? new Date(transferDate + 'T00:00:00').toLocaleDateString('en-US') : 'this date'} forward with a fresh free-storage period.
                  Past dates allowed for backfill. Future dates not yet supported.
                </div>
              </div>
            </div>

            {singleItemMode ? (
              /* ── Single-item confirmation card (from detail panel) ── */
              <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 14, background: theme.colors.bgSubtle }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                  Item to Transfer
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: theme.colors.orangeLight, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Check size={18} color={theme.colors.orange} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace' }}>{preSelectedItem.itemId}</div>
                    {preSelectedItem.vendor && (
                      <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>{preSelectedItem.vendor}</div>
                    )}
                    {preSelectedItem.description && (
                      <div style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {preSelectedItem.description}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                      {preSelectedItem.itemClass && (
                        <span style={{ fontSize: 11, color: theme.colors.textMuted }}>Class: <strong>{preSelectedItem.itemClass}</strong></span>
                      )}
                      {preSelectedItem.qty != null && (
                        <span style={{ fontSize: 11, color: theme.colors.textMuted }}>Qty: <strong>{preSelectedItem.qty}</strong></span>
                      )}
                      {preSelectedItem.status && (
                        <span style={{ fontSize: 11, color: theme.colors.textMuted }}>Status: <strong>{preSelectedItem.status}</strong></span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* ── Full item picker (from table row selection) ── */
              <>
                <div style={{ position: 'relative', marginBottom: 10 }}>
                  <Search size={15} color={theme.colors.textMuted} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
                  <input
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Search items…"
                    style={{ ...input, paddingLeft: 32 }}
                    disabled={loading}
                  />
                </div>

                <div style={{ fontSize: 12, color: theme.colors.textMuted, marginBottom: 6 }}>
                  {selectedIds.size} selected of {sourceItems.length} active items
                </div>

                <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 10, overflow: 'hidden', maxHeight: 240, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: theme.colors.bgSubtle }}>
                        <th style={{ padding: '6px 8px', width: 36 }} />
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Item</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Vendor</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.length === 0 ? (
                        <tr><td colSpan={4} style={{ padding: '20px', textAlign: 'center', color: theme.colors.textMuted, fontSize: 12 }}>
                          {sourceItems.length === 0 ? 'No active items for this client' : 'No items match your search'}
                        </td></tr>
                      ) : filteredItems.map(i => {
                        const sel = selectedIds.has(i.itemId);
                        return (
                          <tr
                            key={i.itemId}
                            onClick={() => !loading && toggleItem(i.itemId)}
                            style={{ cursor: loading ? 'default' : 'pointer', background: sel ? theme.colors.orangeLight : 'transparent', borderBottom: `1px solid ${theme.colors.borderLight}` }}
                          >
                            <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                              <input type="checkbox" checked={sel} readOnly style={{ accentColor: theme.colors.orange, pointerEvents: 'none' }} />
                            </td>
                            <td style={{ padding: '6px 8px', fontWeight: 600 }}>{i.itemId}</td>
                            <td style={{ padding: '6px 8px', color: theme.colors.textSecondary }}>{i.vendor}</td>
                            <td style={{ padding: '6px 8px', color: theme.colors.textSecondary, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.description}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Error banner */}
            {errorMsg && (
              <div style={{ marginTop: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <AlertTriangle size={15} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 13, color: '#dc2626' }}>{errorMsg}</span>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
          <button
            onClick={onClose}
            style={{ padding: '9px 18px', fontSize: 13, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}
          >
            {result?.success ? 'Close' : 'Cancel'}
          </button>
          {!result?.success && (
            <WriteButton
              label={loading ? 'Transferring…' : singleItemMode ? `Transfer Item` : `Transfer ${selectedIds.size} Item${selectedIds.size !== 1 ? 's' : ''}`}
              variant="primary"
              icon={loading ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              disabled={!canSubmit}
              onClick={handleTransfer}
            />
          )}
        </div>
      </div>
    </>
  );
}
