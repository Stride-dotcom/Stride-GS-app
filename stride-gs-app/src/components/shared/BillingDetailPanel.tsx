import React from 'react';
import { X, DollarSign, Package, ClipboardList, FileText, ExternalLink } from 'lucide-react';
import { theme } from '../../styles/theme';
import { fmtDate } from '../../lib/constants';
import { DetailHeader } from './DetailHeader';
import { getPanelContainerStyle, panelBackdropStyle } from './panelStyles';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useResizablePanel } from '../../hooks/useResizablePanel';

interface BillingRow {
  ledgerRowId: string; status: string; invoiceNo: string; client: string;
  date: string; svcCode: string; svcName: string; itemId: string;
  description: string; itemClass: string; qty: number; rate: number; total: number;
  taskId: string; repairId: string; shipmentNo: string; notes: string;
  sourceSheetId?: string; sidemark?: string; category?: string;
}

interface Props {
  row: BillingRow;
  onClose: () => void;
  onNavigate?: (type: 'task' | 'repair' | 'shipment' | 'item', id: string) => void;
}

const STATUS_CFG: Record<string, { bg: string; color: string }> = {
  Unbilled: { bg: '#FEF3C7', color: '#B45309' },
  Invoiced: { bg: '#EFF6FF', color: '#1D4ED8' },
  Billed: { bg: '#F0FDF4', color: '#15803D' },
  Void: { bg: '#F3F4F6', color: '#6B7280' },
};

const SVC_CFG: Record<string, { bg: string; color: string }> = {
  RCVG: { bg: '#EFF6FF', color: '#1D4ED8' }, INSP: { bg: '#FEF3EE', color: '#E85D2D' },
  ASM: { bg: '#F0FDF4', color: '#15803D' }, REPAIR: { bg: '#FEF3C7', color: '#B45309' },
  STOR: { bg: '#F3F4F6', color: '#6B7280' }, DLVR: { bg: '#EDE9FE', color: '#7C3AED' },
  WCPU: { bg: '#FCE7F3', color: '#BE185D' }, WC: { bg: '#FCE7F3', color: '#BE185D' },
  MNRTU: { bg: '#FEF3EE', color: '#E85D2D' }, PLLT: { bg: '#EDE9FE', color: '#7C3AED' },
  PICK: { bg: '#EFF6FF', color: '#1D4ED8' }, LABEL: { bg: '#F0FDF4', color: '#15803D' },
  DISP: { bg: '#FEF2F2', color: '#991B1B' }, RSTK: { bg: '#EDE9FE', color: '#7C3AED' },
  NO_ID: { bg: '#F3F4F6', color: '#6B7280' }, MULTI_INS: { bg: '#FEF3EE', color: '#E85D2D' },
  SIT: { bg: '#EFF6FF', color: '#1D4ED8' },
};

function Badge({ t, bg, color }: { t: string; bg: string; color: string }) {
  return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: bg, color, whiteSpace: 'nowrap' }}>{t}</span>;
}

function Field({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: value ? theme.colors.text : theme.colors.textMuted, fontFamily: mono ? 'monospace' : 'inherit' }}>{value || '\u2014'}</div>
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <Icon size={15} color={theme.colors.orange} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function LinkChip({ label, id, onClick }: { label: string; id: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
        border: `1px solid ${theme.colors.border}`, background: '#fff',
        cursor: onClick ? 'pointer' : 'default', fontFamily: 'inherit',
        color: onClick ? theme.colors.orange : theme.colors.textSecondary,
        transition: 'all 0.15s',
      }}
    >
      {label}: {id}
      {onClick && <ExternalLink size={11} />}
    </button>
  );
}

// Use shared fmtDate from constants — MM/DD/YY format
const fmt = fmtDate;

export function BillingDetailPanel({ row, onClose, onNavigate }: Props) {
  const { isMobile } = useIsMobile();
  const { width: panelWidth, handleMouseDown: handleResizeMouseDown } = useResizablePanel(400, 'billing', isMobile);
  const sc = STATUS_CFG[row.status] || STATUS_CFG.Unbilled;
  const svc = SVC_CFG[row.svcCode] || { bg: '#F3F4F6', color: '#6B7280' };

  return (
    <>
      {/* Backdrop */}
      {!isMobile && <div onClick={onClose} style={panelBackdropStyle} />}

      {/* Panel */}
      <div style={getPanelContainerStyle(panelWidth, isMobile)}>
        {!isMobile && <div onMouseDown={handleResizeMouseDown} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 101 }} />}
        {/* Header — unified DetailHeader (session 70 follow-up). */}
        <DetailHeader
          entityId={row.ledgerRowId}
          clientName={row.client}
          sidemark={row.sidemark}
          actions={
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, color: theme.colors.textMuted }}>
              <X size={18} />
            </button>
          }
          belowId={
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Badge t={row.status} bg={sc.bg} color={sc.color} />
              {row.invoiceNo && <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.text, padding: '2px 10px', background: theme.colors.bgSubtle, borderRadius: 10 }}>{row.invoiceNo}</span>}
            </div>
          }
        />

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

          {/* Service & Billing */}
          <Section icon={DollarSign} title="Billing Details">
            <div style={{ padding: '14px 16px', background: theme.colors.bgSubtle, borderRadius: 10, border: `1px solid ${theme.colors.borderLight}`, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Badge t={row.svcCode} bg={svc.bg} color={svc.color} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>{row.svcName}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', marginBottom: 2 }}>Qty</div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{row.qty}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', marginBottom: 2 }}>Rate</div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>${row.rate.toFixed(2)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', marginBottom: 2 }}>Total</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: theme.colors.orange }}>${row.total.toFixed(2)}</div>
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <Field label="Date" value={fmt(row.date)} />
              <Field label="Category" value={row.category} />
            </div>
          </Section>

          {/* Item Info */}
          <Section icon={Package} title="Item Details">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <Field label="Item ID" value={row.itemId} mono />
              <Field label="Class" value={row.itemClass} />
              <Field label="Sidemark" value={row.sidemark} />
            </div>
            <Field label="Description" value={row.description} />
          </Section>

          {/* Invoice Info */}
          {row.invoiceNo && (
            <Section icon={FileText} title="Invoice">
              <Field label="Invoice #" value={row.invoiceNo} mono />
            </Section>
          )}

          {/* Notes */}
          {row.notes && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <FileText size={15} color={theme.colors.orange} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Notes</span>
              </div>
              <div style={{ padding: '10px 14px', background: theme.colors.bgSubtle, borderRadius: 8, border: `1px solid ${theme.colors.borderLight}`, fontSize: 13, color: theme.colors.textSecondary, lineHeight: 1.5 }}>
                {row.notes}
              </div>
            </div>
          )}

          {/* Related Entities */}
          {(row.taskId || row.repairId || row.shipmentNo) && (
            <Section icon={ClipboardList} title="Related">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {row.taskId && (
                  <LinkChip
                    label="Task"
                    id={row.taskId}
                    onClick={onNavigate ? () => onNavigate('task', row.taskId) : undefined}
                  />
                )}
                {row.repairId && (
                  <LinkChip
                    label="Repair"
                    id={row.repairId}
                    onClick={onNavigate ? () => onNavigate('repair', row.repairId) : undefined}
                  />
                )}
                {row.shipmentNo && (
                  <LinkChip
                    label="Shipment"
                    id={row.shipmentNo}
                    onClick={onNavigate ? () => onNavigate('shipment', row.shipmentNo) : undefined}
                  />
                )}
                {row.itemId && (
                  <LinkChip
                    label="Item"
                    id={row.itemId}
                    onClick={onNavigate ? () => onNavigate('item', row.itemId) : undefined}
                  />
                )}
              </div>
            </Section>
          )}
        </div>
      </div>

      <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
    </>
  );
}
