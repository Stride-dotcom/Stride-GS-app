/**
 * apply-intake-on-submit — post-submission cleanup for ALL intake modes.
 *
 * Two responsibilities:
 *
 * 1. Always: deactivate the intake link the prospect just used. Anon role
 *    can't UPDATE client_intake_links under RLS, so the form's
 *    submitIntake delegates that flip to this service-role function.
 *    Without this step, the link stayed active=true after submission, and
 *    the resign-reminder cron kept finding it as a usable link for
 *    clients with stale hashes — causing repeat emails to clients who'd
 *    already completed their intake (the 2026-05-07 bug).
 *
 * 2. Refresh-mode only (Decision #28): when an existing client submits a
 *    refresh / preference_update intake, propagate their values onto the
 *    clients row immediately — not after a staff click. Mirrors the
 *    legacy IntakesPanel "Create Client from Intake" refresh branch.
 *    Includes the last_intake_body_sha256 stamp the resign-cron uses.
 *
 * For new-client intakes (no clientSpreadsheetId yet), only step 1 runs;
 * step 2 happens later in IntakesPanel.handleCreateClient when an admin
 * activates the intake.
 *
 * Request:  POST { intakeId: string, clientSpreadsheetId?: string, linkId?: string }
 *           If linkId omitted, falls back to the intake row's link_id column.
 * Response: { success: true, linkDeactivated, refreshApplied, ... } or
 *           { success: false, error }
 *
 * Idempotent: if the intake is already auto_applied or activated, the
 * refresh propagation is skipped but the link deactivation still runs
 * (cheap, ensures links from earlier sessions where the deactivation was
 * lost still get cleaned up).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const intakeId = String(body.intakeId || '').trim();
    const clientSpreadsheetId = String(body.clientSpreadsheetId || '').trim();
    const explicitLinkId = String(body.linkId || '').trim();
    if (!intakeId) {
      return json({ success: false, error: 'intakeId is required' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceKey) {
      console.error('[apply-intake-on-submit] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      return json({ success: false, error: 'Server misconfigured' }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Load the just-inserted intake row.
    const { data: intake, error: intakeErr } = await supabase
      .from('client_intakes')
      .select('*')
      .eq('id', intakeId)
      .maybeSingle();
    if (intakeErr || !intake) {
      return json({ success: false, error: `intake not found: ${intakeErr?.message || intakeId}` }, 404);
    }

    // 2. ALWAYS deactivate the intake link the prospect just used. Single-
    // shot links: prospect submitted, link is now consumed. Anon role
    // can't do this UPDATE under RLS so this is the only path. Best-
    // effort — a failure is logged but doesn't block the rest. Resolve
    // linkId from explicit param, else from the intake row's link_id
    // column (always populated when the intake came in via a hosted link).
    const linkId = explicitLinkId || String(intake.link_id || '').trim();
    let linkDeactivated = false;
    if (linkId) {
      try {
        const { error: linkErr } = await supabase
          .from('client_intake_links')
          .update({ active: false, used_at: new Date().toISOString() })
          .eq('link_id', linkId);
        if (linkErr) {
          console.warn('[apply-intake-on-submit] link deactivation failed (non-fatal):', linkErr.message);
        } else {
          linkDeactivated = true;
        }
      } catch (e) {
        console.warn('[apply-intake-on-submit] link deactivation threw (non-fatal):', e);
      }
    }

    // 3. Refresh-mode propagation gate. New-client intakes (intake_mode='new')
    // need a staff click to activate via IntakesPanel because postOnboardClient
    // creates the client sheet/folder structure — service role can't do that.
    // For those, we stop here (link is already deactivated above).
    const isRefresh = intake.intake_mode === 'refresh' ||
                      intake.submission_source === 'intake_preference_update';
    if (!isRefresh || !clientSpreadsheetId) {
      return json({
        success: true,
        linkDeactivated,
        refreshApplied: false,
        reason: isRefresh ? 'no clientSpreadsheetId provided' : 'new-client intake — admin will activate via IntakesPanel',
      });
    }

    // 4. Idempotency on the propagation half: if already applied, skip.
    // Link deactivation above still ran (idempotent itself — repeat
    // updates to active=false are no-ops).
    if (intake.status === 'auto_applied' || intake.status === 'activated') {
      return json({ success: true, linkDeactivated, refreshApplied: false, alreadyApplied: true });
    }

    // 5. Verify the target client exists and matches the linked spreadsheet.
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('spreadsheet_id, tenant_id, name')
      .eq('spreadsheet_id', clientSpreadsheetId)
      .maybeSingle();
    if (clientErr || !client) {
      return json({ success: false, error: `client not found: ${clientErr?.message || clientSpreadsheetId}` }, 404);
    }

    // 5. Build the clients update payload from intake values.
    // Map intake fields → clients columns.
    const updatePayload: Record<string, unknown> = {
      // Contact info
      contact_name:    intake.contact_name || undefined,
      email:           intake.email || undefined,
      phone:           intake.phone || undefined,
      // Billing contact (Supabase-only fields per PR #221+)
      billing_contact_name: intake.billing_contact_name || undefined,
      billing_email:        intake.billing_email || undefined,
      billing_address:      intake.billing_address || undefined,
      // Payment preferences (the autopay opt-in change)
      auto_charge:     intake.autopay_elected === true ? true
                       : intake.autopay_elected === false ? false
                       : undefined,
      // Tax fields
      tax_exempt:           intake.tax_exempt ?? undefined,
      tax_exempt_reason:    intake.tax_exempt_reason || undefined,
      resale_cert_expires:  intake.resale_cert_expires || undefined,
      // Auto-inspection preference
      auto_inspection: intake.auto_inspect ?? undefined,
      // Notification contacts (jsonb)
      notification_contacts: intake.notification_contacts ?? undefined,
      // Intake state mirror (Decision #26)
      last_intake_submitted_at: intake.submitted_at,
      last_intake_body_sha256:  intake.body_sha256,
      // Reset reminder cron — they just signed, so they're current.
      last_intake_reminder_at:  null,
    };
    // Strip undefined keys so we don't blank out fields the form omitted.
    for (const k of Object.keys(updatePayload)) {
      if (updatePayload[k] === undefined) delete updatePayload[k];
    }

    const { error: upErr } = await supabase
      .from('clients')
      .update(updatePayload)
      .eq('spreadsheet_id', clientSpreadsheetId);
    if (upErr) {
      return json({ success: false, error: `clients update failed: ${upErr.message}` }, 500);
    }

    // 5b. Propagate insurance choice + declared value to client_insurance.
    //
    // The `clients` row has no columns for insurance — the canonical store
    // is `client_insurance` (one row per tenant, drives the daily auto-
    // billing cron at 20260420160001_insurance_auto_billing_cron.sql).
    // Pre-2026-06-02 this propagation was missing, so refresh intakes
    // that elected stride_coverage with a declared value never landed in
    // client_insurance — operators clicked "Apply Refresh to Client" and
    // saw $0 in the InsuranceBlock even though the intake had $20K. The
    // auto-billing cron then either skipped or billed $0 for affected
    // tenants. Reported by Justin on the Weidner Apartment Homes /
    // Complete Design intake.
    //
    // Logic:
    //   stride_coverage + value > 0 → upsert client_insurance with
    //     coverage_type='stride_coverage', declared_value, active=true.
    //     On INSERT: stamp inception_date=today + next_billing_date=1st
    //     of next month (first charge prorated) + monthly_rate_per_10k
    //     from service_catalog.INSURANCE (matches useClientInsurance.seed
    //     / firstBillingAnchor). On EXISTING row: update
    //     declared_value + coverage_type + reactivate, but PRESERVE
    //     inception/next_billing so an existing billing cycle isn't
    //     reset. monthly_rate_per_10k also preserved on existing rows so
    //     a service_catalog rate change doesn't retro-apply.
    //   own_policy → if an existing client_insurance row exists, flip
    //     it to coverage_type='own_policy', active=false, cancelled_at=
    //     now() so the cron stops billing. No new row created — the
    //     client doesn't want coverage.
    //   anything else (null / unrecognized choice) → no-op.
    const insuranceChoiceRaw = String(intake.insurance_choice ?? '').trim().toLowerCase();
    // eis_coverage is the legacy alias for stride_coverage (session 77
    // rename). Old intakes may still carry the original value; new ones
    // write stride_coverage. Treat them as identical for billing purposes.
    const insuranceChoice = insuranceChoiceRaw === 'eis_coverage' ? 'stride_coverage' : insuranceChoiceRaw;
    const declaredValue   = Number(intake.insurance_declared_value ?? 0) || 0;
    let insuranceSync: string | null = null;
    try {
      if (insuranceChoice === 'stride_coverage' && declaredValue > 0) {
        const { data: existing } = await supabase
          .from('client_insurance')
          .select('id')
          .eq('tenant_id', clientSpreadsheetId)
          .maybeSingle();
        if (existing) {
          const { error: updErr } = await supabase.from('client_insurance').update({
            declared_value: declaredValue,
            coverage_type:  'stride_coverage',
            active:         true,
            cancelled_at:   null,
            client_name:    intake.business_name || undefined,
          }).eq('tenant_id', clientSpreadsheetId);
          if (updErr) insuranceSync = `update failed: ${updErr.message}`;
          else        insuranceSync = `updated declared_value=${declaredValue} stride_coverage active=true`;
        } else {
          const { data: svc } = await supabase
            .from('service_catalog')
            .select('flat_rate')
            .eq('code', 'INSURANCE')
            .maybeSingle();
          const rate = svc && typeof svc.flat_rate === 'number' ? svc.flat_rate : null;
          if (rate == null) {
            insuranceSync = 'skipped: no INSURANCE rate in service_catalog (admin must set rate in Settings → Pricing first)';
          } else {
            const today = new Date();
            const toDateStr = (d: Date) => d.toISOString().slice(0, 10);
            // First billing date = 1st of next month so the daily cron
            // prorates the partial signup month (mirror of
            // src/lib/insuranceBilling.ts firstBillingAnchor; EFs can't
            // import from src/).
            const firstBillingAnchor = (from: Date): string => {
              const y = from.getFullYear();
              const m = from.getMonth();
              const ny = m === 11 ? y + 1 : y;
              const nm = m === 11 ? 0 : m + 1;
              return `${ny}-${String(nm + 1).padStart(2, '0')}-01`;
            };
            const { error: insErr } = await supabase.from('client_insurance').insert({
              tenant_id:            clientSpreadsheetId,
              client_name:          intake.business_name || '',
              coverage_type:        'stride_coverage',
              declared_value:       declaredValue,
              monthly_rate_per_10k: rate,
              inception_date:       toDateStr(today),
              next_billing_date:    firstBillingAnchor(today),
              active:               true,
            });
            if (insErr) insuranceSync = `insert failed: ${insErr.message}`;
            else        insuranceSync = `created declared_value=${declaredValue} stride_coverage rate=${rate}/$10K`;
          }
        }
      } else if (insuranceChoice === 'own_policy') {
        const { data: existing } = await supabase
          .from('client_insurance')
          .select('id, active')
          .eq('tenant_id', clientSpreadsheetId)
          .maybeSingle();
        if (existing) {
          const { error: updErr } = await supabase.from('client_insurance').update({
            coverage_type: 'own_policy',
            active:        false,
            cancelled_at:  new Date().toISOString(),
          }).eq('tenant_id', clientSpreadsheetId);
          if (updErr) insuranceSync = `own_policy deactivate failed: ${updErr.message}`;
          else        insuranceSync = 'deactivated existing coverage (own_policy elected)';
        } else {
          insuranceSync = 'skipped: own_policy elected, no existing coverage row to deactivate';
        }
      }
    } catch (e) {
      // Never fatal — clients update already committed, intake is still
      // valid. Operator can fix manually in the InsuranceBlock card.
      insuranceSync = `unexpected: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (insuranceSync) {
      console.log(`[apply-intake-on-submit] insurance sync for ${clientSpreadsheetId}: ${insuranceSync}`);
    }

    // 6. Resale cert: copy from intake bucket → resale-certs bucket + signed URL.
    // Mirrors IntakesPanel.tsx lines 129-156 exactly.
    const certWarnings: string[] = [];
    if (intake.tax_exempt !== false && intake.resale_cert_path) {
      try {
        const sourcePath: string = intake.resale_cert_path;
        const sourceBase = sourcePath.split('/').pop() ?? `cert-${Date.now()}.pdf`;
        const certDestKey = `${clientSpreadsheetId}/${Date.now()}-${sourceBase}`;
        const { error: copyErr } = await supabase.storage
          .from('documents')
          .copy(sourcePath, certDestKey, { destinationBucket: 'resale-certs' });
        if (copyErr && !/already exists/i.test(copyErr.message)) {
          certWarnings.push(`cert → resale-certs copy: ${copyErr.message}`);
        } else {
          const { data: signed } = await supabase.storage
            .from('resale-certs')
            .createSignedUrl(certDestKey, 60 * 60 * 24 * 365 * 10);
          if (signed?.signedUrl) {
            await supabase
              .from('clients')
              .update({
                resale_cert_url: signed.signedUrl,
                resale_cert_uploaded_at: new Date().toISOString(),
              })
              .eq('spreadsheet_id', clientSpreadsheetId);
          }
        }
      } catch (e) {
        certWarnings.push(`cert link error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 7. Stamp the intake as auto-applied.
    const { error: stampErr } = await supabase
      .from('client_intakes')
      .update({
        status: 'auto_applied',
        activated_at: new Date().toISOString(),
      })
      .eq('id', intakeId);
    if (stampErr) {
      console.warn('[apply-intake-on-submit] status stamp failed (non-fatal):', stampErr.message);
    }

    // 8. Mirror the refreshed clients row OUT to the per-tenant Settings
    // tab + CB Clients tab via push-client-settings-to-sheet.
    //
    // The Postgres trigger `trg_propagate_clients_to_sheet` (migration
    // 20260520140000_clients_writeback_trigger.sql) ALREADY fires on the
    // UPDATE above, so this call is belt-and-suspenders. Two reasons we
    // keep the explicit invocation in addition to the trigger:
    //   (1) The trigger is fail-open on missing app.settings GUCs.
    //       Explicit invocation works regardless of GUC state.
    //   (2) Latency: refreshes that flip auto_inspection / autopay are
    //       user-facing — operators expect the change visible in the
    //       sheet within seconds. The trigger uses pg_net which queues
    //       async; an explicit await reduces variance.
    // The GAS writer is idempotent so the duplicate fire is a no-op
    // on identical values.
    let sheetMirrorOk = false;
    let sheetMirrorError: string | null = null;
    try {
      const mirrorResp = await fetch(`${supabaseUrl}/functions/v1/push-client-settings-to-sheet`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          spreadsheet_id: clientSpreadsheetId,
          requestedBy:    'apply-intake-on-submit',
        }),
      });
      const mirrorJson = await mirrorResp.json().catch(() => ({}));
      sheetMirrorOk = mirrorResp.ok && mirrorJson.ok === true;
      if (!sheetMirrorOk) {
        sheetMirrorError = String(mirrorJson.error || `HTTP ${mirrorResp.status}`);
        console.warn('[apply-intake-on-submit] sheet mirror failed (non-fatal):', sheetMirrorError);
      }
    } catch (e) {
      sheetMirrorError = e instanceof Error ? e.message : String(e);
      console.warn('[apply-intake-on-submit] sheet mirror threw (non-fatal):', sheetMirrorError);
    }

    return json({
      success: true,
      linkDeactivated,
      refreshApplied: true,
      clientSpreadsheetId,
      certWarnings,
      sheetMirrorOk,
      ...(sheetMirrorError ? { sheetMirrorError } : {}),
      ...(insuranceSync ? { insuranceSync } : {}),
    });
  } catch (e) {
    console.error('[apply-intake-on-submit] unhandled error:', e);
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
