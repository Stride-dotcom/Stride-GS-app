import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================
// TYPES
// ============================================================

interface ChatScope {
  tenant_id: string;
  account_id: string;
  subaccount_id?: string;
  user_id: string;
}

interface UIContext {
  route?: string;
  selected_item_ids?: string[];
}

interface DisambiguationState {
  type: 'items' | 'subaccounts';
  candidates: Array<{ id: string; label: string; index: number }>;
  original_query: string;
  action_context?: any;
}

interface SessionState {
  pending_disambiguation?: DisambiguationState;
  pending_draft?: {
    type: 'will_call' | 'repair_quote' | 'reallocation' | 'disposal';
    draft_id: string;
    summary: string;
  };
}

// ============================================================
// CLIENT-SAFE SYSTEM PROMPT
// ============================================================

const CLIENT_SYSTEM_PROMPT = `You are Stride Helper, a friendly AI assistant for warehouse clients. You help customers manage their stored items with warmth and clarity.

## Your Personality
- Warm, friendly, and approachable - like a helpful concierge
- Use plain English, avoid warehouse jargon
- Light emoji use is okay (but don't overdo it)
- Always explain what's happening in simple terms
- Be reassuring when things might seem complex

## What You Can Help With
- Creating will call / pickup requests for items
- Checking if items have arrived ("Did I get a Jones sofa yet?")
- Requesting repair quotes for damaged items
- Moving items between jobs/projects (subaccounts)
- Finding items and checking their status
- Viewing inspection reports

## Important Rules

### AMBIGUITY - Always Ask for Clarification
When a search returns multiple possible matches, you MUST:
1. Present a numbered list of options
2. Ask the user to choose: "Which one did you mean?"
3. Allow multi-select responses like "1 and 3" or "all"
4. Never guess - always confirm

Example response for multiple matches:
"I found a few items that could be what you're looking for:

1. **Blue Leather Sofa** - Job: Johnson Residence - Received Jan 15
2. **Blue Velvet Sofa** - Job: Smith Office - Received Jan 20
3. **Navy Sofa Set** - Job: Johnson Residence - Received Jan 22

Which one did you mean? You can say a number, multiple numbers (like "1 and 3"), or "all" if you need all of them."

### CONFIRMATION - Always Confirm Before Actions
Any action that changes data MUST follow this flow:
1. Create a draft and summarize what will happen
2. Ask for explicit confirmation: "Should I go ahead with this?"
3. Only execute if user confirms
4. If user says no, cancel and offer alternatives

### LINKS - Only When Asked
- Show item numbers, shipment numbers, etc. as plain text by default
- Only include clickable links when the user asks to "open", "view", or "show me" something
- Or when showing a draft that needs review

## Partial ID Matching
Users may reference items using partial numbers (e.g., "12345" instead of "ITM-00012345").
The system will attempt to resolve in this order:
1. Exact match
2. Ends-with match
3. Contains match

If more than one record matches, you MUST present the options and ask the user to choose.
Never guess when ambiguity exists.

## Available Tools
You have access to tools for:
- Searching items (scoped to the client's account) - supports partial ID matching
- Getting the most recent shipment
- Checking item status and location
- Viewing inspection reports
- Creating will call drafts
- Submitting will calls (after confirmation)
- Creating repair quote request drafts
- Submitting repair quote requests (after confirmation)
- Moving items between jobs (with preview and confirmation)

## Session Context
The user is a client portal user. All data you access is automatically scoped to their account - you cannot see other customers' data, internal notes, costs, rates, or employee information.

## Response Style Examples

Good: "Great news! Your Jones sofa arrived on January 15th. It's currently stored in our climate-controlled area. Would you like me to set up a pickup for it?"

Avoid: "Item ITM-00142 status=active, location_id=LOC-089, received_at=2024-01-15T14:30:00Z"

Good: "I'd be happy to help you schedule a pickup! I'll need to know: who will be picking up the items, and would you like them ready for a specific date?"

Avoid: "Initiating will_call_draft creation sequence. Please provide released_to_name parameter."

## Tool Workflow Rules
- You can call multiple tools in sequence - the system supports multi-round tool calls
- When a user mentions an item number, job name, or shipment number, the system will automatically resolve human-readable IDs to UUIDs
- Chain tool calls as needed: search → get details → take action
- If a search returns exactly one result, proceed automatically with the action
- If a search returns multiple results, present friendly options and ask which one they meant
- For complex operations (e.g., "create a will call for my dining table"), break into steps:
  1. First search for the item by description
  2. Get the item details to confirm it's the right one
  3. Create the will call draft and ask for confirmation

## Error Recovery
- If you can't find an item, try different search terms (description words, job name, etc.)
- If the user provides a partial item number, search for it - don't say you can't find it
- Always try to help before giving up
- Suggest alternatives if something isn't possible (e.g., "That item is already allocated for pickup. Would you like to check on that pickup instead?")`;

// ============================================================
// TOOL DEFINITIONS
// ============================================================

const TOOLS = [
  {
    name: "tool_search_items",
    description: "Search for items in the client's inventory by name, description, or job name",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term (item name, description, or job name)" },
      },
      required: ["query"],
    },
  },
  {
    name: "tool_get_last_inbound_shipment",
    description: "Get the most recent inbound shipment for this client",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "tool_get_shipment_items",
    description: "Get all items from a specific shipment",
    parameters: {
      type: "object",
      properties: {
        shipment_id: { type: "string", description: "The shipment ID" },
      },
      required: ["shipment_id"],
    },
  },
  {
    name: "tool_get_item_status",
    description: "Get detailed status of a specific item",
    parameters: {
      type: "object",
      properties: {
        item_id: { type: "string", description: "The item ID" },
      },
      required: ["item_id"],
    },
  },
  {
    name: "tool_get_inspection_reports",
    description: "Get inspection reports for a shipment, item, or job",
    parameters: {
      type: "object",
      properties: {
        shipment_id: { type: "string", description: "Filter by shipment ID" },
        item_id: { type: "string", description: "Filter by item ID" },
        subaccount_id: { type: "string", description: "Filter by job/subaccount ID" },
      },
    },
  },
  {
    name: "tool_create_will_call_draft",
    description: "Create a draft will call (pickup) request - requires confirmation before submitting",
    parameters: {
      type: "object",
      properties: {
        subaccount_id: { type: "string", description: "The job/subaccount ID" },
        item_ids: { type: "array", items: { type: "string" }, description: "Array of item IDs to pick up" },
        release_type: {
          type: "string",
          enum: ["customer", "third_party_carrier", "stride_delivery"],
          description: "How items will be picked up"
        },
        released_to_name: { type: "string", description: "Name of person/company picking up" },
        notes: { type: "string", description: "Optional notes for the pickup" },
      },
      required: ["item_ids", "release_type", "released_to_name"],
    },
  },
  {
    name: "tool_submit_will_call",
    description: "Submit a confirmed will call draft - only call after user confirms",
    parameters: {
      type: "object",
      properties: {
        draft_id: { type: "string", description: "The draft ID to submit" },
      },
      required: ["draft_id"],
    },
  },
  {
    name: "tool_create_repair_quote_request_draft",
    description: "Create a draft repair quote request - requires confirmation before submitting",
    parameters: {
      type: "object",
      properties: {
        subaccount_id: { type: "string", description: "The job/subaccount ID" },
        item_ids: { type: "array", items: { type: "string" }, description: "Array of item IDs needing repair" },
        notes: { type: "string", description: "Description of repair needed" },
      },
      required: ["item_ids"],
    },
  },
  {
    name: "tool_submit_repair_quote_request",
    description: "Submit a confirmed repair quote request draft - only call after user confirms",
    parameters: {
      type: "object",
      properties: {
        draft_id: { type: "string", description: "The draft ID to submit" },
      },
      required: ["draft_id"],
    },
  },
  {
    name: "tool_reallocate_items_preview",
    description: "Preview moving items from one job to another - shows what will change",
    parameters: {
      type: "object",
      properties: {
        item_ids: { type: "array", items: { type: "string" }, description: "Array of item IDs to move" },
        from_subaccount_id: { type: "string", description: "Source job/subaccount ID" },
        to_subaccount_id: { type: "string", description: "Destination job/subaccount ID" },
      },
      required: ["item_ids", "from_subaccount_id", "to_subaccount_id"],
    },
  },
  {
    name: "tool_reallocate_items_execute",
    description: "Execute the item move after user confirms - only call after confirmation",
    parameters: {
      type: "object",
      properties: {
        item_ids: { type: "array", items: { type: "string" }, description: "Array of item IDs to move" },
        from_subaccount_id: { type: "string", description: "Source job/subaccount ID" },
        to_subaccount_id: { type: "string", description: "Destination job/subaccount ID" },
      },
      required: ["item_ids", "from_subaccount_id", "to_subaccount_id"],
    },
  },
  {
    name: "tool_resolve_disambiguation",
    description: "Resolve a pending disambiguation by selecting from previous options",
    parameters: {
      type: "object",
      properties: {
        selections: {
          type: "array",
          items: { type: "number" },
          description: "Array of selected option numbers (1-indexed)"
        },
        select_all: { type: "boolean", description: "Set to true if user said 'all'" },
      },
      required: [],
    },
  },
  {
    name: "tool_get_subaccounts",
    description: "Get available jobs/subaccounts for the client",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  // ==================== ENHANCED CLIENT TOOLS ====================
  {
    name: "tool_search_items_natural",
    description: "Search items using natural language descriptions like 'blue sofa', 'Smith dining table', or job/project names",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "Natural language description of the item" },
        job_name: { type: "string", description: "Job/project name if mentioned" },
      },
      required: ["description"],
    },
  },
  {
    name: "tool_check_delivery_status",
    description: "Check if items have arrived or when a delivery is expected",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What the client is asking about (item description, shipment number, tracking number)" },
      },
      required: ["query"],
    },
  },
  {
    name: "tool_request_disposal",
    description: "Submit a request to dispose of items in storage",
    parameters: {
      type: "object",
      properties: {
        item_ids: { type: "array", items: { type: "string" }, description: "Item IDs to dispose" },
        reason: { type: "string", description: "Reason for disposal" },
      },
      required: ["item_ids"],
    },
  },
  {
    name: "tool_get_my_storage_summary",
    description: "Get a summary of everything the client has in storage - total items, by job, by status",
    parameters: {
      type: "object",
      properties: {},
    },
  },
];

// ============================================================
// ID RESOLUTION HELPERS
// ============================================================

function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

async function resolveHumanIds(
  supabase: any,
  toolName: string,
  params: any,
  scope: ChatScope
): Promise<any> {
  const resolved = { ...params };

  // Resolve shipment_id if it looks like a shipment number, not a UUID
  if (resolved.shipment_id && !isUUID(resolved.shipment_id)) {
    const numericPart = extractNumericPortion(resolved.shipment_id);
    const { data } = await supabase
      .from("shipments")
      .select("id")
      .eq("tenant_id", scope.tenant_id)
      .eq("account_id", scope.account_id)
      .ilike("shipment_number", `%${numericPart}%`)
      .is("deleted_at", null)
      .limit(1)
      .single();
    if (data) resolved.shipment_id = data.id;
  }

  // Resolve item_id if it looks like an item code, not a UUID
  if (resolved.item_id && !isUUID(resolved.item_id)) {
    const numericPart = extractNumericPortion(resolved.item_id);
    const { data } = await supabase
      .from("items")
      .select("id")
      .eq("tenant_id", scope.tenant_id)
      .eq("account_id", scope.account_id)
      .ilike("item_code", `%${numericPart}%`)
      .is("deleted_at", null)
      .limit(1)
      .single();
    if (data) resolved.item_id = data.id;
  }

  // Resolve item_ids array
  if (resolved.item_ids && Array.isArray(resolved.item_ids)) {
    const resolvedIds: string[] = [];
    for (const id of resolved.item_ids) {
      if (isUUID(id)) {
        resolvedIds.push(id);
      } else {
        const numericPart = extractNumericPortion(id);
        const { data } = await supabase
          .from("items")
          .select("id")
          .eq("tenant_id", scope.tenant_id)
          .eq("account_id", scope.account_id)
          .ilike("item_code", `%${numericPart}%`)
          .is("deleted_at", null)
          .limit(1)
          .single();
        if (data) resolvedIds.push(data.id);
      }
    }
    resolved.item_ids = resolvedIds;
  }

  // Resolve subaccount_id by sidemark name
  if (resolved.subaccount_id && !isUUID(resolved.subaccount_id)) {
    const { data } = await supabase
      .from("sidemarks")
      .select("id")
      .eq("tenant_id", scope.tenant_id)
      .eq("account_id", scope.account_id)
      .ilike("sidemark_name", `%${resolved.subaccount_id}%`)
      .is("deleted_at", null)
      .limit(1)
      .single();
    if (data) resolved.subaccount_id = data.id;
  }

  // Resolve from_subaccount_id by sidemark name
  if (resolved.from_subaccount_id && !isUUID(resolved.from_subaccount_id)) {
    const { data } = await supabase
      .from("sidemarks")
      .select("id")
      .eq("tenant_id", scope.tenant_id)
      .eq("account_id", scope.account_id)
      .ilike("sidemark_name", `%${resolved.from_subaccount_id}%`)
      .is("deleted_at", null)
      .limit(1)
      .single();
    if (data) resolved.from_subaccount_id = data.id;
  }

  // Resolve to_subaccount_id by sidemark name
  if (resolved.to_subaccount_id && !isUUID(resolved.to_subaccount_id)) {
    const { data } = await supabase
      .from("sidemarks")
      .select("id")
      .eq("tenant_id", scope.tenant_id)
      .eq("account_id", scope.account_id)
      .ilike("sidemark_name", `%${resolved.to_subaccount_id}%`)
      .is("deleted_at", null)
      .limit(1)
      .single();
    if (data) resolved.to_subaccount_id = data.id;
  }

  return resolved;
}

// ============================================================
// TOOL HANDLERS
// ============================================================

async function handleTool(
  supabase: any,
  toolName: string,
  params: any,
  scope: ChatScope,
  sessionState: SessionState
): Promise<{ result: any; newSessionState?: Partial<SessionState> }> {
  // Resolve human-readable IDs to UUIDs before executing
  const resolvedParams = await resolveHumanIds(supabase, toolName, params, scope);

  switch (toolName) {
    case "tool_search_items":
      return await toolSearchItems(supabase, resolvedParams, scope);

    case "tool_get_last_inbound_shipment":
      return await toolGetLastInboundShipment(supabase, scope);

    case "tool_get_shipment_items":
      return await toolGetShipmentItems(supabase, resolvedParams, scope);

    case "tool_get_item_status":
      return await toolGetItemStatus(supabase, resolvedParams, scope);

    case "tool_get_inspection_reports":
      return await toolGetInspectionReports(supabase, resolvedParams, scope);

    case "tool_create_will_call_draft":
      return await toolCreateWillCallDraft(supabase, resolvedParams, scope);

    case "tool_submit_will_call":
      return await toolSubmitWillCall(supabase, resolvedParams, scope);

    case "tool_create_repair_quote_request_draft":
      return await toolCreateRepairQuoteDraft(supabase, resolvedParams, scope);

    case "tool_submit_repair_quote_request":
      return await toolSubmitRepairQuoteRequest(supabase, resolvedParams, scope);

    case "tool_reallocate_items_preview":
      return await toolReallocateItemsPreview(supabase, resolvedParams, scope);

    case "tool_reallocate_items_execute":
      return await toolReallocateItemsExecute(supabase, resolvedParams, scope);

    case "tool_resolve_disambiguation":
      return await toolResolveDisambiguation(resolvedParams, sessionState);

    case "tool_get_subaccounts":
      return await toolGetSubaccounts(supabase, scope);

    case "tool_search_items_natural":
      return await toolSearchItemsNatural(supabase, resolvedParams, scope);

    case "tool_check_delivery_status":
      return await toolCheckDeliveryStatus(supabase, resolvedParams, scope);

    case "tool_request_disposal":
      return await toolRequestDisposal(supabase, resolvedParams, scope);

    case "tool_get_my_storage_summary":
      return await toolGetMyStorageSummary(supabase, scope);

    default:
      return { result: { error: `Unknown tool: ${toolName}` } };
  }
}

// ============================================================
// PARTIAL ID MATCHING HELPERS
// ============================================================

// Check if query looks like a partial ID (numeric, or prefixed like ITM-, SHP-, TSK-)
function isPartialIdQuery(query: string): boolean {
  // Pure numeric (e.g., "12345", "00142")
  if (/^\d+$/.test(query)) return true;
  // Prefixed patterns (e.g., "ITM-12345", "SHP-00891", "TSK-142")
  if (/^(ITM|SHP|TSK|RPQ|EST)-?\d+$/i.test(query)) return true;
  return false;
}

// Extract numeric portion from a query or ID
function extractNumericPortion(value: string): string {
  // Remove common prefixes and non-numeric chars
  return value.replace(/^(ITM|SHP|TSK|RPQ|EST)-?/i, "").replace(/\D/g, "");
}

// Prioritize matches: exact > ends-with > contains
function prioritizeMatches<T extends { item_code?: string; shipment_number?: string; task_number?: string }>(
  items: T[],
  query: string,
  codeField: "item_code" | "shipment_number" | "task_number"
): T[] {
  const queryNumeric = extractNumericPortion(query);
  const queryUpper = query.toUpperCase();

  // Categorize matches
  const exact: T[] = [];
  const endsWith: T[] = [];
  const contains: T[] = [];

  for (const item of items) {
    const code = (item[codeField] as string) || "";
    const codeUpper = code.toUpperCase();
    const codeNumeric = extractNumericPortion(code);

    if (codeUpper === queryUpper || codeNumeric === queryNumeric) {
      exact.push(item);
    } else if (codeNumeric.endsWith(queryNumeric) || codeUpper.endsWith(queryUpper)) {
      endsWith.push(item);
    } else if (codeNumeric.includes(queryNumeric) || codeUpper.includes(queryUpper)) {
      contains.push(item);
    }
  }

  // Return in priority order: if exact match exists, return only exact
  if (exact.length > 0) return exact;
  if (endsWith.length > 0) return endsWith;
  return contains;
}

// Tool: Search Items
async function toolSearchItems(supabase: any, params: { query: string }, scope: ChatScope) {
  const { query } = params;
  const isIdQuery = isPartialIdQuery(query);

  // Base select query
  const selectFields = `
    id,
    item_code,
    description,
    status,
    received_at,
    sidemark:sidemarks(id, sidemark_name),
    location:locations(id, code, name),
    shipment:shipments!items_receiving_shipment_id_fkey(id, shipment_number)
  `;

  let allItems: any[] = [];

  if (isIdQuery) {
    // For partial ID queries, fetch more broadly and filter client-side for precision
    const numericPart = extractNumericPortion(query);

    // Try exact match first
    const { data: exactMatch } = await supabase
      .from("items")
      .select(selectFields)
      .eq("tenant_id", scope.tenant_id)
      .eq("account_id", scope.account_id)
      .is("deleted_at", null)
      .ilike("item_code", `%${numericPart}%`)
      .limit(50);

    allItems = exactMatch || [];

    // Apply priority matching
    allItems = prioritizeMatches(allItems, query, "item_code");
  } else {
    // For text queries, search description, item_code, and sidemark name
    const { data: items, error } = await supabase
      .from("items")
      .select(selectFields)
      .eq("tenant_id", scope.tenant_id)
      .eq("account_id", scope.account_id)
      .is("deleted_at", null)
      .or(`description.ilike.%${query}%,item_code.ilike.%${query}%`)
      .limit(20);

    if (error) {
      console.error("Search items error:", error);
      return { result: { error: "Failed to search items", candidates: [] } };
    }

    // Also search by sidemark/job name
    const { data: sidemarkItems } = await supabase
      .from("items")
      .select(`
        id,
        item_code,
        description,
        status,
        received_at,
        sidemark:sidemarks!inner(id, sidemark_name),
        location:locations(id, code, name),
        shipment:shipments!items_receiving_shipment_id_fkey(id, shipment_number)
      `)
      .eq("tenant_id", scope.tenant_id)
      .eq("account_id", scope.account_id)
      .is("deleted_at", null)
      .ilike("sidemarks.sidemark_name", `%${query}%`)
      .limit(20);

    // Combine and dedupe
    allItems = [...(items || []), ...(sidemarkItems || [])];
  }

  // Dedupe by ID
  const uniqueItems = Array.from(new Map(allItems.map(i => [i.id, i])).values());

  const candidates = uniqueItems.map((item: any) => ({
    id: item.id,
    label: item.description || item.item_code,
    item_number: item.item_code,
    job_name: item.sidemark?.sidemark_name || null,
    location_label: item.location?.name || item.location?.code || null,
    received_at: item.received_at,
    shipment_number: item.shipment?.shipment_number || null,
    status: item.status,
  }));

  // If multiple matches, set up disambiguation
  if (candidates.length > 1) {
    return {
      result: {
        multiple_matches: true,
        count: candidates.length,
        candidates: candidates.slice(0, 10).map((c: any, i: number) => ({ ...c, index: i + 1 })),
        message: "Multiple items found. Please specify which one(s) you mean.",
      },
      newSessionState: {
        pending_disambiguation: {
          type: "items" as const,
          candidates: candidates.slice(0, 10).map((c: any, i: number) => ({
            id: c.id,
            label: c.label,
            index: i + 1,
          })),
          original_query: query,
        },
      },
    };
  }

  return { result: { candidates } };
}

// Tool: Get Last Inbound Shipment
async function toolGetLastInboundShipment(supabase: any, scope: ChatScope) {
  const { data: shipment, error } = await supabase
    .from("shipments")
    .select("id, shipment_number, received_at, created_at, status")
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", scope.account_id)
    .eq("shipment_type", "inbound")
    .is("deleted_at", null)
    .order("received_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .single();

  if (error) {
    return { result: { found: false, message: "No recent shipments found" } };
  }

  return {
    result: {
      found: true,
      shipment_id: shipment.id,
      shipment_number: shipment.shipment_number,
      received_at: shipment.received_at || shipment.created_at,
      status: shipment.status,
    },
  };
}

// Tool: Get Shipment Items
async function toolGetShipmentItems(supabase: any, params: { shipment_id: string }, scope: ChatScope) {
  // Verify shipment belongs to this account
  const { data: shipment } = await supabase
    .from("shipments")
    .select("id")
    .eq("id", params.shipment_id)
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", scope.account_id)
    .single();

  if (!shipment) {
    return { result: { error: "Shipment not found", items: [] } };
  }

  // Get items via shipment_items join table
  const { data: siRows } = await supabase
    .from("shipment_items")
    .select("item_id")
    .eq("shipment_id", params.shipment_id);

  const siItemIds = (siRows || []).map((si: any) => si.item_id).filter(Boolean);

  let items: any[] = [];
  if (siItemIds.length > 0) {
    const { data, error } = await supabase
      .from("items")
      .select(`
        id,
        item_code,
        description,
        status,
        sidemark:sidemarks(id, sidemark_name)
      `)
      .in("id", siItemIds)
      .eq("tenant_id", scope.tenant_id)
      .is("deleted_at", null);

    if (error) {
      return { result: { error: "Failed to get shipment items", items: [] } };
    }
    items = data || [];
  }

  return {
    result: {
      items: (items || []).map((item: any) => ({
        item_id: item.id,
        label: item.description || item.item_code,
        item_number: item.item_code,
        job_name: item.sidemark?.sidemark_name,
        status: item.status,
      })),
    },
  };
}

// Tool: Get Item Status
async function toolGetItemStatus(supabase: any, params: { item_id: string }, scope: ChatScope) {
  const { data: item, error } = await supabase
    .from("items")
    .select(`
      id,
      item_code,
      description,
      status,
      received_at,
      sidemark:sidemarks(id, sidemark_name),
      location:locations(id, code, name),
      warehouse:warehouses(id, name),
      shipment:shipments!items_receiving_shipment_id_fkey(id, shipment_number, received_at)
    `)
    .eq("id", params.item_id)
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", scope.account_id)
    .single();

  if (error || !item) {
    return { result: { found: false, message: "Item not found" } };
  }

  // Get any inspection tasks for this item
  const { data: inspectionTasks } = await supabase
    .from("tasks")
    .select("id, task_number, title, status, completed_at")
    .eq("tenant_id", scope.tenant_id)
    .eq("related_item_id", params.item_id)
    .eq("task_type", "inspection")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(5);

  return {
    result: {
      found: true,
      status: item.status,
      description: item.description,
      item_number: item.item_code,
      location_label: item.location?.name || item.location?.code || "Not assigned",
      warehouse: item.warehouse?.name,
      received_at: item.received_at,
      shipment_number: item.shipment?.shipment_number,
      job_name: item.sidemark?.sidemark_name,
      inspection_reports: inspectionTasks?.map((t: any) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        completed_at: t.completed_at,
      })) || [],
    },
  };
}

// Tool: Get Inspection Reports
async function toolGetInspectionReports(
  supabase: any,
  params: { shipment_id?: string; item_id?: string; subaccount_id?: string },
  scope: ChatScope
) {
  let query = supabase
    .from("tasks")
    .select("id, task_number, title, status, completed_at, created_at, related_item_id")
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", scope.account_id)
    .eq("task_type", "inspection")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(20);

  if (params.subaccount_id) {
    query = query.eq("sidemark", params.subaccount_id);
  }

  // Filter by item_id directly if provided
  if (params.item_id) {
    query = query.eq("related_item_id", params.item_id);
  }

  const { data: tasks, error } = await query;

  if (error) {
    return { result: { error: "Failed to get inspection reports", reports: [] } };
  }

  let filteredTasks = tasks || [];

  // Filter by shipment_id if provided - need to get items from that shipment
  if (params.shipment_id) {
    const { data: siRows } = await supabase
      .from("shipment_items")
      .select("item_id")
      .eq("shipment_id", params.shipment_id);

    const shipmentItemIds = (siRows || []).map((si: any) => si.item_id).filter(Boolean);

    filteredTasks = filteredTasks.filter((t: any) =>
      t.related_item_id && shipmentItemIds.includes(t.related_item_id)
    );
  }

  return {
    result: {
      reports: filteredTasks.map((t: any) => ({
        id: t.id,
        title: t.title,
        task_number: t.task_number,
        status: t.status,
        created_at: t.created_at,
        completed_at: t.completed_at,
      })),
    },
  };
}

// Tool: Create Will Call Draft
async function toolCreateWillCallDraft(
  supabase: any,
  params: {
    subaccount_id?: string;
    item_ids: string[];
    release_type: string;
    released_to_name: string;
    notes?: string;
  },
  scope: ChatScope
) {
  // Validate items belong to this account
  const { data: validItems, error: itemsError } = await supabase
    .from("items")
    .select("id, item_code, description, status, sidemark:sidemarks(id, sidemark_name)")
    .in("id", params.item_ids)
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", scope.account_id)
    .is("deleted_at", null);

  if (itemsError || !validItems || validItems.length === 0) {
    return { result: { error: "No valid items found for pickup", ok: false } };
  }

  // Check items are available for pickup
  const unavailableItems = validItems.filter((i: any) =>
    !["active", "in_storage", "available"].includes(i.status)
  );

  if (unavailableItems.length > 0) {
    return {
      result: {
        ok: false,
        error: "Some items are not available for pickup",
        unavailable_items: unavailableItems.map((i: any) => ({
          item_number: i.item_code,
          status: i.status,
        })),
      },
    };
  }

  // Create draft
  const { data: draft, error: draftError } = await supabase
    .from("client_chat_will_call_drafts")
    .insert({
      tenant_id: scope.tenant_id,
      account_id: scope.account_id,
      subaccount_id: params.subaccount_id || null,
      created_by: scope.user_id,
      item_ids: params.item_ids,
      release_type: params.release_type,
      released_to_name: params.released_to_name,
      notes: params.notes || null,
    })
    .select("id")
    .single();

  if (draftError) {
    console.error("Create draft error:", draftError);
    return { result: { error: "Failed to create pickup request draft", ok: false } };
  }

  const releaseTypeLabels: Record<string, string> = {
    customer: "Customer pickup",
    third_party_carrier: "Third-party carrier",
    stride_delivery: "Stride delivery",
  };

  const summary = `
**Pickup Request Draft Created**

Items to be picked up (${validItems.length}):
${validItems.map((i: any) => `- ${i.description || i.item_code}`).join("\n")}

Pickup method: ${releaseTypeLabels[params.release_type] || params.release_type}
Picked up by: ${params.released_to_name}
${params.notes ? `Notes: ${params.notes}` : ""}

Would you like me to submit this pickup request?
  `.trim();

  return {
    result: {
      ok: true,
      draft_id: draft.id,
      summary,
      item_count: validItems.length,
      needs_confirmation: true,
    },
    newSessionState: {
      pending_draft: {
        type: "will_call" as const,
        draft_id: draft.id,
        summary,
      },
    },
  };
}

// Tool: Submit Will Call
async function toolSubmitWillCall(
  supabase: any,
  params: { draft_id: string },
  scope: ChatScope
) {
  // Get draft
  const { data: draft, error: draftError } = await supabase
    .from("client_chat_will_call_drafts")
    .select("*")
    .eq("id", params.draft_id)
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", scope.account_id)
    .eq("status", "draft")
    .single();

  if (draftError || !draft) {
    return { result: { ok: false, error: "Draft not found or already submitted" } };
  }

  // Create the actual outbound shipment
  const { data: shipment, error: shipmentError } = await supabase
    .from("shipments")
    .insert({
      tenant_id: scope.tenant_id,
      account_id: scope.account_id,
      shipment_type: "outbound",
      status: "pending",
      sidemark_id: draft.subaccount_id,
      notes: `${draft.release_type}: ${draft.released_to_name}${draft.notes ? ` - ${draft.notes}` : ""}`,
      created_by: scope.user_id,
    })
    .select("id, shipment_number")
    .single();

  if (shipmentError) {
    console.error("Create shipment error:", shipmentError);
    return { result: { ok: false, error: "Failed to create pickup request" } };
  }

  // Best-effort: coerce legacy SHP-###### → OUT-##### for new outbound shipments.
  // (Some environments still have the old trigger installed.)
  try {
    const raw = String(shipment.shipment_number || "").trim().toUpperCase();
    const match = raw.match(/^SHP-(\d{5,})$/);
    if (match) {
      const digits = match[1];
      const outDigits = digits.length > 5 && digits[0] !== "0" ? digits : digits.slice(-5);
      const coerced = `OUT-${outDigits}`;
      const { error: renumberError } = await supabase
        .from("shipments")
        .update({ shipment_number: coerced })
        .eq("tenant_id", scope.tenant_id)
        .eq("id", shipment.id);
      if (!renumberError) {
        shipment.shipment_number = coerced;
      }
    }
  } catch (err) {
    console.warn("[client-chat] shipment_number coerce failed:", err);
  }

  // Create shipment items
  const shipmentItems = draft.item_ids.map((item_id: string) => ({
    shipment_id: shipment.id,
    item_id,
    expected_quantity: 1,
    status: "pending",
  }));

  await supabase.from("shipment_items").insert(shipmentItems);

  // Update items to allocated status
  await supabase
    .from("items")
    .update({ status: "allocated" })
    .in("id", draft.item_ids);

  // Mark draft as confirmed
  await supabase
    .from("client_chat_will_call_drafts")
    .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
    .eq("id", params.draft_id);

  return {
    result: {
      ok: true,
      request_id: shipment.id,
      request_number: shipment.shipment_number,
      status: "pending",
      message: `Your pickup request ${shipment.shipment_number} has been submitted! The warehouse team will prepare your items.`,
    },
  };
}

// Tool: Create Repair Quote Draft
async function toolCreateRepairQuoteDraft(
  supabase: any,
  params: {
    subaccount_id?: string;
    item_ids: string[];
    notes?: string;
  },
  scope: ChatScope
) {
  // Validate items belong to this account
  const { data: validItems, error: itemsError } = await supabase
    .from("items")
    .select("id, item_code, description, sidemark:sidemarks(id, sidemark_name)")
    .in("id", params.item_ids)
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", scope.account_id)
    .is("deleted_at", null);

  if (itemsError || !validItems || validItems.length === 0) {
    return { result: { error: "No valid items found", ok: false } };
  }

  // Create draft
  const { data: draft, error: draftError } = await supabase
    .from("client_chat_repair_quote_drafts")
    .insert({
      tenant_id: scope.tenant_id,
      account_id: scope.account_id,
      subaccount_id: params.subaccount_id || null,
      created_by: scope.user_id,
      item_ids: params.item_ids,
      notes: params.notes || null,
    })
    .select("id")
    .single();

  if (draftError) {
    console.error("Create repair draft error:", draftError);
    return { result: { error: "Failed to create repair quote request draft", ok: false } };
  }

  const summary = `
**Repair Quote Request Draft Created**

Items needing repair (${validItems.length}):
${validItems.map((i: any) => `- ${i.description || i.item_code}`).join("\n")}

${params.notes ? `Description: ${params.notes}` : ""}

Would you like me to submit this repair quote request?
  `.trim();

  return {
    result: {
      ok: true,
      draft_id: draft.id,
      summary,
      item_count: validItems.length,
      needs_confirmation: true,
    },
    newSessionState: {
      pending_draft: {
        type: "repair_quote" as const,
        draft_id: draft.id,
        summary,
      },
    },
  };
}

// Tool: Submit Repair Quote Request
async function toolSubmitRepairQuoteRequest(
  supabase: any,
  params: { draft_id: string },
  scope: ChatScope
) {
  // Get draft
  const { data: draft, error: draftError } = await supabase
    .from("client_chat_repair_quote_drafts")
    .select("*")
    .eq("id", params.draft_id)
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", scope.account_id)
    .eq("status", "draft")
    .single();

  if (draftError || !draft) {
    return { result: { ok: false, error: "Draft not found or already submitted" } };
  }

  // Create a repair quote task for the first item (related_item_id supports single)
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .insert({
      tenant_id: scope.tenant_id,
      account_id: scope.account_id,
      task_type: "repair_quote",
      title: `Repair Quote Request - ${draft.item_ids.length} item(s)`,
      description: draft.notes || "Customer requested repair quote via chat",
      status: "open",
      priority: "medium",
      related_item_id: draft.item_ids[0] || null,
    })
    .select("id, task_number")
    .single();

  // Link all items via task_items
  if (task && draft.item_ids.length > 0) {
    const taskItemRows = draft.item_ids.map((itemId: string) => ({
      task_id: task.id,
      item_id: itemId,
    }));
    await supabase.from("task_items").insert(taskItemRows);
  }

  if (taskError) {
    console.error("Create task error:", taskError);
    return { result: { ok: false, error: "Failed to create repair quote request" } };
  }

  // Mark draft as confirmed
  await supabase
    .from("client_chat_repair_quote_drafts")
    .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
    .eq("id", params.draft_id);

  return {
    result: {
      ok: true,
      request_id: task.id,
      request_number: task.task_number,
      status: "open",
      message: `Your repair quote request ${task.task_number} has been submitted! Our team will assess the items and provide a quote.`,
    },
  };
}

// Tool: Reallocate Items Preview
async function toolReallocateItemsPreview(
  supabase: any,
  params: {
    item_ids: string[];
    from_subaccount_id: string;
    to_subaccount_id: string;
  },
  scope: ChatScope
) {
  // Validate items
  const { data: items, error: itemsError } = await supabase
    .from("items")
    .select("id, item_code, description, sidemark_id")
    .in("id", params.item_ids)
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", scope.account_id)
    .is("deleted_at", null);

  if (itemsError || !items || items.length === 0) {
    return { result: { ok: false, blockers: ["No valid items found"] } };
  }

  // Validate subaccounts
  const { data: fromSubaccount } = await supabase
    .from("sidemarks")
    .select("id, sidemark_name")
    .eq("id", params.from_subaccount_id)
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", scope.account_id)
    .single();

  const { data: toSubaccount } = await supabase
    .from("sidemarks")
    .select("id, sidemark_name")
    .eq("id", params.to_subaccount_id)
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", scope.account_id)
    .single();

  if (!fromSubaccount || !toSubaccount) {
    return { result: { ok: false, blockers: ["Invalid job/subaccount specified"] } };
  }

  // Check items are from the source subaccount
  const wrongSourceItems = items.filter((i: any) => i.sidemark_id !== params.from_subaccount_id);
  if (wrongSourceItems.length > 0) {
    return {
      result: {
        ok: false,
        blockers: [`Some items are not in the "${fromSubaccount.sidemark_name}" job`],
      },
    };
  }

  const summary = `
**Move Items Preview**

Moving ${items.length} item(s):
${items.map((i: any) => `- ${i.description || i.item_code}`).join("\n")}

From: ${fromSubaccount.sidemark_name}
To: ${toSubaccount.sidemark_name}

Would you like me to move these items?
  `.trim();

  return {
    result: {
      ok: true,
      blockers: [],
      summary,
      item_count: items.length,
      from_job: fromSubaccount.sidemark_name,
      to_job: toSubaccount.sidemark_name,
      needs_confirmation: true,
    },
  };
}

// Tool: Reallocate Items Execute
async function toolReallocateItemsExecute(
  supabase: any,
  params: {
    item_ids: string[];
    from_subaccount_id: string;
    to_subaccount_id: string;
  },
  scope: ChatScope
) {
  // Validate items again
  const { data: items, error: itemsError } = await supabase
    .from("items")
    .select("id, sidemark_id")
    .in("id", params.item_ids)
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", scope.account_id)
    .eq("sidemark_id", params.from_subaccount_id)
    .is("deleted_at", null);

  if (itemsError || !items || items.length === 0) {
    return { result: { ok: false, error: "Items validation failed" } };
  }

  // Validate destination subaccount
  const { data: toSubaccount } = await supabase
    .from("sidemarks")
    .select("id, sidemark_name")
    .eq("id", params.to_subaccount_id)
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", scope.account_id)
    .single();

  if (!toSubaccount) {
    return { result: { ok: false, error: "Destination job not found" } };
  }

  // Perform the move
  const { error: updateError } = await supabase
    .from("items")
    .update({ sidemark_id: params.to_subaccount_id })
    .in("id", params.item_ids)
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", scope.account_id);

  if (updateError) {
    console.error("Move items error:", updateError);
    return { result: { ok: false, error: "Failed to move items" } };
  }

  return {
    result: {
      ok: true,
      moved_count: items.length,
      message: `Successfully moved ${items.length} item(s) to "${toSubaccount.sidemark_name}"!`,
    },
  };
}

// Tool: Resolve Disambiguation
async function toolResolveDisambiguation(
  params: { selections?: number[]; select_all?: boolean },
  sessionState: SessionState
): Promise<{ result: any; newSessionState?: Partial<SessionState> }> {
  const disambiguation = sessionState.pending_disambiguation;

  if (!disambiguation) {
    return {
      result: { error: "No pending selection to resolve" },
    };
  }

  let selectedIds: string[];

  if (params.select_all) {
    selectedIds = disambiguation.candidates.map((c) => c.id);
  } else if (params.selections && params.selections.length > 0) {
    selectedIds = params.selections
      .map((idx) => disambiguation.candidates.find((c) => c.index === idx))
      .filter(Boolean)
      .map((c) => c!.id);
  } else {
    return { result: { error: "No selections provided" } };
  }

  return {
    result: {
      resolved: true,
      selected_ids: selectedIds,
      selected_count: selectedIds.length,
      original_query: disambiguation.original_query,
    },
    newSessionState: {
      pending_disambiguation: undefined,
    },
  };
}

// Tool: Get Subaccounts
async function toolGetSubaccounts(supabase: any, scope: ChatScope) {
  const { data: subaccounts, error } = await supabase
    .from("sidemarks")
    .select("id, sidemark_name")
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", scope.account_id)
    .is("deleted_at", null)
    .order("sidemark_name");

  if (error) {
    return { result: { error: "Failed to get jobs", subaccounts: [] } };
  }

  return {
    result: {
      subaccounts: (subaccounts || []).map((s: any) => ({
        id: s.id,
        name: s.sidemark_name,
      })),
    },
  };
}

// ============================================================
// ENHANCED CLIENT TOOLS
// ============================================================

// Tool: Search Items Natural Language
async function toolSearchItemsNatural(
  supabase: any,
  params: { description: string; job_name?: string },
  scope: ChatScope
) {
  const { description, job_name } = params;

  // Split description into search terms
  const searchTerms = description.toLowerCase().split(/\s+/).filter(t => t.length > 2);

  // Build search query
  let query = supabase
    .from("items")
    .select(`
      id,
      item_code,
      description,
      status,
      received_at,
      sidemark:sidemarks(id, sidemark_name),
      location:locations(id, code, name),
      shipment:shipments!items_receiving_shipment_id_fkey(id, shipment_number)
    `)
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", scope.account_id)
    .is("deleted_at", null);

  // If job_name provided, filter by sidemark
  if (job_name) {
    const { data: sidemarks } = await supabase
      .from("sidemarks")
      .select("id")
      .eq("tenant_id", scope.tenant_id)
      .eq("account_id", scope.account_id)
      .ilike("sidemark_name", `%${job_name}%`);

    if (sidemarks && sidemarks.length > 0) {
      query = query.in("sidemark_id", sidemarks.map((s: any) => s.id));
    }
  }

  const { data: items, error } = await query.limit(50);

  if (error) {
    return { result: { error: "Failed to search items", candidates: [] } };
  }

  // Score items by how many search terms they match
  const scoredItems = (items || []).map((item: any) => {
    const desc = (item.description || "").toLowerCase();
    const jobName = (item.sidemark?.sidemark_name || "").toLowerCase();
    let score = 0;

    for (const term of searchTerms) {
      if (desc.includes(term)) score += 2;
      if (jobName.includes(term)) score += 1;
    }

    return { ...item, score };
  }).filter((item: any) => item.score > 0)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 10);

  if (scoredItems.length === 0) {
    return {
      result: {
        found: false,
        message: "No items matching that description were found. Try different words or check the job name.",
        candidates: [],
      },
    };
  }

  const candidates = scoredItems.map((item: any, i: number) => ({
    index: i + 1,
    id: item.id,
    label: item.description || item.item_code,
    item_number: item.item_code,
    job_name: item.sidemark?.sidemark_name || null,
    status: item.status,
    received_at: item.received_at,
  }));

  if (candidates.length === 1) {
    return {
      result: {
        found: true,
        single_match: true,
        item: candidates[0],
      },
    };
  }

  return {
    result: {
      found: true,
      multiple_matches: true,
      count: candidates.length,
      candidates,
      message: "Found multiple items matching your description. Which one did you mean?",
    },
    newSessionState: {
      pending_disambiguation: {
        type: "items" as const,
        candidates: candidates.map((c: any) => ({ id: c.id, label: c.label, index: c.index })),
        original_query: description,
      },
    },
  };
}

// Tool: Check Delivery Status
async function toolCheckDeliveryStatus(
  supabase: any,
  params: { query: string },
  scope: ChatScope
) {
  const { query } = params;

  // Search recent shipments by tracking number, shipment number, or items
  const { data: shipments, error } = await supabase
    .from("shipments")
    .select(`
      id, shipment_number, tracking_number, status, received_at, expected_arrival_date,
      shipment_type, carrier, notes,
      items:shipment_items(
        item:items(id, item_code, description)
      )
    `)
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", scope.account_id)
    .eq("shipment_type", "inbound")
    .is("deleted_at", null)
    .or(`shipment_number.ilike.%${query}%,tracking_number.ilike.%${query}%`)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    return { result: { error: "Failed to check delivery status" } };
  }

  // Also search items by description to find their shipment
  const { data: itemMatches } = await supabase
    .from("items")
    .select(`
      id, item_code, description, received_at, status,
      shipment:shipments!items_receiving_shipment_id_fkey(
        id, shipment_number, status, received_at, tracking_number
      )
    `)
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", scope.account_id)
    .ilike("description", `%${query}%`)
    .is("deleted_at", null)
    .limit(10);

  if (shipments && shipments.length > 0) {
    const shipment = shipments[0];
    const isReceived = shipment.status === "received" || shipment.received_at;

    return {
      result: {
        found: true,
        type: "shipment",
        shipment: {
          number: shipment.shipment_number,
          tracking: shipment.tracking_number,
          status: shipment.status,
          carrier: shipment.carrier,
          received_at: shipment.received_at,
          expected_arrival_date: shipment.expected_arrival_date,
          is_received: isReceived,
          item_count: shipment.items?.length || 0,
        },
        message: isReceived
          ? `Your shipment ${shipment.shipment_number} has been received!`
          : `Shipment ${shipment.shipment_number} is ${shipment.status}. ${shipment.expected_arrival_date ? `Expected: ${shipment.expected_arrival_date}` : ''}`,
      },
    };
  }

  if (itemMatches && itemMatches.length > 0) {
    const receivedItems = itemMatches.filter((i: any) => i.received_at);
    const pendingItems = itemMatches.filter((i: any) => !i.received_at);

    return {
      result: {
        found: true,
        type: "items",
        received: receivedItems.map((i: any) => ({
          item_number: i.item_code,
          description: i.description,
          received_at: i.received_at,
          shipment: i.shipment?.shipment_number,
        })),
        pending: pendingItems.map((i: any) => ({
          item_number: i.item_code,
          description: i.description,
        })),
        message: receivedItems.length > 0
          ? `Found ${receivedItems.length} item(s) matching "${query}" that have arrived.`
          : `No items matching "${query}" have arrived yet.`,
      },
    };
  }

  return {
    result: {
      found: false,
      message: `No shipments or items found matching "${query}". Try checking with the shipment number or tracking number.`,
    },
  };
}

// Tool: Request Disposal
async function toolRequestDisposal(
  supabase: any,
  params: { item_ids: string[]; reason?: string },
  scope: ChatScope
) {
  const { item_ids, reason } = params;

  // Validate items belong to this account and can be disposed
  const { data: items } = await supabase
    .from("items")
    .select("id, item_code, description, status")
    .in("id", item_ids)
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", scope.account_id)
    .is("deleted_at", null);

  if (!items || items.length === 0) {
    return { result: { ok: false, error: "No valid items found" } };
  }

  // Check for items that can't be disposed
  const unavailableItems = items.filter((i: any) =>
    ["allocated", "released", "disposed"].includes(i.status)
  );

  if (unavailableItems.length > 0) {
    return {
      result: {
        ok: false,
        error: "Some items cannot be disposed",
        unavailable_items: unavailableItems.map((i: any) => ({
          item_number: i.item_code,
          status: i.status,
          reason: i.status === "allocated" ? "Already scheduled for pickup" :
                  i.status === "released" ? "Already released" : "Already disposed",
        })),
      },
    };
  }

  const summary = `
**Disposal Request**

Items to be disposed (${items.length}):
${items.map((i: any) => `- ${i.description || i.item_code}`).join("\n")}

${reason ? `Reason: ${reason}` : ""}

Would you like me to submit this disposal request?
  `.trim();

  return {
    result: {
      ok: true,
      preview: true,
      item_count: items.length,
      summary,
      needs_confirmation: true,
    },
    newSessionState: {
      pending_draft: {
        type: "disposal" as const,
        draft_id: "pending",
        summary,
      },
    },
  };
}

// Tool: Get My Storage Summary
async function toolGetMyStorageSummary(supabase: any, scope: ChatScope) {
  // Get all items for this account
  const { data: items } = await supabase
    .from("items")
    .select(`
      id, status,
      sidemark:sidemarks(id, sidemark_name)
    `)
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", scope.account_id)
    .is("deleted_at", null);

  if (!items) {
    return { result: { error: "Failed to get storage summary" } };
  }

  // Count by status
  const statusCounts: Record<string, number> = {};
  (items || []).forEach((item: any) => {
    const status = item.status || "unknown";
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });

  // Count by job/sidemark
  const jobCounts: Record<string, { id: string; name: string; count: number }> = {};
  (items || []).forEach((item: any) => {
    const jobId = item.sidemark?.id || "unassigned";
    const jobName = item.sidemark?.sidemark_name || "Unassigned";
    if (!jobCounts[jobId]) {
      jobCounts[jobId] = { id: jobId, name: jobName, count: 0 };
    }
    jobCounts[jobId].count++;
  });

  // Get recent shipments
  const { data: recentShipments } = await supabase
    .from("shipments")
    .select("id, shipment_number, shipment_type, status, received_at, shipped_at")
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", scope.account_id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(3);

  return {
    result: {
      total_items: items.length,
      items_in_storage: statusCounts["active"] || 0,
      by_status: statusCounts,
      by_job: Object.values(jobCounts).sort((a, b) => b.count - a.count),
      recent_activity: (recentShipments || []).map((s: any) => ({
        type: s.shipment_type,
        number: s.shipment_number,
        status: s.status,
        date: s.received_at || s.shipped_at,
      })),
    },
  };
}

// ============================================================
// SESSION STATE MANAGEMENT
// ============================================================

async function getOrCreateSession(
  supabase: any,
  scope: ChatScope,
  uiContext: UIContext
): Promise<{ id: string; state: SessionState }> {
  // Try to get existing session
  const { data: existing } = await supabase
    .from("client_chat_sessions")
    .select("id, pending_disambiguation, pending_draft")
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", scope.account_id)
    .eq("user_id", scope.user_id)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (existing) {
    // Update with latest context
    await supabase
      .from("client_chat_sessions")
      .update({
        last_route: uiContext.route || null,
        last_selected_items: uiContext.selected_item_ids || null,
      })
      .eq("id", existing.id);

    return {
      id: existing.id,
      state: {
        pending_disambiguation: existing.pending_disambiguation,
        pending_draft: existing.pending_draft,
      },
    };
  }

  // Create new session
  const { data: newSession, error } = await supabase
    .from("client_chat_sessions")
    .insert({
      tenant_id: scope.tenant_id,
      account_id: scope.account_id,
      user_id: scope.user_id,
      last_route: uiContext.route || null,
      last_selected_items: uiContext.selected_item_ids || null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Create session error:", error);
    // Return a temporary ID if creation fails
    return { id: "temp", state: {} };
  }

  return { id: newSession.id, state: {} };
}

async function updateSessionState(
  supabase: any,
  sessionId: string,
  updates: Partial<SessionState>
) {
  if (sessionId === "temp") return;

  const updateData: any = {};
  if ("pending_disambiguation" in updates) {
    updateData.pending_disambiguation = updates.pending_disambiguation || null;
  }
  if ("pending_draft" in updates) {
    updateData.pending_draft = updates.pending_draft || null;
  }

  if (Object.keys(updateData).length > 0) {
    await supabase
      .from("client_chat_sessions")
      .update(updateData)
      .eq("id", sessionId);
  }
}

// ============================================================
// MAIN HANDLER
// ============================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      message,
      tenantId,
      accountId,
      subaccountId,
      uiContext,
      conversationHistory,
    } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Require authentication
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let userId: string;
    try {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      userId = user.id;

      // Validate user belongs to the requested tenant/account
      const { data: userProfile } = await supabase
        .from("users")
        .select("tenant_id, account_id")
        .eq("id", userId)
        .maybeSingle();

      if (!userProfile || userProfile.tenant_id !== tenantId) {
        return new Response(
          JSON.stringify({ error: "Unauthorized access" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // If accountId is provided, verify the user has access to it
      if (accountId && userProfile.account_id && userProfile.account_id !== accountId) {
        return new Response(
          JSON.stringify({ error: "Unauthorized access to account" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } catch (e) {
      console.error("Auth error:", e);
      return new Response(
        JSON.stringify({ error: "Authentication failed" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const scope: ChatScope = {
      tenant_id: tenantId,
      account_id: accountId,
      subaccount_id: subaccountId,
      user_id: userId,
    };

    const parsedUiContext: UIContext = uiContext || {};

    // Get or create session state
    const session = await getOrCreateSession(supabase, scope, parsedUiContext);

    // Build messages for AI
    const messages: Array<{ role: string; content: string }> = [];

    // Add conversation history if provided
    if (conversationHistory && Array.isArray(conversationHistory)) {
      for (const msg of conversationHistory.slice(-10)) {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    // Add current message
    messages.push({ role: "user", content: message });

    // Add session context to system prompt
    let contextAddition = "";
    if (session.state.pending_disambiguation) {
      contextAddition += `\n\n## Pending Selection\nThe user needs to choose from:\n${session.state.pending_disambiguation.candidates
        .map((c) => `${c.index}. ${c.label}`)
        .join("\n")}\nIf their message contains a selection (number, "all", etc.), use tool_resolve_disambiguation.`;
    }
    if (session.state.pending_draft) {
      contextAddition += `\n\n## Pending Confirmation\nThere is a ${session.state.pending_draft.type} draft awaiting confirmation (draft_id: ${session.state.pending_draft.draft_id}). If the user confirms (yes, sure, go ahead, etc.), submit it. If they decline, acknowledge and offer alternatives.`;
    }

    // Build initial messages for the conversation
    let currentMessages: Array<{ role: string; content?: string; tool_calls?: any; tool_call_id?: string }> = [
      { role: "system", content: CLIENT_SYSTEM_PROMPT + contextAddition },
      ...messages,
    ];

    const MAX_TOOL_ROUNDS = 6; // Safety limit for multi-step operations
    let round = 0;
    let finalContent = "";
    let sessionUpdates: Partial<SessionState> = {};

    // Tool-call loop - continues until AI stops requesting tools or we hit the limit
    while (round < MAX_TOOL_ROUNDS) {
      round++;

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: currentMessages,
          tools: TOOLS.map((t) => ({
            type: "function",
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          })),
          tool_choice: "auto",
          stream: false, // Don't stream intermediate rounds
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          return new Response(
            JSON.stringify({ error: "Rate limits exceeded, please try again later." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (response.status === 402) {
          return new Response(
            JSON.stringify({ error: "Payment required, please add funds to your Lovable AI workspace." }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const t = await response.text();
        console.error("AI gateway error:", response.status, t);
        return new Response(
          JSON.stringify({ error: "AI gateway error" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const aiResponse = await response.json();
      const choice = aiResponse.choices?.[0];

      if (!choice) {
        break;
      }

      const toolCalls = choice.message?.tool_calls;

      // If no tool calls, we have our final answer
      if (!toolCalls || toolCalls.length === 0) {
        finalContent = choice.message?.content || "";
        break;
      }

      // Add assistant message with tool calls to conversation
      currentMessages.push({
        role: "assistant",
        content: choice.message.content || "",
        tool_calls: toolCalls,
      });

      // Execute each tool call
      for (const toolCall of toolCalls) {
        const toolName = toolCall.function.name;
        let toolParams = {};
        try {
          toolParams = JSON.parse(toolCall.function.arguments || "{}");
        } catch (e) {
          console.error("Parse tool args error:", e);
        }

        const { result, newSessionState } = await handleTool(
          supabase,
          toolName,
          toolParams,
          scope,
          session.state
        );

        if (newSessionState) {
          sessionUpdates = { ...sessionUpdates, ...newSessionState };
          // Update session.state so subsequent tool calls in this round see the changes
          Object.assign(session.state, newSessionState);
        }

        // Add tool result to conversation
        currentMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
      // Loop continues - AI gets tool results and decides what to do next
    }

    // Update session state if needed
    if (Object.keys(sessionUpdates).length > 0) {
      await updateSessionState(supabase, session.id, sessionUpdates);
    }

    // Return the final response
    if (finalContent) {
      // We have content from the loop - format as SSE
      const sseData = `data: ${JSON.stringify({
        choices: [{ delta: { content: finalContent } }],
      })}\n\ndata: [DONE]\n\n`;

      return new Response(sseData, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    } else {
      // Do one final streaming call for potentially long responses
      const streamResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: currentMessages,
          stream: true,
        }),
      });

      if (!streamResponse.ok) {
        return new Response(
          JSON.stringify({ content: "I had trouble generating a response. Please try again." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(streamResponse.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }
  } catch (e) {
    console.error("client-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
