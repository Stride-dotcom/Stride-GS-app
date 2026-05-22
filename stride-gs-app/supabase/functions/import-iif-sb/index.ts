/**
 * import-iif-sb — SB-primary handler for GAS action `importIIF`.
 *
 * Phase 6 payments. Replaces handleImportIIF_ at StrideAPI.gs:35715.
 *
 * IIF (Intuit Interchange Format) is a tab-delimited format exported by
 * QuickBooks Desktop. The structure is line-oriented:
 *
 *   !TRNS    TRNSID  TRNSTYPE  DATE  ACCNT  NAME  AMOUNT  MEMO  DUEDATE
 *   !SPL     SPLID   TRNSTYPE  DATE  ACCNT  NAME  AMOUNT  MEMO  QNTY  PRICE  INVITEM
 *   !ENDTRNS
 *   TRNS     1       INVOICE   12/15/2025   Accounts Receivable   ACME Corp   500.00   QB#INV-001   12/30/2025
 *   SPL      2       INVOICE   12/15/2025   Income:Services       ACME Corp   -500.00  Storage     1   500   STOR
 *   ENDTRNS
 *
 * Each TRNSTYPE=INVOICE TRNS row defines an invoice header; subsequent
 * SPL rows (until ENDTRNS) are line items with NEGATIVE AMOUNT (QBD's
 * accounting convention — credits are negative; positive on TRNS,
 * negative on SPL). Our parser emits a POSITIVE quantity * price.
 *
 * GAS handler flow (mirrored here):
 *   1. Parse IIF into raw rows + per-invoice objects.
 *   2. For each invoice: resolve Stax Customer ID from
 *      public.clients.stax_customer_id by name (case/accent fuzzy).
 *   3. UPSERT into public.stax_invoices (UPDATE when an existing PENDING
 *      row matches qb_invoice_no, INSERT otherwise).
 *      Rows already in CREATED / PAID / VOIDED stay untouched.
 *   4. NO_CUSTOMER rows → public.stax_exceptions row + skip insert.
 *   5. Mirror touched invoice numbers via best-effort writes (the SB
 *      table IS the mirror; no further fan-out needed in this scope).
 *
 * THIS HANDLER SCOPE:
 *   FULL : IIF parse, name normalization, public.stax_invoices upsert,
 *         public.stax_exceptions on NO_CUSTOMER, run-log entry.
 *   STUB : Stax sheet "Import" raw-row mirror (drift tolerated; sheet is
 *         legacy debug-only). Past-due safety buffer + Scheduled Date
 *         auto-populate apply to the GAS sheet only.
 *
 * Inputs:
 *   {
 *     tenantId?:   string                // optional, audit only
 *     iifContent?: string                // RAW IIF text (preferred)
 *     fileContent?: string               // base64-encoded IIF (legacy
 *                                        // — GAS used base64 because Apps
 *                                        // Script URL-encoded payloads).
 *     fileName?:   string                // for run-log; "import.iif" default
 *     callerEmail?: string
 *     requestId?:  string
 *   }
 *
 * Required EF secrets:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *
 * No external API call — IIF parsing + SB writes only.
 *
 * Response:
 *   {
 *     success: true,
 *     parsed: N,                // invoices parsed from IIF
 *     inserted: N,              // new public.stax_invoices rows
 *     updated: N,               // refreshed existing PENDING rows
 *     skipped: N,               // already CREATED/PAID/VOIDED OR no Stax customer
 *     exceptions: N,            // public.stax_exceptions rows written
 *     warnings: string[]
 *   }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Body {
  tenantId?:    string;
  iifContent?:  string;
  fileContent?: string;
  fileName?:    string;
  callerEmail?: string;
  requestId?:   string;
}

interface ParsedInvoice {
  docNum:    string;     // TRNS NUM or memo-extracted invoice number
  name:      string;     // customer name from TRNS
  date:      string;     // ISO yyyy-MM-dd (parsed from MM/dd/yyyy)
  dueDate:   string;     // ISO yyyy-MM-dd
  amount:    number;     // positive total
  memo:      string;
  lineItems: Array<{ code: string; description: string; quantity: number; price: number }>;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'POST required', code: 'METHOD_NOT_ALLOWED' }, 405);

  let body: Body;
  try {
    body = await req.json();
  } catch (e) {
    return jsonResponse({ error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`, code: 'INVALID_JSON' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing', code: 'CONFIG_ERROR' }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey);

  // Admin-only gate. `public.stax_invoices` is FLEET-WIDE by design;
  // GAS path enforces via `withStaffGuard_`. Without this any
  // authenticated user could overwrite Stax-side billing records.
  const authHeader = req.headers.get('Authorization') || '';
  const callerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!callerToken) {
    return jsonResponse({ error: 'Authorization header required', code: 'UNAUTHENTICATED' }, 401);
  }
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authClient = createClient(supabaseUrl, anonKey);
  const { data: userData, error: authErr } = await authClient.auth.getUser(callerToken);
  if (authErr || !userData?.user) {
    return jsonResponse({ error: 'Invalid token', code: 'UNAUTHENTICATED' }, 401);
  }
  const callerRole = String((userData.user.user_metadata as { role?: string })?.role ?? '').toLowerCase();
  if (callerRole !== 'admin' && callerRole !== 'staff') {
    return jsonResponse({ error: 'admin/staff role required', code: 'FORBIDDEN' }, 403);
  }

  // ── Decode input ─────────────────────────────────────────────────────
  // Prefer iifContent (raw text). fileContent is treated as base64 to
  // remain backward-compatible with the GAS payload contract.
  let iif = String(body.iifContent ?? '').trim();
  if (!iif && body.fileContent) {
    try {
      // atob → binary string; treat as UTF-8 via TextDecoder.
      const bin = atob(String(body.fileContent).trim());
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      iif = new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonResponse({ error: `Failed to base64-decode fileContent: ${msg}`, code: 'DECODE_ERROR' }, 400);
    }
  }
  if (!iif) {
    return jsonResponse({ error: 'iifContent (or fileContent base64) is required', code: 'INVALID_PARAMS' }, 400);
  }

  const tenantId    = String(body.tenantId    ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();
  const fileName    = String(body.fileName    ?? '').trim() || 'import.iif';

  // ── Parse IIF ────────────────────────────────────────────────────────
  const warnings: string[] = [];
  const parsed = parseIIF(iif, warnings);

  if (parsed.length === 0) {
    return jsonResponse({
      success:    true,
      parsed:     0,
      inserted:   0,
      updated:    0,
      skipped:    0,
      exceptions: 0,
      warnings:   warnings.concat(['IIF parsed to 0 invoices — verify the file is a QuickBooks IIF export with !TRNS/!SPL headers']),
    }, 200);
  }

  // ── Pre-load client name → stax_customer_id ──────────────────────────
  const wantedNames = Array.from(new Set(parsed.map((p) => normalizeName(p.name)).filter(Boolean)));
  const clientMap: Record<string, { id: string; staxId: string; canonicalName: string }> = {};
  if (wantedNames.length > 0) {
    // Pull all active clients; in-memory normalize-match. Smaller blast
    // radius than IN-filtering by name (case/accent variants would miss).
    const { data: clientRows, error: clientsErr } = await sb
      .from('clients')
      .select('id, name, stax_customer_id, active')
      .eq('active', true);
    if (clientsErr) {
      warnings.push(`clients lookup failed (non-fatal): ${clientsErr.message}`);
    } else {
      for (const c of (clientRows ?? []) as Array<{ id?: string; name?: string; stax_customer_id?: string | null; active?: boolean }>) {
        const key = normalizeName(c.name ?? '');
        const sid = String(c.stax_customer_id ?? '').trim();
        if (key && sid) clientMap[key] = {
          id: String(c.id ?? ''),
          staxId: sid,
          canonicalName: String(c.name ?? ''),
        };
      }
    }
  }

  // ── Pre-load existing stax_invoices by qb_invoice_no ─────────────────
  const docNums = Array.from(new Set(parsed.map((p) => p.docNum).filter(Boolean)));
  const existingByNum: Record<string, { id: string; status: string }> = {};
  if (docNums.length > 0) {
    const { data: existRows, error: existErr } = await sb
      .from('stax_invoices')
      .select('id, qb_invoice_no, status')
      .in('qb_invoice_no', docNums);
    if (existErr) {
      warnings.push(`existing-invoice lookup failed (non-fatal): ${existErr.message}`);
    } else {
      for (const e of (existRows ?? []) as Array<{ id?: string; qb_invoice_no?: string; status?: string }>) {
        const k = String(e.qb_invoice_no ?? '').trim();
        if (k) existingByNum[k] = { id: String(e.id ?? ''), status: String(e.status ?? '') };
      }
    }
  }

  let inserted   = 0;
  let updated    = 0;
  let skipped    = 0;
  let exceptions = 0;
  const now = new Date().toISOString();

  for (const inv of parsed) {
    const docNum = inv.docNum.trim();
    if (!docNum) { skipped++; continue; }

    const nameKey  = normalizeName(inv.name);
    const clientHit = clientMap[nameKey] || null;

    if (!clientHit) {
      // NO_CUSTOMER exception — same shape as create-stax-invoices-sb.
      try {
        await sb.from('stax_exceptions').insert({
          timestamp:        now,
          qb_invoice_no:    docNum,
          customer:         inv.name,
          stax_customer_id: '',
          amount:           inv.amount,
          due_date:         inv.dueDate,
          reason:           'NO_CUSTOMER — set stax_customer_id on the client record',
          pay_link:         '',
          resolved:         false,
        });
        exceptions++;
      } catch (e) {
        warnings.push(`exception insert for ${docNum} threw: ${e instanceof Error ? e.message : String(e)}`);
      }
      skipped++;
      continue;
    }

    const existing = existingByNum[docNum];
    if (existing) {
      const status = existing.status.toUpperCase();
      if (status && status !== 'PENDING') {
        // Already in-flight — preserve.
        skipped++;
        continue;
      }
      // UPDATE in place.
      const { error: updErr } = await sb.from('stax_invoices').update({
        customer:         clientHit.canonicalName,
        stax_customer_id: clientHit.staxId,
        invoice_date:     inv.date,
        due_date:         inv.dueDate,
        amount:           inv.amount,
        line_items_json:  JSON.stringify(inv.lineItems),
        notes:            `Refreshed by import-iif-sb at ${now}`,
        updated_at:       now,
      }).eq('id', existing.id);
      if (updErr) {
        warnings.push(`update ${docNum} failed: ${updErr.message}`);
        skipped++;
      } else {
        updated++;
      }
      continue;
    }

    // INSERT new PENDING row.
    const { error: insErr } = await sb.from('stax_invoices').insert({
      qb_invoice_no:    docNum,
      customer:         clientHit.canonicalName,
      stax_customer_id: clientHit.staxId,
      invoice_date:     inv.date,
      due_date:         inv.dueDate,
      amount:           inv.amount,
      line_items_json:  JSON.stringify(inv.lineItems),
      status:           'PENDING',
      created_at_sheet: now,
      notes:            `Imported via import-iif-sb (${fileName})`,
    });
    if (insErr) {
      warnings.push(`insert ${docNum} failed: ${insErr.message}`);
      skipped++;
    } else {
      inserted++;
    }
  }

  // Run log (best-effort).
  try {
    const summary = `Imported ${fileName}: ${inserted} added, ${updated} updated, ${skipped} skipped, ${exceptions} exceptions`;
    await sb.from('stax_run_log').insert({
      timestamp: now,
      fn:        'import-iif-sb',
      summary,
      details:   JSON.stringify({ fileName, inserted, updated, skipped, exceptions, parsed: parsed.length }),
    });
  } catch (e) {
    warnings.push(`run-log insert threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Audit log (best-effort).
  try {
    await sb.from('entity_audit_log').insert({
      entity_type:  'stax_invoice',
      entity_id:    'import-iif',
      tenant_id:    tenantId,
      action:       'iif_import',
      changes:      { fileName, parsed: parsed.length, inserted, updated, skipped, exceptions },
      performed_by: callerEmail || 'import-iif-sb',
      source:       'supabase',
    });
  } catch (e) {
    console.error('[import-iif-sb] audit insert failed:', e);
  }

  return jsonResponse({
    success:    true,
    parsed:     parsed.length,
    inserted,
    updated,
    skipped,
    exceptions,
    warnings,
    requestId,
  }, 200);
});

// ─── IIF parser ─────────────────────────────────────────────────────

/**
 * Parse QuickBooks IIF text into invoice records.
 *
 * Format quirks:
 *   - Tab-delimited.
 *   - Lines starting with `!` define column headers for the section
 *     (e.g. !TRNS, !SPL, !ENDTRNS — though !ENDTRNS has no columns).
 *   - Data lines start with the matching keyword (TRNS, SPL, ENDTRNS).
 *   - A TRNS row begins an invoice; subsequent SPL rows are line items
 *     until ENDTRNS.
 *   - Column order varies between exports — we resolve by header
 *     position from the corresponding `!`-row.
 *   - DATE is MM/dd/yyyy. We emit yyyy-MM-dd for SB consistency.
 *   - SPL AMOUNT is negative (QBD accounting convention). We negate
 *     for line-item price.
 *
 * Only TRNSTYPE=INVOICE rows are emitted. CHECK / BILL / etc. ignored.
 */
function parseIIF(iif: string, warnings: string[]): ParsedInvoice[] {
  const lines = iif.split(/\r?\n/);
  const invoices: ParsedInvoice[] = [];

  let trnsHeader: string[] = [];
  let splHeader:  string[] = [];
  let current: ParsedInvoice | null = null;

  const colIndex = (header: string[], name: string): number => header.indexOf(name);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw) continue;
    const cells = raw.split('\t');
    const tag = String(cells[0] ?? '').trim().toUpperCase();
    if (!tag) continue;

    if (tag === '!TRNS') {
      trnsHeader = cells.map((c) => String(c).trim().toUpperCase());
      continue;
    }
    if (tag === '!SPL') {
      splHeader = cells.map((c) => String(c).trim().toUpperCase());
      continue;
    }
    if (tag === '!ENDTRNS') {
      continue;
    }

    if (tag === 'TRNS') {
      if (trnsHeader.length === 0) {
        warnings.push(`TRNS row before !TRNS header at line ${i + 1}; skipping`);
        continue;
      }
      const typeIdx = colIndex(trnsHeader, 'TRNSTYPE');
      const type = String(cells[typeIdx] ?? '').trim().toUpperCase();
      if (type !== 'INVOICE') {
        current = null;  // skip CHECK/BILL/etc — only INVOICE handled.
        continue;
      }
      const dateStr  = String(cells[colIndex(trnsHeader, 'DATE')]    ?? '').trim();
      const nameStr  = String(cells[colIndex(trnsHeader, 'NAME')]    ?? '').trim();
      const amountStr = String(cells[colIndex(trnsHeader, 'AMOUNT')] ?? '0').trim();
      const memoStr  = String(cells[colIndex(trnsHeader, 'MEMO')]    ?? '').trim();
      const dueIdx   = colIndex(trnsHeader, 'DUEDATE');
      const dueStr   = dueIdx >= 0 ? String(cells[dueIdx] ?? '').trim() : '';
      // DOCNUM column varies — try DOCNUM, then NUM. Fall back to
      // memo-extracted INV-NNN if absent.
      const docIdx1 = colIndex(trnsHeader, 'DOCNUM');
      const docIdx2 = colIndex(trnsHeader, 'NUM');
      let docNum = '';
      if (docIdx1 >= 0) docNum = String(cells[docIdx1] ?? '').trim();
      if (!docNum && docIdx2 >= 0) docNum = String(cells[docIdx2] ?? '').trim();
      if (!docNum) {
        // Fall back to memo extraction: look for "INV-12345" or similar.
        const m = memoStr.match(/INV[-_]?\d+/i);
        if (m) docNum = m[0];
      }

      current = {
        docNum,
        name:    nameStr,
        date:    parseDateToIso(dateStr),
        dueDate: parseDateToIso(dueStr) || parseDateToIso(dateStr),
        amount:  Math.abs(Number(amountStr) || 0),
        memo:    memoStr,
        lineItems: [],
      };
      invoices.push(current);
      continue;
    }

    if (tag === 'SPL') {
      if (!current) continue;
      if (splHeader.length === 0) {
        warnings.push(`SPL row before !SPL header at line ${i + 1}; skipping`);
        continue;
      }
      const amtStr  = String(cells[colIndex(splHeader, 'AMOUNT')] ?? '0').trim();
      const qtyIdx  = colIndex(splHeader, 'QNTY');
      const priceIdx = colIndex(splHeader, 'PRICE');
      const itemIdx  = colIndex(splHeader, 'INVITEM');
      const memoIdx  = colIndex(splHeader, 'MEMO');
      const qty   = qtyIdx   >= 0 ? Number(cells[qtyIdx]   ?? '1') || 1 : 1;
      // SPL AMOUNT is negative for income lines. Negate for line price.
      const lineAmount = -Number(amtStr) || 0;
      const price = priceIdx >= 0 && cells[priceIdx]
        ? Number(cells[priceIdx]) || lineAmount / Math.max(qty, 1)
        : lineAmount / Math.max(qty, 1);
      const code = itemIdx >= 0 ? String(cells[itemIdx] ?? '').trim() : '';
      const desc = memoIdx >= 0 ? String(cells[memoIdx] ?? '').trim() : '';
      current.lineItems.push({
        code,
        description: desc || code || 'Line',
        quantity:    qty,
        price,
      });
      continue;
    }

    if (tag === 'ENDTRNS') {
      current = null;
      continue;
    }
    // Unknown tag — ignore.
  }

  return invoices;
}

/**
 * MM/dd/yyyy → yyyy-MM-dd. Tolerant of 2-digit year (assumes 20xx) and
 * already-ISO inputs.
 */
function parseDateToIso(s: string): string {
  const t = String(s ?? '').trim();
  if (!t) return '';
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (!m) return '';
  const mm = String(m[1]).padStart(2, '0');
  const dd = String(m[2]).padStart(2, '0');
  let yyyy = m[3];
  if (yyyy.length === 2) yyyy = `20${yyyy}`;
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Normalize a client name for fuzzy matching across IIF / SB. Lowercases,
 * strips diacritics, collapses whitespace, drops trailing " - active"
 * (CB Clients convention). Mirrors stax_normalizeName_ semantics.
 */
function normalizeName(name: string): string {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*-\s*active\s*$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
