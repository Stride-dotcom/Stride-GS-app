/***************************************************************
CB13_SCHEMA_MIGRATION.gs
Handles:
- Ledger Entry ID column insertion (additive only)
- No column insertion for Sidemark (looked up from Inventory at report time)
***************************************************************/

function CB13_migrateClientSheet_(clientSpreadsheet) {
var sh = clientSpreadsheet.getSheetByName(CB13.LEDGER_TAB);
if (!sh) throw new Error("Missing Billing_Ledger tab.");

var lastCol = sh.getLastColumn();
if (lastCol < 1) return;

// v2.6.4: Do NOT insert Sidemark column — it conflicts with client ensureHeaderRow_
// and causes data misalignment. Unbilled Report looks up Sidemark from Inventory instead.

// Insert Ledger Entry ID at far right if missing (check all columns to avoid duplicates)
var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
var hasLedgerId = false;
for (var li = 0; li < headers.length; li++) {
  if (CB13_norm_(headers[li]) === CB13_norm_(CB13.HEADERS.LEDGER_ID)) { hasLedgerId = true; break; }
}
if (!hasLedgerId) {
sh.insertColumnAfter(sh.getLastColumn());
sh.getRange(1, sh.getLastColumn()).setValue(CB13.HEADERS.LEDGER_ID);
}
}

function CB13_findHeaderIndex_(headers, candidates) {
var norm = headers.map(CB13_norm_);
for (var i = 0; i < candidates.length; i++) {
var idx = norm.indexOf(CB13_norm_(candidates[i]));
if (idx !== -1) return idx;
}
return null;
}

/**
 * Menu-callable wrapper for client schema migration.
 * Prompts user for client spreadsheet URL, then migrates.
 */
function CB13_runSchemaMigration() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt("Migrate Client Schema",
    "Paste the client Billing spreadsheet URL (or ID):",
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var input = resp.getResponseText().trim();
  // Accept URL or raw ID
  var idMatch = input.match(/\/d\/([a-zA-Z0-9_-]+)/);
  var ssId = idMatch ? idMatch[1] : input;
  try {
    var clientSS = SpreadsheetApp.openById(ssId);
    CB13_migrateClientSheet_(clientSS);
    ui.alert("Migration complete for: " + clientSS.getName());
  } catch (e) {
    ui.alert("Error: " + e.message);
  }
}

/**
 * v2.6.4: Repair client Billing_Ledger columns corrupted by repeated
 * Sidemark insertion. The old migration inserted Sidemark column(s) after
 * Client, shifting old data right by 1-3+ positions. Then ensureHeaderRow_
 * overwrote headers back to 17 columns (without Sidemark), and the user
 * deleted extra Ledger Entry ID columns from the end.
 *
 * Result: old rows have N empty cells after Client (indices 3..3+N-1),
 * with real data starting at index 3+N. New rows are aligned to headers.
 *
 * This function:
 * 1. For each data row, scans from index 3 onward to find the first Date value
 * 2. If Date is not at index 3, splices out the empty cells to realign
 * 3. Pads/trims all rows to exactly 17 columns
 * 4. Re-writes correct headers
 */
function CB13_repairClientBillingColumns() {
  var ui = SpreadsheetApp.getUi();
  var clients = getActiveClients_v2_();
  if (!clients || clients.length === 0) { ui.alert("No active clients found."); return; }

  var EXPECTED = [
    "Status","Invoice #","Client","Date","Svc Code","Svc Name",
    "Item ID","Description","Class","Qty","Rate","Total",
    "Task ID","Repair ID","Shipment #","Item Notes","Ledger Entry ID"
  ];
  var DATE_COL = 3; // 0-based index where "Date" should be
  var EXPECTED_LEN = EXPECTED.length; // 17

  var results = [];
  for (var i = 0; i < clients.length; i++) {
    var clientName = clients[i].name || "Client " + i;
    try {
      var css = SpreadsheetApp.openById(String(clients[i].id).trim());
      var bl = css.getSheetByName("Billing_Ledger");
      if (!bl) { results.push(clientName + ": No Billing_Ledger"); continue; }

      var lastCol = bl.getLastColumn();
      var lastRow = bl.getLastRow();
      if (lastRow < 2) {
        // No data — just fix headers
        bl.getRange(1, 1, 1, EXPECTED_LEN).setValues([EXPECTED]);
        results.push(clientName + ": OK (no data rows)");
        continue;
      }

      // Read ALL data including header
      var allData = bl.getRange(1, 1, lastRow, lastCol).getValues();
      var fixedRows = 0;

      for (var r = 1; r < allData.length; r++) {
        var row = allData[r];

        // Skip completely empty rows
        var hasAny = false;
        for (var ch = 0; ch < row.length; ch++) {
          if (row[ch] !== "" && row[ch] != null) { hasAny = true; break; }
        }
        if (!hasAny) continue;

        // Check if Date is already at the correct position (index 3)
        var dateAtCorrectPos = CB13_isDateValue_(row[DATE_COL]);

        if (!dateAtCorrectPos) {
          // Scan from index 4 onward to find where the Date value actually is
          var foundDateAt = -1;
          for (var scan = DATE_COL + 1; scan < row.length && scan <= DATE_COL + 6; scan++) {
            if (CB13_isDateValue_(row[scan])) {
              foundDateAt = scan;
              break;
            }
          }

          if (foundDateAt > DATE_COL) {
            // Found date at a shifted position — remove the empty cells between
            var shiftAmount = foundDateAt - DATE_COL;
            row.splice(DATE_COL, shiftAmount);
            allData[r] = row;
            fixedRows++;
          }
          // If no date found anywhere, leave the row as-is (might be a legitimate empty-date row)
        }
      }

      // Normalize: set header row and pad/trim all rows to EXPECTED_LEN
      allData[0] = EXPECTED.slice();
      for (var r2 = 0; r2 < allData.length; r2++) {
        while (allData[r2].length < EXPECTED_LEN) allData[r2].push("");
        if (allData[r2].length > EXPECTED_LEN) allData[r2] = allData[r2].slice(0, EXPECTED_LEN);
      }

      // Write back
      bl.clearContents();
      bl.getRange(1, 1, allData.length, EXPECTED_LEN).setValues(allData);

      // Delete extra physical columns beyond 17
      var maxCols = bl.getMaxColumns();
      if (maxCols > EXPECTED_LEN) {
        bl.deleteColumns(EXPECTED_LEN + 1, maxCols - EXPECTED_LEN);
      }

      results.push(clientName + ": REPAIRED — " + fixedRows + " row(s) realigned");

    } catch (err) {
      results.push(clientName + ": ERROR — " + err.message);
    }
  }

  ui.alert("Billing Column Repair Results:\n\n" + results.join("\n"));
}

/** Helper: check if a value looks like a Date */
function CB13_isDateValue_(val) {
  if (!val && val !== 0) return false;
  if (Object.prototype.toString.call(val) === "[object Date]" && !isNaN(val.getTime())) return true;
  var s = String(val).trim();
  if (!s) return false;
  // Check common date patterns: M/D/YYYY, M/D/YY, M-D-YYYY, YYYY-MM-DD
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(s)) return true;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return true;
  // Check if Date constructor can parse it and it looks reasonable (year 2000-2099)
  var d = new Date(s);
  if (!isNaN(d.getTime()) && d.getFullYear() >= 2000 && d.getFullYear() <= 2099) return true;
  return false;
}