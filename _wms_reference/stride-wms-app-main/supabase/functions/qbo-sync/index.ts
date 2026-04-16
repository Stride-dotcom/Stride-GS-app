/**
 * QuickBooks Online Invoice Sync Handler
 *
 * Endpoints:
 * - POST /qbo-sync/invoices - Push billing events as invoices to QBO
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const QBO_CLIENT_ID = Deno.env.get("QBO_CLIENT_ID") || "";
const QBO_CLIENT_SECRET = Deno.env.get("QBO_CLIENT_SECRET") || "";
const QBO_ENVIRONMENT = Deno.env.get("QBO_ENVIRONMENT") || "sandbox";

const QBO_API_BASE = QBO_ENVIRONMENT === "production"
  ? "https://quickbooks.api.intuit.com/v3/company"
  : "https://sandbox-quickbooks.api.intuit.com/v3/company";

const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Service type to QBO Item name mapping
const SERVICE_TYPE_MAP: Record<string, string> = {
  receiving: "Receiving Services",
  storage: "Storage Services",
  storage_daily: "Storage Services",
  assembly: "Assembly Services",
  inspection: "Inspection Services",
  repair: "Repair Services",
  shipping: "Shipping Services",
  delivery: "Delivery Services",
  disposal: "Disposal Services",
  custom: "Custom Charges",
  returns: "Returns Processing",
  handling: "Handling Services",
  will_call: "Will Call Services",
  task_completion: "Task Services",
  service_scan: "Service Charges",
  addon: "Additional Charges",
};

interface BillingEvent {
  id: string;
  account_id: string;
  event_type: string;
  charge_type: string;
  description: string;
  quantity: number;
  unit_rate: number;
  total_amount: number;
  occurred_at: string;
  item_id?: string;
  item_code?: string;
}

interface SyncRequest {
  billingEvents: BillingEvent[];
  periodStart: string;
  periodEnd: string;
}

interface SyncResult {
  accountId: string;
  accountName: string;
  success: boolean;
  qboInvoiceId?: string;
  qboInvoiceNumber?: string;
  error?: string;
  lineCount: number;
  total: number;
}

// Helper: Refresh access token
async function refreshAccessToken(
  supabase: any,
  connection: any,
  tenantId: string
): Promise<string> {
  const tokenResponse = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${btoa(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`)}`,
      "Accept": "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: connection.refresh_token,
    }),
  });

  const tokens = await tokenResponse.json();

  if (tokens.error) {
    throw new Error(`Token refresh failed: ${tokens.error_description || tokens.error}`);
  }

  const now = new Date();
  await supabase
    .from("qbo_connections")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      access_token_expires_at: new Date(now.getTime() + (tokens.expires_in || 3600) * 1000).toISOString(),
      refresh_token_expires_at: new Date(now.getTime() + (tokens.x_refresh_token_expires_in || 8726400) * 1000).toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("tenant_id", tenantId);

  return tokens.access_token;
}

// Helper: Find or create QBO customer
async function findOrCreateCustomer(
  supabase: any,
  accessToken: string,
  realmId: string,
  tenantId: string,
  accountId: string,
  displayName: string,
  email?: string
): Promise<string> {
  // Check local mapping first
  const { data: existingMap } = await supabase
    .from("qbo_customer_map")
    .select("qbo_customer_id")
    .eq("tenant_id", tenantId)
    .eq("account_id", accountId)
    .single();

  if (existingMap?.qbo_customer_id) {
    return existingMap.qbo_customer_id;
  }

  // Escape single quotes for QBO query
  const escapedName = displayName.replace(/'/g, "\\'");

  // Query QBO for existing customer
  const queryResponse = await fetch(
    `${QBO_API_BASE}/${realmId}/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${escapedName}'`)}`,
    {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
    }
  );

  const queryResult = await queryResponse.json();
  const existingCustomer = queryResult.QueryResponse?.Customer?.[0];

  if (existingCustomer) {
    // Save mapping
    await supabase.from("qbo_customer_map").insert({
      tenant_id: tenantId,
      account_id: accountId,
      qbo_customer_id: existingCustomer.Id,
      qbo_display_name: existingCustomer.DisplayName,
    });
    return existingCustomer.Id;
  }

  // Create new customer in QBO
  const customerPayload: any = {
    DisplayName: displayName,
  };

  if (email) {
    customerPayload.PrimaryEmailAddr = { Address: email };
  }

  // Handle sub-customer (Main:Sub format)
  if (displayName.includes(":")) {
    const [parentName] = displayName.split(":");
    const escapedParentName = parentName.replace(/'/g, "\\'");

    // Find parent customer
    const parentQuery = await fetch(
      `${QBO_API_BASE}/${realmId}/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${escapedParentName}'`)}`,
      {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/json",
        },
      }
    );
    const parentResult = await parentQuery.json();
    const parentCustomer = parentResult.QueryResponse?.Customer?.[0];

    if (parentCustomer) {
      customerPayload.ParentRef = { value: parentCustomer.Id };
    }
  }

  const createResponse = await fetch(`${QBO_API_BASE}/${realmId}/customer`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(customerPayload),
  });

  const createResult = await createResponse.json();
  const newCustomer = createResult.Customer;

  if (!newCustomer) {
    const errorMsg = createResult.Fault?.Error?.[0]?.Message || "Unknown error creating customer";
    throw new Error(`Failed to create QBO customer: ${errorMsg}`);
  }

  // Save mapping
  await supabase.from("qbo_customer_map").insert({
    tenant_id: tenantId,
    account_id: accountId,
    qbo_customer_id: newCustomer.Id,
    qbo_display_name: newCustomer.DisplayName,
  });

  return newCustomer.Id;
}

// Helper: Find or create QBO item (product/service)
async function findOrCreateItem(
  supabase: any,
  accessToken: string,
  realmId: string,
  tenantId: string,
  serviceType: string
): Promise<string> {
  const normalizedType = serviceType.toLowerCase().replace(/\s+/g, "_");
  const itemName = SERVICE_TYPE_MAP[normalizedType] || "Warehouse Services";

  // Check local mapping first
  const { data: existingMap } = await supabase
    .from("qbo_item_map")
    .select("qbo_item_id")
    .eq("tenant_id", tenantId)
    .eq("service_type", normalizedType)
    .single();

  if (existingMap?.qbo_item_id) {
    return existingMap.qbo_item_id;
  }

  // Query QBO for existing item
  const escapedItemName = itemName.replace(/'/g, "\\'");
  const queryResponse = await fetch(
    `${QBO_API_BASE}/${realmId}/query?query=${encodeURIComponent(`SELECT * FROM Item WHERE Name = '${escapedItemName}'`)}`,
    {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
    }
  );

  const queryResult = await queryResponse.json();
  const existingItem = queryResult.QueryResponse?.Item?.[0];

  if (existingItem) {
    // Save mapping
    await supabase.from("qbo_item_map").insert({
      tenant_id: tenantId,
      service_type: normalizedType,
      qbo_item_id: existingItem.Id,
      qbo_item_name: existingItem.Name,
    });
    return existingItem.Id;
  }

  // Get income account reference (required for creating items)
  // Try to find "Services" or use the first income account
  const accountQuery = await fetch(
    `${QBO_API_BASE}/${realmId}/query?query=${encodeURIComponent("SELECT * FROM Account WHERE AccountType = 'Income' MAXRESULTS 1")}`,
    {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
    }
  );
  const accountResult = await accountQuery.json();
  const incomeAccount = accountResult.QueryResponse?.Account?.[0];

  if (!incomeAccount) {
    throw new Error("No income account found in QuickBooks");
  }

  // Create new service item in QBO
  const itemPayload = {
    Name: itemName,
    Type: "Service",
    IncomeAccountRef: { value: incomeAccount.Id },
  };

  const createResponse = await fetch(`${QBO_API_BASE}/${realmId}/item`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(itemPayload),
  });

  const createResult = await createResponse.json();
  const newItem = createResult.Item;

  if (!newItem) {
    // If item creation fails, try to find a generic fallback
    console.error("Failed to create QBO item:", createResult);

    const fallbackQuery = await fetch(
      `${QBO_API_BASE}/${realmId}/query?query=${encodeURIComponent("SELECT * FROM Item WHERE Name = 'Warehouse Services'")}`,
      {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/json",
        },
      }
    );
    const fallbackResult = await fallbackQuery.json();
    const fallbackItem = fallbackResult.QueryResponse?.Item?.[0];

    if (fallbackItem) {
      return fallbackItem.Id;
    }

    throw new Error(`Failed to create or find QBO item for service type: ${serviceType}`);
  }

  // Save mapping
  await supabase.from("qbo_item_map").insert({
    tenant_id: tenantId,
    service_type: normalizedType,
    qbo_item_id: newItem.Id,
    qbo_item_name: newItem.Name,
  });

  return newItem.Id;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get user's tenant
    const { data: profile } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!profile?.tenant_id) {
      return new Response(JSON.stringify({ error: "No tenant found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tenantId = profile.tenant_id;

    // Get QBO connection
    const { data: connection } = await supabase
      .from("qbo_connections")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .single();

    if (!connection) {
      return new Response(JSON.stringify({ error: "QuickBooks not connected" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if refresh token is expired
    if (new Date(connection.refresh_token_expires_at) < new Date()) {
      return new Response(JSON.stringify({
        error: "QuickBooks connection expired. Please reconnect."
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Refresh access token if needed
    let accessToken = connection.access_token;
    if (new Date(connection.access_token_expires_at) < new Date(Date.now() + 5 * 60 * 1000)) {
      try {
        accessToken = await refreshAccessToken(supabase, connection, tenantId);
      } catch (refreshError) {
        console.error("Token refresh failed:", refreshError);
        return new Response(JSON.stringify({
          error: "Failed to refresh QuickBooks token. Please reconnect."
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const realmId = connection.realm_id;

    // Parse request body
    const { billingEvents, periodStart, periodEnd }: SyncRequest = await req.json();

    if (!billingEvents || billingEvents.length === 0) {
      return new Response(JSON.stringify({ error: "No billing events provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group billing events by account_id
    const eventsByAccount = billingEvents.reduce((acc, event) => {
      if (!acc[event.account_id]) {
        acc[event.account_id] = [];
      }
      acc[event.account_id].push(event);
      return acc;
    }, {} as Record<string, BillingEvent[]>);

    const results: SyncResult[] = [];

    // Process each account
    for (const [accountId, events] of Object.entries(eventsByAccount)) {
      try {
        // Get account details
        const { data: account } = await supabase
          .from("accounts")
          .select("account_name, account_code, billing_contact_email, primary_contact_email, parent_account_id")
          .eq("id", accountId)
          .single();

        if (!account) {
          results.push({
            accountId,
            accountName: "Unknown",
            success: false,
            error: "Account not found in database",
            lineCount: events.length,
            total: events.reduce((sum, e) => sum + (e.total_amount || 0), 0),
          });
          continue;
        }

        // Build display name with Main:Sub format if has parent
        let displayName = account.account_name;
        if (account.parent_account_id) {
          const { data: parent } = await supabase
            .from("accounts")
            .select("account_name")
            .eq("id", account.parent_account_id)
            .single();
          if (parent) {
            displayName = `${parent.account_name}:${account.account_name}`;
          }
        }

        // Find or create QBO customer
        const qboCustomerId = await findOrCreateCustomer(
          supabase,
          accessToken,
          realmId,
          tenantId,
          accountId,
          displayName,
          account.billing_contact_email || account.primary_contact_email
        );

        // Prepare invoice lines
        const lines = [];
        for (const event of events) {
          // Find or create QBO item for this service type
          const serviceType = event.event_type || event.charge_type || "custom";
          const qboItemId = await findOrCreateItem(
            supabase,
            accessToken,
            realmId,
            tenantId,
            serviceType
          );

          lines.push({
            DetailType: "SalesItemLineDetail",
            Amount: event.total_amount || 0,
            Description: event.description || `${serviceType} charge`,
            SalesItemLineDetail: {
              ItemRef: { value: qboItemId },
              Qty: event.quantity || 1,
              UnitPrice: event.unit_rate || 0,
              ServiceDate: event.occurred_at?.split("T")[0] || new Date().toISOString().split("T")[0],
            },
          });
        }

        // Create invoice in QBO
        const invoicePayload = {
          CustomerRef: { value: qboCustomerId },
          Line: lines,
          TxnDate: new Date().toISOString().split("T")[0],
          PrivateNote: `Stride WMS Billing Report: ${periodStart} to ${periodEnd}`,
        };

        const invoiceResponse = await fetch(`${QBO_API_BASE}/${realmId}/invoice`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          body: JSON.stringify(invoicePayload),
        });

        const invoiceResult = await invoiceResponse.json();

        if (invoiceResult.Invoice) {
          const qboInvoice = invoiceResult.Invoice;

          // Log the sync
          await supabase.from("qbo_invoice_sync_log").insert({
            tenant_id: tenantId,
            account_id: accountId,
            qbo_invoice_id: qboInvoice.Id,
            qbo_invoice_number: qboInvoice.DocNumber,
            period_start: periodStart,
            period_end: periodEnd,
            line_count: events.length,
            subtotal: events.reduce((sum, e) => sum + (e.total_amount || 0), 0),
            total_amount: qboInvoice.TotalAmt,
            billing_event_ids: events.map(e => e.id),
            synced_by: user.id,
            status: "success",
          });

          // Mark billing events as invoiced
          await supabase
            .from("billing_events")
            .update({
              status: "invoiced",
              invoiced_at: new Date().toISOString(),
            })
            .in("id", events.map(e => e.id));

          results.push({
            accountId,
            accountName: displayName,
            success: true,
            qboInvoiceId: qboInvoice.Id,
            qboInvoiceNumber: qboInvoice.DocNumber,
            lineCount: events.length,
            total: qboInvoice.TotalAmt,
          });
        } else {
          const errorMsg = invoiceResult.Fault?.Error?.[0]?.Message || "Unknown QBO error";

          // Log the failed sync
          await supabase.from("qbo_invoice_sync_log").insert({
            tenant_id: tenantId,
            account_id: accountId,
            qbo_invoice_id: "",
            period_start: periodStart,
            period_end: periodEnd,
            line_count: events.length,
            subtotal: events.reduce((sum, e) => sum + (e.total_amount || 0), 0),
            billing_event_ids: events.map(e => e.id),
            synced_by: user.id,
            status: "failed",
            error_message: errorMsg,
          });

          results.push({
            accountId,
            accountName: displayName,
            success: false,
            error: errorMsg,
            lineCount: events.length,
            total: events.reduce((sum, e) => sum + (e.total_amount || 0), 0),
          });
        }
      } catch (accountError: any) {
        console.error(`Error processing account ${accountId}:`, accountError);
        results.push({
          accountId,
          accountName: "Unknown",
          success: false,
          error: accountError.message || "Unknown error",
          lineCount: events.length,
          total: events.reduce((sum, e) => sum + (e.total_amount || 0), 0),
        });
      }
    }

    // Update last_sync_at on connection
    await supabase
      .from("qbo_connections")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("tenant_id", tenantId);

    return new Response(JSON.stringify({
      success: true,
      results,
      summary: {
        totalAccounts: results.length,
        successCount: results.filter(r => r.success).length,
        failedCount: results.filter(r => !r.success).length,
        totalInvoiced: results.filter(r => r.success).reduce((sum, r) => sum + r.total, 0),
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("QBO Sync Error:", error);
    return new Response(JSON.stringify({ error: error.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
