import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { X, Package, Calendar, FileText, ClipboardList, Wrench, Truck, ExternalLink, DollarSign, Ship, AlertCircle, MapPin, CheckCircle2, Pencil, Save, Loader2, FolderOpen, Plus, ChevronDown, Shield, Image as ImageIcon, StickyNote, Activity } from 'lucide-react';
import { FolderButton } from './FolderButton';
import { ItemIdBadges } from './ItemIdBadges';
import { useItemIndicators } from '../../hooks/useItemIndicators';
import { supabase } from '../../lib/supabase';
import { LinkifiedText } from './LinkifiedText';
import { AutocompleteInput } from './AutocompleteInput';
import { theme } from '../../styles/theme';
import { fmtDate } from '../../lib/constants';
import { useReceivingAddons } from '../../hooks/useReceivingAddons';
import { postUpdateInventoryItem, fetchItemMoveHistory, postRequestRepairQuote, postAddItemAddon, postRemoveItemAddon, isApiConfigured } from '../../lib/api';
import type { MoveHistoryEntry } from '../../lib/api';
import type { InventoryItem, InventoryStatus } from '../../lib/types';
import { TabbedDetailPanel } from './TabbedDetailPanel';
import type { TabbedDetailPanelTab } from './TabbedDetailPanel';
import { buildDeepLink } from '../../lib/deepLinks';

export interface LinkedRecord {
  id: string;
  type: 'task' | 'repair' | 'willcall';
  status?: string;
}

interface Props {
  item: any;
  onClose: () => void;
  photosFolderId?: string;
  shipmentFolderUrl?: string;
  linkedTasks?: LinkedRecord[];
  linkedRepairs?: LinkedRecord[];
  linkedWillCalls?: LinkedRecord[];
  onNavigateToRecord?: (type: 'task' | 'repair' | 'willcall' | 'shipment', id: string) => void;
  // Action callbacks
  onCreateTask?: () => void;
  onCreateWillCall?: () => void;
  onTransfer?: () => void;
  // History data — uses any[] to accept both frontend and API types
  itemTasks?: any[];
  itemRepairs?: any[];
  itemWillCalls?: any[];
  itemBilling?: any[];
  // Optional enriched shipment data (carrier, tracking — beyond what's on item itself)
  itemShipment?: { carrier?: string; trackingNo?: string; [key: string]: any };
  // Inline editing props
  userRole?: 'admin' | 'staff' | 'client';
  classNames?: string[];
  locationNames?: string[];
  clientSheetId?: string;
  onItemUpdated?: () => void;
  // Phase 2C — optimistic patch functions (optional)
  applyItemPatch?: (itemId: string, patch: Partial<InventoryItem>) => void;
  mergeItemPatch?: (itemId: string, patch: Partial<InventoryItem>) => void;
  clearItemPatch?: (itemId: string) => void;
}

function Badge({ t, bg, color }: { t: string; bg: string; color: string }) {
  return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: bg, color, whiteSpace: 'nowrap' }}>{t}</span>;
}

function Section({ icon: Icon, title, count, children }: { icon: any; title: string; count?: number; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, flexShrink: 0 }}>
          <Icon size={15} color={theme.colors.orange} />
        </span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        {count !== undefined && <span style={{ fontSize: 11, color: theme.colors.textMuted, background: theme.colors.bgSubtle, padding: '1px 8px', borderRadius: 10 }}>{count}</span>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: value ? theme.colors.text : theme.colors.textMuted, fontFamily: mono ? 'monospace' : 'inherit' }}>{value || '\u2014'}</div>
    </div>
  );
}

// ─── Edit-mode input style ──────────────────────────────────────────────────

const editInputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  fontSize: 13, fontFamily: 'inherit',
  padding: '4px 6px', border: `1px solid ${theme.colors.border}`,
  borderRadius: 4, outline: 'none', background: theme.colors.bgSubtle,
  color: theme.colors.text,
};

function EditInput({ label, value, onChange, mono }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
      <input value={value} onChange={e => onChange(e.target.value)} style={{ ...editInputStyle, fontFamily: mono ? 'monospace' : 'inherit' }} />
    </div>
  );
}

function EditSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ ...editInputStyle, cursor: 'pointer' }}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function EditNumber({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
      <input type="number" min={0} value={value} onChange={e => onChange(e.target.value)} style={editInputStyle} />
    </div>
  );
}

const ICON_MAP = {
  task: ClipboardList,
  repair: Wrench,
  willcall: Truck,
};

const LABEL_MAP = {
  task: 'Tasks',
  repair: 'Repairs',
  willcall: 'Will Calls',
};

function LinkedRecordButton({ records, type, onNavigate }: {
  records: LinkedRecord[];
  type: 'task' | 'repair' | 'willcall';
  onNavigate?: (type: 'task' | 'repair' | 'willcall', id: string) => void;
}) {
  if (!records.length) return null;
  const Icon = ICON_MAP[type];

  // Single record → standalone detail page in a new tab
  if (records.length === 1) {
    const href = `#${type === 'willcall' ? '/will-calls' : type === 'task' ? '/tasks' : '/repairs'}/${encodeURIComponent(records[0].id)}`;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', fontSize: 12, fontWeight: 500,
          border: `1px solid ${theme.colors.border}`, borderRadius: 8,
          background: '#fff', textDecoration: 'none', fontFamily: 'inherit',
          color: theme.colors.textSecondary, transition: 'all 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = theme.colors.orange; e.currentTarget.style.color = theme.colors.orange; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = theme.colors.border; e.currentTarget.style.color = theme.colors.textSecondary; }}
      >
        <Icon size={14} />
        <span>{records[0].id}</span>
        <ExternalLink size={11} style={{ opacity: 0.5 }} />
      </a>
    );
  }

  // Multiple records → in-app navigation to the filtered list page (no specific open id)
  const label = `${records.length} ${LABEL_MAP[type]}`;
  return (
    <button
      onClick={() => onNavigate?.(type, '')}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '6px 12px', fontSize: 12, fontWeight: 500,
        border: `1px solid ${theme.colors.border}`, borderRadius: 8,
        background: '#fff', cursor: 'pointer', fontFamily: 'inherit',
        color: theme.colors.textSecondary, transition: 'all 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = theme.colors.orange; e.currentTarget.style.color = theme.colors.orange; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = theme.colors.border; e.currentTarget.style.color = theme.colors.textSecondary; }}
    >
      <Icon size={14} />
      <span>{label}</span>
      <ExternalLink size={11} style={{ opacity: 0.5 }} />
    </button>
  );
}

// ─── Status color helper ───────────────────────────────────────────────────────

function statusBadgeStyle(status: string): { bg: string; color: string } {
  const s = status?.toLowerCase() || '';
  if (s === 'completed' || s === 'invoiced' || s === 'billed' || s === 'pass' || s === 'released')
    return { bg: '#F0FDF4', color: '#15803D' };
  if (s === 'cancelled' || s === 'void' || s === 'declined' || s === 'fail' || s === 'failed')
    return { bg: '#F3F4F6', color: '#6B7280' };
  if (s === 'unbilled' || s === 'pending' || s === 'in progress' || s === 'open' || s === 'active')
    return { bg: '#FEF3C7', color: '#B45309' };
  return { bg: '#EFF6FF', color: '#1D4ED8' };
}

function MiniStatusBadge({ status }: { status: string }) {
  if (!status) return <span style={{ fontSize: 11, color: theme.colors.textMuted }}>{'\u2014'}</span>;
  const s = statusBadgeStyle(status);
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: 10, fontSize: 10,
      fontWeight: 600, background: s.bg, color: s.color, whiteSpace: 'nowrap',
    }}>{status}</span>
  );
}

// ─── Section emoji map ────────────────────────────────────────────────────────

const SECTION_EMOJI: Record<string, string> = {
  Shipment: '📦', Moves: '📍', Tasks: '📋', Repairs: '🔧', Billing: '💰', 'Will Calls': '🚚',
};

// ─── Collapsible History Section ───────────────────────────────────────────────

function CollapsibleHistorySection({ title, count, defaultOpen, children }: {
  icon?: any; title: string; count: number; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const emoji = SECTION_EMOJI[title] || '';

  return (
    <div style={{ borderTop: `1px solid #F1F5F9` }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
          padding: '12px 0', background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'inherit', color: theme.colors.textPrimary,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {emoji && <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, lineHeight: 1, width: 20, flexShrink: 0, textAlign: 'center' }}>{emoji}</span>}
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1E293B' }}>{title}</span>
          <span style={{
            fontSize: 11, color: theme.colors.textMuted, background: theme.colors.bgSubtle, padding: '1px 8px', borderRadius: 10, fontWeight: 500,
          }}>{count}</span>
        </div>
        <span style={{ fontSize: 14, color: '#94A3B8', transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
      </button>
      {open && (
        <div style={{ paddingBottom: 16 }}>
          {count === 0 ? (
            <div style={{ fontSize: 12, color: '#94A3B8', padding: '4px 0' }}>None</div>
          ) : children}
        </div>
      )}
    </div>
  );
}

// ─── History row styles (mockup-aligned) ──────────────────────────────────────

const histRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
  borderBottom: '1px solid #F8FAFC', fontSize: 12,
};

const histDateStyle: React.CSSProperties = {
  color: '#94A3B8', fontSize: 11, minWidth: 72, flexShrink: 0,
};

const histIdStyle: React.CSSProperties = {
  fontWeight: 600, fontFamily: 'monospace', color: theme.colors.orange,
  cursor: 'pointer', textDecoration: 'none', background: 'none', border: 'none',
  padding: 0, fontSize: 12,
};

const histNoteStyle: React.CSSProperties = {
  color: '#64748B', fontSize: 11,
};

// ─── SERVICE_CODES constant ────────────────────────────────────────────────────

const SERVICE_CODES: Record<string, string> = {
  STOR: 'Storage', RCVG: 'Receiving', INSP: 'Inspection', ASM: 'Assembly',
  MNRTU: 'Minor Touch-Up', WC: 'Will Call', REPAIR: 'Repair',
};

// ─── Status options ────────────────────────────────────────────────────────────

const STATUS_OPTIONS: InventoryStatus[] = ['Active', 'On Hold', 'Released', 'Transferred'];

// ─── Audit entry sub-timeline ─────────────────────────────────────────────────

const AUDIT_ACTION_LABELS: Record<string, { label: string; color: string }> = {
  create: { label: 'Created', color: '#15803D' },
  update: { label: 'Updated', color: '#1D4ED8' },
  start: { label: 'Started', color: '#E85D2D' },
  complete: { label: 'Completed', color: '#15803D' },
  cancel: { label: 'Cancelled', color: '#DC2626' },
  release: { label: 'Released', color: '#7C3AED' },
  transfer: { label: 'Transferred', color: '#0891B2' },
  assign: { label: 'Assigned', color: '#B45309' },
  status_change: { label: 'Status Changed', color: '#6D28D9' },
};

interface AuditEntry {
  id: string; action: string; changes: Record<string, unknown>;
  performed_by: string; performed_at: string;
}

function AuditSubTimeline({ entries }: { entries: AuditEntry[] }) {
  if (!entries.length) return null;
  return (
    <div style={{ marginLeft: 12, borderLeft: `1px solid #E2E8F0`, paddingLeft: 10, marginTop: 4, marginBottom: 4 }}>
      {entries.map(e => {
        const cfg = AUDIT_ACTION_LABELS[e.action] || { label: e.action, color: '#6B7280' };
        const who = e.performed_by ? e.performed_by.split('@')[0] : 'System';
        let detail = '';
        if (e.changes) {
          if (e.changes.summary) detail = String(e.changes.summary);
          else if (e.changes.status && typeof e.changes.status === 'object') {
            const s = e.changes.status as { old?: string; new?: string };
            if (s.old && s.new) detail = `${s.old} → ${s.new}`;
            else if (s.new) detail = `→ ${s.new}`;
          }
          if (e.changes.result) detail += (detail ? ' · ' : '') + String(e.changes.result);
        }
        const time = (() => { try { const d = new Date(e.performed_at); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } })();
        return (
          <div key={e.id} style={{ fontSize: 10, color: '#64748B', padding: '2px 0', display: 'flex', gap: 6, alignItems: 'baseline' }}>
            <span style={{ color: cfg.color, fontWeight: 700, fontSize: 9, textTransform: 'uppercase', flexShrink: 0 }}>{cfg.label}</span>
            {detail && <span>{detail}</span>}
            <span style={{ color: '#94A3B8' }}>by {who}</span>
            <span style={{ color: '#CBD5E1', marginLeft: 'auto', flexShrink: 0 }}>{time}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Item History Component ────────────────────────────────────────────────────

function ItemHistory({ tasks, repairs, willCalls, billing, moves, shipmentNumber, receiveDate, shipmentCarrier, shipmentTracking, auditByEntity, clientSheetId }: {
  tasks: any[];
  repairs: any[];
  willCalls: any[];
  billing: any[];
  moves: MoveHistoryEntry[];
  shipmentNumber?: string;
  receiveDate?: string;
  shipmentCarrier?: string;
  shipmentTracking?: string;
  auditByEntity: Record<string, AuditEntry[]>;
  clientSheetId?: string;
}) {
  return (
    <div>
      {/* Shipment — always first */}
      <CollapsibleHistorySection icon={Ship} title="Shipment" count={shipmentNumber ? 1 : 0}>
        {shipmentNumber && (
          <>
            <div style={histRowStyle}>
              <div style={histDateStyle}>{fmtDate(receiveDate)}</div>
              <div style={{ flex: 1 }}>
                <div>
                  <a href={buildDeepLink('shipments', shipmentNumber!, clientSheetId)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={histIdStyle}>{shipmentNumber}</a>
                  {' '}
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#16A34A' }}>Received</span>
                </div>
                {(shipmentCarrier || shipmentTracking) && (
                  <div style={histNoteStyle}>
                    {[shipmentCarrier, shipmentTracking].filter(Boolean).join(' \u00b7 ')}
                  </div>
                )}
              </div>
            </div>
            <AuditSubTimeline entries={auditByEntity[shipmentNumber] || []} />
          </>
        )}
      </CollapsibleHistorySection>

      {/* Moves — between Shipments and Tasks */}
      <CollapsibleHistorySection icon={MapPin} title="Moves" count={moves.length}>
        {moves.map((m, i) => {
          const isTransfer = m.type === 'Transfer' || m.type === 'transfer';
          return (
            <div key={i} style={histRowStyle}>
              <div style={histDateStyle}>{m.timestamp || '\u2014'}</div>
              <div style={{ flex: 1 }}>
                <div>
                  <span style={{ fontWeight: isTransfer ? 600 : 400, color: isTransfer ? '#1E293B' : '#475569' }}>{m.fromLocation || '\u2014'}</span>
                  <span style={{ color: '#E85D2D', fontWeight: 700, margin: '0 4px' }}>\u2192</span>
                  <span style={{ fontWeight: isTransfer ? 600 : 400, color: isTransfer ? '#1E293B' : '#475569' }}>{m.toLocation || '\u2014'}</span>
                  <span style={{
                    display: 'inline-block', padding: '1px 6px', borderRadius: 8, fontSize: 9, fontWeight: 700, marginLeft: 6,
                    background: isTransfer ? '#FFF7ED' : '#EFF6FF',
                    color: isTransfer ? '#E85D2D' : '#1D4ED8',
                  }}>{isTransfer ? 'Transfer' : 'Location'}</span>
                </div>
                {m.user && <div style={{ fontSize: 10, color: '#94A3B8' }}>By: {m.user}</div>}
              </div>
            </div>
          );
        })}
      </CollapsibleHistorySection>

      {/* Tasks */}
      <CollapsibleHistorySection icon={ClipboardList} title="Tasks" count={tasks.length}>
        {tasks.map(t => (
          <div key={t.taskId}>
            <div style={histRowStyle}>
              <div style={histDateStyle}>{fmtDate(t.completedAt || t.cancelledAt || t.created)}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <a href={buildDeepLink('tasks', t.taskId, clientSheetId)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={histIdStyle}>{t.taskId}</a>
                  <MiniStatusBadge status={t.status} />
                  {t.result && <MiniStatusBadge status={t.result} />}
                </div>
                <div style={histNoteStyle}>
                  {SERVICE_CODES[t.svcCode] || t.svcCode || t.type || '\u2014'}
                </div>
              </div>
            </div>
            <AuditSubTimeline entries={auditByEntity[t.taskId] || []} />
          </div>
        ))}
      </CollapsibleHistorySection>

      {/* Repairs */}
      <CollapsibleHistorySection icon={Wrench} title="Repairs" count={repairs.length}>
        {repairs.map(r => (
          <div key={r.repairId}>
            <div style={histRowStyle}>
              <div style={histDateStyle}>{fmtDate(r.completedDate || r.createdDate)}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <a href={buildDeepLink('repairs', r.repairId, clientSheetId)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={histIdStyle}>{r.repairId}</a>
                  <MiniStatusBadge status={r.status} />
                  {(r.repairResult || r.result) && <MiniStatusBadge status={r.repairResult || r.result} />}
                </div>
                <div style={histNoteStyle}>
                  {(r.finalAmount ?? r.approvedAmount) != null
                    ? `$${Number(r.finalAmount ?? r.approvedAmount).toFixed(2)}`
                    : r.quoteAmount != null ? `$${Number(r.quoteAmount).toFixed(2)}` : ''}
                  {r.repairVendor && <> \u00b7 {r.repairVendor}</>}
                </div>
              </div>
            </div>
            <AuditSubTimeline entries={auditByEntity[r.repairId] || []} />
          </div>
        ))}
      </CollapsibleHistorySection>

      {/* Will Calls */}
      <CollapsibleHistorySection icon={Truck} title="Will Calls" count={willCalls.length}>
        {willCalls.map(w => (
          <div key={w.wcNumber}>
            <div style={histRowStyle}>
              <div style={histDateStyle}>{fmtDate(w.actualPickupDate || w.estimatedPickupDate || w.createdDate)}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <a href={buildDeepLink('will-calls', w.wcNumber, clientSheetId)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={histIdStyle}>{w.wcNumber}</a>
                  <MiniStatusBadge status={w.status} />
                </div>
                {w.pickupParty && <div style={histNoteStyle}>{w.pickupParty}</div>}
              </div>
            </div>
            <AuditSubTimeline entries={auditByEntity[w.wcNumber] || []} />
          </div>
        ))}
      </CollapsibleHistorySection>

      {/* Billing — always last */}
      <CollapsibleHistorySection icon={DollarSign} title="Billing" count={billing.length}>
        {billing.map((b, i) => (
          <div key={b.ledgerRowId || i} style={histRowStyle}>
            <div style={histDateStyle}>{fmtDate(b.date)}</div>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 12 }}>{b.svcCode || ''} \u00b7 {b.svcName || SERVICE_CODES[b.svcCode] || ''}</span>
            </div>
            <div style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>
              {b.total != null ? `$${Number(b.total).toFixed(2)}` : '\u2014'}
            </div>
          </div>
        ))}
      </CollapsibleHistorySection>
    </div>
  );
}


export function ItemDetailPanel({
  item, onClose, photosFolderId, shipmentFolderUrl,
  linkedTasks = [], linkedRepairs = [], linkedWillCalls = [],
  onNavigateToRecord,
  onCreateTask, onCreateWillCall, onTransfer,
  itemTasks = [], itemRepairs = [], itemWillCalls = [], itemBilling = [],
  itemShipment,
  userRole, classNames = [], locationNames = [], clientSheetId, onItemUpdated,
  applyItemPatch, mergeItemPatch, clearItemPatch,
}: Props) {
  // Panel frame + resize + backdrop are handled by TabbedDetailPanel now.
  const statusCfg: Record<string, { bg: string; color: string }> = {
    Active: { bg: '#F0FDF4', color: '#15803D' },
    Released: { bg: '#EFF6FF', color: '#1D4ED8' },
    'On Hold': { bg: '#FEF3C7', color: '#B45309' },
    Transferred: { bg: '#F3F4F6', color: '#6B7280' },
  };
  const sc = statusCfg[item.status] || statusCfg.Active;

  const hasLinkedRecords = linkedTasks.length > 0 || linkedRepairs.length > 0 || linkedWillCalls.length > 0;
  const hasShipment = !!item.shipmentNumber;

  // (I)(A)(R) item indicators — list pages already compute these from
  // already-loaded tasks/repairs; the detail panel has to fetch on its own
  // because it may open from a deep link or a page that doesn't keep the
  // full task/repair list in scope. Tenant-scoped Supabase read, ~50ms.
  const { inspItems, asmItems, repairItems } = useItemIndicators(clientSheetId);

  // Move history — fetch from API when panel opens
  const [moveHistory, setMoveHistory] = useState<MoveHistoryEntry[]>([]);
  useEffect(() => {
    if (!clientSheetId || !item.itemId) return;
    let cancelled = false;
    fetchItemMoveHistory(item.itemId, clientSheetId).then(res => {
      if (!cancelled && res.ok && res.data?.moves) {
        setMoveHistory(res.data.moves);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [clientSheetId, item.itemId]);

  // Fetch audit log entries for this item and all related entities
  const [auditByEntity, setAuditByEntity] = useState<Record<string, AuditEntry[]>>({});
  useEffect(() => {
    if (!item.itemId) return;
    let cancelled = false;
    // Collect all entity IDs we want audit for
    const entityIds = [item.itemId];
    if (item.shipmentNumber) entityIds.push(item.shipmentNumber);
    for (const t of itemTasks) if (t.taskId) entityIds.push(t.taskId);
    for (const r of itemRepairs) if (r.repairId) entityIds.push(r.repairId);
    for (const w of itemWillCalls) if (w.wcNumber) entityIds.push(w.wcNumber);
    (async () => {
      try {
        const { data } = await supabase
          .from('entity_audit_log')
          .select('id, entity_id, action, changes, performed_by, performed_at')
          .in('entity_id', entityIds)
          .order('performed_at', { ascending: true })
          .limit(200);
        if (!cancelled && data) {
          const grouped: Record<string, AuditEntry[]> = {};
          for (const row of data as (AuditEntry & { entity_id: string })[]) {
            if (!grouped[row.entity_id]) grouped[row.entity_id] = [];
            grouped[row.entity_id].push(row);
          }
          setAuditByEntity(grouped);
        }
      } catch { /* best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [item.itemId, item.shipmentNumber, itemTasks.length, itemRepairs.length, itemWillCalls.length]);

  const historyCount = (hasShipment ? 1 : 0) + moveHistory.length + itemTasks.length + itemRepairs.length + itemWillCalls.length + itemBilling.length;

  // Can this user edit?
  const canEditBasic = !!clientSheetId; // all roles can edit basic fields
  const canEditStaff = canEditBasic && (userRole === 'admin' || userRole === 'staff');

  // Repair quote state
  const [repairRequested, setRepairRequested] = useState(false);
  const [repairRequesting, setRepairRequesting] = useState(false);

  // Find active (non-completed/cancelled) repair for this item
  const activeRepair = useMemo(() => {
    return itemRepairs.find((r: any) => {
      const s = String(r.status || '').trim();
      return s === 'Pending Quote' || s === 'Quote Sent' || s === 'Approved';
    });
  }, [itemRepairs]);

  const repairStatus = activeRepair ? String(activeRepair.status || '').trim()
    : repairRequested ? 'Pending Quote'
    : null;

  const handleRequestRepair = useCallback(async () => {
    if (!isApiConfigured() || !clientSheetId || !item.itemId) return;
    setRepairRequesting(true);
    try {
      const resp = await postRequestRepairQuote({ itemId: item.itemId }, clientSheetId);
      if (resp.ok && resp.data?.success) { setRepairRequested(true); onItemUpdated?.(); }
    } catch (_) {}
    setRepairRequesting(false);
  }, [clientSheetId, item.itemId, onItemUpdated]);

  // ─── Add-on services (OVER300, NO_ID, etc.) — live toggles ───────────────
  // Checked state derives from itemBilling: an unbilled row with svcCode matching
  // an addon code = checked. Already-billed rows show the addon as checked + locked.
  // Optimistic local overrides bridge the gap between click and data refetch.
  const { addons: catalogAddons } = useReceivingAddons();
  const canEditAddons = userRole === 'admin' || userRole === 'staff';
  const [addonPending, setAddonPending] = useState<Record<string, 'adding' | 'removing'>>({});
  const [addonOverrides, setAddonOverrides] = useState<Record<string, boolean>>({}); // optimistic overrides; cleared on refetch
  const [addonError, setAddonError] = useState<string | null>(null);

  // Checked state + lock state per addon, derived from itemBilling
  const addonStatus = useMemo(() => {
    const out: Record<string, { checked: boolean; locked: boolean; lockedStatus?: string; ledgerRowId?: string }> = {};
    for (const a of catalogAddons) {
      let row: any = null;
      for (const b of itemBilling) {
        if (String(b.svcCode || '').trim() === a.code) { row = b; break; }
      }
      const status = row ? String(row.status || '').trim() : '';
      const baseChecked = !!row;
      const override = addonOverrides[a.code];
      out[a.code] = {
        checked: override !== undefined ? override : baseChecked,
        locked: !!row && status !== 'Unbilled',
        lockedStatus: status || undefined,
        ledgerRowId: row?.ledgerRowId,
      };
    }
    return out;
  }, [catalogAddons, itemBilling, addonOverrides]);

  // Clear optimistic overrides when the underlying billing data refreshes
  useEffect(() => { setAddonOverrides({}); }, [itemBilling]);

  const toggleAddonLive = useCallback(async (code: string) => {
    if (!canEditAddons) return;
    if (!isApiConfigured() || !clientSheetId || !item.itemId) return;
    const s = addonStatus[code];
    if (!s || s.locked) {
      setAddonError(`Cannot change — already ${s?.lockedStatus || 'invoiced'}`);
      setTimeout(() => setAddonError(null), 3000);
      return;
    }
    setAddonError(null);
    const nextChecked = !s.checked;
    setAddonOverrides(prev => ({ ...prev, [code]: nextChecked }));
    setAddonPending(prev => ({ ...prev, [code]: nextChecked ? 'adding' : 'removing' }));
    try {
      const resp = nextChecked
        ? await postAddItemAddon({ itemId: item.itemId, serviceCode: code }, clientSheetId)
        : await postRemoveItemAddon({ itemId: item.itemId, serviceCode: code }, clientSheetId);
      if (!resp.ok || !resp.data?.success) {
        // rollback
        setAddonOverrides(prev => { const n = { ...prev }; delete n[code]; return n; });
        const msg = resp.data?.error || resp.error || 'Failed to update add-on';
        setAddonError(msg);
        setTimeout(() => setAddonError(null), 3500);
      } else {
        onItemUpdated?.();
      }
    } catch (err) {
      setAddonOverrides(prev => { const n = { ...prev }; delete n[code]; return n; });
      setAddonError(err instanceof Error ? err.message : String(err));
      setTimeout(() => setAddonError(null), 3500);
    } finally {
      setAddonPending(prev => { const n = { ...prev }; delete n[code]; return n; });
    }
  }, [canEditAddons, clientSheetId, item.itemId, addonStatus, onItemUpdated]);

  // ─── Edit/Save mode ───────────────────────────────────────────────────────
  interface DraftFields {
    vendor: string; description: string; reference: string; sidemark: string; room: string;
    location: string; itemClass: string; qty: string; status: string; itemNotes: string;
  }
  const makeDraft = useCallback((): DraftFields => ({
    vendor: item.vendor || '',
    description: item.description || '',
    reference: item.reference || item.poNumber || '',
    sidemark: item.sidemark || '',
    room: item.room || '',
    location: item.location || '',
    itemClass: item.itemClass || '',
    qty: String(item.qty ?? 1),
    status: item.status || 'Active',
    itemNotes: item.itemNotes || item.notes || '',
  }), [item]);

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<DraftFields>(makeDraft);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  // Optimistic overrides — shown after save until next refetch brings fresh data
  const [optimistic, setOptimistic] = useState<Partial<DraftFields> | null>(null);

  const setDraftField = useCallback((field: keyof DraftFields, value: string) => {
    setDraft(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleEditStart = useCallback(() => {
    setDraft(makeDraft());
    setSaveError(null);
    setSaveSuccess(false);
    setIsEditing(true);
  }, [makeDraft]);

  const handleEditCancel = useCallback(() => {
    setIsEditing(false);
    setSaveError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!clientSheetId) return;
    const original = makeDraft();
    // Build payload of only changed fields
    const payload: Record<string, unknown> = { itemId: item.itemId };
    let hasChanges = false;
    // Basic fields (all roles)
    for (const key of ['vendor', 'description', 'reference', 'sidemark', 'room'] as const) {
      if (draft[key].trim() !== original[key]) { payload[key] = draft[key].trim(); hasChanges = true; }
    }
    // Staff/admin fields
    if (canEditStaff) {
      if (draft.location !== original.location) { payload.location = draft.location; hasChanges = true; }
      if (draft.itemClass !== original.itemClass) { payload.itemClass = draft.itemClass; hasChanges = true; }
      const qtyNum = Number(draft.qty);
      if (!isNaN(qtyNum) && qtyNum >= 0 && String(qtyNum) !== original.qty) { payload.qty = qtyNum; hasChanges = true; }
      if (draft.status !== original.status) { payload.status = draft.status; hasChanges = true; }
      if (draft.itemNotes.trim() !== original.itemNotes) { payload.itemNotes = draft.itemNotes.trim(); hasChanges = true; }
    }
    if (!hasChanges) { setIsEditing(false); return; }

    // Phase 2C: patch table row immediately (merge — accumulates fields across saves)
    const patchData: Partial<InventoryItem> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (k !== 'itemId') (patchData as any)[k] = v;
    }
    mergeItemPatch?.(item.itemId, patchData);

    setSaving(true);
    setSaveError(null);
    try {
      const res = await postUpdateInventoryItem(payload as any, clientSheetId);
      if (res.ok) {
        // Store optimistic overrides so UI shows saved values despite cache
        const overrides: Partial<DraftFields> = {};
        for (const key of Object.keys(payload)) {
          if (key !== 'itemId') (overrides as any)[key] = String(payload[key]);
        }
        setOptimistic(overrides);
        setSaveSuccess(true);
        setIsEditing(false);
        onItemUpdated?.();
        setTimeout(() => setSaveSuccess(false), 3000);
        // Note: do NOT clearItemPatch on success — patch stays until 120s TTL expires
        // (patch value == server value, so no visual difference when it expires)
      } else {
        clearItemPatch?.(item.itemId); // rollback table row patch
        setSaveError(res.data?.error || 'Save failed');
      }
    } catch {
      clearItemPatch?.(item.itemId); // rollback table row patch
      setSaveError('Network error — please try again');
    }
    setSaving(false);
  }, [clientSheetId, item.itemId, draft, makeDraft, canEditStaff, onItemUpdated, mergeItemPatch, clearItemPatch]);

  // Clear optimistic overrides when item prop changes (fresh data arrived)
  const itemIdRef = useRef(item.itemId);
  useEffect(() => {
    if (item.itemId !== itemIdRef.current) {
      itemIdRef.current = item.itemId;
      setOptimistic(null);
      setIsEditing(false);
    }
  }, [item.itemId]);

  // Display value helper: optimistic override > item prop
  const dv = useCallback((field: keyof DraftFields, fallback?: string) => {
    if (optimistic && optimistic[field] !== undefined) return optimistic[field]!;
    if (field === 'itemNotes') return item.itemNotes || item.notes || fallback || '';
    if (field === 'reference') return item.reference || item.poNumber || fallback || '';
    return (item as any)[field] || fallback || '';
  }, [item, optimistic]);

  // Folder URLs from linked entity records
  const taskFolderUrls: { label: string; url: string }[] = itemTasks
    .filter(t => t.taskFolderUrl)
    .map(t => ({ label: t.taskId || 'Task Folder', url: t.taskFolderUrl }));
  const repairFolderUrls: { label: string; url: string }[] = itemRepairs
    .filter(r => r.repairFolderUrl)
    .map(r => ({ label: r.repairId || 'Repair Folder', url: r.repairFolderUrl }));
  const wcFolderUrls: { label: string; url: string }[] = itemWillCalls
    .filter(w => w.wcFolderUrl)
    .map(w => ({ label: w.wcNumber || 'WC Folder', url: w.wcFolderUrl }));
  const entityFolderButtons = [...taskFolderUrls, ...repairFolderUrls, ...wcFolderUrls];

  // ── Tab render functions ────────────────────────────────────────────────
  // Each render function is a plain fragment — ALL existing state,
  // handlers, and computed values from above are captured in-closure so
  // behavior is identical to the pre-refactor panel. Only the OUTER frame
  // + section grouping changes.

  const renderDetailsTab = () => (
    <>
      {/* Item Info */}
      <Section icon={Package} title="Item Details">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          {isEditing ? (
            <>
              <EditInput label="Vendor" value={draft.vendor} onChange={v => setDraftField('vendor', v)} />
              {canEditStaff ? (
                <EditSelect label="Class" value={draft.itemClass} options={classNames.length > 0 ? classNames : [draft.itemClass || '']} onChange={v => setDraftField('itemClass', v)} />
              ) : (
                <Field label="Class" value={dv('itemClass')} />
              )}
              {canEditStaff ? (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Location</div>
                  <AutocompleteInput value={draft.location} onChange={v => setDraftField('location', v)} suggestions={locationNames} placeholder="Type location..." allowCustom icon={false} style={{ fontSize: 13 }} />
                </div>
              ) : (
                <Field label="Location" value={dv('location')} mono />
              )}
              {canEditStaff ? (
                <EditNumber label="Qty" value={draft.qty} onChange={v => setDraftField('qty', v)} />
              ) : (
                <Field label="Qty" value={dv('qty')} />
              )}
              <EditInput label="Sidemark" value={draft.sidemark} onChange={v => setDraftField('sidemark', v)} />
              <EditInput label="Room" value={draft.room} onChange={v => setDraftField('room', v)} />
            </>
          ) : (
            <>
              <Field label="Vendor" value={dv('vendor')} />
              <Field label="Class" value={dv('itemClass')} />
              <Field label="Location" value={dv('location')} mono />
              <Field label="Qty" value={dv('qty')} />
              <Field label="Sidemark" value={dv('sidemark')} />
              <Field label="Room" value={dv('room')} />
            </>
          )}
          <Field label="Receive Date" value={fmtDate(item.receiveDate)} />
          <Field label="Release Date" value={fmtDate(item.releaseDate)} />
        </div>

        <div style={{ marginTop: 4 }}>
          {isEditing ? (
            <>
              <EditInput label="Description" value={draft.description} onChange={v => setDraftField('description', v)} />
              <EditInput label="Reference" value={draft.reference} onChange={v => setDraftField('reference', v)} />
            </>
          ) : (
            <>
              <Field label="Description" value={dv('description')} />
              <Field label="Reference" value={dv('reference')} />
            </>
          )}
        </div>
      </Section>

      {/* Item Notes — single-text field (distinct from threaded Notes tab) */}
      <Section icon={AlertCircle} title="Item Notes">
        {isEditing && canEditStaff ? (
          <textarea value={draft.itemNotes} onChange={e => setDraftField('itemNotes', e.target.value)} rows={3}
            style={{ ...editInputStyle, resize: 'vertical' }} />
        ) : (
          <LinkifiedText
            text={dv('itemNotes') || ''}
            fontSize={13}
            color={dv('itemNotes') ? theme.colors.text : theme.colors.textMuted}
          />
        )}
      </Section>

      {/* Add-on Services */}
      {catalogAddons.length > 0 && (
        <Section icon={Plus} title="Add-on Services" count={catalogAddons.filter(a => addonStatus[a.code]?.checked).length || undefined}>
          {addonError && (
            <div role="alert" style={{ fontSize: 11, color: '#92400E', background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 6, padding: '6px 10px', marginBottom: 8 }}>
              {addonError}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {catalogAddons.map(a => {
              const s = addonStatus[a.code] || { checked: false, locked: false };
              const rate = a.rateForClass(item.itemClass || '');
              const pending = addonPending[a.code];
              const disabled = !canEditAddons || !!pending || s.locked;
              return (
                <label
                  key={a.code}
                  onClick={e => { if (disabled) return; e.preventDefault(); toggleAddonLive(a.code); }}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '6px 10px', borderRadius: 8,
                    border: `1px solid ${s.checked ? theme.colors.orange : theme.colors.borderLight}`,
                    background: s.locked ? '#F3F4F6' : s.checked ? '#FFF7F0' : '#fff',
                    cursor: disabled ? 'default' : 'pointer',
                    fontSize: 12, userSelect: 'none',
                    opacity: pending ? 0.6 : 1,
                  }}
                  title={s.locked ? `Locked — already ${s.lockedStatus}` : !canEditAddons ? 'View only' : 'Click to toggle'}
                >
                  <input type="checkbox" checked={s.checked} readOnly disabled={disabled} style={{ accentColor: theme.colors.orange, cursor: disabled ? 'default' : 'pointer', margin: 0 }} />
                  <span style={{ fontWeight: 600, color: theme.colors.text }}>{a.name}</span>
                  <span style={{ color: theme.colors.textMuted, fontSize: 11 }}>
                    {rate > 0 ? `$${rate.toFixed(2)}` : (item.itemClass ? 'no rate' : 'set class')}
                  </span>
                  {pending && <Loader2 size={11} style={{ animation: 'spin 1s linear infinite', color: theme.colors.orange }} />}
                  {s.locked && (
                    <span style={{ fontSize: 9, fontWeight: 700, background: '#E5E7EB', color: '#4B5563', padding: '1px 5px', borderRadius: 6, textTransform: 'uppercase' }}>
                      {s.lockedStatus}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </Section>
      )}

      {/* Related — folder buttons + linked-record shortcuts */}
      <Section icon={FileText} title="Related" count={linkedTasks.length + linkedRepairs.length + linkedWillCalls.length || undefined}>
        {(shipmentFolderUrl || photosFolderId) && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {shipmentFolderUrl && (
              <FolderButton label={`Shipment ${item.shipmentNumber || 'Folder'}`} url={shipmentFolderUrl} icon={Truck} />
            )}
            {photosFolderId && (
              <FolderButton label="Photos" url={`https://drive.google.com/drive/folders/${photosFolderId}`} icon={FolderOpen} />
            )}
          </div>
        )}

        {entityFolderButtons.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {entityFolderButtons.map(({ label, url }) => (
              <FolderButton key={label} label={label} url={url} icon={ExternalLink} />
            ))}
          </div>
        )}

        {hasLinkedRecords ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <LinkedRecordButton records={linkedTasks} type="task" onNavigate={onNavigateToRecord} />
            <LinkedRecordButton records={linkedRepairs} type="repair" onNavigate={onNavigateToRecord} />
            <LinkedRecordButton records={linkedWillCalls} type="willcall" onNavigate={onNavigateToRecord} />
          </div>
        ) : !item.shipmentNumber && !shipmentFolderUrl && entityFolderButtons.length === 0 ? (
          <div style={{ fontSize: 12, color: theme.colors.textMuted, padding: '4px 0', fontStyle: 'italic' }}>
            No linked tasks, repairs, or will calls found for this item.
          </div>
        ) : null}
      </Section>
    </>
  );

  const renderCoverageTab = () => (
    <ItemCoverageTab
      item={item}
      canEdit={!!canEditStaff}
      optimistic={optimistic as any}
      applyItemPatch={applyItemPatch}
      clearItemPatch={clearItemPatch}
    />
  );

  const renderActivityTab = () => (
    <Section icon={Calendar} title="Item History" count={historyCount || undefined}>
      {historyCount === 0 ? (
        <div style={{ fontSize: 12, color: theme.colors.textMuted, padding: '4px 0', fontStyle: 'italic' }}>
          No history found for this item.
        </div>
      ) : (
        <ItemHistory
          tasks={itemTasks}
          repairs={itemRepairs}
          willCalls={itemWillCalls}
          billing={itemBilling}
          moves={moveHistory}
          shipmentNumber={item.shipmentNumber}
          receiveDate={item.receiveDate}
          shipmentCarrier={itemShipment?.carrier}
          shipmentTracking={itemShipment?.trackingNo}
          auditByEntity={auditByEntity}
          clientSheetId={clientSheetId}
        />
      )}
    </Section>
  );

  // ── Header components: status pill + Actions dropdown ──────────────────

  const headerStatusBadge = isEditing && canEditStaff ? (
    <select value={draft.status} onChange={e => setDraftField('status', e.target.value)}
      style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, border: `1px solid ${theme.colors.border}`, fontWeight: 600, background: theme.colors.bgSubtle, cursor: 'pointer' }}>
      {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  ) : (
    <Badge t={isEditing ? draft.status : (dv('status') || item.status)} bg={sc.bg} color={sc.color} />
  );

  const headerActions = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <ItemActionsMenu
        onCreateTask={onCreateTask}
        onCreateWillCall={onCreateWillCall}
        onTransfer={onTransfer}
        onRequestRepair={handleRequestRepair}
        repairStatus={repairStatus ?? undefined}
        repairRequesting={repairRequesting}
      />
      <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, color: 'rgba(255,255,255,0.7)' }}>
        <X size={18} />
      </button>
    </div>
  );

  const statusStrip = (saveError || saveSuccess) ? (
    <>
      {saveError && (
        <div style={{ padding: '6px 20px', background: '#FEF2F2', color: '#DC2626', fontSize: 12, fontWeight: 500, borderBottom: `1px solid #FECACA` }}>
          {saveError}
        </div>
      )}
      {saveSuccess && (
        <div style={{ padding: '6px 20px', background: '#F0FDF4', color: '#15803D', fontSize: 12, fontWeight: 500, borderBottom: `1px solid #BBF7D0` }}>
          Changes saved successfully
        </div>
      )}
    </>
  ) : null;

  const footer = (canEditBasic || isEditing) ? (
    <div style={{
      padding: '10px 20px',
      background: '#FAFAFA',
      display: 'flex', gap: 8, alignItems: 'center',
    }}>
      {isEditing ? (
        <>
          <button onClick={handleSave} disabled={saving}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', background: theme.colors.orange, color: '#fff', cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={12} />}
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={handleEditCancel} disabled={saving}
            style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: `1px solid ${theme.colors.border}`, background: '#fff', color: theme.colors.textSecondary, cursor: 'pointer' }}>
            Cancel
          </button>
        </>
      ) : canEditBasic ? (
        <button onClick={handleEditStart}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: `1px solid ${theme.colors.border}`, background: '#fff', color: theme.colors.textSecondary, cursor: 'pointer' }}>
          <Pencil size={12} /> Edit
        </button>
      ) : null}
    </div>
  ) : null;

  // Custom tabs listed in the order we want them to appear. Built-in tabs
  // (Photos/Docs/Notes/Activity) are appended by the shell after any custom
  // tab NOT matching their id. We interleave by listing the custom tabs with
  // the ids the built-ins register, so the final order is:
  //   Details, Photos, Docs, Notes, Coverage, Activity
  // (Details → custom; Photos/Docs/Notes → built-in; Coverage → custom;
  //  Activity → built-in with render escape hatch.)
  const customTabs: TabbedDetailPanelTab[] = [
    {
      id: 'details',
      label: 'Details',
      icon: <ClipboardList size={13} />,
      keepMounted: true, // preserve edit-input focus across tab switches
      render: () => renderDetailsTab(),
    },
    // Built-ins (photos/docs/notes) will be inserted by the shell here since
    // they aren't in `customTabs` — they append after the customs that match
    // NO built-in id. To force Coverage to sit AFTER the built-ins, we
    // declare it AFTER registering built-ins. The shell's order logic keeps
    // customs in array order and appends un-referenced built-ins; so to
    // achieve the desired final order we instead list ALL tabs manually
    // here and disable `builtInTabs`.
    {
      id: 'photos',
      label: 'Photos',
      icon: <ImageIcon size={13} />,
      render: () => <PhotosPanelProxy item={item} clientSheetId={clientSheetId} />,
    },
    {
      id: 'docs',
      label: 'Docs',
      icon: <FileText size={13} />,
      render: () => <DocsPanelProxy itemId={item.itemId} clientSheetId={clientSheetId} />,
    },
    {
      id: 'notes',
      label: 'Notes',
      icon: <StickyNote size={13} />,
      render: () => <NotesPanelProxy
        itemId={item.itemId}
        itemTasks={itemTasks}
        itemRepairs={itemRepairs}
        itemWillCalls={itemWillCalls}
        shipmentNumber={item.shipmentNumber}
      />,
    },
    {
      id: 'coverage',
      label: 'Coverage',
      icon: <Shield size={13} />,
      render: () => renderCoverageTab(),
    },
    {
      id: 'activity',
      label: 'Activity',
      icon: <Activity size={13} />,
      render: () => renderActivityTab(),
    },
  ];

  return (
    <>
      <TabbedDetailPanel
        title={item.itemId}
        clientName={item.clientName}
        sidemark={item.sidemark}
        idBadges={
          <ItemIdBadges
            itemId={item.itemId}
            inspItems={inspItems}
            asmItems={asmItems}
            repairItems={repairItems}
          />
        }
        belowId={headerStatusBadge}
        headerActions={headerActions}
        tabs={customTabs}
        initialTabId="details"
        statusStrip={statusStrip}
        footer={footer}
        onClose={onClose}
        resizeKey="item"
        defaultWidth={420}
      />
      <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
    </>
  );
}

// ── Local proxy components for built-in tab content ────────────────────────
// These thin wrappers let us compose the shared PhotosPanel / DocumentsPanel
// / NotesPanel (from EntityAttachments.tsx) with item-specific props (e.g.
// cross-entity itemId rollup for Photos, related-entity pills for Notes).
// Imported lazily to keep the main component file from growing wider.

import { PhotosPanel as _PhotosPanel, DocumentsPanel as _DocumentsPanel, NotesPanel as _NotesPanel } from './EntityAttachments';
import { useCoverageOptions, formatCoverageRate, type CoverageOption } from '../../hooks/useCoverageOptions';
import { AutocompleteSelect } from './AutocompleteSelect';
import type { InventoryItem as CoverageItemType } from '../../lib/types';

function PhotosPanelProxy({ item, clientSheetId }: { item: any; clientSheetId: string | undefined }) {
  return (
    <_PhotosPanel
      entityType="inventory"
      entityId={item.itemId}
      itemId={item.itemId}
      tenantId={clientSheetId}
      enableSourceFilter
    />
  );
}

function DocsPanelProxy({ itemId, clientSheetId }: { itemId: string; clientSheetId: string | undefined }) {
  return (
    <_DocumentsPanel
      contextType="item"
      contextId={itemId}
      tenantId={clientSheetId}
    />
  );
}

function NotesPanelProxy({
  itemId, itemTasks, itemRepairs, itemWillCalls, shipmentNumber,
}: {
  itemId: string;
  itemTasks: any[];
  itemRepairs: any[];
  itemWillCalls: any[];
  shipmentNumber?: string;
}) {
  const related = [
    ...itemTasks.map((t: any) => ({ type: 'task', id: String(t.taskId || ''), label: `Task ${t.taskId}` })).filter(r => r.id),
    ...itemRepairs.map((r: any) => ({ type: 'repair', id: String(r.repairId || ''), label: `Repair ${r.repairId}` })).filter(r => r.id),
    ...itemWillCalls.map((w: any) => ({ type: 'will_call', id: String(w.wcNumber || ''), label: `WC ${w.wcNumber}` })).filter(r => r.id),
    ...(shipmentNumber ? [{ type: 'shipment', id: String(shipmentNumber), label: `Shipment ${shipmentNumber}` }] : []),
  ];
  return <_NotesPanel entityType="inventory" entityId={itemId} relatedEntities={related} enableSourceFilter itemId={itemId} />;
}

// ── Actions dropdown (Quick Actions moved into header per mockup) ──────────

function ItemActionsMenu({
  onCreateTask, onCreateWillCall, onTransfer, onRequestRepair,
  repairStatus, repairRequesting,
}: {
  onCreateTask?: () => void;
  onCreateWillCall?: () => void;
  onTransfer?: () => void;
  onRequestRepair: () => Promise<void>;
  repairStatus?: string;
  repairRequesting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const itemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    width: '100%', padding: '8px 12px', fontSize: 12,
    fontWeight: 500, color: theme.colors.text,
    background: 'none', border: 'none', cursor: 'pointer',
    textAlign: 'left', fontFamily: 'inherit',
  };

  const handle = (fn?: () => void) => () => { setOpen(false); fn?.(); };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '6px 12px', fontSize: 12, fontWeight: 600,
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.25)',
          background: 'rgba(255,255,255,0.12)',
          color: '#fff',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <Plus size={13} /> Actions <ChevronDown size={12} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 6px)',
          background: '#fff', border: `1px solid ${theme.colors.border}`,
          borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          minWidth: 180, zIndex: 150, padding: '4px 0',
        }}>
          {onCreateTask && (
            <button style={itemStyle} onClick={handle(onCreateTask)}>
              <ClipboardList size={13} color={theme.colors.orange} /> Create Task
            </button>
          )}
          {!repairStatus ? (
            <button style={itemStyle} onClick={() => { setOpen(false); void onRequestRepair(); }}>
              <Wrench size={13} color={theme.colors.orange} />
              {repairRequesting ? 'Requesting…' : 'Request Repair Quote'}
            </button>
          ) : (
            <div style={{ ...itemStyle, cursor: 'default', color: theme.colors.textMuted, fontSize: 11 }}>
              <CheckCircle2 size={13} color="#15803D" />
              Repair: {repairStatus === 'Pending Quote' ? 'Quote Requested' : repairStatus === 'Quote Sent' ? 'Awaiting Response' : repairStatus}
            </div>
          )}
          {onCreateWillCall && (
            <button style={itemStyle} onClick={handle(onCreateWillCall)}>
              <Truck size={13} color={theme.colors.orange} /> Add to Will Call
            </button>
          )}
          {onTransfer && (
            <button style={itemStyle} onClick={handle(onTransfer)}>
              <ExternalLink size={13} color={theme.colors.orange} /> Transfer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Coverage tab (Phase B — data only, no billing write) ───────────────────
//
// Declared value + coverage option picker + computed premium preview. Save
// persists to the Inventory sheet via postUpdateInventoryItem. Phase C will
// add the "Apply Coverage Charge" button + idempotency guard + ledger-based
// lock display on top of this. Until then this tab is a save-and-preview
// surface only — no billing rows are created.
//
// Per-calc_type math:
//   per_lb            → rate × weight (weight not on inventory today; shows
//                       "Weight required" chip and disables Save)
//   percent_declared  → rate% × declaredValue
//   flat              → rate
//   included          → 0

function ItemCoverageTab({
  item, canEdit, optimistic, applyItemPatch, clearItemPatch,
}: {
  item: any;
  canEdit: boolean;
  optimistic: { declaredValue?: number | string; coverageOptionId?: string } | null;
  applyItemPatch?: (itemId: string, patch: Partial<CoverageItemType>) => void;
  clearItemPatch?: (itemId: string) => void;
}) {
  const { options, loading: optionsLoading, error: optionsError } = useCoverageOptions();

  // Prefer optimistic override > item prop > defaults
  const currentDeclared = (optimistic?.declaredValue != null)
    ? Number(optimistic.declaredValue)
    : (item.declaredValue != null ? Number(item.declaredValue) : 0);
  const currentOptionId = (optimistic?.coverageOptionId != null)
    ? String(optimistic.coverageOptionId)
    : String(item.coverageOptionId || '');

  const [declaredInput, setDeclaredInput] = useState<string>(
    currentDeclared > 0 ? String(currentDeclared) : ''
  );
  const [optionId, setOptionId] = useState<string>(currentOptionId);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Keep local state in sync if the item prop changes externally
  useEffect(() => {
    setDeclaredInput(currentDeclared > 0 ? String(currentDeclared) : '');
    setOptionId(currentOptionId);
  }, [item.itemId]);  // eslint-disable-line react-hooks/exhaustive-deps

  const activeOptions = useMemo(
    () => options.filter(o => o.active).sort((a, b) => a.displayOrder - b.displayOrder),
    [options]
  );

  const selectedOption: CoverageOption | null = useMemo(
    () => activeOptions.find(o => o.id === optionId) || null,
    [activeOptions, optionId]
  );

  const declaredValueNum = Number(declaredInput) || 0;

  // Compute premium preview
  const premiumInfo = useMemo(() => {
    if (!selectedOption) return { amount: 0, display: '—', disabledReason: 'Pick a coverage option' };
    switch (selectedOption.calcType) {
      case 'percent_declared': {
        const amt = (declaredValueNum * selectedOption.rate) / 100;
        return {
          amount: amt,
          display: `$${amt.toFixed(2)}`,
          disabledReason: declaredValueNum <= 0 ? 'Enter a declared value' : null,
        };
      }
      case 'flat':
        return { amount: selectedOption.rate, display: `$${selectedOption.rate.toFixed(2)}`, disabledReason: null };
      case 'included':
        return { amount: 0, display: 'Included ($0.00)', disabledReason: null };
      case 'per_lb':
        // Per-weight premium requires item weight which isn't on the
        // inventory schema today. Show a clear disabled reason so the user
        // knows this is expected rather than a bug.
        return { amount: 0, display: '—', disabledReason: 'Per-pound coverage requires item weight (not yet tracked)' };
      default:
        return { amount: 0, display: '—', disabledReason: 'Unknown calc type' };
    }
  }, [selectedOption, declaredValueNum]);

  const isDirty = declaredValueNum !== currentDeclared || optionId !== currentOptionId;
  const canSave = canEdit && isDirty && !saving;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaveError(null);
    setSaveSuccess(false);
    setSaving(true);

    // Optimistic patch so the UI reflects instantly
    applyItemPatch?.(item.itemId, {
      declaredValue: declaredValueNum,
      coverageOptionId: optionId,
    } as any);

    try {
      const resp = await postUpdateInventoryItem({
        itemId: item.itemId,
        declaredValue: declaredValueNum,
        coverageOptionId: optionId,
      }, item.clientSheetId || item.clientId);
      if (resp.ok && resp.data?.success) {
        setSaveSuccess(true);
        // Patch stays — 120s TTL will align with next refetch
        setTimeout(() => setSaveSuccess(false), 2500);
      } else {
        clearItemPatch?.(item.itemId);
        setSaveError(resp.error || resp.data?.error || 'Save failed.');
      }
    } catch (err: any) {
      clearItemPatch?.(item.itemId);
      setSaveError(err?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }, [canSave, item.itemId, item.clientSheetId, item.clientId, declaredValueNum, optionId, applyItemPatch, clearItemPatch]);

  // ── Render ──────────────────────────────────────────────────────────

  if (optionsLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40, color: theme.colors.textMuted, fontSize: 13 }}>
        Loading coverage options…
      </div>
    );
  }
  if (optionsError) {
    return (
      <div style={{ padding: 20, fontSize: 13, color: '#991B1B', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10 }}>
        Could not load coverage options: {optionsError}
      </div>
    );
  }

  const inputBaseStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    fontSize: 13,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: 8,
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Intro */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: theme.colors.bgSubtle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Shield size={18} color={theme.colors.orange} />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: theme.colors.text }}>Item Coverage</div>
          <div style={{ fontSize: 11, color: theme.colors.textMuted }}>
            Declared value + coverage option. Billing action ships in a follow-up.
          </div>
        </div>
      </div>

      {/* Declared value */}
      <div>
        <label style={{ display: 'block', fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
          Declared Value
        </label>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: theme.colors.textMuted, fontSize: 13 }}>$</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={declaredInput}
            onChange={e => setDeclaredInput(e.target.value)}
            disabled={!canEdit || saving}
            placeholder="0.00"
            style={{ ...inputBaseStyle, paddingLeft: 22 }}
          />
        </div>
      </div>

      {/* Coverage option picker */}
      <div>
        <label style={{ display: 'block', fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
          Coverage Option
        </label>
        <AutocompleteSelect
          options={activeOptions.map(o => ({ value: o.id, label: `${o.name} — ${formatCoverageRate(o)}` }))}
          value={optionId}
          onChange={setOptionId}
          placeholder="Pick a coverage option…"
          disabled={!canEdit || saving}
        />
        {selectedOption?.note && (
          <div style={{ marginTop: 6, fontSize: 11, color: theme.colors.textMuted, fontStyle: 'italic' }}>
            {selectedOption.note}
          </div>
        )}
      </div>

      {/* Premium preview */}
      <div style={{
        padding: '14px 16px',
        background: theme.colors.bgSubtle,
        borderRadius: 12,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Computed Premium
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: premiumInfo.disabledReason ? theme.colors.textMuted : theme.colors.text, marginTop: 2 }}>
            {premiumInfo.display}
          </div>
          {premiumInfo.disabledReason && (
            <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 4 }}>
              {premiumInfo.disabledReason}
            </div>
          )}
        </div>
      </div>

      {/* Save row */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          onClick={handleSave}
          disabled={!canSave}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 16px',
            fontSize: 12, fontWeight: 600,
            borderRadius: 8,
            border: 'none',
            background: canSave ? theme.colors.orange : theme.colors.bgSubtle,
            color: canSave ? '#fff' : theme.colors.textMuted,
            cursor: canSave ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
          }}
        >
          {saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />}
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saveSuccess && (
          <span style={{ fontSize: 12, color: '#15803D', fontWeight: 500 }}>
            ✓ Saved
          </span>
        )}
        {saveError && (
          <span style={{ fontSize: 12, color: '#DC2626', fontWeight: 500 }}>
            {saveError}
          </span>
        )}
      </div>

      {/* Phase C pointer */}
      <div style={{
        marginTop: 4, padding: '10px 12px',
        background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8,
        fontSize: 11, color: '#92400E',
      }}>
        Phase B: save-and-preview only. Billing isn't created yet — the
        "Apply Coverage Charge" action lands in a follow-up release.
      </div>
    </div>
  );
}
