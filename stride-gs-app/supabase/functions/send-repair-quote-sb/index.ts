/**
 * send-repair-quote-sb — [MIGRATION-P3] SB-primary for `sendRepairQuote`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 *
 * Behavior mirrors GAS handleSendRepairQuote_ in shape and side effects:
 *   1. Validate inputs + source status (must be 'Pending Quote' or
 *      'Quote Sent' for re-send; reject 'Approved'/'Completed'/'In Progress'
 *      with INVALID_STATE per the legacy semantics).
 *   2. Parse multi-line quote OR legacy single quoteAmount → normalize
 *      to a quoteLines[] array. Server recomputes ALL totals from the
 *      lines + tax rate — client-supplied totals are never trusted.
 *   3. UPDATE public.repairs with status='Quote Sent', quote_sent_date,
 *      all quote_* numeric columns, quote_lines_json.
 *   4. INSERT entity_audit_log matching GAS shape:
 *      { status: { old: 'Pending Quote', new: 'Quote Sent' } } with
 *      action='status_change'.
 *   5. Fire reverse writethrough in the BACKGROUND via EdgeRuntime.waitUntil
 *      so the EF returns after the SB writes + email (~1-2s) instead of
 *      waiting for the ~30s GAS sheet round-trip. Writer's REVERSE_REPAIR_FIELDS_
 *      map (v38.216.0) covers all the quote_* columns. Failures land in
 *      gs_sync_events; next full-client-sync reconciles.
 *   6. Send REPAIR_QUOTE email via send-email (Resend) — kept synchronous
 *      so emailSent / emailError surface in the response and the operator
 *      sees an immediate confirmation. Tokens:
 *      CLIENT_NAME, REPAIR_ID, ITEM_ID, ITEM_TABLE_HTML, QUOTE_LINE_ITEMS_HTML,
 *      QUOTE_SUBTOTAL, QUOTE_TAX_*, QUOTE_GRAND_TOTAL, NOTES, TASK_NOTES,
 *      APP_URL, APP_DEEP_LINK. send-email resolves recipients via the
 *      REPAIR_QUOTE template's recipients column ({{STAFF_EMAILS}},{{CLIENT_EMAIL}}).
 *      Email failure logs to gs_sync_events; SB commit is not unwound.
 *
 * Idempotency:
 *   • Same lines + same totals already sent → skip email + reverse
 *     writethrough; return alreadyMatching=true. Prevents accidental
 *     re-sends. The legacy GAS handler has the same protection.
 *   • isRevision=true (edit-after-sent flow) bypasses the idempotency skip
 *     so a Save & Resend on unchanged lines still re-fires the email.
 *   • skipEmail=true (Save Draft) lands the SB + sheet writes but skips
 *     the customer email.
 *
 * Auth: verified caller email via supabase.auth.getUser(token); falls
 * back to 'system' on service_role / unauthenticated calls.
 *
 * Request:  POST {
 *   tenantId, repairId, requestId?,
 *   quoteLines?: [{ svcCode, svcName, qty, rate, taxable }],
 *   quoteAmount?: number (legacy single-line),
 *   taxAreaId?, taxAreaName?, taxRate?,
 *   notes?, isRevision?, skipEmail?,
 *   resendExisting?: boolean — PURE RESEND: ignore client lines, re-send the
 *     email from the quote data stored on the repair row (amounts preserved
 *     byte-for-byte; original subject; no quote-column writes; transitions
 *     Pending Quote → Quote Sent for reopened repairs)
 * }
 * Response: { ok, repairId, previousStatus, subtotal, taxAmount, grandTotal,
 *             alreadyMatching?, mirrorQueued, emailSent, emailError? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const APP_URL = 'https://www.mystridehub.com';

// Statuses that allow (re-)sending a quote. 'Pending Quote' is the
// canonical first-quote state; 'Quote Sent' allows the operator to
// re-send / re-quote until the client acts on it. Approved /
// Completed / In Progress are locked — operator must Void the quote
// first. Mirrors handleSendRepairQuote_'s INVALID_STATE branch.
const ALLOWED_SOURCE_STATUSES = new Set(['Pending Quote', 'Quote Sent']);

interface QuoteLineInput {
  svcCode?: unknown;
  svcName?: unknown;
  qty?: unknown;
  rate?: unknown;
  taxable?: unknown;
}
interface QuoteLine {
  svcCode: string;
  svcName: string;
  qty:     number;
  rate:    number;
  taxable: boolean;
  amount:  number;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const tenantId: string  = String(body.tenantId ?? '').trim();
    const repairId: string  = String(body.repairId ?? '').trim();
    const requestId: string = String(body.requestId ?? '').trim() || crypto.randomUUID();
    const notes: string     = String(body.notes ?? '').trim();
    // Edit-quote-after-sent flow (mirrors GAS handleSendRepairQuote_).
    // isRevision bypasses the same-lines idempotency skip, sets
    // quote_revised=true (drives the "Revised" badge), and titles the email
    // "Revised Repair Quote: …"; skipEmail (Save Draft) persists the
    // updated quote without firing the email.
    const isRevision: boolean = body.isRevision === true;
    const skipEmail:  boolean = body.skipEmail  === true;
    // Pure RESEND (no edits): ignore any client-supplied lines and re-send
    // the email from the quote data STORED ON THE REPAIR ROW, byte-for-byte.
    // Born from RPR-63755 (2026-06-11): a reopened repair's quote was re-sent
    // through the builder, whose reconstructed/auto-filled lines priced
    // differently than the original ($228.20 → $251.93). Only the explicit
    // edit flow (Save & Resend, isRevision=true) may change amounts; a plain
    // resend must never recalculate. Also transitions Pending Quote →
    // Quote Sent (the reopen case) so the customer's approve gate appears.
    const resendExisting: boolean = body.resendExisting === true;

    if (!tenantId) return json({ ok: false, error: 'tenantId is required' }, 400);
    if (!repairId) return json({ ok: false, error: 'repairId is required' }, 400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (!supabaseUrl || !serviceKey || !anonKey) {
      return json({ ok: false, error: 'Server misconfigured' }, 500);
    }

    const authHeader = req.headers.get('Authorization');
    let callerEmail = 'system';
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const authClient = createClient(supabaseUrl, anonKey);
      const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
      if (!authErr && user?.email) callerEmail = user.email;
    }
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── 1. Normalize quote input ────────────────────────────────────
    const hasLines = Array.isArray(body.quoteLines) && body.quoteLines.length > 0;
    let quoteLines: QuoteLine[] = [];
    let taxAreaId   = String(body.taxAreaId   ?? '').trim() || null;
    let taxAreaName = String(body.taxAreaName ?? '').trim() || null;
    let taxRate     = Number(body.taxRate);
    if (Number.isNaN(taxRate) || taxRate < 0) taxRate = 0;

    if (resendExisting) {
      // Lines + totals come from the STORED row, derived after the load
      // below — nothing client-supplied is trusted on a pure resend.
    } else if (hasLines) {
      quoteLines = (body.quoteLines as QuoteLineInput[]).map(l => {
        let qty  = Number(l?.qty);
        let rate = Number(l?.rate);
        if (Number.isNaN(qty)  || qty  < 0) qty  = 0;
        if (Number.isNaN(rate) || rate < 0) rate = 0;
        return {
          svcCode: String(l?.svcCode ?? '').trim(),
          svcName: String(l?.svcName ?? '').trim(),
          qty, rate,
          taxable: l?.taxable === true,
          amount:  Math.round(qty * rate * 100) / 100,
        };
      }).filter(l => l.svcCode);
      if (quoteLines.length === 0) {
        return json({ ok: false, error: 'quoteLines must contain at least one line with a non-empty svcCode' }, 400);
      }
    } else if (body.quoteAmount != null) {
      // Legacy single-amount path — synthesize one REPAIR line.
      const legacyAmt = Number(body.quoteAmount);
      if (Number.isNaN(legacyAmt) || legacyAmt < 0) {
        return json({ ok: false, error: 'quoteAmount must be a non-negative number' }, 400);
      }
      quoteLines = [{
        svcCode: 'REPAIR', svcName: 'Repair',
        qty: 1, rate: legacyAmt, taxable: false,
        amount: Math.round(legacyAmt * 100) / 100,
      }];
      taxAreaId = null; taxAreaName = null; taxRate = 0;
    } else {
      return json({ ok: false, error: 'Either quoteLines or quoteAmount is required' }, 400);
    }

    let subtotal        = round2(quoteLines.reduce((s, l) => s + l.amount, 0));
    let taxableSubtotal = round2(quoteLines.filter(l => l.taxable).reduce((s, l) => s + l.amount, 0));
    let taxAmount       = round2(taxableSubtotal * (taxRate / 100));
    let grandTotal      = round2(subtotal + taxAmount);

    // ── 2. Load existing repair + validate state ─────────────────────
    const { data: existing, error: existingErr } = await supabase
      .from('repairs')
      .select('repair_id, status, quote_lines_json, quote_grand_total, quote_sent_date, item_id, repair_notes, task_notes, quote_amount, quote_subtotal, quote_taxable_subtotal, quote_tax_area_id, quote_tax_area_name, quote_tax_rate, quote_tax_amount')
      .eq('tenant_id', tenantId)
      .eq('repair_id', repairId)
      .maybeSingle();
    if (existingErr) return json({ ok: false, error: `Repair lookup failed: ${existingErr.message}` }, 500);
    if (!existing)   return json({ ok: false, error: `Repair ${repairId} not found` }, 404);

    // ── 2b. RESEND: derive lines + totals from the STORED quote ──────
    // Stored totals are used verbatim (never recomputed); per-line amount
    // is qty×rate purely for the email's line-item table rendering.
    if (resendExisting) {
      const storedLines = Array.isArray(existing.quote_lines_json)
        ? (existing.quote_lines_json as QuoteLineInput[])
        : null;
      if (storedLines && storedLines.length > 0) {
        quoteLines = storedLines.map(l => {
          const qty  = Number(l?.qty)  || 0;
          const rate = Number(l?.rate) || 0;
          return {
            svcCode: String(l?.svcCode ?? '').trim(),
            svcName: String(l?.svcName ?? '').trim(),
            qty, rate,
            taxable: l?.taxable === true,
            amount:  Math.round(qty * rate * 100) / 100,
          };
        }).filter(l => l.svcCode);
      } else {
        // Legacy / lines-lost rows: one synthetic line at the stored amount
        // so the email still shows a line table that sums to the total.
        const legacyAmt = Number(existing.quote_amount ?? existing.quote_grand_total ?? 0);
        if (!(legacyAmt > 0)) {
          return json({ ok: false, error: 'No stored quote to resend — send a quote first.', errorCode: 'NO_STORED_QUOTE' }, 422);
        }
        quoteLines = [{
          svcCode: 'REPAIR', svcName: 'Repair',
          qty: 1, rate: legacyAmt, taxable: false,
          amount: Math.round(legacyAmt * 100) / 100,
        }];
      }
      taxAreaId       = (existing.quote_tax_area_id as string | null) ?? null;
      taxAreaName     = (existing.quote_tax_area_name as string | null) ?? null;
      taxRate         = Number(existing.quote_tax_rate ?? 0) || 0;
      taxAmount       = round2(Number(existing.quote_tax_amount ?? 0) || 0);
      grandTotal      = round2(Number(existing.quote_grand_total ?? existing.quote_amount ?? 0) || 0);
      subtotal        = round2(Number(existing.quote_subtotal ?? (grandTotal - taxAmount)) || 0);
      taxableSubtotal = round2(Number(existing.quote_taxable_subtotal ?? 0) || 0);
    }

    const previousStatus = String(existing.status ?? '').trim();
    if (!ALLOWED_SOURCE_STATUSES.has(previousStatus)) {
      return json({
        ok: false,
        error: `Cannot re-send a quote on a repair that is already ${previousStatus}. Void this quote first to make changes.`,
        errorCode: 'INVALID_STATE',
      }, 422);
    }

    // Idempotency — same lines + same grand total → skip email + mirror.
    // Bypassed when isRevision=true so a Save & Resend on unchanged lines
    // still re-sends the customer email per operator intent.
    const existingLines = Array.isArray(existing.quote_lines_json) ? existing.quote_lines_json : null;
    const linesMatch = existingLines
      && existingLines.length === quoteLines.length
      && JSON.stringify(existingLines) === JSON.stringify(quoteLines.map(({ amount: _a, ...rest }) => rest));
    const totalMatches = Number(existing.quote_grand_total ?? -1) === grandTotal;
    if (!isRevision && !resendExisting && linesMatch && totalMatches && previousStatus === 'Quote Sent') {
      return json({
        ok: true, repairId, previousStatus,
        subtotal, taxAmount, grandTotal,
        alreadyMatching: true,
        mirrorQueued: false, emailSent: false,
      });
    }

    // ── 3. UPDATE public.repairs ─────────────────────────────────────
    // Preserve quote_sent_date when an original is already stamped — matches
    // GAS handleSendRepairQuote_'s "set only if blank" guard so a Save &
    // Resend / Save Draft on an existing Quote Sent repair keeps the
    // original send-out date as the customer-visible Quote Sent Date.
    const ptDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const existingQuoteSentDate = String(existing.quote_sent_date ?? '').trim();
    const nextQuoteSentDate = existingQuoteSentDate || ptDate;
    // RESEND: never rewrite the quote columns (they're already the truth we
    // just read) and never touch quote_revised — the only row change is the
    // Pending Quote → Quote Sent transition (reopened repairs).
    const { error: updErr } = resendExisting
      ? (previousStatus === 'Pending Quote'
          ? await supabase
              .from('repairs')
              .update({ status: 'Quote Sent', updated_at: new Date().toISOString() })
              .eq('tenant_id', tenantId)
              .eq('repair_id', repairId)
          : { error: null })
      : await supabase
      .from('repairs')
      .update({
        status:                 'Quote Sent',
        // Mark the quote as Revised on the edit-after-sent flow. Status stays
        // 'Quote Sent' so every approve/decline/edit gate keeps working; the
        // flag drives the "Revised" status badge + "Revised Repair Quote"
        // email. A first send (isRevision=false) writes false.
        quote_revised:          isRevision,
        quote_amount:           grandTotal,  // back-compat with single-amount readers
        quote_sent_date:        nextQuoteSentDate,
        quote_lines_json:       quoteLines.map(({ amount: _a, ...rest }) => rest),
        quote_subtotal:         subtotal,
        quote_taxable_subtotal: taxableSubtotal,
        quote_tax_area_id:      taxAreaId,
        quote_tax_area_name:    taxAreaName,
        quote_tax_rate:         taxRate,
        quote_tax_amount:       taxAmount,
        quote_grand_total:      grandTotal,
        updated_at:             new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('repair_id', repairId);
    if (updErr) return json({ ok: false, error: `Update failed: ${updErr.message}` }, 500);

    // ── 4. entity_audit_log ──────────────────────────────────────────
    // Distinguish a first-send (Pending Quote → Quote Sent) from an
    // edit-after-sent revision (Quote Sent → Quote Sent). Pre-fix the
    // entry hard-coded the Pending→Sent transition on every call,
    // polluting the timeline with phantom status flips on Save & Resend
    // and Save Draft.
    const isFirstSend = previousStatus === 'Pending Quote';
    await supabase.from('entity_audit_log').insert({
      entity_type:  'repair',
      entity_id:    repairId,
      tenant_id:    tenantId,
      action:       isFirstSend ? 'status_change' : (resendExisting ? 'quote_resent' : 'quote_revised'),
      changes:      isFirstSend
        ? { status: { old: previousStatus, new: 'Quote Sent' }, ...(resendExisting ? { resend: true } : {}) }
        : (resendExisting ? { resend: true } : { revision: true, skipEmail }),
      performed_by: callerEmail,
      source:       'edge',
    });

    // ── 5. Reverse writethrough (BACKGROUND) ─────────────────────────
    // 2026-05-29 — moved the GAS sheet mirror behind EdgeRuntime.waitUntil
    // so the EF returns success right after the SB UPDATE + audit log +
    // email send (~1-2s, dominated by the customer email), instead of
    // waiting on the ~30s sheet round-trip. Same gs_sync_events failure
    // capture path; only the await point moves. Pattern mirrors
    // void-invoice-sb (v38.243.0).
    // RESEND mirrors ONLY the status — the sheet's quote columns are either
    // already correct or (post-reopen) stale, and the v38.274 writer guard
    // converges Status to live SB truth. Quote columns must not be rewritten
    // from a resend any more than the SB row is.
    const mirrorPayload = resendExisting ? {
      tenantId,
      table: 'repairs',
      op:    'update',
      rowId: repairId,
      row:   { status: 'Quote Sent' },
      requestId,
    } : {
      tenantId,
      table: 'repairs',
      op:    'update',
      rowId: repairId,
      row:   {
        status:                 'Quote Sent',
        quote_revised:          isRevision,
        quote_amount:           grandTotal,
        quote_sent_date:        nextQuoteSentDate,
        // Stringify quote_lines_json before sending — the GAS writer
        // does setValue() and setValue([object]) writes "[object Object]"
        // to the sheet. The legacy GAS handler stores the lines as
        // JSON.stringify'd text. We mirror that.
        quote_lines_json:       JSON.stringify(quoteLines.map(({ amount: _a, ...rest }) => rest)),
        quote_subtotal:         subtotal,
        quote_taxable_subtotal: taxableSubtotal,
        quote_tax_area_id:      taxAreaId,
        quote_tax_area_name:    taxAreaName,
        quote_tax_rate:         taxRate,
        quote_tax_amount:       taxAmount,
        quote_grand_total:      grandTotal,
      },
      requestId,
    };
    const gasUrl   = Deno.env.get('GAS_API_URL');
    const gasToken = Deno.env.get('GAS_API_TOKEN');
    let mirrorQueued = false;
    if (gasUrl && gasToken) {
      const mirrorPromise = (async () => {
        try {
          const mirrorRes = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mirrorPayload),
          });
          const text = await mirrorRes.text();
          let parsed: { success?: boolean; error?: string } = {};
          try { parsed = JSON.parse(text); } catch { parsed = { error: `non-JSON: ${text.slice(0, 200)}` }; }
          if (!mirrorRes.ok || !parsed.success) {
            const errMsg = parsed.error ?? `HTTP ${mirrorRes.status}`;
            console.error('[send-repair-quote-sb] sheet mirror failed:', errMsg);
            await supabase.from('gs_sync_events').insert({
              tenant_id:     tenantId,
              entity_type:   'repair',
              entity_id:     repairId,
              action_type:   'writethrough_reverse',
              sync_status:   'sync_failed',
              requested_by:  `send-repair-quote-sb:${callerEmail}`,
              request_id:    requestId,
              payload:       { table: 'repairs', op: 'update', rowId: repairId, fieldCount: 11 },
              error_message: String(errMsg).slice(0, 1000),
            }).then(() => {}, () => {});
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          console.error('[send-repair-quote-sb] sheet mirror threw:', errMsg);
          await supabase.from('gs_sync_events').insert({
            tenant_id:     tenantId,
            entity_type:   'repair',
            entity_id:     repairId,
            action_type:   'writethrough_reverse',
            sync_status:   'sync_failed',
            requested_by:  `send-repair-quote-sb:${callerEmail}`,
            request_id:    requestId,
            payload:       { table: 'repairs', op: 'update', rowId: repairId, fieldCount: 11 },
            error_message: errMsg.slice(0, 1000),
          }).then(() => {}, () => {});
        }
      })();
      const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
      if (edgeRuntime && typeof edgeRuntime.waitUntil === 'function') {
        edgeRuntime.waitUntil(mirrorPromise);
      }
      // If EdgeRuntime is unavailable (local dev), the promise still runs —
      // we just won't be told when it finishes. Don't await it.
      mirrorQueued = true;
    } else {
      console.warn('[send-repair-quote-sb] GAS_API_URL / GAS_API_TOKEN not configured — sheet mirror skipped');
    }

    // ── 6. Resolve client + item info for email tokens ───────────────
    const { data: clientRow } = await supabase
      .from('clients')
      .select('name, email')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    const clientName  = (clientRow as { name?: string } | null)?.name?.trim()  || 'Client';

    // Multi-item repairs: the full item list lives in public.repair_items
    // (parent repairs.item_id is only the denormalized "primary"). A single
    // quote can cover N items, so the subject, the body header ({{ITEM_ID}})
    // and the item-detail table must list ALL of them — not just the primary.
    // Pre-fix, only existing.item_id was referenced, so a batch repair's email
    // showed one item ID everywhere. This mirrors the multi-item rendering in
    // request-repair-quote-sb and the work-order print fix (PR #613).
    const primaryItemId = String(existing.item_id ?? '').trim();
    const { data: repairItemRows } = await supabase
      .from('repair_items')
      .select('item_id, created_at')
      .eq('tenant_id', tenantId)
      .eq('repair_id', repairId)
      .order('created_at', { ascending: true });
    const repairItemIds = ((repairItemRows as { item_id: string }[] | null) ?? [])
      .map(r => String(r.item_id ?? '').trim())
      .filter(Boolean);
    // Order: primary first (matches the deep-link / back-compat expectation),
    // then any remaining repair_items in insertion order, de-duplicated.
    // Legacy single-item repairs predate repair_items — the primary fallback
    // keeps them rendering exactly one row.
    const orderedItemIds = Array.from(new Set([primaryItemId, ...repairItemIds].filter(Boolean)));

    interface InventoryRow {
      item_id: string; description: string | null; vendor: string | null;
      sidemark: string | null; location: string | null;
    }
    const { data: invRows } = orderedItemIds.length > 0
      ? await supabase
          .from('inventory')
          .select('item_id, description, vendor, sidemark, location')
          .eq('tenant_id', tenantId).in('item_id', orderedItemIds)
      : { data: null };
    const invByItemId = new Map<string, InventoryRow>();
    for (const r of ((invRows as InventoryRow[] | null) ?? [])) invByItemId.set(r.item_id, r);
    // Preserve orderedItemIds order; synthesize a bare row for any item that's
    // missing from inventory so its ID still appears in the table.
    const orderedItems: InventoryRow[] = orderedItemIds.map(id =>
      invByItemId.get(id) ?? { item_id: id, description: null, vendor: null, sidemark: null, location: null });

    // Comma-joined list of every item on the repair — drives the subject line
    // and the {{ITEM_ID}} body token (header) so all items are shown.
    const itemIdsLabel = orderedItemIds.join(', ');
    // Count-aware grammar tokens so the body reads naturally for multi-item
    // repairs: the REPAIR_QUOTE template's header sentence ("… — {{ITEM_NOUN}}
    // {{ITEM_ID}}") and the summary-card label ("{{ITEM_ID_LABEL}}") pluralize
    // when the quote covers more than one item. A client replied confused
    // ("one chair or both?") when a 2-item quote read "item 64001"; these make
    // it read "items 64001, 64002".
    const isMultiItem  = orderedItemIds.length > 1;
    const itemNoun     = isMultiItem ? 'items' : 'item';
    const itemIdLabel  = isMultiItem ? 'Item IDs' : 'Item ID';

    const itemTableHtml  = renderItemTable(orderedItems);
    const quoteLinesHtml = renderQuoteLines(quoteLines);
    const appDeepLink    = `${APP_URL}/#/repairs?open=${encodeURIComponent(repairId)}&client=${encodeURIComponent(tenantId)}`;

    // ── 7. Send email ────────────────────────────────────────────────
    // Save Draft (skipEmail=true) lands the SB + sheet writes but skips
    // the customer-facing send so the operator can review before
    // resending. emailSent stays false; no error is surfaced.
    let emailSent = false;
    let emailError: string | undefined;
    if (!skipEmail) {
      // A revision reads "Revised Repair Quote: …" so the customer mailbox
      // shows it's an updated quote; a first send reads "Repair Quote Ready: …".
      // Mirrors GAS handleSendRepairQuote_ so the subject is identical
      // regardless of which backend serviced the request.
      // A pure resend keeps the ORIGINAL subject (same quote, same numbers);
      // only the explicit edit flow gets the "Revised" title.
      const subjectOverride = isRevision
        ? `Revised Repair Quote: ${itemIdsLabel} $${formatMoney(grandTotal)}`
        : `Repair Quote Ready: ${itemIdsLabel} $${formatMoney(grandTotal)}`;
      // Bump the idempotency key on a revision OR a pure resend so
      // send-email's per-template dedup doesn't drop the email when
      // nothing changed in the tokens (a resend changes nothing by design).
      const idempotencyKey = (isRevision || resendExisting)
        ? `repair-quote:${repairId}:${grandTotal}:${resendExisting ? 'resend' : 'rev'}:${Date.now()}`
        : `repair-quote:${repairId}:${grandTotal}`;
      try {
        const sendRes = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${serviceKey}`,
            'apikey':         serviceKey,
            'Content-Type':   'application/json',
          },
          body: JSON.stringify({
            templateKey: 'REPAIR_QUOTE',
            subjectOverride,
            tokens: {
              CLIENT_NAME:           clientName,
              REPAIR_ID:             repairId,
              ITEM_ID:               itemIdsLabel,
              ITEM_NOUN:             itemNoun,
              ITEM_ID_LABEL:         itemIdLabel,
              ITEM_TABLE_HTML:       itemTableHtml,
              QUOTE_LINE_ITEMS_HTML: quoteLinesHtml,
              // Token values are RAW numbers — the template surrounds each
              // with a literal '$' (e.g. `${{QUOTE_GRAND_TOTAL}}`). Passing
              // formatCurrency() here used to render $$808.92 (double $).
              // The inline HTML in QUOTE_LINE_ITEMS_HTML keeps using
              // formatCurrency() because it builds the $ into the cells
              // itself (no surrounding template prefix).
              QUOTE_SUBTOTAL:        formatMoney(subtotal),
              QUOTE_TAX_AREA_NAME:   taxAreaName ?? '',
              QUOTE_TAX_RATE:        taxRate ? `${taxRate.toFixed(3)}%` : '',
              QUOTE_TAX_AMOUNT:      formatMoney(taxAmount),
              QUOTE_GRAND_TOTAL:     formatMoney(grandTotal),
              NOTES:                 notes || String(existing.repair_notes ?? ''),
              TASK_NOTES:            String(existing.task_notes ?? ''),
              APP_URL:               APP_URL,
              APP_DEEP_LINK:         appDeepLink,
            },
            idempotencyKey,
            relatedEntityType: 'repair',
            relatedEntityId:   repairId,
            tenantId,
          }),
        });
        const sendJson = await sendRes.json().catch(() => ({})) as Record<string, unknown>;
        if (sendJson.ok) emailSent = true;
        else emailError = String(sendJson.error ?? 'unknown');
      } catch (e) {
        emailError = e instanceof Error ? e.message : String(e);
      }
      if (!emailSent) {
        console.error('[send-repair-quote-sb] email failed:', emailError);
        await supabase.from('gs_sync_events').insert({
          tenant_id:     tenantId,
          entity_type:   'repair',
          entity_id:     repairId,
          action_type:   'send_repair_quote_email',
          sync_status:   'sync_failed',
          requested_by:  `send-repair-quote-sb:${callerEmail}`,
          request_id:    requestId,
          payload:       { templateKey: 'REPAIR_QUOTE', grandTotal },
          error_message: (emailError ?? 'unknown').slice(0, 1000),
        }).then(() => {}, () => {});
      }
    }

    return json({
      ok: true, repairId, previousStatus,
      subtotal, taxAmount, grandTotal,
      // Sheet mirror runs in the background via EdgeRuntime.waitUntil —
      // we don't know the outcome at response time. Failures land in
      // gs_sync_events (FailedOperationsDrawer pickup); the next
      // full-client-sync reconciles regardless. mirrorOk/mirrorError are
      // retained as undefined for back-compat with older React clients
      // that destructure them but treat undefined as "OK".
      mirrorQueued,
      emailSent, emailError,
    });

  } catch (err) {
    console.error('[send-repair-quote-sb] Unexpected error:', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});

function round2(n: number): number { return Math.round(n * 100) / 100; }

function formatCurrency(n: number): string {
  return `$${formatMoney(n)}`;
}

// Same shape as formatCurrency but without the $ prefix — used for tokens
// that go into templates which provide their own '$' (e.g. `${{TOKEN}}`).
function formatMoney(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderItemTable(items: {
  item_id: string; description: string | null; vendor: string | null;
  sidemark: string | null; location: string | null;
}[]): string {
  if (items.length === 0) return '';
  const td = 'padding:6px 10px;border-bottom:1px solid #E5E7EB;font-size:13px;color:#1F2937;vertical-align:top;';
  const th = 'padding:8px 10px;background:#F9FAFB;border-bottom:2px solid #D1D5DB;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#374151;text-align:left;';
  const rows = items.map(it => [
    '<tr>',
    `<td style="${td}font-family:monospace;font-size:12px;">${escapeHtml(it.item_id ?? '')}</td>`,
    `<td style="${td}">${escapeHtml(it.description ?? '')}</td>`,
    `<td style="${td}">${escapeHtml(it.vendor ?? '')}</td>`,
    `<td style="${td}">${escapeHtml(it.sidemark ?? '')}</td>`,
    `<td style="${td}">${escapeHtml(it.location ?? '')}</td>`,
    '</tr>',
  ].join('')).join('');
  return [
    '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;margin:8px 0 16px;">',
    '<thead><tr>',
    `<th style="${th}">Item ID</th>`,
    `<th style="${th}">Description</th>`,
    `<th style="${th}">Vendor</th>`,
    `<th style="${th}">Sidemark</th>`,
    `<th style="${th}">Location</th>`,
    '</tr></thead><tbody>',
    rows,
    '</tbody></table>',
  ].join('');
}

function renderQuoteLines(lines: QuoteLine[]): string {
  const td = 'padding:6px 10px;border-bottom:1px solid #E5E7EB;font-size:13px;color:#1F2937;';
  const th = 'padding:8px 10px;background:#F9FAFB;border-bottom:2px solid #D1D5DB;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#374151;text-align:left;';
  return [
    '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;margin:8px 0 16px;">',
    '<thead><tr>',
    `<th style="${th}">Service</th>`,
    `<th style="${th};text-align:right;">Qty</th>`,
    `<th style="${th};text-align:right;">Rate</th>`,
    `<th style="${th};text-align:right;">Amount</th>`,
    '</tr></thead><tbody>',
    ...lines.map(l => [
      '<tr>',
      `<td style="${td}">${escapeHtml(l.svcName || l.svcCode)}</td>`,
      `<td style="${td};text-align:right;">${l.qty}</td>`,
      `<td style="${td};text-align:right;">${formatCurrency(l.rate)}</td>`,
      `<td style="${td};text-align:right;font-weight:600;">${formatCurrency(l.amount)}</td>`,
      '</tr>',
    ].join('')),
    '</tbody></table>',
  ].join('');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
