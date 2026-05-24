/**
 * gas-proxy — shared helper for SB Edge Functions that delegate to the
 * StrideAPI GAS web app for an action GAS still owns (sheet writes, Drive
 * PDF generation, QB OAuth, Stax SDK calls that have no Deno port, etc).
 *
 * Mirrors the existing reverse-writethrough pattern from `reverse-writethrough.ts`
 * but for ARBITRARY GAS doPost actions (not just the `writeThroughReverse` table
 * dispatcher). The router (apiRouter.ts) already supports flipping any action
 * to its SB EF — this helper lets the SB EF re-dispatch back to GAS for the
 * parts that genuinely require GAS, while still owning the SB-side bookkeeping
 * (audit-log, return-shape normalization, etc).
 *
 * ── When to use ───────────────────────────────────────────────────────────
 *   The handler's authoritative effect lives in a sheet, a Drive folder, or
 *   a GAS-only SDK (QBO OAuth, Stax SDK that requires Apps Script timers).
 *   For pure DB CRUD, write to public.* directly — don't proxy.
 *
 * ── Contract ──────────────────────────────────────────────────────────────
 *   GAS_API_URL + GAS_API_TOKEN must be set on the EF. If either is missing
 *   this returns an error response — the caller decides whether to surface
 *   it or fall back. See onboard-client-sb for the rollback-on-failure
 *   pattern.
 */

export interface GasProxyResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  httpStatus?: number;
}

/**
 * Forward a payload to a GAS doPost action and return the parsed JSON.
 *
 * The GAS web app accepts the action as a query param and the body as JSON
 * POST (see StrideAPI.gs `doPost` switch). `token` is required by every
 * GAS doPost handler.
 *
 * @param action  e.g. 'generateWcDoc', 'qbExport', 'voidRepairQuote'
 * @param payload the body the GAS handler expects (will be JSON-stringified)
 * @param opts    optional { timeoutMs, contentType }
 */
export async function gasProxy<T = unknown>(
  action: string,
  payload: Record<string, unknown>,
  opts: { timeoutMs?: number } = {},
): Promise<GasProxyResult<T>> {
  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  if (!gasUrl || !gasToken) {
    return { ok: false, error: 'GAS_API_URL or GAS_API_TOKEN not configured on this Edge Function' };
  }

  const timeoutMs = opts.timeoutMs ?? 55_000; // EFs have a 60s hard cap on Supabase
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${gasUrl}?action=${encodeURIComponent(action)}&token=${encodeURIComponent(gasToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        ok: false,
        error: `GAS returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`,
        httpStatus: res.status,
      };
    }

    // GAS handlers commonly return one of:
    //   { success: true, ... }    (most P3+ handlers)
    //   { error: '...' }          (handler-level error)
    //   raw object with no envelope
    if (parsed && typeof parsed === 'object') {
      const p = parsed as { success?: boolean; error?: string };
      if (p.error) return { ok: false, error: p.error, httpStatus: res.status, data: parsed as T };
      if (p.success === false) return { ok: false, error: 'GAS reported success=false', httpStatus: res.status, data: parsed as T };
    }
    if (!res.ok) {
      return { ok: false, error: `GAS HTTP ${res.status}`, httpStatus: res.status, data: parsed as T };
    }
    return { ok: true, data: parsed as T, httpStatus: res.status };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Convenience: GAS doPost dispatcher proxy that preserves request_id and
 * caller_email threading. Use this for handlers where GAS expects the same
 * params it always received from the apiPost path.
 */
export async function gasProxyWithMeta<T = unknown>(
  action: string,
  body: Record<string, unknown>,
  meta: { requestId?: string; callerEmail?: string; clientSheetId?: string; tenantId?: string } = {},
): Promise<GasProxyResult<T>> {
  const payload: Record<string, unknown> = {
    ...body,
    ...(meta.requestId    ? { requestId: meta.requestId } : {}),
    ...(meta.callerEmail  ? { callerEmail: meta.callerEmail } : {}),
    ...(meta.clientSheetId ? { clientSheetId: meta.clientSheetId } : {}),
    ...(meta.tenantId && !meta.clientSheetId ? { clientSheetId: meta.tenantId } : {}),
  };
  return gasProxy<T>(action, payload);
}

/**
 * Standard CORS headers used by every SB-primary handler.
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Standard JSON response helper. Matches the body shape used across all
 * existing -sb handlers ({ success: true, ... } or { error: '...', code? }).
 */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
