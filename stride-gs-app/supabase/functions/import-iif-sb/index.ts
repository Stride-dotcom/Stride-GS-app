/**
 * import-iif-sb — [MIGRATION-P6] SHADOW for `importIIF`.
 *
 * GAS answer key: handleImportIIF_ (StrideAPI.gs:34595), doPost action
 * "importIIF". Returns { invoicesAdded, invoicesUpdated,
 * duplicatesSkipped, exceptionsLogged, summary }.
 *
 * Shadow contract (per the P6 build directive): parse the IIF data and
 * COMPUTE what rows WOULD be created / updated / skipped — never write
 * the Stax "Invoices" / "Exceptions" sheets, never mirror to Supabase,
 * never call Stax. Returns the computed decision set + the same headline
 * counts GAS returns, for parity comparison.
 *
 * State source: the migration target is Supabase-authoritative, so the
 * dedup check reads `public.stax_invoices` (the mirror of the Stax
 * Invoices sheet; key qb_invoice_no, carries status) and the Stax
 * customer-id resolution reads `public.clients` (mirror of CB Clients).
 *
 * KNOWN-DIVERGENCE (intentional, documented for the parity reviewer):
 * GAS stax_buildClientStaxMap_ also indexes by the CB Clients "Stax
 * Customer Name" column and can echo that alias into the row's Customer
 * field. `public.clients` has no stax_customer_name column (sbClientRow_
 * never mirrors it), so this shadow indexes by name + qb_customer_name
 * only and always falls back resolvedName → inv.name. That is exactly
 * GAS's behavior when the alias column is blank (the common case);
 * clients with a non-blank Stax alias will surface as a parity
 * mismatch on the `customer` field only — expected, not a bug.
 *
 * MIG-008: no Stax / QBO / Resend client is constructed. The only
 * client is the Supabase service-role reader (a read-only mirror
 * lookup, not a stripped credential). EXTERNAL_PAYMENT_CALLS = false.
 *
 * Request:  POST { fileContent: <base64 IIF>, fileName?: string,
 *                   requestId?: string }
 * Response: { ok, invoicesAdded, invoicesUpdated, duplicatesSkipped,
 *             exceptionsLogged, summary, computed }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  staxNormalizeName,
  staxParseIIF,
  type ParsedTrns,
} from '../_shared/stax-iif-shadow.ts';

const EXTERNAL_PAYMENT_CALLS = false; // MIG-008 invariant — never flip.

interface ClientStaxEntry {
  staxCustomerId: string;
  staxCustomerName: string;
  clientName: string;
}

interface ComputedDecision {
  docNum: string;
  action: 'insert' | 'update' | 'skip_non_pending' | 'exception_no_customer';
  customer: string;
  staxCustomerId: string;
  amount: number;
  existingStatus?: string;
  reason?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);

  let payload: { fileContent?: string; fileName?: string };
  try {
    payload = await req.json();
  } catch (e) {
    return json({ ok: false, error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}` }, 400);
  }

  const fileContent = String(payload?.fileContent ?? '').trim();
  const fileName = String(payload?.fileName ?? 'import.iif').trim();
  if (!fileContent) {
    return json({ ok: false, error: 'fileContent is required', errorCode: 'MISSING_FIELD' }, 400);
  }

  // GAS: Utilities.newBlob(Utilities.base64Decode(...)).getDataAsString()
  let decoded: string;
  try {
    decoded = decodeBase64Utf8(fileContent);
  } catch (e) {
    return json(
      { ok: false, error: `Failed to decode base64 fileContent: ${e instanceof Error ? e.message : String(e)}`, errorCode: 'DECODE_ERROR' },
      400,
    );
  }

  const parsed = staxParseIIF(decoded);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: 'Server misconfigured (no Supabase mirror access)' }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey);

  // ── Build the client → Stax map from public.clients (mirror of CB
  //    Clients). GAS stax_buildClientStaxMap_ keys by client name and
  //    qb_customer_name (and stax_customer_name, which SB lacks — see
  //    KNOWN-DIVERGENCE in the header). Empty map on read failure so we
  //    degrade to "no Stax ID available", matching GAS.
  const clientStaxMap: Record<string, ClientStaxEntry> = {};
  try {
    const { data: clients, error } = await sb
      .from('clients')
      .select('name,qb_customer_name,stax_customer_id')
      .eq('active', true);
    if (error) throw error;
    for (const c of clients ?? []) {
      const clientName = String(c.name ?? '').trim();
      const staxId = String(c.stax_customer_id ?? '').trim();
      if (!clientName || !staxId) continue;
      const qbName = String(c.qb_customer_name ?? '').trim();
      const entry: ClientStaxEntry = {
        staxCustomerId: staxId,
        staxCustomerName: '', // no stax_customer_name column in SB mirror
        clientName,
      };
      clientStaxMap[staxNormalizeName(clientName)] = entry;
      if (qbName) clientStaxMap[staxNormalizeName(qbName)] = entry;
    }
  } catch (e) {
    // GAS returns {} on any error; mirror that (degrade, don't fail).
    console.log(`import-iif-sb clientStaxMap load failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── Dedup map: qb_invoice_no → existing status (mirror of the Stax
  //    Invoices sheet's existingByQbNo + status read). First occurrence
  //    wins, matching GAS's `if (ek && !existingByQbNo[ek])`.
  const existingByQbNo: Record<string, string> = {};
  try {
    const { data: rows, error } = await sb
      .from('stax_invoices')
      .select('qb_invoice_no,status');
    if (error) throw error;
    for (const r of rows ?? []) {
      const k = String(r.qb_invoice_no ?? '').trim();
      if (k && !(k in existingByQbNo)) {
        existingByQbNo[k] = String(r.status ?? '').trim().toUpperCase();
      }
    }
  } catch (e) {
    console.log(`import-iif-sb stax_invoices dedup load failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
  }

  let invoicesAdded = 0;
  let invoicesUpdated = 0;
  let duplicatesSkipped = 0;
  const decisions: ComputedDecision[] = [];

  for (let i = 0; i < parsed.invoices.length; i++) {
    const inv: ParsedTrns = parsed.invoices[i];
    const docNum = String(inv.docNum ?? '').trim();
    if (!docNum) continue;

    const lookupName = staxNormalizeName(inv.name);
    const clientEntry = clientStaxMap[lookupName] || null;
    const resolvedStaxId = clientEntry ? clientEntry.staxCustomerId : '';
    const resolvedName = (clientEntry && clientEntry.staxCustomerName) || String(inv.name ?? '');

    const existed = docNum in existingByQbNo;
    if (existed) {
      const existingStatus = existingByQbNo[docNum];
      // GAS: only PENDING rows refresh; anything else is left untouched
      // and counts as a skipped duplicate.
      if (existingStatus && existingStatus !== 'PENDING') {
        duplicatesSkipped++;
        decisions.push({
          docNum, action: 'skip_non_pending', customer: resolvedName,
          staxCustomerId: resolvedStaxId, amount: Number(inv.amount) || 0,
          existingStatus,
        });
        continue;
      }
      invoicesUpdated++;
      decisions.push({
        docNum, action: 'update', customer: resolvedName,
        staxCustomerId: resolvedStaxId, amount: Number(inv.amount) || 0,
        existingStatus: existingStatus || 'PENDING',
      });
      continue;
    }

    // No Stax Customer ID → NO_CUSTOMER exception, no insert.
    if (!resolvedStaxId) {
      duplicatesSkipped++; // GAS increments duplicatesSkipped here too
      decisions.push({
        docNum, action: 'exception_no_customer', customer: String(inv.name ?? ''),
        staxCustomerId: '', amount: Number(inv.amount) || 0,
        reason: 'No Stax Customer ID on the matching client record. Set one on CB Clients and re-import.',
      });
      continue;
    }

    invoicesAdded++;
    decisions.push({
      docNum, action: 'insert', customer: resolvedName,
      staxCustomerId: resolvedStaxId, amount: Number(inv.amount) || 0,
    });
  }

  // GAS routes blank-doc# INVOICE rows to Exceptions during parse. Those
  // plus the NO_CUSTOMER exceptions form exceptionsLogged. GAS's
  // exceptionsLogged counter only counts the parse-stage (blank doc#)
  // exceptions written to the Exceptions tab — the NO_CUSTOMER ones are
  // appended individually and not added to exceptionsLogged. Mirror that
  // exactly: exceptionsLogged = parsed.exceptions.length.
  const exceptionsLogged = parsed.exceptions.length;

  const summary =
    `Imported ${fileName}: ${invoicesAdded} added, ${invoicesUpdated} updated, ` +
    `${duplicatesSkipped} skipped, ${exceptionsLogged} exceptions`;

  return json({
    ok: true,
    externalPaymentCalls: EXTERNAL_PAYMENT_CALLS,
    invoicesAdded,
    invoicesUpdated,
    duplicatesSkipped,
    exceptionsLogged,
    summary,
    computed: {
      fileName,
      rawRowCount: parsed.rows.length,
      parsedInvoiceCount: parsed.invoices.length,
      blankDocExceptions: parsed.exceptions,
      decisions,
    },
  });
});
