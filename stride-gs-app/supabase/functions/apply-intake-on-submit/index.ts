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

    return json({
      success: true,
      linkDeactivated,
      refreshApplied: true,
      clientSpreadsheetId,
      certWarnings,
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
