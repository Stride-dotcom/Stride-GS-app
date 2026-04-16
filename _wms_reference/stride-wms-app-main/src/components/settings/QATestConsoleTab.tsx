import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useQATests, TEST_SUITES, QATestRun, QATestResult } from '@/hooks/useQATests';
import { useWarehouses } from '@/hooks/useWarehouses';
import { cn } from '@/lib/utils';

type QAHook = ReturnType<typeof useQATests>;

// =============================================================================
// Status Badge Component
// =============================================================================

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
    running: { variant: 'default', label: 'Running' },
    completed: { variant: 'secondary', label: 'Completed' },
    failed: { variant: 'destructive', label: 'Failed' },
    cancelled: { variant: 'outline', label: 'Cancelled' },
    pass: { variant: 'secondary', label: 'Pass' },
    fail: { variant: 'destructive', label: 'Fail' },
    skip: { variant: 'outline', label: 'Skip' },
    pending: { variant: 'outline', label: 'Pending' }
  };

  const config = variants[status] || { variant: 'outline', label: status };

  return (
    <Badge variant={config.variant} className={cn(
      status === 'pass' && 'bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/30',
      status === 'completed' && 'bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/30'
    )}>
      {config.label}
    </Badge>
  );
}

// =============================================================================
// Run Tests Tab
// =============================================================================

function RunTestsTab({
  qa,
  onRunCompleted,
}: {
  qa: QAHook;
  onRunCompleted?: (runId: string) => void;
}) {
  const { runTests, runningTests } = qa;
  const { warehouses } = useWarehouses();
  const [selectedSuites, setSelectedSuites] = useState<string[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('');
  const [mode, setMode] = useState<'create_cleanup' | 'create_only'>('create_cleanup');
  const [runLog, setRunLog] = useState<string[]>([]);

  const handleToggleSuite = (suiteId: string) => {
    setSelectedSuites(prev =>
      prev.includes(suiteId)
        ? prev.filter(s => s !== suiteId)
        : [...prev, suiteId]
    );
  };

  const handleSelectAll = () => {
    if (selectedSuites.length === TEST_SUITES.length) {
      setSelectedSuites([]);
    } else {
      setSelectedSuites(TEST_SUITES.map(s => s.id));
    }
  };

  const handleRunTests = async (suites?: string[]) => {
    setRunLog([`[${new Date().toISOString()}] Starting test run...`]);

    const suitesToRun = suites || selectedSuites;
    if (suitesToRun.length === 0) {
      setRunLog(prev => [...prev, `[${new Date().toISOString()}] Running all test suites`]);
    } else {
      setRunLog(prev => [...prev, `[${new Date().toISOString()}] Running suites: ${suitesToRun.join(', ')}`]);
    }

    const result = await runTests({
      suites: suitesToRun,
      warehouse_id: selectedWarehouse || undefined,
      mode
    });

    if (result) {
      setRunLog(prev => [
        ...prev,
        `[${new Date().toISOString()}] Tests completed`,
        `  Pass: ${result.summary.pass}`,
        `  Fail: ${result.summary.fail}`,
        `  Skip: ${result.summary.skip}`,
        `  Run ID: ${result.run_id}`
      ]);

      // Jump straight to results and load the run so users don't have to hunt for it.
      onRunCompleted?.(result.run_id);
    } else {
      setRunLog(prev => [...prev, `[${new Date().toISOString()}] Test run failed`]);
    }
  };

  return (
    <div className="space-y-6">
      {/* Options Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="settings" size="md" />
            Test Options
          </CardTitle>
          <CardDescription>
            Configure test execution settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Target Warehouse</Label>
              <Select value={selectedWarehouse || '__all__'} onValueChange={(v) => setSelectedWarehouse(v === '__all__' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="All warehouses (default)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All warehouses</SelectItem>
                  {warehouses.map(wh => (
                    <SelectItem key={wh.id} value={wh.id}>
                      {wh.name} ({wh.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>QA Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as 'create_cleanup' | 'create_only')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="create_cleanup">Create + Cleanup (default)</SelectItem>
                  <SelectItem value="create_only">Create only (keep test data)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {mode === 'create_cleanup'
                  ? 'Test data will be automatically cleaned up after tests complete'
                  : 'Test data will be preserved for inspection'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Test Suites Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MaterialIcon name="science" size="md" />
                Test Suites
              </CardTitle>
              <CardDescription>
                Select test suites to run
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAll}
              >
                {selectedSuites.length === TEST_SUITES.length ? 'Deselect All' : 'Select All'}
              </Button>
              <Button
                onClick={() => handleRunTests()}
                disabled={runningTests}
              >
                {runningTests ? (
                  <>
                    <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <MaterialIcon name="play_arrow" size="sm" className="mr-2" />
                    Run All Tests
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {TEST_SUITES.map(suite => (
              <div
                key={suite.id}
                className={cn(
                  "flex items-start gap-3 p-4 border rounded-lg cursor-pointer transition-colors",
                  selectedSuites.includes(suite.id)
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted/50"
                )}
                onClick={() => handleToggleSuite(suite.id)}
              >
                <Checkbox
                  checked={selectedSuites.includes(suite.id)}
                  onCheckedChange={() => handleToggleSuite(suite.id)}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <MaterialIcon name={suite.icon} size="sm" className="text-muted-foreground" />
                    <span className="font-medium">{suite.name}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {suite.description}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRunTests([suite.id]);
                  }}
                  disabled={runningTests}
                >
                  <MaterialIcon name="play_arrow" size="sm" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Run Log Card */}
      {runLog.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="terminal" size="md" />
              Run Log
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-48 w-full rounded-md border bg-muted/30 p-4">
              <pre className="text-sm font-mono">
                {runLog.join('\n')}
              </pre>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// =============================================================================
// Error Results Tab
// =============================================================================

function ErrorResultsTab({ qa }: { qa: QAHook }) {
  const {
    runs,
    currentRun,
    currentResults,
    loading,
    fetchRuns,
    fetchRunResults,
    cleanupRun,
    generateFixPrompt,
    clearCurrentRun,
  } = qa;
  const [selectedResult, setSelectedResult] = useState<QATestResult | null>(null);
  const [fixPromptDialogOpen, setFixPromptDialogOpen] = useState(false);
  const [fixPrompt, setFixPrompt] = useState('');

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const handleViewRun = (run: QATestRun) => {
    fetchRunResults(run.id);
  };

  const handleCopyFixPrompt = (result: QATestResult) => {
    const prompt = generateFixPrompt(result);
    setFixPrompt(prompt);
    setFixPromptDialogOpen(true);
  };

  const handleCopyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(fixPrompt);
    } catch {
      // Fallback
      const textArea = document.createElement('textarea');
      textArea.value = fixPrompt;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
  };

  // Group results by suite
  const resultsBySuite = currentResults.reduce((acc, result) => {
    if (!acc[result.suite]) acc[result.suite] = [];
    acc[result.suite].push(result);
    return acc;
  }, {} as Record<string, QATestResult[]>);

  if (currentRun) {
    return (
      <div className="space-y-6">
        {/* Back button and run header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={clearCurrentRun}>
            <MaterialIcon name="arrow_back" size="sm" className="mr-2" />
            Back to Runs
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  Run Details
                  <StatusBadge status={currentRun.status} />
                </CardTitle>
                <CardDescription>
                  Started {new Date(currentRun.started_at).toLocaleString()}
                  {currentRun.executed_by_user && (
                    <> by {currentRun.executed_by_user.first_name} {currentRun.executed_by_user.last_name}</>
                  )}
                </CardDescription>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{currentRun.pass_count}</div>
                  <div className="text-xs text-muted-foreground">Passed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{currentRun.fail_count}</div>
                  <div className="text-xs text-muted-foreground">Failed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-600">{currentRun.skip_count}</div>
                  <div className="text-xs text-muted-foreground">Skipped</div>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 text-sm md:grid-cols-3">
              <div>
                <span className="text-muted-foreground">Mode:</span>{' '}
                <span className="font-medium">{currentRun.mode === 'create_cleanup' ? 'Create + Cleanup' : 'Create Only'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Warehouse:</span>{' '}
                <span className="font-medium">{currentRun.warehouse?.name || 'All'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Duration:</span>{' '}
                <span className="font-medium">
                  {currentRun.finished_at
                    ? `${Math.round((new Date(currentRun.finished_at).getTime() - new Date(currentRun.started_at).getTime()) / 1000)}s`
                    : 'In progress'}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results by suite */}
        <Card>
          <CardHeader>
            <CardTitle>Test Results</CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" className="w-full">
              {Object.entries(resultsBySuite).map(([suite, results]) => {
                const passCount = results.filter(r => r.status === 'pass').length;
                const failCount = results.filter(r => r.status === 'fail').length;
                const skipCount = results.filter(r => r.status === 'skip').length;
                const suiteInfo = TEST_SUITES.find(s => s.id === suite);

                return (
                  <AccordionItem key={suite} value={suite}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-3 flex-1">
                        <MaterialIcon name={suiteInfo?.icon || 'folder'} size="sm" className="text-muted-foreground" />
                        <span className="font-medium">{suiteInfo?.name || suite}</span>
                        <div className="flex items-center gap-2 ml-auto mr-4">
                          {passCount > 0 && (
                            <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                              {passCount} pass
                            </Badge>
                          )}
                          {failCount > 0 && (
                            <Badge variant="destructive">
                              {failCount} fail
                            </Badge>
                          )}
                          {skipCount > 0 && (
                            <Badge variant="outline">
                              {skipCount} skip
                            </Badge>
                          )}
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-2 pl-8">
                        {results.map(result => (
                          <div
                            key={result.id}
                            className={cn(
                              "flex items-center justify-between p-3 rounded-lg border",
                              result.status === 'fail' && "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/50",
                              result.status === 'pass' && "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/50",
                              result.status === 'skip' && "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50"
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <StatusBadge status={result.status} />
                              <span className="font-medium">{result.test_name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {result.error_message && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setSelectedResult(result)}
                                >
                                  <MaterialIcon name="info" size="sm" className="mr-1" />
                                  Details
                                </Button>
                              )}
                              {result.status === 'fail' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleCopyFixPrompt(result)}
                                >
                                  <MaterialIcon name="content_copy" size="sm" className="mr-1" />
                                  Copy Fix Prompt
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </CardContent>
        </Card>

        {/* Result details dialog */}
        <Dialog open={!!selectedResult} onOpenChange={() => setSelectedResult(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{selectedResult?.test_name}</DialogTitle>
              <DialogDescription>
                Suite: {selectedResult?.suite}
              </DialogDescription>
            </DialogHeader>
            {selectedResult && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <StatusBadge status={selectedResult.status} />
                  {selectedResult.started_at && selectedResult.finished_at && (
                    <span className="text-sm text-muted-foreground">
                      Duration: {Math.round((new Date(selectedResult.finished_at).getTime() - new Date(selectedResult.started_at).getTime()) / 1000)}s
                    </span>
                  )}
                </div>

                {selectedResult.error_message && (
                  <div>
                    <Label className="text-muted-foreground">Error Message</Label>
                    <pre className="mt-1 p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-lg text-sm overflow-x-auto">
                      {selectedResult.error_message}
                    </pre>
                  </div>
                )}

                {selectedResult.error_stack && (
                  <div>
                    <Label className="text-muted-foreground">Stack Trace</Label>
                    <pre className="mt-1 p-3 bg-muted rounded-lg text-xs overflow-x-auto max-h-48">
                      {selectedResult.error_stack}
                    </pre>
                  </div>
                )}

                {selectedResult.details && Object.keys(selectedResult.details).length > 0 && (
                  <div>
                    <Label className="text-muted-foreground">Details</Label>
                    <pre className="mt-1 p-3 bg-muted rounded-lg text-sm overflow-x-auto">
                      {JSON.stringify(selectedResult.details, null, 2)}
                    </pre>
                  </div>
                )}

                {selectedResult.entity_ids && Object.keys(selectedResult.entity_ids).length > 0 && (
                  <div>
                    <Label className="text-muted-foreground">Entity IDs</Label>
                    <pre className="mt-1 p-3 bg-muted rounded-lg text-sm overflow-x-auto">
                      {JSON.stringify(selectedResult.entity_ids, null, 2)}
                    </pre>
                  </div>
                )}

                {selectedResult.status === 'fail' && (
                  <Button
                    className="w-full"
                    onClick={() => {
                      setSelectedResult(null);
                      handleCopyFixPrompt(selectedResult);
                    }}
                  >
                    <MaterialIcon name="content_copy" size="sm" className="mr-2" />
                    Copy Fix Prompt
                  </Button>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Fix prompt dialog */}
        <Dialog open={fixPromptDialogOpen} onOpenChange={setFixPromptDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle>Fix Prompt</DialogTitle>
              <DialogDescription>
                Copy this prompt and paste it to Claude/Lovable to help fix the issue
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="h-[400px] w-full rounded-md border p-4">
              <pre className="text-sm whitespace-pre-wrap">{fixPrompt}</pre>
            </ScrollArea>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setFixPromptDialogOpen(false)}>
                Close
              </Button>
              <Button onClick={handleCopyToClipboard}>
                <MaterialIcon name="content_copy" size="sm" className="mr-2" />
                Copy to Clipboard
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="history" size="md" />
              Test Run History
            </CardTitle>
            <CardDescription>
              View results from previous test runs
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => fetchRuns()} disabled={loading}>
            <MaterialIcon name="refresh" size="sm" className={cn("mr-2", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && runs.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
          </div>
        ) : runs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <MaterialIcon name="science" size="lg" className="mx-auto mb-2 opacity-50" />
            <p>No test runs yet</p>
            <p className="text-sm">Run some tests to see results here</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Results</TableHead>
                <TableHead>Executed By</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map(run => (
                <TableRow key={run.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">
                        {new Date(run.started_at).toLocaleDateString()}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {new Date(run.started_at).toLocaleTimeString()}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={run.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="text-green-600 font-medium">{run.pass_count}</span>
                      <span className="text-muted-foreground">/</span>
                      <span className="text-red-600 font-medium">{run.fail_count}</span>
                      <span className="text-muted-foreground">/</span>
                      <span className="text-gray-600">{run.skip_count}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {run.executed_by_user
                      ? `${run.executed_by_user.first_name || ''} ${run.executed_by_user.last_name || ''}`.trim() || run.executed_by_user.email
                      : 'Unknown'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {run.mode === 'create_cleanup' ? 'Cleanup' : 'Keep'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleViewRun(run)}
                      >
                        <MaterialIcon name="visibility" size="sm" className="mr-1" />
                        View
                      </Button>
                      {run.mode === 'create_only' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => cleanupRun(run.id)}
                        >
                          <MaterialIcon name="delete_sweep" size="sm" className="mr-1" />
                          Cleanup
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// UI Visual QA Results Tab
// =============================================================================

/**
 * Error codes for UI Visual QA failures (must match qa/ui/tours.ts)
 */
const ERROR_CODES = {
  SCROLL_LOCKED: 'SCROLL_LOCKED',
  INSUFFICIENT_SCROLL_BUFFER: 'INSUFFICIENT_SCROLL_BUFFER',
  PRIMARY_ACTION_NOT_REACHABLE: 'PRIMARY_ACTION_NOT_REACHABLE',
  HORIZONTAL_OVERFLOW: 'HORIZONTAL_OVERFLOW',
  BLANK_CONTENT: 'BLANK_CONTENT',
  CONSOLE_ERROR: 'CONSOLE_ERROR',
  UNCAUGHT_EXCEPTION: 'UNCAUGHT_EXCEPTION',
  NETWORK_FAILURE: 'NETWORK_FAILURE',
  AXE_CRITICAL: 'AXE_CRITICAL',
  AXE_SERIOUS: 'AXE_SERIOUS',
  TOUR_STEP_FAILED: 'TOUR_STEP_FAILED',
} as const;

type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

const ERROR_CODE_LABELS: Record<ErrorCode, string> = {
  SCROLL_LOCKED: 'Scroll Locked',
  INSUFFICIENT_SCROLL_BUFFER: 'Insufficient Buffer',
  PRIMARY_ACTION_NOT_REACHABLE: 'Action Not Reachable',
  HORIZONTAL_OVERFLOW: 'Horizontal Overflow',
  BLANK_CONTENT: 'Blank Content',
  CONSOLE_ERROR: 'Console Error',
  UNCAUGHT_EXCEPTION: 'Uncaught Exception',
  NETWORK_FAILURE: 'Network Failure',
  AXE_CRITICAL: 'A11y Critical',
  AXE_SERIOUS: 'A11y Serious',
  TOUR_STEP_FAILED: 'Tour Step Failed',
};

interface UIIssue {
  code: ErrorCode;
  message: string;
  selector?: string;
  measuredValue?: number;
  expectedValue?: number;
  screenshot?: string;
}

interface UISuggestion {
  type: 'contrast' | 'tap_target' | 'spacing' | 'sticky_footer' | 'layout';
  message: string;
  selector?: string;
  priority: 'low' | 'medium' | 'high';
}

interface UIVisualResult {
  id: string;
  test_name: string;
  route: string;
  viewport: string;
  status: 'pass' | 'fail' | 'skip';
  error_message?: string;
  details?: {
    issues: UIIssue[];
    suggestions: UISuggestion[];
    overflow: boolean;
    scrollable: boolean;
    scrollBufferPx?: number;
    primaryActionReachable?: boolean;
    consoleErrors: string[];
    exceptions: string[];
    networkFailures: string[];
    axeViolations: { id: string; impact: string; description: string; nodes: number }[];
    artifacts: string[];
    tourSteps: { step: string; action: string; status: string; error?: string; screenshot?: string }[];
    fileHints: string[];
  };
}

interface TourCoverageData {
  totalRoutes: number;
  routesWithTours: number;
  routesWithoutTours: string[];
  missingTestIds: { selector: string; route: string; count: number }[];
  skippedSteps: { route: string; step: string; reason: string }[];
  coveragePercent: number;
  p0Count?: number;
  p1Count?: number;
  p2Count?: number;
}

interface SelectableIssue {
  id: string;
  runId: string;
  route: string;
  viewport: string;
  testName: string;
  priority: string;
  issue: UIIssue;
  fileHints: string[];
  screenshot?: string;
}

function UIVisualResultsTab() {
  const { runs, fetchRuns, fetchRunResults, currentRun, currentResults, loading, clearCurrentRun } = useQATests();
  const [selectedViewport, setSelectedViewport] = useState<string>('all');
  const [showCoverage, setShowCoverage] = useState(false);
  const [expandedRoute, setExpandedRoute] = useState<string | null>(null);
  const [selectedErrorCode, setSelectedErrorCode] = useState<string>('all');
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());
  const [showBulkFixDialog, setShowBulkFixDialog] = useState(false);
  const [bulkFixPrompt, setBulkFixPrompt] = useState('');

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // Extract all selectable issues from results
  const extractSelectableIssues = (): SelectableIssue[] => {
    const issues: SelectableIssue[] = [];
    const testResults = currentResults.filter(r => r.suite === 'ui_visual_qa' && r.test_name !== 'tour_coverage');

    testResults.forEach(result => {
      const details = result.details as UIVisualResult['details'];
      if (details?.issues && details.issues.length > 0) {
        const priority = result.test_name.match(/^\[(P\d)\]/)?.[1] || 'P2';
        const route = result.test_name.replace(/^\[P\d\]\s*/, '').split(' (')[0];
        const viewport = result.test_name.match(/\((\w+)\)$/)?.[1] || 'unknown';

        details.issues.forEach((issue, idx) => {
          issues.push({
            id: `${result.id}-${idx}`,
            runId: currentRun?.id || '',
            route,
            viewport,
            testName: result.test_name,
            priority,
            issue,
            fileHints: details.fileHints || [],
            screenshot: details.artifacts?.[0],
          });
        });
      }
    });

    return issues;
  };

  const allSelectableIssues = extractSelectableIssues();

  // Filter issues by error code
  const filteredIssues = selectedErrorCode === 'all'
    ? allSelectableIssues
    : allSelectableIssues.filter(si => si.issue.code === selectedErrorCode);

  // Get unique error codes present in results
  const uniqueErrorCodes = [...new Set(allSelectableIssues.map(si => si.issue.code))];

  // Selection handlers
  const handleSelectIssue = (issueId: string) => {
    setSelectedIssues(prev => {
      const newSet = new Set(prev);
      if (newSet.has(issueId)) {
        newSet.delete(issueId);
      } else {
        newSet.add(issueId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    const filteredIds = filteredIssues.map(i => i.id);
    setSelectedIssues(new Set(filteredIds));
  };

  const handleSelectNone = () => {
    setSelectedIssues(new Set());
  };

  // Generate bulk fix prompt
  const generateBulkFixPrompt = () => {
    const selected = allSelectableIssues.filter(si => selectedIssues.has(si.id));
    if (selected.length === 0) return;

    const lines: string[] = [
      '# UI Visual QA - Bulk Fix Request',
      '',
      `**Run ID:** ${currentRun?.id || 'unknown'}`,
      `**Total Issues:** ${selected.length}`,
      `**Generated:** ${new Date().toISOString()}`,
      '',
      '---',
      '',
    ];

    // Group by error code for organization
    const byErrorCode = selected.reduce((acc, si) => {
      if (!acc[si.issue.code]) acc[si.issue.code] = [];
      acc[si.issue.code].push(si);
      return acc;
    }, {} as Record<string, SelectableIssue[]>);

    Object.entries(byErrorCode).forEach(([code, issues]) => {
      lines.push(`## ${ERROR_CODE_LABELS[code as ErrorCode] || code} (${issues.length} issues)`);
      lines.push('');

      issues.forEach((si, idx) => {
        lines.push(`### Issue ${idx + 1}: ${si.route} (${si.viewport})`);
        lines.push('');
        lines.push(`- **Suite:** ui_visual_qa`);
        lines.push(`- **Route:** \`${si.route}\``);
        lines.push(`- **Viewport:** ${si.viewport}`);
        lines.push(`- **Priority:** ${si.priority}`);
        lines.push(`- **Error Code:** \`${si.issue.code}\``);
        lines.push(`- **Message:** ${si.issue.message}`);

        if (si.issue.selector) {
          lines.push(`- **Selector:** \`${si.issue.selector}\``);
        }
        if (si.issue.measuredValue !== undefined) {
          lines.push(`- **Measured Value:** ${si.issue.measuredValue}px`);
        }
        if (si.issue.expectedValue !== undefined) {
          lines.push(`- **Expected Value:** ${si.issue.expectedValue}px`);
        }
        if (si.screenshot) {
          lines.push(`- **Screenshot:** \`${si.screenshot}\``);
        }
        if (si.fileHints.length > 0) {
          lines.push(`- **Files to check:**`);
          si.fileHints.forEach(f => lines.push(`  - \`${f}\``));
        }
        lines.push('');
      });
    });

    lines.push('---');
    lines.push('');
    lines.push('## How to Fix');
    lines.push('');
    lines.push('Please analyze each issue above and provide fixes. For each fix:');
    lines.push('1. Identify the root cause');
    lines.push('2. Provide the code changes needed');
    lines.push('3. Explain how the fix addresses the issue');
    lines.push('');
    lines.push('### Common Fixes by Error Code:');
    lines.push('');
    lines.push('- **SCROLL_LOCKED**: Check for `overflow: hidden` or missing scroll containers');
    lines.push('- **INSUFFICIENT_SCROLL_BUFFER**: Add padding-bottom (80-120px) or use sticky footer');
    lines.push('- **HORIZONTAL_OVERFLOW**: Add `overflow-x: auto` or fix fixed-width elements');
    lines.push('- **CONSOLE_ERROR**: Debug the JavaScript error in browser console');
    lines.push('- **AXE_CRITICAL/AXE_SERIOUS**: Fix accessibility issues (missing labels, contrast, etc.)');
    lines.push('- **TOUR_STEP_FAILED**: Add missing data-testid attributes');

    setBulkFixPrompt(lines.join('\n'));
    setShowBulkFixDialog(true);
  };

  const handleCopyBulkPrompt = async () => {
    try {
      await navigator.clipboard.writeText(bulkFixPrompt);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = bulkFixPrompt;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
  };

  const handleDownloadPrompt = () => {
    const blob = new Blob([bulkFixPrompt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ui-qa-fix-prompt-${currentRun?.id?.slice(0, 8) || 'unknown'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Filter for UI visual QA runs
  const visualRuns = runs.filter(run =>
    run.suites_requested?.includes('ui_visual_qa') ||
    run.metadata?.viewports
  );

  // Filter current results for UI visual QA
  const visualResults = currentResults.filter(r => r.suite === 'ui_visual_qa');
  const coverageResult = visualResults.find(r => r.test_name === 'tour_coverage');
  const testResults = visualResults.filter(r => r.test_name !== 'tour_coverage');

  // Group by route
  const resultsByRoute = testResults.reduce((acc, result) => {
    const route = (result.details as any)?.route || result.test_name.split(' (')[0];
    if (!acc[route]) acc[route] = [];
    acc[route].push(result);
    return acc;
  }, {} as Record<string, typeof testResults>);

  // Filter by viewport
  const filteredRoutes = selectedViewport === 'all'
    ? resultsByRoute
    : Object.fromEntries(
        Object.entries(resultsByRoute).map(([route, results]) => [
          route,
          results.filter(r => r.test_name.includes(`(${selectedViewport})`))
        ]).filter(([_, results]) => results.length > 0)
      );

  const coverageData = coverageResult?.details as unknown as TourCoverageData | undefined;

  if (currentRun && visualResults.length > 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={clearCurrentRun}>
            <MaterialIcon name="arrow_back" size="sm" className="mr-2" />
            Back to Runs
          </Button>
        </div>

        {/* Run Summary */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  UI Visual QA Results
                  <StatusBadge status={currentRun.status} />
                </CardTitle>
                <CardDescription>
                  Run ID: {currentRun.id.slice(0, 8)}... | {new Date(currentRun.started_at).toLocaleString()}
                </CardDescription>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {testResults.filter(r => r.status === 'pass').length}
                  </div>
                  <div className="text-xs text-muted-foreground">Passed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">
                    {testResults.filter(r => r.status === 'fail').length}
                  </div>
                  <div className="text-xs text-muted-foreground">Failed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-600">
                    {testResults.filter(r => r.status === 'skip').length}
                  </div>
                  <div className="text-xs text-muted-foreground">Skipped</div>
                </div>
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Tour Coverage Card */}
        {coverageData && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <MaterialIcon name="coverage" size="md" />
                  Tour Coverage Report
                </CardTitle>
                <Button variant="outline" size="sm" onClick={() => setShowCoverage(!showCoverage)}>
                  {showCoverage ? 'Hide Details' : 'Show Details'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-4 lg:grid-cols-7 mb-4">
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-3xl font-bold text-primary">{coverageData.coveragePercent}%</div>
                  <div className="text-sm text-muted-foreground">Coverage</div>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-3xl font-bold">{coverageData.routesWithTours}</div>
                  <div className="text-sm text-muted-foreground">Routes with Tours</div>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-3xl font-bold">{coverageData.totalRoutes}</div>
                  <div className="text-sm text-muted-foreground">Total Routes</div>
                </div>
                <div className="text-center p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-lg">
                  <div className="text-3xl font-bold text-red-600">{coverageData.p0Count || 0}</div>
                  <div className="text-sm text-muted-foreground">P0 (Critical)</div>
                </div>
                <div className="text-center p-4 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-lg">
                  <div className="text-3xl font-bold text-amber-600">{coverageData.p1Count || 0}</div>
                  <div className="text-sm text-muted-foreground">P1 (Important)</div>
                </div>
                <div className="text-center p-4 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg">
                  <div className="text-3xl font-bold text-gray-600">{coverageData.p2Count || 0}</div>
                  <div className="text-sm text-muted-foreground">P2 (Info)</div>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-3xl font-bold text-amber-600">{coverageData.missingTestIds?.length || 0}</div>
                  <div className="text-sm text-muted-foreground">Missing TestIDs</div>
                </div>
              </div>

              {showCoverage && (
                <div className="space-y-4 mt-4">
                  {coverageData.routesWithoutTours?.length > 0 && (
                    <div>
                      <Label className="text-muted-foreground">Routes Without Tours</Label>
                      <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-lg">
                        <div className="flex flex-wrap gap-2">
                          {coverageData.routesWithoutTours.slice(0, 20).map(route => (
                            <Badge key={route} variant="outline">{route}</Badge>
                          ))}
                          {coverageData.routesWithoutTours.length > 20 && (
                            <Badge variant="secondary">+{coverageData.routesWithoutTours.length - 20} more</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {coverageData.missingTestIds?.length > 0 && (
                    <div>
                      <Label className="text-muted-foreground">Missing TestIDs (Top 20)</Label>
                      <div className="mt-2">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Selector</TableHead>
                              <TableHead>Route</TableHead>
                              <TableHead>Occurrences</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {coverageData.missingTestIds.slice(0, 20).map((item, idx) => (
                              <TableRow key={idx}>
                                <TableCell className="font-mono text-sm">{item.selector}</TableCell>
                                <TableCell>{item.route}</TableCell>
                                <TableCell>{item.count}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Issues Selection & Bulk Fix Card */}
        {allSelectableIssues.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <MaterialIcon name="error_outline" size="md" />
                  Issues ({allSelectableIssues.length})
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSelectAll}
                    disabled={filteredIssues.length === 0}
                  >
                    Select All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSelectNone}
                    disabled={selectedIssues.size === 0}
                  >
                    Select None
                  </Button>
                  <Button
                    size="sm"
                    onClick={generateBulkFixPrompt}
                    disabled={selectedIssues.size === 0}
                  >
                    <MaterialIcon name="auto_fix_high" size="sm" className="mr-2" />
                    Generate Fix Prompt ({selectedIssues.size})
                  </Button>
                </div>
              </div>
              <CardDescription>
                Select issues to generate a combined fix prompt for Claude/Lovable
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Filters */}
              <div className="flex items-center gap-4 mb-4">
                <div className="flex items-center gap-2">
                  <Label>Filter by Error Code:</Label>
                  <Select value={selectedErrorCode} onValueChange={setSelectedErrorCode}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Error Codes ({allSelectableIssues.length})</SelectItem>
                      {uniqueErrorCodes.map(code => (
                        <SelectItem key={code} value={code}>
                          {ERROR_CODE_LABELS[code] || code} ({allSelectableIssues.filter(i => i.issue.code === code).length})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Label>Filter by Viewport:</Label>
                  <Select value={selectedViewport} onValueChange={setSelectedViewport}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Viewports</SelectItem>
                      <SelectItem value="desktop">Desktop</SelectItem>
                      <SelectItem value="tablet">Tablet</SelectItem>
                      <SelectItem value="mobile">Mobile</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Issues Table */}
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={filteredIssues.length > 0 && filteredIssues.every(i => selectedIssues.has(i.id))}
                          onCheckedChange={(checked) => {
                            if (checked) handleSelectAll();
                            else handleSelectNone();
                          }}
                        />
                      </TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Error Code</TableHead>
                      <TableHead>Route</TableHead>
                      <TableHead>Viewport</TableHead>
                      <TableHead>Message</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredIssues.slice(0, 50).map(si => (
                      <TableRow
                        key={si.id}
                        className={cn(
                          selectedIssues.has(si.id) && "bg-primary/5",
                          si.priority === 'P0' && "border-l-4 border-l-red-500",
                          si.priority === 'P1' && "border-l-4 border-l-amber-500",
                          si.priority === 'P2' && "border-l-4 border-l-gray-300"
                        )}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedIssues.has(si.id)}
                            onCheckedChange={() => handleSelectIssue(si.id)}
                          />
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={si.priority === 'P0' ? 'destructive' : si.priority === 'P1' ? 'default' : 'outline'}
                          >
                            {si.priority}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="font-mono text-xs">
                            {si.issue.code}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{si.route}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{si.viewport}</Badge>
                        </TableCell>
                        <TableCell className="max-w-xs truncate" title={si.issue.message}>
                          {si.issue.message}
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredIssues.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No issues found matching the selected filters
                        </TableCell>
                      </TableRow>
                    )}
                    {filteredIssues.length > 50 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-2 text-muted-foreground text-sm">
                          Showing first 50 of {filteredIssues.length} issues
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Bulk Fix Prompt Dialog */}
        <Dialog open={showBulkFixDialog} onOpenChange={setShowBulkFixDialog}>
          <DialogContent className="max-w-4xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MaterialIcon name="auto_fix_high" size="md" />
                Bulk Fix Prompt
              </DialogTitle>
              <DialogDescription>
                Copy this prompt and paste it to Claude/Lovable to fix {selectedIssues.size} selected issue(s)
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="h-[400px] w-full rounded-md border p-4">
              <pre className="text-sm whitespace-pre-wrap font-mono">{bulkFixPrompt}</pre>
            </ScrollArea>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleDownloadPrompt}>
                <MaterialIcon name="download" size="sm" className="mr-2" />
                Download as .txt
              </Button>
              <Button variant="outline" onClick={() => setShowBulkFixDialog(false)}>
                Close
              </Button>
              <Button onClick={handleCopyBulkPrompt}>
                <MaterialIcon name="content_copy" size="sm" className="mr-2" />
                Copy to Clipboard
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Results by Route */}
        <Card>
          <CardHeader>
            <CardTitle>Test Results by Route</CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible className="w-full">
              {Object.entries(filteredRoutes).map(([route, results]) => {
                const resultsArray = results as any[];
                const passCount = resultsArray.filter(r => r.status === 'pass').length;
                const failCount = resultsArray.filter(r => r.status === 'fail').length;
                const hasFailures = failCount > 0;

                return (
                  <AccordionItem key={route} value={route}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-3 flex-1">
                        <MaterialIcon
                          name={hasFailures ? 'error' : 'check_circle'}
                          size="sm"
                          className={hasFailures ? 'text-red-500' : 'text-green-500'}
                        />
                        <span className="font-mono text-sm">{route}</span>
                        <div className="flex items-center gap-2 ml-auto mr-4">
                          {passCount > 0 && (
                            <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                              {passCount} pass
                            </Badge>
                          )}
                          {failCount > 0 && (
                            <Badge variant="destructive">{failCount} fail</Badge>
                          )}
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3 pl-8">
                        {resultsArray.map((result: any) => {
                          const details = result.details as UIVisualResult['details'];
                          const priority = result.test_name.match(/^\[(P\d)\]/)?.[1] || 'P2';
                          return (
                            <div
                              key={result.id}
                              className={cn(
                                "p-4 rounded-lg border",
                                result.status === 'fail' && "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/50",
                                result.status === 'pass' && "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/50",
                                priority === 'P0' && "border-l-4 border-l-red-500",
                                priority === 'P1' && "border-l-4 border-l-amber-500"
                              )}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <Badge
                                    variant={priority === 'P0' ? 'destructive' : priority === 'P1' ? 'default' : 'outline'}
                                    className="text-xs"
                                  >
                                    {priority}
                                  </Badge>
                                  <StatusBadge status={result.status} />
                                  <span className="font-medium">{result.test_name.replace(/^\[P\d\]\s*/, '')}</span>
                                </div>
                              </div>

                              {/* Issues */}
                              {details?.issues && details.issues.length > 0 && (
                                <div className="mb-2">
                                  <div className="flex flex-wrap gap-1 mb-2">
                                    {details.issues.map((issue, idx) => (
                                      <Badge key={idx} variant="secondary" className="font-mono text-xs">
                                        {issue.code}
                                      </Badge>
                                    ))}
                                  </div>
                                  {details.issues.map((issue, idx) => (
                                    <div key={idx} className="text-sm text-red-600 flex items-start gap-2">
                                      <MaterialIcon name="error" size="sm" className="mt-0.5 flex-shrink-0" />
                                      <span>{issue.message}</span>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Scroll/Buffer info */}
                              {details?.scrollBufferPx !== undefined && (
                                <div className={cn(
                                  "text-sm flex items-center gap-2 mb-2",
                                  details.scrollBufferPx < 80 ? "text-red-600" : "text-green-600"
                                )}>
                                  <MaterialIcon name={details.scrollBufferPx < 80 ? "warning" : "check_circle"} size="sm" />
                                  Scroll buffer: {details.scrollBufferPx}px {details.scrollBufferPx < 80 && "(min 80px required)"}
                                </div>
                              )}

                              {/* Suggestions (advisory) */}
                              {details?.suggestions && details.suggestions.length > 0 && (
                                <div className="mb-2 p-2 bg-blue-50 dark:bg-blue-950/50 rounded border border-blue-200 dark:border-blue-800">
                                  <div className="text-xs font-medium text-blue-700 mb-1">Suggestions (advisory)</div>
                                  {details.suggestions.map((s, idx) => (
                                    <div key={idx} className="text-sm text-blue-600 flex items-start gap-2">
                                      <MaterialIcon name="lightbulb" size="sm" className="mt-0.5 flex-shrink-0" />
                                      <span>{s.message}</span>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {details && (
                                <div className="grid gap-2 text-sm">
                                  {details.overflow && (
                                    <div className="flex items-center gap-2 text-red-600">
                                      <MaterialIcon name="warning" size="sm" />
                                      Horizontal overflow detected
                                    </div>
                                  )}
                                  {details.consoleErrors?.length > 0 && (
                                    <div className="flex items-center gap-2 text-red-600">
                                      <MaterialIcon name="error" size="sm" />
                                      {details.consoleErrors.length} console error(s)
                                    </div>
                                  )}
                                  {details.axeViolations?.length > 0 && (
                                    <div className="flex items-center gap-2 text-amber-600">
                                      <MaterialIcon name="accessibility" size="sm" />
                                      {details.axeViolations.length} accessibility violation(s)
                                    </div>
                                  )}
                                  {details.artifacts?.length > 0 && (
                                    <div className="flex items-center gap-2 text-muted-foreground">
                                      <MaterialIcon name="image" size="sm" />
                                      {details.artifacts.length} screenshot(s)
                                    </div>
                                  )}
                                  {details.fileHints?.length > 0 && (
                                    <div className="mt-2">
                                      <span className="text-muted-foreground">Files to check: </span>
                                      <span className="font-mono text-xs">{details.fileHints.join(', ')}</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </CardContent>
        </Card>
      </div>
    );
  }

  // List of UI Visual QA runs
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="screenshot_monitor" size="md" />
              UI Visual QA Runs
            </CardTitle>
            <CardDescription>
              View visual regression test results and screenshots
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => fetchRuns()} disabled={loading}>
            <MaterialIcon name="refresh" size="sm" className={cn("mr-2", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && visualRuns.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
          </div>
        ) : visualRuns.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <MaterialIcon name="screenshot_monitor" size="lg" className="mx-auto mb-2 opacity-50" />
            <p>No UI Visual QA runs yet</p>
            <p className="text-sm">Run the UI Visual QA workflow from GitHub Actions</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Viewports</TableHead>
                <TableHead>Results</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visualRuns.map(run => (
                <TableRow key={run.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">
                        {new Date(run.started_at).toLocaleDateString()}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {new Date(run.started_at).toLocaleTimeString()}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={run.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {((run.metadata as any)?.viewports || ['desktop', 'tablet', 'mobile']).map((vp: string) => (
                        <Badge key={vp} variant="outline" className="text-xs">
                          {vp}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="text-green-600 font-medium">{run.pass_count}</span>
                      <span className="text-muted-foreground">/</span>
                      <span className="text-red-600 font-medium">{run.fail_count}</span>
                      <span className="text-muted-foreground">/</span>
                      <span className="text-gray-600">{run.skip_count}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => fetchRunResults(run.id)}
                    >
                      <MaterialIcon name="visibility" size="sm" className="mr-1" />
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function QATestConsoleTab() {
  const [activeTab, setActiveTab] = useState('run');
  const qa = useQATests();

  const handleRunCompleted = async (runId: string) => {
    setActiveTab('results');
    await qa.fetchRunResults(runId);
  };

  return (
    <div className="space-y-6" data-testid="settings-qa-console">
      <div>
        <h3 className="text-lg font-medium flex items-center gap-2">
          <MaterialIcon name="bug_report" size="md" />
          QA Test Console
        </h3>
        <p className="text-sm text-muted-foreground">
          Run automated end-to-end system tests and view results
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="qa-console-tabs">
        <TabsList>
          <TabsTrigger value="run" className="flex items-center gap-2" data-testid="qa-tab-run">
            <MaterialIcon name="play_circle" size="sm" />
            Run Tests
          </TabsTrigger>
          <TabsTrigger value="results" className="flex items-center gap-2" data-testid="qa-tab-results">
            <MaterialIcon name="checklist" size="sm" />
            Error Results
          </TabsTrigger>
          <TabsTrigger value="visual" className="flex items-center gap-2" data-testid="qa-tab-visual">
            <MaterialIcon name="screenshot_monitor" size="sm" />
            UI Visual QA
          </TabsTrigger>
        </TabsList>

        <TabsContent value="run" className="mt-6">
          <RunTestsTab qa={qa} onRunCompleted={handleRunCompleted} />
        </TabsContent>

        <TabsContent value="results" className="mt-6">
          <ErrorResultsTab qa={qa} />
        </TabsContent>

        <TabsContent value="visual" className="mt-6">
          <UIVisualResultsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
