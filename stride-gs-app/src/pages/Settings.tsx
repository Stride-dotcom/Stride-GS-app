import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon, Users, DollarSign, Mail, Database, Globe, Bell, Plus, ChevronRight, CheckCircle2, AlertCircle, UserPlus, Shield, ToggleLeft, ToggleRight, Eye, EyeOff, Wifi, WifiOff, RefreshCw, Loader2, RefreshCcw, ExternalLink, Wrench, PlayCircle, Send, FolderSync, BookText, LogIn, Cloud, Edit2, Zap, ArrowUpDown, ChevronUp, ChevronDown, X } from 'lucide-react';
import { useReactTable, getCoreRowModel, getSortedRowModel, flexRender, type SortingState, type ColumnDef } from '@tanstack/react-table';
import { getApiUrl, getApiToken, setApiCredentials, isApiConfigured, fetchHealth, postOnboardClient, postUpdateClient, postSyncSettings, postRefreshCaches, postFixMissingFolders, postTestSendClientTemplates, postTestSendClaimEmails, fetchAutoIdSetting, postUpdateAutoIdSetting, postResolveOnboardUser, fetchStaxConfig, postUpdateStaxConfig, apiPost, fetchEmailTemplates, postSyncTemplatesToClients, postBulkSyncToSupabase, postPurgeInactiveFromSupabase, fetchClients, postFinishClientSetup, postSendWelcomeToUsers, resyncUsersPreview, resyncUsers, resyncClientsPreview, resyncClients, setNextFetchNoCache } from '../lib/api';
import type { BulkSyncResult } from '../lib/api';
import type { EmailTemplate } from '../lib/api';
import { entityEvents } from '../lib/entityEvents';
import { TemplateEditor } from '../components/shared/TemplateEditor';
import { ConfirmDialog } from '../components/shared/ConfirmDialog';
import { useAuth } from '../contexts/AuthContext';
import { AutocompleteInput } from '../components/shared/AutocompleteInput';
import type { ApiClient, OnboardClientResponse, UpdateClientResponse, SyncSettingsResponse, RefreshCachesResponse, RunOnClientsResponse, TestSendResult } from '../lib/api';
import { OnboardClientModal } from '../components/shared/OnboardClientModal';
import type { OnboardClientFormData } from '../components/shared/OnboardClientModal';

import { useClients } from '../hooks/useClients';
import { usePricing } from '../hooks/usePricing';
import { useLocations } from '../hooks/useLocations';
import { useUsers } from '../hooks/useUsers';
import type { ApiUser } from '../lib/api';
import { theme } from '../styles/theme';
import { WriteButton } from '../components/shared/WriteButton';
import { QBOConnect } from '../components/settings/QBOConnect';

type Tab = 'general' | 'clients' | 'users' | 'pricing' | 'emails' | 'integrations' | 'notifications' | 'maintenance';

const TABS: { id: Tab; label: string; icon: any; desc: string }[] = [
  { id: 'general', label: 'General', icon: SettingsIcon, desc: 'System settings and preferences' },
  { id: 'clients', label: 'Clients', icon: Users, desc: 'Client accounts and onboarding' },
  { id: 'users', label: 'Users', icon: Shield, desc: 'User access and role management' },
  { id: 'pricing', label: 'Pricing', icon: DollarSign, desc: 'Service rates and class maps' },
  { id: 'emails', label: 'Email Templates', icon: Mail, desc: 'All email & document templates — edit, preview, test send, sync' },
  { id: 'integrations', label: 'Integrations', icon: Globe, desc: 'QuickBooks, Stax, and external services' },
  { id: 'notifications', label: 'Notifications', icon: Bell, desc: 'Alert preferences and triggers' },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench, desc: 'Cache refresh, headers, and triggers' },
];

const EMAIL_TEMPLATES = [
  { key: 'SHIPMENT_RECEIVED', name: 'Shipment Received', desc: 'Sent when a new shipment is completed', active: true },
  { key: 'INSP_EMAIL', name: 'Inspection Complete', desc: 'Sent when an inspection task is completed with result', active: true },
  { key: 'TASK_COMPLETE', name: 'Task Complete', desc: 'Sent when a non-inspection task is completed', active: true },
  { key: 'REPAIR_QUOTE', name: 'Repair Quote', desc: 'Sent to client with repair cost estimate', active: true },
  { key: 'REPAIR_QUOTE_REQUEST', name: 'Repair Quote Request', desc: 'Internal alert when client requests a repair quote', active: true },
  { key: 'REPAIR_COMPLETE', name: 'Repair Complete', desc: 'Sent when repair is finished', active: true },
  { key: 'REPAIR_APPROVED', name: 'Repair Approved', desc: 'Internal alert when client approves a repair', active: true },
  { key: 'REPAIR_DECLINED', name: 'Repair Declined', desc: 'Internal alert when client declines a repair', active: false },
  { key: 'WILL_CALL_CREATED', name: 'Will Call Created', desc: 'Sent when a new will call is created', active: true },
  { key: 'WILL_CALL_RELEASE', name: 'Will Call Release', desc: 'Sent when items are released for pickup', active: true },
  { key: 'WILL_CALL_CANCELLED', name: 'Will Call Cancelled', desc: 'Sent when a will call is cancelled', active: true },
  { key: 'TRANSFER_RECEIVED', name: 'Transfer Received', desc: 'Sent when items are transferred between clients', active: true },
];

const CLAIM_EMAIL_TEMPLATES = [
  { key: 'CLAIM_RECEIVED', name: 'Claim Received', desc: 'Sent to client confirming claim submission' },
  { key: 'CLAIM_STAFF_NOTIFY', name: 'New Claim — Internal', desc: 'Staff alert when a new claim is filed (to notification emails)' },
  { key: 'CLAIM_MORE_INFO', name: 'Information Needed', desc: 'Sent to client requesting additional details' },
  { key: 'CLAIM_DENIAL', name: 'Claim Denial', desc: 'Sent to client with denial decision' },
  { key: 'CLAIM_SETTLEMENT', name: 'Settlement Offer', desc: 'Sent to client with settlement amount (PDF attached)' },
];

const SYSTEM_TEMPLATES = [
  { key: 'WELCOME_EMAIL', name: 'Welcome Email', desc: 'Sent to new client when account is created' },
  { key: 'ONBOARDING_EMAIL', name: 'Onboarding / Getting Started', desc: 'Setup instructions and getting started guide for new clients' },
];

const DOC_TEMPLATES = [
  { key: 'DOC_RECEIVING', name: 'Receiving Document', desc: 'PDF receipt generated when a shipment is completed' },
  { key: 'DOC_TASK_WORK_ORDER', name: 'Task Work Order', desc: 'PDF work order generated from task detail panel' },
  { key: 'DOC_REPAIR_WORK_ORDER', name: 'Repair Work Order', desc: 'PDF work order for repairs' },
  { key: 'DOC_WILL_CALL_RELEASE', name: 'Will Call Release', desc: 'PDF release document for will call pickups' },
];

const MOCK_PRICING = [
  { code: 'RCVG', name: 'Receiving', xs: 5, s: 8, m: 12, l: 20, xl: 35 },
  { code: 'INSP', name: 'Inspection', xs: 5, s: 8, m: 12, l: 20, xl: 35 },
  { code: 'ASM', name: 'Assembly', xs: 25, s: 35, m: 50, l: 70, xl: 100 },
  { code: 'STOR', name: 'Storage (per day)', xs: 0.15, s: 0.25, m: 0.50, l: 0.75, xl: 1.10 },
  { code: 'DLVR', name: 'Delivery', xs: 25, s: 35, m: 50, l: 85, xl: 120 },
  { code: 'WCPU', name: 'Will Call Pickup', xs: 5, s: 10, m: 15, l: 20, xl: 25 },
];

const card: React.CSSProperties = { background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12, padding: 20, marginBottom: 16 };
const input: React.CSSProperties = { width: '100%', padding: '9px 12px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, outline: 'none', fontFamily: 'inherit' };
const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 12 };
const fieldLabel: React.CSSProperties = { fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 3 };

function MaskedField({ label, value, fieldName, onChange }: { label: string; value: string; fieldName: string; onChange?: (val: string) => void }) {
  const [revealed, setRevealed] = useState(false);
  const [val, setVal] = useState(value);
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVal(e.target.value);
    onChange?.(e.target.value);
  };
  return (
    <div>
      <label style={fieldLabel}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          value={val}
          onChange={handleChange}
          type={revealed ? 'text' : 'password'}
          name={fieldName}
          style={{ ...input, paddingRight: 36, fontFamily: revealed ? 'inherit' : 'monospace' }}
        />
        <button
          type="button"
          onClick={() => setRevealed(v => !v)}
          style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: theme.colors.textMuted }}
        >
          {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );
}

function ApiConfigCard() {
  const [url, setUrl] = useState(getApiUrl());
  const [token, setToken] = useState(getApiToken());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const configured = isApiConfigured();

  async function handleTest() {
    setApiCredentials(url, token);
    setTesting(true);
    setTestResult(null);
    const result = await fetchHealth();
    setTesting(false);
    if (result.ok && result.data) {
      setTestResult({ ok: true, message: `Connected — API ${result.data.version} (${new Date(result.data.timestamp).toLocaleTimeString()})` });
    } else {
      setTestResult({ ok: false, message: result.error || 'Connection failed' });
    }
  }

  function handleSave() {
    setApiCredentials(url, token);
    setTestResult(null);
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: configured ? '#F0FDF4' : '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {configured ? <Wifi size={16} color="#15803D" /> : <WifiOff size={16} color="#B45309" />}
        </div>
        <div>
          <div style={sectionTitle}>Stride API Connection</div>
          <div style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: -8 }}>Connect the app to your Google Sheets data via Apps Script API</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14, marginBottom: 16 }}>
        <div>
          <label style={fieldLabel}>API URL (Apps Script Web App URL)</label>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/.../exec" style={{ ...input, fontFamily: 'monospace', fontSize: 11 }} />
        </div>
        <MaskedField label="API Token" value={token} fieldName="api_token" onChange={setToken} />
      </div>

      {testResult && (
        <div style={{ marginBottom: 14, padding: '8px 12px', borderRadius: 8, fontSize: 12, background: testResult.ok ? '#F0FDF4' : '#FEF2F2', border: `1px solid ${testResult.ok ? '#BBF7D0' : '#FECACA'}`, color: testResult.ok ? '#15803D' : '#DC2626' }}>
          {testResult.ok ? <CheckCircle2 size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} /> : <AlertCircle size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} />}
          {testResult.message}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={handleSave} style={{ padding: '8px 18px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: theme.colors.orange, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Save</button>
        <button onClick={handleTest} disabled={testing || !url} style={{ padding: '8px 18px', fontSize: 12, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: testing ? 'wait' : 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: 6, opacity: testing || !url ? 0.6 : 1 }}>
          {testing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
          Test Connection
        </button>
      </div>
    </div>
  );
}

function IntegrationsTab() {
  const [staxEnv, setStaxEnv] = useState<'sandbox' | 'production'>('production');
  const [staxApiKey, setStaxApiKey] = useState('');
  const [staxPayUrl, setStaxPayUrl] = useState('');
  const [cbSpreadsheetId, setCbSpreadsheetId] = useState('');
  const [iifFolderId, setIifFolderId] = useState('');
  const [staxLoading, setStaxLoading] = useState(true);
  const [staxSaving, setStaxSaving] = useState(false);
  const [staxResult, setStaxResult] = useState<string | null>(null);
  const [staxError, setStaxError] = useState<string | null>(null);

  // Load real config from API on mount
  useEffect(() => {
    (async () => {
      setStaxLoading(true);
      const res = await fetchStaxConfig();
      if (res.ok && res.data) {
        const c = res.data.config as Record<string, string>;
        setStaxEnv((c.ENVIRONMENT || 'production').toLowerCase() === 'sandbox' ? 'sandbox' : 'production');
        setStaxApiKey(c.STAX_API_KEY || '');
        setStaxPayUrl(c.STAX_INVOICE_PAY_URL || 'https://secure.staxpayments.com/invoices/');
        setCbSpreadsheetId(c.CB_SPREADSHEET_ID || '');
        setIifFolderId(c.IIF_FOLDER_ID || '');
      }
      setStaxLoading(false);
    })();
  }, []);

  const handleSaveStaxConfig = async () => {
    setStaxSaving(true); setStaxResult(null); setStaxError(null);
    const updates: Array<{ key: string; value: string }> = [
      { key: 'ENVIRONMENT', value: staxEnv },
      { key: 'STAX_API_KEY', value: staxApiKey },
      { key: 'STAX_INVOICE_PAY_URL', value: staxPayUrl },
      { key: 'CB_SPREADSHEET_ID', value: cbSpreadsheetId },
      { key: 'IIF_FOLDER_ID', value: iifFolderId },
    ];
    let errors: string[] = [];
    let saved: string[] = [];
    for (const u of updates) {
      if (!u.value) continue;
      // Don't send masked API key back — it would overwrite the real key with dots
      if (u.key === 'STAX_API_KEY' && u.value.startsWith('••')) { saved.push(u.key + ' (unchanged)'); continue; }
      try {
        const res = await postUpdateStaxConfig(u.key, u.value);
        if (res.ok && res.data?.success) { saved.push(u.key); }
        else { errors.push(`${u.key}: ${res.error || JSON.stringify(res.data) || 'failed'}`); }
      } catch (e) { errors.push(`${u.key}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    setStaxSaving(false);
    if (errors.length) setStaxError('Failed: ' + errors.join('; '));
    else setStaxResult('Saved: ' + saved.join(', '));
  };

  return (
    <>
      {/* API Connection Config */}
      <ApiConfigCard />

      {/* Stax Configuration Section */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: theme.colors.orangeLight, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Globe size={16} color={theme.colors.orange} />
          </div>
          <div>
            <div style={sectionTitle}>Stax Payments Configuration</div>
            <div style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: -8 }}>API keys, environment, and linked Google resources</div>
          </div>
        </div>

        {staxLoading ? (
          <div style={{ padding: 20, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>Loading Stax configuration...</div>
        ) : (
          <>
            {/* Environment Toggle */}
            <div style={{ marginBottom: 16 }}>
              <label style={fieldLabel}>Environment</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['sandbox', 'production'] as const).map(env => (
                  <button
                    key={env}
                    onClick={() => setStaxEnv(env)}
                    style={{
                      padding: '8px 20px', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                      border: `2px solid ${staxEnv === env ? (env === 'production' ? '#DC2626' : theme.colors.orange) : theme.colors.border}`,
                      background: staxEnv === env ? (env === 'production' ? '#FEF2F2' : theme.colors.orangeLight) : '#fff',
                      color: staxEnv === env ? (env === 'production' ? '#DC2626' : theme.colors.orange) : theme.colors.textSecondary,
                      textTransform: 'capitalize', transition: 'all 0.15s',
                    }}
                  >
                    {env}
                    {env === 'production' && staxEnv === 'production' && (
                      <span style={{ marginLeft: 6, fontSize: 10, background: '#DC2626', color: '#fff', padding: '1px 6px', borderRadius: 8, fontWeight: 700 }}>LIVE</span>
                    )}
                  </button>
                ))}
              </div>
              {staxEnv === 'production' && (
                <div style={{ marginTop: 8, padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12, color: '#DC2626' }}>
                  ⚠ Production mode — charges will be real. Confirm before saving.
                </div>
              )}
            </div>

            {/* API Key + Pay URL */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
              <MaskedField label="STAX_API_KEY" value={staxApiKey} fieldName="stax_api_key" onChange={setStaxApiKey} />
              <div>
                <label style={fieldLabel}>STAX_INVOICE_PAY_URL</label>
                <input value={staxPayUrl} onChange={e => setStaxPayUrl(e.target.value)} style={{ ...input, fontFamily: 'monospace', fontSize: 11 }} />
              </div>
            </div>

            {/* Google Drive Fields */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: theme.colors.textSecondary, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Database size={13} /> Google Drive Settings
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={fieldLabel}>CB_SPREADSHEET_ID</label>
                  <input value={cbSpreadsheetId} onChange={e => setCbSpreadsheetId(e.target.value)} style={{ ...input, fontFamily: 'monospace', fontSize: 11 }} />
                </div>
                <div>
                  <label style={fieldLabel}>IIF_FOLDER_ID</label>
                  <input value={iifFolderId} onChange={e => setIifFolderId(e.target.value)} style={{ ...input, fontFamily: 'monospace', fontSize: 11 }} />
                </div>
              </div>
            </div>

            {/* Status */}
            <div style={{ padding: 12, background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, marginBottom: 16, display: 'flex', gap: 16 }}>
              {[
                { label: 'API Status', value: staxApiKey ? 'Connected' : 'No Key', ok: !!staxApiKey },
                { label: 'Environment', value: staxEnv === 'sandbox' ? 'Sandbox' : 'Production', ok: staxEnv === 'sandbox' },
                { label: 'Spreadsheet', value: cbSpreadsheetId ? 'Linked' : 'Not Set', ok: !!cbSpreadsheetId },
                { label: 'IIF Folder', value: iifFolderId ? 'Linked' : 'Not Set', ok: !!iifFolderId },
              ].map(s => (
                <div key={s.label} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: s.ok ? '#15803D' : '#B45309' }}>{s.value}</div>
                </div>
              ))}
            </div>

            {staxResult && <div style={{ padding: '8px 12px', marginBottom: 12, borderRadius: 8, background: '#F0FDF4', border: '1px solid #BBF7D0', fontSize: 12, color: '#166534', display: 'flex', alignItems: 'center', gap: 6 }}><CheckCircle2 size={14} /> {staxResult}</div>}
            {staxError && <div style={{ padding: '8px 12px', marginBottom: 12, borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 12, color: '#DC2626' }}>{staxError}</div>}

            <WriteButton
              label={staxSaving ? 'Saving...' : 'Save Stax Configuration'}
              variant="primary"
              disabled={staxSaving}
              onClick={handleSaveStaxConfig}
            />
          </>
        )}
      </div>

      {/* QuickBooks Online Connection */}
      <QBOConnect />
    </>
  );
}

interface HealthIssue { type: 'error' | 'warning' | 'info'; title: string; fix: string }
interface HealthResult { name: string; passed: boolean; issueCount: number; errorCount: number; warningCount: number; infoCount: number; inventoryCount: number; issues: HealthIssue[] }

function HealthCheckCard() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<HealthResult[] | null>(null);
  const [summary, setSummary] = useState<{ passed: number; failed: number } | null>(null);
  const [error, setError] = useState('');

  const run = async () => {
    setLoading(true); setError(''); setResults(null); setSummary(null);
    try {
      const res = await apiPost<{ success: boolean; passed: number; failed: number; results: HealthResult[] }>('healthCheck', {});
      if (res.ok && res.data) {
        setResults(res.data.results);
        setSummary({ passed: res.data.passed, failed: res.data.failed });
      } else { setError(res.error || 'Health check failed'); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setLoading(false);
  };

  const issueIcon = (type: string) => type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
  const issueColor = (type: string) => type === 'error' ? '#DC2626' : type === 'warning' ? '#B45309' : '#2563EB';

  return (
    <div style={{ padding: '18px 22px', background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Shield size={18} color={theme.colors.orange} />
            <div style={{ fontSize: 14, fontWeight: 600 }}>System Health Check</div>
          </div>
          <div style={{ fontSize: 12, color: theme.colors.textMuted, lineHeight: 1.5 }}>
            Checks all client accounts for missing tabs, cache data, settings, email configuration, and Web App URLs.
            Shows what needs attention with step-by-step instructions to fix each issue.
          </div>
        </div>
        <button onClick={run} disabled={loading} style={{ padding: '8px 18px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: loading ? theme.colors.border : theme.colors.orange, color: loading ? theme.colors.textMuted : '#fff', cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flexShrink: 0 }}>
          {loading ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Running...</> : <><Shield size={14} /> Run Health Check</>}
        </button>
      </div>

      {error && <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 12, color: '#DC2626' }}>{error}</div>}

      {summary && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: summary.failed > 0 ? '#FFFBF5' : '#F0FDF4', border: `1px solid ${summary.failed > 0 ? '#FED7AA' : '#BBF7D0'}` }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: summary.failed > 0 ? '#B45309' : '#15803D', marginBottom: 8 }}>
            {summary.passed} of {summary.passed + summary.failed} clients passed all checks
            {summary.failed > 0 && ` — ${summary.failed} need${summary.failed === 1 ? 's' : ''} attention`}
          </div>

          {results && results.map(r => (
            <div key={r.name} style={{ marginTop: 8, padding: '10px 14px', borderRadius: 8, background: r.passed ? '#F0FDF4' : '#fff', border: `1px solid ${r.passed ? '#BBF7D0' : '#FED7AA'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>{r.passed ? '✅' : '⚠️'}</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</span>
                  <span style={{ fontSize: 11, color: theme.colors.textMuted }}>{r.inventoryCount} items</span>
                </div>
                {r.issueCount > 0 && (
                  <span style={{ fontSize: 11, color: r.errorCount > 0 ? '#DC2626' : '#B45309', fontWeight: 600 }}>
                    {r.errorCount > 0 && `${r.errorCount} error${r.errorCount !== 1 ? 's' : ''}`}
                    {r.errorCount > 0 && r.warningCount > 0 && ', '}
                    {r.warningCount > 0 && `${r.warningCount} warning${r.warningCount !== 1 ? 's' : ''}`}
                    {(r.errorCount > 0 || r.warningCount > 0) && r.infoCount > 0 && ', '}
                    {r.infoCount > 0 && `${r.infoCount} info`}
                  </span>
                )}
              </div>

              {r.issues.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {r.issues.map((issue, idx) => (
                    <div key={idx} style={{ marginTop: idx > 0 ? 6 : 0, padding: '8px 10px', borderRadius: 6, background: issue.type === 'error' ? '#FEF2F2' : issue.type === 'warning' ? '#FFFBF5' : '#EFF6FF', border: `1px solid ${issue.type === 'error' ? '#FECACA' : issue.type === 'warning' ? '#FED7AA' : '#BFDBFE'}` }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: issueColor(issue.type), marginBottom: 4 }}>
                        {issueIcon(issue.type)} {issue.title}
                      </div>
                      <div style={{ fontSize: 11, color: theme.colors.textSecondary, lineHeight: 1.5 }}>
                        <strong>How to fix:</strong> {issue.fix}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Settings() {
  const navigate = useNavigate();
  const { realUser, impersonateUser } = useAuth();
  const isAdmin = realUser?.role === 'admin';
  const [tab, setTab] = useState<Tab>('general');
  const [clientSearch, setClientSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [userSorting, setUserSorting] = useState<SortingState>([]);
  const [showInactiveClients, setShowInactiveClients] = useState(false);
  const apiConfigured = isApiConfigured();
  const { apiClients, loading: clientsLoading, error: clientsError, refetch: refetchClients, applyClientPatch, clearClientPatch } = useClients(apiConfigured && true, showInactiveClients);
  const { priceList, classMap, loading: pricingLoading, error: pricingError, refetch: refetchPricing } = usePricing(apiConfigured && true);
  // Pre-fetch locations for sub-tabs
  useLocations(apiConfigured && true);

  // Users tab
  const { users, loading: usersLoading, error: usersError, addUser, updateUser, deleteUser, refetch: refetchUsers } = useUsers();
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'staff' | 'client'>('staff');
  // v38.61.1 — multi-client support on Add User (was single-select).
  // Each user can now be assigned N client accounts via a chip picker.
  // CSV-joined on submit; backend already accepts CSV in `clientName`/`clientSheetId`.
  const [newUserClientNames, setNewUserClientNames] = useState<string[]>([]);
  const [newUserClientIds, setNewUserClientIds] = useState<string[]>([]);
  const [newUserAddClientDropdown, setNewUserAddClientDropdown] = useState(false);
  const [addUserLoading, setAddUserLoading] = useState(false);
  const [addUserError, setAddUserError] = useState('');
  const [impersonatingEmail, setImpersonatingEmail] = useState<string | null>(null);
  const [addUserSuccess, setAddUserSuccess] = useState('');
  // v38.43.0 — Send Welcome Email button per row on Users tab
  const [sendingWelcomeEmail, setSendingWelcomeEmail] = useState<string | null>(null);
  const [sendWelcomeResult, setSendWelcomeResult] = useState<{ email: string; ok: boolean; message: string } | null>(null);

  // Session 70 follow-up — Resync Users (CB → Supabase cb_users + optional auth.users prune)
  const [resyncOpen, setResyncOpen] = useState(false);
  const [resyncLoading, setResyncLoading] = useState(false);
  const [resyncPreview, setResyncPreviewState] = useState<null | {
    cbCount: number;
    sbCount: number;
    authCount: number;
    willDeleteSb: string[];
    authOrphans: string[];
  }>(null);
  const [resyncPruneAuth, setResyncPruneAuth] = useState(false);
  const [resyncResult, setResyncResult] = useState<null | {
    ok: boolean;
    message: string;
    details?: string[];
  }>(null);

  async function handleOpenResync() {
    setResyncOpen(true);
    setResyncPreviewState(null);
    setResyncResult(null);
    setResyncPruneAuth(false);
    if (!realUser?.email) return;
    setResyncLoading(true);
    try {
      const res = await resyncUsersPreview(realUser.email);
      if (res.ok && res.data?.success) {
        setResyncPreviewState({
          cbCount: res.data.cbCount,
          sbCount: res.data.sbCount,
          authCount: res.data.authCount,
          willDeleteSb: res.data.willDeleteSb || [],
          authOrphans: res.data.authOrphansFound || [],
        });
      } else {
        setResyncResult({ ok: false, message: res.error || 'Preview failed — check API connection.' });
      }
    } catch (err) {
      setResyncResult({ ok: false, message: String(err) });
    } finally {
      setResyncLoading(false);
    }
  }

  // Session 70 follow-up — Resync Clients (CB → Supabase clients mirror)
  const [resyncClientsOpen, setResyncClientsOpen] = useState(false);
  const [resyncClientsLoading, setResyncClientsLoading] = useState(false);
  const [resyncClientsPreviewState, setResyncClientsPreviewState] = useState<null | {
    cbCount: number;
    sbCount: number;
    willDeleteSb: Array<{ spreadsheetId: string; name: string }>;
    missingFromSb: Array<{ sid: string; name: string }>;
  }>(null);
  const [resyncClientsResult, setResyncClientsResult] = useState<null | {
    ok: boolean;
    message: string;
    details?: string[];
  }>(null);

  async function handleOpenResyncClients() {
    setResyncClientsOpen(true);
    setResyncClientsPreviewState(null);
    setResyncClientsResult(null);
    if (!realUser?.email) return;
    setResyncClientsLoading(true);
    try {
      const res = await resyncClientsPreview(realUser.email);
      if (res.ok && res.data?.success) {
        setResyncClientsPreviewState({
          cbCount: res.data.cbCount,
          sbCount: res.data.sbCount,
          willDeleteSb: res.data.willDeleteSb || [],
          missingFromSb: res.data.missingFromSb || [],
        });
      } else {
        setResyncClientsResult({ ok: false, message: res.error || 'Preview failed — check API connection.' });
      }
    } catch (err) {
      setResyncClientsResult({ ok: false, message: String(err) });
    } finally {
      setResyncClientsLoading(false);
    }
  }

  async function handleRunResyncClients() {
    if (!realUser?.email) return;
    setResyncClientsLoading(true);
    setResyncClientsResult(null);
    try {
      const res = await resyncClients(realUser.email);
      if (res.ok && res.data?.success) {
        const d = res.data;
        const details: string[] = [
          `CB Clients: ${d.cbCount}`,
          `Upserted to Supabase: ${d.upserted}`,
          `Deleted orphans from Supabase: ${d.sbDeleted}`,
        ];
        if (d.upsertErrors && d.upsertErrors.length > 0) {
          details.push(`Upsert errors: ${d.upsertErrors.length}`);
        }
        setResyncClientsResult({
          ok: true,
          message: `Resync complete — Supabase clients now matches CB Clients.`,
          details,
        });
        // Refetch clients list so UI updates immediately
        await refetchClients();
      } else {
        setResyncClientsResult({ ok: false, message: res.error || 'Resync failed.' });
      }
    } catch (err) {
      setResyncClientsResult({ ok: false, message: String(err) });
    } finally {
      setResyncClientsLoading(false);
    }
  }

  async function handleRunResync() {
    if (!realUser?.email) return;
    setResyncLoading(true);
    setResyncResult(null);
    try {
      const res = await resyncUsers(realUser.email, resyncPruneAuth);
      if (res.ok && res.data?.success) {
        const d = res.data;
        const details: string[] = [
          `CB Users: ${d.cbCount}`,
          `Upserted to cb_users: ${d.upserted}`,
          `Deleted from cb_users: ${d.sbDeleted}`,
          `auth.users orphans found: ${d.authOrphansFound?.length ?? 0}`,
        ];
        if (d.pruneAuth) details.push(`Deleted from auth.users: ${d.authDeleted}`);
        if (d.authErrors && d.authErrors.length > 0) {
          details.push(`auth delete errors: ${d.authErrors.length} (see logs)`);
        }
        setResyncResult({
          ok: true,
          message: `Resync complete — all 3 stores aligned with CB Users.`,
          details,
        });
        // Refetch the displayed user list
        await refetchUsers();
      } else {
        setResyncResult({ ok: false, message: res.error || 'Resync failed.' });
      }
    } catch (err) {
      setResyncResult({ ok: false, message: String(err) });
    } finally {
      setResyncLoading(false);
    }
  }

  async function handleSendWelcomeToOneUser(userEmail: string) {
    setSendingWelcomeEmail(userEmail);
    setSendWelcomeResult(null);
    try {
      const res = await postSendWelcomeToUsers({ userEmails: [userEmail] });
      if (res.ok && res.data?.success) {
        const row = res.data.results[0];
        if (row?.ok) {
          setSendWelcomeResult({ email: userEmail, ok: true, message: `Welcome email sent to ${userEmail}` });
        } else {
          setSendWelcomeResult({ email: userEmail, ok: false, message: `Send failed: ${row?.reason || row?.error || 'unknown'}` });
        }
      } else {
        setSendWelcomeResult({ email: userEmail, ok: false, message: res.error || res.data?.error || 'Request failed' });
      }
    } catch (err) {
      setSendWelcomeResult({ email: userEmail, ok: false, message: String(err) });
    } finally {
      setSendingWelcomeEmail(null);
      // Auto-dismiss toast after 4 seconds
      setTimeout(() => setSendWelcomeResult(null), 4000);
    }
  }
  // userActionErrors removed — inline toggle replaced by edit panel

  // User edit panel state (v33)
  const [editingUser, setEditingUser] = useState<ApiUser | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<'admin' | 'staff' | 'client'>('client');
  const [editActive, setEditActive] = useState(true);
  const [editClientNames, setEditClientNames] = useState<string[]>([]);
  const [editClientIds, setEditClientIds] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [addClientDropdown, setAddClientDropdown] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const userEditPanelRef = useRef<HTMLDivElement>(null);

  function openUserEdit(u: ApiUser) {
    setEditingUser(u);
    setEditEmail(u.email);
    setEditRole(u.role);
    setEditActive(u.active);
    const names = u.clientName ? u.clientName.split(',').map(s => s.trim()).filter(Boolean) : [];
    const ids = u.clientSheetId ? u.clientSheetId.split(',').map(s => s.trim()).filter(Boolean) : [];
    setEditClientNames(names);
    setEditClientIds(ids);
    setEditError('');
    setAddClientDropdown(false);
    setDeleteConfirm(false);
    // Scroll the edit panel into view after React renders it
    setTimeout(() => {
      userEditPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }

  function removeClientAccess(idx: number) {
    setEditClientNames(prev => prev.filter((_, i) => i !== idx));
    setEditClientIds(prev => prev.filter((_, i) => i !== idx));
  }

  function addClientAccess(clientName: string, clientSheetId: string) {
    if (editClientIds.includes(clientSheetId)) return; // already listed
    setEditClientNames(prev => [...prev, clientName]);
    setEditClientIds(prev => [...prev, clientSheetId]);
    setAddClientDropdown(false);
  }

  async function handleSaveUser() {
    if (!editingUser) return;
    if (editRole === 'client' && editClientIds.length === 0) {
      setEditError('Client-role users must have at least one client account.');
      return;
    }
    if (editClientNames.length !== editClientIds.length) {
      setEditError('Client names and IDs are out of sync. Please remove and re-add clients.');
      return;
    }
    setEditSaving(true);
    setEditError('');
    const result = await updateUser(editingUser.email, {
      role: editRole,
      active: editActive,
      clientName: editClientNames.join(', '),
      clientSheetId: editClientIds.join(', '),
      newEmail: editEmail !== editingUser.email ? editEmail : undefined,
    });
    setEditSaving(false);
    if (result.success) {
      setEditingUser(null);
    } else {
      setEditError(result.error ?? 'Failed to update user');
    }
  }

  async function handleAddUser() {
    if (!newUserEmail.trim()) { setAddUserError('Email is required.'); return; }
    if (newUserRole === 'client' && newUserClientIds.length === 0) {
      setAddUserError('Client-role users must have at least one client account.');
      return;
    }
    setAddUserLoading(true);
    setAddUserError('');
    const result = await addUser(
      newUserEmail.trim().toLowerCase(),
      newUserRole,
      newUserClientNames.length ? newUserClientNames.join(', ') : undefined,
      newUserClientIds.length ? newUserClientIds.join(', ') : undefined
    );
    setAddUserLoading(false);
    if (result.success) {
      setAddUserOpen(false);
      setNewUserEmail(''); setNewUserRole('staff');
      setNewUserClientNames([]); setNewUserClientIds([]);
      setNewUserAddClientDropdown(false);
      setAddUserSuccess('User created — they can use "Forgot Password" on the login page to set up their password.');
      setTimeout(() => setAddUserSuccess(''), 8000);
    } else {
      setAddUserError(result.error ?? 'Failed to add user');
    }
  }

  function addNewUserClientAccess(clientName: string, clientSheetId: string) {
    if (newUserClientIds.includes(clientSheetId)) return;
    setNewUserClientNames(prev => [...prev, clientName]);
    setNewUserClientIds(prev => [...prev, clientSheetId]);
    setNewUserAddClientDropdown(false);
  }

  function removeNewUserClientAccess(idx: number) {
    setNewUserClientNames(prev => prev.filter((_, i) => i !== idx));
    setNewUserClientIds(prev => prev.filter((_, i) => i !== idx));
  }

  // handleToggleActive removed — active toggle is now in the edit panel

  // Users table (TanStack Table — must be top-level, not inside IIFE)
  const filteredUsers = useMemo(() => {
    const uq = userSearch.toLowerCase();
    return uq
      ? users.filter(u =>
          u.email.toLowerCase().includes(uq) ||
          u.role.toLowerCase().includes(uq) ||
          (u.clientName || '').toLowerCase().includes(uq))
      : users;
  }, [users, userSearch]);

  const userColumns = useMemo<ColumnDef<ApiUser, any>[]>(() => [
    { accessorKey: 'email', header: 'Email', cell: ({ getValue }) => <span style={{ fontWeight: 500 }}>{getValue()}</span> },
    {
      accessorKey: 'role', header: 'Role',
      cell: ({ getValue }) => {
        const role = getValue() as string;
        const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
        return <span style={{
          fontSize: 11, padding: '2px 10px', borderRadius: 10, fontWeight: 600,
          background: role === 'admin' ? '#EDE9FE' : role === 'staff' ? '#EFF6FF' : theme.colors.orangeLight,
          color: role === 'admin' ? '#7C3AED' : role === 'staff' ? '#1D4ED8' : theme.colors.orange,
        }}>{roleLabel}</span>;
      },
    },
    {
      accessorKey: 'clientName', header: 'Client Access',
      cell: ({ getValue }) => {
        const names = (getValue() as string || '').split(',').map(s => s.trim()).filter(Boolean);
        return names.length === 0
          ? <span style={{ color: theme.colors.textMuted }}>&mdash;</span>
          : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{names.map((name, i) =>
              <span key={i} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 8, background: theme.colors.orangeLight, color: theme.colors.orange, fontWeight: 600 }}>{name}</span>
            )}</div>;
      },
    },
    {
      accessorKey: 'active', header: 'Active',
      cell: ({ getValue }) => getValue() ? <span style={{ color: '#15803D' }}>&#10003;</span> : <span style={{ color: theme.colors.textMuted }}>&#10007;</span>,
      meta: { align: 'center' },
    },
    {
      accessorKey: 'lastLogin', header: 'Last Login',
      cell: ({ getValue }) => <span style={{ color: theme.colors.textMuted }}>{getValue() || '\u2014'}</span>,
    },
    {
      id: 'actions', header: '', enableSorting: false,
      cell: ({ row }) => {
        const u = row.original;
        return (
          <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            {realUser?.role === 'admin' && u.role === 'client' && (
              <button
                disabled={sendingWelcomeEmail !== null}
                onClick={(e) => { e.stopPropagation(); handleSendWelcomeToOneUser(u.email); }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', fontSize: 11, fontWeight: 600,
                  border: `1px solid ${theme.colors.border}`, borderRadius: 6,
                  background: sendingWelcomeEmail === u.email ? theme.colors.orangeLight : '#fff',
                  color: sendingWelcomeEmail === u.email ? theme.colors.orange : theme.colors.textSecondary,
                  cursor: sendingWelcomeEmail !== null ? 'wait' : 'pointer',
                  opacity: (sendingWelcomeEmail !== null && sendingWelcomeEmail !== u.email) ? 0.4 : 1,
                  fontFamily: 'inherit',
                }}
                title={`Send welcome email to ${u.email}`}
              >
                {sendingWelcomeEmail === u.email ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={12} />}
                {sendingWelcomeEmail === u.email ? 'Sending\u2026' : 'Send Welcome'}
              </button>
            )}
            {realUser?.role === 'admin' && u.email !== realUser.email && u.active && (
              <button
                disabled={impersonatingEmail !== null}
                onClick={async (e) => {
                  e.stopPropagation();
                  setImpersonatingEmail(u.email);
                  const { error: impErr } = await impersonateUser(u.email);
                  setImpersonatingEmail(null);
                  if (!impErr) navigate('/');
                }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', fontSize: 11, fontWeight: 600,
                  border: `1px solid ${theme.colors.border}`, borderRadius: 6,
                  background: impersonatingEmail === u.email ? theme.colors.orangeLight : '#fff',
                  color: impersonatingEmail === u.email ? theme.colors.orange : theme.colors.textSecondary,
                  cursor: impersonatingEmail !== null ? 'wait' : 'pointer',
                  opacity: (impersonatingEmail !== null && impersonatingEmail !== u.email) ? 0.4 : 1,
                  fontFamily: 'inherit',
                }}
                title={`View app as ${u.email}`}
              >
                {impersonatingEmail === u.email ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <LogIn size={12} />}
                {impersonatingEmail === u.email ? 'Loading\u2026' : 'Login As'}
              </button>
            )}
          </div>
        );
      },
    },
  ], [realUser, sendingWelcomeEmail, impersonatingEmail, impersonateUser, navigate]);

  const userTable = useReactTable({
    data: filteredUsers,
    columns: userColumns,
    state: { sorting: userSorting },
    onSortingChange: setUserSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  // Client onboard / edit state
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [clientModalMode, setClientModalMode] = useState<'create' | 'edit'>('create');
  const [selectedClient, setSelectedClient] = useState<ApiClient | null>(null);
  const [clientActionLoading, setClientActionLoading] = useState(false);
  const [onboardResult, setOnboardResult] = useState<OnboardClientResponse | null>(null);
  const [userConflictLoading, setUserConflictLoading] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateClientResponse | null>(null);
  const [clientActionError, setClientActionError] = useState('');

  // Sync settings state
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncSettingsResponse | null>(null);
  const [syncError, setSyncError] = useState('');

  // Email test send state (shared across emails + claims tabs)
  const [testToEmail, setTestToEmail] = useState('');
  const [emailTestResults, setEmailTestResults] = useState<Record<string, TestSendResult>>({});
  const [emailTestLoading, setEmailTestLoading] = useState<Record<string, boolean>>({});
  const [emailSendAllLoading, setEmailSendAllLoading] = useState(false);

  // v38.12.0 — Template editor state
  const [liveTemplates, setLiveTemplates] = useState<EmailTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [tplSyncConfirmOpen, setTplSyncConfirmOpen] = useState(false);
  const [tplSyncing, setTplSyncing] = useState(false);
  const [tplSyncResult, setTplSyncResult] = useState<{ synced: number; failed: number; message: string } | null>(null);

  // Fetch templates from Master when emails tab is active
  const [templatesFetchError, setTemplatesFetchError] = useState<string | null>(null);
  useEffect(() => {
    if (tab === 'emails') {
      setTemplatesLoading(true);
      setTemplatesFetchError(null);
      fetchEmailTemplates().then(resp => {
        if (resp.ok && resp.data?.templates) {
          setLiveTemplates(resp.data.templates);
        } else {
          setTemplatesFetchError(resp.error || resp.data?.error || 'Failed to load templates');
        }
        setTemplatesLoading(false);
      }).catch(err => {
        setTemplatesFetchError(String(err));
        setTemplatesLoading(false);
      });
    }
  }, [tab]);

  const handleSyncToClients = async () => {
    setTplSyncing(true);
    setTplSyncResult(null);
    const resp = await postSyncTemplatesToClients();
    setTplSyncing(false);
    setTplSyncConfirmOpen(false);
    if (resp.ok && resp.data) {
      setTplSyncResult({ synced: resp.data.synced, failed: resp.data.failed, message: resp.data.message || '' });
    } else {
      setTplSyncResult({ synced: 0, failed: 0, message: resp.error || 'Sync failed' });
    }
  };

  const refreshTemplates = () => {
    setTemplatesLoading(true);
    fetchEmailTemplates().then(resp => {
      if (resp.ok && resp.data?.templates) setLiveTemplates(resp.data.templates);
      setTemplatesLoading(false);
    }).catch(() => setTemplatesLoading(false));
  };

  // Helper to find live template HTML for a given key
  const getLiveTemplate = (key: string): EmailTemplate | undefined => liveTemplates.find(t => t.key === key);
  const [claimEmailTestResults, setClaimEmailTestResults] = useState<Record<string, TestSendResult>>({});
  const [claimEmailTestLoading, setClaimEmailTestLoading] = useState<Record<string, boolean>>({});

  async function handleTestSendOneClientTemplate(templateKey: string) {
    if (!testToEmail.trim()) return;
    setEmailTestLoading(prev => ({ ...prev, [templateKey]: true }));
    setEmailTestResults(prev => { const n = { ...prev }; delete n[templateKey]; return n; });
    const res = await postTestSendClientTemplates({ toEmail: testToEmail.trim(), templateKey });
    setEmailTestLoading(prev => { const n = { ...prev }; delete n[templateKey]; return n; });
    if (res.data?.results?.[0]) {
      const r = res.data.results[0];
      setEmailTestResults(prev => ({ ...prev, [templateKey]: r }));
    } else {
      setEmailTestResults(prev => ({ ...prev, [templateKey]: { key: templateKey, sent: false, error: res.error || 'Failed' } }));
    }
  }

  async function handleTestSendAllClientTemplates() {
    if (!testToEmail.trim()) return;
    setEmailSendAllLoading(true);
    setEmailTestResults({});
    const res = await postTestSendClientTemplates({ toEmail: testToEmail.trim() });
    setEmailSendAllLoading(false);
    if (res.data?.results) {
      const r: Record<string, TestSendResult> = {};
      res.data.results.forEach(item => { r[item.key] = item; });
      setEmailTestResults(r);
    }
  }

  async function handleTestSendOneClaimEmail(templateKey: string) {
    if (!testToEmail.trim()) return;
    setClaimEmailTestLoading(prev => ({ ...prev, [templateKey]: true }));
    setClaimEmailTestResults(prev => { const n = { ...prev }; delete n[templateKey]; return n; });
    const res = await postTestSendClaimEmails({ toEmail: testToEmail.trim(), templateKey });
    setClaimEmailTestLoading(prev => { const n = { ...prev }; delete n[templateKey]; return n; });
    if (res.data?.results?.[0]) {
      const r = res.data.results[0];
      setClaimEmailTestResults(prev => ({ ...prev, [templateKey]: r }));
    } else {
      setClaimEmailTestResults(prev => ({ ...prev, [templateKey]: { key: templateKey, sent: false, error: res.error || 'Failed' } }));
    }
  }

  // Maintenance tab state
  const [refreshCachesLoading, setRefreshCachesLoading] = useState(false);
  const [refreshCachesResult, setRefreshCachesResult] = useState<RefreshCachesResponse | null>(null);
  const [refreshCachesError, setRefreshCachesError] = useState('');
  const [updateHeadersLoading, setUpdateHeadersLoading] = useState(false);
  const [updateHeadersResult, setUpdateHeadersResult] = useState<RunOnClientsResponse | null>(null);
  const [updateHeadersError, setUpdateHeadersError] = useState('');
  const [updateHeadersProgress, setUpdateHeadersProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [installTriggersLoading, setInstallTriggersLoading] = useState(false);
  const [installTriggersResult, setInstallTriggersResult] = useState<RunOnClientsResponse | null>(null);
  const [installTriggersError, setInstallTriggersError] = useState('');
  const [installTriggersProgress, setInstallTriggersProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [syncAutocompLoading, setSyncAutocompLoading] = useState(false);
  const [syncAutocompResult, setSyncAutocompResult] = useState<RunOnClientsResponse | null>(null);
  const [syncAutocompError, setSyncAutocompError] = useState('');
  const [fixFoldersLoading, setFixFoldersLoading] = useState(false);
  const [fixFoldersResult, setFixFoldersResult] = useState<{ fixed: number; clients: number; errors: number } | null>(null);
  const [fixFoldersError, setFixFoldersError] = useState('');
  const [fixFoldersProgress, setFixFoldersProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [refreshCachesProgress, setRefreshCachesProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [syncAutocompProgress, setSyncAutocompProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [welcomeEmailLoading, setWelcomeEmailLoading] = useState<string | null>(null);
  const [welcomeEmailResult, setWelcomeEmailResult] = useState<{ clientName: string; ok: boolean; error?: string } | null>(null);
  const [finishSetupLoading, setFinishSetupLoading] = useState<string | null>(null);
  const [finishSetupResult, setFinishSetupResult] = useState<{ clientName: string; ok: boolean; message?: string; error?: string; webAppUrl?: string } | null>(null);
  const [purgeInactiveLoading, setPurgeInactiveLoading] = useState(false);
  const [purgeInactiveResult, setPurgeInactiveResult] = useState<{ purgedCount: number; purged: Array<{ name: string; purge?: { purged: boolean; details?: Record<string, number | string>; failCount?: number } }> } | null>(null);
  const [purgeInactiveError, setPurgeInactiveError] = useState('');
  // Per-client Supabase sync (card-level button) — separate from bulk sync so
  // a single client can be re-mirrored without waiting through all active clients.
  const [clientSbSyncLoading, setClientSbSyncLoading] = useState<string | null>(null);
  const [clientSbSyncResult, setClientSbSyncResult] = useState<{ clientName: string; totalRows: Record<string, number>; totalDeleted?: Record<string, number> } | null>(null);
  const [clientSbSyncError, setClientSbSyncError] = useState<{ clientName: string; error: string } | null>(null);
  // Per-client sync elapsed timer — matches the Maintenance bulk-sync progress banner
  const [clientSbSyncTimer, setClientSbSyncTimer] = useState<{ clientName: string; startedAt: number; elapsed: number } | null>(null);
  useEffect(() => {
    if (!clientSbSyncLoading || !clientSbSyncTimer) return;
    const id = setInterval(() => {
      setClientSbSyncTimer(prev => prev ? { ...prev, elapsed: Math.floor((Date.now() - prev.startedAt) / 1000) } : prev);
    }, 1000);
    return () => clearInterval(id);
  }, [clientSbSyncLoading, clientSbSyncTimer]);
  const [bulkSyncLoading, setBulkSyncLoading] = useState(false);
  const [bulkSyncResult, setBulkSyncResult] = useState<BulkSyncResult | null>(() => {
    try { const s = localStorage.getItem('stride_bulkSyncResult'); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const [bulkSyncError, setBulkSyncError] = useState(() => {
    try { return localStorage.getItem('stride_bulkSyncError') || ''; } catch { return ''; }
  });
  const [bulkSyncProgress, setBulkSyncProgress] = useState<{ done: number; total: number; current: string; startedAt?: number } | null>(() => {
    // Restore "in progress" state if the user navigated away mid-sync.
    // The sync still runs server-side; we just show "sync was in progress" until it finishes
    // or 10 minutes elapse (considered stale/timed out).
    try {
      const s = localStorage.getItem('stride_bulkSyncProgress');
      if (!s) return null;
      const parsed = JSON.parse(s);
      if (parsed?.startedAt && Date.now() - parsed.startedAt > 10 * 60 * 1000) {
        // Stale — clear it
        localStorage.removeItem('stride_bulkSyncProgress');
        return null;
      }
      return parsed;
    } catch { return null; }
  });

  async function handleRefreshCaches() {
    setRefreshCachesLoading(true);
    setRefreshCachesError('');
    setRefreshCachesResult(null);

    let activeClients = apiClients.filter(c => c.active && c.spreadsheetId);
    if (activeClients.length === 0) {
      const freshRes = await fetchClients();
      if (freshRes.ok && freshRes.data?.clients) {
        activeClients = freshRes.data.clients.filter(c => c.active && c.spreadsheetId);
      }
    }
    if (activeClients.length === 0) {
      setRefreshCachesError('No active clients found — check API connection in Settings → Integrations');
      setRefreshCachesLoading(false);
      return;
    }

    setRefreshCachesProgress({ done: 0, total: activeClients.length, current: activeClients[0].name });

    const aggregatedSynced: { name: string; sheetId: string }[] = [];
    const aggregatedFailed: { name: string; sheetId: string; error: string }[] = [];

    for (let i = 0; i < activeClients.length; i++) {
      const client = activeClients[i];
      setRefreshCachesProgress({ done: i, total: activeClients.length, current: client.name });
      try {
        const res = await postRefreshCaches({ clientSheetIds: [client.spreadsheetId] });
        if (res.ok && res.data) {
          aggregatedSynced.push(...(res.data.synced || []));
          aggregatedFailed.push(...(res.data.failed || []));
        } else {
          aggregatedFailed.push({ name: client.name, sheetId: client.spreadsheetId, error: res.error || 'Request failed' });
        }
      } catch (err: unknown) {
        aggregatedFailed.push({
          name: client.name,
          sheetId: client.spreadsheetId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    setRefreshCachesProgress(null);
    setRefreshCachesResult({ success: true, synced: aggregatedSynced, failed: aggregatedFailed });
    setRefreshCachesLoading(false);
  }

  /**
   * Generic per-client loop for remote-action endpoints (Update Headers, Install Triggers).
   * Each call gets its own 5-min timeout. Failures on one client don't abort the loop.
   * Backend's `handleRemoteAction_` accepts `clientSheetIds: [id]` to filter to a single client.
   */
  async function runPerClientRemoteAction(
    action: 'updateHeaders' | 'installTriggers',
    setProgress: (p: { done: number; total: number; current: string } | null) => void,
    setResult: (r: RunOnClientsResponse | null) => void,
    setError: (e: string) => void,
  ) {
    let activeClients = apiClients.filter(c => c.active && c.spreadsheetId);
    if (activeClients.length === 0) {
      const freshRes = await fetchClients();
      if (freshRes.ok && freshRes.data?.clients) {
        activeClients = freshRes.data.clients.filter(c => c.active && c.spreadsheetId);
      }
    }
    if (activeClients.length === 0) {
      setError('No active clients found — check API connection in Settings → Integrations');
      return { cancelled: true };
    }

    setProgress({ done: 0, total: activeClients.length, current: activeClients[0].name });

    const aggregatedResults: any[] = [];
    for (let i = 0; i < activeClients.length; i++) {
      const client = activeClients[i];
      setProgress({ done: i, total: activeClients.length, current: client.name });
      try {
        const res = await apiPost<{ success: boolean; succeeded: number; failed: number; results: any[] }>(
          action,
          { clientSheetIds: [client.spreadsheetId] },
          {},
          { timeoutMs: 300_000 } // 5 minutes per client
        );
        if (res.ok && res.data?.results) {
          aggregatedResults.push(...res.data.results);
        } else {
          aggregatedResults.push({
            name: client.name,
            sheetId: client.spreadsheetId,
            ok: false,
            error: res.error || 'Request failed',
          });
        }
      } catch (err: unknown) {
        aggregatedResults.push({
          name: client.name,
          sheetId: client.spreadsheetId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    setProgress(null);
    const succeeded = aggregatedResults.filter(r => r.ok).length;
    const failed = aggregatedResults.length - succeeded;
    setResult({
      success: true,
      functionName: action,
      succeeded,
      failed,
      results: aggregatedResults,
    });
    return { cancelled: false };
  }

  async function handleUpdateHeaders() {
    setUpdateHeadersLoading(true);
    setUpdateHeadersError('');
    setUpdateHeadersResult(null);
    try {
      await runPerClientRemoteAction('updateHeaders', setUpdateHeadersProgress, setUpdateHeadersResult, setUpdateHeadersError);
    } catch (err: unknown) {
      setUpdateHeadersError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdateHeadersLoading(false);
      setUpdateHeadersProgress(null);
    }
  }

  async function handleInstallTriggers() {
    setInstallTriggersLoading(true);
    setInstallTriggersError('');
    setInstallTriggersResult(null);
    try {
      await runPerClientRemoteAction('installTriggers', setInstallTriggersProgress, setInstallTriggersResult, setInstallTriggersError);
    } catch (err: unknown) {
      setInstallTriggersError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallTriggersLoading(false);
      setInstallTriggersProgress(null);
    }
  }

  async function handleSyncAutocompleteDB() {
    setSyncAutocompLoading(true);
    setSyncAutocompError('');
    setSyncAutocompResult(null);

    let activeClients = apiClients.filter(c => c.active && c.spreadsheetId);
    if (activeClients.length === 0) {
      const freshRes = await fetchClients();
      if (freshRes.ok && freshRes.data?.clients) {
        activeClients = freshRes.data.clients.filter(c => c.active && c.spreadsheetId);
      }
    }
    if (activeClients.length === 0) {
      setSyncAutocompError('No active clients found — check API connection in Settings → Integrations');
      setSyncAutocompLoading(false);
      return;
    }

    setSyncAutocompProgress({ done: 0, total: activeClients.length, current: activeClients[0].name });

    const aggregatedResults: any[] = [];

    for (let i = 0; i < activeClients.length; i++) {
      const client = activeClients[i];
      setSyncAutocompProgress({ done: i, total: activeClients.length, current: client.name });
      try {
        const res = await apiPost<{ success: boolean; results: Array<{ name: string; ok: boolean; added?: number; error?: string }> }>(
          'syncAutocompleteDb',
          { clientSheetIds: [client.spreadsheetId] },
          {},
          { timeoutMs: 300_000 }
        );
        if (res.ok && res.data?.results) {
          // Enrich each result with sheetId for React keying
          aggregatedResults.push(...res.data.results.map(r => ({ ...r, sheetId: client.spreadsheetId })));
        } else {
          aggregatedResults.push({
            name: client.name,
            sheetId: client.spreadsheetId,
            ok: false,
            error: res.error || 'Request failed',
          });
        }
      } catch (err: unknown) {
        aggregatedResults.push({
          name: client.name,
          sheetId: client.spreadsheetId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    setSyncAutocompProgress(null);
    const succeeded = aggregatedResults.filter(r => r.ok).length;
    const failed = aggregatedResults.length - succeeded;
    setSyncAutocompResult({
      success: true,
      functionName: 'syncAutocompleteDB',
      succeeded,
      failed,
      results: aggregatedResults,
    } as any);
    setSyncAutocompLoading(false);
  }

  async function handleFixMissingFolders() {
    setFixFoldersLoading(true);
    setFixFoldersError('');
    setFixFoldersResult(null);

    let activeClients = apiClients.filter(c => c.active && c.spreadsheetId);
    if (activeClients.length === 0) {
      const freshRes = await fetchClients();
      if (freshRes.ok && freshRes.data?.clients) {
        activeClients = freshRes.data.clients.filter(c => c.active && c.spreadsheetId);
      }
    }
    if (activeClients.length === 0) {
      setFixFoldersError('No active clients found — check API connection in Settings → Integrations');
      setFixFoldersLoading(false);
      return;
    }

    setFixFoldersProgress({ done: 0, total: activeClients.length, current: activeClients[0].name });

    let totalFixed = 0;
    let errorCount = 0;

    for (let i = 0; i < activeClients.length; i++) {
      const client = activeClients[i];
      setFixFoldersProgress({ done: i, total: activeClients.length, current: client.name });
      try {
        const res = await postFixMissingFolders(client.spreadsheetId);
        totalFixed += res.data?.total ?? 0;
      } catch {
        errorCount++;
      }
    }

    setFixFoldersProgress(null);
    setFixFoldersResult({ fixed: totalFixed, clients: activeClients.length, errors: errorCount });
    setFixFoldersLoading(false);
  }

  async function handlePurgeInactive() {
    setPurgeInactiveLoading(true);
    setPurgeInactiveError('');
    setPurgeInactiveResult(null);
    try {
      const res = await postPurgeInactiveFromSupabase();
      if (res.ok && res.data) {
        setPurgeInactiveResult({ purgedCount: res.data.purgedCount, purged: res.data.purged });
      } else {
        setPurgeInactiveError(res.error || 'Purge failed');
      }
    } catch (err: unknown) {
      setPurgeInactiveError(err instanceof Error ? err.message : String(err));
    }
    setPurgeInactiveLoading(false);
  }

  async function handleClientSupabaseSync(client: ApiClient) {
    if (!client.spreadsheetId) return;
    setClientSbSyncLoading(client.spreadsheetId);
    setClientSbSyncResult(null);
    setClientSbSyncError(null);
    setClientSbSyncTimer({ clientName: client.name, startedAt: Date.now(), elapsed: 0 });
    try {
      const res = await postBulkSyncToSupabase(client.spreadsheetId);
      if (res.ok && res.data) {
        setClientSbSyncResult({
          clientName: client.name,
          totalRows: res.data.totalRows as Record<string, number>,
          totalDeleted: res.data.totalDeleted as Record<string, number> | undefined,
        });
      } else {
        setClientSbSyncError({ clientName: client.name, error: res.error || 'Sync failed' });
      }
    } catch (err) {
      setClientSbSyncError({ clientName: client.name, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setClientSbSyncLoading(null);
      setClientSbSyncTimer(null);
    }
  }

  async function handleBulkSyncToSupabase() {
    // Per-client loop — avoids 90s timeout on syncing all clients at once.
    // Each client sync takes 15-60s (read all sheets + upsert + orphan deletes).
    setBulkSyncLoading(true);
    setBulkSyncError('');
    setBulkSyncResult(null);
    localStorage.removeItem('stride_bulkSyncResult');
    localStorage.removeItem('stride_bulkSyncError');

    // Get the client list — prefer the hook's cached copy, fall back to a fresh
    // fetch if empty (Maintenance tab may be reached before the hook populates).
    let activeClients = apiClients.filter(c => c.active && c.spreadsheetId);
    if (activeClients.length === 0) {
      const freshRes = await fetchClients();
      if (freshRes.ok && freshRes.data?.clients) {
        activeClients = freshRes.data.clients.filter(c => c.active && c.spreadsheetId);
      }
    }

    if (activeClients.length === 0) {
      setBulkSyncError('No active clients found — check API connection in Settings → Integrations');
      setBulkSyncLoading(false);
      return;
    }

    const initProgress = { done: 0, total: activeClients.length, current: activeClients[0].name, startedAt: Date.now() };
    setBulkSyncProgress(initProgress);
    try { localStorage.setItem('stride_bulkSyncProgress', JSON.stringify(initProgress)); } catch {};

    // Aggregated result across all clients
    const aggregated: BulkSyncResult = {
      success: true,
      clientsSynced: 0,
      totalRows: { inventory: 0, tasks: 0, repairs: 0, will_calls: 0, shipments: 0, billing: 0 },
      totalDeleted: { inventory: 0, tasks: 0, repairs: 0, will_calls: 0, shipments: 0, billing: 0 },
      clients: [],
    };

    const errors: string[] = [];

    for (let i = 0; i < activeClients.length; i++) {
      const client = activeClients[i];
      const prog = { done: i, total: activeClients.length, current: client.name, startedAt: initProgress.startedAt };
      setBulkSyncProgress(prog);
      try { localStorage.setItem('stride_bulkSyncProgress', JSON.stringify(prog)); } catch {};

      try {
        const res = await postBulkSyncToSupabase(client.spreadsheetId);
        if (res.ok && res.data) {
          aggregated.clientsSynced += res.data.clientsSynced;
          // Sum per-entity totals
          const k: Array<keyof typeof aggregated.totalRows> = ['inventory','tasks','repairs','will_calls','shipments','billing'];
          for (const key of k) {
            aggregated.totalRows[key] += res.data.totalRows?.[key] ?? 0;
            if (res.data.totalDeleted && aggregated.totalDeleted) {
              aggregated.totalDeleted[key] += res.data.totalDeleted[key] ?? 0;
            }
          }
          aggregated.clients.push(...(res.data.clients || []));
        } else {
          errors.push(`${client.name}: ${res.error || 'sync failed'}`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${client.name}: ${msg}`);
      }
    }

    // v38.45.0: After syncing active clients, purge Supabase data for inactive clients
    setBulkSyncProgress({ done: activeClients.length, total: activeClients.length + 1, current: 'Purging inactive clients…', startedAt: initProgress.startedAt });
    try { localStorage.setItem('stride_bulkSyncProgress', JSON.stringify({ done: activeClients.length, total: activeClients.length + 1, current: 'Purging inactive clients…', startedAt: initProgress.startedAt })); } catch {};
    let purgedCount = 0;
    try {
      const purgeRes = await postPurgeInactiveFromSupabase();
      if (purgeRes.ok && purgeRes.data) {
        purgedCount = purgeRes.data.purgedCount;
      }
    } catch (purgeErr) {
      errors.push('Inactive purge: ' + (purgeErr instanceof Error ? purgeErr.message : String(purgeErr)));
    }

    setBulkSyncProgress(null);
    setBulkSyncLoading(false);
    localStorage.removeItem('stride_bulkSyncProgress');

    if (errors.length > 0) {
      const errMsg = `Synced ${aggregated.clientsSynced} of ${activeClients.length}. Errors: ${errors.join(' | ')}`;
      setBulkSyncError(errMsg);
      try { localStorage.setItem('stride_bulkSyncError', errMsg); } catch {};
    }
    // Add purge count to the result for display
    const finalResult = { ...aggregated, inactivePurged: purgedCount };
    if (aggregated.clientsSynced > 0) {
      setBulkSyncResult(finalResult);
      try { localStorage.setItem('stride_bulkSyncResult', JSON.stringify(finalResult)); } catch {};
    }
  }

  async function handleSendWelcomeEmail(client: ApiClient) {
    if (!client.spreadsheetId) return;
    setWelcomeEmailLoading(client.spreadsheetId);
    setWelcomeEmailResult(null);
    try {
      const res = await apiPost<{ success: boolean; sentTo?: string; error?: string }>('sendWelcomeEmail', { clientSheetId: client.spreadsheetId });
      if (res.ok && res.data?.success) {
        setWelcomeEmailResult({ clientName: client.name, ok: true });
      } else {
        const errMsg = res.data?.error || res.error || 'Send failed';
        setWelcomeEmailResult({ clientName: client.name, ok: false, error: errMsg });
      }
    } catch (err: unknown) {
      setWelcomeEmailResult({ clientName: client.name, ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setWelcomeEmailLoading(null);
    }
  }

  /**
   * Finish Setup — recovery action for clients where onboarding partially completed.
   * Re-runs Web App deploy + trigger install via finishClientSetup endpoint.
   */
  async function handleFinishSetup(client: ApiClient) {
    if (!client.spreadsheetId) return;
    setFinishSetupLoading(client.spreadsheetId);
    setFinishSetupResult(null);
    try {
      const res = await postFinishClientSetup(client.spreadsheetId);
      if (res.ok && res.data?.success) {
        setFinishSetupResult({
          clientName: client.name,
          ok: true,
          message: res.data.message || 'Setup complete',
          webAppUrl: res.data.webAppUrl,
        });
        // Optimistic: patch the client's webAppUrl locally so the Finish Setup
        // button disappears immediately without waiting for the refetch
        if (res.data.webAppUrl) {
          applyClientPatch(client.spreadsheetId, { webAppUrl: res.data.webAppUrl });
        }
        // Force no-cache refetch to pick up all server-side changes
        setNextFetchNoCache();
        refetchClients();
      } else {
        const errMsg = res.data?.error || res.error || 'Finish Setup failed';
        setFinishSetupResult({ clientName: client.name, ok: false, error: errMsg });
      }
    } catch (err: unknown) {
      setFinishSetupResult({ clientName: client.name, ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setFinishSetupLoading(null);
    }
  }

  // Auto-Generate Item IDs toggle state
  const [autoIdEnabled, setAutoIdEnabled] = useState<boolean | null>(null); // null = loading
  const [autoIdToggleLoading, setAutoIdToggleLoading] = useState(false);
  const [autoIdError, setAutoIdError] = useState('');

  useEffect(() => {
    if (!apiConfigured) return;
    let cancelled = false;
    fetchAutoIdSetting().then(resp => {
      if (!cancelled && resp.ok && resp.data) setAutoIdEnabled(resp.data.enabled);
      else if (!cancelled) setAutoIdEnabled(false);
    });
    return () => { cancelled = true; };
  }, [apiConfigured]);

  async function handleToggleAutoId() {
    const newVal = !autoIdEnabled;
    setAutoIdToggleLoading(true);
    setAutoIdError('');
    try {
      const res = await postUpdateAutoIdSetting(newVal);
      if (res.ok && res.data) {
        setAutoIdEnabled(res.data.enabled);
      } else {
        setAutoIdError(res.error || 'Failed to update setting');
      }
    } catch (err: unknown) {
      setAutoIdError(err instanceof Error ? err.message : String(err));
    } finally {
      setAutoIdToggleLoading(false);
    }
  }

  function openCreateModal() {
    setSelectedClient(null);
    setClientModalMode('create');
    setOnboardResult(null);
    setUpdateResult(null);
    setClientActionError('');
    setClientModalOpen(true);
  }

  function openEditModal(client: ApiClient) {
    setSelectedClient(client);
    setClientModalMode('edit');
    setOnboardResult(null);
    setUpdateResult(null);
    setClientActionError('');
    setClientModalOpen(true);
  }

  async function handleClientSubmit(data: OnboardClientFormData): Promise<import('../components/shared/OnboardClientModal').OnboardSubmitResult> {
    setClientActionLoading(true);
    setClientActionError('');
    setOnboardResult(null);
    setUpdateResult(null);
    try {
      if (clientModalMode === 'create') {
        const res = await postOnboardClient({
          clientName: data.clientName,
          clientEmail: data.clientEmail,
          contactName: data.contactName,
          phone: data.phone,
          qbCustomerName: data.qbCustomerName,
          staxCustomerId: data.staxCustomerId,
          paymentTerms: data.paymentTerms,
          freeStorageDays: Number(data.freeStorageDays),
          discountStoragePct: Number(data.discountStoragePct),
          discountServicesPct: Number(data.discountServicesPct),
          enableReceivingBilling: data.enableReceivingBilling,
          enableShipmentEmail: data.enableShipmentEmail,
          enableNotifications: data.enableNotifications,
          autoInspection: data.autoInspection,
          separateBySidemark: data.separateBySidemark,
          autoCharge: data.autoCharge,
          parentClient: data.parentClient,
          importInventoryUrl: data.importInventoryUrl,
          notes: data.notes,
          shipmentNote: data.shipmentNote,
        });
        setClientActionLoading(false);
        if (res.data?.success) {
          setOnboardResult(res.data);
          refetchClients();
          // Session 69 — broadcast so every mounted useClients (dropdowns on other pages) refetches.
          entityEvents.emit('client', data.spreadsheetId || data.clientName || '');
          return {
            ok: true,
            successMessage: `Client "${data.clientName}" onboarded successfully`,
            warnings: res.data.warnings || [],
          };
        }
        const errMsg = res.error || (res.data as any)?.error || 'Onboard failed — check warnings for details';
        return { ok: false, error: errMsg };
      } else {
        // Session 69 — optimistic patch: flip the client's fields locally BEFORE the
        // server round-trip so the UI (client card, sort order, active-count badge)
        // reflects the change immediately. Especially important for reactivation —
        // operators need to see the client snap back into the active list so they
        // can continue setting up the account without waiting for a refetch.
        applyClientPatch(data.spreadsheetId, {
          name: data.clientName,
          email: data.clientEmail,
          contactName: data.contactName,
          phone: data.phone,
          qbCustomerName: data.qbCustomerName,
          staxCustomerId: data.staxCustomerId,
          paymentTerms: data.paymentTerms,
          freeStorageDays: Number(data.freeStorageDays),
          discountStoragePct: Number(data.discountStoragePct),
          discountServicesPct: Number(data.discountServicesPct),
          enableReceivingBilling: data.enableReceivingBilling,
          enableShipmentEmail: data.enableShipmentEmail,
          enableNotifications: data.enableNotifications,
          autoInspection: data.autoInspection,
          separateBySidemark: data.separateBySidemark,
          active: data.active,
          parentClient: data.parentClient,
          folderId: data.folderId,
          photosFolderId: data.photosFolderId,
          invoiceFolderId: data.invoiceFolderId,
          notes: data.notes,
          shipmentNote: data.shipmentNote,
        });

        const res = await postUpdateClient({
          spreadsheetId: data.spreadsheetId,
          clientName: data.clientName,
          clientEmail: data.clientEmail,
          contactName: data.contactName,
          phone: data.phone,
          qbCustomerName: data.qbCustomerName,
          staxCustomerId: data.staxCustomerId,
          paymentTerms: data.paymentTerms,
          freeStorageDays: Number(data.freeStorageDays),
          discountStoragePct: Number(data.discountStoragePct),
          discountServicesPct: Number(data.discountServicesPct),
          enableReceivingBilling: data.enableReceivingBilling,
          enableShipmentEmail: data.enableShipmentEmail,
          enableNotifications: data.enableNotifications,
          autoInspection: data.autoInspection,
          separateBySidemark: data.separateBySidemark,
          active: data.active,
          parentClient: data.parentClient,
          folderId: data.folderId,
          photosFolderId: data.photosFolderId,
          invoiceFolderId: data.invoiceFolderId,
          notes: data.notes,
          shipmentNote: data.shipmentNote,
          syncToSheet: true,
        });
        setClientActionLoading(false);
        if (res.data?.success) {
          setUpdateResult(res.data);
          // Force bypass GAS 600s cache — otherwise refetch returns stale data
          // and overwrites the optimistic patch, making changes appear to revert.
          setNextFetchNoCache();
          refetchClients();
          // Session 69 — broadcast so every mounted useClients (dropdowns on other pages) refetches.
          entityEvents.emit('client', data.spreadsheetId);
          return {
            ok: true,
            successMessage: `Client "${data.clientName}" ${data.active ? (apiClients.find(c => c.spreadsheetId === data.spreadsheetId && !c.active) ? 'reactivated' : 'updated') : 'updated'} successfully`,
            warnings: (res.data as any).warnings || [],
          };
        }
        // Revert optimistic patch on failure
        clearClientPatch(data.spreadsheetId);
        const errMsg = res.error || (res.data as any)?.error || 'Update failed';
        return { ok: false, error: errMsg };
      }
    } catch (err: unknown) {
      setClientActionLoading(false);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async function handleResolveUserConflict(action: 'add_access' | 'skip') {
    if (!onboardResult?.existingUser || !onboardResult?.clientSheetId || !onboardResult?.clientName) return;
    setUserConflictLoading(true);
    try {
      await postResolveOnboardUser({
        email: onboardResult.existingUser.email,
        clientName: onboardResult.clientName,
        clientSheetId: onboardResult.clientSheetId,
        userAction: action,
      });
      // Clear the existingUser from the result to dismiss the prompt
      setOnboardResult(prev => prev ? { ...prev, existingUser: undefined } : prev);
    } catch (err: unknown) {
      setClientActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setUserConflictLoading(false);
    }
  }

  async function handleSyncAll() {
    setSyncLoading(true);
    setSyncError('');
    setSyncResult(null);
    try {
      const res = await postSyncSettings({ syncAll: true });
      if (res.data) {
        setSyncResult(res.data);
      } else {
        setSyncError(res.error || 'Sync failed');
      }
    } catch (err: unknown) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncLoading(false);
    }
  }

  return (
    <div style={{ background: '#F5F2EE', margin: '-28px -32px', padding: '28px 32px', minHeight: '100%' }}>
      <div style={{ marginBottom: 20, fontSize: 13, fontWeight: 600, letterSpacing: '1px', color: '#1C1C1C' }}>STRIDE LOGISTICS · SETTINGS</div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20 }}>
        {/* Tab Nav */}
        <div>
          {TABS.map(t => {
            const Icon = t.icon; const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', marginBottom: 2,
                border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                background: active ? theme.colors.orangeLight : 'transparent',
                color: active ? theme.colors.orange : theme.colors.textSecondary,
                fontWeight: active ? 600 : 500, fontSize: 13, transition: 'all 0.15s',
                borderLeft: active ? `3px solid ${theme.colors.orange}` : '3px solid transparent',
              }}>
                <Icon size={16} />{t.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div>
          {tab === 'general' && (
            <>
              <div style={card}>
                <div style={sectionTitle}>System Configuration</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div><label style={fieldLabel}>Owner Email</label><input defaultValue="justin@stridenw.com" style={input} /></div>
                  <div><label style={fieldLabel}>Timezone</label><select defaultValue="America/Los_Angeles" style={{ ...input, cursor: 'pointer' }}><option>America/Los_Angeles</option><option>America/Denver</option><option>America/Chicago</option><option>America/New_York</option></select></div>
                  <div><label style={fieldLabel}>Master Spreadsheet ID</label><input defaultValue="1abc...xyz" style={{ ...input, fontFamily: 'monospace', fontSize: 11 }} /></div>
                  <div><label style={fieldLabel}>Consolidated Billing ID</label><input defaultValue="16Yq...Tq8" style={{ ...input, fontFamily: 'monospace', fontSize: 11 }} /></div>
                </div>
              </div>
              <div style={card}>
                <div style={sectionTitle}>Feature Flags</div>
                {[
                  { label: 'Enable Receiving Billing', desc: 'Auto-create RCVG billing entries on shipment complete', checked: true },
                  { label: 'Enable Shipment Emails', desc: 'Send receiving notification emails to clients', checked: true },
                  { label: 'Auto Inspection', desc: 'Auto-create inspection tasks for new items', checked: true },
                  { label: 'Enable Notifications', desc: 'Send internal staff notifications', checked: true },
                ].map(f => (
                  <label key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: `1px solid ${theme.colors.borderLight}`, cursor: 'pointer' }}>
                    <input type="checkbox" defaultChecked={f.checked} style={{ accentColor: theme.colors.orange, width: 16, height: 16 }} />
                    <div><div style={{ fontSize: 13, fontWeight: 500 }}>{f.label}</div><div style={{ fontSize: 11, color: theme.colors.textMuted }}>{f.desc}</div></div>
                  </label>
                ))}
              </div>
              <button onClick={() => alert('Coming soon')} style={{ padding: '10px 20px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 8, background: theme.colors.orange, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Save Changes</button>
            </>
          )}

          {tab === 'clients' && (() => {
            const isLive = apiClients.length > 0;
            const q = clientSearch.toLowerCase();
            const filtered = q
              ? apiClients.filter(c =>
                  c.name.toLowerCase().includes(q) ||
                  (c.email || '').toLowerCase().includes(q) ||
                  (c.contactName || '').toLowerCase().includes(q) ||
                  (c.qbCustomerName || '').toLowerCase().includes(q))
              : apiClients;
            // Auto-sort: active clients A-Z first, then inactive A-Z
            const displayClients = [...filtered].sort((a, b) => {
              if (a.active !== b.active) return a.active ? -1 : 1;
              return a.name.localeCompare(b.name);
            });

            return (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={sectionTitle}>{showInactiveClients ? 'All' : 'Active'} Clients ({q ? `${displayClients.length} of ${apiClients.length}` : displayClients.length})</div>
                    {isLive && <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 8, background: '#F0FDF4', color: '#15803D', fontWeight: 700, textTransform: 'uppercase' }}>Live</span>}
                    {clientsLoading && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: theme.colors.textMuted }} />}
                    {clientActionLoading && <span style={{ fontSize: 10, color: theme.colors.orange }}>Processing…</span>}
                    {clientsError && <span style={{ fontSize: 10, color: '#DC2626' }}>{clientsError}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {isLive && (
                      <button
                        onClick={() => setShowInactiveClients(!showInactiveClients)}
                        style={{
                          padding: '6px 12px', fontSize: 11, borderRadius: 6, fontFamily: 'inherit',
                          display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                          border: `1px solid ${showInactiveClients ? theme.colors.orange : theme.colors.border}`,
                          background: showInactiveClients ? theme.colors.orangeLight : '#fff',
                          color: showInactiveClients ? theme.colors.orange : theme.colors.textMuted,
                          fontWeight: showInactiveClients ? 600 : 400,
                        }}
                        title={showInactiveClients ? 'Hide inactive clients' : 'Show inactive clients for reactivation'}
                      >
                        {showInactiveClients ? <EyeOff size={12} /> : <Eye size={12} />}
                        {showInactiveClients ? 'Hide Inactive' : 'Show Inactive'}
                      </button>
                    )}
                    {isLive && isAdmin && (
                      <button
                        onClick={handleOpenResyncClients}
                        title="Reconcile CB Clients (source of truth) with Supabase clients mirror. Use when a newly onboarded client isn't showing up in the app."
                        style={{ padding: '6px 12px', fontSize: 11, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textMuted, display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        <RefreshCcw size={12} /> Resync from CB
                      </button>
                    )}
                    {isLive && (
                      <button
                        onClick={handleSyncAll}
                        disabled={syncLoading}
                        title="Push CB settings to all active client sheets"
                        style={{ padding: '6px 12px', fontSize: 11, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: syncLoading ? 'wait' : 'pointer', fontFamily: 'inherit', color: theme.colors.textMuted, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {syncLoading ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCcw size={12} />}
                        Sync All Settings
                      </button>
                    )}
                    {/* Rediscover Script IDs — hidden from normal view, available in Maintenance tab if needed */}
                    {isLive && <button onClick={refetchClients} style={{ padding: '6px 10px', fontSize: 11, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textMuted }}><RefreshCw size={12} /></button>}
                    <button onClick={openCreateModal} style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: theme.colors.orange, color: '#fff', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Plus size={14} /> Onboard New Client
                    </button>
                  </div>
                </div>

                {/* Sync result */}
                {syncResult && (
                  <div style={{ padding: 12, borderRadius: 10, marginBottom: 12, background: syncResult.failedCount ? '#FEF2F2' : '#F0FDF4', border: `1px solid ${syncResult.failedCount ? '#FECACA' : '#BBF7D0'}`, fontSize: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4, color: syncResult.failedCount ? '#991B1B' : '#15803D' }}>
                      Sync complete — {syncResult.syncedCount} synced{syncResult.failedCount ? `, ${syncResult.failedCount} failed` : ''}
                    </div>
                    {syncResult.failed && syncResult.failed.length > 0 && (
                      <div style={{ color: '#991B1B', fontSize: 11 }}>{syncResult.failed.map(f => `${f.name}: ${f.error}`).join(' · ')}</div>
                    )}
                    <button onClick={() => setSyncResult(null)} style={{ marginTop: 6, fontSize: 10, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 0 }}>Dismiss</button>
                  </div>
                )}
                {syncError && (
                  <div style={{ padding: 12, borderRadius: 10, marginBottom: 12, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 12, color: '#991B1B' }}>
                    Sync failed: {syncError}
                    <button onClick={() => setSyncError('')} style={{ marginLeft: 8, fontSize: 10, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 0 }}>Dismiss</button>
                  </div>
                )}

                {/* Per-client Supabase sync — live progress banner (matches Maintenance bulk-sync look) */}
                {clientSbSyncLoading && clientSbSyncTimer && (
                  <div style={{
                    padding: '12px 16px', marginBottom: 12, borderRadius: 10,
                    background: 'linear-gradient(90deg, #FFF7ED 0%, #FFEDD5 50%, #FFF7ED 100%)',
                    backgroundSize: '200% 100%',
                    animation: 'syncPulse 2s ease-in-out infinite',
                    border: `1px solid ${theme.colors.orange}33`,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Loader2 size={18} color={theme.colors.orange} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: theme.colors.text }}>
                          Syncing {clientSbSyncTimer.clientName} to Supabase…
                        </div>
                        <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 1 }}>
                          Rebuilding inventory / tasks / repairs / will calls / shipments / billing. Typical runtime 15–60s. <strong>Keep this page open until it finishes.</strong>
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: theme.colors.orange, fontVariantNumeric: 'tabular-nums', minWidth: 40, textAlign: 'right' }}>
                      {clientSbSyncTimer.elapsed < 60
                        ? `${clientSbSyncTimer.elapsed}s`
                        : `${Math.floor(clientSbSyncTimer.elapsed / 60)}:${String(clientSbSyncTimer.elapsed % 60).padStart(2, '0')}`}
                    </div>
                    <style>{`@keyframes syncPulse { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }`}</style>
                  </div>
                )}

                {/* Per-client Supabase sync result */}
                {clientSbSyncResult && (
                  <div style={{ padding: 12, borderRadius: 10, marginBottom: 12, background: '#F0FDF4', border: '1px solid #BBF7D0', fontSize: 12 }}>
                    <div style={{ fontWeight: 600, color: '#15803D', marginBottom: 4 }}>
                      ✓ {clientSbSyncResult.clientName} synced to Supabase
                    </div>
                    <div style={{ fontSize: 11, color: '#15803D', opacity: 0.85 }}>
                      Inventory {clientSbSyncResult.totalRows.inventory ?? 0} · Tasks {clientSbSyncResult.totalRows.tasks ?? 0} · Repairs {clientSbSyncResult.totalRows.repairs ?? 0} · Will Calls {clientSbSyncResult.totalRows.will_calls ?? 0} · Shipments {clientSbSyncResult.totalRows.shipments ?? 0} · Billing {clientSbSyncResult.totalRows.billing ?? 0} upserted
                      {clientSbSyncResult.totalDeleted && (
                        Object.values(clientSbSyncResult.totalDeleted).some(v => v > 0)
                          ? ` · ${Object.values(clientSbSyncResult.totalDeleted).reduce((a, b) => a + b, 0)} orphan rows deleted`
                          : ''
                      )}
                    </div>
                    <button onClick={() => setClientSbSyncResult(null)} style={{ marginTop: 6, fontSize: 10, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 0 }}>Dismiss</button>
                  </div>
                )}
                {clientSbSyncError && (
                  <div style={{ padding: 12, borderRadius: 10, marginBottom: 12, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 12, color: '#991B1B' }}>
                    Supabase sync failed for {clientSbSyncError.clientName}: {clientSbSyncError.error}
                    <button onClick={() => setClientSbSyncError(null)} style={{ marginLeft: 8, fontSize: 10, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 0 }}>Dismiss</button>
                  </div>
                )}

                {/* Onboard result */}
                {onboardResult && onboardResult.success && (
                  <div style={{ padding: 12, borderRadius: 10, marginBottom: 12, background: '#F0FDF4', border: '1px solid #BBF7D0', fontSize: 12 }}>
                    <div style={{ fontWeight: 600, color: '#15803D', marginBottom: 6 }}>✓ {onboardResult.clientName} onboarded successfully</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {onboardResult.spreadsheetUrl && (
                        <a href={onboardResult.spreadsheetUrl} target="_blank" rel="noopener noreferrer"
                          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, background: '#fff', border: '1px solid #BBF7D0', color: '#15803D', fontSize: 11, textDecoration: 'none', fontWeight: 500 }}>
                          <ExternalLink size={11} /> Open Sheet
                        </a>
                      )}
                      {onboardResult.clientFolderUrl && (
                        <a href={onboardResult.clientFolderUrl} target="_blank" rel="noopener noreferrer"
                          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, background: '#fff', border: '1px solid #BBF7D0', color: '#15803D', fontSize: 11, textDecoration: 'none', fontWeight: 500 }}>
                          <ExternalLink size={11} /> Open Drive Folder
                        </a>
                      )}
                    </div>
                    {onboardResult.warnings && onboardResult.warnings.length > 0 && (
                      <div style={{ marginTop: 6, fontSize: 11, color: '#B45309' }}>⚠ {onboardResult.warnings.join(' · ')}</div>
                    )}

                    {/* User conflict prompt */}
                    {onboardResult.existingUser && (
                      <div style={{ marginTop: 10, padding: 12, borderRadius: 8, background: '#FEF3C7', border: '1px solid #FDE68A' }}>
                        <div style={{ fontWeight: 600, color: '#92400E', marginBottom: 6, fontSize: 12 }}>
                          Existing User Detected
                        </div>
                        <div style={{ fontSize: 12, color: '#78350F', marginBottom: 8 }}>
                          <strong>{onboardResult.existingUser.email}</strong> already has access to <strong>{onboardResult.existingUser.clientName}</strong>.
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button
                            onClick={() => handleResolveUserConflict('add_access')}
                            disabled={userConflictLoading}
                            style={{ padding: '6px 14px', fontSize: 11, fontWeight: 600, border: 'none', borderRadius: 6, background: userConflictLoading ? theme.colors.border : theme.colors.orange, color: '#fff', cursor: userConflictLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}
                          >
                            {userConflictLoading && <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />}
                            Add "{onboardResult.clientName}" to their access
                          </button>
                          <button
                            onClick={() => handleResolveUserConflict('skip')}
                            disabled={userConflictLoading}
                            style={{ padding: '6px 14px', fontSize: 11, border: `1px solid #FDE68A`, borderRadius: 6, background: '#fff', cursor: userConflictLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', color: '#92400E' }}
                          >
                            Skip user creation
                          </button>
                        </div>
                        <div style={{ fontSize: 10, color: '#92400E', marginTop: 6, opacity: 0.7 }}>
                          Either way, {onboardResult.existingUser.email} will be set as the contact email for notifications on this account.
                        </div>
                      </div>
                    )}

                    <button onClick={() => setOnboardResult(null)} style={{ marginTop: 6, fontSize: 10, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 0 }}>Dismiss</button>
                  </div>
                )}

                {/* Update result */}
                {updateResult && updateResult.success && (
                  <div style={{ padding: 12, borderRadius: 10, marginBottom: 12, background: '#F0FDF4', border: '1px solid #BBF7D0', fontSize: 12, color: '#15803D', fontWeight: 500 }}>
                    ✓ {updateResult.clientName} updated{updateResult.synced ? ' and synced to sheet' : ''}.
                    {updateResult.warnings && updateResult.warnings.length > 0 && (
                      <span style={{ color: '#B45309' }}> ⚠ {updateResult.warnings.join(' · ')}</span>
                    )}
                    <button onClick={() => setUpdateResult(null)} style={{ marginLeft: 8, fontSize: 10, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 0 }}>Dismiss</button>
                  </div>
                )}

                {/* Client error */}
                {clientActionError && (
                  <div style={{ padding: 12, borderRadius: 10, marginBottom: 12, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 12, color: '#991B1B' }}>
                    Error: {clientActionError}
                    <button onClick={() => setClientActionError('')} style={{ marginLeft: 8, fontSize: 10, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 0 }}>Dismiss</button>
                  </div>
                )}

                {/* Welcome email result */}
                {welcomeEmailResult && (
                  <div style={{ padding: 12, borderRadius: 10, marginBottom: 12, background: welcomeEmailResult.ok ? '#F0FDF4' : '#FEF2F2', border: `1px solid ${welcomeEmailResult.ok ? '#BBF7D0' : '#FECACA'}`, fontSize: 12, color: welcomeEmailResult.ok ? '#15803D' : '#991B1B', fontWeight: 500 }}>
                    {welcomeEmailResult.ok
                      ? `Welcome email sent to ${welcomeEmailResult.clientName}`
                      : `Failed to send welcome email to ${welcomeEmailResult.clientName}: ${welcomeEmailResult.error}`}
                    <button onClick={() => setWelcomeEmailResult(null)} style={{ marginLeft: 8, fontSize: 10, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 0 }}>Dismiss</button>
                  </div>
                )}

                {finishSetupResult && (
                  <div style={{ padding: 12, borderRadius: 10, marginBottom: 12, background: finishSetupResult.ok ? '#F0FDF4' : '#FEF2F2', border: `1px solid ${finishSetupResult.ok ? '#BBF7D0' : '#FECACA'}`, fontSize: 12, color: finishSetupResult.ok ? '#15803D' : '#991B1B', fontWeight: 500 }}>
                    {finishSetupResult.ok
                      ? `✓ Finish Setup complete for ${finishSetupResult.clientName}${finishSetupResult.webAppUrl ? ' — Web App deployed & triggers installed' : ''}`
                      : `Finish Setup failed for ${finishSetupResult.clientName}: ${finishSetupResult.error}`}
                    <button onClick={() => setFinishSetupResult(null)} style={{ marginLeft: 8, fontSize: 10, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 0 }}>Dismiss</button>
                  </div>
                )}

                {/* Client search */}
                {isLive && apiClients.length > 6 && (
                  <div style={{ position: 'relative', marginBottom: 12 }}>
                    <AutocompleteInput
                      value={clientSearch}
                      onChange={setClientSearch}
                      suggestions={apiClients.map(c => c.name)}
                      placeholder="Search clients by name, email, contact, or QB name..."
                      allowCustom
                      style={{ width: '100%', fontSize: 13 }}
                    />
                    {clientSearch && (
                      <button
                        onClick={() => setClientSearch('')}
                        style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 2 }}
                        title="Clear search"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                )}

                {/* Client rows */}
                {displayClients.map(c => {
                  const clientActive = (c as ApiClient).active !== false;
                  return (
                  <div key={c.name}
                    onClick={() => isLive ? openEditModal(c as ApiClient) : undefined}
                    style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: isLive ? 'pointer' : 'default', opacity: clientActive ? 1 : 0.55 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</div>
                        {!clientActive && <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 8, background: '#FEF2F2', color: '#DC2626', fontWeight: 700, textTransform: 'uppercase' }}>Inactive</span>}
                        {(c as ApiClient).spreadsheetId && (
                          <a href={`https://docs.google.com/spreadsheets/d/${(c as ApiClient).spreadsheetId}`}
                            target="_blank" rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            style={{ color: theme.colors.textMuted, display: 'flex', alignItems: 'center' }}
                            title="Open inventory sheet">
                            <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>
                        {c.email}
                        {(c as ApiClient).contactName ? ` · ${(c as ApiClient).contactName}` : ''}
                        {(c as ApiClient).phone ? ` · ${(c as ApiClient).phone}` : ''}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: '#F0FDF4', color: '#15803D', fontWeight: 600 }}>Active</span>
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: theme.colors.bgSubtle, color: theme.colors.textMuted }}>{c.freeStorageDays}d free storage</span>
                        {c.autoInspection && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: '#FEF3EE', color: '#E85D2D' }}>Auto-INSP</span>}
                        {(c as ApiClient).qbCustomerName && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: '#EFF6FF', color: '#1D4ED8' }}>QB</span>}
                        {(c as ApiClient).staxCustomerId && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: '#F5F3FF', color: '#7C3AED' }}>Stax</span>}
                        {(c as ApiClient).autoCharge === true && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: '#F0FDF4', color: '#15803D', fontWeight: 600 }}>Auto Pay</span>}
                        {(c as ApiClient).autoCharge !== true && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: '#FEF2F2', color: '#DC2626', fontWeight: 600 }}>Manual Pay</span>}
                        {(c as ApiClient).parentClient && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: '#FEF3C7', color: '#92400E' }}>Child of {(c as ApiClient).parentClient}</span>}
                        {!!(c as ApiClient).name && displayClients.some(dc => (dc as ApiClient).parentClient === c.name) && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: '#DBEAFE', color: '#1E40AF' }}>Parent</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 8 }}>
                      {/* Finish Setup button — shown only during onboarding (Web App URL missing) */}
                      {isLive && (c as ApiClient).spreadsheetId && !(c as ApiClient).webAppUrl && (
                        <button
                          onClick={e => { e.stopPropagation(); handleFinishSetup(c as ApiClient); }}
                          disabled={finishSetupLoading === (c as ApiClient).spreadsheetId}
                          title="Web App URL missing — click to deploy and finish onboarding"
                          style={{ padding: '5px 10px', fontSize: 10, fontWeight: 700, border: '1px solid #F59E0B', borderRadius: 6, background: '#FEF3C7', cursor: finishSetupLoading === (c as ApiClient).spreadsheetId ? 'wait' : 'pointer', fontFamily: 'inherit', color: '#92400E', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
                        >
                          {finishSetupLoading === (c as ApiClient).spreadsheetId
                            ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
                            : <Zap size={11} />}
                          {finishSetupLoading === (c as ApiClient).spreadsheetId ? 'Finishing…' : 'Finish Setup'}
                        </button>
                      )}
                      {isLive && (c as ApiClient).spreadsheetId && (
                        <button
                          onClick={e => { e.stopPropagation(); handleSendWelcomeEmail(c as ApiClient); }}
                          disabled={welcomeEmailLoading === (c as ApiClient).spreadsheetId}
                          title={`Send welcome email to ${c.email}`}
                          style={{ padding: '5px 10px', fontSize: 10, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: welcomeEmailLoading === (c as ApiClient).spreadsheetId ? 'wait' : 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
                        >
                          {welcomeEmailLoading === (c as ApiClient).spreadsheetId ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={11} />}
                          Welcome Email
                        </button>
                      )}
                      {/* Per-client Supabase sync — re-mirror this one client without running the full bulk sync */}
                      {isLive && (c as ApiClient).spreadsheetId && clientActive && (
                        <button
                          onClick={e => { e.stopPropagation(); handleClientSupabaseSync(c as ApiClient); }}
                          disabled={clientSbSyncLoading === (c as ApiClient).spreadsheetId || bulkSyncLoading}
                          title={`Sync ${c.name} to Supabase (re-mirror inventory / tasks / repairs / will calls / shipments / billing)`}
                          style={{ padding: '5px 10px', fontSize: 10, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: clientSbSyncLoading === (c as ApiClient).spreadsheetId ? 'wait' : (bulkSyncLoading ? 'not-allowed' : 'pointer'), fontFamily: 'inherit', color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', opacity: bulkSyncLoading ? 0.5 : 1 }}
                        >
                          {clientSbSyncLoading === (c as ApiClient).spreadsheetId
                            ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
                            : <Cloud size={11} />}
                          {clientSbSyncLoading === (c as ApiClient).spreadsheetId ? 'Syncing…' : 'Sync'}
                        </button>
                      )}
                      {/* Edit button — opens the same edit modal as clicking the card, but visible & obvious */}
                      {isLive && (
                        <button
                          onClick={e => { e.stopPropagation(); openEditModal(c as ApiClient); }}
                          title={`Edit ${c.name}`}
                          style={{ padding: '5px 10px', fontSize: 10, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
                        >
                          <Edit2 size={11} /> Edit
                        </button>
                      )}
                      {isLive && <ChevronRight size={18} color={theme.colors.textMuted} />}
                    </div>
                  </div>
                  );
                })}

                {/* Modal */}
                {clientModalOpen && (
                  <OnboardClientModal
                    mode={clientModalMode}
                    existingClient={selectedClient}
                    allClients={apiClients}
                    onClose={() => setClientModalOpen(false)}
                    onSubmit={handleClientSubmit}
                  />
                )}

                {/* Session 70 follow-up — Resync Clients modal (CB → Supabase clients mirror) */}
                {resyncClientsOpen && (
                  <div
                    onClick={() => !resyncClientsLoading && setResyncClientsOpen(false)}
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <div
                      onClick={e => e.stopPropagation()}
                      style={{ background: '#fff', borderRadius: 12, width: 'min(620px, 92vw)', maxHeight: '86vh', overflow: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}
                    >
                      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: 16, fontWeight: 700 }}>Resync Clients from CB</div>
                        <button onClick={() => !resyncClientsLoading && setResyncClientsOpen(false)} style={{ background: 'none', border: 'none', cursor: resyncClientsLoading ? 'not-allowed' : 'pointer', padding: 4, color: theme.colors.textMuted }}>
                          <X size={18} />
                        </button>
                      </div>
                      <div style={{ padding: 20 }}>
                        <div style={{ fontSize: 13, color: theme.colors.textSecondary, lineHeight: 1.6, marginBottom: 14 }}>
                          Reads every row from the <strong>CB Clients</strong> sheet (source of truth) and upserts into the Supabase <code>clients</code> mirror.
                          Any Supabase row whose spreadsheet ID isn't in CB is deleted.
                          Use this when a newly onboarded client isn't appearing in the app.
                        </div>

                        {resyncClientsLoading && !resyncClientsPreviewState && !resyncClientsResult && (
                          <div style={{ padding: '20px 0', textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>
                            <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', marginBottom: 8 }} />
                            <div>Computing diff…</div>
                          </div>
                        )}

                        {resyncClientsPreviewState && !resyncClientsResult && (
                          <>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                              <div style={{ padding: 12, background: theme.colors.bgSubtle, borderRadius: 8, border: `1px solid ${theme.colors.border}` }}>
                                <div style={{ fontSize: 11, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>CB Clients</div>
                                <div style={{ fontSize: 22, fontWeight: 700, color: theme.colors.text }}>{resyncClientsPreviewState.cbCount}</div>
                                <div style={{ fontSize: 10, color: theme.colors.textMuted }}>source of truth</div>
                              </div>
                              <div style={{ padding: 12, background: theme.colors.bgSubtle, borderRadius: 8, border: `1px solid ${theme.colors.border}` }}>
                                <div style={{ fontSize: 11, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Supabase clients</div>
                                <div style={{ fontSize: 22, fontWeight: 700, color: theme.colors.text }}>{resyncClientsPreviewState.sbCount}</div>
                                <div style={{ fontSize: 10, color: (resyncClientsPreviewState.willDeleteSb.length > 0 || resyncClientsPreviewState.missingFromSb.length > 0) ? '#B45309' : theme.colors.textMuted }}>
                                  {resyncClientsPreviewState.missingFromSb.length > 0 ? `${resyncClientsPreviewState.missingFromSb.length} missing` : ''}
                                  {resyncClientsPreviewState.missingFromSb.length > 0 && resyncClientsPreviewState.willDeleteSb.length > 0 ? ' · ' : ''}
                                  {resyncClientsPreviewState.willDeleteSb.length > 0 ? `${resyncClientsPreviewState.willDeleteSb.length} orphans` : ''}
                                  {resyncClientsPreviewState.missingFromSb.length === 0 && resyncClientsPreviewState.willDeleteSb.length === 0 ? 'in sync' : ''}
                                </div>
                              </div>
                            </div>

                            {resyncClientsPreviewState.missingFromSb.length > 0 && (
                              <div style={{ padding: 10, border: '1px solid #A7F3D0', background: '#ECFDF5', borderRadius: 8, marginBottom: 10 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: '#065F46', marginBottom: 4 }}>
                                  Will add to Supabase ({resyncClientsPreviewState.missingFromSb.length}):
                                </div>
                                <div style={{ fontSize: 11, color: '#065F46', fontFamily: 'monospace', wordBreak: 'break-all', maxHeight: 140, overflowY: 'auto' }}>
                                  {resyncClientsPreviewState.missingFromSb.map(r => `${r.name}  (${r.sid.substring(0, 14)}…)`).join('\n')}
                                </div>
                              </div>
                            )}

                            {resyncClientsPreviewState.willDeleteSb.length > 0 && (
                              <div style={{ padding: 10, border: '1px solid #FECACA', background: '#FEF2F2', borderRadius: 8, marginBottom: 14 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: '#991B1B', marginBottom: 4 }}>
                                  Will delete Supabase orphans ({resyncClientsPreviewState.willDeleteSb.length}):
                                </div>
                                <div style={{ fontSize: 11, color: '#991B1B', fontFamily: 'monospace', wordBreak: 'break-all', maxHeight: 140, overflowY: 'auto' }}>
                                  {resyncClientsPreviewState.willDeleteSb.map(r => `${r.name || '(no name)'}  (${(r.spreadsheetId || '').substring(0, 14)}…)`).join('\n')}
                                </div>
                              </div>
                            )}

                            {resyncClientsPreviewState.missingFromSb.length === 0 && resyncClientsPreviewState.willDeleteSb.length === 0 && (
                              <div style={{ padding: 10, border: '1px solid #A7F3D0', background: '#ECFDF5', borderRadius: 8, marginBottom: 14, fontSize: 12, color: '#065F46' }}>
                                ✓ Supabase clients already matches CB. Running resync will re-upsert {resyncClientsPreviewState.cbCount} rows for idempotency.
                              </div>
                            )}
                          </>
                        )}

                        {resyncClientsResult && (
                          <div style={{ padding: 12, border: `1px solid ${resyncClientsResult.ok ? '#A7F3D0' : '#FECACA'}`, background: resyncClientsResult.ok ? '#ECFDF5' : '#FEF2F2', borderRadius: 8, marginBottom: 14 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: resyncClientsResult.ok ? '#065F46' : '#991B1B', marginBottom: 6 }}>
                              {resyncClientsResult.message}
                            </div>
                            {resyncClientsResult.details && (
                              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: resyncClientsResult.ok ? '#065F46' : '#991B1B' }}>
                                {resyncClientsResult.details.map((d, i) => <li key={i}>{d}</li>)}
                              </ul>
                            )}
                          </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                          {!resyncClientsResult ? (
                            <>
                              <button
                                onClick={() => !resyncClientsLoading && setResyncClientsOpen(false)}
                                disabled={resyncClientsLoading}
                                style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: resyncClientsLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}
                              >
                                Cancel
                              </button>
                              <button
                                onClick={handleRunResyncClients}
                                disabled={resyncClientsLoading || !resyncClientsPreviewState}
                                style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: theme.colors.orange, color: '#fff', cursor: (resyncClientsLoading || !resyncClientsPreviewState) ? 'wait' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4, opacity: (resyncClientsLoading || !resyncClientsPreviewState) ? 0.7 : 1 }}
                              >
                                {resyncClientsLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCcw size={13} />}
                                {resyncClientsLoading ? 'Resyncing…' : 'Run Resync'}
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setResyncClientsOpen(false)}
                              style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: theme.colors.orange, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}
                            >
                              Done
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            );
          })()}

          {tab === 'users' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={sectionTitle}>User Access Management</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {/* Session 70 follow-up — admin-only resync tool */}
                  {isAdmin && (
                    <button
                      onClick={handleOpenResync}
                      title="Reconcile CB Users (source of truth) with Supabase cb_users mirror and (optionally) auth.users"
                      style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', color: theme.colors.textSecondary, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <RefreshCcw size={14} /> Resync Users
                    </button>
                  )}
                  <button
                    onClick={() => { setAddUserOpen(true); setAddUserError(''); }}
                    style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: theme.colors.orange, color: '#fff', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    <UserPlus size={14} /> Add User
                  </button>
                </div>
              </div>

              {addUserSuccess && (
                <div style={{ padding: '10px 14px', fontSize: 12, background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 8, color: '#065F46', marginBottom: 12 }}>
                  {addUserSuccess}
                </div>
              )}

              {sendWelcomeResult && (
                <div style={{
                  padding: '10px 14px', fontSize: 12, borderRadius: 8, marginBottom: 12,
                  background: sendWelcomeResult.ok ? '#ECFDF5' : '#FEF2F2',
                  border: `1px solid ${sendWelcomeResult.ok ? '#A7F3D0' : '#FECACA'}`,
                  color: sendWelcomeResult.ok ? '#065F46' : '#991B1B',
                  fontWeight: 500,
                }}>
                  {sendWelcomeResult.message}
                </div>
              )}

              {/* Add User inline form */}
              {addUserOpen && (
                <div style={{ ...card, border: `1px solid ${theme.colors.orange}`, marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>New User</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10, marginBottom: 10 }}>
                    <div>
                      <label style={fieldLabel}>Email *</label>
                      <input
                        value={newUserEmail}
                        onChange={e => { setNewUserEmail(e.target.value); setAddUserError(''); }}
                        placeholder="user@example.com"
                        style={input}
                        autoFocus
                        disabled={addUserLoading}
                      />
                    </div>
                    <div>
                      <label style={fieldLabel}>Role *</label>
                      <select
                        value={newUserRole}
                        onChange={e => setNewUserRole(e.target.value as 'admin' | 'staff' | 'client')}
                        style={{ ...input, cursor: 'pointer' }}
                        disabled={addUserLoading}
                      >
                        <option value="staff">Staff</option>
                        <option value="admin">Admin</option>
                        <option value="client">Client</option>
                      </select>
                    </div>
                  </div>
                  {newUserRole === 'client' && (
                    <div style={{ marginBottom: 10 }}>
                      <label style={fieldLabel}>Client Accounts</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 32, padding: '6px 10px', border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', alignItems: 'center' }}>
                        {newUserClientNames.length === 0 && <span style={{ fontSize: 11, color: theme.colors.textMuted }}>No clients assigned</span>}
                        {newUserClientNames.map((name, idx) => (
                          <span key={newUserClientIds[idx] || idx} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10, background: theme.colors.orangeLight, color: theme.colors.orange, fontSize: 11, fontWeight: 600 }}>
                            {name}
                            <button onClick={() => removeNewUserClientAccess(idx)} disabled={addUserLoading} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: theme.colors.orange, padding: 0, lineHeight: 1 }}>&times;</button>
                          </span>
                        ))}
                        <button
                          onClick={() => setNewUserAddClientDropdown(!newUserAddClientDropdown)}
                          disabled={addUserLoading}
                          style={{ background: 'none', border: `1px dashed ${theme.colors.border}`, borderRadius: 8, padding: '2px 10px', fontSize: 11, cursor: 'pointer', color: theme.colors.textMuted, fontFamily: 'inherit' }}
                        >
                          + Add
                        </button>
                      </div>
                      {newUserAddClientDropdown && (
                        <div style={{ marginTop: 6, maxHeight: 200, overflowY: 'auto', border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                          {apiClients
                            .filter(c => c.active !== false && !newUserClientIds.includes(c.spreadsheetId))
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map(c => (
                              <button
                                key={c.spreadsheetId}
                                onClick={() => addNewUserClientAccess(c.name, c.spreadsheetId)}
                                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12, border: 'none', borderBottom: `1px solid ${theme.colors.borderLight}`, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}
                                onMouseOver={e => (e.currentTarget.style.background = theme.colors.bgSubtle)}
                                onMouseOut={e => (e.currentTarget.style.background = '#fff')}
                              >
                                {c.name}
                              </button>
                            ))}
                          {apiClients.filter(c => c.active !== false && !newUserClientIds.includes(c.spreadsheetId)).length === 0 && (
                            <div style={{ padding: '8px 12px', fontSize: 11, color: theme.colors.textMuted }}>All clients already assigned</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {addUserError && (
                    <div style={{ padding: '7px 10px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 7, fontSize: 12, color: '#DC2626', marginBottom: 10 }}>
                      {addUserError}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={handleAddUser}
                      disabled={addUserLoading}
                      style={{ padding: '8px 18px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: addUserLoading ? theme.colors.border : theme.colors.orange, color: addUserLoading ? theme.colors.textMuted : '#fff', cursor: addUserLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      {addUserLoading && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
                      {addUserLoading ? 'Adding…' : 'Add User'}
                    </button>
                    <button
                      onClick={() => { setAddUserOpen(false); setNewUserEmail(''); setNewUserRole('staff'); setNewUserClientNames([]); setNewUserClientIds([]); setNewUserAddClientDropdown(false); setAddUserError(''); }}
                      style={{ padding: '8px 14px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* User Edit Panel */}
              {editingUser && (
                <div ref={userEditPanelRef} style={{ ...card, border: `2px solid ${theme.colors.orange}`, marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>Edit User</div>
                    <button onClick={() => setEditingUser(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: theme.colors.textMuted, padding: 0, lineHeight: 1 }}>&times;</button>
                  </div>

                  {/* Email (editable) */}
                  <div style={{ marginBottom: 12 }}>
                    <label style={fieldLabel}>Email</label>
                    <input value={editEmail} onChange={e => setEditEmail(e.target.value.trim().toLowerCase())} style={input} disabled={editSaving} placeholder="user@example.com" />
                    {editEmail !== editingUser.email && editEmail && (
                      <div style={{ fontSize: 11, color: '#F59E0B', marginTop: 4 }}>Email will be changed from {editingUser.email} → {editEmail}. Update the Supabase auth email separately if needed.</div>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    {/* Role */}
                    <div>
                      <label style={fieldLabel}>Role</label>
                      <select value={editRole} onChange={e => setEditRole(e.target.value as 'admin' | 'staff' | 'client')} style={{ ...input, cursor: 'pointer' }} disabled={editSaving}>
                        <option value="admin">Admin</option>
                        <option value="staff">Staff</option>
                        <option value="client">Client</option>
                      </select>
                    </div>
                    {/* Active */}
                    <div>
                      <label style={fieldLabel}>Active</label>
                      <button
                        onClick={() => setEditActive(!editActive)}
                        disabled={editSaving}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, width: '100%' }}
                      >
                        {editActive ? <ToggleRight size={18} color="#15803D" /> : <ToggleLeft size={18} color={theme.colors.textMuted} />}
                        <span style={{ color: editActive ? '#15803D' : theme.colors.textMuted, fontWeight: 600 }}>{editActive ? 'Active' : 'Inactive'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Client Access */}
                  {editRole === 'client' && (
                    <div style={{ marginBottom: 12 }}>
                      <label style={fieldLabel}>Client Access</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 32, padding: '6px 10px', border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', alignItems: 'center' }}>
                        {editClientNames.length === 0 && <span style={{ fontSize: 11, color: theme.colors.textMuted }}>No clients assigned</span>}
                        {editClientNames.map((name, idx) => (
                          <span key={editClientIds[idx] || idx} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10, background: theme.colors.orangeLight, color: theme.colors.orange, fontSize: 11, fontWeight: 600 }}>
                            {name}
                            <button onClick={() => removeClientAccess(idx)} disabled={editSaving} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: theme.colors.orange, padding: 0, lineHeight: 1 }}>&times;</button>
                          </span>
                        ))}
                        <button
                          onClick={() => setAddClientDropdown(!addClientDropdown)}
                          disabled={editSaving}
                          style={{ background: 'none', border: `1px dashed ${theme.colors.border}`, borderRadius: 8, padding: '2px 10px', fontSize: 11, cursor: 'pointer', color: theme.colors.textMuted, fontFamily: 'inherit' }}
                        >
                          + Add
                        </button>
                      </div>
                      {addClientDropdown && (
                        <div style={{ marginTop: 6, maxHeight: 200, overflowY: 'auto', border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                          {apiClients.filter(c => !editClientIds.includes(c.spreadsheetId)).map(c => (
                            <button
                              key={c.spreadsheetId}
                              onClick={() => addClientAccess(c.name, c.spreadsheetId)}
                              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12, border: 'none', borderBottom: `1px solid ${theme.colors.borderLight}`, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}
                              onMouseOver={e => (e.currentTarget.style.background = theme.colors.bgSubtle)}
                              onMouseOut={e => (e.currentTarget.style.background = '#fff')}
                            >
                              {c.name}
                            </button>
                          ))}
                          {apiClients.filter(c => !editClientIds.includes(c.spreadsheetId)).length === 0 && (
                            <div style={{ padding: '8px 12px', fontSize: 11, color: theme.colors.textMuted }}>All clients already assigned</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {editRole !== 'client' && (
                    <div style={{ marginBottom: 12, padding: '8px 12px', background: theme.colors.bgSubtle, borderRadius: 8, fontSize: 11, color: theme.colors.textMuted }}>
                      Staff and admin users have access to all client accounts.
                    </div>
                  )}

                  {/* Audit info */}
                  <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 11, color: theme.colors.textMuted }}>
                    {editingUser.created && <span>Created: {editingUser.created}</span>}
                    {editingUser.lastLogin && <span>Last login: {editingUser.lastLogin}</span>}
                    {editingUser.updatedBy && <span>Updated by: {editingUser.updatedBy}</span>}
                  </div>

                  {editError && (
                    <div style={{ padding: '7px 10px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 7, fontSize: 12, color: '#DC2626', marginBottom: 10 }}>
                      {editError}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={handleSaveUser}
                        disabled={editSaving}
                        style={{ padding: '8px 18px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: editSaving ? theme.colors.border : theme.colors.orange, color: editSaving ? theme.colors.textMuted : '#fff', cursor: editSaving ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}
                      >
                        {editSaving && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
                        {editSaving ? 'Saving…' : 'Save Changes'}
                      </button>
                      <button onClick={() => setEditingUser(null)} style={{ padding: '8px 14px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>
                        Cancel
                      </button>
                    </div>
                    {/* Delete user */}
                    {!deleteConfirm ? (
                      <button onClick={() => setDeleteConfirm(true)} disabled={editSaving} style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, border: '1px solid #FECACA', borderRadius: 8, background: '#FEF2F2', cursor: 'pointer', fontFamily: 'inherit', color: '#DC2626' }}>
                        Delete User
                      </button>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: '#DC2626' }}>Delete permanently?</span>
                        <button onClick={async () => {
                          setEditSaving(true);
                          const res = await deleteUser(editingUser.email);
                          setEditSaving(false);
                          if (res.success) { setEditingUser(null); setDeleteConfirm(false); }
                          else { setEditError(res.error || 'Delete failed'); setDeleteConfirm(false); }
                        }} disabled={editSaving} style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, border: 'none', borderRadius: 6, background: '#DC2626', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
                          Yes, Delete
                        </button>
                        <button onClick={() => setDeleteConfirm(false)} style={{ padding: '5px 12px', fontSize: 11, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>
                          No
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* User search */}
              {users.length > 4 && (
                <div style={{ position: 'relative', marginBottom: 12 }}>
                  <AutocompleteInput
                    value={userSearch}
                    onChange={setUserSearch}
                    suggestions={users.map(u => u.email)}
                    placeholder="Search users by email, role, or client name..."
                    allowCustom
                    style={{ width: '100%', fontSize: 13 }}
                  />
                  {userSearch && (
                    <button
                      onClick={() => setUserSearch('')}
                      style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 2 }}
                      title="Clear search"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              )}

              {/* Users table (TanStack Table with sortable headers) */}
              {usersLoading && <div style={{ padding: 20, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>Loading users…</div>}
              {usersError && <div style={{ padding: '10px 14px', background: '#FEF2F2', borderRadius: 8, color: '#DC2626', fontSize: 12, marginBottom: 12 }}>{usersError}</div>}
              {!usersLoading && (() => {
                const thStyle: React.CSSProperties = {
                  padding: '10px 14px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted,
                  textTransform: 'uppercase', letterSpacing: '0.04em', userSelect: 'none',
                };

                return (
                  <div style={{ ...card, padding: 0 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        {userTable.getHeaderGroups().map(hg => (
                          <tr key={hg.id} style={{ borderBottom: `2px solid ${theme.colors.border}` }}>
                            {hg.headers.map(h => (
                              <th
                                key={h.id}
                                onClick={h.column.getCanSort() ? (e) => h.column.toggleSorting(undefined, e.shiftKey) : undefined}
                                style={{
                                  ...thStyle,
                                  textAlign: (h.column.columnDef.meta as any)?.align || 'left',
                                  cursor: h.column.getCanSort() ? 'pointer' : 'default',
                                }}
                              >
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  {flexRender(h.column.columnDef.header, h.getContext())}
                                  {h.column.getCanSort() && (
                                    h.column.getIsSorted() === 'asc' ? <ChevronUp size={12} /> :
                                    h.column.getIsSorted() === 'desc' ? <ChevronDown size={12} /> :
                                    <ArrowUpDown size={10} style={{ opacity: 0.4 }} />
                                  )}
                                </span>
                              </th>
                            ))}
                          </tr>
                        ))}
                      </thead>
                      <tbody>
                        {userTable.getRowModel().rows.length === 0 && (
                          <tr><td colSpan={6} style={{ padding: '20px 14px', textAlign: 'center', color: theme.colors.textMuted, fontSize: 12 }}>
                            {userSearch ? 'No users match your search.' : 'No users found. Add your first user above.'}
                          </td></tr>
                        )}
                        {userTable.getRowModel().rows.map(row => {
                          const u = row.original;
                          const isSelected = editingUser?.email === u.email;
                          return (
                            <tr
                              key={row.id}
                              onClick={() => openUserEdit(u)}
                              style={{ borderBottom: `1px solid ${theme.colors.borderLight}`, opacity: u.active ? 1 : 0.55, cursor: 'pointer', background: isSelected ? theme.colors.orangeLight : undefined }}
                              onMouseOver={e => { if (!isSelected) e.currentTarget.style.background = theme.colors.bgSubtle; }}
                              onMouseOut={e => { if (!isSelected) e.currentTarget.style.background = ''; }}
                            >
                              {row.getVisibleCells().map(cell => (
                                <td key={cell.id} style={{ padding: '10px 14px', textAlign: (cell.column.columnDef.meta as any)?.align || 'left' }}>
                                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}

              <div style={{ padding: 14, background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 10, fontSize: 12, color: '#0369A1', marginTop: 16, lineHeight: 1.6 }}>
                <strong>How it works:</strong> Users are stored in the "Users" tab of the Consolidated Billing sheet. All roles (admin, staff, client) sign in with email + password. Client users are automatically created when you onboard a new client — they just need to use "Forgot Password" on the login page to set their password. Click any row to edit user details, role, and client access. Users can have access to multiple client accounts (shown as chips).
              </div>

              {/* Session 70 follow-up — Resync Users modal */}
              {resyncOpen && (
                <div
                  onClick={() => !resyncLoading && setResyncOpen(false)}
                  style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{ background: '#fff', borderRadius: 12, width: 'min(600px, 92vw)', maxHeight: '86vh', overflow: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}
                  >
                    <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>Resync Users</div>
                      <button onClick={() => !resyncLoading && setResyncOpen(false)} style={{ background: 'none', border: 'none', cursor: resyncLoading ? 'not-allowed' : 'pointer', padding: 4, color: theme.colors.textMuted }}>
                        <X size={18} />
                      </button>
                    </div>

                    <div style={{ padding: 20 }}>
                      <div style={{ fontSize: 13, color: theme.colors.textSecondary, lineHeight: 1.6, marginBottom: 14 }}>
                        Reconciles the three places user data lives. <strong>CB Users</strong> is the source of truth.
                        <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                          <li><strong>cb_users</strong> (Supabase mirror) — every CB row is upserted; orphans are deleted</li>
                          <li><strong>auth.users</strong> (Supabase login) — orphans are listed; deletion is opt-in below</li>
                        </ul>
                      </div>

                      {resyncLoading && !resyncPreview && !resyncResult && (
                        <div style={{ padding: '20px 0', textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>
                          <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', marginBottom: 8 }} />
                          <div>Computing diff…</div>
                        </div>
                      )}

                      {resyncPreview && !resyncResult && (
                        <>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
                            <div style={{ padding: 12, background: theme.colors.bgSubtle, borderRadius: 8, border: `1px solid ${theme.colors.border}` }}>
                              <div style={{ fontSize: 11, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>CB Users</div>
                              <div style={{ fontSize: 22, fontWeight: 700, color: theme.colors.text }}>{resyncPreview.cbCount}</div>
                              <div style={{ fontSize: 10, color: theme.colors.textMuted }}>source of truth</div>
                            </div>
                            <div style={{ padding: 12, background: theme.colors.bgSubtle, borderRadius: 8, border: `1px solid ${theme.colors.border}` }}>
                              <div style={{ fontSize: 11, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>cb_users</div>
                              <div style={{ fontSize: 22, fontWeight: 700, color: theme.colors.text }}>{resyncPreview.sbCount}</div>
                              <div style={{ fontSize: 10, color: resyncPreview.willDeleteSb.length > 0 ? '#DC2626' : theme.colors.textMuted }}>
                                {resyncPreview.willDeleteSb.length > 0 ? `${resyncPreview.willDeleteSb.length} orphan${resyncPreview.willDeleteSb.length === 1 ? '' : 's'}` : 'in sync'}
                              </div>
                            </div>
                            <div style={{ padding: 12, background: theme.colors.bgSubtle, borderRadius: 8, border: `1px solid ${theme.colors.border}` }}>
                              <div style={{ fontSize: 11, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>auth.users</div>
                              <div style={{ fontSize: 22, fontWeight: 700, color: theme.colors.text }}>{resyncPreview.authCount}</div>
                              <div style={{ fontSize: 10, color: resyncPreview.authOrphans.length > 0 ? '#B45309' : theme.colors.textMuted }}>
                                {resyncPreview.authOrphans.length > 0 ? `${resyncPreview.authOrphans.length} orphan${resyncPreview.authOrphans.length === 1 ? '' : 's'}` : 'in sync'}
                              </div>
                            </div>
                          </div>

                          {resyncPreview.willDeleteSb.length > 0 && (
                            <div style={{ padding: 10, border: '1px solid #FECACA', background: '#FEF2F2', borderRadius: 8, marginBottom: 10 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: '#991B1B', marginBottom: 4 }}>
                                Will delete from cb_users ({resyncPreview.willDeleteSb.length}):
                              </div>
                              <div style={{ fontSize: 11, color: '#991B1B', fontFamily: 'monospace', wordBreak: 'break-all', maxHeight: 120, overflowY: 'auto' }}>
                                {resyncPreview.willDeleteSb.join('\n')}
                              </div>
                            </div>
                          )}

                          {resyncPreview.authOrphans.length > 0 && (
                            <div style={{ padding: 10, border: '1px solid #FDE68A', background: '#FFFBEB', borderRadius: 8, marginBottom: 14 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: '#92400E', marginBottom: 4 }}>
                                auth.users accounts NOT in CB ({resyncPreview.authOrphans.length}):
                              </div>
                              <div style={{ fontSize: 11, color: '#92400E', fontFamily: 'monospace', wordBreak: 'break-all', maxHeight: 120, overflowY: 'auto' }}>
                                {resyncPreview.authOrphans.join('\n')}
                              </div>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#92400E', marginTop: 8, cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={resyncPruneAuth}
                                  onChange={e => setResyncPruneAuth(e.target.checked)}
                                  style={{ accentColor: theme.colors.orange }}
                                />
                                Also delete these {resyncPreview.authOrphans.length} auth.users accounts (disables login for these emails)
                              </label>
                            </div>
                          )}

                          {resyncPreview.willDeleteSb.length === 0 && resyncPreview.authOrphans.length === 0 && (
                            <div style={{ padding: 10, border: '1px solid #A7F3D0', background: '#ECFDF5', borderRadius: 8, marginBottom: 14, fontSize: 12, color: '#065F46' }}>
                              ✓ All 3 stores are already in sync. Running resync will re-upsert {resyncPreview.cbCount} CB rows for idempotency.
                            </div>
                          )}
                        </>
                      )}

                      {resyncResult && (
                        <div style={{ padding: 12, border: `1px solid ${resyncResult.ok ? '#A7F3D0' : '#FECACA'}`, background: resyncResult.ok ? '#ECFDF5' : '#FEF2F2', borderRadius: 8, marginBottom: 14 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: resyncResult.ok ? '#065F46' : '#991B1B', marginBottom: 6 }}>
                            {resyncResult.message}
                          </div>
                          {resyncResult.details && resyncResult.details.length > 0 && (
                            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: resyncResult.ok ? '#065F46' : '#991B1B' }}>
                              {resyncResult.details.map((d, i) => <li key={i}>{d}</li>)}
                            </ul>
                          )}
                        </div>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                        {!resyncResult ? (
                          <>
                            <button
                              onClick={() => !resyncLoading && setResyncOpen(false)}
                              disabled={resyncLoading}
                              style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: resyncLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleRunResync}
                              disabled={resyncLoading || !resyncPreview}
                              style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: theme.colors.orange, color: '#fff', cursor: (resyncLoading || !resyncPreview) ? 'wait' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4, opacity: (resyncLoading || !resyncPreview) ? 0.7 : 1 }}
                            >
                              {resyncLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCcw size={13} />}
                              {resyncLoading ? 'Resyncing…' : 'Run Resync'}
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setResyncOpen(false)}
                            style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: theme.colors.orange, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}
                          >
                            Done
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'pricing' && (() => {
            const isLive = priceList.length > 0;
            const displayPricing = isLive ? priceList.map(p => ({
              code: String(p['Service Code'] || ''),
              name: String(p['Service Name'] || ''),
              xs: Number(p['XS Rate']) || 0,
              s: Number(p['S Rate']) || 0,
              m: Number(p['M Rate']) || 0,
              l: Number(p['L Rate']) || 0,
              xl: Number(p['XL Rate']) || 0,
            })) : MOCK_PRICING;
            const displayClasses = isLive ? classMap.map(c => ({
              c: String(c.Class || ''),
              vol: `${Number(c['Cubic Volume']) || 0} cu ft`,
            })) : [{ c: 'XS', vol: '\u226410 cu ft' }, { c: 'S', vol: '11-25' }, { c: 'M', vol: '26-50' }, { c: 'L', vol: '51-75' }, { c: 'XL', vol: '76+' }];

            return (
              <div style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={sectionTitle}>Service Rates by Class</div>
                    {isLive && <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 8, background: '#F0FDF4', color: '#15803D', fontWeight: 700, textTransform: 'uppercase' }}>Live</span>}
                    {pricingLoading && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: theme.colors.textMuted }} />}
                    {pricingError && <span style={{ fontSize: 10, color: '#DC2626' }}>{pricingError}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {isLive && <button onClick={refetchPricing} style={{ padding: '6px 10px', fontSize: 11, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textMuted }}><RefreshCw size={12} /></button>}
                    <button onClick={() => alert('Coming soon — Edit rates')} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Edit Rates</button>
                  </div>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ borderBottom: `2px solid ${theme.colors.border}` }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Code</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Service</th>
                    {['XS', 'S', 'M', 'L', 'XL'].map(c => <th key={c} style={{ padding: '8px 10px', textAlign: 'right', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>{c}</th>)}
                  </tr></thead>
                  <tbody>{displayPricing.map(p => (
                    <tr key={p.code} style={{ borderBottom: `1px solid ${theme.colors.borderLight}` }}>
                      <td style={{ padding: '8px 10px', fontWeight: 600, fontFamily: 'monospace' }}>{p.code}</td>
                      <td style={{ padding: '8px 10px', color: theme.colors.textSecondary }}>{p.name}</td>
                      {[p.xs, p.s, p.m, p.l, p.xl].map((v, i) => <td key={i} style={{ padding: '8px 10px', textAlign: 'right' }}>${v.toFixed(2)}</td>)}
                    </tr>
                  ))}</tbody>
                </table>
                <div style={{ marginTop: 16 }}>
                  <div style={sectionTitle}>Class Map</div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    {displayClasses.map(x => (
                      <div key={x.c} style={{ flex: 1, padding: '10px', background: theme.colors.bgSubtle, borderRadius: 8, textAlign: 'center' }}>
                        <div style={{ fontSize: 16, fontWeight: 700 }}>{x.c}</div>
                        <div style={{ fontSize: 10, color: theme.colors.textMuted, marginTop: 2 }}>{x.vol}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          {tab === 'emails' && (
            <>
              {/* Top bar: Sync + Test Send input */}
              <div style={card}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: theme.colors.orangeLight, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Mail size={14} color={theme.colors.orange} />
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>Email & Document Templates</div>
                      <div style={{ fontSize: 12, color: theme.colors.textSecondary }}>Edit templates, test-send emails, and sync to all client sheets.</div>
                    </div>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => setTplSyncConfirmOpen(true)}
                      disabled={tplSyncing}
                      style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 8, background: theme.colors.orange, color: '#fff', cursor: tplSyncing ? 'default' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      {tplSyncing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <FolderSync size={13} />}
                      {tplSyncing ? 'Syncing…' : 'Sync to All Clients'}
                    </button>
                  )}
                </div>
                {tplSyncResult && (
                  <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 10, fontSize: 12, background: tplSyncResult.failed > 0 ? '#FEF3C7' : '#F0FDF4', color: tplSyncResult.failed > 0 ? '#92400E' : '#15803D', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {tplSyncResult.failed > 0 ? <AlertCircle size={13} /> : <CheckCircle2 size={13} />}
                    {tplSyncResult.message}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    value={testToEmail}
                    onChange={e => setTestToEmail(e.target.value)}
                    placeholder="Test recipient email address"
                    type="email"
                    style={{ ...input, flex: 1 }}
                  />
                  <button
                    onClick={handleTestSendAllClientTemplates}
                    disabled={emailSendAllLoading || !testToEmail.trim()}
                    style={{ padding: '9px 18px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: testToEmail.trim() ? theme.colors.orange : theme.colors.bgSubtle, color: testToEmail.trim() ? '#fff' : theme.colors.textMuted, cursor: testToEmail.trim() ? 'pointer' : 'default', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flexShrink: 0 }}
                  >
                    {emailSendAllLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={13} />}
                    {emailSendAllLoading ? 'Sending…' : 'Send All'}
                  </button>
                </div>
              </div>

              {templatesLoading && (
                <div style={{ textAlign: 'center', padding: 20, color: theme.colors.textMuted, fontSize: 12 }}>Loading templates from Master…</div>
              )}
              {templatesFetchError && (
                <div style={{ padding: '10px 16px', margin: '0 0 12px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FCA5A5', fontSize: 12, color: '#DC2626' }}>
                  Template fetch failed: {templatesFetchError}
                </div>
              )}
              {!templatesLoading && !templatesFetchError && liveTemplates.length === 0 && (
                <div style={{ padding: '10px 16px', margin: '0 0 12px', borderRadius: 8, background: '#FEF3C7', border: '1px solid #FCD34D', fontSize: 12, color: '#92400E' }}>
                  No templates loaded. The getEmailTemplates API may not be responding. Check that StrideAPI is deployed (v172+).
                </div>
              )}

              {/* Client Email Templates */}
              <div style={{ ...sectionTitle, marginBottom: 12 }}>Client Emails ({EMAIL_TEMPLATES.length})</div>
              {EMAIL_TEMPLATES.map(e => {
                const result = emailTestResults[e.key];
                const loading = emailTestLoading[e.key];
                const live = getLiveTemplate(e.key);
                return (
                  <div key={e.key} style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{e.name}</span>
                        <span style={{ fontSize: 10, fontFamily: 'monospace', color: theme.colors.textMuted, background: theme.colors.bgSubtle, padding: '1px 6px', borderRadius: 4, flexShrink: 0 }}>{e.key}</span>
                      </div>
                      <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 3 }}>{e.desc}</div>
                      {result && (
                        <div style={{ marginTop: 5, fontSize: 11, color: result.sent ? '#15803D' : '#DC2626', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {result.sent ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                          {result.sent ? `Sent to ${testToEmail}` : (result.error || 'Failed')}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, marginLeft: 12 }}>
                      {live && (
                        <button onClick={() => setEditingTemplate(live)} style={{ padding: '5px 12px', fontSize: 11, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Edit</button>
                      )}
                      <button
                        onClick={() => handleTestSendOneClientTemplate(e.key)}
                        disabled={loading || !testToEmail.trim()}
                        style={{ padding: '5px 14px', fontSize: 11, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: (loading || !testToEmail.trim()) ? 'default' : 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: 5 }}
                      >
                        {loading ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={11} />}
                        {loading ? 'Sending…' : 'Test'}
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* System Templates (Welcome + Onboarding) */}
              <div style={{ ...sectionTitle, marginTop: 20, marginBottom: 12 }}>System Emails ({SYSTEM_TEMPLATES.length})</div>
              {SYSTEM_TEMPLATES.map(e => {
                const result = emailTestResults[e.key];
                const loading = emailTestLoading[e.key];
                const live = getLiveTemplate(e.key);
                return (
                  <div key={e.key} style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{e.name}</span>
                        <span style={{ fontSize: 10, fontFamily: 'monospace', color: theme.colors.textMuted, background: theme.colors.bgSubtle, padding: '1px 6px', borderRadius: 4 }}>{e.key}</span>
                        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: '#EFF6FF', color: '#1D4ED8', fontWeight: 600 }}>SYSTEM</span>
                      </div>
                      <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 3 }}>{e.desc}</div>
                      {result && (
                        <div style={{ marginTop: 5, fontSize: 11, color: result.sent ? '#15803D' : '#DC2626', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {result.sent ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                          {result.sent ? `Sent to ${testToEmail}` : (result.error || 'Failed')}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, marginLeft: 12 }}>
                      {live && (
                        <button onClick={() => setEditingTemplate(live)} style={{ padding: '5px 12px', fontSize: 11, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Edit</button>
                      )}
                      <button
                        onClick={() => handleTestSendOneClientTemplate(e.key)}
                        disabled={loading || !testToEmail.trim()}
                        style={{ padding: '5px 14px', fontSize: 11, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: (loading || !testToEmail.trim()) ? 'default' : 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: 5 }}
                      >
                        {loading ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={11} />}
                        {loading ? 'Sending…' : 'Test'}
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Document Templates */}
              <div style={{ ...sectionTitle, marginTop: 20, marginBottom: 12 }}>Document Templates ({DOC_TEMPLATES.length})</div>
              {DOC_TEMPLATES.map(e => {
                const live = getLiveTemplate(e.key);
                return (
                  <div key={e.key} style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{e.name}</span>
                        <span style={{ fontSize: 10, fontFamily: 'monospace', color: theme.colors.textMuted, background: theme.colors.bgSubtle, padding: '1px 6px', borderRadius: 4 }}>{e.key}</span>
                        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: '#FEF3C7', color: '#92400E', fontWeight: 600 }}>DOC</span>
                      </div>
                      <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 3 }}>{e.desc}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, marginLeft: 12 }}>
                      {live && (
                        <button onClick={() => setEditingTemplate(live)} style={{ padding: '5px 12px', fontSize: 11, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Edit</button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Claim Email Templates (merged from Claims tab) */}
              <div style={{ ...sectionTitle, marginTop: 20, marginBottom: 12 }}>Claim Emails ({CLAIM_EMAIL_TEMPLATES.length})</div>
              {CLAIM_EMAIL_TEMPLATES.map(e => {
                const result = claimEmailTestResults[e.key];
                const loading = claimEmailTestLoading[e.key];
                const live = getLiveTemplate(e.key);
                return (
                  <div key={e.key} style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{e.name}</span>
                        <span style={{ fontSize: 10, fontFamily: 'monospace', color: theme.colors.textMuted, background: theme.colors.bgSubtle, padding: '1px 6px', borderRadius: 4, flexShrink: 0 }}>{e.key}</span>
                      </div>
                      <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 3 }}>{e.desc}</div>
                      {result && (
                        <div style={{ marginTop: 5, fontSize: 11, color: result.sent ? '#15803D' : '#DC2626', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {result.sent ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                          {result.sent
                            ? `Sent to ${testToEmail}${result.usedFallback ? ' (inline fallback)' : ' (Master template)'}`
                            : (result.error || 'Failed')}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, marginLeft: 12 }}>
                      {live && (
                        <button onClick={() => setEditingTemplate(live)} style={{ padding: '5px 12px', fontSize: 11, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Edit</button>
                      )}
                      <button
                        onClick={() => handleTestSendOneClaimEmail(e.key)}
                        disabled={loading || !testToEmail.trim()}
                        style={{ padding: '5px 14px', fontSize: 11, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: (loading || !testToEmail.trim()) ? 'default' : 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: 5 }}
                      >
                        {loading ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={11} />}
                        {loading ? 'Sending…' : 'Test'}
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Editor overlay */}
              {editingTemplate && (
                <TemplateEditor
                  template={editingTemplate}
                  onClose={() => setEditingTemplate(null)}
                  onSaved={() => { refreshTemplates(); setEditingTemplate(null); }}
                />
              )}

              {/* Sync confirmation */}
              <ConfirmDialog
                open={tplSyncConfirmOpen}
                title="Sync Templates to All Clients"
                message="Push all email and document templates from the Master Price List to every client's Email_Template_Cache tab? This overwrites their cached copies."
                confirmLabel="Sync Now"
                cancelLabel="Cancel"
                onConfirm={handleSyncToClients}
                onCancel={() => setTplSyncConfirmOpen(false)}
                processing={tplSyncing}
              />
            </>
          )}

          {/* Claims tab removed — merged into Email Templates tab above */}

          {tab === 'integrations' && (
            <IntegrationsTab />
          )}

          {tab === 'maintenance' && (() => {
            const runResultCard = (result: RunOnClientsResponse | null, error: string, onDismiss: () => void, onDismissError: () => void) => (
              <>
                {result && (
                  <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: result.failed > 0 ? '#FEF3C7' : '#F0FDF4', border: `1px solid ${result.failed > 0 ? '#F59E0B' : '#BBF7D0'}`, fontSize: 12 }}>
                    <div style={{ fontWeight: 600, color: result.failed > 0 ? '#92400E' : '#15803D', marginBottom: 4 }}>
                      {result.succeeded} succeeded{result.failed > 0 ? `, ${result.failed} failed` : ''}
                    </div>
                    {result.results.filter(r => !r.ok).map((r, i) => (
                      <div key={r.sheetId || r.name || i} style={{ color: '#991B1B', fontSize: 11 }}>
                        {r.name}: {r.error || (r as any).message || 'Unknown error'}
                      </div>
                    ))}
                    <button onClick={onDismiss} style={{ marginTop: 4, fontSize: 10, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 0 }}>Dismiss</button>
                  </div>
                )}
                {error && (
                  <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 12, color: '#991B1B' }}>
                    {error}
                    <button onClick={onDismissError} style={{ marginLeft: 8, fontSize: 10, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 0 }}>Dismiss</button>
                  </div>
                )}
              </>
            );

            return (
              <>
                {/* System Health Check */}
                <HealthCheckCard />

                {/* Refresh Caches */}
                <div style={card}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <div style={{ width: 30, height: 30, borderRadius: 8, background: theme.colors.orangeLight, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <RefreshCcw size={15} color={theme.colors.orange} />
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>Refresh All Caches</div>
                      </div>
                      <div style={{ fontSize: 12, color: theme.colors.textSecondary, lineHeight: 1.5, marginLeft: 38 }}>
                        Copies the latest Pricing, Class Map, Email Templates, and Locations from Master sources into every active client sheet. Run this after updating rates or adding new email templates.
                      </div>
                      {refreshCachesProgress && (
                        <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: '#FFF7ED', border: '1px solid #FED7AA', fontSize: 12 }}>
                          <div style={{ fontWeight: 600, color: theme.colors.orange, marginBottom: 6 }}>
                            Refreshing {refreshCachesProgress.done + 1} of {refreshCachesProgress.total}: {refreshCachesProgress.current}
                          </div>
                          <div style={{ height: 6, background: '#FED7AA', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${(refreshCachesProgress.done / refreshCachesProgress.total) * 100}%`, height: '100%', background: theme.colors.orange, transition: 'width 0.3s ease' }} />
                          </div>
                        </div>
                      )}
                      {refreshCachesResult && (
                        <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: refreshCachesResult.failed.length > 0 ? '#FEF3C7' : '#F0FDF4', border: `1px solid ${refreshCachesResult.failed.length > 0 ? '#F59E0B' : '#BBF7D0'}`, fontSize: 12 }}>
                          <div style={{ fontWeight: 600, color: refreshCachesResult.failed.length > 0 ? '#92400E' : '#15803D', marginBottom: 4 }}>
                            {refreshCachesResult.synced.length} synced{refreshCachesResult.failed.length > 0 ? `, ${refreshCachesResult.failed.length} failed` : ''}
                          </div>
                          {refreshCachesResult.failed.map(f => (
                            <div key={f.sheetId} style={{ color: '#991B1B', fontSize: 11 }}>{f.name}: {f.error}</div>
                          ))}
                          <button onClick={() => setRefreshCachesResult(null)} style={{ marginTop: 4, fontSize: 10, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 0 }}>Dismiss</button>
                        </div>
                      )}
                      {refreshCachesError && (
                        <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 12, color: '#991B1B' }}>
                          {refreshCachesError}
                          <button onClick={() => setRefreshCachesError('')} style={{ marginLeft: 8, fontSize: 10, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 0 }}>Dismiss</button>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={handleRefreshCaches}
                      disabled={refreshCachesLoading || !apiConfigured}
                      title={!apiConfigured ? 'Configure API connection first' : ''}
                      style={{ padding: '8px 18px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: refreshCachesLoading ? theme.colors.border : theme.colors.orange, color: refreshCachesLoading ? theme.colors.textMuted : '#fff', cursor: refreshCachesLoading ? 'wait' : !apiConfigured ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, opacity: !apiConfigured ? 0.5 : 1 }}
                    >
                      {refreshCachesLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <PlayCircle size={13} />}
                      {refreshCachesLoading
                        ? (refreshCachesProgress ? `${refreshCachesProgress.done}/${refreshCachesProgress.total}` : 'Running…')
                        : 'Run'}
                    </button>
                  </div>
                </div>

                {/* Update Headers & Validations */}
                <div style={card}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <div style={{ width: 30, height: 30, borderRadius: 8, background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Database size={15} color="#1D4ED8" />
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>Update Headers &amp; Validations</div>
                      </div>
                      <div style={{ fontSize: 12, color: theme.colors.textSecondary, lineHeight: 1.5, marginLeft: 38 }}>
                        Adds any missing column headers and refreshes dropdown validations on all active client sheets. Run this after a schema update or when a client sheet is missing columns.
                      </div>
                      {updateHeadersProgress && (
                        <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: '#EFF6FF', border: '1px solid #BFDBFE', fontSize: 12 }}>
                          <div style={{ fontWeight: 600, color: '#1D4ED8', marginBottom: 6 }}>
                            Updating {updateHeadersProgress.done + 1} of {updateHeadersProgress.total}: {updateHeadersProgress.current}
                          </div>
                          <div style={{ height: 6, background: '#DBEAFE', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${(updateHeadersProgress.done / updateHeadersProgress.total) * 100}%`, height: '100%', background: '#2563EB', transition: 'width 0.3s ease' }} />
                          </div>
                        </div>
                      )}
                      {runResultCard(
                        updateHeadersResult,
                        updateHeadersError,
                        () => setUpdateHeadersResult(null),
                        () => setUpdateHeadersError('')
                      )}
                    </div>
                    <button
                      onClick={handleUpdateHeaders}
                      disabled={updateHeadersLoading || !apiConfigured}
                      title={!apiConfigured ? 'Configure API connection first' : ''}
                      style={{ padding: '8px 18px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: updateHeadersLoading ? theme.colors.border : '#1D4ED8', color: updateHeadersLoading ? theme.colors.textMuted : '#fff', cursor: updateHeadersLoading ? 'wait' : !apiConfigured ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, opacity: !apiConfigured ? 0.5 : 1 }}
                    >
                      {updateHeadersLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <PlayCircle size={13} />}
                      {updateHeadersLoading
                        ? (updateHeadersProgress ? `${updateHeadersProgress.done}/${updateHeadersProgress.total}` : 'Running…')
                        : 'Run'}
                    </button>
                  </div>
                </div>

                {/* Install Triggers */}
                <div style={card}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <div style={{ width: 30, height: 30, borderRadius: 8, background: '#F0FDF4', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Bell size={15} color="#15803D" />
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>Install Triggers</div>
                      </div>
                      <div style={{ fontSize: 12, color: theme.colors.textSecondary, lineHeight: 1.5, marginLeft: 38 }}>
                        Reinstalls the 5 onEdit triggers on all active client sheets. Run this when a client sheet stops responding to edits, or after onboarding a batch of new clients.
                      </div>
                      {installTriggersProgress && (
                        <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: '#F0FDF4', border: '1px solid #BBF7D0', fontSize: 12 }}>
                          <div style={{ fontWeight: 600, color: '#15803D', marginBottom: 6 }}>
                            Installing {installTriggersProgress.done + 1} of {installTriggersProgress.total}: {installTriggersProgress.current}
                          </div>
                          <div style={{ height: 6, background: '#DCFCE7', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${(installTriggersProgress.done / installTriggersProgress.total) * 100}%`, height: '100%', background: '#16A34A', transition: 'width 0.3s ease' }} />
                          </div>
                        </div>
                      )}
                      {runResultCard(
                        installTriggersResult,
                        installTriggersError,
                        () => setInstallTriggersResult(null),
                        () => setInstallTriggersError('')
                      )}
                    </div>
                    <button
                      onClick={handleInstallTriggers}
                      disabled={installTriggersLoading || !apiConfigured}
                      title={!apiConfigured ? 'Configure API connection first' : ''}
                      style={{ padding: '8px 18px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: installTriggersLoading ? theme.colors.border : '#15803D', color: installTriggersLoading ? theme.colors.textMuted : '#fff', cursor: installTriggersLoading ? 'wait' : !apiConfigured ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, opacity: !apiConfigured ? 0.5 : 1 }}
                    >
                      {installTriggersLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <PlayCircle size={13} />}
                      {installTriggersLoading
                        ? (installTriggersProgress ? `${installTriggersProgress.done}/${installTriggersProgress.total}` : 'Running…')
                        : 'Run'}
                    </button>
                  </div>
                </div>

                {/* Sync Autocomplete DB */}
                <div style={card}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <div style={{ width: 30, height: 30, borderRadius: 8, background: '#F5F3FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <BookText size={15} color="#7C3AED" />
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>Sync Autocomplete DB</div>
                      </div>
                      <div style={{ fontSize: 12, color: theme.colors.textSecondary, lineHeight: 1.5, marginLeft: 38 }}>
                        Rebuilds the Autocomplete_DB tab on all active client sheets with current Vendor, Description, and Sidemark values from their Inventory. Run this after bulk imports or data cleanup.
                      </div>
                      {syncAutocompProgress && (
                        <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: '#F5F3FF', border: '1px solid #DDD6FE', fontSize: 12 }}>
                          <div style={{ fontWeight: 600, color: '#7C3AED', marginBottom: 6 }}>
                            Syncing {syncAutocompProgress.done + 1} of {syncAutocompProgress.total}: {syncAutocompProgress.current}
                          </div>
                          <div style={{ height: 6, background: '#DDD6FE', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${(syncAutocompProgress.done / syncAutocompProgress.total) * 100}%`, height: '100%', background: '#7C3AED', transition: 'width 0.3s ease' }} />
                          </div>
                        </div>
                      )}
                      {runResultCard(
                        syncAutocompResult,
                        syncAutocompError,
                        () => setSyncAutocompResult(null),
                        () => setSyncAutocompError('')
                      )}
                    </div>
                    <button
                      onClick={handleSyncAutocompleteDB}
                      disabled={syncAutocompLoading || !apiConfigured}
                      title={!apiConfigured ? 'Configure API connection first' : ''}
                      style={{ padding: '8px 18px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: syncAutocompLoading ? theme.colors.border : '#7C3AED', color: syncAutocompLoading ? theme.colors.textMuted : '#fff', cursor: syncAutocompLoading ? 'wait' : !apiConfigured ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, opacity: !apiConfigured ? 0.5 : 1 }}
                    >
                      {syncAutocompLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <PlayCircle size={13} />}
                      {syncAutocompLoading
                        ? (syncAutocompProgress ? `${syncAutocompProgress.done}/${syncAutocompProgress.total}` : 'Running…')
                        : 'Run'}
                    </button>
                  </div>
                </div>

                {/* Fix Missing Folders */}
                <div style={card}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <div style={{ width: 30, height: 30, borderRadius: 8, background: '#FFF7ED', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <FolderSync size={15} color="#B45309" />
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>Fix Missing Folders</div>
                      </div>
                      <div style={{ fontSize: 12, color: theme.colors.textSecondary, lineHeight: 1.5, marginLeft: 38 }}>
                        Scans all sheet tabs (Inventory, Tasks, Repairs, Shipments, Will Calls, WC Items) for rows without Drive folder hyperlinks and creates them. Run this after bulk imports or if folder buttons show as disabled.
                      </div>
                      {fixFoldersProgress && (
                        <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: '#FFF7ED', border: '1px solid #FED7AA', fontSize: 12 }}>
                          <div style={{ fontWeight: 600, color: '#B45309', marginBottom: 6 }}>
                            Scanning {fixFoldersProgress.done + 1} of {fixFoldersProgress.total}: {fixFoldersProgress.current}
                          </div>
                          <div style={{ height: 6, background: '#FED7AA', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${(fixFoldersProgress.done / fixFoldersProgress.total) * 100}%`, height: '100%', background: '#B45309', transition: 'width 0.3s ease' }} />
                          </div>
                        </div>
                      )}
                      {fixFoldersResult && (
                        <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: fixFoldersResult.errors > 0 ? '#FEF3C7' : '#F0FDF4', border: `1px solid ${fixFoldersResult.errors > 0 ? '#F59E0B' : '#BBF7D0'}`, fontSize: 12 }}>
                          <div style={{ fontWeight: 600, color: fixFoldersResult.errors > 0 ? '#92400E' : '#15803D', marginBottom: 4 }}>
                            {fixFoldersResult.fixed > 0
                              ? `Fixed ${fixFoldersResult.fixed} missing folder links across ${fixFoldersResult.clients} client(s)`
                              : `All folder links already in place (${fixFoldersResult.clients} client(s) checked)`}
                            {fixFoldersResult.errors > 0 ? ` (${fixFoldersResult.errors} failed)` : ''}
                          </div>
                          <button onClick={() => setFixFoldersResult(null)} style={{ marginTop: 4, fontSize: 10, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 0 }}>Dismiss</button>
                        </div>
                      )}
                      {fixFoldersError && (
                        <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 12, color: '#991B1B' }}>
                          {fixFoldersError}
                          <button onClick={() => setFixFoldersError('')} style={{ marginLeft: 8, fontSize: 10, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 0 }}>Dismiss</button>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={handleFixMissingFolders}
                      disabled={fixFoldersLoading || !apiConfigured}
                      title={!apiConfigured ? 'Configure API connection first' : ''}
                      style={{ padding: '8px 18px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: fixFoldersLoading ? theme.colors.border : '#B45309', color: fixFoldersLoading ? theme.colors.textMuted : '#fff', cursor: fixFoldersLoading ? 'wait' : !apiConfigured ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, opacity: !apiConfigured ? 0.5 : 1 }}
                    >
                      {fixFoldersLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <PlayCircle size={13} />}
                      {fixFoldersLoading
                        ? (fixFoldersProgress ? `${fixFoldersProgress.done}/${fixFoldersProgress.total}` : 'Running…')
                        : 'Run'}
                    </button>
                  </div>
                </div>

                {/* Bulk Sync to Supabase */}
                <div style={card}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <div style={{ width: 30, height: 30, borderRadius: 8, background: '#ECFDF5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Cloud size={15} color="#059669" />
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>Bulk Sync to Supabase</div>
                      </div>
                      <div style={{ fontSize: 12, color: theme.colors.textSecondary, lineHeight: 1.5, marginLeft: 38 }}>
                        Re-syncs the Supabase read cache (Inventory, Tasks, Repairs, Will Calls, Shipments, Billing) from the current sheet data across all active clients. Also <strong>deletes orphan rows</strong> in Supabase that no longer exist in sheets. Run this after deleting rows directly in Google Sheets to keep the app in sync.
                      </div>
                      <div style={{ marginTop: 8, marginLeft: 38, padding: '8px 10px', borderRadius: 6, background: '#FFFBEB', border: '1px solid #FDE68A', fontSize: 11, color: '#92400E', lineHeight: 1.4 }}>
                        <strong>⚠ Keep this page open until the sync finishes.</strong> The sync runs client-by-client (15–60s each, total 15–45 min for all clients). If you close the tab, navigate away, or let the device sleep, the loop stops and you'll need to restart it.
                      </div>
                      {bulkSyncProgress && (
                        <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: '#EFF6FF', border: '1px solid #BFDBFE', fontSize: 12 }}>
                          <div style={{ fontWeight: 600, color: '#1D4ED8', marginBottom: 6 }}>
                            Syncing {bulkSyncProgress.done + 1} of {bulkSyncProgress.total}: {bulkSyncProgress.current}
                          </div>
                          <div style={{ height: 6, background: '#DBEAFE', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{
                              width: `${((bulkSyncProgress.done) / bulkSyncProgress.total) * 100}%`,
                              height: '100%',
                              background: '#2563EB',
                              transition: 'width 0.3s ease',
                            }} />
                          </div>
                        </div>
                      )}
                      {bulkSyncResult && (
                        <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: '#F0FDF4', border: '1px solid #BBF7D0', fontSize: 12 }}>
                          <div style={{ fontWeight: 600, color: '#15803D', marginBottom: 6 }}>
                            Synced {bulkSyncResult.clientsSynced} client{bulkSyncResult.clientsSynced !== 1 ? 's' : ''}
                            {(bulkSyncResult.inactivePurged ?? 0) > 0 && (
                              <span style={{ fontWeight: 400 }}> · {bulkSyncResult.inactivePurged} inactive client{bulkSyncResult.inactivePurged !== 1 ? 's' : ''} purged</span>
                            )}
                          </div>
                          <div style={{ color: '#166534', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 16px', marginBottom: 4 }}>
                            <div>Inventory: {bulkSyncResult.totalRows.inventory} upserted{bulkSyncResult.totalDeleted ? `, ${bulkSyncResult.totalDeleted.inventory} deleted` : ''}</div>
                            <div>Tasks: {bulkSyncResult.totalRows.tasks} upserted{bulkSyncResult.totalDeleted ? `, ${bulkSyncResult.totalDeleted.tasks} deleted` : ''}</div>
                            <div>Repairs: {bulkSyncResult.totalRows.repairs} upserted{bulkSyncResult.totalDeleted ? `, ${bulkSyncResult.totalDeleted.repairs} deleted` : ''}</div>
                            <div>Will Calls: {bulkSyncResult.totalRows.will_calls} upserted{bulkSyncResult.totalDeleted ? `, ${bulkSyncResult.totalDeleted.will_calls} deleted` : ''}</div>
                            <div>Shipments: {bulkSyncResult.totalRows.shipments} upserted{bulkSyncResult.totalDeleted ? `, ${bulkSyncResult.totalDeleted.shipments} deleted` : ''}</div>
                            <div>Billing: {bulkSyncResult.totalRows.billing} upserted{bulkSyncResult.totalDeleted ? `, ${bulkSyncResult.totalDeleted.billing} deleted` : ''}</div>
                          </div>
                          <button onClick={() => { setBulkSyncResult(null); localStorage.removeItem('stride_bulkSyncResult'); }} style={{ marginTop: 4, fontSize: 10, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 0 }}>Dismiss</button>
                        </div>
                      )}
                      {bulkSyncError && (
                        <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 12, color: '#991B1B' }}>
                          {bulkSyncError}
                          <button onClick={() => { setBulkSyncError(''); localStorage.removeItem('stride_bulkSyncError'); }} style={{ marginLeft: 8, fontSize: 10, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 0 }}>Dismiss</button>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={handleBulkSyncToSupabase}
                      disabled={bulkSyncLoading || !apiConfigured}
                      title={!apiConfigured ? 'Configure API connection first' : ''}
                      style={{ padding: '8px 18px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: bulkSyncLoading ? theme.colors.border : '#059669', color: bulkSyncLoading ? theme.colors.textMuted : '#fff', cursor: bulkSyncLoading ? 'wait' : !apiConfigured ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, opacity: !apiConfigured ? 0.5 : 1 }}
                    >
                      {bulkSyncLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <PlayCircle size={13} />}
                      {bulkSyncLoading
                        ? (bulkSyncProgress ? `${bulkSyncProgress.done}/${bulkSyncProgress.total}` : 'Syncing…')
                        : 'Run'}
                    </button>
                  </div>
                </div>

                {/* Purge Inactive Clients from Supabase */}
                <div style={card}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <div style={{ width: 30, height: 30, borderRadius: 8, background: '#FEF2F2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <EyeOff size={15} color="#DC2626" />
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>Purge Inactive Clients</div>
                      </div>
                      <div style={{ fontSize: 12, color: theme.colors.textSecondary, lineHeight: 1.5, marginLeft: 38 }}>
                        Removes all Supabase cached data (Inventory, Tasks, Repairs, Will Calls, Shipments, Billing) for clients marked <strong>Inactive</strong> in the CB Clients sheet. Fast — only targets inactive clients, no full sync needed. Also runs automatically when you deactivate a client through the Settings edit modal.
                      </div>
                      <div style={{ marginTop: 8, marginLeft: 38, padding: '8px 10px', borderRadius: 6, background: '#FFFBEB', border: '1px solid #FDE68A', fontSize: 11, color: '#92400E', lineHeight: 1.4 }}>
                        <strong>⚠ Keep this page open until the purge finishes.</strong> Runs for ~5–20s per inactive client. If you close the tab mid-run, partial purges may leave stale data — re-run to clean up.
                      </div>
                      {purgeInactiveResult && (() => {
                        const anyFailed = purgeInactiveResult.purged.some(p => p.purge?.failCount && p.purge.failCount > 0);
                        const bgColor = purgeInactiveResult.purgedCount === 0 ? '#F8FAFC' : anyFailed ? '#FEF2F2' : '#F0FDF4';
                        const borderColor = purgeInactiveResult.purgedCount === 0 ? '#E2E8F0' : anyFailed ? '#FECACA' : '#BBF7D0';
                        const textColor = purgeInactiveResult.purgedCount === 0 ? theme.colors.textSecondary : anyFailed ? '#991B1B' : '#15803D';
                        return (
                          <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: bgColor, border: `1px solid ${borderColor}`, fontSize: 12 }}>
                            <div style={{ fontWeight: 600, color: textColor }}>
                              {purgeInactiveResult.purgedCount === 0
                                ? 'No inactive clients found'
                                : anyFailed
                                  ? `Purge attempted for ${purgeInactiveResult.purgedCount} inactive client${purgeInactiveResult.purgedCount !== 1 ? 's' : ''} — some DELETEs failed (check Supabase API key)`
                                  : `Purged ${purgeInactiveResult.purgedCount} inactive client${purgeInactiveResult.purgedCount !== 1 ? 's' : ''}`}
                            </div>
                            {purgeInactiveResult.purgedCount > 0 && (
                              <div style={{ marginTop: 6, fontSize: 11 }}>
                                {purgeInactiveResult.purged.map((p, i) => {
                                  const d = p.purge?.details;
                                  const failed = p.purge?.failCount && p.purge.failCount > 0;
                                  return (
                                    <div key={i} style={{ marginBottom: 4, color: failed ? '#991B1B' : '#166534' }}>
                                      <strong>{p.name}</strong>
                                      {d && (
                                        <span style={{ marginLeft: 8, fontWeight: 400 }}>
                                          {Object.entries(d).map(([table, val]) => (
                                            `${table}: ${typeof val === 'number' ? val + ' deleted' : val}`
                                          )).join(' · ')}
                                        </span>
                                      )}
                                      {failed && <span style={{ marginLeft: 6, fontWeight: 600 }}> ⚠ FAILED</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            <button onClick={() => setPurgeInactiveResult(null)} style={{ marginTop: 4, fontSize: 10, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 0 }}>Dismiss</button>
                          </div>
                        );
                      })()}
                      {purgeInactiveError && (
                        <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 12, color: '#991B1B' }}>
                          {purgeInactiveError}
                          <button onClick={() => setPurgeInactiveError('')} style={{ marginLeft: 8, fontSize: 10, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 0 }}>Dismiss</button>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={handlePurgeInactive}
                      disabled={purgeInactiveLoading || !apiConfigured}
                      style={{ padding: '8px 18px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: purgeInactiveLoading ? theme.colors.border : '#DC2626', color: purgeInactiveLoading ? theme.colors.textMuted : '#fff', cursor: purgeInactiveLoading ? 'wait' : !apiConfigured ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, opacity: !apiConfigured ? 0.5 : 1 }}
                    >
                      {purgeInactiveLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <EyeOff size={13} />}
                      {purgeInactiveLoading ? 'Purging…' : 'Purge'}
                    </button>
                  </div>
                </div>

                {/* Auto-Generate Item IDs */}
                <div style={card}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <div style={{ width: 30, height: 30, borderRadius: 8, background: '#FFF7ED', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {autoIdEnabled ? <ToggleRight size={15} color={theme.colors.orange} /> : <ToggleLeft size={15} color={theme.colors.textMuted} />}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>Auto-Generate Item IDs</div>
                        {autoIdEnabled !== null && (
                          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: autoIdEnabled ? '#F0FDF4' : '#F3F4F6', color: autoIdEnabled ? '#15803D' : '#6B7280', fontWeight: 700, textTransform: 'uppercase' }}>
                            {autoIdEnabled ? 'ON' : 'OFF'}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: theme.colors.textSecondary, lineHeight: 1.5, marginLeft: 38 }}>
                        When enabled, Item IDs are automatically assigned during Dock Intake (Receiving). IDs are sequential numbers starting from the <code>NEXT_ITEM_ID</code> value in CB Settings. Turn this on when label printers are ready.
                      </div>
                      {autoIdError && (
                        <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 12, color: '#991B1B' }}>
                          {autoIdError}
                          <button onClick={() => setAutoIdError('')} style={{ marginLeft: 8, fontSize: 10, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 0 }}>Dismiss</button>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={handleToggleAutoId}
                      disabled={autoIdToggleLoading || autoIdEnabled === null || !apiConfigured}
                      title={!apiConfigured ? 'Configure API connection first' : autoIdEnabled ? 'Turn off auto-generated Item IDs' : 'Turn on auto-generated Item IDs'}
                      style={{ padding: '8px 18px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: autoIdToggleLoading ? theme.colors.border : autoIdEnabled ? '#DC2626' : theme.colors.orange, color: autoIdToggleLoading ? theme.colors.textMuted : '#fff', cursor: autoIdToggleLoading ? 'wait' : !apiConfigured ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, opacity: !apiConfigured || autoIdEnabled === null ? 0.5 : 1 }}
                    >
                      {autoIdToggleLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : autoIdEnabled ? <ToggleRight size={13} /> : <ToggleLeft size={13} />}
                      {autoIdToggleLoading ? 'Saving…' : autoIdEnabled ? 'Turn Off' : 'Turn On'}
                    </button>
                  </div>
                </div>

                {/* Script ID info note */}
                <div style={{ padding: 14, background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 10, fontSize: 12, color: '#0369A1', lineHeight: 1.6 }}>
                  <strong>Note:</strong> Update Headers and Install Triggers use the Apps Script Execution API and require a <strong>Script ID</strong> for each client in the CB Clients tab. If a client shows "missing scriptId" errors, add their bound script ID to the "Script ID" column in Consolidated Billing → Clients tab. Script IDs can be found in <code>admin/clients.json</code> or by opening Extensions → Apps Script on each client sheet and copying the project ID from the URL.
                </div>
              </>
            );
          })()}

          {tab === 'notifications' && (
            <div style={card}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', textAlign: 'center' }}>
                <Bell size={40} color={theme.colors.textMuted} style={{ marginBottom: 16, opacity: 0.4 }} />
                <div style={{ fontSize: 18, fontWeight: 700, color: theme.colors.textPrimary, marginBottom: 6 }}>Notifications Coming Soon</div>
                <div style={{ fontSize: 13, color: theme.colors.textMuted, maxWidth: 360, lineHeight: 1.5 }}>
                  In-app and email notification preferences will be configurable here in a future update. You'll be able to choose which events trigger alerts and how they're delivered.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
