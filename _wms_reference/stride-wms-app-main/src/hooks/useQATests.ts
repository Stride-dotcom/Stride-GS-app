import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

// =============================================================================
// Types
// =============================================================================

export interface QATestRun {
  id: string;
  tenant_id: string;
  warehouse_id: string | null;
  executed_by: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  pass_count: number;
  fail_count: number;
  skip_count: number;
  mode: 'create_cleanup' | 'create_only';
  suites_requested: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // Joined fields
  executed_by_user?: {
    first_name: string | null;
    last_name: string | null;
    email: string;
  };
  warehouse?: {
    name: string;
    code: string;
  };
}

export interface QATestResult {
  id: string;
  run_id: string;
  tenant_id: string;
  suite: string;
  test_name: string;
  status: 'pending' | 'pass' | 'fail' | 'skip' | 'running';
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  error_stack: string | null;
  details: Record<string, unknown>;
  entity_ids: Record<string, string[]>;
  logs: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunTestsOptions {
  suites?: string[];
  warehouse_id?: string;
  mode?: 'create_cleanup' | 'create_only';
}

export interface RunTestsResult {
  run_id: string;
  status: string;
  summary: {
    pass: number;
    fail: number;
    skip: number;
  };
  results_count: number;
}

// =============================================================================
// Test Suite Definitions
// =============================================================================

export const TEST_SUITES = [
  {
    id: 'receiving_flow',
    name: 'Receiving Flow',
    description: 'Tests inbound shipment receiving, photos, put-away locations',
    icon: 'inventory_2'
  },
  {
    id: 'outbound_flow',
    name: 'Outbound / Will Call Flow',
    description: 'Tests outbound shipment creation, release photos, completion',
    icon: 'local_shipping'
  },
  {
    id: 'task_flow',
    name: 'Task Flow (Inspection/Assembly/Repair)',
    description: 'Tests task creation, one-per-item rules, completion with photos',
    icon: 'task_alt'
  },
  {
    id: 'movement_flow',
    name: 'Movement / Put-away Flow',
    description: 'Tests item movement between locations, validation',
    icon: 'swap_horiz'
  },
  {
    id: 'stocktake_flow',
    name: 'Stocktake Flow',
    description: 'Tests stocktake creation, scanning, completion',
    icon: 'inventory'
  },
  {
    id: 'claims_flow',
    name: 'Claims Flow',
    description: 'Tests claim creation, attachments, status workflow',
    icon: 'receipt_long'
  },
  {
    id: 'pricing_flow',
    name: 'Pricing Engine / Class Pricing Flow',
    description: 'Tests service events, class pricing, rate structure',
    icon: 'attach_money'
  },
  {
    id: 'prompts_flow',
    name: 'Guided Prompts Coverage',
    description: 'Verifies guided prompts exist for all workflow types',
    icon: 'psychology'
  },
  {
    id: 'repair_quotes_flow',
    name: 'Repair Quote + Single-Item Task Flow',
    description: 'Tests client quote requests, office pricing, auto-task creation',
    icon: 'build'
  }
];

// =============================================================================
// Hook
// =============================================================================

export function useQATests() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [runs, setRuns] = useState<QATestRun[]>([]);
  const [currentRun, setCurrentRun] = useState<QATestRun | null>(null);
  const [currentResults, setCurrentResults] = useState<QATestResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [runningTests, setRunningTests] = useState(false);

  // Fetch all test runs
  const fetchRuns = useCallback(async () => {
    if (!profile?.tenant_id) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('qa_test_runs')
        .select(`
          *,
          executed_by_user:users!qa_test_runs_executed_by_fkey(first_name, last_name, email),
          warehouse:warehouses(name, code)
        `)
        .eq('tenant_id', profile.tenant_id)
        .order('started_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setRuns((data as unknown as QATestRun[]) || []);
    } catch (error) {
      console.error('Error fetching QA test runs:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to fetch test runs'
      });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, toast]);

  // Fetch results for a specific run
  const fetchRunResults = useCallback(async (runId: string) => {
    if (!profile?.tenant_id) return;

    setLoading(true);
    try {
      // Fetch run details
      const { data: runData, error: runError } = await supabase
        .from('qa_test_runs')
        .select(`
          *,
          executed_by_user:users!qa_test_runs_executed_by_fkey(first_name, last_name, email),
          warehouse:warehouses(name, code)
        `)
        .eq('id', runId)
        .single();

      if (runError) throw runError;
      setCurrentRun(runData as unknown as QATestRun);

      // Fetch results
      const { data: resultsData, error: resultsError } = await supabase
        .from('qa_test_results')
        .select('*')
        .eq('run_id', runId)
        .order('created_at');

      if (resultsError) throw resultsError;
      setCurrentResults((resultsData as unknown as QATestResult[]) || []);
    } catch (error) {
      console.error('Error fetching run results:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to fetch test results'
      });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, toast]);

  // Run tests via Edge Function
  const runTests = useCallback(async (options: RunTestsOptions = {}): Promise<RunTestsResult | null> => {
    if (!profile?.tenant_id) return null;

    setRunningTests(true);
    try {
      // Ensure we have an authenticated session before invoking the Edge Function.
      // If the session is missing (common after refresh / expired local storage), try a refresh once.
      let { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session) {
        await supabase.auth.refreshSession();
        sessionData = (await supabase.auth.getSession()).data;
      }

      if (!sessionData?.session) {
        toast({
          variant: 'destructive',
          title: 'You are signed out',
          description: 'Please sign in again to run QA tests.',
        });
        return null;
      }

      const response = await supabase.functions.invoke('qa-runner', {
        body: {
          action: 'run_tests',
          suites: options.suites || [],
          warehouse_id: options.warehouse_id,
          mode: options.mode || 'create_cleanup'
        }
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to run tests');
      }

      const result = response.data as RunTestsResult;

      toast({
        title: 'Tests Completed',
        description: `${result.summary.pass} passed, ${result.summary.fail} failed, ${result.summary.skip} skipped`
      });

      // Refresh runs list
      await fetchRuns();

      return result;
    } catch (error) {
      console.error('Error running tests:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to run tests'
      });
      return null;
    } finally {
      setRunningTests(false);
    }
  }, [profile?.tenant_id, toast, fetchRuns]);

  // Cleanup test data for a run
  const cleanupRun = useCallback(async (runId: string): Promise<boolean> => {
    if (!profile?.tenant_id) return false;

    try {
      const response = await supabase.functions.invoke('qa-runner', {
        body: {
          action: 'cleanup',
          run_id: runId
        }
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to cleanup');
      }

      toast({
        title: 'Cleanup Complete',
        description: 'Test data has been cleaned up'
      });

      return true;
    } catch (error) {
      console.error('Error cleaning up run:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to cleanup test data'
      });
      return false;
    }
  }, [profile?.tenant_id, toast]);

  // Generate fix prompt for a failed test - optimized for pasting into an AI builder
  const generateFixPrompt = useCallback((result: QATestResult): string => {
    const suiteDef = TEST_SUITES.find(s => s.id === result.suite);
    const lines = [
      '# QA Test Failure - Fix Request',
      '',
      '> Paste this into an AI code assistant to get help fixing this issue.',
      '',
      '## Context',
      '',
      `| Field | Value |`,
      `|-------|-------|`,
      `| **Suite** | ${result.suite} — ${suiteDef?.name || result.suite} |`,
      `| **Test** | ${result.test_name} |`,
      `| **Status** | ${result.status} |`,
      `| **Run ID** | ${result.run_id} |`,
      `| **Timestamp** | ${result.finished_at || result.started_at || 'N/A'} |`,
      '',
      '## Error',
      '',
      '```',
      result.error_message || 'No error message captured',
      '```',
      '',
    ];

    if (result.error_stack) {
      lines.push(
        '## Stack Trace',
        '',
        '```',
        result.error_stack,
        '```',
        '',
      );
    }

    // Include rich details if available
    const details = result.details as Record<string, unknown> | undefined;
    if (details) {
      // Console errors
      const consoleErrors = details.consoleErrors as string[] | undefined;
      if (consoleErrors && consoleErrors.length > 0) {
        lines.push('## Console Errors', '');
        consoleErrors.forEach((err, i) => {
          lines.push(`${i + 1}. \`${err}\``);
        });
        lines.push('');
      }

      // Uncaught exceptions
      const exceptions = details.exceptions as string[] | undefined;
      if (exceptions && exceptions.length > 0) {
        lines.push('## Uncaught Exceptions', '');
        exceptions.forEach((ex, i) => {
          lines.push(`${i + 1}. \`${ex}\``);
        });
        lines.push('');
      }

      // Network failures
      const networkFailures = details.networkFailures as string[] | undefined;
      if (networkFailures && networkFailures.length > 0) {
        lines.push('## Network Failures', '');
        networkFailures.forEach((nf, i) => {
          lines.push(`${i + 1}. \`${nf}\``);
        });
        lines.push('');
      }

      // Tour step failures (for UI Visual QA / Deep E2E)
      const tourSteps = details.tourSteps as Array<{ step: string; action: string; status: string; error?: string }> | undefined;
      if (tourSteps) {
        const failedSteps = tourSteps.filter(s => s.status === 'fail');
        if (failedSteps.length > 0) {
          lines.push('## Failed Tour Steps', '');
          failedSteps.forEach((s, i) => {
            lines.push(`### Step ${i + 1}: \`${s.action}\` on \`${s.step}\``);
            if (s.error) {
              lines.push('```', s.error, '```');
            }
            lines.push('');
          });
        }
      }

      // Accessibility violations
      const axeViolations = details.axeViolations as Array<{ id: string; impact: string; description: string; nodes: number }> | undefined;
      if (axeViolations && axeViolations.length > 0) {
        lines.push('## Accessibility Violations (axe-core)', '');
        axeViolations.forEach(v => {
          lines.push(`- **${v.id}** (${v.impact}): ${v.description} — ${v.nodes} element(s) affected`);
        });
        lines.push('');
      }

      // Issues array (for UI Visual QA)
      const issues = details.issues as Array<{ code: string; message: string; selector?: string; measuredValue?: number; expectedValue?: number }> | undefined;
      if (issues && issues.length > 0) {
        lines.push('## Issues Detected', '');
        issues.forEach((issue, i) => {
          lines.push(`### ${i + 1}. [${issue.code}] ${issue.message}`);
          if (issue.selector) lines.push(`- **Selector:** \`${issue.selector}\``);
          if (issue.measuredValue !== undefined) lines.push(`- **Measured:** ${issue.measuredValue}px`);
          if (issue.expectedValue !== undefined) lines.push(`- **Expected:** ${issue.expectedValue}px`);
          lines.push('');
        });
      }

      // Scroll/overflow info
      if (details.scrollBufferPx !== undefined) {
        lines.push(`**Scroll buffer:** ${details.scrollBufferPx}px (target: 80–120px)`);
        lines.push('');
      }
      if (details.overflow) {
        lines.push('**Horizontal overflow detected** — page content extends beyond viewport width.');
        lines.push('');
      }

      // Remaining details as JSON (exclude already-formatted fields)
      const excludeKeys = ['consoleErrors', 'exceptions', 'networkFailures', 'tourSteps', 'axeViolations', 'issues', 'artifacts', 'fileHints', 'scrollBufferPx', 'overflow', 'scrollable', 'suggestions', 'primaryActionReachable'];
      const remainingDetails: Record<string, unknown> = {};
      Object.entries(details).forEach(([k, v]) => {
        if (!excludeKeys.includes(k) && v !== null && v !== undefined) {
          remainingDetails[k] = v;
        }
      });
      if (Object.keys(remainingDetails).length > 0) {
        lines.push('## Additional Test Details', '', '```json', JSON.stringify(remainingDetails, null, 2), '```', '');
      }
    }

    if (result.entity_ids && Object.keys(result.entity_ids).length > 0) {
      lines.push('## Entity IDs Created During Test', '', '```json', JSON.stringify(result.entity_ids, null, 2), '```', '');
    }

    lines.push(
      '## Expected Behavior',
      '',
      getSuiteExpectedBehavior(result.suite, result.test_name),
      '',
      '## Files to Check',
      '',
      'Start investigating in these files:',
      '',
      getSuiteFilesToCheck(result.suite),
      '',
      '## Technology Stack',
      '',
      '- React 18 + TypeScript + Vite',
      '- Supabase (PostgreSQL + Auth + Edge Functions)',
      '- shadcn-ui + Radix UI + Tailwind CSS',
      '- React Hook Form + Zod validation',
      '- TanStack React Query v5',
      '',
      '## Instructions for AI',
      '',
      '1. Read the error and stack trace carefully',
      '2. Open the files listed above and look for the root cause',
      '3. Explain what is going wrong and why',
      '4. Provide the minimal code change needed to fix it',
      '5. If the fix requires database/RLS changes, note that separately',
      '6. After fixing, verify the change does not break other tests',
    );

    return lines.join('\n');
  }, []);

  return {
    runs,
    currentRun,
    currentResults,
    loading,
    runningTests,
    fetchRuns,
    fetchRunResults,
    runTests,
    cleanupRun,
    generateFixPrompt,
    clearCurrentRun: () => {
      setCurrentRun(null);
      setCurrentResults([]);
    }
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

function getSuiteExpectedBehavior(suite: string, testName: string): string {
  const behaviors: Record<string, string> = {
    receiving_flow: 'Inbound shipments should be created with items, photos attached, locations assigned, and validators should pass before completion.',
    outbound_flow: 'Outbound shipments should be created, release photos attached, validators should verify no unresolved tasks, and items should be marked as released.',
    task_flow: 'Tasks should follow one-per-item rules for inspections, photos should be attached to items on completion, and validators should verify all requirements.',
    movement_flow: 'Items should be movable between locations, movement should be blocked during active stocktakes if freeze is enabled.',
    stocktake_flow: 'Stocktakes should progress through draft → in_progress → completed, with proper validation at each step.',
    claims_flow: 'Claims should be created with proper tenant_id, attachments should be linkable, and status workflow should progress correctly.',
    pricing_flow: 'Service events should exist with proper class pricing, no duplicate rows for the same service/class combination.',
    prompts_flow: 'Guided prompts should exist for all workflow types: receiving, inspection, assembly, repair, outbound.',
    repair_quotes_flow: 'Repair quotes should be single-item only. Client can request quote (no duplicates). Office sets customer_price and locks pricing. Accepted quotes auto-create single-item Repair tasks with quote metadata.'
  };

  return behaviors[suite] || 'Test should pass without errors.';
}

function getSuiteFilesToCheck(suite: string): string {
  const files: Record<string, string[]> = {
    receiving_flow: [
      'src/pages/ShipmentDetail.tsx',
      'src/hooks/useShipments.ts',
      'src/lib/billing/taskCompletionValidation.ts',
      'supabase/functions/validate_shipment_receiving_completion'
    ],
    outbound_flow: [
      'src/pages/ShipmentDetail.tsx',
      'src/pages/OutboundCreate.tsx',
      'src/hooks/useShipments.ts',
      'supabase/functions/validate_shipment_outbound_completion'
    ],
    task_flow: [
      'src/pages/TaskDetail.tsx',
      'src/hooks/useTasks.ts',
      'src/lib/billing/taskCompletionValidation.ts',
      'supabase/functions/validate_task_completion'
    ],
    movement_flow: [
      'src/hooks/useItems.ts',
      'src/components/inventory/MoveItemDialog.tsx',
      'supabase/functions/validate_movement_event'
    ],
    stocktake_flow: [
      'src/pages/Stocktakes.tsx',
      'src/components/stocktakes/StocktakeScanView.tsx',
      'src/hooks/useStocktakes.ts',
      'supabase/functions/validate_stocktake_completion'
    ],
    claims_flow: [
      'src/pages/Claims.tsx',
      'src/pages/ClaimDetail.tsx',
      'src/hooks/useClaims.ts'
    ],
    pricing_flow: [
      'src/components/settings/ServiceEventsPricingTab.tsx',
      'src/hooks/useServiceEvents.ts',
      'src/lib/billing/BillingCalculator.tsx'
    ],
    prompts_flow: [
      'src/components/settings/PromptsSettingsTab.tsx',
      'src/hooks/useGuidedPrompts.ts'
    ],
    repair_quotes_flow: [
      'src/pages/RepairQuotes.tsx',
      'src/components/repair-quotes/RepairQuoteDetailDialog.tsx',
      'src/pages/ClientItems.tsx',
      'src/hooks/useDashboardStats.ts',
      'supabase/migrations/20260201110000_repair_quotes_single_item.sql'
    ]
  };

  const fileList = files[suite] || ['Check relevant files for this feature'];
  return fileList.map(f => `- ${f}`).join('\n');
}
