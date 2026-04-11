# Stride WMS — Phase 7 Spreadsheet Parity Audit

> **Version:** 1.0.0 — 2026-03-26
> **Purpose:** Complete mapping of every spreadsheet function, workflow, side effect, and data dependency — the foundation for Phase 7 (Wire to Real Data) API implementation.
> **Scope:** All 15 Apps Script files across 4 interconnected Google Sheets plus QR Scanner system.

---

## PART A — BUILD PLAN CONFIRMATION

### A1. Final Proposed App Modules

| Module | Primary Data Source | Script Source | Status |
|--------|-------------------|---------------|--------|
| **Inventory** | Client Inventory → Inventory tab | `inventory code.gs.txt` | UI built, needs API |
| **Receiving** | Client Inventory → Shipments tab | `inventory code.gs.txt` | UI built, needs API |
| **Tasks** | Client Inventory → Tasks tab / Task Board | `inventory code.gs.txt` + `task board script.txt` | UI built, needs API |
| **Repairs** | Client Inventory → Repairs tab | `inventory code.gs.txt` + `task board script.txt` | UI built, needs API |
| **Will Calls** | Client Inventory → Will_Calls + WC_Items tabs | `inventory code.gs.txt` | UI built, needs API |
| **Billing** | Client Billing_Ledger + CB Consolidated_Ledger + Unbilled_Report | `Code.gs.js` + `Invoice Commit.js` + `CB13 Unbilled Reports.js` + `CB13_Preview_Core.js` | UI built, needs API |
| **Payments / Stax** | CB + Stax API | `StaxAutoPay.gs` (⚠ inaccessible — permission issue) | UI built, needs API |
| **Settings** | Client Settings + CB Settings + Master Settings | `Code.gs.js` + `Client_Onboarding.js` + `Master Price list script.txt` | UI built, needs API |
| **QR Scanner** | Cross-client Inventory (indexed) + Locations sheet | `ScannerBackend.gs.txt` + `IndexBuilder.gs.txt` | Standalone web app, already has doGet/doPost API |
| **Client Portal** | Read-only views of Inventory, Shipments, Billing | `inventory code.gs.txt` | UI built, needs API |

### A2. Real Workflow Mapping

#### Inventory
- **Read:** Inventory tab → all columns (Item ID, Description, Class, Vendor, Location, Room, Status, Receive Date, Release Date, Sidemark, Shipment #, Qty, Item Notes, Photos URL)
- **Write:** Location updates (QR scanner), status changes (Release), notes edits
- **Side effects:** Status change to "Released" → sets Release Date, triggers WC billing if via Will Call
- **Cross-refs:** Items linked to Tasks, Repairs, Will Calls, Billing_Ledger by Item ID

#### Receiving (Shipments)
- **Trigger:** "Complete Shipment" menu action or button
- **Creates:** Shipment row (SHP-XXXXXX), inventory items (one per line), RCVG billing rows, auto-inspection tasks (if AUTO_INSPECTION=TRUE), Drive folders (shipment + photos), Receiving PDF document, email notification
- **ID generation:** SHP counter in Settings (SHP-000001 format), Item IDs with client prefix
- **Status flow:** Draft → In Progress → Complete
- **Billing:** One RCVG charge per item received (rate from Price_Cache by class)

#### Tasks
- **Types:** Inspection, Assembly, Minor Touch-Up, custom
- **Status flow:** Open → In Progress → Complete/Cancelled
- **Completion side effects:** Billing row created (INSP/ASM/MNRTU service code), Work Order PDF generated, email sent, "Completion Processed At" timestamp set
- **Task Board sync:** Shared handlers (SH_ prefix) ensure identical processing from both Client sheet and Task Board
- **Idempotency:** "Completion Processed At" marker prevents double-processing

#### Repairs
- **Status flow:** Open → Quoted → Approved → In Progress → Complete/Cancelled/Declined
- **Quote flow:** Inspector fills estimate → "Quote Sent At" marker → email with quote PDF
- **Approval flow:** Client approves → "Approval Processed At" marker → status → In Progress
- **Completion:** Billing row (REPAIR service code), Repair Work Order PDF, email, "Completion Processed At" marker
- **Task Board sync:** SH_processRepairCompletionById_, SH_processRepairQuoteById_, SH_processRepairApprovalById_

#### Will Calls
- **Creation:** "Create Will Call" → assigns inventory items, sets COD amount, creates WC row + WC_Items rows, generates Will Call PDF, sends email
- **Release:** "Process Release" → updates item status to Released, sets Release Date, creates WC billing row per item, generates release confirmation
- **COD:** Optional cash-on-delivery amount tracked on WC record
- **ID generation:** WC-XXXXXX counter in Settings

#### Billing
- **Storage charges (STOR):** Generated from CB → per-item daily rate × class volume × days (respecting FREE_STORAGE_DAYS + discounts). Idempotent via Task ID = "STOR-{ItemID}-{YYYYMMDD}-{YYYYMMDD}"
- **Service charges:** Created at task/repair/shipment/WC completion. Rate looked up from Price_Cache by service code + class
- **Invoice flow:** Generate Unbilled Report → Select rows → Group by client (optionally by sidemark) → Get invoice # from Master RPC → Create Google Doc PDF → Email to client → Mark Invoiced → Write to Consolidated_Ledger
- **QB Export:** IIF format with TRNS/SPL/ENDTRNS blocks, QB Customer Name mapping, service→account mapping

#### Payments
- **Stax integration:** Auto-pay processing via Stax API (⚠ StaxAutoPay.gs inaccessible for detailed audit)
- **Known features from UI:** Invoice list, charge log, exceptions, customer mapping, IIF→Stax pipeline

### A3. Role Matrix

| Feature | Staff (Admin) | Staff (Warehouse) | Client Portal |
|---------|--------------|-------------------|---------------|
| View Inventory | ✅ All clients | ✅ All clients | ✅ Own items only |
| Edit Inventory | ✅ Full | ✅ Location/notes | ❌ |
| Receiving | ✅ Create/complete | ✅ Process items | ❌ View only |
| Tasks | ✅ Create/assign/complete | ✅ Work assigned tasks | ❌ View status |
| Repairs | ✅ Full lifecycle | ✅ Work repairs | ✅ Approve/decline quotes |
| Will Calls | ✅ Create/release | ✅ Process release | ✅ Request pickup |
| Billing | ✅ Full (generate, invoice, export) | ❌ | ✅ View invoices |
| Settings | ✅ Full | ❌ | ❌ |
| QR Scanner | ✅ | ✅ | ❌ |
| Onboarding | ✅ Admin only | ❌ | ❌ |

---

## PART B — API PLAN

### B1. Endpoint Map by Entity/Workflow

#### Inventory Endpoints
| Method | Endpoint | Purpose | Source Function |
|--------|----------|---------|-----------------|
| GET | `/api/inventory` | List items (filtered by client, status, search) | Direct sheet read |
| GET | `/api/inventory/:itemId` | Get single item with linked records | `qrLookupItem()` pattern |
| PUT | `/api/inventory/:itemId` | Update item (location, notes, status) | `qrUpdateLocations()` pattern |
| PUT | `/api/inventory/:itemId/release` | Release item (set status, date) | `releaseInventoryItems_()` |
| POST | `/api/inventory/import` | Import items from old spreadsheet | `onboardImportInventory_()` |

#### Receiving / Shipments Endpoints
| Method | Endpoint | Purpose | Source Function |
|--------|----------|---------|-----------------|
| GET | `/api/shipments` | List shipments | Direct sheet read |
| GET | `/api/shipments/:shipNo` | Get shipment details + items | Direct sheet read |
| POST | `/api/shipments` | Create shipment (draft) | `createShipment_()` |
| PUT | `/api/shipments/:shipNo/complete` | Complete shipment → create items, billing, PDF, email | `completeShipment_()` |
| GET | `/api/shipments/:shipNo/pdf` | Get/regenerate receiving PDF | `generateReceivingDoc_()` |

#### Tasks Endpoints
| Method | Endpoint | Purpose | Source Function |
|--------|----------|---------|-----------------|
| GET | `/api/tasks` | List tasks (filter by type, status, assigned) | Direct sheet read |
| GET | `/api/tasks/:taskId` | Get task details | Direct sheet read |
| POST | `/api/tasks` | Create task | `createTask_()` |
| PUT | `/api/tasks/:taskId` | Update task (notes, photos, status) | `updateTask_()` |
| PUT | `/api/tasks/:taskId/complete` | Complete task → billing, PDF, email | `SH_processTaskCompletionById_()` |
| PUT | `/api/tasks/:taskId/cancel` | Cancel task | Status update |

#### Repairs Endpoints
| Method | Endpoint | Purpose | Source Function |
|--------|----------|---------|-----------------|
| GET | `/api/repairs` | List repairs | Direct sheet read |
| GET | `/api/repairs/:repairId` | Get repair details | Direct sheet read |
| POST | `/api/repairs` | Create repair | `createRepair_()` |
| PUT | `/api/repairs/:repairId/quote` | Send quote → PDF, email | `SH_processRepairQuoteById_()` |
| PUT | `/api/repairs/:repairId/approve` | Approve repair | `SH_processRepairApprovalById_()` |
| PUT | `/api/repairs/:repairId/decline` | Decline repair | Status update + email |
| PUT | `/api/repairs/:repairId/complete` | Complete repair → billing, PDF, email | `SH_processRepairCompletionById_()` |

#### Will Calls Endpoints
| Method | Endpoint | Purpose | Source Function |
|--------|----------|---------|-----------------|
| GET | `/api/willcalls` | List will calls | Direct sheet read |
| GET | `/api/willcalls/:wcId` | Get WC details + items | Direct sheet read |
| POST | `/api/willcalls` | Create will call → PDF, email | `createWillCall_()` |
| PUT | `/api/willcalls/:wcId/release` | Process release → update items, billing | `processWillCallRelease_()` |
| GET | `/api/willcalls/:wcId/pdf` | Get/regenerate WC PDF | `generateWillCallDoc_()` |

#### Billing Endpoints
| Method | Endpoint | Purpose | Source Function |
|--------|----------|---------|-----------------|
| GET | `/api/billing/ledger` | Get client billing ledger | Direct Billing_Ledger read |
| POST | `/api/billing/storage` | Generate storage charges | `StrideGenerateStorageCharges()` |
| GET | `/api/billing/unbilled` | Get unbilled report | `CB13_generateUnbilledReport()` |
| POST | `/api/billing/invoices` | Create & send invoices | `CB13_commitInvoice()` |
| POST | `/api/billing/invoices/:invNo/resend` | Re-send invoice email | `CB13_resendInvoiceEmail()` |
| POST | `/api/billing/qb-export` | Export to QuickBooks IIF | `CB13_qbExportFromUnbilledSelection()` |
| GET | `/api/billing/consolidated` | Get consolidated ledger | Direct Consolidated_Ledger read |

#### Settings / Admin Endpoints
| Method | Endpoint | Purpose | Source Function |
|--------|----------|---------|-----------------|
| GET | `/api/settings` | Get client settings | `readClientSettings_()` |
| PUT | `/api/settings` | Update client settings | Settings tab write |
| GET | `/api/clients` | List all clients | `getActiveClients_v2_()` |
| POST | `/api/clients/onboard` | Onboard new client | `onboardNewClient_()` |
| PUT | `/api/clients/:id/sync-settings` | Sync settings to client | `StrideSyncSettingsToClient()` |
| GET | `/api/pricing` | Get price list | Master Price_List read |
| GET | `/api/pricing/classes` | Get class map | Class_Cache / Class_Map read |

#### QR Scanner Endpoints (Already Exist)
| Method | Endpoint | Purpose | Source Function |
|--------|----------|---------|-----------------|
| GET/POST | `?action=getLocations` | Get location codes | `qrGetLocations()` |
| GET/POST | `?action=updateLocations` | Batch update locations | `qrUpdateLocations()` |
| GET/POST | `?action=lookupItem` | Single item lookup | `qrLookupItem()` |
| GET/POST | `?action=lookupItems` | Bulk item lookup | `qrLookupItems()` |
| GET/POST | `?action=getItemsForLabels` | Label data fetch | `qrGetItemsForLabels()` |
| GET/POST | `?action=rebuildIndex` | Force index rebuild | `qrBuildIndex()` |
| GET/POST | `?action=getLabelConfig` | Get label config | `qrGetLabelConfig()` |
| GET/POST | `?action=saveLabelConfig` | Save label config | `qrSaveLabelConfig()` |

#### Utility / RPC Endpoints
| Method | Endpoint | Purpose | Source Function |
|--------|----------|---------|-----------------|
| POST | `/api/rpc/next-invoice-id` | Get next invoice number | `getNextInvoiceIdFromMasterRpc_()` |
| POST | `/api/rpc/next-shipment-id` | Get next shipment number | Counter in Master Settings |
| POST | `/api/rpc/next-task-id` | Get next task number | Counter in client Settings |

### B2. Request/Response Structure

**Standard Response Envelope:**
```json
{
  "success": true|false,
  "data": { ... } | [ ... ],
  "error": "message" (only on failure),
  "meta": {
    "total": 100,
    "page": 1,
    "pageSize": 50
  }
}
```

**Read endpoints:** Return sheet data as JSON arrays/objects with header-mapped keys.

**Write endpoints:** Accept JSON body with field names matching sheet headers (case-insensitive). Return created/updated record.

**Batch endpoints:** Accept arrays. Return `{ success: true, results: { updated: [], failed: [], skipped: [] } }`.

### B3. Read vs Write Endpoints

| Type | Count | Notes |
|------|-------|-------|
| **Read-only (GET)** | 18 | Inventory list, item detail, shipments, tasks, repairs, WC, billing ledger, settings, pricing |
| **Write (POST/PUT)** | 22 | All create/update/complete/release operations |
| **Side-effect-heavy** | 10 | Shipment complete, task complete, repair lifecycle, WC release, invoice create, storage charges |

### B4. Auth/Validation Approach

**Phase 6 Auth (prerequisite for Phase 7):**
- Staff: Google Sign-In with @stridenw.com accounts
- Clients: Magic link login (email → verify → session token)
- Users tab in Consolidated Billing: Email | Role (staff/client) | Client Name | Active

**API Auth Flow:**
1. React app sends request with session token in Authorization header
2. Apps Script doGet/doPost validates token against Users tab
3. Role determines data scope (staff = all clients, client = own data only)
4. Client isolation enforced at query level (filter by Client Name / Client Spreadsheet ID)

**Validation layers:**
- Auth token validation (every request)
- Role-based access control (staff vs client per endpoint)
- Client isolation (client users can only access their own data)
- Input validation (required fields, valid status transitions, date formats)
- Idempotency checks (duplicate prevention via Task ID, Ledger Row ID)

### B5. Cross-Domain Strategy

**Architecture:** mystridehub.com (React SPA on GitHub Pages) → Apps Script Web App API

**Recommended approach: Direct fetch with CORS headers (NOT JSONP)**

Apps Script `doGet`/`doPost` can return `ContentService` responses. The React app should use standard `fetch()` calls:

```javascript
// React app
const response = await fetch(APPS_SCRIPT_WEB_APP_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain' }, // Apps Script limitation
  body: JSON.stringify({ action: 'getInventory', token: authToken, params: { ... } })
});
```

**Why NOT JSONP by default:**
- JSONP is GET-only, exposes params in URL, no error handling
- The QR Scanner currently uses JSONP (legacy decision for iPhone Safari compat) — should migrate
- Standard fetch with POST is more secure, supports request bodies, proper error codes

**Apps Script CORS note:**
- Apps Script web apps deployed as "anyone" automatically handle CORS
- No proxy needed on mystridehub.com for Apps Script calls
- All requests route through `doPost` with JSON body containing `action` + `token` + `params`

### B6. Proxy Decision

**No proxy needed on mystridehub.com** for the Apps Script API layer. Apps Script web apps deployed with "Execute as: Me" and "Access: Anyone" serve cross-origin requests natively.

**Exception:** If a future endpoint requires server-side secrets (e.g., Stax API keys), a Cloudflare Worker or simple proxy on mystridehub.com hosting could be used. For Phase 7, all secrets live in Apps Script Properties/Settings — no proxy required.

---

## PART C — SPREADSHEET PARITY AUDIT

### C1. Entrypoints / Execution Surfaces

#### Client Inventory Script (`inventory code.gs.txt` — v2.6.4, ~8000 lines)

**Installable Triggers:**
| Trigger | Type | Function | Purpose |
|---------|------|----------|---------|
| onOpen | Simple | `onOpen(e)` | Creates "Stride Client" and "Stride Warehouse" menus |
| onEdit | Simple | `onEdit(e)` | Handles checkbox toggles, status changes, dropdown validations |

**Menu: "Stride Client" (client-facing):**
| Menu Item | Function | Purpose |
|-----------|----------|---------|
| 📦 View Active Inventory | `showActiveInventory_()` | Filter to active items |
| 📋 View All Items | `showAllItems_()` | Remove filters |
| 📊 Inventory Summary | `showInventorySummary_()` | Summary stats dialog |

**Menu: "Stride Warehouse" (staff-facing):**
| Menu Item | Function | Purpose |
|-----------|----------|---------|
| 📥 Complete Shipment | `completeShipment_()` | Process receiving |
| ✅ Complete Selected Tasks | `completeSelectedTasks_()` | Batch task completion |
| 🔧 Create Repair from Task | `createRepairFromTask_()` | Convert task → repair |
| 📦 Create Will Call | `showCreateWillCallDialog_()` | WC creation dialog |
| 🚚 Process Will Call Release | `processWillCallRelease_()` | Release WC items |
| 🔄 Transfer Items | `showTransferDialog_()` | Inter-client transfer |
| 💰 Recalculate Billing | `recalculateBilling_()` | Refresh billing rows |
| 📄 Regenerate Document | `regenerateDocument_()` | Re-create PDF |
| 📧 Resend Email | `resendEmail_()` | Re-send notification |
| ⚙️ Refresh Price Cache | `refreshPriceCache_()` | Sync pricing from Master |
| 📥 Import Inventory | `showImportDialog_()` | Legacy import tool |
| 🔒 Protect Sheets | `protectSheets_()` | Set sheet protections |

**doGet/doPost:**
- None in client inventory script (no web app)

**Batch Utilities:**
- `refreshAllCaches_()` — Refresh Price_Cache + Class_Cache from Master
- `recalculateBilling_()` — Recalculate all billing rows from scratch
- `protectSheets_()` — Apply sheet protection rules

**Time-Driven Triggers:**
- None in client inventory (QR IndexBuilder has 6-hour rebuild trigger)

#### Consolidated Billing Script (`Code.gs.js` — v2.0.0)

**Triggers:**
| Trigger | Type | Function | Purpose |
|---------|------|----------|---------|
| onOpen | Simple | `onOpen()` | Creates "Stride Billing" menu |
| onEdit | Simple | `onEdit(e)` | Two-way Consolidated_Ledger ↔ client Billing_Ledger sync + onboard trigger |

**Menu: "Stride Billing":**
| Menu Item | Function | Purpose |
|-----------|----------|---------|
| ⚙ Setup (Owner Only) | `StrideBillingSetup()` | Initialize sheets/settings |
| 📦 Generate Storage Charges (STOR) | `StrideGenerateStorageCharges_WithLogs()` | Create STOR billing rows |
| 📋 Generate Unbilled Report | `CB13_generateUnbilledReport_WithLogs()` | Pull unbilled from all clients |
| 🗑 Clear Unbilled Report | `CB13_clearUnbilledReport()` | Clear report data |
| 💾 Export to QuickBooks (IIF) | `CB13_qbExportFromUnbilledSelection()` | QB IIF export |
| 🧾 Create & Send Invoices (PDF) | `CB13_createAndSendInvoices()` | Invoice creation + email |
| 📧 Re-send Invoice Email | `CB13_resendInvoiceEmail()` | Resend existing invoice |
| 🔄 Sync Settings to Client | `StrideSyncSettingsToClient()` | Push settings to client sheet |

**Phase 3 Menu (optional install):**
| Menu Item | Function | Purpose |
|-----------|----------|---------|
| Batch Print Invoices | `StrideBatchPrintInvoices_Phase3()` | Batch PDF regeneration |
| Install OnOpen Trigger | `StrideBillingPhase3_InstallOnOpenMenuTrigger()` | Install Phase 3 menu trigger |

#### Client Onboarding (`Client_Onboarding.js` — v1.5.0)

**Triggers:**
| Trigger | Type | Function | Purpose |
|---------|------|----------|---------|
| onEdit delegate | Edit | `handleOnboardEditTrigger_(e)` | Fires when "Run Onboard" checkbox = TRUE |

**Menu Items (added to Stride Billing menu):**
| Menu Item | Function | Purpose |
|-----------|----------|---------|
| Sync Settings to Client | `StrideSyncSettingsToClient()` | Sync CB → client Settings |
| Migrate Clients Tab (v1.4.0) | `StrideMigrateClientsTab_v140()` | One-time layout migration |

#### Task Board Script (`task board script.txt` — v1.4.0)

**Triggers:**
| Trigger | Type | Function | Purpose |
|---------|------|----------|---------|
| onOpen | Simple | `onOpen()` | Creates "Stride Task Board" menu |
| onEdit | Installable | `TB_onEdit(e)` | Handles checkbox completion triggers on board |

**Menu: "Stride Task Board":**
| Menu Item | Function | Purpose |
|-----------|----------|---------|
| 🔄 Refresh Board | `TB_refreshBoard()` | Pull tasks from all clients |
| 📋 Filter by Type | `TB_filterByType()` | Filter task view |
| 📋 Filter by Status | `TB_filterByStatus()` | Filter task view |
| 🔍 Filter by Client | `TB_filterByClient()` | Filter task view |
| ✖ Clear Filters | `TB_clearFilters()` | Remove all filters |
| ⚙ Setup | `TB_setup()` | Initialize board sheets |
| 📊 Board Settings | `TB_showSettings()` | Show settings dialog |
| 🔄 Force Sync All | `TB_forceSyncAll()` | Full resync |
| 🔒 Protect Board | `TB_protectBoard()` | Apply protections |
| 📧 Send Task Notification | `TB_sendNotification()` | Email notification |

#### Master Price List Script (`Master Price list script.txt` — v2.1.1)

**Triggers:**
| Trigger | Type | Function | Purpose |
|---------|------|----------|---------|
| onOpen | Simple | `onOpen(e)` | Creates "Stride Master" menu |
| doGet | Web app | `doGet(e)` | RPC endpoint for invoice/shipment ID generation |
| doPost | Web app | `doPost(e)` | RPC endpoint (JSON body) |

**Menu: "Stride Master":**
| Menu Item | Function | Purpose |
|-----------|----------|---------|
| 🔄 Refresh Templates | `MPL_refreshTemplates()` | Reload email/invoice templates |
| ⚙ Settings | `MPL_showSettings()` | Show settings dialog |

**RPC Actions (doGet/doPost → `handleApiCall_`):**
| Action | Function | Response |
|--------|----------|----------|
| `getNextInvoiceId` | Counter increment | `{ success: true, invoiceNo: "INV-000123" }` |
| `getNextShipmentId` | Counter increment | `{ success: true, shipmentNo: "SHP-000456" }` |
| `getNextTaskId` | Counter increment | `{ success: true, taskId: "TSK-000789" }` |
| `getPricing` | Read Price_List | `{ success: true, pricing: [...] }` |
| `getClassMap` | Read Class_Map | `{ success: true, classMap: {...} }` |
| `getEmailTemplate` | Read Email_Templates | `{ success: true, template: {...} }` |

#### QR Scanner Backend (`ScannerBackend.gs.txt` — v1.3.0)

**Triggers:**
| Trigger | Type | Function | Purpose |
|---------|------|----------|---------|
| doGet | Web app | `doGet(e)` | API endpoint + HTML page serving |
| doPost | Web app | `doPost(e)` | JSON API (backwards compat) |

**API Routes** (10 actions — see B1 QR Scanner section above)

#### QR Index Builder (`IndexBuilder.gs.txt` — v1.2.0)

**Triggers:**
| Trigger | Type | Function | Purpose |
|---------|------|----------|---------|
| Time-based | Installable | `qrScheduledIndexRebuild()` | 6-hour auto-rebuild |

**Setup functions:**
- `qrInstallIndexTrigger()` — Install 6-hour trigger
- `qrRemoveIndexTrigger()` — Remove trigger

#### Billing Logs (`Billing Logs.js` — v2.0.0)

**Setup functions:**
- `installBillingLogSheets()` — Create Billing_Log sheet, delete legacy log sheets

#### CB13 Schema Migration (`CB13 Schema Migration.js`)

**Menu-callable:**
- `CB13_runSchemaMigration()` — Prompt for client SS ID, run migration
- `CB13_repairClientBillingColumns()` — Fix column shift corruption

---

### C2. Sheet-Driven Logic

#### Settings Keys (Client Sheet → Settings Tab)

| Key | Type | Default | Purpose | Script |
|-----|------|---------|---------|--------|
| `CLIENT_NAME` | String | — | Client display name | Client, CB |
| `CLIENT_EMAIL` | String | — | Email for notifications/invoices | Client, CB |
| `NOTIFICATION_EMAILS` | String | — | Additional CC emails (comma-separated) | Client, CB |
| `MASTER_SPREADSHEET_ID` | String | — | Link to Master Price List | Client |
| `CONSOLIDATED_BILLING_SPREADSHEET_ID` | String | — | Link back to CB | Client |
| `DRIVE_PARENT_FOLDER_ID` | String | — | Client's root Drive folder | Client, CB |
| `PHOTOS_FOLDER_ID` | String | — | Photos subfolder | Client, CB |
| `MASTER_ACCOUNTING_FOLDER_ID` | String | — | Invoices subfolder | Client, CB |
| `FREE_STORAGE_DAYS` | Number | 0 | Days before storage billing starts | CB (STOR) |
| `DISCOUNT_STORAGE_PCT` | Number | 0 | Storage discount (-10 to +10) | CB, Invoice |
| `DISCOUNT_SERVICES_PCT` | Number | 0 | Services discount (-10 to +10) | CB, Invoice |
| `PAYMENT_TERMS` | String | "CC ON FILE" | Invoice payment terms | Invoice |
| `ENABLE_RECEIVING_BILLING` | Boolean | TRUE | Auto-create RCVG billing | Client |
| `ENABLE_SHIPMENT_EMAIL` | Boolean | TRUE | Send receiving email | Client |
| `ENABLE_NOTIFICATIONS` | Boolean | TRUE | Send email notifications | Client |
| `AUTO_INSPECTION` | Boolean | TRUE | Auto-create inspection tasks | Client |
| `SEPARATE_BY_SIDEMARK` | Boolean | FALSE | Invoice grouping by sidemark | CB, Invoice |
| `QB_CUSTOMER_NAME` | String | — | QuickBooks customer name override | QB Export |
| `LOGO_URL` | String | — | Client logo for documents | Client |
| `BILLING_LEDGER_COUNTER` | Number | 0 | Auto-increment for BL-XXXXXX IDs | CB (STOR) |
| `Invoice Folder ID` | String | — | Auto-created invoice subfolder | Invoice |

#### Settings Keys (Consolidated Billing → Settings Tab)

| Key | Type | Purpose |
|-----|------|---------|
| `MASTER_SPREADSHEET_ID` | String | Master Price List SS ID |
| `CLIENT_PARENT_FOLDER_ID` | String | Parent folder for new client folders |
| `CLIENT_INVENTORY_TEMPLATE_ID` | String | Template SS ID for new clients |
| `DOC_TEMPLATES_FOLDER_ID` | String | Google Doc templates folder |
| `OWNER_EMAIL` | String | Owner email for error notifications |
| `NOTIFICATION_EMAILS` | String | Staff notification emails |
| `MASTER_RPC_URL` | String | Master web app URL for RPC |
| `MASTER_RPC_TOKEN` | String | Auth token for RPC calls |
| `IIF_EXPORT_FOLDER_ID` | String | Drive folder for IIF files |
| `INVOICE_FORMAT` | String | DETAILED or SIMPLIFIED |

#### Settings Keys (Master Price List → Settings Tab)

| Key | Type | Purpose |
|-----|------|---------|
| `INVOICE_COUNTER` | Number | Next invoice number |
| `SHIPMENT_COUNTER` | Number | Next shipment number |
| `DOC_INVOICE_TEMPLATE_ID` | String | Google Doc invoice template ID |
| `RPC_TOKEN` | String | Expected token for RPC validation |

#### Required Sheet/Tab Names

**Client Spreadsheet (×N):**
| Tab | Purpose | Headers Defined In |
|-----|---------|-------------------|
| `Inventory` | Item master | C9 section below |
| `Shipments` | Receiving records | C9 section below |
| `Tasks` | Work orders | C9 section below |
| `Repairs` | Repair orders | C9 section below |
| `Will_Calls` | Pickup orders | C9 section below |
| `WC_Items` | Will call line items | C9 section below |
| `Billing_Ledger` | All billable events | C9 section below |
| `Settings` | Key/Value config | Key, Value, Notes |
| `Price_Cache` | Cached pricing from Master | Svc Code, Class columns |
| `Class_Cache` | Class → cubic volume map | Class, Volume |
| `Setup_Instructions` | Hidden setup guide | — |

**Consolidated Billing (×1):**
| Tab | Purpose |
|-----|---------|
| `Clients` | Client registry with onboarding |
| `Settings` | CB-level config |
| `Unbilled_Report` | Staging for invoice creation |
| `Consolidated_Ledger` | Master billing record |
| `Billing_Log` | Audit trail |
| `QB_Invoice_Export` | QB staging (auto-created) |
| `QB_Service_Mapping` | Svc Code → QB account map |

**Master Price List (×1):**
| Tab | Purpose |
|-----|---------|
| `Price_List` | Service rates by class |
| `Class_Map` | Class definitions + cubic volumes |
| `Email_Templates` | Email templates (10+ rows) |
| `Invoice_Templates` | Invoice HTML templates (legacy) |
| `Settings` | Master config + counters |

**Task Board (×1):**
| Tab | Purpose |
|-----|---------|
| `Board` | Cross-client task dashboard |
| `Settings` | Board config |

#### Header-Sync Logic

- `ensureHeaderRowSafe_(sheet, requiredHeaders, renames)` — Non-destructive: renames legacy columns (e.g., "Ledger Entry ID" → "Ledger Row ID"), appends missing headers at end, never removes/reorders existing columns
- `ensureHeaderRowExact_(sheet, headers)` — Exact match: resets header row if mismatch
- All column lookups use `headerMapFromRow_()` — builds case-insensitive map of header name → 0-based column index
- Architectural decision: Consolidated_Ledger headers are authoritative; client Billing_Ledger syncs from them

#### Cache Tabs

| Cache | Location | Source | Refresh |
|-------|----------|--------|---------|
| `Price_Cache` | Client sheet | Master Price_List | `refreshPriceCache_()` menu action |
| `Class_Cache` | Client sheet | Master Class_Map | `refreshAllCaches_()` |
| QR Item Index | CacheService (script-scoped) | All client Inventories | 6-hour auto-rebuild + on-demand |

#### Checkbox Columns That Drive Behavior

| Sheet | Column | Trigger | Action |
|-------|--------|---------|--------|
| Clients (CB) | Run Onboard | onEdit | Full onboarding workflow |
| Tasks | Complete (checkbox) | onEdit | Task completion processing |
| Repairs | Complete (checkbox) | onEdit | Repair completion processing |
| Repairs | Quote Sent (checkbox) | onEdit | Quote email trigger |
| Repairs | Approved (checkbox) | onEdit | Approval processing |
| Task Board | Complete (checkbox) | TB_onEdit | Shared handler completion |
| Task Board | Quote Sent (checkbox) | TB_onEdit | Shared handler quote |
| Task Board | Approved (checkbox) | TB_onEdit | Shared handler approval |

#### Dropdown Validations

| Sheet | Column | Values | Purpose |
|-------|--------|--------|---------|
| Inventory | Status | Active, Released, On Hold, Transferred | Item lifecycle |
| Tasks | Status | Open, In Progress, Complete, Cancelled | Task lifecycle |
| Tasks | Type | Inspection, Assembly, Minor Touch-Up, Custom | Task classification |
| Repairs | Status | Open, Quoted, Approved, In Progress, Complete, Cancelled, Declined | Repair lifecycle |
| Will_Calls | Status | Pending, Ready, Released, Cancelled | WC lifecycle |
| Billing_Ledger | Status | Unbilled, Invoiced, Billed, Void | Billing lifecycle |
| Unbilled_Report | Status | Unbilled, Invoiced, Void | Report status filter |

---

### C3. Workflow Side Effects

#### Complete Shipment
| Step | Side Effect | Target |
|------|-------------|--------|
| 1 | Create Shipment row (SHP-XXXXXX) | Shipments tab |
| 2 | Create inventory items (one per line) | Inventory tab |
| 3 | Create RCVG billing rows (one per item) | Billing_Ledger |
| 4 | Create auto-inspection tasks (if AUTO_INSPECTION=TRUE) | Tasks tab |
| 5 | Create Drive folder for shipment | Google Drive |
| 6 | Create Photos subfolder | Google Drive |
| 7 | Generate Receiving PDF document | Google Drive |
| 8 | Send receiving email with PDF attachment | Gmail |
| 9 | Set shipment status to "Complete" | Shipments tab |

#### Complete Task
| Step | Side Effect | Target |
|------|-------------|--------|
| 1 | Set status to "Complete" | Tasks tab |
| 2 | Set "Completion Processed At" timestamp | Tasks tab |
| 3 | Create billing row (INSP/ASM/MNRTU) | Billing_Ledger |
| 4 | Generate Work Order PDF | Google Drive |
| 5 | Send completion email with PDF | Gmail |
| 6 | Set "Email Sent At" timestamp | Tasks tab |
| 7 | Update Task Board __Sync Status | Task Board (if synced) |

#### Complete Repair
| Step | Side Effect | Target |
|------|-------------|--------|
| 1 | Set status to "Complete" | Repairs tab |
| 2 | Set "Completion Processed At" timestamp | Repairs tab |
| 3 | Create REPAIR billing row | Billing_Ledger |
| 4 | Generate Repair Work Order PDF | Google Drive |
| 5 | Send completion email with PDF | Gmail |
| 6 | Set "Email Sent At" timestamp | Repairs tab |

#### Send Repair Quote
| Step | Side Effect | Target |
|------|-------------|--------|
| 1 | Set status to "Quoted" | Repairs tab |
| 2 | Set "Quote Sent At" timestamp | Repairs tab |
| 3 | Generate Repair Quote PDF | Google Drive |
| 4 | Send quote email with PDF | Gmail |

#### Approve Repair
| Step | Side Effect | Target |
|------|-------------|--------|
| 1 | Set status to "Approved" → "In Progress" | Repairs tab |
| 2 | Set "Approval Processed At" timestamp | Repairs tab |
| 3 | Send approval confirmation email | Gmail |

#### Create Will Call
| Step | Side Effect | Target |
|------|-------------|--------|
| 1 | Create WC row (WC-XXXXXX) | Will_Calls tab |
| 2 | Create WC_Items rows (one per assigned item) | WC_Items tab |
| 3 | Update item status to "On Hold" | Inventory tab |
| 4 | Set COD amount if applicable | Will_Calls tab |
| 5 | Generate Will Call PDF | Google Drive |
| 6 | Send WC notification email with PDF | Gmail |

#### Process Will Call Release
| Step | Side Effect | Target |
|------|-------------|--------|
| 1 | Set WC status to "Released" | Will_Calls tab |
| 2 | Update WC_Items status to "Released" | WC_Items tab |
| 3 | Set item status to "Released" | Inventory tab |
| 4 | Set item Release Date | Inventory tab |
| 5 | Create WC billing rows (one per item) | Billing_Ledger |
| 6 | Generate release confirmation | Google Drive |
| 7 | Send release email | Gmail |

#### Transfer Items
| Step | Side Effect | Target |
|------|-------------|--------|
| 1 | Set source item status to "Transferred" | Source Inventory |
| 2 | Create item in destination client sheet | Dest Inventory |
| 3 | Move unbilled billing rows to destination | Source → Dest Billing_Ledger |
| 4 | Send transfer email notification | Gmail (TRANSFER_RECEIVED template) |

#### Client Onboarding
| Step | Side Effect | Target |
|------|-------------|--------|
| 1 | Create client Drive folder | Google Drive |
| 2 | Create Photos subfolder | Google Drive |
| 3 | Create Invoices subfolder | Google Drive |
| 4 | Copy template spreadsheet | Google Drive |
| 5 | Write settings to new client sheet | Client Settings tab |
| 6 | Import inventory (if Import URL provided) | Client Inventory + Tasks |
| 7 | Write IDs back to Clients tab | CB Clients tab |
| 8 | Set Active=TRUE | CB Clients tab |
| 9 | Send internal onboard notification email | Gmail |
| 10 | Send client welcome email | Gmail |

#### Invoice Creation
| Step | Side Effect | Target |
|------|-------------|--------|
| 1 | Get invoice number from Master RPC | Master Settings counter |
| 2 | Copy Google Doc template | Google Drive |
| 3 | Populate template with tokens | Google Doc |
| 4 | Export as PDF | Google Drive |
| 5 | Save PDF to master + client invoice folders | Google Drive |
| 6 | Delete temp Google Doc | Google Drive |
| 7 | Write rows to Consolidated_Ledger | CB Consolidated_Ledger |
| 8 | Update client Billing_Ledger status → "Invoiced" | Client Billing_Ledger |
| 9 | Mark Unbilled_Report rows "Invoiced" | CB Unbilled_Report |
| 10 | Send invoice email with PDF | Gmail |
| 11 | Update Email Status column | CB Consolidated_Ledger |
| 12 | Log to Billing_Log | CB Billing_Log |

---

### C4. Validation / Guardrail Logic

#### Status Transition Rules

**Inventory Status:**
- Active → Released (via WC Release or manual)
- Active → On Hold (via WC creation)
- Active → Transferred (via Transfer Items)
- On Hold → Released (via WC Release)
- On Hold → Active (via WC cancellation)
- ❌ Released → Active (not allowed)
- ❌ Transferred → Active (not allowed)

**Task Status:**
- Open → In Progress → Complete
- Open → Cancelled
- In Progress → Cancelled
- ❌ Complete → any (final state)

**Repair Status:**
- Open → Quoted → Approved → In Progress → Complete
- Any → Cancelled (except Complete)
- Quoted → Declined
- ❌ Complete → any (final state)

**Billing Status:**
- Unbilled → Invoiced (via invoice creation)
- Unbilled → Void (via manual action)
- Invoiced → Billed (via payment confirmation)
- ❌ Invoiced → Unbilled (not allowed)
- ❌ Void → any (final state)

#### Protected Fields
- Shipment # — auto-generated, not editable after creation
- Item ID — auto-generated, not editable
- Task ID — auto-generated
- Repair ID — auto-generated
- WC ID — auto-generated
- Ledger Row ID — auto-generated (BL-XXXXXX)
- Invoice # — auto-generated from Master RPC
- Completion Processed At — set by system only
- Email Sent At — set by system only
- Quote Sent At — set by system only
- Approval Processed At — set by system only

#### Required Fields per Operation
- **Complete Shipment:** At least 1 item row with Item ID + Description + Class
- **Create Task:** Item ID, Task Type
- **Create Repair:** Item ID (from task conversion)
- **Create Will Call:** At least 1 item selected, Pickup contact info
- **Send Invoice:** At least 1 unbilled row selected, Master RPC available
- **Storage Charges:** Start date, End date, at least 1 active client with Active items

#### Duplicate Prevention
- Item IDs: Checked during import (existingIds set)
- Shipment #: Counter-based (SHP-XXXXXX), no duplicates possible
- Task IDs: Counter-based + prefix
- STOR charges: Task ID format "STOR-{ItemID}-{date}-{date}" checked against finalized rows
- Ledger Row IDs: Counter-based (BL-XXXXXX), LockService-protected allocation
- Invoice #: Master RPC counter, atomic increment

#### Admin-Only Operations
- Setup (initialize sheets)
- Protect/unprotect sheets
- Client onboarding
- Schema migration
- Billing Log installation
- Settings sync
- Storage charge generation
- Invoice creation

---

### C5. Idempotency / Duplicate Prevention

#### LockService Usage
| Script | Function | Lock Type | Timeout |
|--------|----------|-----------|---------|
| Client Inventory | `onEdit` (checkbox handlers) | Script lock | 10s |
| CB Code.gs | `StrideGenerateUnbilledReport` | Script lock | 30s |
| CB Code.gs | `StrideGenerateStorageCharges` | Script lock | 30s |
| CB Code.gs | `StrideApproveOrVoidInvoices` | Script lock | 30s |
| CB Code.gs | `StrideBatchPrintInvoices_Phase3` | Script lock | 30s |
| CB Preview | `CB13_createAndSendInvoices` | Script lock | 30s |
| QR Scanner | `qrUpdateLocations` | Script lock | 15s |
| Task Board | `TB_onEdit` | Script lock | 10s |

#### Processed-At Markers
| Marker Column | Sheet | Prevents |
|--------------|-------|----------|
| `Completion Processed At` | Tasks | Double task completion |
| `Completion Processed At` | Repairs | Double repair completion |
| `Email Sent At` | Tasks | Double email send |
| `Email Sent At` | Repairs | Double email send |
| `Quote Sent At` | Repairs | Double quote email |
| `Approval Processed At` | Repairs | Double approval processing |

#### Storage Billing Dedup
- **Task ID format:** `STOR-{ItemID}-{YYYYMMDD}-{YYYYMMDD}`
- **Dedup set:** Built from finalized rows only (status = Invoiced/Billed/Void)
- **Cleanup:** Before generating, delete all unbilled STOR rows in date range
- **Result:** Safe to re-run — regenerates unbilled, skips already-invoiced

#### Invoice Dedup
- **Consolidated_Ledger:** Check existing Ledger Row IDs before append (v1.3.2 fix)
- **Unbilled_Report:** Skip rows already marked "Invoiced"
- **Master RPC:** Atomic counter increment prevents duplicate invoice numbers

#### Email Resend Protection
- Email Sent At timestamp prevents auto-resend
- Manual resend via menu bypasses (intentional)

---

### C6. Cross-Script Dependencies

#### Master ↔ Client Dependencies
| From | To | Data | Mechanism |
|------|----|------|-----------|
| Master Price_List | Client Price_Cache | Service rates by class | `refreshPriceCache_()` copies rows |
| Master Class_Map | Client Class_Cache | Class → cubic volume | `refreshAllCaches_()` copies rows |
| Master Email_Templates | Client email sends | Template HTML + tokens | Read at send time via MASTER_SPREADSHEET_ID |
| Master Settings | Client via RPC | Invoice/Shipment/Task IDs | HTTP POST to Master doGet/doPost |
| Master Invoice_Templates | Invoice PDF generation | HTML template (legacy) | Read at invoice time |
| Master Settings.DOC_INVOICE_TEMPLATE_ID | Invoice PDF | Google Doc template ID | Read at invoice time |

#### Client ↔ CB Dependencies
| From | To | Data | Mechanism |
|------|----|------|-----------|
| CB Clients tab | Client Settings tab | All client config | `writeSettingsToClientSheet_()` one-way sync |
| Client Billing_Ledger | CB Unbilled_Report | Unbilled rows | `CB13_generateUnbilledReport()` pulls |
| Client Billing_Ledger | CB Consolidated_Ledger | Invoice rows | `appendConsolidatedLedgerRow_()` writes |
| CB Consolidated_Ledger | Client Billing_Ledger | Status/Invoice # updates | `pushStatusToClientLedger_()` syncs back |
| CB onEdit | Client Billing_Ledger | Status changes | Two-way sync on Consolidated_Ledger edits |
| Client Inventory | CB storage charges | Active items for STOR calc | Read during `StrideGenerateStorageCharges()` |

#### Client ↔ Task Board Dependencies
| From | To | Data | Mechanism |
|------|----|------|-----------|
| Client Tasks/Repairs | Task Board Board tab | Task/repair rows | `TB_refreshBoard()` pulls from all clients |
| Task Board checkbox | Client Tasks/Repairs | Completion/quote/approval | Shared handlers (SH_*) write back to client |
| Task Board | Client Billing_Ledger | Billing on completion | Shared handlers create billing rows |

**Shared Handler Functions (SH_ prefix, parity-controlled v1.1.0):**
Both `inventory code.gs.txt` and `task board script.txt` contain identical copies:
- `SH_processTaskCompletionById_(clientSsId, taskId)`
- `SH_processRepairCompletionById_(clientSsId, repairId)`
- `SH_processRepairQuoteById_(clientSsId, repairId)`
- `SH_processRepairApprovalById_(clientSsId, repairId)`
- `SH_lookupRate_(clientSs, svcCode, className)`
- `SH_generateRepairWorkOrderPdf_(clientSs, repairRow, headers)`
- `SH_generateTaskWorkOrderPdf_(clientSs, taskRow, headers)`
- `SH_sendTemplateEmail_(clientSs, templateKey, tokens, pdfFile)`
- `SH_getHeaderMap_(sheet)` / `SH_getHeaderMapFromRow_(row)`
- `SH_createBillingRow_(clientSs, params)`

**Version parity:** `SHARED_HANDLER_VERSION = "1.1.0"` — must match in both scripts.

#### Email/Invoice Template Dependencies
- 10 email template keys in Master Email_Templates tab (rows 2-15)
- Template keys: RECEIVING, TASK_COMPLETE, REPAIR_QUOTE, REPAIR_COMPLETE, REPAIR_APPROVED, REPAIR_DECLINED, WILL_CALL, WC_RELEASE, WELCOME_EMAIL, TRANSFER_RECEIVED
- Token format: `{{TOKEN_NAME}}` replaced at send time
- Invoice template: Google Doc with `{{INV_NO}}`, `{{CLIENT_NAME}}`, `{{INV_DATE}}`, etc.

---

### C7. Non-UI Admin / Backoffice Functions

| Function | Script | Purpose | Trigger |
|----------|--------|---------|---------|
| `refreshPriceCache_()` | Client | Sync Price_List from Master to Price_Cache | Menu |
| `refreshAllCaches_()` | Client | Refresh Price_Cache + Class_Cache | Menu |
| `recalculateBilling_()` | Client | Recalculate all billing from scratch | Menu |
| `protectSheets_()` | Client | Apply sheet protections | Menu |
| `StrideGenerateStorageCharges()` | CB | Generate STOR charges for all clients | Menu (wrapped with logs) |
| `CB13_generateUnbilledReport()` | CB | Pull unbilled from all clients | Menu (wrapped with logs) |
| `CB13_clearUnbilledReport()` | CB | Clear report data | Menu |
| `StrideBillingSetup()` | CB | Initialize all sheets/settings | Menu |
| `StrideSafeUpdateHeaders()` | CB | Non-destructive header migration | Called by Setup |
| `StrideBillingPhase3_AddMenu()` | CB | Install Phase 3 menu | Menu |
| `installBillingLogSheets()` | CB | Create Billing_Log, delete legacy logs | Setup |
| `CB13_qbExportFromUnbilledSelection()` | CB | Export selected rows to QB IIF | Menu |
| `CB13_qbExport_buildStagingSheet()` | CB | Stage invoiced rows for QB | Internal |
| `CB13_qbExport_generateIIF()` | CB | Generate IIF file from staging | Internal |
| `onboardNewClient_()` | CB | Full client onboarding | Edit trigger (Run Onboard) |
| `StrideSyncSettingsToClient()` | CB | Push settings to client(s) | Menu |
| `StrideMigrateClientsTab_v140()` | CB | One-time layout migration | Menu |
| `CB13_runSchemaMigration()` | CB | Run schema migration on client | Menu |
| `CB13_repairClientBillingColumns()` | CB | Fix column-shift corruption | Menu |
| `TB_refreshBoard()` | Task Board | Pull tasks from all clients | Menu |
| `TB_forceSyncAll()` | Task Board | Full resync | Menu |
| `TB_setup()` | Task Board | Initialize board sheets | Menu |
| `TB_protectBoard()` | Task Board | Apply protections | Menu |
| `qrBuildIndex()` | QR Scanner | Build global item index | API/Trigger |
| `qrRefreshIndex()` | QR Scanner | Force index rebuild | API |
| `qrInstallIndexTrigger()` | QR Scanner | Install 6-hour trigger | Manual |
| `qrSetupLocationsSheet()` | QR Scanner | Create Locations sheet | API |
| `CB13_createInvoiceDocTemplate()` | CB Invoice | Create master Doc template | Manual |

---

### C8. Menu Action Parity

#### Client Inventory — "Stride Client" Menu
| Menu Item | Function | App Feature | Admin-Only | Prerequisites |
|-----------|----------|-------------|------------|---------------|
| View Active Inventory | `showActiveInventory_()` | Inventory page filter | No | Inventory tab exists |
| View All Items | `showAllItems_()` | Inventory page (no filter) | No | Inventory tab exists |
| Inventory Summary | `showInventorySummary_()` | Dashboard stats | No | Inventory tab exists |

#### Client Inventory — "Stride Warehouse" Menu
| Menu Item | Function | App Feature | Admin-Only | Prerequisites |
|-----------|----------|-------------|------------|---------------|
| Complete Shipment | `completeShipment_()` | Receiving page → Complete button | Yes (staff) | Shipment rows filled |
| Complete Selected Tasks | `completeSelectedTasks_()` | Tasks page → Complete action | Yes (staff) | Tasks selected |
| Create Repair from Task | `createRepairFromTask_()` | Tasks page → Create Repair action | Yes (staff) | Task selected |
| Create Will Call | `showCreateWillCallDialog_()` | Will Calls page → Create button | Yes (staff) | Items available |
| Process Will Call Release | `processWillCallRelease_()` | Will Calls page → Release button | Yes (staff) | WC in Ready status |
| Transfer Items | `showTransferDialog_()` | Transfer modal | Yes (admin) | Multiple clients exist |
| Recalculate Billing | `recalculateBilling_()` | Admin-only (no UI equivalent yet) | Yes (admin) | Billing_Ledger exists |
| Regenerate Document | `regenerateDocument_()` | Detail panel → Regen PDF action | Yes (staff) | Record with PDF exists |
| Resend Email | `resendEmail_()` | Detail panel → Resend Email action | Yes (staff) | Record with email exists |
| Refresh Price Cache | `refreshPriceCache_()` | Settings → Integrations (auto) | Yes (admin) | Master SS ID set |
| Import Inventory | `showImportDialog_()` | Admin-only (onboarding flow) | Yes (admin) | Old spreadsheet URL |
| Protect Sheets | `protectSheets_()` | Spreadsheet-only (no app equiv) | Yes (admin) | — |

#### Consolidated Billing — "Stride Billing" Menu
| Menu Item | Function | App Feature | Admin-Only | Prerequisites |
|-----------|----------|-------------|------------|---------------|
| Setup | `StrideBillingSetup()` | Admin-only (one-time) | Yes | Owner access |
| Generate Storage Charges | `StrideGenerateStorageCharges_WithLogs()` | Billing page → Generate STOR button | Yes | Date range input |
| Generate Unbilled Report | `CB13_generateUnbilledReport_WithLogs()` | Billing page → Unbilled Report button | Yes | End date input |
| Clear Unbilled Report | `CB13_clearUnbilledReport()` | Billing page → Clear button | Yes | Report exists |
| Export to QuickBooks | `CB13_qbExportFromUnbilledSelection()` | Billing page → QB Export modal | Yes | Rows selected |
| Create & Send Invoices | `CB13_createAndSendInvoices()` | Billing page → Create Invoice modal | Yes | Rows selected |
| Re-send Invoice Email | `CB13_resendInvoiceEmail()` | Billing page → Resend action | Yes | Invoice exists |
| Sync Settings to Client | `StrideSyncSettingsToClient()` | Settings → Client sync button | Yes | Client selected |

#### Task Board — "Stride Task Board" Menu
| Menu Item | Function | App Feature | Admin-Only | Prerequisites |
|-----------|----------|-------------|------------|---------------|
| Refresh Board | `TB_refreshBoard()` | Tasks page auto-refresh | No | — |
| Filter by Type/Status/Client | `TB_filter*()` | Tasks page filters | No | Board populated |
| Clear Filters | `TB_clearFilters()` | Tasks page → Clear filters | No | — |
| Setup | `TB_setup()` | Admin-only (one-time) | Yes | — |
| Board Settings | `TB_showSettings()` | Spreadsheet-only | Yes | — |
| Force Sync All | `TB_forceSyncAll()` | Admin-only | Yes | — |
| Protect Board | `TB_protectBoard()` | Spreadsheet-only | Yes | — |
| Send Notification | `TB_sendNotification()` | App notification system | Yes | Task selected |

#### Master Price List — "Stride Master" Menu
| Menu Item | Function | App Feature | Admin-Only | Prerequisites |
|-----------|----------|-------------|------------|---------------|
| Refresh Templates | `MPL_refreshTemplates()` | Spreadsheet-only | Yes | — |
| Settings | `MPL_showSettings()` | Spreadsheet-only | Yes | — |

---

### C9. Column / Schema Parity

#### Inventory Tab
| Column | Required | Script-Used | Display-Only | Status | Linkage | Timestamp |
|--------|----------|-------------|--------------|--------|---------|-----------|
| Item ID | ✅ | ✅ | | | Primary key | |
| Description | ✅ | ✅ | | | | |
| Class | ✅ | ✅ | | | → Class_Cache volume | |
| Vendor | | ✅ | | | | |
| Qty | | ✅ | | | | |
| Location | | ✅ | | | QR scanner target | |
| Room | | ✅ | | | | |
| Sidemark | | ✅ | | | → Invoice grouping | |
| Status | ✅ | ✅ | | ✅ Active/Released/On Hold/Transferred | | |
| Receive Date | ✅ | ✅ | | | | ✅ |
| Release Date | | ✅ | | | | ✅ |
| Shipment # | | ✅ | | | → Shipments tab | |
| Item Notes | | ✅ | | | | |
| Photos | | ✅ | ✅ | | → Drive folder URL | |
| Inspection Notes | | ✅ | | | | |
| Assembly Status | | ✅ | | | | |

#### Shipments Tab
| Column | Required | Script-Used | Status | Linkage |
|--------|----------|-------------|--------|---------|
| Shipment # | ✅ | ✅ | | Primary key (SHP-XXXXXX) |
| Client | ✅ | ✅ | | |
| Date | ✅ | ✅ | | |
| Status | ✅ | ✅ | Draft/In Progress/Complete | |
| Items Count | | ✅ | | |
| Carrier | | ✅ | | |
| Tracking # | | ✅ | | |
| Notes | | ✅ | | |
| Folder URL | | ✅ | | → Drive shipment folder |
| PDF URL | | ✅ | | → Receiving document |

#### Tasks Tab
| Column | Required | Script-Used | Status | Linkage | Marker |
|--------|----------|-------------|--------|---------|--------|
| Task ID | ✅ | ✅ | | Primary key | |
| Item ID | ✅ | ✅ | | → Inventory | |
| Type | ✅ | ✅ | | | |
| Status | ✅ | ✅ | Open/In Progress/Complete/Cancelled | | |
| Assigned To | | ✅ | | | |
| Result | | ✅ | Pass/Fail | | |
| Notes | | ✅ | | | |
| Photos | | ✅ | | → Drive folder | |
| Svc Code | | ✅ | | → Billing | |
| Billed | | ✅ | | | |
| Completion Processed At | | ✅ | | | ✅ Idempotency |
| Email Sent At | | ✅ | | | ✅ Idempotency |
| Shipment # | | ✅ | | → Shipments | |

#### Repairs Tab
| Column | Required | Script-Used | Status | Linkage | Marker |
|--------|----------|-------------|--------|---------|--------|
| Repair ID | ✅ | ✅ | | Primary key | |
| Item ID | ✅ | ✅ | | → Inventory | |
| Source Task ID | | ✅ | | → Tasks | |
| Status | ✅ | ✅ | Open/Quoted/Approved/In Progress/Complete/Cancelled/Declined | | |
| Inspector Notes | | ✅ | | | |
| Repair Notes | | ✅ | | | |
| Estimate | | ✅ | | | |
| Final Cost | | ✅ | | | |
| Photos | | ✅ | | → Drive folder | |
| Svc Code | | ✅ | | → Billing | |
| Billed | | ✅ | | | |
| Completion Processed At | | ✅ | | | ✅ Idempotency |
| Email Sent At | | ✅ | | | ✅ Idempotency |
| Quote Sent At | | ✅ | | | ✅ Idempotency |
| Approval Processed At | | ✅ | | | ✅ Idempotency |

#### Will_Calls Tab
| Column | Required | Script-Used | Status | Linkage |
|--------|----------|-------------|--------|---------|
| WC ID | ✅ | ✅ | | Primary key (WC-XXXXXX) |
| Client | ✅ | ✅ | | |
| Status | ✅ | ✅ | Pending/Ready/Released/Cancelled | |
| Pickup Contact | | ✅ | | |
| Pickup Date | | ✅ | | |
| COD Amount | | ✅ | | |
| COD Paid | | ✅ | | |
| Items Count | | ✅ | | |
| Notes | | ✅ | | |
| Created Date | | ✅ | | |
| PDF URL | | ✅ | | → Drive WC document |

#### WC_Items Tab
| Column | Required | Script-Used | Status | Linkage |
|--------|----------|-------------|--------|---------|
| WC ID | ✅ | ✅ | | → Will_Calls |
| Item ID | ✅ | ✅ | | → Inventory |
| Description | | ✅ | | |
| Class | | ✅ | | |
| Status | | ✅ | Assigned/Released | |

#### Billing_Ledger Tab (Client)
| Column | Required | Script-Used | Status | Linkage | Marker |
|--------|----------|-------------|--------|---------|--------|
| Status | ✅ | ✅ | Unbilled/Invoiced/Billed/Void | | |
| Invoice # | | ✅ | | → Invoice PDF | |
| Client | ✅ | ✅ | | | |
| Date | ✅ | ✅ | | | |
| Svc Code | ✅ | ✅ | STOR/RCVG/INSP/ASM/MNRTU/WC/REPAIR | → Price_Cache | |
| Svc Name | | ✅ | | | |
| Category | | ✅ | | | |
| Item ID | | ✅ | | → Inventory | |
| Description | | ✅ | | | |
| Class | | ✅ | | → rate lookup | |
| Qty | | ✅ | | | |
| Rate | | ✅ | | | |
| Total | ✅ | ✅ | | | |
| Task ID | | ✅ | | → Tasks (+ STOR dedup key) | |
| Repair ID | | ✅ | | → Repairs | |
| Shipment # | | ✅ | | → Shipments | |
| Item Notes | | ✅ | | | |
| Ledger Row ID | ✅ | ✅ | | Primary key (BL-XXXXXX) | |
| Invoice Date | | ✅ | | | ✅ |
| Invoice URL | | ✅ | | → PDF link | |

#### Consolidated_Ledger Tab (CB)
| Column | Required | Script-Used | Linkage |
|--------|----------|-------------|---------|
| Status | ✅ | ✅ | |
| Invoice # | ✅ | ✅ | → Invoice PDF |
| Client | ✅ | ✅ | |
| Client Sheet ID | ✅ | ✅ | → Client SS |
| Ledger Row ID | ✅ | ✅ | → Client Billing_Ledger |
| Source Row | | ✅ | |
| Date | ✅ | ✅ | |
| Svc Code | ✅ | ✅ | |
| Svc Name | | ✅ | |
| Item ID | | ✅ | |
| Description | | ✅ | |
| Class | | ✅ | |
| Qty | | ✅ | |
| Rate | | ✅ | |
| Total | ✅ | ✅ | |
| Task ID | | ✅ | |
| Repair ID | | ✅ | |
| Shipment # | | ✅ | |
| Item Notes | | ✅ | |
| Email Status | | ✅ | Sent/Failed |
| Invoice URL | | ✅ | → PDF link |
| Date Added | | ✅ | |

#### Clients Tab (CB)
| Column | Required | Script-Used | Purpose |
|--------|----------|-------------|---------|
| Client Name | ✅ | ✅ | Display name |
| Client Spreadsheet ID | ✅ | ✅ | Link to client SS (auto-filled) |
| Client Folder ID | | ✅ | Drive folder (auto-filled) |
| Photos Folder ID | | ✅ | Photos subfolder (auto-filled) |
| Invoice Folder ID | | ✅ | Invoices subfolder (auto-filled) |
| Client Email | | ✅ | Synced to Settings |
| Free Storage Days | | ✅ | Synced to Settings |
| Discount Storage % | | ✅ | Synced to Settings |
| Discount Services % | | ✅ | Synced to Settings |
| Payment Terms | | ✅ | Synced to Settings |
| Enable Receiving Billing | | ✅ | Synced to Settings |
| Enable Shipment Email | | ✅ | Synced to Settings |
| Enable Notifications | | ✅ | Synced to Settings |
| Auto Inspection | | ✅ | Synced to Settings |
| Separate By Sidemark | | ✅ | Synced to Settings |
| Active | | ✅ | Auto-set after onboard |
| Run Onboard | | ✅ | Trigger checkbox |
| Notes | | | Free-form |
| QB_CUSTOMER_NAME | | ✅ | QB export override |
| Stax Customer ID | | ✅ | Stax payment mapping |
| Import Inventory URL | | ✅ | Old SS URL for import |

---

### C10. Real Action Parity Matrix

| # | Spreadsheet Action | Trigger | Purpose | Source Sheet | Target Sheet | Side Effects | Validations | API Endpoint Needed | UI Surface | Sheet-Only? |
|---|-------------------|---------|---------|-------------|-------------|-------------|-------------|-------------------|-----------|-------------|
| 1 | Complete Shipment | Menu | Process receiving | Shipments | Inventory, Billing_Ledger, Tasks | PDF, email, Drive folders | Items filled, class valid | `POST /api/shipments/:id/complete` | Receiving page | No |
| 2 | Complete Task | Menu/Checkbox | Finish task | Tasks | Billing_Ledger | PDF, email, billing row | Task exists, not already complete | `PUT /api/tasks/:id/complete` | Tasks page | No |
| 3 | Create Repair from Task | Menu | Convert task to repair | Tasks | Repairs | New repair row | Task selected, inspection type | `POST /api/repairs` | Tasks page action | No |
| 4 | Send Repair Quote | Checkbox | Email quote | Repairs | — | PDF, email | Not already quoted | `PUT /api/repairs/:id/quote` | Repairs detail | No |
| 5 | Approve Repair | Checkbox | Approve work | Repairs | — | Email | In Quoted status | `PUT /api/repairs/:id/approve` | Client portal | No |
| 6 | Complete Repair | Checkbox | Finish repair | Repairs | Billing_Ledger | PDF, email, billing row | In Progress status | `PUT /api/repairs/:id/complete` | Repairs page | No |
| 7 | Create Will Call | Menu/Dialog | Schedule pickup | Will_Calls | WC_Items, Inventory | PDF, email | Items selected | `POST /api/willcalls` | WC page | No |
| 8 | Process WC Release | Menu | Release items | Will_Calls | Inventory, Billing_Ledger | Billing rows, email | WC in Ready status | `PUT /api/willcalls/:id/release` | WC page | No |
| 9 | Transfer Items | Menu/Dialog | Move between clients | Inventory | Dest Inventory, Billing_Ledger | Email (TRANSFER_RECEIVED) | Source items active | `POST /api/inventory/transfer` | Transfer modal | No |
| 10 | Generate Storage Charges | Menu | Create STOR rows | CB→Client Inventory | Client Billing_Ledger | Idempotent STOR rows | Date range, active items | `POST /api/billing/storage` | Billing page | No |
| 11 | Generate Unbilled Report | Menu | Pull unbilled rows | Client Billing_Ledger | CB Unbilled_Report | Report populated | End date | `GET /api/billing/unbilled` | Billing page | No |
| 12 | Create & Send Invoices | Menu | Invoice selected rows | CB Unbilled_Report | Consolidated_Ledger, Billing_Ledger | PDF, email, status update | Rows selected, RPC available | `POST /api/billing/invoices` | Billing page | No |
| 13 | QB Export (IIF) | Menu | Export to QuickBooks | CB Unbilled_Report | IIF file in Drive | File created | QB mappings set | `POST /api/billing/qb-export` | Billing page | No |
| 14 | Re-send Invoice Email | Menu | Resend PDF email | Consolidated_Ledger | — | Email | Invoice exists | `POST /api/billing/invoices/:id/resend` | Billing page | No |
| 15 | Client Onboarding | Edit trigger | Setup new client | CB Clients | Drive, new SS, Settings | Folders, SS, emails | Name filled, not yet onboarded | `POST /api/clients/onboard` | Settings page | No |
| 16 | Sync Settings | Menu | Push config to client | CB Clients | Client Settings | Settings updated | Client selected | `PUT /api/clients/:id/sync-settings` | Settings page | No |
| 17 | Refresh Price Cache | Menu | Sync pricing | Master Price_List | Client Price_Cache | Cache refreshed | Master SS ID set | `POST /api/settings/refresh-cache` | Settings page | No |
| 18 | Regenerate Document | Menu | Re-create PDF | Various | Drive | PDF regenerated | Record exists | `POST /api/documents/regenerate` | Detail panels | No |
| 19 | Resend Email | Menu | Re-send notification | Various | Gmail | Email sent | Record exists | `POST /api/emails/resend` | Detail panels | No |
| 20 | Protect Sheets | Menu | Apply protections | — | Sheet protections | — | — | — | — | ✅ Yes |
| 21 | Setup (CB) | Menu | Initialize sheets | — | CB sheets | — | Owner only | — | — | ✅ Yes |
| 22 | Schema Migration | Menu | Fix column layout | Billing_Ledger | Billing_Ledger | Columns repaired | — | — | — | ✅ Yes |
| 23 | Install Billing Logs | Menu | Create log sheet | — | Billing_Log | Legacy deleted | — | — | — | ✅ Yes |
| 24 | Batch Print Invoices | Menu | Regenerate PDFs | Consolidated_Ledger | Drive | PDFs created | Invoice #s exist | — | — | ✅ Yes (admin batch) |
| 25 | View Active Inventory | Menu | Filter view | Inventory | — | Filter applied | — | `GET /api/inventory?status=Active` | Inventory page | No |
| 26 | Inventory Summary | Menu | Stats dialog | Inventory | — | Dialog shown | — | `GET /api/inventory/summary` | Dashboard | No |
| 27 | QR Location Update | Web API | Scan & update | QR Index | Client Inventory | Location changed | Items in index | Already exists | QR Scanner | No |
| 28 | QR Item Lookup | Web API | Scan to find | QR Index | — | — | Item exists | Already exists | QR Scanner | No |
| 29 | Import Inventory | Menu/Dialog | Legacy migration | Old SS | New Inventory + Tasks | Items + tasks created | Old URL valid | `POST /api/inventory/import` | Admin only | No |
| 30 | Recalculate Billing | Menu | Refresh charges | Billing_Ledger | Billing_Ledger | Rows recalculated | — | `POST /api/billing/recalculate` | Admin only | No |

---

## PART D — GAP / RISK REPORT

### D1. Features in Sheets Not Yet in App

| Feature | Sheet Location | App Status | Priority |
|---------|---------------|------------|----------|
| Storage charge generation (STOR) | CB → StrideGenerateStorageCharges | UI button exists, no API | **Critical** |
| Invoice creation + PDF | CB → CB13_commitInvoice | UI modal exists, no API | **Critical** |
| Unbilled report generation | CB → CB13_generateUnbilledReport | UI modal exists, no API | **Critical** |
| QB IIF export | CB → CB13_qbExportFromUnbilledSelection | UI modal exists, no API | **High** |
| Client onboarding | CB → handleOnboardEditTrigger_ | UI modal exists, no API | **High** |
| Settings sync (CB → client) | CB → StrideSyncSettingsToClient | UI button exists, no API | **High** |
| Transfer items | Client → showTransferDialog_ | UI modal exists, no API | **High** |
| Recalculate billing | Client → recalculateBilling_ | No UI surface | Medium |
| Document regeneration | Client → regenerateDocument_ | No UI surface | Medium |
| Email resend (non-invoice) | Client → resendEmail_ | No UI surface | Medium |
| Import inventory (legacy) | Client → showImportDialog_ | No UI surface | Low |
| Sheet protections | Client → protectSheets_ | N/A (sheet-only) | N/A |
| Schema migration/repair | CB → CB13_repairClientBillingColumns | N/A (sheet-only) | N/A |

### D2. Spreadsheet Logic That Can't Yet Be Supported

| Logic | Issue | Mitigation |
|-------|-------|------------|
| Google Doc template → PDF | Apps Script-specific API (DocumentApp, Drive export) | Keep server-side in Apps Script; app calls API endpoint that triggers PDF gen |
| Gmail sending | Apps Script GmailApp | Keep server-side; app triggers via API |
| Drive folder creation | Apps Script DriveApp | Keep server-side; app triggers via API |
| LockService | Apps Script concurrency control | Implement equivalent mutex via CacheService or Properties |
| onEdit triggers | Sheet-native event system | Replace with API calls from app UI actions |
| Two-way ledger sync | Consolidated_Ledger ↔ client Billing_Ledger via onEdit | Replace with API-mediated sync on write operations |
| Price_Cache / Class_Cache | Sheet-to-sheet copy | API endpoint returns pricing; app caches in React Query |
| Checkbox-driven workflows | Sheet checkboxes trigger onEdit | Replace with button clicks → API calls |
| Master RPC (doGet/doPost) | Cross-spreadsheet HTTP calls | Keep as-is; app also calls Master RPC directly or via proxy |

### D3. Workflow Ambiguity Needing Decisions

| # | Question | Impact | Options |
|---|----------|--------|---------|
| 1 | **Should the app replace sheet editing, or coexist?** | If coexist, two-way sync must remain; if replace, onEdit triggers can be simplified | A) Full replacement (cleaner) B) Coexist during transition (safer) |
| 2 | **Auth for API endpoints** | doGet/doPost currently have no auth (deployed as "anyone") | A) Token-based (simple, current RPC pattern) B) Firebase Auth integration C) Supabase Auth |
| 3 | **Invoice PDF generation — server or client?** | Google Doc templates require Apps Script | A) Keep server-side (recommended) B) Client-side with HTML→PDF library |
| 4 | **QR Scanner — keep JSONP or migrate to fetch?** | QR Scanner currently uses JSONP for iPhone Safari compat | A) Migrate to fetch (recommended) B) Keep JSONP for backward compat |
| 5 | **Real-time updates** | Sheets don't push changes to app | A) Polling (simple) B) Apps Script → webhook → app C) CacheService change detection |
| 6 | **Stax integration routing** | StaxAutoPay.gs inaccessible for audit | Must audit before building payment API endpoints |
| 7 | **Task Board — keep separate or merge into app?** | Task Board is a cross-client dashboard | A) Merge into app Tasks page (recommended) B) Keep as separate sheet tool |
| 8 | **Modular client inventory (stride-client-inventory/src/)** | Directory exists but src/ is empty — files not yet split | Must decide: split monolith before or after API layer |
| 9 | **Batch operations** | Storage charges, unbilled report process all clients sequentially | A) Keep sequential (simple) B) Parallel processing C) Queue-based |
| 10 | **Offline capability** | Warehouse workers may lose connectivity | Phase 8 item, but API design should accommodate |

### D4. Risk Assessment

#### Critical Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| **Billing parity break** | 🔴 Critical | Medium | Never calculate billing in React; all billing via Apps Script API; verify STOR totals match before/after |
| **Invoice ID duplication** | 🔴 Critical | Low | Keep Master RPC as single source; add LockService to counter increment |
| **Cross-client data leak** | 🔴 Critical | Low | Enforce client isolation at API layer; test with multi-client scenarios |
| **Storage charge double-billing** | 🔴 Critical | Medium | Maintain STOR Task ID dedup pattern; test with re-run scenarios |
| **Two-way ledger sync breaks** | 🔴 Critical | High (during transition) | If app and sheets coexist, onEdit trigger must still fire; test bidirectional sync |

#### High Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| **Email delivery failure** | 🟡 High | Medium | Keep GmailApp server-side; add retry logic; log all sends |
| **PDF generation failure** | 🟡 High | Medium | Keep Google Doc templates server-side; add error handling + fallback HTML |
| **StaxAutoPay audit gap** | 🟡 High | Certain | File inaccessible — must resolve permission issue and audit before building payment API |
| **Shared handler version drift** | 🟡 High | Medium | SHARED_HANDLER_VERSION must match in both scripts; add version check |
| **Transfer billing migration** | 🟡 High | Medium | Unbilled rows moved between clients — must maintain Ledger Row ID integrity |
| **Repair lifecycle complexity** | 🟡 High | Medium | 7 statuses with 4 idempotency markers — must test all transitions |
| **Discount calculation** | 🟡 High | Low | Negative = discount, positive = surcharge; range -10 to +10; formula: `rate * (1 + pct/100)` |

#### Medium Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| **QR index cache expiry** | 🟠 Medium | Medium | 6-hour TTL; auto-rebuild trigger; on-demand rebuild on miss |
| **Header schema drift** | 🟠 Medium | Medium | Non-destructive header updates; always use headerMapFromRow_ |
| **Will Call COD tracking** | 🟠 Medium | Low | COD amount defaults when price=0 — known issue |
| **Multi-row selection** | 🟠 Medium | Medium | Only picks last row for some operations — known issue |
| **Modular src/ empty** | 🟠 Medium | Certain | Monolith still authoritative; modular split is future work |

### D5. Recommended Phase 7 Implementation Order

1. **Auth layer** (Phase 6 prerequisite — magic link + Users tab)
2. **Read-only API endpoints** (Inventory, Tasks, Repairs, WC, Billing views)
3. **Settings API** (Read/write client + CB settings)
4. **Action API endpoints** (Complete shipment, task, repair, WC lifecycle)
5. **Billing API** (Storage charges, unbilled report, invoice creation)
6. **QB Export API** (IIF generation)
7. **Transfer API** (Inter-client item transfer)
8. **Onboarding API** (New client setup)
9. **Stax/Payment API** (⚠ requires StaxAutoPay.gs audit first)
10. **QR Scanner migration** (JSONP → fetch, embed in app)

---

## APPENDIX A — Client Inventory (Modular) Status

The `stride-client-inventory/src/` directory exists but is **empty**. The planned modular split (Code.gs, Billing.gs, Emails.gs, Import.gs, Repairs.gs, Shipments.gs, Tasks.gs, Transfer.gs, Triggers.gs, Utils.gs, WillCalls.gs) has not been implemented yet.

**Current state:** The monolithic `inventory code.gs.txt` (~8000 lines, v2.6.4) remains the authoritative source for all client inventory logic.

**Planned module mapping:**
| Module File | Functions From Monolith |
|------------|------------------------|
| `Code.gs` | onOpen, menu creation, core utilities, headerMapFromRow_ |
| `Billing.gs` | createBillingRow_, recalculateBilling_, SH_lookupRate_, SH_createBillingRow_ |
| `Emails.gs` | sendTemplateEmail_, SH_sendTemplateEmail_, all email template logic |
| `Import.gs` | showImportDialog_, importInventory_, fuzzy column matching |
| `Repairs.gs` | createRepairFromTask_, SH_processRepairCompletionById_, SH_processRepairQuoteById_, SH_processRepairApprovalById_ |
| `Shipments.gs` | completeShipment_, createShipment_, generateReceivingDoc_ |
| `Tasks.gs` | completeSelectedTasks_, SH_processTaskCompletionById_, createTask_ |
| `Transfer.gs` | showTransferDialog_, transferItems_ |
| `Triggers.gs` | onEdit, onOpen, checkbox handlers |
| `Utils.gs` | headerMapFromRow_, date helpers, formatting, Drive utilities |
| `WillCalls.gs` | showCreateWillCallDialog_, processWillCallRelease_, createWillCall_ |

**Recommendation:** Complete the modular split AFTER the Phase 7 API layer is stable, since the API endpoints will call the same underlying functions regardless of file organization.

---

## APPENDIX B — StaxAutoPay.gs Audit Gap

**Status:** ⚠ File exists but is inaccessible due to FUSE mount permission issue.

**File location:** `/AppScripts/stax-auto-pay/StaxAutoPay.gs` (95KB)

**Known from UI build:**
- Invoice list with payment status
- Charge log (successful/failed charges)
- Exception handling for failed payments
- Customer mapping (Client Name → Stax Customer ID)
- IIF → Stax processing pipeline

**Action required:** Resolve filesystem permission and complete StaxAutoPay.gs audit before building payment API endpoints. The Stax Customer ID column exists in the CB Clients tab, indicating integration between onboarding and payment processing.

---

## APPENDIX C — Known Issues Affecting Phase 7

From CLAUDE.md active issues:

1. **4 doc templates still use HTML import** — Receiving, Task WO, Repair WO, Will Call PDFs use `createGoogleDocFromHtml_()` instead of Doc templates. Margin/width issues reported.
2. **Transfer Items dialog** — Needs processing animation + button disable after complete
3. **Multi-row selection** — Only picks last row for WC creation and other functions
4. **CTA buttons in emails** — Not linking to task/shipment/WC folders
5. **COD amount defaulting** — When creating Will Call with COD + price = 0
6. **Repair discount behavior** — Should disable discounts on repairs
7. **`populateUnbilledReport_()` in Code.gs.js** — Uses OLD header names ("Billing Status", "Service Date")
8. **`CB13_addBillingStatusValidation()`** — Looks for "Billing Status" instead of "Status"

**Phase 7 impact:** Issues 7 and 8 are header naming bugs that must be fixed before the API layer reads these columns. All other issues are UI/UX and can be fixed in parallel.

---

> **Document complete.** This audit covers all 13 accessible script files across 4 interconnected Google Sheets, the QR Scanner system, and identifies 2 gaps (StaxAutoPay.gs inaccessible, modular src/ empty). All sections A through D are fully populated with no truncation.
