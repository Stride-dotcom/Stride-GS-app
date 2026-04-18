import { useState, useMemo } from 'react';
import { X } from 'lucide-react';
import { useClients } from '../../hooks/useClients';
import { useAuth } from '../../contexts/AuthContext';
import type { ExpectedShipment } from '../../hooks/useExpectedShipments';

const CARRIERS = [
  'Unknown', 'UPS', 'FedEx', 'USPS', 'Freight-LTL', 'White Glove', 'Client Drop-off', 'Other',
];

interface Props {
  onClose: () => void;
  onSave: (entry: Omit<ExpectedShipment, 'id' | 'createdBy' | 'createdAt'>) => void;
}

export function AddExpectedModal({ onClose, onSave }: Props) {
  const { apiClients } = useClients();
  const { user } = useAuth();

  const [client, setClient] = useState('');
  const [clientSheetId, setClientSheetId] = useState<string | undefined>();
  const [showClientDrop, setShowClientDrop] = useState(false);
  const [vendor, setVendor] = useState('');
  const [carrier, setCarrier] = useState('Unknown');
  const [tracking, setTracking] = useState('');
  const [expectedDate, setExpectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [pieces, setPieces] = useState('');
  const [notes, setNotes] = useState('');

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

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      client: client.trim(),
      clientSheetId,
      vendor: vendor.trim(),
      carrier,
      tracking: tracking.trim() || undefined,
      expectedDate,
      pieces: pieces ? Number(pieces) : undefined,
      notes: notes.trim() || undefined,
    });
    onClose();
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
          <div style={{ fontSize: 20, fontWeight: 400, color: '#1C1C1C' }}>Add Expected Shipment</div>
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

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          <button onClick={handleSave} disabled={!canSave} style={{ ...btnPrimary, opacity: canSave ? 1 : 0.5, cursor: canSave ? 'pointer' : 'not-allowed' }}>
            Add to Calendar
          </button>
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
