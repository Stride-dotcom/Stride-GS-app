import { useState, useEffect, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { useAdminDev } from '@/hooks/useAdminDev';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useQATests, QATestRun, QATestResult } from '@/hooks/useQATests';
import { supabase } from '@/integrations/supabase/client';
import { QATestConsoleTab } from '@/components/settings/QATestConsoleTab';
import { cn } from '@/lib/utils';
import { BackToDevConsoleButton } from '@/components/admin/BackToDevConsoleButton';

// Note: BotQAPage and DiagnosticsPage are accessed via navigation links, not embedded

// =============================================================================
// Types
// =============================================================================

interface QASuiteStatus {
  suite: string;
  label: string;
  icon: string;
  lastRun?: QATestRun | null;
  loading: boolean;
}

// Error codes for UI Visual QA failures
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

/** Short one-line explanation of each error code for the fix prompt */
function getErrorCodeExplanation(code: string): string {
  const explanations: Record<string, string> = {
    SCROLL_LOCKED: 'The page content cannot be scrolled — the primary action button may be unreachable.',
    INSUFFICIENT_SCROLL_BUFFER: 'Not enough padding below the last interactive element — buttons may be cut off or hidden behind fixed footers.',
    PRIMARY_ACTION_NOT_REACHABLE: 'The main Save/Submit/Complete button is not visible or scrollable to within the viewport.',
    HORIZONTAL_OVERFLOW: 'The page content extends horizontally beyond the viewport width, causing a horizontal scrollbar.',
    BLANK_CONTENT: 'The page loaded but the main content area appears empty — data may not be loading.',
    CONSOLE_ERROR: 'JavaScript errors were logged to the browser console during the page visit.',
    UNCAUGHT_EXCEPTION: 'An unhandled runtime exception crashed or disrupted the page.',
    NETWORK_FAILURE: 'One or more API/network requests failed during the page load or interaction.',
    AXE_CRITICAL: 'Critical WCAG accessibility violations were found — these block users with assistive technology.',
    AXE_SERIOUS: 'Serious WCAG accessibility violations were found — these significantly hinder accessibility.',
    TOUR_STEP_FAILED: 'A scripted UI interaction (click, fill, assert) failed — usually a missing element or testid.',
  };
  return explanations[code] || 'An issue was detected during testing.';
}

interface UIIssue {
  code: ErrorCode;
  message: string;
  selector?: string;
  measuredValue?: number;
  expectedValue?: number;
  screenshot?: string;
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
  // Rich context for AI fix prompts
  consoleErrors?: string[];
  exceptions?: string[];
  networkFailures?: string[];
  failedTourSteps?: { step: string; action: string; status: string; error?: string }[];
  axeViolations?: { id: string; impact: string; description: string; nodes: number }[];
  scrollBufferPx?: number;
  overflow?: boolean;
  routeDescription?: string;
}

// =============================================================================
// Heuristic Suggestions Types & Generator
// =============================================================================

interface HeuristicSuggestion {
  id: string;
  category: 'accessibility' | 'layout' | 'scrolling' | 'mobile' | 'performance' | 'general';
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  affectedRoutes: string[];
  affectedViewports: string[];
  recommendation: string;
}

interface AISuggestion {
  route: string;
  viewport: string;
  category: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
  recommendation: string;
}

interface UIAIReview {
  id: string;
  run_id: string;
  created_at: string;
  created_by: string;
  summary: string;
  suggestions: AISuggestion[];
  status: 'pending' | 'completed' | 'failed';
  error?: string;
}

const SUGGESTION_CATEGORIES: Record<string, { label: string; icon: string; color: string }> = {
  accessibility: { label: 'Accessibility', icon: 'accessibility', color: 'text-purple-600' },
  layout: { label: 'Layout', icon: 'view_quilt', color: 'text-blue-600' },
  scrolling: { label: 'Scrolling', icon: 'swap_vert', color: 'text-amber-600' },
  mobile: { label: 'Mobile', icon: 'phone_android', color: 'text-green-600' },
  performance: { label: 'Performance', icon: 'speed', color: 'text-red-600' },
  general: { label: 'General', icon: 'lightbulb', color: 'text-gray-600' },
};

/**
 * Generate heuristic suggestions from test results.
 * Prefers existing suggestions from qa_test_results.details.suggestions[]
 * Falls back to generating suggestions from failure signals.
 */
function generateHeuristicSuggestions(results: QATestResult[]): HeuristicSuggestion[] {
  const suggestions: HeuristicSuggestion[] = [];
  const suggestionMap = new Map<string, HeuristicSuggestion>();

  // First, collect any existing suggestions from results
  results.forEach(result => {
    const details = result.details as UIVisualResult['details'];
    if (details?.suggestions) {
      details.suggestions.forEach((s, idx) => {
        const key = `existing-${s.type}-${s.message}`;
        if (!suggestionMap.has(key)) {
          const route = result.test_name.replace(/^\[P\d\]\s*/, '').split(' (')[0];
          const viewport = result.test_name.match(/\((\w+)\)$/)?.[1] || 'unknown';
          suggestionMap.set(key, {
            id: `existing-${result.id}-${idx}`,
            category: mapSuggestionType(s.type),
            severity: mapPriority(s.priority),
            title: s.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            description: s.message,
            affectedRoutes: [route],
            affectedViewports: [viewport],
            recommendation: s.message,
          });
        } else {
          const existing = suggestionMap.get(key)!;
          const route = result.test_name.replace(/^\[P\d\]\s*/, '').split(' (')[0];
          const viewport = result.test_name.match(/\((\w+)\)$/)?.[1] || 'unknown';
          if (!existing.affectedRoutes.includes(route)) existing.affectedRoutes.push(route);
          if (!existing.affectedViewports.includes(viewport)) existing.affectedViewports.push(viewport);
        }
      });
    }
  });

  // Generate suggestions from failure signals
  const failedResults = results.filter(r => r.status === 'fail' && r.test_name !== 'tour_coverage');

  // Group failures by error code
  const failuresByCode: Record<string, { routes: Set<string>; viewports: Set<string>; count: number }> = {};
  const mobileFailures: { routes: Set<string>; count: number } = { routes: new Set(), count: 0 };
  const axeViolations: { routes: Set<string>; types: Set<string>; count: number } = { routes: new Set(), types: new Set(), count: 0 };

  failedResults.forEach(result => {
    const details = result.details as UIVisualResult['details'];
    const route = result.test_name.replace(/^\[P\d\]\s*/, '').split(' (')[0];
    const viewport = result.test_name.match(/\((\w+)\)$/)?.[1] || 'unknown';

    if (details?.issues) {
      details.issues.forEach(issue => {
        if (!failuresByCode[issue.code]) {
          failuresByCode[issue.code] = { routes: new Set(), viewports: new Set(), count: 0 };
        }
        failuresByCode[issue.code].routes.add(route);
        failuresByCode[issue.code].viewports.add(viewport);
        failuresByCode[issue.code].count++;
      });
    }

    // Track mobile-specific failures
    if (viewport === 'mobile') {
      mobileFailures.routes.add(route);
      mobileFailures.count++;
    }

    // Track axe violations
    if (details?.axeViolations) {
      details.axeViolations.forEach(v => {
        axeViolations.routes.add(route);
        axeViolations.types.add(v.id);
        axeViolations.count += v.nodes;
      });
    }
  });

  // Generate suggestions based on failure patterns

  // Scroll-related issues
  const scrollCodes = ['SCROLL_LOCKED', 'INSUFFICIENT_SCROLL_BUFFER', 'PRIMARY_ACTION_NOT_REACHABLE'];
  const scrollIssues = scrollCodes.filter(code => failuresByCode[code]);
  if (scrollIssues.length > 0) {
    const routes = new Set<string>();
    const viewports = new Set<string>();
    scrollIssues.forEach(code => {
      failuresByCode[code].routes.forEach(r => routes.add(r));
      failuresByCode[code].viewports.forEach(v => viewports.add(v));
    });

    const key = 'scroll-issues';
    if (!suggestionMap.has(key)) {
      suggestionMap.set(key, {
        id: key,
        category: 'scrolling',
        severity: 'high',
        title: 'Scrolling & Content Accessibility',
        description: `${scrollIssues.length} scroll-related issue type(s) detected across ${routes.size} route(s). Users may not be able to reach important content or actions.`,
        affectedRoutes: Array.from(routes),
        affectedViewports: Array.from(viewports),
        recommendation: 'Review pages for: (1) Remove overflow:hidden or height:100vh traps, (2) Add minimum 80-120px bottom padding, (3) Consider sticky action bars for primary CTAs, (4) Ensure content is scrollable on all viewports.',
      });
    }
  }

  // Horizontal overflow
  if (failuresByCode['HORIZONTAL_OVERFLOW']) {
    const data = failuresByCode['HORIZONTAL_OVERFLOW'];
    const key = 'horizontal-overflow';
    if (!suggestionMap.has(key)) {
      suggestionMap.set(key, {
        id: key,
        category: 'layout',
        severity: 'medium',
        title: 'Horizontal Overflow Issues',
        description: `Horizontal overflow detected on ${data.routes.size} route(s). This causes unwanted horizontal scrolling and poor UX.`,
        affectedRoutes: Array.from(data.routes),
        affectedViewports: Array.from(data.viewports),
        recommendation: 'Check container widths, padding, and fixed-width elements. Use max-width with overflow-x:auto where needed. Review responsive breakpoints for smaller screens.',
      });
    }
  }

  // Accessibility (axe) issues
  if (failuresByCode['AXE_CRITICAL'] || failuresByCode['AXE_SERIOUS'] || axeViolations.count > 0) {
    const criticalData = failuresByCode['AXE_CRITICAL'];
    const seriousData = failuresByCode['AXE_SERIOUS'];
    const routes = new Set<string>();
    const viewports = new Set<string>();

    if (criticalData) {
      criticalData.routes.forEach(r => routes.add(r));
      criticalData.viewports.forEach(v => viewports.add(v));
    }
    if (seriousData) {
      seriousData.routes.forEach(r => routes.add(r));
      seriousData.viewports.forEach(v => viewports.add(v));
    }
    axeViolations.routes.forEach(r => routes.add(r));

    const key = 'accessibility-issues';
    if (!suggestionMap.has(key)) {
      suggestionMap.set(key, {
        id: key,
        category: 'accessibility',
        severity: criticalData ? 'high' : 'medium',
        title: 'Accessibility Violations',
        description: `Accessibility issues found: ${axeViolations.types.size} violation type(s) with ${axeViolations.count} affected element(s) across ${routes.size} route(s).`,
        affectedRoutes: Array.from(routes),
        affectedViewports: Array.from(viewports),
        recommendation: 'Review axe violation details. Common fixes: (1) Add missing labels to form controls, (2) Improve color contrast ratios, (3) Add alt text to images, (4) Ensure interactive elements are keyboard accessible.',
      });
    }
  }

  // Contrast issues (from axe violations)
  const contrastViolations = failedResults.filter(r => {
    const details = r.details as UIVisualResult['details'];
    return details?.axeViolations?.some(v => v.id.includes('contrast'));
  });
  if (contrastViolations.length > 0) {
    const routes = new Set<string>();
    contrastViolations.forEach(r => {
      routes.add(r.test_name.replace(/^\[P\d\]\s*/, '').split(' (')[0]);
    });

    const key = 'contrast-issues';
    if (!suggestionMap.has(key)) {
      suggestionMap.set(key, {
        id: key,
        category: 'accessibility',
        severity: 'medium',
        title: 'Color Contrast Issues',
        description: `Text/background contrast issues on ${routes.size} route(s). Low contrast makes content hard to read for users with visual impairments.`,
        affectedRoutes: Array.from(routes),
        affectedViewports: ['all'],
        recommendation: 'Increase contrast ratios. WCAG AA requires 4.5:1 for normal text and 3:1 for large text. Use tools like WebAIM contrast checker to verify.',
      });
    }
  }

  // Mobile-specific issues
  if (mobileFailures.count >= 3) {
    const key = 'mobile-issues';
    if (!suggestionMap.has(key)) {
      suggestionMap.set(key, {
        id: key,
        category: 'mobile',
        severity: mobileFailures.count >= 5 ? 'high' : 'medium',
        title: 'Mobile Layout Patterns',
        description: `${mobileFailures.count} failure(s) on mobile viewport across ${mobileFailures.routes.size} route(s). Mobile users may have degraded experience.`,
        affectedRoutes: Array.from(mobileFailures.routes),
        affectedViewports: ['mobile'],
        recommendation: 'Review mobile layouts: (1) Ensure touch targets are at least 44x44px, (2) Add adequate spacing between interactive elements, (3) Consider "glove-friendly" design with larger buttons, (4) Test with actual mobile devices.',
      });
    }
  }

  // Console errors
  if (failuresByCode['CONSOLE_ERROR'] || failuresByCode['UNCAUGHT_EXCEPTION']) {
    const errorData = failuresByCode['CONSOLE_ERROR'];
    const exceptionData = failuresByCode['UNCAUGHT_EXCEPTION'];
    const routes = new Set<string>();

    if (errorData) errorData.routes.forEach(r => routes.add(r));
    if (exceptionData) exceptionData.routes.forEach(r => routes.add(r));

    const key = 'js-errors';
    if (!suggestionMap.has(key)) {
      suggestionMap.set(key, {
        id: key,
        category: 'performance',
        severity: exceptionData ? 'high' : 'medium',
        title: 'JavaScript Errors',
        description: `Console errors or uncaught exceptions detected on ${routes.size} route(s). These may cause features to break.`,
        affectedRoutes: Array.from(routes),
        affectedViewports: ['all'],
        recommendation: 'Debug JavaScript errors in browser console. Check for: (1) Undefined variables, (2) API response handling, (3) Missing null checks, (4) Race conditions in async code.',
      });
    }
  }

  return Array.from(suggestionMap.values()).sort((a, b) => {
    const severityOrder = { high: 0, medium: 1, low: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}

function mapSuggestionType(type: string): HeuristicSuggestion['category'] {
  const typeMap: Record<string, HeuristicSuggestion['category']> = {
    contrast: 'accessibility',
    tap_target: 'mobile',
    spacing: 'layout',
    sticky_footer: 'scrolling',
    layout: 'layout',
  };
  return typeMap[type] || 'general';
}

function mapPriority(priority: string): HeuristicSuggestion['severity'] {
  const priorityMap: Record<string, HeuristicSuggestion['severity']> = {
    high: 'high',
    medium: 'medium',
    low: 'low',
  };
  return priorityMap[priority] || 'medium';
}

// =============================================================================
// QA Run Status Panel
// =============================================================================

interface QARunStatusPanelProps {
  onRunUIVisual: () => void;
  onTabChange: (tab: string) => void;
}

function QARunStatusPanel({ onRunUIVisual, onTabChange }: QARunStatusPanelProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [statuses, setStatuses] = useState<QASuiteStatus[]>([
    { suite: 'ui_visual_qa', label: 'UI Visual QA', icon: 'screenshot_monitor', loading: true, lastRun: null },
    { suite: 'workflow_qa', label: 'Workflow QA', icon: 'checklist', loading: true, lastRun: null },
    { suite: 'bot_qa', label: 'Bot QA', icon: 'smart_toy', loading: true, lastRun: null },
  ]);
  const [showRunDialog, setShowRunDialog] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.tenant_id) return;
    fetchLastRuns();
  }, [profile?.tenant_id]);

  const fetchLastRuns = async () => {
    if (!profile?.tenant_id) return;

    try {
      // Fetch last run for each suite type
      const suiteQueries = [
        { suite: 'ui_visual_qa', filter: { column: 'suites_requested', value: 'ui_visual_qa' } },
        { suite: 'workflow_qa', filter: { column: 'mode', value: 'create_cleanup', notMode: 'bot_qa' } },
        { suite: 'bot_qa', filter: { column: 'mode', value: 'bot_qa' } },
      ];

      const results = await Promise.all(
        suiteQueries.map(async ({ suite, filter }) => {
          let query = supabase
            .from('qa_test_runs')
            .select('*')
            .eq('tenant_id', profile.tenant_id)
            .order('started_at', { ascending: false })
            .limit(1);

          if (filter.column === 'suites_requested') {
            query = query.contains('suites_requested', [filter.value]);
          } else if (filter.column === 'mode') {
            query = query.eq('mode', filter.value);
          }

          const { data, error } = await query;
          if (error) throw error;
          return { suite, run: data?.[0] || null };
        })
      );

      setStatuses(prev =>
        prev.map(s => {
          const result = results.find(r => r.suite === s.suite);
          return { ...s, loading: false, lastRun: result?.run || null } as QASuiteStatus;
        })
      );
    } catch (error) {
      console.error('Error fetching last runs:', error);
      setStatuses(prev => prev.map(s => ({ ...s, loading: false })));
    }
  };


  const formatTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays}d ago`;
    if (diffHours > 0) return `${diffHours}h ago`;
    if (diffMins > 0) return `${diffMins}m ago`;
    return 'just now';
  };

  const handleRunClick = (suite: string) => {
    setShowRunDialog(suite);
  };

  const handleViewResults = (suite: string) => {
    if (suite === 'ui_visual_qa') {
      onTabChange('visual');
    } else if (suite === 'workflow_qa') {
      onTabChange('workflow');
    } else if (suite === 'bot_qa') {
      onTabChange('bot');
    }
  };

  return (
    <>
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MaterialIcon name="monitoring" size="sm" />
            QA Run Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {statuses.map(status => (
              <div
                key={status.suite}
                className={cn(
                  "p-4 rounded-lg border transition-colors cursor-pointer hover:bg-muted/50",
                  status.lastRun?.status === 'failed' && "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30",
                  status.lastRun?.status === 'completed' && status.lastRun.fail_count === 0 && "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30"
                )}
                onClick={() => handleViewResults(status.suite)}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <MaterialIcon name={status.icon} size="md" className="text-muted-foreground" />
                    <span className="font-medium">{status.label}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRunClick(status.suite);
                    }}
                  >
                    <MaterialIcon name="play_arrow" size="sm" className="mr-1" />
                    Run
                  </Button>
                </div>

                {status.loading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                    <span className="text-sm">Loading...</span>
                  </div>
                ) : status.lastRun ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <StatusIndicator status={status.lastRun.status} size="sm" />
                      <span className="text-xs text-muted-foreground">
                        {formatTimeAgo(status.lastRun.started_at)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-green-600 font-medium">{status.lastRun.pass_count} pass</span>
                      <span className="text-red-600 font-medium">{status.lastRun.fail_count} fail</span>
                      <span className="text-gray-500">{status.lastRun.skip_count} skip</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No runs yet
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Run Instructions Dialog */}
      <Dialog open={showRunDialog !== null} onOpenChange={() => setShowRunDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="play_circle" size="md" />
              Run {statuses.find(s => s.suite === showRunDialog)?.label}
            </DialogTitle>
            <DialogDescription>
              Follow these instructions to trigger a QA run
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {showRunDialog === 'ui_visual_qa' && (
              <>
                <p className="text-sm text-muted-foreground">
                  UI Visual QA tests run via GitHub Actions workflow. To trigger a run:
                </p>
                <ol className="list-decimal list-inside space-y-2 text-sm">
                  <li>Go to the repository on GitHub</li>
                  <li>Navigate to <strong>Actions</strong> tab</li>
                  <li>Select <strong>UI Visual QA</strong> workflow</li>
                  <li>Click <strong>Run workflow</strong></li>
                  <li>Select the branch and click <strong>Run workflow</strong></li>
                </ol>
                <div className="p-3 bg-muted rounded-lg">
                  <code className="text-xs">
                    gh workflow run ui-visual-qa.yml -f branch=main
                  </code>
                </div>
              </>
            )}
            {showRunDialog === 'workflow_qa' && (
              <>
                <p className="text-sm text-muted-foreground">
                  Workflow QA tests can be run directly from this page:
                </p>
                <ol className="list-decimal list-inside space-y-2 text-sm">
                  <li>Switch to the <strong>Workflow QA</strong> tab</li>
                  <li>Select the test suites you want to run</li>
                  <li>Click <strong>Run Tests</strong></li>
                </ol>
                <Button
                  className="w-full"
                  onClick={() => {
                    setShowRunDialog(null);
                    onTabChange('workflow');
                  }}
                >
                  <MaterialIcon name="arrow_forward" size="sm" className="mr-2" />
                  Go to Workflow QA
                </Button>
              </>
            )}
            {showRunDialog === 'bot_qa' && (
              <>
                <p className="text-sm text-muted-foreground">
                  Bot QA tests can be run from the Bot QA page:
                </p>
                <ol className="list-decimal list-inside space-y-2 text-sm">
                  <li>Switch to the <strong>Bot QA</strong> tab</li>
                  <li>Open the full Bot QA page</li>
                  <li>Run tool-level or conversation tests</li>
                </ol>
                <Button
                  className="w-full"
                  onClick={() => {
                    setShowRunDialog(null);
                    onTabChange('bot');
                  }}
                >
                  <MaterialIcon name="arrow_forward" size="sm" className="mr-2" />
                  Go to Bot QA
                </Button>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRunDialog(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// =============================================================================
// Status Badge Component
// =============================================================================

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
    pass: 'Pass',
    fail: 'Fail',
    skip: 'Skip',
    pending: 'Pending',
  };
  return <StatusIndicator status={status} label={labels[status]} size="sm" />;
}

/**
 * QA Center - Consolidated internal QA tools
 *
 * Requires:
 * - VITE_ENABLE_QA_CENTER=true
 * - Tenant in VITE_QA_ALLOWLIST_TENANTS (comma-separated UUIDs) or empty for all
 * - User has admin_dev system role
 */
export default function QACenter() {
  const { canAccessQACenter, isAdminDev, loading } = useAdminDev();
  const [activeTab, setActiveTab] = useState('visual');

  // Show loading state
  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  // Redirect if not authorized
  if (!canAccessQACenter) {
    return <Navigate to="/" replace />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-6" data-testid="qa-center-page">
        {/* Page Header */}
        <div className="flex items-center justify-between" data-testid="page-header">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <MaterialIcon name="science" size="lg" />
              QA Center
            </h1>
            <p className="text-muted-foreground">
              Internal testing and diagnostics tools
            </p>
          </div>
          <div className="flex items-center gap-2">
            <BackToDevConsoleButton />
            <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
              <MaterialIcon name="shield_person" size="sm" className="mr-1" />
              admin_dev
            </Badge>
          </div>
        </div>

        {/* QA Run Status Panel */}
        <QARunStatusPanel
          onRunUIVisual={() => setActiveTab('visual')}
          onTabChange={setActiveTab}
        />

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="qa-center-tabs">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="visual" className="flex items-center gap-2" data-testid="qa-tab-visual">
              <MaterialIcon name="screenshot_monitor" size="sm" />
              UI Visual QA
            </TabsTrigger>
            <TabsTrigger value="workflow" className="flex items-center gap-2" data-testid="qa-tab-workflow">
              <MaterialIcon name="checklist" size="sm" />
              Workflow QA
            </TabsTrigger>
            <TabsTrigger value="bot" className="flex items-center gap-2" data-testid="qa-tab-bot">
              <MaterialIcon name="smart_toy" size="sm" />
              Bot QA
            </TabsTrigger>
            <TabsTrigger value="diagnostics" className="flex items-center gap-2" data-testid="qa-tab-diagnostics">
              <MaterialIcon name="bug_report" size="sm" />
              Diagnostics
            </TabsTrigger>
            <TabsTrigger value="access" className="flex items-center gap-2" data-testid="qa-tab-access">
              <MaterialIcon name="admin_panel_settings" size="sm" />
              Access
            </TabsTrigger>
          </TabsList>

          {/* UI Visual QA Tab */}
          <TabsContent value="visual" className="mt-6">
            <UIVisualQATab />
          </TabsContent>

          {/* Workflow QA Tab */}
          <TabsContent value="workflow" className="mt-6">
            <QATestConsoleTab />
          </TabsContent>

          {/* Bot QA Tab */}
          <TabsContent value="bot" className="mt-6">
            <BotQAContent />
          </TabsContent>

          {/* Diagnostics Tab */}
          <TabsContent value="diagnostics" className="mt-6">
            <DiagnosticsContent />
          </TabsContent>

          {/* Admin Dev Access Tab */}
          <TabsContent value="access" className="mt-6">
            <AdminDevAccessTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

// =============================================================================
// UI Visual QA Tab
// =============================================================================

interface UIVisualResult {
  id: string;
  test_name: string;
  route: string;
  viewport: string;
  status: 'pass' | 'fail' | 'skip';
  error_message?: string;
  details?: {
    issues: UIIssue[];
    suggestions: { type: string; message: string; priority: string }[];
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

function UIVisualQATab() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { isAdminDev } = useAdminDev();
  const [runs, setRuns] = useState<QATestRun[]>([]);
  const [currentRun, setCurrentRun] = useState<QATestRun | null>(null);
  const [currentResults, setCurrentResults] = useState<QATestResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedViewport, setSelectedViewport] = useState<string>('all');
  const [selectedErrorCode, setSelectedErrorCode] = useState<string>('all');
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());
  const [showBulkFixDialog, setShowBulkFixDialog] = useState(false);
  const [bulkFixPrompt, setBulkFixPrompt] = useState('');
  const [showCoverage, setShowCoverage] = useState(false);
  const [screenshotUrls, setScreenshotUrls] = useState<Record<string, string>>({});

  // Suggestions state
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [expandedSuggestions, setExpandedSuggestions] = useState<Set<string>>(new Set());
  const [suggestionsCopied, setSuggestionsCopied] = useState(false);

  // AI Review state (gated by VITE_ENABLE_UI_AI_REVIEW)
  const aiReviewEnabled = import.meta.env.VITE_ENABLE_UI_AI_REVIEW === 'true';
  const [aiReview, setAIReview] = useState<UIAIReview | null>(null);
  const [aiReviewLoading, setAIReviewLoading] = useState(false);
  const [showAIReview, setShowAIReview] = useState(false);
  const [aiReviewMode, setAIReviewMode] = useState<'all' | 'failed'>('failed');

  // Fetch UI Visual QA runs
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
        .contains('suites_requested', ['ui_visual_qa'])
        .order('started_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setRuns((data as unknown as QATestRun[]) || []);
    } catch (error) {
      console.error('Error fetching UI Visual QA runs:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to fetch UI Visual QA runs'
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
      setCurrentRun(runData as unknown as QATestRun);

      // Fetch results
      const { data: resultsData, error: resultsError } = await supabase
        .from('qa_test_results')
        .select('*')
        .eq('run_id', runId)
        .eq('suite', 'ui_visual_qa')
        .order('created_at');

      if (resultsError) throw resultsError;
      setCurrentResults((resultsData as unknown as QATestResult[]) || []);

      // Generate signed URLs for screenshots
      await generateScreenshotUrls(runId, resultsData as unknown as QATestResult[]);
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

  // Generate signed URLs for screenshots
  const generateScreenshotUrls = async (runId: string, results: QATestResult[]) => {
    const urls: Record<string, string> = {};

    for (const result of results) {
      const details = result.details as UIVisualResult['details'];
      if (details?.artifacts) {
        for (const artifact of details.artifacts) {
          // Artifact path format: ui/<runId>/<viewport>/<route>/<step>.png
          const storagePath = artifact.startsWith('ui/') ? artifact : `ui/${runId}/${artifact}`;

          try {
            const { data, error } = await supabase.storage
              .from('qa-artifacts')
              .createSignedUrl(storagePath, 3600); // 1 hour expiry

            if (data?.signedUrl) {
              urls[artifact] = data.signedUrl;
            }
          } catch (err) {
            console.warn(`Failed to get signed URL for ${storagePath}:`, err);
          }
        }
      }
    }

    setScreenshotUrls(urls);
  };

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // Extract all selectable issues from results
  const extractSelectableIssues = (): SelectableIssue[] => {
    const issues: SelectableIssue[] = [];
    const testResults = currentResults.filter(r => r.test_name !== 'tour_coverage');

    testResults.forEach(result => {
      const details = result.details as UIVisualResult['details'];
      if (details?.issues && details.issues.length > 0) {
        const priority = result.test_name.match(/^\[(P\d)\]/)?.[1] || 'P2';
        const route = result.test_name.replace(/^\[P\d\]\s*/, '').split(' (')[0];
        const viewport = result.test_name.match(/\((\w+)\)$/)?.[1] || 'unknown';

        const failedSteps = details.tourSteps?.filter(s => s.status === 'fail') || [];

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
            consoleErrors: details.consoleErrors?.length ? details.consoleErrors : undefined,
            exceptions: details.exceptions?.length ? details.exceptions : undefined,
            networkFailures: details.networkFailures?.length ? details.networkFailures : undefined,
            failedTourSteps: failedSteps.length ? failedSteps : undefined,
            axeViolations: details.axeViolations?.length ? details.axeViolations : undefined,
            scrollBufferPx: details.scrollBufferPx,
            overflow: details.overflow || undefined,
            routeDescription: route,
          });
        });
      }
    });

    return issues;
  };

  const allSelectableIssues = extractSelectableIssues();

  // Filter issues by error code and viewport
  const filteredIssues = allSelectableIssues.filter(si => {
    const matchesCode = selectedErrorCode === 'all' || si.issue.code === selectedErrorCode;
    const matchesViewport = selectedViewport === 'all' || si.viewport === selectedViewport;
    return matchesCode && matchesViewport;
  });

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

    // Collect unique files across all issues
    const allFiles = new Set<string>();
    selected.forEach(si => si.fileHints.forEach(f => allFiles.add(f)));

    // Collect all console errors across issues
    const allConsoleErrors = new Set<string>();
    selected.forEach(si => si.consoleErrors?.forEach(e => allConsoleErrors.add(e)));

    // Collect all exceptions
    const allExceptions = new Set<string>();
    selected.forEach(si => si.exceptions?.forEach(e => allExceptions.add(e)));

    // Collect all network failures
    const allNetworkFailures = new Set<string>();
    selected.forEach(si => si.networkFailures?.forEach(n => allNetworkFailures.add(n)));

    // Collect unique failed tour steps
    const allFailedSteps: { step: string; action: string; error?: string; route: string }[] = [];
    selected.forEach(si => {
      si.failedTourSteps?.forEach(s => {
        if (!allFailedSteps.some(existing => existing.step === s.step && existing.route === si.route)) {
          allFailedSteps.push({ ...s, route: si.route });
        }
      });
    });

    // Collect all axe violations
    const allAxeViolations: { id: string; impact: string; description: string; nodes: number; route: string }[] = [];
    selected.forEach(si => {
      si.axeViolations?.forEach(v => {
        if (!allAxeViolations.some(existing => existing.id === v.id && existing.route === si.route)) {
          allAxeViolations.push({ ...v, route: si.route });
        }
      });
    });

    const lines: string[] = [
      '# UI Visual QA - Fix Request',
      '',
      '> Paste this into an AI code assistant (Claude, Cursor, etc.) to get help fixing these issues.',
      '',
      '## Summary',
      '',
      `| Field | Value |`,
      `|-------|-------|`,
      `| **Run ID** | ${currentRun?.id || 'unknown'} |`,
      `| **Total Issues** | ${selected.length} |`,
      `| **Unique Routes Affected** | ${new Set(selected.map(s => s.route)).size} |`,
      `| **P0 (Critical)** | ${selected.filter(s => s.priority === 'P0').length} |`,
      `| **P1 (Important)** | ${selected.filter(s => s.priority === 'P1').length} |`,
      `| **P2 (Info)** | ${selected.filter(s => s.priority === 'P2').length} |`,
      `| **Generated** | ${new Date().toISOString()} |`,
      '',
    ];

    // Console errors section
    if (allConsoleErrors.size > 0) {
      lines.push('## JavaScript Console Errors', '');
      lines.push('These errors were logged to the browser console during testing:', '');
      [...allConsoleErrors].forEach((err, i) => {
        lines.push(`${i + 1}. \`${err}\``);
      });
      lines.push('');
    }

    // Uncaught exceptions
    if (allExceptions.size > 0) {
      lines.push('## Uncaught Exceptions', '');
      lines.push('These runtime exceptions crashed during testing:', '');
      [...allExceptions].forEach((ex, i) => {
        lines.push(`${i + 1}. \`${ex}\``);
      });
      lines.push('');
    }

    // Network failures
    if (allNetworkFailures.size > 0) {
      lines.push('## Network Failures', '');
      lines.push('These API/network requests failed during testing:', '');
      [...allNetworkFailures].forEach((nf, i) => {
        lines.push(`${i + 1}. \`${nf}\``);
      });
      lines.push('');
    }

    // Failed tour steps with full error detail
    if (allFailedSteps.length > 0) {
      lines.push('## Failed Interaction Steps', '');
      lines.push('These scripted UI interactions failed (element not found, timeout, etc.):', '');
      allFailedSteps.forEach((s, i) => {
        lines.push(`### Step ${i + 1}: \`${s.action}\` on route \`${s.route}\``);
        lines.push(`- **Selector/Target:** \`${s.step}\``);
        if (s.error) {
          lines.push(`- **Error:**`);
          lines.push('```', s.error, '```');
        }
        lines.push('');
      });
    }

    // Accessibility violations
    if (allAxeViolations.length > 0) {
      lines.push('## Accessibility Violations (axe-core / WCAG)', '');
      allAxeViolations.forEach(v => {
        lines.push(`- **${v.id}** (${v.impact}) on \`${v.route}\`: ${v.description} — ${v.nodes} element(s)`);
      });
      lines.push('');
    }

    lines.push('---', '');

    // Group by error code for detailed breakdown
    const byErrorCode = selected.reduce((acc, si) => {
      if (!acc[si.issue.code]) acc[si.issue.code] = [];
      acc[si.issue.code].push(si);
      return acc;
    }, {} as Record<string, SelectableIssue[]>);

    lines.push('## Issues by Category', '');

    Object.entries(byErrorCode).forEach(([code, issues]) => {
      lines.push(`### ${ERROR_CODE_LABELS[code as ErrorCode] || code} (${issues.length} issue${issues.length > 1 ? 's' : ''})`);
      lines.push('');
      lines.push(getErrorCodeExplanation(code));
      lines.push('');

      issues.forEach((si, idx) => {
        lines.push(`#### ${idx + 1}. \`${si.route}\` — ${si.viewport} viewport [${si.priority}]`);
        lines.push('');
        lines.push(`- **Error:** ${si.issue.message}`);

        if (si.issue.selector) {
          lines.push(`- **CSS Selector:** \`${si.issue.selector}\``);
        }
        if (si.issue.measuredValue !== undefined) {
          lines.push(`- **Measured:** ${si.issue.measuredValue}px`);
        }
        if (si.issue.expectedValue !== undefined) {
          lines.push(`- **Expected:** ≥ ${si.issue.expectedValue}px`);
        }
        if (si.scrollBufferPx !== undefined) {
          lines.push(`- **Scroll buffer:** ${si.scrollBufferPx}px (target: 80–120px)`);
        }
        if (si.overflow) {
          lines.push(`- **Horizontal overflow:** Content extends beyond viewport`);
        }
        if (si.fileHints.length > 0) {
          lines.push(`- **Source files:**`);
          si.fileHints.forEach(f => lines.push(`  - \`${f}\``));
        }
        lines.push('');
      });
    });

    lines.push('---', '');

    // All files to check - deduplicated summary
    if (allFiles.size > 0) {
      lines.push('## All Files to Check', '');
      lines.push('These are the source files related to the affected routes:', '');
      [...allFiles].sort().forEach(f => lines.push(`- \`${f}\``));
      lines.push('');
    }

    // Technology stack context
    lines.push(
      '## Technology Stack',
      '',
      '- **Frontend:** React 18 + TypeScript + Vite',
      '- **UI Library:** shadcn-ui + Radix UI + Tailwind CSS',
      '- **Database:** Supabase (PostgreSQL + RLS)',
      '- **Auth:** Supabase Auth (JWT)',
      '- **State:** TanStack React Query v5',
      '- **Forms:** React Hook Form + Zod',
      '- **Testing:** Playwright + axe-core',
      '',
    );

    // Detailed fix instructions by error code
    lines.push(
      '## Fix Instructions',
      '',
      'For each issue above, please:',
      '',
      '1. **Read** the error message and identify the root cause',
      '2. **Open** the listed source file(s) and find the problematic code',
      '3. **Explain** what is going wrong and why',
      '4. **Provide** the minimal code change to fix it',
      '5. **Verify** the fix does not break other functionality',
      '',
      '### Fix Patterns by Error Type',
      '',
    );

    // Only include fix patterns for error codes that are present
    const codeSet = new Set(Object.keys(byErrorCode));
    if (codeSet.has('SCROLL_LOCKED')) {
      lines.push('**SCROLL_LOCKED** — The page cannot scroll. Usually caused by:');
      lines.push('- `overflow: hidden` on a parent container (body, main, or layout wrapper)');
      lines.push('- Missing `overflow-y: auto` on the scrollable content area');
      lines.push('- A `h-screen` / `h-full` container without scroll on the inner content');
      lines.push('- Fix: Add `overflow-y: auto` to the main content wrapper in DashboardLayout or the page component');
      lines.push('');
    }
    if (codeSet.has('INSUFFICIENT_SCROLL_BUFFER')) {
      lines.push('**INSUFFICIENT_SCROLL_BUFFER** — Not enough space below the last interactive element (target: 80–120px). Caused by:');
      lines.push('- Missing `pb-20` or `pb-24` on the page content container');
      lines.push('- A sticky/fixed footer overlapping content');
      lines.push('- Fix: Add `className="pb-24"` to the page\'s main content wrapper');
      lines.push('');
    }
    if (codeSet.has('PRIMARY_ACTION_NOT_REACHABLE')) {
      lines.push('**PRIMARY_ACTION_NOT_REACHABLE** — The main action button (Save/Submit/Complete) is not visible or scrollable to. Caused by:');
      lines.push('- Button is below the fold and scroll is locked');
      lines.push('- Button is behind a fixed header/footer');
      lines.push('- Fix: Make the button sticky at the bottom, or fix the scroll issue so user can reach it');
      lines.push('');
    }
    if (codeSet.has('HORIZONTAL_OVERFLOW')) {
      lines.push('**HORIZONTAL_OVERFLOW** — Content extends past the right edge of the viewport. Caused by:');
      lines.push('- A table or element with `min-width` larger than viewport');
      lines.push('- Long unbroken text or URLs without `break-words`');
      lines.push('- Fix: Wrap tables in `overflow-x-auto`, add `break-words` to text, or use responsive widths');
      lines.push('');
    }
    if (codeSet.has('BLANK_CONTENT')) {
      lines.push('**BLANK_CONTENT** — The page rendered but the content area is empty. Caused by:');
      lines.push('- Data not loading (API error, missing tenant_id filter)');
      lines.push('- Component render guard blocking content (loading state stuck)');
      lines.push('- Fix: Check the data fetching hook for errors, verify RLS policies, add error states');
      lines.push('');
    }
    if (codeSet.has('CONSOLE_ERROR')) {
      lines.push('**CONSOLE_ERROR** — JavaScript errors in the browser console. Check the "Console Errors" section above for the exact messages. Common causes:');
      lines.push('- Undefined property access (data not loaded yet)');
      lines.push('- Failed API calls throwing unhandled errors');
      lines.push('- Fix: Add null checks, error boundaries, or loading guards');
      lines.push('');
    }
    if (codeSet.has('UNCAUGHT_EXCEPTION')) {
      lines.push('**UNCAUGHT_EXCEPTION** — Unhandled runtime error that crashed the page. Check "Uncaught Exceptions" section above. Fix:');
      lines.push('- Wrap the problematic code in try/catch');
      lines.push('- Add React error boundaries');
      lines.push('- Fix the underlying null/undefined access');
      lines.push('');
    }
    if (codeSet.has('NETWORK_FAILURE')) {
      lines.push('**NETWORK_FAILURE** — API requests failed. Check "Network Failures" section above. Common causes:');
      lines.push('- Missing Supabase RLS policies');
      lines.push('- Incorrect API endpoint or function name');
      lines.push('- Authentication token expired');
      lines.push('');
    }
    if (codeSet.has('AXE_CRITICAL') || codeSet.has('AXE_SERIOUS')) {
      lines.push('**AXE_CRITICAL / AXE_SERIOUS** — WCAG accessibility violations. Common fixes:');
      lines.push('- Add `alt` text to images');
      lines.push('- Add `<label>` elements to form inputs');
      lines.push('- Fix color contrast ratios (use WCAG AA: 4.5:1 for text)');
      lines.push('- Add `aria-label` to icon-only buttons');
      lines.push('- Ensure focus indicators are visible');
      lines.push('');
    }
    if (codeSet.has('TOUR_STEP_FAILED')) {
      lines.push('**TOUR_STEP_FAILED** — A scripted UI interaction could not be completed. Check "Failed Interaction Steps" above. Common causes:');
      lines.push('- Missing `data-testid` attribute on the target element');
      lines.push('- Element not rendered (hidden behind a condition or loading state)');
      lines.push('- Element present but not visible (display:none, opacity:0, off-screen)');
      lines.push('- Timing issue (element not ready within timeout)');
      lines.push('- Fix: Add the missing `data-testid`, fix the render condition, or increase the step timeout');
      lines.push('');
    }

    setBulkFixPrompt(lines.join('\n'));
    setShowBulkFixDialog(true);
  };

  const handleCopyBulkPrompt = async () => {
    try {
      await navigator.clipboard.writeText(bulkFixPrompt);
      toast({ title: 'Copied', description: 'Fix prompt copied to clipboard' });
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = bulkFixPrompt;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      toast({ title: 'Copied', description: 'Fix prompt copied to clipboard' });
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

  const clearCurrentRun = () => {
    setCurrentRun(null);
    setCurrentResults([]);
    setSelectedIssues(new Set());
    setScreenshotUrls({});
    setAIReview(null);
    setShowAIReview(false);
    setExpandedSuggestions(new Set());
  };

  // Filter for test results (excluding coverage)
  const testResults = currentResults.filter(r => r.test_name !== 'tour_coverage');
  const coverageResult = currentResults.find(r => r.test_name === 'tour_coverage');
  const coverageData = coverageResult?.details as unknown as TourCoverageData | undefined;

  // Generate heuristic suggestions
  const heuristicSuggestions = generateHeuristicSuggestions(currentResults);

  // Group by route for detail view
  const resultsByRoute = testResults.reduce((acc, result) => {
    const route = result.test_name.replace(/^\[P\d\]\s*/, '').split(' (')[0];
    if (!acc[route]) acc[route] = [];
    acc[route].push(result);
    return acc;
  }, {} as Record<string, QATestResult[]>);

  // Toggle suggestion expansion
  const toggleSuggestionExpand = (id: string) => {
    setExpandedSuggestions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // Copy suggestions summary to clipboard
  const handleCopySuggestions = async () => {
    const lines: string[] = [
      '# UI Visual QA - Suggestions Summary',
      '',
      `**Run ID:** ${currentRun?.id || 'unknown'}`,
      `**Total Suggestions:** ${heuristicSuggestions.length}`,
      `**Generated:** ${new Date().toISOString()}`,
      '',
      '---',
      '',
    ];

    heuristicSuggestions.forEach((suggestion, idx) => {
      lines.push(`## ${idx + 1}. ${suggestion.title}`);
      lines.push('');
      lines.push(`**Category:** ${SUGGESTION_CATEGORIES[suggestion.category]?.label || suggestion.category}`);
      lines.push(`**Severity:** ${suggestion.severity.toUpperCase()}`);
      lines.push(`**Affected Routes:** ${suggestion.affectedRoutes.join(', ')}`);
      lines.push(`**Affected Viewports:** ${suggestion.affectedViewports.join(', ')}`);
      lines.push('');
      lines.push(`**Description:** ${suggestion.description}`);
      lines.push('');
      lines.push(`**Recommendation:** ${suggestion.recommendation}`);
      lines.push('');
      lines.push('---');
      lines.push('');
    });

    const text = lines.join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setSuggestionsCopied(true);
      setTimeout(() => setSuggestionsCopied(false), 2000);
      toast({ title: 'Copied', description: 'Suggestions summary copied to clipboard' });
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setSuggestionsCopied(true);
      setTimeout(() => setSuggestionsCopied(false), 2000);
      toast({ title: 'Copied', description: 'Suggestions summary copied to clipboard' });
    }
  };

  // Fetch existing AI review for this run
  const fetchAIReview = useCallback(async (runId: string) => {
    try {
      const { data, error } = await supabase
        .from('ui_ai_reviews')
        .select('*')
        .eq('run_id', runId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      if (data) {
        setAIReview(data as unknown as UIAIReview);
      }
    } catch (error) {
      console.warn('No existing AI review found:', error);
    }
  }, []);

  // Trigger AI review via Edge Function
  const handleGenerateAIReview = async () => {
    if (!currentRun || !profile?.id) return;

    setAIReviewLoading(true);
    try {
      // Collect screenshots to send
      const resultsToReview = aiReviewMode === 'failed'
        ? testResults.filter(r => r.status === 'fail')
        : testResults;

      // Get representative screenshots (limit to 60)
      const screenshots: { route: string; viewport: string; path: string; url: string }[] = [];
      const routeViewportSeen = new Set<string>();

      for (const result of resultsToReview) {
        const details = result.details as UIVisualResult['details'];
        if (!details?.artifacts?.length) continue;

        const route = result.test_name.replace(/^\[P\d\]\s*/, '').split(' (')[0];
        const viewport = result.test_name.match(/\((\w+)\)$/)?.[1] || 'desktop';
        const key = `${route}-${viewport}`;

        // Only take first screenshot per route-viewport combo
        if (!routeViewportSeen.has(key)) {
          routeViewportSeen.add(key);
          const artifactPath = details.artifacts[0];
          const signedUrl = screenshotUrls[artifactPath];
          if (signedUrl) {
            screenshots.push({ route, viewport, path: artifactPath, url: signedUrl });
          }
        }

        if (screenshots.length >= 60) break;
      }

      if (screenshots.length === 0) {
        toast({ title: 'No screenshots', description: 'No screenshots available for AI review', variant: 'destructive' });
        setAIReviewLoading(false);
        return;
      }

      // Call Edge Function
      const { data, error } = await supabase.functions.invoke('ui-ai-review', {
        body: {
          run_id: currentRun.id,
          tenant_id: profile.tenant_id,
          user_id: profile.id,
          mode: aiReviewMode,
          screenshots: screenshots.map(s => ({ route: s.route, viewport: s.viewport, url: s.url })),
        },
      });

      if (error) throw error;

      if (data?.review) {
        setAIReview(data.review);
        setShowAIReview(true);
        toast({ title: 'AI Review Complete', description: `Generated ${data.review.suggestions?.length || 0} suggestions` });
      }
    } catch (error) {
      console.error('Error generating AI review:', error);
      toast({ title: 'Error', description: 'Failed to generate AI review. Check Edge Function logs.', variant: 'destructive' });
    } finally {
      setAIReviewLoading(false);
    }
  };

  // Fetch AI review when run changes
  useEffect(() => {
    if (currentRun?.id && aiReviewEnabled) {
      fetchAIReview(currentRun.id);
    }
  }, [currentRun?.id, aiReviewEnabled, fetchAIReview]);

  // Run detail view
  if (currentRun) {
    return (
      <div className="space-y-6" data-testid="ui-visual-qa-detail">
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
                  <MaterialIcon name="pie_chart" size="md" />
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

        {/* Heuristic Suggestions Panel */}
        {heuristicSuggestions.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <MaterialIcon name="lightbulb" size="md" className="text-amber-500" />
                  Suggestions ({heuristicSuggestions.length})
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowSuggestions(!showSuggestions)}
                  >
                    {showSuggestions ? 'Collapse' : 'Expand'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopySuggestions}
                  >
                    <MaterialIcon name={suggestionsCopied ? 'check' : 'content_copy'} size="sm" className="mr-2" />
                    {suggestionsCopied ? 'Copied!' : 'Copy Summary'}
                  </Button>
                </div>
              </div>
              <CardDescription>
                Advisory suggestions based on test failures (does not affect pass/fail status)
              </CardDescription>
            </CardHeader>
            {showSuggestions && (
              <CardContent>
                <div className="space-y-4">
                  {/* Summary by category */}
                  <div className="flex flex-wrap gap-3 mb-4">
                    {Object.entries(
                      heuristicSuggestions.reduce((acc, s) => {
                        acc[s.category] = (acc[s.category] || 0) + 1;
                        return acc;
                      }, {} as Record<string, number>)
                    ).map(([category, count]) => {
                      const cat = SUGGESTION_CATEGORIES[category];
                      return (
                        <Badge key={category} variant="outline" className="px-3 py-1">
                          <MaterialIcon name={cat?.icon || 'info'} size="sm" className={cn("mr-1", cat?.color)} />
                          {cat?.label || category}: {count}
                        </Badge>
                      );
                    })}
                  </div>

                  {/* Individual suggestions */}
                  <Accordion type="multiple" value={Array.from(expandedSuggestions)} className="space-y-2">
                    {heuristicSuggestions.map((suggestion) => {
                      const cat = SUGGESTION_CATEGORIES[suggestion.category];
                      return (
                        <AccordionItem
                          key={suggestion.id}
                          value={suggestion.id}
                          className={cn(
                            "border rounded-lg px-4",
                            suggestion.severity === 'high' && "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30",
                            suggestion.severity === 'medium' && "border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30",
                            suggestion.severity === 'low' && "border-gray-200"
                          )}
                        >
                          <AccordionTrigger
                            className="hover:no-underline py-3"
                            onClick={() => toggleSuggestionExpand(suggestion.id)}
                          >
                            <div className="flex items-center gap-3 flex-1 text-left">
                              <MaterialIcon name={cat?.icon || 'info'} size="sm" className={cat?.color} />
                              <span className="font-medium">{suggestion.title}</span>
                              <Badge
                                variant={suggestion.severity === 'high' ? 'destructive' : suggestion.severity === 'medium' ? 'default' : 'outline'}
                                className="ml-auto mr-2"
                              >
                                {suggestion.severity}
                              </Badge>
                              <Badge variant="secondary">
                                {suggestion.affectedRoutes.length} route(s)
                              </Badge>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="pb-4">
                            <div className="space-y-3 pt-2">
                              <p className="text-sm text-muted-foreground">{suggestion.description}</p>

                              <div className="grid gap-3 md:grid-cols-2">
                                <div>
                                  <Label className="text-xs text-muted-foreground">Affected Routes</Label>
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {suggestion.affectedRoutes.slice(0, 10).map(route => (
                                      <Badge key={route} variant="outline" className="text-xs font-mono">
                                        {route}
                                      </Badge>
                                    ))}
                                    {suggestion.affectedRoutes.length > 10 && (
                                      <Badge variant="secondary" className="text-xs">
                                        +{suggestion.affectedRoutes.length - 10} more
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <div>
                                  <Label className="text-xs text-muted-foreground">Viewports</Label>
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {suggestion.affectedViewports.map(vp => (
                                      <Badge key={vp} variant="outline" className="text-xs">
                                        {vp}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              </div>

                              <div className="p-3 bg-muted rounded-lg">
                                <Label className="text-xs text-muted-foreground mb-1 block">Recommendation</Label>
                                <p className="text-sm">{suggestion.recommendation}</p>
                              </div>
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                </div>
              </CardContent>
            )}
          </Card>
        )}

        {/* AI UI Review Panel (gated) */}
        {aiReviewEnabled && isAdminDev && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <MaterialIcon name="auto_awesome" size="md" className="text-purple-500" />
                  AI UI Review
                  <Badge variant="outline" className="ml-2 text-xs">Beta</Badge>
                </CardTitle>
                <div className="flex items-center gap-2">
                  {!aiReview && (
                    <>
                      <Select value={aiReviewMode} onValueChange={(v: 'all' | 'failed') => setAIReviewMode(v)}>
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="failed">Failed pages only</SelectItem>
                          <SelectItem value="all">All pages</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        onClick={handleGenerateAIReview}
                        disabled={aiReviewLoading}
                      >
                        {aiReviewLoading ? (
                          <>
                            <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                            Analyzing...
                          </>
                        ) : (
                          <>
                            <MaterialIcon name="auto_awesome" size="sm" className="mr-2" />
                            Generate AI Review
                          </>
                        )}
                      </Button>
                    </>
                  )}
                  {aiReview && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowAIReview(!showAIReview)}
                    >
                      {showAIReview ? 'Hide' : 'Show'} Review
                    </Button>
                  )}
                </div>
              </div>
              <CardDescription>
                Vision-based UI critique using AI (server-side, gated feature)
              </CardDescription>
            </CardHeader>
            {showAIReview && aiReview && (
              <CardContent>
                <div className="space-y-4">
                  {/* AI Review Summary */}
                  <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                    <Label className="text-xs text-muted-foreground mb-2 block">AI Summary</Label>
                    <p className="text-sm">{aiReview.summary}</p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                      <MaterialIcon name="schedule" size="sm" />
                      Generated {new Date(aiReview.created_at).toLocaleString()}
                    </div>
                  </div>

                  {/* AI Suggestions */}
                  {aiReview.suggestions && aiReview.suggestions.length > 0 && (
                    <div className="space-y-3">
                      <Label className="text-sm font-medium">AI Suggestions ({aiReview.suggestions.length})</Label>
                      <Accordion type="single" collapsible className="space-y-2">
                        {aiReview.suggestions.map((suggestion, idx) => (
                          <AccordionItem
                            key={idx}
                            value={`ai-${idx}`}
                            className={cn(
                              "border rounded-lg px-4",
                              suggestion.severity === 'high' && "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30",
                              suggestion.severity === 'medium' && "border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30"
                            )}
                          >
                            <AccordionTrigger className="hover:no-underline py-3">
                              <div className="flex items-center gap-3 flex-1 text-left">
                                <Badge variant="outline">{suggestion.category}</Badge>
                                <span className="font-medium truncate flex-1">{suggestion.description.slice(0, 60)}...</span>
                                <Badge
                                  variant={suggestion.severity === 'high' ? 'destructive' : suggestion.severity === 'medium' ? 'default' : 'outline'}
                                  className="ml-2"
                                >
                                  {suggestion.severity}
                                </Badge>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent className="pb-4">
                              <div className="space-y-3 pt-2">
                                <div className="flex gap-2">
                                  <Badge variant="outline" className="font-mono text-xs">{suggestion.route}</Badge>
                                  <Badge variant="outline" className="text-xs">{suggestion.viewport}</Badge>
                                </div>
                                <p className="text-sm text-muted-foreground">{suggestion.description}</p>
                                <div className="p-3 bg-muted rounded-lg">
                                  <Label className="text-xs text-muted-foreground mb-1 block">Recommendation</Label>
                                  <p className="text-sm">{suggestion.recommendation}</p>
                                </div>
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    </div>
                  )}

                  {aiReview.status === 'failed' && aiReview.error && (
                    <div className="p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-lg">
                      <div className="flex items-center gap-2 text-red-600">
                        <MaterialIcon name="error" size="sm" />
                        <span className="font-medium">Review Failed</span>
                      </div>
                      <p className="text-sm text-red-600 mt-1">{aiReview.error}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            )}
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
                      <TableHead>Screenshot</TableHead>
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
                        <TableCell>
                          {si.screenshot && screenshotUrls[si.screenshot] && (
                            <a
                              href={screenshotUrls[si.screenshot]}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-block"
                            >
                              <img
                                src={screenshotUrls[si.screenshot]}
                                alt="Screenshot"
                                className="w-16 h-10 object-cover rounded border hover:opacity-80"
                              />
                            </a>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredIssues.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          No issues found matching the selected filters
                        </TableCell>
                      </TableRow>
                    )}
                    {filteredIssues.length > 50 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-2 text-muted-foreground text-sm">
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
              {Object.entries(resultsByRoute).map(([route, results]) => {
                const passCount = results.filter(r => r.status === 'pass').length;
                const failCount = results.filter(r => r.status === 'fail').length;
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
                        {results.map(result => {
                          const details = result.details as UIVisualResult['details'];
                          const priority = result.test_name.match(/^\[(P\d)\]/)?.[1] || 'P2';
                          const viewport = result.test_name.match(/\((\w+)\)$/)?.[1] || 'unknown';
                          const screenshotPath = details?.artifacts?.[0];

                          return (
                            <div
                              key={result.id}
                              className={cn(
                                "p-4 rounded-lg border",
                                result.status === 'fail' && "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/50",
                                result.status === 'pass' && "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/50"
                              )}
                            >
                              <div className="flex items-start justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <Badge
                                    variant={priority === 'P0' ? 'destructive' : priority === 'P1' ? 'default' : 'outline'}
                                    className="text-xs"
                                  >
                                    {priority}
                                  </Badge>
                                  <StatusBadge status={result.status} />
                                  <Badge variant="outline">{viewport}</Badge>
                                </div>
                                {screenshotPath && screenshotUrls[screenshotPath] && (
                                  <a
                                    href={screenshotUrls[screenshotPath]}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-block"
                                  >
                                    <img
                                      src={screenshotUrls[screenshotPath]}
                                      alt="Screenshot"
                                      className="w-24 h-16 object-cover rounded border hover:opacity-80"
                                    />
                                  </a>
                                )}
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

                              {/* Scroll buffer info */}
                              {details?.scrollBufferPx !== undefined && (
                                <div className={cn(
                                  "text-sm flex items-center gap-2 mb-2",
                                  details.scrollBufferPx < 80 ? "text-red-600" : "text-green-600"
                                )}>
                                  <MaterialIcon name={details.scrollBufferPx < 80 ? "warning" : "check_circle"} size="sm" />
                                  Scroll buffer: {details.scrollBufferPx}px {details.scrollBufferPx < 80 && "(min 80px required)"}
                                </div>
                              )}

                              {details?.fileHints && details.fileHints.length > 0 && (
                                <div className="mt-2 text-sm">
                                  <span className="text-muted-foreground">Files to check: </span>
                                  <span className="font-mono text-xs">{details.fileHints.join(', ')}</span>
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

  // Runs list view
  return (
    <Card data-testid="ui-visual-qa-runs">
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
        {loading && runs.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
          </div>
        ) : runs.length === 0 ? (
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
                <TableHead>Results</TableHead>
                <TableHead>Viewports</TableHead>
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
                    <div className="flex gap-1">
                      {(run.metadata?.viewports as string[] || ['desktop', 'tablet', 'mobile']).map((vp: string) => (
                        <Badge key={vp} variant="outline" className="text-xs">
                          {vp}
                        </Badge>
                      ))}
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

/**
 * Bot QA Content - Extracted from BotQA page
 */
function BotQAContent() {
  const navigate = useNavigate();
  // We need to render BotQAPage content without the DashboardLayout wrapper
  // Since BotQAPage is a full page component, we'll extract its inner content
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="smart_toy" size="md" />
            Bot Testing Tools
          </CardTitle>
          <CardDescription>
            Test AI bot entity resolution, tool execution, and conversation flows
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">
            Navigate to the full Bot QA page for comprehensive testing tools.
          </p>
          <Button type="button" onClick={() => navigate('/admin/bot-qa')}>
            <MaterialIcon name="open_in_new" size="sm" />
            Open Bot QA
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Diagnostics Content - Extracted from Diagnostics page
 */
function DiagnosticsContent() {
  const navigate = useNavigate();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="bug_report" size="md" />
            Error Monitoring Dashboard
          </CardTitle>
          <CardDescription>
            View and manage application errors, warnings, and issues
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">
            Navigate to the full Diagnostics page for comprehensive error monitoring.
          </p>
          <Button type="button" onClick={() => navigate('/diagnostics')}>
            <MaterialIcon name="open_in_new" size="sm" />
            Open Diagnostics
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Admin Dev Access Management Tab
 */
function AdminDevAccessTab() {
  const { toast } = useToast();
  const { grantAdminDev, revokeAdminDev, fetchAdminDevUsers, isAdminDev } = useAdminDev();
  const [adminDevUsers, setAdminDevUsers] = useState<{ id: string; email: string; first_name: string | null; last_name: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [grantDialogOpen, setGrantDialogOpen] = useState(false);
  const [grantEmail, setGrantEmail] = useState('');
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    loadAdminDevUsers();
  }, []);

  const loadAdminDevUsers = async () => {
    setLoading(true);
    const users = await fetchAdminDevUsers();
    setAdminDevUsers(users);
    setLoading(false);
  };

  const handleGrant = async () => {
    if (!grantEmail.trim()) return;

    setGranting(true);
    const result = await grantAdminDev(grantEmail.trim());
    setGranting(false);

    if (result.success) {
      toast({ title: 'Success', description: `Granted admin_dev access to ${grantEmail}` });
      setGrantDialogOpen(false);
      setGrantEmail('');
      loadAdminDevUsers();
    } else {
      toast({ title: 'Error', description: result.error, variant: 'destructive' });
    }
  };

  const handleRevoke = async (userId: string, email: string) => {
    setRevoking(userId);
    const result = await revokeAdminDev(userId);
    setRevoking(null);

    if (result.success) {
      toast({ title: 'Success', description: `Revoked admin_dev access from ${email}` });
      loadAdminDevUsers();
    } else {
      toast({ title: 'Error', description: result.error, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MaterialIcon name="admin_panel_settings" size="md" />
                Admin Dev Access Management
              </CardTitle>
              <CardDescription>
                Manage users with the admin_dev system role
              </CardDescription>
            </div>
            <Button onClick={() => setGrantDialogOpen(true)}>
              <MaterialIcon name="person_add" size="sm" className="mr-2" />
              Grant Access
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
            </div>
          ) : adminDevUsers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MaterialIcon name="group" size="lg" className="mx-auto mb-2 opacity-50" />
              <p>No admin_dev users found</p>
              <p className="text-sm">Grant access to internal team members</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adminDevUsers.map(user => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                          <MaterialIcon name="person" size="sm" className="text-purple-600" />
                        </div>
                        <span className="font-medium">
                          {user.first_name && user.last_name
                            ? `${user.first_name} ${user.last_name}`
                            : user.email.split('@')[0]}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevoke(user.id, user.email)}
                        disabled={revoking === user.id}
                      >
                        {revoking === user.id ? (
                          <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                        ) : (
                          <>
                            <MaterialIcon name="person_remove" size="sm" className="mr-1" />
                            Revoke
                          </>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <MaterialIcon name="info" size="sm" />
            About System Roles
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            The <code className="bg-muted px-1 rounded">admin_dev</code> role is a <strong>system role</strong> that exists outside of tenant scope.
          </p>
          <p>
            System roles cannot be created, modified, or assigned by tenant administrators - only by existing admin_dev users or through the service role.
          </p>
          <p>
            Access to QA Center requires:
          </p>
          <ul className="list-disc list-inside ml-4 space-y-1">
            <li><code className="bg-muted px-1 rounded">VITE_ENABLE_QA_CENTER=true</code></li>
            <li>Tenant in allowlist (or empty allowlist for all tenants)</li>
            <li>User has <code className="bg-muted px-1 rounded">admin_dev</code> system role</li>
          </ul>
        </CardContent>
      </Card>

      {/* Grant Access Dialog */}
      <Dialog open={grantDialogOpen} onOpenChange={setGrantDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grant Admin Dev Access</DialogTitle>
            <DialogDescription>
              Enter the email of the user to grant admin_dev access
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="grant-email">Email Address</Label>
              <Input
                id="grant-email"
                type="email"
                placeholder="developer@example.com"
                value={grantEmail}
                onChange={e => setGrantEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleGrant()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleGrant} disabled={!grantEmail.trim() || granting}>
              {granting ? (
                <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-2" />
              ) : (
                <MaterialIcon name="person_add" size="sm" className="mr-2" />
              )}
              Grant Access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
