/**
 * useEmailTemplates — Supabase-backed CRUD for email/doc templates.
 *
 * Phase 6 (session 73): templates live in public.email_templates as the
 * primary source. React reads + writes go straight to Supabase (service
 * role bypasses RLS for GAS email sends; admin-role writes are enforced
 * by the "email_templates_write_admin" policy on the table).
 *
 * If Supabase returns 0 rows we fall back to the existing GAS endpoint
 * (`fetchEmailTemplates`) which auto-seeds from the MPL sheet on first
 * call — so the admin sees templates immediately even on a fresh table.
 *
 * Updates write one audit row per changed field to email_templates_audit
 * (best-effort — audit failure must not roll back the update).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { fetchEmailTemplates, type EmailTemplate } from '../lib/api';

interface EmailTemplateRow {
  id: string;
  template_key: string;
  subject: string;
  body: string;
  notes: string | null;
  recipients: string | null;
  attach_doc: string | null;
  category: string | null;
  active: boolean;
  updated_at: string;
}

type KnownCategory = EmailTemplate['category'];

function normalizeCategory(v: string | null | undefined): KnownCategory {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'document' || s === 'doc') return 'document';
  if (s === 'claim' || s === 'system') return s as KnownCategory;
  return 'email';
}

function rowToTemplate(row: EmailTemplateRow): EmailTemplate {
  return {
    key:        row.template_key,
    subject:    row.subject ?? '',
    bodyHtml:   row.body ?? '',
    notes:      row.notes ?? '',
    recipients: row.recipients ?? '',
    attachDoc:  row.attach_doc ?? '',
    category:   normalizeCategory(row.category),
  };
}

export interface UseEmailTemplatesResult {
  templates: EmailTemplate[];
  loading: boolean;
  error: string | null;
  /** `'supabase' | 'gas_fallback' | null` — visible for debugging + UI hints. */
  source: 'supabase' | 'gas_fallback' | null;
  refetch: () => Promise<void>;
  updateTemplate: (templateKey: string, updates: { subject?: string; bodyHtml?: string }) => Promise<EmailTemplate | null>;
}

export function useEmailTemplates(): UseEmailTemplatesResult {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'supabase' | 'gas_fallback' | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);

    // 1. Supabase-first.
    const { data, error: sbErr } = await supabase
      .from('email_templates')
      .select('id,template_key,subject,body,notes,recipients,attach_doc,category,active,updated_at')
      .order('template_key', { ascending: true });

    if (!mountedRef.current) return;

    if (!sbErr && data && data.length > 0) {
      setTemplates((data as EmailTemplateRow[]).filter(r => r.active !== false).map(rowToTemplate));
      setSource('supabase');
      setLoading(false);
      return;
    }

    // 2. GAS fallback — auto-seeds Supabase from MPL on first call.
    try {
      const resp = await fetchEmailTemplates();
      if (!mountedRef.current) return;
      if (resp.ok && resp.data?.success) {
        setTemplates(resp.data.templates ?? []);
        setSource('gas_fallback');
      } else {
        setError(resp.error || resp.data?.error || 'Failed to load templates');
      }
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);

  // Realtime — admin edits propagate across tabs in ~1s.
  useEffect(() => {
    const channel = supabase
      .channel('email_templates_live')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'email_templates' },
        () => { void refetch(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refetch]);

  const updateTemplate = useCallback(
    async (templateKey: string, updates: { subject?: string; bodyHtml?: string }): Promise<EmailTemplate | null> => {
      const before = templates.find(t => t.key === templateKey);
      if (!before) {
        setError('Template not found in local cache — refresh and try again');
        return null;
      }

      const patch: Record<string, unknown> = {};
      if (updates.subject !== undefined) patch.subject = updates.subject;
      if (updates.bodyHtml !== undefined) patch.body = updates.bodyHtml;
      if (Object.keys(patch).length === 0) return before;

      // 1. UPDATE on email_templates (RLS enforces admin role via JWT).
      const { data, error: err } = await supabase
        .from('email_templates')
        .update(patch)
        .eq('template_key', templateKey)
        .select('id,template_key,subject,body,notes,recipients,attach_doc,category,active,updated_at')
        .single();

      if (err || !data) {
        setError(err?.message ?? 'Update failed');
        return null;
      }
      const after = rowToTemplate(data as EmailTemplateRow);

      // 2. Audit rows — best-effort, one per changed field. Pull the auth
      //    user id from the current session so created_by is a real FK.
      try {
        const sessionResp = await supabase.auth.getUser();
        const authUid = sessionResp.data?.user?.id ?? null;
        const changedByName = user?.displayName || user?.email || null;
        const auditRows: Record<string, unknown>[] = [];
        if (updates.subject !== undefined && updates.subject !== before.subject) {
          auditRows.push({
            template_id:     (data as EmailTemplateRow).id,
            template_key:    templateKey,
            field_changed:   'subject',
            old_value:       before.subject,
            new_value:       updates.subject,
            changed_by:      authUid,
            changed_by_name: changedByName,
          });
        }
        if (updates.bodyHtml !== undefined && updates.bodyHtml !== before.bodyHtml) {
          auditRows.push({
            template_id:     (data as EmailTemplateRow).id,
            template_key:    templateKey,
            field_changed:   'body',
            old_value:       before.bodyHtml,
            new_value:       updates.bodyHtml,
            changed_by:      authUid,
            changed_by_name: changedByName,
          });
        }
        if (auditRows.length > 0) {
          await supabase.from('email_templates_audit').insert(auditRows);
        }
      } catch (auditErr) {
        console.warn('[email_templates_audit] insert failed (non-fatal):', auditErr);
      }

      // 3. Optimistic local update — Realtime will also fire a refetch.
      setTemplates(prev => prev.map(t => t.key === templateKey ? after : t));
      return after;
    },
    [templates, user],
  );

  return { templates, loading, error, source, refetch, updateTemplate };
}
