/**
 * stax-catalog-sync — Supabase Edge Function
 *
 * Syncs a single service_catalog item to the Stax payment platform catalog.
 * Creates a new Stax catalog item if stax_item_id is null, otherwise updates.
 * Stores the returned Stax item_id back to service_catalog.stax_item_id.
 *
 * Request:  POST { serviceId: uuid }
 * Response: { ok: boolean, stax_item_id?: string, action?: 'created'|'updated', error?: string }
 *
 * Stax API:
 *   POST https://apiprod.fattlabs.com/item          — create catalog item
 *   PUT  https://apiprod.fattlabs.com/item/{id}      — update catalog item
 *   Docs: https://fattmerchant.docs.apiary.io
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STAX_API_BASE = 'https://apiprod.fattlabs.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ServiceRow {
  id: string;
  code: string;
  name: string;
  category: string;
  billing: string;
  flat_rate: number | null;
  rates: Record<string, number> | null;
  taxable: boolean;
  active: boolean;
  stax_item_id: string | null;
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return jsonResp({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const { serviceId } = await req.json();
    if (!serviceId) {
      return jsonResp({ ok: false, error: 'serviceId required' }, 400);
    }

    // ── Env ──
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const staxApiKey = Deno.env.get('STAX_API_KEY');
    if (!staxApiKey) {
      return jsonResp({ ok: false, error: 'STAX_API_KEY not configured' }, 500);
    }

    const sb = createClient(supabaseUrl, supabaseServiceKey);

    // ── Read service ──
    const { data: svc, error: fetchErr } = await sb
      .from('service_catalog')
      .select('id, code, name, category, billing, flat_rate, rates, taxable, active, stax_item_id')
      .eq('id', serviceId)
      .single();

    if (fetchErr || !svc) {
      return jsonResp({ ok: false, error: fetchErr?.message ?? 'Service not found' }, 404);
    }

    const service = svc as ServiceRow;

    // ── Build Stax item payload ──
    // Use flat_rate if set (even if 0), otherwise average of class rates
    let price = service.flat_rate != null ? Number(service.flat_rate) : 0;
    if (service.flat_rate == null && service.rates) {
      const vals = Object.values(service.rates).filter((v): v is number => typeof v === 'number' && v > 0);
      if (vals.length > 0) price = vals.reduce((a, b) => a + b, 0) / vals.length;
    }

    const staxPayload = {
      item: service.code,
      details: service.name,
      quantity: 1,
      price: price,
      is_default: false,
      is_taxable: service.taxable,
      in_inventory: false,
    };

    let action: 'created' | 'updated';
    let staxItemId: string;

    if (service.stax_item_id) {
      // ── Update existing ──
      const resp = await fetch(`${STAX_API_BASE}/item/${service.stax_item_id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${staxApiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(staxPayload),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        // If 404, item was deleted from Stax — create new
        if (resp.status === 404) {
          const createResult = await createStaxItem(staxApiKey, staxPayload);
          if (!createResult.ok) return jsonResp({ ok: false, error: createResult.error }, 500);
          staxItemId = createResult.id;
          action = 'created';
        } else {
          return jsonResp({ ok: false, error: `Stax PUT failed: ${resp.status} ${errText}` }, 500);
        }
      } else {
        const body = await resp.json();
        staxItemId = body.id ?? service.stax_item_id;
        action = 'updated';
      }
    } else {
      // ── Create new ──
      const createResult = await createStaxItem(staxApiKey, staxPayload);
      if (!createResult.ok) return jsonResp({ ok: false, error: createResult.error }, 500);
      staxItemId = createResult.id;
      action = 'created';
    }

    // ── Store stax_item_id back ──
    const { error: updateErr } = await sb
      .from('service_catalog')
      .update({ stax_item_id: staxItemId })
      .eq('id', serviceId);

    if (updateErr) {
      console.error('Failed to store stax_item_id:', updateErr.message);
      // Non-fatal — the Stax item was created/updated successfully
    }

    return jsonResp({ ok: true, stax_item_id: staxItemId, action });

  } catch (err) {
    console.error('stax-catalog-sync error:', err);
    return jsonResp({ ok: false, error: String(err) }, 500);
  }
});

// ── Helpers ──

async function createStaxItem(
  apiKey: string,
  payload: Record<string, unknown>
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const resp = await fetch(`${STAX_API_BASE}/item`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    return { ok: false, error: `Stax POST failed: ${resp.status} ${errText}` };
  }
  const body = await resp.json();
  if (!body.id) {
    return { ok: false, error: 'Stax returned no item id' };
  }
  return { ok: true, id: body.id };
}

function jsonResp(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
