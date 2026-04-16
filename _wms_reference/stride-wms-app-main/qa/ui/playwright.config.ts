import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for UI Visual QA
 *
 * Runs visual tests across 3 viewports: desktop, tablet, mobile
 */
const ALL_VIEWPORTS = ['desktop', 'tablet', 'mobile'] as const;
type ViewportName = typeof ALL_VIEWPORTS[number];

function parseRequestedViewports(): ViewportName[] {
  const raw = process.env.VIEWPORTS;
  if (!raw) return [...ALL_VIEWPORTS];
  const valid = raw
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v): v is ViewportName => (ALL_VIEWPORTS as readonly string[]).includes(v));
  return valid.length > 0 ? valid : ['desktop'];
}

const requestedViewports = parseRequestedViewports();

const viewportProjects = {
  desktop: {
    name: 'desktop',
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: 1440, height: 900 },
    },
  },
  tablet: {
    name: 'tablet',
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: 834, height: 1194 },
      isMobile: true,
      hasTouch: true,
    },
  },
  mobile: {
    name: 'mobile',
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    },
  },
} as const;

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false, // Run sequentially to avoid conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // Single worker for consistent screenshots
  reporter: [
    ['html', { outputFolder: '../../playwright-report' }],
    ['json', { outputFile: '../../playwright-results.json' }],
  ],
  timeout: 60000, // 60s per test
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: process.env.APP_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: requestedViewports.map((viewport) => viewportProjects[viewport]),
});
