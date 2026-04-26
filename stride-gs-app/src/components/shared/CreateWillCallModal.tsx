import React, { useState, useMemo, useEffect, useRef } from 'react';
import { X, Search, Check, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { AutocompleteSelect } from './AutocompleteSelect';
import { theme } from '../../styles/theme';
import { WriteButton } from './WriteButton';
import { postCreateWillCall, isApiConfigured } from '../../lib/api';
import type { CreateWillCallResponse } from '../../lib/api';
import { useClients } from '../../hooks/useClients';
import { useAuth } from '../../contexts/AuthContext';
import type { WillCall } from '../../lib/types';
import { ProcessingOverlay } from './ProcessingOverlay';

interface Props {
  onClose: () => void;
  onSubmit?: (data: any) => void;
  preSelectedItemIds?: string[];
  liveItems?: Array<{ itemId: string; clientName: string; clientId: string; vendor: string; description: string; location: string; sidemark: string; status: string; [k: string]: any }>;
  // Phase 2C — optimistic create functions (optional)
  addOptimisticWc?: (wc: WillCall) => void;
  removeOptimisticWc?: (tempWcNumber: string) => void;
  /** Existing will calls — used to warn about items already on active WCs */
  existingWillCalls?: WillCall[];
}

interface WcConflictInfo {
  itemId: string;
  wcNumber: string;
  wcStatus: string;
}

export function CreateWillCallModal({ onClose, onSubmit, preSelectedItemIds = [], liveItems, addOptimisticWc, removeOptimisticWc, existingWillCalls }: Props) {
  const { user } = useAuth();
  const hasPreSelected = preSelectedItemIds.length > 0;
  const [step, setStep] = useState<'details' | 'items' | 'review'>('details');
  const [pickupParty, setPickupParty] = useState('');
  const [pickupPhone, setPickupPhone] = useState('');
  const [requestedBy, setRequestedBy] = useState('');
  const [estDate, setEstDate] = useState('');
  const [wcNotes, setWcNotes] = useState('');
  const [cod, setCod] = useState(false);
  const [codAmount, setCodAmount] = useState('');
  // Auto-detect client from pre-selected items (if all from same client)
  const autoClient = useMemo(() => {
    if (!preSelectedItemIds.length || !liveItems?.length) return '';
    const clients = new Set(preSelectedItemIds.map(id => liveItems.find(i => i.itemId === id)?.clientName).filter(Boolean));
    return clients.size === 1 ? [...clients][0]! : '';
  }, [preSelectedItemIds, liveItems]);
  const [client, setClient] = useState(autoClient);
  const userChangedClient = useRef(false);
  // Sync auto-detected client when liveItems arrive, but don't overwrite manual selection
  useEffect(() => {
    if (autoClient && !client && !userChangedClient.current) setClient(autoClient);
  }, [autoClient]);
  const handleClientChange = (val: string) => { userChangedClient.current = true; setClient(val); };
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(preSelectedItemIds));

  // API + submit state
  const apiConfigured = isApiConfigured();
  const { clients: liveClients, apiClients } = useClients(apiConfigured);
  const clientSheetId = apiClients.find(c => c.name === client)?.spreadsheetId || '';
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<CreateWillCallResponse | null>(null);

  const allItems = liveItems || [];

  // Client list: live API names if available, else empty
  const apiClientNames = useMemo(() => liveClients.map(c => c.name).sort(), [liveClients]);
  const clientNames = apiClientNames.length > 0 ? apiClientNames : [...new Set(allItems.map(i => i.clientName))].sort();

  const activeItems = useMemo(() => allItems.filter(i => i.status === 'Active' && (!client || i.clientName === client)), [allItems, client]);
  const filteredItems = useMemo(() => {
    if (!searchTerm) return activeItems;
    const q = searchTerm.toLowerCase();
    return activeItems.filter(i => i.itemId.toLowerCase().includes(q) || i.description.toLowerCase().includes(q) || i.vendor.toLowerCase().includes(q) || i.sidemark.toLowerCase().includes(q));
  }, [activeItems, searchTerm]);

  const selectedItems = useMemo(() => allItems.filter(i => selectedIds.has(i.itemId)), [allItems, selectedIds]);

  // Check selected items against existing active will calls (exclude optimistic TEMP entries)
  const wcConflicts = useMemo<WcConflictInfo[]>(() => {
    if (!existingWillCalls?.length || !selectedIds.size) return [];
    const activeStatuses = new Set(['Pending', 'Scheduled', 'Partial']);
    const results: WcConflictInfo[] = [];
    const seen = new Set<string>(); // avoid duplicate warnings per item
    for (const wc of existingWillCalls) {
      if (wc.wcNumber.startsWith('TEMP-')) continue; // skip optimistic creates
      if (!activeStatuses.has(wc.status)) continue;
      for (const wcItem of (wc.items || [])) {
        if (wcItem.released) continue;
        if (!selectedIds.has(wcItem.itemId)) continue;
        if (seen.has(wcItem.itemId)) continue;
        seen.add(wcItem.itemId);
        results.push({ itemId: wcItem.itemId, wcNumber: wc.wcNumber, wcStatus: wc.status });
      }
    }
    return results;
  }, [existingWillCalls, selectedIds]);

  const toggleItem = (id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const canSubmit = pickupParty.trim() && selectedIds.size > 0;

  const handleCreate = async () => {
    setSubmitError(null);
    const demoMode = !apiConfigured || !clientSheetId;
    const now = new Date().toISOString().slice(0, 10);

    if (demoMode) {
      const wcNum = 'WC-' + new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' }).replace(/\//g, '') + Date.now().toString().slice(-6);
      setCreateResult({ success: true, wcNumber: wcNum, itemCount: selectedIds.size, totalFee: 0, emailSent: false, warnings: ['Demo mode — no API configured'] });
      onSubmit?.({ client, pickupParty, items: [...selectedIds], wcNumber: wcNum });
      return;
    }

    // Phase 2C: insert temp WC row immediately
    const tempWcNum = `TEMP-${Date.now()}`;
    if (addOptimisticWc) {
      addOptimisticWc({
        wcNumber: tempWcNum,
        clientId: clientSheetId,
        clientName: client,
        status: 'Pending',
        pickupParty,
        pickupPartyPhone: pickupPhone || undefined,
        scheduledDate: estDate || undefined,
        itemCount: selectedIds.size,
        items: selectedItems.map(i => ({
          itemId: i.itemId,
          description: i.description,
          qty: i.qty ?? 1,
          released: false,
          vendor: i.vendor,
          location: i.location,
        })),
        createdDate: now,
        notes: wcNotes || undefined,
        requiresSignature: false,
        cod: false,
      } as any);
    }

    setSubmitting(true);
    try {
      const resp = await postCreateWillCall({
        items: [...selectedIds],
        pickupParty,
        pickupPhone: pickupPhone || undefined,
        requestedBy: requestedBy || undefined,
        estDate: estDate || undefined,
        notes: wcNotes || undefined,
        cod,
        codAmount: cod && codAmount !== '' ? parseFloat(codAmount) : undefined,
        createdBy: user?.displayName || user?.email || 'App',
      }, clientSheetId);
      if (!resp.ok || !resp.data?.success) {
        removeOptimisticWc?.(tempWcNum); // rollback
        setSubmitError(resp.error || resp.data?.error || 'Failed to create will call. Please try again.');
      } else {
        removeOptimisticWc?.(tempWcNum); // remove temp; refetch loads real WC
        setCreateResult(resp.data);
        onSubmit?.({ client, pickupParty, items: [...selectedIds], wcNumber: resp.data.wcNumber });
      }
    } catch (err) {
      removeOptimisticWc?.(tempWcNum); // rollback
      setSubmitError(err instanceof Error ? err.message : 'Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const input: React.CSSProperties = { width: '100%', padding: '9px 12px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, outline: 'none', fontFamily: 'inherit' };

  return (
    <>
      <div onClick={submitting ? undefined : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 200 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 640, maxWidth: '95vw', maxHeight: '90vh', background: '#fff', borderRadius: 20,
        boxShadow: '0 24px 60px rgba(0,0,0,0.25)', zIndex: 201, display: 'flex', flexDirection: 'column',
        fontFamily: theme.typography.fontFamily, overflow: 'hidden',
      }}>
        <ProcessingOverlay
          visible={submitting}
          message="Hold tight — creating your will call"
          subMessage="Generating the release doc and notifying the client. You can leave this open."
        />
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Create Will Call</div>
            <div style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 2 }}>
              {step === 'details'
                ? `Step 1 of ${hasPreSelected ? 2 : 3}: Pickup details`
                : step === 'items'
                  ? 'Step 2 of 3: Select items'
                  : `Step ${hasPreSelected ? 2 : 3} of ${hasPreSelected ? 2 : 3}: Review`}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted }}><X size={18} /></button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

          {step === 'details' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 3 }}>Client *</label>
                {hasPreSelected && autoClient ? (
                  <div style={{ padding: '9px 12px', fontSize: 13, background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 8, color: theme.colors.text, fontWeight: 500 }}>
                    {autoClient}
                  </div>
                ) : (
                  <AutocompleteSelect
                    value={client}
                    onChange={v => { handleClientChange(v); setSelectedIds(new Set()); setSearchTerm(''); }}
                    placeholder="Select client..."
                    options={clientNames.map(c => ({ value: c, label: c }))}
                    style={{ width: '100%' }}
                  />
                )}
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 3 }}>Pickup Party *</label>
                <input value={pickupParty} onChange={e => setPickupParty(e.target.value)} placeholder="Name of person/company picking up" style={input} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 3 }}>Pickup Phone</label>
                <input value={pickupPhone} onChange={e => setPickupPhone(e.target.value)} placeholder="Phone number" style={input} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 3 }}>Requested By</label>
                <input value={requestedBy} onChange={e => setRequestedBy(e.target.value)} placeholder="Who requested this release" style={input} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 3 }}>Estimated Pickup Date</label>
                <input type="date" value={estDate} onChange={e => setEstDate(e.target.value)} style={input} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 3 }}>Notes</label>
                <textarea value={wcNotes} onChange={e => setWcNotes(e.target.value)} placeholder="Special instructions..." rows={2} style={{ ...input, resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={cod} onChange={e => setCod(e.target.checked)} style={{ accentColor: theme.colors.orange }} />
                  COD (Cash on Delivery)
                </label>
              </div>
              {cod && (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 3 }}>COD Amount</label>
                  <input type="number" value={codAmount} onChange={e => setCodAmount(e.target.value)} placeholder="$0.00" style={input} />
                </div>
              )}
            </div>
          )}

          {step === 'items' && (
            <div>
              {!client && <div style={{ padding: 20, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>Please select a client first (go back to Step 1)</div>}
              {client && (
                <>
                  <div style={{ position: 'relative', marginBottom: 12 }}>
                    <Search size={15} color={theme.colors.textMuted} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
                    <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search items by ID, description, vendor..." style={{ ...input, paddingLeft: 32 }} />
                  </div>
                  <div style={{ fontSize: 12, color: theme.colors.textMuted, marginBottom: 8 }}>
                    {selectedIds.size} item{selectedIds.size !== 1 ? 's' : ''} selected &middot; {filteredItems.length} available
                    {wcConflicts.length > 0 && (
                      <span style={{ color: '#DC2626', fontWeight: 600, marginLeft: 8 }}>
                        &middot; {wcConflicts.length} already on a Will Call
                      </span>
                    )}
                  </div>
                  <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 10, overflow: 'hidden', maxHeight: 340, overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead><tr style={{ background: theme.colors.bgSubtle }}>
                        <th style={{ padding: '6px 8px', width: 36 }}></th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Item ID</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Vendor</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Description</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Location</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Sidemark</th>
                      </tr></thead>
                      <tbody>{filteredItems.map(item => {
                        const sel = selectedIds.has(item.itemId);
                        return (
                          <tr key={item.itemId} onClick={() => toggleItem(item.itemId)} style={{ cursor: 'pointer', background: sel ? theme.colors.orangeLight : 'transparent', borderBottom: `1px solid ${theme.colors.borderLight}` }}>
                            <td style={{ padding: '6px 8px', textAlign: 'center' }}><input type="checkbox" checked={sel} readOnly style={{ accentColor: theme.colors.orange, pointerEvents: 'none' }} /></td>
                            <td style={{ padding: '6px 8px', fontWeight: 600 }}>{item.itemId}</td>
                            <td style={{ padding: '6px 8px', color: theme.colors.textSecondary }}>{item.vendor}</td>
                            <td style={{ padding: '6px 8px', color: theme.colors.textSecondary, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</td>
                            <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: theme.colors.textSecondary }}>{item.location}</td>
                            <td style={{ padding: '6px 8px', color: theme.colors.textMuted, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.sidemark}</td>
                          </tr>
                        );
                      })}</tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 'review' && (
            <div>
              <div style={{ background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, fontSize: 13 }}>
                  <div><div style={{ fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Client</div><div style={{ fontWeight: 600, marginTop: 2 }}>{client}</div></div>
                  <div><div style={{ fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Pickup Party</div><div style={{ fontWeight: 600, marginTop: 2 }}>{pickupParty}</div></div>
                  <div><div style={{ fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Phone</div><div style={{ marginTop: 2 }}>{pickupPhone || '\u2014'}</div></div>
                  <div><div style={{ fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Requested By</div><div style={{ marginTop: 2 }}>{requestedBy || '\u2014'}</div></div>
                  <div><div style={{ fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Est. Pickup</div><div style={{ marginTop: 2 }}>{estDate || '\u2014'}</div></div>
                  <div><div style={{ fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Items</div><div style={{ fontWeight: 600, marginTop: 2 }}>{selectedIds.size}</div></div>
                </div>
                {cod && <div style={{ marginTop: 10, fontSize: 13 }}><span style={{ background: '#FEF3C7', color: '#B45309', padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600 }}>COD: ${codAmount || '0'}</span></div>}
                {wcNotes && <div style={{ marginTop: 10, fontSize: 12, color: theme.colors.textSecondary }}><strong>Notes:</strong> {wcNotes}</div>}
              </div>
              {wcConflicts.length > 0 && (
                <div style={{ padding: '10px 12px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <AlertTriangle size={14} color="#DC2626" />
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#DC2626' }}>
                      {wcConflicts.length === 1 ? 'Item already on an active Will Call' : `${wcConflicts.length} items already on active Will Calls`}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#991B1B', lineHeight: 1.7 }}>
                    {wcConflicts.map((c, i) => (
                      <div key={i}>
                        Item <strong>{c.itemId}</strong> is on{' '}
                        <a
                          href={`#/will-calls/${c.wcNumber}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#DC2626', fontWeight: 700, textDecoration: 'underline' }}
                          onClick={e => e.stopPropagation()}
                        >{c.wcNumber}</a>
                        {' '}({c.wcStatus})
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: '#991B1B', marginTop: 6 }}>
                    Remove these items or the server will reject the request.
                  </div>
                </div>
              )}
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Selected Items ({selectedItems.length})</div>
              <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ background: theme.colors.bgSubtle }}>
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Item</th>
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Vendor</th>
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Description</th>
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Location</th>
                  </tr></thead>
                  <tbody>{selectedItems.map(i => (
                    <tr key={i.itemId} style={{ borderBottom: `1px solid ${theme.colors.borderLight}` }}>
                      <td style={{ padding: '6px 10px', fontWeight: 600 }}>{i.itemId}</td>
                      <td style={{ padding: '6px 10px', color: theme.colors.textSecondary }}>{i.vendor}</td>
                      <td style={{ padding: '6px 10px', color: theme.colors.textSecondary }}>{i.description}</td>
                      <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{i.location}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {createResult && createResult.success ? (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            <div style={{ padding: '12px 14px', background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <CheckCircle2 size={16} color="#15803D" />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#15803D' }}>Will Call Created —{' '}
                  <a
                    href={`#/will-calls/${createResult.wcNumber}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#15803D', textDecoration: 'underline', cursor: 'pointer' }}
                    onClick={e => e.stopPropagation()}
                  >{createResult.wcNumber}</a>
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#166534', lineHeight: 1.5 }}>
                <div>{createResult.itemCount} item{createResult.itemCount !== 1 ? 's' : ''} added{typeof createResult.totalFee === 'number' && createResult.totalFee > 0 ? ` · Total WC Fee: $${createResult.totalFee.toFixed(2)}` : ''}</div>
                <div>Email: {createResult.emailSent ? '✓ Sent' : '✗ Not sent'}</div>
              </div>
              {createResult.warnings && createResult.warnings.length > 0 && (
                <div style={{ marginTop: 8, padding: '6px 10px', background: '#FEF3C7', borderRadius: 6 }}>
                  {createResult.warnings.map((w, i) => <div key={i} style={{ fontSize: 11, color: '#92400E' }}>⚠ {w}</div>)}
                </div>
              )}
            </div>
            <button onClick={onClose} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Done</button>
          </div>
        ) : (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            {step === 'review' && submitError && (
              <div style={{ marginBottom: 10, padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12, color: '#DC2626', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{submitError}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button onClick={() => {
                if (step === 'details') onClose();
                else if (step === 'review') setStep(hasPreSelected ? 'details' : 'items');
                else setStep('details');
              }} style={{
                padding: '9px 18px', fontSize: 13, fontWeight: 500, border: `1px solid ${theme.colors.border}`,
                borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary,
              }}>{step === 'details' ? 'Cancel' : 'Back'}</button>

              {step === 'review' ? (
                <WriteButton
                  label={submitting ? 'Creating...' : 'Create Will Call'}
                  variant="primary"
                  icon={submitting ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={15} />}
                  disabled={!canSubmit || submitting}
                  style={{ opacity: submitting ? 0.7 : 1 }}
                  onClick={handleCreate}
                />
              ) : (
                <button onClick={() => setStep(step === 'details' ? (hasPreSelected ? 'review' : 'items') : 'review')}
                  disabled={step === 'details' ? !client || !pickupParty.trim() : selectedIds.size === 0}
                  style={{
                    padding: '9px 24px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 8,
                    background: (step === 'details' ? client && pickupParty.trim() : selectedIds.size > 0) ? theme.colors.orange : theme.colors.border,
                    color: (step === 'details' ? client && pickupParty.trim() : selectedIds.size > 0) ? '#fff' : theme.colors.textMuted,
                    cursor: (step === 'details' ? client && pickupParty.trim() : selectedIds.size > 0) ? 'pointer' : 'not-allowed',
                    fontFamily: 'inherit',
                  }}>Next</button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
