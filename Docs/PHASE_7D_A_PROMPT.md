PHASE 7D-A — WORKFLOW INVENTORY + EXECUTABLE TEST MATRIX
STRIDE GS APP / GOOGLE SHEETS SYSTEM
VERSION 2.0

ROLE
You are NOT fixing code yet.
You are NOT running QA yet.
Your job is to build the most accurate possible workflow inventory and test matrix from the actual codebase.

GOAL
Create a source-of-truth testing matrix based on:
- Google Sheets Apps Script logic
- StrideAPI.gs
- React UI code
- Task Board script
- current docs

This must be built from real code inspection, not from assumptions or summaries.

==================================================
READ FIRST (MANDATORY)
==================================================

Read and analyze:
1. CLAUDE.md
2. Docs/Stride_GS_App_Build_Status.md
3. stride-gs-app/docs/PHASE_7_FORENSIC_TEST_REPORT.md
4. stride-gs-app/docs/PHASE_7_REPAIR_CHECKLIST.md
5. AppScripts/stride-api/StrideAPI.gs
6. All 13 files in AppScripts/stride-client-inventory/src/:
   - Code.gs, AutocompleteDB.gs, Billing.gs, Emails.gs, Import.gs,
     RemoteAdmin.gs, Repairs.gs, Shipments.gs, Tasks.gs, Transfer.gs,
     Triggers.gs, Utils.gs, WillCalls.gs
7. AppScripts/task board script.txt
8. All 11 files in AppScripts/Consolidated Billing Sheet/:
   - Code.gs.js, Invoice Commit.js, CB13_Preview_Core.js,
     CB13 Unbilled Reports.js, CB13_UI.html.txt, CB13 Config.js,
     CB13 Schema Migration.js, Client_Onboarding.js, Billing Logs.js,
     QB_Export.js
9. AppScripts/Master Price list script.txt
10. All React source files in stride-gs-app/src/ (pages, hooks, components, api, types, lib)

You must inspect actual source files before writing the matrix.

==================================================
CONTEXT MANAGEMENT (CRITICAL)
==================================================

The codebase is large. StrideAPI.gs alone is ~77KB, plus 13 client scripts,
11 CB scripts, and 76 React source files. To avoid hitting context limits:

- Use TARGETED READS: search for function names, exports, handler signatures,
  and key logic blocks rather than reading entire files top-to-bottom
- For StrideAPI.gs: grep for `function handle` and `function api_` to get
  the handler index, then read specific handlers as needed
- For React: read page files fully but only read hook/component files for
  the sections relevant to each workflow
- You MAY spawn read-only Explore subagents for parallel code inspection
  (do NOT let subagents write any files — main chat only writes)
- Prioritize: StrideAPI handlers → React pages/panels → client scripts →
  CB scripts → Task Board

==================================================
SCOPE
==================================================

You must inventory all major app/workflow areas, including at minimum:
- Dashboard
- Inventory
- Receiving (including Import Inventory if exposed in app)
- Shipments
- Tasks (create, start, complete, status lifecycle)
- Repairs (create, quote, approve/decline, complete)
- Will Calls (create, release, cancel)
- Billing (storage charges, unbilled report, invoice creation)
- Payments / Stax
- Claims (full lifecycle)
- Settings / Maintenance
- Global Search
- Client Onboarding (create/edit/sync from Settings + CB)
- Transfer Items (cross-client inventory + billing moves)
- Storage Charge Generation (rates, dedup, FREE_STORAGE_DAYS, class-based)
- Detail side panels (all table pages)
- Exports (Excel/PDF/etc.)
- Start Task (folder/PDF/hyperlink creation)
- Email/PDF/Drive folder side effects
- Row-click detail behavior on all table pages
- Task Board parity:
  - Compare shared handlers (SH_ prefix, SHARED_HANDLER_VERSION) vs client script originals
  - Check status values match client script validation lists
  - Note any Task Board features that bypass StrideAPI (direct sheet edits)
- Settings sync (CB Clients tab → client Settings tab)

==================================================
DATA RESTRICTIONS
==================================================

All test cases must reference ONLY:
- Demo Company (spreadsheet: 1bG4Sd7uEkBcTJF513C2GgESskXDyvZomctfmaBVmpZs)
- Justin Demo Company (spreadsheet: 1-nF3CgQBcfCncqW6u3d4jilsZzjqR1RO6y_f4OD-O2A)

DO NOT include Brian Paquette Interiors in any test steps.
That is a LIVE CLIENT — strictly off limits for testing.

==================================================
REQUIRED OUTPUT 1 — WORKFLOW INVENTORY
==================================================

Create:
stride-gs-app/docs/PHASE_7D_WORKFLOW_INVENTORY.md

For EACH workflow/feature, document:

1. Feature / workflow name
2. Implementation status:
   - Actually implemented (end-to-end working)
   - Partially implemented (some pieces missing)
   - UI stub only (button exists, no backend)
   - Backend exists but UI parity missing
3. UI entry point (page, button, menu item)
4. Page/component involved (React file path)
5. API endpoint/function used (StrideAPI.gs handler name)
6. Apps Script function(s) used (client script function name)
7. Google Sheet(s) involved (which spreadsheet)
8. Tab(s) involved (which sheet tabs)
9. Key columns/fields touched
10. Preconditions required (status, data, settings)
11. Side effects:
    - Email (template key, recipient logic)
    - PDF (doc type, template source)
    - Drive folder (path pattern)
    - Status change (from → to)
    - Billing write (service code, columns)
    - Task/repair creation
    - Trigger side effect (onEdit, onChange)
12. Expected success result
13. Failure conditions / likely edge cases
14. Evidence required to prove the test passed

For each feature, explicitly state what exists in:
- Google Sheets / Apps Script (client scripts, CB scripts)
- StrideAPI.gs
- React app

Flag any workflow where current docs appear stale or incomplete.

==================================================
REQUIRED OUTPUT 2 — EXECUTABLE TEST MATRIX
==================================================

Create:
stride-gs-app/docs/PHASE_7D_TEST_MATRIX.md

For EACH test case, use this format:

### TC-001: [Workflow Name] — [Happy Path / Edge / Failure / Idempotency / Auth]
| Field | Value |
|-------|-------|
| Workflow | [name] |
| Action | [exact steps to perform] |
| Page | [exact URL hash, e.g. #/tasks] |
| Test Account | Demo Company or Justin Demo Company |
| Preconditions | [what must be true before test] |
| Expected UI Result | [what user sees] |
| Expected API Response | [success/error, key fields] |
| Expected Sheet Result | [exact tab, row target logic, columns updated] |
| Sheet to Verify | [spreadsheet name + ID] |
| Tab to Verify | [exact tab name] |
| Columns to Check | [exact column names] |
| Side Effects to Verify | [email sent? PDF created? folder created?] |
| Pass Evidence | [what proves it worked] |
| Test Category | happy path / edge case / failure case / idempotency / concurrency / auth boundary / error handling |

==================================================
MANDATORY TEST MATRIX COVERAGE
==================================================

You must include test cases for:

1. Receiving → Inventory creation/update
2. Task create (from Inventory selection)
3. Start Task (folder + PDF + hyperlink creation)
4. Start Task idempotency (already started)
5. Complete Task (Pass + Fail results)
6. Task status/filter behavior (Open, In Progress, Completed)
7. Task Board parity (shared handler behavior matches client script)
8. Repair create / send quote / approve / decline / complete
9. Will Call create / release (full + partial) / cancel
10. Storage charge generation (rates, dedup, FREE_STORAGE_DAYS, discounts)
11. Unbilled report generation
12. Invoice creation + email
13. Claims lifecycle (create, add items, notes, request info, settlement, close, void, reopen)
14. Global search across all supported entities/fields
15. Row-click detail behavior on ALL table pages
16. Exports (Excel/PDF where available)
17. Settings/admin actions (users, sync, feature flags)
18. Client onboarding (create new client, edit existing, sync settings)
19. Transfer Items between clients
20. Import Inventory (if exposed in React app)
21. Auth boundary tests:
    - Client portal vs staff access
    - Invalid/missing clientSheetId
    - Expired session behavior
    - API timeout/error handling
22. Email / PDF / Drive folder side effects (at least one per type)
23. Idempotency: re-running same action (start task twice, complete task twice, release WC twice)

==================================================
SPECIAL REQUIREMENTS
==================================================

1. For every major write action, identify:
   - Exact sheet (by name and spreadsheet ID)
   - Exact row target logic (how does the script find the row?)
   - Exact columns likely updated
   - How a tester should confirm it worked

2. For Task Board parity items, compare:
   - SH_ prefixed functions in task board script vs originals in client scripts
   - SHARED_HANDLER_VERSION value
   - Any divergence in logic or column references

3. For each feature, note if the deployed React bundle matches source
   (reference the GitHub Pages CDN caching gotcha from Known Issues)

==================================================
DO NOT DO YET
==================================================

Do NOT:
- Fix bugs
- Run tests
- Claim PASS/FAIL
- Deploy anything
- Edit any source code

This phase is discovery and test design only.

==================================================
FINAL CHAT RESPONSE
==================================================

Return:
1. Total workflows inventoried
2. Total test cases created
3. Areas that seem incomplete or risky
4. Top 10 highest-risk workflows to test first
5. Any workflows where docs are stale vs actual code
6. Exact doc paths created

SUCCESS CRITERIA
- Workflow inventory built from real code inspection
- Test matrix is concrete and executable (no vague "test this page" language)
- Sheet verification steps are explicit (tab name, column names, row logic)
- Implementation status clearly marked per workflow
- 3-layer parity documented (Sheets → API → React)
- Ready for human review before execution
