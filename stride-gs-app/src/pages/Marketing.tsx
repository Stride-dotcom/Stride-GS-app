import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  RefreshCw, Search, Download, ChevronLeft, ChevronRight,
  Play, Pause, CheckCircle2, Trash2, Send, Eye,
  Plus, Upload, X, Edit3, Ban, RotateCcw, Inbox,
} from 'lucide-react';
import { theme } from '../styles/theme';
import { useApiData } from '../hooks/useApiData';
import { useIsMobile } from '../hooks/useIsMobile';
import { ProcessingOverlay } from '../components/shared/ProcessingOverlay';
import { InfoTooltip } from '../components/shared/InfoTooltip';
import { fmtDate } from '../lib/constants';
import { setNextFetchNoCache } from '../lib/api';
import type {
  MarketingCampaign, MarketingContact, MarketingTemplate,
  CampaignContact, CampaignLogEntry, SuppressionLogEntry,
  DashboardCampaignRow, DashboardStats, MarketingSettings,
  CreateCampaignPayload, CreateContactPayload, CreateTemplatePayload,
  ContactStatus,
} from '../lib/api';
import {
  fetchMarketingDashboard, fetchMarketingCampaigns,
  fetchMarketingCampaignDetail, fetchMarketingContacts,
  fetchMarketingContactDetail, fetchMarketingTemplates,
  fetchMarketingLogs, fetchMarketingSuppressionLogs,
  fetchMarketingSettings,
  postCreateMarketingCampaign, postUpdateMarketingCampaign,
  postActivateCampaign, postPauseCampaign, postCompleteCampaign,
  postRunCampaignNow, postDeleteCampaign,
  postCreateMarketingContact, postImportMarketingContacts,
  postUpdateMarketingContact, postSuppressContact, postUnsuppressContact,
  postCreateMarketingTemplate, postUpdateMarketingTemplate,
  postUpdateMarketingSettings,
  postSendTestEmail, postPreviewTemplate, postCheckMarketingInbox,
} from '../lib/api';
import {
  fetchMarketingContactsFromSupabase,
  fetchMarketingCampaignsFromSupabase,
  fetchMarketingTemplatesFromSupabase,
  fetchMarketingSettingsFromSupabase,
  fetchMarketingDashboardFromSupabase,
} from '../lib/supabaseQueries';

// ─── Status badge colors ────────────────────────────────────────────────────

const CAMPAIGN_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  Active: { bg: '#F0FDF4', text: '#15803D' },
  Draft: { bg: '#FEF3C7', text: '#B45309' },
  Paused: { bg: '#EFF6FF', text: '#1D4ED8' },
  Complete: { bg: '#F3F4F6', text: '#6B7280' },
};

const CAMPAIGN_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  Blast: { bg: '#EFF6FF', text: '#1D4ED8' },
  Sequence: { bg: '#FFF7ED', text: '#E85D2D' },
};

const CONTACT_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  Pending: { bg: '#FEF3C7', text: '#B45309' },
  Client: { bg: '#F0FDF4', text: '#15803D' },
  Suppressed: { bg: '#FEF2F2', text: '#DC2626' },
};

const LOG_RESULT_COLORS: Record<string, { bg: string; text: string }> = {
  Success: { bg: '#F0FDF4', text: '#15803D' },
  Sent: { bg: '#F0FDF4', text: '#15803D' },
  Failed: { bg: '#FEF2F2', text: '#DC2626' },
  Skipped: { bg: '#FEF3C7', text: '#B45309' },
};

const CC_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  Pending: { bg: '#FEF3C7', text: '#B45309' },
  Sent: { bg: '#EFF6FF', text: '#1D4ED8' },
  'Follow-Up Scheduled': { bg: '#FFF7ED', text: '#E85D2D' },
  Replied: { bg: '#F0FDF4', text: '#15803D' },
  Bounced: { bg: '#FEF2F2', text: '#DC2626' },
  Unsubscribed: { bg: '#F3F4F6', text: '#6B7280' },
  Exhausted: { bg: '#F3F4F6', text: '#6B7280' },
  Complete: { bg: '#F0FDF4', text: '#15803D' },
};

// ─── Shared components ──────────────────────────────────────────────────────

function Badge({ label, colors }: { label: string; colors?: { bg: string; text: string } }) {
  const c = colors || { bg: '#F3F4F6', text: '#6B7280' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11,
      fontWeight: 600, letterSpacing: '0.02em', background: c.bg, color: c.text, whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

function StatCard({ label, value, color, sub }: { label: string; value: string | number; color?: string; sub?: string }) {
  return (
    <div style={{
      background: theme.colors.bgCard, border: `1px solid ${theme.colors.border}`,
      borderRadius: 12, padding: 14, minWidth: 0,
    }}>
      <div style={{ fontSize: 10, color: theme.colors.textMuted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || theme.colors.text }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: theme.colors.textMuted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
      <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite', color: theme.colors.textMuted }} />
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@media (max-width: 767px) { .mktg-form-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <div style={{ padding: 24, color: theme.colors.statusRed, fontSize: 13 }}>Error: {msg}</div>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div style={{ padding: 48, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>{msg}</div>
  );
}

function ActionBtn({ label, icon, onClick, disabled, variant = 'default' }: {
  label: string; icon?: React.ReactNode; onClick: () => void;
  disabled?: boolean; variant?: 'default' | 'primary' | 'danger';
}) {
  const styles: Record<string, React.CSSProperties> = {
    default: {
      border: `1px solid ${theme.colors.border}`, background: theme.colors.bgCard, color: theme.colors.text,
    },
    primary: {
      border: `1px solid ${theme.colors.primary}`, background: theme.colors.primary, color: '#fff',
    },
    danger: {
      border: '1px solid #DC2626', background: theme.colors.bgCard, color: '#DC2626',
    },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '8px 16px', fontSize: 12, fontWeight: 600, borderRadius: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: theme.typography.fontFamily,
        ...styles[variant],
      }}
    >{icon}{label}</button>
  );
}

function ResultBanner({ result, onDismiss }: { result: { ok: boolean; message: string }; onDismiss: () => void }) {
  return (
    <div style={{
      padding: '10px 16px', borderRadius: 8, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8,
      background: result.ok ? '#F0FDF4' : '#FEF2F2',
      border: `1px solid ${result.ok ? '#BBF7D0' : '#FECACA'}`,
      color: result.ok ? '#15803D' : '#DC2626',
      fontSize: 12, fontWeight: 500,
    }}>
      <span style={{ flex: 1 }}>{result.message}</span>
      <button onClick={onDismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>
        <X size={14} />
      </button>
    </div>
  );
}

function ConfirmDialog({ title, message, onConfirm, onCancel, confirmLabel, danger, busy }: {
  title: string; message: string; onConfirm: () => void; onCancel: () => void;
  confirmLabel?: string; danger?: boolean; busy?: boolean;
}) {
  const { isMobile } = useIsMobile();
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? 16 : 0,
    }} onClick={onCancel}>
      <div style={{
        position: 'relative',
        background: '#fff', borderRadius: 12, padding: isMobile ? 20 : 24,
        maxWidth: 400, width: '100%',
        boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
      }} onClick={e => e.stopPropagation()}>
        <ProcessingOverlay visible={!!busy} />
        <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700 }}>{title}</h3>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: theme.colors.textMuted }}>{message}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <ActionBtn label="Cancel" onClick={onCancel} disabled={busy} />
          <ActionBtn label={confirmLabel || 'Confirm'} onClick={onConfirm} variant={danger ? 'danger' : 'primary'} disabled={busy} />
        </div>
      </div>
    </div>
  );
}

function FormField({ label, children, info }: { label: string; children: React.ReactNode; info?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: theme.colors.textMuted, display: 'flex', alignItems: 'center', marginBottom: 4 }}>
        <span>{label}</span>
        {info && <InfoTooltip text={info} />}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px', border: `1px solid ${theme.colors.border}`, borderRadius: 8,
  fontSize: 12, width: '100%', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' };

// ─── Modal wrapper ──────────────────────────────────────────────────────────

function Modal({ title, onClose, children, width, busy }: { title: string; onClose: () => void; children: React.ReactNode; width?: number; busy?: boolean }) {
  const { isMobile } = useIsMobile();
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
      display: 'flex', alignItems: isMobile ? 'flex-end' : 'flex-start', justifyContent: 'center',
      paddingTop: isMobile ? 0 : 20, overflowY: 'auto',
    }} onClick={onClose}>
      <div style={{
        position: 'relative',
        background: '#fff', borderRadius: isMobile ? '16px 16px 0 0' : 12,
        padding: isMobile ? '20px 16px' : 24,
        maxWidth: isMobile ? '100%' : (width || 520), width: '100%',
        maxHeight: isMobile ? '90dvh' : '92vh', overflowY: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.15)', marginBottom: isMobile ? 0 : 20,
        resize: isMobile ? undefined : 'both', minWidth: isMobile ? undefined : 360, minHeight: isMobile ? undefined : 200,
      }} onClick={e => e.stopPropagation()}>
        <ProcessingOverlay visible={!!busy} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.colors.textMuted }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Tab type ───────────────────────────────────────────────────────────────

type TabId = 'dashboard' | 'campaigns' | 'contacts' | 'templates' | 'logs' | 'settings';

const TABS: { id: TabId; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'templates', label: 'Templates' },
  { id: 'logs', label: 'Logs' },
  { id: 'settings', label: 'Settings' },
];

// ─── Merge tokens ───────────────────────────────────────────────────────────

const MERGE_TOKENS = [
  '{{First Name}}', '{{Last Name}}', '{{Full Name}}', '{{Company}}', '{{Email}}',
  '{{BookingURL}}', '{{UNSUB_URL}}', '{{Sender Name}}', '{{Sender Phone}}',
  '{{Sender Email}}', '{{Website URL}}', '{{Current Year}}',
  '{{Custom 1}}', '{{Custom 2}}', '{{Custom 3}}',
];

// ─── Helper: format date/time for display ───────────────────────────────────

function fmtDateTime(d?: string | null): string {
  if (!d) return '\u2014';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return fmtDate(d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) + ' ' +
    dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function pct(num: number, denom: number): string {
  if (!denom) return '0%';
  return (num / denom * 100).toFixed(1) + '%';
}

// ─── CSV export helper ──────────────────────────────────────────────────────

function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => {
    const v = String(r[h] ?? '');
    return v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── Shared hook for write actions ──────────────────────────────────────────

function useWriteAction() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const run = useCallback(async <T,>(
    fn: () => Promise<{ data: T | null; error: string | null; ok: boolean }>,
    successMsg?: string,
  ): Promise<{ ok: boolean; data: T | null }> => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fn();
      if (res.ok) {
        setResult({ ok: true, message: successMsg || 'Success' });
        return { ok: true, data: res.data };
      } else {
        setResult({ ok: false, message: res.error || 'Operation failed' });
        return { ok: false, data: null };
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unexpected error';
      setResult({ ok: false, message: msg });
      return { ok: false, data: null };
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, result, setResult, run };
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

export function Marketing() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [selectedContactEmail, setSelectedContactEmail] = useState<string | null>(null);
  const [showCreateCampaign, setShowCreateCampaign] = useState(false);
  const [showCreateContact, setShowCreateContact] = useState(false);
  const [showImportContacts, setShowImportContacts] = useState(false);
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);

  // Template list — lifted to page level so Create/Edit Campaign modals can use it for dropdowns
  const templatesFetchFn = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const sb = await fetchMarketingTemplatesFromSupabase();
        if (sb && sb.templates.length > 0) {
          return { data: { success: true, data: { templates: sb.templates } }, ok: true as const, error: null };
        }
      } catch { /* fall through to GAS */ }
      return fetchMarketingTemplates(signal);
    },
    []
  );
  const { data: rawTemplates, refetch: refetchTemplates } = useApiData(
    templatesFetchFn, true, 'mktg-templates',
  );
  const allTemplateNames: string[] = useMemo(() => {
    if (!rawTemplates) return [];
    const d = (rawTemplates as any)?.data ?? rawTemplates;
    const list = (d?.templates ?? d) as MarketingTemplate[] || [];
    return list.filter(t => t.active !== false).map(t => t.name).filter(Boolean).sort();
  }, [rawTemplates]);
  const allTemplates: MarketingTemplate[] = useMemo(() => {
    if (!rawTemplates) return [];
    const d = (rawTemplates as any)?.data ?? rawTemplates;
    return (d?.templates ?? d) as MarketingTemplate[] || [];
  }, [rawTemplates]);
  const [checkInboxResult, setCheckInboxResult] = useState<{ ok: boolean; message: string } | null>(null);
  const { busy: inboxBusy, run: runInbox } = useWriteAction();

  const handleCheckInbox = useCallback(async () => {
    const res = await runInbox(() => postCheckMarketingInbox(), 'Inbox checked');
    if (res.ok && res.data) {
      const d = res.data as { replies?: number; bounces?: number; unsubscribes?: number };
      setCheckInboxResult({ ok: true, message: `Inbox checked: ${d.replies ?? 0} replies, ${d.bounces ?? 0} bounces, ${d.unsubscribes ?? 0} unsubscribes` });
    }
  }, [runInbox]);

  const { isMobile } = useIsMobile();

  return (
    <div style={{ background: '#F5F2EE', margin: '-28px -32px', padding: isMobile ? '20px 12px' : '28px 32px', minHeight: '100%', fontFamily: theme.typography.fontFamily }}>
      {/* Page Header */}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'stretch' : 'center', gap: isMobile ? 12 : 0, marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '1px', color: '#1C1C1C' }}>
          STRIDE LOGISTICS · MARKETING
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ActionBtn label={isMobile ? '+ Campaign' : '+ New Campaign'} variant="primary" onClick={() => { setActiveTab('campaigns'); setShowCreateCampaign(true); }} />
          <ActionBtn label="Check Inbox" icon={<Inbox size={14} />} onClick={handleCheckInbox} disabled={inboxBusy} />
        </div>
      </div>

      {checkInboxResult && <ResultBanner result={checkInboxResult} onDismiss={() => setCheckInboxResult(null)} />}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: `2px solid ${theme.colors.border}`, marginBottom: 20, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => { setActiveTab(t.id); setSelectedCampaignId(null); setSelectedContactEmail(null); }}
            style={{
              padding: isMobile ? '8px 12px' : '10px 18px', fontSize: isMobile ? 12 : 13, fontWeight: 600, cursor: 'pointer',
              color: activeTab === t.id ? theme.colors.primary : theme.colors.textMuted,
              borderBottom: `2px solid ${activeTab === t.id ? theme.colors.primary : 'transparent'}`,
              marginBottom: -2, background: 'none', border: 'none', borderTop: 'none',
              borderLeft: 'none', borderRight: 'none', whiteSpace: 'nowrap',
              fontFamily: theme.typography.fontFamily,
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'dashboard' && <DashboardTab />}
      {activeTab === 'campaigns' && !selectedCampaignId && (
        <CampaignsTab
          onSelectCampaign={setSelectedCampaignId}
          showCreate={showCreateCampaign}
          onShowCreate={setShowCreateCampaign}
          templateNames={allTemplateNames}
        />
      )}
      {activeTab === 'campaigns' && selectedCampaignId && (
        <CampaignDetailPanel campaignId={selectedCampaignId} onClose={() => setSelectedCampaignId(null)} templateNames={allTemplateNames} />
      )}
      {activeTab === 'contacts' && !selectedContactEmail && (
        <ContactsTab
          onSelectContact={setSelectedContactEmail}
          showCreate={showCreateContact}
          onShowCreate={setShowCreateContact}
          showImport={showImportContacts}
          onShowImport={setShowImportContacts}
        />
      )}
      {activeTab === 'contacts' && selectedContactEmail && (
        <ContactDetailPanel email={selectedContactEmail} onClose={() => setSelectedContactEmail(null)} />
      )}
      {activeTab === 'templates' && (
        <TemplatesTab showCreate={showCreateTemplate} onShowCreate={setShowCreateTemplate} templates={allTemplates} refetchTemplates={refetchTemplates} />
      )}
      {activeTab === 'logs' && <LogsTab />}
      {activeTab === 'settings' && <SettingsTab />}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 1: DASHBOARD
// ═════════════════════════════════════════════════════════════════════════════

function DashboardTab() {
  const { isMobile: mob } = useIsMobile();
  const dashFetchFn = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const sb = await fetchMarketingDashboardFromSupabase();
        if (sb && sb.totalContacts > 0) {
          return { data: { success: true, data: sb }, ok: true as const, error: null };
        }
      } catch { /* fall through to GAS */ }
      return fetchMarketingDashboard(signal);
    },
    []
  );
  const { data: raw, loading, error, refetch } = useApiData(
    dashFetchFn, true, 'mktg-dashboard',
  );

  const stats: DashboardStats | null = useMemo(() => {
    if (!raw) return null;
    const d = (raw as any)?.data ?? raw;
    return d as DashboardStats;
  }, [raw]);

  if (loading) return <Spinner />;
  if (error) return <ErrorMsg msg={error} />;
  if (!stats) return <EmptyState msg="No dashboard data available" />;

  const g = stats.globalTotals;
  const totalSent = g.sent || 0;

  return (
    <div>
      {/* Refresh */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={() => { setNextFetchNoCache(); refetch(); }} style={{
          background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 12, color: theme.colors.textMuted, fontFamily: theme.typography.fontFamily,
        }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: mob ? 'repeat(2, 1fr)' : 'repeat(6, 1fr)', gap: mob ? 8 : 12, marginBottom: 20 }}>
        <StatCard label="Total Contacts" value={stats.totalContacts.toLocaleString()}
          sub={`${stats.activeLeads.toLocaleString()} leads \u00b7 ${stats.existingClients.toLocaleString()} clients`} />
        <StatCard label="Active Campaigns" value={stats.activeCampaigns} color={theme.colors.primary} />
        <StatCard label="Sent (Total)" value={totalSent.toLocaleString()} color="#1D4ED8" />
        <StatCard label="Reply Rate" value={pct(g.replied, totalSent)} color="#15803D"
          sub={`${g.replied} replies`} />
        <StatCard label="Bounce Rate" value={pct(g.bounced, totalSent)} color="#DC2626"
          sub={`${g.bounced} bounces`} />
        <StatCard label="Unsubscribed" value={pct(g.unsubscribed, totalSent)} color="#94A3B8"
          sub={`${g.unsubscribed} unsubs`} />
      </div>

      {/* Campaign Stats Table */}
      <div style={{ background: theme.colors.bgCard, border: `1px solid ${theme.colors.border}`, borderRadius: 12, overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: mob ? 700 : undefined }}>
          <thead>
            <tr style={{ background: '#FAFAFA' }}>
              {['Campaign', 'Type', 'Status', 'Enrolled', 'Sent', 'Pending', 'Replied', 'Bounced', 'Unsubs', 'Conversions', 'Last Run'].map(h => (
                <th key={h} style={{
                  padding: '10px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700,
                  color: theme.colors.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.colors.border}`,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stats.campaigns.map((c: DashboardCampaignRow) => (
              <tr key={c.campaignId} style={{ borderBottom: `1px solid ${theme.colors.borderSubtle}` }}
                onMouseEnter={e => (e.currentTarget.style.background = '#FAFAFA')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}>
                <td style={{ padding: '10px 12px', fontWeight: 600 }}>{c.name}</td>
                <td style={{ padding: '10px 12px' }}><Badge label={c.type} colors={CAMPAIGN_TYPE_COLORS[c.type]} /></td>
                <td style={{ padding: '10px 12px' }}><Badge label={c.status} colors={CAMPAIGN_STATUS_COLORS[c.status]} /></td>
                <td style={{ padding: '10px 12px' }}>{c.enrolled}</td>
                <td style={{ padding: '10px 12px' }}>{c.sent}</td>
                <td style={{ padding: '10px 12px' }}>{c.pending}</td>
                <td style={{ padding: '10px 12px' }}>{c.replied}</td>
                <td style={{ padding: '10px 12px' }}>{c.bounced}</td>
                <td style={{ padding: '10px 12px' }}>{c.unsubscribed}</td>
                <td style={{ padding: '10px 12px' }}>{c.converted}</td>
                <td style={{ padding: '10px 12px', fontSize: 11, color: theme.colors.textMuted }}>{fmtDateTime(c.lastRunDate)}</td>
              </tr>
            ))}
            {!stats.campaigns.length && (
              <tr><td colSpan={11} style={{ padding: 24, textAlign: 'center', color: theme.colors.textMuted }}>No campaigns yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Gmail quota */}
      <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 8, textAlign: 'right' }}>
        Gmail quota remaining today: {stats.gmailQuotaRemaining}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// CREATE CAMPAIGN MODAL
// ═════════════════════════════════════════════════════════════════════════════

function CreateCampaignModal({ onClose, onCreated, templateNames }: { onClose: () => void; onCreated: () => void; templateNames: string[] }) {
  const [form, setForm] = useState<CreateCampaignPayload>({
    name: '', type: 'Blast', priority: 5, targetType: 'All Active Leads', targetValue: '',
    enrollment: 'Dynamic', tplInitial: '', tplFU1: '', tplFU2: '', tplFU3: '',
    maxFU: 3, interval: 3, dailyLimit: 50, sendStart: 8, sendEnd: 18,
    testMode: false, testRecipient: '', notes: '',
  });
  const { busy, result, setResult, run } = useWriteAction();

  const handleSubmit = async () => {
    if (!form.name.trim()) { setResult({ ok: false, message: 'Campaign name is required' }); return; }
    const res = await run(() => postCreateMarketingCampaign(form), 'Campaign created');
    if (res.ok) { setTimeout(() => { onCreated(); onClose(); }, 800); }
  };

  const set = (k: keyof CreateCampaignPayload, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Modal title="Create Campaign" onClose={onClose} width={560} busy={busy}>
      {result && <ResultBanner result={result} onDismiss={() => setResult(null)} />}
      <div className="mktg-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
        <FormField label="Campaign Name *" info="A name to help you remember this campaign, like 'Spring Designer Outreach'. Only you and your team see this — your contacts will never see it.">
          <input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Q2 Outreach" />
        </FormField>
        <FormField label="Type" info="Pick 'Blast' to send one email and stop. Pick 'Sequence' to send the first email, then automatically send up to 3 more follow-ups if the person doesn't reply.">
          <select style={selectStyle} value={form.type} onChange={e => set('type', e.target.value)}>
            <option>Blast</option><option>Sequence</option>
          </select>
        </FormField>
        <FormField label="Target Type" info="Choose who gets this campaign. 'All Active Leads' sends to everyone on your list. 'Existing Clients' only sends to people you already work with. 'Non-Clients' skips your existing clients. 'Campaign Tag' sends only to contacts you've labeled with a specific tag. 'Manual List' sends to a list you've saved by name.">
          <select style={selectStyle} value={form.targetType} onChange={e => set('targetType', e.target.value)}>
            <option>All Active Leads</option><option>Existing Clients</option><option>Non-Clients</option>
            <option>Campaign Tag</option><option>Manual List</option>
          </select>
        </FormField>
        <FormField label="Target Value" info="Only fill this in if you chose 'Campaign Tag' or 'Manual List' above. Type the tag or list name here. Otherwise, leave it blank.">
          <input style={inputStyle} value={form.targetValue} onChange={e => set('targetValue', e.target.value)} placeholder="Tag or list name" />
        </FormField>
        <FormField label="Enrollment" info="'Dynamic' means if you add new contacts later that match this campaign, they'll get the emails too. 'Snapshot' locks the list — only the people who matched when you started the campaign will get emails. When in doubt, use Dynamic.">
          <select style={selectStyle} value={form.enrollment} onChange={e => set('enrollment', e.target.value)}>
            <option>Dynamic</option><option>Snapshot</option>
          </select>
        </FormField>
        <FormField label="Priority (1-10)" info="If you have several campaigns running at once, the higher number goes first each day. Most campaigns can stay at 5. Use 8-10 for anything urgent, 1-3 for low priority.">
          <input style={inputStyle} type="number" min={1} max={10} value={form.priority} onChange={e => set('priority', Number(e.target.value))} />
        </FormField>
        <FormField label="Initial Template" info="This is the first email that gets sent when someone enters the campaign. Pick a template you've already created on the Templates tab.">
          <select style={selectStyle} value={form.tplInitial} onChange={e => set('tplInitial', e.target.value)}>
            <option value="">— Select template —</option>
            {templateNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </FormField>
        <FormField label="Follow-Up 1" info="If the person doesn't reply to the first email, this one gets sent next. Leave as 'None' to not send any follow-up.">
          <select style={selectStyle} value={form.tplFU1} onChange={e => set('tplFU1', e.target.value)}>
            <option value="">— None —</option>
            {templateNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </FormField>
        <FormField label="Follow-Up 2" info="If they still haven't replied after Follow-Up 1, this email goes next. Leave as 'None' if you don't want a second follow-up.">
          <select style={selectStyle} value={form.tplFU2} onChange={e => set('tplFU2', e.target.value)}>
            <option value="">— None —</option>
            {templateNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </FormField>
        <FormField label="Follow-Up 3" info="This is the last follow-up. Sent after Follow-Up 2 if still no reply. Leave as 'None' to skip.">
          <select style={selectStyle} value={form.tplFU3} onChange={e => set('tplFU3', e.target.value)}>
            <option value="">— None —</option>
            {templateNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </FormField>
        <FormField label="Daily Limit" info="How many emails this campaign can send in one day. Google limits us to about 500 total per day across ALL campaigns, so keep this number small (25-50 is safe). Sending too many too fast can get us marked as spam.">
          <input style={inputStyle} type="number" min={1} value={form.dailyLimit} onChange={e => set('dailyLimit', Number(e.target.value))} />
        </FormField>
        <FormField label="Follow-Up Interval (days)" info="How many days to wait before sending the next follow-up. If you put 3, the system waits 3 days after each email before sending the next one.">
          <input style={inputStyle} type="number" min={1} value={form.interval} onChange={e => set('interval', Number(e.target.value))} />
        </FormField>
        <FormField label="Send Window Start (hour)" info="The earliest time of day emails can go out, using 24-hour time. Put 8 for 8:00 AM, 9 for 9:00 AM. This keeps us from sending emails in the middle of the night.">
          <input style={inputStyle} type="number" min={0} max={23} value={form.sendStart} onChange={e => set('sendStart', Number(e.target.value))} />
        </FormField>
        <FormField label="Send Window End (hour)" info="The latest time of day emails can go out, using 24-hour time. Put 17 for 5:00 PM, 18 for 6:00 PM. Together with the start time, this keeps emails inside business hours.">
          <input style={inputStyle} type="number" min={1} max={24} value={form.sendEnd} onChange={e => set('sendEnd', Number(e.target.value))} />
        </FormField>
      </div>
      <FormField label="Notes" info="A place to jot down anything about this campaign you want to remember — who it's for, what you're testing, why you made it. Only you and your team see these notes.">
        <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
      </FormField>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={form.testMode} onChange={e => set('testMode', e.target.checked)} /> Test Mode
        </label>
        {form.testMode && (
          <input style={{ ...inputStyle, width: 220 }} value={form.testRecipient} onChange={e => set('testRecipient', e.target.value)} placeholder="Test recipient email" />
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <ActionBtn label="Cancel" onClick={onClose} />
        <ActionBtn label={busy ? 'Creating...' : 'Create Campaign'} variant="primary" onClick={handleSubmit} disabled={busy} />
      </div>
    </Modal>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 2: CAMPAIGNS
// ═════════════════════════════════════════════════════════════════════════════

function CampaignsTab({ onSelectCampaign, showCreate, onShowCreate, templateNames }: {
  onSelectCampaign: (id: string) => void; showCreate: boolean; onShowCreate: (v: boolean) => void; templateNames: string[];
}) {
  const { isMobile: mob } = useIsMobile();
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [search, setSearch] = useState('');

  const campaignsFetchFn = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const sb = await fetchMarketingCampaignsFromSupabase();
        if (sb && sb.campaigns.length > 0) {
          return { data: { success: true, data: { campaigns: sb.campaigns } }, ok: true as const, error: null };
        }
      } catch { /* fall through to GAS */ }
      return fetchMarketingCampaigns(signal);
    },
    []
  );
  const { data: raw, loading, error, refetch } = useApiData(
    campaignsFetchFn, true, 'mktg-campaigns',
  );

  const campaigns: MarketingCampaign[] = useMemo(() => {
    if (!raw) return [];
    const d = (raw as any)?.data ?? raw;
    return (d?.campaigns ?? d) as MarketingCampaign[] || [];
  }, [raw]);

  const filtered = useMemo(() => {
    let list = campaigns;
    if (statusFilter !== 'All') list = list.filter(c => c.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.campaignId.toLowerCase().includes(q));
    }
    return list;
  }, [campaigns, statusFilter, search]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { All: campaigns.length, Draft: 0, Active: 0, Paused: 0, Complete: 0 };
    campaigns.forEach(c => { if (counts[c.status] !== undefined) counts[c.status]++; });
    return counts;
  }, [campaigns]);

  const handleCreated = () => { setNextFetchNoCache(); refetch(); };

  if (loading) return <Spinner />;
  if (error) return <ErrorMsg msg={error} />;

  return (
    <div>
      {showCreate && <CreateCampaignModal onClose={() => onShowCreate(false)} onCreated={handleCreated} templateNames={templateNames} />}

      {/* Action bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: mob ? 'wrap' : undefined }}>
        <div style={{ flex: 1, minWidth: mob ? '100%' : undefined, order: mob ? 1 : 0 }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: theme.colors.textMuted }} />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search campaigns..."
              style={{
                padding: '8px 12px 8px 30px', border: `1px solid ${theme.colors.border}`, borderRadius: 8,
                fontSize: 12, width: mob ? '100%' : 240, fontFamily: theme.typography.fontFamily, outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
        </div>
        <button onClick={() => { setNextFetchNoCache(); refetch(); }} style={{
          background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 12, color: theme.colors.textMuted, fontFamily: theme.typography.fontFamily,
        }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Status chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {(['All', 'Draft', 'Active', 'Paused', 'Complete'] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)} style={{
            padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 20, cursor: 'pointer',
            border: `1px solid ${statusFilter === s ? theme.colors.primary : theme.colors.border}`,
            background: statusFilter === s ? theme.colors.orangeLight : theme.colors.bgCard,
            color: statusFilter === s ? theme.colors.primary : theme.colors.text,
            fontFamily: theme.typography.fontFamily,
          }}>
            {s} <span style={{ color: theme.colors.textMuted, marginLeft: 4 }}>{statusCounts[s] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: theme.colors.bgCard, border: `1px solid ${theme.colors.border}`, borderRadius: 12, overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: mob ? 600 : undefined }}>
          <thead>
            <tr style={{ background: '#FAFAFA' }}>
              {['Campaign Name', 'Type', 'Status', 'Targeting', 'Sent', 'Replies', 'Priority', 'Created'].map(h => (
                <th key={h} style={{
                  padding: '10px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700,
                  color: theme.colors.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.colors.border}`,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.campaignId} onClick={() => onSelectCampaign(c.campaignId)}
                style={{ borderBottom: `1px solid ${theme.colors.borderSubtle}`, cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#FAFAFA')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}>
                <td style={{ padding: '10px 12px', fontWeight: 600 }}>{c.name}</td>
                <td style={{ padding: '10px 12px' }}><Badge label={c.type} colors={CAMPAIGN_TYPE_COLORS[c.type]} /></td>
                <td style={{ padding: '10px 12px' }}><Badge label={c.status} colors={CAMPAIGN_STATUS_COLORS[c.status]} /></td>
                <td style={{ padding: '10px 12px' }}>{c.targetType}</td>
                <td style={{ padding: '10px 12px' }}>{c.totalSent}</td>
                <td style={{ padding: '10px 12px' }}>{c.totalReplied}</td>
                <td style={{ padding: '10px 12px' }}>{c.priority}</td>
                <td style={{ padding: '10px 12px', fontSize: 11, color: theme.colors.textMuted }}>{fmtDate(c.createdDate)}</td>
              </tr>
            ))}
            {!filtered.length && (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: theme.colors.textMuted }}>No campaigns found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 3: CAMPAIGN DETAIL PANEL
// ═════════════════════════════════════════════════════════════════════════════

function CampaignDetailPanel({ campaignId, onClose, templateNames }: { campaignId: string; onClose: () => void; templateNames: string[] }) {
  const { isMobile: mob } = useIsMobile();
  const campaignDetailFetchFn = useCallback((signal?: AbortSignal) => fetchMarketingCampaignDetail(campaignId, signal), [campaignId]);
  const { data: raw, loading, error, refetch } = useApiData(
    campaignDetailFetchFn, true, `mktg-campaign-${campaignId}`,
  );
  const { busy, result, setResult, run } = useWriteAction();
  const [confirm, setConfirm] = useState<{ action: string; title: string; message: string } | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showTestEmail, setShowTestEmail] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');

  const detail = useMemo(() => {
    if (!raw) return null;
    const d = (raw as any)?.data ?? raw;
    return d as { campaign: MarketingCampaign; contacts: CampaignContact[]; stats: Record<string, number> };
  }, [raw]);

  const doRefresh = useCallback(() => { setNextFetchNoCache(); refetch(); }, [refetch]);

  const handleAction = useCallback(async (action: string) => {
    setConfirm(null);
    let res;
    switch (action) {
      case 'activate':
        res = await run(() => postActivateCampaign(campaignId), 'Campaign activated');
        break;
      case 'pause':
        res = await run(() => postPauseCampaign(campaignId), 'Campaign paused');
        break;
      case 'complete':
        res = await run(() => postCompleteCampaign(campaignId), 'Campaign completed');
        break;
      case 'runNow':
        res = await run(() => postRunCampaignNow(campaignId), 'Campaign run completed');
        break;
      case 'delete':
        res = await run(() => postDeleteCampaign(campaignId), 'Campaign deleted');
        if (res?.ok) { setTimeout(onClose, 800); }
        return;
    }
    if (res?.ok) doRefresh();
  }, [campaignId, run, doRefresh, onClose]);

  const confirmAction = useCallback((action: string, title: string, message: string) => {
    setConfirm({ action, title, message });
  }, []);

  const handlePreview = useCallback(async () => {
    if (!detail?.campaign.initialTemplate) return;
    const res = await run(() => postPreviewTemplate(detail.campaign.initialTemplate), 'Preview generated');
    if (res.ok && res.data) {
      setPreviewHtml((res.data as { html?: string }).html || '<p>No preview available</p>');
      setShowPreview(true);
    }
  }, [detail, run]);

  if (loading) return <Spinner />;
  if (error) return <ErrorMsg msg={error} />;
  if (!detail) return <EmptyState msg="Campaign not found" />;

  const c = detail.campaign;
  const st = detail.stats;

  return (
    <div style={{ maxWidth: mob ? '100%' : 600 }}>
      {confirm && (
        <ConfirmDialog
          title={confirm.title} message={confirm.message}
          confirmLabel={confirm.action === 'delete' ? 'Delete' : 'Confirm'}
          danger={confirm.action === 'delete' || confirm.action === 'complete'}
          onCancel={() => setConfirm(null)}
          onConfirm={() => handleAction(confirm.action)}
          busy={busy}
        />
      )}
      {showEdit && (
        <EditCampaignModal campaign={c} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); doRefresh(); }} templateNames={templateNames} />
      )}
      {showTestEmail && (
        <SendTestEmailModal campaignId={campaignId} onClose={() => setShowTestEmail(false)} />
      )}
      {showPreview && (
        <Modal title="Email Preview" onClose={() => setShowPreview(false)} width={700}>
          <div dangerouslySetInnerHTML={{ __html: previewHtml }} style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 8, padding: 16, maxHeight: 500, overflowY: 'auto' }} />
        </Modal>
      )}

      {result && <ResultBanner result={result} onDismiss={() => setResult(null)} />}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer', fontSize: 12,
            color: theme.colors.textMuted, display: 'flex', alignItems: 'center', gap: 4,
            fontFamily: theme.typography.fontFamily, marginBottom: 8, padding: 0,
          }}><ChevronLeft size={14} /> Back to Campaigns</button>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{c.name}</h2>
          <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
            <Badge label={c.type} colors={CAMPAIGN_TYPE_COLORS[c.type]} />
            <Badge label={c.status} colors={CAMPAIGN_STATUS_COLORS[c.status]} />
            <span style={{ fontSize: 11, color: theme.colors.textMuted }}>Priority: {c.priority}</span>
          </div>
        </div>
        <ActionBtn label="Edit" icon={<Edit3 size={14} />} onClick={() => setShowEdit(true)} />
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: mob ? 'repeat(3, 1fr)' : 'repeat(5, 1fr)', gap: mob ? 8 : 12, marginBottom: 16 }}>
        {[
          { num: st.sent ?? c.totalSent, label: 'Sent', color: '#1D4ED8' },
          { num: st.replied ?? c.totalReplied, label: 'Replied', color: '#15803D' },
          { num: st.bounced ?? c.totalBounced, label: 'Bounced', color: '#DC2626' },
          { num: st.unsubscribed ?? c.totalUnsubscribed, label: 'Unsubs', color: '#94A3B8' },
          { num: st.converted ?? c.totalConverted, label: 'Converted', color: theme.colors.primary },
        ].map(s => (
          <div key={s.label} style={{
            background: '#F8FAFC', border: `1px solid ${theme.colors.border}`,
            borderRadius: 8, padding: mob ? 8 : 10, textAlign: 'center',
          }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.num}</div>
            <div style={{ fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Campaign Settings */}
      <SectionTitle title="Campaign Settings" />
      <div style={{ display: 'grid', gridTemplateColumns: mob ? '1fr' : '1fr 1fr', gap: mob ? 8 : 12, marginBottom: 12 }}>
        <ReadOnlyField label="Targeting" value={c.targetType + (c.targetValue ? ` (${c.targetValue})` : '')} />
        <ReadOnlyField label="Enrollment" value={c.enrollmentMode} />
        <ReadOnlyField label="Daily Limit" value={String(c.dailySendLimit)} />
        <ReadOnlyField label="Send Window" value={`${c.sendWindowStart}:00 to ${c.sendWindowEnd}:00`} />
        <ReadOnlyField label="Start Date" value={fmtDate(c.startDate)} />
        <ReadOnlyField label="End Date" value={fmtDate(c.endDate)} />
        <ReadOnlyField label="Test Mode" value={c.testMode ? 'On' : 'Off'} />
        <ReadOnlyField label="Test Recipient" value={c.testRecipient || '\u2014'} />
      </div>

      {/* Templates */}
      <SectionTitle title="Templates" />
      <div style={{ marginBottom: 12 }}>
        <ReadOnlyField label="Initial Email" value={c.initialTemplate || '\u2014'} />
        <ReadOnlyField label={`Follow-Up 1 (after ${c.followUpIntervalDays}d)`} value={c.followUp1Template || '\u2014 None \u2014'} />
        <ReadOnlyField label={`Follow-Up 2`} value={c.followUp2Template || '\u2014 None \u2014'} />
        <ReadOnlyField label={`Follow-Up 3`} value={c.followUp3Template || '\u2014 None \u2014'} />
      </div>
      {(c.custom1 || c.custom2 || c.custom3) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          {c.custom1 && <ReadOnlyField label="Custom 1" value={c.custom1} />}
          {c.custom2 && <ReadOnlyField label="Custom 2" value={c.custom2} />}
          {c.custom3 && <ReadOnlyField label="Custom 3" value={c.custom3} />}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
        {c.status === 'Active' && (
          <ActionBtn label="Pause Campaign" icon={<Pause size={14} />} onClick={() => confirmAction('pause', 'Pause Campaign', `Pause "${c.name}"? No more emails will be sent until reactivated.`)} disabled={busy} />
        )}
        {(c.status === 'Draft' || c.status === 'Paused') && (
          <ActionBtn label="Activate" icon={<Play size={14} />} onClick={() => confirmAction('activate', 'Activate Campaign', `Activate "${c.name}"? This will begin enrolling contacts and sending emails.`)} disabled={busy} />
        )}
        {c.status === 'Active' && (
          <ActionBtn label={busy ? 'Running...' : 'Run Now'} icon={<Play size={14} />} variant="primary" onClick={() => confirmAction('runNow', 'Run Campaign Now', `Run "${c.name}" immediately? This will send emails to eligible contacts now.`)} disabled={busy} />
        )}
        <ActionBtn label="Preview Email" icon={<Eye size={14} />} onClick={handlePreview} disabled={busy || !c.initialTemplate} />
        <ActionBtn label="Send Test" icon={<Send size={14} />} onClick={() => setShowTestEmail(true)} disabled={busy} />
        {(c.status === 'Active' || c.status === 'Paused') && (
          <ActionBtn label="Complete" icon={<CheckCircle2 size={14} />} onClick={() => confirmAction('complete', 'Complete Campaign', `Mark "${c.name}" as complete? This cannot be undone.`)} disabled={busy} />
        )}
        {c.status === 'Draft' && (
          <ActionBtn label="Delete" icon={<Trash2 size={14} />} variant="danger" onClick={() => confirmAction('delete', 'Delete Campaign', `Delete "${c.name}"? This will also remove all campaign contact records. This cannot be undone.`)} disabled={busy} />
        )}
      </div>

      {/* Campaign Contacts sub-table */}
      <SectionTitle title={`Campaign Contacts (${detail.contacts.length})`} />
      <div style={{ background: theme.colors.bgCard, border: `1px solid ${theme.colors.border}`, borderRadius: 12, overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: mob ? 500 : undefined }}>
          <thead>
            <tr style={{ background: '#FAFAFA' }}>
              {['Contact', 'Email', 'Status', 'Step', 'Last Contact', 'Next Follow-Up'].map(h => (
                <th key={h} style={{
                  padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700,
                  color: theme.colors.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.colors.border}`,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {detail.contacts.slice(0, 50).map((cc, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${theme.colors.borderSubtle}` }}>
                <td style={{ padding: '8px 10px', fontWeight: 600 }}>{cc.contactName}</td>
                <td style={{ padding: '8px 10px' }}>{cc.email}</td>
                <td style={{ padding: '8px 10px' }}><Badge label={cc.status} colors={CC_STATUS_COLORS[cc.status]} /></td>
                <td style={{ padding: '8px 10px' }}>{cc.currentStep}</td>
                <td style={{ padding: '8px 10px', fontSize: 11, color: theme.colors.textMuted }}>{fmtDate(cc.lastContactDate)}</td>
                <td style={{ padding: '8px 10px', fontSize: 11, color: theme.colors.textMuted }}>{fmtDate(cc.nextFollowUpDate)}</td>
              </tr>
            ))}
            {!detail.contacts.length && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: theme.colors.textMuted }}>No contacts enrolled</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {detail.contacts.length > 50 && (
        <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 4 }}>
          Showing 50 of {detail.contacts.length} contacts
        </div>
      )}

      {/* Notes / Errors */}
      {c.lastError && (
        <div style={{ marginTop: 16, padding: 12, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#DC2626', marginBottom: 4 }}>Last Error</div>
          <div style={{ fontSize: 12, color: '#991B1B' }}>{c.lastError}</div>
        </div>
      )}
      {c.notes && (
        <div style={{ marginTop: 12 }}>
          <ReadOnlyField label="Notes" value={c.notes} />
        </div>
      )}
    </div>
  );
}

// ─── Edit Campaign Modal ────────────────────────────────────────────────────

function EditCampaignModal({ campaign, onClose, onSaved, templateNames }: { campaign: MarketingCampaign; onClose: () => void; onSaved: () => void; templateNames: string[] }) {
  const [form, setForm] = useState({
    name: campaign.name,
    priority: campaign.priority,
    targetType: campaign.targetType,
    targetValue: campaign.targetValue,
    enrollment: campaign.enrollmentMode,
    tplInitial: campaign.initialTemplate,
    tplFU1: campaign.followUp1Template,
    tplFU2: campaign.followUp2Template,
    tplFU3: campaign.followUp3Template,
    dailyLimit: campaign.dailySendLimit,
    interval: campaign.followUpIntervalDays,
    sendStart: campaign.sendWindowStart,
    sendEnd: campaign.sendWindowEnd,
    testMode: campaign.testMode,
    testRecipient: campaign.testRecipient,
    notes: campaign.notes,
    custom1: campaign.custom1,
    custom2: campaign.custom2,
    custom3: campaign.custom3,
  });
  const { busy, result, setResult, run } = useWriteAction();

  const handleSave = async () => {
    const res = await run(
      () => postUpdateMarketingCampaign({ campaignId: campaign.campaignId, ...form }),
      'Campaign updated'
    );
    if (res.ok) { setTimeout(onSaved, 600); }
  };

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Modal title={`Edit: ${campaign.name}`} onClose={onClose} width={560} busy={busy}>
      {result && <ResultBanner result={result} onDismiss={() => setResult(null)} />}
      <div className="mktg-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
        <FormField label="Campaign Name" info="The name you use to recognize this campaign. Changing it just updates the label — it doesn't affect any emails that have already been sent.">
          <input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} />
        </FormField>
        <FormField label="Priority (1-10)" info="If several campaigns are running, higher numbers send first each day. Most campaigns can stay at 5.">
          <input style={inputStyle} type="number" min={1} max={10} value={form.priority} onChange={e => set('priority', Number(e.target.value))} />
        </FormField>
        <FormField label="Initial Template" info="The first email this campaign sends. Pick a template you've created on the Templates tab.">
          <select style={selectStyle} value={form.tplInitial} onChange={e => set('tplInitial', e.target.value)}>
            <option value="">— Select template —</option>
            {templateNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </FormField>
        <FormField label="Follow-Up 1" info="The email that's sent next if the person hasn't replied. Leave as 'None' to skip.">
          <select style={selectStyle} value={form.tplFU1} onChange={e => set('tplFU1', e.target.value)}>
            <option value="">— None —</option>
            {templateNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </FormField>
        <FormField label="Follow-Up 2" info="The second follow-up email, sent if there's still no reply. Leave as 'None' to skip.">
          <select style={selectStyle} value={form.tplFU2} onChange={e => set('tplFU2', e.target.value)}>
            <option value="">— None —</option>
            {templateNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </FormField>
        <FormField label="Follow-Up 3" info="The last follow-up. After this, the system stops contacting that person. Leave as 'None' to skip.">
          <select style={selectStyle} value={form.tplFU3} onChange={e => set('tplFU3', e.target.value)}>
            <option value="">— None —</option>
            {templateNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </FormField>
        <FormField label="Daily Limit" info="How many emails this campaign is allowed to send per day. Keep it small (25-50) so we don't get flagged as spam.">
          <input style={inputStyle} type="number" min={1} value={form.dailyLimit} onChange={e => set('dailyLimit', Number(e.target.value))} />
        </FormField>
        <FormField label="Follow-Up Interval (days)" info="How many days the system waits before sending the next follow-up. 3 means it waits 3 days after each email.">
          <input style={inputStyle} type="number" min={1} value={form.interval} onChange={e => set('interval', Number(e.target.value))} />
        </FormField>
        <FormField label="Custom 1" info="A free notes field you can use however you want — like tracking where leads came from, or which salesperson owns them. You can also show this value in your email by using {{Custom 1}} in a template.">
          <input style={inputStyle} value={form.custom1} onChange={e => set('custom1', e.target.value)} />
        </FormField>
        <FormField label="Custom 2" info="A second free notes field. Can also be shown in emails using {{Custom 2}} in a template.">
          <input style={inputStyle} value={form.custom2} onChange={e => set('custom2', e.target.value)} />
        </FormField>
      </div>
      <FormField label="Notes" info="A place to jot down anything about this campaign you want to remember. Only you and your team see this.">
        <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
      </FormField>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={form.testMode} onChange={e => set('testMode', e.target.checked)} /> Test Mode
        </label>
        {form.testMode && (
          <input style={{ ...inputStyle, width: 220 }} value={form.testRecipient} onChange={e => set('testRecipient', e.target.value)} placeholder="Test recipient email" />
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <ActionBtn label="Cancel" onClick={onClose} />
        <ActionBtn label={busy ? 'Saving...' : 'Save Changes'} variant="primary" onClick={handleSave} disabled={busy} />
      </div>
    </Modal>
  );
}

// ─── Send Test Email Modal ──────────────────────────────────────────────────

function SendTestEmailModal({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const { busy, result, setResult, run } = useWriteAction();

  const handleSend = async () => {
    if (!email.trim()) { setResult({ ok: false, message: 'Email address is required' }); return; }
    await run(() => postSendTestEmail(campaignId, email), 'Test email sent');
  };

  return (
    <Modal title="Send Test Email" onClose={onClose} width={400} busy={busy}>
      {result && <ResultBanner result={result} onDismiss={() => setResult(null)} />}
      <FormField label="Recipient Email" info="Who should receive the test email. Use your own email to see exactly what the campaign will look like before it goes out to real contacts.">
        <input style={inputStyle} value={email} onChange={e => setEmail(e.target.value)} placeholder="test@example.com" />
      </FormField>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <ActionBtn label="Cancel" onClick={onClose} />
        <ActionBtn label={busy ? 'Sending...' : 'Send Test'} variant="primary" icon={<Send size={14} />} onClick={handleSend} disabled={busy} />
      </div>
    </Modal>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 4: CONTACTS
// ═════════════════════════════════════════════════════════════════════════════

function ContactsTab({ onSelectContact, showCreate, onShowCreate, showImport, onShowImport }: {
  onSelectContact: (email: string) => void;
  showCreate: boolean; onShowCreate: (v: boolean) => void;
  showImport: boolean; onShowImport: (v: boolean) => void;
}) {
  const { isMobile: mob } = useIsMobile();
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 100;

  const fetchParams = useMemo(() => {
    const p: Record<string, string> = { page: String(page), pageSize: String(pageSize) };
    if (statusFilter !== 'All') p.status = statusFilter;
    if (search) p.search = search;
    return p;
  }, [statusFilter, search, page]);

  // FIX: wrap in useCallback. Without this, every render created a new fetchFn
  // → useApiData's doFetch dep changed → useEffect refired → loop of 13k+ canceled
  // fetches. Cache key is also derived from the memo output so it only changes
  // when real filters change.
  const cacheKey = useMemo(() => `mktg-contacts-${JSON.stringify(fetchParams)}`, [fetchParams]);
  const contactsFetchFn = useCallback(
    async (signal?: AbortSignal) => {
      // Supabase-first (~50ms with server-side filter + pagination).
      // GAS fallback only on Supabase miss or empty table.
      try {
        const sb = await fetchMarketingContactsFromSupabase({
          status: fetchParams.status,
          search: fetchParams.search,
          page: page,
          pageSize: pageSize,
        });
        if (sb && sb.total > 0) {
          // Match the MarketingContactsResponse nested shape { success, data: {...} }
          return { data: { success: true, data: { contacts: sb.contacts, total: sb.total, page: sb.page, pageSize: sb.pageSize } }, ok: true as const, error: null };
        }
      } catch { /* fall through to GAS */ }
      return fetchMarketingContacts(signal, fetchParams);
    },
    [fetchParams, page]
  );
  const { data: raw, loading, error, refetch } = useApiData(contactsFetchFn, true, cacheKey);

  const result = useMemo(() => {
    if (!raw) return null;
    const d = (raw as any)?.data ?? raw;
    return d as { contacts: MarketingContact[]; total: number; page: number; pageSize: number };
  }, [raw]);

  // Note: redundant manual refetch() effect removed. useApiData already refetches
  // automatically when fetchFn or cacheKey change (both are derived from fetchParams).

  const contacts = result?.contacts ?? [];
  const total = result?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleCreated = () => { setNextFetchNoCache(); refetch(); };

  return (
    <div>
      {showCreate && <CreateContactModal onClose={() => onShowCreate(false)} onCreated={handleCreated} />}
      {showImport && <ImportContactsModal onClose={() => onShowImport(false)} onImported={handleCreated} />}

      {/* Action bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: mob ? 'wrap' : undefined }}>
        <ActionBtn label="+ Add" icon={<Plus size={14} />} variant="primary" onClick={() => onShowCreate(true)} />
        <ActionBtn label="Import" icon={<Upload size={14} />} onClick={() => onShowImport(true)} />
        <div style={{ flex: 1, minWidth: mob ? '100%' : undefined, order: mob ? 1 : 0 }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: theme.colors.textMuted }} />
            <input
              value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search contacts..."
              style={{
                padding: '8px 12px 8px 30px', border: `1px solid ${theme.colors.border}`, borderRadius: 8,
                fontSize: 12, width: mob ? '100%' : 240, fontFamily: theme.typography.fontFamily, outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
        </div>
        <button onClick={() => { setNextFetchNoCache(); refetch(); }} style={{
          background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 12, color: theme.colors.textMuted, fontFamily: theme.typography.fontFamily,
        }}><RefreshCw size={13} /> Refresh</button>
      </div>

      {/* Status chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {(['All', 'Pending', 'Client', 'Suppressed'] as const).map(s => (
          <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }} style={{
            padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 20, cursor: 'pointer',
            border: `1px solid ${statusFilter === s ? theme.colors.primary : theme.colors.border}`,
            background: statusFilter === s ? theme.colors.orangeLight : theme.colors.bgCard,
            color: statusFilter === s ? theme.colors.primary : theme.colors.text,
            fontFamily: theme.typography.fontFamily,
          }}>{s}</button>
        ))}
      </div>

      {loading && <Spinner />}
      {error && <ErrorMsg msg={error} />}
      {!loading && !error && (
        <>
          <div style={{ background: theme.colors.bgCard, border: `1px solid ${theme.colors.border}`, borderRadius: 12, overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: mob ? 600 : undefined }}>
              <thead>
                <tr style={{ background: '#FAFAFA' }}>
                  {['Name', 'Email', 'Company', 'Status', 'Last Campaign', 'Bounced', 'Unsub', 'Replied'].map(h => (
                    <th key={h} style={{
                      padding: '10px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700,
                      color: theme.colors.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.colors.border}`,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {contacts.map(ct => (
                  <tr key={ct.email} onClick={() => onSelectContact(ct.email)}
                    style={{ borderBottom: `1px solid ${theme.colors.borderSubtle}`, cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#FAFAFA')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>{ct.firstName} {ct.lastName}</td>
                    <td style={{ padding: '10px 12px' }}>{ct.email}</td>
                    <td style={{ padding: '10px 12px' }}>{ct.company || '\u2014'}</td>
                    <td style={{ padding: '10px 12px' }}><Badge label={ct.status} colors={CONTACT_STATUS_COLORS[ct.status]} /></td>
                    <td style={{ padding: '10px 12px', fontSize: 11, color: theme.colors.textMuted }}>{fmtDate(ct.lastCampaignDate)}</td>
                    <td style={{ padding: '10px 12px' }}>{ct.bounced ? '\u2713' : '\u2014'}</td>
                    <td style={{ padding: '10px 12px' }}>{ct.unsubscribed ? '\u2713' : '\u2014'}</td>
                    <td style={{ padding: '10px 12px' }}>{ct.replied ? '\u2713' : '\u2014'}</td>
                  </tr>
                ))}
                {!contacts.length && (
                  <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: theme.colors.textMuted }}>No contacts found</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <span style={{ fontSize: 11, color: theme.colors.textMuted }}>
              Showing {contacts.length} of {total.toLocaleString()} contacts \u00b7 Page {page} of {totalPages}
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{
                border: `1px solid ${theme.colors.border}`, background: theme.colors.bgCard, borderRadius: 6,
                padding: '4px 8px', cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.4 : 1,
              }}><ChevronLeft size={14} /></button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} style={{
                border: `1px solid ${theme.colors.border}`, background: theme.colors.bgCard, borderRadius: 6,
                padding: '4px 8px', cursor: page >= totalPages ? 'default' : 'pointer', opacity: page >= totalPages ? 0.4 : 1,
              }}><ChevronRight size={14} /></button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Create Contact Modal ───────────────────────────────────────────────────

function CreateContactModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<CreateContactPayload>({
    email: '', firstName: '', lastName: '', company: '', status: 'Pending',
    existingClient: false, campaignTag: '', source: '', notes: '',
  });
  const { busy, result, setResult, run } = useWriteAction();

  const handleSubmit = async () => {
    if (!form.email.trim()) { setResult({ ok: false, message: 'Email is required' }); return; }
    if (!form.firstName.trim()) { setResult({ ok: false, message: 'First name is required' }); return; }
    const res = await run(() => postCreateMarketingContact(form), 'Contact created');
    if (res.ok) { setTimeout(() => { onCreated(); onClose(); }, 600); }
  };

  const set = (k: keyof CreateContactPayload, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Modal title="Add Contact" onClose={onClose} width={460} busy={busy}>
      {result && <ResultBanner result={result} onDismiss={() => setResult(null)} />}
      <div className="mktg-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
        <FormField label="First Name *" info="The person's first name. This shows up in emails wherever you put {{First Name}} in the template.">
          <input style={inputStyle} value={form.firstName} onChange={e => set('firstName', e.target.value)} />
        </FormField>
        <FormField label="Last Name" info="The person's last name. Optional but helps personalize emails.">
          <input style={inputStyle} value={form.lastName} onChange={e => set('lastName', e.target.value)} />
        </FormField>
      </div>
      <FormField label="Email *" info="The email address we'll send campaigns to. Each contact needs a unique email — duplicates will be rejected.">
        <input style={inputStyle} type="email" value={form.email} onChange={e => set('email', e.target.value)} />
      </FormField>
      <FormField label="Company" info="The company name this person works for. Used in emails when you put {{Company}} in the template.">
        <input style={inputStyle} value={form.company} onChange={e => set('company', e.target.value)} />
      </FormField>
      <div className="mktg-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
        <FormField label="Status" info="'Pending' = a lead you haven't worked with yet. 'Client' = someone who has already used Stride. Campaigns can target one group or the other.">
          <select style={selectStyle} value={form.status} onChange={e => set('status', e.target.value as ContactStatus)}>
            <option>Pending</option><option>Client</option>
          </select>
        </FormField>
        <FormField label="Campaign Tag" info="A label you pick to group contacts (e.g. 'trade-show-2025' or 'west-coast'). Campaigns can target everyone with the same tag.">
          <input style={inputStyle} value={form.campaignTag} onChange={e => set('campaignTag', e.target.value)} />
        </FormField>
      </div>
      <FormField label="Source" info="Where did this contact come from? Examples: Website, Referral, Trade Show, Cold List. Just for your records.">
        <input style={inputStyle} value={form.source} onChange={e => set('source', e.target.value)} placeholder="e.g. Website, Referral" />
      </FormField>
      <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <input type="checkbox" checked={form.existingClient} onChange={e => set('existingClient', e.target.checked)} /> Existing Client
        <InfoTooltip text="Check this box if they're already a Stride customer. It keeps them out of cold-outreach campaigns so you don't pitch someone who already works with us." />
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <ActionBtn label="Cancel" onClick={onClose} />
        <ActionBtn label={busy ? 'Creating...' : 'Add Contact'} variant="primary" onClick={handleSubmit} disabled={busy} />
      </div>
    </Modal>
  );
}

// ─── Import Contacts Modal ──────────────────────────────────────────────────

function ImportContactsModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [csv, setCsv] = useState('');
  const { busy, result, setResult, run } = useWriteAction();

  const handleImport = async () => {
    const lines = csv.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) { setResult({ ok: false, message: 'Paste CSV with header row + at least 1 data row' }); return; }
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const emailIdx = headers.findIndex(h => h === 'email');
    const fnIdx = headers.findIndex(h => h === 'first name' || h === 'firstname');
    const lnIdx = headers.findIndex(h => h === 'last name' || h === 'lastname');
    const compIdx = headers.findIndex(h => h === 'company');
    if (emailIdx < 0) { setResult({ ok: false, message: 'CSV must have an "Email" column' }); return; }

    const contacts: CreateContactPayload[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      const email = cols[emailIdx];
      if (!email) continue;
      contacts.push({
        email,
        firstName: fnIdx >= 0 ? cols[fnIdx] || '' : '',
        lastName: lnIdx >= 0 ? cols[lnIdx] || '' : '',
        company: compIdx >= 0 ? cols[compIdx] || '' : '',
      });
    }

    if (!contacts.length) { setResult({ ok: false, message: 'No valid contacts found in CSV' }); return; }
    const res = await run(() => postImportMarketingContacts(contacts), `Imported ${contacts.length} contacts`);
    if (res.ok) { setTimeout(() => { onImported(); onClose(); }, 800); }
  };

  return (
    <Modal title="Import Contacts" onClose={onClose} width={520} busy={busy}>
      {result && <ResultBanner result={result} onDismiss={() => setResult(null)} />}
      <p style={{ fontSize: 12, color: theme.colors.textMuted, margin: '0 0 12px', display: 'flex', alignItems: 'center' }}>
        <span>Paste CSV data with columns: Email (required), First Name, Last Name, Company</span>
        <InfoTooltip text="Copy contacts from a spreadsheet and paste them here. The first row should list the column names (Email, First Name, Last Name, Company). Only Email is required. Each contact must be on its own line. Easiest way: open your spreadsheet, select the cells including headers, copy, then paste here." />
      </p>
      <textarea
        style={{ ...inputStyle, minHeight: 160, resize: 'vertical', fontFamily: 'monospace', fontSize: 11 }}
        value={csv} onChange={e => setCsv(e.target.value)}
        placeholder={'Email,First Name,Last Name,Company\njohn@example.com,John,Smith,Acme Inc'}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <ActionBtn label="Cancel" onClick={onClose} />
        <ActionBtn label={busy ? 'Importing...' : 'Import'} variant="primary" icon={<Upload size={14} />} onClick={handleImport} disabled={busy} />
      </div>
    </Modal>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// CONTACT DETAIL PANEL
// ═════════════════════════════════════════════════════════════════════════════

function ContactDetailPanel({ email, onClose }: { email: string; onClose: () => void }) {
  const { isMobile: mob } = useIsMobile();
  const contactDetailFetchFn = useCallback((signal?: AbortSignal) => fetchMarketingContactDetail(email, signal), [email]);
  const { data: raw, loading, error, refetch } = useApiData(
    contactDetailFetchFn, true, `mktg-contact-${email}`,
  );
  const { busy, result, setResult, run } = useWriteAction();
  const [showEdit, setShowEdit] = useState(false);
  const [confirm, setConfirm] = useState<{ action: 'suppress' | 'unsuppress' } | null>(null);

  const detail = useMemo(() => {
    if (!raw) return null;
    const d = (raw as any)?.data ?? raw;
    return d as { contact: MarketingContact; campaignHistory: CampaignContact[] };
  }, [raw]);

  const doRefresh = useCallback(() => { setNextFetchNoCache(); refetch(); }, [refetch]);

  const handleSuppress = useCallback(async () => {
    setConfirm(null);
    const res = await run(() => postSuppressContact(email, 'Manual suppression'), 'Contact suppressed');
    if (res.ok) doRefresh();
  }, [email, run, doRefresh]);

  const handleUnsuppress = useCallback(async () => {
    setConfirm(null);
    const res = await run(() => postUnsuppressContact(email, 'Manual release'), 'Contact unsuppressed');
    if (res.ok) doRefresh();
  }, [email, run, doRefresh]);

  if (loading) return <Spinner />;
  if (error) return <ErrorMsg msg={error} />;
  if (!detail) return <EmptyState msg="Contact not found" />;

  const ct = detail.contact;

  return (
    <div style={{ maxWidth: 600 }}>
      {confirm && (
        <ConfirmDialog
          title={confirm.action === 'suppress' ? 'Suppress Contact' : 'Unsuppress Contact'}
          message={confirm.action === 'suppress'
            ? `Suppress ${ct.firstName} ${ct.lastName} (${ct.email})? They will be excluded from all future campaigns.`
            : `Unsuppress ${ct.firstName} ${ct.lastName} (${ct.email})? They will be eligible for campaigns again.`}
          confirmLabel={confirm.action === 'suppress' ? 'Suppress' : 'Unsuppress'}
          danger={confirm.action === 'suppress'}
          onCancel={() => setConfirm(null)}
          onConfirm={confirm.action === 'suppress' ? handleSuppress : handleUnsuppress}
          busy={busy}
        />
      )}
      {showEdit && (
        <EditContactModal contact={ct} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); doRefresh(); }} />
      )}

      {result && <ResultBanner result={result} onDismiss={() => setResult(null)} />}

      <button onClick={onClose} style={{
        background: 'none', border: 'none', cursor: 'pointer', fontSize: 12,
        color: theme.colors.textMuted, display: 'flex', alignItems: 'center', gap: 4,
        fontFamily: theme.typography.fontFamily, marginBottom: 8, padding: 0,
      }}><ChevronLeft size={14} /> Back to Contacts</button>

      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>{ct.firstName} {ct.lastName}</h2>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, alignItems: 'center' }}>
        <Badge label={ct.status} colors={CONTACT_STATUS_COLORS[ct.status]} />
        {ct.existingClient && <Badge label="Existing Client" colors={{ bg: '#F0FDF4', text: '#15803D' }} />}
      </div>

      {/* Contact info */}
      <div style={{ display: 'grid', gridTemplateColumns: mob ? '1fr' : '1fr 1fr', gap: mob ? 8 : 12, marginBottom: 16 }}>
        <ReadOnlyField label="Email" value={ct.email} />
        <ReadOnlyField label="Company" value={ct.company || '\u2014'} />
        <ReadOnlyField label="Source" value={ct.source || '\u2014'} />
        <ReadOnlyField label="Campaign Tag" value={ct.campaignTag || '\u2014'} />
        <ReadOnlyField label="Date Added" value={fmtDate(ct.dateAdded)} />
        <ReadOnlyField label="Added By" value={ct.addedBy || '\u2014'} />
      </div>

      {/* Flags */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        <FlagPill label="Replied" active={ct.replied} />
        <FlagPill label="Converted" active={ct.converted} />
        <FlagPill label="Bounced" active={ct.bounced} negative />
        <FlagPill label="Unsubscribed" active={ct.unsubscribed} negative />
      </div>

      {/* Suppression info */}
      {ct.suppressed && (
        <div style={{ marginBottom: 16, padding: 12, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#DC2626', marginBottom: 4 }}>Suppressed</div>
          <div style={{ fontSize: 12, color: '#991B1B' }}>Reason: {ct.suppressionReason || 'Manual'} \u00b7 Date: {fmtDate(ct.suppressionDate)}</div>
          {ct.manualReleaseNote && <div style={{ fontSize: 12, color: '#991B1B', marginTop: 4 }}>Release Note: {ct.manualReleaseNote}</div>}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <ActionBtn label="Edit Contact" icon={<Edit3 size={14} />} onClick={() => setShowEdit(true)} disabled={busy} />
        {ct.suppressed
          ? <ActionBtn label="Unsuppress" icon={<RotateCcw size={14} />} onClick={() => setConfirm({ action: 'unsuppress' })} disabled={busy} />
          : <ActionBtn label="Suppress" icon={<Ban size={14} />} variant="danger" onClick={() => setConfirm({ action: 'suppress' })} disabled={busy} />
        }
      </div>

      {/* Campaign history */}
      <SectionTitle title={`Campaign History (${detail.campaignHistory.length})`} />
      <div style={{ background: theme.colors.bgCard, border: `1px solid ${theme.colors.border}`, borderRadius: 12, overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: mob ? 450 : undefined }}>
          <thead>
            <tr style={{ background: '#FAFAFA' }}>
              {['Campaign', 'Status', 'Step', 'Last Contact', 'Replied', 'Bounced'].map(h => (
                <th key={h} style={{
                  padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700,
                  color: theme.colors.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.colors.border}`,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {detail.campaignHistory.map((cc, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${theme.colors.borderSubtle}` }}>
                <td style={{ padding: '8px 10px', fontWeight: 600 }}>{cc.campaignName}</td>
                <td style={{ padding: '8px 10px' }}><Badge label={cc.status} colors={CC_STATUS_COLORS[cc.status]} /></td>
                <td style={{ padding: '8px 10px' }}>{cc.currentStep}</td>
                <td style={{ padding: '8px 10px', fontSize: 11, color: theme.colors.textMuted }}>{fmtDate(cc.lastContactDate)}</td>
                <td style={{ padding: '8px 10px' }}>{cc.replied ? '\u2713' : '\u2014'}</td>
                <td style={{ padding: '8px 10px' }}>{cc.bounced ? '\u2713' : '\u2014'}</td>
              </tr>
            ))}
            {!detail.campaignHistory.length && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: theme.colors.textMuted }}>No campaign history</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {ct.notes && (
        <div style={{ marginTop: 12 }}><ReadOnlyField label="Notes" value={ct.notes} /></div>
      )}
    </div>
  );
}

// ─── Edit Contact Modal ─────────────────────────────────────────────────────

function EditContactModal({ contact, onClose, onSaved }: { contact: MarketingContact; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    firstName: contact.firstName,
    lastName: contact.lastName,
    company: contact.company,
    status: contact.status,
    existingClient: contact.existingClient,
    campaignTag: contact.campaignTag,
    source: contact.source,
    notes: contact.notes,
  });
  const { busy, result, setResult, run } = useWriteAction();

  const handleSave = async () => {
    const res = await run(
      () => postUpdateMarketingContact({ email: contact.email, ...form }),
      'Contact updated'
    );
    if (res.ok) { setTimeout(onSaved, 600); }
  };

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Modal title={`Edit: ${contact.firstName} ${contact.lastName}`} onClose={onClose} width={460} busy={busy}>
      {result && <ResultBanner result={result} onDismiss={() => setResult(null)} />}
      <div className="mktg-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
        <FormField label="First Name" info="The person's first name. Shows in emails wherever you use {{First Name}}.">
          <input style={inputStyle} value={form.firstName} onChange={e => set('firstName', e.target.value)} />
        </FormField>
        <FormField label="Last Name" info="The person's last name.">
          <input style={inputStyle} value={form.lastName} onChange={e => set('lastName', e.target.value)} />
        </FormField>
      </div>
      <FormField label="Company" info="Company name. Used in emails via {{Company}}.">
        <input style={inputStyle} value={form.company} onChange={e => set('company', e.target.value)} />
      </FormField>
      <div className="mktg-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
        <FormField label="Status" info="'Pending' = a lead. 'Client' = already a Stride customer. Campaigns can target one group or the other.">
          <select style={selectStyle} value={form.status} onChange={e => set('status', e.target.value)}>
            <option>Pending</option><option>Client</option>
          </select>
        </FormField>
        <FormField label="Campaign Tag" info="A label for grouping contacts (e.g. 'trade-show-2025'). Campaigns can target everyone with the same tag.">
          <input style={inputStyle} value={form.campaignTag} onChange={e => set('campaignTag', e.target.value)} />
        </FormField>
      </div>
      <FormField label="Source" info="Where this contact came from (Website, Referral, Trade Show, etc.). For your records.">
        <input style={inputStyle} value={form.source} onChange={e => set('source', e.target.value)} />
      </FormField>
      <FormField label="Notes" info="Any internal notes you want to keep about this contact. Only you see these — they do NOT get sent in emails.">
        <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
      </FormField>
      <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <input type="checkbox" checked={form.existingClient} onChange={e => set('existingClient', e.target.checked)} /> Existing Client
        <InfoTooltip text="Check if they're already a Stride customer. Keeps them out of cold-outreach campaigns." />
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <ActionBtn label="Cancel" onClick={onClose} />
        <ActionBtn label={busy ? 'Saving...' : 'Save Changes'} variant="primary" onClick={handleSave} disabled={busy} />
      </div>
    </Modal>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 5: TEMPLATES
// ═════════════════════════════════════════════════════════════════════════════

function TemplatesTab({ showCreate, onShowCreate, templates, refetchTemplates }: { showCreate: boolean; onShowCreate: (v: boolean) => void; templates: MarketingTemplate[]; refetchTemplates: () => void }) {
  const { isMobile: mob } = useIsMobile();
  const [search, setSearch] = useState('');
  const [editingTemplate, setEditingTemplate] = useState<MarketingTemplate | null>(null);

  const refetch = refetchTemplates;

  const filtered = useMemo(() => {
    if (!search) return templates;
    const q = search.toLowerCase();
    return templates.filter(t => t.name.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q));
  }, [templates, search]);

  const handleCreated = () => { setNextFetchNoCache(); refetch(); };

  return (
    <div>
      {showCreate && <CreateTemplateModal onClose={() => onShowCreate(false)} onCreated={handleCreated} />}
      {editingTemplate && (
        <EditTemplateModal template={editingTemplate} onClose={() => setEditingTemplate(null)} onSaved={() => { setEditingTemplate(null); setNextFetchNoCache(); refetch(); }} />
      )}

      {/* Action bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: mob ? 'wrap' : undefined }}>
        <div style={{ flex: 1, minWidth: mob ? '100%' : undefined, order: mob ? 1 : 0 }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: theme.colors.textMuted }} />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search templates..."
              style={{
                padding: '8px 12px 8px 30px', border: `1px solid ${theme.colors.border}`, borderRadius: 8,
                fontSize: 12, width: mob ? '100%' : 240, fontFamily: theme.typography.fontFamily, outline: 'none', boxSizing: 'border-box',
              }}
          />
          </div>
        </div>
        <button onClick={() => { setNextFetchNoCache(); refetch(); }} style={{
          background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 12, color: theme.colors.textMuted, fontFamily: theme.typography.fontFamily,
        }}><RefreshCw size={13} /> Refresh</button>
        <ActionBtn label="+ New Template" variant="primary" onClick={() => onShowCreate(true)} />
      </div>

      {/* Table */}
      <div style={{ background: theme.colors.bgCard, border: `1px solid ${theme.colors.border}`, borderRadius: 12, overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: mob ? 600 : undefined }}>
          <thead>
            <tr style={{ background: '#FAFAFA' }}>
              {['Template Name', 'Type', 'Subject', 'Preview Text', 'Active', 'Version', ''].map(h => (
                <th key={h} style={{
                  padding: '10px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700,
                  color: theme.colors.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.colors.border}`,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(t => (
              <tr key={t.name} style={{ borderBottom: `1px solid ${theme.colors.borderSubtle}`, opacity: t.active === false ? 0.5 : 1 }}
                onMouseEnter={e => (e.currentTarget.style.background = '#FAFAFA')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}>
                <td style={{ padding: '10px 12px', fontWeight: 600 }}>{t.name}</td>
                <td style={{ padding: '10px 12px' }}>
                  {t.type ? (
                    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: '#F1F5F9', color: '#475569' }}>{t.type}</span>
                  ) : '\u2014'}
                </td>
                <td style={{ padding: '10px 12px' }}>{t.subject}</td>
                <td style={{ padding: '10px 12px', color: theme.colors.textMuted, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.previewText || '\u2014'}</td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: t.active !== false ? '#ECFDF5' : '#FEF2F2', color: t.active !== false ? '#059669' : '#DC2626' }}>
                    {t.active !== false ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ padding: '10px 12px' }}>{t.version}</td>
                <td style={{ padding: '10px 12px' }}>
                  <button onClick={() => setEditingTemplate(t)} style={{
                    background: 'none', border: 'none', cursor: 'pointer', color: theme.colors.primary, fontSize: 11, fontWeight: 600,
                    fontFamily: theme.typography.fontFamily,
                  }}>Edit</button>
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: theme.colors.textMuted }}>No templates found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Merge Token Reference */}
      <div style={{
        marginTop: 16, padding: 16, background: '#F8FAFC', border: `1px solid ${theme.colors.border}`, borderRadius: 10,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Available Merge Tokens</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {MERGE_TOKENS.map(tk => (
            <span key={tk} style={{
              background: '#F1F5F9', padding: '2px 8px', borderRadius: 6,
              fontSize: 10, fontFamily: 'monospace', color: '#475569',
            }}>{tk}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Template Body Editor (shared between Create + Edit modals) ─────────────

function TemplateBodyEditor({ htmlBody, onChange, placeholder }: {
  htmlBody: string;
  onChange: (val: string) => void;
  placeholder?: string;
}) {
  const [mode, setMode] = useState<'html' | 'preview'>('html');
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.textSecondary }}>HTML Body *</span>
        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: `1px solid ${theme.colors.border}` }}>
          {(['html', 'preview'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding: '3px 12px', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
              background: mode === m ? theme.colors.orange : '#fff',
              color: mode === m ? '#fff' : theme.colors.textSecondary,
            }}>{m === 'html' ? 'HTML' : 'Preview'}</button>
          ))}
        </div>
      </div>
      {mode === 'html' ? (
        <>
          <textarea
            style={{ ...inputStyle, height: '60vh', minHeight: 300, resize: 'vertical', fontFamily: 'monospace', fontSize: 11 }}
            value={htmlBody} onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {MERGE_TOKENS.map(tk => (
              <button key={tk} onClick={() => onChange(htmlBody + tk)} style={{
                background: '#F1F5F9', padding: '2px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontSize: 10, fontFamily: 'monospace', color: '#475569',
              }}>{tk}</button>
            ))}
          </div>
        </>
      ) : (
        <div style={{
          border: `1px solid ${theme.colors.border}`, borderRadius: 8, overflow: 'hidden',
          height: '65vh', minHeight: 300, background: '#fff',
        }}>
          {htmlBody.trim() ? (
            <iframe
              title="Template Preview"
              srcDoc={htmlBody}
              sandbox=""
              style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            />
          ) : (
            <div style={{ padding: 24, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>
              Enter HTML in the HTML tab to see a preview
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Create Template Modal ──────────────────────────────────────────────────

const TEMPLATE_TYPES = ['Initial', 'Follow-Up 1', 'Follow-Up 2', 'Follow-Up 3', 'General'] as const;

function CreateTemplateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<CreateTemplatePayload>({ name: '', subject: '', previewText: '', htmlBody: '', type: 'General', active: true });
  const { busy, result, setResult, run } = useWriteAction();

  const handleSubmit = async () => {
    if (!form.name.trim()) { setResult({ ok: false, message: 'Template name is required' }); return; }
    if (!form.subject.trim()) { setResult({ ok: false, message: 'Subject line is required' }); return; }
    if (!form.htmlBody.trim()) { setResult({ ok: false, message: 'HTML body is required' }); return; }
    const res = await run(() => postCreateMarketingTemplate(form), 'Template created');
    if (res.ok) { setTimeout(() => { onCreated(); onClose(); }, 600); }
  };

  return (
    <Modal title="Create Template" onClose={onClose} width={1100} busy={busy}>
      {result && <ResultBanner result={result} onDismiss={() => setResult(null)} />}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
        <FormField label="Template Name *" info="A name to help YOU identify this template (e.g. 'Initial Outreach', 'Follow-Up 1'). Contacts never see this. Pick something memorable — you'll type this name when assigning the template to a campaign.">
          <input style={inputStyle} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Initial Outreach" />
        </FormField>
        <FormField label="Type" info="Organizational label to help you categorize templates. Doesn't restrict which campaign slot can use this template — any template can be assigned to any slot.">
          <select style={selectStyle} value={form.type || 'General'} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            {TEMPLATE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </FormField>
      </div>
      <FormField label="Subject Line *" info="The subject line the recipient sees in their inbox. You can personalize it with things like {{First Name}} or {{Company}}. Keep it short (under 60 characters) for best open rates.">
        <input style={inputStyle} value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="e.g. Quick question about {{Company}}" />
      </FormField>
      <FormField label="Preview Text" info="The gray text that shows next to the subject line in most inboxes (before they open the email). Use this as a second hook — a few words to make them click.">
        <input style={inputStyle} value={form.previewText} onChange={e => setForm(f => ({ ...f, previewText: e.target.value }))} />
      </FormField>
      <TemplateBodyEditor
        htmlBody={form.htmlBody}
        onChange={val => setForm(f => ({ ...f, htmlBody: val }))}
        placeholder="<p>Hi {{First Name}},</p>"
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <ActionBtn label="Cancel" onClick={onClose} />
        <ActionBtn label={busy ? 'Creating...' : 'Create Template'} variant="primary" onClick={handleSubmit} disabled={busy} />
      </div>
    </Modal>
  );
}

// ─── Edit Template Modal ────────────────────────────────────────────────────

function EditTemplateModal({ template, onClose, onSaved }: { template: MarketingTemplate; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    subject: template.subject,
    previewText: template.previewText,
    htmlBody: template.htmlBody,
    type: template.type || 'General',
    active: template.active !== false,
  });
  const { busy, result, setResult, run } = useWriteAction();

  const handleSave = async () => {
    const res = await run(
      () => postUpdateMarketingTemplate({ name: template.name, ...form }),
      'Template updated'
    );
    if (res.ok) { setTimeout(onSaved, 600); }
  };

  return (
    <Modal title={`Edit: ${template.name}`} onClose={onClose} width={1100} busy={busy}>
      {result && <ResultBanner result={result} onDismiss={() => setResult(null)} />}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
        <FormField label="Type" info="Organizational label for this template. Doesn't restrict which campaign slot can use it.">
          <select style={selectStyle} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            {TEMPLATE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </FormField>
        <FormField label="Active" info="When OFF, this template won't appear in campaign template dropdowns. Useful for retiring old templates without deleting them.">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0' }}>
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
              {form.active ? 'Active — visible in campaign dropdowns' : 'Inactive — hidden from campaign dropdowns'}
            </label>
          </div>
        </FormField>
      </div>
      <FormField label="Subject Line" info="The subject the recipient sees in their inbox. You can use {{First Name}} or {{Company}} to personalize it. Short is better.">
        <input style={inputStyle} value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
      </FormField>
      <FormField label="Preview Text" info="The gray preview text next to the subject in most inboxes. Treat it like a second subject line.">
        <input style={inputStyle} value={form.previewText} onChange={e => setForm(f => ({ ...f, previewText: e.target.value }))} />
      </FormField>
      <TemplateBodyEditor
        htmlBody={form.htmlBody}
        onChange={val => setForm(f => ({ ...f, htmlBody: val }))}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <ActionBtn label="Cancel" onClick={onClose} />
        <ActionBtn label={busy ? 'Saving...' : 'Save Changes'} variant="primary" onClick={handleSave} disabled={busy} />
      </div>
    </Modal>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 6: LOGS
// ═════════════════════════════════════════════════════════════════════════════

function LogsTab() {
  const { isMobile: mob } = useIsMobile();
  const [logType, setLogType] = useState<'campaign' | 'suppression'>('campaign');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 100;

  // Campaign logs
  const campaignLogsFetchFn = useCallback(
    (signal?: AbortSignal) => fetchMarketingLogs(signal, { logType: 'campaign', page: String(page), pageSize: String(pageSize) }),
    [page]
  );
  const { data: rawCampaign, loading: loadingCampaign, error: errCampaign, refetch: refetchCampaign } = useApiData(
    campaignLogsFetchFn, logType === 'campaign', `mktg-logs-campaign-${page}`,
  );
  // Suppression logs
  const suppressionLogsFetchFn = useCallback(
    (signal?: AbortSignal) => fetchMarketingSuppressionLogs(signal, { page: String(page), pageSize: String(pageSize) }),
    [page]
  );
  const { data: rawSuppression, loading: loadingSuppression, error: errSuppression, refetch: refetchSuppression } = useApiData(
    suppressionLogsFetchFn, logType === 'suppression', `mktg-logs-suppression-${page}`,
  );

  const campaignLogs = useMemo(() => {
    if (!rawCampaign) return { logs: [] as CampaignLogEntry[], total: 0 };
    const d = (rawCampaign as any)?.data ?? rawCampaign;
    return { logs: (d?.logs ?? []) as CampaignLogEntry[], total: d?.total ?? 0 };
  }, [rawCampaign]);

  const suppressionLogs = useMemo(() => {
    if (!rawSuppression) return { logs: [] as SuppressionLogEntry[], total: 0 };
    const d = (rawSuppression as any)?.data ?? rawSuppression;
    return { logs: (d?.logs ?? []) as SuppressionLogEntry[], total: d?.total ?? 0 };
  }, [rawSuppression]);

  const isLoading = logType === 'campaign' ? loadingCampaign : loadingSuppression;
  const err = logType === 'campaign' ? errCampaign : errSuppression;
  const total = logType === 'campaign' ? campaignLogs.total : suppressionLogs.total;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const filteredCampaignLogs = useMemo(() => {
    if (!search) return campaignLogs.logs;
    const q = search.toLowerCase();
    return campaignLogs.logs.filter(l =>
      l.email.toLowerCase().includes(q) || l.contactName.toLowerCase().includes(q) ||
      l.campaignName.toLowerCase().includes(q) || l.subject.toLowerCase().includes(q)
    );
  }, [campaignLogs.logs, search]);

  const filteredSuppressionLogs = useMemo(() => {
    if (!search) return suppressionLogs.logs;
    const q = search.toLowerCase();
    return suppressionLogs.logs.filter(l =>
      l.email.toLowerCase().includes(q) || l.firstName.toLowerCase().includes(q) ||
      l.company.toLowerCase().includes(q) || l.reason.toLowerCase().includes(q)
    );
  }, [suppressionLogs.logs, search]);

  const handleExportCsv = useCallback(() => {
    if (logType === 'campaign') {
      downloadCsv(filteredCampaignLogs as unknown as Record<string, unknown>[], 'campaign_log.csv');
    } else {
      downloadCsv(filteredSuppressionLogs as unknown as Record<string, unknown>[], 'suppression_log.csv');
    }
  }, [logType, filteredCampaignLogs, filteredSuppressionLogs]);

  return (
    <div>
      {/* Log type sub-tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button onClick={() => { setLogType('campaign'); setPage(1); setSearch(''); }} style={{
          padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 20, cursor: 'pointer',
          border: `1px solid ${logType === 'campaign' ? theme.colors.primary : theme.colors.border}`,
          background: logType === 'campaign' ? theme.colors.orangeLight : theme.colors.bgCard,
          color: logType === 'campaign' ? theme.colors.primary : theme.colors.text,
          fontFamily: theme.typography.fontFamily,
        }}>Campaign Log</button>
        <button onClick={() => { setLogType('suppression'); setPage(1); setSearch(''); }} style={{
          padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 20, cursor: 'pointer',
          border: `1px solid ${logType === 'suppression' ? theme.colors.primary : theme.colors.border}`,
          background: logType === 'suppression' ? theme.colors.orangeLight : theme.colors.bgCard,
          color: logType === 'suppression' ? theme.colors.primary : theme.colors.text,
          fontFamily: theme.typography.fontFamily,
        }}>Suppression Log</button>
      </div>

      {/* Action bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: mob ? 'wrap' : undefined }}>
        <button onClick={handleExportCsv} style={{
          padding: '8px 16px', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
          border: `1px solid ${theme.colors.border}`, background: theme.colors.bgCard, color: theme.colors.text,
          display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: theme.typography.fontFamily,
        }}><Download size={14} /> Export CSV</button>
        <div style={{ flex: 1, minWidth: mob ? '100%' : undefined, order: mob ? 1 : 0 }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: theme.colors.textMuted }} />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search logs..."
              style={{
                padding: '8px 12px 8px 30px', border: `1px solid ${theme.colors.border}`, borderRadius: 8,
                fontSize: 12, width: mob ? '100%' : 240, fontFamily: theme.typography.fontFamily, outline: 'none', boxSizing: 'border-box',
              }}
          />
          </div>
        </div>
        <button onClick={() => {
          setNextFetchNoCache();
          logType === 'campaign' ? refetchCampaign() : refetchSuppression();
        }} style={{
          background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 12, color: theme.colors.textMuted, fontFamily: theme.typography.fontFamily,
        }}><RefreshCw size={13} /> Refresh</button>
      </div>

      {isLoading && <Spinner />}
      {err && <ErrorMsg msg={err} />}

      {!isLoading && !err && logType === 'campaign' && (
        <div style={{ background: theme.colors.bgCard, border: `1px solid ${theme.colors.border}`, borderRadius: 12, overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: mob ? 600 : undefined }}>
            <thead>
              <tr style={{ background: '#FAFAFA' }}>
                {['Timestamp', 'Campaign', 'Contact', 'Email', 'Result', 'Details'].map(h => (
                  <th key={h} style={{
                    padding: '10px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700,
                    color: theme.colors.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.colors.border}`,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredCampaignLogs.map((l, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${theme.colors.borderSubtle}` }}>
                  <td style={{ padding: '10px 12px', fontSize: 11, color: theme.colors.textMuted }}>{fmtDateTime(l.timestamp)}</td>
                  <td style={{ padding: '10px 12px' }}>{l.campaignName}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>{l.contactName}</td>
                  <td style={{ padding: '10px 12px' }}>{l.email}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <Badge label={l.result} colors={LOG_RESULT_COLORS[l.result]} />
                    {l.testModeUsed && <span style={{ fontSize: 9, color: theme.colors.textMuted, marginLeft: 4 }}>[TEST]</span>}
                  </td>
                  <td style={{ padding: '10px 12px', color: theme.colors.textMuted }}>{l.emailStep}{l.errorMessage ? ` \u2014 ${l.errorMessage}` : ''}</td>
                </tr>
              ))}
              {!filteredCampaignLogs.length && (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: theme.colors.textMuted }}>No campaign log entries</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && !err && logType === 'suppression' && (
        <div style={{ background: theme.colors.bgCard, border: `1px solid ${theme.colors.border}`, borderRadius: 12, overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: mob ? 500 : undefined }}>
            <thead>
              <tr style={{ background: '#FAFAFA' }}>
                {['Timestamp', 'Email', 'Name', 'Company', 'Reason', 'Triggered By'].map(h => (
                  <th key={h} style={{
                    padding: '10px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700,
                    color: theme.colors.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.colors.border}`,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredSuppressionLogs.map((l, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${theme.colors.borderSubtle}` }}>
                  <td style={{ padding: '10px 12px', fontSize: 11, color: theme.colors.textMuted }}>{fmtDateTime(l.timestamp)}</td>
                  <td style={{ padding: '10px 12px' }}>{l.email}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>{l.firstName}</td>
                  <td style={{ padding: '10px 12px' }}>{l.company || '\u2014'}</td>
                  <td style={{ padding: '10px 12px' }}>{l.reason}</td>
                  <td style={{ padding: '10px 12px', color: theme.colors.textMuted }}>{l.triggeredBy}</td>
                </tr>
              ))}
              {!filteredSuppressionLogs.length && (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: theme.colors.textMuted }}>No suppression log entries</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {!isLoading && !err && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <span style={{ fontSize: 11, color: theme.colors.textMuted }}>
            Page {page} of {totalPages} \u00b7 {total.toLocaleString()} entries
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{
              border: `1px solid ${theme.colors.border}`, background: theme.colors.bgCard, borderRadius: 6,
              padding: '4px 8px', cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.4 : 1,
            }}><ChevronLeft size={14} /></button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} style={{
              border: `1px solid ${theme.colors.border}`, background: theme.colors.bgCard, borderRadius: 6,
              padding: '4px 8px', cursor: page >= totalPages ? 'default' : 'pointer', opacity: page >= totalPages ? 0.4 : 1,
            }}><ChevronRight size={14} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 7: SETTINGS
// ═════════════════════════════════════════════════════════════════════════════

function SettingsTab() {
  const { isMobile: mob } = useIsMobile();
  const settingsFetchFn = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const sb = await fetchMarketingSettingsFromSupabase();
        if (sb) {
          return { data: { success: true, data: sb }, ok: true as const, error: null };
        }
      } catch { /* fall through to GAS */ }
      return fetchMarketingSettings(signal);
    },
    []
  );
  const { data: raw, loading, error, refetch } = useApiData(
    settingsFetchFn, true, 'mktg-settings',
  );
  const { busy, result, setResult, run } = useWriteAction();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<MarketingSettings | null>(null);

  const settings: MarketingSettings | null = useMemo(() => {
    if (!raw) return null;
    const d = (raw as any)?.data ?? raw;
    return d as MarketingSettings;
  }, [raw]);

  useEffect(() => {
    if (settings && !form) setForm({ ...settings });
  }, [settings, form]);

  const handleSave = async () => {
    if (!form) return;
    const res = await run(() => postUpdateMarketingSettings(form), 'Settings saved');
    if (res.ok) {
      setEditing(false);
      setNextFetchNoCache();
      refetch();
    }
  };

  if (loading) return <Spinner />;
  if (error) return <ErrorMsg msg={error} />;
  if (!settings) return <EmptyState msg="No settings available" />;

  const displayData = form || settings;
  const set = (k: keyof MarketingSettings, v: string) => setForm(f => f ? { ...f, [k]: v } : f);

  return (
    <div style={{ maxWidth: mob ? '100%' : 600 }}>
      {result && <ResultBanner result={result} onDismiss={() => setResult(null)} />}

      {/* Sender Configuration */}
      <div style={{
        background: theme.colors.bgCard, border: `1px solid ${theme.colors.border}`, borderRadius: 12,
        padding: mob ? 16 : 24, marginBottom: 16,
      }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Sender Configuration</h3>
        <div style={{ display: 'grid', gridTemplateColumns: mob ? '1fr' : '1fr 1fr', gap: mob ? 8 : 12 }}>
          {editing ? (
            <>
              <FormField label="Send From Email" info="The email address that campaigns will be sent FROM. Must be an address you can actually send from in Gmail (either your own account or a verified alias). Example: SeattleReceiver@stridenw.com.">
                <input style={inputStyle} value={displayData.sendFromEmail} onChange={e => set('sendFromEmail', e.target.value)} />
              </FormField>
              <FormField label="Sender Name" info="The name recipients see in their inbox (e.g. 'Justin from Stride Logistics'). This shows up next to the email address when they receive it.">
                <input style={inputStyle} value={displayData.senderName} onChange={e => set('senderName', e.target.value)} />
              </FormField>
              <FormField label="Reply-To Email" info="When someone hits Reply on one of your campaign emails, their reply goes to THIS address. Usually you want this to be the person who actually watches the inbox.">
                <input style={inputStyle} value={displayData.senderEmail} onChange={e => set('senderEmail', e.target.value)} />
              </FormField>
              <FormField label="Phone Number" info="Your contact phone number. Shows up in email signatures wherever you put {{Phone}} in the template.">
                <input style={inputStyle} value={displayData.senderPhone} onChange={e => set('senderPhone', e.target.value)} />
              </FormField>
            </>
          ) : (
            <>
              <ReadOnlyField label="Send From Email" value={displayData.sendFromEmail} />
              <ReadOnlyField label="Sender Name" value={displayData.senderName} />
              <ReadOnlyField label="Reply-To Email" value={displayData.senderEmail} />
              <ReadOnlyField label="Phone Number" value={displayData.senderPhone} />
            </>
          )}
        </div>
        {editing ? (
          <>
            <FormField label="Website URL" info="Your company website. Shows in emails via {{Website}}. Example: https://www.stridenw.com">
              <input style={inputStyle} value={displayData.websiteUrl} onChange={e => set('websiteUrl', e.target.value)} />
            </FormField>
            <FormField label="Booking URL" info="A link where people can book a call or meeting with you (Calendly, HubSpot, etc.). Used in emails via {{Booking URL}} for 'schedule a call' buttons.">
              <input style={inputStyle} value={displayData.bookingUrl} onChange={e => set('bookingUrl', e.target.value)} />
            </FormField>
          </>
        ) : (
          <>
            <ReadOnlyField label="Website URL" value={displayData.websiteUrl} />
            <ReadOnlyField label="Booking URL" value={displayData.bookingUrl} />
          </>
        )}
      </div>

      {/* Daily Digest */}
      <div style={{
        background: theme.colors.bgCard, border: `1px solid ${theme.colors.border}`, borderRadius: 12,
        padding: 24, marginBottom: 16,
      }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Daily Digest</h3>
        {editing ? (
          <FormField label="Digest Recipient" info="Every morning, an automatic summary email is sent with yesterday's campaign activity (sent, replies, bounces, new leads). This is the address that receives that daily report. Usually your own email.">
            <input style={inputStyle} value={displayData.dailyDigestEmail} onChange={e => set('dailyDigestEmail', e.target.value)} />
          </FormField>
        ) : (
          <ReadOnlyField label="Digest Recipient" value={displayData.dailyDigestEmail} />
        )}
      </div>

      {/* Unsubscribe */}
      <div style={{
        background: theme.colors.bgCard, border: `1px solid ${theme.colors.border}`, borderRadius: 12,
        padding: 24, marginBottom: 16,
      }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Unsubscribe</h3>
        {editing ? (
          <FormField label="Unsubscribe Web App URL" info="The link recipients click when they want to stop receiving emails. Every campaign email includes an unsubscribe link pointing here (legally required). Leave as-is unless you've been told to change it — Justin or your developer will set this up for you.">
            <input style={inputStyle} value={displayData.unsubscribeBaseUrl} onChange={e => set('unsubscribeBaseUrl', e.target.value)} />
          </FormField>
        ) : (
          <ReadOnlyField label="Unsubscribe Web App URL" value={displayData.unsubscribeBaseUrl} />
        )}
      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        {editing ? (
          <>
            <ActionBtn label="Cancel" onClick={() => { setEditing(false); setForm(settings ? { ...settings } : null); }} />
            <ActionBtn label={busy ? 'Saving...' : 'Save Settings'} variant="primary" onClick={handleSave} disabled={busy} />
          </>
        ) : (
          <ActionBtn label="Edit Settings" icon={<Edit3 size={14} />} variant="primary" onClick={() => setEditing(true)} />
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SHARED UI HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function SectionTitle({ title }: { title: string }) {
  return (
    <div style={{
      fontSize: 13, fontWeight: 700, margin: '16px 0 8px', paddingBottom: 6,
      borderBottom: `1px solid ${theme.colors.borderSubtle}`,
    }}>{title}</div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: theme.colors.textMuted, marginBottom: 3 }}>{label}</div>
      <div style={{
        padding: '8px 12px', border: `1px solid ${theme.colors.border}`, borderRadius: 8,
        fontSize: 12, background: '#FAFAFA', color: theme.colors.text, minHeight: 18,
        wordBreak: 'break-all',
      }}>{value}</div>
    </div>
  );
}

function FlagPill({ label, active, negative }: { label: string; active: boolean; negative?: boolean }) {
  const bg = !active ? '#F3F4F6' : negative ? '#FEF2F2' : '#F0FDF4';
  const text = !active ? '#9CA3AF' : negative ? '#DC2626' : '#15803D';
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
      background: bg, color: text,
    }}>
      {active ? '\u2713' : '\u2014'} {label}
    </span>
  );
}
