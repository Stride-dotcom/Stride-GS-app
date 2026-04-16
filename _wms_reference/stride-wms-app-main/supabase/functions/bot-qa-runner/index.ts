import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================
// TYPES
// ============================================================

interface TestScenario {
  id: string;
  name: string;
  description: string;
  turns: ScenarioTurn[];
  assertions: ScenarioAssertion[];
  cleanup?: CleanupAction[];
}

interface ScenarioTurn {
  user_message: string;
  expected_patterns?: string[];
  expected_behavior?: string;
  should_ask_clarification?: boolean;
  should_ask_confirmation?: boolean;
  auto_confirm?: boolean;
}

interface ScenarioAssertion {
  type: 'db_count' | 'db_field' | 'response_contains' | 'response_not_contains';
  table?: string;
  filter?: Record<string, any>;
  field?: string;
  expected_value?: any;
  operator?: 'eq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains';
  pattern?: string;
  description: string;
}

interface CleanupAction {
  table: string;
  filter: Record<string, any>;
}

interface TurnResult {
  user_message: string;
  bot_response: string;
  assertions_checked: Array<{
    description: string;
    passed: boolean;
    actual?: any;
    expected?: any;
  }>;
  duration_ms: number;
}

interface ScenarioResult {
  scenario_id: string;
  scenario_name: string;
  status: 'pass' | 'fail' | 'skip' | 'error';
  message: string;
  turns: TurnResult[];
  db_assertions: Array<{
    description: string;
    passed: boolean;
    actual?: any;
    expected?: any;
  }>;
  total_duration_ms: number;
  error?: string;
}

// ============================================================
// SCENARIO DEFINITIONS
// ============================================================

function getTestScenarios(tenantId: string, testShipmentId?: string, testShipmentNumber?: string): TestScenario[] {
  const scenarios: TestScenario[] = [];

  // Scenario 1: Partial shipment match (unambiguous)
  if (testShipmentNumber) {
    const partialNumber = testShipmentNumber.slice(-5);
    scenarios.push({
      id: 'conv-1',
      name: 'Partial Shipment Match (Unambiguous)',
      description: 'User references shipment by partial number, bot resolves unambiguously',
      turns: [
        {
          user_message: `What's in shipment ${partialNumber}?`,
          expected_patterns: ['item', 'found', testShipmentNumber],
          expected_behavior: 'Bot should resolve the partial number and return shipment info',
        },
      ],
      assertions: [],
      cleanup: [],
    });
  }

  // Scenario 2: Ambiguous suffix (dynamic based on data)
  scenarios.push({
    id: 'conv-2',
    name: 'Ambiguous Suffix Detection',
    description: 'User references with a short suffix that matches multiple records',
    turns: [
      {
        user_message: 'Show shipment 12',
        expected_behavior: 'Bot should ask to choose if multiple matches exist, or show result if unique',
        should_ask_clarification: true,
      },
    ],
    assertions: [],
    cleanup: [],
  });

  // Scenario 3: Bulk inspections create 1-per-item
  if (testShipmentId && testShipmentNumber) {
    scenarios.push({
      id: 'conv-3',
      name: 'Bulk Inspection Creation (1 per item)',
      description: 'Create inspection tasks for shipment items - verifies one task per item rule',
      turns: [
        {
          user_message: `Create inspection tasks for all items on shipment ${testShipmentNumber}`,
          expected_patterns: ['preview', 'inspection', 'confirm'],
          expected_behavior: 'Bot should show preview and ask for confirmation',
          should_ask_confirmation: true,
        },
        {
          user_message: 'Yes, create them',
          expected_patterns: ['created', 'inspection', 'task'],
          expected_behavior: 'Bot should confirm task creation',
          auto_confirm: true,
        },
      ],
      assertions: [
        {
          type: 'db_count',
          table: 'tasks',
          filter: { task_type: 'inspection', 'notes->qa_test': true },
          description: 'Each inspection task should have exactly 1 item',
        },
      ],
      cleanup: [
        { table: 'tasks', filter: { 'notes->qa_test': true } },
      ],
    });
  }

  // Scenario 4: Bulk move requires preview + confirm
  scenarios.push({
    id: 'conv-4',
    name: 'Bulk Move Preview + Confirm',
    description: 'Bulk move should show preview and require explicit confirmation',
    turns: [
      {
        user_message: 'Move all items from shipment 12345 to location A1-01',
        expected_behavior: 'Bot should either ask for clarification (if ambiguous) or show preview with confirmation request',
        should_ask_confirmation: true,
      },
    ],
    assertions: [],
    cleanup: [],
  });

  // Scenario 5: Read-only history query
  scenarios.push({
    id: 'conv-5',
    name: 'Movement History Query',
    description: 'Read-only query for item movement history - immediate execution',
    turns: [
      {
        user_message: 'Who moved item 998877 last?',
        expected_behavior: 'Bot should either return movement info or indicate item not found. Should NOT ask for confirmation for read operations.',
      },
    ],
    assertions: [],
    cleanup: [],
  });

  return scenarios;
}

// ============================================================
// TENANT BOT CALLER
// ============================================================

async function callTenantBot(
  tenantId: string,
  userId: string,
  message: string,
  conversationHistory: Array<{ role: string; content: string }>,
  authToken: string
): Promise<{ response: string; error?: string }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const tenantChatUrl = `${supabaseUrl}/functions/v1/tenant-chat`;

  try {
    const response = await fetch(tenantChatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        message,
        tenantId,
        uiContext: { route: '/admin/bot-qa' },
        conversationHistory,
      }),
    });

    if (!response.ok) {
      return { response: '', error: `HTTP ${response.status}` };
    }

    // Handle SSE response
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream')) {
      const reader = response.body?.getReader();
      if (!reader) {
        return { response: '', error: 'No response body' };
      }

      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullContent += content;
            }
          } catch {
            // Incomplete JSON, continue
          }
        }
      }

      return { response: fullContent };
    } else {
      // JSON response
      const data = await response.json();
      return { response: data.content || data.error || 'No content' };
    }
  } catch (error) {
    return { response: '', error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ============================================================
// SCENARIO RUNNER
// ============================================================

async function runScenario(
  supabase: any,
  scenario: TestScenario,
  tenantId: string,
  userId: string,
  authToken: string
): Promise<ScenarioResult> {
  const startTime = Date.now();
  const turnResults: TurnResult[] = [];
  const conversationHistory: Array<{ role: string; content: string }> = [];
  let hasError = false;
  let errorMessage = '';

  try {
    for (const turn of scenario.turns) {
      const turnStart = Date.now();
      const turnAssertions: TurnResult['assertions_checked'] = [];

      // Call the bot
      const { response, error } = await callTenantBot(
        tenantId,
        userId,
        turn.user_message,
        conversationHistory,
        authToken
      );

      if (error) {
        hasError = true;
        errorMessage = `Turn failed: ${error}`;
        turnResults.push({
          user_message: turn.user_message,
          bot_response: `ERROR: ${error}`,
          assertions_checked: [],
          duration_ms: Date.now() - turnStart,
        });
        break;
      }

      // Update conversation history
      conversationHistory.push({ role: 'user', content: turn.user_message });
      conversationHistory.push({ role: 'assistant', content: response });

      // Check expected patterns
      if (turn.expected_patterns) {
        for (const pattern of turn.expected_patterns) {
          const found = response.toLowerCase().includes(pattern.toLowerCase());
          turnAssertions.push({
            description: `Response contains "${pattern}"`,
            passed: found,
            actual: found ? 'found' : 'not found',
            expected: 'found',
          });
        }
      }

      // Check clarification behavior
      if (turn.should_ask_clarification) {
        const asksForChoice = /choose|which|select|multiple|ambiguous|did you mean/i.test(response);
        const hasNumberedList = /\d+\.\s+\w/.test(response);
        const passed = asksForChoice || hasNumberedList || /not found|no .* found/i.test(response);

        turnAssertions.push({
          description: 'Bot asks for clarification when ambiguous (or indicates not found)',
          passed,
          actual: asksForChoice ? 'asks to choose' : hasNumberedList ? 'shows numbered list' : 'other response',
          expected: 'asks to choose OR shows not found',
        });
      }

      // Check confirmation behavior
      if (turn.should_ask_confirmation) {
        const asksConfirm = /confirm|proceed|continue|yes.*no|are you sure/i.test(response);
        const showsPreview = /preview|will|would|about to|summary/i.test(response);
        const passed = asksConfirm || showsPreview || /not found|error|cannot/i.test(response);

        turnAssertions.push({
          description: 'Bot shows preview and asks for confirmation',
          passed,
          actual: asksConfirm ? 'asks confirmation' : showsPreview ? 'shows preview' : 'other response',
          expected: 'preview + confirmation OR error/not found',
        });
      }

      turnResults.push({
        user_message: turn.user_message,
        bot_response: response,
        assertions_checked: turnAssertions,
        duration_ms: Date.now() - turnStart,
      });
    }

    // Run DB assertions
    const dbAssertions: ScenarioResult['db_assertions'] = [];

    for (const assertion of scenario.assertions) {
      if (assertion.type === 'db_count' && assertion.table) {
        // For inspection tasks, verify each has exactly 1 item
        if (assertion.table === 'tasks' && assertion.filter?.task_type === 'inspection') {
          const { data: tasks } = await supabase
            .from('tasks')
            .select('id, task_number, item_ids')
            .eq('tenant_id', tenantId)
            .eq('task_type', 'inspection')
            .contains('notes', { qa_test: true });

          const validTasks = (tasks || []).filter((t: any) =>
            Array.isArray(t.item_ids) && t.item_ids.length === 1
          );

          const allValid = tasks?.length > 0 && validTasks.length === tasks.length;

          dbAssertions.push({
            description: assertion.description,
            passed: allValid,
            actual: `${validTasks.length}/${tasks?.length || 0} tasks have exactly 1 item`,
            expected: 'All tasks have exactly 1 item',
          });
        }
      }
    }

    // Determine final status
    const allTurnsPassed = turnResults.every(t =>
      t.assertions_checked.length === 0 || t.assertions_checked.every(a => a.passed)
    );
    const allDbPassed = dbAssertions.every(a => a.passed);

    const status = hasError ? 'error'
      : (allTurnsPassed && allDbPassed) ? 'pass'
      : 'fail';

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      status,
      message: hasError ? errorMessage : status === 'pass' ? 'All assertions passed' : 'Some assertions failed',
      turns: turnResults,
      db_assertions: dbAssertions,
      total_duration_ms: Date.now() - startTime,
      error: hasError ? errorMessage : undefined,
    };
  } catch (error) {
    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      turns: turnResults,
      db_assertions: [],
      total_duration_ms: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================
// CLEANUP
// ============================================================

async function cleanupScenario(
  supabase: any,
  scenario: TestScenario,
  tenantId: string
): Promise<{ deleted: number; errors: string[] }> {
  let deleted = 0;
  const errors: string[] = [];

  for (const cleanup of scenario.cleanup || []) {
    try {
      let query = supabase
        .from(cleanup.table)
        .delete()
        .eq('tenant_id', tenantId);

      // Apply filters
      for (const [key, value] of Object.entries(cleanup.filter)) {
        if (key.includes('->')) {
          // JSONB filter
          const [col, jsonKey] = key.split('->');
          query = query.contains(col, { [jsonKey]: value });
        } else {
          query = query.eq(key, value);
        }
      }

      const { error, count } = await query;
      if (error) {
        errors.push(`${cleanup.table}: ${error.message}`);
      } else {
        deleted += count || 0;
      }
    } catch (e) {
      errors.push(`${cleanup.table}: ${e instanceof Error ? e.message : 'Unknown'}`);
    }
  }

  return { deleted, errors };
}

// ============================================================
// MAIN HANDLER
// ============================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify admin access
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user profile
    const { data: profile } = await supabase
      .from("users")
      .select("id, tenant_id")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return new Response(
        JSON.stringify({ error: "User profile not found" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check admin role via user_roles table
    const { data: userRoles } = await supabase
      .from("user_roles")
      .select(`
        role_id,
        roles (name)
      `)
      .eq("user_id", user.id)
      .is("deleted_at", null);

    const roleNames = (userRoles || []).map((ur: any) => ur.roles?.name?.toLowerCase());
    // Allow admin or the system-level admin_dev role
    const isAdmin = roleNames.includes('admin') || roleNames.includes('admin_dev');

    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tenantId = profile.tenant_id;
    const userId = user.id;

    // Parse request
    const body = await req.json();
    const { action, scenario_ids, test_shipment_id, test_shipment_number } = body;

    if (action === 'list_scenarios') {
      const scenarios = getTestScenarios(tenantId, test_shipment_id, test_shipment_number);
      return new Response(
        JSON.stringify({ scenarios: scenarios.map(s => ({ id: s.id, name: s.name, description: s.description })) }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === 'run_scenarios') {
      const scenarios = getTestScenarios(tenantId, test_shipment_id, test_shipment_number);
      const scenariosToRun = scenario_ids
        ? scenarios.filter(s => scenario_ids.includes(s.id))
        : scenarios;

      const results: ScenarioResult[] = [];

      for (const scenario of scenariosToRun) {
        // Skip scenarios that need shipment if not provided
        if ((scenario.id === 'conv-1' || scenario.id === 'conv-3') && !test_shipment_id) {
          results.push({
            scenario_id: scenario.id,
            scenario_name: scenario.name,
            status: 'skip',
            message: 'No test shipment selected',
            turns: [],
            db_assertions: [],
            total_duration_ms: 0,
          });
          continue;
        }

        const result = await runScenario(supabase, scenario, tenantId, userId, token);
        results.push(result);
      }

      return new Response(
        JSON.stringify({ results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === 'cleanup') {
      const scenarios = getTestScenarios(tenantId, test_shipment_id, test_shipment_number);
      let totalDeleted = 0;
      const allErrors: string[] = [];

      for (const scenario of scenarios) {
        const { deleted, errors } = await cleanupScenario(supabase, scenario, tenantId);
        totalDeleted += deleted;
        allErrors.push(...errors);
      }

      // Also cleanup any QA tasks by notes
      const { error: taskCleanupError, count } = await supabase
        .from('tasks')
        .delete()
        .eq('tenant_id', tenantId)
        .contains('notes', { qa_test: true });

      if (!taskCleanupError && count) {
        totalDeleted += count;
      }

      return new Response(
        JSON.stringify({
          deleted: totalDeleted,
          errors: allErrors.length > 0 ? allErrors : undefined
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action. Use: list_scenarios, run_scenarios, cleanup" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("bot-qa-runner error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
