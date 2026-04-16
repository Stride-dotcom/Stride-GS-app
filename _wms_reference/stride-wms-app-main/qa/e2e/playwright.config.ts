import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { optionalEnv } from './lib/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const hasClientCreds =
  !!(optionalEnv('QA_CLIENT_EMAIL') && optionalEnv('QA_CLIENT_PASSWORD'));

export default defineConfig({
  globalSetup: path.join(__dirname, 'global-setup'),
  testDir: '.',
  outputDir: path.join(__dirname, '../../test-results'),
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ['html', { outputFolder: path.join(__dirname, '../../e2e-report') }],
    ['json', { outputFile: path.join(__dirname, '../../e2e-results.json') }],
    ['list'],
  ],
  use: {
    baseURL: process.env.APP_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'admin',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        storageState: path.join(__dirname, '.auth/admin.json'),
      },
    },
    ...(hasClientCreds
      ? [
          {
            name: 'client',
            use: {
              ...devices['Desktop Chrome'],
              viewport: { width: 1440, height: 900 },
              storageState: path.join(__dirname, '.auth/client.json'),
            },
          },
        ]
      : []),
  ],
});
