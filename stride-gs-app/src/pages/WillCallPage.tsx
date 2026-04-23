import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, SearchX, ShieldX, ExternalLink, DollarSign } from 'lucide-react';
import { theme } from '../styles/theme';
import { useWillCallDetail } from '../hooks/useWillCallDetail';
import { EntityPage, EPCard, EPLabel, EPFooterButton, EntityPageTokens } from '../components/shared/EntityPage';
import { EntityHistory } from '../components/shared/EntityHistory';
import { fmtDate } from '../lib/constants';
import type { ApiWCItem } from '../lib/api';

// ── Status badge ──────────────────────────────────────────────────────────────

const WC_STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  'Pending':   { bg: theme.colors.statusAmberBg,  color: theme.colors.statusAmber },
  'Scheduled': { bg: theme.colors.statusBlueBg,   color: theme.colors.statusBlue },
  'Partial':   { bg: theme.colors.statusBlueBg,   color: theme.colors.statusBlue },
  'Released':  { bg: theme.colors.statusGreenBg,  color: theme.colors.statusGreen },
  'Cancelled': { bg: theme.colors.statusGrayBg,   color: theme.colors.statusGray },
};

function StatusBadge({ status }: { status: string }) {
  const c = WC_STATUS_COLORS[status] ?? { bg: theme.colors.statusGrayBg, color: theme.colors.statusGray };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: theme.radii.full,
      background: c.bg, color: c.color,
      fontSize: theme.typography.sizes.xs, fontWeight: theme.typography.weights.semibold,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
      {status}
    </span>
  );
}

// ── Activity tab ──────────────────────────────────────────────────────────────

const ACTIVITY_FILTERS = [
  { label: 'All',        actions: [] },
  { label: 'Scheduling', actions: ['create', 'update', 'assign'] },
  { label: 'Documents',  actions: ['update'] },
  { label: 'Release',    actions: ['release', 'complete'] },
  { label: 'Notes',      actions: ['update'] },
];

function ActivityTab({ entityId, tenantId }: { entityId: string; tenantId?: string }) {
  const [activeFilter, setActiveFilter] = useState(0);
  const currentFilter = ACTIVITY_FILTERS[activeFilter];
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14 }}>
        {ACTIVITY_FILTERS.map((f, i) => {
          const isActive = i === activeFilter;
          return (
            <button
              key={f.label + i}
              onClick={() => setActiveFilter(i)}
              style={{
                padding: `4px ${theme.spacing.md}`,
                borderRadius: theme.radii.full,
                border: 'none', fontFamily: 'inherit',
                fontSize: theme.typography.sizes.xs,
                fontWeight: theme.typography.weights.semibold,
                cursor: 'pointer',
                background: isActive ? EntityPageTokens.tabActive : theme.colors.bgSubtle,
                color: isActive ? '#fff' : theme.colors.textSecondary,
                transition: `background ${theme.transitions.fast}, color ${theme.transitions.fast}`,
              }}
            >{f.label}</button>
          );
        })}
      </div>
      <EPCard style={{ padding: '8px 14px' }}>
        <EntityHistory
          entityType="will_call"
          entityId={entityId}
          tenantId={tenantId}
          defaultExpanded
          actionFilter={currentFilter.actions.length > 0 ? currentFilter.actions : undefined}
        />
      </EPCard>
    </div>
  );
}

// ── COD badge with pulse animation ───────────────────────────────────────────

function CodBadge({ amount }: { amount?: number | null }) {
  return (
    <>
      <style>{`
        @keyframes wc-cod-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.75; transform: scale(1.04); }
        }
      `}</style>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 10px', borderRadius: theme.radii.full,
        background: theme.colors.statusAmberBg, color: theme.colors.statusAmber,
        fontSize: theme.typography.sizes.xs, fontWeight: theme.typography.weights.semibold,
        animation: 'wc-cod-pulse 2s ease-in-out infinite',
        cursor: 'default',
      }}>
        <DollarSign size={11} />
        COD{amount != null ? ` · $${Number(amount).toFixed(2)}` : ''}
      </span>
    </>
  );
}

// ── Items table ───────────────────────────────────────────────────────────────

function ItemsTable({ items, onNavigateToItem }: { items: ApiWCItem[]; onNavigateToItem: (id: string) => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  if (!items.length) {
    return <div style={{ fontSize: 13, color: theme.colors.textMuted, padding: '12px 0' }}>No items on this will call.</div>;
  }

  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map(i => i.itemId)));
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${theme.colors.borderLight}` }}>
            <th style={{ width: 32, padding: '6px 8px', textAlign: 'center' }}>
              <input
                type="checkbox"
                checked={selected.size === items.length && items.length > 0}
                onChange={toggleAll}
                style={{ cursor: 'pointer' }}
              />
            </th>
            {['Item ID', 'Description', 'Vendor', 'Class', 'Location', 'Sidemark', 'Qty', 'Status'].map(h => (
              <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: theme.colors.orange, textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.itemId}
              style={{ borderBottom: `1px solid ${theme.colors.borderLight}`, background: selected.has(item.itemId) ? theme.colors.bgSubtle : 'transparent' }}
            >
              <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={selected.has(item.itemId)}
                  onChange={() => {
                    const next = new Set(selected);
                    if (next.has(item.itemId)) next.delete(item.itemId);
                    else next.add(item.itemId);
                    setSelected(next);
                  }}
                  style={{ cursor: 'pointer' }}
                />
              </td>
              <td style={{ padding: '6px 8px' }}>
                <button
                  onClick={() => onNavigateToItem(item.itemId)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: theme.colors.orange, display: 'inline-flex', alignItems: 'center', gap: 3 }}
                >
                  {item.itemId}
                  <ExternalLink size={10} />
                </button>
              </td>
              <td style={{ padding: '6px 8px', color: theme.colors.text, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description || '—'}</td>
              <td style={{ padding: '6px 8px', color: theme.colors.textSecondary }}>{item.vendor || '—'}</td>
              <td style={{ padding: '6px 8px', color: theme.colors.textSecondary }}>{item.itemClass || '—'}</td>
              <td style={{ padding: '6px 8px', color: theme.colors.textSecondary }}>{item.location || '—'}</td>
              <td style={{ padding: '6px 8px', color: theme.colors.textSecondary }}>{item.sidemark || '—'}</td>
              <td style={{ padding: '6px 8px', color: theme.colors.text, fontWeight: 600 }}>{item.qty ?? 1}</td>
              <td style={{ padding: '6px 8px' }}>
                {item.released ? (
                  <span style={{ fontSize: 11, fontWeight: 700, color: theme.colors.statusGreen, background: theme.colors.statusGreenBg, padding: '2px 7px', borderRadius: theme.radii.full }}>Released</span>
                ) : (
                  <span style={{ fontSize: 11, fontWeight: 700, color: theme.colors.textMuted, background: theme.colors.bgSubtle, padding: '2px 7px', borderRadius: theme.radii.full }}>Pending</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Details tab ───────────────────────────────────────────────────────────────

function DetailsTab({ wc, onNavigateToItem }: { wc: NonNullable<ReturnType<typeof useWillCallDetail>['wc']>; onNavigateToItem: (id: string) => void }) {
  return (
    <div>
      {/* Pickup overview */}
      <EPCard>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 24px' }}>
          <Field label="Pickup Party"    value={wc.pickupParty} />
          <Field label="Phone"           value={wc.pickupPhone} />
          <Field label="Scheduled Date"  value={wc.estimatedPickupDate ? fmtDate(wc.estimatedPickupDate) : undefined} />
          <Field label="Items Count"     value={String(wc.itemsCount ?? wc.items?.length ?? 0)} />
        </div>
        {wc.notes && (
          <div style={{ marginTop: 14 }}>
            <EPLabel>Notes</EPLabel>
            <div style={{ fontSize: 13, color: '#333', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{wc.notes}</div>
          </div>
        )}
      </EPCard>

      {/* Items table */}
      <EPCard>
        <EPLabel>Items ({wc.items?.length ?? 0})</EPLabel>
        <div style={{ marginTop: 8 }}>
          <ItemsTable items={wc.items ?? []} onNavigateToItem={onNavigateToItem} />
        </div>
      </EPCard>

      {/* Drive folder */}
      {wc.wcFolderUrl && (
        <EPCard>
          <a
            href={wc.wcFolderUrl}
            target="_blank"
            rel="noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: theme.typography.sizes.sm, color: theme.colors.orange, fontWeight: theme.typography.weights.medium, textDecoration: 'none' }}
          >
            <ExternalLink size={13} />
            View Will Call Folder in Drive
          </a>
        </EPCard>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <EPLabel>{label}</EPLabel>
      <div style={{ fontSize: theme.typography.sizes.base, color: value ? theme.colors.text : theme.colors.textMuted, fontWeight: value ? theme.typography.weights.medium : theme.typography.weights.normal }}>
        {value || '—'}
      </div>
    </div>
  );
}

// ── Loading / error states ────────────────────────────────────────────────────

function PageState({ icon: Icon, color, title, body, actions }: {
  icon: React.ComponentType<{ size: number; color?: string }>;
  color: string; title: string; body: string; actions?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, padding: 32, textAlign: 'center' }}>
      <Icon size={48} color={color} />
      <div style={{ fontSize: 18, fontWeight: 600, color: theme.colors.text }}>{title}</div>
      <div style={{ fontSize: 14, color: theme.colors.textMuted, maxWidth: 400 }}>{body}</div>
      {actions}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function WillCallPage() {
  const { wcId } = useParams<{ wcId: string }>();
  const navigate = useNavigate();
  const { wc, status, error, refetch } = useWillCallDetail(wcId);

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: theme.colors.textMuted }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 14 }}>Loading will call{wcId ? ` ${wcId}` : ''}…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (status === 'access-denied') {
    return <PageState icon={ShieldX} color={theme.colors.statusRed} title="Access Denied" body="You don't have permission to view this will call." actions={<button onClick={() => navigate(-1)} style={backBtnStyle}>Go Back</button>} />;
  }

  if (status === 'not-found') {
    return <PageState icon={SearchX} color={theme.colors.textMuted} title="Will Call Not Found" body={`No will call with ID "${wcId}" was found.`} actions={<button onClick={() => navigate('/will-calls')} style={backBtnStyle}>Back to Will Calls</button>} />;
  }

  if (status === 'error') {
    return (
      <PageState icon={AlertCircle} color={theme.colors.statusRed} title="Failed to Load Will Call" body={error || 'An unexpected error occurred.'}
        actions={<div style={{ display: 'flex', gap: 12 }}><button onClick={refetch} style={{ ...backBtnStyle, color: theme.colors.primary }}>Retry</button><button onClick={() => navigate('/will-calls')} style={backBtnStyle}>Back to Will Calls</button></div>}
      />
    );
  }

  if (!wc) return null;

  const s = wc.status;
  const footer = (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {wc.cod && <CodBadge amount={wc.codAmount} />}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {s === 'Pending' && (
          <EPFooterButton label="Schedule" variant="primary" />
        )}
        {s === 'Scheduled' && (
          <EPFooterButton label="Release Items" variant="primary" />
        )}
        {s === 'Partial' && (
          <EPFooterButton label="Release Remaining" variant="primary" />
        )}
      </div>
    </>
  );

  const tabs = [
    { id: 'details',  label: 'Details', keepMounted: true, render: () => <DetailsTab wc={wc} onNavigateToItem={(id) => navigate(`/inventory/${id}`)} /> },
    { id: 'photos',   label: 'Photos' },
    { id: 'docs',     label: 'Docs' },
    { id: 'notes',    label: 'Notes' },
    { id: 'activity', label: 'Activity' },
  ];

  return (
    <EntityPage
      entityLabel="Will Call"
      entityId={wc.wcNumber}
      statusBadge={<StatusBadge status={wc.status} />}
      clientName={wc.clientName}
      sidemark={undefined}
      metaPills={
        wc.pickupParty ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: `2px ${theme.spacing.sm}`, borderRadius: theme.radii.md, background: theme.colors.bgSubtle, fontSize: theme.typography.sizes.xs, color: theme.colors.textSecondary, fontWeight: theme.typography.weights.medium }}>
            <span style={{ fontSize: 9, fontWeight: theme.typography.weights.semibold, color: EntityPageTokens.labelColor, textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>Pickup</span>
            {wc.pickupParty}
          </span>
        ) : undefined
      }
      tabs={tabs}
      builtInTabs={{
        photos: { entityType: 'will_call', entityId: wc.wcNumber, tenantId: wc.clientSheetId },
        docs:   { contextType: 'willcall', contextId: wc.wcNumber, tenantId: wc.clientSheetId },
        notes:  { entityType: 'will_call', entityId: wc.wcNumber },
        activity: { render: () => <ActivityTab entityId={wc.wcNumber} tenantId={wc.clientSheetId} /> },
      }}
      footer={footer}
    />
  );
}

const backBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: `${theme.spacing.sm} ${theme.spacing.lg}`, borderRadius: theme.radii.lg,
  border: `1px solid ${theme.colors.border}`,
  background: theme.colors.bgCard, color: theme.colors.text,
  fontSize: theme.typography.sizes.base, fontWeight: theme.typography.weights.medium,
  cursor: 'pointer', fontFamily: 'inherit',
};
