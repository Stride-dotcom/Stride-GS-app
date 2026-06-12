/**
 * AddChargeButton — universal "Add Charge" trigger for entity detail pages.
 *
 * Drop one line into any entity surface (Item, Task, Repair, Will Call,
 * Shipment, Delivery Order). It is self-contained: admin+staff role gate,
 * the trigger button, the entity-aware AddChargeModal, and a success toast.
 * Clients never see it.
 *
 *   <AddChargeButton entity={{ tenantId, entityType, entityId, itemId, itemClass }} />
 *
 * `buttonStyle` lets the host match its footer's pill styling; omit it for
 * the default dark pill.
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { DollarSign } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { AddChargeModal, type AddChargeEntity } from './AddChargeModal';

interface Props {
  entity: AddChargeEntity;
  /** Match the host footer's pill; falls back to a default dark pill. */
  buttonStyle?: React.CSSProperties;
  label?: string;
  iconSize?: number;
}

const DEFAULT_PILL: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 14px', borderRadius: 8,
  background: '#1A1A1A', color: '#fff', border: 'none',
  cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
  whiteSpace: 'nowrap',
};

export function AddChargeButton({ entity, buttonStyle, label = 'Add Charge', iconSize = 13 }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Admin + staff only — clients never get billing controls.
  if (!user || (user.role !== 'admin' && user.role !== 'staff')) return null;
  // No tenant → nothing to write against (e.g. an unsaved/legacy entity).
  if (!entity.tenantId) return null;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={buttonStyle ?? DEFAULT_PILL}>
        <DollarSign size={iconSize} /> {label}
      </button>
      {open && (
        <AddChargeModal
          entity={entity}
          onClose={() => setOpen(false)}
          onSaved={(msg) => {
            setOpen(false);
            setToast(msg);
            window.setTimeout(() => setToast(null), 3000);
          }}
        />
      )}
      {toast && createPortal(
        <div style={{
          position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          background: '#1A1A1A', color: '#fff', padding: '10px 20px', borderRadius: 10,
          fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>{toast}</div>,
        document.body,
      )}
    </>
  );
}
