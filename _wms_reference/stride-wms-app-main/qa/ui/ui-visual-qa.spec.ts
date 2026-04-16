import { test, expect, Page, BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { pageTours, deepTours, PageTour, TourStep, TourMode, RoleContext, Priority, ERROR_CODES, ErrorCode, shouldCheckScrollBuffer, shouldFailRun, getDeepToursOrdered } from './tours';
import { getFileHintsForRoute, getAllRoutes } from './routeToFileHints';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// CONFIGURATION
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const QA_TENANT_ID = process.env.QA_TENANT_ID || '';
const QA_ADMIN_EMAIL = process.env.QA_ADMIN_EMAIL || '';
const QA_ADMIN_PASSWORD = process.env.QA_ADMIN_PASSWORD || '';
const QA_CLIENT_EMAIL = process.env.QA_CLIENT_EMAIL || '';
const QA_CLIENT_PASSWORD = process.env.QA_CLIENT_PASSWORD || '';
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:5173';
const DEEP_MODE = process.env.QA_DEEP_MODE === 'true';
const DEEP_TAGS_FILTER = process.env.QA_DEEP_TAGS ? process.env.QA_DEEP_TAGS.split(',').map(t => t.trim()) : [];
const ROUTES_INPUT = process.env.ROUTES?.trim() || 'all';

// Buffer check constants
const MIN_SCROLL_BUFFER_PX = 80;
const MAX_SCROLL_BUFFER_PX = 120;
const IDEAL_SCROLL_BUFFER_PX = 100;

const ALL_VIEWPORTS = ['desktop', 'tablet', 'mobile'] as const;
type Viewport = typeof ALL_VIEWPORTS[number];

function parseRequestedViewports(): Viewport[] {
  const raw = process.env.VIEWPORTS;
  if (!raw) return [...ALL_VIEWPORTS];
  const valid = raw
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v): v is Viewport => (ALL_VIEWPORTS as readonly string[]).includes(v));
  return valid.length > 0 ? valid : ['desktop'];
}

const VIEWPORTS = parseRequestedViewports();

function normalizeRoutePath(route: string): string {
  const withoutQuery = route.split('?')[0].split('#')[0].trim();
  if (!withoutQuery) return '/';
  const withLeadingSlash = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  if (withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/')) {
    return withLeadingSlash.slice(0, -1);
  }
  return withLeadingSlash;
}

function parseRequestedRoutes(): string[] | null {
  if (!ROUTES_INPUT || ROUTES_INPUT.toLowerCase() === 'all') return null;
  const parsed = ROUTES_INPUT
    .split(',')
    .map((r) => normalizeRoutePath(r))
    .filter(Boolean);
  return parsed.length > 0 ? parsed : null;
}

function looksLikeDynamicIdSegment(segment: string): boolean {
  if (!segment) return false;
  if (segment.startsWith(':')) return true;
  if (/^\d+$/.test(segment)) return true;
  // UUID (common for Supabase IDs)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return true;
  // Generic token with digits (e.g. codes like ABC123, ulids, etc.)
  if (segment.length >= 5 && /\d/.test(segment)) return true;
  return false;
}

function routeTokenMatchesTour(routeToken: string, tourRoute: string): boolean {
  const token = normalizeRoutePath(routeToken);
  const tour = normalizeRoutePath(tourRoute);

  if (token === tour) return true;
  if (tour.startsWith(`${token}/`) || token.startsWith(`${tour}/`)) return true;

  if (tour.includes(':')) {
    const tokenParts = token.split('/').filter(Boolean);
    const tourParts = tour.split('/').filter(Boolean);
    if (tokenParts.length === tourParts.length) {
      const matches = tourParts.every((part, idx) => {
        const tokenPart = tokenParts[idx] || '';
        if (part.startsWith(':')) return looksLikeDynamicIdSegment(tokenPart);
        return part === tokenPart;
      });
      if (matches) return true;
    }
  }

  return false;
}

function filterToursByRoutes<T extends { route: string }>(tours: T[], routeFilter: string[] | null): T[] {
  if (!routeFilter || routeFilter.length === 0) return tours;
  return tours.filter((tour) => routeFilter.some((token) => routeTokenMatchesTour(token, tour.route)));
}

const ROUTE_FILTER = parseRequestedRoutes();
const SELECTED_PAGE_TOURS = filterToursByRoutes(pageTours, ROUTE_FILTER);

function getSelectedDeepTours(): PageTour[] {
  const orderedDeepTours = getDeepToursOrdered();
  const tagScopedTours = DEEP_TAGS_FILTER.length > 0
    ? orderedDeepTours.filter((t) => t.tags?.some((tag) => DEEP_TAGS_FILTER.includes(tag)))
    : orderedDeepTours;

  const routeScopedTours = filterToursByRoutes(tagScopedTours, ROUTE_FILTER);
  const selectedNames = new Set(routeScopedTours.map((t) => t.name));
  const tourByName = new Map(orderedDeepTours.map((t) => [t.name, t]));

  // Always include deep-tour dependencies, even if they don't match route filters.
  const addDependencies = (tour: PageTour) => {
    for (const depName of tour.dependsOn || []) {
      if (selectedNames.has(depName)) continue;
      const depTour = tourByName.get(depName);
      if (!depTour) continue;
      selectedNames.add(depName);
      addDependencies(depTour);
    }
  };

  for (const tour of routeScopedTours) {
    addDependencies(tour);
  }

  return orderedDeepTours.filter((t) => selectedNames.has(t.name));
}

// ============================================================
// TYPES
// ============================================================

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

interface TestResult {
  suite: string;
  test_name: string;
  route: string;
  viewport: Viewport;
  priority: Priority;
  status: 'pass' | 'fail' | 'skip';
  error_message?: string;
  started_at: string;
  finished_at: string;
  details: {
    issues: UIIssue[];
    suggestions: UISuggestion[];
    overflow: boolean;
    scrollable: boolean;
    scrollBufferPx?: number;
    primaryActionReachable?: boolean;
    consoleErrors: string[];
    exceptions: string[];
    networkFailures: string[];
    axeViolations: AxeViolation[];
    artifacts: string[];
    tourSteps: TourStepResult[];
    fileHints: string[];
  };
}

interface AxeViolation {
  id: string;
  impact: string;
  description: string;
  nodes: number;
}

interface TourStepResult {
  step: string;
  action: string;
  status: 'pass' | 'fail' | 'skip';
  error?: string;
  screenshot?: string;
  /** The CSS selector that was targeted (for debugging) */
  selector?: string;
  /** The value that was being used (for debugging) */
  value?: string;
  /** The current page URL when the step executed */
  pageUrl?: string;
  /** Duration in ms */
  durationMs?: number;
}

interface TourCoverageReport {
  totalRoutes: number;
  routesWithTours: number;
  routesWithoutTours: string[];
  missingTestIds: { selector: string; route: string; count: number }[];
  skippedSteps: { route: string; step: string; reason: string }[];
  coveragePercent: number;
  p0Count: number;
  p1Count: number;
  p2Count: number;
}

interface ScrollCheckResult {
  scrollable: boolean;
  scrollLocked: boolean;
  bufferPx: number;
  primaryActionVisible: boolean;
  primaryActionReachable: boolean;
  lowestActionableSelector?: string;
}

// ============================================================
// GLOBAL STATE
// ============================================================

let supabase: SupabaseClient;
let runId: string;
let adminContext: BrowserContext;
let clientContext: BrowserContext;
let executedByUserId: string | null = null;
const testResults: TestResult[] = [];
const missingTestIds: Map<string, { route: string; count: number }> = new Map();
const skippedSteps: { route: string; step: string; reason: string }[] = [];

/**
 * Shared context store for deep tours. Allows tours to pass data between
 * each other (e.g., store the URL of a created shipment to navigate back later).
 */
const sharedContext: Map<string, string> = new Map();

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function generateRunId(): string {
  return randomUUID();
}

function resolveProjectViewport(projectName: string): Viewport {
  return (ALL_VIEWPORTS as readonly string[]).includes(projectName) ? (projectName as Viewport) : 'desktop';
}

async function createSupabaseClient(): Promise<SupabaseClient> {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function resolveExecutedByUserId(): Promise<string | null> {
  if (executedByUserId) return executedByUserId;
  if (!QA_TENANT_ID || !QA_ADMIN_EMAIL || !supabase) return null;

  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('tenant_id', QA_TENANT_ID)
    .eq('email', QA_ADMIN_EMAIL)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();

  if (!error && data?.id) {
    executedByUserId = data.id;
    return executedByUserId;
  }

  const { data: fallback, error: fallbackError } = await supabase
    .from('users')
    .select('id')
    .eq('tenant_id', QA_TENANT_ID)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fallbackError) {
    console.error('Error resolving executed_by user:', fallbackError);
    return null;
  }

  executedByUserId = fallback?.id ?? null;
  return executedByUserId;
}

async function loginUser(page: Page, email: string, password: string, isClient: boolean = false): Promise<boolean> {
  try {
    const loginUrl = isClient ? '/client/login' : '/auth';
    await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: 30000 });

    await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });

    await page.fill('input[type="email"], input[name="email"]', email);
    await page.fill('input[type="password"], input[name="password"]', password);
    await page.click('button[type="submit"]');

    await page.waitForURL((url) => !url.pathname.includes('auth') && !url.pathname.includes('login'), {
      timeout: 15000,
    });

    return true;
  } catch (error) {
    console.error(`Login failed for ${email}:`, error);
    return false;
  }
}

async function getDynamicId(table: string, tenantId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from(table)
      .select('id')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(1);

    return data?.[0]?.id || null;
  } catch {
    return null;
  }
}

async function getDynamicIdForRoute(route: string): Promise<string | null> {
  const routeTableMap: Record<string, string> = {
    '/shipments/:id': 'shipments',
    '/inventory/:id': 'items',
    '/tasks/:id': 'tasks',
    '/claims/:id': 'claims',
    '/stocktakes/:id/scan': 'stocktakes',
    '/stocktakes/:id/report': 'stocktakes',
    '/manifests/:id': 'manifests',
    '/manifests/:id/scan': 'manifests',
    '/manifests/:id/history': 'manifests',
    '/repair-quotes/:id': 'repair_quotes',
    '/quotes/:id': 'quotes',
  };

  const table = routeTableMap[route];
  if (!table) return null;

  return getDynamicId(table, QA_TENANT_ID);
}

function resolveRoute(route: string, id: string | null): string {
  if (!id) return route;
  return route.replace(':id', id);
}

async function captureScreenshot(page: Page, runId: string, viewport: Viewport, route: string, stepName: string): Promise<string> {
  const routeSlug = route.replace(/\//g, '_').replace(/:/g, '').substring(1) || 'root';
  const filename = `${stepName.replace(/\s+/g, '_').toLowerCase()}.png`;
  const localPath = path.join('screenshots', runId, viewport, routeSlug, filename);

  const dir = path.dirname(localPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  await page.screenshot({ path: localPath, fullPage: false });

  return `ui/${runId}/${viewport}/${routeSlug}/${filename}`;
}

// ============================================================
// SCROLLABILITY & BUFFER CHECKS
// ============================================================

async function checkScrollability(page: Page, primaryActionSelector?: string): Promise<ScrollCheckResult> {
  return page.evaluate(async (selector) => {
    const result: ScrollCheckResult = {
      scrollable: false,
      scrollLocked: false,
      bufferPx: 0,
      primaryActionVisible: false,
      primaryActionReachable: false,
    };

    const viewportHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;

    // Check if page needs scrolling
    if (documentHeight > viewportHeight) {
      const initialScrollY = window.scrollY;

      // Try to scroll
      window.scrollTo(0, 100);
      await new Promise(resolve => setTimeout(resolve, 100));

      if (window.scrollY !== initialScrollY) {
        result.scrollable = true;
        window.scrollTo(0, initialScrollY); // Reset
      } else {
        result.scrollLocked = true;
      }
    }

    // Find lowest actionable element
    const actionSelectors = selector
      ? selector.split(',').map(s => s.trim())
      : [
          'button[type="submit"]',
          '[data-testid*="save"]',
          '[data-testid*="submit"]',
          '[data-testid*="complete"]',
          '[data-testid*="finish"]',
          'form button:last-child',
          'input:last-of-type',
          'textarea:last-of-type',
        ];

    let lowestElement: Element | null = null;
    let lowestBottom = 0;

    for (const sel of actionSelectors) {
      try {
        const elements = document.querySelectorAll(sel);
        elements.forEach(el => {
          const rect = el.getBoundingClientRect();
          const absoluteBottom = rect.bottom + window.scrollY;
          if (absoluteBottom > lowestBottom) {
            lowestBottom = absoluteBottom;
            lowestElement = el;
          }
        });
      } catch {
        // Invalid selector, skip
      }
    }

    if (lowestElement) {
      result.lowestActionableSelector = lowestElement.tagName.toLowerCase() +
        (lowestElement.id ? `#${lowestElement.id}` : '') +
        (lowestElement.className ? `.${lowestElement.className.split(' ')[0]}` : '');

      // Check if element is currently visible
      const rect = lowestElement.getBoundingClientRect();
      result.primaryActionVisible = rect.top >= 0 && rect.bottom <= viewportHeight;

      // Scroll to bottom and check buffer
      window.scrollTo(0, documentHeight - viewportHeight);
      await new Promise(resolve => setTimeout(resolve, 100));

      const rectAfterScroll = lowestElement.getBoundingClientRect();
      result.bufferPx = Math.round(viewportHeight - rectAfterScroll.bottom);
      result.primaryActionReachable = result.bufferPx >= 0;

      // Reset scroll
      window.scrollTo(0, 0);
    }

    return result;
  }, primaryActionSelector);
}

async function checkLayoutIssues(page: Page): Promise<{ overflow: boolean; blankContent: boolean }> {
  return page.evaluate(() => {
    const overflow = document.body.scrollWidth > window.innerWidth;
    const main = document.querySelector('main');
    const blankContent = main ? main.getBoundingClientRect().height < 50 : false;
    return { overflow, blankContent };
  });
}

// ============================================================
// UI IMPROVEMENT SUGGESTIONS
// ============================================================

async function generateUISuggestions(page: Page): Promise<UISuggestion[]> {
  return page.evaluate(() => {
    const suggestions: UISuggestion[] = [];

    // Check for small tap targets (< 44px)
    const buttons = document.querySelectorAll('button, a, [role="button"]');
    let smallTapTargets = 0;
    buttons.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 44 || rect.height < 44) {
        smallTapTargets++;
      }
    });
    if (smallTapTargets > 3) {
      suggestions.push({
        type: 'tap_target',
        message: `${smallTapTargets} interactive elements have tap targets smaller than 44px. Consider increasing size for mobile/glove usability.`,
        priority: 'medium',
      });
    }

    // Check for forms without sticky footer
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
      const rect = form.getBoundingClientRect();
      if (rect.height > window.innerHeight * 0.8) {
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
          const btnRect = submitBtn.getBoundingClientRect();
          const stickyParent = submitBtn.closest('[class*="sticky"], [class*="fixed"]');
          if (!stickyParent && btnRect.bottom > window.innerHeight) {
            suggestions.push({
              type: 'sticky_footer',
              message: 'Long form detected without sticky action bar. Consider adding sticky footer for submit button.',
              priority: 'medium',
            });
          }
        }
      }
    });

    // Check for crowded content (many elements close together)
    const allInteractive = document.querySelectorAll('button, a, input, select, textarea');
    let crowdedPairs = 0;
    const elements = Array.from(allInteractive);
    for (let i = 0; i < elements.length - 1; i++) {
      const rect1 = elements[i].getBoundingClientRect();
      const rect2 = elements[i + 1].getBoundingClientRect();
      const gap = Math.abs(rect2.top - rect1.bottom);
      if (gap < 8 && gap >= 0) {
        crowdedPairs++;
      }
    }
    if (crowdedPairs > 5) {
      suggestions.push({
        type: 'spacing',
        message: `${crowdedPairs} pairs of interactive elements have less than 8px spacing. Consider improving spacing for touch usability.`,
        priority: 'low',
      });
    }

    return suggestions;
  });
}

// ============================================================
// AXE ACCESSIBILITY CHECK
// ============================================================

async function runAxeCheck(page: Page): Promise<AxeViolation[]> {
  try {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();

    return results.violations.map((v) => ({
      id: v.id,
      impact: v.impact || 'unknown',
      description: v.description,
      nodes: v.nodes.length,
    }));
  } catch {
    return [];
  }
}

// ============================================================
// TOUR EXECUTION
// ============================================================

async function executeTourStep(
  page: Page,
  step: TourStep,
  runId: string,
  viewport: Viewport,
  route: string
): Promise<TourStepResult> {
  const stepStartTime = Date.now();
  const result: TourStepResult = {
    step: step.note || step.action,
    action: step.action,
    status: 'pass',
    selector: step.selector,
    value: step.value,
  };

  const timeout = step.timeout || 5000;

  try {
    switch (step.action) {
      // ===========================================
      // ORIGINAL SAFE ACTIONS
      // ===========================================

      case 'click':
        if (step.selector) {
          const clickEl = page.locator(step.selector).first();
          await clickEl.waitFor({ state: 'visible', timeout });
          await clickEl.click({ timeout });
        }
        break;

      case 'openDropdown':
      case 'openModal':
        if (step.selector) {
          await page.click(step.selector, { timeout });
          await page.waitForTimeout(300);
        }
        break;

      case 'type':
        if (step.selector && step.value) {
          await page.fill(step.selector, step.value, { timeout });
        }
        break;

      case 'scroll':
        if (step.value) {
          await page.evaluate((scrollY) => window.scrollTo(0, parseInt(scrollY)), step.value);
        }
        break;

      case 'scrollToBottom':
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(200);
        break;

      case 'scrollToElement':
        if (step.selector) {
          await page.locator(step.selector).first().scrollIntoViewIfNeeded({ timeout });
          await page.waitForTimeout(200);
        }
        break;

      case 'waitFor':
        if (step.selector) {
          await page.waitForSelector(step.selector, { timeout });
        }
        break;

      case 'expectVisible':
        if (step.selector) {
          await expect(page.locator(step.selector).first()).toBeVisible({ timeout });
        }
        break;

      case 'closeModal':
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        break;

      case 'navigateBack':
        await page.goBack({ waitUntil: 'networkidle', timeout: 10000 });
        break;

      case 'screenshot':
        result.screenshot = await captureScreenshot(page, runId, viewport, route, step.note || 'screenshot');
        break;

      case 'pressKey':
        if (step.value) {
          await page.keyboard.press(step.value);
          await page.waitForTimeout(200);
        }
        break;

      // ===========================================
      // DEEP E2E ACTIONS
      // ===========================================

      case 'fill':
        // Clear the field first, then type the value
        if (step.selector && step.value) {
          const fillEl = page.locator(step.selector).first();
          await fillEl.waitFor({ state: 'visible', timeout });
          await fillEl.click({ timeout });
          await fillEl.fill('');
          await fillEl.fill(step.value);
        }
        break;

      case 'clearField':
        if (step.selector) {
          const clearEl = page.locator(step.selector).first();
          await clearEl.waitFor({ state: 'visible', timeout });
          await clearEl.fill('');
        }
        break;

      case 'selectOption':
        // For native <select> elements
        if (step.selector && step.value) {
          await page.selectOption(step.selector, { label: step.value }, { timeout });
        }
        break;

      case 'selectCombobox':
        // For SearchableSelect / Combobox components:
        // 1. Click the trigger to open the popover
        // 2. Type in the search field
        // 3. Click the matching option
        if (step.selector) {
          const comboTrigger = page.locator(step.selector).first();
          await comboTrigger.waitFor({ state: 'visible', timeout });
          await comboTrigger.click({ timeout });
          await page.waitForTimeout(300);

          // Type search value if provided
          if (step.value) {
            // Try to find the search input inside the popover
            const popoverInput = page.locator('[role="listbox"] input, [data-radix-popper-content-wrapper] input, [role="dialog"] input[placeholder*="Search" i], [cmdk-input]').first();
            try {
              await popoverInput.waitFor({ state: 'visible', timeout: 2000 });
              await popoverInput.fill(step.value);
              await page.waitForTimeout(500);
            } catch {
              // No search input - maybe it's a simple dropdown, try typing directly
              await page.keyboard.type(step.value);
              await page.waitForTimeout(500);
            }

            // Click the first matching option
            const option = page.locator(`[role="option"]:has-text("${step.value}"), [role="listbox"] [class*="item"]:has-text("${step.value}"), [data-radix-popper-content-wrapper] [class*="item"]:has-text("${step.value}")`).first();
            try {
              await option.waitFor({ state: 'visible', timeout: 3000 });
              await option.click({ timeout: 3000 });
            } catch {
              // If no option found, try pressing Enter
              await page.keyboard.press('Enter');
            }
          }
          await page.waitForTimeout(200);
        }
        break;

      case 'clickByText':
        if (step.value) {
          const textEl = page.locator(`button:has-text("${step.value}"), a:has-text("${step.value}"), [role="button"]:has-text("${step.value}"), [role="menuitem"]:has-text("${step.value}")`).first();
          await textEl.waitFor({ state: 'visible', timeout });
          await textEl.click({ timeout });
        }
        break;

      case 'uploadFile':
        // Attach a file to an <input type="file">
        if (step.selector && step.value) {
          const fileInput = page.locator(step.selector).first();
          // File inputs may be hidden; use setInputFiles which handles that
          await fileInput.setInputFiles(step.value);
        }
        break;

      case 'assertText':
        // Assert that a selector contains specific text
        if (step.selector && step.value) {
          const textContainer = page.locator(step.selector).first();
          await expect(textContainer).toContainText(step.value, { timeout });
        }
        break;

      case 'assertVisible':
        if (step.selector) {
          await expect(page.locator(step.selector).first()).toBeVisible({ timeout });
        }
        break;

      case 'assertHidden':
        if (step.selector) {
          await expect(page.locator(step.selector).first()).not.toBeVisible({ timeout });
        }
        break;

      case 'assertUrl':
        if (step.value) {
          await expect(page).toHaveURL(new RegExp(step.value), { timeout });
        }
        break;

      case 'assertToast':
        // Wait for a toast notification containing specific text
        if (step.value) {
          const toast = page.locator(`[data-sonner-toast], [class*="toast"], [role="status"], [data-radix-toast-viewport] > *`).filter({ hasText: step.value }).first();
          await toast.waitFor({ state: 'visible', timeout: timeout || 10000 });
        }
        break;

      case 'assertCount':
        if (step.selector && step.count !== undefined) {
          const count = await page.locator(step.selector).count();
          expect(count).toBe(step.count);
        }
        break;

      case 'submitForm':
        // Click a submit button and wait for either a navigation or a toast
        if (step.selector) {
          const submitBtn = page.locator(step.selector).first();
          await submitBtn.waitFor({ state: 'visible', timeout });

          // Set up a race: either URL changes or a toast appears
          const currentUrl = page.url();
          await submitBtn.click({ timeout });

          // Wait for either navigation or toast
          try {
            if (step.value) {
              // Wait for success toast
              const successToast = page.locator(`[data-sonner-toast], [class*="toast"], [role="status"]`).filter({ hasText: step.value }).first();
              await Promise.race([
                successToast.waitFor({ state: 'visible', timeout: 15000 }),
                page.waitForURL((url) => url.toString() !== currentUrl, { timeout: 15000 }),
              ]);
            } else {
              await page.waitForURL((url) => url.toString() !== currentUrl, { timeout: 15000 });
            }
          } catch {
            // Acceptable - some forms don't navigate or show toasts
          }
          await page.waitForTimeout(500);
        }
        break;

      case 'navigate':
        if (step.value) {
          // If using stored value, resolve it
          let url = step.value;
          if (step.storeKey && sharedContext.has(step.storeKey)) {
            url = sharedContext.get(step.storeKey)!;
          }
          if (!url.startsWith('http')) {
            url = `${APP_BASE_URL}${url}`;
          }
          await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        }
        break;

      case 'storeValue':
        // Store a value from the page into the shared context
        if (step.storeKey) {
          if (step.selector === 'window.location.pathname') {
            const pathname = new URL(page.url()).pathname;
            sharedContext.set(step.storeKey, pathname);
          } else if (step.selector) {
            const el = page.locator(step.selector).first();
            const text = await el.textContent({ timeout });
            if (text) sharedContext.set(step.storeKey, text.trim());
          }
        }
        break;

      case 'useStoredValue':
        // Navigate to a stored URL or use stored value in the current context
        if (step.storeKey) {
          const stored = sharedContext.get(step.storeKey);
          if (stored) {
            const navUrl = stored.startsWith('http') ? stored : `${APP_BASE_URL}${stored}`;
            await page.goto(navUrl, { waitUntil: 'networkidle', timeout: 30000 });
          }
        }
        break;

      case 'waitForNavigation':
        await page.waitForURL((url) => true, { timeout: timeout || 10000, waitUntil: 'networkidle' });
        break;

      case 'waitForNetwork':
        await page.waitForLoadState('networkidle', { timeout: timeout || 15000 });
        break;

      case 'checkCheckbox':
        if (step.selector) {
          const checkbox = page.locator(step.selector).first();
          await checkbox.waitFor({ state: 'visible', timeout });
          if (!(await checkbox.isChecked())) {
            await checkbox.check({ timeout });
          }
        }
        break;

      case 'uncheckCheckbox':
        if (step.selector) {
          const uncheckbox = page.locator(step.selector).first();
          await uncheckbox.waitFor({ state: 'visible', timeout });
          if (await uncheckbox.isChecked()) {
            await uncheckbox.uncheck({ timeout });
          }
        }
        break;

      case 'toggleSwitch':
        if (step.selector) {
          const switchEl = page.locator(step.selector).first();
          await switchEl.waitFor({ state: 'visible', timeout });
          await switchEl.click({ timeout });
        }
        break;

      case 'selectTab':
        // Click a tab by text content
        if (step.value) {
          const tab = step.selector
            ? page.locator(step.selector).filter({ hasText: step.value }).first()
            : page.locator(`[role="tab"]:has-text("${step.value}")`).first();
          await tab.waitFor({ state: 'visible', timeout });
          await tab.click({ timeout });
          await page.waitForTimeout(300);
        }
        break;

      case 'selectDate':
        // Fill a date input
        if (step.selector && step.value) {
          const dateInput = page.locator(step.selector).first();
          await dateInput.waitFor({ state: 'visible', timeout });
          await dateInput.fill(step.value);
        }
        break;

      case 'clickTableRow':
        // Click a table row that contains specific text
        if (step.value) {
          const row = step.selector
            ? page.locator(step.selector).filter({ hasText: step.value }).first()
            : page.locator(`table tbody tr:has-text("${step.value}")`).first();
          await row.waitFor({ state: 'visible', timeout });
          await row.click({ timeout });
        }
        break;

      case 'dragAndDrop':
        if (step.selector && step.targetSelector) {
          const source = page.locator(step.selector).first();
          const target = page.locator(step.targetSelector).first();
          await source.dragTo(target, { timeout });
        }
        break;

      case 'pause':
        await page.waitForTimeout(step.count || 1000);
        break;
    }

    if (step.screenshotAfter) {
      result.screenshot = await captureScreenshot(page, runId, viewport, route, `after_${step.note || step.action}`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    result.durationMs = Date.now() - stepStartTime;
    try { result.pageUrl = page.url(); } catch { /* page may be closed */ }

    if (step.optional) {
      result.status = 'skip';
      result.error = errorMsg;

      if (step.selector && error instanceof Error && error.message.includes('locator')) {
        const existing = missingTestIds.get(step.selector);
        if (existing) {
          existing.count++;
        } else {
          missingTestIds.set(step.selector, { route, count: 1 });
        }
      }

      skippedSteps.push({
        route,
        step: step.note || step.action,
        reason: result.error,
      });
    } else {
      result.status = 'fail';
      result.error = errorMsg;
    }
  }

  if (result.status === 'pass') {
    result.durationMs = Date.now() - stepStartTime;
  }

  return result;
}

async function runTour(
  page: Page,
  tour: PageTour,
  runId: string,
  viewport: Viewport
): Promise<{ stepResults: TourStepResult[]; artifacts: string[] }> {
  const stepResults: TourStepResult[] = [];
  const artifacts: string[] = [];

  let resolvedRoute = tour.route;
  if (tour.requiresId) {
    const id = await getDynamicIdForRoute(tour.route);
    if (id) {
      resolvedRoute = resolveRoute(tour.route, id);
    } else {
      return {
        stepResults: [{ step: 'setup', action: 'getDynamicId', status: 'skip', error: 'No ID found for route' }],
        artifacts: [],
      };
    }
  }

  try {
    await page.goto(`${APP_BASE_URL}${resolvedRoute}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
  } catch (error) {
    return {
      stepResults: [{ step: 'navigation', action: 'goto', status: 'fail', error: error instanceof Error ? error.message : 'Navigation failed' }],
      artifacts: [],
    };
  }

  for (const step of tour.steps) {
    const result = await executeTourStep(page, step, runId, viewport, tour.route);
    stepResults.push(result);
    if (result.screenshot) {
      artifacts.push(result.screenshot);
    }

    if (result.status === 'fail' && !step.optional) {
      break;
    }
  }

  return { stepResults, artifacts };
}

// ============================================================
// MAIN TEST FUNCTION
// ============================================================

async function testRoute(
  page: Page,
  route: string,
  viewport: Viewport,
  tour?: PageTour
): Promise<TestResult> {
  const startedAt = new Date().toISOString();
  const priority = tour?.priority || 'P2';
  const consoleErrors: string[] = [];
  const exceptions: string[] = [];
  const networkFailures: string[] = [];
  const issues: UIIssue[] = [];
  let stepResults: TourStepResult[] = [];
  let artifacts: string[] = [];
  let suggestions: UISuggestion[] = [];

  // Event listeners
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (error) => {
    exceptions.push(error.message);
  });

  page.on('requestfailed', (request) => {
    networkFailures.push(`${request.method()} ${request.url()} - ${request.failure()?.errorText}`);
  });

  try {
    if (tour) {
      const tourResult = await runTour(page, tour, runId, viewport);
      stepResults = tourResult.stepResults;
      artifacts = tourResult.artifacts;
    } else {
      let resolvedRoute = route;
      if (route.includes(':id')) {
        const id = await getDynamicIdForRoute(route);
        if (id) {
          resolvedRoute = resolveRoute(route, id);
        } else {
          return {
            suite: 'ui_visual_qa',
            test_name: `${route} (${viewport})`,
            route,
            viewport,
            priority,
            status: 'skip',
            error_message: 'No dynamic ID available for route',
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            details: {
              issues: [],
              suggestions: [],
              overflow: false,
              scrollable: false,
              consoleErrors: [],
              exceptions: [],
              networkFailures: [],
              axeViolations: [],
              artifacts: [],
              tourSteps: [],
              fileHints: getFileHintsForRoute(route)?.files || [],
            },
          };
        }
      }

      await page.goto(`${APP_BASE_URL}${resolvedRoute}`, { waitUntil: 'networkidle', timeout: 30000 });
      const screenshot = await captureScreenshot(page, runId, viewport, route, 'initial');
      artifacts.push(screenshot);
    }

    // Layout checks
    const layoutIssues = await checkLayoutIssues(page);

    if (layoutIssues.overflow) {
      issues.push({
        code: ERROR_CODES.HORIZONTAL_OVERFLOW,
        message: 'Horizontal overflow detected - content extends beyond viewport width',
      });
    }

    if (layoutIssues.blankContent) {
      issues.push({
        code: ERROR_CODES.BLANK_CONTENT,
        message: 'Main content area appears blank or has very small height',
      });
    }

    // Scroll and buffer checks (P0 and P1 only)
    let scrollResult: ScrollCheckResult | undefined;
    if (shouldCheckScrollBuffer(priority)) {
      scrollResult = await checkScrollability(page, tour?.primaryActionSelector);

      if (scrollResult.scrollLocked) {
        issues.push({
          code: ERROR_CODES.SCROLL_LOCKED,
          message: 'Page content exceeds viewport but scrolling is locked',
        });
      }

      if (scrollResult.bufferPx < MIN_SCROLL_BUFFER_PX && scrollResult.lowestActionableSelector) {
        issues.push({
          code: ERROR_CODES.INSUFFICIENT_SCROLL_BUFFER,
          message: `Scroll buffer is ${scrollResult.bufferPx}px, minimum required is ${MIN_SCROLL_BUFFER_PX}px for glove-friendly usability`,
          selector: scrollResult.lowestActionableSelector,
          measuredValue: scrollResult.bufferPx,
          expectedValue: IDEAL_SCROLL_BUFFER_PX,
        });
      }

      if (!scrollResult.primaryActionReachable && tour?.primaryActionSelector) {
        issues.push({
          code: ERROR_CODES.PRIMARY_ACTION_NOT_REACHABLE,
          message: 'Primary action button is not reachable after scrolling to bottom',
          selector: tour.primaryActionSelector,
        });
      }
    }

    // Accessibility check
    const axeViolations = await runAxeCheck(page);
    const criticalAxe = axeViolations.filter(v => v.impact === 'critical');
    const seriousAxe = axeViolations.filter(v => v.impact === 'serious');

    if (criticalAxe.length > 0) {
      issues.push({
        code: ERROR_CODES.AXE_CRITICAL,
        message: `${criticalAxe.length} critical accessibility violation(s): ${criticalAxe.map(v => v.id).join(', ')}`,
      });
    }

    if (seriousAxe.length > 0) {
      issues.push({
        code: ERROR_CODES.AXE_SERIOUS,
        message: `${seriousAxe.length} serious accessibility violation(s): ${seriousAxe.map(v => v.id).join(', ')}`,
      });
    }

    // Console/network errors — include actual error text for fix prompts
    if (consoleErrors.length > 0) {
      const errorSummary = consoleErrors.slice(0, 10).join('\n');
      issues.push({
        code: ERROR_CODES.CONSOLE_ERROR,
        message: `${consoleErrors.length} console error(s) detected:\n${errorSummary}`,
      });
    }

    if (exceptions.length > 0) {
      const exceptionSummary = exceptions.slice(0, 5).join('\n');
      issues.push({
        code: ERROR_CODES.UNCAUGHT_EXCEPTION,
        message: `${exceptions.length} uncaught exception(s) detected:\n${exceptionSummary}`,
      });
    }

    if (networkFailures.length > 0) {
      const nfSummary = networkFailures.slice(0, 10).join('\n');
      issues.push({
        code: ERROR_CODES.NETWORK_FAILURE,
        message: `${networkFailures.length} network request failure(s) detected:\n${nfSummary}`,
      });
    }

    // Tour step failures — include selector, error message, and page URL for debugging
    const failedSteps = stepResults.filter(s => s.status === 'fail');
    if (failedSteps.length > 0) {
      const stepDetails = failedSteps.map(s => {
        const parts = [s.step];
        if (s.selector) parts.push(`selector="${s.selector}"`);
        if (s.error) parts.push(`error: ${s.error}`);
        if (s.pageUrl) parts.push(`url: ${s.pageUrl}`);
        return parts.join(' | ');
      });
      issues.push({
        code: ERROR_CODES.TOUR_STEP_FAILED,
        message: `${failedSteps.length} tour step(s) failed:\n${stepDetails.join('\n')}`,
      });
    }

    // Generate UI suggestions (P0 and P1 only)
    if (shouldCheckScrollBuffer(priority)) {
      suggestions = await generateUISuggestions(page);
    }

    // Determine overall status
    const hasFailingIssues = issues.length > 0;
    const status: 'pass' | 'fail' | 'skip' = hasFailingIssues ? 'fail' : 'pass';
    let errorMessage: string | undefined;

    if (hasFailingIssues) {
      errorMessage = issues.map(i => `[${i.code}] ${i.message}`).join('; ');
    }

    return {
      suite: 'ui_visual_qa',
      test_name: `${route} (${viewport})`,
      route,
      viewport,
      priority,
      status,
      error_message: errorMessage,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      details: {
        issues,
        suggestions,
        overflow: layoutIssues.overflow,
        scrollable: scrollResult?.scrollable || false,
        scrollBufferPx: scrollResult?.bufferPx,
        primaryActionReachable: scrollResult?.primaryActionReachable,
        consoleErrors,
        exceptions,
        networkFailures,
        axeViolations,
        artifacts,
        tourSteps: stepResults,
        fileHints: getFileHintsForRoute(route)?.files || [],
      },
    };
  } catch (error) {
    return {
      suite: 'ui_visual_qa',
      test_name: `${route} (${viewport})`,
      route,
      viewport,
      priority,
      status: 'fail',
      error_message: error instanceof Error ? error.message : 'Unknown error',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      details: {
        issues,
        suggestions: [],
        overflow: false,
        scrollable: false,
        consoleErrors,
        exceptions,
        networkFailures,
        axeViolations: [],
        artifacts,
        tourSteps: stepResults,
        fileHints: getFileHintsForRoute(route)?.files || [],
      },
    };
  }
}

// ============================================================
// RESULTS PERSISTENCE
// ============================================================

async function saveResultsToSupabase(results: TestResult[], runId: string, coverageReport: TourCoverageReport): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.log('Supabase not configured, skipping database save');
    return;
  }
  if (!QA_TENANT_ID) {
    console.log('QA_TENANT_ID is not configured, skipping database save');
    return;
  }

  try {
    const executedBy = await resolveExecutedByUserId();
    if (!executedBy) {
      console.log('Could not resolve executed_by user, skipping database save');
      return;
    }

    const p0Failures = results.filter(r => r.priority === 'P0' && r.status === 'fail');
    const runStatus = p0Failures.length > 0 ? 'failed' : results.some(r => r.status === 'fail') ? 'completed' : 'completed';

    const { error: runError } = await supabase
      .from('qa_test_runs')
      .insert({
        id: runId,
        tenant_id: QA_TENANT_ID,
        executed_by: executedBy,
        status: runStatus,
        suites_requested: ['ui_visual_qa'],
        mode: 'create_cleanup',
        pass_count: results.filter(r => r.status === 'pass').length,
        fail_count: results.filter(r => r.status === 'fail').length,
        skip_count: results.filter(r => r.status === 'skip').length,
        finished_at: new Date().toISOString(),
        metadata: {
          viewports: VIEWPORTS,
          totalRoutes: coverageReport.totalRoutes,
          coveragePercent: coverageReport.coveragePercent,
          p0Failures: p0Failures.length,
          p1Failures: results.filter(r => r.priority === 'P1' && r.status === 'fail').length,
        },
      });

    if (runError) {
      console.error('Error creating test run:', runError);
      return;
    }

    for (const result of results) {
      await supabase.from('qa_test_results').insert({
        run_id: runId,
        tenant_id: QA_TENANT_ID,
        suite: result.suite,
        test_name: result.test_name,
        status: result.status,
        error_message: result.error_message,
        started_at: result.started_at,
        finished_at: result.finished_at,
        details: result.details,
      });
    }

    await supabase.from('qa_test_results').insert({
      run_id: runId,
      tenant_id: QA_TENANT_ID,
      suite: 'ui_visual_qa',
      test_name: 'tour_coverage',
      status: 'pass',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      details: coverageReport,
    });

    console.log(`Results saved to Supabase. Run ID: ${runId}`);
  } catch (error) {
    console.error('Error saving to Supabase:', error);
  }
}

function generateCoverageReport(): TourCoverageReport {
  const selectedDeepTours = getSelectedDeepTours();
  const allTours = [...SELECTED_PAGE_TOURS, ...selectedDeepTours];
  const allRoutes = ROUTE_FILTER
    ? getAllRoutes().filter((r) => ROUTE_FILTER.some((token) => routeTokenMatchesTour(token, r)))
    : getAllRoutes();
  const routesWithTours = [...new Set(allTours.map(t => t.route))];
  const routesWithoutTours = allRoutes.filter(r => !routesWithTours.includes(r));

  const missingTestIdsList = Array.from(missingTestIds.entries())
    .map(([selector, info]) => ({ selector, route: info.route, count: info.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return {
    totalRoutes: allRoutes.length,
    routesWithTours: routesWithTours.length,
    routesWithoutTours,
    missingTestIds: missingTestIdsList,
    skippedSteps,
    coveragePercent: allRoutes.length === 0 ? 0 : Math.round((routesWithTours.length / allRoutes.length) * 100),
    p0Count: allTours.filter(t => t.priority === 'P0').length,
    p1Count: allTours.filter(t => t.priority === 'P1').length,
    p2Count: allTours.filter(t => t.priority === 'P2').length,
  };
}

// ============================================================
// TESTS
// ============================================================

test.describe('UI Visual QA', () => {
  test.beforeAll(async ({ browser }) => {
    runId = generateRunId();
    console.log(`Starting UI Visual QA run: ${runId}`);

    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      supabase = await createSupabaseClient();
    }

    adminContext = await browser.newContext();
    clientContext = await browser.newContext();

    const adminPage = await adminContext.newPage();
    const adminLoggedIn = await loginUser(adminPage, QA_ADMIN_EMAIL, QA_ADMIN_PASSWORD, false);
    if (!adminLoggedIn) {
      console.error('Admin login failed');
    }
    await adminPage.close();

    if (QA_CLIENT_EMAIL && QA_CLIENT_PASSWORD) {
      const clientPage = await clientContext.newPage();
      const clientLoggedIn = await loginUser(clientPage, QA_CLIENT_EMAIL, QA_CLIENT_PASSWORD, true);
      if (!clientLoggedIn) {
        console.error('Client login failed');
      }
      await clientPage.close();
    }
  });

  test.afterAll(async () => {
    if (!runId) runId = generateRunId();

    const coverageReport = generateCoverageReport();
    await saveResultsToSupabase(testResults, runId, coverageReport);

    const reportPath = path.join('screenshots', runId, 'tour_coverage.json');
    const dir = path.dirname(reportPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(reportPath, JSON.stringify(coverageReport, null, 2));

    await adminContext?.close();
    await clientContext?.close();
  });

  // Generate tests for each selected tour; viewport is derived from Playwright project
  for (const tour of SELECTED_PAGE_TOURS) {
    test(`[${tour.priority}] ${tour.name}`, async (_fixtures, testInfo) => {
      const viewport = resolveProjectViewport(testInfo.project.name);
      const context = tour.roleContext === 'client' ? clientContext : adminContext;
      const page = await context.newPage();

      try {
        const result = await testRoute(page, tour.route, viewport, tour);
        testResults.push(result);

        // For P0 failures, fail the test hard
        if (result.status === 'fail' && shouldFailRun(tour.priority)) {
          expect(result.error_message).toBeUndefined();
        } else if (result.status === 'fail') {
          // P1/P2 failures are soft
          expect.soft(result.error_message).toBeUndefined();
        }
      } finally {
        await page.close();
      }
    });
  }

  // Route-only screenshots run only for "all routes" mode to keep targeted runs fast.
  if (!ROUTE_FILTER) {
    const routesWithTours = new Set(SELECTED_PAGE_TOURS.map((t) => t.route));
    const routesWithoutTours = getAllRoutes().filter((r) => !routesWithTours.has(r));

    for (const route of routesWithoutTours.slice(0, 10)) {
      test(`[P2] Route-only: ${route}`, async (_fixtures, testInfo) => {
        const viewport = resolveProjectViewport(testInfo.project.name);
        const page = await adminContext.newPage();

        try {
          const result = await testRoute(page, route, viewport);
          testResults.push(result);

          if (result.status === 'fail') {
            expect.soft(result.error_message).toBeUndefined();
          }
        } finally {
          await page.close();
        }
      });
    }
  } else {
    // If a ROUTES filter yields zero tours (and deep is disabled or has no matches),
    // ensure we still register runnable tests rather than failing with "No tests found".
    const selectedDeepTours = getSelectedDeepTours();
    const hasAnyTours = SELECTED_PAGE_TOURS.length > 0 || selectedDeepTours.length > 0;

    if (!hasAnyTours) {
      const scopedRoutes = getAllRoutes().filter((r) => ROUTE_FILTER.some((token) => routeTokenMatchesTour(token, r)));

      if (scopedRoutes.length === 0) {
        test('[P2] ROUTES filter: no matching tours or routes', async () => {
          test.skip(true, 'ROUTES filter did not match any defined tours or known routes.');
        });
      } else {
        for (const route of scopedRoutes.slice(0, 10)) {
          test(`[P2] Route-only (scoped): ${route}`, async (_fixtures, testInfo) => {
            const viewport = resolveProjectViewport(testInfo.project.name);
            const page = await adminContext.newPage();

            try {
              const result = await testRoute(page, route, viewport);
              testResults.push(result);

              if (result.status === 'fail') {
                expect.soft(result.error_message).toBeUndefined();
              }
            } finally {
              await page.close();
            }
          });
        }
      }
    }
  }
});

// ============================================================
// DEEP E2E TESTS
// ============================================================
// These tests create real data, fill forms, upload photos, and exercise
// the full application lifecycle through the UI. They run sequentially
// in dependency order and only on desktop viewport (deep tests focus on
// functional correctness, not responsive layout).
//
// Enable with: QA_DEEP_MODE=true
// Filter by tags: QA_DEEP_TAGS=shipments,tasks
// ============================================================

test.describe('Deep E2E QA', () => {
  // Only run when DEEP_MODE is enabled
  test.skip(!DEEP_MODE, 'Deep E2E tests are disabled. Set QA_DEEP_MODE=true to enable.');
  test.skip((_fixtures, testInfo) => resolveProjectViewport(testInfo.project.name) !== 'desktop', 'Deep E2E tests run only on desktop project.');

  // Deep tests must run sequentially (they depend on each other)
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    if (!DEEP_MODE) return;

    // Reuse or create contexts
    if (!runId) runId = generateRunId();
    console.log(`Starting Deep E2E QA run: ${runId}`);

    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && !supabase) {
      supabase = await createSupabaseClient();
    }

    if (!adminContext) adminContext = await browser.newContext();
    if (!clientContext) clientContext = await browser.newContext();

    // Login admin
    const adminPage = await adminContext.newPage();
    const adminLoggedIn = await loginUser(adminPage, QA_ADMIN_EMAIL, QA_ADMIN_PASSWORD, false);
    if (!adminLoggedIn) console.error('Deep E2E: Admin login failed');
    await adminPage.close();

    // Login client
    if (QA_CLIENT_EMAIL && QA_CLIENT_PASSWORD) {
      const clientPage = await clientContext.newPage();
      const clientLoggedIn = await loginUser(clientPage, QA_CLIENT_EMAIL, QA_CLIENT_PASSWORD, true);
      if (!clientLoggedIn) console.error('Deep E2E: Client login failed');
      await clientPage.close();
    }

    // Clear shared context for a fresh run
    sharedContext.clear();
  });

  test.afterAll(async () => {
    if (!DEEP_MODE) return;
    if (!runId) runId = generateRunId();

    const coverageReport = generateCoverageReport();
    await saveResultsToSupabase(testResults, runId, coverageReport);

    const reportPath = path.join('screenshots', runId, 'deep_e2e_results.json');
    const dir = path.dirname(reportPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const deepResults = testResults.filter(r => r.suite === 'deep_e2e');
    fs.writeFileSync(reportPath, JSON.stringify({
      runId,
      mode: 'deep',
      totalTests: deepResults.length,
      passed: deepResults.filter(r => r.status === 'pass').length,
      failed: deepResults.filter(r => r.status === 'fail').length,
      skipped: deepResults.filter(r => r.status === 'skip').length,
      results: deepResults,
      sharedContext: Object.fromEntries(sharedContext),
    }, null, 2));

    console.log(`Deep E2E results saved. Pass: ${deepResults.filter(r => r.status === 'pass').length}, Fail: ${deepResults.filter(r => r.status === 'fail').length}`);
  });

  // Generate deep tests in dependency order, desktop only
  const filteredDeepTours = getSelectedDeepTours();

  for (const tour of filteredDeepTours) {
    test(`[DEEP][${tour.priority}] ${tour.name}`, async () => {
      const context = tour.roleContext === 'client' ? clientContext : adminContext;
      const page = await context.newPage();

      // Increase timeout for deep tests (they do real CRUD operations)
      test.setTimeout(120_000);

      try {
        const startedAt = new Date().toISOString();
        const consoleErrors: string[] = [];
        const exceptions: string[] = [];
        const networkFailures: string[] = [];
        const stepResults: TourStepResult[] = [];
        const artifacts: string[] = [];

        // Capture errors
        page.on('console', (msg) => {
          if (msg.type() === 'error') consoleErrors.push(msg.text());
        });
        page.on('pageerror', (error) => {
          exceptions.push(error.message);
        });
        page.on('requestfailed', (request) => {
          networkFailures.push(`${request.method()} ${request.url()} - ${request.failure()?.errorText}`);
        });

        // Execute tour steps
        for (const step of tour.steps) {
          const stepResult = await executeTourStep(page, step, runId, 'desktop', tour.route);
          stepResults.push(stepResult);
          if (stepResult.screenshot) artifacts.push(stepResult.screenshot);

          // For deep tours, stop on non-optional failures
          if (stepResult.status === 'fail' && !step.optional) {
            break;
          }
        }

        const failedSteps = stepResults.filter(s => s.status === 'fail');
        const issues: UIIssue[] = [];

        if (failedSteps.length > 0) {
          // Include the actual error messages in the issue for richer fix prompts
          const stepDetails = failedSteps.map(s => {
            const parts = [s.step];
            if (s.selector) parts.push(`selector="${s.selector}"`);
            if (s.error) parts.push(`error: ${s.error}`);
            if (s.pageUrl) parts.push(`url: ${s.pageUrl}`);
            return parts.join(' | ');
          });
          issues.push({
            code: ERROR_CODES.TOUR_STEP_FAILED,
            message: `${failedSteps.length} deep E2E step(s) failed:\n${stepDetails.join('\n')}`,
          });
        }

        if (consoleErrors.length > 0) {
          // Include actual error texts (up to 10) for debugging
          const errorSummary = consoleErrors.slice(0, 10).join('\n');
          issues.push({
            code: ERROR_CODES.CONSOLE_ERROR,
            message: `${consoleErrors.length} console error(s) during deep test:\n${errorSummary}`,
          });
        }

        if (exceptions.length > 0) {
          const exceptionSummary = exceptions.slice(0, 5).join('\n');
          issues.push({
            code: ERROR_CODES.UNCAUGHT_EXCEPTION,
            message: `${exceptions.length} uncaught exception(s) during deep test:\n${exceptionSummary}`,
          });
        }

        if (networkFailures.length > 0) {
          const nfSummary = networkFailures.slice(0, 10).join('\n');
          issues.push({
            code: ERROR_CODES.NETWORK_FAILURE,
            message: `${networkFailures.length} network failure(s) during deep test:\n${nfSummary}`,
          });
        }

        const testResult: TestResult = {
          suite: 'deep_e2e',
          test_name: tour.name,
          route: tour.route,
          viewport: 'desktop',
          priority: tour.priority,
          status: issues.length > 0 ? 'fail' : 'pass',
          error_message: issues.length > 0 ? issues.map(i => `[${i.code}] ${i.message}`).join('; ') : undefined,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          details: {
            issues,
            suggestions: [],
            overflow: false,
            scrollable: false,
            consoleErrors,
            exceptions,
            networkFailures,
            axeViolations: [],
            artifacts,
            tourSteps: stepResults,
            fileHints: getFileHintsForRoute(tour.route)?.files || [],
          },
        };

        testResults.push(testResult);

        // P0 deep test failures fail the run
        if (testResult.status === 'fail' && shouldFailRun(tour.priority)) {
          expect(testResult.error_message).toBeUndefined();
        } else if (testResult.status === 'fail') {
          expect.soft(testResult.error_message).toBeUndefined();
        }
      } finally {
        await page.close();
      }
    });
  }
});
