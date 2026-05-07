/**
 * useClientIntake — thin helper for the public /intake/:linkId wizard.
 *
 * Responsibilities:
 *   • Resolve a linkId to a client_intake_links row (or null if
 *     missing / expired / revoked). Used by the wizard to show a
 *     "this link isn't active" screen instead of the form.
 *   • Upload a prospect file to Supabase Storage under
 *     documents/intakes/<linkId>/<filename>. The `intakes_anon_upload`
 *     policy accepts the insert; no auth required.
 *   • Submit a client_intakes row. RLS policy `intakes_public_insert`
 *     accepts INSERT from anon. Returns the newly-created row id on
 *     success or the Supabase error message on failure.
 *   • Flip the corresponding client_intake_links.used_at timestamp so
 *     the admin view can distinguish consumed vs pending links.
 *
 * The hook is intentionally stateless — the wizard manages the draft
 * itself and calls these helpers at specific milestones (link-resolve
 * on mount, uploads on step 5, submit on step 6). That keeps the React
 * tree predictable on a page that the prospect may load cold from an
 * email link with no session cache.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { sendEmail } from '../lib/email';

export interface IntakeLinkInfo {
  id: string;
  linkId: string;
  prospectName: string | null;
  prospectEmail: string | null;
  expiresAt: string | null;
  active: boolean;
  usedAt: string | null;
  /** When set, this link is for an existing client (refresh mode). */
  clientSpreadsheetId: string | null;
}

/** Pre-fill payload for refresh-mode intakes. Pulls from the existing
 *  clients row + the most recent client_intakes row for that client.
 *  All fields optional — form falls back to empty defaults when missing. */
export interface RefreshPrefill {
  spreadsheetId: string;
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  businessAddress: string;
  website: string;
  billingContactName: string;
  billingEmail: string;
  billingAddress: string;
  notificationContacts: Array<{ name?: string; email: string }>;
  insuranceChoice: 'own_policy' | 'stride_coverage' | 'eis_coverage' | '';
  insuranceDeclaredValue: string;
  autoInspect: boolean;
  paymentAuthorized: boolean;
  /** v2 model — current autopay state from clients.auto_charge. true =
   *  enrolled, false = terms billing. Drives the Step 4 radio prefill. */
  autopayCurrent: boolean;
  /** v2 model — clients.payment_method_required snapshot. Drives Step 4
   *  copy variant: true = "required", false = "encouraged". */
  paymentMethodRequired: boolean;
  taxExempt: boolean | null;
  taxExemptReason: string;
  resaleCertExpires: string;
  resaleCertCurrentUrl: string;
  resaleCertUploadedAt: string;
}

export interface IntakeSubmitPayload {
  linkId: string;
  // Step 1
  businessName: string;
  contactName: string;
  email: string;
  phone?: string;
  businessAddress?: string;
  website?: string;
  // Step 2
  billingContactName?: string;
  billingEmail?: string;
  billingAddress?: string;
  notificationContacts: Array<{ name?: string; email: string }>;
  // Step 3 — T&C
  // 'eis_coverage' retained in the union as a back-compat read path —
   // new intakes write 'stride_coverage' per session 77 rename.
  insuranceChoice: 'own_policy' | 'stride_coverage' | 'eis_coverage';
  /** Only captured when the prospect picks 'stride_coverage'. Dollars.
   *  Copied into client_insurance.declared_value on activation and
   *  used by the daily billing job. */
  insuranceDeclaredValue?: number;
  /** Prospect opted into Stride auto-inspecting inbound shipments for
   *  visible shipping damage. Default false; copied into the client's
   *  AUTO_INSPECTION setting at activation. */
  autoInspect?: boolean;
  signatureType: 'typed' | 'drawn';
  signatureData: string; // typed name OR base64 PNG data URL
  initials: Record<string, string>; // { storage: 'ABC', ... }
  // Step 4
  paymentAuthorized: boolean;
  /** v2 model — explicit autopay opt-in (separate from paymentAuthorized
   *  which is the past-due-safety-net authorization). When true: Stride
   *  charges the card on each invoice's due date. When false: terms billing
   *  (charge only if past due past the grace period). */
  autopayElected?: boolean;
  /** Acknowledgment of the 3% credit-card processing fee disclosure on
   *  Step 4 of the form. Captured separately so we can prove the
   *  prospect saw it specifically. */
  acknowledged3pctCcFee?: boolean;
  /** Snapshot of clients.payment_method_required at sign time. Tells us
   *  later whether this signature was under "card required" or
   *  "card encouraged" rules. */
  paymentMethodRequiredSnapshot?: boolean;
  /** SHA-256 of the exact T&C body the prospect saw + signed. Per
   *  Decision #21 — drives the form's full-flow vs preference-only-flow
   *  detection on subsequent visits. */
  bodySha256?: string;
  /** Origin of this submission. 'intake_full' = new client, 'intake_preference_update'
   *  = existing client refresh, 'staff_override' = staff-initiated change. */
  submissionSource?: 'intake_full' | 'intake_preference_update' | 'staff_override';
  // Step 5 — file paths (uploaded separately before submit)
  signedTcPdfPath?: string;
  resaleCertPath?: string;
  /** Prospect indicated they are a wholesale customer (resale exemption).
   *  Forwarded to clients.tax_exempt on activation. */
  taxExempt?: boolean;
  /** Resale / Out-of-state / Government / Non-profit / Other. */
  taxExemptReason?: string;
  /** Date the prospect's resale certificate expires. */
  resaleCertExpires?: string;
  /** Refresh-mode marker — set when the link's client_spreadsheet_id is
   *  populated. Activation route diverges based on this. */
  intakeMode?: 'new' | 'refresh';
  clientSpreadsheetId?: string;
  // Meta (captured in the browser)
  userAgent?: string;
}

// Refresh-mode prefill — only used when the link references an existing
// client. Reads the canonical clients row + the most-recent client_intakes
// row (for fields like notification_contacts that historically only lived
// on intake submissions). Best-effort; missing rows fall back to empty
// strings so the form still renders.
export async function fetchRefreshPrefill(spreadsheetId: string): Promise<RefreshPrefill | null> {
  try {
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('spreadsheet_id, name, email, contact_name, phone, qb_customer_name, auto_charge, payment_method_required, auto_inspection, notification_contacts, tax_exempt, tax_exempt_reason, resale_cert_expires, resale_cert_url, resale_cert_uploaded_at')
      .eq('spreadsheet_id', spreadsheetId)
      .maybeSingle();
    if (clientErr || !client) return null;

    // Fall back to most recent intake for any field not on clients (business
    // address, website, billing fields, insurance choice, declared value,
    // notification contacts when clients.notification_contacts is null).
    const { data: lastIntake } = await supabase
      .from('client_intakes')
      .select('business_address, website, billing_contact_name, billing_email, billing_address, notification_contacts, insurance_choice, insurance_declared_value, auto_inspect, payment_authorized')
      .eq('client_spreadsheet_id', spreadsheetId)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Notification contacts: prefer the canonical clients column; fall back
    // to the last intake's snapshot.
    const contacts: Array<{ name?: string; email: string }> = (() => {
      const fromClient = (client as { notification_contacts?: unknown }).notification_contacts;
      if (Array.isArray(fromClient)) return fromClient as Array<{ name?: string; email: string }>;
      const fromIntake = lastIntake?.notification_contacts;
      if (Array.isArray(fromIntake)) return fromIntake as Array<{ name?: string; email: string }>;
      return [];
    })();

    return {
      spreadsheetId: client.spreadsheet_id,
      businessName:        client.name || '',
      contactName:         client.contact_name || '',
      email:               client.email || '',
      phone:               client.phone || '',
      businessAddress:     lastIntake?.business_address || '',
      website:             lastIntake?.website || '',
      billingContactName:  lastIntake?.billing_contact_name || '',
      billingEmail:        lastIntake?.billing_email || '',
      billingAddress:      lastIntake?.billing_address || '',
      notificationContacts: contacts,
      insuranceChoice:     (lastIntake?.insurance_choice as RefreshPrefill['insuranceChoice']) || '',
      insuranceDeclaredValue: lastIntake?.insurance_declared_value != null ? String(lastIntake.insurance_declared_value) : '',
      autoInspect:         client.auto_inspection === true || lastIntake?.auto_inspect === true,
      paymentAuthorized:   client.auto_charge === true || lastIntake?.payment_authorized === true,
      autopayCurrent:      client.auto_charge === true,
      paymentMethodRequired: client.payment_method_required !== false,  // default true if null
      taxExempt:           client.tax_exempt === false ? false : true,
      taxExemptReason:     client.tax_exempt_reason || 'Resale',
      resaleCertExpires:   client.resale_cert_expires || '',
      resaleCertCurrentUrl: client.resale_cert_url || '',
      resaleCertUploadedAt: client.resale_cert_uploaded_at || '',
    };
  } catch {
    return null;
  }
}

function linkRowToInfo(r: LinkRow): IntakeLinkInfo {
  return {
    id: r.id,
    linkId: r.link_id,
    prospectName: r.prospect_name,
    prospectEmail: r.prospect_email,
    expiresAt: r.expires_at,
    active: r.active !== false,
    usedAt: r.used_at,
    clientSpreadsheetId: r.client_spreadsheet_id ?? null,
  };
}

interface LinkRow {
  id: string;
  link_id: string;
  prospect_name: string | null;
  prospect_email: string | null;
  expires_at: string | null;
  active: boolean | null;
  used_at: string | null;
  client_spreadsheet_id?: string | null;
}

export type LinkStatus = 'loading' | 'valid' | 'invalid' | 'expired';

export function useIntakeLink(linkId: string | null) {
  const [status, setStatus] = useState<LinkStatus>('loading');
  const [link, setLink] = useState<IntakeLinkInfo | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!linkId) { setStatus('invalid'); return; }
    let cancelled = false;
    (async () => {
      // RLS on client_intake_links.SELECT for anon already filters to
      // active=true and non-expired. If nothing comes back, the link is
      // either missing, revoked, or expired — we can't distinguish
      // between those from the client (by design — don't leak which).
      const { data, error } = await supabase
        .from('client_intake_links')
        .select('*')
        .eq('link_id', linkId)
        .maybeSingle();
      if (cancelled || !mountedRef.current) return;
      if (error || !data) {
        setStatus('invalid');
        setLink(null);
        return;
      }
      const info = linkRowToInfo(data as LinkRow);
      setLink(info);
      // `expires_at > now()` is already enforced by RLS, but double-check
      // client-side so we render a clearer error if a link was revoked
      // between page load and the fetch.
      if (info.expiresAt && new Date(info.expiresAt).getTime() <= Date.now()) {
        setStatus('expired');
      } else {
        setStatus('valid');
      }
    })();
    return () => { cancelled = true; };
  }, [linkId]);

  return { status, link };
}

/**
 * uploadIntakeFile — anon upload to documents/intakes/<linkId>/<ts>-<name>.
 * Returns the storage object path on success or throws on failure. The
 * caller saves the path to the client_intakes row.
 */
export async function uploadIntakeFile(linkId: string, file: File): Promise<string> {
  // Normalize the filename: strip whitespace, lowercase, prefix with
  // a timestamp so two uploads of "resale.pdf" don't collide within
  // the same intake.
  const safe = file.name.replace(/[^\w.-]+/g, '_').toLowerCase();
  const path = `intakes/${linkId}/${Date.now()}-${safe}`;
  const { error } = await supabase.storage
    .from('documents')
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    });
  if (error) throw new Error(error.message);
  return path;
}

/**
 * submitIntake — INSERT a row into client_intakes via the anon RLS
 * policy. Returns { id } on success or { error } on failure. Also
 * flips client_intake_links.used_at so the admin view can distinguish
 * completed vs pending invitations.
 */
export async function submitIntake(payload: IntakeSubmitPayload): Promise<{ id: string } | { error: string }> {
  // Generate the row id client-side so we don't need RETURNING. The intake
  // form runs anon (no auth — it's a public /intake/:linkId page), and the
  // SELECT policy on client_intakes is staff-only by design — anon can
  // INSERT but cannot SELECT. PostgREST's default `Prefer: return=representation`
  // (which `.insert(row).select('id').single()` enables) does an
  // INSERT...RETURNING which evaluates the SELECT policy on the new row.
  // That fails for anon → the entire transaction rolls back with
  // "new row violates row-level security policy". Generating the id here
  // and using `Prefer: return=minimal` (the default when no .select() is
  // chained) avoids the SELECT step entirely.
  const intakeId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;

  const row = {
    id:                    intakeId,
    link_id:               payload.linkId,
    status:                'pending',
    business_name:         payload.businessName.trim(),
    contact_name:          payload.contactName.trim(),
    email:                 payload.email.trim().toLowerCase(),
    phone:                 payload.phone?.trim() || null,
    business_address:      payload.businessAddress?.trim() || null,
    website:               payload.website?.trim() || null,
    billing_contact_name:  payload.billingContactName?.trim() || null,
    billing_email:         payload.billingEmail?.trim().toLowerCase() || null,
    billing_address:       payload.billingAddress?.trim() || null,
    notification_contacts: payload.notificationContacts.filter(c => c.email.trim().length > 0),
    insurance_choice:      payload.insuranceChoice,
    insurance_declared_value: payload.insuranceDeclaredValue ?? 0,
    auto_inspect:          payload.autoInspect === true,
    payment_authorized:    payload.paymentAuthorized,
    signature_type:        payload.signatureType,
    signature_data:        payload.signatureData,
    signed_at:             new Date().toISOString(),
    initials:              payload.initials,
    signed_tc_pdf_path:    payload.signedTcPdfPath ?? null,
    resale_cert_path:      payload.resaleCertPath ?? null,
    tax_exempt:            payload.taxExempt ?? null,
    tax_exempt_reason:     payload.taxExemptReason ?? null,
    resale_cert_expires:   payload.resaleCertExpires ?? null,
    intake_mode:           payload.intakeMode || 'new',
    client_spreadsheet_id: payload.clientSpreadsheetId || null,
    user_agent:            payload.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : null),
    submitted_at:          new Date().toISOString(),
    // v2 model fields — see IntakeSubmitPayload doc comments
    body_sha256:                       payload.bodySha256 ?? null,
    autopay_elected:                   payload.autopayElected ?? null,
    payment_method_required_snapshot:  payload.paymentMethodRequiredSnapshot ?? null,
    acknowledged_3pct_cc_fee:          payload.acknowledged3pctCcFee ?? false,
    submission_source:                 payload.submissionSource ||
                                       (payload.intakeMode === 'refresh' ? 'intake_preference_update' : 'intake_full'),
  };
  const { error } = await supabase.from('client_intakes').insert(row);
  if (error) return { error: error.message };

  // Always call apply-intake-on-submit. Two responsibilities:
  //   - Deactivate the intake link (active=false, used_at=now) via the
  //     service-role edge function. Anon can't UPDATE client_intake_links
  //     under RLS, so this is the only path. Without this, the link stays
  //     active=true and the resign-reminder cron keeps finding it as a
  //     usable link for the prospect's eventual clients row.
  //   - For refresh-mode intakes, also propagate the prospect's values
  //     onto the existing clients row (Decision #28 auto-apply path),
  //     including stamping last_intake_body_sha256 so the resign cron
  //     stops emailing them.
  //
  // For new-client intakes, only the link-deactivation half runs;
  // IntakesPanel.handleCreateClient stamps the hash + propagates the
  // rest when the admin activates.
  //
  // Best-effort — if the edge function call fails, the intake row is
  // already persisted and an admin can manually activate from the
  // queue (which now also stamps the hash via IntakesPanel).
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
    const projectUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
    if (projectUrl) {
      await fetch(`${projectUrl}/functions/v1/apply-intake-on-submit`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          intakeId,
          linkId: payload.linkId,
          clientSpreadsheetId: payload.clientSpreadsheetId || undefined,
        }),
      }).catch((e) => console.warn('[intake] apply-intake-on-submit failed (non-fatal):', e));
    }
  } catch (e) {
    console.warn('[intake] apply-intake-on-submit invocation error (non-fatal):', e);
  }

  // Fire-and-forget admin email alert. The Supabase AFTER-INSERT trigger
  // already queued in-app notifications for every admin via
  // in_app_notifications; this call handles the email channel. Uses the
  // INTAKE_SUBMITTED template (editable in Settings → Email Templates).
  // Never awaited — prospect's success screen doesn't depend on it.
  //
  // Session 90 — migrated off the GAS `notifyIntakeSubmitted` handler
  // (which called MailApp via api_sendTemplateEmail_) onto the Supabase
  // `send-email` edge function. We pass NO `to` field — the edge
  // function reads INTAKE_SUBMITTED's `recipients` column from
  // email_templates ('{{STAFF_EMAILS}}') and resolves it against
  // public.profiles WHERE role IN ('admin','staff') AND is_active. The
  // entire token-derivation that used to live in handleNotifyIntakeSubmitted_
  // (declared-value formatting, payment-authorized Y/N mapping, review-link
  // construction) now happens here in React.
  try {
    const declaredNum = Number(row.insurance_declared_value) || 0;
    const declaredFmt = '$' + declaredNum.toLocaleString('en-US', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
    const paymentLabel = row.payment_authorized === true
      ? 'Yes'
      : row.payment_authorized === false ? 'No' : '—';
    const reviewLink =
      'https://www.mystridehub.com/#/settings?tab=clients&subtab=intakes' +
      (intakeId ? `&intake=${encodeURIComponent(intakeId)}` : '');

    void sendEmail({
      templateKey: 'INTAKE_SUBMITTED',
      // No `to` — the edge function expands template.recipients
      // ('{{STAFF_EMAILS}}') from public.profiles.
      tokens: {
        BUSINESS_NAME:      row.business_name      || 'unnamed business',
        CONTACT_NAME:       row.contact_name       || 'unknown contact',
        CONTACT_EMAIL:      row.email              || '—',
        CONTACT_PHONE:      row.phone              || '—',
        SUBMITTED_AT:       row.submitted_at,
        INSURANCE_CHOICE:   row.insurance_choice   || '—',
        DECLARED_VALUE:     declaredFmt,
        PAYMENT_AUTHORIZED: paymentLabel,
        REVIEW_LINK:        reviewLink,
      },
      idempotencyKey:    `intake-submitted:${intakeId}`,
      relatedEntityType: 'client_intake',
      relatedEntityId:   intakeId,
    }).then(r => {
      if (!r.ok) {
        console.warn('[intake] admin notify email failed (non-blocking):', r.error);
      }
    }).catch(err => {
      console.warn('[intake] admin notify email threw (non-blocking):', err);
    });
  } catch (_) { /* never let a notify failure break the success screen */ }

  return { id: intakeId };
}

/**
 * Fetch the DOC_CLIENT_TC HTML from email_templates. Supabase's
 * email_templates.SELECT policy is public-ish (authenticated + anon
 * for active templates); we only need to read .body.
 */
export async function fetchClientTcBody(): Promise<string | null> {
  const { data, error } = await supabase
    .from('email_templates')
    .select('body')
    .eq('template_key', 'DOC_CLIENT_TC')
    .eq('active', true)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { body: string | null }).body ?? null;
}

export interface PublicCoverageNote {
  id: string;
  name: string;
  note: string;
}

/**
 * fetchPublicCoverageNotes — pull active coverage options for
 * interpolation into the T&C. Anon-readable via the
 * `coverage_options_anon_read` policy. The `note` field is what ends
 * up as the contractual description; the Price List page is the
 * editorial surface.
 */
export async function fetchPublicCoverageNotes(): Promise<PublicCoverageNote[]> {
  const { data, error } = await supabase
    .from('coverage_options')
    .select('id,name,note')
    .eq('active', true)
    .order('display_order', { ascending: true });
  if (error || !data) return [];
  return (data as Array<{ id: string; name: string | null; note: string | null }>)
    .map(r => ({ id: r.id, name: r.name ?? '', note: r.note ?? '' }));
}

/**
 * getPublicDocumentUrl — staff/admin review helper. Returns a short-
 * lived signed URL to an intake-uploaded document (resale cert, etc).
 * Not used by the public wizard — the public form only uploads,
 * never reads back.
 */
export async function getIntakeFileSignedUrl(path: string, expiresInSeconds = 300): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('documents')
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Utility: safe useCallback ref wrapper for the HTMLCanvasElement signature pad. */
export function useSignatureCanvas(): {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  clear: () => void;
  isEmpty: () => boolean;
  toDataURL: () => string;
  handlers: {
    onMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
    onMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
    onMouseUp: () => void;
    onMouseLeave: () => void;
    onTouchStart: (e: React.TouchEvent<HTMLCanvasElement>) => void;
    onTouchMove: (e: React.TouchEvent<HTMLCanvasElement>) => void;
    onTouchEnd: () => void;
  };
} {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  const getCtx = () => canvasRef.current?.getContext('2d') ?? null;

  const getXY = (evt: React.MouseEvent | React.TouchEvent): { x: number; y: number } => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    const clientX = 'touches' in evt ? evt.touches[0]?.clientX ?? 0 : (evt as React.MouseEvent).clientX;
    const clientY = 'touches' in evt ? evt.touches[0]?.clientY ?? 0 : (evt as React.MouseEvent).clientY;
    return {
      x: (clientX - rect.left) * (c.width / rect.width),
      y: (clientY - rect.top)  * (c.height / rect.height),
    };
  };

  const start = (evt: React.MouseEvent | React.TouchEvent) => {
    drawingRef.current = true;
    lastRef.current = getXY(evt);
  };
  const move = (evt: React.MouseEvent | React.TouchEvent) => {
    if (!drawingRef.current) return;
    const ctx = getCtx();
    const prev = lastRef.current;
    if (!ctx || !prev) return;
    const { x, y } = getXY(evt);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1C1C1C';
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    hasInkRef.current = true;
    lastRef.current = { x, y };
  };
  const end = () => {
    drawingRef.current = false;
    lastRef.current = null;
  };

  const clear = useCallback(() => {
    const c = canvasRef.current;
    const ctx = getCtx();
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    hasInkRef.current = false;
  }, []);

  const isEmpty = useCallback(() => !hasInkRef.current, []);
  const toDataURL = useCallback(() => canvasRef.current?.toDataURL('image/png') ?? '', []);

  return {
    canvasRef,
    clear,
    isEmpty,
    toDataURL,
    handlers: {
      onMouseDown: (e) => start(e),
      onMouseMove: (e) => move(e),
      onMouseUp: end,
      onMouseLeave: end,
      onTouchStart: (e) => { e.preventDefault(); start(e); },
      onTouchMove:  (e) => { e.preventDefault(); move(e); },
      onTouchEnd: end,
    },
  };
}

/* ============================================================
 * v38.179.0 — Intake draft auto-save (Option 2)
 *
 * Pre-existing flow: form state lived in useState only — close the tab
 * or refresh and everything evaporated, with zero server-side trace.
 * (Justin caught this when Jenny Ruegamer reported failed submissions
 * twice and we had no record of either attempt.)
 *
 * New flow:
 *   • fetchIntakeDraft(linkId)   → load saved snapshot on form mount
 *   • saveIntakeDraft(linkId, …) → debounced upsert as the prospect types
 *   • deleteIntakeDraft(linkId)  → cleanup on successful submit
 *
 * File fields (resaleCertFile, otherFiles) are NOT persisted — File
 * objects don't survive serialization, and there's no way to "remember"
 * a chosen local file across browser sessions. The prospect re-attaches
 * files when they resume. Everything else (text, booleans, signature
 * base64, sectionInitials, notificationContacts) round-trips through
 * JSONB.
 * ============================================================ */

export interface SavedIntakeDraft {
  draft: Record<string, unknown>;
  step: number;
  updatedAt: string;
}

/**
 * Strip non-serializable fields (File / FileList) before persisting. Returns
 * a JSON-safe shallow clone. The caller's Draft type loses fidelity here —
 * that's fine, the prospect re-attaches files on resume. We persist the
 * file *names* as a hint so the resume UI can display "you uploaded
 * resale.pdf last time — please re-attach if still applicable".
 */
function stripFiles(draft: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let resaleHint = '';
  const otherHints: string[] = [];
  for (const [k, v] of Object.entries(draft)) {
    if (v instanceof File) {
      // Stash filename hint, drop the File object.
      if (k === 'resaleCertFile') resaleHint = v.name;
      continue;
    }
    if (Array.isArray(v) && v.length > 0 && v[0] instanceof File) {
      if (k === 'otherFiles') {
        for (const f of v as File[]) otherHints.push(f.name);
      }
      out[k] = [];
      continue;
    }
    out[k] = v;
  }
  // Drop file slots themselves so the hydration step doesn't try to
  // resurrect a File from a string (which would crash <input type=file>).
  delete out.resaleCertFile;
  delete out.otherFiles;
  // Persist hints in a separate namespace so the resume screen can
  // display "you previously attached: <names>".
  out.__fileHints = { resaleCertFileName: resaleHint, otherFileNames: otherHints };
  return out;
}

export async function fetchIntakeDraft(linkId: string): Promise<SavedIntakeDraft | null> {
  if (!linkId) return null;
  const { data, error } = await supabase
    .from('client_intake_drafts')
    .select('draft, step, updated_at')
    .eq('link_id', linkId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    draft: (data.draft as Record<string, unknown>) || {},
    step: typeof data.step === 'number' ? data.step : 1,
    updatedAt: String(data.updated_at || ''),
  };
}

export async function saveIntakeDraft(linkId: string, draft: Record<string, unknown>, step: number): Promise<void> {
  if (!linkId) return;
  const stripped = stripFiles(draft);
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null;
  // Best-effort upsert. Failures are non-fatal — the prospect can still
  // submit; auto-save is a nice-to-have, not a blocker.
  const { error } = await supabase
    .from('client_intake_drafts')
    .upsert(
      { link_id: linkId, draft: stripped, step, user_agent: ua },
      { onConflict: 'link_id' }
    );
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[intake-draft] save failed (non-fatal):', error.message);
  }
}

export async function deleteIntakeDraft(linkId: string): Promise<void> {
  if (!linkId) return;
  // Best-effort cleanup — if it fails the row stays orphaned but the
  // submitted client_intakes row is the source of truth so it's harmless.
  await supabase.from('client_intake_drafts').delete().eq('link_id', linkId).then(
    () => { /* ok */ },
    (err) => console.warn('[intake-draft] delete failed (non-fatal):', err)
  );
}

/**
 * Admin-side: list every saved draft. Used by Settings → Clients →
 * Intakes → Drafts sub-tab. Joins prospect_name + prospect_email from
 * client_intake_links so the operator sees who's mid-form without an
 * extra round-trip.
 */
export interface AdminIntakeDraft {
  linkId: string;
  prospectName: string | null;
  prospectEmail: string | null;
  step: number;
  draft: Record<string, unknown>;
  updatedAt: string;
  createdAt: string;
}
export async function fetchAdminIntakeDrafts(): Promise<AdminIntakeDraft[]> {
  const { data, error } = await supabase
    .from('client_intake_drafts')
    .select('link_id, step, draft, updated_at, created_at, client_intake_links!inner(prospect_name, prospect_email)')
    .order('updated_at', { ascending: false });
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((row) => {
    const link = row.client_intake_links as { prospect_name?: string | null; prospect_email?: string | null } | null;
    return {
      linkId: String(row.link_id),
      prospectName: link?.prospect_name ?? null,
      prospectEmail: link?.prospect_email ?? null,
      step: typeof row.step === 'number' ? row.step : 1,
      draft: (row.draft as Record<string, unknown>) || {},
      updatedAt: String(row.updated_at || ''),
      createdAt: String(row.created_at || ''),
    };
  });
}
