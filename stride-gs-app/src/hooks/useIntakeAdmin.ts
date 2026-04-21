/**
 * useIntakeAdmin — admin-side reads + writes for the client intake
 * pipeline. Complements the public hooks in useClientIntake (which
 * handle anon-side link validation, uploads, and submit).
 *
 * Three responsibilities:
 *   • List + live-refresh every client_intakes row (admin/staff RLS).
 *   • Generate a new client_intake_links row (admin RLS) and hand
 *     back the magic URL the admin can paste into an email.
 *   • Update an intake's status (reviewed / activated / rejected)
 *     with a reviewed_by / reviewed_at stamp.
 *
 * Realtime: subscribes to postgres_changes on client_intakes and
 * client_intake_links so two admins editing concurrently converge
 * without a manual refresh.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface IntakeRow {
  id: string;
  linkId: string | null;
  status: 'pending' | 'reviewed' | 'activated' | 'rejected';
  businessName: string;
  contactName: string;
  email: string;
  phone: string | null;
  businessAddress: string | null;
  website: string | null;
  billingContactName: string | null;
  billingEmail: string | null;
  billingAddress: string | null;
  notificationContacts: Array<{ name?: string; email: string }>;
  insuranceChoice: 'own_policy' | 'eis_coverage' | null;
  paymentAuthorized: boolean;
  signatureType: 'typed' | 'drawn' | null;
  signatureData: string | null;
  signedAt: string | null;
  initials: Record<string, string>;
  signedTcPdfPath: string | null;
  resaleCertPath: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  submittedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  activatedAt: string | null;
  notes: string | null;
}

export interface IntakeLinkRow {
  id: string;
  linkId: string;
  prospectName: string | null;
  prospectEmail: string | null;
  createdBy: string | null;
  expiresAt: string | null;
  usedAt: string | null;
  active: boolean;
  createdAt: string;
}

interface IntakeDbRow {
  id: string;
  link_id: string | null;
  status: string;
  business_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  business_address: string | null;
  website: string | null;
  billing_contact_name: string | null;
  billing_email: string | null;
  billing_address: string | null;
  notification_contacts: unknown;
  insurance_choice: string | null;
  payment_authorized: boolean | null;
  signature_type: string | null;
  signature_data: string | null;
  signed_at: string | null;
  initials: unknown;
  signed_tc_pdf_path: string | null;
  resale_cert_path: string | null;
  ip_address: string | null;
  user_agent: string | null;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  activated_at: string | null;
  notes: string | null;
}

interface IntakeLinkDbRow {
  id: string;
  link_id: string;
  prospect_name: string | null;
  prospect_email: string | null;
  created_by: string | null;
  expires_at: string | null;
  used_at: string | null;
  active: boolean | null;
  created_at: string;
}

function rowToIntake(r: IntakeDbRow): IntakeRow {
  return {
    id: r.id,
    linkId: r.link_id,
    status: (r.status as IntakeRow['status']) ?? 'pending',
    businessName: r.business_name,
    contactName: r.contact_name,
    email: r.email,
    phone: r.phone,
    businessAddress: r.business_address,
    website: r.website,
    billingContactName: r.billing_contact_name,
    billingEmail: r.billing_email,
    billingAddress: r.billing_address,
    notificationContacts: Array.isArray(r.notification_contacts)
      ? (r.notification_contacts as Array<{ name?: string; email: string }>)
      : [],
    insuranceChoice: (r.insurance_choice as IntakeRow['insuranceChoice']) ?? null,
    paymentAuthorized: r.payment_authorized === true,
    signatureType: (r.signature_type as IntakeRow['signatureType']) ?? null,
    signatureData: r.signature_data,
    signedAt: r.signed_at,
    initials: (r.initials && typeof r.initials === 'object') ? r.initials as Record<string, string> : {},
    signedTcPdfPath: r.signed_tc_pdf_path,
    resaleCertPath: r.resale_cert_path,
    ipAddress: r.ip_address,
    userAgent: r.user_agent,
    submittedAt: r.submitted_at,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    activatedAt: r.activated_at,
    notes: r.notes,
  };
}

function rowToLink(r: IntakeLinkDbRow): IntakeLinkRow {
  return {
    id: r.id,
    linkId: r.link_id,
    prospectName: r.prospect_name,
    prospectEmail: r.prospect_email,
    createdBy: r.created_by,
    expiresAt: r.expires_at,
    usedAt: r.used_at,
    active: r.active !== false,
    createdAt: r.created_at,
  };
}

export interface GenerateLinkPayload {
  prospectName?: string;
  prospectEmail?: string;
  expiresAt?: string | null;
}

export interface UseIntakeAdminResult {
  intakes: IntakeRow[];
  links: IntakeLinkRow[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  generateLink: (payload: GenerateLinkPayload) => Promise<IntakeLinkRow | null>;
  revokeLink: (id: string) => Promise<boolean>;
  updateStatus: (id: string, status: IntakeRow['status'], notes?: string) => Promise<boolean>;
  getFileSignedUrl: (path: string, expiresInSeconds?: number) => Promise<string | null>;
}

export function useIntakeAdmin(): UseIntakeAdminResult {
  const [intakes, setIntakes] = useState<IntakeRow[]>([]);
  const [links, setLinks]     = useState<IntakeLinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refetch = useCallback(async () => {
    setLoading(true); setError(null);
    const [iRes, lRes] = await Promise.all([
      supabase.from('client_intakes').select('*').order('submitted_at', { ascending: false }),
      supabase.from('client_intake_links').select('*').order('created_at', { ascending: false }),
    ]);
    if (!mountedRef.current) return;
    if (iRes.error) { setError(iRes.error.message); setIntakes([]); }
    else { setIntakes(((iRes.data ?? []) as IntakeDbRow[]).map(rowToIntake)); }
    if (!lRes.error && lRes.data) setLinks((lRes.data as IntakeLinkDbRow[]).map(rowToLink));
    setLoading(false);
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);

  // Realtime — a new submission (or another admin revoking a link)
  // lands without a manual refresh. Unique channel per mount avoids
  // collisions when two admin tabs are open.
  useEffect(() => {
    const ch = supabase
      .channel(`intake_admin_${Math.random().toString(36).slice(2, 10)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_intakes' },
        () => { void refetch(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_intake_links' },
        () => { void refetch(); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [refetch]);

  const generateLink = useCallback(async (payload: GenerateLinkPayload): Promise<IntakeLinkRow | null> => {
    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user.id ?? null;
    const row = {
      prospect_name:  payload.prospectName?.trim() || null,
      prospect_email: payload.prospectEmail?.trim().toLowerCase() || null,
      expires_at:     payload.expiresAt ?? null,
      created_by:     userId,
      active:         true,
    };
    const { data, error: err } = await supabase
      .from('client_intake_links')
      .insert(row)
      .select('*')
      .single();
    if (err || !data) { setError(err?.message ?? 'Link generation failed'); return null; }
    const link = rowToLink(data as IntakeLinkDbRow);
    setLinks(prev => [link, ...prev]);
    return link;
  }, []);

  const revokeLink = useCallback(async (id: string): Promise<boolean> => {
    const { error: err } = await supabase
      .from('client_intake_links')
      .update({ active: false })
      .eq('id', id);
    if (err) { setError(err.message); return false; }
    setLinks(prev => prev.map(l => l.id === id ? { ...l, active: false } : l));
    return true;
  }, []);

  const updateStatus = useCallback(async (id: string, status: IntakeRow['status'], notes?: string): Promise<boolean> => {
    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user.id ?? null;
    const patch: Record<string, unknown> = {
      status,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    };
    if (notes !== undefined) patch.notes = notes;
    if (status === 'activated') patch.activated_at = new Date().toISOString();
    const { data, error: err } = await supabase
      .from('client_intakes')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (err) { setError(err.message); return false; }
    if (data) {
      const updated = rowToIntake(data as IntakeDbRow);
      setIntakes(prev => prev.map(i => i.id === id ? updated : i));
    }
    return true;
  }, []);

  const getFileSignedUrl = useCallback(async (path: string, expiresInSeconds = 300): Promise<string | null> => {
    const { data, error: err } = await supabase.storage
      .from('documents')
      .createSignedUrl(path, expiresInSeconds);
    if (err || !data) return null;
    return data.signedUrl;
  }, []);

  return useMemo(() => ({
    intakes, links, loading, error, refetch,
    generateLink, revokeLink, updateStatus, getFileSignedUrl,
  }), [intakes, links, loading, error, refetch, generateLink, revokeLink, updateStatus, getFileSignedUrl]);
}
