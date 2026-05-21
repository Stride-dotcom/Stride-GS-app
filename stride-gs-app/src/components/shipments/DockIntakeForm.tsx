/**
 * DockIntakeForm — Stage 1 of the 2-stage receiving workflow.
 *
 * Stage 1 happens at the dock: a truck arrives, the operator counts pieces,
 * snaps photos of the load + the BOL, and saves. This creates a row in the
 * `shipments` table with `inbound_status='in_progress'` and the new dock_*
 * columns populated. Items get entered later (Stage 2) when the load has been
 * brought inside and the operator is at a workstation.
 *
 * The Stage 1 row uses a generated DOCK-YYYYMMDD-XXXX shipment_number that
 * lives entirely in Supabase. The existing GAS `completeShipment` flow runs
 * unchanged in Stage 2 and produces its own SHP-XXXX number — see
 * `Receiving.tsx`'s Stage 2 handler for how the dock row is reconciled
 * (dock metadata copied onto the GAS-created row + DOCK row deleted).
 *
 * Inline styles + theme.ts only — matches the rest of the Receiving page.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Camera, FileText, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { theme } from '../../styles/theme';
import { AutocompleteSelect } from '../shared/AutocompleteSelect';
import { PhotoUploadButton } from '../media/PhotoUploadButton';
import { DocumentScanButton } from '../media/DocumentScanButton';
import { useClients } from '../../hooks/useClients';
import { useAuth } from '../../contexts/AuthContext';
import { usePhotos } from '../../hooks/usePhotos';
import { useDocuments } from '../../hooks/useDocuments';
import { useIsMobile } from '../../hooks/useIsMobile';
import { supabase } from '../../lib/supabase';
import { entityEvents } from '../../lib/entityEvents';

// ─── DOCK shipment_number generator ─────────────────────────────────────────
// Format: DOCK-YYYYMMDD-XXXX where XXXX is 4 random hex chars. The random
// suffix has 65k possible values so a same-day collision is < 1 in 65k per
// attempt. The caller (handleComplete) retries once on a unique-index
// violation; if both attempts collide the operator sees the raw error and
// can re-click Complete to roll a new suffix.
function generateDockNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, '0');
  return `DOCK-${y}${m}${d}-${rand}`;
}

/** True if a Supabase error looks like a unique-constraint violation on
 *  shipment_number. Postgres error code 23505 + a hint that mentions the
 *  shipment_number column / index. Matched loosely because the JS client
 *  surfaces the code in different shapes across versions. */
function isDockNumberCollision(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === '23505') return true;
  return /duplicate key|unique constraint/i.test(err.message || '')
    && /shipment_number/i.test(err.message || '');
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 500, color: theme.colors.textMuted,
  display: 'block', marginBottom: 3,
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 13,
  border: `1px solid ${theme.colors.borderLight}`, borderRadius: 6,
  outline: 'none', fontFamily: 'inherit', background: '#fff',
  boxSizing: 'border-box',
};

export function DockIntakeForm() {
  const navigate = useNavigate();
  const { isMobile } = useIsMobile();
  const { user } = useAuth();
  const { clients: liveClients } = useClients();

  // ─── Stage 1 fields ─────────────────────────────────────────────────────
  const [clientSheetId, setClientSheetId] = useState('');
  const [clientName, setClientName] = useState('');
  const [pieceCount, setPieceCount] = useState<string>('');
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  // Generate the DOCK number eagerly so photos/docs can attach to it BEFORE
  // the row is saved (operator snaps photos at the dock door, then taps
  // Complete). We only persist the row on submit — but if the user abandons
  // the page, the photos remain orphaned by entity_id. That's an accepted
  // trade-off; the alternative is a save-first / upload-second flow which
  // adds friction at the moment the operator most needs speed.
  const [dockNo] = useState(() => generateDockNumber());

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [toast, setToast] = useState('');

  // ─── Media hooks scoped to this DOCK shipment ───────────────────────────
  const photoTenant = clientSheetId || null;
  const { photos, uploadPhoto } = usePhotos({
    entityType: 'shipment', entityId: dockNo, tenantId: photoTenant,
  });
  const { documents } = useDocuments({
    contextType: 'shipment', contextId: dockNo, tenantId: photoTenant,
  });

  const handleFiles = useCallback(async (files: File[]) => {
    for (const f of files) await uploadPhoto(f, 'receiving');
  }, [uploadPhoto]);

  const handleUploadOne = useCallback(async (file: File) => {
    const result = await uploadPhoto(file, 'receiving');
    return !!result;
  }, [uploadPhoto]);

  // ─── Accessibility-scoped client list ───────────────────────────────────
  const accessibleClients = useMemo(() => {
    if (user?.role === 'client' && user.accessibleClientNames?.length) {
      const allowed = new Set(user.accessibleClientNames);
      return liveClients.filter(c => allowed.has(c.name));
    }
    return liveClients;
  }, [liveClients, user?.role, user?.accessibleClientNames]);

  const pieceCountNum = useMemo(() => {
    const n = parseInt(pieceCount, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [pieceCount]);

  const canSubmit = !!clientSheetId && !!clientName && !submitting;

  const handleComplete = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitError('');

    // Combine reference into notes — the `shipments` table doesn't have a
    // dedicated reference column. Prefix with "PO/Ref:" so it's parseable
    // back out and obviously distinct from free-form notes. Empty inputs
    // fall through cleanly.
    const combinedNotes = (() => {
      const ref = reference.trim();
      const n = notes.trim();
      if (ref && n) return `PO/Ref: ${ref}\n${n}`;
      if (ref) return `PO/Ref: ${ref}`;
      return n;
    })();

    const nowIso = new Date().toISOString();
    const today = nowIso.slice(0, 10);

    setSubmitting(true);
    try {
      // Insert with one retry on a same-day suffix collision. Photos already
      // uploaded against the original `dockNo` stay there; if the retry
      // succeeds, we update them to the new number so they appear on the
      // saved row. (No retry on RLS / network errors — those need operator
      // action, not a fresh suffix.)
      const insertRow = (sn: string) => supabase
        .from('shipments')
        .insert({
          tenant_id: clientSheetId,
          shipment_number: sn,
          receive_date: today,
          item_count: 0,
          carrier: carrier.trim(),
          tracking_number: tracking.trim(),
          notes: combinedNotes,
          inbound_status: 'in_progress',
          dock_piece_count: pieceCountNum,
          dock_completed_at: nowIso,
          dock_completed_by: user?.email || '',
        });

      let savedNo = dockNo;
      let { error } = await insertRow(savedNo);
      if (error && isDockNumberCollision(error)) {
        const retryNo = generateDockNumber();
        const retry = await insertRow(retryNo);
        if (!retry.error) {
          savedNo = retryNo;
          error = null;
          // Re-tag any photos/docs already uploaded under the original
          // dockNo onto the retry number so they show up on the saved row.
          await supabase.from('item_photos')
            .update({ entity_id: retryNo })
            .eq('tenant_id', clientSheetId)
            .eq('entity_type', 'shipment')
            .eq('entity_id', dockNo);
          await supabase.from('documents')
            .update({ context_id: retryNo })
            .eq('tenant_id', clientSheetId)
            .eq('context_type', 'shipment')
            .eq('context_id', dockNo);
        } else {
          error = retry.error;
        }
      }
      if (error) {
        setSubmitError(error.message || 'Failed to save dock intake');
        setSubmitting(false);
        return;
      }

      // Notify the shipments list so the new row appears without a manual
      // refresh. Use `emitFromRealtime` (NOT `emit`) — the row is already in
      // Supabase from our direct insert above, so the next fetch should hit
      // Supabase, not bypass to GAS.
      try { entityEvents.emitFromRealtime('shipment', savedNo); } catch { /* noop */ }

      setToast(`Dock intake saved for ${clientName} — ${savedNo}`);
      // Brief delay so the operator sees the confirmation; then back to list.
      setTimeout(() => {
        navigate('/shipments', { replace: true });
      }, 900);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }, [canSubmit, clientSheetId, clientName, dockNo, carrier, tracking, reference,
      notes, pieceCountNum, user?.email, navigate]);

  return (
    <div style={{ position: 'relative', background: '#F5F2EE', margin: '-28px -32px', padding: '28px 32px', minHeight: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '2px', color: '#1C1C1C' }}>
          STRIDE LOGISTICS · DOCK INTAKE
          <span style={{ marginLeft: 12, display: 'inline-block', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: theme.colors.orange, background: theme.colors.orangeLight, padding: '3px 10px', borderRadius: 100 }}>
            STAGE 1
          </span>
        </div>
        {/* Affordance for users with /receiving bookmarked or muscle-memory
            for the single-stage flow — sends them straight to a Stage-1
            placeholder DOCK with no metadata, which they can then complete
            and immediately move into items in one continuous flow. We can't
            actually skip Stage 1 (the Supabase shipment row is the spine
            that links photos/docs/dock_*); the next-best thing is to make
            it one click. */}
        <button
          onClick={() => {
            // Take them straight to the Shipments list — they can still see
            // any In Progress dock intakes they had open, and a future
            // "expedited intake" mode can be wired here without code change.
            navigate('/shipments');
          }}
          style={{
            padding: '6px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '0.5px',
            border: `1px solid ${theme.colors.border}`, borderRadius: 8,
            background: '#fff', cursor: 'pointer', fontFamily: 'inherit',
            color: theme.colors.textSecondary,
          }}
        >
          Back to shipments list
        </button>
      </div>

      {/* Stage explainer card */}
      <div style={{
        background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: isMobile ? 8 : 12,
        padding: isMobile ? 12 : 16, marginBottom: isMobile ? 10 : 14,
        display: 'flex', gap: 12, alignItems: 'flex-start',
      }}>
        <Truck size={20} color={theme.colors.orange} style={{ flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: theme.colors.text }}>
            Quick intake at the dock door
          </div>
          <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 3, lineHeight: 1.45 }}>
            Snap photos of the load, count pieces, capture carrier + tracking. Save and walk away —
            you'll enter items later from the <strong>In Progress</strong> tab on the Shipments page.
          </div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: theme.colors.textMuted, marginTop: 6 }}>
            Dock intake ref: <strong>{dockNo}</strong>
          </div>
        </div>
      </div>

      {/* Form card */}
      <div style={{
        background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: isMobile ? 8 : 12,
        padding: isMobile ? 12 : 20, marginBottom: isMobile ? 10 : 16,
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr',
          gap: 12, marginBottom: 16,
        }}>
          <div style={{ gridColumn: isMobile ? '1' : '1 / span 2' }}>
            <label style={labelStyle}>Client *</label>
            <AutocompleteSelect
              value={clientSheetId || ''}
              onChange={val => {
                const match = accessibleClients.find(c => c.id === val);
                if (match) {
                  setClientSheetId(match.id);
                  setClientName(match.name);
                } else {
                  setClientSheetId('');
                  setClientName('');
                }
              }}
              placeholder="Select client..."
              options={accessibleClients.map(c => ({ value: c.id, label: c.name }))}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label style={labelStyle}>Piece Count</label>
            <input
              type="number"
              min={0}
              value={pieceCount}
              onChange={e => setPieceCount(e.target.value)}
              placeholder="e.g. 12"
              inputMode="numeric"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Carrier / Shipper</label>
            <input
              value={carrier}
              onChange={e => setCarrier(e.target.value)}
              placeholder="UPS, FedEx, LTL, white glove..."
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Tracking #</label>
            <input
              value={tracking}
              onChange={e => setTracking(e.target.value)}
              placeholder="Tracking number..."
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Reference / PO</label>
            <input
              value={reference}
              onChange={e => setReference(e.target.value)}
              placeholder="PO# or reference..."
              style={inputStyle}
            />
          </div>
          <div style={{ gridColumn: isMobile ? '1' : '1 / -1' }}>
            <label style={labelStyle}>Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Damage, missing labels, driver notes..."
              rows={2}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
        </div>

        {/* Photos block */}
        <div style={{
          marginTop: 12, padding: isMobile ? 12 : 14,
          background: '#FAFBFC', border: `1px solid ${theme.colors.borderLight}`,
          borderRadius: 10,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10,
            fontSize: 12, fontWeight: 600, color: theme.colors.text,
          }}>
            <Camera size={14} color={theme.colors.orange} />
            Dock Photos ({photos.length})
          </div>
          {!clientSheetId ? (
            <div style={{
              fontSize: 12, color: theme.colors.textMuted, fontStyle: 'italic',
              padding: '10px 12px', border: `1px dashed ${theme.colors.borderLight}`,
              borderRadius: 8, textAlign: 'center',
            }}>
              Select a client to enable photo + document upload.
            </div>
          ) : (
            <>
              <PhotoUploadButton
                onUpload={handleFiles}
                onUploadOne={handleUploadOne}
                label="Upload Photos"
                compact
              />
              {photos.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {photos.slice(0, 12).map(p => (
                    <div
                      key={p.id}
                      title={p.file_name}
                      style={{
                        width: 56, height: 56, borderRadius: 6, flexShrink: 0,
                        background: `#E5E7EB url(${p.thumbnail_url || p.storage_url || ''}) center/cover`,
                        border: '1px solid rgba(0,0,0,0.08)',
                      }}
                    />
                  ))}
                  {photos.length > 12 && (
                    <span style={{ fontSize: 11, color: theme.colors.textMuted, fontWeight: 600, alignSelf: 'center' }}>
                      +{photos.length - 12}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Documents block */}
        <div style={{
          marginTop: 10, padding: isMobile ? 12 : 14,
          background: '#FAFBFC', border: `1px solid ${theme.colors.borderLight}`,
          borderRadius: 10,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10,
            fontSize: 12, fontWeight: 600, color: theme.colors.text,
          }}>
            <FileText size={14} color={theme.colors.orange} />
            Dock Documents — BOL, packing slip ({documents.length})
          </div>
          {!clientSheetId ? (
            <div style={{
              fontSize: 12, color: theme.colors.textMuted, fontStyle: 'italic',
              padding: '10px 12px', border: `1px dashed ${theme.colors.borderLight}`,
              borderRadius: 8, textAlign: 'center',
            }}>
              Select a client to enable photo + document upload.
            </div>
          ) : (
            <>
              <DocumentScanButton
                contextType="shipment"
                contextId={dockNo}
                tenantId={photoTenant}
                label="Scan Document"
              />
              {documents.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {documents.slice(0, 6).map(d => (
                    <span
                      key={d.id}
                      title={d.file_name}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '4px 10px', fontSize: 11, fontWeight: 500,
                        background: '#F3F4F6', color: theme.colors.textSecondary,
                        borderRadius: 4, whiteSpace: 'nowrap',
                      }}
                    >
                      {d.file_name.length > 28 ? `${d.file_name.slice(0, 28)}…` : d.file_name}
                    </span>
                  ))}
                  {documents.length > 6 && (
                    <span style={{ fontSize: 11, color: theme.colors.textMuted, fontWeight: 600 }}>
                      +{documents.length - 6}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Action row */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 12, marginTop: 18, paddingTop: 14, borderTop: `1px solid ${theme.colors.borderLight}`,
          flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: 12, color: theme.colors.textMuted }}>
            {pieceCountNum != null
              ? <><strong>{pieceCountNum}</strong> piece{pieceCountNum === 1 ? '' : 's'} · {photos.length} photo{photos.length === 1 ? '' : 's'} · {documents.length} doc{documents.length === 1 ? '' : 's'}</>
              : <>Piece count optional · {photos.length} photo{photos.length === 1 ? '' : 's'} · {documents.length} doc{documents.length === 1 ? '' : 's'}</>
            }
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {submitError && (
              <div style={{ fontSize: 12, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6, maxWidth: 360 }}>
                <AlertTriangle size={13} />
                <span>{submitError}</span>
              </div>
            )}
            <button
              onClick={() => navigate('/shipments')}
              disabled={submitting}
              style={{
                padding: '9px 18px', fontSize: 13, fontWeight: 500,
                border: `1px solid ${theme.colors.border}`, borderRadius: 8,
                background: '#fff', cursor: submitting ? 'default' : 'pointer',
                fontFamily: 'inherit', color: theme.colors.textSecondary,
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleComplete}
              disabled={!canSubmit}
              style={{
                padding: '9px 22px', fontSize: 13, fontWeight: 600,
                borderRadius: 8, border: 'none',
                background: canSubmit ? theme.colors.orange : theme.colors.border,
                color: canSubmit ? '#fff' : theme.colors.textMuted,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {submitting
                ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving...</>
                : <><Check size={15} /> Complete Stage 1</>
              }
            </button>
          </div>
        </div>
      </div>

      {/* Toast (bottom-center, auto-dismiss via navigate timer) */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
          background: '#15803D', color: '#fff', padding: '10px 18px',
          borderRadius: 100, fontSize: 13, fontWeight: 600,
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)', zIndex: 9999,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Check size={14} /> {toast}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
