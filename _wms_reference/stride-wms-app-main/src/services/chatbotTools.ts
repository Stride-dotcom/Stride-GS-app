import { supabase } from '@/integrations/supabase/client';

export interface ChatbotTool {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
  handler: (params: any) => Promise<any>;
}

// Type-safe helper for tables with columns not yet in generated types
const db = supabase as any;

/**
 * Get all chatbot tools for entity lookup and listing
 */
export function getChatbotTools(): ChatbotTool[] {
  return [
    {
      name: 'lookup_task',
      description: 'Search tasks by number (TSK-XXXXX) or keywords in title/description',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Task number or search keywords' },
        },
        required: ['query'],
      },
      handler: lookupTask,
    },
    {
      name: 'lookup_shipment',
      description: 'Search shipments by number (SHP/MAN/EXP/INT/OUT-XXXXX), tracking number, or keywords',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Shipment number, tracking number, or keywords' },
        },
        required: ['query'],
      },
      handler: lookupShipment,
    },
    {
      name: 'lookup_item',
      description: 'Search items by number (ITM-XXXXX), SKU, or name',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Item number, SKU, or name' },
        },
        required: ['query'],
      },
      handler: lookupItem,
    },
    {
      name: 'lookup_quote',
      description: 'Search service quotes by number (EST-XXXXX) or account name',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Quote number or account name' },
        },
        required: ['query'],
      },
      handler: lookupQuote,
    },
    {
      name: 'lookup_repair_quote',
      description: 'Search repair quotes by number (RPQ-XXXXX) or account name',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Repair quote number or account name' },
        },
        required: ['query'],
      },
      handler: lookupRepairQuote,
    },
    {
      name: 'list_tasks',
      description: 'List tasks with optional filters',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status (open, in_progress, completed, cancelled)' },
          assignee: { type: 'string', description: 'Filter by assignee name' },
          due_before: { type: 'string', description: 'Filter by due date (YYYY-MM-DD)' },
          priority: { type: 'string', description: 'Filter by priority (low, medium, high, urgent)' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
      },
      handler: listTasks,
    },
    {
      name: 'list_shipments',
      description: 'List shipments with optional filters',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status' },
          account: { type: 'string', description: 'Filter by account name' },
          arriving_today: { type: 'boolean', description: 'Show only shipments arriving today' },
          direction: { type: 'string', description: 'Filter by direction (inbound, outbound)' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
      },
      handler: listShipments,
    },
    {
      name: 'list_quotes',
      description: 'List service quotes with optional filters',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status (draft, sent, accepted, declined, expired, void)' },
          account: { type: 'string', description: 'Filter by account name' },
          expiring_within_days: { type: 'number', description: 'Show quotes expiring within N days' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
      },
      handler: listQuotes,
    },
  ];
}

// ==================== Tool Handlers ====================

async function lookupTask({ query }: { query: string }) {
  const isNumber = /^(TSK-)?\d{1,5}$/i.test(query);

  if (isNumber) {
    const num = query.toUpperCase().startsWith('TSK-')
      ? query.toUpperCase()
      : `TSK-${query.padStart(5, '0')}`;

    const { data, error } = await db
      .from('tasks')
      .select('id, task_number, title, status, assignee_name, due_date, priority, description')
      .eq('task_number', num)
      .single();

    if (error || !data) {
      return { found: false, message: `Task ${num} not found` };
    }

    return {
      found: true,
      task: {
        number: data.task_number,
        title: data.title,
        status: data.status,
        assignee: data.assignee_name,
        due_date: data.due_date,
        priority: data.priority,
        description: data.description,
      },
    };
  }

  // Search by keywords
  const { data, error } = await db
    .from('tasks')
    .select('id, task_number, title, status, assignee_name, due_date')
    .or(`title.ilike.%${query}%,description.ilike.%${query}%`)
    .limit(5);

  if (error) {
    return { found: false, message: 'Error searching tasks' };
  }

  return {
    found: !!data?.length,
    tasks: data?.map((t: any) => ({
      number: t.task_number,
      title: t.title,
      status: t.status,
      assignee: t.assignee_name,
      due_date: t.due_date,
    })) || [],
  };
}

async function lookupShipment({ query }: { query: string }) {
  if (/^(SHP|MAN|EXP|INT|OUT)-\d{5,6}$/i.test(query)) {
    const { data, error } = await db
      .from('shipments')
      .select('id, shipment_number, status, carrier, tracking_number, shipment_type, expected_arrival_date, account_id')
      .eq('shipment_number', query.toUpperCase())
      .single();

    if (error || !data) {
      return { found: false, message: `Shipment ${query.toUpperCase()} not found` };
    }

    return {
      found: true,
      shipment: {
        number: data.shipment_number,
        status: data.status,
        carrier: data.carrier,
        tracking: data.tracking_number,
        direction: data.shipment_type,
        eta: data.expected_arrival_date,
      },
    };
  }

  // Search by tracking number
  const { data, error } = await db
    .from('shipments')
    .select('id, shipment_number, status, carrier, tracking_number, shipment_type')
    .or(`tracking_number.ilike.%${query}%`)
    .limit(5);

  if (error) {
    return { found: false, message: 'Error searching shipments' };
  }

  return {
    found: !!data?.length,
    shipments: data?.map((s: any) => ({
      number: s.shipment_number,
      status: s.status,
      carrier: s.carrier,
      tracking: s.tracking_number,
      direction: s.shipment_type,
    })) || [],
  };
}

async function lookupItem({ query }: { query: string }) {
  if (/^ITM-\d{5}$/i.test(query)) {
    const { data, error } = await db
      .from('items')
      .select('id, item_code, description, status, quantity')
      .eq('item_code', query.toUpperCase())
      .single();

    if (error || !data) {
      return { found: false, message: `Item ${query.toUpperCase()} not found` };
    }

    return {
      found: true,
      item: {
        number: data.item_code,
        name: data.description,
        quantity: data.quantity,
        status: data.status,
      },
    };
  }

  // Search by description
  const { data, error } = await db
    .from('items')
    .select('id, item_code, description, status, quantity')
    .or(`description.ilike.%${query}%,item_code.ilike.%${query}%`)
    .limit(5);

  if (error) {
    return { found: false, message: 'Error searching items' };
  }

  return {
    found: !!data?.length,
    items: data?.map((i: any) => ({
      number: i.item_code,
      name: i.description,
      quantity: i.quantity,
      status: i.status,
    })) || [],
  };
}

async function lookupQuote({ query }: { query: string }) {
  // Note: quotes table may not exist yet - handle gracefully
  try {
    if (/^EST-\d{5}$/i.test(query)) {
      const { data, error } = await db
        .from('quotes')
        .select('id, quote_number, status, grand_total, expiration_date, account:accounts(account_name)')
        .eq('quote_number', query.toUpperCase())
        .single();

      if (error || !data) {
        return { found: false, message: `Quote ${query.toUpperCase()} not found` };
      }

      return {
        found: true,
        quote: {
          number: data.quote_number,
          status: data.status,
          account: data.account?.account_name,
          total: data.grand_total,
          expires: data.expiration_date,
        },
      };
    }

    // Search by account name
    const { data, error } = await db
      .from('quotes')
      .select('id, quote_number, status, grand_total, account:accounts(account_name)')
      .limit(10);

    if (error) {
      return { found: false, message: 'Service quotes feature not available' };
    }

    const filtered = data?.filter((q: any) =>
      q.account?.account_name?.toLowerCase().includes(query.toLowerCase())
    ) || [];

    return {
      found: !!filtered.length,
      quotes: filtered.slice(0, 5).map((q: any) => ({
        number: q.quote_number,
        status: q.status,
        account: q.account?.account_name,
        total: q.grand_total,
      })),
    };
  } catch {
    return { found: false, message: 'Service quotes feature not available' };
  }
}

async function lookupRepairQuote({ query }: { query: string }) {
  if (/^RPQ-\d{5}$/i.test(query)) {
    const { data, error } = await db
      .from('repair_quotes')
      .select('id, quote_number, status, total_amount, account:accounts(account_name)')
      .eq('quote_number', query.toUpperCase())
      .single();

    if (error || !data) {
      return { found: false, message: `Repair quote ${query.toUpperCase()} not found` };
    }

    return {
      found: true,
      repair_quote: {
        number: data.quote_number,
        status: data.status,
        account: data.account?.account_name,
        total: data.total_amount,
      },
    };
  }

  // Search by account name
  const { data, error } = await db
    .from('repair_quotes')
    .select('id, quote_number, status, total_amount, account:accounts(account_name)')
    .limit(10);

  if (error) {
    return { found: false, message: 'Error searching repair quotes' };
  }

  const filtered = data?.filter((q: any) =>
    q.account?.account_name?.toLowerCase().includes(query.toLowerCase())
  ) || [];

  return {
    found: !!filtered.length,
    repair_quotes: filtered.slice(0, 5).map((q: any) => ({
      number: q.quote_number,
      status: q.status,
      account: q.account?.account_name,
      total: q.total_amount,
    })),
  };
}

async function listTasks(filters: {
  status?: string;
  assignee?: string;
  due_before?: string;
  priority?: string;
  limit?: number;
}) {
  let query = db
    .from('tasks')
    .select('id, task_number, title, status, assignee_name, due_date, priority');

  if (filters.status) {
    query = query.eq('status', filters.status);
  }
  if (filters.assignee) {
    query = query.ilike('assignee_name', `%${filters.assignee}%`);
  }
  if (filters.due_before) {
    query = query.lte('due_date', filters.due_before);
  }
  if (filters.priority) {
    query = query.eq('priority', filters.priority);
  }

  const { data, error } = await query
    .order('due_date', { ascending: true })
    .limit(filters.limit || 10);

  if (error) {
    return { count: 0, tasks: [], error: 'Error listing tasks' };
  }

  return {
    count: data?.length || 0,
    tasks: data?.map((t: any) => ({
      number: t.task_number,
      title: t.title,
      status: t.status,
      assignee: t.assignee_name,
      due_date: t.due_date,
      priority: t.priority,
    })) || [],
  };
}

async function listShipments(filters: {
  status?: string;
  account?: string;
  arriving_today?: boolean;
  direction?: string;
  limit?: number;
}) {
  let query = db
    .from('shipments')
    .select('id, shipment_number, status, carrier, shipment_type, expected_arrival_date, account:accounts(account_name)');

  if (filters.status) {
    query = query.eq('status', filters.status);
  }
  if (filters.direction) {
    query = query.eq('shipment_type', filters.direction);
  }
  if (filters.arriving_today) {
    const today = new Date().toISOString().split('T')[0];
    query = query.eq('expected_arrival_date', today);
  }

  const { data, error } = await query
    .order('expected_arrival_date', { ascending: true })
    .limit(filters.limit || 10);

  if (error) {
    return { count: 0, shipments: [], error: 'Error listing shipments' };
  }

  let results = data || [];
  if (filters.account) {
    results = results.filter((s: any) =>
      s.account?.account_name?.toLowerCase().includes(filters.account!.toLowerCase())
    );
  }

  return {
    count: results.length,
    shipments: results.map((s: any) => ({
      number: s.shipment_number,
      status: s.status,
      carrier: s.carrier,
      direction: s.shipment_type,
      account: s.account?.account_name,
      eta: s.expected_arrival_date,
    })),
  };
}

async function listQuotes(filters: {
  status?: string;
  account?: string;
  expiring_within_days?: number;
  limit?: number;
}) {
  // Note: quotes table may not exist yet - handle gracefully
  try {
    let query = db
      .from('quotes')
      .select('id, quote_number, status, grand_total, expiration_date, account:accounts(account_name)');

    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    if (filters.expiring_within_days) {
      const today = new Date();
      const futureDate = new Date();
      futureDate.setDate(today.getDate() + filters.expiring_within_days);
      query = query
        .gte('expiration_date', today.toISOString().split('T')[0])
        .lte('expiration_date', futureDate.toISOString().split('T')[0]);
    }

    const { data, error } = await query
      .order('expiration_date', { ascending: true })
      .limit(filters.limit || 10);

    if (error) {
      return { count: 0, quotes: [], message: 'Service quotes feature not available' };
    }

    let results = data || [];
    if (filters.account) {
      results = results.filter((q: any) =>
        q.account?.account_name?.toLowerCase().includes(filters.account!.toLowerCase())
      );
    }

    return {
      count: results.length,
      quotes: results.map((q: any) => ({
        number: q.quote_number,
        status: q.status,
        account: q.account?.account_name,
        total: q.grand_total,
        expires: q.expiration_date,
      })),
    };
  } catch {
    return { count: 0, quotes: [], message: 'Service quotes feature not available' };
  }
}

/**
 * Get tools in Anthropic API format
 */
export function getChatbotToolsForAnthropic() {
  return getChatbotTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

/**
 * Execute a tool by name
 */
export async function executeTool(name: string, params: any): Promise<any> {
  const tools = getChatbotTools();
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return tool.handler(params);
}
