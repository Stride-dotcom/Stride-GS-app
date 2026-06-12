/**
 * useAddCharge — shared state for the universal "Add Charge" flow.
 *
 * Returns one modal + toast and an opener, so a host panel can trigger the
 * same Add Charge modal from MULTIPLE places (the desktop footer pill AND the
 * mobile FAB menu) without mounting the modal twice or duplicating the
 * admin+staff gate and toast.
 *
 *   const addCharge = useAddCharge(entity);
 *   // desktop footer:  {addCharge.canAdd && <button onClick={addCharge.open}>…</button>}
 *   // mobile FAB:      ...(addCharge.canAdd ? [{ …, onClick: addCharge.open }] : [])
 *   // render once:     {addCharge.modal}
 *
 * `canAdd` is false (and `modal` renders nothing) for client-role users or
 * when the entity has no tenant — clients never get billing controls.
 */
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../contexts/AuthContext';
import { AddChargeModal, type AddChargeEntity } from './AddChargeModal';

export interface UseAddChargeResult {
  canAdd: boolean;
  open: () => void;
  modal: ReactNode;
}

export function useAddCharge(entity: AddChargeEntity): UseAddChargeResult {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Admin + staff only — clients never get billing controls. No tenant →
  // nothing to write against (e.g. an unsaved/legacy entity).
  const canAdd = !!user && (user.role === 'admin' || user.role === 'staff') && !!entity.tenantId;

  const modal = (
    <>
      {isOpen && canAdd && (
        <AddChargeModal
          entity={entity}
          onClose={() => setIsOpen(false)}
          onSaved={(msg) => {
            setIsOpen(false);
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

  return { canAdd, open: () => setIsOpen(true), modal };
}
