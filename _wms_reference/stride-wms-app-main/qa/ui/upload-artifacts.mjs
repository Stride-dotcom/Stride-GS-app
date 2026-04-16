#!/usr/bin/env node

/**
 * Upload Artifacts Script (ESM runtime-safe)
 *
 * Uploads screenshots and coverage report to Supabase Storage.
 * Used by GitHub Actions workflow after tests complete.
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const QA_TENANT_ID = process.env.QA_TENANT_ID || '';

function normalizeStoragePath(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function walkDir(dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.log('Supabase not configured, skipping upload');
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const screenshotsBase = 'screenshots';

  if (!fs.existsSync(screenshotsBase)) {
    console.log('No screenshots directory found');
    return;
  }

  const dirs = fs.readdirSync(screenshotsBase)
    .filter((d) => fs.statSync(path.join(screenshotsBase, d)).isDirectory())
    .sort()
    .reverse();

  if (dirs.length === 0) {
    console.log('No run directories found');
    return;
  }

  const runId = dirs[0];
  const runDir = path.join(screenshotsBase, runId);
  console.log(`Uploading artifacts for run: ${runId}`);

  const files = walkDir(runDir);
  console.log(`Found ${files.length} files to upload`);

  let successCount = 0;
  let failCount = 0;

  for (const filePath of files) {
    const relativePath = path.relative(runDir, filePath);
    const storagePath = `ui/${runId}/${normalizeStoragePath(relativePath)}`;
    const ext = path.extname(filePath).toLowerCase();
    const contentType = ext === '.json' ? 'application/json' : 'image/png';

    try {
      const fileBuffer = fs.readFileSync(filePath);
      const { error } = await supabase.storage
        .from('qa-artifacts')
        .upload(storagePath, fileBuffer, {
          contentType,
          upsert: true,
        });

      if (error) {
        console.error(`Failed: ${storagePath} - ${error.message}`);
        failCount++;
      } else {
        successCount++;
      }
    } catch (error) {
      console.error(`Error: ${storagePath} - ${error}`);
      failCount++;
    }
  }

  console.log(`\nUpload complete: ${successCount} succeeded, ${failCount} failed`);

  if (successCount <= 0) return;

  console.log('\nSaving artifact records...');

  for (const filePath of files) {
    if (!filePath.endsWith('.png')) continue;

    const relativePath = path.relative(runDir, filePath);
    const normalizedPath = normalizeStoragePath(relativePath);
    const storagePath = `ui/${runId}/${normalizedPath}`;
    const parts = normalizedPath.split('/');

    // Format: <viewport>/<route_slug>/<step>.png
    const viewport = parts[0];
    const routeSlug = parts[1];
    const stepName = parts[2]?.replace('.png', '');

    try {
      await supabase.from('qa_artifacts').insert({
        run_id: runId,
        tenant_id: QA_TENANT_ID,
        suite: 'ui_visual_qa',
        route: routeSlug,
        viewport,
        step_name: stepName,
        storage_path: storagePath,
      });
    } catch {
      // Record may already exist or run_id FK constraint.
      console.log(`Note: Could not save artifact record for ${storagePath}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
