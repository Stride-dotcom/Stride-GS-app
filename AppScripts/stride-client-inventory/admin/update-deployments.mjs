/* ===================================================
   update-deployments.mjs — v2.3.1 — 2026-04-17 — --name filter for single client
   =================================================== */
/**
 * v2.2.1: Client filter no longer requires a non-empty webAppUrl — clients with
 *         empty webAppUrl pass through and fall into the "create new deployment"
 *         path. Used to recover clients whose prior URL was a stranded/template
 *         deployment that the Apps Script API happily update()'d without fixing.
 */
/**
 * Updates Web App deployments on Apps Script projects.
 * Creates a new version and updates the existing Web App deployment to use it.
 *
 * Usage:
 *   node admin/update-deployments.mjs                          # Update all client Web Apps
 *   node admin/update-deployments.mjs --name "template"        # Update one client by name (partial match)
 *   node admin/update-deployments.mjs --api                    # Update StrideAPI Web App only
 *   node admin/update-deployments.mjs --all                    # Update clients + StrideAPI
 *
 * This replaces manual "Deploy → Manage Deployments → New version → Deploy"
 * after any npm run rollout or npm run push-api.
 */

import { google } from 'googleapis';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENTS_PATH = join(__dirname, 'clients.json');
const CRED_PATH = join(__dirname, '.credentials.json');

// Standalone projects with Web App deployments
const STANDALONE_PROJECTS = {
  api: {
    name: 'Stride API',
    scriptId: '134--evzE23rsA3CV_vEFQvZIQ86LE9boeSPBpGMYJ3pLbcW_Te6uqZ1M',
    webAppUrl: 'https://script.google.com/macros/s/AKfycbz7v3wu3bXAR3mXSako_DcSDzcT9WZZ0wvcX06OeGmxd-gT1P1w-nSTNx0aF3Z2KNbq/exec'
  },
  cb: {
    name: 'CB / QR Scanner',
    scriptId: '1o38NMWpP7FrdCyNLo5Yd-AwHlzcHr2PxZ_QyYwlF20_5ljx_bukOScJQ',
    webAppUrl: 'https://script.google.com/macros/s/AKfycbyMrvs7SnbchtUf5iZzB4jWkVHV6n4mtDicyOXodPTIlvEUFQEZiUOBHSpvjmTleDZJow/exec'
  }
};

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

function extractDeploymentId(webAppUrl) {
  // URL format: https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec
  const id = webAppUrl
    .replace('https://script.google.com/macros/s/', '')
    .replace('/exec', '');
  return (id && id !== webAppUrl) ? id : null;
}

async function updateDeployment(scriptApi, name, scriptId, webAppUrl) {
  const deploymentId = extractDeploymentId(webAppUrl);

  // Step 1: Create a new version on the TARGET script (real client script)
  const versionRes = await scriptApi.projects.versions.create({
    scriptId: scriptId,
    requestBody: {
      description: `Auto-deploy ${new Date().toISOString()}`
    }
  });
  const versionNumber = versionRes.data.versionNumber;

  // Step 2: Try to update the existing deployment. If the deploymentId doesn't
  // belong to this scriptId (e.g. the URL in CB was for the template's
  // deployment), CREATE a new deployment instead and return the new URL so the
  // caller can overwrite CB.
  if (deploymentId) {
    try {
      await scriptApi.projects.deployments.update({
        scriptId: scriptId,
        deploymentId: deploymentId,
        requestBody: {
          deploymentConfig: {
            versionNumber: versionNumber,
            description: `Auto-deploy ${new Date().toISOString()}`
          }
        }
      });
      console.log(`OK (version ${versionNumber})`);
      return { ok: true, newWebAppUrl: null };
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message || '';
      const notFound = msg.toLowerCase().includes('not found') || err.response?.status === 404;
      if (!notFound) throw err; // propagate real errors (quota, auth, etc.)
      // Fall through to create a new deployment
      process.stdout.write('(existing deployment is on another script, creating new) ');
    }
  } else {
    process.stdout.write('(no existing webAppUrl, creating) ');
  }

  // Step 3: Create a brand-new Web App deployment on the correct script.
  // Manifest must have webapp config already (it does — set during earlier
  // onboarding). If not present, this call returns an error.
  const createRes = await scriptApi.projects.deployments.create({
    scriptId: scriptId,
    requestBody: {
      versionNumber: versionNumber,
      manifestFileName: 'appsscript',
      description: `Auto-create ${new Date().toISOString()}`
    }
  });
  const newDepId = createRes.data.deploymentId;
  if (!newDepId) {
    console.log(`FAIL: deployments.create returned no deploymentId`);
    return { ok: false, newWebAppUrl: null };
  }
  const newWebAppUrl = `https://script.google.com/macros/s/${newDepId}/exec`;
  console.log(`OK (new deployment, version ${versionNumber})`);
  return { ok: true, newWebAppUrl };
}

async function main() {
  const args = process.argv.slice(2);
  const nameIdx = args.indexOf('--name');
  const nameFilter = nameIdx !== -1 ? args[nameIdx + 1]?.toLowerCase() : null;
  const doApi = args.includes('--api') || args.includes('--all');
  const doCb = args.includes('--cb') || args.includes('--all');
  const doClients = nameFilter || (!args.includes('--api') && !args.includes('--cb')) || args.includes('--all');

  const auth = getAuthClient();
  const scriptApi = google.script({ version: 'v1', auth });

  let targets = [];

  if (doClients) {
    // v2.2.1 — allow clients with empty webAppUrl so the "create new deployment"
    // fallback path in updateDeployment() runs for clients whose prior URL
    // pointed to a stranded/template deployment.
    // v2.3.0 — include isTemplate rows so the Master Inventory Template gets
    // a Web App deployment alongside live clients.
    // v2.3.1 — --name <partial> filters to a single client by name (case-insensitive).
    const clients = JSON.parse(readFileSync(CLIENTS_PATH, 'utf8')).clients
      .filter(c => c.enabled && c.scriptId)
      .filter(c => !nameFilter || c.name.toLowerCase().includes(nameFilter));
    targets.push(...clients.map(c => ({ name: c.name, scriptId: c.scriptId, webAppUrl: c.webAppUrl || '' })));
  }

  if (doApi) {
    targets.push(STANDALONE_PROJECTS.api);
  }
  if (doCb) {
    targets.push(STANDALONE_PROJECTS.cb);
  }

  const parts = [];
  if (doClients) parts.push('clients');
  if (doApi) parts.push('API');
  if (doCb) parts.push('CB/Scanner');
  const mode = parts.join(' + ') || 'clients only';
  console.log(`\n=== Update Web App Deployments (${mode}) ===`);
  console.log(`Targets: ${targets.length} project(s)\n`);

  let success = 0, failed = 0;

  // Apps Script API limit: ~60 management requests per user per minute.
  // Each deploy is 3 requests (create version + create/update deployment +
  // occasional read). Pace at ~1500ms per client to stay well under quota
  // (≈40/min). Without this we hit "Quota exceeded" after ~5-6 clients.
  const DEPLOY_DELAY_MS = 1500;

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const label = `[${i + 1}/${targets.length}] ${target.name}`;
    process.stdout.write(`  ${label}... `);

    // Retry on quota errors with exponential backoff: 30s, 60s, 90s.
    const QUOTA_BACKOFFS_MS = [30000, 60000, 90000];
    let attempt = 0;
    let done = false;
    while (!done) {
      try {
        const res = await updateDeployment(scriptApi, target.name, target.scriptId, target.webAppUrl);
        const ok = !!(res && res.ok);
        if (ok) {
          success++;
          // If a brand-new deployment was created (old URL belonged to wrong
          // script), remember to write the new URL back to CB afterwards.
          if (res.newWebAppUrl) {
            target.newWebAppUrl = res.newWebAppUrl;
          }
        } else {
          failed++;
        }
        done = true;
      } catch (err) {
        const msg = err.response?.data?.error?.message || err.message || String(err);
        if (msg.toLowerCase().includes('quota') && attempt < QUOTA_BACKOFFS_MS.length) {
          const waitMs = QUOTA_BACKOFFS_MS[attempt++];
          process.stdout.write(`quota hit, waiting ${waitMs / 1000}s... `);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        console.log(`FAIL: ${msg}`);
        failed++;
        done = true;
      }
    }
    if (i < targets.length - 1) {
      await new Promise(r => setTimeout(r, DEPLOY_DELAY_MS));
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total: ${targets.length} | Success: ${success} | Failed: ${failed}`);

  // v2.2.0: When fresh deployments were created (target.newWebAppUrl set),
  // persist the new URLs back to clients.json so the next CB sync below and
  // future rollouts use the correct URLs.
  const newUrls = targets.filter(t => t.newWebAppUrl);
  if (newUrls.length > 0) {
    try {
      const clientsJson = JSON.parse(readFileSync(CLIENTS_PATH, 'utf8'));
      for (const t of newUrls) {
        const c = clientsJson.clients.find(x => x.scriptId === t.scriptId);
        if (c) c.webAppUrl = t.newWebAppUrl;
      }
      writeFileSync(CLIENTS_PATH, JSON.stringify(clientsJson, null, 2));
      console.log(`  ✓ Rewrote ${newUrls.length} new Web App URL(s) in clients.json`);
    } catch (jsonErr) {
      console.log(`  ⚠ clients.json rewrite failed: ${jsonErr.message || jsonErr}`);
    }
  }

  // v2.1.0: Auto-sync Web App URLs to CB Clients sheet after client deployments
  if (doClients && success > 0) {
    try {
      const CB_SPREADSHEET_ID = '16Yqap3i-nuBWTL9yQGjpuDNEybKCaE8IlM2mb9VJTq8';
      const sheetsApi = google.sheets({ version: 'v4', auth });
      const resp = await sheetsApi.spreadsheets.values.get({
        spreadsheetId: CB_SPREADSHEET_ID, range: 'Clients',
      });
      const rows = resp.data.values || [];
      if (rows.length >= 2) {
        const headers = rows[0].map(h => String(h).trim());
        const ssIdIdx = headers.indexOf('Client Spreadsheet ID');
        let webAppIdx = headers.indexOf('Web App URL');

        if (ssIdIdx >= 0 && webAppIdx >= 0) {
          const allClients = JSON.parse(readFileSync(CLIENTS_PATH, 'utf8')).clients;
          const urlMap = {};
          for (const c of allClients) {
            if (c.spreadsheetId && c.webAppUrl) urlMap[c.spreadsheetId] = c.webAppUrl;
          }

          const updates = [];
          for (let r = 1; r < rows.length; r++) {
            const ssId = String(rows[r][ssIdIdx] || '').trim();
            const currentUrl = String(rows[r][webAppIdx] || '').trim();
            const newUrl = urlMap[ssId] || '';
            if (newUrl && newUrl !== currentUrl) {
              const colLetter = webAppIdx < 26 ? String.fromCharCode(65 + webAppIdx) : 'A' + String.fromCharCode(65 + webAppIdx - 26);
              updates.push({ range: `Clients!${colLetter}${r + 1}`, values: [[newUrl]] });
            }
          }

          if (updates.length > 0) {
            await sheetsApi.spreadsheets.values.batchUpdate({
              spreadsheetId: CB_SPREADSHEET_ID,
              requestBody: { valueInputOption: 'RAW', data: updates },
            });
            console.log(`\n  ✓ Synced ${updates.length} Web App URL(s) to CB Clients sheet`);
          } else {
            console.log(`\n  ✓ All Web App URLs already up to date in CB Clients sheet`);
          }
        } else if (webAppIdx < 0) {
          console.log(`\n  ⚠ "Web App URL" column not found in CB Clients sheet — add it to auto-sync`);
        }
      }
    } catch (syncErr) {
      console.log(`\n  ⚠ Web App URL sync warning: ${syncErr.message || syncErr}`);
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
