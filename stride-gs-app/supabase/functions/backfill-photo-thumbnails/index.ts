/**
 * backfill-photo-thumbnails — one-shot admin backfill (batched + resumable).
 *
 * PR #664 bumped new-upload thumbnails 400px → 1000px. The ~6,446 existing
 * photos still carry 400px thumbnails baked into storage. This regenerates
 * them to 1000px STORED thumbnails so the grid is crisp for every photo.
 *
 * Resize engine: Supabase Storage image transformation (the render endpoint),
 * which is enabled on this project. We download the original THROUGH the
 * transform (width/height=maxEdge, resize=contain) so Supabase does the resize
 * server-side, then write those bytes back over the SAME thumbnail_key. The
 * edge worker only MOVES bytes — no client-side bitmap decode — so there's no
 * memory accumulation. (The first cut used ImageScript to decode/resize in the
 * worker and hit 546 WORKER_RESOURCE_LIMIT at batch=60 because 60 decoded
 * bitmaps blew the worker's memory cap; the transform approach removed that
 * ceiling and is also faster: ~860ms/img vs ~1290ms.)
 *
 * Transforms are used ONCE here as the resize engine; the grid keeps serving
 * the STORED thumbnails afterward, so there is no ongoing per-view transform
 * billing (that distinction was the reason we chose "backfill regenerate" over
 * "serve transforms live" for the grid).
 *
 * Body (all optional):
 *   { limit?: number,        // max rows per call (default 80)
 *     cutoffIso?: string,    // only rows created before this (default PR-#664 deploy)
 *     maxEdge?: number,      // thumbnail long-edge px (default 1000)
 *     quality?: number,      // JPEG quality 1-100 (default 82)
 *     budgetMs?: number }    // stop starting new images after this elapsed (default 100000)
 *
 * Response:
 *   { ok, processed, skipped, failed, remaining, elapsedMs, avgMsPerImage,
 *     errors: [{ id, key, stage, message }] }
 *
 * Driven by a short-lived pg_cron job `backfill-photo-thumbs-drain` (same
 * net.http_post + inlined service-role bearer pattern as dt-sync-statuses,
 * operational-only / not in source), removed once the queue drains.
 *
 * Auth: verify_jwt; the cron caller sends the service-role bearer which the
 * gateway accepts. The function itself uses the service role for storage + DB.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BUCKET = 'photos';
// Rows created on/after PR #664's deploy already have 1000px thumbs.
const DEFAULT_CUTOFF_ISO = '2026-06-08T23:00:00Z';
const DEFAULT_LIMIT = 80;
const DEFAULT_MAX_EDGE = 1000;
const DEFAULT_QUALITY = 82;
const DEFAULT_BUDGET_MS = 100_000;

interface ErrItem { id: string; key: string; stage: string; message: string }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const startedAt = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const limit     = Math.max(1, Math.min(500, Number(body.limit) || DEFAULT_LIMIT));
    const cutoffIso = typeof body.cutoffIso === 'string' && body.cutoffIso ? body.cutoffIso : DEFAULT_CUTOFF_ISO;
    const maxEdge   = Math.max(200, Math.min(4000, Number(body.maxEdge) || DEFAULT_MAX_EDGE));
    const quality   = Math.max(1, Math.min(100, Number(body.quality) || DEFAULT_QUALITY));
    const budgetMs  = Math.max(5_000, Math.min(140_000, Number(body.budgetMs) || DEFAULT_BUDGET_MS));

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceKey) {
      return json({ ok: false, error: 'Server misconfigured (missing env)' }, 500);
    }
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── Claim a batch of un-regenerated, pre-cutoff rows ────────────────
    const { data: rows, error: selErr } = await supabase
      .from('item_photos')
      .select('id, storage_key, thumbnail_key')
      .is('thumb_regen_at', null)
      .not('thumbnail_key', 'is', null)
      .lt('created_at', cutoffIso)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (selErr) return json({ ok: false, error: `select failed: ${selErr.message}` }, 500);

    let processed = 0, skipped = 0, failed = 0;
    const errors: ErrItem[] = [];

    for (const row of rows ?? []) {
      if (Date.now() - startedAt > budgetMs) break;  // leave headroom under the edge 150s ceiling
      const id = String(row.id);
      const origKey = String(row.storage_key || '');
      const thumbKey = String(row.thumbnail_key || '');
      if (!origKey || !thumbKey) { skipped++; continue; }

      // 1. Download the original THROUGH the transform so Supabase resizes it
      //    server-side. A failure here is treated as TRANSIENT (not stamped →
      //    retried on a later pass).
      const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(origKey, {
        transform: { width: maxEdge, height: maxEdge, resize: 'contain', quality },
      });
      if (dlErr || !blob) {
        failed++;
        errors.push({ id, key: origKey, stage: 'transform', message: dlErr?.message || 'no blob' });
        continue;
      }

      const bytes = new Uint8Array(await blob.arrayBuffer());
      // Guard: a transform error can come back as a tiny JSON/text body rather
      // than an image. Treat an implausibly small payload as a PERMANENT skip
      // (stamp so the batch advances) — the old 400px thumb stays in place and
      // a poison row can't stall the queue forever.
      if (bytes.byteLength < 512) {
        failed++;
        errors.push({ id, key: origKey, stage: 'transform', message: `tiny payload ${bytes.byteLength}b` });
        await supabase.from('item_photos').update({ thumb_regen_at: new Date().toISOString() }).eq('id', id);
        continue;
      }

      // 2. Overwrite the thumbnail at the SAME key (upsert). Keeps the DB row's
      //    thumbnail_key valid and lets cached signed URLs serve the new bytes.
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(thumbKey, bytes, {
        contentType: 'image/jpeg',
        upsert: true,
      });
      if (upErr) {
        failed++;
        errors.push({ id, key: thumbKey, stage: 'upload', message: upErr.message });
        continue;  // transient — don't stamp, retry next pass
      }

      // 3. Stamp success.
      const { error: updErr } = await supabase
        .from('item_photos')
        .update({ thumb_regen_at: new Date().toISOString() })
        .eq('id', id);
      if (updErr) {
        failed++;
        errors.push({ id, key: thumbKey, stage: 'stamp', message: updErr.message });
        continue;
      }
      processed++;
    }

    // ── Remaining count so the driver knows when to stop ────────────────
    const { count: remaining } = await supabase
      .from('item_photos')
      .select('id', { count: 'exact', head: true })
      .is('thumb_regen_at', null)
      .not('thumbnail_key', 'is', null)
      .lt('created_at', cutoffIso);

    const elapsedMs = Date.now() - startedAt;
    return json({
      ok: true,
      processed,
      skipped,
      failed,
      remaining: remaining ?? null,
      elapsedMs,
      avgMsPerImage: processed > 0 ? Math.round(elapsedMs / processed) : null,
      errors: errors.slice(0, 25),
    });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message || 'Internal error', elapsedMs: Date.now() - startedAt }, 500);
  }
});
