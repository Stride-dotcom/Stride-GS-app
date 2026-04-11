/***************************************************************
CB13_CONFIG.gs
Stride Consolidated Billing v1.3.0 — Phase 1
Add-on module (does not modify v1.2.2)
***************************************************************/

var CB13_VERSION = "v1.3.0-PHASE1";

var CB13 = {
SHEETS: {
UNBILLED: "Unbilled_Report"
},

LEDGER_TAB: "Billing_Ledger",

HEADERS: {
BILLING_STATUS: "Billing Status",
CLIENT: "Client",
SIDEMARK: "Sidemark",
SERVICE_DATE: "Service Date",
SERVICE_NAME: "Service Name",
TOTAL: "Total",
SVC_CODE: "SVC code",
ITEM_ID: "Item ID",
LEDGER_ID: "Ledger Entry ID",
SEPARATE_BY_SIDEMARK: "Separate By Sidemark"
}
};
function CB13_seedSettingsKeys_(sh, requiredKeys) {
// Expects Key in col A, Value in col B
const values = sh.getDataRange().getValues();
const existing = new Set();

for (let r = 0; r < values.length; r++) {
const k = String(values[r][0] || "").trim();
if (k) existing.add(k);
}

let row = sh.getLastRow() + 1;
requiredKeys.forEach((k) => {
if (!existing.has(k)) {
sh.getRange(row, 1).setValue(k);
sh.getRange(row, 2).setValue(""); // leave blank for user to fill
row++;
}
});
}