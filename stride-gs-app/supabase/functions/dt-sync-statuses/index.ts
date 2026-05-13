/**
 * dt-sync-statuses — Supabase Edge Function — v15 2026-05-13 PST
 *
 * v15: P+D mirror idempotency. The v14 INSERT-branch mirror could leave a
 *      PU line without a delivery counterpart if the mirror INSERT failed
 *      on first sync (PU line exists → next sync hits UPDATE branch, never
 *      retries). v15 adds a missing-counterpart check to the UPDATE branch
 *      so the mirror is back-filled on subsequent runs.
 *
 * v14: P+D mirror for driver-added PU lines. When the item-reconcile
 *      block INSERTs a new PU item (DT introduced a line outside our
 *      app — driver discovered an unexpected piece, etc.) AND the
 *      parent order has linked_order_id, also INSERT a matching
 *      delivery line with parent_pickup_item_id set. Description is
 *      stored clean (strips "PICK UP: PU:" prefix). Tier-B propagation
 *      at end of loop then stamps picked_up_at + audit columns on the
 *      new delivery item, and dt-push-order republishes the delivery
 *      so the manifest carries the new line.
 *
 * v13: PU→Delivery item-sync engine (Tier B). After the v12 pickup-stamp
 *      pass, when one or more delivery items were propagated (quantity
 *      from delivered_quantity, item_note merged with PU note + return
 *      codes via sentinel marker), fire-and-forget invoke dt-push-order
 *      so the DT delivery manifest reflects the post-PU reality before
 *      the delivery driver sees it.
 *
 * v12: Pickup-stamp pass at end of per-order loop. When a pickup-leg
 *      reaches Completed/Collected status, invoke the new shared helper
 *      stampPickupOnLinkedDelivery so the linked delivery row's
 *      linked_pickup_finished_at + linked_pickup_driver_name fields and
 *      the delivery items' picked_up_at flags get the real export.xml
 *      values (corrects the now()/null placeholder the webhook path
 *      stamps). Mirrors the v11 auto-release block; helper is
 *      idempotent + filters out orders without linked_order_id.
 *
 * v11: Fixed toIso parser. DT exports timestamps as "YYYY-MM-DD HH:MM:SS
 *      ±HHMM" (e.g. "2026-05-14 13:41:00 -0700"). Pre-v11's normalize
 *      step replaced ONLY the first space with T → "YYYY-MM-DDTHH:MM:SS
 *      ±HHMM", a form V8 rejects because the space before the timezone
 *      breaks ISO. Result: scheduled_at / started_at / finished_at /
 *      signature_captured_at silently became NULL across the fleet,
 *      surfacing as empty Service Date columns on the Digs Furniture
 *      orders list. The status_id update kept working because it
 *      doesn't go through toIso, so the bug was masked from headline
 *      "Sync to DT" testing.
 *
 *      v11 tries Date.parse on the raw input first (DT's space-separated
 *      form parses natively in V8) and keeps the normalize step as a
 *      fallback — now also stripping the space before the timezone offset
 *      so the output is actually valid ISO.
 *
 * v10 2026-04-28 PST
 *
 * v10: POD photo ingestion. Parses the new <images count="N"> block
 *      DT now includes in export.xml (admin enabled it via support
 *      ticket on 2026-04-28). For each <image>:
 *        • Stable id (32-hex hash from DT) is the dedupe key — DT
 *          rotates the src/thumbnail URLs every 30 min but keeps id
 *          stable, so we only fetch+upload bytes once.
 *        • Captures the full-res src and the thumbnail to the
 *          dt-pod-photos storage bucket (private; UI gets signed
 *          URLs). Path: `{dt_order_id}/{dt_image_id}.jpg` and
 *          `{dt_order_id}/thumb_{dt_image_id}.jpg`.
 *        • Upserts dt_order_photos by (dt_order_id, dt_image_id);
 *          fetch_attempts increments on retry, fetch_error captures
 *          any reason a fetch failed.
 *      Photo URLs from DT are public and expire 30 min after the
 *      export call; we capture bytes inline so the URL expiry is
 *      irrelevant to downstream consumers.
 *
 * v9: Dropped the `pushed_to_dt_at IS NOT NULL` filter. Older orders
 *     with source='reconcile' (sheet-backfilled) and no
 *     pushed_to_dt_at stamp were never being synced — they sat with
 *     status_id NULL forever even though DT had a real status for
 *     them. Now we sync any row with a dt_identifier that isn't
 *     already in a terminal status.
 *
 * v8 2026-04-25 PST: Look up DT orders by `dt_identifier` instead of `dt_dispatch_id`.
 *     Two reasons:
 *       1. `dt-push-order` doesn't capture a dispatch ID from DT's
 *          add_order response (DT returns only <success>...</success>),
 *          so app-pushed orders have dt_dispatch_id IS NULL forever.
 *          Until v7 they were filtered out and stayed "Awaiting DT
 *          Sync" indefinitely.
 *       2. The DT XML spec for /orders/api/export.xml takes
 *          `service_order_id={Order_Number}` — that's the human
 *          identifier (e.g. "MRS-00002"), not the numeric dispatch ID.
 *          We always have dt_identifier on every row.
 *     Filter: `pushed_to_dt_at IS NOT NULL` (instead of dt_dispatch_id).
 *     URL: `service_order_id=${dt_identifier}`.
 *
 * v7:
 * v7: Switched from the code-only `/orders/api/get_order_status` endpoint
 *     to the rich `/orders/api/export.xml?service_order_id=…` per-order
 *     endpoint. We now mirror the full DT completion payload back into
 *     the cache instead of only the status code:
 *       • dt_orders top-level: status, started_at, finished_at,
 *         scheduled_at, driver, truck, service_unit, stop_number,
 *         actual_service_time_minutes, payment_collected, payment_notes,
 *         cod_amount, signature_captured_at, dt_status_code,
 *         dt_export_payload (raw parsed JSON for debugging).
 *       • dt_order_items (matched by dt_item_code): delivered,
 *         delivered_quantity, item_note, checked_quantity, location,
 *         return_codes.
 *       • dt_order_history: replace-on-sync per order with the events
 *         DT returns (date/time/lat/lng/code/description/owner).
 *       • dt_order_notes: replace-on-sync for source='dt_export' so
 *         driver/dispatcher-added DT-side notes flow back without
 *         clobbering app-authored ones.
 *     Backwards-compat: the same auto-Collected branch fires when DT
 *     reports completion on an already-paid order.
 *
 * v6 (prior): missing-credentials path returns ok:false; statuses fetched once.
 * v5 (prior): api_key query param auth; terminal-category filter; same-status guard.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { releaseInventoryOnDtFinished } from '../_shared/release-on-dt-finished.ts';
import { stampPickupOnLinkedDelivery } from '../_shared/stamp-pickup-on-linked-delivery.ts';

const STATUS_COLLECTED = 22;
const STATUS_COMPLETED = 3;

interface SyncBody {
  scope?: 'active' | 'all';
  orderId?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  let body: SyncBody = {};
  try { body = await req.json(); } catch (_) { body = {}; }
  const scope = body.scope || 'active';
  const singleOrderId = body.orderId;

  const { data: cred, error: credErr } = await supabase
    .from('dt_credentials').select('*').limit(1).maybeSingle();
  if (credErr) return json({ ok: false, error: `Credentials read failed: ${credErr.message}` }, 500);
  const haveCreds = !!(cred?.auth_token_encrypted && cred?.api_base_url);

  const { data: statusRows } = await supabase
    .from('dt_statuses').select('id, code, category');
  const allStatuses = (statusRows || []) as Array<{ id: number; code: string | null; category: string }>;
  const statusByCode = new Map<string, { id: number; category: string }>();
  for (const s of allStatuses) {
    if (s.code) statusByCode.set(String(s.code).toUpperCase(), { id: s.id, category: s.category });
  }

  // v9: sync every row with a dt_identifier that isn't already in a
  // terminal status. Drops the previous pushed_to_dt_at filter so
  // legacy reconciled rows (source='reconcile') also pull statuses.
  let query = supabase
    .from('dt_orders')
    .select('id, dt_identifier, dt_dispatch_id, status_id, last_synced_at, tenant_id, paid_at, order_type, linked_order_id')
    .not('dt_identifier', 'is', null);

  if (singleOrderId) {
    query = query.eq('id', singleOrderId);
  } else if (scope === 'active') {
    const terminalIds = allStatuses
      .filter(s => s.category === 'completed' || s.category === 'cancelled' || s.category === 'exception' || s.category === 'billing')
      .map(s => s.id);
    if (terminalIds.length > 0) {
      query = query.or(`status_id.is.null,status_id.not.in.(${terminalIds.join(',')})`);
    }
  }

  const { data: orders, error: fetchErr } = await query;
  if (fetchErr) return json({ ok: false, error: `Order fetch failed: ${fetchErr.message}` }, 500);

  const result = {
    ok: true,
    checked: orders?.length ?? 0,
    updated: 0,
    completed: 0,
    errors: [] as string[],
    note: '',
  };

  if (!orders || orders.length === 0) {
    result.note = 'No pushed orders need syncing.';
    return json(result);
  }

  if (!haveCreds) {
    const nowIso = new Date().toISOString();
    const ids = orders.map(o => o.id);
    const { error: touchErr } = await supabase.from('dt_orders').update({ last_synced_at: nowIso }).in('id', ids);
    if (touchErr) result.errors.push(`Timestamp update failed: ${touchErr.message}`);
    result.ok = false;
    result.note = 'DT credentials not configured.';
    return json(result, 503);
  }

  const baseUrl = String(cred!.api_base_url).replace(/\/+$/, '');
  const apiKey  = String(cred!.auth_token_encrypted);

  for (const o of orders) {
    try {
      // DT's `service_order_id` parameter accepts the Order_Number
      // (human identifier) per the XML API spec. Prefer dt_identifier;
      // fall back to dt_dispatch_id for legacy webhook rows that may
      // only have the numeric ID.
      const lookupId = o.dt_identifier || (o.dt_dispatch_id != null ? String(o.dt_dispatch_id) : '');
      if (!lookupId) { result.errors.push(`${o.id}: no dt_identifier or dt_dispatch_id`); continue; }
      const url = `${baseUrl}/orders/api/export.xml?code=expressinstallation&api_key=${encodeURIComponent(apiKey)}&service_order_id=${encodeURIComponent(lookupId)}`;
      const resp = await fetch(url, { method: 'POST', headers: { 'Accept': 'application/xml' } });
      if (!resp.ok) { result.errors.push(`${o.dt_identifier}: HTTP ${resp.status}`); continue; }
      const xml = await resp.text();
      const parsed = parseExportOrder(xml);
      if (!parsed) { result.errors.push(`${o.dt_identifier}: empty/invalid export response`); continue; }

      // ── status code → status_id resolution ───────────────────────────
      const dtStatusCode = (parsed.status || '').toUpperCase();
      let finalStatusId: number | null = null;
      let category: string | null = null;
      if (dtStatusCode) {
        const match = statusByCode.get(dtStatusCode);
        if (match) {
          finalStatusId = match.id;
          category = match.category;
          if (category === 'completed' && o.paid_at) {
            finalStatusId = STATUS_COLLECTED;
          }
        } else {
          result.errors.push(`${o.dt_identifier}: unknown DT status "${dtStatusCode}"`);
        }
      }

      // ── update dt_orders row ────────────────────────────────────────
      const patch: Record<string, unknown> = {
        last_synced_at:               new Date().toISOString(),
        dt_status_code:               dtStatusCode || null,
        dt_export_payload:            parsed,
        scheduled_at:                 toIso(parsed.scheduled_at),
        started_at:                   toIso(parsed.started_at),
        finished_at:                  toIso(parsed.finished_at),
        actual_service_time_minutes:  parsed.service_time,
        driver_id:                    parsed.driver?.id ?? null,
        driver_name:                  parsed.driver?.name ?? null,
        truck_id:                     parsed.truck?.id ?? null,
        truck_name:                   parsed.truck?.name ?? null,
        service_unit:                 parsed.service_unit,
        stop_number:                  parsed.stop_number,
        payment_collected:            parsed.payment_collected,
        payment_notes:                parsed.payment_notes,
        cod_amount:                   parsed.cod_amount,
        signature_captured_at:        toIso(parsed.signature_captured_at),
      };
      if (finalStatusId != null && finalStatusId !== o.status_id) {
        patch.status_id = finalStatusId;
        if (category === 'completed') result.completed += 1;
      }

      const { error: updErr } = await supabase.from('dt_orders').update(patch).eq('id', o.id);
      if (updErr) { result.errors.push(`${o.dt_identifier}: ${updErr.message}`); continue; }
      result.updated += 1;

      // "Is finished now" signal for the post-reconcile auto-release.
      // We DON'T require a transition (was-not-3, now-3) because the
      // common webhook→sync handoff is:
      //   1. Webhook arrives → updates o.status_id=3 directly
      //   2. Webhook fire-and-forgets dt-sync-statuses({orderId})
      //   3. Sync runs: DT confirms Finished, but o.status_id is
      //      already 3 in our DB → transition check would fail
      // Firing on "is Finished or Collected" (whether or not we
      // transitioned this poll) handles that handoff. Idempotency in
      // the helper (`.neq('status','Released')`) prevents double-
      // releases when the periodic sync re-encounters the same order.
      const orderIsFinishedAfterPoll =
        finalStatusId === STATUS_COMPLETED || finalStatusId === STATUS_COLLECTED ||
        (finalStatusId == null && (o.status_id === STATUS_COMPLETED || o.status_id === STATUS_COLLECTED));
      const orderTypeIsRelease = (o as { order_type?: string | null }).order_type !== 'pickup';

      // ── dt_order_items reconcile ─────────────────────────────────────
      // Three-way merge keyed on dt_item_code:
      //   • Both sides present → UPDATE driver-facing fields (delivered
      //     quantities, location, item_note, return codes).
      //   • DT has it, Stride doesn't → INSERT a new row stamped
      //     extras.added_by='dt_sync'. Description + quantity carry over
      //     from the DT export so the operator can identify the addition.
      //   • Stride has it, DT doesn't → soft-mark removed_at + removed_source.
      //     We never hard-delete: keeps billing/audit history intact and
      //     leaves a trail if a DT-side delete was unintended.
      //
      // The "Stride has it, DT doesn't" branch only fires when DT actually
      // returned an items block. An empty <items/> on a service-only or
      // not-yet-loaded DT order would otherwise nuke every line locally —
      // we treat empty-from-DT as "no changes" rather than "all removed".
      if (parsed.items.length > 0) {
        const dtItemIds = new Set(
          parsed.items.map(it => it.item_id).filter((s): s is string => !!s)
        );

        // Snapshot current Stride rows for this order (active only — we
        // ignore already-removed rows so DT can re-add a code without us
        // un-removing the historical row).
        const { data: localRows } = await supabase
          .from('dt_order_items')
          .select('id, dt_item_code, extras')
          .eq('dt_order_id', o.id)
          .is('removed_at', null);
        const localByCode = new Map<string, { id: string; extras: Record<string, unknown> | null }>();
        for (const r of (localRows ?? []) as Array<{ id: string; dt_item_code: string | null; extras: Record<string, unknown> | null }>) {
          if (r.dt_item_code) localByCode.set(r.dt_item_code, { id: r.id, extras: r.extras });
        }

        // Helper for the P+D mirror branch (used by both INSERT-new and
        // UPDATE-existing paths). Strips the "PICK UP: PU:" prefix DT
        // adds to pickup-leg descriptions so the delivery row reads
        // clean — matches the convention used by CreateDeliveryOrderModal
        // at L1459 ("Description format is stored CLEAN ... on either leg").
        const stripPuPrefix = (raw: string | null | undefined): string => {
          return (raw ?? '').replace(/^\s*(PICK\s*UP:\s*)?(PU:\s*)?/i, '').replace(/\s+/g, ' ').trim();
        };
        const createMirrorOnDelivery = async (puItemId: string, puIt: typeof parsed.items[number]) => {
          const cleanDesc = stripPuPrefix(puIt.description) || (puIt.description ?? '');
          const mirrorRes = await supabase.from('dt_order_items').insert({
            dt_order_id:           o.linked_order_id,
            dt_item_code:          null,  // delivery doesn't have a DT-side id yet; dt-push-order will assign on next push
            description:           cleanDesc,
            quantity:              puIt.quantity,
            original_quantity:     puIt.quantity,
            parent_pickup_item_id: puItemId,
            extras:                { source: 'pickup_added_in_dt_mirrored', added_at: new Date().toISOString() },
            last_synced_at:        new Date().toISOString(),
          });
          if (mirrorRes.error) {
            result.errors.push(`${o.dt_identifier} P+D mirror insert for new PU item ${puIt.item_id}: ${mirrorRes.error.message}`);
          } else {
            console.log(`[dt-sync-statuses] P+D mirror — created delivery counterpart for new PU item ${puIt.item_id} on order=${o.dt_identifier}`);
          }
        };

        // UPDATE matching + INSERT new
        for (const it of parsed.items) {
          if (!it.item_id) continue;
          const local = localByCode.get(it.item_id);
          if (local) {
            await supabase.from('dt_order_items').update({
              delivered:          it.delivered,
              delivered_quantity: it.delivered_quantity,
              item_note:          it.item_note,
              checked_quantity:   it.checked_quantity,
              location:           it.location,
              return_codes:       it.return_codes,
              last_synced_at:     new Date().toISOString(),
            }).eq('id', local.id);
            // Idempotency: if a prior sync run inserted the PU line but
            // the mirror INSERT failed, the PU line is now in the UPDATE
            // branch and would never get its delivery counterpart created.
            // Detect missing counterparts here and back-fill. Only runs
            // for P+D pairs where the PU line was added by dt_sync (not
            // by the app's CreateDeliveryOrderModal — those already have
            // mirrors created at the modal save).
            if (o.order_type === 'pickup' && o.linked_order_id) {
              const addedByDtSync = (local.extras as Record<string, unknown> | null)?.added_by === 'dt_sync';
              if (addedByDtSync) {
                const { data: existingMirror } = await supabase
                  .from('dt_order_items')
                  .select('id')
                  .eq('dt_order_id', o.linked_order_id)
                  .eq('parent_pickup_item_id', local.id)
                  .is('removed_at', null)
                  .limit(1)
                  .maybeSingle();
                if (!existingMirror) {
                  await createMirrorOnDelivery(local.id, it);
                }
              }
            }
          } else {
            // Insert: DT introduced this line outside our app. Stamp
            // extras.added_by so downstream surfaces (Order page badges,
            // billing review) can flag it for an operator double-check.
            //
            // .select('id').single() returns the new row id so the P+D
            // mirror block below can create a matching delivery item with
            // parent_pickup_item_id set. Without this we'd have a PU line
            // with no delivery counterpart — the driver discovered a piece
            // we didn't know about, but the delivery manifest still doesn't
            // know to load it.
            const insRes = await supabase.from('dt_order_items').insert({
              dt_order_id:        o.id,
              dt_item_code:       it.item_id,
              description:        it.description,
              quantity:           it.quantity,
              original_quantity:  it.quantity,
              delivered:          it.delivered,
              delivered_quantity: it.delivered_quantity,
              item_note:          it.item_note,
              checked_quantity:   it.checked_quantity,
              location:           it.location,
              return_codes:       it.return_codes,
              extras:             { added_by: 'dt_sync', added_at: new Date().toISOString() },
              last_synced_at:     new Date().toISOString(),
            }).select('id').single();
            if (insRes.error) {
              result.errors.push(`${o.dt_identifier} item insert ${it.item_id}: ${insRes.error.message}`);
            } else if (insRes.data && o.order_type === 'pickup' && o.linked_order_id) {
              // P+D mirror — driver added a line to the PU manifest in DT
              // that didn't exist when the pair was created. Insert a
              // matching delivery line linked back to this PU item via
              // parent_pickup_item_id so:
              //   (a) the delivery manifest will carry the line when
              //       dt-push-order republishes the delivery,
              //   (b) Tier-B propagation at end of loop will stamp
              //       picked_up_at + audit columns on the new delivery
              //       item (if the PU item is already delivered=true).
              // Retry path: if this mirror INSERT fails, the next sync
              // run will hit the UPDATE branch above (the PU item now
              // exists locally) and will back-fill the mirror via the
              // existing-counterpart check.
              await createMirrorOnDelivery((insRes.data as { id: string }).id, it);
            }
          }
        }

        // Soft-remove Stride-only items (DT no longer carries them).
        const orphanIds: string[] = [];
        for (const [code, row] of localByCode) {
          if (!dtItemIds.has(code)) orphanIds.push(row.id);
        }
        if (orphanIds.length > 0) {
          const { error: rmErr } = await supabase
            .from('dt_order_items')
            .update({
              removed_at:     new Date().toISOString(),
              removed_source: 'dt_sync',
              last_synced_at: new Date().toISOString(),
            })
            .in('id', orphanIds);
          if (rmErr) result.errors.push(`${o.dt_identifier} item remove: ${rmErr.message}`);
        }
      }

      // ── dt_order_history : replace source='dt_export' rows ──────────
      // Build the insert payload first; only delete if the new payload is
      // valid (else we'd nuke the cache when DT returns one bad timestamp).
      // happened_at is NOT NULL in the schema, so rows that don't normalize
      // to ISO are dropped rather than blocking the whole batch.
      const historyRows = parsed.history
        .map(h => ({
          dt_order_id: o.id,
          code:        h.code,
          description: h.description,
          happened_at: toIso(h.happened_at),
          owner_id:    h.owner_id,
          owner_name:  h.owner_name,
          owner_type:  h.owner_type,
          lat:         h.lat,
          lng:         h.lng,
          source:      'dt_export',
        }))
        .filter(r => r.happened_at != null);
      await supabase.from('dt_order_history').delete()
        .eq('dt_order_id', o.id).eq('source', 'dt_export');
      if (historyRows.length > 0) {
        const { error: histErr } = await supabase.from('dt_order_history').insert(historyRows);
        if (histErr) result.errors.push(`${o.dt_identifier} history: ${histErr.message}`);
      }

      // ── dt_order_notes : replace source='dt_export' rows ────────────
      const noteRows = parsed.notes.map(n => ({
        dt_order_id:   o.id,
        body:          n.body,
        author_name:   n.author,
        author_type:   inferAuthorType(n.author),
        visibility:    'public',
        created_at_dt: toIso(n.created_at),
        source:        'dt_export',
      }));
      await supabase.from('dt_order_notes').delete()
        .eq('dt_order_id', o.id).eq('source', 'dt_export');
      if (noteRows.length > 0) {
        const { error: noteErr } = await supabase.from('dt_order_notes').insert(noteRows);
        if (noteErr) result.errors.push(`${o.dt_identifier} notes: ${noteErr.message}`);
      }

      // ── dt_order_photos : ingest <images> from export ────────────────
      // DT's photo URLs expire 30 min after this export call, so we
      // fetch the bytes and upload to our durable storage NOW. Subsequent
      // syncs skip fetch when storage_path is already set for the image.
      for (const img of parsed.images) {
        if (!img.id) continue;
        const { data: existing } = await supabase
          .from('dt_order_photos')
          .select('id, storage_path, thumbnail_path, fetch_attempts')
          .eq('dt_order_id', o.id)
          .eq('dt_image_id', img.id)
          .maybeSingle();
        const existingRow = existing as { id: string; storage_path: string | null; thumbnail_path: string | null; fetch_attempts: number | null } | null;
        if (existingRow?.storage_path && existingRow?.thumbnail_path) {
          continue; // already captured
        }
        const fullPath  = `${o.id}/${img.id}.jpg`;
        const thumbPath = `${o.id}/thumb_${img.id}.jpg`;
        let storagePath: string | null = existingRow?.storage_path ?? null;
        let thumbnailPath: string | null = existingRow?.thumbnail_path ?? null;
        let fetchError: string | null = null;
        let contentType: string | null = null;
        let sizeBytes: number | null = null;
        try {
          if (!storagePath && img.src) {
            const r = await fetch(img.src);
            if (!r.ok) throw new Error(`full-res HTTP ${r.status}`);
            const buf = new Uint8Array(await r.arrayBuffer());
            contentType = r.headers.get('content-type') || 'image/jpeg';
            sizeBytes   = buf.byteLength;
            const { error: upErr } = await supabase.storage
              .from('dt-pod-photos')
              .upload(fullPath, buf, { contentType, upsert: true });
            if (upErr) throw new Error(`storage upload (full): ${upErr.message}`);
            storagePath = fullPath;
          }
          if (!thumbnailPath && img.thumbnail) {
            const r = await fetch(img.thumbnail);
            if (!r.ok) throw new Error(`thumb HTTP ${r.status}`);
            const buf = new Uint8Array(await r.arrayBuffer());
            const { error: upErr } = await supabase.storage
              .from('dt-pod-photos')
              .upload(thumbPath, buf, { contentType: r.headers.get('content-type') || 'image/jpeg', upsert: true });
            if (upErr) throw new Error(`storage upload (thumb): ${upErr.message}`);
            thumbnailPath = thumbPath;
          }
        } catch (fe) {
          fetchError = fe instanceof Error ? fe.message : String(fe);
        }
        const photoRow: Record<string, unknown> = {
          dt_order_id:      o.id,
          dt_image_id:      img.id,
          dt_image_name:    img.name,
          dt_url:           img.src,
          thumbnail_dt_url: img.thumbnail,
          storage_path:     storagePath,
          thumbnail_path:   thumbnailPath,
          content_type:     contentType,
          size_bytes:       sizeBytes,
          captured_at:      toIso(img.created_at),
          fetched_at:       fetchError ? null : new Date().toISOString(),
          fetch_attempts:   (existingRow?.fetch_attempts ?? 0) + 1,
          fetch_error:      fetchError,
          kind:             'pod',
        };
        const { error: photoErr } = await supabase.from('dt_order_photos').upsert(photoRow, {
          onConflict: 'dt_order_id,dt_image_id',
        });
        if (photoErr) result.errors.push(`${o.dt_identifier} photo ${img.id}: ${photoErr.message}`);
        else if (fetchError) result.errors.push(`${o.dt_identifier} photo ${img.id}: ${fetchError}`);
      }

      // ── Auto-release inventory on the Completed-status transition ────
      // Fires only when this poll DETECTED the transition (was not 3,
      // now is 3) and only for non-pickup orders. dt_order_items has
      // just been reconciled above, so `delivered=true` flags are
      // freshly upserted before the helper reads them. Mirrors the
      // dt-webhook-ingest trigger; if a webhook already fired the
      // helper, the .neq('status','Released') guard makes this a
      // clean no-op. Failures are internal to the helper (land in
      // gs_sync_events for FailedOperationsDrawer); the status update
      // is independent of the release-mirror.
      if (orderIsFinishedAfterPoll && orderTypeIsRelease) {
        const releaseResult = await releaseInventoryOnDtFinished({
          supabase,
          gasUrl:    Deno.env.get('GAS_API_URL'),
          gasToken:  Deno.env.get('GAS_API_TOKEN'),
          dtOrderId: o.id,
          source:    'dt_sync',
        });
        if (releaseResult.fired) {
          console.log(
            `[dt-sync-statuses] auto-release order=${o.dt_identifier} ` +
            `released=${releaseResult.itemsReleased} ` +
            `skipped_already=${releaseResult.itemsAlreadyReleased} ` +
            `skipped_not_delivered=${releaseResult.itemsSkippedNotDelivered} ` +
            `mirror_ok=${releaseResult.mirrorOk}`
          );
        } else if (releaseResult.skippedReason) {
          console.log(`[dt-sync-statuses] auto-release order=${o.dt_identifier} skipped: ${releaseResult.skippedReason}`);
        }
      }

      // ── Pickup-leg completion → stamp linked delivery row ────────────
      // Mirror of the auto-release block above, but for the PU side of
      // a P+D pair. The webhook path (notify-pickup-completed) stamps
      // linked_pickup_finished_at = now() and driver_name = null because
      // DT export.xml lags the Service_Route_Finished webhook by a poll
      // cycle. By the time this sync re-encounters the pickup, the row
      // has real finished_at + driver_name from export.xml, so the
      // helper overwrites the placeholder with the accurate values.
      // Helper short-circuits on orders without linked_order_id, so
      // standalone pickups are cheap no-ops.
      if (orderIsFinishedAfterPoll && !orderTypeIsRelease) {
        const stampResult = await stampPickupOnLinkedDelivery({
          supabase,
          pickupOrderId: o.id,
          source: 'sync',
          // Tier B: the dt_order_items reconcile block above has just
          // refreshed PU items from export.xml, so delivered_quantity /
          // item_note / return_codes are export-fresh. Safe to propagate.
          propagateItemFields: true,
        });
        if (stampResult.fired) {
          console.log(
            `[dt-sync-statuses] pickup-stamp order=${o.dt_identifier} ` +
            `linked=${stampResult.linkedDeliveryId} ` +
            `order_level=${stampResult.orderLevelStamped} ` +
            `items_stamped=${stampResult.itemsStamped}/${stampResult.itemsEligibleOnPickup} ` +
            `items_propagated=${stampResult.itemsPropagated.length}`
          );
        } else if (stampResult.skippedReason && stampResult.skippedReason !== 'no_linked_delivery') {
          console.log(`[dt-sync-statuses] pickup-stamp order=${o.dt_identifier} skipped: ${stampResult.skippedReason}`);
        }

        // ── Push-back: re-push the linked delivery to DT ──────────────────
        // When Tier-B propagation modified one or more delivery items, the
        // DT delivery manifest needs to reflect the reality (qty + notes)
        // so the eventual delivery driver sees what's actually coming.
        // dt-push-order rebuilds the order's manifest from current Supabase
        // state, so a single invocation suffices regardless of how many
        // items changed. Fire-and-forget — failures land in
        // dt_orders.push_error / sync_events for FailedOperationsDrawer.
        if (stampResult.fired && stampResult.itemsPropagated.length > 0 && stampResult.linkedDeliveryId) {
          const pushUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/dt-push-order`;
          const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const linkedDeliveryId = stampResult.linkedDeliveryId;
          const propagatedCount = stampResult.itemsPropagated.length;
          const pushPromise = fetch(pushUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${svcKey}`,
              'apikey': svcKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ orderId: linkedDeliveryId }),
          }).then(async (resp) => {
            const txt = await resp.text().catch(() => '');
            if (!resp.ok) {
              console.warn(`[dt-sync-statuses] dt-push-order returned ${resp.status} for delivery=${linkedDeliveryId}: ${txt.slice(0, 200)}`);
              // Surface dispatch failure to FailedOperationsDrawer.
              // dt-push-order itself may write its own push_error
              // when reached, but a transient network/TLS failure
              // before the function runs would otherwise be silent.
              await supabase.from('gs_sync_events').insert({
                tenant_id:     o.tenant_id,
                entity_type:   'dt_order',
                entity_id:     linkedDeliveryId,
                action_type:   'dt_push_order_after_pu_sync',
                sync_status:   'sync_failed',
                requested_by:  'dt-sync-statuses:pu_propagate',
                request_id:    crypto.randomUUID(),
                payload:       { items_propagated: propagatedCount },
                error_message: `HTTP ${resp.status}: ${txt.slice(0, 500)}`,
              });
            } else {
              console.log(`[dt-sync-statuses] dt-push-order dispatched for delivery=${linkedDeliveryId} (${propagatedCount} items propagated)`);
            }
          }).catch(async (err) => {
            const msg = (err as Error).message;
            console.warn(`[dt-sync-statuses] dt-push-order dispatch failed for delivery=${linkedDeliveryId}: ${msg}`);
            // Network / TLS / fetch-level failure — record so it
            // doesn't disappear.
            await supabase.from('gs_sync_events').insert({
              tenant_id:     o.tenant_id,
              entity_type:   'dt_order',
              entity_id:     linkedDeliveryId,
              action_type:   'dt_push_order_after_pu_sync',
              sync_status:   'sync_failed',
              requested_by:  'dt-sync-statuses:pu_propagate',
              request_id:    crypto.randomUUID(),
              payload:       { items_propagated: propagatedCount },
              error_message: `dispatch failed: ${msg.slice(0, 500)}`,
            }).then(() => {}, () => {});
          });
          const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
          if (edgeRuntime && typeof edgeRuntime.waitUntil === 'function') {
            edgeRuntime.waitUntil(pushPromise);
          }
        }
      }
    } catch (e) {
      result.errors.push(`${o.dt_identifier}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await new Promise(r => setTimeout(r, 100));
  }

  return json(result);
});

// ─── XML parsing ─────────────────────────────────────────────────────────
//
// Deno doesn't ship a DOMParser by default, so we use targeted regex
// extractors. This is safe-ish here because the DT export.xml schema is
// stable and well-formed; we only pull the fields we know about and
// tolerate missing tags. Any unexpected nesting just produces null/[] and
// the writer handles that gracefully.

interface ParsedHistoryEvent {
  code: number | null;
  description: string | null;
  happened_at: string | null;
  owner_id: number | null;
  owner_name: string | null;
  owner_type: string | null;
  lat: number | null;
  lng: number | null;
}

interface ParsedNote {
  body: string;
  author: string | null;
  created_at: string | null;
  note_type: string | null;
}

interface ParsedImage {
  id: string | null;        // stable hash; dedupe key
  name: string | null;      // filename
  src: string | null;       // ephemeral full-res URL (30 min)
  thumbnail: string | null; // ephemeral thumbnail URL (30 min)
  created_at: string | null;// when the driver took the photo
}

interface ParsedItem {
  item_id: string | null;
  /** v11 — captured for the reconcile path so DT-side item additions
   *  produce a usable Stride row (we'd otherwise insert with NULL
   *  description and the operator wouldn't know what got added). */
  description: string | null;
  quantity: number | null;
  delivered: boolean | null;
  delivered_quantity: number | null;
  item_note: string | null;
  checked_quantity: number | null;
  location: string | null;
  return_codes: unknown;
}

interface ParsedExport {
  status: string | null;
  service_unit: string | null;
  stop_number: number | null;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  service_time: number | null;
  payment_collected: boolean | null;
  payment_notes: string | null;
  cod_amount: number | null;
  signature_captured_at: string | null;
  truck: { id: number | null; name: string | null } | null;
  driver: { id: number | null; name: string | null } | null;
  items: ParsedItem[];
  notes: ParsedNote[];
  history: ParsedHistoryEvent[];
  images: ParsedImage[];
}

function parseExportOrder(xml: string): ParsedExport | null {
  const orderXml = section(xml, 'service_order');
  if (!orderXml) return null;

  return {
    status:                tag(orderXml, 'status'),
    service_unit:          tag(orderXml, 'service_unit'),
    stop_number:           toInt(tag(orderXml, 'stop_number')),
    scheduled_at:          tag(orderXml, 'scheduled_at'),
    started_at:            tag(orderXml, 'started_at'),
    finished_at:           tag(orderXml, 'finished_at'),
    service_time:          toInt(tag(orderXml, 'service_time')),
    payment_collected:     toBool(tag(orderXml, 'payment_collected')),
    payment_notes:         tag(orderXml, 'payment_notes'),
    cod_amount:            toNum(tag(orderXml, 'cod_amount')),
    signature_captured_at: signatureCreatedAt(orderXml),
    truck:                 parseTruck(orderXml),
    driver:                parseFirstDriver(orderXml),
    items:                 parseItems(orderXml),
    notes:                 parseNotes(orderXml),
    history:               parseHistory(orderXml),
    images:                parseImages(orderXml),
  };
}

// Parse the <images count="N"> block. DT shape:
//   <images count="2">
//     <image id="..." name="..." title="..." src="https://..."
//            thumbnail="https://..." created_at="2026-04-27 11:32:51 -0700"/>
//   </images>
// Self-closing element with all data on attributes.
function parseImages(xml: string): ParsedImage[] {
  const block = section(xml, 'images') ?? '';
  if (!block) return [];
  const out: ParsedImage[] = [];
  for (const a of attrs(block, 'image')) {
    if (!a.id && !a.src) continue; // skip the wrapper or junk
    out.push({
      id:         a.id || null,
      name:       a.name || null,
      src:        a.src || null,
      thumbnail:  a.thumbnail || null,
      created_at: a.created_at || null,
    });
  }
  return out;
}

function section(xml: string, tagName: string): string | null {
  const m = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i').exec(xml);
  return m ? m[1] : null;
}
function allSections(xml: string, tagName: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}
function attrs(xml: string, tagName: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  // Match either self-closing or with body — we only want the open-tag attrs
  const re = new RegExp(`<${tagName}\\b([^>]*?)\\/?>`, 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrStr = m[1] || '';
    const a: Record<string, string> = {};
    const ar = /(\w[\w\-_]*)\s*=\s*"([^"]*)"/g;
    let am;
    while ((am = ar.exec(attrStr)) !== null) a[am[1]] = xmlDecode(am[2]);
    out.push(a);
  }
  return out;
}
function tag(xml: string, name: string): string | null {
  const inner = section(xml, name);
  if (inner == null) return null;
  return xmlDecode(stripCdata(inner)).trim() || null;
}
function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}
function xmlDecode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
function toInt(s: string | null): number | null {
  if (s == null) return null;
  const n = parseInt(s, 10); return Number.isFinite(n) ? n : null;
}
function toNum(s: string | null): number | null {
  if (s == null) return null;
  const n = Number(s); return Number.isFinite(n) ? n : null;
}
function toBool(s: string | null): boolean | null {
  if (s == null) return null;
  const v = s.toLowerCase().trim();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return null;
}

function signatureCreatedAt(xml: string): string | null {
  // Two possible shapes: <signature created_at="..."/> or
  // <signature><created_at>...</created_at></signature>
  const sig = section(xml, 'signature');
  if (sig != null) {
    const inner = tag(sig, 'created_at');
    if (inner) return inner;
  }
  const a = attrs(xml, 'signature');
  for (const o of a) if (o.created_at) return o.created_at;
  return null;
}

function parseTruck(xml: string): { id: number | null; name: string | null } | null {
  const inner = section(xml, 'truck');
  if (inner != null) {
    return {
      id:   toInt(tag(inner, 'id')),
      name: tag(inner, 'name'),
    };
  }
  const a = attrs(xml, 'truck');
  for (const o of a) {
    if (o.id || o.name) return { id: toInt(o.id || null), name: o.name || null };
  }
  return null;
}

function parseFirstDriver(xml: string): { id: number | null; name: string | null } | null {
  const driversBlock = section(xml, 'drivers');
  const scope = driversBlock ?? xml;
  const driverInners = allSections(scope, 'driver');
  if (driverInners.length > 0) {
    const inner = driverInners[0];
    const id = toInt(tag(inner, 'id'));
    const name = tag(inner, 'name');
    if (id != null || name != null) return { id, name };
  }
  const a = attrs(scope, 'driver');
  if (a.length > 0 && (a[0].id || a[0].name)) {
    return { id: toInt(a[0].id || null), name: a[0].name || null };
  }
  return null;
}

function parseItems(xml: string): ParsedItem[] {
  const itemsBlock = section(xml, 'items') ?? '';
  const inners = allSections(itemsBlock, 'item');
  return inners.map((inner) => ({
    item_id:            tag(inner, 'item_id'),
    description:        tag(inner, 'description'),
    quantity:           toNum(tag(inner, 'quantity')),
    delivered:          toBool(tag(inner, 'delivered')),
    delivered_quantity: toNum(tag(inner, 'delivered_quantity')),
    item_note:          tag(inner, 'item_note'),
    checked_quantity:   toNum(tag(inner, 'checked_quantity')),
    location:           tag(inner, 'location'),
    return_codes:       parseReturnCodes(inner),
  }));
}
function parseReturnCodes(itemXml: string): unknown {
  const block = section(itemXml, 'return_codes');
  if (block == null) return null;
  const codes = allSections(block, 'return_code').map(c => xmlDecode(stripCdata(c)).trim()).filter(Boolean);
  if (codes.length > 0) return codes;
  const flat = xmlDecode(stripCdata(block)).trim();
  return flat || null;
}

function parseNotes(xml: string): ParsedNote[] {
  const notesBlock = section(xml, 'notes') ?? '';
  // <note created_at="..." author="..." note_type="...">body</note>
  const re = /<note\b([^>]*)>([\s\S]*?)<\/note>/gi;
  const out: ParsedNote[] = [];
  let m;
  while ((m = re.exec(notesBlock)) !== null) {
    const a: Record<string, string> = {};
    const ar = /(\w[\w\-_]*)\s*=\s*"([^"]*)"/g;
    let am;
    while ((am = ar.exec(m[1])) !== null) a[am[1]] = xmlDecode(am[2]);
    const body = xmlDecode(stripCdata(m[2])).trim();
    if (!body) continue;
    out.push({ body, author: a.author || null, created_at: a.created_at || null, note_type: a.note_type || null });
  }
  return out;
}

// Normalize a DT-emitted timestamp to ISO so Postgres timestamptz always
// parses cleanly. DT can return ISO already, "YYYY-MM-DD HH:MM:SS" without
// timezone, or empty/garbage. We coerce defensively — anything unparseable
// returns null instead of nuking a batch insert.
function toIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const trimmed = String(s).trim();
  if (!trimmed) return null;
  // v2026-05-12 — DT export format is "YYYY-MM-DD HH:MM:SS ±HHMM" (e.g.
  // "2026-05-14 13:41:00 -0700"). Date.parse accepts that natively, but
  // the previous normalization step rewrote it to "YYYY-MM-DDTHH:MM:SS
  // ±HHMM" (only the FIRST space was replaced with T) — and *that* form
  // is rejected by V8/Node/Deno because the space before the timezone
  // breaks ISO. Result: every scheduled_at / started_at / finished_at /
  // signature_captured_at silently became NULL across the fleet. The
  // status_id update kept working because it doesn't go through toIso,
  // so the bug was masked except in date-display columns (the
  // 2026-05-12 service-date-column-empty incident on Digs orders).
  //
  // Fix: try Date.parse on the raw input first. The original normalize
  // step is kept as a fallback for any future DT format change — but
  // now also strips the space before the timezone offset so the output
  // is valid ISO.
  let t = Date.parse(trimmed);
  if (!Number.isFinite(t)) {
    const normalized = trimmed
      .replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2})?)/, '$1T$2')
      .replace(/ ([+-]\d{2}:?\d{2})$/, '$1');
    t = Date.parse(normalized);
  }
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function parseHistory(xml: string): ParsedHistoryEvent[] {
  const block = section(xml, 'order_history') ?? '';
  const events: ParsedHistoryEvent[] = [];
  // Self-closing <event .../> form
  const reSelf = /<event\b([^>]*?)\/>/gi;
  let m;
  while ((m = reSelf.exec(block)) !== null) {
    events.push(eventFromAttrs(m[1]));
  }
  // Open-body <event ...>...</event> form (e.g. with nested description)
  const reOpen = /<event\b([^>]*)>([\s\S]*?)<\/event>/gi;
  while ((m = reOpen.exec(block)) !== null) {
    const ev = eventFromAttrs(m[1]);
    const innerDesc = tag(m[2], 'description');
    if (innerDesc) ev.description = innerDesc;
    events.push(ev);
  }
  return events;
}
function eventFromAttrs(attrStr: string): ParsedHistoryEvent {
  const a: Record<string, string> = {};
  const ar = /(\w[\w\-_]*)\s*=\s*"([^"]*)"/g;
  let am;
  while ((am = ar.exec(attrStr)) !== null) a[am[1]] = xmlDecode(am[2]);
  // DT often returns date+time as separate attrs; combine into ISO.
  let happened: string | null = null;
  if (a.happened_at) happened = a.happened_at;
  else if (a.date && a.time) happened = `${a.date}T${a.time}`;
  else if (a.date) happened = a.date;
  return {
    code:        toInt(a.code || null),
    description: a.description || null,
    happened_at: happened,
    owner_id:    toInt(a.owner_id || null),
    owner_name:  a.owner_name || null,
    owner_type:  a.owner_type || null,
    lat:         toNum(a.lat || null),
    lng:         toNum(a.lng || null),
  };
}

function inferAuthorType(author: string | null): 'driver' | 'dispatcher' | 'app_user' | 'system' {
  if (!author) return 'system';
  const a = author.toLowerCase();
  if (a.includes('driver')) return 'driver';
  if (a.includes('strideapp') || a === 'stride') return 'app_user';
  return 'dispatcher';
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  } as Record<string, string>;
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
