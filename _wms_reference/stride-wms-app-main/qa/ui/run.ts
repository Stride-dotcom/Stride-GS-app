#!/usr/bin/env npx ts-node

/**
 * UI Visual QA Runner
 *
 * Orchestrates the Playwright test run, uploads artifacts to Supabase Storage,
 * and generates the final report.
 *
 * Usage:
 *   npx ts-node qa/ui/run.ts
 *
 * Environment variables:
 *   APP_BASE_URL - Application URL
 *   SUPABASE_URL - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Supabase service role key
 *   QA_TENANT_ID - Tenant ID for QA tests
 *   QA_ADMIN_EMAIL / QA_ADMIN_PASSWORD - Admin credentials
 *   QA_CLIENT_EMAIL / QA_CLIENT_PASSWORD - Client credentials
 */

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const QA_TENANT_ID = process.env.QA_TENANT_ID || '';

interface UploadResult {
  success: boolean;
  path: string;
  error?: string;
}

async function uploadScreenshots(runId: string): Promise<UploadResult[]> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.log('Supabase not configured, skipping screenshot upload');
    return [];
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const results: UploadResult[] = [];
  const screenshotsDir = path.join('screenshots', runId);

  if (!fs.existsSync(screenshotsDir)) {
    console.log('No screenshots directory found');
    return [];
  }

  // Walk directory recursively
  function walkDir(dir: string, baseDir: string): string[] {
    const files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...walkDir(fullPath, baseDir));
      } else if (entry.isFile() && entry.name.endsWith('.png')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  const files = walkDir(screenshotsDir, screenshotsDir);
  console.log(`Found ${files.length} screenshots to upload`);

  for (const filePath of files) {
    const relativePath = path.relative(screenshotsDir, filePath);
    const storagePath = `ui/${runId}/${relativePath}`;

    try {
      const fileBuffer = fs.readFileSync(filePath);

      const { error } = await supabase.storage
        .from('qa-artifacts')
        .upload(storagePath, fileBuffer, {
          contentType: 'image/png',
          upsert: true,
        });

      if (error) {
        results.push({ success: false, path: storagePath, error: error.message });
        console.error(`Failed to upload ${storagePath}: ${error.message}`);
      } else {
        results.push({ success: true, path: storagePath });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      results.push({ success: false, path: storagePath, error: errorMsg });
      console.error(`Error uploading ${storagePath}: ${errorMsg}`);
    }
  }

  return results;
}

async function saveArtifactRecords(runId: string, uploads: UploadResult[]): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  for (const upload of uploads.filter((u) => u.success)) {
    // Parse path to extract route, viewport, step
    const parts = upload.path.split('/');
    // Format: ui/<runId>/<viewport>/<route_slug>/<step>.png
    const viewport = parts[2];
    const routeSlug = parts[3];
    const stepName = parts[4]?.replace('.png', '');

    try {
      await supabase.from('qa_artifacts').insert({
        run_id: runId,
        tenant_id: QA_TENANT_ID,
        suite: 'ui_visual_qa',
        route: routeSlug,
        viewport,
        step_name: stepName,
        storage_path: upload.path,
      });
    } catch (error) {
      console.error(`Error saving artifact record: ${error}`);
    }
  }
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('UI Visual QA Runner');
  console.log('='.repeat(60));

  // Validate environment
  const requiredVars = ['APP_BASE_URL', 'QA_ADMIN_EMAIL', 'QA_ADMIN_PASSWORD'];
  const missingVars = requiredVars.filter((v) => !process.env[v]);

  if (missingVars.length > 0) {
    console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
    console.log('\nRequired variables:');
    console.log('  APP_BASE_URL - Application URL (e.g., https://app.stride-wms.com)');
    console.log('  QA_ADMIN_EMAIL - Admin user email');
    console.log('  QA_ADMIN_PASSWORD - Admin user password');
    console.log('\nOptional variables:');
    console.log('  SUPABASE_URL - Supabase project URL');
    console.log('  SUPABASE_SERVICE_ROLE_KEY - Supabase service role key');
    console.log('  QA_TENANT_ID - Tenant ID for QA tests');
    console.log('  QA_CLIENT_EMAIL - Client user email');
    console.log('  QA_CLIENT_PASSWORD - Client user password');
    process.exit(1);
  }

  // Run Playwright tests
  console.log('\nRunning Playwright tests...');
  try {
    execSync('npx playwright test --config=qa/ui/playwright.config.ts', {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
  } catch {
    console.log('Some tests failed - continuing with artifact upload');
  }

  // Find the run ID from the results
  const resultsPath = path.join('playwright-results.json');
  let runId = `ui-${Date.now()}`;

  if (fs.existsSync(resultsPath)) {
    try {
      const results = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
      // Try to extract run ID from test output
      console.log('Playwright results generated');
    } catch {
      console.log('Could not parse Playwright results');
    }
  }

  // Find screenshots directory
  const screenshotsBase = 'screenshots';
  if (fs.existsSync(screenshotsBase)) {
    const dirs = fs.readdirSync(screenshotsBase);
    const latestDir = dirs.sort().reverse()[0];
    if (latestDir) {
      runId = latestDir;
    }
  }

  console.log(`\nRun ID: ${runId}`);

  // Upload screenshots to Supabase Storage
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    console.log('\nUploading screenshots to Supabase Storage...');
    const uploads = await uploadScreenshots(runId);
    const successCount = uploads.filter((u) => u.success).length;
    console.log(`Uploaded ${successCount}/${uploads.length} screenshots`);

    // Save artifact records
    console.log('\nSaving artifact records...');
    await saveArtifactRecords(runId, uploads);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('UI Visual QA Complete');
  console.log('='.repeat(60));
  console.log(`Run ID: ${runId}`);
  console.log(`Screenshots: screenshots/${runId}/`);
  console.log(`Report: playwright-report/index.html`);

  if (SUPABASE_URL) {
    console.log(`\nView results in Settings > QA Tests > Error Results`);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
