/**
 * get-shared-doc — Supabase Edge Function
 *
 * Serves a document file through a public share link, bypassing
 * storage RLS. The share validation IS the authorization: if the
 * photo_shares row is active, not expired, and its doc_ids array
 * contains the requested doc_id, the file is served — exactly the
 * predicate enforced by the documents_anon_read_via_share /
 * documents_storage_anon_read_via_share RLS policies (migration
 * 20260514120000_attachment_shares.sql), re-implemented here with
 * the service role so it works even when those storage policies are
 * not live in prod (the root cause behind PR #443's open risk).
 *
 *   GET /functions/v1/get-shared-doc?share_id=<slug>&doc_id=<uuid>
 *   → 200 file bytes, Content-Type = documents.mime_type
 *   → 400 missing/invalid params
 *   → 404 share inactive/expired/not found, or doc not in share,
 *         or doc soft-deleted, or object missing in storage
 *   → 500 server misconfigured / storage error
 *
 * share_id is the photo_shares.share_id text slug (the public URL
 * segment), NOT the table's uuid primary key. doc_id is documents.id.
 *
 * DEPLOY NOTE: this endpoint is opened directly by the browser
 * (anchor / fetch with NO Authorization header), so it MUST be
 * deployed with JWT verification disabled:
 *   npx supabase functions deploy get-shared-doc \
 *     --project-ref uqplppugeickmamycpuz --no-verify-jwt
 * Without --no-verify-jwt the Supabase gateway 401s before this
 * code runs.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DOCS_BUCKET = 'documents';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Loose RFC-4122 shape check — the .eq filter is the real guard, this
// just rejects obviously bogus input before it ever hits the DB.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Strip anything that could break out of the Content-Disposition
// header (CR/LF/quotes/backslash) and fall back to a safe default.
function safeFilename(name: string | null): string {
  const cleaned = (name ?? '').replace(/[\r\n"\\]/g, '').trim();
  return cleaned.length > 0 ? cleaned : 'document';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'GET') {
    return jsonError('Method not allowed', 405);
  }

  const url = new URL(req.url);
  const shareId = (url.searchParams.get('share_id') ?? '').trim();
  const docId = (url.searchParams.get('doc_id') ?? '').trim();

  if (!shareId || !docId) {
    return jsonError('share_id and doc_id are required', 400);
  }
  if (!UUID_RE.test(docId)) {
    return jsonError('doc_id is malformed', 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    console.error('[get-shared-doc] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return jsonError('Server misconfigured', 500);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  // 1. Resolve the share. Mirror the anon RLS predicate exactly:
  //    active = true AND (expires_at IS NULL OR expires_at > now()).
  const { data: share, error: shareErr } = await admin
    .from('photo_shares')
    .select('doc_ids, active, expires_at')
    .eq('share_id', shareId)
    .eq('active', true)
    .maybeSingle();

  if (shareErr) {
    console.error('[get-shared-doc] photo_shares lookup failed:', shareErr.message);
    return jsonError('Lookup failed', 500);
  }

  // Single generic 404 for every "you can't have this" case so the
  // endpoint can't be used to enumerate shares or document ids.
  const notAvailable = () => jsonError('Document not available', 404);

  if (!share) return notAvailable();
  if (share.expires_at && new Date(share.expires_at).getTime() <= Date.now()) {
    return notAvailable();
  }
  const docIds: string[] = Array.isArray(share.doc_ids) ? share.doc_ids : [];
  if (!docIds.includes(docId)) return notAvailable();

  // 2. Resolve the document. deleted_at IS NULL mirrors the RLS
  //    policy — a soft-deleted doc stays invisible even if it was
  //    curated into the share before deletion.
  const { data: doc, error: docErr } = await admin
    .from('documents')
    .select('storage_key, mime_type, file_name, deleted_at')
    .eq('id', docId)
    .maybeSingle();

  if (docErr) {
    console.error('[get-shared-doc] documents lookup failed:', docErr.message);
    return jsonError('Lookup failed', 500);
  }
  if (!doc || doc.deleted_at || !doc.storage_key) return notAvailable();

  // 3. Pull the bytes with the service role — bypasses storage RLS.
  const { data: blob, error: dlErr } = await admin.storage
    .from(DOCS_BUCKET)
    .download(doc.storage_key);

  if (dlErr || !blob) {
    console.error('[get-shared-doc] storage download failed:', dlErr?.message ?? 'no data');
    return notAvailable();
  }

  const contentType = doc.mime_type || 'application/octet-stream';
  const filename = safeFilename(doc.file_name);

  return new Response(blob.stream(), {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': contentType,
      // inline so PDFs/images open in the new tab; the encoded
      // form carries unicode filenames safely.
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
      // Share-gated content can be revoked at any time — never let a
      // proxy/CDN serve it back after revocation.
      'Cache-Control': 'no-store',
    },
  });
});
