// render-doc-pdf — server-side HTML → PDF via Cloudflare Browser Rendering.
//
// Replaces the blank-prone client-side html2canvas path for archived docs.
// React builds the doc HTML exactly as before (one shared template in
// `email_templates` + the docTokens.ts builders) and POSTs it here; we render
// it through a REAL headless Chrome (Cloudflare Browser Rendering /pdf) and
// return the PDF bytes. React keeps its existing dedupe / storage-upload /
// documents-insert / retry-queue logic unchanged.
//
//   POST { html: string }  →  200 application/pdf (bytes)
//                          →  4xx/5xx application/json { error }
//
// Auth: verify_jwt = true (gateway requires a valid Supabase JWT — browser is
// called by signed-in staff/admin). No DB writes here; the only secret read is
// the Cloudflare token from the service-role-only `public.app_config` table.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Cloudflare account id is an identifier, not a secret (it appears in dashboard
// URLs). The API TOKEN is the secret and lives in public.app_config.
const CF_ACCOUNT_ID = '75746d1a1eac89a239ac4c44c12034b3';
const CF_PDF_ENDPOINT = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/browser-rendering/pdf`;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let html: unknown;
  try {
    ({ html } = await req.json());
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  if (typeof html !== 'string' || html.trim().length === 0) {
    return json({ error: 'missing "html" string in body' }, 400);
  }
  // Cloudflare /pdf accepts request bodies up to 50 MB.
  if (html.length > 45_000_000) {
    return json({ error: 'html too large' }, 413);
  }

  // Read the Cloudflare token from the service-role-only config table.
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'server misconfigured' }, 500);
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: cfg, error: cfgErr } = await admin
    .from('app_config')
    .select('value')
    .eq('key', 'cloudflare_browser_token')
    .maybeSingle();
  if (cfgErr || !cfg?.value) {
    return json({ error: 'cloudflare render token not configured' }, 500);
  }

  // Render via Cloudflare Browser Rendering (real headless Chrome).
  let cfResp: Response;
  try {
    cfResp = await fetch(CF_PDF_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.value}`,
        'Content-Type': 'application/json',
      },
      // printBackground so the orange header bars / shaded boxes render.
      body: JSON.stringify({ html, pdfOptions: { printBackground: true } }),
    });
  } catch (e) {
    return json({ error: `cloudflare request failed: ${String(e)}` }, 502);
  }

  if (!cfResp.ok) {
    const detail = await cfResp.text().catch(() => '');
    return json({ error: `cloudflare render failed (${cfResp.status})`, detail: detail.slice(0, 600) }, 502);
  }

  const pdf = await cfResp.arrayBuffer();
  return new Response(pdf, {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/pdf', 'Content-Length': String(pdf.byteLength) },
  });
});
