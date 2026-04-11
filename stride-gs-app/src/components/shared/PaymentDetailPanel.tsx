import React from 'react';
import { X, CreditCard, FileText, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { theme } from '../../styles/theme';
import { WriteButton } from './WriteButton';
import { getPanelContainerStyle, panelBackdropStyle } from './panelStyles';
import { useIsMobile } from '../../hooks/useIsMobile';

/**
 * Phase 7A-12: Payment / Invoice Detail Panel
 * Slide-out panel from Payments invoices tab.
 * Shows: QB Invoice info, line items, charge attempt timeline, payment method, Send Pay Link.
 */

export interface PaymentInvoice {
  qbInvoice: string;
  customer: string;
  staxId: string;
  amount: number;
  status: string;
  dueDate: string;
  created: string;
}

interface LineItem {
  description: string; svcCode: string; qty: number; rate: number; total: number;
}

interface ChargeAttempt {
  timestamp: string; status: 'Success' | 'Failed' | 'Pending'; txnId: string; notes: string;
}

interface Props {
  invoice: PaymentInvoice;
  onClose: () => void;
  /** Real charge log entries for this invoice (from Payments page state) */
  charges?: ChargeAttempt[];
  /** Customer payment method description from Customers tab (e.g. "Visa ending 4242") */
  paymentMethod?: string;
  /** Callback to reset a failed invoice back to PENDING/CREATED */
  onReset?: (qbInvoice: string) => Promise<void>;
  /** Callback to retry a charge on a CREATED invoice */
  onRetryCharge?: (qbInvoice: string) => Promise<void>;
}

const STATUS_CFG: Record<string, { bg: string; color: string }> = {
  Pending: { bg: '#FEF3C7', color: '#B45309' },
  Paid:    { bg: '#F0FDF4', color: '#15803D' },
  Voided:  { bg: '#F3F4F6', color: '#6B7280' },
  Failed:  { bg: '#FEF2F2', color: '#DC2626' },
};

const SVC_CFG: Record<string, { bg: string; text: string }> = {
  RCVG: { bg: '#EFF6FF', text: '#1D4ED8' }, INSP: { bg: '#FEF3EE', text: '#E85D2D' },
  ASM: { bg: '#F0FDF4', text: '#15803D' }, REPAIR: { bg: '#FEF3C7', text: '#B45309' },
  STOR: { bg: '#F3F4F6', text: '#6B7280' }, DLVR: { bg: '#EDE9FE', text: '#7C3AED' },
  WCPU: { bg: '#FCE7F3', text: '#BE185D' },
};

function Field({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontFamily: mono ? 'monospace' : 'inherit', color: value ? theme.colors.text : theme.colors.textMuted }}>{String(value ?? '—')}</div>
    </div>
  );
}

export function PaymentDetailPanel({ invoice, onClose, charges, paymentMethod, onReset, onRetryCharge }: Props) {
  const { isMobile } = useIsMobile();
  const sc = STATUS_CFG[invoice.status] || { bg: '#F3F4F6', color: '#6B7280' };
  const lineItems: LineItem[] = [];
  const chargeLog = charges || [];
  const payMethod = paymentMethod || 'No payment method on file';

  const th: React.CSSProperties = { padding: '6px 10px', textAlign: 'left', fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${theme.colors.border}`, background: theme.colors.bgSubtle };
  const td: React.CSSProperties = { padding: '8px 10px', fontSize: 12, borderBottom: `1px solid ${theme.colors.borderLight}` };

  return (
    <>
      {!isMobile && <div onClick={onClose} style={panelBackdropStyle} />}
      <div style={getPanelContainerStyle(480, isMobile)}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{invoice.qbInvoice}</div>
              <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>{invoice.customer}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.color }}>{invoice.status}</span>
              <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted }}><X size={18} /></button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

          {/* Invoice Info */}
          <div style={{ background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <FileText size={14} color={theme.colors.orange} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>Invoice Details</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
              <Field label="QB Invoice #" value={invoice.qbInvoice} />
              <Field label="Stax Invoice ID" value={invoice.staxId || '—'} mono />
              <Field label="Amount" value={`$${invoice.amount.toFixed(2)}`} />
              <Field label="Due Date" value={invoice.dueDate} />
              <Field label="Created" value={invoice.created} />
              <Field label="Status" value={invoice.status} />
            </div>
          </div>

          {/* Payment Method */}
          <div style={{ background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 12, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
            <CreditCard size={16} color={theme.colors.textSecondary} />
            <div>
              <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Payment Method</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: payMethod.startsWith('No') ? '#DC2626' : theme.colors.text }}>{payMethod}</div>
            </div>
          </div>

          {/* Line Items */}
          {lineItems.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Line Items</div>
              <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Description</th>
                      <th style={{ ...th, textAlign: 'center' }}>Code</th>
                      <th style={{ ...th, textAlign: 'right' }}>Qty</th>
                      <th style={{ ...th, textAlign: 'right' }}>Rate</th>
                      <th style={{ ...th, textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((item, idx) => (
                      <tr key={idx}>
                        <td style={{ ...td, color: theme.colors.textSecondary }}>{item.description}</td>
                        <td style={{ ...td, textAlign: 'center' }}>
                          <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600, background: SVC_CFG[item.svcCode]?.bg || '#F3F4F6', color: SVC_CFG[item.svcCode]?.text || '#6B7280' }}>{item.svcCode}</span>
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>{item.qty}</td>
                        <td style={{ ...td, textAlign: 'right', color: theme.colors.textSecondary }}>${item.rate.toFixed(2)}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>${item.total.toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr style={{ background: theme.colors.bgSubtle }}>
                      <td colSpan={4} style={{ ...td, fontWeight: 600, borderBottom: 'none', textAlign: 'right' }}>Total</td>
                      <td style={{ ...td, fontWeight: 700, color: theme.colors.orange, borderBottom: 'none', textAlign: 'right' }}>${invoice.amount.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Charge Attempt Timeline */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <Clock size={14} color={theme.colors.orange} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>Charge Timeline</span>
            </div>
            {chargeLog.length === 0 ? (
              <div style={{ fontSize: 12, color: theme.colors.textMuted, padding: '10px 0' }}>No charge attempts yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {chargeLog.map((attempt, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 12, padding: '10px 14px', border: `1px solid ${theme.colors.border}`, borderRadius: 10, background: attempt.status === 'Success' ? '#F0FDF4' : attempt.status === 'Failed' ? '#FEF2F2' : theme.colors.bgSubtle }}>
                    <div style={{ flexShrink: 0, marginTop: 2 }}>
                      {attempt.status === 'Success' && <CheckCircle2 size={16} color="#15803D" />}
                      {attempt.status === 'Failed' && <XCircle size={16} color="#DC2626" />}
                      {attempt.status === 'Pending' && <AlertCircle size={16} color="#B45309" />}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: attempt.status === 'Success' ? '#15803D' : attempt.status === 'Failed' ? '#DC2626' : '#B45309' }}>{attempt.status}</span>
                        <span style={{ fontSize: 11, color: theme.colors.textMuted }}>{attempt.timestamp}</span>
                      </div>
                      {attempt.notes && <div style={{ fontSize: 11, color: theme.colors.textSecondary, marginTop: 2 }}>{attempt.notes}</div>}
                      {attempt.txnId && <div style={{ fontSize: 10, fontFamily: 'monospace', color: theme.colors.textMuted, marginTop: 2 }}>TXN: {attempt.txnId}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/* Reset button for failed invoices */}
          {onReset && ['EXCEPTION', 'CHARGE_FAILED', 'DELETED'].includes(invoice.status.toUpperCase()) && (
            <WriteButton
              label="Reset & Retry"
              variant="secondary"
              icon={<AlertCircle size={14} />}
              style={{ flex: 1, borderColor: '#3B82F6', color: '#1D4ED8', background: '#EFF6FF' }}
              onClick={async () => { await onReset(invoice.qbInvoice); onClose(); }}
            />
          )}
          {/* Retry charge for CREATED invoices */}
          {onRetryCharge && invoice.status.toUpperCase() === 'CREATED' && invoice.staxId && (
            <WriteButton
              label="Charge Now"
              variant="primary"
              icon={<CreditCard size={14} />}
              style={{ flex: 1 }}
              onClick={async () => { await onRetryCharge(invoice.qbInvoice); }}
            />
          )}
          <button onClick={onClose} style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Close</button>
        </div>
      </div>
      <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
    </>
  );
}
