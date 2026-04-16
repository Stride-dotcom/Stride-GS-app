import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================
// TYPES
// ============================================================

interface TenantScope {
  tenant_id: string;
  user_id: string;
  user_name?: string;
}

interface UIContext {
  route?: string;
  selected_item_ids?: string[];
  selected_shipment_id?: string;
}

interface DisambiguationState {
  type: 'items' | 'shipments' | 'tasks' | 'stocktakes' | 'entity_type';
  candidates: Array<{ id: string; label: string; index: number; entity_type?: string }>;
  original_query: string;
  action_context?: any;
}

interface SessionState {
  pending_disambiguation?: DisambiguationState;
  pending_draft?: {
    type: string;
    draft_id?: string;
    summary: string;
    data?: any;
  };
}

// ============================================================
// TENANT OPS SYSTEM PROMPT
// ============================================================

const TENANT_SYSTEM_PROMPT = `You are Stride Ops Assistant, an internal AI assistant for warehouse operations staff. You help with inventory management, shipment processing, task management, and operational troubleshooting.

## Your Role
- Direct and precise communication
- Operational language and warehouse terminology allowed
- No emojis
- Full visibility into tenant operations
- Help staff work efficiently and safely

## What You Can Help With
- Find inventory, shipments, tasks, and locations
- Understand status, history, and blockers
- Create and manage Inspection, Assembly, and Repair tasks
- Perform inventory movements and bulk operations safely
- Troubleshoot outbound, receiving, and stocktakes

## Partial ID Matching
Users may reference entities using partial numbers (e.g., "45678" instead of "SHP-123-45678").
Resolution order:
1. Exact match
2. Ends-with match
3. Contains match

CRITICAL RULES:
- If exactly one record matches: proceed
- If multiple records match: ASK the user to choose (never guess)
- If the number could belong to multiple entity types: ask which type
- This applies to BOTH read-only and write actions

## Execution Safety Rules

IMMEDIATE execution allowed for:
- Read-only queries (searches, status checks, history lookups)
- Single-item moves (if item is not frozen or in active release)

PREVIEW + CONFIRMATION required for:
- Bulk item moves
- Bulk task creation
- Task assignment
- Stocktake closure
- Any destructive or high-impact action

Pattern: Preview -> Summarize -> Ask "Confirm?" -> Execute

## Task Type Intelligence (CRITICAL)

### INSPECTION TASKS
- HARD RULE: One inspection task = one item
- Never create multi-item inspection tasks
- Required to capture item-specific photos
- Photos attach to the item record
- When asked to create inspections for a shipment: loop items, create one task per item

### ASSEMBLY TASKS
- Default: one task per item
- Grouped assembly allowed ONLY if explicitly requested
- If grouping requested, confirm before proceeding
- Photos optional

### REPAIR TASKS
- Default: one task per item
- Must follow inspection completion
- Start in "pending_approval" state
- Never auto-start repairs
- Never skip approval workflow

## Edge Case Rules
- If inspection is missing, warn before creating repair tasks
- If items are in active outbound, warn that repair/assembly will block release
- If items are frozen by stocktake, block moves and explain why
- Never combine inspection + repair + assembly into one task
- Avoid operations that create photo, approval, or billing ambiguity

## Response Style
- Be concise but explicit about what happened
- Always explain why something is blocked
- Use plain text identifiers by default
- Provide links only if user asks to open something
- Use operational terminology (location codes, status names, etc.)

## Security
- All data is scoped to the current tenant
- You may show employee names and audit information
- You may show movement history and internal notes
- Write actions are permission-checked server-side

## Tool Workflow Rules
- You can call multiple tools in sequence - the system supports multi-round tool calls
- When a user mentions a shipment number, item number, or location code, the system will automatically resolve human-readable IDs to UUIDs
- Chain tool calls as needed: search → get details → take action
- If a search returns exactly one result, proceed automatically
- If a search returns multiple results, present options and ask user to choose
- For complex operations (e.g., "move items from shipment X to location Y"), break into steps:
  1. First search for the shipment to get details
  2. Get the items from that shipment
  3. Search for the destination location
  4. Preview the move, then execute after confirmation

## Error Recovery
- If a tool returns "not found", the ID may need resolution - try searching with the original text
- If the user provides a partial number, search for it - don't say you can't find it
- Always attempt to help before giving up
- If blocked by stocktake or outbound allocation, explain clearly why the operation cannot proceed

## Entity References
When mentioning entities in your responses, include both the display number and UUID for linking:
- Items: "ITM-12345 [id:uuid-here]"
- Shipments: "SHP-001044 [id:uuid-here]"
- Tasks: "TSK-1043 [id:uuid-here]"
The frontend will render these as clickable links.`;

// ============================================================
// TOOL DEFINITIONS
// ============================================================

const TOOLS = [
  // ==================== SEARCH TOOLS ====================
  {
    name: "tool_search_items",
    description: "Search for items by item code, description, vendor, sidemark, room, location, or account. Supports partial ID matching.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term (item number, description, location, account name)" },
        status: { type: "string", description: "Filter by status (active, allocated, released, disposed)" },
        account_id: { type: "string", description: "Filter by account ID" },
        location_id: { type: "string", description: "Filter by location ID" },
      },
      required: ["query"],
    },
  },
  {
    name: "tool_search_shipments",
    description: "Search for shipments by number, tracking, or account. Supports partial ID matching.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term (shipment number, tracking number, account name)" },
        status: { type: "string", description: "Filter by status" },
        shipment_type: { type: "string", description: "Filter by type (inbound, outbound)" },
      },
      required: ["query"],
    },
  },
  {
    name: "tool_search_tasks",
    description: "Search for tasks by number, title, or type. Supports partial ID matching.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term (task number, title, assignee)" },
        task_type: { type: "string", description: "Filter by type (inspection, assembly, repair, repair_quote)" },
        status: { type: "string", description: "Filter by status (open, in_progress, completed, cancelled)" },
      },
      required: ["query"],
    },
  },
  {
    name: "tool_search_locations",
    description: "Search for warehouse locations by code or name",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Location code or name" },
        warehouse_id: { type: "string", description: "Filter by warehouse" },
      },
      required: ["query"],
    },
  },

  // ==================== ITEM DETAIL TOOLS ====================
  {
    name: "tool_get_item_details",
    description: "Get full details of an item including status, location, account, and photos",
    parameters: {
      type: "object",
      properties: {
        item_id: { type: "string", description: "Item ID" },
      },
      required: ["item_id"],
    },
  },
  {
    name: "tool_get_item_movement_history",
    description: "Get movement history for an item (who moved it, when, from where to where)",
    parameters: {
      type: "object",
      properties: {
        item_id: { type: "string", description: "Item ID" },
        limit: { type: "number", description: "Max records to return (default 20)" },
      },
      required: ["item_id"],
    },
  },
  {
    name: "tool_get_item_outbound_history",
    description: "Get outbound/release history for an item",
    parameters: {
      type: "object",
      properties: {
        item_id: { type: "string", description: "Item ID" },
      },
      required: ["item_id"],
    },
  },

  // ==================== SHIPMENT TOOLS ====================
  {
    name: "tool_get_shipment_details",
    description: "Get full details of a shipment including items, status, and blockers",
    parameters: {
      type: "object",
      properties: {
        shipment_id: { type: "string", description: "Shipment ID" },
      },
      required: ["shipment_id"],
    },
  },
  {
    name: "tool_get_shipment_items",
    description: "Get all items on a shipment",
    parameters: {
      type: "object",
      properties: {
        shipment_id: { type: "string", description: "Shipment ID" },
      },
      required: ["shipment_id"],
    },
  },
  {
    name: "tool_validate_shipment_outbound",
    description: "Check if an outbound shipment is ready to release - identifies blockers",
    parameters: {
      type: "object",
      properties: {
        shipment_id: { type: "string", description: "Shipment ID" },
      },
      required: ["shipment_id"],
    },
  },

  // ==================== TASK CREATION TOOLS ====================
  {
    name: "tool_create_task_single",
    description: "Create a single task (inspection, assembly, or repair) - immediate execution",
    parameters: {
      type: "object",
      properties: {
        task_type: { type: "string", enum: ["inspection", "assembly", "repair", "repair_quote"], description: "Type of task" },
        item_id: { type: "string", description: "Item ID for the task" },
        title: { type: "string", description: "Task title" },
        description: { type: "string", description: "Task description" },
        priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "Priority level" },
        assignee_id: { type: "string", description: "User ID to assign (optional)" },
      },
      required: ["task_type", "item_id"],
    },
  },
  {
    name: "tool_create_tasks_bulk_preview",
    description: "Preview bulk task creation - returns summary for confirmation. REQUIRED for inspection tasks on shipments.",
    parameters: {
      type: "object",
      properties: {
        task_type: { type: "string", enum: ["inspection", "assembly", "repair"], description: "Type of tasks" },
        item_ids: { type: "array", items: { type: "string" }, description: "Array of item IDs" },
        shipment_id: { type: "string", description: "Shipment ID (to get items from)" },
        priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "Priority level" },
        assignee_id: { type: "string", description: "User ID to assign all tasks to" },
      },
    },
  },
  {
    name: "tool_create_tasks_bulk_execute",
    description: "Execute bulk task creation after user confirmation",
    parameters: {
      type: "object",
      properties: {
        task_type: { type: "string", enum: ["inspection", "assembly", "repair"], description: "Type of tasks" },
        item_ids: { type: "array", items: { type: "string" }, description: "Array of item IDs" },
        priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "Priority level" },
        assignee_id: { type: "string", description: "User ID to assign all tasks to" },
        confirmed: { type: "boolean", description: "Must be true to execute" },
      },
      required: ["task_type", "item_ids", "confirmed"],
    },
  },

  // ==================== MOVEMENT TOOLS ====================
  {
    name: "tool_move_item",
    description: "Move a single item to a new location - immediate if allowed",
    parameters: {
      type: "object",
      properties: {
        item_id: { type: "string", description: "Item ID" },
        to_location_id: { type: "string", description: "Destination location ID" },
        notes: { type: "string", description: "Movement notes" },
      },
      required: ["item_id", "to_location_id"],
    },
  },
  {
    name: "tool_move_items_preview",
    description: "Preview bulk item movement - returns summary and blockers for confirmation",
    parameters: {
      type: "object",
      properties: {
        item_ids: { type: "array", items: { type: "string" }, description: "Array of item IDs" },
        to_location_id: { type: "string", description: "Destination location ID" },
      },
      required: ["item_ids", "to_location_id"],
    },
  },
  {
    name: "tool_move_items_execute",
    description: "Execute bulk item movement after user confirmation",
    parameters: {
      type: "object",
      properties: {
        item_ids: { type: "array", items: { type: "string" }, description: "Array of item IDs" },
        to_location_id: { type: "string", description: "Destination location ID" },
        notes: { type: "string", description: "Movement notes" },
        confirmed: { type: "boolean", description: "Must be true to execute" },
      },
      required: ["item_ids", "to_location_id", "confirmed"],
    },
  },

  // ==================== STOCKTAKE TOOLS ====================
  {
    name: "tool_search_stocktakes",
    description: "Search for stocktakes by number or status",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Stocktake number or search term" },
        status: { type: "string", description: "Filter by status (draft, in_progress, completed)" },
      },
    },
  },
  {
    name: "tool_validate_stocktake_completion",
    description: "Validate if a stocktake can be closed - checks for unresolved variances",
    parameters: {
      type: "object",
      properties: {
        stocktake_id: { type: "string", description: "Stocktake ID" },
      },
      required: ["stocktake_id"],
    },
  },
  {
    name: "tool_close_stocktake",
    description: "Close a stocktake after validation and confirmation",
    parameters: {
      type: "object",
      properties: {
        stocktake_id: { type: "string", description: "Stocktake ID" },
        confirmed: { type: "boolean", description: "Must be true to execute" },
      },
      required: ["stocktake_id", "confirmed"],
    },
  },

  // ==================== ACCOUNT TOOLS ====================
  {
    name: "tool_search_accounts",
    description: "Search for client accounts by name or code",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Account name or code" },
      },
      required: ["query"],
    },
  },
  {
    name: "tool_get_account_summary",
    description: "Get a summary of an account including active item count, open tasks, recent shipments, and outstanding balance",
    parameters: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "Account ID" },
      },
      required: ["account_id"],
    },
  },

  // ==================== DISPOSAL TOOLS ====================
  {
    name: "tool_create_disposal_order_draft",
    description: "Create a draft disposal order for items - requires confirmation",
    parameters: {
      type: "object",
      properties: {
        item_ids: { type: "array", items: { type: "string" }, description: "Item IDs to dispose" },
        reason: { type: "string", description: "Disposal reason" },
      },
      required: ["item_ids"],
    },
  },

  // ==================== ANALYTICS TOOLS ====================
  {
    name: "tool_get_warehouse_snapshot",
    description: "Get current warehouse stats: total items in storage, items received today/this week, pending outbound, open tasks by type",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "tool_get_recent_activity",
    description: "Get recent warehouse activity - shipments received, items moved, tasks completed in the last N hours",
    parameters: {
      type: "object",
      properties: {
        hours: { type: "number", description: "Hours to look back (default 24)" },
      },
    },
  },

  // ==================== CLAIMS TOOLS ====================
  {
    name: "tool_search_claims",
    description: "Search for claims by number, account, or status",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Claim number or account name" },
        status: { type: "string", description: "Filter by status" },
      },
    },
  },

  // ==================== NOTES TOOLS ====================
  {
    name: "tool_add_note_to_item",
    description: "Add a note to an item for internal tracking",
    parameters: {
      type: "object",
      properties: {
        item_id: { type: "string", description: "Item ID" },
        note: { type: "string", description: "Note content" },
      },
      required: ["item_id", "note"],
    },
  },

  // ==================== UTILITY TOOLS ====================
  {
    name: "tool_resolve_disambiguation",
    description: "Resolve a pending disambiguation by selecting from previous options",
    parameters: {
      type: "object",
      properties: {
        selections: { type: "array", items: { type: "number" }, description: "Selected option numbers (1-indexed)" },
        select_all: { type: "boolean", description: "Set to true if user said 'all'" },
        entity_type: { type: "string", description: "If disambiguating entity type: 'item', 'shipment', 'task'" },
      },
    },
  },
];

// ============================================================
// PARTIAL ID MATCHING HELPERS
// ============================================================

function isPartialIdQuery(query: string): boolean {
  if (/^\d+$/.test(query)) return true;
  if (/^(ITM|SHP|TSK|RPQ|EST|STK)-?\d+$/i.test(query)) return true;
  return false;
}

function extractNumericPortion(value: string): string {
  return value.replace(/^(ITM|SHP|TSK|RPQ|EST|STK)-?/i, "").replace(/\D/g, "");
}

function prioritizeMatches<T>(
  items: T[],
  query: string,
  codeField: string
): T[] {
  const queryNumeric = extractNumericPortion(query);
  const queryUpper = query.toUpperCase();

  const exact: T[] = [];
  const endsWith: T[] = [];
  const contains: T[] = [];

  for (const item of items) {
    const code = ((item as any)[codeField] as string) || "";
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

  if (exact.length > 0) return exact;
  if (endsWith.length > 0) return endsWith;
  return contains;
}

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
  scope: TenantScope
): Promise<any> {
  const resolved = { ...params };

  // Resolve shipment_id if it looks like a shipment number, not a UUID
  if (resolved.shipment_id && !isUUID(resolved.shipment_id)) {
    const numericPart = extractNumericPortion(resolved.shipment_id);
    const { data } = await supabase
      .from("shipments")
      .select("id")
      .eq("tenant_id", scope.tenant_id)
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
          .ilike("item_code", `%${numericPart}%`)
          .is("deleted_at", null)
          .limit(1)
          .single();
        if (data) resolvedIds.push(data.id);
      }
    }
    resolved.item_ids = resolvedIds;
  }

  // Resolve to_location_id by location code
  if (resolved.to_location_id && !isUUID(resolved.to_location_id)) {
    const { data } = await supabase
      .from("locations")
      .select("id")
      .eq("tenant_id", scope.tenant_id)
      .ilike("code", `%${resolved.to_location_id}%`)
      .is("deleted_at", null)
      .limit(1)
      .single();
    if (data) resolved.to_location_id = data.id;
  }

  // Resolve stocktake_id
  if (resolved.stocktake_id && !isUUID(resolved.stocktake_id)) {
    const numericPart = extractNumericPortion(resolved.stocktake_id);
    const { data } = await supabase
      .from("stocktakes")
      .select("id")
      .eq("tenant_id", scope.tenant_id)
      .ilike("stocktake_number", `%${numericPart}%`)
      .limit(1)
      .single();
    if (data) resolved.stocktake_id = data.id;
  }

  // Resolve account_id by account name or code
  if (resolved.account_id && !isUUID(resolved.account_id)) {
    const { data } = await supabase
      .from("accounts")
      .select("id")
      .eq("tenant_id", scope.tenant_id)
      .or(`account_name.ilike.%${resolved.account_id}%,account_code.ilike.%${resolved.account_id}%`)
      .is("deleted_at", null)
      .limit(1)
      .single();
    if (data) resolved.account_id = data.id;
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
  scope: TenantScope,
  sessionState: SessionState
): Promise<{ result: any; newSessionState?: Partial<SessionState> }> {
  // Resolve human-readable IDs to UUIDs before executing
  const resolvedParams = await resolveHumanIds(supabase, toolName, params, scope);

  switch (toolName) {
    case "tool_search_items":
      return await toolSearchItems(supabase, resolvedParams, scope);
    case "tool_search_shipments":
      return await toolSearchShipments(supabase, resolvedParams, scope);
    case "tool_search_tasks":
      return await toolSearchTasks(supabase, resolvedParams, scope);
    case "tool_search_locations":
      return await toolSearchLocations(supabase, resolvedParams, scope);
    case "tool_get_item_details":
      return await toolGetItemDetails(supabase, resolvedParams, scope);
    case "tool_get_item_movement_history":
      return await toolGetItemMovementHistory(supabase, resolvedParams, scope);
    case "tool_get_item_outbound_history":
      return await toolGetItemOutboundHistory(supabase, resolvedParams, scope);
    case "tool_get_shipment_details":
      return await toolGetShipmentDetails(supabase, resolvedParams, scope);
    case "tool_get_shipment_items":
      return await toolGetShipmentItems(supabase, resolvedParams, scope);
    case "tool_validate_shipment_outbound":
      return await toolValidateShipmentOutbound(supabase, resolvedParams, scope);
    case "tool_create_task_single":
      return await toolCreateTaskSingle(supabase, resolvedParams, scope);
    case "tool_create_tasks_bulk_preview":
      return await toolCreateTasksBulkPreview(supabase, resolvedParams, scope);
    case "tool_create_tasks_bulk_execute":
      return await toolCreateTasksBulkExecute(supabase, resolvedParams, scope);
    case "tool_move_item":
      return await toolMoveItem(supabase, resolvedParams, scope);
    case "tool_move_items_preview":
      return await toolMoveItemsPreview(supabase, resolvedParams, scope);
    case "tool_move_items_execute":
      return await toolMoveItemsExecute(supabase, resolvedParams, scope);
    case "tool_search_stocktakes":
      return await toolSearchStocktakes(supabase, resolvedParams, scope);
    case "tool_validate_stocktake_completion":
      return await toolValidateStocktakeCompletion(supabase, resolvedParams, scope);
    case "tool_close_stocktake":
      return await toolCloseStocktake(supabase, resolvedParams, scope);
    case "tool_search_accounts":
      return await toolSearchAccounts(supabase, resolvedParams, scope);
    case "tool_get_account_summary":
      return await toolGetAccountSummary(supabase, resolvedParams, scope);
    case "tool_create_disposal_order_draft":
      return await toolCreateDisposalOrderDraft(supabase, resolvedParams, scope);
    case "tool_get_warehouse_snapshot":
      return await toolGetWarehouseSnapshot(supabase, scope);
    case "tool_get_recent_activity":
      return await toolGetRecentActivity(supabase, resolvedParams, scope);
    case "tool_search_claims":
      return await toolSearchClaims(supabase, resolvedParams, scope);
    case "tool_add_note_to_item":
      return await toolAddNoteToItem(supabase, resolvedParams, scope);
    case "tool_resolve_disambiguation":
      return await toolResolveDisambiguation(resolvedParams, sessionState);
    default:
      return { result: { error: `Unknown tool: ${toolName}` } };
  }
}

// ==================== SEARCH TOOLS ====================

async function toolSearchItems(supabase: any, params: any, scope: TenantScope) {
  const { query, status, account_id, location_id } = params;
  const isIdQuery = isPartialIdQuery(query);

  let queryBuilder = supabase
    .from("items")
    .select(`
      id, item_code, description, status, has_damage, received_at,
      vendor, sidemark, room,
      account:accounts(id, account_name, account_code),
      sidemark_rel:sidemarks(id, sidemark_name),
      location:locations!items_current_location_id_fkey(id, code, name),
      warehouse:warehouses(id, name)
    `)
    .eq("tenant_id", scope.tenant_id)
    .is("deleted_at", null);

  if (status) queryBuilder = queryBuilder.eq("status", status);
  if (account_id) queryBuilder = queryBuilder.eq("account_id", account_id);
  if (location_id) queryBuilder = queryBuilder.eq("current_location_id", location_id);

  if (isIdQuery) {
    const numericPart = extractNumericPortion(query);
    queryBuilder = queryBuilder.ilike("item_code", `%${numericPart}%`);
  } else {
    queryBuilder = queryBuilder.or(`description.ilike.%${query}%,item_code.ilike.%${query}%,vendor.ilike.%${query}%,sidemark.ilike.%${query}%,room.ilike.%${query}%`);
  }

  const { data: items, error } = await queryBuilder.limit(50);

  if (error) {
    return { result: { error: "Failed to search items", items: [] } };
  }

  let results = items || [];
  if (isIdQuery) {
    results = prioritizeMatches(results, query, "item_code");
  }

  const candidates = results.slice(0, 15).map((item: any, i: number) => ({
    id: item.id,
    index: i + 1,
    item_code: item.item_code,
    description: item.description,
    status: item.status,
    damaged: item.has_damage || false,
    vendor: item.vendor,
    account: item.account?.account_name,
    job: item.sidemark || item.sidemark_rel?.sidemark_name,
    room: item.room,
    location: item.location?.code || item.location?.name,
    warehouse: item.warehouse?.name,
  }));

  if (candidates.length > 1) {
    return {
      result: {
        multiple_matches: true,
        count: candidates.length,
        items: candidates,
        message: `Found ${candidates.length} items matching "${query}". Specify which one.`,
      },
      newSessionState: {
        pending_disambiguation: {
          type: "items" as const,
          candidates: candidates.map((c: any) => ({ id: c.id, label: `${c.item_code} - ${c.description || 'No description'}`, index: c.index })),
          original_query: query,
        },
      },
    };
  }

  return { result: { items: candidates } };
}

async function toolSearchShipments(supabase: any, params: any, scope: TenantScope) {
  const { query, status, shipment_type } = params;
  const isIdQuery = isPartialIdQuery(query);

  let queryBuilder = supabase
    .from("shipments")
    .select(`
      id, shipment_number, shipment_type, status, tracking_number,
      expected_arrival_date, received_at, shipped_at,
      account:accounts(id, account_name)
    `)
    .eq("tenant_id", scope.tenant_id)
    .is("deleted_at", null);

  if (status) queryBuilder = queryBuilder.eq("status", status);
  if (shipment_type) queryBuilder = queryBuilder.eq("shipment_type", shipment_type);

  if (isIdQuery) {
    const numericPart = extractNumericPortion(query);
    queryBuilder = queryBuilder.or(`shipment_number.ilike.%${numericPart}%,tracking_number.ilike.%${numericPart}%`);
  } else {
    queryBuilder = queryBuilder.or(`shipment_number.ilike.%${query}%,tracking_number.ilike.%${query}%`);
  }

  const { data: shipments, error } = await queryBuilder.limit(30);

  if (error) {
    return { result: { error: "Failed to search shipments", shipments: [] } };
  }

  let results = shipments || [];
  if (isIdQuery) {
    results = prioritizeMatches(results, query, "shipment_number");
  }

  const candidates = results.slice(0, 10).map((s: any, i: number) => ({
    id: s.id,
    index: i + 1,
    shipment_number: s.shipment_number,
    type: s.shipment_type,
    status: s.status,
    tracking: s.tracking_number,
    account: s.account?.account_name,
    date: s.received_at || s.shipped_at || s.expected_arrival_date,
  }));

  if (candidates.length > 1) {
    return {
      result: {
        multiple_matches: true,
        count: candidates.length,
        shipments: candidates,
        message: `Found ${candidates.length} shipments. Specify which one.`,
      },
      newSessionState: {
        pending_disambiguation: {
          type: "shipments" as const,
          candidates: candidates.map((c: any) => ({ id: c.id, label: `${c.shipment_number} (${c.type})`, index: c.index })),
          original_query: query,
        },
      },
    };
  }

  return { result: { shipments: candidates } };
}

async function toolSearchTasks(supabase: any, params: any, scope: TenantScope) {
  const { query, task_type, status } = params;
  const isIdQuery = isPartialIdQuery(query);

  let queryBuilder = supabase
    .from("tasks")
    .select(`
      id, task_number, title, task_type, status, priority,
      assignee_name, due_date, created_at,
      account:accounts(id, account_name)
    `)
    .eq("tenant_id", scope.tenant_id)
    .is("deleted_at", null);

  if (task_type) queryBuilder = queryBuilder.eq("task_type", task_type);
  if (status) queryBuilder = queryBuilder.eq("status", status);

  if (isIdQuery) {
    const numericPart = extractNumericPortion(query);
    queryBuilder = queryBuilder.ilike("task_number", `%${numericPart}%`);
  } else {
    queryBuilder = queryBuilder.or(`title.ilike.%${query}%,task_number.ilike.%${query}%,assignee_name.ilike.%${query}%`);
  }

  const { data: tasks, error } = await queryBuilder.order("created_at", { ascending: false }).limit(30);

  if (error) {
    return { result: { error: "Failed to search tasks", tasks: [] } };
  }

  let results = tasks || [];
  if (isIdQuery) {
    results = prioritizeMatches(results, query, "task_number");
  }

  const candidates = results.slice(0, 10).map((t: any, i: number) => ({
    id: t.id,
    index: i + 1,
    task_number: t.task_number,
    title: t.title,
    type: t.task_type,
    status: t.status,
    priority: t.priority,
    assignee: t.assignee_name,
    due_date: t.due_date,
    account: t.account?.account_name,
  }));

  if (candidates.length > 1) {
    return {
      result: {
        multiple_matches: true,
        count: candidates.length,
        tasks: candidates,
        message: `Found ${candidates.length} tasks. Specify which one.`,
      },
      newSessionState: {
        pending_disambiguation: {
          type: "tasks" as const,
          candidates: candidates.map((c: any) => ({ id: c.id, label: `${c.task_number} - ${c.title}`, index: c.index })),
          original_query: query,
        },
      },
    };
  }

  return { result: { tasks: candidates } };
}

async function toolSearchLocations(supabase: any, params: any, scope: TenantScope) {
  const { query, warehouse_id } = params;

  let queryBuilder = supabase
    .from("locations")
    .select(`id, code, name, location_type, warehouse:warehouses(id, name)`)
    .eq("tenant_id", scope.tenant_id)
    .is("deleted_at", null)
    .or(`code.ilike.%${query}%,name.ilike.%${query}%`);

  if (warehouse_id) queryBuilder = queryBuilder.eq("warehouse_id", warehouse_id);

  const { data: locations, error } = await queryBuilder.limit(20);

  if (error) {
    return { result: { error: "Failed to search locations", locations: [] } };
  }

  return {
    result: {
      locations: (locations || []).map((loc: any) => ({
        id: loc.id,
        code: loc.code,
        name: loc.name,
        type: loc.location_type,
        warehouse: loc.warehouse?.name,
      })),
    },
  };
}

// ==================== ITEM DETAIL TOOLS ====================

async function toolGetItemDetails(supabase: any, params: any, scope: TenantScope) {
  const { item_id } = params;

  const { data: item, error } = await supabase
    .from("items")
    .select(`
      id, item_code, description, status, has_damage, quantity,
      received_at, weight_lbs, size, size_unit,
      vendor, sidemark, room,
      account:accounts(id, account_name, account_code),
      sidemark_rel:sidemarks(id, sidemark_name),
      location:locations!items_current_location_id_fkey(id, code, name),
      warehouse:warehouses(id, name),
      shipment:shipments!items_receiving_shipment_id_fkey(id, shipment_number)
    `)
    .eq("id", item_id)
    .eq("tenant_id", scope.tenant_id)
    .single();

  if (error || !item) {
    return { result: { found: false, error: "Item not found" } };
  }

  // Get notes from item_notes table
  const { data: notes } = await supabase
    .from("item_notes")
    .select("note, created_at, note_type")
    .eq("item_id", item_id)
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(5);

  // Get photo count from item_photos table
  const { count: photoCount } = await supabase
    .from("item_photos")
    .select("id", { count: "exact", head: true })
    .eq("item_id", item_id);

  // Get active tasks for this item via task_items join table
  const { data: taskItems } = await supabase
    .from("task_items")
    .select("task:tasks(id, task_number, task_type, status, title)")
    .eq("item_id", item_id)
    .in("tasks.status", ["open", "in_progress"])
    .limit(5);

  // Also check via related_item_id
  const { data: directTasks } = await supabase
    .from("tasks")
    .select("id, task_number, task_type, status, title")
    .eq("tenant_id", scope.tenant_id)
    .eq("related_item_id", item_id)
    .in("status", ["open", "in_progress"])
    .is("deleted_at", null)
    .limit(5);

  const activeTasks = [
    ...(taskItems || []).filter((ti: any) => ti.task).map((ti: any) => ti.task),
    ...(directTasks || []),
  ];

  // Check if item is frozen by stocktake
  const { data: activeStocktake } = await supabase
    .from("stocktake_items")
    .select("stocktake:stocktakes(id, stocktake_number, status)")
    .eq("item_id", item_id)
    .in("stocktakes.status", ["draft", "in_progress"])
    .limit(1);

  return {
    result: {
      found: true,
      item: {
        id: item.id,
        item_code: item.item_code,
        description: item.description,
        status: item.status,
        damaged: item.has_damage || false,
        quantity: item.quantity,
        received_at: item.received_at,
        weight_lbs: item.weight_lbs,
        size: item.size ? `${item.size} ${item.size_unit || ""}`.trim() : null,
        vendor: item.vendor,
        account: item.account?.account_name,
        job: item.sidemark || item.sidemark_rel?.sidemark_name,
        room: item.room,
        location: item.location ? `${item.location.code} (${item.location.name})` : null,
        warehouse: item.warehouse?.name,
        shipment: item.shipment?.shipment_number,
        notes: (notes || []).map((n: any) => n.note),
        photo_count: photoCount || 0,
      },
      active_tasks: activeTasks,
      frozen_by_stocktake: activeStocktake?.[0]?.stocktake?.stocktake_number || null,
    },
  };
}

async function toolGetItemMovementHistory(supabase: any, params: any, scope: TenantScope) {
  const { item_id, limit = 20 } = params;

  // Verify item exists and belongs to tenant
  const { data: item } = await supabase
    .from("items")
    .select("id, item_code")
    .eq("id", item_id)
    .eq("tenant_id", scope.tenant_id)
    .single();

  if (!item) {
    return { result: { error: "Item not found" } };
  }

  const { data: movements, error } = await supabase
    .from("movements")
    .select(`
      id, action_type, from_location_id, to_location_id,
      from_location:locations!movements_from_location_id_fkey(code, name),
      to_location:locations!movements_to_location_id_fkey(code, name),
      actor_id, actor_type, note, moved_at
    `)
    .eq("item_id", item_id)
    .order("moved_at", { ascending: false })
    .limit(limit);

  if (error) {
    return { result: { movements: [], message: "Movement history not available" } };
  }

  // Resolve actor names for user-type actors
  const actorIds = [...new Set((movements || []).filter((m: any) => m.actor_type === "user" && m.actor_id).map((m: any) => m.actor_id))];
  const actorMap: Record<string, string> = {};
  if (actorIds.length > 0) {
    const { data: users } = await supabase.from("users").select("id, first_name, last_name").in("id", actorIds);
    (users || []).forEach((u: any) => { actorMap[u.id] = `${u.first_name || ""} ${u.last_name || ""}`.trim(); });
  }

  return {
    result: {
      item_code: item.item_code,
      movements: (movements || []).map((m: any) => ({
        type: m.action_type,
        from: m.from_location?.code || "Unknown",
        to: m.to_location?.code || "Unknown",
        moved_by: m.actor_id ? (actorMap[m.actor_id] || m.actor_type) : "System",
        notes: m.note,
        timestamp: m.moved_at,
      })),
    },
  };
}

async function toolGetItemOutboundHistory(supabase: any, params: any, scope: TenantScope) {
  const { item_id } = params;

  const { data: item } = await supabase
    .from("items")
    .select("id, item_code")
    .eq("id", item_id)
    .eq("tenant_id", scope.tenant_id)
    .single();

  if (!item) {
    return { result: { error: "Item not found" } };
  }

  const { data: shipmentItems, error } = await supabase
    .from("shipment_items")
    .select(`
      status, released_at,
      shipment:shipments(id, shipment_number, shipment_type, status, released_to, shipped_at)
    `)
    .eq("item_id", item_id)
    .eq("shipments.shipment_type", "outbound")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    return { result: { releases: [] } };
  }

  return {
    result: {
      item_code: item.item_code,
      releases: (shipmentItems || [])
        .filter((si: any) => si.shipment)
        .map((si: any) => ({
          shipment_number: si.shipment.shipment_number,
          status: si.status,
          shipment_status: si.shipment.status,
          released_to: si.shipment.released_to,
          released_at: si.shipment.shipped_at || si.released_at,
        })),
    },
  };
}

// ==================== SHIPMENT TOOLS ====================

async function toolGetShipmentDetails(supabase: any, params: any, scope: TenantScope) {
  const { shipment_id } = params;

  const { data: shipment, error } = await supabase
    .from("shipments")
    .select(`
      id, shipment_number, shipment_type, status, tracking_number,
      carrier, expected_arrival_date, received_at, shipped_at, released_to,
      notes,
      account:accounts(id, account_name),
      sidemark:sidemarks(id, sidemark_name),
      created_by_user:users!shipments_created_by_fkey(first_name, last_name)
    `)
    .eq("id", shipment_id)
    .eq("tenant_id", scope.tenant_id)
    .single();

  if (error || !shipment) {
    return { result: { found: false, error: "Shipment not found" } };
  }

  // Get item count by status
  const { data: itemStats } = await supabase
    .from("shipment_items")
    .select("status")
    .eq("shipment_id", shipment_id);

  const statusCounts: Record<string, number> = {};
  (itemStats || []).forEach((si: any) => {
    statusCounts[si.status] = (statusCounts[si.status] || 0) + 1;
  });

  return {
    result: {
      found: true,
      shipment: {
        id: shipment.id,
        number: shipment.shipment_number,
        type: shipment.shipment_type,
        status: shipment.status,
        tracking: shipment.tracking_number,
        carrier: shipment.carrier,
        expected_arrival_date: shipment.expected_arrival_date,
        received_at: shipment.received_at,
        shipped_at: shipment.shipped_at,
        released_to: shipment.released_to,
        account: shipment.account?.account_name,
        job: shipment.sidemark?.sidemark_name,
        item_status_breakdown: statusCounts,
        notes: shipment.notes,
        created_by: shipment.created_by_user
          ? `${shipment.created_by_user.first_name} ${shipment.created_by_user.last_name}`
          : null,
      },
    },
  };
}

async function toolGetShipmentItems(supabase: any, params: any, scope: TenantScope) {
  const { shipment_id } = params;

  // Verify shipment
  const { data: shipment } = await supabase
    .from("shipments")
    .select("id, shipment_number")
    .eq("id", shipment_id)
    .eq("tenant_id", scope.tenant_id)
    .single();

  if (!shipment) {
    return { result: { error: "Shipment not found", items: [] } };
  }

  // Get items via shipment_items join table
  const { data: shipmentItemRows } = await supabase
    .from("shipment_items")
    .select("item_id")
    .eq("shipment_id", shipment_id);

  const itemIds = (shipmentItemRows || []).map((si: any) => si.item_id).filter(Boolean);

  let items: any[] = [];
  let error: any = null;
  if (itemIds.length > 0) {
    const res = await supabase
      .from("items")
      .select(`
        id, item_code, description, status, has_damage,
        location:locations!items_current_location_id_fkey(id, code)
      `)
      .in("id", itemIds)
      .eq("tenant_id", scope.tenant_id)
      .is("deleted_at", null);
    items = res.data || [];
    error = res.error;
  }

  if (error) {
    return { result: { error: "Failed to get items", items: [] } };
  }

  return {
    result: {
      shipment_number: shipment.shipment_number,
      item_count: items?.length || 0,
      items: (items || []).map((item: any) => ({
        id: item.id,
        item_code: item.item_code,
        description: item.description,
        status: item.status,
        damaged: item.has_damage || false,
        location: item.location?.code,
      })),
    },
  };
}

async function toolValidateShipmentOutbound(supabase: any, params: any, scope: TenantScope) {
  const { shipment_id } = params;

  const { data: shipment } = await supabase
    .from("shipments")
    .select("id, shipment_number, shipment_type, status")
    .eq("id", shipment_id)
    .eq("tenant_id", scope.tenant_id)
    .single();

  if (!shipment) {
    return { result: { error: "Shipment not found" } };
  }

  if (shipment.shipment_type !== "outbound") {
    return { result: { error: "Not an outbound shipment", shipment_type: shipment.shipment_type } };
  }

  // Get items and their blockers
  const { data: shipmentItems } = await supabase
    .from("shipment_items")
    .select(`
      item_id, status,
      item:items(id, item_code, description, status)
    `)
    .eq("shipment_id", shipment_id);

  const blockers: string[] = [];
  const itemsNotReady: any[] = [];

  for (const si of shipmentItems || []) {
    if (!si.item) continue;

    // Check if item is in a blocking status
    if (si.item.status === "allocated") {
      // Good
    } else if (si.item.status === "released") {
      blockers.push(`${si.item.item_code} already released`);
    } else {
      itemsNotReady.push({
        item_code: si.item.item_code,
        status: si.item.status,
      });
    }
  }

  // Check for active tasks blocking release
  const itemIds = (shipmentItems || []).map((si: any) => si.item_id).filter(Boolean);
  if (itemIds.length > 0) {
    // Check via related_item_id
    const { data: activeTasks } = await supabase
      .from("tasks")
      .select("task_number, task_type, status")
      .eq("tenant_id", scope.tenant_id)
      .in("status", ["open", "in_progress"])
      .in("related_item_id", itemIds)
      .is("deleted_at", null);

    if (activeTasks && activeTasks.length > 0) {
      for (const task of activeTasks) {
        blockers.push(`Active ${task.task_type} task ${task.task_number} blocking items`);
      }
    }
  }

  // Check for stocktake freeze
  const { data: frozenItems } = await supabase
    .from("stocktake_items")
    .select("item_id, stocktake:stocktakes(stocktake_number)")
    .in("item_id", itemIds)
    .in("stocktakes.status", ["draft", "in_progress"]);

  if (frozenItems && frozenItems.length > 0) {
    const stocktakeNumbers = [...new Set(frozenItems.map((fi: any) => fi.stocktake?.stocktake_number))];
    blockers.push(`Items frozen by stocktake(s): ${stocktakeNumbers.join(", ")}`);
  }

  return {
    result: {
      shipment_number: shipment.shipment_number,
      current_status: shipment.status,
      ready_to_release: blockers.length === 0 && itemsNotReady.length === 0,
      total_items: shipmentItems?.length || 0,
      blockers,
      items_not_ready: itemsNotReady,
    },
  };
}

// ==================== TASK CREATION TOOLS ====================

async function toolCreateTaskSingle(supabase: any, params: any, scope: TenantScope) {
  const { task_type, item_id, title, description, priority = "medium", assignee_id } = params;

  // Verify item
  const { data: item } = await supabase
    .from("items")
    .select("id, item_code, description, account_id, sidemark_id, status")
    .eq("id", item_id)
    .eq("tenant_id", scope.tenant_id)
    .single();

  if (!item) {
    return { result: { ok: false, error: "Item not found" } };
  }

  // For repair tasks, check if inspection exists
  if (task_type === "repair") {
    const { data: inspectionTask } = await supabase
      .from("tasks")
      .select("id, status")
      .eq("tenant_id", scope.tenant_id)
      .eq("task_type", "inspection")
      .eq("related_item_id", item_id)
      .eq("status", "completed")
      .is("deleted_at", null)
      .limit(1);

    if (!inspectionTask || inspectionTask.length === 0) {
      return {
        result: {
          ok: false,
          error: "No completed inspection found for this item",
          warning: "Repair tasks should follow inspection completion. Create inspection first?",
        },
      };
    }
  }

  // Check for active outbound
  if (["repair", "assembly"].includes(task_type)) {
    const { data: activeOutbound } = await supabase
      .from("shipment_items")
      .select("shipment:shipments(shipment_number, status)")
      .eq("item_id", item_id)
      .in("shipments.status", ["pending", "processing"]);

    if (activeOutbound && activeOutbound.length > 0) {
      return {
        result: {
          ok: false,
          warning: `Item is in active outbound (${activeOutbound[0].shipment?.shipment_number}). Creating ${task_type} task will block release.`,
          proceed_anyway: "Confirm to create task anyway",
        },
      };
    }
  }

  const taskTitle = title || `${task_type.charAt(0).toUpperCase() + task_type.slice(1)} - ${item.item_code}`;
  const taskStatus = task_type === "repair" ? "pending_approval" : "open";

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      tenant_id: scope.tenant_id,
      account_id: item.account_id,
      task_type,
      title: taskTitle,
      description: description || `${task_type} task for ${item.description || item.item_code}`,
      status: taskStatus,
      priority,
      related_item_id: item_id,
      assigned_to: assignee_id || null,
    })
    .select("id, task_number")
    .single();

  if (error) {
    return { result: { ok: false, error: "Failed to create task" } };
  }

  // Link item to task via task_items
  if (task) {
    await supabase.from("task_items").insert({
      task_id: task.id,
      item_id: item_id,
    }).select().maybeSingle();
  }

  return {
    result: {
      ok: true,
      task_number: task.task_number,
      task_id: task.id,
      task_type,
      status: taskStatus,
      message: `Created ${task_type} task ${task.task_number} for ${item.item_code}`,
    },
  };
}

async function toolCreateTasksBulkPreview(supabase: any, params: any, scope: TenantScope) {
  const { task_type, item_ids, shipment_id, priority = "medium", assignee_id } = params;

  let targetItemIds = item_ids || [];

  // If shipment_id provided, get items from shipment via shipment_items
  if (shipment_id && !item_ids?.length) {
    const { data: siRows } = await supabase
      .from("shipment_items")
      .select("item_id")
      .eq("shipment_id", shipment_id);
    const siItemIds = (siRows || []).map((si: any) => si.item_id).filter(Boolean);
    if (siItemIds.length > 0) {
      const { data: shipmentItems } = await supabase
        .from("items")
        .select("id, item_code, description")
        .in("id", siItemIds)
        .eq("tenant_id", scope.tenant_id)
        .is("deleted_at", null);
      targetItemIds = (shipmentItems || []).map((i: any) => i.id);
    }
  }

  if (targetItemIds.length === 0) {
    return { result: { ok: false, error: "No items specified" } };
  }

  // Get item details
  const { data: items } = await supabase
    .from("items")
    .select("id, item_code, description, account_id")
    .in("id", targetItemIds)
    .eq("tenant_id", scope.tenant_id);

  if (!items || items.length === 0) {
    return { result: { ok: false, error: "No valid items found" } };
  }

  // Check for existing tasks of this type via task_items and related_item_id
  const itemsWithExistingTasks = new Set<string>();

  // Check via task_items join table
  const { data: existingTaskItems } = await supabase
    .from("task_items")
    .select("item_id, task:tasks(task_type, status)")
    .in("item_id", targetItemIds)
    .eq("tasks.task_type", task_type)
    .in("tasks.status", ["open", "in_progress"]);

  (existingTaskItems || []).forEach((ti: any) => {
    if (ti.task && ti.item_id) itemsWithExistingTasks.add(ti.item_id);
  });

  // Also check via related_item_id
  const { data: directExisting } = await supabase
    .from("tasks")
    .select("related_item_id")
    .eq("tenant_id", scope.tenant_id)
    .eq("task_type", task_type)
    .in("status", ["open", "in_progress"])
    .in("related_item_id", targetItemIds)
    .is("deleted_at", null);

  (directExisting || []).forEach((t: any) => {
    if (t.related_item_id) itemsWithExistingTasks.add(t.related_item_id);
  });

  const itemsToCreate = items.filter((i: any) => !itemsWithExistingTasks.has(i.id));

  // CRITICAL: For inspection tasks, always one per item
  const taskCount = task_type === "inspection" ? itemsToCreate.length : itemsToCreate.length;

  const summary = `
**Bulk ${task_type} Task Creation Preview**

Total items: ${items.length}
Items with existing ${task_type} tasks (skipped): ${itemsWithExistingTasks.size}
Tasks to create: ${taskCount}

${task_type === "inspection" ? "NOTE: One inspection task per item (required for photo capture)" : ""}

Items:
${itemsToCreate.slice(0, 10).map((i: any) => `- ${i.item_code}: ${i.description || "No description"}`).join("\n")}
${itemsToCreate.length > 10 ? `... and ${itemsToCreate.length - 10} more` : ""}

Confirm to create ${taskCount} ${task_type} task(s)?
  `.trim();

  return {
    result: {
      ok: true,
      preview: true,
      task_type,
      task_count: taskCount,
      item_count: itemsToCreate.length,
      skipped_count: itemsWithExistingTasks.size,
      summary,
      item_ids_to_process: itemsToCreate.map((i: any) => i.id),
    },
    newSessionState: {
      pending_draft: {
        type: "bulk_tasks",
        summary,
        data: {
          task_type,
          item_ids: itemsToCreate.map((i: any) => i.id),
          priority,
          assignee_id,
        },
      },
    },
  };
}

async function toolCreateTasksBulkExecute(supabase: any, params: any, scope: TenantScope) {
  const { task_type, item_ids, priority = "medium", assignee_id, confirmed } = params;

  if (!confirmed) {
    return { result: { ok: false, error: "Confirmation required. Say 'yes' or 'confirm' to proceed." } };
  }

  if (!item_ids || item_ids.length === 0) {
    return { result: { ok: false, error: "No items specified" } };
  }

  // Get item details
  const { data: items } = await supabase
    .from("items")
    .select("id, item_code, description, account_id")
    .in("id", item_ids)
    .eq("tenant_id", scope.tenant_id);

  if (!items || items.length === 0) {
    return { result: { ok: false, error: "No valid items found" } };
  }

  const createdTasks: string[] = [];
  const errors: string[] = [];

  // CRITICAL: For inspection, create one task per item
  for (const item of items) {
    const taskStatus = task_type === "repair" ? "pending_approval" : "open";

    const { data: task, error } = await supabase
      .from("tasks")
      .insert({
        tenant_id: scope.tenant_id,
        account_id: item.account_id,
        task_type,
        title: `${task_type.charAt(0).toUpperCase() + task_type.slice(1)} - ${item.item_code}`,
        description: `${task_type} for ${item.description || item.item_code}`,
        status: taskStatus,
        priority,
        related_item_id: item.id,
        assigned_to: assignee_id || null,
      })
      .select("id, task_number")
      .single();

    if (error) {
      errors.push(`Failed for ${item.item_code}: ${error.message}`);
    } else {
      createdTasks.push(task.task_number);
      // Link via task_items
      await supabase.from("task_items").insert({
        task_id: task.id,
        item_id: item.id,
      }).select().maybeSingle();
    }
  }

  return {
    result: {
      ok: errors.length === 0,
      created_count: createdTasks.length,
      task_numbers: createdTasks.slice(0, 10),
      errors: errors.length > 0 ? errors : undefined,
      message: `Created ${createdTasks.length} ${task_type} task(s)${errors.length > 0 ? ` with ${errors.length} errors` : ""}`,
    },
  };
}

// ==================== MOVEMENT TOOLS ====================

async function toolMoveItem(supabase: any, params: any, scope: TenantScope) {
  const { item_id, to_location_id, notes } = params;

  // Get item
  const { data: item } = await supabase
    .from("items")
    .select("id, item_code, status, current_location_id")
    .eq("id", item_id)
    .eq("tenant_id", scope.tenant_id)
    .single();

  if (!item) {
    return { result: { ok: false, error: "Item not found" } };
  }

  // Check if frozen by stocktake
  const { data: frozenCheck } = await supabase
    .from("stocktake_items")
    .select("stocktake:stocktakes(stocktake_number)")
    .eq("item_id", item_id)
    .in("stocktakes.status", ["draft", "in_progress"])
    .limit(1);

  if (frozenCheck && frozenCheck.length > 0) {
    return {
      result: {
        ok: false,
        error: `Item frozen by stocktake ${frozenCheck[0].stocktake?.stocktake_number}`,
        blocked: true,
      },
    };
  }

  // Check if in active release
  if (item.status === "allocated") {
    return {
      result: {
        ok: false,
        error: "Item is allocated for outbound release. Cannot move until released or deallocated.",
        blocked: true,
      },
    };
  }

  // Verify destination location
  const { data: location } = await supabase
    .from("locations")
    .select("id, code, name")
    .eq("id", to_location_id)
    .eq("tenant_id", scope.tenant_id)
    .single();

  if (!location) {
    return { result: { ok: false, error: "Destination location not found" } };
  }

  const fromLocationId = item.current_location_id;

  // Update item location
  const { error: updateError } = await supabase
    .from("items")
    .update({ current_location_id: to_location_id })
    .eq("id", item_id);

  if (updateError) {
    return { result: { ok: false, error: "Failed to move item" } };
  }

  // Log movement
  try {
    await supabase.from("movements").insert({
      item_id,
      from_location_id: fromLocationId,
      to_location_id,
      action_type: "moved",
      actor_type: "user",
      actor_id: scope.user_id,
      note: notes || null,
      tenant_id: scope.tenant_id,
    });
  } catch {
    // Movement logging is best-effort
  }

  return {
    result: {
      ok: true,
      message: `Moved ${item.item_code} to ${location.code}`,
      item_code: item.item_code,
      new_location: location.code,
    },
  };
}

async function toolMoveItemsPreview(supabase: any, params: any, scope: TenantScope) {
  const { item_ids, to_location_id } = params;

  // Verify destination
  const { data: location } = await supabase
    .from("locations")
    .select("id, code, name")
    .eq("id", to_location_id)
    .eq("tenant_id", scope.tenant_id)
    .single();

  if (!location) {
    return { result: { ok: false, error: "Destination location not found" } };
  }

  // Get items and check blockers
  const { data: items } = await supabase
    .from("items")
    .select("id, item_code, status, location:locations!items_current_location_id_fkey(code)")
    .in("id", item_ids)
    .eq("tenant_id", scope.tenant_id);

  const moveable: any[] = [];
  const blocked: any[] = [];

  for (const item of items || []) {
    // Check stocktake freeze
    const { data: frozenCheck } = await supabase
      .from("stocktake_items")
      .select("stocktake:stocktakes(stocktake_number)")
      .eq("item_id", item.id)
      .in("stocktakes.status", ["draft", "in_progress"])
      .limit(1);

    if (frozenCheck && frozenCheck.length > 0) {
      blocked.push({ item_code: item.item_code, reason: `Frozen by stocktake ${frozenCheck[0].stocktake?.stocktake_number}` });
      continue;
    }

    if (item.status === "allocated") {
      blocked.push({ item_code: item.item_code, reason: "Allocated for outbound" });
      continue;
    }

    moveable.push(item);
  }

  const summary = `
**Bulk Move Preview**

Destination: ${location.code} (${location.name || ""})

Items that can be moved: ${moveable.length}
${moveable.slice(0, 10).map((i: any) => `- ${i.item_code} (from ${i.location?.code || "unassigned"})`).join("\n")}
${moveable.length > 10 ? `... and ${moveable.length - 10} more` : ""}

${blocked.length > 0 ? `
Blocked items: ${blocked.length}
${blocked.map((b: any) => `- ${b.item_code}: ${b.reason}`).join("\n")}
` : ""}

Confirm to move ${moveable.length} item(s)?
  `.trim();

  return {
    result: {
      ok: true,
      preview: true,
      destination: location.code,
      moveable_count: moveable.length,
      blocked_count: blocked.length,
      blocked_items: blocked,
      summary,
      item_ids_to_move: moveable.map((i: any) => i.id),
    },
    newSessionState: {
      pending_draft: {
        type: "bulk_move",
        summary,
        data: {
          item_ids: moveable.map((i: any) => i.id),
          to_location_id,
        },
      },
    },
  };
}

async function toolMoveItemsExecute(supabase: any, params: any, scope: TenantScope) {
  const { item_ids, to_location_id, notes, confirmed } = params;

  if (!confirmed) {
    return { result: { ok: false, error: "Confirmation required" } };
  }

  let movedCount = 0;
  const errors: string[] = [];

  for (const itemId of item_ids) {
    const { error } = await supabase
      .from("items")
      .update({ current_location_id: to_location_id })
      .eq("id", itemId)
      .eq("tenant_id", scope.tenant_id);

    if (error) {
      errors.push(itemId);
    } else {
      movedCount++;
      // Log movement
      try {
        await supabase.from("movements").insert({
          item_id: itemId,
          to_location_id,
          action_type: "moved",
          actor_type: "user",
          actor_id: scope.user_id,
          note: notes || null,
          tenant_id: scope.tenant_id,
        });
      } catch {
        // Movement logging is best-effort
      }
    }
  }

  return {
    result: {
      ok: errors.length === 0,
      moved_count: movedCount,
      error_count: errors.length,
      message: `Moved ${movedCount} item(s)${errors.length > 0 ? ` (${errors.length} failed)` : ""}`,
    },
  };
}

// ==================== STOCKTAKE TOOLS ====================

async function toolSearchStocktakes(supabase: any, params: any, scope: TenantScope) {
  const { query, status } = params;

  let queryBuilder = supabase
    .from("stocktakes")
    .select(`
      id, stocktake_number, status, title, location_id,
      location:locations(code, name),
      started_at, completed_at
    `)
    .eq("tenant_id", scope.tenant_id);

  if (status) queryBuilder = queryBuilder.eq("status", status);

  if (query) {
    if (isPartialIdQuery(query)) {
      const numericPart = extractNumericPortion(query);
      queryBuilder = queryBuilder.ilike("stocktake_number", `%${numericPart}%`);
    } else {
      queryBuilder = queryBuilder.or(`stocktake_number.ilike.%${query}%,title.ilike.%${query}%`);
    }
  }

  const { data: stocktakes, error } = await queryBuilder.order("created_at", { ascending: false }).limit(20);

  if (error) {
    return { result: { error: "Failed to search stocktakes", stocktakes: [] } };
  }

  let results = stocktakes || [];
  if (query && isPartialIdQuery(query)) {
    results = prioritizeMatches(results, query, "stocktake_number");
  }

  return {
    result: {
      stocktakes: results.map((s: any) => ({
        id: s.id,
        number: s.stocktake_number,
        title: s.title,
        status: s.status,
        location: s.location?.code,
        started_at: s.started_at,
        completed_at: s.completed_at,
      })),
    },
  };
}

async function toolValidateStocktakeCompletion(supabase: any, params: any, scope: TenantScope) {
  const { stocktake_id } = params;

  const { data: stocktake } = await supabase
    .from("stocktakes")
    .select("id, stocktake_number, status, title")
    .eq("id", stocktake_id)
    .eq("tenant_id", scope.tenant_id)
    .single();

  if (!stocktake) {
    return { result: { error: "Stocktake not found" } };
  }

  if (stocktake.status === "completed") {
    return { result: { error: "Stocktake already completed" } };
  }

  // Get stocktake items and check for unresolved variances
  const { data: items } = await supabase
    .from("stocktake_items")
    .select("id, expected_quantity, counted_quantity, status")
    .eq("stocktake_id", stocktake_id);

  // Items with discrepancy status or mismatched quantities that haven't been resolved
  const unresolvedVariances = (items || []).filter(
    (i: any) => i.expected_quantity !== i.counted_quantity && i.status !== "resolved" && i.status !== "verified"
  );

  const canClose = unresolvedVariances.length === 0;

  return {
    result: {
      stocktake_number: stocktake.stocktake_number,
      current_status: stocktake.status,
      total_items: items?.length || 0,
      unresolved_variances: unresolvedVariances.length,
      can_close: canClose,
      blockers: canClose ? [] : [`${unresolvedVariances.length} unresolved variance(s)`],
      message: canClose
        ? "Stocktake ready to close. Confirm?"
        : `Cannot close: ${unresolvedVariances.length} variance(s) need resolution`,
    },
  };
}

async function toolCloseStocktake(supabase: any, params: any, scope: TenantScope) {
  const { stocktake_id, confirmed } = params;

  if (!confirmed) {
    return { result: { ok: false, error: "Confirmation required" } };
  }

  // Re-validate
  const validation = await toolValidateStocktakeCompletion(supabase, { stocktake_id }, scope);
  if (!validation.result.can_close) {
    return { result: { ok: false, error: validation.result.message } };
  }

  const { error } = await supabase
    .from("stocktakes")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      completed_by: scope.user_id,
    })
    .eq("id", stocktake_id)
    .eq("tenant_id", scope.tenant_id);

  if (error) {
    return { result: { ok: false, error: "Failed to close stocktake" } };
  }

  return {
    result: {
      ok: true,
      message: `Stocktake ${validation.result.stocktake_number} closed successfully`,
    },
  };
}

// ==================== ACCOUNT TOOLS ====================

async function toolSearchAccounts(supabase: any, params: any, scope: TenantScope) {
  const { query } = params;

  const { data: accounts, error } = await supabase
    .from("accounts")
    .select("id, account_name, account_code, email, phone, status")
    .eq("tenant_id", scope.tenant_id)
    .is("deleted_at", null)
    .or(`account_name.ilike.%${query}%,account_code.ilike.%${query}%`)
    .limit(20);

  if (error) {
    return { result: { error: "Failed to search accounts", accounts: [] } };
  }

  return {
    result: {
      accounts: (accounts || []).map((a: any) => ({
        id: a.id,
        name: a.account_name,
        code: a.account_code,
        email: a.email,
        phone: a.phone,
        status: a.status,
      })),
    },
  };
}

async function toolGetAccountSummary(supabase: any, params: any, scope: TenantScope) {
  const { account_id } = params;

  // Get account info
  const { data: account } = await supabase
    .from("accounts")
    .select("id, account_name, account_code, email, phone")
    .eq("id", account_id)
    .eq("tenant_id", scope.tenant_id)
    .single();

  if (!account) {
    return { result: { error: "Account not found" } };
  }

  // Count items by status
  const { data: itemCounts } = await supabase
    .from("items")
    .select("status")
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", account_id)
    .is("deleted_at", null);

  const statusCounts: Record<string, number> = {};
  (itemCounts || []).forEach((item: any) => {
    statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
  });

  // Count open tasks
  const { count: openTaskCount } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", account_id)
    .in("status", ["open", "in_progress"])
    .is("deleted_at", null);

  // Get recent shipments
  const { data: recentShipments } = await supabase
    .from("shipments")
    .select("id, shipment_number, shipment_type, status, received_at, shipped_at")
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", account_id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(5);

  // Count unbilled events
  const { data: unbilledEvents } = await supabase
    .from("billing_events")
    .select("total_amount")
    .eq("tenant_id", scope.tenant_id)
    .eq("account_id", account_id)
    .is("invoice_id", null);

  const unbilledTotal = (unbilledEvents || []).reduce((sum: number, e: any) => sum + (e.total_amount || 0), 0);

  return {
    result: {
      account: {
        id: account.id,
        name: account.account_name,
        code: account.account_code,
        email: account.email,
        phone: account.phone,
      },
      items: {
        total: itemCounts?.length || 0,
        by_status: statusCounts,
      },
      open_tasks: openTaskCount || 0,
      recent_shipments: (recentShipments || []).map((s: any) => ({
        number: s.shipment_number,
        type: s.shipment_type,
        status: s.status,
        date: s.received_at || s.shipped_at,
      })),
      unbilled_amount: unbilledTotal,
    },
  };
}

// ==================== DISPOSAL TOOLS ====================

async function toolCreateDisposalOrderDraft(supabase: any, params: any, scope: TenantScope) {
  const { item_ids, reason } = params;

  // Validate items
  const { data: items } = await supabase
    .from("items")
    .select("id, item_code, description, status, account:accounts(account_name)")
    .in("id", item_ids)
    .eq("tenant_id", scope.tenant_id)
    .is("deleted_at", null);

  if (!items || items.length === 0) {
    return { result: { ok: false, error: "No valid items found" } };
  }

  // Check for items that can't be disposed
  const blockedItems = items.filter((i: any) =>
    ["allocated", "released"].includes(i.status)
  );

  if (blockedItems.length > 0) {
    return {
      result: {
        ok: false,
        error: "Some items cannot be disposed",
        blocked_items: blockedItems.map((i: any) => ({
          item_code: i.item_code,
          status: i.status,
          reason: i.status === "allocated" ? "Allocated for outbound" : "Already released",
        })),
      },
    };
  }

  const summary = `
**Disposal Order Draft**

Items to dispose (${items.length}):
${items.map((i: any) => `- ${i.item_code}: ${i.description || "No description"} (${i.account?.account_name || "No account"})`).join("\n")}

Reason: ${reason || "Not specified"}

Confirm to create disposal order?
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
        type: "disposal",
        summary,
        data: { item_ids, reason },
      },
    },
  };
}

// ==================== ANALYTICS TOOLS ====================

async function toolGetWarehouseSnapshot(supabase: any, scope: TenantScope) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Total items in storage
  const { count: totalItems } = await supabase
    .from("items")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", scope.tenant_id)
    .eq("status", "active")
    .is("deleted_at", null);

  // Items received today
  const { count: receivedToday } = await supabase
    .from("items")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", scope.tenant_id)
    .gte("received_at", todayStart)
    .is("deleted_at", null);

  // Items received this week
  const { count: receivedWeek } = await supabase
    .from("items")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", scope.tenant_id)
    .gte("received_at", weekAgo)
    .is("deleted_at", null);

  // Pending outbound shipments
  const { count: pendingOutbound } = await supabase
    .from("shipments")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", scope.tenant_id)
    .eq("shipment_type", "outbound")
    .in("status", ["pending", "processing"])
    .is("deleted_at", null);

  // Open tasks by type
  const { data: openTasks } = await supabase
    .from("tasks")
    .select("task_type")
    .eq("tenant_id", scope.tenant_id)
    .in("status", ["open", "in_progress"])
    .is("deleted_at", null);

  const tasksByType: Record<string, number> = {};
  (openTasks || []).forEach((t: any) => {
    tasksByType[t.task_type] = (tasksByType[t.task_type] || 0) + 1;
  });

  // In-progress stocktakes
  const { count: activeStocktakes } = await supabase
    .from("stocktakes")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", scope.tenant_id)
    .in("status", ["draft", "in_progress"]);

  return {
    result: {
      snapshot_time: now.toISOString(),
      items_in_storage: totalItems || 0,
      received_today: receivedToday || 0,
      received_this_week: receivedWeek || 0,
      pending_outbound_shipments: pendingOutbound || 0,
      open_tasks: {
        total: openTasks?.length || 0,
        by_type: tasksByType,
      },
      active_stocktakes: activeStocktakes || 0,
    },
  };
}

async function toolGetRecentActivity(supabase: any, params: any, scope: TenantScope) {
  const hours = params.hours || 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  // Recent inbound shipments
  const { data: recentInbound } = await supabase
    .from("shipments")
    .select("id, shipment_number, received_at, account:accounts(account_name)")
    .eq("tenant_id", scope.tenant_id)
    .eq("shipment_type", "inbound")
    .gte("received_at", since)
    .is("deleted_at", null)
    .order("received_at", { ascending: false })
    .limit(10);

  // Recent completed tasks
  const { data: recentTasks } = await supabase
    .from("tasks")
    .select("id, task_number, task_type, title, completed_at")
    .eq("tenant_id", scope.tenant_id)
    .eq("status", "completed")
    .gte("completed_at", since)
    .is("deleted_at", null)
    .order("completed_at", { ascending: false })
    .limit(10);

  // Recent item movements
  const { data: recentMovements } = await supabase
    .from("movements")
    .select(`
      id, action_type, moved_at,
      item:items(item_code),
      to_location:locations!movements_to_location_id_fkey(code)
    `)
    .eq("tenant_id", scope.tenant_id)
    .gte("moved_at", since)
    .order("moved_at", { ascending: false })
    .limit(10);

  return {
    result: {
      period: `Last ${hours} hours`,
      shipments_received: (recentInbound || []).map((s: any) => ({
        number: s.shipment_number,
        received_at: s.received_at,
        account: s.account?.account_name,
      })),
      tasks_completed: (recentTasks || []).map((t: any) => ({
        number: t.task_number,
        type: t.task_type,
        title: t.title,
        completed_at: t.completed_at,
      })),
      items_moved: (recentMovements || []).map((m: any) => ({
        item_code: m.item?.item_code,
        type: m.action_type,
        to_location: m.to_location?.code,
        timestamp: m.moved_at,
      })),
    },
  };
}

// ==================== CLAIMS TOOLS ====================

async function toolSearchClaims(supabase: any, params: any, scope: TenantScope) {
  const { query, status } = params;

  let queryBuilder = supabase
    .from("claims")
    .select(`
      id, claim_number, status, claim_type, created_at,
      account:accounts(id, account_name)
    `)
    .eq("tenant_id", scope.tenant_id)
    .is("deleted_at", null);

  if (status) {
    queryBuilder = queryBuilder.eq("status", status);
  }

  if (query) {
    queryBuilder = queryBuilder.or(`claim_number.ilike.%${query}%`);
  }

  const { data: claims, error } = await queryBuilder
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return { result: { error: "Failed to search claims", claims: [] } };
  }

  return {
    result: {
      claims: (claims || []).map((c: any) => ({
        id: c.id,
        number: c.claim_number,
        type: c.claim_type,
        status: c.status,
        account: c.account?.account_name,
        created_at: c.created_at,
      })),
    },
  };
}

// ==================== NOTES TOOLS ====================

async function toolAddNoteToItem(supabase: any, params: any, scope: TenantScope) {
  const { item_id, note } = params;

  // Verify item exists
  const { data: item } = await supabase
    .from("items")
    .select("id, item_code")
    .eq("id", item_id)
    .eq("tenant_id", scope.tenant_id)
    .single();

  if (!item) {
    return { result: { ok: false, error: "Item not found" } };
  }

  // Insert into item_notes table
  const { error } = await supabase
    .from("item_notes")
    .insert({
      item_id,
      note,
      created_by: scope.user_id,
      note_type: "general",
      visibility: "internal",
      is_current: true,
      tenant_id: scope.tenant_id,
    });

  if (error) {
    return { result: { ok: false, error: "Failed to add note" } };
  }

  return {
    result: {
      ok: true,
      message: `Note added to ${item.item_code}`,
      item_code: item.item_code,
    },
  };
}

// ==================== UTILITY TOOLS ====================

async function toolResolveDisambiguation(
  params: { selections?: number[]; select_all?: boolean; entity_type?: string },
  sessionState: SessionState
): Promise<{ result: any; newSessionState?: Partial<SessionState> }> {
  const disambiguation = sessionState.pending_disambiguation;

  if (!disambiguation) {
    return { result: { error: "No pending selection to resolve" } };
  }

  // Handle entity type disambiguation
  if (params.entity_type) {
    return {
      result: {
        resolved: true,
        entity_type: params.entity_type,
        original_query: disambiguation.original_query,
      },
      newSessionState: { pending_disambiguation: undefined },
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
    newSessionState: { pending_disambiguation: undefined },
  };
}

// ============================================================
// SESSION STATE MANAGEMENT
// ============================================================

async function getOrCreateSession(
  supabase: any,
  scope: TenantScope,
  uiContext: UIContext
): Promise<{ id: string; state: SessionState }> {
  // Use the client_chat_sessions table with tenant-level scope
  const { data: existing } = await supabase
    .from("client_chat_sessions")
    .select("id, pending_disambiguation, pending_draft")
    .eq("tenant_id", scope.tenant_id)
    .eq("user_id", scope.user_id)
    .is("account_id", null) // Tenant sessions have no account_id
    .gt("expires_at", new Date().toISOString())
    .single();

  if (existing) {
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

  const { data: newSession, error } = await supabase
    .from("client_chat_sessions")
    .insert({
      tenant_id: scope.tenant_id,
      account_id: null, // Tenant sessions
      user_id: scope.user_id,
      last_route: uiContext.route || null,
      last_selected_items: uiContext.selected_item_ids || null,
    })
    .select("id")
    .single();

  if (error) {
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
    await supabase.from("client_chat_sessions").update(updateData).eq("id", sessionId);
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
    const { message, tenantId, uiContext, conversationHistory } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Extract and validate user auth
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const userId = user.id;

    // Fetch user profile and validate tenant_id matches the authenticated user's tenant
    const { data: profile } = await supabase
      .from("users")
      .select("first_name, last_name, tenant_id")
      .eq("id", userId)
      .single();

    if (!profile || profile.tenant_id !== tenantId) {
      return new Response(
        JSON.stringify({ error: "Forbidden: tenant mismatch" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const userName = `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || "Unknown";

    const scope: TenantScope = {
      tenant_id: profile.tenant_id,
      user_id: userId,
      user_name: userName,
    };

    const parsedUiContext: UIContext = uiContext || {};
    const session = await getOrCreateSession(supabase, scope, parsedUiContext);

    // Build messages
    const messages: Array<{ role: string; content: string }> = [];

    if (conversationHistory && Array.isArray(conversationHistory)) {
      for (const msg of conversationHistory.slice(-10)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: "user", content: message });

    // Add session context
    let contextAddition = "";
    if (session.state.pending_disambiguation) {
      contextAddition += `\n\n## Pending Selection\nUser needs to choose from:\n${session.state.pending_disambiguation.candidates
        .map((c) => `${c.index}. ${c.label}`)
        .join("\n")}\nIf their message contains a selection, use tool_resolve_disambiguation.`;
    }
    if (session.state.pending_draft) {
      contextAddition += `\n\n## Pending Confirmation\nThere is a ${session.state.pending_draft.type} operation awaiting confirmation. If user confirms (yes, confirm, proceed), execute it. If they decline, acknowledge and cancel.`;
    }

    // Build initial messages for the conversation
    let currentMessages: Array<{ role: string; content?: string; tool_calls?: any; tool_call_id?: string }> = [
      { role: "system", content: TENANT_SYSTEM_PROMPT + contextAddition },
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
            JSON.stringify({ error: "Rate limited. Try again shortly." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (response.status === 402) {
          return new Response(
            JSON.stringify({ error: "Payment required." }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const t = await response.text();
        console.error("AI error:", response.status, t);
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
          console.error("Parse error:", e);
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
    console.error("tenant-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
