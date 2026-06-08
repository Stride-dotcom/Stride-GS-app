/**
 * backfill-photo-thumbnails — one-shot admin backfill (batched + resumable).
 *
 * PR #664 bumped new-upload thumbnails 400px → 1000px. The ~6,437 existing
 * photos still carry 400px thumbnails baked into storage, so they look soft
 * on hi-DPI grid tiles (the lightbox loads the full-res original, which is
 * why opening a photo was always sharp). This function regenerates the
 * thumbnail at 1000px for a batch of pre-cutoff rows per invocation, writes
 * it back over the SAME thumbnail_key (so existing DB rows + signed URLs stay
 * valid), and stamps item_photos.thumb_regen_at so the work is resumable and
 * idempotent.
 *
 * Driven by a short-lived pg_cron job (same net.http_post + inlined
 * service-role bearer pattern as dt-sync-statuses). The job is removed once
 * `thumb_regen_at IS NULL AND thumbnail_key IS NOT NULL AND created_at <
 * cutoff` drains to zero.
 *
 * Body (all optional):
 *   { limit?: number,        // max rows to process this call (default 25)
 *     cutoffIso?: string,    // only rows created before this (default the
 *                            //   PR-#664 deploy boundary)
 *     maxEdge?: number,      // thumbnail long-edge px (default 1000)
 *     quality?: number,      // JPEG quality 1-100 (default 82)
 *     budgetMs?: number }    // stop starting new images after this elapsed
 *                            //   wall-clock (default 110000, under the edge
 *                            //   150s ceiling)
 *
 * Response:
 *   { ok, processed, skipped, failed, remaining, elapsedMs,
 *     avgMsPerImage, errors: [{ id, key, stage, message }] }
 *
 * Auth: verify_jwt left at the platform default; the cron caller sends the
 * service-role bearer which the gateway accepts. The function itself uses the
 * service role for storage + DB, so a caller can't escalate beyond the
 * idempotent thumbnail regeneration this performs.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Image } from 'https://deno.land/x/imagescript@1.2.17/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BUCKET = 'photos';
// Rows created on/after PR #664's deploy already have 1000px thumbs.
const DEFAULT_CUTOFF_ISO = '2026-06-08T23:00:00Z';
const DEFAULT_LIMIT = 25;
const DEFAULT_MAX_EDGE = 1000;
const DEFAULT_QUALITY = 82;
const DEFAULT_BUDGET_MS = 110_000;

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
    const limit     = Math.max(1, Math.min(200, Number(body.limit) || DEFAULT_LIMIT));
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
      if (Date.now() - startedAt > budgetMs) break;  // leave headroom under the edge ceiling
      const id = String(row.id);
      const origKey = String(row.storage_key || '');
      const thumbKey = String(row.thumbnail_key || '');
      if (!origKey || !thumbKey) { skipped++; continue; }

      // 1. Download the original. A download failure is treated as TRANSIENT —
      //    we don't stamp thumb_regen_at, so a later pass retries it.
      const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(origKey);
      if (dlErr || !blob) {
        failed++;
        errors.push({ id, key: origKey, stage: 'download', message: dlErr?.message || 'no blob' });
        continue;
      }

      // 2. Decode + resize + re-encode. A decode/encode failure is treated as
      //    PERMANENT (e.g. HEIC or a corrupt original) — we stamp thumb_regen_at
      //    so the batch advances and we don't retry a poison row forever. The
      //    old 400px thumb simply stays in place (grid still renders it).
      let out: Uint8Array;
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const img = await Image.decode(bytes);
        const longEdge = Math.max(img.width, img.height);
        if (longEdge > maxEdge) {
          const scale = maxEdge / longEdge;
          img.resize(Math.max(1, Math.round(img.width * scale)), Math.max(1, Math.round(img.height * scale)));
        }
        out = await img.encodeJPEG(quality);
      } catch (e) {
        failed++;
        errors.push({ id, key: origKey, stage: 'decode', message: (e as Error).message?.slice(0, 200) || 'decode error' });
        await supabase.from('item_photos').update({ thumb_regen_at: new Date().toISOString() }).eq('id', id);
        continue;
      }

      // 3. Overwrite the thumbnail at the SAME key (upsert). Keeps the DB row's
      //    thumbnail_key valid and lets cached signed URLs serve the new bytes.
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(thumbKey, out, {
        contentType: 'image/jpeg',
        upsert: true,
      });
      if (upErr) {
        failed++;
        errors.push({ id, key: thumbKey, stage: 'upload', message: upErr.message });
        continue;  // transient — don't stamp, retry next pass
      }

      // 4. Stamp success.
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

    // ── Remaining count for the driver to know when to stop ─────────────
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
