import React, { useState, useEffect, useRef } from 'react';
import { X, Check, Users, Edit2, ExternalLink, FolderOpen, Sheet, Info, Loader2, AlertTriangle, CheckCircle, FileText } from 'lucide-react';
import { theme } from '../../styles/theme';
import { AutocompleteSelect } from './AutocompleteSelect';
import { InfoTooltip } from './InfoTooltip';
import { usePaymentTerms } from '../../hooks/usePaymentTerms';
import type { ApiClient } from '../../lib/api';
import { DocumentList } from '../media/DocumentList';
import { DocumentUploadButton } from '../media/DocumentUploadButton';
import { useDocuments } from '../../hooks/useDocuments';

export interface OnboardClientFormData {
  // Identity
  clientName: string;
  clientEmail: string;
  contactName: string;
  phone: string;
  // Billing
  qbCustomerName: string;
  staxCustomerId: string;
  paymentTerms: string;
  freeStorageDays: string;
  discountStoragePct: string;
  discountServicesPct: string;
  // Feature toggles
  enableReceivingBilling: boolean;
  enableShipmentEmail: boolean;
  enableNotifications: boolean;
  autoInspection: boolean;
  separateBySidemark: boolean;
  autoCharge: boolean;
  // Active
  active: boolean;
  // Parent/child
  parentClient: string;
  // Optional
  importInventoryUrl: string;
  notes: string;
  // v38.37.0 — per-client receiving instruction shown as amber banner on Receiving page
  shipmentNote: string;
  // Auto-generated (edit mode only)
  spreadsheetId: string;
  folderId: string;
  photosFolderId: string;
  invoiceFolderId: string;
  webAppUrl: string;
}

/**
 * Result returned by onSubmit. Modal stays open on { ok: false } with form data preserved.
 * On { ok: true }, modal shows success card for 2 seconds then auto-closes.
 */
export interface OnboardSubmitResult {
  ok: boolean;
  error?: string;
  warnings?: string[];
  successMessage?: string; // e.g. "Client onboarded successfully"
}

interface Props {
  mode?: 'create' | 'edit';
  existingClient?: ApiClient | null;
  allClients?: ApiClient[];
  onClose: () => void;
  /** Returns a promise with submit result. Modal handles loading/error/success internally. */
  onSubmit: (data: OnboardClientFormData) => Promise<OnboardSubmitResult>;
  /** Pre-fill specific fields in create mode (e.g. from a client intake
   *  submission). Only the keys present are applied; everything else
   *  falls back to the empty-state defaults. Ignored in edit mode —
   *  edit always starts from `existingClient`. */
  initialData?: Partial<OnboardClientFormData>;
}

// Simulated phase sequence shown during the 30-60s onboarding call. Advances on a
// timer since the backend doesn't emit progress events. Gives the user continuous
// visual feedback that work is happening.
const ONBOARD_PHASES = [
  { label: 'Creating Drive folders…', minSec: 0 },
  { label: 'Copying inventory template spreadsheet…', minSec: 4 },
  { label: 'Writing client settings…', minSec: 10 },
  { label: 'Adding client to Consolidated Billing…', minSec: 15 },
  { label: 'Creating user account…', minSec: 20 },
  { label: 'Deploying Web App…', minSec: 25 },
  { label: 'Installing onEdit triggers…', minSec: 40 },
  { label: 'Finalizing…', minSec: 50 },
];

const EDIT_PHASES = [
  { label: 'Updating Clients tab…', minSec: 0 },
  { label: 'Syncing settings to client sheet…', minSec: 3 },
  { label: 'Finalizing…', minSec: 8 },
];

const inp: React.CSSProperties = {
  width: '100%', padding: '9px 12px', fontSize: 13,
  border: `1px solid ${theme.colors.border}`, borderRadius: 8,
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
};
const inpMono: React.CSSProperties = { ...inp, fontFamily: 'monospace', fontSize: 11 };

const lbl: React.CSSProperties = {
  fontSize: 11, fontWeight: 500, color: theme.colors.textMuted,
  textTransform: 'uppercase', letterSpacing: '0.04em',
  display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3,
};
const sectionHead: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, marginBottom: 12, color: theme.colors.orange,
};
const sectionDivider: React.CSSProperties = { marginBottom: 20 };

function buildInitialData(existing: ApiClient | null): OnboardClientFormData {
  if (!existing) {
    return {
      clientName: '', clientEmail: '', contactName: '', phone: '',
      qbCustomerName: '', staxCustomerId: '', paymentTerms: 'Net 30',
      freeStorageDays: '0', discountStoragePct: '0', discountServicesPct: '0',
      enableReceivingBilling: true, enableShipmentEmail: true,
      enableNotifications: true, autoInspection: true, separateBySidemark: false, autoCharge: false,
      active: true, parentClient: '', importInventoryUrl: '', notes: '', shipmentNote: '',
      spreadsheetId: '', folderId: '', photosFolderId: '', invoiceFolderId: '', webAppUrl: '',
    };
  }
  return {
    clientName: existing.name,
    clientEmail: existing.email,
    contactName: existing.contactName || '',
    phone: existing.phone || '',
    qbCustomerName: existing.qbCustomerName || '',
    staxCustomerId: existing.staxCustomerId || '',
    paymentTerms: existing.paymentTerms || 'Net 30',
    freeStorageDays: String(existing.freeStorageDays ?? 0),
    discountStoragePct: String(existing.discountStoragePct ?? 0),
    discountServicesPct: String(existing.discountServicesPct ?? 0),
    enableReceivingBilling: existing.enableReceivingBilling !== false,
    enableShipmentEmail: existing.enableShipmentEmail !== false,
    enableNotifications: existing.enableNotifications !== false,
    autoInspection: existing.autoInspection !== false,
    separateBySidemark: existing.separateBySidemark === true,
    autoCharge: existing.autoCharge === true,
    active: existing.active !== false,
    parentClient: existing.parentClient || '',
    importInventoryUrl: '',
    notes: existing.notes || '',
    shipmentNote: existing.shipmentNote || '',
    spreadsheetId: existing.spreadsheetId || '',
    folderId: existing.folderId || '',
    photosFolderId: existing.photosFolderId || '',
    invoiceFolderId: existing.invoiceFolderId || '',
    webAppUrl: existing.webAppUrl || '',
  };
}

export function OnboardClientModal({ mode = 'create', existingClient = null, allClients = [], onClose, onSubmit, initialData }: Props) {
  const isEdit = mode === 'edit';
  const [data, setData] = useState<OnboardClientFormData>(() => {
    const base = buildInitialData(existingClient);
    // Apply create-mode prefill (e.g. from a client_intakes row) on top
    // of the blank defaults. Edit mode always wins over initialData so
    // an operator can't accidentally clobber an existing client.
    return isEdit || !initialData ? base : { ...base, ...initialData };
  });

  // Session 70 fix #2 — CB-sourced payment terms (operator-maintained list
  // matching QuickBooks). Falls back to the legacy 6 options if the endpoint
  // is unreachable or the Payment_Terms tab is empty.
  const { terms: paymentTermsList } = usePaymentTerms();
  const paymentTermsOptions = paymentTermsList.length > 0
    ? paymentTermsList
    : ['Net 15', 'Net 30', 'Net 45', 'Net 60', 'Due on Receipt', 'CC ON FILE'];

  // Submit lifecycle state — modal owns this, parent just resolves the promise
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitWarnings, setSubmitWarnings] = useState<string[]>([]);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const phaseTimerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  const phases = isEdit ? EDIT_PHASES : ONBOARD_PHASES;
  const currentPhase = phases[phaseIdx] || phases[phases.length - 1];
  // Estimated total seconds — used to compute progress bar fill during unknown-duration wait
  const estimatedTotalSec = phases[phases.length - 1].minSec + (isEdit ? 5 : 20);
  const progressPct = Math.min(95, (elapsedSec / estimatedTotalSec) * 100);

  // Advance phase timer while submitting
  useEffect(() => {
    if (!submitting) {
      if (phaseTimerRef.current) {
        clearInterval(phaseTimerRef.current);
        phaseTimerRef.current = null;
      }
      return;
    }
    startTimeRef.current = Date.now();
    setElapsedSec(0);
    setPhaseIdx(0);

    phaseTimerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedSec(elapsed);
      // Find the latest phase whose minSec we've passed
      let latestPhase = 0;
      for (let i = 0; i < phases.length; i++) {
        if (elapsed >= phases[i].minSec) latestPhase = i;
      }
      setPhaseIdx(latestPhase);
    }, 500);

    return () => {
      if (phaseTimerRef.current) {
        clearInterval(phaseTimerRef.current);
        phaseTimerRef.current = null;
      }
    };
  }, [submitting, phases]);

  const set = (key: keyof OnboardClientFormData, val: string | boolean) =>
    setData(prev => ({ ...prev, [key]: val }));

  const canSubmit = data.clientName.trim() && data.clientEmail.trim();

  async function handleSubmitClick() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitWarnings([]);
    setSubmitSuccess(null);

    try {
      const result = await onSubmit(data);
      if (result.ok) {
        setSubmitSuccess(result.successMessage || (isEdit ? 'Client updated successfully' : 'Client onboarded successfully'));
        if (result.warnings && result.warnings.length > 0) {
          setSubmitWarnings(result.warnings);
        }
        // Auto-close after showing success — but only if there are no warnings
        // (warnings deserve a manual read before the modal goes away)
        if (!result.warnings || result.warnings.length === 0) {
          setTimeout(() => onClose(), 1800);
        }
      } else {
        setSubmitError(result.error || 'Operation failed');
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const toggleStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
    border: `1px solid ${active ? theme.colors.orange : theme.colors.border}`,
    background: active ? theme.colors.orangeLight : '#fff',
    fontSize: 12, fontWeight: 500,
    color: active ? theme.colors.orange : theme.colors.textSecondary,
    transition: 'all 0.15s',
  });

  const toggleDot = (active: boolean) => (
    <div style={{
      width: 32, height: 18, borderRadius: 9, background: active ? theme.colors.orange : theme.colors.border,
      position: 'relative', flexShrink: 0, transition: 'background 0.15s',
    }}>
      <div style={{
        position: 'absolute', top: 2, left: active ? 16 : 2, width: 14, height: 14,
        borderRadius: '50%', background: '#fff', transition: 'left 0.15s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </div>
  );

  // Block backdrop close during submit — prevents accidental form loss
  const handleBackdropClick = () => {
    if (submitting) return;
    onClose();
  };

  return (
    <>
      <div onClick={handleBackdropClick} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 200 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 680, maxWidth: '96vw', maxHeight: '92vh',
        background: '#fff', borderRadius: 20, boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
        zIndex: 201, display: 'flex', flexDirection: 'column', fontFamily: theme.typography.fontFamily,
        overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {isEdit ? <Edit2 size={18} color={theme.colors.orange} /> : <Users size={18} color={theme.colors.orange} />}
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {isEdit ? `Edit Client — ${data.clientName}` : 'Onboard New Client'}
              </div>
              <div style={{ fontSize: 12, color: theme.colors.textMuted }}>
                {isEdit
                  ? 'Update client settings. Changes sync to their inventory sheet.'
                  : 'Creates inventory sheet, Drive folders, and all configurations'}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted }}><X size={18} /></button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

          {/* Client Info */}
          <div style={sectionDivider}>
            <div style={sectionHead}>Client Information</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={lbl}>
                  <span>Client Name *</span>
                  <InfoTooltip text="The client's business name as it should appear on invoices and emails. This is the primary name used throughout the system." />
                </label>
                <input value={data.clientName} onChange={e => set('clientName', e.target.value)}
                  placeholder="e.g., Harper Design Co" style={inp} />
              </div>
              <div>
                <label style={lbl}>
                  <span>Client Email *</span>
                  <InfoTooltip text="Main contact email for this client. Shipment confirmations, invoices, and automated notifications are sent here. You can separate multiple addresses with commas." />
                </label>
                <input type="email" value={data.clientEmail} onChange={e => set('clientEmail', e.target.value)}
                  placeholder="billing@client.com" style={inp} />
              </div>
              <div>
                <label style={lbl}>
                  <span>Contact Name</span>
                  <InfoTooltip text="Name of the primary contact person at the client (optional). Shown on invoices and welcome emails." />
                </label>
                <input value={data.contactName} onChange={e => set('contactName', e.target.value)}
                  placeholder="Primary contact" style={inp} />
              </div>
              <div>
                <label style={lbl}>
                  <span>Phone</span>
                  <InfoTooltip text="Main phone number for the client (optional). For your records only — not used by the system." />
                </label>
                <input value={data.phone} onChange={e => set('phone', e.target.value)}
                  placeholder="206-555-0100" style={inp} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>
                  <span>Parent Account (optional)</span>
                  <InfoTooltip text="If this client is a sub-account under a larger parent company, pick the parent here. Parent users will be able to see all of their children's inventory. Leave blank for standalone clients." />
                </label>
                <AutocompleteSelect
                  value={data.parentClient}
                  onChange={v => set('parentClient', v)}
                  placeholder="None — standalone account"
                  options={[{ value: '', label: 'None — standalone account' }, ...allClients
                    .filter(c => c.name !== data.clientName)
                    .map(c => ({ value: c.name, label: c.name }))]}
                  style={{ width: '100%' }}
                />
                <div style={{ fontSize: 10, color: theme.colors.textMuted, marginTop: 3 }}>
                  If set, the parent account user can see this client&apos;s inventory alongside their own.
                </div>
              </div>
            </div>
          </div>

          {/* Billing Config */}
          <div style={sectionDivider}>
            <div style={sectionHead}>Billing Configuration</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={lbl}>
                  <span>QuickBooks Customer Name</span>
                  <InfoTooltip text="The exact customer name as it appears in QuickBooks. This must match character-for-character, or the QuickBooks IIF export won't link invoices to the right customer. Copy it directly from QuickBooks." />
                </label>
                <input value={data.qbCustomerName} onChange={e => set('qbCustomerName', e.target.value)}
                  placeholder="Must match QB exactly" style={inp} />
              </div>
              <div>
                <label style={lbl}>
                  <span>Payment Terms</span>
                  <InfoTooltip text="How long the client has to pay an invoice after it's sent. Shown on the invoice PDF. 'Due on Receipt' means payment is expected immediately; 'CC ON FILE' means we'll auto-charge their card on file." />
                </label>
                <select value={data.paymentTerms} onChange={e => set('paymentTerms', e.target.value)}
                  style={{ ...inp, cursor: 'pointer' }}>
                  {/* Existing value not in the list (e.g., a custom term set
                      elsewhere) should stay visible while the operator edits. */}
                  {data.paymentTerms && !paymentTermsOptions.includes(data.paymentTerms) && (
                    <option value={data.paymentTerms}>{data.paymentTerms}</option>
                  )}
                  {paymentTermsOptions.map(term => (
                    <option key={term} value={term}>{term}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={lbl}>
                  <span>Free Storage Days</span>
                  <InfoTooltip text="Number of days after an item is received that storage is free. Storage charges only start accruing after this grace period. Set to 0 for no free days." />
                </label>
                <input type="number" value={data.freeStorageDays} onChange={e => set('freeStorageDays', e.target.value)} style={inp} />
              </div>
              <div>
                <label style={lbl}>
                  <span>Storage Discount %</span>
                  <InfoTooltip text="Adjusts the storage rate for this client. Enter a NEGATIVE number for a discount (e.g. -10 = 10% off storage) or a POSITIVE number for a surcharge (e.g. 10 = 10% more than standard). Range: -10 to +10. Leave at 0 for standard rates." />
                </label>
                <input type="number" min={-100} max={100} step={1} value={data.discountStoragePct} onChange={e => set('discountStoragePct', e.target.value)}
                  placeholder="0" style={inp} />
                <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>-10 to +10. Negative = discount (-10 = -10%), positive = surcharge (+10 = +10%).</div>
              </div>
              <div>
                <label style={lbl}>
                  <span>Services Discount %</span>
                  <InfoTooltip text="Adjusts service rates (inspection, assembly, will call, repairs, etc.) for this client. Enter a NEGATIVE number for a discount (e.g. -10 = 10% off) or a POSITIVE number for a surcharge (e.g. 10 = 10% more). Range: -10 to +10. Leave at 0 for standard rates." />
                </label>
                <input type="number" min={-100} max={100} step={1} value={data.discountServicesPct} onChange={e => set('discountServicesPct', e.target.value)}
                  placeholder="0" style={inp} />
                <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>-10 to +10. Negative = discount (-10 = -10%), positive = surcharge (+10 = +10%).</div>
              </div>
              <div>
                <label style={lbl}>
                  <span>Stax Customer ID</span>
                  <InfoTooltip text="The client's customer ID from the Stax (Fattmerchant) payment system. Used to auto-charge the card on file and link payments to this client. Find it in the Stax dashboard under Customers — it's a long letter/number string. Leave blank if the client doesn't pay through Stax." />
                </label>
                <input value={data.staxCustomerId} onChange={e => set('staxCustomerId', e.target.value)}
                  placeholder="From Stax dashboard" style={inpMono} />
              </div>
            </div>
          </div>

          {/* Feature Toggles */}
          <div style={sectionDivider}>
            <div style={sectionHead}>Feature Settings</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {([
                { key: 'enableReceivingBilling', label: 'Receiving Billing', desc: 'Auto-create RCVG charge on receive', tip: 'When ON, a receiving charge (RCVG) is automatically added to the client\'s bill every time a shipment is completed. Turn OFF for clients who get free receiving.' },
                { key: 'enableShipmentEmail', label: 'Shipment Emails', desc: 'Send receiving email to client', tip: 'When ON, the client automatically receives a shipment confirmation email (with photos and PDF) whenever a shipment is completed. Turn OFF to keep receiving silent.' },
                { key: 'enableNotifications', label: 'Notifications', desc: 'Status update emails', tip: 'When ON, the client receives status update emails for tasks, repairs, and will calls (inspection complete, repair quote, will call ready, etc.). Turn OFF to suppress all status notifications.' },
                { key: 'autoInspection', label: 'Auto Inspection', desc: 'Auto-create INSP task on receive', tip: 'When ON, every item received automatically gets an inspection task created. Use for clients who require inspection on all incoming items. Leave OFF to create inspections manually as needed.' },
                { key: 'separateBySidemark', label: 'Separate by Sidemark', desc: 'Invoice lines grouped by sidemark', tip: 'When ON, invoices are split into separate invoice documents per sidemark (one invoice per project/room). When OFF, all charges go on a single consolidated invoice.' },
                { key: 'autoCharge', label: 'Auto Charge', desc: 'Auto-charge payments on due date', tip: 'When ON, Stax invoices for this client are automatically charged on their due date by the daily auto-charge trigger (9 AM Pacific). When OFF, invoices must be charged manually from the Payments page. Individual invoices can still override this setting.' },
              ] as const).map(f => (
                <div key={f.key} onClick={() => set(f.key, !data[f.key])} style={toggleStyle(data[f.key])}>
                  <div>
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                      {f.label}
                      <InfoTooltip text={f.tip} />
                    </div>
                    <div style={{ fontSize: 10, opacity: 0.75, marginTop: 1 }}>{f.desc}</div>
                  </div>
                  {toggleDot(data[f.key])}
                </div>
              ))}
              {isEdit && (
                <div onClick={() => set('active', !data.active)} style={toggleStyle(data.active)}>
                  <div>
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                      Active
                      <InfoTooltip text="When ON, this client is active and appears in dropdowns and reports. Turn OFF to archive an inactive client without deleting their data." />
                    </div>
                    <div style={{ fontSize: 10, opacity: 0.75, marginTop: 1 }}>Disable to hide from active list</div>
                  </div>
                  {toggleDot(data.active)}
                </div>
              )}
            </div>
          </div>

          {/* Edit mode: Generated IDs */}
          {isEdit && (
            <div style={sectionDivider}>
              <div style={{ ...sectionHead, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sheet size={14} /> Generated IDs
                <span style={{ fontSize: 10, fontWeight: 400, color: theme.colors.textMuted, marginLeft: 4 }}>
                  Auto-filled during onboarding — edit only if IDs changed
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
                <div>
                  <label style={lbl}>
                    <span>Client Spreadsheet ID</span>
                    <InfoTooltip text="The Google Sheets ID of this client's inventory workbook — automatically created during onboarding. Click the link button to open it in Google Sheets. Don't edit this manually unless the sheet was moved or replaced." />
                  </label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input value={data.spreadsheetId} onChange={e => set('spreadsheetId', e.target.value)}
                      placeholder="Auto-generated during onboard" style={{ ...inpMono, flex: 1 }} />
                    {data.spreadsheetId && (
                      <a href={`https://docs.google.com/spreadsheets/d/${data.spreadsheetId}`}
                        target="_blank" rel="noopener noreferrer"
                        style={{ padding: '9px 10px', border: `1px solid ${theme.colors.border}`, borderRadius: 8, color: theme.colors.textMuted, display: 'flex', alignItems: 'center', textDecoration: 'none' }}
                        title="Open spreadsheet">
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                </div>
                <div>
                <label style={lbl}>
                  <span>Web App URL</span>
                  <InfoTooltip text="The deployed Web App URL for this client's bound Apps Script. Used by maintenance functions (Update Headers, Install Triggers). Auto-populated by npm run sync-web-urls, or paste manually from the client's Apps Script deployment." />
                </label>
                <input value={data.webAppUrl || ''} onChange={e => set('webAppUrl', e.target.value)}
                  placeholder="https://script.google.com/macros/s/.../exec" style={{ ...inpMono }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={lbl}>
                      <span>Client Folder ID</span>
                      <InfoTooltip text="Google Drive folder where all of this client's documents are stored (shipments, tasks, repairs, will calls). Auto-created during onboarding." />
                    </label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input value={data.folderId} onChange={e => set('folderId', e.target.value)}
                        placeholder="Drive folder ID" style={{ ...inpMono, flex: 1 }} />
                      {data.folderId && (
                        <a href={`https://drive.google.com/drive/folders/${data.folderId}`}
                          target="_blank" rel="noopener noreferrer"
                          style={{ padding: '9px 10px', border: `1px solid ${theme.colors.border}`, borderRadius: 8, color: theme.colors.textMuted, display: 'flex', alignItems: 'center', textDecoration: 'none' }}
                          title="Open folder">
                          <FolderOpen size={13} />
                        </a>
                      )}
                    </div>
                  </div>
                  <div>
                    <label style={lbl}>
                      <span>Photos Folder ID</span>
                      <InfoTooltip text="Google Drive subfolder where receiving photos are uploaded when shipments arrive. Auto-created during onboarding." />
                    </label>
                    <input value={data.photosFolderId} onChange={e => set('photosFolderId', e.target.value)}
                      placeholder="Photos subfolder ID" style={inpMono} />
                  </div>
                  <div>
                    <label style={lbl}>
                      <span>Invoice Folder ID</span>
                      <InfoTooltip text="Google Drive subfolder where invoice PDFs are saved for this client. Auto-created during onboarding." />
                    </label>
                    <input value={data.invoiceFolderId} onChange={e => set('invoiceFolderId', e.target.value)}
                      placeholder="Invoices subfolder ID" style={inpMono} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Edit mode: Client Documents — the shared documents module
              scoped to (context_type='client', context_id=spreadsheetId).
              Holds intake originals copied over at activation plus any
              ad-hoc renewals (COI, updated W-9, parent/child addenda). */}
          {isEdit && data.spreadsheetId && (
            <div style={sectionDivider}>
              <div style={{ ...sectionHead, display: 'flex', alignItems: 'center', gap: 6 }}>
                <FileText size={14} /> Client Documents
                <span style={{ fontSize: 10, fontWeight: 400, color: theme.colors.textMuted, marginLeft: 4 }}>
                  Intake packet + ongoing renewals
                </span>
                {data.clientEmail && (
                  <a
                    href={`#/intakes?email=${encodeURIComponent(data.clientEmail)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      marginLeft: 'auto',
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
                      padding: '4px 10px', borderRadius: 100,
                      background: '#fff', color: theme.colors.textSecondary,
                      border: `1px solid ${theme.colors.border}`,
                      textDecoration: 'none',
                    }}
                    title="Open this client's original intake submission"
                  >
                    <ExternalLink size={11} /> View Original Intake
                  </a>
                )}
              </div>
              <ClientDocumentsBlock clientSheetId={data.spreadsheetId} />
            </div>
          )}

          {/* Optional */}
          <div style={sectionDivider}>
            <div style={sectionHead}>Optional</div>
            {!isEdit && (
              <div style={{ marginBottom: 12 }}>
                <label style={lbl}>
                  <span>Import Inventory URL (Google Sheet URL)</span>
                  <InfoTooltip text="If you're onboarding a client who already has existing inventory in an old Google Sheet, paste the URL here. After creation, use the Import Inventory tool inside the new client sheet to pull the data over. Leave blank for brand-new clients." />
                </label>
                <input value={data.importInventoryUrl} onChange={e => set('importInventoryUrl', e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..." style={inpMono} />
              </div>
            )}
            <div>
              <label style={lbl}>
                <span>Notes</span>
                <InfoTooltip text="Internal notes about this client — billing quirks, contact preferences, special handling, anything staff should know. Not visible to the client." />
              </label>
              <textarea value={data.notes} onChange={e => set('notes', e.target.value)}
                rows={2} placeholder="Internal notes about this client..."
                style={{ ...inp, resize: 'vertical' }} />
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={lbl}>
                <span>Shipment Note (shown on Receiving)</span>
                <InfoTooltip text="Shown as a prominent amber banner on the Receiving page every time this client is selected. Use for strict receiving instructions (e.g. 'Open all boxes with driver present')." />
              </label>
              <textarea value={data.shipmentNote} onChange={e => set('shipmentNote', e.target.value)}
                rows={2} placeholder="e.g. Open all boxes with driver present. No exceptions."
                style={{ ...inp, resize: 'vertical' }} />
            </div>
          </div>

          {/* Info box */}
          {!isEdit ? (
            <div style={{ padding: 12, background: '#FFFBF5', border: '1px solid #FED7AA', borderRadius: 8, fontSize: 11, color: '#92400E', lineHeight: 1.6 }}>
              <strong>When you click "Run Onboard":</strong><br />
              1. Creates a new client inventory spreadsheet from template<br />
              2. Creates Google Drive folders (Photos, Invoices)<br />
              3. Populates all Settings on the new sheet<br />
              4. Adds client row to Consolidated Billing Clients tab<br />
              5. Imports inventory if URL provided
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, padding: 12, background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 8, fontSize: 11, color: '#0C4A6E', lineHeight: 1.5 }}>
              <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <strong>Sync to sheet:</strong> Saving will update the Clients tab in Consolidated Billing AND push all settings to the client&apos;s inventory spreadsheet Settings tab.
              </div>
            </div>
          )}
        </div>

        {/* Submit state overlay — covers form during submit/error/success */}
        {(submitting || submitError || submitSuccess) && (
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.97)',
            zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: 24, gap: 16,
          }}>
            {submitting && (
              <>
                <Loader2 size={36} style={{ animation: 'spin 1s linear infinite', color: theme.colors.orange }} />
                <div style={{ fontSize: 15, fontWeight: 600, color: theme.colors.textPrimary, textAlign: 'center' }}>
                  {isEdit ? 'Updating client…' : 'Onboarding client…'}
                </div>
                <div style={{ fontSize: 13, color: theme.colors.textSecondary, textAlign: 'center', minHeight: 18 }}>
                  {currentPhase.label}
                </div>
                <div style={{ fontSize: 11, color: theme.colors.textMuted }}>
                  {elapsedSec}s elapsed
                </div>
                {/* Animated progress bar */}
                <div style={{ width: 320, maxWidth: '90%', height: 6, background: '#F3F4F6', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    width: `${progressPct}%`, height: '100%', background: theme.colors.orange,
                    transition: 'width 0.5s ease',
                  }} />
                </div>
                <div style={{ fontSize: 11, color: theme.colors.textMuted, textAlign: 'center', maxWidth: 360, marginTop: 4 }}>
                  This takes {isEdit ? '5-15 seconds' : '30-60 seconds'}. Please don't close this window.
                </div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </>
            )}

            {submitSuccess && (
              <>
                <CheckCircle size={44} color="#15803D" />
                <div style={{ fontSize: 16, fontWeight: 700, color: '#15803D', textAlign: 'center' }}>
                  {submitSuccess}
                </div>
                {submitWarnings.length > 0 && (
                  <div style={{ background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 10, padding: 14, maxWidth: 440, width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#92400E', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                      <AlertTriangle size={14} /> Warnings ({submitWarnings.length})
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: '#92400E', lineHeight: 1.5 }}>
                      {submitWarnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                    <button
                      onClick={onClose}
                      style={{ marginTop: 10, padding: '6px 14px', fontSize: 12, fontWeight: 600, background: '#92400E', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      Close
                    </button>
                  </div>
                )}
                {submitWarnings.length === 0 && (
                  <div style={{ fontSize: 11, color: theme.colors.textMuted }}>Closing…</div>
                )}
              </>
            )}

            {submitError && (
              <>
                <AlertTriangle size={44} color="#DC2626" />
                <div style={{ fontSize: 15, fontWeight: 700, color: '#991B1B', textAlign: 'center' }}>
                  {isEdit ? 'Update failed' : 'Onboarding failed'}
                </div>
                <div style={{ fontSize: 12, color: '#991B1B', textAlign: 'center', maxWidth: 440, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 12, lineHeight: 1.5 }}>
                  {submitError}
                </div>
                <div style={{ fontSize: 11, color: theme.colors.textMuted, textAlign: 'center', maxWidth: 400 }}>
                  Your form data has been preserved. Fix the issue and click Retry, or Cancel to discard.
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                  <button
                    onClick={() => { setSubmitError(null); }}
                    style={{ padding: '9px 18px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}
                  >
                    Back to Form
                  </button>
                  <button
                    onClick={handleSubmitClick}
                    style={{ padding: '9px 24px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 8, background: theme.colors.orange, color: '#fff', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <Check size={15} /> Retry
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{ padding: '9px 18px', fontSize: 13, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: submitting ? 'not-allowed' : 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary, opacity: submitting ? 0.5 : 1 }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmitClick}
            disabled={!canSubmit || submitting}
            style={{ padding: '9px 24px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 8, background: (!canSubmit || submitting) ? theme.colors.border : theme.colors.orange, color: (!canSubmit || submitting) ? theme.colors.textMuted : '#fff', cursor: (!canSubmit || submitting) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {submitting ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={15} />}
            {submitting ? (isEdit ? 'Saving…' : 'Onboarding…') : (isEdit ? 'Save & Sync' : 'Run Onboard')}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * ClientDocumentsBlock — thin wrapper around the shared documents
 * module, scoped to context_type='client' + context_id=spreadsheetId.
 *
 * Reuses DocumentUploadButton (arbitrary file picker) + DocumentList
 * (renders every row with soft-delete + signed-URL download). Because
 * uploads go through useDocuments.uploadDocument, files land in the
 * same bucket as entity docs — documents/{tenant}/client-{id}/filename —
 * and RLS automatically scopes reads to the right audience (staff/admin
 * everything, client-role users only their own tenant).
 */
function ClientDocumentsBlock({ clientSheetId }: { clientSheetId: string }) {
  const { documents, loading, uploadDocument } = useDocuments({
    contextType: 'client',
    contextId: clientSheetId,
    tenantId: clientSheetId,
  });
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleUpload = async (files: File[]) => {
    setUploading(true); setErr(null);
    try {
      for (const f of files) {
        const res = await uploadDocument(f);
        if (!res) { setErr(`Upload failed for ${f.name}`); break; }
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ background: theme.colors.bgSubtle, borderRadius: 10, padding: 14 }}>
      <div style={{ marginBottom: 10 }}>
        <DocumentUploadButton onUpload={handleUpload} uploading={uploading} compact />
      </div>
      {err && (
        <div role="alert" style={{
          padding: '8px 12px', marginBottom: 10,
          background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C',
          borderRadius: 8, fontSize: 12,
        }}>
          <AlertTriangle size={12} style={{ marginRight: 6, verticalAlign: '-2px' }} /> {err}
        </div>
      )}
      {loading ? (
        <div style={{ padding: 12, textAlign: 'center', color: theme.colors.textMuted, fontSize: 12 }}>Loading…</div>
      ) : documents.length === 0 ? (
        <div style={{ padding: 12, textAlign: 'center', color: theme.colors.textMuted, fontSize: 12 }}>
          No documents yet. The original intake packet lands here when a client is activated from an intake; admins can also upload renewals, COI, tax forms, etc.
        </div>
      ) : (
        <DocumentList contextType="client" contextId={clientSheetId} tenantId={clientSheetId} />
      )}
    </div>
  );
}

