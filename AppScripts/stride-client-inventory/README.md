# Stride Client Inventory — Bulk Rollout Tool

Local master codebase with Apps Script API bulk rollout for ~60 bound client scripts.

## Prerequisites

1. **Node.js** (v18+)
2. **Google Cloud Project** with these APIs enabled:
   - Apps Script API
   - Google Sheets API
3. **OAuth 2.0 credentials** (Desktop App type) downloaded as JSON

## Setup

### 1. Enable APIs

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (or create one)
3. Go to **APIs & Services > Library**
4. Search and enable: **Apps Script API**
5. Search and enable: **Google Sheets API**

### 2. Create OAuth Credentials

1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth client ID**
3. Application type: **Desktop app**
4. Download the JSON file

### 3. Run Setup

```bash
cd stride-client-inventory
npm install
npm run setup
```

This prompts for the downloaded JSON path, opens a browser for authorization, and saves tokens to `admin/.credentials.json`.

### 4. Find Script IDs

For each client spreadsheet:
1. Open the spreadsheet
2. Go to **Extensions > Apps Script**
3. The URL will be: `https://script.google.com/home/projects/{SCRIPT_ID}/edit`
4. Copy the `{SCRIPT_ID}` portion

### 5. Register Clients

Edit `admin/clients.json`:
```json
{
  "clients": [
    {
      "name": "Client Name",
      "spreadsheetId": "from-spreadsheet-url",
      "scriptId": "from-apps-script-url",
      "group": "pilot",
      "enabled": true
    }
  ]
}
```

- `spreadsheetId`: from the sheet URL: `docs.google.com/spreadsheets/d/{ID}/edit`
- `scriptId`: from the Apps Script editor URL (see step 4)
- `group`: rollout group tag (e.g., "pilot", "batch1", "all")
- `enabled`: set `false` to skip during rollout

## Usage

### Rollout Commands

```bash
# Dry run (default) — shows what would happen, no changes
npm run rollout:dry

# Push to pilot group only
npm run rollout:pilot

# Push to all enabled clients
npm run rollout

# Push to a single client
node admin/rollout.mjs --client=ClientName --execute

# Push to a specific group
node admin/rollout.mjs --group=batch1 --execute

# Push to ALL clients (requires typing YES)
node admin/rollout.mjs --all --execute
```

### Verify Triggers

After rollout, verify triggers are healthy:
```bash
npm run verify
```

This reads `_TRIGGER_STATE` from each client's Settings sheet. Clients must have run **Stride Admin > Verify Triggers** at least once for this to report data.

### Post-Rollout Checklist

After pushing to a client:
1. Open the spreadsheet — "Stride Warehouse" menu should appear
2. Go to **Stride Admin > Install Triggers**
3. Go to **Stride Admin > Verify Triggers** (writes state for remote verification)
4. Test an edit trigger (e.g., check a task checkbox on Inventory)
5. Confirm version: check CI_V in the script editor matches expected version

## File Structure

```
stride-client-inventory/
  src/                    # Master source (11 .gs files + manifest)
    Code.gs               # Constants, menus, setup
    Triggers.gs           # Edit handlers, trigger mgmt, shared handlers
    Shipments.gs          # Dock Intake / receiving
    Tasks.gs              # Task creation, work orders
    Repairs.gs            # Repair creation, work orders
    WillCalls.gs          # Will call create/process/release
    Billing.gs            # Billing ledger, rate lookups
    Emails.gs             # Email templates, PDF generation
    Transfer.gs           # Cross-client item transfers
    Import.gs             # Inventory migration tool
    Utils.gs              # Helpers, filters, cache, setup
    appsscript.json       # Manifest with OAuth scopes
  admin/
    clients.json          # Client registry
    rollout.mjs           # Bulk push tool
    verify-triggers.mjs   # Trigger state checker
    setup-auth.mjs        # OAuth setup wizard
```

## Safety

- **Dry-run by default** — `--execute` flag required to push
- **Pre-push backup** — remote script content saved to `logs/backups/` before overwrite
- **Pre-push validation** — checks appsscript.json, Code.gs, version headers, required scopes
- **Rate limiting** — 1.2s delay between pushes (API limit: 50 req/min)
- **Confirmation** — `--all --execute` requires typing YES

## Source-of-Truth Rules

- `src/` is the **only** code source of truth
- Direct edits in live client script projects are **emergency-only**
- Emergency fixes must be back-ported to `src/` immediately
- Git tag, CI_V constant, file headers, and rollout log must all match the same version
