import { X, CreditCard, CheckCircle2, XCircle, AlertCircle, ShieldCheck } from 'lucide-react';
import { theme } from '../../styles/theme';
import { WriteButton } from './WriteButton';

/**
 * Phase 7A-14: Customer Verification Panel
 * Slide-out panel from Payments → Customers tab.
 * Shows: Stax customer details, email, payment methods (active/deleted/default), verification status.
 */

export interface StaxCustomer {
  qbName: string;
  staxName: string;
  staxId: string;
  email: string;
  payMethod: string;
}

interface Props {
  customer: StaxCustomer;
  onClose: () => void;
}

interface PaymentMethod {
  id: string; type: string; last4: string; expiry: string;
  isDefault: boolean; isActive: boolean; brand: string;
}

// Payment methods and verification data come from real Stax customer records.
// The Customers tab stores a summary string (e.g. "Visa ending 4242") in the Payment Method column.
// Detailed per-method data requires a Stax API call per customer (not yet implemented).

function Field({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontFamily: mono ? 'monospace' : 'inherit', color: value ? theme.colors.text : theme.colors.textMuted }}>{value || '—'}</div>
    </div>
  );
}

export function CustomerVerificationPanel({ customer, onClose }: Props) {
  // Real data: payment method summary from Customers sheet, no per-method breakdown yet
  const payMethods: PaymentMethod[] = customer.payMethod ? [{
    id: 'pm_1', type: 'card', brand: customer.payMethod.split(' ')[0] || 'Card',
    last4: (customer.payMethod.match(/\d{4}$/) || [''])[0], expiry: '—',
    isDefault: true, isActive: true,
  }] : [];
  const verification = { verified: !!customer.staxId, date: '', method: customer.staxId ? 'Stax customer sync' : '' };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 90 }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 440, maxWidth: '95vw',
        background: '#fff', borderLeft: `1px solid ${theme.colors.border}`, zIndex: 100,
        display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,0.08)',
        fontFamily: theme.typography.fontFamily, animation: 'slideIn 0.2s ease-out',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700 }}>{customer.qbName}</div>
              <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>{customer.staxName}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {verification.verified
                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: '#F0FDF4', color: '#15803D' }}><CheckCircle2 size={12} /> Verified</span>
                : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: '#FEF2F2', color: '#DC2626' }}><XCircle size={12} /> Unverified</span>
              }
              <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted }}><X size={18} /></button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

          {/* Stax Details */}
          <div style={{ background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Stax Customer Details</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
              <Field label="QB Name" value={customer.qbName} />
              <Field label="Stax Name" value={customer.staxName} />
              <Field label="Stax ID" value={customer.staxId} mono />
              <Field label="Email" value={customer.email} />
            </div>
          </div>

          {/* Verification Status */}
          <div style={{ background: verification.verified ? '#F0FDF4' : '#FEF2F2', border: `1px solid ${verification.verified ? '#BBF7D0' : '#FECACA'}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <ShieldCheck size={16} color={verification.verified ? '#15803D' : '#DC2626'} />
              <span style={{ fontSize: 12, fontWeight: 600, color: verification.verified ? '#15803D' : '#DC2626' }}>
                {verification.verified ? 'Customer Verified with Stax' : 'Customer Not Yet Verified'}
              </span>
            </div>
            {verification.verified ? (
              <div style={{ fontSize: 11, color: '#15803D' }}>
                Verified on {verification.date} via {verification.method}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: '#DC2626' }}>
                This customer has not been verified in Stax. Click "Verify with Stax" below to confirm their account and payment methods.
              </div>
            )}
          </div>

          {/* Payment Methods */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <CreditCard size={14} color={theme.colors.orange} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>Payment Methods ({payMethods.length})</span>
            </div>
            {payMethods.length === 0 ? (
              <div style={{ fontSize: 12, color: theme.colors.textMuted, padding: '8px 0' }}>No payment methods on file.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {payMethods.map(pm => (
                  <div key={pm.id} style={{
                    padding: '10px 14px', border: `1px solid ${pm.isDefault ? theme.colors.orange : pm.isActive ? theme.colors.border : theme.colors.borderLight}`,
                    borderRadius: 10, background: pm.isActive ? '#fff' : '#FAFAFA', opacity: pm.isActive ? 1 : 0.6,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 36, height: 24, borderRadius: 4, background: pm.isActive ? theme.colors.bgSubtle : '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <CreditCard size={14} color={pm.isActive ? theme.colors.textSecondary : theme.colors.textMuted} />
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{pm.brand} ···· {pm.last4}</div>
                        {pm.expiry !== '—' && <div style={{ fontSize: 11, color: theme.colors.textMuted }}>Expires {pm.expiry}</div>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {pm.isDefault && <span style={{ fontSize: 10, padding: '1px 8px', borderRadius: 8, background: theme.colors.orangeLight, color: theme.colors.orange, fontWeight: 600 }}>Default</span>}
                      {pm.isActive
                        ? <span style={{ fontSize: 10, padding: '1px 8px', borderRadius: 8, background: '#F0FDF4', color: '#15803D', fontWeight: 600 }}>Active</span>
                        : <span style={{ fontSize: 10, padding: '1px 8px', borderRadius: 8, background: '#F3F4F6', color: '#6B7280', fontWeight: 600 }}>Deleted</span>
                      }
                    </div>
                  </div>
                ))}
              </div>
            )}
            {payMethods.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, padding: 10, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8 }}>
                <AlertCircle size={14} color="#DC2626" />
                <span style={{ fontSize: 12, color: '#DC2626' }}>No payment method — auto-charge will be blocked</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0, display: 'flex', gap: 8 }}>
          <WriteButton
            label="Verify with Stax"
            variant="primary"
            icon={<ShieldCheck size={14} />}
            style={{ flex: 1 }}
            onClick={async () => { /* Phase 7B: wire to API */ }}
          />
          <button onClick={onClose} style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Close</button>
        </div>
      </div>
      <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
    </>
  );
}
