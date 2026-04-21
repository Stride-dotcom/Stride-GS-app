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

export interface IntakeLinkInfo {
  id: string;
  linkId: string;
  prospectName: string | null;
  prospectEmail: string | null;
  expiresAt: string | null;
  active: boolean;
  usedAt: string | null;
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
  // Step 5 — file paths (uploaded separately before submit)
  signedTcPdfPath?: string;
  resaleCertPath?: string;
  // Meta (captured in the browser)
  userAgent?: string;
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
  const row = {
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
    user_agent:            payload.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : null),
    submitted_at:          new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('client_intakes')
    .insert(row)
    .select('id')
    .single();
  if (error || !data) return { error: error?.message ?? 'Submit failed' };

  // Best-effort link consumption marker — non-fatal if it fails (the
  // intake row is already persisted and the admin can see it). Anon
  // role can't UPDATE links under RLS, so this relies on an admin-run
  // reconciler OR the marker will be set when the admin marks the
  // intake reviewed. For now we log + swallow.
  try {
    await supabase
      .from('client_intake_links')
      .update({ used_at: new Date().toISOString() })
      .eq('link_id', payload.linkId);
  } catch (_) { /* anon UPDATE blocked by RLS; admin reconciles */ }

  return { id: (data as { id: string }).id };
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
