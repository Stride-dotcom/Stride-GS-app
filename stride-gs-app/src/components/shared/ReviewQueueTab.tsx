/**
 * ReviewQueueTab — Phase 2c (revised)
 *
 * Staff/admin queue of orders awaiting review.
 *
 * Fixes in this revision:
 *  - Per-row persistent push error display (no longer toast-only)
 *  - "Quote Needed" → "Priced with Delivery" for pickup legs of P+D pairs
 *  - "Push All Pending" batch button
 *  - Error toast stays visible 8 s (was 3.5 s)
 */
import React, { useMemo, useState } from 'react';
import {
  CheckCircle2, XCircle, AlertCircle, Loader2, ClipboardCheck, RefreshCw,
  ChevronsRight, AlertTriangle,
} from 'lucide-react';
import { theme } from '../../styles/theme';
import type { DtOrderForUI } from '../../hooks/useOrders';
import { supabase } from '../../lib/supabase';

interface Props {
  orders: DtOrderForUI[];
  loading: boolean;
  onRefetch: () => void;
  onOpenDetail: (order: DtOrderForUI) => void;
}

const REVIEW_CFG: Record<string, { bg: string; color: string; label: string }> = {
  pending_review:      { bg: '#FEF3C7', color: '#B45309', label: 'Pending' },
  revision_requested:  { bg: '#FED7AA', color: '#9A3412', label: 'Revision' },
  approved:            { bg: '#DCFCE7', color: '#166534', label: 'Approved' },
  rejected:            { bg: '#FEE2E2', color: '#991B1B', label: 'Rejected' },
};

function fmtDate(iso: string): string {
  if (!iso) return '—';
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch { return iso; }
}

export function ReviewQueueTab({ orders, loading, onRefetch, onOpenDetail }: Props) {
  const [actingId, setActingId] = useState<string | null>(null);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [pushingAll, setPushingAll] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all'>('pending');
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);
  const [revisionNotesFor, setRevisionNotesFor] = useState<string | null>(null);
  const [revisionNotes, setRevisionNotes] = useState('');
  // Persistent per-row push errors so staff can see the exact message after toast fades
  const [pushErrors, setPushErrors] = useState<Record<string, string>>({});

  const queue = useMemo(() => {
    if (statusFilter === 'pending') {
      return orders.filter(o => o.reviewStatus === 'pending_review' || o.reviewStatus === 'revision_requested');
    }
    return orders.filter(o => o.reviewStatus && o.reviewStatus !== 'not_required');
  }, [orders, statusFilter]);

  const pendingOrders = useMemo(
    () => orders.filter(o => o.reviewStatus === 'pending_review' || o.reviewStatus === 'revision_requested'),
    [orders]
  );

  const showToast = (msg: string, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), isError ? 10000 : 4000);
  };

  const updateReviewStatus = async (
    orderId: string,
    status: 'approved' | 'rejected' | 'revision_requested',
    notes?: string,
  ) => {
    const { data: authData } = await supabase.auth.getUser();
    const reviewerUid = authData?.user?.id || null;
    const patch: Record<string, unknown> = {
      review_status: status,
      reviewed_by: reviewerUid,
      reviewed_at: new Date().toISOString(),
    };
    if (notes) patch.review_notes = notes;
    const { error } = await supabase.from('dt_orders').update(patch).eq('id', orderId);
    if (error) throw error;
  };

  const pushToDt = async (orderId: string, dtIdentifier: string) => {
    const { data, error } = await supabase.functions.invoke('dt-push-order', {
      body: { orderId },
    });
    // Extract the detailed error from the response body when available
    const result = data as { ok?: boolean; error?: string; responseBody?: string; dt_identifier?: string } | null;
    if (error) {
      // On non-2xx, supabase client puts generic msg in error but the actual
      // DT error is in the response body (data). Prefer data.error if present.
      const detailMsg = result?.error || error.message || 'Edge Function error';
      const bodySnippet = result?.responseBody ? `\n\nDT response: ${result.responseBody.slice(0, 200)}` : '';
      console.error('[dt-push] Push failed:', { orderId, detailMsg, responseBody: result?.responseBody });
      throw new Error(`DT push failed: ${detailMsg}${bodySnippet}`);
    }
    if (result && result.ok === false) {
      console.error('[dt-push] DT rejected order:', { orderId, error: result.error, responseBody: result.responseBody });
      throw new Error(result.error || 'Unknown DT push error');
    }
    return result?.dt_identifier || dtIdentifier;
  };

  // TODO(mobile-ux, code-review L5): replace the `confirm()` and `prompt()`
  // browser dialogs used by handleApprove / handleReject / handlePushAll with
  // the in-app modal primitives. Native `confirm` is awkward on mobile (small
  // truncated text, no styling, blocks the JS thread) and `prompt` doesn't
  // exist at all on some embedded webviews — both should be replaced with a
  // ConfirmDialog / TextInputDialog from src/components/shared/ once those are
  // available. Keeping the inline dialogs for now to avoid a deeper UX
  // refactor on the same review-queue change.
  const handleApprove = async (order: DtOrderForUI) => {
    const isLinkedPair = order.orderType === 'pickup_and_delivery' && !!order.linkedOrderId;
    const confirmMsg = isLinkedPair
      ? `Approve ${order.dtIdentifier} + linked pickup and push BOTH to DispatchTrack?`
      : `Approve order ${order.dtIdentifier} and push to DispatchTrack?`;
    if (!confirm(confirmMsg)) return;
    setActingId(order.id);
    setPushingId(order.id);
    // Clear any prior error for this row
    setPushErrors(prev => { const n = { ...prev }; delete n[order.id]; return n; });
    try {
      await updateReviewStatus(order.id, 'approved');
      if (isLinkedPair && order.linkedOrderId) {
        await updateReviewStatus(order.linkedOrderId, 'approved');
      }
      try {
        await pushToDt(order.id, order.dtIdentifier);
        showToast(isLinkedPair
          ? `✓ ${order.dtIdentifier} + linked pickup pushed to DispatchTrack`
          : `✓ ${order.dtIdentifier} pushed to DispatchTrack`);
      } catch (pushErr) {
        const errMsg = (pushErr as Error).message;
        setPushErrors(prev => ({ ...prev, [order.id]: errMsg }));
        showToast(`Approved but DT push failed — see error on row`, true);
      }
      onRefetch();
    } catch (err) {
      showToast(`Approval failed: ${(err as Error).message}`, true);
    } finally {
      setActingId(null);
      setPushingId(null);
    }
  };

  const handleReject = async (order: DtOrderForUI) => {
    const reason = prompt('Reason for rejecting this order (shown to client):');
    if (!reason) return;
    setActingId(order.id);
    try {
      await updateReviewStatus(order.id, 'rejected', reason);
      showToast(`${order.dtIdentifier} rejected`);
      onRefetch();
    } catch (err) {
      showToast(`Rejection failed: ${(err as Error).message}`, true);
    } finally {
      setActingId(null);
    }
  };

  const handleRequestRevision = (order: DtOrderForUI) => {
    setRevisionNotesFor(order.id);
    setRevisionNotes(order.reviewNotes || '');
  };

  const submitRevisionRequest = async () => {
    if (!revisionNotesFor || !revisionNotes.trim()) return;
    setActingId(revisionNotesFor);
    try {
      await updateReviewStatus(revisionNotesFor, 'revision_requested', revisionNotes.trim());
      showToast('Revision requested');
      setRevisionNotesFor(null);
      setRevisionNotes('');
      onRefetch();
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, true);
    } finally {
      setActingId(null);
    }
  };

  const handlePushAll = async () => {
    const eligible = pendingOrders.filter(o =>
      // Only push the delivery leg of P+D pairs (Edge Function handles the linked pickup)
      // Skip pure pickup legs of P+D (order_type=pickup with a linkedOrderId that points to a P+D)
      !(o.orderType === 'pickup' && !!o.linkedOrderId)
    );
    if (eligible.length === 0) {
      showToast('No pending orders ready to approve & push');
      return;
    }
    if (!confirm(`Approve & push all ${eligible.length} pending order(s) to DispatchTrack?`)) return;
    setPushingAll(true);
    const errors: string[] = [];
    for (const order of eligible) {
      const isLinkedPair = order.orderType === 'pickup_and_delivery' && !!order.linkedOrderId;
      setPushErrors(prev => { const n = { ...prev }; delete n[order.id]; return n; });
      try {
        await updateReviewStatus(order.id, 'approved');
        if (isLinkedPair && order.linkedOrderId) {
          await updateReviewStatus(order.linkedOrderId, 'approved');
        }
        try {
          await pushToDt(order.id, order.dtIdentifier);
        } catch (pushErr) {
          const errMsg = (pushErr as Error).message;
          setPushErrors(prev => ({ ...prev, [order.id]: errMsg }));
          errors.push(`${order.dtIdentifier}: ${errMsg}`);
        }
      } catch (err) {
        errors.push(`${order.dtIdentifier} approval failed: ${(err as Error).message}`);
      }
    }
    onRefetch();
    setPushingAll(false);
    if (errors.length === 0) {
      showToast(`✓ All ${eligible.length} order(s) approved & pushed`);
    } else {
      showToast(`${eligible.length - errors.length} pushed, ${errors.length} failed — check rows for details`, true);
    }
  };

  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 16, flexWrap: 'wrap', gap: 10,
      }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => setStatusFilter('pending')}
            style={filterPillStyle(statusFilter === 'pending')}
          >
            Pending ({pendingOrders.length})
          </button>
          <button
            onClick={() => setStatusFilter('all')}
            style={filterPillStyle(statusFilter === 'all')}
          >
            All Reviewed ({orders.filter(o => o.reviewStatus && o.reviewStatus !== 'not_required').length})
          </button>
          {/* Push All Pending — only shown when there are pending orders */}
          {pendingOrders.length > 0 && (
            <button
              onClick={handlePushAll}
              disabled={pushingAll}
              style={{
                padding: '8px 14px', borderRadius: 100,
                border: 'none', background: '#166534', color: '#fff',
                fontSize: 11, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase',
                cursor: pushingAll ? 'not-allowed' : 'pointer', opacity: pushingAll ? 0.7 : 1,
                display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit',
              }}
            >
              {pushingAll
                ? <><Loader2 size={12} className="spin" /> Pushing All…</>
                : <><ChevronsRight size={12} /> Push All ({pendingOrders.filter(o => !(o.orderType === 'pickup' && !!o.linkedOrderId)).length})</>
              }
            </button>
          )}
        </div>
        <button
          onClick={onRefetch}
          style={{
            background: '#fff', border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 100, padding: '8px 16px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 11, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#666',
          }}
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {loading && (
        <div style={{ padding: 40, textAlign: 'center', color: theme.colors.textMuted }}>Loading…</div>
      )}

      {!loading && queue.length === 0 && (
        <div style={{
          padding: '60px 20px', textAlign: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
          color: theme.colors.textMuted,
        }}>
          <ClipboardCheck size={40} opacity={0.3} />
          <div style={{ fontSize: 15, fontWeight: 600 }}>No orders need review</div>
          <div style={{ fontSize: 13 }}>Client-created orders will appear here awaiting approval.</div>
        </div>
      )}

      {queue.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {queue.map(order => {
            const cfg = REVIEW_CFG[order.reviewStatus] || REVIEW_CFG.pending_review;
            const isBusy = actingId === order.id || pushingAll;
            const isPickupLegOfPD = order.orderType === 'pickup' && !!order.linkedOrderId;
            const pushError = pushErrors[order.id];

            return (
              <div
                key={order.id}
                style={{
                  background: '#fff', borderRadius: 12, padding: 16,
                  border: `1px solid ${pushError ? '#FECACA' : theme.colors.border}`,
                  display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap',
                }}
              >
                {/* Left: Identity */}
                <div style={{ minWidth: 140, flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: theme.colors.primary }}>
                      {order.dtIdentifier}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                      background: cfg.bg, color: cfg.color, textTransform: 'uppercase', letterSpacing: '0.5px',
                    }}>
                      {cfg.label}
                    </span>
                    {order.orderType && order.orderType !== 'delivery' && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                        background: order.orderType === 'service_only' ? '#E0E7FF' : '#FEF3C7',
                        color: order.orderType === 'service_only' ? '#3730A3' : '#B45309',
                        textTransform: 'uppercase', letterSpacing: '0.5px',
                      }}>
                        {order.orderType === 'pickup'              ? 'Pickup'
                          : order.orderType === 'pickup_and_delivery' ? 'Pickup + Delivery'
                          : order.orderType === 'service_only'        ? 'Service'
                          : order.orderType}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: theme.colors.text, fontWeight: 600 }}>
                    {order.clientName}
                  </div>
                  {order.createdByRole && (
                    <div style={{ fontSize: 10, color: theme.colors.textMuted, marginTop: 2 }}>
                      Created by {order.createdByRole}
                    </div>
                  )}
                </div>

                {/* Middle: Details */}
                <div style={{ flex: '1 1 280px', minWidth: 200 }}>
                  <div style={{ fontSize: 12, marginBottom: 4 }}>
                    <strong>{order.contactName}</strong>
                    {' · '}
                    <span style={{ color: theme.colors.textMuted }}>
                      {[order.contactCity, order.contactState].filter(Boolean).join(', ')}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: theme.colors.textMuted, marginBottom: 4 }}>
                    {fmtDate(order.localServiceDate)}
                    {(order.windowStartLocal || order.windowEndLocal) && ` · ${order.windowStartLocal?.slice(0, 5)}–${order.windowEndLocal?.slice(0, 5)}`}
                    {' · '}
                    {order.items.length} item{order.items.length !== 1 ? 's' : ''}
                  </div>
                  {order.reviewNotes && (
                    <div style={{ fontSize: 11, padding: '6px 10px', background: '#FEF3C7', borderRadius: 6, color: '#92400E', marginTop: 4 }}>
                      <strong>Revision note:</strong> {order.reviewNotes}
                    </div>
                  )}
                  {/* Persistent push error — shown until next refetch */}
                  {pushError && (
                    <div style={{
                      fontSize: 11, padding: '6px 10px', background: '#FEF2F2',
                      border: '1px solid #FECACA', borderRadius: 6, color: '#991B1B',
                      marginTop: 6, display: 'flex', alignItems: 'flex-start', gap: 5,
                    }}>
                      <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span><strong>DT push failed:</strong> {pushError}</span>
                    </div>
                  )}
                </div>

                {/* Right: Price + actions */}
                <div style={{ minWidth: 180, flexShrink: 0, textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: theme.colors.text, marginBottom: 8 }}>
                    {isPickupLegOfPD
                      ? <span style={{ fontSize: 13, color: theme.colors.textMuted, fontWeight: 500 }}>Priced with Delivery</span>
                      : order.orderTotal != null
                        ? `$${order.orderTotal.toFixed(2)}`
                        : <span style={{ fontSize: 13, color: '#B45309', fontWeight: 600 }}>Quote Needed</span>
                    }
                  </div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => onOpenDetail(order)}
                      disabled={isBusy}
                      style={smallBtn(false)}
                    >
                      View
                    </button>
                    {(order.reviewStatus === 'pending_review' || order.reviewStatus === 'revision_requested') && (
                      <>
                        <button
                          onClick={() => handleRequestRevision(order)}
                          disabled={isBusy}
                          style={smallBtn(false, '#B45309', '#FED7AA')}
                        >
                          <AlertCircle size={11} /> Revise
                        </button>
                        <button
                          onClick={() => handleReject(order)}
                          disabled={isBusy}
                          style={smallBtn(false, '#991B1B', '#FECACA')}
                        >
                          <XCircle size={11} /> Reject
                        </button>
                        {/* Don't show Approve & Push on pickup legs — their delivery will push both */}
                        {!isPickupLegOfPD && (
                          <button
                            onClick={() => handleApprove(order)}
                            disabled={isBusy}
                            style={smallBtn(true)}
                          >
                            {pushingId === order.id ? <Loader2 size={11} className="spin" /> : <CheckCircle2 size={11} />}
                            {pushingId === order.id ? 'Pushing…' : 'Approve & Push'}
                          </button>
                        )}
                      </>
                    )}
                    {/* Retry push for approved orders that failed */}
                    {order.reviewStatus === 'approved' && pushError && (
                      <button
                        onClick={async () => {
                          setPushingId(order.id);
                          setPushErrors(prev => { const n = { ...prev }; delete n[order.id]; return n; });
                          try {
                            await pushToDt(order.id, order.dtIdentifier);
                            showToast(`✓ ${order.dtIdentifier} pushed to DispatchTrack`);
                            onRefetch();
                          } catch (err) {
                            const errMsg = (err as Error).message;
                            setPushErrors(prev => ({ ...prev, [order.id]: errMsg }));
                            showToast('Retry failed — see error', true);
                          } finally {
                            setPushingId(null);
                          }
                        }}
                        disabled={pushingId === order.id}
                        style={smallBtn(true)}
                      >
                        {pushingId === order.id ? <Loader2 size={11} className="spin" /> : <ChevronsRight size={11} />}
                        Retry Push
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          onClick={() => setToast(null)}
          style={{
            position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
            background: toast.isError ? '#7F1D1D' : '#1C1C1C',
            color: '#fff', padding: '10px 20px',
            borderRadius: 100, fontSize: 13, zIndex: 500, cursor: 'pointer',
            boxShadow: '0 6px 20px rgba(0,0,0,0.3)', maxWidth: '80vw', textAlign: 'center',
          }}
        >
          {toast.msg} <span style={{ opacity: 0.6, marginLeft: 8 }}>✕</span>
        </div>
      )}

      {/* Revision notes modal */}
      {revisionNotesFor && (
        <>
          <div onClick={() => setRevisionNotesFor(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 300 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            width: 480, background: '#fff', borderRadius: 16, padding: 24, zIndex: 301,
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Request Revision</div>
            <div style={{ fontSize: 12, color: theme.colors.textMuted, marginBottom: 12 }}>
              Describe what needs to change. This message will be visible to the client.
            </div>
            <textarea
              value={revisionNotes}
              onChange={e => setRevisionNotes(e.target.value)}
              placeholder="e.g. Requested date is a service day conflict — please pick an alternate date"
              style={{
                width: '100%', minHeight: 100, padding: 12,
                border: `1px solid ${theme.colors.border}`, borderRadius: 8,
                fontSize: 13, fontFamily: 'inherit', resize: 'vertical',
                boxSizing: 'border-box',
              }}
              autoFocus
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button onClick={() => setRevisionNotesFor(null)} style={{ ...smallBtn(false), padding: '8px 16px' }}>Cancel</button>
              <button
                onClick={submitRevisionRequest}
                disabled={!revisionNotes.trim() || actingId === revisionNotesFor}
                style={{ ...smallBtn(true), padding: '8px 16px' }}
              >
                Send to Client
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function filterPillStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 16px', borderRadius: 100,
    fontSize: 11, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase',
    cursor: 'pointer',
    border: active ? 'none' : '1px solid rgba(0,0,0,0.08)',
    background: active ? '#1C1C1C' : '#fff',
    color: active ? '#fff' : '#666',
    fontFamily: 'inherit',
  };
}

function smallBtn(primary: boolean, color?: string, bg?: string): React.CSSProperties {
  return {
    padding: '6px 12px', borderRadius: 6,
    border: primary ? 'none' : `1px solid ${bg || theme.colors.border}`,
    background: primary ? '#166534' : (bg || '#fff'),
    color: primary ? '#fff' : (color || theme.colors.text),
    fontSize: 11, fontWeight: 600, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 4,
    fontFamily: 'inherit',
  };
}
