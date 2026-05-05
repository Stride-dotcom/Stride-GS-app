/**
 * IntakesPanel — full intakes dashboard extracted from pages/Intakes.tsx
 * so it can be rendered inside Settings → Clients → Intakes sub-tab.
 *
 * Key addition over the original Intakes page:
 *   After GenerateLinkBlock.handleGenerate() resolves with a fresh link
 *   AND the admin filled in a prospect email, the panel auto-opens
 *   IntakeEmailModal pre-filled with the CLIENT_INTAKE_INVITE template
 *   (substituted tokens). The admin can edit subject and send directly
 *   from the dialog, or just copy the link and close.
 */
import { useEffect, useMemo, useState } from 'react';
import { Copy, CheckCircle2, Link2, Plus, Trash2, FileText, UserPlus, Eye, X, AlertTriangle, ExternalLink, Loader2, Mail } from 'lucide-react';
import { theme } from '../../styles/theme';
import { fmtDateTime } from '../../lib/constants';
import { useIntakeAdmin, copyIntakeDocsToClient, seedClientInsuranceFromIntake, type IntakeRow, type IntakeLinkRow } from '../../hooks/useIntakeAdmin';
// Reference for future wiring — keep the helper in the import graph
// without tripping noUnusedLocals.
void copyIntakeDocsToClient;
import { OnboardClientModal, type OnboardClientFormData, type OnboardSubmitResult, type PendingIntakeOverride } from '../shared/OnboardClientModal';
import { IntakeEmailModal } from '../shared/IntakeEmailModal';
import { postOnboardClient, apiFetch } from '../../lib/api';
import type { EmailTemplate } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { sendEmail } from '../../lib/email';
import { useAuth } from '../../contexts/AuthContext';
import { useClients } from '../../hooks/useClients';
import { fetchAdminIntakeDrafts, type AdminIntakeDraft } from '../../hooks/useClientIntake';

// v38.179.0 — 'drafts' added so the operator can see in-progress intakes
// (rows in client_intake_drafts that haven't been submitted yet). The
// drafts view is a separate list+detail pane; submitted intakes live in
// client_intakes and use the existing chips.
type StatusFilter = IntakeRow['status'] | 'all' | 'drafts';

const PAGE_FONT = theme.typography.fontFamily;
const BASE_INTAKE_URL = 'https://www.mystridehub.com/#/intake/';

export function IntakesPanel() {
  const { intakes, links, loading, error, generateLink, revokeLink, updateStatus, getFileSignedUrl } = useIntakeAdmin();
  // v2 — pull the canonical clients list so refresh-mode intakes can resolve
  // their existing client record + open the modal in edit mode (rather than
  // the scary "Onboard New Client" view that suggests duplicate creation).
  // includeInactive=true so reactivation flows still work.
  const { apiClients } = useClients(true, true);
  const [filter, setFilter] = useState<StatusFilter>('pending');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [onboardOpen, setOnboardOpen] = useState(false);

  // Deep-link handler: `/#/intakes?email=<addr>` or `?subtab=intakes&email=<addr>`
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const match = window.location.hash.match(/[?&]email=([^&]+)/);
    const wantedEmail = match ? decodeURIComponent(match[1]).toLowerCase() : '';
    if (!wantedEmail || intakes.length === 0) return;
    const hit = intakes.find(i => i.email.toLowerCase() === wantedEmail);
    if (hit) {
      setFilter('all');
      setSelectedId(hit.id);
    }
  }, [intakes]);

  const filtered = useMemo(() => {
    if (filter === 'all') return intakes;
    return intakes.filter(i => i.status === filter);
  }, [intakes, filter]);

  const selected = useMemo(
    () => selectedId ? intakes.find(i => i.id === selectedId) ?? null : null,
    [intakes, selectedId]
  );

  if (filter !== 'drafts' && !selectedId && filtered.length > 0) {
    setTimeout(() => setSelectedId(filtered[0].id), 0);
  }

  // v38.179.0 — Drafts list (in-progress intakes that haven't been submitted).
  // Fetched lazily when the filter is set to 'drafts' so we don't pay the
  // Supabase round-trip on every panel render. Realtime would be nice
  // (live "Jenny is at step 4 right now…") but a manual refresh button
  // covers the common case without subscribing.
  const [drafts, setDrafts] = useState<AdminIntakeDraft[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const [selectedDraftLinkId, setSelectedDraftLinkId] = useState<string | null>(null);
  const refreshDrafts = async () => {
    setDraftsLoading(true);
    try {
      const rows = await fetchAdminIntakeDrafts();
      setDrafts(rows);
      setDraftsLoaded(true);
    } finally {
      setDraftsLoading(false);
    }
  };
  useEffect(() => {
    if (filter === 'drafts' && !draftsLoaded) void refreshDrafts();
  }, [filter, draftsLoaded]);

  if (filter === 'drafts' && !selectedDraftLinkId && drafts.length > 0) {
    setTimeout(() => setSelectedDraftLinkId(drafts[0].linkId), 0);
  }

  const counts = useMemo(() => ({
    all:      intakes.length,
    pending:  intakes.filter(i => i.status === 'pending').length,
    reviewed: intakes.filter(i => i.status === 'reviewed').length,
    activated:intakes.filter(i => i.status === 'activated').length,
    rejected: intakes.filter(i => i.status === 'rejected').length,
    drafts:   drafts.length,
  }), [intakes, drafts]);

  const handleCreateClient = async (formData: OnboardClientFormData): Promise<OnboardSubmitResult> => {
    // Refresh-mode activation: the intake was submitted via a link tagged
    // with client_spreadsheet_id, so we MERGE into the existing clients
    // row instead of running postOnboardClient (which would error on
    // duplicate folder/sheet creation). The existing-client path:
    //   1. Update clients row directly via Supabase (tax + cert fields,
    //      notification_contacts replace).
    //   2. Copy the new resale cert from the documents bucket into the
    //      resale-certs bucket; update clients.resale_cert_url.
    //   3. Mark the intake activated.
    const isRefresh = !!(selected && (selected as IntakeRow & { clientSpreadsheetId?: string }).clientSpreadsheetId);
    if (isRefresh && selected) {
      const refreshSheetId = (selected as IntakeRow & { clientSpreadsheetId?: string }).clientSpreadsheetId!;
      const warnings: string[] = [];
      try {
        // Defensive: only include notification_contacts in the update when
        // the submitted list is non-empty. An empty list almost certainly
        // means the client clicked through without touching the section
        // (pre-fill might have returned nothing for legacy rows). Writing
        // [] would clobber the column; skipping the field leaves whatever
        // was there. Note: actual warehouse alerts live in the client
        // sheet's Settings.NOTIFICATION_EMAILS — that path is untouched
        // either way.
        const submittedContacts = selected.notificationContacts ?? [];
        const updatePayload: Record<string, unknown> = {
          name:           formData.clientName,
          email:          formData.clientEmail,
          contact_name:   formData.contactName,
          phone:          formData.phone || null,
          qb_customer_name: formData.qbCustomerName || null,
          payment_terms:  formData.paymentTerms,
          auto_inspection: formData.autoInspection,
          auto_charge:     formData.autoCharge,
          // Tax / cert (matches handleClientSubmit's create-mode write
          // in Settings.tsx so the data flow is identical between
          // create and refresh activations).
          tax_exempt:           formData.taxExempt !== false,
          tax_exempt_reason:    formData.taxExemptReason || 'Resale',
          resale_cert_expires:  formData.resaleCertExpires || null,
        };
        if (submittedContacts.length > 0) {
          updatePayload.notification_contacts = submittedContacts;
        } else {
          warnings.push('Notification contacts left unchanged (empty list submitted).');
        }
        const { error: upErr } = await supabase
          .from('clients')
          .update(updatePayload)
          .eq('spreadsheet_id', refreshSheetId);
        if (upErr) {
          return { ok: false, error: 'Update failed: ' + upErr.message };
        }
        warnings.push(`Updated existing client "${formData.clientName}" from refresh intake.`);

        // Resale cert: same copy-to-resale-certs path as the new-client
        // activation flow below.
        if (selected.taxExempt !== false && selected.resaleCertPath) {
          try {
            const sourceBase = selected.resaleCertPath.split('/').pop() ?? `cert-${Date.now()}.pdf`;
            const certDestKey = `${refreshSheetId}/${Date.now()}-${sourceBase}`;
            const { error: copyErr } = await supabase.storage
              .from('documents')
              .copy(selected.resaleCertPath, certDestKey, { destinationBucket: 'resale-certs' });
            if (copyErr && !/already exists/i.test(copyErr.message)) {
              warnings.push(`Cert → resale-certs: ${copyErr.message}`);
            } else {
              const { data: signed } = await supabase.storage
                .from('resale-certs')
                .createSignedUrl(certDestKey, 60 * 60 * 24 * 365 * 10);
              if (signed?.signedUrl) {
                await supabase
                  .from('clients')
                  .update({
                    resale_cert_url: signed.signedUrl,
                    resale_cert_uploaded_at: new Date().toISOString(),
                  })
                  .eq('spreadsheet_id', refreshSheetId);
                warnings.push('New resale cert linked to client tax record.');
              }
            }
          } catch (e) {
            warnings.push(`Cert link error: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        await updateStatus(selected.id, 'activated');
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      return { ok: true, successMessage: `Client "${formData.clientName}" updated from refresh intake`, warnings };
    }

    // ── New-client activation (existing path) ────────────────────────
    const payload = {
      clientName:          formData.clientName,
      clientEmail:         formData.clientEmail,
      contactName:         formData.contactName,
      phone:               formData.phone,
      qbCustomerName:      formData.qbCustomerName,
      staxCustomerId:      formData.staxCustomerId,
      paymentTerms:        formData.paymentTerms,
      freeStorageDays:     Number(formData.freeStorageDays) || 0,
      discountStoragePct:  Number(formData.discountStoragePct) || 0,
      discountServicesPct: Number(formData.discountServicesPct) || 0,
      enableReceivingBilling: formData.enableReceivingBilling,
      enableShipmentEmail:    formData.enableShipmentEmail,
      enableNotifications:    formData.enableNotifications,
      autoInspection:         formData.autoInspection,
      separateBySidemark:     formData.separateBySidemark,
      autoCharge:             formData.autoCharge,
      importInventoryUrl:     formData.importInventoryUrl,
      notes:                  formData.notes,
      shipmentNote:           formData.shipmentNote,
      parentClient:           formData.parentClient,
    };
    const res = await postOnboardClient(payload);
    if (!res.ok || !res.data?.success) {
      return { ok: false, error: res.error || res.data?.error || 'Onboard failed' };
    }
    const warnings: string[] = res.data.warnings ?? [];
    if (selected) {
      const newClientSheetId = res.data.clientSheetId;
      if (newClientSheetId) {
        try {
          const copyRes = await copyIntakeDocsToClient(selected, newClientSheetId);
          if (copyRes.copied > 0) {
            warnings.push(`Copied ${copyRes.copied} intake document${copyRes.copied === 1 ? '' : 's'} to client.`);
          }
          for (const f of copyRes.failures) {
            warnings.push(`Intake doc copy failed: ${f.path.split('/').pop()} — ${f.error}`);
          }
        } catch (e) {
          warnings.push(`Intake doc copy error: ${e instanceof Error ? e.message : String(e)}`);
        }

        // Copy the resale cert into the dedicated resale-certs bucket and
        // stamp the signed URL on the new client row. The intake bucket
        // copy above remains as audit trail; the client-facing cert lives
        // in resale-certs alongside any future re-uploads from the admin
        // edit flow.
        if (selected.taxExempt !== false && selected.resaleCertPath) {
          try {
            const sourceBase = selected.resaleCertPath.split('/').pop() ?? `cert-${Date.now()}.pdf`;
            const certDestKey = `${newClientSheetId}/${Date.now()}-${sourceBase}`;
            const { error: copyErr } = await supabase.storage
              .from('documents')
              .copy(selected.resaleCertPath, certDestKey, { destinationBucket: 'resale-certs' });
            if (copyErr && !/already exists/i.test(copyErr.message)) {
              warnings.push(`Resale cert → resale-certs bucket: ${copyErr.message}`);
            } else {
              const { data: signed } = await supabase.storage
                .from('resale-certs')
                .createSignedUrl(certDestKey, 60 * 60 * 24 * 365 * 10);
              if (signed?.signedUrl) {
                await supabase
                  .from('clients')
                  .update({
                    resale_cert_url: signed.signedUrl,
                    resale_cert_uploaded_at: new Date().toISOString(),
                  })
                  .eq('spreadsheet_id', newClientSheetId);
                warnings.push('Resale cert linked to client tax record.');
              }
            }
          } catch (e) {
            warnings.push(`Resale cert link error: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        // Seed the client_insurance row so the daily billing cron picks
        // the new client up on its next run (+30 days from today).
        try {
          const seedRes = await seedClientInsuranceFromIntake(selected, newClientSheetId, formData.clientName);
          if (seedRes.seeded) {
            warnings.push(`Insurance auto-billing activated — $${selected.insuranceDeclaredValue.toLocaleString()} declared.`);
          } else if (seedRes.error === 'declared_value_missing') {
            warnings.push(`Insurance: prospect chose Stride coverage but declared value was missing — set it up from the client settings Insurance card.`);
          } else if (seedRes.error) {
            warnings.push(`Insurance seed failed: ${seedRes.error}. Set up insurance manually from client settings.`);
          }
        } catch (e) {
          warnings.push(`Insurance seed error: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      await updateStatus(selected.id, 'activated');
    }
    return { ok: true, successMessage: 'Client created from intake', warnings };
  };

  const prefillFromIntake = (intake: IntakeRow): Partial<OnboardClientFormData> => ({
    clientName:   intake.businessName,
    clientEmail:  intake.email,
    contactName:  intake.contactName,
    phone:        intake.phone ?? '',
    // v38.160.0 — Carry the intake's Billing Contact section through to
    // the onboard modal. Previously the fields were collected at intake
    // but admin had to retype during onboard. Now they auto-populate.
    // handleClientSubmit's post-create Supabase update lands them on
    // clients.billing_* so the QBO push + invoice email paths use them.
    billingContactName: intake.billingContactName ?? '',
    billingEmail:       intake.billingEmail       ?? '',
    billingAddress:     intake.billingAddress     ?? '',
    qbCustomerName: intake.businessName,
    paymentTerms: 'Net 30',
    freeStorageDays: '0',
    autoCharge:   intake.paymentAuthorized,
    enableNotifications: true,
    // Carry the prospect's opt-in through to the client settings
    // toggle. Previously hardcoded to true regardless of intake; now
    // defaults to off unless they checked the box on Step 3.
    autoInspection: intake.autoInspect === true,
    // Forward the wholesale-exemption answer captured at intake. The
    // OnboardClientModal Tax & Resale section reads these defaults;
    // handleClientSubmit (Settings.tsx) writes them to clients table
    // post-create. Cert PDF is copied separately by copyIntakeDocsToClient.
    taxExempt:           intake.taxExempt !== false, // null → default to wholesale (most common); true → wholesale; false → end customer
    taxExemptReason:     intake.taxExemptReason || 'Resale',
    resaleCertExpires:   intake.resaleCertExpires || '',
    notes: [
      intake.notes,
      (intake.insuranceChoice === 'stride_coverage' || intake.insuranceChoice === 'eis_coverage')
        ? `Added to Stride policy${intake.insuranceDeclaredValue > 0 ? ` — declared $${intake.insuranceDeclaredValue.toLocaleString()}` : ''} ($30/mo per $10K declared value).`
        : null,
      intake.insuranceChoice === 'own_policy' ? "Client's own policy — collect COI." : null,
    ].filter(Boolean).join(' '),
  });

  return (
    <div style={{ fontFamily: PAGE_FONT }}>
      {/* Generate Link block */}
      <GenerateLinkBlock links={links} generateLink={generateLink} revokeLink={revokeLink} />

      {error && (
        <div role="alert" style={{
          padding: '10px 14px', margin: '12px 0',
          background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C',
          borderRadius: 10, fontSize: 13,
        }}>
          <AlertTriangle size={12} style={{ marginRight: 6, verticalAlign: '-1px' }} /> {error}
        </div>
      )}

      {/* Split view */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 360px) 1fr', gap: 16, marginTop: 16 }}>
        {/* Left — list */}
        <aside style={listShell}>
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${theme.colors.border}`, background: theme.colors.bgSubtle }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <FilterChip label="All"        n={counts.all}       active={filter === 'all'}       onClick={() => setFilter('all')} />
              <FilterChip label="Pending"    n={counts.pending}   active={filter === 'pending'}   onClick={() => setFilter('pending')}  accent="warning" />
              <FilterChip label="Reviewed"   n={counts.reviewed}  active={filter === 'reviewed'}  onClick={() => setFilter('reviewed')} />
              <FilterChip label="Activated"  n={counts.activated} active={filter === 'activated'} onClick={() => setFilter('activated')} accent="success" />
              <FilterChip label="Rejected"   n={counts.rejected}  active={filter === 'rejected'}  onClick={() => setFilter('rejected')}  accent="danger" />
              <FilterChip label="Drafts"     n={counts.drafts}    active={filter === 'drafts'}    onClick={() => setFilter('drafts')}    accent="info" />
            </div>
          </div>
          <div style={{ maxHeight: 560, overflowY: 'auto' }}>
            {filter === 'drafts' ? (
              draftsLoading ? (
                <div style={{ padding: 24, textAlign: 'center', color: theme.colors.textMuted, fontSize: 12 }}>Loading drafts…</div>
              ) : drafts.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: theme.colors.textMuted, fontSize: 12 }}>No drafts in progress.</div>
              ) : (
                drafts.map(d => (
                  <DraftListRow
                    key={d.linkId}
                    draft={d}
                    selected={selectedDraftLinkId === d.linkId}
                    onClick={() => setSelectedDraftLinkId(d.linkId)}
                  />
                ))
              )
            ) : loading ? (
              <div style={{ padding: 24, textAlign: 'center', color: theme.colors.textMuted, fontSize: 12 }}>Loading…</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: theme.colors.textMuted, fontSize: 12 }}>No intakes in this view.</div>
            ) : (
              filtered.map(i => (
                <IntakeListRow
                  key={i.id}
                  intake={i}
                  selected={selectedId === i.id}
                  onClick={() => setSelectedId(i.id)}
                />
              ))
            )}
          </div>
        </aside>

        {/* Right — review */}
        <main style={reviewShell}>
          {filter === 'drafts' ? (
            (() => {
              const selDraft = selectedDraftLinkId ? drafts.find(d => d.linkId === selectedDraftLinkId) ?? null : null;
              if (!selDraft) {
                return (
                  <div style={{ padding: 40, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>
                    {drafts.length === 0 ? 'No drafts to inspect.' : 'Select a draft to inspect.'}
                  </div>
                );
              }
              return <DraftSnapshot draft={selDraft} onRefresh={refreshDrafts} />;
            })()
          ) : selected ? (
            <IntakeReview
              intake={selected}
              onCreateClient={() => setOnboardOpen(true)}
              onMarkReviewed={() => updateStatus(selected.id, 'reviewed')}
              onReject={(reason) => updateStatus(selected.id, 'rejected', reason)}
              getFileSignedUrl={getFileSignedUrl}
            />
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>
              Select an intake to review.
            </div>
          )}
        </main>
      </div>

      {onboardOpen && selected && (() => {
        // v2 — refresh-mode intake (existing client re-signing) opens the
        // modal in edit mode + passes the intake's submitted values as
        // pendingIntake so the form fields preview exactly what'll save.
        // Banner at the top + cert badge in TaxExemptBlock surface the
        // pending changes. The submit handler (handleCreateClient) still
        // branches on isRefresh internally and runs the same UPDATE +
        // cert copy logic on Save & Sync.
        const refreshSheetId = (selected as IntakeRow & { clientSpreadsheetId?: string }).clientSpreadsheetId || '';
        const existingClient = refreshSheetId
          ? apiClients.find(c => c.spreadsheetId === refreshSheetId) || null
          : null;
        if (existingClient) {
          const pendingIntake: PendingIntakeOverride = {
            id: selected.id,
            submittedAt: selected.submittedAt,
            contactName: selected.contactName,
            email: selected.email,
            phone: selected.phone,
            businessAddress: selected.businessAddress,
            billingContactName: selected.billingContactName,
            billingEmail: selected.billingEmail,
            billingAddress: selected.billingAddress,
            notificationContacts: selected.notificationContacts,
            autoInspect: selected.autoInspect,
            taxExempt: selected.taxExempt,
            taxExemptReason: selected.taxExemptReason,
            resaleCertExpires: selected.resaleCertExpires,
            resaleCertPath: selected.resaleCertPath,
          };
          return (
            <OnboardClientModal
              mode="edit"
              existingClient={existingClient}
              allClients={apiClients}
              pendingIntake={pendingIntake}
              onClose={() => setOnboardOpen(false)}
              onSubmit={handleCreateClient}
            />
          );
        }
        return (
          <OnboardClientModal
            mode="create"
            initialData={prefillFromIntake(selected)}
            allClients={apiClients}
            onClose={() => setOnboardOpen(false)}
            onSubmit={handleCreateClient}
          />
        );
      })()}
    </div>
  );
}

// ─── Generate link block ───────────────────────────────────────────────

function GenerateLinkBlock({ links, generateLink, revokeLink }: {
  links: IntakeLinkRow[];
  generateLink: ReturnType<typeof useIntakeAdmin>['generateLink'];
  revokeLink: ReturnType<typeof useIntakeAdmin>['revokeLink'];
}) {
  const { realUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fresh, setFresh] = useState<IntakeLinkRow | null>(null);
  const [copied, setCopied] = useState(false);

  // Email modal state
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [tcTemplate, setTcTemplate] = useState<{ subject: string; body: string } | null>(null);
  const [modalFresh, setModalFresh] = useState<IntakeLinkRow | null>(null);
  const [modalProspectName, setModalProspectName] = useState('');
  const [modalProspectEmail, setModalProspectEmail] = useState('');

  const activeLinks = useMemo(() => links.filter(l => l.active), [links]);

  const handleGenerate = async () => {
    setWorking(true); setErr(null);
    const savedEmail = email.trim();
    const savedName  = name.trim();
    const res = await generateLink({
      prospectName:  savedName  || undefined,
      prospectEmail: savedEmail || undefined,
      expiresAt: expiresAt || null,
    });
    setWorking(false);
    if (!res) { setErr('Failed to generate link. Check that you have admin permissions.'); return; }
    setFresh(res);
    setName(''); setEmail(''); setExpiresAt('');

    // Auto-open email modal when a prospect email was provided.
    if (savedEmail) {
      setModalFresh(res);
      setModalProspectName(savedName);
      setModalProspectEmail(savedEmail);
      // Lazy-fetch CLIENT_INTAKE_INVITE template if not already loaded.
      if (!tcTemplate) {
        const tRes = await apiFetch<{ templates: EmailTemplate[] }>('getEmailTemplates');
        const t = (tRes.data?.templates ?? []).find(
          (tmpl: EmailTemplate) => tmpl.key === 'CLIENT_INTAKE_INVITE'
        );
        if (t) setTcTemplate({ subject: t.subject ?? '', body: t.bodyHtml ?? '' });
      }
      setEmailModalOpen(true);
    }
  };

  const substituteTokens = (raw: string, intakeUrl: string, expiresStr: string): string =>
    raw
      .replace(/\{\{PROSPECT_NAME\}\}/g, modalProspectName || 'there')
      .replace(/\{\{INTAKE_LINK\}\}/g, intakeUrl)
      .replace(/\{\{EXPIRES_DATE\}\}/g, expiresStr);

  const getModalContent = () => {
    if (!tcTemplate || !modalFresh) return { subject: '', body: '' };
    const intakeUrl = url(modalFresh.linkId);
    const expiresStr = modalFresh.expiresAt
      ? new Date(modalFresh.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : 'no expiry date';
    return {
      subject: substituteTokens(tcTemplate.subject, intakeUrl, expiresStr),
      body:    substituteTokens(tcTemplate.body,    intakeUrl, expiresStr),
    };
  };

  const handleSendEmail = async (subject: string, bodyHtml: string, bcc: string[]) => {
    if (!modalFresh) return;
    setEmailSending(true);
    try {
      // Session 90 — migrated off the GAS `sendIntakeInvitation` handler
      // (which called MailApp) onto the Supabase `send-email` edge function
      // (which calls Resend). Subject + body are pre-rendered by the modal
      // (so the staff edits flow through), but the templateKey is still
      // recorded for audit so this row joins the rest of the email_sends
      // history correctly.
      //
      // idempotencyKey ties the send to the intake link id — preventing
      // accidental double-sends if the modal "Send" button is clicked
      // twice or the request races a refresh.
      // bcc is populated by the modal's "Send me a copy" checkbox so the
      // sending staff member gets a paper trail of every invite.
      const result = await sendEmail({
        templateKey:       'CLIENT_INTAKE_INVITE',
        to:                modalProspectEmail,
        bcc:               bcc.length > 0 ? bcc : undefined,
        subjectOverride:   subject,
        htmlOverride:      bodyHtml,
        idempotencyKey:    `intake-invite:${modalFresh.linkId}`,
        relatedEntityType: 'intake_link',
        relatedEntityId:   modalFresh.linkId,
      });
      if (!result.ok) {
        // Surface the error inline; modal stays open so the admin can
        // tweak the body or retry.
        console.error('[IntakesPanel] Intake invite send failed:', result.error);
        alert(`Failed to send invite: ${result.error ?? 'Unknown error'}`);
        return;
      }
    } finally {
      setEmailSending(false);
    }
    setEmailModalOpen(false);
    setModalFresh(null);
  };

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const url = (linkId: string) => `${BASE_INTAKE_URL}${linkId}`;

  const modal = getModalContent();

  return (
    <>
      <section style={blockShell}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Link2 size={16} color={theme.colors.orange} />
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: theme.colors.text }}>Invitation Links</h2>
              <span style={chipMuted}>{activeLinks.length} active</span>
            </div>
            <div style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 4 }}>
              Generate a unique /intake URL to send to a prospect. Each link is single-use in practice.
            </div>
          </div>
          <button onClick={() => setOpen(v => !v)} style={pillBtn}>
            <Plus size={13} /> {open ? 'Close' : 'Generate Link'}
          </button>
        </div>

        {open && (
          <div style={{ marginTop: 8, padding: 14, background: theme.colors.bgSubtle, borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 160px', gap: 10 }}>
              <TextField label="Prospect name"  value={name}      onChange={setName}      placeholder="Optional" />
              <TextField label="Prospect email" value={email}     onChange={setEmail}     placeholder="Optional — auto-opens email modal" />
              <TextField label="Expires" type="date" value={expiresAt} onChange={setExpiresAt} placeholder="Never" />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={handleGenerate} disabled={working} style={{ ...pillBtn, opacity: working ? 0.6 : 1 }}>
                {working
                  ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Generating…</>
                  : <>Generate</>}
              </button>
              {err && <span style={{ color: '#B91C1C', fontSize: 12 }}>{err}</span>}
            </div>

            {fresh && (
              <div style={{ padding: 12, background: 'rgba(74,138,92,0.08)', border: '1px solid rgba(74,138,92,0.3)', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <CheckCircle2 size={14} color="#15803D" />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#15803D' }}>Link ready — send to prospect</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#fff', borderRadius: 8, fontSize: 12, wordBreak: 'break-all' }}>
                  <code style={{ flex: 1, fontFamily: 'monospace' }}>{url(fresh.linkId)}</code>
                  <button onClick={() => copy(url(fresh.linkId))} style={iconButton} title="Copy">
                    {copied ? <CheckCircle2 size={13} color="#15803D" /> : <Copy size={13} />}
                  </button>
                  <a href={url(fresh.linkId)} target="_blank" rel="noopener noreferrer" style={iconButtonLink} title="Open">
                    <ExternalLink size={13} />
                  </a>
                  {/* Re-open email modal after copy if prospect email exists */}
                  {modalProspectEmail && modalFresh?.linkId === fresh.linkId && (
                    <button onClick={() => setEmailModalOpen(true)} style={iconButton} title="Open email composer">
                      <Mail size={13} />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Active link table */}
        {activeLinks.length > 0 && (
          <div style={{ marginTop: 14, border: `1px solid ${theme.colors.borderLight}`, borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: theme.colors.bgSubtle }}>
                  <th style={thStyle}>Prospect</th>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>Created</th>
                  <th style={thStyle}>Expires</th>
                  <th style={thStyle}>Used</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Link</th>
                </tr>
              </thead>
              <tbody>
                {activeLinks.map(l => (
                  <tr key={l.id} style={{ borderBottom: `1px solid ${theme.colors.borderLight}` }}>
                    <td style={tdStyle}>{l.prospectName || <span style={{ color: theme.colors.textMuted }}>—</span>}</td>
                    <td style={tdStyle}>{l.prospectEmail || <span style={{ color: theme.colors.textMuted }}>—</span>}</td>
                    <td style={{ ...tdStyle, color: theme.colors.textMuted }}>{fmtDateTime(l.createdAt)}</td>
                    <td style={{ ...tdStyle, color: theme.colors.textMuted }}>{l.expiresAt ? fmtDateTime(l.expiresAt) : 'Never'}</td>
                    <td style={tdStyle}>{l.usedAt ? <span style={{ color: '#15803D' }}>{fmtDateTime(l.usedAt)}</span> : <span style={{ color: theme.colors.textMuted }}>Unused</span>}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 4 }}>
                        <button onClick={() => copy(url(l.linkId))} style={iconButton} title="Copy URL">
                          <Copy size={12} />
                        </button>
                        <a href={url(l.linkId)} target="_blank" rel="noopener noreferrer" style={iconButtonLink} title="Open">
                          <ExternalLink size={12} />
                        </a>
                        <button onClick={() => { void revokeLink(l.id); }} style={iconButtonDanger} title="Revoke">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Email modal */}
      {emailModalOpen && modalFresh && (
        <IntakeEmailModal
          prospectName={modalProspectName}
          prospectEmail={modalProspectEmail}
          intakeUrl={url(modalFresh.linkId)}
          templateSubject={modal.subject}
          templateBody={modal.body}
          senderEmail={realUser?.email ?? null}
          onSend={handleSendEmail}
          onCopyLink={() => setEmailModalOpen(false)}
          onClose={() => setEmailModalOpen(false)}
          sending={emailSending}
        />
      )}
    </>
  );
}

// ─── Intake list row ──────────────────────────────────────────────────

function IntakeListRow({ intake, selected, onClick }: { intake: IntakeRow; selected: boolean; onClick: () => void }) {
  const statusMeta = STATUS_META[intake.status];
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', textAlign: 'left', padding: '12px 14px',
        borderBottom: `1px solid ${theme.colors.borderLight}`,
        background: selected ? theme.colors.bgSubtle : '#fff',
        border: 'none', cursor: 'pointer', fontFamily: PAGE_FONT,
        borderLeft: selected ? `3px solid ${theme.colors.orange}` : '3px solid transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: theme.colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {intake.businessName}
        </div>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase',
          padding: '2px 7px', borderRadius: 4,
          background: statusMeta.bg, color: statusMeta.color,
          flexShrink: 0, marginLeft: 6,
        }}>
          {intake.status}
        </span>
      </div>
      <div style={{ fontSize: 11, color: theme.colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {intake.contactName} · {intake.email}
      </div>
      <div style={{ fontSize: 10, color: theme.colors.textMuted, marginTop: 4 }}>
        {fmtDateTime(intake.submittedAt)}
      </div>
    </button>
  );
}

// ─── Review panel ─────────────────────────────────────────────────────

function IntakeReview({ intake, onCreateClient, onMarkReviewed, onReject, getFileSignedUrl }: {
  intake: IntakeRow;
  onCreateClient: () => void;
  onMarkReviewed: () => void;
  onReject: (reason: string) => void;
  getFileSignedUrl: (path: string, expiresInSeconds?: number) => Promise<string | null>;
}) {
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const isFinal = intake.status === 'activated' || intake.status === 'rejected';
  // Refresh intakes carry a client_spreadsheet_id back from the link
  // they were submitted through. The activation handler takes a
  // different branch for these (UPDATE the existing client +
  // copy the cert into resale-certs) — call that out in the button
  // label so admins don't think they're about to create a duplicate.
  // The same handler runs either way; only the surfaced text changes.
  const isRefresh = !!intake.clientSpreadsheetId;

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18, paddingBottom: 16, borderBottom: `1px solid ${theme.colors.borderLight}` }}>
        <button
          onClick={onCreateClient}
          disabled={isFinal}
          style={{ ...primaryActionBtn, opacity: isFinal ? 0.5 : 1, cursor: isFinal ? 'not-allowed' : 'pointer' }}
          title={isRefresh
            ? 'Apply this refresh intake to the existing client — updates tax/insurance fields, copies any new resale cert into the client record, and marks the intake activated.'
            : 'Create a new client record from this intake.'}
        >
          <UserPlus size={13} />
          {isRefresh ? 'Apply Refresh to Client' : 'Create Client from Intake'}
        </button>
        <button onClick={onMarkReviewed} disabled={intake.status !== 'pending'} style={{ ...ghostBtn, opacity: intake.status !== 'pending' ? 0.4 : 1 }}>
          <Eye size={13} /> Mark Reviewed
        </button>
        <button onClick={() => setRejectMode(v => !v)} disabled={isFinal} style={{ ...dangerBtn, opacity: isFinal ? 0.5 : 1 }}>
          <X size={13} /> Reject
        </button>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: theme.colors.textMuted, display: 'flex', alignItems: 'center', gap: 6 }}>
          Submitted {fmtDateTime(intake.submittedAt)}
        </div>
      </div>

      {rejectMode && (
        <div style={{ padding: 12, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 10, marginBottom: 16 }}>
          <textarea
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            placeholder="Reason for rejection (optional — saved to the intake row's notes)"
            rows={2}
            style={{ width: '100%', boxSizing: 'border-box', padding: 8, fontSize: 12, fontFamily: PAGE_FONT, border: `1px solid ${theme.colors.border}`, borderRadius: 8, resize: 'vertical', background: '#fff' }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button onClick={() => { onReject(rejectReason || 'Rejected'); setRejectMode(false); }} style={dangerBtn}>Confirm Reject</button>
            <button onClick={() => setRejectMode(false)} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 18 }}>
        <MetaCard label="Status" value={<StatusPill status={intake.status} />} />
        <MetaCard label="Coverage" value={(() => {
          if (intake.insuranceChoice === 'own_policy') return "Client's own policy";
          if (intake.insuranceChoice === 'stride_coverage' || intake.insuranceChoice === 'eis_coverage') {
            const dv = intake.insuranceDeclaredValue;
            // The intake row carries the prospect's declared value; a
            // zero-value row is an older intake or an edge case so fall
            // back to just the label.
            return dv > 0
              ? `Stride policy · $${dv.toLocaleString()} declared`
              : 'Added to Stride policy';
          }
          return '—';
        })()} />
        <MetaCard label="Payment authorized" value={intake.paymentAuthorized ? 'Yes' : 'No'} accent={intake.paymentAuthorized ? '#15803D' : '#B45309'} />
        <MetaCard label="Signed" value={intake.signedAt ? fmtDateTime(intake.signedAt) : '—'} />
      </div>

      <Section title="Business">
        <KV k="Business name" v={intake.businessName} />
        <KV k="Contact"        v={`${intake.contactName} — ${intake.email}`} />
        {intake.phone   && <KV k="Phone"    v={intake.phone} />}
        {intake.website && <KV k="Website"  v={intake.website} />}
        {intake.businessAddress && <KV k="Address" v={intake.businessAddress} />}
      </Section>

      <Section title="Billing">
        <KV k="Billing contact" v={intake.billingContactName || '—'} />
        <KV k="Billing email"   v={intake.billingEmail || '—'} />
        <KV k="Billing address" v={intake.billingAddress || '—'} />
        <KV k="Notifications"
            v={intake.notificationContacts.length > 0
              ? intake.notificationContacts.map(c => c.name ? `${c.name} <${c.email}>` : c.email).join(', ')
              : 'Main contact only'} />
      </Section>

      <Section title="Agreement">
        <KV k="Insurance choice" v={(() => {
          if (intake.insuranceChoice === 'own_policy') return "Client's own policy (collect COI at activation)";
          if (intake.insuranceChoice === 'stride_coverage' || intake.insuranceChoice === 'eis_coverage') {
            const dv = intake.insuranceDeclaredValue;
            const monthly = Math.max(30, Math.round((dv / 10000) * 30 * 100) / 100);
            return dv > 0
              ? `Added to Stride policy · $${dv.toLocaleString()} declared · $${monthly.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo`
              : 'Added to Stride policy (declared value not captured — pre-session-77 intake)';
          }
          return '—';
        })()} />
        <KV k="Auto-inspection" v={intake.autoInspect
          ? 'Opted in — authorised Stride to inspect every inbound shipment'
          : 'Off — by request only'} />
        <KV k="Sections initialed" v={
          ['storage','insurance','billing','lien','general'].map(k => {
            const val = intake.initials[k] || '—';
            return (
              <span key={k} style={{ display: 'inline-block', marginRight: 10, fontFamily: 'monospace' }}>
                {k}: <strong>{val}</strong>
              </span>
            );
          })
        } />
        <KV k="Signature"
            v={intake.signatureType === 'drawn' && intake.signatureData
              ? <img alt="signature" src={intake.signatureData} style={{ maxHeight: 64, border: `1px solid ${theme.colors.border}`, borderRadius: 6, padding: 4, background: '#fff' }} />
              : intake.signatureType === 'typed'
                ? <span style={{ fontFamily: "'Caveat', cursive", fontSize: 22 }}>{intake.signatureData}</span>
                : '—'} />
      </Section>

      <Section title="Documents">
        <DocumentLink label="Resale Certificate" path={intake.resaleCertPath} getFileSignedUrl={getFileSignedUrl} />
        {(intake.signedTcPdfPath ?? '').split(',').filter(p => p.trim().length > 0).map((p, i) => (
          <DocumentLink key={i} label={`Additional #${i + 1}`} path={p.trim()} getFileSignedUrl={getFileSignedUrl} />
        ))}
        {!intake.resaleCertPath && !intake.signedTcPdfPath && (
          <div style={{ fontSize: 12, color: theme.colors.textMuted, padding: '8px 0' }}>No documents uploaded.</div>
        )}
      </Section>

      <Section title="Meta">
        <KV k="Link ID"     v={intake.linkId || '—'} />
        <KV k="IP"          v={intake.ipAddress || 'Not captured'} />
        <KV k="User agent"  v={<span style={{ fontFamily: 'monospace', fontSize: 10, wordBreak: 'break-all' }}>{intake.userAgent || '—'}</span>} />
        {intake.notes     && <KV k="Admin notes" v={intake.notes} />}
        {intake.reviewedAt  && <KV k="Reviewed"  v={fmtDateTime(intake.reviewedAt)} />}
        {intake.activatedAt && <KV k="Activated" v={fmtDateTime(intake.activatedAt)} />}
      </Section>
    </div>
  );
}

function DocumentLink({ label, path, getFileSignedUrl }: {
  label: string; path: string | null; getFileSignedUrl: (path: string, s?: number) => Promise<string | null>;
}) {
  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  if (!path) return null;

  const open = async () => {
    if (docUrl) { window.open(docUrl, '_blank', 'noopener,noreferrer'); return; }
    setDocLoading(true);
    const signed = await getFileSignedUrl(path, 600);
    setDocLoading(false);
    if (signed) {
      setDocUrl(signed);
      window.open(signed, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: theme.colors.bgSubtle, borderRadius: 8, marginBottom: 6 }}>
      <FileText size={13} color={theme.colors.orange} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 10, color: theme.colors.textMuted, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{path}</div>
      </div>
      <button onClick={open} disabled={docLoading} style={ghostBtn}>
        {docLoading ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <ExternalLink size={11} />}
        Open
      </button>
    </div>
  );
}

// ─── Leaf primitives ──────────────────────────────────────────────────

function FilterChip({ label, n, active, onClick, accent }: {
  label: string; n: number; active: boolean; onClick: () => void;
  accent?: 'success' | 'warning' | 'danger' | 'info';
}) {
  const palette = accent === 'success' ? { bg: 'rgba(74,138,92,0.14)', fg: '#15803D' }
    : accent === 'warning' ? { bg: '#FEF3C7', fg: '#92400E' }
    : accent === 'danger'  ? { bg: '#FEE2E2', fg: '#B91C1C' }
    : accent === 'info'    ? { bg: '#DBEAFE', fg: '#1E40AF' }
    : { bg: theme.colors.bgSubtle, fg: theme.colors.textSecondary };
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '4px 10px', borderRadius: 100,
        background: active ? palette.bg : 'transparent',
        color: active ? palette.fg : theme.colors.textMuted,
        border: `1px solid ${active ? 'transparent' : theme.colors.border}`,
        fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
        cursor: 'pointer', fontFamily: PAGE_FONT,
      }}
    >
      {label} <span style={{ fontVariantNumeric: 'tabular-nums' }}>{n}</span>
    </button>
  );
}

function MetaCard({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div style={{ background: theme.colors.bgSubtle, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: theme.colors.textMuted, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: accent || theme.colors.text }}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16, borderTop: `1px solid ${theme.colors.borderLight}`, paddingTop: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', color: theme.colors.textMuted, textTransform: 'uppercase', marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 10, fontSize: 13 }}>
      <div style={{ color: theme.colors.textMuted, fontWeight: 500 }}>{k}</div>
      <div style={{ color: theme.colors.text }}>{v || <span style={{ color: theme.colors.textMuted }}>—</span>}</div>
    </div>
  );
}

function StatusPill({ status }: { status: IntakeRow['status'] }) {
  const m = STATUS_META[status];
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 100,
      background: m.bg, color: m.color, fontSize: 10, fontWeight: 700,
      letterSpacing: '0.5px', textTransform: 'uppercase',
    }}>{status}</span>
  );
}

function TextField({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', color: theme.colors.textMuted, textTransform: 'uppercase' }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          padding: '8px 10px', fontSize: 13, fontFamily: PAGE_FONT,
          background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 8, outline: 'none',
        }}
      />
    </label>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────

const STATUS_META: Record<IntakeRow['status'], { bg: string; color: string }> = {
  pending:   { bg: '#FEF3C7', color: '#92400E' },
  reviewed:  { bg: '#EFF6FF', color: '#1D4ED8' },
  activated: { bg: 'rgba(74,138,92,0.14)', color: '#15803D' },
  rejected:  { bg: '#FEE2E2', color: '#B91C1C' },
};

const blockShell: React.CSSProperties = {
  background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12,
  padding: 16, fontFamily: PAGE_FONT,
};
const listShell: React.CSSProperties = {
  background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12,
  overflow: 'hidden', alignSelf: 'flex-start',
};
const reviewShell: React.CSSProperties = {
  background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12,
  minHeight: 480,
};
const pillBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 18px', fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase',
  background: theme.colors.orange, color: '#fff', border: 'none', borderRadius: 100,
  cursor: 'pointer', fontFamily: PAGE_FONT,
};
const ghostBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '7px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase',
  background: '#fff', color: theme.colors.textSecondary,
  border: `1px solid ${theme.colors.border}`, borderRadius: 100,
  cursor: 'pointer', fontFamily: PAGE_FONT,
};
const dangerBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '7px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase',
  background: '#FEE2E2', color: '#B91C1C',
  border: '1px solid #FCA5A5', borderRadius: 100,
  cursor: 'pointer', fontFamily: PAGE_FONT,
};
const primaryActionBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '9px 18px', fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase',
  background: theme.colors.orange, color: '#fff', border: 'none', borderRadius: 100,
  cursor: 'pointer', fontFamily: PAGE_FONT,
};
const chipMuted: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
  padding: '2px 8px', borderRadius: 100,
  background: theme.colors.bgSubtle, color: theme.colors.textMuted,
};
const iconButton: React.CSSProperties = {
  padding: 6, background: '#fff', border: `1px solid ${theme.colors.border}`,
  borderRadius: 6, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
const iconButtonLink: React.CSSProperties = {
  ...iconButton, color: theme.colors.textSecondary, textDecoration: 'none',
};
const iconButtonDanger: React.CSSProperties = {
  ...iconButton, color: '#B91C1C', borderColor: '#FCA5A5',
};
const thStyle: React.CSSProperties = {
  padding: '8px 10px', textAlign: 'left',
  fontWeight: 700, fontSize: 10, letterSpacing: '1px', textTransform: 'uppercase',
  color: theme.colors.textMuted, borderBottom: `1px solid ${theme.colors.border}`,
};
const tdStyle: React.CSSProperties = {
  padding: '8px 10px', verticalAlign: 'middle',
};

/* ──────────────────────────────────────────────────────────────────────
 * v38.179.0 — Drafts sub-views
 *
 * DraftListRow: compact row matching IntakeListRow's visual style.
 *   Shows business name (or "—" if unstarted), prospect name/email,
 *   current step / 6, last-updated relative time.
 *
 * DraftSnapshot: read-only dump of every saved field so the operator
 *   can see exactly how far the prospect got. Useful for diagnosing
 *   silent submission failures (Jenny Ruegamer 2026-04-24 was the
 *   driving incident).
 * ────────────────────────────────────────────────────────────────────── */

const STEP_LABELS: Record<number, string> = {
  1: 'Business info',
  2: 'Billing contact',
  3: 'Terms & signature',
  4: 'Payment setup',
  5: 'Tax & documents',
  6: 'Review & submit',
};

function DraftListRow({ draft, selected, onClick }: { draft: AdminIntakeDraft; selected: boolean; onClick: () => void }) {
  const d = draft.draft as Record<string, unknown>;
  const biz = String(d.businessName || '').trim() || '—';
  const stepLabel = STEP_LABELS[draft.step] || `Step ${draft.step}`;
  const updatedFmt = draft.updatedAt ? fmtDateTime(draft.updatedAt) : '—';
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '10px 14px',
        background: selected ? theme.colors.bgSubtle : '#fff',
        border: 'none',
        borderBottom: `1px solid ${theme.colors.border}`,
        cursor: 'pointer', fontFamily: PAGE_FONT,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: theme.colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {biz}
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, color: theme.colors.orange, whiteSpace: 'nowrap' }}>
          Step {draft.step}/6
        </span>
      </div>
      <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {draft.prospectName || draft.prospectEmail || draft.linkId}
      </div>
      <div style={{ fontSize: 10, color: theme.colors.textMuted, marginTop: 2 }}>
        {stepLabel} · updated {updatedFmt}
      </div>
    </button>
  );
}

function DraftSnapshot({ draft, onRefresh }: { draft: AdminIntakeDraft; onRefresh: () => void }) {
  const d = draft.draft as Record<string, unknown>;
  const fileHints = (d.__fileHints as { resaleCertFileName?: string; otherFileNames?: string[] }) || {};
  const intakeUrl = `${window.location.origin}/#/intake/${draft.linkId}`;
  const stepLabel = STEP_LABELS[draft.step] || `Step ${draft.step}`;

  // Build a flat key/value rendering of every saved field, skipping the
  // private __fileHints namespace and any keys whose value is empty.
  const visible: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(d)) {
    if (k === '__fileHints') continue;
    if (v === null || v === undefined || v === '') continue;
    let str: string;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      str = JSON.stringify(v);
    } else if (typeof v === 'object') {
      str = JSON.stringify(v);
    } else {
      str = String(v);
    }
    if (str.length > 800) str = str.slice(0, 800) + '… (truncated)';
    visible.push([k, str]);
  }

  return (
    <div style={{ padding: 20, fontFamily: PAGE_FONT }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: theme.colors.text }}>
            {String(d.businessName || '').trim() || draft.prospectName || '(unnamed draft)'}
          </div>
          <div style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 2 }}>
            Step {draft.step}/6 · {stepLabel} · updated {fmtDateTime(draft.updatedAt)}
          </div>
          {draft.prospectEmail && (
            <div style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 2 }}>
              Invitation sent to {draft.prospectEmail}
            </div>
          )}
        </div>
        <button
          onClick={onRefresh}
          title="Re-fetch drafts list (catch new ones in progress)"
          style={{
            padding: '6px 10px', fontSize: 11, fontWeight: 600,
            border: `1px solid ${theme.colors.border}`, borderRadius: 6,
            background: '#fff', cursor: 'pointer',
            color: theme.colors.textSecondary, fontFamily: 'inherit',
          }}
        >
          Refresh
        </button>
      </div>

      <div style={{ background: theme.colors.bgSubtle, padding: 10, borderRadius: 8, marginBottom: 14, fontSize: 11, color: theme.colors.textSecondary }}>
        <div style={{ fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Resume URL (same as the prospect's)</div>
        <code style={{ wordBreak: 'break-all', display: 'block', marginBottom: 6 }}>{intakeUrl}</code>
        <a href={intakeUrl} target="_blank" rel="noreferrer" style={{ color: theme.colors.orange, fontWeight: 600, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <ExternalLink size={11} /> Open prospect's link
        </a>
      </div>

      {(fileHints.resaleCertFileName || (fileHints.otherFileNames && fileHints.otherFileNames.length > 0)) && (
        <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8, padding: 10, marginBottom: 14, fontSize: 11, color: '#92400E' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Files prospect previously chose (not persisted)</div>
          {fileHints.resaleCertFileName && <div>Resale cert: <code>{fileHints.resaleCertFileName}</code></div>}
          {fileHints.otherFileNames && fileHints.otherFileNames.length > 0 && (
            <div>Other: <code>{fileHints.otherFileNames.join(', ')}</code></div>
          )}
          <div style={{ marginTop: 4, fontStyle: 'italic' }}>The prospect will need to re-attach files when they resume.</div>
        </div>
      )}

      <div style={{ fontSize: 11, fontWeight: 700, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        Saved fields ({visible.length})
      </div>
      <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
        {visible.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: theme.colors.textMuted, fontSize: 12 }}>
            No fields saved yet — prospect opened the form but hasn't typed anything.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <tbody>
              {visible.map(([k, v]) => (
                <tr key={k} style={{ borderBottom: `1px solid ${theme.colors.borderLight}` }}>
                  <td style={{ ...tdStyle, width: 180, fontWeight: 600, color: theme.colors.textMuted, verticalAlign: 'top' }}>{k}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', wordBreak: 'break-word' }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
