import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, SearchX, ShieldX, ExternalLink, Wrench } from 'lucide-react';
import { theme } from '../styles/theme';
import { useRepairDetail } from '../hooks/useRepairDetail';
import { EntityPage, EPCard, EPLabel, EPFooterButton, EntityPageTokens } from '../components/shared/EntityPage';
import { EntityHistory } from '../components/shared/EntityHistory';
import { fmtDate } from '../lib/constants';

// ── Status badge ──────────────────────────────────────────────────────────────

const REPAIR_STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  'Pending Quote': { bg: theme.colors.statusAmberBg,  color: theme.colors.statusAmber },
  'Quote Sent':    { bg: theme.colors.statusBlueBg,   color: theme.colors.statusBlue },
  'Approved':      { bg: theme.colors.statusGreenBg,  color: theme.colors.statusGreen },
  'Declined':      { bg: theme.colors.statusRedBg,    color: theme.colors.statusRed },
  'In Progress':   { bg: theme.colors.statusBlueBg,   color: theme.colors.statusBlue },
  'Complete':      { bg: theme.colors.statusGreenBg,  color: theme.colors.statusGreen },
  'Failed':        { bg: theme.colors.statusRedBg,    color: theme.colors.statusRed },
  'Cancelled':     { bg: theme.colors.statusGrayBg,   color: theme.colors.statusGray },
};

function StatusBadge({ status }: { status: string }) {
  const c = REPAIR_STATUS_COLORS[status] ?? { bg: theme.colors.statusGrayBg, color: theme.colors.statusGray };
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
  { label: 'All',            actions: [] },
  { label: 'Status Changes', actions: ['status_change', 'start', 'complete', 'cancel'] },
  { label: 'Quotes',         actions: ['update'] },
  { label: 'Notes',          actions: ['update'] },
  { label: 'Billing',        actions: ['create'] },
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
          entityType="repair"
          entityId={entityId}
          tenantId={tenantId}
          defaultExpanded
          actionFilter={currentFilter.actions.length > 0 ? currentFilter.actions : undefined}
        />
      </EPCard>
    </div>
  );
}

// ── Details tab ───────────────────────────────────────────────────────────────

function DetailsTab({ repair, onNavigateToItem }: { repair: NonNullable<ReturnType<typeof useRepairDetail>['repair']>; onNavigateToItem: (id: string) => void }) {
  const showQuote = repair.status === 'Quote Sent' || repair.status === 'Approved' || repair.status === 'Declined';

  return (
    <div>
      {/* Item info card */}
      <EPCard>
        <EPLabel>Linked Item</EPLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 24px', marginTop: 4 }}>
          <div>
            <EPLabel>Item ID</EPLabel>
            {repair.itemId ? (
              <button
                onClick={() => onNavigateToItem(repair.itemId!)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: 0, fontFamily: 'inherit',
                  fontSize: theme.typography.sizes.base,
                  fontWeight: theme.typography.weights.semibold,
                  color: theme.colors.orange,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >
                {repair.itemId}
                <ExternalLink size={11} />
              </button>
            ) : (
              <span style={{ fontSize: theme.typography.sizes.base, color: theme.colors.textMuted }}>—</span>
            )}
          </div>
          <Field label="Vendor"      value={repair.vendor} />
          <Field label="Description" value={repair.description} />
          <Field label="Class"       value={repair.itemClass} />
          <Field label="Location"    value={repair.location} />
          <Field label="Sidemark"    value={repair.sidemark} />
        </div>
      </EPCard>

      {/* Repair details */}
      <EPCard>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 24px' }}>
          <Field label="Repair Vendor"  value={repair.repairVendor} />
          <Field label="Created By"     value={repair.createdBy} />
          <Field label="Created"        value={fmtDate(repair.createdDate)} />
          {repair.scheduledDate && <Field label="Scheduled"  value={fmtDate(repair.scheduledDate)} />}
          {repair.startDate     && <Field label="Started"    value={fmtDate(repair.startDate)} />}
          {repair.completedDate && <Field label="Completed"  value={fmtDate(repair.completedDate)} />}
          {repair.sourceTaskId  && <Field label="Source Task" value={repair.sourceTaskId} />}
        </div>
      </EPCard>

      {/* Quote review — shown when a quote exists */}
      {showQuote && (
        <EPCard>
          <EPLabel>Quote</EPLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 24px', marginTop: 4 }}>
            {repair.quoteAmount != null && (
              <div>
                <EPLabel>Amount</EPLabel>
                <div style={{ fontSize: theme.typography.sizes.base, fontWeight: theme.typography.weights.semibold, color: theme.colors.text }}>
                  ${Number(repair.quoteAmount).toFixed(2)}
                </div>
              </div>
            )}
            {repair.quoteSentDate && <Field label="Sent Date" value={fmtDate(repair.quoteSentDate)} />}
          </div>
          {repair.status === 'Declined' && (
            <div style={{ marginTop: 10, padding: '6px 10px', borderRadius: theme.radii.md, background: theme.colors.statusRedBg, color: theme.colors.statusRed, fontSize: theme.typography.sizes.xs, fontWeight: theme.typography.weights.semibold }}>
              Quote declined
            </div>
          )}
          {repair.status === 'Approved' && (
            <div style={{ marginTop: 10, padding: '6px 10px', borderRadius: theme.radii.md, background: theme.colors.statusGreenBg, color: theme.colors.statusGreen, fontSize: theme.typography.sizes.xs, fontWeight: theme.typography.weights.semibold }}>
              Quote approved
            </div>
          )}
        </EPCard>
      )}

      {/* Repair notes */}
      {repair.repairNotes && (
        <EPCard>
          <EPLabel>Repair Notes</EPLabel>
          <div style={{ fontSize: 13, color: '#333', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{repair.repairNotes}</div>
        </EPCard>
      )}

      {/* Drive folder */}
      {repair.repairFolderUrl && (
        <EPCard>
          <a
            href={repair.repairFolderUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: theme.typography.sizes.sm,
              color: theme.colors.orange, fontWeight: theme.typography.weights.medium,
              textDecoration: 'none',
            }}
          >
            <ExternalLink size={13} />
            View Repair Folder in Drive
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

export function RepairPage() {
  const { repairId } = useParams<{ repairId: string }>();
  const navigate = useNavigate();
  const { repair, status, error, refetch } = useRepairDetail(repairId);

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: theme.colors.textMuted }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 14 }}>Loading repair{repairId ? ` ${repairId}` : ''}…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (status === 'access-denied') {
    return <PageState icon={ShieldX} color={theme.colors.statusRed} title="Access Denied" body="You don't have permission to view this repair." actions={<button onClick={() => navigate(-1)} style={backBtnStyle}>Go Back</button>} />;
  }

  if (status === 'not-found') {
    return <PageState icon={SearchX} color={theme.colors.textMuted} title="Repair Not Found" body={`No repair with ID "${repairId}" was found.`} actions={<button onClick={() => navigate('/repairs')} style={backBtnStyle}>Back to Repairs</button>} />;
  }

  if (status === 'error') {
    return (
      <PageState icon={AlertCircle} color={theme.colors.statusRed} title="Failed to Load Repair" body={error || 'An unexpected error occurred.'}
        actions={<div style={{ display: 'flex', gap: 12 }}><button onClick={refetch} style={{ ...backBtnStyle, color: theme.colors.primary }}>Retry</button><button onClick={() => navigate('/repairs')} style={backBtnStyle}>Back to Repairs</button></div>}
      />
    );
  }

  if (!repair) return null;

  // ── State-aware footer ──
  const s = repair.status;
  const footer = (
    <>
      <div style={{ display: 'flex', gap: 8 }}>
        <EPFooterButton
          label="View Item"
          variant="secondary"
          icon={<Wrench size={13} />}
          onClick={() => repair.itemId && navigate(`/inventory/${repair.itemId}`)}
          disabled={!repair.itemId}
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {s === 'Pending Quote' && (
          <EPFooterButton label="Send Quote" variant="primary" />
        )}
        {s === 'Quote Sent' && (
          <>
            <EPFooterButton label="Decline" variant="secondary" />
            <EPFooterButton label="Approve Quote" variant="primary" />
          </>
        )}
        {s === 'Approved' && (
          <EPFooterButton label="Start Repair" variant="primary" />
        )}
        {s === 'In Progress' && (
          <>
            <EPFooterButton label="Fail" variant="secondary" />
            <EPFooterButton label="Complete" variant="primary" />
          </>
        )}
        {(s === 'Complete' || s === 'Failed') && (
          <EPFooterButton label="Correct Result" variant="secondary" />
        )}
      </div>
    </>
  );

  const tabs = [
    { id: 'details',  label: 'Details', keepMounted: true, render: () => <DetailsTab repair={repair} onNavigateToItem={(id) => navigate(`/inventory/${id}`)} /> },
    { id: 'photos',   label: 'Photos' },
    { id: 'docs',     label: 'Docs' },
    { id: 'notes',    label: 'Notes' },
    { id: 'activity', label: 'Activity' },
  ];

  return (
    <EntityPage
      entityLabel="Repair"
      entityId={repair.repairId}
      statusBadge={<StatusBadge status={repair.status} />}
      clientName={repair.clientName}
      sidemark={repair.sidemark}
      metaPills={
        repair.repairVendor ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: `2px ${theme.spacing.sm}`, borderRadius: theme.radii.md, background: theme.colors.bgSubtle, fontSize: theme.typography.sizes.xs, color: theme.colors.textSecondary, fontWeight: theme.typography.weights.medium }}>
            <span style={{ fontSize: 9, fontWeight: theme.typography.weights.semibold, color: EntityPageTokens.labelColor, textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>Vendor</span>
            {repair.repairVendor}
          </span>
        ) : undefined
      }
      tabs={tabs}
      builtInTabs={{
        photos: { entityType: 'repair', entityId: repair.repairId, tenantId: repair.clientSheetId },
        docs:   { contextType: 'repair', contextId: repair.repairId, tenantId: repair.clientSheetId },
        notes:  { entityType: 'repair', entityId: repair.repairId, itemId: repair.itemId },
        activity: { render: () => <ActivityTab entityId={repair.repairId} tenantId={repair.clientSheetId} /> },
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
