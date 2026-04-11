/***************************************************************
STRIDE CONSOLIDATED BILLING — v1.5.0 (OWNER ONLY)
PHASE 1 (frozen behavior):
- Setup / Protections
- Generate Unbilled Report (pulls from all client Billing_Ledgers)
- Marks pulled rows as Billed + stamps Batch ID (idempotent)
PHASE 2 (additive):
- Generate Storage Charges (STOR) across clients
  - Writes to client Billing_Ledger ONLY (status: Unbilled)
  - Consolidated_Ledger populated AFTER invoice approval
- Consolidated_Ledger sheet (invoice processing source)
- Invoice_Review sheet (approval queue)
- Invoice generation + approval
- Invoice PDF generation (basic HTML->PDF)
- Two-way ledger sync: edits in Consolidated_Ledger push back
  to client ledgers
MASTER GOVERNING RULES (SYSTEM_MASTER):
- No Phase 1 rewrites without explicit approval
- All writes remain header-mapped
- Matching key: Ledger Row ID (BL-000001)
- Storage idempotency: STOR-[ItemID]-[YYYYMMDD]-[YYYYMMDD]
  stored in Task ID

v1.3.1 vs v1.3.0:
- FIX: StrideGenerateStorageCharges now writes ONLY to client
  Billing_Ledger (Unbilled). Removed all pendingConsolRows /
  appendConsolidatedLedgerRow_ logic. Consolidated_Ledger is
  populated at invoice approval time via CB13_commitInvoice.
- FIX: STOR notes string now uses MM/DD/YY date format instead
  of YYYY-MM-DD (formatMMDDYY_ helper added).
- ADD: CB13_clearUnbilledReport — clears all data rows from
  Unbilled_Report while preserving header.
- UPD: Menu cleaned up — removed Migrate Clients Tab,
  Migrate Client Schema, Install Billing Log Sheets.
  Added Clear Unbilled Report.

v1.3.0 vs v1.2.4:
- ADD: Client Onboarding automation (Client_Onboarding.gs)
- ADD: Sync Settings to Client menu option
- UPD: Clients tab new layout (config rows 1-2, headers row 4)
- UPD: getActiveClients_ updated for new Clients tab layout

v1.2.4 vs v1.2.3:
- ADD: Rate and Total columns included in 2-way ledger sync
***************************************************************/
const CB_V = "v2.1.0";
const CB_SH = {
  SETTINGS: "Settings",
  CLIENTS: "Clients",
  REPORT: "Unbilled_Report",
  LOCATIONS: "Locations",
  USERS: "Users",
  // Phase 2:
  CONSOL_LEDGER: "Consolidated_Ledger",
  INVOICE_REVIEW: "Invoice_Review"
};
const CB_KEYS = {
  OWNER_EMAIL: "OWNER_EMAIL",
  IIF_EXPORT_FOLDER_ID: "IIF_EXPORT_FOLDER_ID"
};
const CLIENT_SHEETS = {
  SETTINGS: "Settings",
  INVENTORY: "Inventory",
  BILLING_LEDGER: "Billing_Ledger"
};
/** Phase 1 flush interval (memory safety). */
const FLUSH_INTERVAL = 5;
/** Phase 2 storage charge flush interval (rows per client batch write). */
const STOR_FLUSH_INTERVAL = 50;
/** Phase 1 report columns (fixed width for reliable setValues). */
// v1.4.0: Aligned with CB13 Unbilled Report + Consolidated_Ledger schema
const REPORT_HEADERS = [
  "Status", "Client", "Sidemark", "Date", "Svc Code", "Svc Name",
  "Item ID", "Description", "Class", "Qty", "Rate", "Total",
  "Item Notes", "Ledger Row ID", "Source Sheet ID"
];
/** Phase 2: Consolidated ledger headers (invoice processing source). */
const CONSOL_LEDGER_HEADERS = [
  "Status", "Invoice #", "Client", "Client Sheet ID", "Ledger Row ID",
  "Source Row", "Date", "Svc Code", "Svc Name", "Item ID", "Description",
  "Class", "Qty", "Rate", "Total", "Task ID", "Repair ID", "Shipment #",
  "Item Notes", "Sidemark", "Email Status", "Invoice URL", "Date Added"
];
/** Phase 2: Invoice review queue. */
const INVOICE_REVIEW_HEADERS = [
  "Action (Approve/Void)", "INV #",
  "Client", "Svc Code", "Svc Name", "Item ID", "Description", "Class",
  "Qty", "Rate", "Total",
  "Task ID", "Repair ID", "Shipment #", "Item Notes",
  "Ledger Row ID", "Client Sheet ID", "Source Row"
];
/** Valid invoice filter modes. */
const INVOICE_FILTER_MODES = ["ALL", "CLIENT", "SVC", "DATE", "CLIENT+DATE"];

/* ============================================================
   MENU
   ============================================================ */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Stride Billing")
    .addItem("⚙ Setup (Owner Only)", "StrideBillingSetup")
    .addSeparator()
    .addItem("📦 Generate Storage Charges (STOR)", "StrideGenerateStorageCharges_WithLogs")
    .addItem("📋 Generate Unbilled Report", "CB13_generateUnbilledReport_WithLogs")
    .addItem("🗑 Clear Unbilled Report", "CB13_clearUnbilledReport")
    .addSeparator()
    .addItem("💾 Export Highlighted to QuickBooks (IIF)", "CB13_qbExportFromUnbilledSelection")
    .addSeparator()
    .addItem("🧾 Create & Send Invoices (PDF)", "CB13_createAndSendInvoices")
    .addItem("📧 Re-send Invoice Email", "CB13_resendInvoiceEmail")
    .addSeparator()
    .addItem("🔄 Sync Settings to Client", "StrideSyncSettingsToClient")
    .addItem("🔧 Update Headers (Safe)", "StrideSafeUpdateHeaders")
    .addSeparator()
    .addItem("⚖️ Claims — Setup Schema", "Claims_SetupSchema")
    .addToUi();
}

/* ============================================================
   SAFE HEADER UPDATE — non-destructive
   Renames legacy headers, adds missing ones. Preserves formatting & column order.
   ============================================================ */
function StrideSafeUpdateHeaders() {
  const ss = SpreadsheetApp.getActive();
  const ui = SpreadsheetApp.getUi();
  const results = [];

  // Legacy renames
  const RENAMES = {
    "Ledger Entry ID": "Ledger Row ID"
  };

  // Consolidated_Ledger
  const cl = ss.getSheetByName(CB_SH.CONSOL_LEDGER);
  if (cl) {
    ensureHeaderRowSafe_(cl, CONSOL_LEDGER_HEADERS, RENAMES);
    results.push("Consolidated_Ledger: updated");
  }

  // Invoice_Review
  const ir = ss.getSheetByName(CB_SH.INVOICE_REVIEW);
  if (ir) {
    ensureHeaderRowSafe_(ir, INVOICE_REVIEW_HEADERS, RENAMES);
    results.push("Invoice_Review: updated");
  }

  // Unbilled_Report — skipped: this sheet is fully rebuilt each time Generate Unbilled Report runs.
  // Safe Update should not touch it to avoid header/data misalignment.

  ui.alert("Update Headers (Safe) complete.\n\n" + results.join("\n") +
    "\n\nFormatting and column order preserved. Only missing headers added and legacy names renamed.");
}

/* ============================================================
   PHASE 1 — SETUP (safe to re-run)
   ============================================================ */
function StrideBillingSetup() {
  const ss = SpreadsheetApp.getActive();
  const settings = ensureSheet_(ss, CB_SH.SETTINGS);
  // Only write headers if sheet is empty or header row doesn't match
  var settingsLR = settings.getLastRow();
  if (settingsLR < 1) {
    settings.getRange(1, 1, 1, 3)
      .setValues([["Key", "Value", "Notes"]])
      .setFontWeight("bold");
    settings.setFrozenRows(1);
  }
  // Seed OWNER_EMAIL if not present
  CB13_seedSettingsKeys_(settings, [CB_KEYS.OWNER_EMAIL, CB_KEYS.IIF_EXPORT_FOLDER_ID]);

  const clients = ensureSheet_(ss, CB_SH.CLIENTS);
  if (clients.getLastRow() < 1) {
    clients.getRange(1, 1, 1, 4)
      .setValues([["Client Name", "Client Spreadsheet ID", "Active", "Notes"]])
      .setFontWeight("bold");
    clients.setFrozenRows(1);
  }

  const report = ensureSheet_(ss, CB_SH.REPORT);
  if (report.getLastRow() < 1) {
    ensureReportHeader_(report);
  }

  const cl = ensureSheet_(ss, CB_SH.CONSOL_LEDGER);
  ensureHeaderRowExact_(cl, CONSOL_LEDGER_HEADERS);
  const ir = ensureSheet_(ss, CB_SH.INVOICE_REVIEW);
  ensureHeaderRowExact_(ir, INVOICE_REVIEW_HEADERS);
  // v2.1.0: Locations tab — centralized warehouse location list
  ensureLocationsSheet_(ss);
  // v2.1.0: Users tab — auth user management
  ensureUsersSheet_(ss);
  SpreadsheetApp.getUi().alert(
    "✅ Stride Consolidated Billing " + CB_V + " setup complete.\n\n" +
    "Next:\n1) Fill Clients sheet with client spreadsheet IDs\n" +
    "2) Add warehouse locations to the Locations tab\n" +
    "3) Add staff users to the Users tab\n" +
    "4) Phase 1: Generate Unbilled Report\n" +
    "5) Phase 2: Generate Storage Charges / Invoices"
  );
}

/* ============================================================
   PHASE 1 — UNBILLED REPORT (frozen behavior + header-mapped)
   ============================================================ */
function StrideGenerateUnbilledReport() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    ui.alert("Another billing report run is already in progress. Please try again in a minute.");
    return;
  }
  try {
    const clientsSh = ss.getSheetByName(CB_SH.CLIENTS);
    if (!clientsSh) { ui.alert("Missing Clients sheet. Run Setup."); return; }

    const endDateResp = ui.prompt(
      "End Date",
      "Enter end date (MM/DD/YY). Charges on/before this date will be included.",
      ui.ButtonSet.OK_CANCEL
    );
    if (endDateResp.getSelectedButton() !== ui.Button.OK) return;
    const endDate = parseDate_(endDateResp.getResponseText());
    if (!endDate) { ui.alert("Invalid date. Use MM/DD/YY."); return; }

    const svcResp = ui.prompt(
      "Service Code Filter (optional)",
      "Comma-separated service codes (e.g. STOR,INSP). Leave blank for all.",
      ui.ButtonSet.OK_CANCEL
    );
    if (svcResp.getSelectedButton() !== ui.Button.OK) return;
    const svcFilterRaw = String(svcResp.getResponseText() || "");
    const svcFilterArr = svcFilterRaw
      .split(",")
      .map(s => String(s || "").trim())
      .filter(Boolean);
    const svcSet = new Set(svcFilterArr.map(s => s.toUpperCase()));

    const batchId = "BATCH-" + Utilities.formatDate(
      new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss"
    );

    const cVals = clientsSh.getDataRange().getValues();
    if (cVals.length < 2) { ui.alert("No clients configured."); return; }

    const cMap = headerMapFromRow_(cVals[0]);
    const idxName   = cMap["CLIENT NAME"];
    const idxId     = cMap["CLIENT SPREADSHEET ID"];
    const idxActive = cMap["ACTIVE"];

    if (idxName === undefined || idxId === undefined) {
      ui.alert(
        'Clients sheet missing required headers: "Client Name" and/or ' +
        '"Client Spreadsheet ID". Run Setup again.'
      );
      return;
    }

    const activeClients = [];
    for (let r = 1; r < cVals.length; r++) {
      const name   = String(cVals[r][idxName] || "").trim();
      const id     = String(cVals[r][idxId] || "").trim();
      const active = (idxActive === undefined) ? true : truthy_(cVals[r][idxActive]);
      if (name && id && active) activeClients.push({ name, id });
    }
    if (!activeClients.length) { ui.alert("No ACTIVE clients found."); return; }

    const reportSh = ss.getSheetByName(CB_SH.REPORT) || ensureSheet_(ss, CB_SH.REPORT);
    ensureReportHeader_(reportSh);

    const pulledAt = new Date();
    let reportRows = [];
    let totalRows  = 0;
    const failedClients = [];

    activeClients.forEach((client, idx) => {
      try {
        const css    = SpreadsheetApp.openById(client.id);
        const ledger = css.getSheetByName(CLIENT_SHEETS.BILLING_LEDGER);
        if (!ledger) {
          failedClients.push(client.name + " (no " + CLIENT_SHEETS.BILLING_LEDGER + " sheet)");
          return;
        }
        const lr = ledger.getLastRow();
        const lc = ledger.getLastColumn();
        if (lr < 2 || lc < 1) return;

        const values = ledger.getRange(1, 1, lr, lc).getValues();
        const map    = headerMapFromRow_(values[0]);

        const cStatus = map["STATUS"];
        const cDate   = map["DATE"];
        const cSvc    = (map["SVC CODE"] !== undefined) ? map["SVC CODE"] : map["SERVICE CODE"];
        const cTotal  = map["TOTAL"];
        const cShip   = map["SHIPMENT #"];
        const cItem   = map["ITEM ID"];
        const cNotes  = map["NOTES"];
        const cBatch  = (map["BATCH ID"] !== undefined) ? map["BATCH ID"] : map["BATCH"];

        if (cStatus === undefined || cDate === undefined ||
            cSvc === undefined || cTotal === undefined) {
          failedClients.push(
            client.name + " (missing required columns: Status/Date/Svc Code/Total)"
          );
          return;
        }

        const matchedRows = [];
        for (let i = 1; i < values.length; i++) {
          const rowNum = i + 1;
          const status = String(values[i][cStatus] || "").trim();
          if (status && status.toLowerCase() !== "unbilled") continue;

          const rowDate = normalizeDateToMidnight_(values[i][cDate]);
          if (!rowDate) continue;
          if (rowDate.getTime() > endDate.getTime()) continue;

          const svc = String(values[i][cSvc] || "").trim().toUpperCase();
          if (svcSet.size && !svcSet.has(svc)) continue;

          const total  = values[i][cTotal];
          const shipNo = (cShip !== undefined) ? String(values[i][cShip] || "").trim() : "";
          const itemId = (cItem !== undefined) ? String(values[i][cItem] || "").trim() : "";
          const notes  = (cNotes !== undefined) ? String(values[i][cNotes] || "").trim() : "";

          matchedRows.push(rowNum);
          reportRows.push([
            client.name, client.id, rowNum, rowDate, svc, total,
            shipNo, itemId, notes, batchId, pulledAt, css.getUrl()
          ]);
        }

        // v1.4.0: Do NOT stamp rows as "Billed" during report generation.
        // Status should only change when invoices are actually committed/exported.
        // This allows re-running the report without losing unbilled rows.
        matchedRows.sort((a, b) => a - b);
        if (matchedRows.length && cBatch !== undefined) {
          batchWriteColumn_(ledger, matchedRows, cBatch + 1, batchId);
        }
      } catch (err) {
        const msg = (err && err.message) ? err.message : String(err);
        failedClients.push(client.name + " (" + msg + ")");
        Logger.log("Client pull failed: " + client.name + " — " + err);
      }

      if (reportRows.length &&
          ((idx + 1) % FLUSH_INTERVAL === 0 || idx === activeClients.length - 1)) {
        const start = reportSh.getLastRow() + 1;
        reportSh.getRange(start, 1, reportRows.length, REPORT_HEADERS.length)
          .setValues(reportRows);
        totalRows += reportRows.length;
        reportRows = [];
      }
    });

    if (reportRows.length) {
      const start = reportSh.getLastRow() + 1;
      reportSh.getRange(start, 1, reportRows.length, REPORT_HEADERS.length)
        .setValues(reportRows);
      totalRows += reportRows.length;
      reportRows = [];
    }

    if (totalRows === 0 && failedClients.length === 0) {
      ui.alert("No eligible unbilled rows found up to " + endDateResp.getResponseText() + ".");
      return;
    }

    let msg = "";
    if (totalRows > 0) {
      msg += "✅ Report generated.\nBatch ID: " + batchId + "\nRows: " + totalRows;
    } else {
      msg += "No eligible unbilled rows found up to " + endDateResp.getResponseText() + ".";
    }
    if (failedClients.length) {
      msg += "\n\n⚠ " + failedClients.length + " client(s) failed:\n• " + failedClients.join("\n• ");
    }
    ui.alert(msg);

  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ============================================================
   PHASE 2 — STORAGE CHARGE GENERATION
   v1.3.1: Writes ONLY to client Billing_Ledger (Unbilled).
   Consolidated_Ledger is populated at invoice approval time.
   ============================================================ */
function StrideGenerateStorageCharges() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    ui.alert("Another run is already in progress. Please try again in a minute.");
    return;
  }
  try {
    const clients = getActiveClients_();
    if (!clients.length) { ui.alert("No ACTIVE clients found."); return; }

    const startResp = ui.prompt(
      "Storage Start Date",
      "Enter start date (MM/DD/YY). Storage will be calculated within this range.",
      ui.ButtonSet.OK_CANCEL
    );
    if (startResp.getSelectedButton() !== ui.Button.OK) return;
    const startDate = parseDate_(startResp.getResponseText());
    if (!startDate) { ui.alert("Invalid start date. Use MM/DD/YY."); return; }

    const endResp = ui.prompt(
      "Storage End Date",
      "Enter end date (MM/DD/YY). Storage will be calculated within this range.",
      ui.ButtonSet.OK_CANCEL
    );
    if (endResp.getSelectedButton() !== ui.Button.OK) return;
    const endDate = parseDate_(endResp.getResponseText());
    if (!endDate) { ui.alert("Invalid end date. Use MM/DD/YY."); return; }

    if (endDate.getTime() < startDate.getTime()) {
      ui.alert("End Date must be on/after Start Date.");
      return;
    }

    const storRates = loadStorRatesByClassFromAnyClient_(clients);
    if (!storRates || !Object.keys(storRates).length) {
      ui.alert(
        "Could not load STOR rates from Master Price List. " +
        "Verify STOR exists and clients have MASTER_SPREADSHEET_ID."
      );
      return;
    }

    let created = 0;
    const skipped = [];
    const failed  = [];

  const unbilledReportRows = [];
    clients.forEach(client => {
      try {
        const css        = SpreadsheetApp.openById(client.id);
        const settingsSh = css.getSheetByName(CLIENT_SHEETS.SETTINGS);
        const invSh      = css.getSheetByName(CLIENT_SHEETS.INVENTORY);
        const blSh       = css.getSheetByName(CLIENT_SHEETS.BILLING_LEDGER);
      const ccSh      = css.getSheetByName("Class_Cache") || css.getSheetByName("CLASSCACHE");
      const classVols = loadClassVolumes_(ccSh);

        if (!settingsSh || !invSh || !blSh) {
          failed.push(client.name + " (missing Settings/Inventory/Billing_Ledger)");
          return;
        }

        const sMap       = readClientSettings_(settingsSh);
        const freeDays   = Number(sMap["FREE_STORAGE_DAYS"] || 0) || 0;
        const clientName = String(sMap["CLIENT_NAME"] || client.name || "").trim() || client.name;

        const invVals = invSh.getDataRange().getValues();
        if (invVals.length < 2) return;

        const invHdr  = headerMapFromRow_(invVals[0]);
        const cItem   = invHdr["ITEM ID"];
        const cDesc   = invHdr["DESCRIPTION"];
        const cClass  = invHdr["CLASS"];
        const cRecv   = invHdr["RECEIVE DATE"];
        const cStatus = invHdr["STATUS"];
        const cShip   = invHdr["SHIPMENT #"];
        const cRel    = invHdr["RELEASE DATE"];
    const cSidemark = invHdr["SIDEMARK"];

        if (cItem === undefined || cClass === undefined || cRecv === undefined) {
          failed.push(
            client.name + " (Inventory missing required columns: Item ID / Class / Receive Date)"
          );
          return;
        }

        const blHdrRow = blSh.getRange(1, 1, 1, blSh.getLastColumn()).getValues()[0];
        const blHdr    = headerMapFromRow_(blHdrRow);
        const blCols   = {
          status:       blHdr["STATUS"],
          invoice:      blHdr["INVOICE #"],
          client:       blHdr["CLIENT"],
          date:         blHdr["DATE"],
          svcCode:      blHdr["SVC CODE"],
          svcName:      blHdr["SVC NAME"],
          itemId:       blHdr["ITEM ID"],
          desc:         blHdr["DESCRIPTION"],
          klass:        blHdr["CLASS"],
          qty:          blHdr["QTY"],
          rate:         blHdr["RATE"],
          total:        blHdr["TOTAL"],
          taskId:       blHdr["TASK ID"],
          repairId:     blHdr["REPAIR ID"],
          shipNo:       blHdr["SHIPMENT #"],
          notes:        blHdr["ITEM NOTES"] !== undefined ? blHdr["ITEM NOTES"] : blHdr["NOTES"],
          // v1.4.0: Standardized on "Ledger Row ID" — also accept legacy "Ledger Entry ID"
          ledgerRowId:  blHdr["LEDGER ROW ID"] !== undefined ? blHdr["LEDGER ROW ID"] : blHdr["LEDGER ENTRY ID"]
        };

        if (blCols.status === undefined || blCols.date === undefined ||
            blCols.svcCode === undefined || blCols.total === undefined) {
          failed.push(
            client.name + " (Billing_Ledger missing required columns: Status/Date/Svc Code/Total)"
          );
          return;
        }
        if (blCols.ledgerRowId === undefined) {
          failed.push(
            client.name + " (Billing_Ledger missing Ledger Row ID — run Update Headers on client sheet)"
          );
          return;
        }

        // v1.4.0: Build lookup of existing Task IDs for idempotency
        // Only dedup against Invoiced/Billed/Void rows — unbilled rows can be regenerated
        // v1.4.1: Read all billing data once for dedup + cleanup
        const existingTaskIds = new Set();
        const blLastRow = blSh.getLastRow();
        var blAllData = (blLastRow >= 2) ? blSh.getRange(2, 1, blLastRow - 1, blSh.getLastColumn()).getValues() : [];

        // Build dedup set from finalized rows only (Invoiced/Billed/Void)
        for (var di = 0; di < blAllData.length; di++) {
          var rowStatus = String(blAllData[di][blCols.status] || "").trim().toLowerCase();
          if (rowStatus === "invoiced" || rowStatus === "billed" || rowStatus === "void") {
            if (blCols.taskId !== undefined) {
              var tid = String(blAllData[di][blCols.taskId] || "").trim();
              if (tid) existingTaskIds.add(tid);
            }
            if (blCols.ledgerRowId !== undefined) {
              var lid = String(blAllData[di][blCols.ledgerRowId] || "").trim();
              if (lid) existingTaskIds.add(lid);
            }
          }
        }

        // v1.4.0: Remove existing unbilled STOR rows for this date range before regenerating
        if (blAllData.length && blCols.svcCode !== undefined) {
          var rowsToDelete = [];
          for (var ci = blAllData.length - 1; ci >= 0; ci--) {
            var cRowStatus = String(blAllData[ci][blCols.status] || "").trim().toLowerCase();
            var cRowSvc = String(blAllData[ci][blCols.svcCode] || "").trim().toUpperCase();
            if ((cRowStatus === "unbilled" || cRowStatus === "") && cRowSvc === "STOR") {
              var cRowDate = normalizeDateToMidnight_(blAllData[ci][blCols.date]);
              if (cRowDate && cRowDate.getTime() >= startDate.getTime() && cRowDate.getTime() <= endDate.getTime()) {
                rowsToDelete.push(ci + 2);
              }
            }
          }
          // Delete from bottom up to avoid row shift issues
          for (var dri = 0; dri < rowsToDelete.length; dri++) {
            blSh.deleteRow(rowsToDelete[dri]);
          }
          if (rowsToDelete.length) {
            Logger.log("[STOR] Cleared " + rowsToDelete.length + " unbilled STOR rows for " + client.name);
          }
        }

        const nextLedgerRowIdFn = makeClientLedgerRowIdAllocator_(css, settingsSh, blSh);

        // Collect rows to batch-write to client ledger
        const pendingClientRows = [];

        for (let r = 1; r < invVals.length; r++) {
          const itemId = String(invVals[r][cItem] || "").trim();
          if (!itemId) continue;

          const status = (cStatus !== undefined)
            ? String(invVals[r][cStatus] || "").trim() : "";
          if (status && status.toLowerCase() !== "active") continue;

          const recv = normalizeDateToMidnight_(invVals[r][cRecv]);
          if (!recv) continue;

          const rel = (cRel !== undefined)
            ? normalizeDateToMidnight_(invVals[r][cRel]) : null;
          const effectiveEnd = (rel && rel.getTime() <= endDate.getTime()) ? addDays_(rel, -1) : endDate;

          const billableStart = addDays_(recv, freeDays);
          const chargeStart   = maxDate_(billableStart, startDate);
          const chargeEnd     = effectiveEnd;
          const billableDays  = dateDiffDaysInclusive_(chargeStart, chargeEnd);
          if (billableDays <= 0) continue;

          const klass = String(invVals[r][cClass] || "").trim().toUpperCase();
      const baseRate = Number(storRates[klass] || 0) || 0;
      const cubicVol = Number(classVols[klass] || 0) || 0;
      const rate     = baseRate * cubicVol;
          if (rate <= 0) {
            skipped.push(
              client.name + " " + itemId + " (no STOR rate for class " + klass + ")"
            );
            continue;
          }

          const storTaskId = buildStorTaskId_(itemId, chargeStart, chargeEnd);
          if (existingTaskIds.has(storTaskId)) continue;

          const desc   = (cDesc !== undefined) ? String(invVals[r][cDesc] || "").trim() : "";
          const shipNo = (cShip !== undefined) ? String(invVals[r][cShip] || "").trim() : "";
      const sidemark = (cSidemark !== undefined) ? String(invVals[r][cSidemark] || "").trim() : "";
          const total  = rate * billableDays;

          const ledgerRowId = nextLedgerRowIdFn();
          if (!ledgerRowId) {
            failed.push(client.name + " (could not allocate Ledger Row ID)");
            return;
          }

          // v1.3.1: Date format MM/DD/YY for human-readable notes
          const notesStr = "Storage " + formatMMDDYY_(chargeStart) +
            " to " + formatMMDDYY_(chargeEnd) + " (" + billableDays + " day(s))";

          const row = new Array(blSh.getLastColumn()).fill("");
          setIfCol_(row, blCols.status,       "Unbilled");
          setIfCol_(row, blCols.invoice,       "");
          setIfCol_(row, blCols.client,        clientName);
          setIfCol_(row, blCols.date,          chargeEnd);
          setIfCol_(row, blCols.svcCode,       "STOR");
          setIfCol_(row, blCols.svcName,       "Storage");
          setIfCol_(row, blCols.itemId,        itemId);
          setIfCol_(row, blCols.desc,          desc);
          setIfCol_(row, blCols.klass,         klass);
          setIfCol_(row, blCols.qty,           billableDays);
          setIfCol_(row, blCols.rate,          rate);
          setIfCol_(row, blCols.total,         total);
          setIfCol_(row, blCols.taskId,        storTaskId);
          setIfCol_(row, blCols.repairId,      "");
          setIfCol_(row, blCols.shipNo,        shipNo);
          setIfCol_(row, blCols.notes,         notesStr);
          setIfCol_(row, blCols.ledgerRowId,   ledgerRowId || storTaskId);

          pendingClientRows.push(row);
          existingTaskIds.add(storTaskId);
        unbilledReportRows.push({
          client: clientName, sidemark: sidemark,
          date: chargeEnd, svcName: "Storage",
          qty: billableDays, rate: rate, total: total,
          svcCode: "STOR", itemId: itemId,
          description: desc, klass: klass,
          notes: notesStr, taskId: storTaskId,
          entryId: ledgerRowId || storTaskId, sourceId: client.id,
          shipNo: shipNo, category: "Storage Charges"
        });
          created++;

          // Flush to client ledger in batches
          if (pendingClientRows.length >= STOR_FLUSH_INTERVAL) {
            const insertStart = blSh.getLastRow() + 1;
            blSh.getRange(insertStart, 1, pendingClientRows.length, pendingClientRows[0].length)
              .setValues(pendingClientRows);
            pendingClientRows.length = 0;
          }
        }

        // Final flush for this client
        if (pendingClientRows.length) {
          const insertStart = blSh.getLastRow() + 1;
          blSh.getRange(insertStart, 1, pendingClientRows.length, pendingClientRows[0].length)
            .setValues(pendingClientRows);
          pendingClientRows.length = 0;
        }

      } catch (err) {
        failed.push(
          client.name + " (" + (err && err.message ? err.message : String(err)) + ")"
        );
        Logger.log("StrideGenerateStorageCharges client failed: " + client.name + " — " + err);
      }
    });

    // v1.4.3: Removed populateUnbilledReport_() call — CB13_generateUnbilledReport is the only writer
    // Storage charges are written to client Billing_Ledger. Run "Generate Unbilled Report" to view them.

    let msg = "✅ Storage generation complete.\nCreated: " + created;
    if (skipped.length) {
      msg += "\n\nSkipped (rate missing):\n• " +
        skipped.slice(0, 20).join("\n• ") +
        (skipped.length > 20 ? "\n• ..." : "");
    }
    if (failed.length) {
      msg += "\n\n❗ Failed:\n• " + failed.join("\n• ");
    }
    ui.alert(msg);

  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ============================================================
   PHASE 2 — INVOICE GENERATION (to Invoice_Review)
   ============================================================ */
function StrideGenerateInvoices() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();
  const cl = ss.getSheetByName(CB_SH.CONSOL_LEDGER);
  if (!cl) { ui.alert("Missing Consolidated_Ledger. Run Setup."); return; }
  ensureHeaderRowExact_(cl, CONSOL_LEDGER_HEADERS);

  const modeResp = ui.prompt(
    "Invoice Filter Mode",
    "Enter one mode:\n" +
    "ALL = all Unbilled\n" +
    "CLIENT = by client name\n" +
    "SVC = by service code\n" +
    "DATE = by date range\n" +
    "CLIENT+DATE = by client + date range",
    ui.ButtonSet.OK_CANCEL
  );
  if (modeResp.getSelectedButton() !== ui.Button.OK) return;
  const mode = String(modeResp.getResponseText() || "").trim().toUpperCase();

  if (INVOICE_FILTER_MODES.indexOf(mode) === -1) {
    ui.alert(
      "Unknown filter mode: \"" + mode + "\".\n\nValid modes: " +
      INVOICE_FILTER_MODES.join(", ")
    );
    return;
  }

  let clientFilter = "";
  let svcFilter    = "";
  let startDate    = null;
  let endDate      = null;

  if (mode === "CLIENT" || mode === "CLIENT+DATE") {
    const c = ui.prompt("Client Filter", "Enter client name (exact match).", ui.ButtonSet.OK_CANCEL);
    if (c.getSelectedButton() !== ui.Button.OK) return;
    clientFilter = String(c.getResponseText() || "").trim();
    if (!clientFilter) { ui.alert("Client filter required."); return; }
  }
  if (mode === "SVC") {
    const s = ui.prompt("Service Code Filter", "Enter service code (e.g. STOR,INSP).", ui.ButtonSet.OK_CANCEL);
    if (s.getSelectedButton() !== ui.Button.OK) return;
    svcFilter = String(s.getResponseText() || "").trim().toUpperCase();
    if (!svcFilter) { ui.alert("Svc filter required."); return; }
  }
  if (mode === "DATE" || mode === "CLIENT+DATE") {
    const sd = ui.prompt("Start Date", "Enter start date (MM/DD/YY).", ui.ButtonSet.OK_CANCEL);
    if (sd.getSelectedButton() !== ui.Button.OK) return;
    startDate = parseDate_(sd.getResponseText());
    if (!startDate) { ui.alert("Invalid start date."); return; }

    const ed = ui.prompt("End Date", "Enter end date (MM/DD/YY).", ui.ButtonSet.OK_CANCEL);
    if (ed.getSelectedButton() !== ui.Button.OK) return;
    endDate = parseDate_(ed.getResponseText());
    if (!endDate) { ui.alert("Invalid end date."); return; }
    if (endDate.getTime() < startDate.getTime()) { ui.alert("End must be on/after start."); return; }
  }

  const vals = cl.getDataRange().getValues();
  if (vals.length < 2) { ui.alert("No consolidated ledger rows."); return; }

  const h            = headerMapFromRow_(vals[0]);
  const cStatus      = h["STATUS"];
  const cInv         = h["INVOICE #"];
  const cClient      = h["CLIENT"];
  const cDate        = h["DATE"];
  const cSvc         = h["SVC CODE"];
  const cSvcName     = h["SVC NAME"];
  const cItem        = h["ITEM ID"];
  const cDesc        = h["DESCRIPTION"];
  const cClass       = h["CLASS"];
  const cQty         = h["QTY"];
  const cRate        = h["RATE"];
  const cTotal       = h["TOTAL"];
  const cTask        = h["TASK ID"];
  const cRepair      = h["REPAIR ID"];
  const cShip        = h["SHIPMENT #"];
  const cNotes       = h["ITEM NOTES"];
  const cLedgerRowId = h["LEDGER ROW ID"];
  const cClientSheetId = h["CLIENT SHEET ID"];
  const cSourceRow   = h["SOURCE ROW"];

  if (cStatus === undefined || cInv === undefined || cClient === undefined) {
    ui.alert("Consolidated_Ledger missing required columns. Run Setup.");
    return;
  }

  const rowsOut = [];
  for (let i = 1; i < vals.length; i++) {
    const status = String(vals[i][cStatus] || "").trim();
    const invNo  = String(vals[i][cInv] || "").trim();
    if (status.toLowerCase() !== "unbilled") continue;
    if (invNo) continue;

    const client = String(vals[i][cClient] || "").trim();
    if (clientFilter && client !== clientFilter) continue;

    const svc = String(vals[i][cSvc] || "").trim().toUpperCase();
    if (svcFilter && svc !== svcFilter) continue;

    if (startDate && endDate) {
      const d = normalizeDateToMidnight_(vals[i][cDate]);
      if (!d) continue;
      if (d.getTime() < startDate.getTime() || d.getTime() > endDate.getTime()) continue;
    }

    rowsOut.push([
      "", "",
      client,
      svc,
      (cSvcName !== undefined) ? String(vals[i][cSvcName] || "") : "",
      (cItem !== undefined) ? String(vals[i][cItem] || "") : "",
      (cDesc !== undefined) ? String(vals[i][cDesc] || "") : "",
      (cClass !== undefined) ? String(vals[i][cClass] || "") : "",
      (cQty !== undefined) ? vals[i][cQty] : "",
      (cRate !== undefined) ? vals[i][cRate] : "",
      (cTotal !== undefined) ? vals[i][cTotal] : "",
      (cTask !== undefined) ? String(vals[i][cTask] || "") : "",
      (cRepair !== undefined) ? String(vals[i][cRepair] || "") : "",
      (cShip !== undefined) ? String(vals[i][cShip] || "") : "",
      (cNotes !== undefined) ? String(vals[i][cNotes] || "") : "",
      (cLedgerRowId !== undefined) ? String(vals[i][cLedgerRowId] || "") : "",
      (cClientSheetId !== undefined) ? String(vals[i][cClientSheetId] || "") : "",
      (cSourceRow !== undefined) ? String(vals[i][cSourceRow] || "") : ""
    ]);
  }

  const ir = ss.getSheetByName(CB_SH.INVOICE_REVIEW) || ensureSheet_(ss, CB_SH.INVOICE_REVIEW);
  ensureHeaderRowExact_(ir, INVOICE_REVIEW_HEADERS);
  if (ir.getLastRow() > 1) {
    ir.getRange(2, 1, ir.getLastRow() - 1, ir.getLastColumn()).clearContent();
  }
  if (rowsOut.length) {
    ir.getRange(2, 1, rowsOut.length, INVOICE_REVIEW_HEADERS.length).setValues(rowsOut);
  }

  ui.alert(
    "✅ Invoice review queue generated.\nRows: " + rowsOut.length +
    "\n\nNext: set Action = Approve or Void, then run Approve / Void Invoices."
  );
}

/* ============================================================
   PHASE 2 — INVOICE APPROVAL / VOID + PDF GENERATION
   ============================================================ */
function StrideApproveOrVoidInvoices() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    ui.alert("Another invoice run is already in progress. Please try again in a minute.");
    return;
  }
  try {
    const ir = ss.getSheetByName(CB_SH.INVOICE_REVIEW);
    const cl = ss.getSheetByName(CB_SH.CONSOL_LEDGER);
    if (!ir || !cl) {
      ui.alert("Missing Invoice_Review or Consolidated_Ledger. Run Setup.");
      return;
    }

    ensureHeaderRowExact_(ir, INVOICE_REVIEW_HEADERS);
    ensureHeaderRowExact_(cl, CONSOL_LEDGER_HEADERS);

    const irVals = ir.getDataRange().getValues();
    if (irVals.length < 2) { ui.alert("No rows in Invoice_Review."); return; }

    const irH            = headerMapFromRow_(irVals[0]);
    const cAction        = irH["ACTION (APPROVE/VOID)"];
    const cInv           = irH["INV #"];
    const cClient        = irH["CLIENT"];
    const cLedgerRowId   = irH["LEDGER ROW ID"];
    const cClientSheetId = irH["CLIENT SHEET ID"];
    const cSourceRow     = irH["SOURCE ROW"];

    if (cAction === undefined || cClient === undefined || cLedgerRowId === undefined) {
      ui.alert("Invoice_Review missing required columns. Run Setup.");
      return;
    }

    const clIndex = buildConsolLedgerIndex_(cl);
    const approveGroups = {};
    const voidRows = [];

    for (let i = 1; i < irVals.length; i++) {
      const action       = String(irVals[i][cAction] || "").trim().toLowerCase();
      if (!action) continue;
      const clientName   = String(irVals[i][cClient] || "").trim();
      const ledgerRowId  = String(irVals[i][cLedgerRowId] || "").trim();
      const clientSheetId = (cClientSheetId !== undefined)
        ? String(irVals[i][cClientSheetId] || "").trim() : "";
      const sourceRow    = (cSourceRow !== undefined)
        ? String(irVals[i][cSourceRow] || "").trim() : "";

      if (!ledgerRowId || !clientSheetId) continue;

      if (action === "approve") {
        if (!approveGroups[clientName]) approveGroups[clientName] = [];
        approveGroups[clientName].push({
          irRow: i + 1, clientName, clientSheetId, ledgerRowId, sourceRow
        });
      } else if (action === "void") {
        voidRows.push({
          irRow: i + 1, clientName, clientSheetId, ledgerRowId, sourceRow
        });
      }
    }

    const results = { approved: 0, voided: 0, failed: [] };

    voidRows.forEach(v => {
      try {
        const key   = v.clientSheetId + "||" + v.ledgerRowId;
        const clRow = clIndex[key];
        if (clRow) {
          updateConsolidatedLedgerRow_(cl, clRow, { status: "Void", invoiceNo: "" });
          pushStatusToClientLedger_(v.clientSheetId, v.ledgerRowId, {
            status: "Void", invoiceNo: ""
          });
        }
        results.voided++;
        ir.getRange(v.irRow, cAction + 1).setValue("");
      } catch (e) {
        results.failed.push(v.clientName + " VOID (" + e + ")");
      }
    });

    const masterRpc = getMasterRpcFromAnyClient_(getActiveClients_());
    if (!masterRpc || !masterRpc.rpcUrl || !masterRpc.rpcToken) {
      if (Object.keys(approveGroups).length) {
        ui.alert(
          "Missing MASTER RPC URL/TOKEN (needed for invoice IDs).\n\n" +
          "Ensure client Settings has MASTER_RPC_URL + MASTER_RPC_TOKEN.\n\n" +
          "Voids processed: " + results.voided
        );
      }
      return;
    }

    Object.keys(approveGroups).forEach(clientName => {
      const rows = approveGroups[clientName];
      if (!rows.length) return;
      try {
        const invNo = getNextInvoiceIdFromMasterRpc_(masterRpc.rpcUrl, masterRpc.rpcToken);
        if (!invNo) throw new Error("Could not generate invoice ID from Master RPC.");

        rows.forEach(r => {
          if (cInv !== undefined) ir.getRange(r.irRow, cInv + 1).setValue(invNo);
          ir.getRange(r.irRow, cAction + 1).setValue("");
        });

        rows.forEach(r => {
          const key   = r.clientSheetId + "||" + r.ledgerRowId;
          const clRow = clIndex[key];
          if (clRow) {
            updateConsolidatedLedgerRow_(cl, clRow, { status: "Invoiced", invoiceNo: invNo });
          }
          pushStatusToClientLedger_(r.clientSheetId, r.ledgerRowId, {
            status: "Invoiced", invoiceNo: invNo
          });
        });

        const invoiceData = rows.map(r => {
          const key = r.clientSheetId + "||" + r.ledgerRowId;
          return clIndex[key] ? readConsolidatedLedgerRow_(cl, clIndex[key]) : null;
        }).filter(Boolean);

        const pdfFile = generateInvoicePdf_(invNo, clientName, invoiceData);
        emailInvoiceToClient_(rows[0].clientSheetId, invNo, pdfFile);
        results.approved += rows.length;
      } catch (e) {
        results.failed.push(clientName + " APPROVE (" + e + ")");
        Logger.log("Approve group failed: " + clientName + " — " + e);
      }
    });

    let msg = "✅ Invoice processing complete.\n" +
      "Approved rows: " + results.approved + "\nVoided rows: " + results.voided;
    if (results.failed.length) {
      msg += "\n\n❗ Failed:\n• " + results.failed.join("\n• ");
    }
    ui.alert(msg);

  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ============================================================
   PHASE 2 — TWO-WAY LEDGER SYNC
   ============================================================ */
function onEdit(e) {
  try {
    try { handleOnboardEditTrigger_(e); } catch (_) {}

    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== CB_SH.CONSOL_LEDGER) return;

    const row = e.range.getRow();
    if (row < 2) return;
    if (e.value === undefined && e.oldValue === undefined) return;

    const headers    = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const map        = headerMapFromRow_(headers);
    const cStatus    = map["STATUS"];
    const cInv       = map["INVOICE #"];
    const cRate      = map["RATE"];
    const cTotal     = map["TOTAL"];
    const cClientSheetId = map["CLIENT SHEET ID"];
    const cLedgerRowId   = map["LEDGER ROW ID"];

    const editedCol0 = e.range.getColumn() - 1;
    if (editedCol0 !== cStatus && editedCol0 !== cInv &&
        editedCol0 !== cRate && editedCol0 !== cTotal) return;

    const rowVals       = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
    const clientSheetId = String(rowVals[cClientSheetId] || "").trim();
    const ledgerRowId   = String(rowVals[cLedgerRowId] || "").trim();
    if (!clientSheetId || !ledgerRowId) return;

    const payload = {};
    if (cStatus !== undefined) payload.status    = String(rowVals[cStatus] || "").trim();
    if (cInv !== undefined)    payload.invoiceNo = String(rowVals[cInv] || "").trim();
    pushStatusToClientLedger_(clientSheetId, ledgerRowId, payload);

  } catch (err) {
    Logger.log("onEdit sync error: " + err);
  }
}

/* ============================================================
   PROTECTIONS (Owner Only)
   ============================================================ */


/* ============================================================
   UNBILLED REPORT — CLEAR
   v1.3.1: Added. Deletes all data rows, preserves header.
   ============================================================ */
function CB13_clearUnbilledReport() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();

  const resp = ui.alert(
    "Clear Unbilled Report",
    "This will delete all data rows from the Unbilled_Report.\n" +
    "The header row will be preserved.\n\nProceed?",
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  const sh = ss.getSheetByName(CB_SH.REPORT);
  if (!sh) { ui.alert("Unbilled_Report sheet not found."); return; }

  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    ss.toast("Unbilled Report is already empty.", "Nothing to do", 3);
    return;
  }

  sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();
  sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearDataValidations();

  ss.toast("Unbilled Report cleared (" + (lastRow - 1) + " rows removed).", "Done", 4);
}

/* ============================================================
   HELPERS — SHEETS / HEADERS / SETTINGS
   ============================================================ */
function ensureSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/**
 * v1.4.0: Non-destructive header update.
 * - Renames legacy headers (e.g. "Ledger Entry ID" → "Ledger Row ID")
 * - Appends missing headers at the end (preserves column order & formatting)
 * - Never removes or reorders existing columns
 */
function ensureHeaderRowSafe_(sheet, requiredHeaders, renames) {
  if (!sheet || sheet.getLastColumn() < 1) {
    // Empty sheet — just write headers fresh
    sheet.getRange(1, 1, 1, requiredHeaders.length)
      .setValues([requiredHeaders])
      .setFontWeight("bold");
    sheet.setFrozenRows(1);
    return;
  }

  var lastCol = sheet.getLastColumn();
  var existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  // Step 1: Apply renames (e.g. "Ledger Entry ID" → "Ledger Row ID")
  if (renames) {
    for (var ci = 0; ci < existing.length; ci++) {
      var h = String(existing[ci] || "").trim();
      if (renames[h]) {
        sheet.getRange(1, ci + 1).setValue(renames[h]);
        existing[ci] = renames[h];
      }
    }
  }

  // Step 2: Find missing headers and append them
  var existingSet = {};
  for (var ei = 0; ei < existing.length; ei++) {
    var norm = String(existing[ei] || "").trim().toUpperCase();
    if (norm) existingSet[norm] = true;
  }

  var missing = [];
  for (var ri = 0; ri < requiredHeaders.length; ri++) {
    if (!existingSet[requiredHeaders[ri].toUpperCase()]) {
      missing.push(requiredHeaders[ri]);
    }
  }

  if (missing.length) {
    var startCol = lastCol + 1;
    for (var mi = 0; mi < missing.length; mi++) {
      sheet.getRange(1, startCol + mi).setValue(missing[mi]).setFontWeight("bold");
    }
  }

  sheet.setFrozenRows(1);
}

function ensureHeaderRowExact_(sheet, headers) {
  const maxCols    = Math.max(headers.length, sheet.getLastColumn() || 1);
  const existing   = sheet.getRange(1, 1, 1, maxCols).getValues()[0] || [];
  const same       = headers.length === existing.length &&
    headers.every((h, i) => String(existing[i] || "").trim() === h);
  if (!same) {
    sheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight("bold");
    if (maxCols > headers.length) {
      sheet.getRange(1, headers.length + 1, 1, maxCols - headers.length).clearContent();
    }
  } else {
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  }
  sheet.setFrozenRows(1);
}

function ensureReportHeader_(reportSh) {
  const header = reportSh.getRange(1, 1, 1, REPORT_HEADERS.length).getValues()[0] || [];
  const same   = header.length === REPORT_HEADERS.length &&
    REPORT_HEADERS.every((h, i) => String(header[i] || "").trim() === h);
  if (!same) {
    reportSh.getRange(1, 1, 1, REPORT_HEADERS.length)
      .setValues([REPORT_HEADERS])
      .setFontWeight("bold");
  }
  reportSh.setFrozenRows(1);
}

function tryGetEmail_() {
  try {
    return Session.getEffectiveUser().getEmail() ||
      Session.getActiveUser().getEmail() || "";
  } catch (_) { return ""; }
}

function clearAllProtections_(sheet) {
  [
    SpreadsheetApp.ProtectionType.SHEET,
    SpreadsheetApp.ProtectionType.RANGE
  ].forEach(type => {
    sheet.getProtections(type).forEach(p => {
      try { p.remove(); } catch (_) {}
    });
  });
}

function headerMapFromRow_(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    const k = String(h || "").trim().toUpperCase();
    if (k && !(k in map)) map[k] = i;  // v1.3.2: first occurrence wins
  });
  return map;
}

function getSetting_(ss, sheetName, key) {
  const sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return "";
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  const row  = vals.find(r => String(r[0]).trim() === key);
  return row ? String(row[1] || "").trim() : "";
}

function truthy_(v) {
  if (v === true) return true;
  const s = String(v || "").trim().toLowerCase();
  return ["true", "yes", "y", "1", "checked"].includes(s);
}

/* ============================================================
   HELPERS — BATCH WRITE (Phase 1)
   ============================================================ */
function batchWriteColumn_(sheet, rows, col, value) {
  if (!rows.length) return;
  let blockStart = rows[0];
  let blockEnd   = rows[0];
  for (let i = 1; i <= rows.length; i++) {
    if (i === rows.length || rows[i] !== blockEnd + 1) {
      const count = blockEnd - blockStart + 1;
      const block = Array(count).fill([value]);
      sheet.getRange(blockStart, col, count, 1).setValues(block);
      if (i < rows.length) { blockStart = rows[i]; blockEnd = rows[i]; }
    } else {
      blockEnd = rows[i];
    }
  }
}

/* ============================================================
   HELPERS — DATE
   ============================================================ */
function parseDate_(s) {
  var t = String(s || "").trim();
  if (!t) return null;
  var m;
  m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/.exec(t);
  if (m) {
    var month = Number(m[1]), day = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    var yr = Number(m[3]);
    if (yr < 100) yr += 2000;
    var d = new Date(yr, month - 1, day, 0, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }
  m = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/.exec(t);
  if (m) {
    var month = Number(m[2]), day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    var d = new Date(Number(m[1]), month - 1, day, 0, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** @deprecated Use parseDate_ */
function parseISODate_(s) { return parseDate_(s); }

function normalizeDateToMidnight_(v) {
  let d;
  if (v instanceof Date) { d = v; }
  else {
    const s = String(v || "").trim();
    if (!s) return null;
    d = new Date(s);
  }
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function addDays_(d, days) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + (Number(days) || 0));
  return normalizeDateToMidnight_(x);
}

function maxDate_(a, b) {
  if (!a) return b;
  if (!b) return a;
  return (a.getTime() >= b.getTime()) ? a : b;
}

function dateDiffDaysInclusive_(start, end) {
  if (!start || !end) return 0;
  const s = normalizeDateToMidnight_(start);
  const e = normalizeDateToMidnight_(end);
  if (!s || !e) return 0;
  const diff = Math.floor((e.getTime() - s.getTime()) / (24 * 60 * 60 * 1000));
  return diff + 1;
}

function formatISO_(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

/**
 * v1.3.1: Format date as MM/DD/YY for human-readable notes strings.
 */
function formatMMDDYY_(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";
  const m   = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const y   = String(d.getFullYear()).slice(-2);
  return m + "/" + day + "/" + y;
}

function formatYMD_(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return "" + y + m + day;
}

/* ============================================================
   PHASE 2 — CLIENT DISCOVERY / SETTINGS
   ============================================================ */
function getActiveClients_() {
  return getActiveClients_v2_();
}

function readClientSettings_(settingsSh) {
  const map = {};
  const lr  = settingsSh.getLastRow();
  if (lr < 2) return map;
  const vals = settingsSh.getRange(2, 1, lr - 1, 2).getValues();
  vals.forEach(r => {
    const k = String(r[0] || "").trim().toUpperCase();
    if (k) map[k] = r[1];
  });
  return map;
}

/* ============================================================
   PHASE 2 — STOR RATE LOOKUP
   ============================================================ */
function loadStorRatesByClassFromAnyClient_(clients) {
  for (let i = 0; i < clients.length; i++) {
    try {
      const css      = SpreadsheetApp.openById(clients[i].id);
      const settings = css.getSheetByName(CLIENT_SHEETS.SETTINGS);
      if (!settings) continue;
      const sMap     = readClientSettings_(settings);
      const masterId = String(sMap["MASTER_SPREADSHEET_ID"] || "").trim();
      if (!masterId) continue;
      const master   = SpreadsheetApp.openById(masterId);
      const price    = master.getSheetByName("Price_List");
      if (!price || price.getLastRow() < 2) continue;
      const pVals    = price.getDataRange().getValues();
      const pHdr     = headerMapFromRow_(pVals[0]);
      const cSvcCode = pHdr["SERVICE CODE"];
      if (cSvcCode === undefined) continue;

      let storRow = null;
      for (let r = 1; r < pVals.length; r++) {
        const code = String(pVals[r][cSvcCode] || "").trim().toUpperCase();
        if (code === "STOR") { storRow = pVals[r]; break; }
      }
      if (!storRow) continue;

      const out = {};
      Object.keys(pHdr).forEach(k => {
        const match = /^([A-Z]{1,4})\s+RATE$/.exec(k);
        if (!match) return;
        const klass = match[1].toUpperCase();
        const col0  = pHdr[k];
        const val   = Number(storRow[col0] || 0) || 0;
        if (val > 0) out[klass] = val;
      });
      return out;
    } catch (e) {
      Logger.log("loadStorRatesByClassFromAnyClient_ warning: " + e);
    }
  }
  return {};
}

/* ============================================================
   PHASE 2 — STORAGE IDEMPOTENCY + LEDGER ROW ID ALLOCATION
   ============================================================ */

// v1.4.1: Header-based lookup (was positional) — supports "Cubic Volume" or "Storage Size"
function loadClassVolumes_(ccSh) {
  if (!ccSh || ccSh.getLastRow() < 2) return {};
  var data = ccSh.getDataRange().getValues();
  var hdr = {};
  for (var c = 0; c < data[0].length; c++) hdr[String(data[0][c]).trim().toUpperCase()] = c;
  var cClass = hdr["CLASS"];
  var cVol = hdr["CUBIC VOLUME"] !== undefined ? hdr["CUBIC VOLUME"] : hdr["STORAGE SIZE"];
  if (cClass === undefined || cVol === undefined) return {};
  var out = {};
  for (var r = 1; r < data.length; r++) {
    var cls = String(data[r][cClass] || "").trim().toUpperCase();
    var vol = Number(data[r][cVol] || 0) || 0;
    if (cls && vol > 0) out[cls] = vol;
  }
  return out;
}
function buildStorTaskId_(itemId, startDate, endDate) {
  return "STOR-" + itemId + "-" + formatYMD_(startDate) + "-" + formatYMD_(endDate);
}


// v1.4.3: populateUnbilledReport_() removed — CB13_generateUnbilledReport is the only writer to Unbilled_Report
function getConsolidatedTaskIdsForClient_(consolLedger, clientSheetId) {
  const lr = consolLedger.getLastRow();
  if (lr < 2) return [];
  const vals = consolLedger.getRange(2, 1, lr - 1, consolLedger.getLastColumn()).getValues();
  const hdr  = headerMapFromRow_(
    consolLedger.getRange(1, 1, 1, consolLedger.getLastColumn()).getValues()[0]
  );
  const cClientSheetId = hdr["CLIENT SHEET ID"];
  const cTask          = hdr["TASK ID"];
  if (cClientSheetId === undefined || cTask === undefined) return [];
  const out = [];
  vals.forEach(r => {
    if (String(r[cClientSheetId] || "").trim() === clientSheetId) {
      const t = String(r[cTask] || "").trim();
      if (t) out.push(t);
    }
  });
  return out;
}

function makeClientLedgerRowIdAllocator_(clientSs, settingsSh, billingLedgerSh) {
  const keyName = "BILLING_LEDGER_COUNTER";
  const sVals   = settingsSh.getDataRange().getValues();
  const sHdr    = headerMapFromRow_(sVals[0]);
  const cKey    = sHdr["KEY"];
  const cVal    = sHdr["VALUE"];
  if (cKey === undefined || cVal === undefined) return () => "";

  let rowIdx = -1;
  for (let i = 1; i < sVals.length; i++) {
    if (String(sVals[i][cKey] || "").trim() === keyName) { rowIdx = i + 1; break; }
  }
  if (rowIdx === -1) return () => "";

  return () => {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) return "";
    try {
      const current = parseInt(settingsSh.getRange(rowIdx, cVal + 1).getValue(), 10) || 0;
      const next    = current + 1;
      settingsSh.getRange(rowIdx, cVal + 1).setValue(next);
      SpreadsheetApp.flush();
      return "BL-" + String(next).padStart(6, "0");
    } finally {
      try { lock.releaseLock(); } catch (_) {}
    }
  };
}

function setIfCol_(rowArray, col0, value) {
  if (col0 === undefined || col0 === null) return;
  const idx = Number(col0);
  if (isNaN(idx) || idx < 0) return;
  while (rowArray.length <= idx) rowArray.push("");  // v1.3.2: extend array if needed
  rowArray[idx] = (value !== undefined && value !== null) ? value : "";
}

/* ============================================================
   PHASE 2 — CONSOLIDATED LEDGER WRITE / UPDATE / READ
   ============================================================ */
function appendConsolidatedLedgerRow_(consolLedger, payload) {
  const hdrRow = consolLedger.getRange(1, 1, 1, consolLedger.getLastColumn()).getValues()[0];
  const h      = headerMapFromRow_(hdrRow);
  const row    = new Array(consolLedger.getLastColumn()).fill("");

  setIfCol_(row, h["STATUS"],          payload.status || "");
  setIfCol_(row, h["INVOICE #"],       payload.invoiceNo || "");
  setIfCol_(row, h["CLIENT"],          payload.client || "");
  setIfCol_(row, h["CLIENT SHEET ID"], payload.clientSheetId || "");
  setIfCol_(row, h["LEDGER ROW ID"],   payload.ledgerRowId || "");
  setIfCol_(row, h["SOURCE ROW"],      payload.sourceRow || "");
  setIfCol_(row, h["DATE"],            payload.date || "");
  setIfCol_(row, h["SVC CODE"],        payload.svcCode || "");
  setIfCol_(row, h["SVC NAME"],        payload.svcName || "");
  setIfCol_(row, h["ITEM ID"],         payload.itemId || "");
  setIfCol_(row, h["DESCRIPTION"],     payload.description || "");
  setIfCol_(row, h["CLASS"],           payload.klass || "");
  setIfCol_(row, h["QTY"],             payload.qty !== undefined ? payload.qty : "");
  setIfCol_(row, h["RATE"],            payload.rate !== undefined ? payload.rate : "");
  setIfCol_(row, h["TOTAL"],           payload.total !== undefined ? payload.total : "");
  setIfCol_(row, h["TASK ID"],         payload.taskId || "");
  setIfCol_(row, h["REPAIR ID"],       payload.repairId || "");
  setIfCol_(row, h["SHIPMENT #"],      payload.shipNo || "");
  setIfCol_(row, h["ITEM NOTES"],      payload.notes || "");
  setIfCol_(row, h["SIDEMARK"],        payload.sidemark || "");
  setIfCol_(row, h["EMAIL STATUS"],    payload.emailStatus || "");
  setIfCol_(row, h["INVOICE URL"],     payload.invoiceUrl || "");
  setIfCol_(row, h["DATE ADDED"],      new Date());

  var insertRow = consolLedger.getLastRow() + 1;
  consolLedger.getRange(insertRow, 1, 1, row.length).setValues([row]);

  // v1.4.0: Hyperlink the Invoice # and Invoice URL columns
  var invUrl = String(payload.invoiceUrl || "").trim();
  if (invUrl) {
    var invNoCol = h["INVOICE #"];
    var invUrlCol = h["INVOICE URL"];
    var invNo = String(payload.invoiceNo || "").trim();
    if (invNoCol !== undefined && invNo) {
      try {
        var rt = SpreadsheetApp.newRichTextValue()
          .setText(invNo)
          .setLinkUrl(invUrl)
          .build();
        consolLedger.getRange(insertRow, invNoCol + 1).setRichTextValue(rt);
      } catch(_) {}
    }
    if (invUrlCol !== undefined) {
      try {
        var rt2 = SpreadsheetApp.newRichTextValue()
          .setText("View Invoice")
          .setLinkUrl(invUrl)
          .build();
        consolLedger.getRange(insertRow, invUrlCol + 1).setRichTextValue(rt2);
      } catch(_) {}
    }
  }
}

function buildConsolLedgerIndex_(clSheet) {
  const vals            = clSheet.getDataRange().getValues();
  const h               = headerMapFromRow_(vals[0] || []);
  const cClientSheetId  = h["CLIENT SHEET ID"];
  const cLedgerRowId    = h["LEDGER ROW ID"];
  const index           = {};
  if (vals.length < 2 || cClientSheetId === undefined || cLedgerRowId === undefined) return index;
  for (let i = 1; i < vals.length; i++) {
    const key = String(vals[i][cClientSheetId] || "").trim() +
      "||" + String(vals[i][cLedgerRowId] || "").trim();
    if (key !== "||") index[key] = i + 1;
  }
  return index;
}

function updateConsolidatedLedgerRow_(clSheet, rowNum, updates) {
  const headers = clSheet.getRange(1, 1, 1, clSheet.getLastColumn()).getValues()[0];
  const h       = headerMapFromRow_(headers);
  const rowVals = clSheet.getRange(rowNum, 1, 1, clSheet.getLastColumn()).getValues()[0];
  let changed   = false;

  if (updates.status !== undefined && h["STATUS"] !== undefined) {
    rowVals[h["STATUS"]] = updates.status; changed = true;
  }
  if (updates.invoiceNo !== undefined && h["INVOICE #"] !== undefined) {
    rowVals[h["INVOICE #"]] = updates.invoiceNo; changed = true;
  }
  if (changed) {
    clSheet.getRange(rowNum, 1, 1, rowVals.length).setValues([rowVals]);
  }
}

function readConsolidatedLedgerRow_(clSheet, rowNum) {
  const headers = clSheet.getRange(1, 1, 1, clSheet.getLastColumn()).getValues()[0];
  const h       = headerMapFromRow_(headers);
  const row     = clSheet.getRange(rowNum, 1, 1, clSheet.getLastColumn()).getValues()[0];
  const get     = (k) => (h[k] !== undefined) ? row[h[k]] : "";
  return {
    status:      get("STATUS"),
    invoiceNo:   get("INVOICE #"),
    client:      get("CLIENT"),
    clientSheetId: get("CLIENT SHEET ID"),
    ledgerRowId: get("LEDGER ROW ID"),
    sourceRow:   get("SOURCE ROW"),
    date:        get("DATE"),
    svcCode:     get("SVC CODE"),
    svcName:     get("SVC NAME"),
    itemId:      get("ITEM ID"),
    description: get("DESCRIPTION"),
    klass:       get("CLASS"),
    qty:         get("QTY"),
    rate:        get("RATE"),
    total:       get("TOTAL"),
    taskId:      get("TASK ID"),
    repairId:    get("REPAIR ID"),
    shipNo:      get("SHIPMENT #"),
    notes:       get("ITEM NOTES"),
    discountPct: get("DISCOUNT %"),
    discountAmt: get("DISCOUNT AMT")
  };
}

/* ============================================================
   PHASE 2 — CLIENT LEDGER SYNC BY Ledger Row ID
   ============================================================ */
function pushStatusToClientLedger_(clientSheetId, ledgerRowId, updates) {
  const css = SpreadsheetApp.openById(clientSheetId);
  const bl  = css.getSheetByName(CLIENT_SHEETS.BILLING_LEDGER);
  if (!bl) throw new Error("Client Billing_Ledger not found.");

  const hdr          = bl.getRange(1, 1, 1, bl.getLastColumn()).getValues()[0];
  const h            = headerMapFromRow_(hdr);
  const cLedgerRowId = h["LEDGER ROW ID"];
  const cStatus      = h["STATUS"];
  const cInv         = h["INVOICE #"];

  if (cLedgerRowId === undefined) {
    throw new Error("Client Billing_Ledger missing Ledger Row ID.");
  }

  const lr = bl.getLastRow();
  if (lr < 2) return;

  const ids = bl.getRange(2, cLedgerRowId + 1, lr - 1, 1)
    .getValues().flat().map(v => String(v || "").trim());
  const idx = ids.indexOf(String(ledgerRowId || "").trim());
  if (idx === -1) return;

  const rowNum  = idx + 2;
  const rowVals = bl.getRange(rowNum, 1, 1, bl.getLastColumn()).getValues()[0];
  let changed   = false;

  if (updates.status !== undefined && cStatus !== undefined) {
    rowVals[cStatus] = updates.status; changed = true;
  }
  if (updates.invoiceNo !== undefined && cInv !== undefined) {
    rowVals[cInv] = updates.invoiceNo; changed = true;
  }
  if (changed) {
    bl.getRange(rowNum, 1, 1, rowVals.length).setValues([rowVals]);
  }
}

/* ============================================================
   PHASE 2 — MASTER RPC + EMAIL/PDF
   ============================================================ */
function getMasterRpcFromAnyClient_(clients) {
  for (let i = 0; i < clients.length; i++) {
    try {
      const css      = SpreadsheetApp.openById(clients[i].id);
      const settings = css.getSheetByName(CLIENT_SHEETS.SETTINGS);
      if (!settings) continue;
      const sMap     = readClientSettings_(settings);
      const rpcUrl   = String(sMap["MASTER_RPC_URL"] || "").trim();
      const rpcToken = String(sMap["MASTER_RPC_TOKEN"] || "").trim();
      if (rpcUrl && rpcToken) return { rpcUrl, rpcToken };
    } catch (e) {
      Logger.log("getMasterRpcFromAnyClient_ warning: " + e);
    }
  }
  return null;
}

function getNextInvoiceIdFromMasterRpc_(rpcUrl, rpcToken) {
  const payload = { token: rpcToken, action: "getNextInvoiceId" };
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  const resp = UrlFetchApp.fetch(rpcUrl, options);
  if (resp.getResponseCode() !== 200) {
    Logger.log("getNextInvoiceIdFromMasterRpc_ HTTP " + resp.getResponseCode());
    return "";
  }
  const json = JSON.parse(resp.getContentText() || "{}");
  if (json && json.success && json.invoiceNo) return String(json.invoiceNo);
  Logger.log("getNextInvoiceIdFromMasterRpc_ error: " + (json && json.error ? json.error : "unknown"));
  return "";
}

function generateInvoicePdf_(invNo, clientName, lineItems) {
  const now   = new Date();
  const total = lineItems.reduce((sum, li) => sum + (Number(li.total) || 0), 0);
  const html  = buildInvoiceHtml_(invNo, clientName, now, lineItems, total);
  // v2.6.3: Use Google Docs export for 0.25" margins (HtmlService has no margin control)
  const tempDoc = DocumentApp.create(invNo + "-" + sanitizeFileName_(clientName));
  const docId = tempDoc.getId();
  var body = tempDoc.getBody();
  body.clear();
  body.appendParagraph("placeholder");
  tempDoc.saveAndClose();
  // Overwrite doc body with HTML content via Drive API
  var htmlBlob = Utilities.newBlob(html, "text/html", "invoice.html");
  Drive.Files.update({ title: tempDoc.getName() }, docId, htmlBlob, { convert: true });
  // Export as PDF with 0.25" margins
  var pdfExportUrl = "https://docs.google.com/document/d/" + docId + "/export?" +
    "format=pdf&top=0.25&bottom=0.25&left=0.25&right=0.25";
  var pdfResp = UrlFetchApp.fetch(pdfExportUrl, {
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  var pdfBlob = pdfResp.getBlob().setName(invNo + "-" + sanitizeFileName_(clientName) + ".pdf");
  // Save to invoices folder, delete temp doc
  const folder = getOrCreateInvoicesFolder_();
  var pdfFile = folder.createFile(pdfBlob);
  DriveApp.getFileById(docId).setTrashed(true);
  return pdfFile;
}

function buildInvoiceHtml_(invNo, clientName, dateObj, lineItems, total) {
  const dateStr = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const rows    = lineItems.map(li => {
    return "<tr>" +
      "<td style='padding:8px;border:1px solid #e5e7eb;'>" + escHtml_(li.svcCode) + "</td>" +
      "<td style='padding:8px;border:1px solid #e5e7eb;'>" + escHtml_(li.svcName) + "</td>" +
      "<td style='padding:8px;border:1px solid #e5e7eb;'>" + escHtml_(li.itemId) + "</td>" +
      "<td style='padding:8px;border:1px solid #e5e7eb;'>" + escHtml_(li.description) + "</td>" +
      "<td style='padding:8px;border:1px solid #e5e7eb;text-align:right;'>" + escHtml_(String(li.qty)) + "</td>" +
      "<td style='padding:8px;border:1px solid #e5e7eb;text-align:right;'>" + escHtml_(formatMoney_(li.rate)) + "</td>" +
      "<td style='padding:8px;border:1px solid #e5e7eb;text-align:right;'>" + escHtml_(formatMoney_(li.total)) + "</td>" +
      "</tr>";
  }).join("");

  return (
    "<html><body style='font-family:Arial,sans-serif;color:#111827;'>" +
    "<div style='width:8in;margin:0;'>" +
    "<h2 style='margin:0 0 6px 0;'>Stride Logistics &mdash; Invoice</h2>" +
    "<div style='margin-bottom:16px;color:#374151;'>" +
    "<div><b>Invoice:</b> " + escHtml_(invNo) + "</div>" +
    "<div><b>Client:</b> " + escHtml_(clientName) + "</div>" +
    "<div><b>Date:</b> " + escHtml_(dateStr) + "</div>" +
    "</div>" +
    "<table style='border-collapse:collapse;width:100%;font-size:12px;'>" +
    "<thead><tr style='background:#f3f4f6;'>" +
    "<th style='padding:8px;border:1px solid #e5e7eb;text-align:left;'>Svc Code</th>" +
    "<th style='padding:8px;border:1px solid #e5e7eb;text-align:left;'>Svc Name</th>" +
    "<th style='padding:8px;border:1px solid #e5e7eb;text-align:left;'>Item ID</th>" +
    "<th style='padding:8px;border:1px solid #e5e7eb;text-align:left;'>Description</th>" +
    "<th style='padding:8px;border:1px solid #e5e7eb;text-align:right;'>Qty</th>" +
    "<th style='padding:8px;border:1px solid #e5e7eb;text-align:right;'>Rate</th>" +
    "<th style='padding:8px;border:1px solid #e5e7eb;text-align:right;'>Total</th>" +
    "</tr></thead>" +
    "<tbody>" + rows + "</tbody>" +
    "</table>" +
    "<div style='margin-top:14px;text-align:right;font-size:14px;'>" +
    "<b>Grand Total: $" + escHtml_(formatMoney_(total)) + "</b>" +
    "</div></div></body></html>"
  );
}

function emailInvoiceToClient_(clientSheetId, invNo, pdfFile) {
  try {
    const css      = SpreadsheetApp.openById(clientSheetId);
    const settings = css.getSheetByName(CLIENT_SHEETS.SETTINGS);
    if (!settings) return;
    const sMap        = readClientSettings_(settings);
    const clientEmail = String(sMap["CLIENT_EMAIL"] || "").trim();
    const clientName  = String(sMap["CLIENT_NAME"] || "").trim() || "Client";
    const staffEmails = String(sMap["NOTIFICATION_EMAILS"] || "").trim();
    if (!clientEmail) return;

    var allRecipients = clientEmail;
    if (staffEmails) allRecipients += "," + staffEmails;
    GmailApp.sendEmail(allRecipients,
      "Invoice " + invNo + " — Stride Logistics",
      "",
      {
        htmlBody:
          "<p>Hi " + escHtml_(clientName) + ",</p>" +
          "<p>Your invoice <b>" + escHtml_(invNo) + "</b> is attached.</p>" +
          "<p>Thank you,<br/>Stride Logistics</p>",
        attachments: [pdfFile.getBlob()],
        from: "whse@stridenw.com"
      }
    );
  } catch (e) {
    Logger.log("emailInvoiceToClient_ warning: " + e);
  }
}

function getOrCreateInvoicesFolder_() {
  const ss     = SpreadsheetApp.getActive();
  const parent = DriveApp.getFileById(ss.getId()).getParents().hasNext()
    ? DriveApp.getFileById(ss.getId()).getParents().next()
    : DriveApp.getRootFolder();
  const name = "Invoices";
  const it   = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function sanitizeFileName_(s) {
  return String(s || "").replace(/[\\\/:*?"<>|]+/g, " ").trim();
}

function escHtml_(s) {
  return String(s || "").replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c])
  );
}

function formatMoney_(v) {
  const n = Number(v);
  return isNaN(n) ? "0.00" : n.toFixed(2);
}

/** Safe UI wrapper - returns getUi() when available, stub when not (editor/trigger context). */
function safeUi_() {
  try {
    return SpreadsheetApp.getUi();
  } catch (e) {
    return {
      alert: function(msg) { Logger.log("UI_ALERT: " + msg); SpreadsheetApp.getActive().toast(String(msg).substring(0, 200), "QB Export", 10); },
      prompt: function(title, msg, buttons) { Logger.log("UI_PROMPT: " + title + " " + msg); return null; }
    };
  }
}

/* ============================================================
   PHASE 3 — ADDITIVE EXTENSIONS
   ============================================================ */
const CB_P3_V    = "v1.2.0";
const CB_P3_MENU = "Stride Billing (Phase 3)";

function StrideBillingPhase3_AddMenu() {
  SpreadsheetApp.getUi()
    .createMenu(CB_P3_MENU)
    .addItem("Batch Print Invoices", "StrideBatchPrintInvoices_Phase3")
    .addItem("Rebuild PDFs for Selected INV(s)", "StrideBatchPrintInvoices_Phase3")
    .addSeparator()
    .addItem("Install OnOpen Menu Trigger", "StrideBillingPhase3_InstallOnOpenMenuTrigger")
    .addToUi();

  SpreadsheetApp.getUi().alert(
    "✅ " + CB_P3_MENU + " menu added.\n\nVersion: " + CB_P3_V
  );
}

function StrideBillingPhase3_InstallOnOpenMenuTrigger() {
  const fn = "StrideBillingPhase3_OnOpenAddMenu_";
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction && t.getHandlerFunction() === fn)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger(fn)
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onOpen()
    .create();
  SpreadsheetApp.getUi().alert("✅ Phase 3 onOpen menu trigger installed.");
}

function StrideBillingPhase3_OnOpenAddMenu_() {
  try {
    SpreadsheetApp.getUi()
      .createMenu(CB_P3_MENU)
      .addItem("Batch Print Invoices", "StrideBatchPrintInvoices_Phase3")
      .addItem("Rebuild PDFs for Selected INV(s)", "StrideBatchPrintInvoices_Phase3")
      .addToUi();
  } catch (e) {
    Logger.log("StrideBillingPhase3_OnOpenAddMenu_ failed: " + e);
  }
}

function StrideBatchPrintInvoices_Phase3() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();

  const cl = ss.getSheetByName(CB_SH.CONSOL_LEDGER);
  if (!cl) { ui.alert("Missing Consolidated_Ledger. Run Setup first."); return; }

  const resp = ui.prompt(
    "Batch Print Invoices",
    "Enter INV number(s) comma-separated (e.g., INV-000101,INV-000102)\n" +
    "OR enter ALL to rebuild all invoiced PDFs.",
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;

  const raw     = String(resp.getResponseText() || "").trim();
  if (!raw) return;

  const modeAll = raw.trim().toUpperCase() === "ALL";
  const targets = modeAll ? null : raw.split(",").map(s => s.trim()).filter(Boolean);

  if (!modeAll && (!targets || !targets.length)) {
    ui.alert("No invoice numbers provided.");
    return;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    ui.alert("Another run is already in progress. Please try again in a minute.");
    return;
  }

  try {
    ensureHeaderRowExact_(cl, CONSOL_LEDGER_HEADERS);
    const vals = cl.getDataRange().getValues();
    if (vals.length < 2) { ui.alert("No rows in Consolidated_Ledger."); return; }

    const h              = headerMapFromRow_(vals[0]);
    const cStatus        = h["STATUS"];
    const cInv           = h["INVOICE #"];
    const cClient        = h["CLIENT"];
    const cClientSheetId = h["CLIENT SHEET ID"];

    if (cStatus === undefined || cInv === undefined || cClientSheetId === undefined) {
      ui.alert("Consolidated_Ledger missing required columns. Run Setup.");
      return;
    }

    const byInv = {};
    for (let i = 1; i < vals.length; i++) {
      const status        = String(vals[i][cStatus] || "").trim().toLowerCase();
      const invNo         = String(vals[i][cInv] || "").trim();
      const clientSheetId = String(vals[i][cClientSheetId] || "").trim();
      if (!invNo || !clientSheetId || status !== "invoiced") continue;
      if (!modeAll && !targets.some(t => t === invNo)) continue;

      const clientName = String(vals[i][cClient] || "").trim() || "Client";
      if (!byInv[invNo]) byInv[invNo] = { invNo, clientName, clientSheetId, lineItems: [] };
      byInv[invNo].lineItems.push(readConsolidatedLedgerRow_(cl, i + 1));
    }

    const invNos = Object.keys(byInv).sort();
    if (!invNos.length) { ui.alert("No matching invoiced invoices found."); return; }

    const master              = getMasterIdFromAnyClientForTemplates_(Object.values(byInv));
    const invoiceTemplateHtml = master ? tryLoadInvoiceTemplateHtmlFromMaster_(master) : "";

    const outFolder    = getOrCreateInvoicesFolder_();
    let savedHere      = 0;
    let savedToClients = 0;
    const failures     = [];

    invNos.forEach(invNo => {
      const group = byInv[invNo];
      try {
        const now      = new Date();
        const total    = group.lineItems.reduce((sum, li) => sum + (Number(li.total) || 0), 0);
        const pdfBlob  = buildInvoicePdfBlob_Phase3_(
          invNo, group.clientName, now, group.lineItems, total, invoiceTemplateHtml
        );
        const file1 = outFolder.createFile(pdfBlob);
        savedHere++;
        const clientFolder = tryGetClientInvoicesFolder_(group.clientSheetId);
        if (clientFolder) {
          clientFolder.createFile(pdfBlob.copyBlob()).setName(file1.getName());
          savedToClients++;
        }
      } catch (e) {
        failures.push(invNo + " (" + (e && e.message ? e.message : String(e)) + ")");
      }
    });

    let msg =
      "✅ Batch print complete (" + CB_P3_V + ").\n\n" +
      "Invoices processed: " + invNos.length + "\n" +
      "Saved to /Invoices/: " + savedHere + "\n" +
      "Saved to client /Invoices/: " + savedToClients;
    if (invoiceTemplateHtml) { msg += "\n\nTemplate: Master Invoice_Templates (used)"; }
    else { msg += "\n\nTemplate: Phase 2 fallback"; }
    if (failures.length) { msg += "\n\n❗ Failed:\n• " + failures.join("\n• "); }
    ui.alert(msg);

  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function getMasterIdFromAnyClientForTemplates_(invoiceGroups) {
  for (let i = 0; i < invoiceGroups.length; i++) {
    try {
      const css      = SpreadsheetApp.openById(invoiceGroups[i].clientSheetId);
      const settings = css.getSheetByName(CLIENT_SHEETS.SETTINGS);
      if (!settings) continue;
      const sMap     = readClientSettings_(settings);
      const masterId = String(sMap["MASTER_SPREADSHEET_ID"] || "").trim();
      if (masterId) return masterId;
    } catch (e) {
      Logger.log("getMasterIdFromAnyClientForTemplates_ warning: " + e);
    }
  }
  return "";
}

function tryLoadInvoiceTemplateHtmlFromMaster_(masterSpreadsheetId) {
  try {
    const master = SpreadsheetApp.openById(masterSpreadsheetId);
    const sh     = master.getSheetByName("Invoice_Templates");
    if (!sh || sh.getLastRow() < 2) return "";

    const vals  = sh.getDataRange().getValues();
    const h     = headerMapFromRow_(vals[0]);
    const cKey  = (h["TEMPLATE KEY"] !== undefined) ? h["TEMPLATE KEY"] : h["KEY"];
    const cHtml = (h["HTML BODY"] !== undefined) ? h["HTML BODY"] :
                  (h["HTML"] !== undefined) ? h["HTML"] :
                  (h["BODY"] !== undefined) ? h["BODY"] : undefined;
    if (cHtml === undefined) return "";

    let best = "";
    for (let i = 1; i < vals.length; i++) {
      const html = String(vals[i][cHtml] || "").trim();
      if (!html) continue;
      if (cKey !== undefined) {
        const key = String(vals[i][cKey] || "").trim().toUpperCase();
        if (key === "INVOICE" || key === "DEFAULT") return html;
      }
      if (!best) best = html;
    }
    return best;
  } catch (e) {
    Logger.log("tryLoadInvoiceTemplateHtmlFromMaster_ warning: " + e);
    return "";
  }
}

function buildInvoicePdfBlob_Phase3_(invNo, clientName, dateObj, lineItems, total, masterTemplateHtml) {
  let html = "";
  if (masterTemplateHtml) {
    const dateStr        = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "yyyy-MM-dd");
    const invFormat_     = getSetting_(SpreadsheetApp.getActive(), CB_SH.SETTINGS, "INVOICE_FORMAT") || "DETAILED";
    const lineItemsHtml  = (invFormat_.toUpperCase() === "SIMPLIFIED")
      ? buildSimplifiedInvoiceLineItemsHtml_Phase3_(lineItems)
      : buildInvoiceLineItemsHtml_Phase3_(lineItems);
    html = masterTemplateHtml;
    html = html.replaceAll("{{INVOICE_NO}}", escHtml_(invNo));
    html = html.replaceAll("{{CLIENT_NAME}}", escHtml_(clientName));
    html = html.replaceAll("{{INVOICE_DATE}}", escHtml_(dateStr));
    html = html.replaceAll("{{LINE_ITEMS_HTML}}", lineItemsHtml);
    html = html.replaceAll("{{GRAND_TOTAL}}", escHtml_(formatMoney_(total)));
  } else {
    html = buildInvoiceHtml_(invNo, clientName, dateObj, lineItems, total);
  }
  return HtmlService.createHtmlOutput(html).getBlob()
    .setName(invNo + "-" + sanitizeFileName_(clientName) + ".pdf")
    .getAs(MimeType.PDF);
}

function buildInvoiceLineItemsHtml_Phase3_(lineItems) {
  return lineItems.map(function(li) {
    var row = "<tr>" +
      "<td>" + escHtml_(String(li.svcCode || "")) + "</td>" +
      "<td>" + escHtml_(String(li.svcName || "")) + "</td>" +
      "<td>" + escHtml_(String(li.itemId || "")) + "</td>" +
      "<td>" + escHtml_(String(li.description || "")) + "</td>" +
      "<td style='text-align:right'>" + (li.qty || 0) + "</td>" +
      "<td style='text-align:right'>$" + Number(li.rate || 0).toFixed(2) + "</td>" +
      "<td style='text-align:right'>$" + Number(li.total || 0).toFixed(2) + "</td>" +
      "</tr>";
    if (li.discountAmt && Number(li.discountAmt) < 0) {
      row += "<tr style='color:#888;font-style:italic'>" +
        "<td></td><td></td><td></td>" +
        "<td>Discount (" + (li.discountPct ? Number(li.discountPct).toFixed(1) + "%" : "") + ")</td>" +
        "<td></td><td></td>" +
        "<td style='text-align:right;color:#c00'>$" + Number(li.discountAmt).toFixed(2) + "</td>" +
        "</tr>";
    }
    return row;
  }).join("");
}

function buildSimplifiedInvoiceLineItemsHtml_Phase3_(lineItems) {
  const groups = {};
  lineItems.forEach(function(li) {
    const key = (String(li.svcCode || "")) || "OTHER";
    if (!groups[key]) groups[key] = { svcCode: key, svcName: li.svcName || "", total: 0, count: 0, discountAmt: 0 };
    groups[key].total += Number(li.total || 0);
    groups[key].count++;
    groups[key].discountAmt += Number(li.discountAmt || 0);
  });

  var keys = Object.keys(groups);
  if (keys.length <= 1) {
    var g   = groups[keys[0]];
    var row = "<tr>" +
      "<td></td><td>Warehouse Charges</td><td></td>" +
      "<td>" + escHtml_(g.count + " line items") + "</td>" +
      "<td></td><td></td>" +
      "<td style='text-align:right'>" + escHtml_(formatMoney_(g.total)) + "</td>" +
      "</tr>";
    if (g.discountAmt < 0) {
      row += "<tr style='color:#888;font-style:italic'>" +
        "<td></td><td></td><td></td><td>Discount (included above)</td>" +
        "<td></td><td></td>" +
        "<td style='text-align:right;color:#c00'>$" + Number(g.discountAmt).toFixed(2) + "</td>" +
        "</tr>";
    }
    return row;
  }

  return keys.map(function(key) {
    var g   = groups[key];
    var row = "<tr>" +
      "<td>" + escHtml_(g.svcCode) + "</td>" +
      "<td>Warehouse Charges - " + escHtml_(g.svcName) + "</td>" +
      "<td></td>" +
      "<td>" + escHtml_(g.count + " items") + "</td>" +
      "<td></td><td></td>" +
      "<td style='text-align:right'>" + escHtml_(formatMoney_(g.total)) + "</td>" +
      "</tr>";
    if (g.discountAmt < 0) {
      row += "<tr style='color:#888;font-style:italic'>" +
        "<td></td><td></td><td></td><td>Discount (included above)</td>" +
        "<td></td><td></td>" +
        "<td style='text-align:right;color:#c00'>$" + Number(g.discountAmt).toFixed(2) + "</td>" +
        "</tr>";
    }
    return row;
  }).join("");
}

function tryGetClientInvoicesFolder_(clientSheetId) {
  try {
    const css      = SpreadsheetApp.openById(clientSheetId);
    const settings = css.getSheetByName(CLIENT_SHEETS.SETTINGS);
    if (!settings) return null;
    const sMap     = readClientSettings_(settings);
    const parentId = String(sMap["DRIVE_PARENT_FOLDER_ID"] || "").trim();
    if (!parentId) return null;
    const parent = DriveApp.getFolderById(parentId);
    const it     = parent.getFoldersByName("Invoices");
    return it.hasNext() ? it.next() : parent.createFolder("Invoices");
  } catch (e) {
    Logger.log("tryGetClientInvoicesFolder_ warning: " + e);
    return null;
  }
}

function CB13_addBillingStatusValidation() {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var sh      = ss.getSheetByName(CB_SH.REPORT);
  if (!sh) return;
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return;
  var headers   = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var idxStatus = headers.indexOf("Billing Status");
  if (idxStatus === -1) idxStatus = 0;
  var range = sh.getRange(2, idxStatus + 1, lastRow - 1, 1);
  var rule  = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Unbilled", "Invoiced", "Void"], true)
    .setAllowInvalid(false)
    .build();
  range.setDataValidation(rule);
}

/* ============================================================
   LOCATIONS — Centralized warehouse location list (v2.1.0)
   Client sheets pull from this via Location_Cache during
   Refresh Price/Class Cache.
   ============================================================ */

/**
 * Ensures the Locations sheet exists with proper header.
 * Location names go in column A starting at row 2.
 */
function ensureLocationsSheet_(ss) {
  var sh = ss.getSheetByName(CB_SH.LOCATIONS);
  if (!sh) {
    sh = ss.insertSheet(CB_SH.LOCATIONS);
    sh.getRange(1, 1, 1, 2)
      .setValues([["Location", "Notes"]])
      .setFontWeight("bold")
      .setBackground("#0F172A")
      .setFontColor("#ffffff");
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 200);
    sh.setColumnWidth(2, 350);
  }
  return sh;
}

/**
 * v2.1.0: Users tab — centralized user management for auth.
 * Headers: Email | Role | Client Name | Client Spreadsheet ID | Active | Created | Last Login | Last Login Source | Updated By | Updated At
 * Roles: admin, staff, client
 * Active defaults to FALSE on creation (manual activation required)
 */
var USERS_HEADERS = [
  "Email", "Role", "Client Name", "Client Spreadsheet ID",
  "Active", "Created", "Last Login", "Last Login Source",
  "Updated By", "Updated At"
];

function ensureUsersSheet_(ss) {
  var sh = ss.getSheetByName(CB_SH.USERS);
  if (!sh) {
    sh = ss.insertSheet(CB_SH.USERS);
    sh.getRange(1, 1, 1, USERS_HEADERS.length)
      .setValues([USERS_HEADERS])
      .setFontWeight("bold")
      .setBackground("#0F172A")
      .setFontColor("#ffffff");
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 250);  // Email
    sh.setColumnWidth(2, 100);  // Role
    sh.setColumnWidth(3, 200);  // Client Name
    sh.setColumnWidth(4, 250);  // Client Spreadsheet ID
    sh.setColumnWidth(5, 80);   // Active
    sh.setColumnWidth(6, 160);  // Created
    sh.setColumnWidth(7, 160);  // Last Login
    sh.setColumnWidth(8, 140);  // Last Login Source
    sh.setColumnWidth(9, 200);  // Updated By
    sh.setColumnWidth(10, 160); // Updated At
    // Role validation
    var roleRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(["admin", "staff", "client"], true)
      .setAllowInvalid(false)
      .build();
    sh.getRange(2, 2, 998, 1).setDataValidation(roleRule);
    // Active validation
    var activeRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(["TRUE", "FALSE"], true)
      .setAllowInvalid(false)
      .build();
    sh.getRange(2, 5, 998, 1).setDataValidation(activeRule);
  }
  return sh;
}