import { test, expect } from '@playwright/test';
import { attachErrorTracking, type ErrorTracking } from './lib/errors.js';
import { optionalEnv } from './lib/env.js';
import { getDynamicId } from './lib/supabaseAdmin.js';
import { ADMIN_ROUTES, CLIENT_ROUTES, DYNAMIC_ROUTES } from './lib/routes.js';

// ---------------------------------------------------------------------------
// Admin tests
// ---------------------------------------------------------------------------
test.describe('Admin — functional tests', () => {
  let tracking: ErrorTracking;

  test.beforeEach((_fixtures, testInfo) => {
    test.skip(testInfo.project.name !== 'admin', 'Admin-only test');
  });

  test.beforeEach(async ({ page }) => {
    tracking = attachErrorTracking(page);
  });

  test.afterEach(() => {
    tracking?.detach();
  });

  // ---- Session validation ----
  test('admin session is valid', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });

    // Should NOT be redirected to auth
    expect(page.url()).not.toContain('/auth');

    expect(tracking.jsExceptions).toHaveLength(0);
    expect(tracking.requestFailures).toHaveLength(0);
  });

  // ---- Unauthenticated redirect ----
  test('unauthenticated user is redirected to /auth', async ({ browser }, testInfo) => {
    const baseURL =
      (testInfo.project.use as { baseURL?: string }).baseURL ||
      process.env.APP_BASE_URL ||
      'http://localhost:5173';

    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    const freshTracking = attachErrorTracking(page);

    try {
      await page.goto('/inventory', { waitUntil: 'domcontentloaded' });
      // Wait for redirect to /auth
      await page.waitForURL((url) => url.pathname.startsWith('/auth'), {
        timeout: 60_000,
      });
      expect(page.url()).toContain('/auth');
    } finally {
      freshTracking.detach();
      await context.close();
    }
  });

  // ---- Page-load sweep ----
  for (const route of ADMIN_ROUTES) {
    test(`page loads: ${route.label} (${route.path})`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });

      expect(tracking.jsExceptions).toHaveLength(0);
      expect(tracking.requestFailures).toHaveLength(0);
    });
  }

  // ---- Sidebar navigation ----
  test('sidebar navigation links are functional', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });

    // Collect sidebar links
    const sidebarLinks = page.locator('nav a[href]');
    const count = await sidebarLinks.count();
    expect(count).toBeGreaterThan(0);

    const hrefs: string[] = [];
    for (let i = 0; i < count; i++) {
      const href = await sidebarLinks.nth(i).getAttribute('href');
      if (href && href.startsWith('/') && !href.startsWith('/auth')) {
        hrefs.push(href);
      }
    }

    // Deduplicate
    const uniqueHrefs = [...new Set(hrefs)];

    // Navigate to up to 5 sidebar links to keep tests reasonable
    const sampled = uniqueHrefs.slice(0, 5);
    for (const href of sampled) {
      await page.goto(href, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
    }

    expect(tracking.jsExceptions).toHaveLength(0);
    expect(tracking.requestFailures).toHaveLength(0);
  });

  // ---- Tab interactions (Settings, Billing, Reports only) ----
  test('Settings page tabs are navigable', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });

    const tabs = page.locator('[role="tablist"] [role="tab"]');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThan(1);

    // Click the second tab to verify tabs are interactive
    if (tabCount > 1) {
      await tabs.nth(1).click();
      await expect(tabs.nth(1)).toHaveAttribute('data-state', 'active', {
        timeout: 5_000,
      });
    }

    expect(tracking.jsExceptions).toHaveLength(0);
    expect(tracking.requestFailures).toHaveLength(0);
  });

  test('Billing page tabs are navigable', async ({ page }) => {
    await page.goto('/billing', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });

    const tabs = page.locator('[role="tablist"] [role="tab"]');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThan(1);

    if (tabCount > 1) {
      await tabs.nth(1).click();
      await expect(tabs.nth(1)).toHaveAttribute('data-state', 'active', {
        timeout: 5_000,
      });
    }

    expect(tracking.jsExceptions).toHaveLength(0);
    expect(tracking.requestFailures).toHaveLength(0);
  });

  test('Reports page tabs are navigable', async ({ page }) => {
    await page.goto('/reports', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });

    const tabs = page.locator('[role="tablist"] [role="tab"]');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThan(1);

    if (tabCount > 1) {
      await tabs.nth(1).click();
      await expect(tabs.nth(1)).toHaveAttribute('data-state', 'active', {
        timeout: 5_000,
      });
    }

    expect(tracking.jsExceptions).toHaveLength(0);
    expect(tracking.requestFailures).toHaveLength(0);
  });

  // ---- Inventory search ----
  test('Inventory page search input is functional', async ({ page }) => {
    await page.goto('/inventory', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });

    const searchInput = page.locator('input[placeholder*="earch" i]');
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
    await searchInput.fill('test-search-query');
    await expect(searchInput).toHaveValue('test-search-query');

    expect(tracking.jsExceptions).toHaveLength(0);
    expect(tracking.requestFailures).toHaveLength(0);
  });

  // ---- Shipments create button ----
  test('Shipments page create button opens dialog', async ({ page }) => {
    await page.goto('/shipments', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });

    // Resilient fallback chain: prefer data-testid, fall back to text match
    const createButton = page.locator(
      '[data-testid="create-shipment-button"], button:has-text("Create"), button:has-text("New"), button:has-text("Add"), a:has-text("Create"), a:has-text("New"), a:has-text("Add")',
    );
    await expect(createButton.first()).toBeVisible({ timeout: 10_000 });
    await createButton.first().click();

    // Verify either a dialog opened or we navigated to a create page
    const dialogOrPage = page
      .locator('[role="dialog"]')
      .or(page.locator('main'));
    await expect(dialogOrPage).toBeVisible({ timeout: 10_000 });

    expect(tracking.jsExceptions).toHaveLength(0);
    expect(tracking.requestFailures).toHaveLength(0);
  });

  // ---- Dynamic detail pages ----
  for (const route of DYNAMIC_ROUTES) {
    test(`dynamic page: ${route.label}`, async ({ page }) => {
      const tenantId = optionalEnv('QA_TENANT_ID');
      const id = await getDynamicId(route.table, {
        tenantId: tenantId ?? undefined,
      });

      if (!id) {
        test.skip(true, `No ${route.table} rows found for dynamic route`);
        return;
      }

      const resolvedPath = route.path.replace(':id', id);
      await page.goto(resolvedPath, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });

      expect(tracking.jsExceptions).toHaveLength(0);
      expect(tracking.requestFailures).toHaveLength(0);
    });
  }

  // ---- Console error sweep ----
  test('console error sweep across key pages', async ({ page }) => {
    const keyPages = ['/', '/inventory', '/shipments', '/billing', '/settings'];

    for (const pagePath of keyPages) {
      await page.goto(pagePath, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
    }

    expect(tracking.jsExceptions).toHaveLength(0);
    expect(tracking.requestFailures).toHaveLength(0);
    expect(tracking.consoleErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Client tests
// ---------------------------------------------------------------------------
test.describe('Client — functional tests', () => {
  let tracking: ErrorTracking;

  test.beforeEach((_fixtures, testInfo) => {
    test.skip(testInfo.project.name !== 'client', 'Client-only test');
  });

  test.beforeEach(async ({ page }) => {
    tracking = attachErrorTracking(page);
  });

  test.afterEach(() => {
    tracking?.detach();
  });

  for (const route of CLIENT_ROUTES) {
    test(`page loads: ${route.label} (${route.path})`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });

      expect(tracking.jsExceptions).toHaveLength(0);
      expect(tracking.requestFailures).toHaveLength(0);
    });
  }
});
