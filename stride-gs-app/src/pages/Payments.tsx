import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Users, FileText, Zap, AlertTriangle, Send, CheckCircle2, XCircle, RefreshCw, DollarSign, Activity, UploadCloud, Loader2, Search } from 'lucide-react';
import { theme } from '../styles/theme';
import { WriteButton } from '../components/shared/WriteButton';
// PreChargeValidationModal removed — batch charging now done via Charge Selected button
import { PaymentDetailPanel, type PaymentInvoice } from '../components/shared/PaymentDetailPanel';
import { CustomerVerificationPanel, type StaxCustomer } from '../components/shared/CustomerVerificationPanel';
import {
  fetchStaxInvoices, fetchStaxChargeLog, fetchStaxExceptions,
  fetchStaxCustomers, fetchStaxRunLog, fetchStaxConfig,
  postImportIIF, postResolveStaxException, postUpdateStaxConfig,
  postSaveStaxCustomerMapping, postAutoMatchStaxCustomers,
  postPullStaxCustomers, postSyncStaxCustomers,
  postCreateStaxInvoices, postStaxRefreshCustomerIds, postChargeSingleInvoice,
  postSendStaxPayLinks, postSendStaxPayLink,
  postCreateTestInvoice, postVoidStaxInvoice, postUpdateStaxInvoice, postDeleteStaxInvoice, postResetStaxInvoiceStatus, postToggleAutoCharge, postLinkStaxInvoiceToExisting,
  postBatchVoidStaxInvoices, postBatchDeleteStaxInvoices, type BatchMutationResult,
  fetchIIFFiles, postImportIIFFromDrive, type IIFFile,
  setNextFetchNoCache,
  type StaxInvoice, type StaxCharge, type StaxException,
  type StaxCustomerRow, type StaxRunLogEntry,
} from '../lib/api';
import { AutocompleteSelect } from '../components/shared/AutocompleteSelect';
import { ProcessingOverlay } from '../components/shared/ProcessingOverlay';
import { InfoTooltip } from '../components/shared/InfoTooltip';
import { BulkResultSummary } from '../components/shared/BulkResultSummary';
import { BatchProgress, type BatchState } from '../components/shared/BatchProgress';
import { runBatchLoop, mergePreflightSkips } from '../lib/batchLoop';
import { entityEvents } from '../lib/entityEvents';
import {
  fetchStaxInvoicesFromSupabase,
  fetchStaxChargeLogFromSupabase,
  fetchStaxExceptionsFromSupabase,
  fetchStaxCustomersFromSupabase,
  fetchStaxRunLogFromSupabase,
  isSupabaseCacheAvailable,
} from '../lib/supabaseQueries';

// Note: 'pipeline', 'mapping', and 'runlog' content blocks below are
// not currently reachable via the TABS nav. Kept in place so the code
// can be re-enabled by adding to the TABS array; removing entirely
// would lose the Customer Mapping and Run Log features.
type Tab = 'iif' | 'review' | 'invoices' | 'queue' | 'charges' | 'exceptions' | 'customers' | 'pipeline' | 'mapping' | 'runlog';

/** Map API StaxInvoice → PaymentDetailPanel PaymentInvoice */
function toPaymentInvoice(inv: StaxInvoice): PaymentInvoice {
  return {
    qbInvoice: inv.qbInvoice,
    customer: inv.customer,
    staxId: inv.staxId,
    amount: inv.amount,
    dueDate: inv.dueDate,
    status: inv.status,
    created: inv.createdAt,
    lineItemsJson: inv.lineItemsJson,
  };
}

/** Map API StaxCustomerRow → CustomerVerificationPanel StaxCustomer */
function toStaxCustomer(c: StaxCustomerRow): StaxCustomer {
  return {
    qbName: c.qbName,
    staxName: c.staxName,
    staxId: c.staxId,
    email: c.email,
    payMethod: c.payMethod,
  };
}


const STATUS_CFG: Record<string, { bg: string; text: string }> = {
  Pending: { bg: '#FEF3C7', text: '#B45309' }, Paid: { bg: '#F0FDF4', text: '#15803D' },
  Voided: { bg: '#F3F4F6', text: '#6B7280' }, Success: { bg: '#F0FDF4', text: '#15803D' },
  Failed: { bg: '#FEF2F2', text: '#DC2626' },
};

// Display-only labels for Stax invoice statuses (underlying data values stay unchanged)
const STAX_STATUS_LABEL: Record<string, string> = {
  'PENDING': 'Imported',
  'CREATED': 'Ready to Charge',
  'PAID': 'Paid',
  'CHARGE_FAILED': 'Failed',
  'VOIDED': 'Voided',
};
function staxLabel(status: string): string { return STAX_STATUS_LABEL[status.toUpperCase()] || status; }

const card: React.CSSProperties = { background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12, padding: 20, marginBottom: 16 };
const th: React.CSSProperties = { padding: '14px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '2px', borderBottom: 'none', background: '#F5F2EE' };
const td: React.CSSProperties = { padding: '10px 10px', fontSize: 12, borderBottom: `1px solid ${theme.colors.borderLight}` };

function Badge({ t, c }: { t: string; c?: { bg: string; text: string } }) {
  const s = c || STATUS_CFG[t] || { bg: '#F3F4F6', text: '#6B7280' };
  return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: s.bg, color: s.text, whiteSpace: 'nowrap' }}>{t}</span>;
}

function IIFImportTab({ onImported }: { onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [parsed, setParsed] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ invoicesAdded: number; duplicatesSkipped: number; exceptionsLogged: number; summary: string } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Drive file picker state
  const [driveFiles, setDriveFiles] = useState<IIFFile[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveFolderName, setDriveFolderName] = useState('');
  const [driveImporting, setDriveImporting] = useState<string | null>(null); // file ID being imported
  const [driveLoaded, setDriveLoaded] = useState(false);

  const loadDriveFiles = useCallback(async () => {
    setDriveLoading(true); setDriveError(null);
    const res = await fetchIIFFiles();
    setDriveLoading(false); setDriveLoaded(true);
    if (res.ok && res.data) {
      setDriveFiles(res.data.files);
      setDriveFolderName(res.data.folderName);
    } else {
      setDriveError(res.error || 'Failed to load IIF files from Drive');
    }
  }, []);

  // Load Drive files on mount
  useEffect(() => { if (!driveLoaded) loadDriveFiles(); }, [driveLoaded, loadDriveFiles]);

  const handleDriveImport = async (fileId: string, fileName: string) => {
    if (!confirm(`Import "${fileName}" from Google Drive?`)) return;
    setDriveImporting(fileId); setImportError(null); setResult(null);
    const res = await postImportIIFFromDrive({ fileId });
    setDriveImporting(null);
    if (res.ok && res.data) { setResult(res.data); onImported(); }
    else { setImportError(res.error || 'Drive import failed'); }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f && (f.name.endsWith('.iif') || f.name.endsWith('.txt'))) { setFile(f); setParsed(true); setResult(null); setImportError(null); }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); setParsed(true); setResult(null); setImportError(null); }
  };

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setImportError(null);
    try {
      const arrayBuf = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      const res = await postImportIIF(base64, file.name);
      if (res.ok && res.data) {
        setResult(res.data);
        onImported();
      } else {
        setImportError(res.error || 'Import failed');
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      {/* Drop Zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? theme.colors.orange : theme.colors.border}`,
          borderRadius: 12, padding: '40px 24px', textAlign: 'center', cursor: 'pointer',
          background: dragging ? theme.colors.orangeLight : theme.colors.bgSubtle,
          transition: 'all 0.15s', marginBottom: 16,
        }}
      >
        <input ref={fileRef} type="file" accept=".iif,.txt" onChange={handleFileInput} style={{ display: 'none' }} />
        <UploadCloud size={32} color={dragging ? theme.colors.orange : theme.colors.textMuted} style={{ margin: '0 auto 12px' }} />
        {file ? (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.colors.text, marginBottom: 4 }}>{file.name}</div>
            <div style={{ fontSize: 12, color: theme.colors.textMuted }}>{(file.size / 1024).toFixed(1)} KB — click to change file</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.colors.textSecondary, marginBottom: 4 }}>Drop your IIF file here</div>
            <div style={{ fontSize: 12, color: theme.colors.textMuted }}>Accepts .iif and .txt files — click to browse</div>
          </div>
        )}
      </div>

      {/* Drive File Picker */}
      <div style={{ ...card, padding: 0, marginBottom: 16 }}>
        <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${theme.colors.borderLight}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={16} color={theme.colors.orange} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Import from Google Drive</span>
            {driveFolderName && <span style={{ fontSize: 11, color: theme.colors.textMuted }}>({driveFolderName})</span>}
          </div>
          <button onClick={loadDriveFiles} disabled={driveLoading} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 4, background: '#fff', cursor: driveLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}>
            <RefreshCw size={11} style={driveLoading ? { animation: 'spin 1s linear infinite' } : undefined} /> Refresh
          </button>
        </div>
        {driveError && <div style={{ padding: '8px 16px', background: '#FEF2F2', borderBottom: `1px solid #FECACA`, fontSize: 12, color: '#DC2626' }}>{driveError}</div>}
        {driveLoading ? (
          <div style={{ padding: 20, textAlign: 'center', color: theme.colors.textMuted, fontSize: 12 }}>Loading files from Drive...</div>
        ) : driveFiles.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: theme.colors.textMuted, fontSize: 12 }}>
            {driveError ? 'Configure IIF_EXPORT_FOLDER_ID in CB Settings to enable Drive import' : 'No IIF files found in the export folder'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>File Name</th>
              <th style={th}>Size</th>
              <th style={th}>Last Modified</th>
              <th style={th}></th>
            </tr></thead>
            <tbody>{driveFiles.map(f => (
              <tr key={f.id} style={{ transition: 'background 0.1s' }} onMouseEnter={e => e.currentTarget.style.background = theme.colors.bgSubtle} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ ...td, fontWeight: 600, fontSize: 12 }}>{f.name}</td>
                <td style={{ ...td, fontSize: 12, color: theme.colors.textMuted }}>{(f.size / 1024).toFixed(1)} KB</td>
                <td style={{ ...td, fontSize: 12, color: theme.colors.textMuted }}>{f.lastUpdated}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <WriteButton label={driveImporting === f.id ? 'Importing...' : 'Import'} variant="primary" size="sm" disabled={!!driveImporting}
                    icon={driveImporting === f.id ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={11} />}
                    onClick={async () => handleDriveImport(f.id, f.name)} />
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      {/* — OR — manual upload */}
      <div style={{ textAlign: 'center', color: theme.colors.textMuted, fontSize: 11, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>— or upload manually —</div>

      {/* Result Card */}
      {result && (
        <div style={{ ...card, background: '#F0FDF4', border: '1px solid #BBF7D0', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <CheckCircle2 size={18} color="#15803D" />
            <span style={{ fontSize: 14, fontWeight: 600, color: '#15803D' }}>Import Complete</span>
          </div>
          <div style={{ fontSize: 12, color: '#166534', lineHeight: 1.6 }}>
            <div><strong>{result.invoicesAdded}</strong> invoices added</div>
            <div><strong>{result.duplicatesSkipped}</strong> duplicates skipped</div>
            <div><strong>{result.exceptionsLogged}</strong> exceptions logged</div>
          </div>
        </div>
      )}

      {importError && (
        <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 12, color: '#DC2626' }}>{importError}</div>
      )}

      {/* Info */}
      {parsed && !result && (
        <div style={{ ...card, background: '#FFFBF5', border: '1px solid #FED7AA', marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#92400E', lineHeight: 1.5 }}>
            <strong>{file?.name}</strong> ({file ? (file.size / 1024).toFixed(1) : 0} KB) ready to import. Click "Confirm Import" to parse the IIF file server-side and write invoices to the Stax spreadsheet.
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10 }}>
        <WriteButton
          label={importing ? 'Importing...' : 'Confirm Import'}
          variant="primary"
          icon={importing ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={14} />}
          disabled={!file || importing}
          onClick={handleImport}
        />
        <button
          onClick={() => { setFile(null); setParsed(false); setResult(null); setImportError(null); }}
          style={{ padding: '9px 18px', fontSize: 13, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function RunLogTab({ entries }: { entries: StaxRunLogEntry[] }) {
  const logTh: React.CSSProperties = { ...th };
  const logTd: React.CSSProperties = { ...td };

  const FN_CFG: Record<string, { bg: string; text: string }> = {
    runAutoCharge: { bg: '#EFF6FF', text: '#1D4ED8' },
    createStaxInvoices: { bg: '#F0FDF4', text: '#15803D' },
    syncCustomers: { bg: '#EDE9FE', text: '#7C3AED' },
    importIIF: { bg: '#FEF3C7', text: '#B45309' },
  };

  return (
    <div style={{ ...card, padding: 0 }}>
      <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${theme.colors.borderLight}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Activity size={16} color={theme.colors.orange} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>Run Log</span>
          <span style={{ fontSize: 12, color: theme.colors.textMuted }}>({entries.length} entries)</span>
        </div>
      </div>
      {entries.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>No run log entries yet</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...logTh, width: 140 }}>Timestamp</th>
              <th style={{ ...logTh, width: 160 }}>Function</th>
              <th style={logTh}>Summary</th>
              <th style={logTh}>Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, idx) => {
              const fc = FN_CFG[entry.fn] || { bg: '#F3F4F6', text: '#6B7280' };
              return (
                <tr key={idx} style={{ transition: 'background 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.background = theme.colors.bgSubtle}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ ...logTd, fontSize: 11, fontFamily: 'monospace', color: theme.colors.textMuted, whiteSpace: 'nowrap' }}>{entry.timestamp}</td>
                  <td style={logTd}>
                    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 600, background: fc.bg, color: fc.text, fontFamily: 'monospace' }}>{entry.fn}</span>
                  </td>
                  <td style={{ ...logTd, fontWeight: 500 }}>{entry.summary}</td>
                  <td style={{ ...logTd, color: theme.colors.textMuted, fontSize: 11 }}>{entry.details}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function Payments() {
  const [tab, setTab] = useState<Tab>('iif');
  // showPreCharge, runningCharges, dryRun removed — charging now done via Charge Selected
  const [selectedInvoice, setSelectedInvoice] = useState<PaymentInvoice | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<StaxCustomer | null>(null);

  // ─── Live data state ───
  const [invoices, setInvoices] = useState<StaxInvoice[]>([]);
  const [charges, setCharges] = useState<StaxCharge[]>([]);
  const [exceptions, setExceptions] = useState<StaxException[]>([]);
  const [customers, setCustomers] = useState<StaxCustomerRow[]>([]);
  const [runLog, setRunLog] = useState<StaxRunLogEntry[]>([]);
  const [autoCharge, setAutoCharge] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [mappingEdits, setMappingEdits] = useState<Record<string, string>>({});
  const [mappingSaving, setMappingSaving] = useState(false);
  const [autoMatching, setAutoMatching] = useState(false);
  const [mappingResult, setMappingResult] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [custResult, setCustResult] = useState<string | null>(null);

  // v38.124.0 — guard against the realtime-vs-typing race that caused
  // inline edits to "save then revert". Every editable cell registers
  // its key on focus and removes it on blur. The realtime subscription
  // (below) skips loadData() while editing is in progress so the user's
  // typed-but-unsaved value isn't stomped by a refetch fired by some
  // other write. After the user blurs, the save fires; the save's own
  // realtime callback then fires after the set has been cleared, and
  // the refetch lands cleanly with the persisted value.
  const editingFieldsRef = useRef(new Set<string>());
  const beginEdit = (key: string) => editingFieldsRef.current.add(key);
  const endEdit   = (key: string) => editingFieldsRef.current.delete(key);

  // ─── Phase 4: Financial operations state ───
  const [creatingInvoices, setCreatingInvoices] = useState(false);
  const [invoiceResult, setInvoiceResult] = useState<string | null>(null);
  const [chargeResult, setChargeResult] = useState<string | null>(null);
  const [chargingInvoice, setChargingInvoice] = useState<string | null>(null); // QB# being charged
  const [sendingPayLinks, setSendingPayLinks] = useState(false);
  const [payLinkResult, setPayLinkResult] = useState<string | null>(null);
  const [sendingPayLink, setSendingPayLink] = useState<string | null>(null); // QB# being sent
  const [showResolvedExceptions, setShowResolvedExceptions] = useState(false);
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<string>('CREATED');
  const [invoiceSortCol, setInvoiceSortCol] = useState<string>('');
  const [invoiceSortDesc, setInvoiceSortDesc] = useState(false);
  const [voidingInvoice, setVoidingInvoice] = useState<string | null>(null);
  const [selectedInvoices, setSelectedInvoices] = useState<Set<number>>(new Set()); // rowIndex-based for duplicate QB# safety
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkResult, setBulkResult] = useState<BatchMutationResult | null>(null);
  const [bulkActionLabel, setBulkActionLabel] = useState<string>('');
  const [chargeBatch, setChargeBatch] = useState<{ state: BatchState; total: number; processed: number; succeeded: number; failed: number; errorMessage?: string }>({
    state: 'idle', total: 0, processed: 0, succeeded: 0, failed: 0,
  });
  const [reviewSelected, setReviewSelected] = useState<number[]>([]); // rowIndex-based

  // ─── Test Mode state (resets on page reload — intentionally not persisted) ───
  const [chargeLogSearch, setChargeLogSearch] = useState('');
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [showTestInvoice, setShowTestInvoice] = useState(false);
  const [testCustomer, setTestCustomer] = useState('');
  const [testAmount, setTestAmount] = useState('1.00');
  const [testQbNo, setTestQbNo] = useState('');
  const [creatingTest, setCreatingTest] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testDueDate, setTestDueDate] = useState(new Date().toISOString().slice(0, 10));

  const loadData = useCallback(async (noCache = false) => {
    if (noCache) setNextFetchNoCache();
    setRefreshing(true);
    setError(null);
    try {
      // Session 69 — Supabase-first for the 5 list datasets. Config stays GAS (live Script Properties).
      // When noCache=true (explicit refresh button), skip Supabase to get the freshest data.
      const supabaseAvailable = !noCache && (await isSupabaseCacheAvailable());
      if (supabaseAvailable) {
        // Load Supabase data first (fast ~50ms), config from GAS separately (slower)
        const [sbInv, sbCharges, sbExc, sbCust, sbLog] = await Promise.all([
          fetchStaxInvoicesFromSupabase(),
          fetchStaxChargeLogFromSupabase(),
          fetchStaxExceptionsFromSupabase(),
          fetchStaxCustomersFromSupabase(),
          fetchStaxRunLogFromSupabase(),
        ]);
        if (sbInv) setInvoices(sbInv.invoices);
        if (sbCharges) setCharges(sbCharges.charges);
        if (sbExc) setExceptions(sbExc.exceptions);
        if (sbCust) setCustomers(sbCust.customers);
        if (sbLog) setRunLog(sbLog.entries);
        // Config from GAS — fire-and-forget, don't block render
        fetchStaxConfig().then(cfgRes => {
          if (cfgRes.ok && cfgRes.data) {
            setAutoCharge(cfgRes.data.config.AUTO_CHARGE_ENABLED === true);
          }
        }).catch(() => {});
        // If any Supabase table returned null, fall through to GAS for that specific dataset.
        // In practice the tables should be seeded before first production use.
        if (!sbInv || !sbCharges || !sbExc || !sbCust || !sbLog) {
          const [invRes, chargeRes, excRes, custRes, logRes] = await Promise.all([
            !sbInv ? fetchStaxInvoices() : Promise.resolve({ ok: true, data: null } as any),
            !sbCharges ? fetchStaxChargeLog() : Promise.resolve({ ok: true, data: null } as any),
            !sbExc ? fetchStaxExceptions() : Promise.resolve({ ok: true, data: null } as any),
            !sbCust ? fetchStaxCustomers() : Promise.resolve({ ok: true, data: null } as any),
            !sbLog ? fetchStaxRunLog() : Promise.resolve({ ok: true, data: null } as any),
          ]);
          if (invRes.ok && invRes.data) setInvoices(invRes.data.invoices);
          if (chargeRes.ok && chargeRes.data) setCharges(chargeRes.data.charges);
          if (excRes.ok && excRes.data) setExceptions(excRes.data.exceptions);
          if (custRes.ok && custRes.data) setCustomers(custRes.data.customers);
          if (logRes.ok && logRes.data) setRunLog(logRes.data.entries);
        }
        setLastUpdated(new Date());
        return;
      }

      const [invRes, chargeRes, excRes, custRes, logRes, cfgRes] = await Promise.all([
        fetchStaxInvoices(),
        fetchStaxChargeLog(),
        fetchStaxExceptions(),
        fetchStaxCustomers(),
        fetchStaxRunLog(),
        fetchStaxConfig(),
      ]);
      if (invRes.ok && invRes.data) setInvoices(invRes.data.invoices);
      if (chargeRes.ok && chargeRes.data) setCharges(chargeRes.data.charges);
      if (excRes.ok && excRes.data) setExceptions(excRes.data.exceptions);
      if (custRes.ok && custRes.data) setCustomers(custRes.data.customers);
      if (logRes.ok && logRes.data) setRunLog(logRes.data.entries);
      if (cfgRes.ok && cfgRes.data) {
        setAutoCharge(cfgRes.data.config.AUTO_CHARGE_ENABLED === true);
      }
      // Report first error encountered
      const firstErr = [invRes, chargeRes, excRes, custRes, logRes, cfgRes].find(r => !r.ok);
      if (firstErr) setError(firstErr.error);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // v38.119.0 — Realtime subscription: refetch Payments when any Stax
  // mirror table changes in Supabase (another tab edits, backend
  // write-through, etc.). Debounced via the central realtime channel +
  // entityEvents bus. No polling. Originally only stax_invoice was
  // wired, which left Charges / Exceptions / Customers / Run Log stale
  // — now all five trigger a refetch.
  useEffect(() => {
    const unsub = entityEvents.subscribe((entityType) => {
      if (
        entityType === 'stax_invoice' ||
        entityType === 'stax_charge' ||
        entityType === 'stax_exception' ||
        entityType === 'stax_customer' ||
        entityType === 'stax_run_log'
      ) {
        // v38.124.0 — skip the refetch if the user has any cell focused.
        // Replacing `invoices` with server data while typing wipes the
        // typed-but-unsaved value (the input is controlled, so the
        // underlying state change resets the visible value too). The
        // user's manual Refresh button still calls loadData(true)
        // directly and bypasses this guard.
        if (editingFieldsRef.current.size > 0) return;
        loadData();
      }
    });
    return unsub;
  }, [loadData]);

  // ─── Computed summary values ───
  const pendingInvoices = invoices.filter(i => i.status === 'PENDING' || i.status === 'Pending');
  const pendingTotal = pendingInvoices.reduce((s, i) => s + i.amount, 0);
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const paidCharges = charges.filter(c => {
    const s = c.status.toLowerCase();
    if (s !== 'success' && s !== 'paid') return false;
    const d = new Date(c.timestamp);
    return d >= thirtyDaysAgo;
  });
  const collectedTotal = paidCharges.reduce((s, c) => s + c.amount, 0);
  const unresolvedExceptions = exceptions.filter(e => !e.resolved);

  const pendingCount = invoices.filter(i => (i.status || '').toUpperCase() === 'PENDING').length;
  const createdCount = invoices.filter(i => (i.status || '').toUpperCase() === 'CREATED').length;
  const TABS: { id: Tab; label: string; icon: any; count?: number }[] = [
    { id: 'iif', label: 'Import', icon: Upload },
    { id: 'review', label: 'Review', icon: FileText, count: pendingCount || undefined },
    { id: 'invoices', label: 'Invoices', icon: FileText },
    { id: 'queue', label: 'Charge Queue', icon: Zap, count: createdCount || undefined },
    { id: 'charges', label: 'Charge Log', icon: Activity, count: charges.length },
    { id: 'exceptions', label: 'Exceptions', icon: AlertTriangle, count: unresolvedExceptions.length },
    { id: 'customers', label: 'Customers', icon: Users, count: customers.length },
  ];

  const chip = (active: boolean): React.CSSProperties => ({ padding: '8px 16px', borderRadius: 100, fontSize: 11, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer', border: active ? 'none' : '1px solid rgba(0,0,0,0.08)', background: active ? '#1C1C1C' : '#fff', color: active ? '#fff' : '#666', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' });

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 80, gap: 12 }}>
        <Loader2 size={28} color={theme.colors.orange} style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 14, color: theme.colors.textMuted }}>Loading Stax data...</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error && invoices.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', background: '#F5F2EE', margin: '-28px -32px', minHeight: '100%' }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '2px', color: '#1C1C1C', marginBottom: 16 }}>STRIDE LOGISTICS · PAYMENTS</div>
        <div style={{ ...card, maxWidth: 480, margin: '0 auto', padding: 24 }}>
          <AlertTriangle size={28} color="#DC2626" style={{ margin: '0 auto 12px', display: 'block' }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: '#DC2626', marginBottom: 8 }}>Failed to load Stax data</div>
          <div style={{ fontSize: 12, color: theme.colors.textMuted, marginBottom: 16 }}>{error}</div>
          <WriteButton label="Retry" variant="primary" icon={<RefreshCw size={14} />} onClick={async () => { setLoading(true); loadData(); }} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: '#F5F2EE', margin: '-28px -32px', padding: '28px 32px', minHeight: '100%' }}>
      {chargeBatch.state !== 'idle' && (
        <div style={{ position: 'sticky', top: 0, zIndex: 10, marginBottom: 12 }}>
          <BatchProgress
            state={chargeBatch.state}
            total={chargeBatch.total}
            processed={chargeBatch.processed}
            succeeded={chargeBatch.succeeded}
            failed={chargeBatch.failed}
            actionLabel="Charging invoices"
            errorMessage={chargeBatch.errorMessage}
          />
          {chargeBatch.state === 'complete' && (
            <button onClick={() => setChargeBatch({ state: 'idle', total: 0, processed: 0, succeeded: 0, failed: 0 })} style={{ marginTop: 4, fontSize: 11, border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 0 }}>Dismiss</button>
          )}
        </div>
      )}
      <BulkResultSummary open={!!bulkResult} actionLabel={bulkActionLabel} result={bulkResult} onClose={() => setBulkResult(null)} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '2px', color: '#1C1C1C' }}>
            STRIDE LOGISTICS · PAYMENTS
          </div>
          {lastUpdated && <span style={{ fontSize: 10, color: theme.colors.textMuted }}>Updated {lastUpdated.toLocaleTimeString()}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            title="Refresh data"
            style={{ padding: '8px 12px', border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: refreshing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 500, fontFamily: 'inherit', color: theme.colors.textSecondary }}
          >
            <RefreshCw size={14} style={refreshing ? { animation: 'spin 1s linear infinite' } : undefined} />
          </button>
          <WriteButton label="Import IIF" variant="secondary" icon={<Upload size={14} />} onClick={async () => setTab('iif')} />
        </div>
      </div>
      <div style={{ background: '#FFFFFF', borderRadius: 20, padding: 24, border: '1px solid rgba(0,0,0,0.04)' }}>

      {error && <div style={{ padding: '8px 14px', marginBottom: 14, borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 12, color: '#DC2626' }}>{error}</div>}
      {chargeResult && <div style={{ padding: '8px 14px', marginBottom: 14, borderRadius: 8, background: chargeResult.includes('DRY RUN') ? '#FFFBEB' : '#F0FDF4', border: `1px solid ${chargeResult.includes('DRY RUN') ? '#FCD34D' : '#BBF7D0'}`, fontSize: 12, color: chargeResult.includes('DRY RUN') ? '#92400E' : '#166534', display: 'flex', alignItems: 'center', gap: 8 }}><CheckCircle2 size={14} /> {chargeResult} <button onClick={() => setChargeResult(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: chargeResult.includes('DRY RUN') ? '#92400E' : '#166534', fontSize: 16 }}>&times;</button></div>}
      {/* ProcessingOverlay for runningCharges removed — use Charge Selected instead */}
      <ProcessingOverlay visible={creatingInvoices} message="Creating Stax invoices..." />

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <div style={{ background: '#1C1C1C', borderRadius: 20, padding: '20px 22px' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 10, display: 'flex', alignItems: 'center' }}>
            <span>Pending Invoices</span>
            <InfoTooltip text="Invoices that have been created in Stax but have NOT been paid yet. These will be charged automatically on their due date (if Auto-Charge is on), or you can charge them manually." />
          </div>
          <div style={{ fontSize: 28, fontWeight: 300, color: '#fff', lineHeight: 1 }}>{pendingInvoices.length}</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 8 }}>${pendingTotal.toFixed(2)} total</div>
        </div>
        <div style={{ background: '#1C1C1C', borderRadius: 20, padding: '20px 22px' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 10, display: 'flex', alignItems: 'center' }}>
            <span>Collected (30d)</span>
            <InfoTooltip text="Total money successfully charged to customer credit cards in the last 30 days. This is real money that landed in your account (minus Stax processing fees)." />
          </div>
          <div style={{ fontSize: 28, fontWeight: 300, color: '#4ADE80', lineHeight: 1 }}>${collectedTotal.toFixed(2)}</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 8 }}>{paidCharges.length} successful charges</div>
        </div>
        <div style={{ background: '#1C1C1C', borderRadius: 20, padding: '20px 22px' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 10, display: 'flex', alignItems: 'center' }}>
            <span>Open Exceptions</span>
            <InfoTooltip text="Charges that failed and need you to fix something. Common reasons: expired card, no card on file, declined transaction, customer not matched to Stax. Click the Exceptions tab to see details and resolve each one." />
          </div>
          <div style={{ fontSize: 28, fontWeight: 300, color: '#F87171', lineHeight: 1 }}>{unresolvedExceptions.length}</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 8 }}>Require manual attention</div>
        </div>
        <div style={{ background: '#1C1C1C', borderRadius: 20, padding: '20px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '2px', display: 'flex', alignItems: 'center' }}>
              <span>Auto-Charge</span>
              <InfoTooltip text="When ON, the system automatically charges customer credit cards each day at 9:00 AM Pacific for any invoices that are due that day. When OFF, nothing gets charged automatically — you'd have to run charges manually. Turn this on for hands-off collection, off while you're testing or troubleshooting." />
            </div>
            <label style={{ position: 'relative', display: 'inline-block', width: 40, height: 22, cursor: 'pointer' }} title="Toggle auto-charge">
              <input type="checkbox" checked={autoCharge} onChange={async () => {
                const newVal = !autoCharge;
                setAutoCharge(newVal);
                const res = await postUpdateStaxConfig('AUTO_CHARGE_ENABLED', newVal ? 'TRUE' : 'FALSE');
                if (!res.ok) { setAutoCharge(!newVal); setError(res.error || 'Failed to update'); }
                else { loadData(true); }
              }} style={{ opacity: 0, width: 0, height: 0 }} />
              <span style={{ position: 'absolute', inset: 0, background: autoCharge ? theme.colors.orange : 'rgba(255,255,255,0.2)', borderRadius: 11, transition: '0.2s' }}><span style={{ position: 'absolute', top: 2, left: autoCharge ? 20 : 2, width: 18, height: 18, background: '#fff', borderRadius: '50%', transition: '0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }} /></span>
            </label>
          </div>
          <div style={{ fontSize: 22, fontWeight: 300, color: autoCharge ? '#4ADE80' : 'rgba(255,255,255,0.45)' }}>{autoCharge ? 'Enabled' : 'Disabled'}</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 8 }}>Daily at 9:00 AM Pacific</div>
        </div>
      </div>

      {/* Tab Nav */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map(t => { const Icon = t.icon; return (
          <button key={t.id} onClick={() => setTab(t.id)} style={chip(tab === t.id)}>
            <Icon size={14} />{t.label}{t.count !== undefined && <span style={{ background: tab === t.id ? 'rgba(232,93,45,0.15)' : theme.colors.bgSubtle, padding: '1px 6px', borderRadius: 8, fontSize: 10 }}>{t.count}</span>}
          </button>
        ); })}
      </div>

      {/* Tab Content */}
      {tab === 'invoices' && (
        <div style={{ ...card, padding: 0 }}>
          <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${theme.colors.borderLight}` }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Stax Invoices</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <WriteButton label={syncing ? 'Syncing...' : 'Sync Customers'} variant="secondary" size="sm" disabled={syncing || creatingInvoices} icon={syncing ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />} onClick={async () => {
                setSyncing(true); setCustResult(null); setError(null);
                const res = await postSyncStaxCustomers();
                setSyncing(false);
                if (res.ok && res.data) { setCustResult(`Sync: ${res.data.verified} verified, ${res.data.hasPayment} with payment`); loadData(true); }
                else { setError(res.error || 'Sync customers failed'); }
              }} />
              <InfoTooltip text="Pulls the latest customer list from your Stax account and updates the local customer mapping table. Run this after adding or changing customers in Stax." size={12} />
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <WriteButton label={creatingInvoices ? 'Creating...' : 'Create Stax Invoices'} variant="primary" size="sm" disabled={creatingInvoices || syncing} icon={creatingInvoices ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <FileText size={12} />} onClick={async () => {
                if (!confirm('Create Stax invoices for all PENDING rows?\n\nThis will call the Stax API to create invoices.')) return;
                setCreatingInvoices(true); setInvoiceResult(null); setError(null);
                const res = await postCreateStaxInvoices();
                setCreatingInvoices(false);
                if (res.ok && res.data) { const details = (res.data as any).errorDetails; setInvoiceResult(res.data.summary + (details?.length ? '\n\nErrors:\n' + details.map((d: any) => `${d.invoice} (${d.customer}): ${d.error}`).join('\n') : '')); loadData(true); }
                else { setError(res.error || 'Create invoices failed'); }
              }} />
              <InfoTooltip text="Pushes all PENDING invoices to Stax's system. This creates each invoice in Stax, assigns a Stax Invoice ID, and changes status from PENDING to CREATED. Invoices must be Created in Stax before they can be charged." size={12} />
              </span>
              <div style={{ position: 'relative' }}>
                <button onClick={() => { setShowTestInvoice(!showTestInvoice); setTestResult(null); setTestError(null); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', fontSize: 12, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer', color: theme.colors.textSecondary, fontFamily: 'inherit' }}><DollarSign size={12} /> Create Test Invoice</button>
                <InfoTooltip text="Creates a small test invoice ($1.00 default) for a selected customer. This lets you test the full charge workflow — Create Stax Invoices → Run Charges — without going through the billing, IIF export, and import process. Test invoices show a purple 'Test' badge in the table. You can charge test invoices for real (to verify Stax end-to-end with a $1 charge) or use Dry Run mode to test without any real charge. Void any real test charges in the Stax dashboard afterward." size={12} />
                {showTestInvoice && (
                  <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 8, padding: 16, background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100, width: 320 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Create Test Invoice</div>
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>Customer *</label>
                      <AutocompleteSelect
                        value={testCustomer}
                        onChange={setTestCustomer}
                        placeholder="Select customer..."
                        options={customers.filter(c => c.staxId).map(c => ({ value: c.qbName, label: c.qbName }))}
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>Amount ($)</label>
                        <input type="number" min={0.01} max={100} step={0.01} value={testAmount} onChange={e => setTestAmount(e.target.value)} style={{ width: '100%', padding: '7px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontFamily: 'inherit', boxSizing: 'border-box' }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>Due Date</label>
                        <input type="date" value={testDueDate} onChange={e => setTestDueDate(e.target.value)} style={{ width: '100%', padding: '7px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontFamily: 'inherit', boxSizing: 'border-box' }} />
                      </div>
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>QB Invoice # <span style={{ fontWeight: 400, fontSize: 10 }}>(optional — auto-generates TEST-... if blank)</span></label>
                      <input value={testQbNo} onChange={e => setTestQbNo(e.target.value)} placeholder="Auto: TEST-..." style={{ width: '100%', padding: '7px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontFamily: 'inherit', boxSizing: 'border-box' }} />
                    </div>
                    {testError && <div style={{ padding: '6px 10px', marginBottom: 8, borderRadius: 6, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 11, color: '#DC2626' }}>{testError}</div>}
                    {testResult && <div style={{ padding: '6px 10px', marginBottom: 8, borderRadius: 6, background: '#F0FDF4', border: '1px solid #BBF7D0', fontSize: 11, color: '#166534' }}>{testResult}</div>}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <button onClick={() => { setShowTestInvoice(false); setTestResult(null); setTestError(null); }} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                      <WriteButton label={creatingTest ? 'Creating...' : 'Create'} variant="primary" size="sm" disabled={creatingTest || !testCustomer} onClick={async () => {
                        setCreatingTest(true); setTestError(null); setTestResult(null);
                        const res = await postCreateTestInvoice({ customer: testCustomer, amount: parseFloat(testAmount) || 1.00, qbInvoiceNo: testQbNo || undefined, dueDate: testDueDate || undefined });
                        setCreatingTest(false);
                        if (res.ok && res.data?.success) {
                          setTestResult(`Test invoice ${res.data.qbInvoiceNo} created for ${res.data.customer} — $${res.data.amount.toFixed(2)}`);
                          setTestCustomer(''); setTestAmount('1.00'); setTestQbNo('');
                          loadData(true);
                        } else { setTestError(res.data?.error || res.error || 'Failed to create test invoice'); }
                      }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          {invoiceResult && <div style={{ padding: '10px 16px', background: invoiceResult.includes('Errors:') ? '#FEF2F2' : '#F0FDF4', borderBottom: `1px solid ${theme.colors.borderLight}`, fontSize: 13, color: invoiceResult.includes('Errors:') ? '#DC2626' : '#15803D', whiteSpace: 'pre-wrap' }}><div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>{invoiceResult.includes('Errors:') ? <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} /> : <CheckCircle2 size={14} style={{ flexShrink: 0, marginTop: 2 }} />} <span>{invoiceResult}</span> <button onClick={() => setInvoiceResult(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 16, flexShrink: 0 }}>&times;</button></div></div>}

          {/* Search bar */}
          <div style={{ padding: '8px 16px', borderBottom: `1px solid ${theme.colors.borderLight}` }}>
            <div style={{ position: 'relative', maxWidth: 360 }}>
              <Search size={14} color={theme.colors.textMuted} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
              <input value={invoiceSearch} onChange={e => setInvoiceSearch(e.target.value)} placeholder="Search invoices, customers…" style={{ width: '100%', padding: '7px 10px 7px 30px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, outline: 'none', background: theme.colors.bgSubtle, fontFamily: 'inherit' }} />
            </div>
          </div>

          {/* Status filter chips */}
          {(() => {
            const statusCounts: Record<string, number> = { '': invoices.length };
            for (const inv of invoices) { const s = (inv.status || '').toUpperCase(); statusCounts[s] = (statusCounts[s] || 0) + 1; }
            // Workflow order: Imported → Ready to Charge → Paid, then edge cases
            const statuses = ['PENDING', 'CREATED', 'PAID', 'CHARGE_FAILED', 'VOIDED'];
            const chipS = (active: boolean, count: number): React.CSSProperties => ({
              padding: '4px 12px', borderRadius: 16, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
              background: active ? theme.colors.orange : 'transparent',
              color: active ? '#fff' : count > 0 ? theme.colors.textSecondary : theme.colors.textMuted,
              fontFamily: 'inherit', transition: '0.15s',
              opacity: !active && count === 0 ? 0.5 : 1,
            });
            return (
              <div style={{ padding: '8px 16px', display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: `1px solid ${theme.colors.borderLight}` }}>
                <button style={chipS(!invoiceStatusFilter, invoices.length)} onClick={() => setInvoiceStatusFilter('')}>All</button>
                {statuses.map(s => (
                  <button key={s} style={chipS(invoiceStatusFilter === s, statusCounts[s] || 0)} onClick={() => setInvoiceStatusFilter(invoiceStatusFilter === s ? '' : s)}>{staxLabel(s)} ({statusCounts[s] || 0})</button>
                ))}
              </div>
            );
          })()}

          {/* Filtered + sorted invoices */}
          {(() => {
            let filtered = invoices;
            if (invoiceSearch.trim()) {
              const sq = invoiceSearch.toLowerCase();
              filtered = filtered.filter(i =>
                (i.qbInvoice || '').toLowerCase().includes(sq) ||
                (i.customer || '').toLowerCase().includes(sq) ||
                (i.staxId || '').toLowerCase().includes(sq) ||
                String(i.amount).includes(sq) ||
                (i.dueDate || '').includes(sq)
              );
            }
            if (invoiceStatusFilter) filtered = filtered.filter(i => (i.status || '').toUpperCase() === invoiceStatusFilter);

            if (invoiceSortCol) {
              const col = invoiceSortCol;
              const desc = invoiceSortDesc;
              filtered = [...filtered].sort((a, b) => {
                let va: string | number = '', vb: string | number = '';
                if (col === 'qbInvoice') { va = a.qbInvoice; vb = b.qbInvoice; }
                else if (col === 'customer') { va = a.customer; vb = b.customer; }
                else if (col === 'amount') { va = a.amount; vb = b.amount; }
                else if (col === 'dueDate') { va = a.dueDate; vb = b.dueDate; }
                else if (col === 'status') { va = a.status; vb = b.status; }
                else if (col === 'createdAt') { va = a.createdAt; vb = b.createdAt; }
                if (typeof va === 'number' && typeof vb === 'number') return desc ? vb - va : va - vb;
                return desc ? String(vb).localeCompare(String(va)) : String(va).localeCompare(String(vb));
              });
            }

            const toggleSort = (col: string) => {
              if (invoiceSortCol === col) { if (invoiceSortDesc) { setInvoiceSortCol(''); setInvoiceSortDesc(false); } else setInvoiceSortDesc(true); }
              else { setInvoiceSortCol(col); setInvoiceSortDesc(false); }
            };
            const sortIcon = (col: string) => invoiceSortCol === col ? (invoiceSortDesc ? ' ↓' : ' ↑') : ' ↕';
            const sortTh = (col: string, _label?: string, extra?: React.CSSProperties): React.CSSProperties => ({
              ...th, cursor: 'pointer', userSelect: 'none',
              color: invoiceSortCol === col ? theme.colors.orange : th.color,
              ...extra,
            });

            return filtered.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>
                {invoiceStatusFilter ? `No ${invoiceStatusFilter} invoices` : 'No invoices yet'}
              </div>
            ) : (
              <>
              {/* Bulk action bar */}
              {selectedInvoices.size > 0 && (
                <div style={{ padding: '8px 16px', background: '#EFF6FF', borderBottom: `1px solid #BFDBFE`, display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, fontWeight: 600, color: '#1D4ED8' }}>
                  <span>{selectedInvoices.size} invoice{selectedInvoices.size !== 1 ? 's' : ''} selected</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <WriteButton label={bulkProcessing ? 'Processing...' : `Void ${selectedInvoices.size}`} variant="secondary" size="sm" disabled={bulkProcessing}
                      onClick={async () => {
                        const allSelected = filtered.filter(inv => selectedInvoices.has(inv.rowIndex));
                        const eligible: typeof allSelected = [];
                        const preflightSkipped: Array<{ id: string; reason: string }> = [];
                        for (const inv of allSelected) {
                          const st = (inv.status || '').toUpperCase();
                          if (st === 'PAID') preflightSkipped.push({ id: inv.qbInvoice, reason: 'Cannot void PAID — refund in Stax first' });
                          else if (st === 'VOIDED') preflightSkipped.push({ id: inv.qbInvoice, reason: 'Already voided' });
                          else eligible.push(inv);
                        }
                        if (!eligible.length) { setError('No eligible invoices to void (PAID/VOIDED are excluded)'); return; }
                        if (!confirm(`Void ${eligible.length} invoice(s)?\n\nThis marks them as VOIDED. They stay in the sheet for audit.`)) return;
                        // Session 69 — optimistic: flip rows to VOIDED immediately.
                        const eligibleQbNos = new Set(eligible.map(e => e.qbInvoice));
                        setInvoices(prev => prev.map(inv => eligibleQbNos.has(inv.qbInvoice) ? { ...inv, status: 'VOIDED' } : inv));
                        setBulkProcessing(true);
                        const resp = await postBatchVoidStaxInvoices({ qbInvoiceNos: eligible.map(e => e.qbInvoice) });
                        const serverResult: BatchMutationResult = resp.ok && resp.data ? resp.data : {
                          success: false, processed: eligible.length, succeeded: 0, failed: eligible.length,
                          skipped: [], errors: eligible.map(e => ({ id: e.qbInvoice, reason: resp.error || 'Request failed' })),
                          message: resp.error || 'Batch void failed',
                        };
                        // Revert failed rows back to their original status
                        if (serverResult.errors && serverResult.errors.length) {
                          const failedIds = new Set(serverResult.errors.map(e => e.id).filter(Boolean));
                          const origById: Record<string, StaxInvoice> = {};
                          for (const e of eligible) origById[e.qbInvoice] = e;
                          setInvoices(prev => prev.map(inv => failedIds.has(inv.qbInvoice) ? { ...inv, status: origById[inv.qbInvoice]?.status ?? inv.status } : inv));
                        }
                        setBulkProcessing(false); setSelectedInvoices(new Set());
                        setBulkActionLabel('Void Invoices');
                        setBulkResult(mergePreflightSkips(serverResult, preflightSkipped));
                        loadData(true);
                      }}
                    />
                    <WriteButton label={bulkProcessing ? 'Processing...' : `Delete ${selectedInvoices.size}`} variant="secondary" size="sm" disabled={bulkProcessing}
                      style={{ borderColor: '#DC2626', color: '#DC2626' }}
                      onClick={async () => {
                        const allSelected = filtered.filter(inv => selectedInvoices.has(inv.rowIndex));
                        const eligible: typeof allSelected = [];
                        const preflightSkipped: Array<{ id: string; reason: string }> = [];
                        for (const inv of allSelected) {
                          if ((inv.status || '').toUpperCase() === 'PENDING') eligible.push(inv);
                          else preflightSkipped.push({ id: inv.qbInvoice, reason: `Only PENDING can be deleted (current: ${inv.status || 'unknown'})` });
                        }
                        if (!eligible.length) { setError('Only Imported invoices can be deleted. Use Void for Ready to Charge invoices.'); return; }
                        if (!confirm(`Delete ${eligible.length} PENDING invoice(s)?\n\nThis marks them as DELETED. They stay in the sheet for audit.`)) return;
                        // Session 69 — optimistic: flip rows to DELETED immediately.
                        const eligibleQbNos = new Set(eligible.map(e => e.qbInvoice));
                        setInvoices(prev => prev.map(inv => eligibleQbNos.has(inv.qbInvoice) ? { ...inv, status: 'DELETED' } : inv));
                        setBulkProcessing(true);
                        const resp = await postBatchDeleteStaxInvoices({ qbInvoiceNos: eligible.map(e => e.qbInvoice) });
                        const serverResult: BatchMutationResult = resp.ok && resp.data ? resp.data : {
                          success: false, processed: eligible.length, succeeded: 0, failed: eligible.length,
                          skipped: [], errors: eligible.map(e => ({ id: e.qbInvoice, reason: resp.error || 'Request failed' })),
                          message: resp.error || 'Batch delete failed',
                        };
                        // Revert failed rows back to their original status
                        if (serverResult.errors && serverResult.errors.length) {
                          const failedIds = new Set(serverResult.errors.map(e => e.id).filter(Boolean));
                          const origById: Record<string, StaxInvoice> = {};
                          for (const e of eligible) origById[e.qbInvoice] = e;
                          setInvoices(prev => prev.map(inv => failedIds.has(inv.qbInvoice) ? { ...inv, status: origById[inv.qbInvoice]?.status ?? inv.status } : inv));
                        }
                        setBulkProcessing(false); setSelectedInvoices(new Set());
                        setBulkActionLabel('Delete Invoices');
                        setBulkResult(mergePreflightSkips(serverResult, preflightSkipped));
                        loadData(true);
                      }}
                    />
                    <WriteButton label={bulkProcessing ? 'Charging...' : `Charge ${selectedInvoices.size}`} variant="primary" size="sm" disabled={bulkProcessing}
                      onClick={async () => {
                        const allSelected = filtered.filter(inv => selectedInvoices.has(inv.rowIndex));
                        const eligible: typeof allSelected = [];
                        const preflightSkipped: Array<{ id: string; reason: string }> = [];
                        for (const inv of allSelected) {
                          const st = (inv.status || '').toUpperCase();
                          if (st !== 'CREATED') preflightSkipped.push({ id: inv.qbInvoice, reason: `Only CREATED invoices can be charged (current: ${inv.status || 'unknown'})` });
                          else if (!inv.staxId) preflightSkipped.push({ id: inv.qbInvoice, reason: 'Missing Stax ID' });
                          else eligible.push(inv);
                        }
                        if (!eligible.length) { setError('No eligible invoices to charge. Only "Ready to Charge" invoices with a Stax ID can be charged.'); return; }
                        if (!confirm(`⚠ Charge ${eligible.length} invoice(s) now via Stax?\n\nThis will charge each customer's payment method on file (~3-8s each).\n\nKEEP THIS PAGE OPEN until the batch finishes. Closing the tab partway will leave some invoices charged and others not.`)) return;
                        setBulkProcessing(true);
                        setChargeBatch({ state: 'processing', total: eligible.length, processed: 0, succeeded: 0, failed: 0 });
                        const result = await runBatchLoop<typeof eligible[0], { success?: boolean }>({
                          items: eligible.map(e => ({ id: e.qbInvoice, item: e })),
                          call: async (inv) => {
                            const r = await postChargeSingleInvoice({ qbInvoiceNo: inv.qbInvoice });
                            return { ok: !!(r.ok && r.data?.success), data: r.data ?? undefined, error: r.error || (r.data as any)?.error };
                          },
                          onProgress: (done, total) => setChargeBatch(prev => ({ ...prev, processed: done, succeeded: Math.max(0, done - prev.failed), total })),
                          preflightSkipped,
                        });
                        setChargeBatch({ state: 'complete', total: eligible.length, processed: eligible.length, succeeded: result.succeeded, failed: result.failed });
                        setBulkProcessing(false); setSelectedInvoices(new Set());
                        setBulkActionLabel('Charge Invoices');
                        setBulkResult(result);
                        loadData(true);
                      }}
                    />
                    <button onClick={() => setSelectedInvoices(new Set())} style={{ padding: '3px 10px', fontSize: 11, border: `1px solid ${theme.colors.border}`, borderRadius: 4, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Clear</button>
                  </div>
                </div>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={{ ...th, width: 36 }} onClick={e => { e.stopPropagation(); const allIdx = filtered.map(x => x.rowIndex); if (selectedInvoices.size === allIdx.length) setSelectedInvoices(new Set()); else setSelectedInvoices(new Set(allIdx)); }}>
                    <input type="checkbox" checked={filtered.length > 0 && selectedInvoices.size === filtered.length} onChange={() => {}} style={{ cursor: 'pointer', accentColor: theme.colors.orange }} />
                  </th>
                  <th style={sortTh('qbInvoice', 'QB Invoice')} onClick={() => toggleSort('qbInvoice')}>QB Invoice{sortIcon('qbInvoice')}</th>
                  <th style={sortTh('customer', 'Customer')} onClick={() => toggleSort('customer')}>Customer{sortIcon('customer')}</th>
                  <th style={th}>Stax ID</th>
                  <th style={sortTh('amount', 'Amount')} onClick={() => toggleSort('amount')}>Amount{sortIcon('amount')}</th>
                  <th style={sortTh('dueDate', 'Due Date')} onClick={() => toggleSort('dueDate')}>Due Date{sortIcon('dueDate')}</th>
                  <th style={sortTh('status', 'Status')} onClick={() => toggleSort('status')}>Status{sortIcon('status')}</th>
                  <th style={{ ...th, width: 90, textAlign: 'center' }}>Auto</th>
                  <th style={sortTh('createdAt', 'Created')} onClick={() => toggleSort('createdAt')}>Created{sortIcon('createdAt')}</th>
                  <th style={th}></th>
                </tr></thead>
                <tbody>{filtered.map(i => (
                  <tr
                    key={i.qbInvoice}
                    style={{ transition: 'background 0.1s', cursor: 'pointer', opacity: (i.status || '').toUpperCase() === 'VOIDED' ? 0.5 : 1 }}
                    onClick={() => setSelectedInvoice(toPaymentInvoice(i))}
                    onMouseEnter={e => e.currentTarget.style.background = theme.colors.bgSubtle}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    title="Click to view invoice details"
                  >
                    <td style={{ ...td, width: 36 }} onClick={e => { e.stopPropagation(); setSelectedInvoices(prev => { const next = new Set(prev); if (next.has(i.rowIndex)) next.delete(i.rowIndex); else next.add(i.rowIndex); return next; }); }}>
                      <input type="checkbox" checked={selectedInvoices.has(i.rowIndex)} onChange={() => {}} style={{ cursor: 'pointer', accentColor: theme.colors.orange }} />
                    </td>
                    <td style={{ ...td, fontWeight: 600 }}>
                      {i.qbInvoice}
                      {i.isTest && <span style={{ marginLeft: 6, display: 'inline-block', padding: '1px 6px', borderRadius: 8, fontSize: 9, fontWeight: 700, background: '#EDE9FE', color: '#7C3AED', verticalAlign: 'middle' }}>Test</span>}
                    </td>
                    <td style={{ ...td, fontWeight: 500 }}>{i.customer}{i.autoCharge !== false && <span style={{ marginLeft: 4, fontSize: 9, padding: '1px 5px', borderRadius: 4, background: '#F0FDF4', color: '#15803D', fontWeight: 700 }}>Auto Pay</span>}</td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, color: theme.colors.textMuted }}>{i.staxId || '\u2014'}</td>
                    <td style={{ ...td, fontWeight: 600 }}>${i.amount.toFixed(2)}</td>
                    <td style={td}>{i.dueDate}</td>
                    <td style={td}><Badge t={staxLabel(i.status)} /></td>
                    <td style={{ ...td, width: 90, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      {(i.status === 'CREATED' || i.status === 'Created') && i.staxId ? (
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: i.autoCharge === true ? '#15803D' : '#B45309' }}>
                          <input type="checkbox" checked={i.autoCharge === true}
                            onChange={async () => {
                              const newVal = !i.autoCharge;
                              // Optimistic update — flip immediately in UI
                              setInvoices(prev => prev.map(inv => inv.qbInvoice === i.qbInvoice ? { ...inv, autoCharge: newVal } : inv));
                              const res = await postToggleAutoCharge({ invoiceNos: [i.qbInvoice], autoCharge: newVal });
                              if (!res.ok) {
                                // Revert on failure
                                setInvoices(prev => prev.map(inv => inv.qbInvoice === i.qbInvoice ? { ...inv, autoCharge: !newVal } : inv));
                                setError(res.error || 'Toggle failed');
                              }
                            }}
                            style={{ accentColor: '#15803D', cursor: 'pointer' }} />
                          <span title={i.autoCharge === true ? 'This invoice will be charged automatically on its due date' : 'This invoice must be charged manually — click to enable auto-pay'}>{i.autoCharge === true ? 'Auto' : 'Manual'}</span>
                        </label>
                      ) : <span style={{ fontSize: 11, color: theme.colors.textMuted }}>{'\u2014'}</span>}
                    </td>
                    <td style={{ ...td, color: theme.colors.textMuted }}>{i.createdAt}</td>
                    <td style={{ ...td, textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      {(i.status === 'CREATED' || i.status === 'Created') && i.staxId && <WriteButton
                        label={chargingInvoice === i.qbInvoice ? 'Charging...' : 'Charge'}
                        variant="secondary" size="sm" disabled={!!chargingInvoice}
                        onClick={async () => {
                        if (!confirm(`Charge invoice ${i.qbInvoice} ($${i.amount.toFixed(2)}) for ${i.customer}?\n\nThis will charge the customer's payment method on file.`)) return;
                        setChargingInvoice(i.qbInvoice); setChargeResult(null); setError(null);
                        const res = await postChargeSingleInvoice({ qbInvoiceNo: i.qbInvoice });
                        setChargingInvoice(null);
                        if (res.ok && res.data) {
                          if (res.data.testMode) { setChargeResult(`[DRY RUN] ${i.qbInvoice}: ${res.data.message || 'Pre-flight passed — no charge executed'}`); }
                          else if (res.data.success) { setChargeResult(`${i.qbInvoice}: Charged successfully — txn ${res.data.transactionId}`); }
                          else { setChargeResult(`${i.qbInvoice}: ${res.data.status} — ${res.data.error || 'Unknown error'}`); }
                          loadData(true);
                        } else { setError(res.error || 'Charge failed'); }
                      }} />}
                      {/* Reset button — on EXCEPTION/CHARGE_FAILED/DELETED rows */}
                      {['EXCEPTION', 'CHARGE_FAILED', 'DELETED'].includes((i.status || '').toUpperCase()) && (
                        <button
                          disabled={!!voidingInvoice}
                          onClick={async () => {
                            if (!confirm(`Reset invoice ${i.qbInvoice} back to ${i.staxId ? 'CREATED' : 'PENDING'}?\n\nThis re-enters it into the charge workflow so it can be retried.`)) return;
                            setVoidingInvoice(i.qbInvoice); setError(null);
                            const res = await postResetStaxInvoiceStatus({ qbInvoiceNo: i.qbInvoice });
                            setVoidingInvoice(null);
                            if (res.ok && res.data?.success) { setChargeResult(`${i.qbInvoice} reset to ${res.data.newStatus}`); loadData(true); }
                            else { setError(res.error || 'Reset failed'); }
                          }}
                          style={{ padding: '3px 8px', fontSize: 11, fontWeight: 500, border: `1px solid #3B82F6`, borderRadius: 4, background: '#EFF6FF', cursor: 'pointer', color: '#1D4ED8', fontFamily: 'inherit' }}
                          title="Reset to re-enter charge workflow"
                        >
                          Reset
                        </button>
                      )}
                      {/* Void button — not on PAID or already VOIDED */}
                      {(i.status || '').toUpperCase() !== 'PAID' && (i.status || '').toUpperCase() !== 'VOIDED' && (
                        <button
                          disabled={!!voidingInvoice}
                          onClick={async () => {
                            if (!confirm(`Void invoice ${i.qbInvoice}?\n\nThis removes it from the active list. The row stays in the sheet for audit purposes. You cannot void PAID invoices.`)) return;
                            setVoidingInvoice(i.qbInvoice); setError(null);
                            const res = await postVoidStaxInvoice({ qbInvoiceNo: i.qbInvoice });
                            setVoidingInvoice(null);
                            if (res.ok && res.data?.success) { setChargeResult(`${i.qbInvoice} voided`); loadData(true); }
                            else { setError(res.error || 'Void failed'); }
                          }}
                          style={{ padding: '3px 8px', fontSize: 11, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 4, background: '#fff', cursor: 'pointer', color: theme.colors.textMuted, fontFamily: 'inherit' }}
                          title="Void this invoice"
                        >
                          {voidingInvoice === i.qbInvoice ? '...' : 'Void'}
                        </button>
                      )}
                      </div>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
              <div style={{ padding: '10px 16px', borderTop: `1px solid ${theme.colors.borderLight}`, fontSize: 11, color: theme.colors.textMuted }}>
                {filtered.length} invoice{filtered.length !== 1 ? 's' : ''}{invoiceStatusFilter ? ` (${invoiceStatusFilter})` : ''} · Click a row to view details
              </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ═══ Review Tab (PENDING invoices — editable) ═══ */}
      {tab === 'review' && (() => {
        const pending = invoices.filter(i => (i.status || '').toUpperCase() === 'PENDING');
        return (
          <div style={{ ...card, padding: 0 }}>
            <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${theme.colors.borderLight}` }}>
              <div>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Review & Edit</span>
                <span style={{ fontSize: 12, color: theme.colors.textMuted, marginLeft: 8 }}>PENDING invoices — edit before pushing to Stax</span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: theme.colors.textSecondary }}>
                  <input type="checkbox" checked={pending.filter(p => p.staxCustomerId).length > 0 && reviewSelected.length === pending.filter(p => p.staxCustomerId).length} onChange={() => {
                    const pushable = pending.filter(p => p.staxCustomerId);
                    if (reviewSelected.length === pushable.length) setReviewSelected([]);
                    else setReviewSelected(pushable.map(p => p.rowIndex));
                  }} style={{ accentColor: theme.colors.orange }} />
                  Select All
                </label>
                <WriteButton label={bulkProcessing ? 'Voiding...' : `Void (${reviewSelected.length})`} variant="secondary" size="sm" disabled={bulkProcessing || !reviewSelected.length}
                  style={{ borderColor: '#DC2626', color: '#DC2626' }}
                  onClick={async () => {
                    if (!confirm(`Void ${reviewSelected.length} selected PENDING invoice(s)?\n\nThis removes them from the active workflow. They stay in the sheet for audit.`)) return;
                    const qbNos = reviewSelected.map(ri => pending.find(p => p.rowIndex === ri)?.qbInvoice || '').filter(Boolean);
                    // Session 69 — optimistic: flip rows to DELETED immediately.
                    const qbSet = new Set(qbNos);
                    const origStatusById: Record<string, string> = {};
                    for (const p of pending) if (qbSet.has(p.qbInvoice)) origStatusById[p.qbInvoice] = p.status || 'PENDING';
                    setInvoices(prev => prev.map(inv => qbSet.has(inv.qbInvoice) ? { ...inv, status: 'DELETED' } : inv));
                    setBulkProcessing(true);
                    const resp = await postBatchDeleteStaxInvoices({ qbInvoiceNos: qbNos });
                    const serverResult: BatchMutationResult = resp.ok && resp.data ? resp.data : {
                      success: false, processed: qbNos.length, succeeded: 0, failed: qbNos.length,
                      skipped: [], errors: qbNos.map(q => ({ id: q, reason: resp.error || 'Request failed' })),
                      message: resp.error || 'Batch delete failed',
                    };
                    if (serverResult.errors && serverResult.errors.length) {
                      const failedIds = new Set(serverResult.errors.map(e => e.id).filter(Boolean));
                      setInvoices(prev => prev.map(inv => failedIds.has(inv.qbInvoice) ? { ...inv, status: origStatusById[inv.qbInvoice] || inv.status } : inv));
                    }
                    setBulkProcessing(false); setReviewSelected([]);
                    setBulkActionLabel('Delete PENDING Invoices');
                    setBulkResult(serverResult);
                    loadData(true);
                  }} />
                <WriteButton label={creatingInvoices ? 'Pushing...' : `Push to Stax (${reviewSelected.length})`} variant="primary" size="sm" disabled={creatingInvoices || !reviewSelected.length}
                  icon={creatingInvoices ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={12} />}
                  onClick={async () => {
                    if (!confirm(`Push ${reviewSelected.length} selected invoice(s) to Stax?\n\nThis creates them in Stax and changes status to CREATED.`)) return;
                    setCreatingInvoices(true); setInvoiceResult(null); setError(null);
                    const qbNos = reviewSelected.map(ri => { const inv = pending.find(p => p.rowIndex === ri); return inv?.qbInvoice || ''; }).filter(Boolean);
                    const res = await postCreateStaxInvoices({ invoiceNos: qbNos });
                    setCreatingInvoices(false);
                    if (res.ok && res.data) { const details = (res.data as any).errorDetails; setInvoiceResult(res.data.summary + (details?.length ? '\n\nErrors:\n' + details.map((d: any) => `${d.invoice} (${d.customer}): ${d.error}`).join('\n') : '')); setReviewSelected([]); loadData(true); }
                    else { setError(res.error || 'Push to Stax failed'); }
                  }} />
              </div>
            </div>
            {invoiceResult && <div style={{ padding: '10px 16px', background: invoiceResult.includes('Errors:') ? '#FEF2F2' : '#F0FDF4', borderBottom: `1px solid ${theme.colors.borderLight}`, fontSize: 13, color: invoiceResult.includes('Errors:') ? '#DC2626' : '#15803D', whiteSpace: 'pre-wrap' }}><div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>{invoiceResult.includes('Errors:') ? <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} /> : <CheckCircle2 size={14} style={{ flexShrink: 0, marginTop: 2 }} />} <span>{invoiceResult}</span> <button onClick={() => setInvoiceResult(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 16, flexShrink: 0 }}>&times;</button></div></div>}
            {(() => { const noId = pending.filter(p => !p.staxCustomerId); return noId.length > 0 ? (
              <div style={{ padding: '10px 16px', background: '#FEF3C7', borderBottom: `1px solid #FDE68A`, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <AlertTriangle size={14} color="#B45309" style={{ flexShrink: 0 }} />
                <span style={{ color: '#92400E' }}><strong>{noId.length} invoice{noId.length > 1 ? 's' : ''}</strong> missing Stax Customer ID — add the customer mapping in Stax Customers tab, then refresh.</span>
                <button onClick={async () => {
                  setCreatingInvoices(true);
                  const res = await postStaxRefreshCustomerIds();
                  setCreatingInvoices(false);
                  if (res.ok) { loadData(true); setInvoiceResult(res.data?.updated || 'Refreshed'); }
                  else setError(res.error || 'Refresh failed');
                }} disabled={creatingInvoices} style={{ marginLeft: 'auto', padding: '4px 12px', fontSize: 11, fontWeight: 600, border: `1px solid #D97706`, borderRadius: 6, background: '#FFFBEB', cursor: 'pointer', color: '#B45309', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <RefreshCw size={11} /> Refresh Stax IDs
                </button>
              </div>
            ) : null; })()}
            {pending.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>
                No PENDING invoices to review. Import an IIF file first.
                <div style={{ marginTop: 8 }}><button onClick={() => setTab('iif')} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, border: `1px solid ${theme.colors.orange}`, borderRadius: 6, background: '#fff', cursor: 'pointer', color: theme.colors.orange, fontFamily: 'inherit' }}>Go to Import</button></div>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th}></th>
                  <th style={th}>QB Invoice</th>
                  <th style={th}>Customer</th>
                  <th style={th}>Amount</th>
                  <th style={th}>Due Date</th>
                  <th style={th}>Notes</th>
                  <th style={th}></th>
                </tr></thead>
                <tbody>{pending.map(i => {
                  const noStaxId = !i.staxCustomerId;
                  return (
                  <tr key={i.rowIndex} style={{ background: reviewSelected.includes(i.rowIndex) ? 'rgba(232,93,45,0.04)' : noStaxId ? '#F9FAFB' : 'transparent', opacity: noStaxId ? 0.5 : 1 }}>
                    <td style={{ ...td, width: 32 }}>
                      {noStaxId ? (
                        <span title="Missing Stax Customer ID — cannot push" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16 }}>
                          <AlertTriangle size={12} color="#B45309" />
                        </span>
                      ) : (
                        <input type="checkbox" checked={reviewSelected.includes(i.rowIndex)} onChange={() => {
                          setReviewSelected(prev => prev.includes(i.rowIndex) ? prev.filter(x => x !== i.rowIndex) : [...prev, i.rowIndex]);
                        }} style={{ accentColor: theme.colors.orange }} />
                      )}
                    </td>
                    <td style={{ ...td, fontWeight: 600 }}>
                      {i.qbInvoice}
                      {i.isTest && <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 6, fontSize: 9, fontWeight: 700, background: '#EDE9FE', color: '#7C3AED' }}>Test</span>}
                    </td>
                    <td style={td}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                        {i.staxCustomerId ? (
                          <>
                            <span style={{ color: '#15803D', fontSize: 10 }}>✓</span>
                            <span style={{ fontWeight: 500 }}>{i.customer}</span>
                            {i.paymentMethodStatus === 'has_pm' && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: '#F0FDF4', color: '#15803D', fontWeight: 700 }}>CC on file</span>}
                            {i.paymentMethodStatus === 'no_pm' && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: '#FEF3C7', color: '#B45309', fontWeight: 700 }}>No PM</span>}
                          </>
                        ) : (
                          <>
                            <span style={{ color: '#DC2626', fontSize: 10 }}>✗</span>
                            <span style={{ fontWeight: 500, color: '#DC2626' }}>{i.customer}</span>
                            <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: '#FEF2F2', color: '#991B1B', fontWeight: 700 }}>No Stax ID</span>
                          </>
                        )}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontSize: 12, fontWeight: 500 }}>
                      ${i.amount.toFixed(2)}
                    </td>
                    <td style={td}>
                      <input type="date" value={i.dueDate || ''}
                        onFocus={() => beginEdit(i.qbInvoice + ':dueDate')}
                        onChange={(e) => {
                          // Controlled input — update local state immediately so the field shows the new value
                          const v = e.target.value;
                          setInvoices(prev => prev.map(inv => inv.qbInvoice === i.qbInvoice ? { ...inv, dueDate: v } : inv));
                        }}
                        onBlur={async (e) => {
                          // Clear the editing flag BEFORE the await so the realtime
                          // refetch triggered by our save doesn't get blocked.
                          endEdit(i.qbInvoice + ':dueDate');
                          const newVal = e.target.value;
                          // Skip if no change (setInvoices above already set the state, so compare to original)
                          if (!newVal || newVal === i.dueDate) return;
                          // Optimistic update already applied via onChange. Save to server.
                          const origDueDate = i.dueDate;
                          try {
                            const res = await postUpdateStaxInvoice({ qbInvoiceNo: i.qbInvoice, dueDate: newVal });
                            if (!res.ok || !res.data?.success) {
                              // Revert on failure
                              setInvoices(prev => prev.map(inv => inv.qbInvoice === i.qbInvoice ? { ...inv, dueDate: origDueDate } : inv));
                              setError(res.error || res.data?.message || 'Update failed');
                            }
                          } catch (err) {
                            setInvoices(prev => prev.map(inv => inv.qbInvoice === i.qbInvoice ? { ...inv, dueDate: origDueDate } : inv));
                            setError(String(err));
                          }
                        }}
                        style={{ padding: '4px 8px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 4, fontFamily: 'inherit' }} />
                    </td>
                    <td style={td}>
                      <input value={i.notes || ''}
                        onFocus={() => beginEdit(i.qbInvoice + ':notes')}
                        onChange={(e) => {
                          const v = e.target.value;
                          setInvoices(prev => prev.map(inv => inv.qbInvoice === i.qbInvoice ? { ...inv, notes: v } : inv));
                        }}
                        onBlur={async (e) => {
                          endEdit(i.qbInvoice + ':notes');
                          const newVal = e.target.value;
                          if (newVal === i.notes) return;
                          const origNotes = i.notes;
                          try {
                            const res = await postUpdateStaxInvoice({ qbInvoiceNo: i.qbInvoice, notes: newVal });
                            if (!res.ok || !res.data?.success) {
                              setInvoices(prev => prev.map(inv => inv.qbInvoice === i.qbInvoice ? { ...inv, notes: origNotes } : inv));
                              setError(res.error || res.data?.message || 'Update failed');
                            }
                          } catch (err) {
                            setInvoices(prev => prev.map(inv => inv.qbInvoice === i.qbInvoice ? { ...inv, notes: origNotes } : inv));
                            setError(String(err));
                          }
                        }}
                        placeholder="Notes..."
                        style={{ width: '100%', padding: '4px 8px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 4, fontFamily: 'inherit', minWidth: 100 }} />
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 4 }}>
                        {/* v38.124.0 — recovery for orphan rows whose invoice
                            is already in Stax (e.g. dedup wiped the stax_id).
                            Calls Stax API to find the matching invoice + flips
                            PENDING→CREATED. Avoids the "I'll have to push it
                            again" duplicate-creation trap. */}
                        <button
                          onClick={async () => {
                            if (!confirm(`Look up ${i.qbInvoice} in Stax and link it? This avoids creating a duplicate. Use this when the invoice already exists in Stax but our system lost the link.`)) return;
                            const res = await postLinkStaxInvoiceToExisting({ qbInvoiceNo: i.qbInvoice });
                            if (res.ok && res.data?.success) {
                              loadData(true);
                            } else if (res.ok && res.data?.ambiguous && res.data.candidates) {
                              const choices = res.data.candidates.map((c, idx) =>
                                `${idx + 1}. ${c.id} — $${c.total ?? '?'} ${c.status ?? ''}`
                              ).join('\n');
                              const pick = prompt(
                                `Multiple Stax invoices match this QB#. Which one?\n\n${choices}\n\nEnter number 1-${res.data.candidates.length}:`,
                                '1'
                              );
                              const n = Number(pick) - 1;
                              if (Number.isInteger(n) && n >= 0 && n < res.data.candidates.length) {
                                const retry = await postLinkStaxInvoiceToExisting({
                                  qbInvoiceNo: i.qbInvoice,
                                  staxInvoiceId: res.data.candidates[n].id,
                                });
                                if (retry.ok && retry.data?.success) loadData(true);
                                else setError(retry.error || retry.data?.error || 'Link failed');
                              }
                            } else {
                              setError(res.error || res.data?.error || 'Link failed');
                            }
                          }}
                          style={{ padding: '3px 8px', fontSize: 11, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 4, background: '#fff', cursor: 'pointer', color: theme.colors.textSecondary, fontFamily: 'inherit' }}
                          title="Already in Stax? Link this row to it instead of pushing again"
                        >Link</button>
                        <button onClick={async () => {
                          if (!confirm(`Delete ${i.qbInvoice}? It will be marked DELETED.`)) return;
                          const res = await postDeleteStaxInvoice({ qbInvoiceNo: i.qbInvoice, rowIndex: i.rowIndex });
                          if (res.ok && res.data?.success) { setReviewSelected(prev => prev.filter(x => x !== i.rowIndex)); loadData(true); }
                          else setError(res.error || 'Delete failed');
                        }} style={{ padding: '3px 8px', fontSize: 11, fontWeight: 500, border: `1px solid #FECACA`, borderRadius: 4, background: '#FEF2F2', cursor: 'pointer', color: '#DC2626', fontFamily: 'inherit' }}>Void</button>
                      </div>
                    </td>
                  </tr>
                  ); })}</tbody>
              </table>
            )}
            <div style={{ padding: '10px 16px', borderTop: `1px solid ${theme.colors.borderLight}`, fontSize: 11, color: theme.colors.textMuted }}>
              {pending.length} pending · {pending.filter(p => p.staxCustomerId).length} pushable · {reviewSelected.length} selected
            </div>
          </div>
        );
      })()}

      {/* ═══ Charge Queue Tab (CREATED invoices grouped by due date) ═══ */}
      {tab === 'queue' && (() => {
        // v4.4.0 NVPC Phase 4A: Only CREATED invoices with a Stax ID are truly
        // chargeable. PENDING rows must be pushed to Stax first. We surface
        // due-today/past PENDING rows in a dedicated "Needs Push to Stax" section
        // at the top so users see ALL their due-today work in one place.
        const created = invoices.filter(i => (i.status || '').toUpperCase() === 'CREATED' && i.staxId);
        const today = new Date().toISOString().slice(0, 10);
        const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

        // PENDING rows that need to be pushed BEFORE they can be charged.
        // Split into "due now" (urgent) and "due future" (informational).
        const pendingAll = invoices.filter(i => (i.status || '').toUpperCase() === 'PENDING');
        const pendingDueNow = pendingAll.filter(i => i.dueDate && i.dueDate <= today);
        const pendingFuture = pendingAll.filter(i => i.dueDate && i.dueDate > today);

        const groups: { label: string; color: string; invoices: typeof created }[] = [
          { label: 'Due Today', color: '#DC2626', invoices: created.filter(i => i.dueDate <= today) },
          { label: 'Due Tomorrow', color: '#F59E0B', invoices: created.filter(i => i.dueDate === tomorrow) },
          { label: 'Due This Week', color: '#2563EB', invoices: created.filter(i => i.dueDate > tomorrow && i.dueDate <= weekEnd) },
          { label: 'Due Later', color: theme.colors.textMuted, invoices: created.filter(i => i.dueDate > weekEnd) },
        ].filter(g => g.invoices.length > 0);

        const pmIcon = (status?: string) => {
          if (status === 'has_pm') return <span style={{ color: '#15803D', fontSize: 11 }} title="Payment method on file">Ready</span>;
          if (status === 'no_pm') return <span style={{ color: '#DC2626', fontSize: 11 }} title="No payment method on file">No PM</span>;
          if (status === 'no_customer') return <span style={{ color: '#DC2626', fontSize: 11 }} title="No Stax customer">No Cust</span>;
          return <span style={{ color: theme.colors.textMuted, fontSize: 11 }}>—</span>;
        };

        // Push-to-Stax handler — wraps postCreateStaxInvoices with loading state
        const handlePushOne = async (qbInvoice: string) => {
          setChargingInvoice(qbInvoice); // reuse chargingInvoice for loading spinner
          setChargeResult(null);
          setError(null);
          const res = await postCreateStaxInvoices({ invoiceNos: [qbInvoice] });
          setChargingInvoice(null);
          if (res.ok && res.data) {
            setChargeResult(`${qbInvoice}: ${res.data.summary || 'Pushed to Stax'}`);
            loadData(true);
          } else {
            setError(res.error || 'Push to Stax failed');
          }
        };

        const handlePushAllEligible = async () => {
          if (pendingDueNow.length === 0) return;
          const pushable = pendingDueNow.filter(p => p.staxCustomerId);
          if (pushable.length === 0) { setError('No eligible rows — all PENDING due-now rows are missing Stax Customer ID'); return; }
          if (!confirm(`Push ${pushable.length} due-now PENDING invoice(s) to Stax? This creates them in Stax and moves them to CREATED.`)) return;
          setCreatingInvoices(true);
          setError(null);
          const res = await postCreateStaxInvoices({ invoiceNos: pushable.map(p => p.qbInvoice) });
          setCreatingInvoices(false);
          if (res.ok && res.data) {
            setChargeResult(res.data.summary || 'Pushed to Stax');
            loadData(true);
          } else {
            setError(res.error || 'Push to Stax failed');
          }
        };

        return (
          <div style={{ ...card, padding: 0 }}>
            <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${theme.colors.borderLight}` }}>
              <div>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Charge Queue</span>
                <span style={{ fontSize: 12, color: theme.colors.textMuted, marginLeft: 8 }}>{created.length} ready · {pendingDueNow.length} pending push</span>
              </div>
              <InfoTooltip text="Invoices must be created in Stax (status: CREATED with a Stax Invoice ID) before they can be auto-charged. The 'Needs Push to Stax' section shows PENDING invoices due now — click Push to Stax to create them before the next charge run. The daily auto-charge trigger runs at 8 AM Pacific, auto-pushes due-today PENDING invoices with Auto Charge enabled, then charges sequentially. Large batches are processed with a per-run cap — rows beyond the cap defer to the next run without any status change. If repeated API errors occur, a circuit breaker halts the run safely and resumes next time." />
              {created.length > 0 && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <WriteButton label={`Set All Auto (${created.length})`} variant="secondary" size="sm"
                    onClick={async () => {
                      const res = await postToggleAutoCharge({ invoiceNos: created.map(c => c.qbInvoice), autoCharge: true });
                      if (res.ok) { setChargeResult(res.data?.message || 'All set to Auto'); loadData(true); } else setError(res.error || 'Failed');
                    }} />
                  <WriteButton label={`Set All Manual (${created.length})`} variant="secondary" size="sm"
                    onClick={async () => {
                      const res = await postToggleAutoCharge({ invoiceNos: created.map(c => c.qbInvoice), autoCharge: false });
                      if (res.ok) { setChargeResult(res.data?.message || 'All set to Manual'); loadData(true); } else setError(res.error || 'Failed');
                    }} />
                </div>
              )}
            </div>

            {/* ═══ v4.4.0 NVPC Phase 4A — Needs Push to Stax section ═══
                PENDING rows that are due-today-or-past and must be pushed to Stax
                before they can be charged. Shown at the top so users see all their
                due-now work in one place. Rows missing Stax Customer ID are
                flagged — they need Customer mapping first (handled in Review tab). */}
            {pendingDueNow.length > 0 && (
              <div>
                <div style={{ padding: '10px 16px', background: '#FEF3C7', borderBottom: `1px solid #FDE68A`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertTriangle size={14} color="#B45309" />
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#92400E' }}>Needs Push to Stax ({pendingDueNow.length})</span>
                    <span style={{ fontSize: 11, color: '#92400E' }}>These PENDING invoices are due now but haven't been created in Stax yet</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#92400E' }}>${pendingDueNow.reduce((s, i) => s + i.amount, 0).toFixed(2)}</span>
                    {pendingDueNow.filter(p => p.staxCustomerId).length > 0 && (
                      <WriteButton
                        label={creatingInvoices ? 'Pushing...' : `Push All (${pendingDueNow.filter(p => p.staxCustomerId).length})`}
                        variant="primary"
                        size="sm"
                        disabled={creatingInvoices}
                        onClick={handlePushAllEligible}
                      />
                    )}
                  </div>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Invoice #', 'Customer', 'Amount', 'Due Date', 'Customer ID', 'Auto', ''].map(h => (
                        <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 500, fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${theme.colors.borderLight}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>{pendingDueNow.map(i => {
                    const hasCustomer = !!i.staxCustomerId;
                    return (
                      <tr key={i.qbInvoice} style={{ background: hasCustomer ? 'transparent' : '#FEF2F2' }}>
                        <td style={{ ...td, fontWeight: 600, width: 160 }}>
                          {i.qbInvoice}
                          {i.isTest && <span style={{ marginLeft: 4, padding: '1px 5px', borderRadius: 6, fontSize: 9, fontWeight: 700, background: '#EDE9FE', color: '#7C3AED' }}>Test</span>}
                          <span style={{ marginLeft: 4, padding: '1px 5px', borderRadius: 6, fontSize: 9, fontWeight: 700, background: '#FEF3C7', color: '#92400E' }}>Pending Push</span>
                        </td>
                        <td style={{ ...td, fontWeight: 500 }}>{i.customer}</td>
                        <td style={{ ...td, fontWeight: 600 }}>${i.amount.toFixed(2)}</td>
                        <td style={td}>{i.dueDate}</td>
                        <td style={{ ...td, fontSize: 10, color: hasCustomer ? theme.colors.textMuted : '#DC2626', fontFamily: 'monospace' }}>
                          {hasCustomer ? i.staxCustomerId.substring(0, 10) + '...' : 'MISSING'}
                        </td>
                        <td style={{ ...td, width: 90, textAlign: 'center', fontSize: 11, color: i.autoCharge === true ? '#15803D' : '#B45309' }}>
                          {i.autoCharge === true ? 'Auto' : 'Manual'}
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          {hasCustomer ? (
                            <WriteButton
                              label={chargingInvoice === i.qbInvoice ? 'Pushing...' : 'Push to Stax'}
                              variant="primary"
                              size="sm"
                              disabled={!!chargingInvoice || creatingInvoices}
                              onClick={() => handlePushOne(i.qbInvoice)}
                            />
                          ) : (
                            <span style={{ fontSize: 11, color: '#DC2626' }} title="This customer has no Stax Customer ID mapping. Add it in the Customers tab or run Refresh Stax IDs.">
                              Needs Customer
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            )}

            {created.length === 0 && pendingDueNow.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>
                No invoices in the charge queue.
                {pendingFuture.length > 0 && <div style={{ marginTop: 4, fontSize: 12 }}>({pendingFuture.length} PENDING future-dated invoice{pendingFuture.length !== 1 ? 's' : ''} in Review tab)</div>}
                <div style={{ marginTop: 8 }}><button onClick={() => setTab('review')} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, border: `1px solid ${theme.colors.orange}`, borderRadius: 6, background: '#fff', cursor: 'pointer', color: theme.colors.orange, fontFamily: 'inherit' }}>Go to Review</button></div>
              </div>
            ) : groups.map(g => (
              <div key={g.label}>
                <div style={{ padding: '10px 16px', background: theme.colors.bgSubtle, borderBottom: `1px solid ${theme.colors.borderLight}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: g.color }}>{g.label} ({g.invoices.length})</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: g.color }}>${g.invoices.reduce((s, i) => s + i.amount, 0).toFixed(2)}</span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Invoice #', 'Customer', 'Amount', 'Due Date', 'Status', 'Auto', 'Scheduled', ''].map(h => (
                        <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 500, fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${theme.colors.borderLight}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>{g.invoices.map(i => (
                    <tr key={i.qbInvoice} style={{ cursor: 'pointer' }}
                      onClick={() => setSelectedInvoice(toPaymentInvoice(i))}
                      onMouseEnter={e => e.currentTarget.style.background = theme.colors.bgSubtle}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ ...td, fontWeight: 600, width: 160 }}>
                        {i.qbInvoice}
                        {i.isTest && <span style={{ marginLeft: 4, padding: '1px 5px', borderRadius: 6, fontSize: 9, fontWeight: 700, background: '#EDE9FE', color: '#7C3AED' }}>Test</span>}
                      </td>
                      <td style={{ ...td, fontWeight: 500 }}>{i.customer}{i.autoCharge !== false && <span style={{ marginLeft: 4, fontSize: 9, padding: '1px 5px', borderRadius: 4, background: '#F0FDF4', color: '#15803D', fontWeight: 700 }}>Auto Pay</span>}</td>
                      <td style={{ ...td, fontWeight: 600 }}>${i.amount.toFixed(2)}</td>
                      <td style={td}>{i.dueDate}</td>
                      <td style={{ ...td, width: 80 }}>{pmIcon(i.paymentMethodStatus)}</td>
                      <td style={{ ...td, width: 90, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: i.autoCharge === true ? '#15803D' : '#B45309' }}>
                          <input type="checkbox" checked={i.autoCharge === true}
                            onChange={async () => {
                              const newVal = !i.autoCharge;
                              // Optimistic update — flip immediately in UI
                              setInvoices(prev => prev.map(inv => inv.qbInvoice === i.qbInvoice ? { ...inv, autoCharge: newVal } : inv));
                              const res = await postToggleAutoCharge({ invoiceNos: [i.qbInvoice], autoCharge: newVal });
                              if (!res.ok) {
                                // Revert on failure
                                setInvoices(prev => prev.map(inv => inv.qbInvoice === i.qbInvoice ? { ...inv, autoCharge: !newVal } : inv));
                                setError(res.error || 'Toggle failed');
                              }
                            }}
                            style={{ accentColor: '#15803D', cursor: 'pointer' }} />
                          <span title={i.autoCharge === true ? 'This invoice will be charged automatically on its due date' : 'This invoice must be charged manually — click to enable auto-pay'}>{i.autoCharge === true ? 'Auto' : 'Manual'}</span>
                        </label>
                      </td>
                      <td style={{ ...td, width: 50 }}>
                        {/* v38.120.0 — Scheduled Date column: separate from Due Date.
                            Defaults to Due Date display when user hasn't overridden.
                            Editing saves to scheduledDate (sticks). Charge loop uses
                            scheduledDate if set, else falls back to dueDate. */}
                        <input type="date" value={i.scheduledDate || i.dueDate || ''} onClick={e => e.stopPropagation()}
                          onFocus={() => beginEdit(i.qbInvoice + ':scheduledDate')}
                          onChange={(e) => {
                            const v = e.target.value;
                            setInvoices(prev => prev.map(inv => inv.qbInvoice === i.qbInvoice ? { ...inv, scheduledDate: v } : inv));
                          }}
                          onBlur={async (e) => {
                            endEdit(i.qbInvoice + ':scheduledDate');
                            const newVal = e.target.value;
                            const currentShown = i.scheduledDate || i.dueDate || '';
                            if (!newVal || newVal === currentShown) return;
                            const origScheduled = i.scheduledDate || '';
                            try {
                              const res = await postUpdateStaxInvoice({ qbInvoiceNo: i.qbInvoice, scheduledDate: newVal });
                              if (!res.ok || !res.data?.success) {
                                setInvoices(prev => prev.map(inv => inv.qbInvoice === i.qbInvoice ? { ...inv, scheduledDate: origScheduled } : inv));
                                setError(res.error || res.data?.message || 'Update failed');
                              }
                            } catch (err) {
                              setInvoices(prev => prev.map(inv => inv.qbInvoice === i.qbInvoice ? { ...inv, scheduledDate: origScheduled } : inv));
                              setError(String(err));
                            }
                          }}
                          title="Scheduled charge date — defaults to due date, override for a specific charge day"
                          style={{ padding: '2px 4px', fontSize: 11, border: `1px solid ${theme.colors.border}`, borderRadius: 4, fontFamily: 'inherit', width: 120 }} />
                      </td>
                      <td style={{ ...td, textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                        <WriteButton label={chargingInvoice === i.qbInvoice ? 'Charging...' : 'Charge Now'} variant="secondary" size="sm" disabled={!!chargingInvoice}
                          onClick={async () => {
                            if (!confirm(`Charge ${i.qbInvoice} ($${i.amount.toFixed(2)}) for ${i.customer} now?`)) return;
                            setChargingInvoice(i.qbInvoice); setChargeResult(null); setError(null);
                            const res = await postChargeSingleInvoice({ qbInvoiceNo: i.qbInvoice });
                            setChargingInvoice(null);
                            if (res.ok && res.data) {
                              if (res.data.success) setChargeResult(`${i.qbInvoice}: Charged — txn ${res.data.transactionId}`);
                              else setChargeResult(`${i.qbInvoice}: ${res.data.status} — ${res.data.error}`);
                              loadData(true);
                            } else setError(res.error || 'Charge failed');
                          }} />
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ))}
          </div>
        );
      })()}

      {tab === 'charges' && (() => {
        const q = chargeLogSearch.toLowerCase();
        const filtered = q ? charges.filter(c =>
          (c.qbInvoice || '').toLowerCase().includes(q) ||
          (c.customer || '').toLowerCase().includes(q) ||
          (c.status || '').toLowerCase().includes(q) ||
          (c.txnId || '').toLowerCase().includes(q) ||
          (c.notes || '').toLowerCase().includes(q) ||
          String(c.amount).includes(q) ||
          (c.timestamp || '').toLowerCase().includes(q)
        ) : charges;
        const sorted = [...filtered].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
        return (
        <div style={{ ...card, padding: 0 }}>
          <div style={{ padding: '14px 16px', borderBottom: `1px solid ${theme.colors.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Charge Log</span>
            <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 320 }}>
              <Search size={14} color={theme.colors.textMuted} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
              <input value={chargeLogSearch} onChange={e => setChargeLogSearch(e.target.value)} placeholder="Search invoices, customers, status…" style={{ width: '100%', padding: '7px 10px 7px 30px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, outline: 'none', background: theme.colors.bgSubtle, fontFamily: 'inherit' }} />
            </div>
            <span style={{ fontSize: 11, color: theme.colors.textMuted }}>{sorted.length} of {charges.length}</span>
          </div>
          {charges.some(c => c.notes?.includes('[DRY RUN]') || c.status === 'DRY_RUN_PASSED') && (
            <div style={{ padding: '8px 16px', background: '#FFFBEB', borderBottom: `1px solid #FCD34D`, fontSize: 12, color: '#92400E', display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={13} /> Some entries below are from Dry Run tests — no actual charges were made for those rows.
            </div>
          )}
          {sorted.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>{charges.length === 0 ? 'No charge log entries yet' : 'No matches for "' + chargeLogSearch + '"'}</div>
          ) : (
            <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 400px)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Timestamp', 'Invoice', 'Customer', 'Amount', 'Status', 'Transaction ID', 'Notes'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{sorted.map((c, i) => (
                <tr key={i}><td style={{ ...td, fontSize: 11, color: theme.colors.textMuted }}>{c.timestamp}</td><td style={{ ...td, fontWeight: 600 }}>{c.qbInvoice}</td><td style={{ ...td, fontWeight: 500 }}>{c.customer}</td><td style={{ ...td, fontWeight: 600 }}>${c.amount.toFixed(2)}</td><td style={td}><Badge t={c.status} /></td><td style={{ ...td, fontFamily: 'monospace', fontSize: 11, color: theme.colors.textMuted }}>{c.txnId || '\u2014'}</td><td style={{ ...td, color: theme.colors.textSecondary }}>{c.notes}</td></tr>
              ))}</tbody>
            </table>
            </div>
          )}
        </div>
        );
      })()}

      {tab === 'exceptions' && (
        <div style={{ ...card, padding: 0 }}>
          <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${theme.colors.borderLight}` }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Exceptions</span>
            <WriteButton label={sendingPayLinks ? 'Sending...' : 'Send Pay Links'} variant="primary" size="sm" disabled={sendingPayLinks} icon={sendingPayLinks ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={12} />} onClick={async () => {
              const failedCount = exceptions.filter(e => !e.resolved).length;
              if (!confirm(`Send pay link emails for all CHARGE_FAILED invoices?\n\n${failedCount} unresolved exception(s) found.`)) return;
              setSendingPayLinks(true); setPayLinkResult(null); setError(null);
              const res = await postSendStaxPayLinks();
              setSendingPayLinks(false);
              if (res.ok && res.data) { setPayLinkResult(res.data.summary); loadData(true); }
              else { setError(res.error || 'Send pay links failed'); }
            }} />
          </div>
          {payLinkResult && <div style={{ padding: '10px 16px', background: '#F0FDF4', borderBottom: `1px solid ${theme.colors.borderLight}`, fontSize: 13, color: '#15803D', display: 'flex', alignItems: 'center', gap: 8 }}><CheckCircle2 size={14} /> {payLinkResult} <button onClick={() => setPayLinkResult(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#15803D', fontSize: 16 }}>&times;</button></div>}
          {unresolvedExceptions.length === 0 && !showResolvedExceptions ? (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <div style={{ color: '#15803D', fontSize: 14, fontWeight: 600, marginBottom: 4 }}>All clear — no open exceptions</div>
              {exceptions.length > 0 && (
                <button onClick={() => setShowResolvedExceptions(true)} style={{ fontSize: 12, color: theme.colors.orange, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                  Show {exceptions.length} resolved exception{exceptions.length !== 1 ? 's' : ''}
                </button>
              )}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Timestamp', 'Invoice', 'Customer', 'Amount', 'Reason', 'Resolved', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{(showResolvedExceptions ? exceptions : unresolvedExceptions).map((exc, i) => (
                <tr key={i} style={{ background: exc.resolved ? 'transparent' : '#FFFBF5' }}>
                  <td style={{ ...td, fontSize: 11, color: theme.colors.textMuted }}>{exc.timestamp}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{exc.qbInvoice}</td>
                  <td style={{ ...td, fontWeight: 500 }}>{exc.customer}</td>
                  <td style={{ ...td, fontWeight: 600 }}>${exc.amount.toFixed(2)}</td>
                  <td style={{ ...td, color: '#DC2626', fontSize: 12 }}>{exc.reason}</td>
                  <td style={td}>{exc.resolved ? <CheckCircle2 size={15} color="#15803D" /> : <XCircle size={15} color="#DC2626" />}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {!exc.resolved && <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      {exc.payLink && <WriteButton label={sendingPayLink === exc.qbInvoice ? 'Sending...' : 'Pay Link'} variant="secondary" size="sm" disabled={!!sendingPayLink} icon={<Send size={10} />} onClick={async () => {
                        if (!confirm(`Send pay link email for invoice ${exc.qbInvoice} ($${exc.amount.toFixed(2)})?`)) return;
                        setSendingPayLink(exc.qbInvoice); setError(null);
                        const res = await postSendStaxPayLink({ qbInvoiceNo: exc.qbInvoice });
                        setSendingPayLink(null);
                        if (res.ok && res.data && res.data.success) { setPayLinkResult(`Pay link sent for ${exc.qbInvoice}`); loadData(true); }
                        else { setError(res.error || res.data?.error || 'Send pay link failed'); }
                      }} />}
                      <WriteButton label="Resolve" variant="secondary" size="sm" onClick={async () => {
                        const res = await postResolveStaxException({ qbInvoiceNo: exc.qbInvoice, timestamp: exc.timestamp });
                        if (res.ok && res.data?.success) { loadData(true); }
                        else { setError(res.error || 'Failed to resolve exception'); }
                      }} />
                    </div>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'customers' && (
        <div style={{ ...card, padding: 0 }}>
          <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${theme.colors.borderLight}` }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Stax Customers</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <WriteButton label={pulling ? 'Pulling...' : 'Pull Customers (CB)'} variant="secondary" size="sm" disabled={pulling || syncing} icon={pulling ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <UploadCloud size={12} />} onClick={async () => {
                setPulling(true); setCustResult(null); setError(null);
                const res = await postPullStaxCustomers();
                setPulling(false);
                if (res.ok && res.data) {
                  setCustResult(`Pull complete: ${res.data.withStaxId} with Stax ID, ${res.data.missingStaxId} missing, ${res.data.apiErrors} errors`);
                  loadData(true);
                } else { setError(res.error || 'Pull customers failed'); }
              }} />
              <WriteButton label={syncing ? 'Syncing...' : 'Sync with Stax'} variant="secondary" size="sm" disabled={pulling || syncing} icon={syncing ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />} onClick={async () => {
                setSyncing(true); setCustResult(null); setError(null);
                const res = await postSyncStaxCustomers();
                setSyncing(false);
                if (res.ok && res.data) {
                  const d = res.data;
                  setCustResult(`Sync: ${d.verified} verified, ${d.hasPayment} with payment, ${d.foundByEmail} found by email, ${d.companyPushed} company names pushed${d.apiErrors ? ', ' + d.apiErrors + ' errors' : ''}`);
                  loadData(true);
                } else { setError(res.error || 'Sync customers failed'); }
              }} />
            </div>
          </div>
          {customers.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>No customers yet</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['QB Name', 'Stax Name', 'Stax ID', 'Email', 'Payment Method'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{customers.map(c => (
                <tr
                  key={c.qbName}
                  style={{ cursor: 'pointer', transition: 'background 0.1s' }}
                  onClick={() => setSelectedCustomer(toStaxCustomer(c))}
                  onMouseEnter={e => e.currentTarget.style.background = theme.colors.bgSubtle}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  title="Click to verify customer"
                >
                  <td style={{ ...td, fontWeight: 600 }}>{c.qbName}</td>
                  <td style={td}>{c.staxName}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, color: theme.colors.textMuted }}>{c.staxId}</td>
                  <td style={{ ...td, color: theme.colors.textSecondary }}>{c.email}</td>
                  <td style={td}>{c.payMethod ? <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: '#F0FDF4', color: '#15803D', fontWeight: 500 }}>{c.payMethod}</span> : <span style={{ color: theme.colors.textMuted }}>{'\u2014'}</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {custResult && (
            <div style={{ padding: '8px 14px', margin: '0 16px', borderRadius: 8, background: '#F0FDF4', border: '1px solid #BBF7D0', fontSize: 12, color: '#166534' }}>
              <CheckCircle2 size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} />{custResult}
            </div>
          )}
          <div style={{ padding: '10px 16px', borderTop: `1px solid ${theme.colors.borderLight}`, fontSize: 11, color: theme.colors.textMuted }}>
            Click a customer to view Stax details and payment methods
          </div>
        </div>
      )}

      {tab === 'iif' && <IIFImportTab onImported={() => loadData(true)} />}

      {tab === 'runlog' && <RunLogTab entries={runLog} />}

      {/* IIF → Stax Pipeline */}
      {tab === 'pipeline' && (
        <div>
          <div style={card}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>IIF → Stax Invoice Pipeline</div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
              {[
                { step: '1', label: 'QB Billing Report', desc: 'Generate unbilled report from Billing page', status: 'ready', color: '#15803D' },
                { step: '2', label: 'Export IIF', desc: 'Export IIF file for QuickBooks import', status: 'ready', color: '#15803D' },
                { step: '3', label: 'Create Stax Invoices', desc: 'Uses same billing data to create Stax invoices', status: 'ready', color: '#1D4ED8' },
                { step: '4', label: 'Auto-Charge on Due Date', desc: 'Stax charges card/ACH when invoice is due', status: 'auto', color: '#7C3AED' },
              ].map(s => (
                <div key={s.step} style={{ flex: 1, padding: 14, background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, textAlign: 'center' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: s.color + '15', color: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, margin: '0 auto 8px' }}>{s.step}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{s.label}</div>
                  <div style={{ fontSize: 10, color: theme.colors.textMuted, lineHeight: 1.4 }}>{s.desc}</div>
                </div>
              ))}
            </div>
            <div style={{ padding: 14, background: '#FFFBF5', border: '1px solid #FED7AA', borderRadius: 10, fontSize: 12, color: '#92400E', lineHeight: 1.6 }}>
              <strong>How it works:</strong> The billing report generates unbilled line items. The same data feeds both the QB IIF export (for bookkeeping) and the Stax invoice creation (for payment collection). When you set a due date on the invoice, Stax automatically charges the customer's payment method on that date. If the charge fails, it appears in the Exceptions tab.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <WriteButton label={creatingInvoices ? 'Creating...' : 'Create Stax Invoices from Billing Report'} variant="primary" disabled={creatingInvoices} style={{ flex: 1, padding: '12px', fontSize: 13 }} onClick={async () => {
              if (!confirm('Create Stax invoices for all PENDING rows in the Invoices tab?\n\nThis will call the Stax API.')) return;
              setCreatingInvoices(true); setInvoiceResult(null); setError(null);
              const res = await postCreateStaxInvoices();
              setCreatingInvoices(false);
              if (res.ok && res.data) { setInvoiceResult(res.data.summary); setTab('invoices'); loadData(true); }
              else { setError(res.error || 'Create invoices failed'); }
            }} />
          </div>
        </div>
      )}

      {/* Customer Mapping */}
      {tab === 'mapping' && (
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center' }}>
            <span>QB ↔ Stax Customer Mapping</span>
            <InfoTooltip text="Every client in QuickBooks must be linked to a matching customer in Stax before we can charge them. This tab is where you make that link. Red dot = not linked yet (charges will fail). Green dot = linked and ready. Use 'Auto-Match by Name' to link everything automatically, or paste the Stax Customer ID manually." />
          </div>
          <div style={{ fontSize: 12, color: theme.colors.textMuted, marginBottom: 16 }}>Match QuickBooks customer names to Stax customer IDs. This mapping is required for invoice creation and auto-charging.</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ borderBottom: `2px solid ${theme.colors.border}` }}>
              <th style={{ ...th, width: 180 }}>QB Customer Name</th>
              <th style={th}><span style={{ display: 'inline-flex', alignItems: 'center' }}>Stax Customer ID<InfoTooltip text="The unique ID that Stax uses to identify this customer. Looks like a long string of letters and numbers. You can find it by logging into Stax, opening the customer, and copying the ID from the URL or customer page. Or just click 'Auto-Match by Name' below to fill them in automatically." /></span></th>
              <th style={th}>Stax Company</th>
              <th style={th}>Email</th>
              <th style={th}>Payment Method</th>
              <th style={{ ...th, width: 60 }}>Status</th>
            </tr></thead>
            <tbody>
              {customers.map(c => (
                <tr key={c.qbName} style={{ borderBottom: `1px solid ${theme.colors.borderLight}` }}>
                  <td style={{ ...td, fontWeight: 600 }}>{c.qbName}</td>
                  <td style={td}><input value={mappingEdits[c.qbName] !== undefined ? mappingEdits[c.qbName] : c.staxId} onChange={e => setMappingEdits(prev => ({ ...prev, [c.qbName]: e.target.value }))} style={{ padding: '4px 8px', fontSize: 11, fontFamily: 'monospace', border: `1px solid ${theme.colors.borderLight}`, borderRadius: 6, width: 140 }} /></td>
                  <td style={td}>{c.staxCompany || c.staxName}</td>
                  <td style={{ ...td, color: theme.colors.textSecondary }}>{c.email}</td>
                  <td style={td}>{c.payMethod ? <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: '#F0FDF4', color: '#15803D' }}>{c.payMethod}</span> : <span style={{ color: theme.colors.textMuted }}>{'\u2014'}</span>}</td>
                  <td style={td}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: c.staxId ? '#15803D' : '#DC2626' }} /></td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: theme.colors.textMuted }}>No customers loaded</td></tr>
              )}
            </tbody>
          </table>
          {mappingResult && (
            <div style={{ padding: '8px 14px', margin: '10px 16px 0', borderRadius: 8, background: '#F0FDF4', border: '1px solid #BBF7D0', fontSize: 12, color: '#166534' }}>{mappingResult}</div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <WriteButton label={mappingSaving ? 'Saving...' : 'Save Mappings'} variant="primary" disabled={mappingSaving || Object.keys(mappingEdits).length === 0} onClick={async () => {
              setMappingSaving(true); setMappingResult(null);
              const mappings = Object.entries(mappingEdits).map(([qbCustomerName, staxCustomerId]) => ({ qbCustomerName, staxCustomerId }));
              const res = await postSaveStaxCustomerMapping(mappings);
              setMappingSaving(false);
              if (res.ok && res.data) {
                setMappingResult(`Saved: ${res.data.updated} updated, ${res.data.added} added`);
                setMappingEdits({});
                loadData(true);
              } else { setError(res.error || 'Failed to save mappings'); }
            }} />
            <WriteButton label={autoMatching ? 'Matching...' : 'Auto-Match by Name'} variant="secondary" disabled={autoMatching} onClick={async () => {
              setAutoMatching(true); setMappingResult(null);
              const res = await postAutoMatchStaxCustomers();
              setAutoMatching(false);
              if (res.ok && res.data) {
                setMappingResult(`Auto-match: ${res.data.added} new customer(s) added, ${res.data.alreadyExisted} already existed`);
                loadData(true);
              } else { setError(res.error || 'Auto-match failed'); }
            }} />
            <WriteButton label="Refresh" variant="secondary" onClick={async () => { loadData(true); }} />
          </div>
        </div>
      )}

      {/* Modals / Panels */}
      {selectedInvoice && (
        <PaymentDetailPanel
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          charges={charges.filter(c => c.qbInvoice === selectedInvoice.qbInvoice).map(c => ({
            timestamp: c.timestamp, status: (c.status === 'SUCCESS' ? 'Success' : c.status === 'DECLINED' || c.status === 'API_ERROR' || c.status === 'NO_PAYMENT_METHOD' ? 'Failed' : 'Pending') as 'Success' | 'Failed' | 'Pending',
            txnId: c.txnId || '', notes: c.notes || c.status,
          }))}
          paymentMethod={(() => {
            const cust = customers.find(c => c.qbName === selectedInvoice.customer);
            return cust?.payMethod || undefined;
          })()}
          onReset={async (qbInvoice) => {
            const res = await postResetStaxInvoiceStatus({ qbInvoiceNo: qbInvoice });
            if (res.ok && res.data?.success) {
              setChargeResult(`${qbInvoice} reset to ${res.data.newStatus}`);
              loadData(true);
            } else { setError(res.error || 'Reset failed'); }
          }}
          onRetryCharge={async (qbInvoice) => {
            if (!confirm(`Charge invoice ${qbInvoice} ($${selectedInvoice.amount.toFixed(2)}) for ${selectedInvoice.customer}?`)) return;
            setChargingInvoice(qbInvoice); setChargeResult(null); setError(null);
            const res = await postChargeSingleInvoice({ qbInvoiceNo: qbInvoice });
            setChargingInvoice(null);
            if (res.ok && res.data?.success) {
              setChargeResult(`${qbInvoice}: Charged successfully — txn ${res.data.transactionId}`);
            } else {
              setChargeResult(`${qbInvoice}: ${res.data?.status || 'FAILED'} — ${res.data?.error || res.error || 'Charge failed'}`);
            }
            loadData(true);
          }}
        />
      )}
      {selectedCustomer && (
        <CustomerVerificationPanel customer={selectedCustomer} onClose={() => setSelectedCustomer(null)} />
      )}
      </div>
    </div>
  );
}
