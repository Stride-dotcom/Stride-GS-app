import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STRIPE_SMS_SEGMENT_METER_EVENT_NAME =
  (Deno.env.get("STRIPE_SMS_SEGMENT_METER_EVENT_NAME") ?? "").trim();

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-04-10",
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sms-billing-sync-token",
};

interface SyncUsageRequest {
  tenant_id?: string | null;
  limit?: number;
  max_tenants?: number;
}

interface RoleRow {
  roles?: { name?: string | null } | null;
}

type ExecutionMode = "job_token" | "authenticated_admin_dev" | "authenticated_tenant";

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNullableUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

function parseLimit(value: unknown, fallback: number, max: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
      ? Number.parseInt(value, 10)
      : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 1), max);
}

function directionTimestamp(usageDate: string, direction: string): number {
  const hour = direction === "inbound" ? 12 : 18;
  const dt = new Date(`${usageDate}T${String(hour).padStart(2, "0")}:00:00.000Z`);
  return Math.floor(dt.getTime() / 1000);
}

function toNonNegativeInt(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : 0;
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

async function fetchStripeMeterEventName(meterId: string): Promise<string | null> {
  const response = await fetch(`https://api.stripe.com/v1/billing/meters/${encodeURIComponent(meterId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof body?.error?.message === "string"
        ? body.error.message
        : `Stripe meter lookup failed with status ${response.status}`;
    throw new Error(message);
  }

  return toNonEmptyString((body as Record<string, unknown>).event_name);
}

async function createStripeMeterEvent(params: {
  eventName: string;
  stripeCustomerId: string;
  value: number;
  timestamp: number;
  identifier: string;
}): Promise<{ id: string | null }> {
  const form = new URLSearchParams();
  form.set("event_name", params.eventName);
  form.set("payload[stripe_customer_id]", params.stripeCustomerId);
  form.set("payload[value]", String(params.value));
  form.set("timestamp", String(params.timestamp));
  form.set("identifier", params.identifier);

  const response = await fetch("https://api.stripe.com/v1/billing/meter_events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof body?.error?.message === "string"
        ? body.error.message
        : `Stripe meter event create failed with status ${response.status}`;
    throw new Error(message);
  }

  return {
    id: toNonEmptyString((body as Record<string, unknown>).id),
  };
}

function isMissingRollupSyncColumnsError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as { code?: string }).code : "";
  const message =
    typeof error === "object" && error !== null ? String((error as { message?: string }).message || "") : "";
  const details =
    typeof error === "object" && error !== null ? String((error as { details?: string }).details || "") : "";
  const normalized = `${message} ${details}`.toLowerCase();
  if (code === "42703") return true;
  return (
    normalized.includes("stripe_sync_status") ||
    normalized.includes("stripe_synced_segment_count") ||
    normalized.includes("stripe_last_sync_attempt_at") ||
    normalized.includes("stripe_last_synced_at")
  );
}

async function updateRollupSyncState(
  supabase: any,
  rollupId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from("sms_usage_daily_rollups")
    .update(payload)
    .eq("id", rollupId);

  if (!error) return;
  if (isMissingRollupSyncColumnsError(error)) {
    console.warn("SMS rollup Stripe sync columns not present yet; skipping rollup sync field update.");
    return;
  }
  throw new Error(error.message || "Failed to update SMS rollup sync state.");
}

async function resolveExecutionContext(
  req: Request,
  requestedTenantId: string | null,
): Promise<
  | { ok: true; mode: ExecutionMode; tenantIds: string[] }
  | { ok: false; response: Response }
> {
  const expectedJobToken = (Deno.env.get("SMS_BILLING_SYNC_JOB_TOKEN") || "").trim();
  const providedJobToken = (req.headers.get("x-sms-billing-sync-token") || "").trim();
  const allowAllWithJobToken = (Deno.env.get("SMS_USAGE_SYNC_ALLOW_ALL") || "").trim().toLowerCase() === "true";

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  if (expectedJobToken && providedJobToken === expectedJobToken) {
    if (requestedTenantId) {
      return { ok: true, mode: "job_token", tenantIds: [requestedTenantId] };
    }
    if (!allowAllWithJobToken) {
      return {
        ok: false,
        response: jsonResponse(
          { ok: false, error: "tenant_id is required for job-token usage sync unless SMS_USAGE_SYNC_ALLOW_ALL=true." },
          400,
        ),
      };
    }
    const { data: rows, error } = await serviceClient
      .from("tenant_subscriptions")
      .select("tenant_id")
      .not("stripe_subscription_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) {
      return { ok: false, response: jsonResponse({ ok: false, error: error.message }, 500) };
    }
    const tenantIds = Array.from(new Set((rows || []).map((r: any) => String(r.tenant_id)).filter(Boolean)));
    return { ok: true, mode: "job_token", tenantIds };
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, response: jsonResponse({ ok: false, error: "Unauthorized" }, 401) };
  }

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(token);
  if (authError || !user) {
    return { ok: false, response: jsonResponse({ ok: false, error: "Unauthorized" }, 401) };
  }

  const { data: roleRows, error: roleError } = await authClient
    .from("user_roles")
    .select("roles:role_id(name)")
    .eq("user_id", user.id)
    .is("deleted_at", null);
  if (roleError) {
    return { ok: false, response: jsonResponse({ ok: false, error: roleError.message }, 500) };
  }

  const roleNames = (Array.isArray(roleRows) ? roleRows : [])
    .map((row) => (row as RoleRow)?.roles?.name ?? null)
    .map((name) => toNonEmptyString(name))
    .filter((name): name is string => Boolean(name));

  const isAdminDev = roleNames.includes("admin_dev");
  const canSync = isAdminDev || roleNames.includes("admin") || roleNames.includes("billing_manager");
  if (!canSync) {
    return {
      ok: false,
      response: jsonResponse(
        { ok: false, error: "Only admin_dev, admin, or billing_manager can sync SMS usage to Stripe." },
        403,
      ),
    };
  }

  const { data: userRow, error: userRowError } = await authClient
    .from("users")
    .select("tenant_id")
    .eq("id", user.id)
    .maybeSingle();
  if (userRowError || !userRow?.tenant_id) {
    return { ok: false, response: jsonResponse({ ok: false, error: "Unable to resolve user tenant." }, 400) };
  }

  if (requestedTenantId && isAdminDev) {
    return { ok: true, mode: "authenticated_admin_dev", tenantIds: [requestedTenantId] };
  }

  if (!requestedTenantId || !isAdminDev) {
    return {
      ok: true,
      mode: isAdminDev ? "authenticated_admin_dev" : "authenticated_tenant",
      tenantIds: [String(userRow.tenant_id)],
    };
  }

  return { ok: true, mode: "authenticated_admin_dev", tenantIds: [requestedTenantId] };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ ok: false, error: "Required environment variables are not configured." }, 500);
  }

  const body = (await req.json().catch(() => ({}))) as SyncUsageRequest;
  const requestedTenantId = toNullableUuid(body.tenant_id ?? null);
  const perTenantLimit = parseLimit(body.limit, 400, 5000);
  const maxTenants = parseLimit(body.max_tenants, 50, 200);

  const execution = await resolveExecutionContext(req, requestedTenantId);
  if (!execution.ok) return execution.response;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const tenantIds = execution.tenantIds.slice(0, maxTenants);
  const tenantResults: Array<Record<string, unknown>> = [];
  let totalSynced = 0;
  let totalErrored = 0;
  let totalSkipped = 0;

  for (const tenantId of tenantIds) {
    try {
      // Ensure latest events are rolled up before syncing.
      await (supabase as any).rpc("rpc_admin_rollup_sms_usage_events", {
        p_tenant_id: tenantId,
        p_limit: 20000,
      });

      const { data: subscriptionRow, error: subError } = await supabase
        .from("tenant_subscriptions")
        .select(
          "stripe_subscription_id, plan_id, stripe_subscription_item_id_sms_metered",
        )
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (subError) throw new Error(subError.message || "Failed to load tenant subscription.");

      const stripeSubscriptionId = toNonEmptyString(subscriptionRow?.stripe_subscription_id);
      if (!stripeSubscriptionId) {
        tenantResults.push({
          tenant_id: tenantId,
          synced: 0,
          skipped: 1,
          errored: 0,
          reason: "no_stripe_subscription_id",
        });
        totalSkipped += 1;
        continue;
      }

      const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
        expand: ["items.data.price"],
      });
      const items = Array.isArray(stripeSubscription.items?.data) ? stripeSubscription.items.data : [];
      const stripeCustomerId =
        typeof stripeSubscription.customer === "string"
          ? stripeSubscription.customer
          : toNonEmptyString(stripeSubscription.customer?.id);

      let meteredItemId = toNonEmptyString(subscriptionRow?.stripe_subscription_item_id_sms_metered);
      let meteredPriceId: string | null = null;
      let planMeterEventName: string | null = null;
      const planId = toNullableUuid(subscriptionRow?.plan_id ?? null);
      if (planId) {
        const { data: planRow } = await supabase
          .from("saas_plans")
          .select("stripe_price_id_sms_segment_metered, stripe_meter_event_name_sms_segments")
          .eq("id", planId)
          .maybeSingle();
        meteredPriceId = toNonEmptyString(planRow?.stripe_price_id_sms_segment_metered);
        planMeterEventName = toNonEmptyString(planRow?.stripe_meter_event_name_sms_segments);
      }

      if (!meteredItemId && meteredPriceId) {
        const found = items.find((item: any) => {
          const price = item.price;
          const priceId = typeof price === "string" ? price : price?.id ?? null;
          return priceId === meteredPriceId;
        });
        meteredItemId = found?.id ?? null;
      }

      if (!meteredItemId) {
        tenantResults.push({
          tenant_id: tenantId,
          synced: 0,
          skipped: 1,
          errored: 0,
          reason: "no_sms_metered_subscription_item",
        });
        totalSkipped += 1;
        continue;
      }

      if (!meteredPriceId) {
        const found = items.find((item: any) => item.id === meteredItemId);
        if (found) {
          const price = found.price;
          meteredPriceId = typeof price === "string" ? price : toNonEmptyString(price?.id);
        }
      }

      const meteredItem = items.find((item: any) => item.id === meteredItemId) ?? null;
      const meteredPriceObject = meteredItem?.price;
      const meterId =
        meteredPriceObject && typeof meteredPriceObject !== "string"
          ? toNonEmptyString((meteredPriceObject as any)?.recurring?.meter)
          : null;

      let meterEventName = STRIPE_SMS_SEGMENT_METER_EVENT_NAME || planMeterEventName || null;
      if (!meterEventName && meterId) {
        try {
          meterEventName = await fetchStripeMeterEventName(meterId);
        } catch (meterLookupError) {
          console.warn(
            `Unable to resolve Stripe meter event_name for meter ${meterId}:`,
            meterLookupError instanceof Error ? meterLookupError.message : meterLookupError,
          );
        }
      }

      const syncMode: "meter_events" | "legacy_usage_records" = meterEventName
        ? "meter_events"
        : "legacy_usage_records";

      const periodStartUnix = Number(stripeSubscription.current_period_start || 0);
      const periodEndUnix = Number(stripeSubscription.current_period_end || 0);
      const nowUnix = Math.floor(Date.now() / 1000);

      const { data: rollups, error: rollupError } = await (supabase as any)
        .from("sms_usage_daily_rollups")
        .select(
          "id, usage_date, direction, segment_count, stripe_synced_segment_count, stripe_sync_status",
        )
        .eq("tenant_id", tenantId)
        .order("usage_date", { ascending: true })
        .limit(perTenantLimit * 3);
      if (rollupError) throw new Error(rollupError.message || "Failed to load SMS usage rollups.");

      const candidates = (Array.isArray(rollups) ? rollups : [])
        .filter((row) => {
          const segmentCount = toNonNegativeInt(row.segment_count);
          const syncedCount = toNonNegativeInt(row.stripe_synced_segment_count);
          const status = String(row.stripe_sync_status ?? "pending");
          return status === "pending" || status === "error" || segmentCount !== syncedCount;
        })
        .slice(0, perTenantLimit);

      let synced = 0;
      let skipped = 0;
      let errored = 0;

      for (const row of candidates) {
        const rollupId = String(row.id);
        const usageDate = String(row.usage_date);
        const direction = String(row.direction || "outbound");
        const segmentCount = toNonNegativeInt(row.segment_count);
        const currentSyncedCount = toNonNegativeInt(row.stripe_synced_segment_count);
        const attemptAt = new Date().toISOString();

        const baseTimestamp = directionTimestamp(usageDate, direction);

        if (periodStartUnix > 0 && baseTimestamp < periodStartUnix) {
          await updateRollupSyncState(supabase, rollupId, {
            stripe_sync_status: "skipped",
            stripe_synced_segment_count: segmentCount,
            stripe_last_sync_attempt_at: attemptAt,
            stripe_last_synced_at: attemptAt,
            stripe_last_sync_error:
              "Rollup date is outside Stripe's current billing period; marked skipped to avoid stale backlog.",
          });
          skipped += 1;
          continue;
        }

        let timestamp = baseTimestamp;
        if (periodEndUnix > 0 && timestamp >= periodEndUnix) {
          timestamp = Math.max(periodStartUnix || 1, periodEndUnix - 60);
        }
        if (timestamp >= nowUnix) {
          timestamp = Math.max((periodStartUnix || 1), nowUnix - 60);
        }

        try {
          if (syncMode === "meter_events") {
            if (!stripeCustomerId) {
              throw new Error("Stripe customer ID is required for meter-event usage reporting.");
            }
            if (!meterEventName) {
              throw new Error(
                "Meter event_name is required for meter-based usage billing. Set STRIPE_SMS_SEGMENT_METER_EVENT_NAME.",
              );
            }

            const delta = segmentCount - currentSyncedCount;
            if (delta < 0) {
              throw new Error(
                `Rollup segment_count decreased from synced value (${currentSyncedCount} -> ${segmentCount}). Manual reconciliation required.`,
              );
            }

            if (delta === 0) {
              await updateRollupSyncState(supabase, rollupId, {
                stripe_sync_status: "synced",
                stripe_synced_segment_count: segmentCount,
                stripe_last_sync_attempt_at: attemptAt,
                stripe_last_synced_at: attemptAt,
                stripe_last_sync_error: null,
              });
              skipped += 1;
              continue;
            }

            const meterEvent = await createStripeMeterEvent({
              eventName: meterEventName,
              stripeCustomerId,
              value: delta,
              timestamp,
              identifier: `sms-usage:${tenantId}:${rollupId}:${segmentCount}:${currentSyncedCount}`,
            });

            await updateRollupSyncState(supabase, rollupId, {
              stripe_sync_status: "synced",
              stripe_synced_segment_count: segmentCount,
              stripe_last_sync_attempt_at: attemptAt,
              stripe_last_synced_at: attemptAt,
              stripe_last_sync_error: null,
              stripe_last_usage_record_id: meterEvent.id,
            });
            synced += 1;
          } else {
            const usageRecord = await stripe.subscriptionItems.createUsageRecord(
              meteredItemId,
              {
                quantity: segmentCount,
                timestamp,
                action: "set",
              },
              {
                idempotencyKey: `sms-usage:${tenantId}:${usageDate}:${direction}:${segmentCount}`,
              },
            );

            await updateRollupSyncState(supabase, rollupId, {
              stripe_sync_status: "synced",
              stripe_synced_segment_count: segmentCount,
              stripe_last_sync_attempt_at: attemptAt,
              stripe_last_synced_at: attemptAt,
              stripe_last_sync_error: null,
              stripe_last_usage_record_id: usageRecord.id,
            });
            synced += 1;
          }
        } catch (usageError) {
          const message = usageError instanceof Error ? usageError.message : "Unknown Stripe usage sync error.";
          await updateRollupSyncState(supabase, rollupId, {
            stripe_sync_status: "error",
            stripe_last_sync_attempt_at: attemptAt,
            stripe_last_sync_error: message,
          });
          errored += 1;
        }
      }

      tenantResults.push({
        tenant_id: tenantId,
        stripe_subscription_id: stripeSubscriptionId,
        stripe_subscription_item_id_sms_metered: meteredItemId,
        stripe_price_id_sms_metered: meteredPriceId,
        usage_sync_mode: syncMode,
        meter_event_name: meterEventName,
        candidates: candidates.length,
        synced,
        skipped,
        errored,
      });
      totalSynced += synced;
      totalSkipped += skipped;
      totalErrored += errored;
    } catch (tenantError) {
      const message = tenantError instanceof Error ? tenantError.message : "Unknown tenant sync error.";
      tenantResults.push({
        tenant_id: tenantId,
        synced: 0,
        skipped: 0,
        errored: 1,
        error: message,
      });
      totalErrored += 1;
    }
  }

  return jsonResponse({
    ok: true,
    mode: execution.mode,
    tenant_count: tenantResults.length,
    totals: {
      synced: totalSynced,
      skipped: totalSkipped,
      errored: totalErrored,
    },
    tenant_results: tenantResults,
  });
});
