/* ===================================================
   Claims.gs.js — v1.0.0 — 2026-03-29 11:45 PM PST
   Stride Claims Module — CB Schema Setup & Constants
   =================================================== */

// ── Schema: Claims (main tab) ─────────────────────────────────────────────────

var CLAIMS_HEADERS = [
  "Claim ID", "Claim Type", "Status", "Outcome Type", "Resolution Type",
  "Date Opened", "Incident Date", "Date Closed", "Date Settlement Sent",
  "Date Signed Settlement Received", "Created By", "First Reviewed By", "First Reviewed At",
  "Primary Contact Name", "Company / Client Name", "Email", "Phone",
  "Requested Amount", "Approved Amount", "Coverage Type", "Client Selected Coverage",
  "Property / Incident Reference", "Incident Location", "Issue Description",
  "Decision Explanation", "Internal Notes Summary", "Public Notes Summary",
  "Claim Folder URL", "Current Settlement File URL", "Current Settlement Version",
  "Void Reason", "Close Note", "Last Updated"
];

// Rename legacy columns from the old single-tab Claims schema → new names.
// Applied non-destructively — no data is removed, column order preserved.
var CLAIMS_HEADER_RENAMES = {
  "Client":            "Company / Client Name",
  "Description":       "Issue Description",
  "Location":          "Incident Location",
  "Filed By":          "Created By",
  "Filed Date":        "Date Opened",
  "Settlement Amount": "Requested Amount",
  "Resolved Date":     "Date Closed",
  "Notes":             "Internal Notes Summary",
  "Photos URL":        "Claim Folder URL"
};

// ── Schema: Claim_Items ───────────────────────────────────────────────────────

var CLAIM_ITEMS_HEADERS = [
  "Claim ID", "Item ID", "Item Description Snapshot", "Vendor Snapshot",
  "Class Snapshot", "Status Snapshot", "Location Snapshot", "Sidemark Snapshot",
  "Room Snapshot", "Added At", "Added By"
];

// ── Schema: Claim_History ─────────────────────────────────────────────────────

var CLAIM_HISTORY_HEADERS = [
  "Claim ID", "Event Timestamp", "Event Type", "Event Message",
  "Actor", "Is Public", "Related File URL"
];

// ── Schema: Claim_Files ───────────────────────────────────────────────────────

var CLAIM_FILES_HEADERS = [
  "Claim ID", "File Type", "File Name", "File URL",
  "Version No", "Is Current", "Created At", "Created By"
];

// ── Claims_Config keys ────────────────────────────────────────────────────────

var CLAIMS_CONFIG_KEYS = [
  "CLAIMS_PARENT_FOLDER_ID",      // Drive folder ID where per-claim folders are created
  "SETTLEMENT_TEMPLATE_DOC_ID",   // Google Doc template ID for settlement PDF generation
  "COVERAGE_VALUES",              // Pipe-delimited allowed coverage types
  "OUTCOME_VALUES",               // Pipe-delimited allowed outcome types
  "RESOLUTION_VALUES",            // Pipe-delimited allowed resolution types
  "NOTIFICATION_EMAILS"           // Comma-separated internal notification recipients
];

var CLAIMS_CONFIG_DEFAULTS = {
  "COVERAGE_VALUES":   "Full Replacement Coverage|Full Replacement Coverage with $300 Deductible|Standard Valuation Coverage",
  "OUTCOME_VALUES":    "Approved|Partial Approval|Denied|Withdrawn",
  "RESOLUTION_VALUES": "Repair|Replace|Cash Settlement|Other"
};

// ── One-time schema setup ─────────────────────────────────────────────────────

/**
 * Run ONCE from the Stride Billing menu to initialize all Claims tabs.
 * Safe to re-run — non-destructive. Renames legacy columns, appends missing ones.
 * Seeds Claims_Config with default values for dropdown fields.
 */
function Claims_SetupSchema() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  try {
    // 1. Claims (main) — rename legacy columns + append missing
    var claimsSh = ensureSheet_(ss, "Claims");
    ensureHeaderRowSafe_(claimsSh, CLAIMS_HEADERS, CLAIMS_HEADER_RENAMES);

    // 2. Claim_Items — child records, one row per linked item per claim
    var itemsSh = ensureSheet_(ss, "Claim_Items");
    ensureHeaderRowSafe_(itemsSh, CLAIM_ITEMS_HEADERS, {});

    // 3. Claim_History — full audit trail
    var historySh = ensureSheet_(ss, "Claim_History");
    ensureHeaderRowSafe_(historySh, CLAIM_HISTORY_HEADERS, {});

    // 4. Claim_Files — file/PDF tracking with versioning
    var filesSh = ensureSheet_(ss, "Claim_Files");
    ensureHeaderRowSafe_(filesSh, CLAIM_FILES_HEADERS, {});

    // 5. Claims_Config — key/value configuration (Col A = Key, Col B = Value)
    var configSh = ensureSheet_(ss, "Claims_Config");
    if (configSh.getLastRow() < 1) {
      configSh.getRange(1, 1, 1, 2).setValues([["Key", "Value"]]).setFontWeight("bold");
      configSh.setFrozenRows(1);
    }

    // Seed missing keys (skip existing)
    var existingKeys = {};
    if (configSh.getLastRow() >= 2) {
      configSh.getRange(2, 1, configSh.getLastRow() - 1, 1).getValues()
        .forEach(function(r) {
          var k = String(r[0] || "").trim();
          if (k) existingKeys[k] = true;
        });
    }
    var nextRow = configSh.getLastRow() + 1;
    CLAIMS_CONFIG_KEYS.forEach(function(key) {
      if (!existingKeys[key]) {
        configSh.getRange(nextRow, 1).setValue(key);
        configSh.getRange(nextRow, 2).setValue(CLAIMS_CONFIG_DEFAULTS[key] || "");
        nextRow++;
      }
    });

    ui.alert(
      "✅ Claims Schema Ready",
      "Tabs created/updated:\n" +
      "  • Claims (legacy columns renamed, new columns added)\n" +
      "  • Claim_Items\n" +
      "  • Claim_History\n" +
      "  • Claim_Files\n" +
      "  • Claims_Config\n\n" +
      "REQUIRED — open Claims_Config and fill in:\n" +
      "  CLAIMS_PARENT_FOLDER_ID   ← Drive folder ID for claim folders\n" +
      "  SETTLEMENT_TEMPLATE_DOC_ID ← Google Doc template ID\n" +
      "  NOTIFICATION_EMAILS        ← comma-separated internal emails\n\n" +
      "Add these keys to Master Price List → Email_Templates tab:\n" +
      "  CLAIM_RECEIVED  |  CLAIM_STAFF_NOTIFY\n" +
      "  CLAIM_MORE_INFO  |  CLAIM_DENIAL  |  CLAIM_SETTLEMENT",
      ui.ButtonSet.OK
    );

  } catch (e) {
    ui.alert("Claims setup failed: " + e.message);
  }
}
