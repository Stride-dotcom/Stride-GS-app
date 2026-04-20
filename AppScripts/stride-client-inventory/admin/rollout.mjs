/* ===================================================
   rollout.mjs — v3.0.0 — 2026-03-25 10:00 PM
   =================================================== */
/**
 * Bulk rollout tool for pushing src/ code to client Apps Script projects
 * via the Apps Script API (projects.updateContent).
 *
 * SAFETY: Default mode is dry-run. Use --execute to actually push.
 *
 * Usage:
 *   node admin/rollout.mjs                          # dry-run, all enabled
 *   node admin/rollout.mjs --execute                # push to all enabled
 *   node admin/rollout.mjs --client=ClientA --execute  # single client
 *   node admin/rollout.mjs --group=pilot --execute  # group only
 *   node admin/rollout.mjs --all --execute          # all (requires YES)
 */

import { google } from 'googleapis';
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createInterface } from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, '..', 'src');
const CLIENTS_PATH = join(__dirname, 'clients.json');
const CRED_PATH = join(__dirname, '.credentials.json');
const LOGS_DIR = join(__dirname, '..', 'logs');
const BACKUPS_DIR = join(LOGS_DIR, 'backups');

// --- Argument parsing ---

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    execute: false,
    dryRun: true,
    client: null,
    group: null,
    all: false
  };
  for (const arg of args) {
    if (arg === '--execute') { opts.execute = true; opts.dryRun = false; }
    else if (arg === '--dry-run') { opts.dryRun = true; }
    else if (arg === '--all') { opts.all = true; }
    else if (arg.startsWith('--client=')) { opts.client = arg.split('=')[1]; }
    else if (arg.startsWith('--group=')) { opts.group = arg.split('=')[1]; }
    else { console.warn('Unknown argument:', arg); }
  }
  return opts;
}

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// --- Auth ---

function getAuthClient() {
  if (!existsSync(CRED_PATH)) {
    console.error('ERROR: No credentials found. Run: npm run setup');
    process.exit(1);
  }
  const creds = JSON.parse(readFileSync(CRED_PATH, 'utf8'));
  const oauth2 = new google.auth.OAuth2(creds.client_id, creds.client_secret);
  oauth2.setCredentials({
    refresh_token: creds.refresh_token,
    access_token: creds.access_token,
    token_type: creds.token_type || 'Bearer',
    expiry_date: creds.expiry_date
  });
  return oauth2;
}

// --- Source file loading ---

function loadSourceFiles() {
  const files = [];
  const entries = readdirSync(SRC_DIR);

  // Ensure Code.gs is first (globals must be available)
  const gsFiles = entries.filter(f => extname(f) === '.gs').sort((a, b) => {
    if (a === 'Code.gs') return -1;
    if (b === 'Code.gs') return 1;
    return a.localeCompare(b);
  });

  for (const file of gsFiles) {
    const source = readFileSync(join(SRC_DIR, file), 'utf8');
    files.push({
      name: basename(file, '.gs'),
      type: 'SERVER_JS',
      source
    });
  }

  // appsscript.json manifest
  const manifestPath = join(SRC_DIR, 'appsscript.json');
  if (existsSync(manifestPath)) {
    files.push({
      name: 'appsscript',
      type: 'JSON',
      source: readFileSync(manifestPath, 'utf8')
    });
  }

  return files;
}

// --- Validation ---

function validatePayload(files) {
  const errors = [];
  const hasManifest = files.some(f => f.name === 'appsscript' && f.type === 'JSON');
  const hasCode = files.some(f => f.name === 'Code' && f.type === 'SERVER_JS');

  if (!hasManifest) errors.push('MISSING: appsscript.json not found in src/');
  if (!hasCode) errors.push('MISSING: Code.gs not found in src/');

  // Check version headers on all .gs files
  for (const f of files) {
    if (f.type !== 'SERVER_JS') continue;
    if (!f.source.startsWith('/* ===')) {
      errors.push(`MISSING VERSION HEADER: ${f.name}.gs does not start with version header`);
    }
  }

  // Check required scopes in manifest
  if (hasManifest) {
    const manifest = JSON.parse(files.find(f => f.name === 'appsscript').source);
    const scopes = manifest.oauthScopes || [];
    const required = [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ];
    for (const scope of required) {
      if (!scopes.includes(scope)) {
        errors.push(`MISSING SCOPE: ${scope} not in appsscript.json`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// --- Client loading ---

function loadClients(opts) {
  if (!existsSync(CLIENTS_PATH)) {
    console.error('ERROR: clients.json not found at', CLIENTS_PATH);
    process.exit(1);
  }
  const { clients } = JSON.parse(readFileSync(CLIENTS_PATH, 'utf8'));

  let filtered = clients;

  // Apply filters
  if (opts.client) {
    filtered = filtered.filter(c =>
      c.name.toLowerCase() === opts.client.toLowerCase()
    );
    if (filtered.length === 0) {
      console.error(`ERROR: Client "${opts.client}" not found in registry.`);
      process.exit(1);
    }
  } else if (opts.group) {
    filtered = filtered.filter(c => c.group === opts.group);
    if (filtered.length === 0) {
      console.error(`ERROR: No clients in group "${opts.group}".`);
      process.exit(1);
    }
  }

  // Unless --all, only include enabled clients
  if (!opts.all) {
    filtered = filtered.filter(c => c.enabled !== false);
  }

  return filtered;
}

// --- Backup remote content ---

async function backupRemoteContent(scriptApi, client) {
  try {
    const res = await scriptApi.projects.getContent({ scriptId: client.scriptId });
    const backupFile = join(
      BACKUPS_DIR,
      `${client.name.replace(/[^a-zA-Z0-9_-]/g, '_')}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    );
    mkdirSync(BACKUPS_DIR, { recursive: true });
    writeFileSync(backupFile, JSON.stringify(res.data, null, 2));
    return { ok: true, path: backupFile };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// --- Push to client ---

async function pushToClient(scriptApi, client, files, dryRun) {
  if (dryRun) {
    return {
      client: client.name,
      scriptId: client.scriptId,
      success: true,
      dryRun: true,
      message: 'DRY RUN — would push ' + files.length + ' files'
    };
  }

  try {
    // Backup first
    const backup = await backupRemoteContent(scriptApi, client);
    if (!backup.ok) {
      console.warn(`  WARNING: Could not backup ${client.name}: ${backup.error}`);
    }

    // Push
    await scriptApi.projects.updateContent({
      scriptId: client.scriptId,
      requestBody: { files }
    });

    return {
      client: client.name,
      scriptId: client.scriptId,
      success: true,
      backupPath: backup.ok ? backup.path : null
    };
  } catch (err) {
    return {
      client: client.name,
      scriptId: client.scriptId,
      success: false,
      error: err.message || String(err)
    };
  }
}

// --- Extract version from Code.gs ---

function extractVersion(files) {
  const codeFile = files.find(f => f.name === 'Code');
  if (!codeFile) return 'unknown';
  const match = codeFile.source.match(/var CI_V\s*=\s*"([^"]+)"/);
  return match ? match[1] : 'unknown';
}

// --- Main ---

async function main() {
  const opts = parseArgs();
  const mode = opts.dryRun ? 'DRY RUN' : 'EXECUTE';

  console.log(`\n=== Stride Client Inventory Rollout [${mode}] ===\n`);

  // Load and validate source files
  const files = loadSourceFiles();
  const validation = validatePayload(files);

  if (!validation.valid) {
    console.error('VALIDATION FAILED:');
    validation.errors.forEach(e => console.error('  - ' + e));
    process.exit(1);
  }

  const version = extractVersion(files);
  const fileNames = files.map(f => f.name + (f.type === 'JSON' ? '.json' : '.gs'));
  console.log(`Version: ${version}`);
  console.log(`Files (${files.length}): ${fileNames.join(', ')}`);

  // Load clients
  const clients = loadClients(opts);
  console.log(`\nTargeting ${clients.length} client(s):\n`);
  clients.forEach(c => console.log(`  - ${c.name} (${c.scriptId.substring(0, 12)}...)`));

  // Safety: --all --execute requires confirmation
  if (opts.all && opts.execute) {
    console.log(`\n*** WARNING: About to push to ALL ${clients.length} clients ***`);
    const confirm = await prompt('Type YES to confirm: ');
    if (confirm !== 'YES') {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  // Get API client
  const auth = getAuthClient();
  const scriptApi = google.script({ version: 'v1', auth });

  // Push to each client
  console.log('\n--- Starting rollout ---\n');
  const results = [];

  for (let i = 0; i < clients.length; i++) {
    const client = clients[i];
    process.stdout.write(`[${i + 1}/${clients.length}] ${client.name}... `);

    const result = await pushToClient(scriptApi, client, files, opts.dryRun);
    results.push(result);

    if (result.success) {
      console.log(result.dryRun ? 'OK (dry run)' : 'OK');
    } else {
      console.log('FAILED: ' + result.error);
    }

    // Rate limit: 1.2s between pushes (50 req/min API limit)
    if (!opts.dryRun && i < clients.length - 1) {
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  // Summary
  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`\n--- Rollout Complete ---`);
  console.log(`Total: ${results.length} | Success: ${succeeded} | Failed: ${failed}`);

  if (failed > 0) {
    console.log('\nFailed clients:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`  - ${r.client}: ${r.error}`);
    });
  }

  // Write log
  mkdirSync(LOGS_DIR, { recursive: true });
  const logEntry = {
    timestamp: new Date().toISOString(),
    version,
    mode: opts.dryRun ? 'dry-run' : 'execute',
    filesIncluded: fileNames,
    results,
    summary: {
      total: results.length,
      success: succeeded,
      failed,
      skipped: 0
    }
  };

  const logFile = join(LOGS_DIR, `rollout-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(logFile, JSON.stringify(logEntry, null, 2));
  console.log(`\nLog written to: ${logFile}`);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
