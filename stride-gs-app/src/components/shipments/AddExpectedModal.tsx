import { useState, useMemo } from 'react';
import { X, Trash2 } from 'lucide-react';
import { useClients } from '../../hooks/useClients';
import { useAuth } from '../../contexts/AuthContext';
import type { ExpectedShipment } from '../../hooks/useExpectedShipments';

const CARRIERS = [
  'Unknown', 'UPS', 'FedEx', 'USPS', 'Freight-LTL', 'White Glove', 'Client Drop-off', 'Other',
];

export interface ExpectedShipmentSavePayload {
  client: string;
  clientSheetId: string;         // required — the modal resolves this from the typed name before save
  vendor?: string;
  carrier: string;
  tracking?: string;
  expectedDate: string;
  pieces?: number;
  notes?: string;
}

interface Props {
  onClose: () => void;
  onSave: (entry: ExpectedShipmentSavePayload) => Promise<boolean> | boolean | void;
  editingEvent?: ExpectedShipment;
  onDelete?: (id: string) => Promise<boolean> | boolean | void;
}

export function AddExpectedModal({ onClose, onSave, editingEvent, onDelete }: Props) {
  const { apiClients } = useClients();
  const { user } = useAuth();
  const isEdit = !!editingEvent;

  const [client, setClient] = useState(editingEvent?.client ?? '');
  const [clientSheetId, setClientSheetId] = useState<string | undefined>(editingEvent?.clientSheetId);
  const [showClientDrop, setShowClientDrop] = useState(false);
  const [vendor, setVendor] = useState(editingEvent?.vendor ?? '');
  const [carrier, setCarrier] = useState(editingEvent?.carrier ?? 'Unknown');
  const [tracking, setTracking] = useState(editingEvent?.tracking ?? '');
  const [expectedDate, setExpectedDate] = useState(editingEvent?.expectedDate ?? new Date().toISOString().slice(0, 10));
  const [pieces, setPieces] = useState(editingEvent?.pieces != null ? String(editingEvent.pieces) : '');
  const [notes, setNotes] = useState(editingEvent?.notes ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const accessibleClients = useMemo(() => {
    if (user?.role === 'client' && user.accessibleClientNames?.length) {
      const allowed = new Set(user.accessibleClientNames);
      return apiClients.filter(c => allowed.has(c.name));
    }
    return apiClients;
  }, [apiClients, user?.role, user?.accessibleClientNames]);

  const filteredClients = useMemo(() => {
    const q = client.toLowerCase();
    if (!q) return accessibleClients.slice(0, 8);
    return accessibleClients.filter(c => c.name.toLowerCase().includes(q)).slice(0, 8);
  }, [accessibleClients, client]);

  const canSave = client.trim().length > 0 && expectedDate.length > 0;

  const handleSave = async () => {
    if (!canSave) return;

    // Resolve clientSheetId from the typed name if the user didn't pick
    // a dropdown suggestion. Required by RLS on expected_shipments.
    const typedName = client.trim();
    let resolvedSheetId = clientSheetId;
    if (!resolvedSheetId) {
      const match = accessibleClients.find(
        c => c.name.trim().toLowerCase() === typedName.toLowerCase()
      );
      resolvedSheetId = match?.spreadsheetId;
    }
    if (!resolvedSheetId) {
      setValidationError('Pick a client from the dropdown — free text not allowed.');
      return;
    }
    setValidationError(null);
    setSaving(true);
    try {
      const result = await onSave({
        client: typedName,
        clientSheetId: resolvedSheetId,
        vendor: vendor.trim() || undefined,
        carrier,
        tracking: tracking.trim() || undefined,
        expectedDate,
        pieces: pieces ? Number(pieces) : undefined,
        notes: notes.trim() || undefined,
      });
      // If the hook returned false/null, keep the modal open so user
      // can retry. If it returned true/void, close.
      if (result === false) {
        setValidationError('Save failed — check connection and retry.');
        return;
      }
      onClose();
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingEvent || !onDelete) return;
    setSaving(true);
    try {
      const result = await onDelete(editingEvent.id);
      if (result === false) {
        setValidationError('Delete failed — check connection and retry.');
        return;
      }
      onClose();
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Inter', -apple-system, sans-serif",
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#F5F2EE', borderRadius: 20, padding: 28,
          width: 460, maxWidth: '90vw', maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 400, color: '#1C1C1C' }}>{isEdit ? 'Edit Expected Shipment' : 'Add Expected Shipment'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={18} color="#666" />
          </button>
        </div>

        <Field label="Client *">
          <div style={{ position: 'relative' }}>
            <input
              value={client}
              onChange={e => { setClient(e.target.value); setShowClientDrop(true); setClientSheetId(undefined); }}
              onFocus={() => setShowClientDrop(true)}
              onBlur={() => setTimeout(() => setShowClientDrop(false), 150)}
              placeholder="Type to search or enter free text..."
              style={inputStyle}
            />
            {showClientDrop && filteredClients.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0,
                background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10,
                boxShadow: '0 4px 20px rgba(0,0,0,0.1)', zIndex: 10, marginTop: 4,
                maxHeight: 220, overflowY: 'auto',
              }}>
                {filteredClients.map(c => (
                  <div
                    key={c.spreadsheetId}
                    onMouseDown={() => { setClient(c.name); setClientSheetId(c.spreadsheetId); setShowClientDrop(false); }}
                    style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#F5F2EE')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                  >
                    {c.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Field>

        <Field label="Vendor / Shipper">
          <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="Vendor name" style={inputStyle} />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Carrier">
            <select value={carrier} onChange={e => setCarrier(e.target.value)} style={inputStyle}>
              {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Expected Date *">
            <input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} style={inputStyle} />
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <Field label="Tracking #">
            <input value={tracking} onChange={e => setTracking(e.target.value)} placeholder="Optional" style={inputStyle} />
          </Field>
          <Field label="Pieces">
            <input type="number" min="0" value={pieces} onChange={e => setPieces(e.target.value)} placeholder="—" style={inputStyle} />
          </Field>
        </div>

        <Field label="Notes">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Optional notes"
            rows={3}
            style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
          />
        </Field>

        {validationError && (
          <div style={{ padding: '8px 12px', marginBottom: 12, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: 12, borderRadius: 8 }}>
            {validationError}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 20 }}>
          <div>
            {isEdit && onDelete && editingEvent && (
              <button
                onClick={() => {
                  if (confirmDelete) {
                    handleDelete();
                  } else {
                    setConfirmDelete(true);
                    setTimeout(() => setConfirmDelete(false), 3000);
                  }
                }}
                disabled={saving}
                style={{ ...(confirmDelete ? btnDangerConfirm : btnDanger), opacity: saving ? 0.6 : 1, cursor: saving ? 'wait' : 'pointer' }}
              >
                <Trash2 size={13} style={{ marginRight: 6, verticalAlign: '-2px' }} />
                {confirmDelete ? 'Confirm Delete' : 'Delete'}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose} disabled={saving} style={{ ...btnGhost, opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>Cancel</button>
            <button
              onClick={handleSave}
              disabled={!canSave || saving}
              style={{ ...btnPrimary, opacity: (!canSave || saving) ? 0.5 : 1, cursor: (!canSave || saving) ? 'not-allowed' : 'pointer' }}
            >
              {saving ? 'Saving\u2026' : (isEdit ? 'Save Changes' : 'Add to Calendar')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '2px', textTransform: 'uppercase', color: '#999', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', fontSize: 13,
  border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, outline: 'none',
  background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box',
};

const btnGhost: React.CSSProperties = {
  padding: '10px 20px', fontSize: 11, fontWeight: 600, letterSpacing: '2px',
  textTransform: 'uppercase', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 100,
  background: '#fff', color: '#1C1C1C', cursor: 'pointer',
};

const btnPrimary: React.CSSProperties = {
  padding: '10px 20px', fontSize: 11, fontWeight: 600, letterSpacing: '2px',
  textTransform: 'uppercase', border: 'none', borderRadius: 100,
  background: '#E8692A', color: '#fff',
};

const btnDanger: React.CSSProperties = {
  padding: '10px 18px', fontSize: 11, fontWeight: 600, letterSpacing: '2px',
  textTransform: 'uppercase', border: '1px solid rgba(180,90,90,0.4)', borderRadius: 100,
  background: 'rgba(180,90,90,0.1)', color: '#B45A5A', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center',
};

const btnDangerConfirm: React.CSSProperties = {
  ...btnDanger,
  background: '#B45A5A', color: '#fff', border: '1px solid #B45A5A',
};
