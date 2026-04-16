import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

// =============================================================================
// Types
// =============================================================================

export interface BotQATestRun {
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
  mode: string;
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
}

export interface BotQATestResult {
  id: string;
  run_id: string;
  tenant_id: string;
  suite: string;
  test_name: string;
  status: 'pending' | 'pass' | 'fail' | 'skip' | 'running' | 'error';
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

// =============================================================================
// Hook
// =============================================================================

export function useBotQATests() {
  const { profile, user } = useAuth();
  const { toast } = useToast();
  const [runs, setRuns] = useState<BotQATestRun[]>([]);
  const [currentRun, setCurrentRun] = useState<BotQATestRun | null>(null);
  const [currentResults, setCurrentResults] = useState<BotQATestResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch all bot QA test runs
  const fetchRuns = useCallback(async () => {
    if (!profile?.tenant_id) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('qa_test_runs')
        .select(`
          *,
          executed_by_user:users!qa_test_runs_executed_by_fkey(first_name, last_name, email)
        `)
        .eq('tenant_id', profile.tenant_id)
        .eq('mode', 'bot_qa')
        .order('started_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setRuns((data as unknown as BotQATestRun[]) || []);
    } catch (error) {
      console.error('Error fetching Bot QA test runs:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to fetch Bot QA test runs'
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
          executed_by_user:users!qa_test_runs_executed_by_fkey(first_name, last_name, email)
        `)
        .eq('id', runId)
        .single();

      if (runError) throw runError;
      setCurrentRun(runData as unknown as BotQATestRun);

      // Fetch results
      const { data: resultsData, error: resultsError } = await supabase
        .from('qa_test_results')
        .select('*')
        .eq('run_id', runId)
        .order('created_at');

      if (resultsError) throw resultsError;
      setCurrentResults((resultsData as unknown as BotQATestResult[]) || []);
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

  // Create a new test run record
  const createRun = useCallback(async (testType: 'tool_level' | 'conversation'): Promise<string | null> => {
    if (!profile?.tenant_id || !user?.id) return null;

    try {
      const { data, error } = await supabase
        .from('qa_test_runs')
        .insert({
          tenant_id: profile.tenant_id,
          executed_by: user.id,
          status: 'running',
          pass_count: 0,
          fail_count: 0,
          skip_count: 0,
          mode: 'bot_qa',
          suites_requested: [testType === 'tool_level' ? 'bot_tool_level' : 'bot_conversation'],
          metadata: { test_type: testType }
        })
        .select('id')
        .single();

      if (error) throw error;
      return data?.id || null;
    } catch (error) {
      console.error('Error creating test run:', error);
      return null;
    }
  }, [profile?.tenant_id, user?.id]);

  // Save a test result
  const saveResult = useCallback(async (
    runId: string,
    result: {
      suite: string;
      test_name: string;
      status: 'pass' | 'fail' | 'skip' | 'error';
      error_message?: string | null;
      details?: Record<string, unknown>;
      duration_ms?: number;
    }
  ): Promise<boolean> => {
    if (!profile?.tenant_id) return false;

    try {
      const now = new Date().toISOString();
      const insertData = {
        run_id: runId,
        tenant_id: profile.tenant_id,
        suite: result.suite,
        test_name: result.test_name,
        status: result.status,
        started_at: now,
        finished_at: now,
        error_message: result.error_message || null,
        details: result.details || {},
        entity_ids: {},
        logs: result.duration_ms ? `Duration: ${result.duration_ms}ms` : null
      };
      const { error } = await (supabase.from('qa_test_results' as any).insert(insertData as any) as any);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error saving test result:', error);
      return false;
    }
  }, [profile?.tenant_id]);

  // Finalize a test run
  const finalizeRun = useCallback(async (
    runId: string,
    summary: { pass: number; fail: number; skip: number; error: number }
  ): Promise<boolean> => {
    try {
      const status = summary.fail > 0 || summary.error > 0 ? 'failed' : 'completed';
      const { error } = await supabase
        .from('qa_test_runs')
        .update({
          status,
          pass_count: summary.pass,
          fail_count: summary.fail + summary.error,
          skip_count: summary.skip,
          finished_at: new Date().toISOString()
        })
        .eq('id', runId);

      if (error) throw error;
      
      // Refresh runs list
      await fetchRuns();
      return true;
    } catch (error) {
      console.error('Error finalizing test run:', error);
      return false;
    }
  }, [fetchRuns]);

  // Generate fix prompt for a failed test
  const generateFixPrompt = useCallback((result: BotQATestResult): string => {
    const lines = [
      '## Bot QA Test Failure - Fix Request',
      '',
      `**Suite:** ${result.suite}`,
      `**Test:** ${result.test_name}`,
      `**Status:** ${result.status}`,
      '',
      '### Error Details',
      '```',
      result.error_message || 'No error message',
      '```',
      ''
    ];

    if (result.error_stack) {
      lines.push('### Stack Trace', '```', result.error_stack, '```', '');
    }

    if (result.details && Object.keys(result.details).length > 0) {
      lines.push('### Details', '```json', JSON.stringify(result.details, null, 2), '```', '');
    }

    lines.push(
      '### Files to Check',
      '- supabase/functions/bot-qa-runner/index.ts',
      '- supabase/functions/tenant-chat/index.ts',
      '- supabase/functions/client-chat/index.ts',
      '- src/services/chatbotTools.ts',
      '- src/services/entityResolver.ts',
      '',
      `**Run ID:** ${result.run_id}`
    );

    return lines.join('\n');
  }, []);

  return {
    runs,
    currentRun,
    currentResults,
    loading,
    fetchRuns,
    fetchRunResults,
    createRun,
    saveResult,
    finalizeRun,
    generateFixPrompt,
    clearCurrentRun: () => {
      setCurrentRun(null);
      setCurrentResults([]);
    }
  };
}
