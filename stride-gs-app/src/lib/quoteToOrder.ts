import { supabase } from './supabase';
import { calcQuote } from './quoteCalc';
import type { Quote, QuoteCatalog } from './quoteTypes';

/**
 * convertQuoteToDraftOrder — turn a Quote into a draft dt_orders row.
 *
 * Pre-fills only what a quote actually carries: client (tenant), contact
 * name, free-text address, and a human-readable pricing breakdown
 * dumped into the order's `details` field (the same column the
 * "Notes / Special Instructions" textarea writes to in
 * CreateDeliveryOrderModal).
 *
 * Everything else — service date, pickup leg, items, accessorials,
 * coverage, taxes — stays empty so the operator can fill it in via the
 * normal Edit Draft modal flow when they land on the order.
 */
export async function convertQuoteToDraftOrder(
  quote: Quote,
  catalog: QuoteCatalog,
  authUid: string | null,
  userRole: string,
): Promise<{ orderId: string; dtIdentifier: string }> {
  if (!quote.clientSheetId) {
    throw new Error('This quote is not linked to a client. Pick a client on the quote before converting.');
  }

  const breakdown = formatQuoteBreakdown(quote, catalog);

  const draftIdent = `DRAFT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  const payload: Record<string, unknown> = {
    tenant_id: quote.clientSheetId,
    timezone: 'America/Los_Angeles',
    source: 'app',
    review_status: 'draft',
    created_by_user: authUid,
    created_by_role: userRole || 'staff',
    order_type: 'delivery',
    is_pickup: false,
    contact_name: quote.client || null,
    contact_address: quote.address || null,
    details: breakdown,
    dt_identifier: draftIdent,
  };

  const { data: row, error } = await supabase
    .from('dt_orders')
    .insert(payload)
    .select('id, dt_identifier')
    .single();
  if (error || !row) throw new Error(`Could not create draft order: ${error?.message || 'unknown error'}`);

  return { orderId: (row as { id: string }).id, dtIdentifier: (row as { dt_identifier: string }).dt_identifier };
}

function formatQuoteBreakdown(quote: Quote, catalog: QuoteCatalog): string {
  const result = calcQuote(quote, catalog.services, catalog.classes, catalog.coverageOptions);
  const lines: string[] = [];
  lines.push(`Quote ${quote.number}${quote.project ? ` — ${quote.project}` : ''}`);
  if (quote.date) lines.push(`Quoted ${quote.date}${quote.expiration ? ` · expires ${quote.expiration}` : ''}`);
  lines.push('');

  if (result.lineItems.length > 0) {
    lines.push('Services:');
    for (const li of result.lineItems) {
      const cls = li.className ? `  [${li.className}]` : '';
      lines.push(`  • ${li.serviceName}${cls} — ${li.qty} × $${li.rate.toFixed(2)} = $${li.amount.toFixed(2)}`);
    }
    lines.push('');
  }

  lines.push(`Subtotal: $${result.subtotal.toFixed(2)}`);
  if (result.discountAmount > 0) lines.push(`Discount: -$${result.discountAmount.toFixed(2)}`);
  if (result.coverageCost > 0)   lines.push(`Coverage: $${result.coverageCost.toFixed(2)}`);
  if (result.taxAmount > 0)      lines.push(`Tax: $${result.taxAmount.toFixed(2)}`);
  lines.push(`Total: $${result.grandTotal.toFixed(2)}`);

  if (quote.customerNotes.trim()) {
    lines.push('');
    lines.push('Customer notes:');
    lines.push(quote.customerNotes.trim());
  }
  if (quote.internalNotes.trim()) {
    lines.push('');
    lines.push('Internal notes:');
    lines.push(quote.internalNotes.trim());
  }

  return lines.join('\n');
}
