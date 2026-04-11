import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { theme } from '../../styles/theme';
import { WriteButton } from './WriteButton';
import type { StaxInvoice } from '../../lib/api';

interface Props {
  invoices: StaxInvoice[];
  onConfirm: () => Promise<void>;
  onClose: () => void;
  dryRun?: boolean;
}

interface EligibleRow {
  invNo: string; customer: string; amount: number; dueDate: string; staxId: string; isTest: boolean;
}
interface BlockedRow {
  invNo: string; customer: string; amount: number; dueDate: string; reason: string;
}

const th: React.CSSProperties = {
  padding: '7px 12px', textAlign: 'left', fontSize: 10, fontWeight: 500,
  color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em',
  borderBottom: `1px solid ${theme.colors.border}`,
};
const td: React.CSSProperties = {
  padding: '8px 12px', fontSize: 12, borderBottom: `1px solid ${theme.colors.borderLight}`,
};

export function PreChargeValidationModal({ invoices, onConfirm, onClose, dryRun }: Props) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const { eligible, blocked } = useMemo(() => {
    const elig: EligibleRow[] = [];
    const block: BlockedRow[] = [];

    for (const inv of invoices) {
      const status = (inv.status || '').toUpperCase();

      // Only CREATED invoices with a Stax ID are candidates
      if (status !== 'CREATED' || !inv.staxId) {
        if (status === 'PENDING') {
          block.push({ invNo: inv.qbInvoice, customer: inv.customer, amount: inv.amount, dueDate: inv.dueDate, reason: 'Not yet created in Stax' });
        } else if (status === 'PAID') {
          block.push({ invNo: inv.qbInvoice, customer: inv.customer, amount: inv.amount, dueDate: inv.dueDate, reason: 'Already paid' });
        }
        // Skip VOIDED, CHARGE_FAILED without Stax ID, etc.
        continue;
      }

      // Check due date
      if (inv.dueDate > today) {
        block.push({ invNo: inv.qbInvoice, customer: inv.customer, amount: inv.amount, dueDate: inv.dueDate, reason: 'Future due date' });
        continue;
      }

      // Check amount
      if (!inv.amount || inv.amount <= 0) {
        block.push({ invNo: inv.qbInvoice, customer: inv.customer, amount: inv.amount, dueDate: inv.dueDate, reason: 'Zero amount' });
        continue;
      }

      // Check customer ID
      if (!inv.staxCustomerId) {
        block.push({ invNo: inv.qbInvoice, customer: inv.customer, amount: inv.amount, dueDate: inv.dueDate, reason: 'No Stax customer' });
        continue;
      }

      // Eligible
      elig.push({ invNo: inv.qbInvoice, customer: inv.customer, amount: inv.amount, dueDate: inv.dueDate, staxId: inv.staxId, isTest: !!inv.isTest });
    }

    return { eligible: elig, blocked: block };
  }, [invoices, today]);

  const eligibleTotal = eligible.reduce((s, i) => s + i.amount, 0);

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 200 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 640, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
        background: '#fff', borderRadius: 16, boxShadow: '0 8px 40px rgba(0,0,0,0.15)',
        zIndex: 201, fontFamily: theme.typography.fontFamily,
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${theme.colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Pre-Charge Validation{dryRun ? ' (Dry Run)' : ''}</div>
            <div style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 2 }}>
              {dryRun
                ? 'Review eligible invoices — no actual charges will be made'
                : 'Review eligible and blocked invoices before running charges'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 24 }}>
          {/* Eligible Section */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <CheckCircle2 size={16} color="#15803D" />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#15803D' }}>
                Eligible for Charge ({eligible.length})
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: '#15803D' }}>
                ${eligibleTotal.toFixed(2)} total
              </span>
            </div>
            {eligible.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13, background: '#F0FDF4', borderRadius: 10, border: '1px solid #BBF7D0' }}>
                No invoices are eligible for charging right now
              </div>
            ) : (
              <div style={{ border: `1px solid #BBF7D0`, borderRadius: 10, overflow: 'hidden', background: '#F0FDF4' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#DCFCE7' }}>
                      <th style={{ ...th, borderBottomColor: '#BBF7D0', color: '#15803D' }}>Invoice</th>
                      <th style={{ ...th, borderBottomColor: '#BBF7D0', color: '#15803D' }}>Customer</th>
                      <th style={{ ...th, borderBottomColor: '#BBF7D0', color: '#15803D' }}>Amount</th>
                      <th style={{ ...th, borderBottomColor: '#BBF7D0', color: '#15803D' }}>Due Date</th>
                      <th style={{ ...th, borderBottomColor: '#BBF7D0', color: '#15803D' }}>Stax ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eligible.map(inv => (
                      <tr key={inv.invNo}>
                        <td style={{ ...td, fontWeight: 600, borderBottomColor: '#BBF7D0' }}>
                          {inv.invNo}
                          {inv.isTest && <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 6, fontSize: 9, fontWeight: 700, background: '#EDE9FE', color: '#7C3AED' }}>Test</span>}
                        </td>
                        <td style={{ ...td, borderBottomColor: '#BBF7D0' }}>{inv.customer}</td>
                        <td style={{ ...td, fontWeight: 600, color: '#15803D', borderBottomColor: '#BBF7D0' }}>${inv.amount.toFixed(2)}</td>
                        <td style={{ ...td, color: theme.colors.textSecondary, borderBottomColor: '#BBF7D0' }}>{inv.dueDate}</td>
                        <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, color: theme.colors.textMuted, borderBottomColor: '#BBF7D0' }}>{inv.staxId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Blocked Section */}
          {blocked.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <AlertTriangle size={16} color="#B45309" />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#B45309' }}>
                  Blocked — Will Not Charge ({blocked.length})
                </span>
              </div>
              <div style={{ border: `1px solid #FED7AA`, borderRadius: 10, overflow: 'hidden', background: '#FFFBF5' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#FEF3C7' }}>
                      <th style={{ ...th, borderBottomColor: '#FED7AA', color: '#B45309' }}>Invoice</th>
                      <th style={{ ...th, borderBottomColor: '#FED7AA', color: '#B45309' }}>Customer</th>
                      <th style={{ ...th, borderBottomColor: '#FED7AA', color: '#B45309' }}>Amount</th>
                      <th style={{ ...th, borderBottomColor: '#FED7AA', color: '#B45309' }}>Due Date</th>
                      <th style={{ ...th, borderBottomColor: '#FED7AA', color: '#B45309' }}>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blocked.map(inv => (
                      <tr key={inv.invNo}>
                        <td style={{ ...td, fontWeight: 600, borderBottomColor: '#FED7AA', color: theme.colors.textMuted }}>{inv.invNo}</td>
                        <td style={{ ...td, borderBottomColor: '#FED7AA', color: theme.colors.textMuted }}>{inv.customer}</td>
                        <td style={{ ...td, borderBottomColor: '#FED7AA', color: theme.colors.textMuted }}>${inv.amount.toFixed(2)}</td>
                        <td style={{ ...td, color: theme.colors.textMuted, borderBottomColor: '#FED7AA' }}>{inv.dueDate}</td>
                        <td style={{ ...td, borderBottomColor: '#FED7AA' }}>
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600, background: '#FEF2F2', color: '#DC2626' }}>
                            {inv.reason}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={onClose} style={{ padding: '9px 18px', fontSize: 13, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>
              Cancel
            </button>
            {eligible.length > 0 && (
              <WriteButton
                label={dryRun
                  ? `Test ${eligible.length} Invoice${eligible.length !== 1 ? 's' : ''} (Dry Run)`
                  : `Charge ${eligible.length} Invoice${eligible.length !== 1 ? 's' : ''} ($${eligibleTotal.toFixed(2)})`}
                variant="primary"
                style={dryRun ? { background: '#F59E0B', borderColor: '#F59E0B' } : undefined}
                onClick={async () => { await onConfirm(); onClose(); }}
              />
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
