/* ===================================================
   Emails.gs — v4.6.0 — 2026-04-16 PST — Drop Room column from email item tables, Reference takes its place
   v4.6.0: buildItemsHtmlTable_ and buildSingleItemTableHtml_ now emit
           Item ID / Qty / Vendor / Description / Sidemark / Reference.
           Room was client-facing noise; Reference (PO/reference) is what
           warehouse + billing need to see. Applies to SHIPMENT_RECEIVED,
           INSP_EMAIL, TASK_COMPLETE, REPAIR_QUOTE, REPAIR_COMPLETE email
           bodies that render item tables via these helpers.
   v4.5.1: (1) Resend paths (INSP_EMAIL, REPAIR_QUOTE, REPAIR_COMPLETE) now pass
               {{SIDEMARK}} + {{SIDEMARK_HEADER}} — previously left literal token
               in the resent email body.
           (2) Shipment email body table (buildItemsHtmlTable_) now has columns
               Item ID, Reference, Qty, Vendor, Description, Sidemark, Room
               (removed "Item Notes" to make room for "Reference"; users said
               Reference is more important).
           (3) Embedded DOC_RECEIVING fallback in getDefaultDocHtml_ now has
               Item ID, Reference, Qty, Vendor, Description, Sidemark, Notes —
               Class + Location removed. Matches production DOC_RECEIVING
               template in Doc Templates/ pushed via extended push-templates.
   v4.5.0: Added buildSidemarkHeader_(sidemark) + collectSidemarksFromRows_(map, rows)
           helpers. Emit {{SIDEMARK}} + {{SIDEMARK_HEADER}} tokens from multi-item
           email send paths. Templates now render a prominent Project/Sidemark chip
           near the top so clients immediately see which project an email references.
   v4.4.0: Email CTA URLs changed from route-style (#/tasks/ID) to query-style
           (#/tasks?open=ID&client=SHEETID) so the list-page deep-link handlers
           (session 65) auto-select the client AND auto-open the detail panel.
           Fixes the case where clicking the email CTA landed on the list with
           no client selected and no detail opening. Same change for repairs.
   v4.3.0 — 2026-04-15 10:00 AM PST
   v4.2.0: sendWelcomeEmail_ and the test-send path now resolve the
   {{APP_URL}} token (https://www.mystridehub.com). Previously only
   {{CLIENT_NAME}}, {{SPREADSHEET_URL}}, and {{CLIENT_EMAIL}} were
   resolved, so Master Price List WELCOME_EMAIL templates that use
   {{APP_URL}} for the login CTA had the token rendered as literal
   text. This parity with StrideAPI.gs handleSendWelcomeEmail_ means
   the spreadsheet custom menu "Send Welcome Email" now produces the
   same output as the React-side resend button.
   =================================================== */

/* ============================================================
   DRIVE FOLDER HELPERS
   ============================================================ */

function createItemFolder_(photosUrl, folderName) {
  if (!photosUrl) return "";
  try {
    var folderId = "";
    var match = String(photosUrl).match(/[-\w]{25,}/);
    if (match) folderId = match[0];
    if (!folderId) return "";
    var parentFolder = DriveApp.getFolderById(folderId);
    var existing = parentFolder.getFoldersByName(folderName);
    if (existing.hasNext()) {
      return existing.next().getUrl();
    }
    var newFolder = parentFolder.createFolder(folderName);
    return newFolder.getUrl();
  } catch (err) {
    Logger.log("createItemFolder_ error: " + err);
    return "";
  }
}

/* ============================================================
   WORK ORDER PDF GENERATION
   ============================================================
   Generates printable Work Order PDFs for tasks and repairs.
   Requires: Advanced Drive Service enabled in Apps Script editor
   (Services -> Drive API -> Add).
   ============================================================ */

/**
 * Creates a Google Doc from raw HTML using Advanced Drive Service.
 * Returns the Doc ID.
 */
function createGoogleDocFromHtml_(title, html) {
  var blob = Utilities.newBlob(html, "text/html", title + ".html");
  var tempFile = DriveApp.createFile(blob);
  try {
    var doc = Drive.Files.copy(
      { title: title, mimeType: MimeType.GOOGLE_DOCS },
      tempFile.getId()
    );
    tempFile.setTrashed(true);
    return doc.id;
  } catch (e) {
    try { tempFile.setTrashed(true); } catch (_) {}
    throw new Error(
      "HTML->Doc conversion failed. Enable Advanced Drive Service in Apps Script. " +
      "Error: " + (e && e.message ? e.message : e)
    );
  }
}

/**
 * Exports a Google Doc as a PDF blob with exact margin control (in inches).
 * Uses the Docs export URL with margin query parameters — the only reliable
 * way to get exact margins in Apps Script PDF output.
 */
function exportDocAsPdfBlob_(docId, fileName, marginInches) {
  var m = marginInches || 0.25;
  var pts = m * 72; // convert inches to points for Docs API

  // v2.6.5: Set document page margins via Docs API before PDF export
  // This overrides Google Docs' default 1-inch margins on the document itself
  try {
    var token = ScriptApp.getOAuthToken();
    var updateUrl = "https://docs.googleapis.com/v1/documents/" + docId + ":batchUpdate";
    var updatePayload = {
      requests: [{
        updateDocumentStyle: {
          documentStyle: {
            marginTop:    { magnitude: pts, unit: "PT" },
            marginBottom: { magnitude: pts, unit: "PT" },
            marginLeft:   { magnitude: pts, unit: "PT" },
            marginRight:  { magnitude: pts, unit: "PT" }
          },
          fields: "marginTop,marginBottom,marginLeft,marginRight"
        }
      }]
    };
    UrlFetchApp.fetch(updateUrl, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + token },
      payload: JSON.stringify(updatePayload),
      muteHttpExceptions: true
    });
  } catch (marginErr) {
    Logger.log("exportDocAsPdfBlob_ margin update failed (non-fatal): " + marginErr);
  }

  var url = "https://docs.google.com/document/d/" + docId + "/export?" +
    "format=pdf&size=letter&portrait=true&fitw=true&top=" + m + "&bottom=" + m + "&left=" + m + "&right=" + m;
  var tokenExport = ScriptApp.getOAuthToken();
  var resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: "Bearer " + tokenExport },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error("PDF export failed (" + resp.getResponseCode() + "): " + resp.getContentText().substring(0, 200));
  }
  return resp.getBlob().setName(fileName);
}

/* ============================================================
   EMAIL — PDF & TEMPLATE HELPERS
   ============================================================ */

function findPdfInFolder_(folderUrl, namePrefix) {
  if (!folderUrl) return null;
  var folderId = String(folderUrl).match(/[-\w]{25,}/);
  if (!folderId) return null;
  try {
    var folder = DriveApp.getFolderById(folderId[0]);
    var files = folder.getFilesByType(MimeType.PDF);
    while (files.hasNext()) {
      var file = files.next();
      if (file.getName().indexOf(namePrefix) === 0) return file.getBlob();
    }
  } catch (e) {
    Logger.log("findPdfInFolder_ error: " + e);
  }
  return null;
}

function sendTemplateEmail_(ss, templateKey, toEmails, tokens, pdfAttachment) {
var subject = "", htmlBody = "", templateRecipients = "", attachDocKey = "";
try {
// v4.0.4: Try local Email_Template_Cache first (instant), fall back to Master (slow)
var tmplSh = ss.getSheetByName("Email_Template_Cache");
var tmplSource = "cache";
if (!tmplSh || tmplSh.getLastRow() < 2) {
  // No local cache — fall back to Master Price List
  var masterId = getSetting_(ss, CI_SETTINGS_KEYS.MASTER_SPREADSHEET_ID);
  if (!masterId) {
    Logger.log("[EMAIL_DEBUG] " + templateKey + " FAIL: No Email_Template_Cache and no MASTER_SPREADSHEET_ID");
    throw new Error("No Email_Template_Cache or MASTER_SPREADSHEET_ID");
  }
  Logger.log("[EMAIL_DEBUG] " + templateKey + " No local cache — opening Master: " + masterId);
  var master = SpreadsheetApp.openById(masterId);
  tmplSh = master.getSheetByName("Email_Templates");
  tmplSource = "master";
  if (!tmplSh || tmplSh.getLastRow() < 2) {
    throw new Error("Email_Templates not found in Master: " + masterId);
  }
}
Logger.log("[EMAIL_DEBUG] " + templateKey + " step 1 OK: Using " + tmplSource + " (" + (tmplSh.getLastRow() - 1) + " rows)");
var lastCol = Math.max(tmplSh.getLastColumn(), 6);
var data = tmplSh.getRange(2, 1, tmplSh.getLastRow() - 1, lastCol).getValues();
var tmplRow = null;
var foundKeys = [];
for (var i = 0; i < data.length; i++) {
var cellKey = String(data[i][0] || "").trim();
foundKeys.push(cellKey);
if (cellKey === templateKey) { tmplRow = data[i]; break; }
}
if (!tmplRow) {
  Logger.log("[EMAIL_DEBUG] " + templateKey + " FAIL: Key not found. Available: [" + foundKeys.join(", ") + "]");
  throw new Error("Template key '" + templateKey + "' not found. Available: " + foundKeys.join(", "));
}
Logger.log("[EMAIL_DEBUG] " + templateKey + " step 2 OK: Template found via " + tmplSource + ", subject='" + String(tmplRow[1] || "").substring(0, 50) + "'");
subject = String(tmplRow[1] || "");
htmlBody = String(tmplRow[2] || "");
if (!htmlBody || htmlBody.length < 10) {
  Logger.log("[EMAIL_DEBUG] " + templateKey + " WARNING: HTML body very short (" + htmlBody.length + " chars)");
}
templateRecipients = String(tmplRow[4] || "").trim();
attachDocKey = String(tmplRow[5] || "").trim();
htmlBody += '<div style="text-align:center;font-size:8px;color:#CBD5E1;margin-top:4px;">T</div>';
Logger.log("[EMAIL_DEBUG] " + templateKey + " SUCCESS: Using template (T) from " + tmplSource + ". Recipients='" + templateRecipients + "', attachDoc='" + attachDocKey + "'");
} catch (err) {
Logger.log("[EMAIL_DEBUG] " + templateKey + " FALLBACK: " + err + " — using hardcoded fallback (F)");
var fb = getFallbackTemplate_(templateKey, tokens);
subject = fb.subject;
htmlBody = fb.htmlBody + '<div style="text-align:center;font-size:8px;color:#CBD5E1;margin-top:4px;">F</div>';
}
// v2.6.3: Resolve recipients from Email_Templates column E if present, otherwise use passed-in toEmails
var resolvedEmails = "";
if (templateRecipients) {
  resolvedEmails = templateRecipients
    .replace(/\{\{STAFF_EMAILS\}\}/gi, getSetting_(ss, CI_SETTINGS_KEYS.NOTIFICATION_EMAILS) || "")
    .replace(/\{\{CLIENT_EMAIL\}\}/gi, getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_EMAIL) || "");
} else {
  resolvedEmails = String(toEmails || "");
}
var emails = resolvedEmails.split(",").map(function(s) { return s.trim(); }).filter(Boolean);
emails = emails.filter(function(item, pos) { return item && emails.indexOf(item) === pos; });
if (!emails.length) return;
// Auto-resolve common tokens for all templates
tokens = tokens || {};
// {{INVENTORY_URL}} — link to this client spreadsheet
if (!tokens["{{INVENTORY_URL}}"]) tokens["{{INVENTORY_URL}}"] = ss.getUrl() || "";
// If {{PHOTOS_URL}} is empty, set it to "#" so buttons don't break, and provide a hide-able button token
var photosUrlVal = tokens["{{PHOTOS_URL}}"] || "";
if (!photosUrlVal || photosUrlVal === "#" || photosUrlVal.indexOf("http") !== 0) {
  tokens["{{PHOTOS_URL}}"] = "#";
  // Remove photos button from HTML by replacing the button section if photos URL is empty
  htmlBody = htmlBody.replace(/<a[^>]*\{\{PHOTOS_URL\}\}[^>]*>[^<]*<\/a>/gi, "");
}

var entries = Object.entries(tokens);
for (var j = 0; j < entries.length; j++) {
var token = entries[j][0];
var value = entries[j][1];
var safe = String(value !== undefined && value !== null ? value : "");
subject = subject.split(token).join(safe);
htmlBody = htmlBody.split(token).join(safe);
}

// v4.3.0: Inject "View in Stride Hub" deep-link CTA button if caller set {{APP_DEEP_LINK}}
var deepLinkUrl = (tokens && tokens["{{APP_DEEP_LINK}}"]) || "";
if (deepLinkUrl && deepLinkUrl.indexOf("http") === 0) {
  var ctaBtn = '<div style="text-align:center;margin:20px 0 8px;">' +
    '<a href="' + deepLinkUrl + '" style="display:inline-block;background:#E85D2D;color:#ffffff;' +
    'padding:11px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;' +
    'font-family:Arial,Helvetica,sans-serif;letter-spacing:0.01em;">View in Stride Hub &#8594;</a></div>';
  htmlBody = htmlBody.indexOf('</body>') !== -1
    ? htmlBody.replace('</body>', ctaBtn + '</body>')
    : htmlBody + ctaBtn;
}

// v2.6.5: Attach PDF if provided by caller, or find existing PDF via Column F folder hint
// Map doc template keys to actual PDF filename prefixes
var DOC_KEY_TO_PREFIX = {
  "DOC_RECEIVING": "Receiving_",
  "DOC_TASK_WORK_ORDER": "Work_Order_",
  "DOC_REPAIR_WORK_ORDER": "Work_Order_",
  "DOC_WILL_CALL_RELEASE": "Will_Call_"
};
var emailAttachments = [];
if (pdfAttachment) {
  emailAttachments.push(pdfAttachment);
} else if (attachDocKey && tokens && tokens["__PDF_FOLDER_URL__"]) {
  // Try to find existing PDF in the specified Drive folder
  try {
    var pdfPrefix = DOC_KEY_TO_PREFIX[attachDocKey] || attachDocKey;
    var pdfBlob = findPdfInFolder_(tokens["__PDF_FOLDER_URL__"], pdfPrefix);
    if (pdfBlob) emailAttachments.push(pdfBlob);
  } catch (attachErr) {
    Logger.log("sendTemplateEmail_ attachment lookup failed: " + attachErr);
  }
}

try {
var emailOpts = { htmlBody: htmlBody, from: "whse@stridenw.com" };
if (emailAttachments.length) emailOpts.attachments = emailAttachments;
GmailApp.sendEmail(emails.join(","), subject, "", emailOpts);
} catch (err2) {
Logger.log("sendTemplateEmail_ send failed (" + templateKey + "): " + err2);
}
}

/* ============================================================
   DOC TEMPLATE HELPERS
   ============================================================ */

/**
 * Fetches a document HTML template from Email_Templates in the Master Price List.
 * Returns { title: String, html: String } or null if not found / empty.
 * Document templates share the same sheet as email templates.
 * Column A = Template Key, Column B = Title pattern, Column C = HTML Body.
 */
function getDocTemplateHtml_(ss, templateKey) {
  try {
    // v4.0.4: Try local Email_Template_Cache first, fall back to Master
    var tmplSh = ss.getSheetByName("Email_Template_Cache");
    var tmplSource = "cache";
    if (!tmplSh || tmplSh.getLastRow() < 2) {
      var masterId = getSetting_(ss, CI_SETTINGS_KEYS.MASTER_SPREADSHEET_ID);
      if (!masterId) { Logger.log("[DOC_TEMPLATE] No cache or MASTER_SPREADSHEET_ID for: " + templateKey); return null; }
      Logger.log("[DOC_TEMPLATE] No local cache — opening Master: " + masterId);
      var master = SpreadsheetApp.openById(masterId);
      tmplSh = master.getSheetByName("Email_Templates");
      tmplSource = "master";
      if (!tmplSh || tmplSh.getLastRow() < 2) { Logger.log("[DOC_TEMPLATE] Email_Templates not found in Master"); return null; }
    }
    var lastCol = Math.max(tmplSh.getLastColumn(), 6);
    var data = tmplSh.getRange(2, 1, tmplSh.getLastRow() - 1, lastCol).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0] || "").trim() === templateKey) {
        var html = String(data[i][2] || "").trim();
        if (!html) { Logger.log("[DOC_TEMPLATE] Found " + templateKey + " via " + tmplSource + " but HTML is empty"); return null; }
        Logger.log("[DOC_TEMPLATE] Found " + templateKey + " via " + tmplSource + ", HTML length: " + html.length);
        return { title: String(data[i][1] || ""), html: html, recipients: String(data[i][4] || "").trim() };
      }
    }
    Logger.log("[DOC_TEMPLATE] Key not found: " + templateKey + " via " + tmplSource);
  } catch (err) {
    Logger.log("[DOC_TEMPLATE] Fetch failed for " + templateKey + ": " + err);
  }
  return null;
}

/**
 * Replaces all {{TOKEN}} placeholders in an HTML string with values from a tokens map.
 * Tokens with undefined/null values resolve to empty string.
 */
function resolveDocTokens_(html, tokens) {
  var entries = Object.entries(tokens || {});
  for (var j = 0; j < entries.length; j++) {
    var val = entries[j][1];
    var safe = String(val !== undefined && val !== null ? val : "");
    html = html.split(entries[j][0]).join(safe);
  }
  return html;
}

/**
 * Returns the corrected default HTML for a document template.
 * Used as fallback when the Email_Templates sheet lookup fails or is empty.
 * @param {string} templateKey  One of: DOC_RECEIVING, DOC_TASK_WORK_ORDER, DOC_REPAIR_WORK_ORDER, DOC_WILL_CALL_RELEASE
 * @return {string} HTML template string with {{TOKEN}} placeholders
 */
function getDefaultDocHtml_(templateKey) {
  switch (templateKey) {
    case "DOC_RECEIVING":
      return '<html><head><style>body{font-family:Arial,Helvetica,sans-serif;color:#1E293B;margin:0;padding:0;}table{border-collapse:collapse;width:8in;}</style></head><body><div style="width:8in;margin:0;"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:6px;"><tr><td style="vertical-align:middle;"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="vertical-align:middle;padding-right:10px;"><img src="{{LOGO_URL}}" alt="Logo" style="height:38px;width:38px;" /></td><td style="vertical-align:middle;"><span style="font-size:20px;font-weight:bold;color:#1E293B;">Stride Logistics </span><span style="font-size:20px;font-weight:bold;color:#E85D2D;">WMS</span><br><span style="font-size:10px;color:#64748B;">Kent, WA &middot; whse@stridenw.com &middot; 206-550-1848</span></td></tr></table></td><td style="text-align:right;vertical-align:middle;"><div style="font-size:20px;font-weight:bold;color:#1E293B;">Receiving Document</div><div style="font-size:11px;color:#64748B;margin-top:2px;">Warehouse Receipt &amp; Acknowledgment</div></td></tr></table><table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;margin-bottom:14px;"><tr><td style="width:50%;vertical-align:top;padding-right:10px;"><div style="background:#F8FAFC;border:1px solid #E2E8F0;padding:10px 12px;"><div style="font-size:9px;color:#64748B;font-weight:bold;margin-bottom:6px;">SHIPMENT DETAILS</div><table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td style="font-size:10px;color:#64748B;padding:2px 0;width:85px;">Shipment #</td><td style="font-size:12px;font-weight:bold;">{{SHIPMENT_NO}}</td></tr><tr><td style="font-size:10px;color:#64748B;padding:2px 0;">Received</td><td style="font-size:12px;font-weight:bold;">{{RECEIVED_DATE}}</td></tr><tr><td style="font-size:10px;color:#64748B;padding:2px 0;">Carrier</td><td style="font-size:12px;">{{CARRIER}}</td></tr><tr><td style="font-size:10px;color:#64748B;padding:2px 0;">Tracking #</td><td style="font-size:12px;">{{TRACKING}}</td></tr><tr><td style="font-size:10px;color:#64748B;padding:2px 0;">Items</td><td style="font-size:12px;font-weight:bold;">{{ITEM_COUNT}}</td></tr></table></div></td><td style="width:50%;vertical-align:top;"><div style="background:#F8FAFC;border:1px solid #E2E8F0;padding:10px 12px;"><div style="font-size:9px;color:#64748B;font-weight:bold;margin-bottom:6px;">CLIENT</div><div style="font-size:14px;font-weight:bold;margin-bottom:2px;">{{CLIENT_NAME}}</div>{{CLIENT_EMAIL_HTML}}</div></td></tr></table>{{SHIPMENT_NOTES_HTML}}<div style="font-size:9px;color:#64748B;font-weight:bold;margin-bottom:4px;">ITEMS RECEIVED</div><table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E2E8F0;margin-bottom:4px;"><tr style="background:#E85D2D;"><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:center;width:24px;">#</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Item ID</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Reference</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:center;width:30px;">Qty</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Vendor</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Description</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Sidemark</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Notes</th></tr>{{ITEMS_TABLE_ROWS}}</table><div style="text-align:right;font-size:11px;font-weight:bold;color:#1E293B;margin-bottom:16px;">Total Items: {{TOTAL_ITEMS}}</div><div style="border-top:2px solid #E2E8F0;padding-top:10px;margin-bottom:16px;"><div style="font-size:9px;font-weight:bold;color:#64748B;margin-bottom:4px;">TERMS &amp; CONDITIONS</div><div style="font-size:8.5px;color:#94A3B8;line-height:1.5;"><b>1. Acceptance.</b> The act of tendering goods for storage or other services shall constitute acceptance of this contract and all terms herein.<br><b>2. Receiving.</b> All items are received as Subject to Inspection regardless of shipper policies. Stride Logistics is not liable for concealed damages, manufacturing defects, parts shortages, or craftsmanship issues.<br><b>3. Storage.</b> Storage charges begin on the date Warehouse accepts care, custody and control of the Goods. All storage charges are due and payable prior to release unless Depositor has a credit account.<br><b>4. Liability.</b> Warehouse shall not be liable for loss or damage unless caused by failure to exercise reasonable care. Depositor stores goods entirely at their own risk and is responsible for maintaining insurance on all stored items.<br><b>5. Claims.</b> Claims must be presented in writing within 60 days of delivery or notification of loss or damage.<br><b>6. Release.</b> Goods shall be delivered only upon receipt of complete written instructions from Depositor. Written authorization is required for all releases.<br><b>7. Lien.</b> Warehouse shall have a general lien on all goods for unpaid charges including storage, handling, transportation, and other expenses. Advance payment may be required prior to release.</div></div><table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;"><tr><td style="width:46%;"><div style="border-bottom:1.5px solid #1E293B;height:32px;"></div><div style="font-size:9px;color:#64748B;padding-top:4px;">Warehouse Representative / Date</div></td><td style="width:8%;"></td><td style="width:46%;"><div style="border-bottom:1.5px solid #1E293B;height:32px;"></div><div style="font-size:9px;color:#64748B;padding-top:4px;">Client Representative / Date</div></td></tr></table></div></body></html>';
    case "DOC_TASK_WORK_ORDER":
      return '<html><head><style>body{font-family:Arial,Helvetica,sans-serif;color:#1E293B;margin:0;padding:0;}table{border-collapse:collapse;width:8in;}</style></head><body><div style="width:8in;margin:0;"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:6px;"><tr><td style="vertical-align:middle;"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="vertical-align:middle;padding-right:10px;"><img src="{{LOGO_URL}}" alt="Logo" style="height:38px;width:38px;" /></td><td style="vertical-align:middle;"><span style="font-size:20px;font-weight:bold;color:#1E293B;">Stride Logistics </span><span style="font-size:20px;font-weight:bold;color:#E85D2D;">WMS</span><br><span style="font-size:10px;color:#64748B;">Kent, WA &middot; whse@stridenw.com &middot; 206-550-1848</span></td></tr></table></td><td style="text-align:right;vertical-align:middle;"><div style="font-size:20px;font-weight:bold;color:#1E293B;">Work Order</div><div style="font-size:15px;font-weight:bold;color:#E85D2D;margin-top:2px;">{{TASK_ID}}</div></td></tr></table><table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;margin-bottom:14px;"><tr><td style="width:50%;vertical-align:top;"><table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td style="font-size:10px;color:#64748B;padding:2px 0;width:80px;font-weight:bold;">CLIENT</td><td style="font-size:12px;font-weight:bold;">{{CLIENT_NAME}}</td></tr>{{SIDEMARK_ROW}}</table></td><td style="width:50%;vertical-align:top;"><table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td style="font-size:10px;color:#64748B;padding:2px 0;text-align:right;width:65px;font-weight:bold;">DATE</td><td style="font-size:12px;font-weight:bold;text-align:right;">{{DATE}}</td></tr><tr><td style="font-size:10px;color:#64748B;padding:2px 0;text-align:right;font-weight:bold;">STATUS</td><td style="font-size:12px;font-weight:bold;text-align:right;">{{STATUS}}</td></tr></table></td></tr></table><div style="background:#F8FAFC;border:1px solid #E2E8F0;padding:10px 12px;margin-bottom:14px;"><div style="font-size:9px;color:#64748B;font-weight:bold;margin-bottom:6px;">TASK DETAILS</div><table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td style="font-size:10px;color:#64748B;padding:2px 0;width:100px;font-weight:bold;">Task Type</td><td style="font-size:12px;font-weight:bold;">{{TASK_TYPE}}</td></tr>{{NOTES_ROW}}{{PHOTOS_ROW}}</table></div><div style="font-size:9px;color:#64748B;font-weight:bold;margin-bottom:4px;">ITEM DETAILS</div><table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E2E8F0;margin-bottom:16px;"><tr style="background:#E85D2D;"><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Item ID</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:center;width:30px;">Qty</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Vendor</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Description</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Sidemark</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Room</th></tr><tr><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;font-weight:bold;">{{ITEM_ID}}</td><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;text-align:center;">{{ITEM_QTY}}</td><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;">{{ITEM_VENDOR}}</td><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;">{{ITEM_DESC}}</td><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;">{{ITEM_SIDEMARK}}</td><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;">{{ITEM_ROOM}}</td></tr></table><div style="border:2px solid #1E293B;padding:14px;margin-bottom:14px;"><div style="font-size:11px;font-weight:bold;color:#1E293B;margin-bottom:10px;border-bottom:2px solid #E2E8F0;padding-bottom:5px;">WAREHOUSE USE ONLY</div><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="width:50%;padding-bottom:14px;"><div style="font-size:10px;font-weight:bold;color:#64748B;margin-bottom:4px;">Completed By</div><div style="border-bottom:1.5px solid #CBD5E1;height:22px;width:90%;"></div></td><td style="width:50%;padding-bottom:14px;"><div style="font-size:10px;font-weight:bold;color:#64748B;margin-bottom:4px;text-align:right;">Date</div><div style="border-bottom:1.5px solid #CBD5E1;height:22px;width:90%;margin-left:auto;"></div></td></tr></table><div style="margin-bottom:14px;"><div style="font-size:10px;font-weight:bold;color:#64748B;margin-bottom:6px;">Result</div>{{RESULT_OPTIONS_HTML}}</div><div><div style="font-size:10px;font-weight:bold;color:#64748B;margin-bottom:6px;">Notes</div><div style="border-bottom:1px solid #E2E8F0;height:18px;margin-bottom:6px;">&nbsp;</div><div style="border-bottom:1px solid #E2E8F0;height:18px;margin-bottom:6px;">&nbsp;</div><div style="border-bottom:1px solid #E2E8F0;height:18px;">&nbsp;</div></div></div><div style="text-align:center;font-size:9px;color:#94A3B8;border-top:1px solid #E2E8F0;padding-top:6px;">Stride Logistics &middot; 206-550-1848 &middot; whse@stridenw.com</div></div></body></html>';
    case "DOC_REPAIR_WORK_ORDER":
      return '<html><head><style>body{font-family:Arial,Helvetica,sans-serif;color:#1E293B;margin:0;padding:0;}table{border-collapse:collapse;width:8in;}</style></head><body><div style="width:8in;margin:0;"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:6px;"><tr><td style="vertical-align:middle;"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="vertical-align:middle;padding-right:10px;"><img src="{{LOGO_URL}}" alt="Logo" style="height:38px;width:38px;" /></td><td style="vertical-align:middle;"><span style="font-size:20px;font-weight:bold;color:#1E293B;">Stride Logistics </span><span style="font-size:20px;font-weight:bold;color:#E85D2D;">WMS</span><br><span style="font-size:10px;color:#64748B;">Kent, WA &middot; whse@stridenw.com &middot; 206-550-1848</span></td></tr></table></td><td style="text-align:right;vertical-align:middle;"><div style="font-size:20px;font-weight:bold;color:#1E293B;">Work Order</div><div style="font-size:15px;font-weight:bold;color:#E85D2D;margin-top:2px;">{{REPAIR_ID}}</div></td></tr></table><table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;margin-bottom:14px;"><tr><td style="width:50%;vertical-align:top;"><table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td style="font-size:10px;color:#64748B;padding:2px 0;width:80px;font-weight:bold;">CLIENT</td><td style="font-size:12px;font-weight:bold;">{{CLIENT_NAME}}</td></tr>{{SIDEMARK_ROW}}</table></td><td style="width:50%;vertical-align:top;"><table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td style="font-size:10px;color:#64748B;padding:2px 0;text-align:right;width:65px;font-weight:bold;">DATE</td><td style="font-size:12px;font-weight:bold;text-align:right;">{{DATE}}</td></tr><tr><td style="font-size:10px;color:#64748B;padding:2px 0;text-align:right;font-weight:bold;">STATUS</td><td style="font-size:12px;font-weight:bold;text-align:right;">{{STATUS}}</td></tr></table></td></tr></table><div style="background:#F8FAFC;border:1px solid #E2E8F0;padding:10px 12px;margin-bottom:14px;"><div style="font-size:9px;color:#64748B;font-weight:bold;margin-bottom:6px;">REPAIR DETAILS</div><table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td style="font-size:10px;color:#64748B;padding:2px 0;width:100px;font-weight:bold;">Repair Type</td><td style="font-size:12px;font-weight:bold;">{{REPAIR_TYPE}}</td></tr>{{APPROVED_ROW}}{{NOTES_ROW}}{{PHOTOS_ROW}}</table></div><div style="font-size:9px;color:#64748B;font-weight:bold;margin-bottom:4px;">ITEM DETAILS</div><table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E2E8F0;margin-bottom:16px;"><tr style="background:#E85D2D;"><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Item ID</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:center;width:30px;">Qty</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Vendor</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Description</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Sidemark</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Room</th></tr><tr><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;font-weight:bold;">{{ITEM_ID}}</td><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;text-align:center;">{{ITEM_QTY}}</td><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;">{{ITEM_VENDOR}}</td><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;">{{ITEM_DESC}}</td><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;">{{ITEM_SIDEMARK}}</td><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;">{{ITEM_ROOM}}</td></tr></table><div style="border:2px solid #1E293B;padding:14px;margin-bottom:14px;"><div style="font-size:11px;font-weight:bold;color:#1E293B;margin-bottom:10px;border-bottom:2px solid #E2E8F0;padding-bottom:5px;">WAREHOUSE USE ONLY</div><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="width:50%;padding-bottom:14px;"><div style="font-size:10px;font-weight:bold;color:#64748B;margin-bottom:4px;">Completed By</div><div style="border-bottom:1.5px solid #CBD5E1;height:22px;width:90%;"></div></td><td style="width:50%;padding-bottom:14px;"><div style="font-size:10px;font-weight:bold;color:#64748B;margin-bottom:4px;text-align:right;">Date</div><div style="border-bottom:1.5px solid #CBD5E1;height:22px;width:90%;margin-left:auto;"></div></td></tr></table><div style="margin-bottom:14px;"><div style="font-size:10px;font-weight:bold;color:#64748B;margin-bottom:6px;">Repair Result</div>{{RESULT_OPTIONS_HTML}}</div><div><div style="font-size:10px;font-weight:bold;color:#64748B;margin-bottom:6px;">Notes</div><div style="border-bottom:1px solid #E2E8F0;height:18px;margin-bottom:6px;">&nbsp;</div><div style="border-bottom:1px solid #E2E8F0;height:18px;margin-bottom:6px;">&nbsp;</div><div style="border-bottom:1px solid #E2E8F0;height:18px;">&nbsp;</div></div></div><div style="text-align:center;font-size:9px;color:#94A3B8;border-top:1px solid #E2E8F0;padding-top:6px;">Stride Logistics &middot; 206-550-1848 &middot; whse@stridenw.com</div></div></body></html>';
    case "DOC_WILL_CALL_RELEASE":
      return '<html><head><style>body{font-family:Arial,Helvetica,sans-serif;color:#1E293B;margin:0;padding:0;}table{border-collapse:collapse;width:8in;}</style></head><body><div style="width:8in;margin:0;"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:6px;"><tr><td style="vertical-align:middle;"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="vertical-align:middle;padding-right:10px;"><img src="{{LOGO_URL}}" alt="Logo" style="height:38px;width:38px;" /></td><td style="vertical-align:middle;"><span style="font-size:20px;font-weight:bold;color:#1E293B;">Stride Logistics </span><span style="font-size:20px;font-weight:bold;color:#E85D2D;">WMS</span><br><span style="font-size:10px;color:#64748B;">Kent, WA &middot; whse@stridenw.com &middot; 206-550-1848</span></td></tr></table></td><td style="text-align:right;vertical-align:middle;"><div style="font-size:20px;font-weight:bold;color:#1E293B;">Will Call Release</div><div style="font-size:15px;font-weight:bold;color:#E85D2D;margin-top:2px;">{{WC_NUMBER}}</div></td></tr></table>{{COD_BANNER_HTML}}<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;margin-bottom:10px;"><tr><td style="width:50%;vertical-align:top;padding-right:10px;"><div style="background:#F8FAFC;border:1px solid #E2E8F0;padding:10px 12px;"><div style="font-size:9px;color:#64748B;font-weight:bold;margin-bottom:6px;">ORDER DETAILS</div><table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td style="font-size:10px;color:#64748B;padding:2px 0;width:90px;">Client</td><td style="font-size:12px;font-weight:bold;">{{CLIENT_NAME}}</td></tr><tr><td style="font-size:10px;color:#64748B;padding:2px 0;">Date</td><td style="font-size:12px;font-weight:bold;">{{DATE}}</td></tr>{{EST_PICKUP_ROW}}{{REQUESTED_BY_ROW}}<tr><td style="font-size:10px;color:#64748B;padding:2px 0;">Items</td><td style="font-size:12px;font-weight:bold;">{{ITEM_COUNT}}</td></tr></table></div></td><td style="width:50%;vertical-align:top;"><div style="background:#F8FAFC;border:1px solid #E2E8F0;padding:10px 12px;"><div style="font-size:9px;color:#64748B;font-weight:bold;margin-bottom:6px;">RELEASE TO</div><div style="font-size:14px;font-weight:bold;margin-bottom:2px;">{{PICKUP_PARTY}}</div>{{PICKUP_PHONE_HTML}}</div></td></tr></table>{{NOTES_HTML}}<div style="font-size:9px;color:#64748B;font-weight:bold;margin-bottom:4px;">ITEMS FOR RELEASE</div><table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E2E8F0;margin-bottom:4px;"><tr style="background:#E85D2D;"><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:center;width:24px;">#</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Item ID</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:center;width:30px;">Qty</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Vendor</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Description</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:center;width:38px;">Class</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Location</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Sidemark</th></tr>{{ITEMS_TABLE_ROWS}}</table><div style="text-align:right;font-size:11px;font-weight:bold;color:#1E293B;margin-bottom:10px;">Total Items: {{TOTAL_ITEMS}}</div><div style="border:2px solid #1E293B;padding:10px 14px;margin-bottom:10px;"><div style="font-size:11px;font-weight:bold;color:#1E293B;margin-bottom:8px;border-bottom:2px solid #E2E8F0;padding-bottom:4px;">WAREHOUSE USE ONLY</div><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="width:50%;padding-bottom:4px;"><div style="font-size:10px;font-weight:bold;color:#64748B;margin-bottom:3px;">Items Verified By</div><div style="border-bottom:1.5px solid #CBD5E1;height:20px;width:90%;"></div></td><td style="width:50%;padding-bottom:4px;"><div style="font-size:10px;font-weight:bold;color:#64748B;margin-bottom:3px;text-align:right;">Date Released</div><div style="border-bottom:1.5px solid #CBD5E1;height:20px;width:90%;margin-left:auto;"></div></td></tr></table></div><div style="border:1px solid #E2E8F0;padding:10px 14px;margin-bottom:10px;"><div style="font-size:9px;color:#64748B;margin-bottom:10px;line-height:1.5;">I acknowledge receipt of the above items in their current condition. I understand that Stride Logistics is released from liability for these items upon signing.</div><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="width:58%;"><div style="border-bottom:1.5px solid #1E293B;height:28px;"></div><div style="font-size:9px;color:#64748B;padding-top:3px;">Signature</div></td><td style="width:4%;"></td><td style="width:38%;"><div style="border-bottom:1.5px solid #1E293B;height:28px;"></div><div style="font-size:9px;color:#64748B;padding-top:3px;">Date</div></td></tr></table><table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;"><tr><td style="width:58%;"><div style="border-bottom:1.5px solid #1E293B;height:22px;"></div><div style="font-size:9px;color:#64748B;padding-top:3px;">Printed Name</div></td><td style="width:42%;"></td></tr></table></div><div style="text-align:center;font-size:9px;color:#94A3B8;border-top:1px solid #E2E8F0;padding-top:5px;">Stride Logistics &middot; 206-550-1848 &middot; whse@stridenw.com</div></div></body></html>';
    default:
      return '';
  }
}

/* ============================================================
   EMAIL — HTML TABLE BUILDERS
   ============================================================ */

/**
 * Builds an HTML table of items for the SHIPMENT_RECEIVED email.
 * @param {Object} mapInv  Header map for Inventory sheet
 * @param {Array[]} rows   2-D array of inventory row data for the shipment
 * @return {string} HTML table markup
 */
/**
 * v4.4.0 — Build a conditional Sidemark header block for client-facing alert emails.
 *   buildSidemarkHeader_(value)  — single value from an inventory lookup
 *   collectSidemarksFromRows_(map, rows)  — distinct sidemarks across multi-item emails
 *     (shipment receipt, will call created/release/cancelled). Returns a comma-joined
 *     header; empty string when no rows have a sidemark.
 * Templates render `{{SIDEMARK_HEADER}}` as a prominent Project/Sidemark chip near
 * the top, so clients immediately see which project the email references.
 */
function buildSidemarkHeader_(sidemark) {
  var s = String(sidemark || "").trim();
  if (!s) return "";
  return '<div style="background:#FEF3E8;border:1px solid #F9C79F;border-radius:8px;padding:10px 14px;margin:0 0 14px 0;font-size:13px;color:#7C2D12"><span style="font-weight:800;color:#E85D2D;text-transform:uppercase;letter-spacing:0.04em;font-size:11px">Project / Sidemark:</span> <span style="font-weight:700;color:#1E293B;font-size:14px">' + esc_(s) + '</span></div>';
}

function collectSidemarksFromRows_(mapInv, rows) {
  if (!mapInv || !rows || !rows.length) return "";
  var smCol = mapInv["Sidemark"];
  if (!smCol) return "";
  var seen = {};
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var v = String(rows[i][smCol - 1] || "").trim();
    if (v && !seen[v]) { seen[v] = true; out.push(v); }
  }
  return out.join(", ");
}

function buildItemsHtmlTable_(mapInv, rows) {
    // v4.6.0 — drop Room, Reference moved to last column (client-facing Reference/PO > Room for the office)
    var cols = ["Item ID", "Qty", "Vendor", "Description", "Sidemark", "Reference"];
  var html = '<table style="width:100%;border-collapse:collapse;margin-bottom:16px">';
  html += '<tr>';
  for (var c = 0; c < cols.length; c++) {
    html += '<td style="padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:600;font-size:13px">' + cols[c] + '</td>';
  }
  html += '</tr>';
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    html += '<tr>';
    for (var c2 = 0; c2 < cols.length; c2++) {
      var val = "";
      if (mapInv[cols[c2]]) {
        val = String(r[mapInv[cols[c2]] - 1] || "");
      }
      html += '<td style="padding:6px 12px;border:1px solid #e2e8f0;font-size:13px">' + val + '</td>';
    }
    html += '</tr>';
  }
  html += '</table>';
  return html;
}

/**
 * Builds a single-row HTML item-details table from an inventory lookup object.
 * Uses the same style as buildItemsHtmlTable_ for consistency.
 * @param {Object} invLookup  Object returned by findInventoryRowByItemId_
 * @param {string} itemId     The Item ID value
 * @return {string} HTML table markup
 */
function buildSingleItemTableHtml_(invLookup, itemId) {
  if (!invLookup) return '<p style="color:#94a3b8;font-size:13px;margin-bottom:16px"><em>Item details unavailable</em></p>';
  // v4.6.0 — Room dropped in favor of Reference (client-facing PO/reference beats Room for warehouse ops)
  var cols = ["Item ID", "Qty", "Vendor", "Description", "Sidemark", "Reference"];
  var vals = [
    esc_(itemId || ""),
    esc_(String(invLookup.qty || "")),
    esc_(invLookup.vendor || ""),
    esc_(invLookup.description || ""),
    esc_(invLookup.sidemark || ""),
    esc_(invLookup.reference || "")
  ];
  var html = '<table style="width:100%;border-collapse:collapse;margin-bottom:16px">';
  html += '<tr>';
  for (var c = 0; c < cols.length; c++) {
    html += '<td style="padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:600;font-size:13px">' + cols[c] + '</td>';
  }
  html += '</tr><tr>';
  for (var v = 0; v < vals.length; v++) {
    html += '<td style="padding:6px 12px;border:1px solid #e2e8f0;font-size:13px">' + vals[v] + '</td>';
  }
  html += '</tr></table>';
  return html;
}

/* ============================================================
   RE-SEND EMAIL
   ============================================================ */

function StrideResendEmail() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var activeSheet = ss.getActiveSheet();
  var sheetName = activeSheet.getName();

  if (sheetName !== CI_SH.TASKS && sheetName !== CI_SH.REPAIRS) {
    ui.alert("Select a row on the Tasks or Repairs tab first.");
    return;
  }

  var activeRange = ss.getActiveRange();
  if (!activeRange || activeRange.getRow() < 2) {
    ui.alert("Select a data row (row 2 or below).");
    return;
  }

  var row = activeRange.getRow();
  var map = getHeaderMap_(activeSheet);
  var rowData = activeSheet.getRange(row, 1, 1, activeSheet.getLastColumn()).getValues()[0];
  var itemId = getCellByHeader_(rowData, map, "Item ID") || "";
  if (!itemId) { ui.alert("No Item ID found in the selected row."); return; }

  // Determine which email types are available based on the sheet
  var emailTypes = [];
  if (sheetName === CI_SH.TASKS) {
    emailTypes.push("Inspection Report (INSP_EMAIL)");
  } else {
    emailTypes.push("Repair Quote (REPAIR_QUOTE)");
    emailTypes.push("Repair Approved (REPAIR_APPROVED)");
    emailTypes.push("Repair Declined (REPAIR_DECLINED)");
    emailTypes.push("Repair Complete (REPAIR_COMPLETE)");
    emailTypes.push("Repair Quote Request (REPAIR_QUOTE_REQUEST)");
  }

  var prompt = ui.prompt(
    "Re-send Email",
    "Item: " + itemId + "\n\nAvailable email types:\n" +
    emailTypes.map(function(t, i) { return (i + 1) + ") " + t; }).join("\n") +
    "\n\nEnter the number (1" + (emailTypes.length > 1 ? "-" + emailTypes.length : "") + "):",
    ui.ButtonSet.OK_CANCEL
  );
  if (prompt.getSelectedButton() !== ui.Button.OK) return;

  var choice = parseInt(prompt.getResponseText(), 10);
  if (isNaN(choice) || choice < 1 || choice > emailTypes.length) {
    ui.alert("Invalid selection.");
    return;
  }

  var templateKey = "";
  if (sheetName === CI_SH.TASKS) {
    templateKey = "INSP_EMAIL";
  } else {
    var repairKeys = ["REPAIR_QUOTE", "REPAIR_APPROVED", "REPAIR_DECLINED", "REPAIR_COMPLETE", "REPAIR_QUOTE_REQUEST"];
    templateKey = repairKeys[choice - 1];
  }

  // Read all needed data
  var clientName = getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_NAME) || "Client";
  var clientEmail = getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_EMAIL) || "";
  var staffEmails = getSetting_(ss, CI_SETTINGS_KEYS.NOTIFICATION_EMAILS) || "";
  var notifEnabled = truthy_(getSetting_(ss, CI_SETTINGS_KEYS.ENABLE_NOTIFICATIONS));

  if (!clientEmail && !staffEmails) {
    ui.alert("No email recipients configured. Check CLIENT_EMAIL and NOTIFICATION_EMAILS in Settings.");
    return;
  }

  var invLookup = findInventoryRowByItemId_(ss, itemId);
  var itemTableHtml = buildSingleItemTableHtml_(invLookup, itemId);
  var desc = getCellByHeader_(rowData, map, "Description") || (invLookup ? invLookup.description : "") || "-";

  var tokens = {};

  if (templateKey === "INSP_EMAIL") {
    var result = getCellByHeader_(rowData, map, "Result") || "-";
    var resultColor = (result === "Pass" || result === "PASS") ? "#16A34A" :
                      (result === "Fail" || result === "FAIL") ? "#DC2626" : "#64748B";
    var shipNo = getCellByHeader_(rowData, map, "Shipment #") || "-";
    var taskNotes = getCellByHeader_(rowData, map, "Task Notes") || "-";
    // v2.6.4: Get photos URL from Task ID hyperlink
    var photos = "#";
    var taskIdForLink = getCellByHeader_(rowData, map, "Task ID") || "";
    var resendTaskIdCol = map["Task ID"];
    if (resendTaskIdCol) {
      var resendTaskRt = activeSheet.getRange(row, resendTaskIdCol).getRichTextValue();
      if (resendTaskRt && resendTaskRt.getLinkUrl()) photos = resendTaskRt.getLinkUrl();
    }
    // v4.5.0 — include Sidemark
    var _rsInspSm = invLookup ? (invLookup.sidemark || "") : "";
    tokens = {
      "{{ITEM_ID}}": itemId, "{{CLIENT_NAME}}": clientName,
      "{{SHIPMENT_NO}}": shipNo, "{{RESULT}}": result,
      "{{TASK_NOTES}}": taskNotes, "{{DESCRIPTION}}": desc,
      "{{ITEM_TABLE_HTML}}": itemTableHtml, "{{PHOTOS_URL}}": photos,
      "{{RESULT_COLOR}}": resultColor, "{{REPAIR_NOTE}}": "",
      "{{SIDEMARK}}": _rsInspSm,
      "{{SIDEMARK_HEADER}}": buildSidemarkHeader_(_rsInspSm),
      "{{APP_DEEP_LINK}}": taskIdForLink ? "https://www.mystridehub.com/#/tasks?open=" + encodeURIComponent(taskIdForLink) + "&client=" + encodeURIComponent(ss.getId()) : ""
    };
    var recipients = mergeEmails_(staffEmails, clientEmail);
    sendTemplateEmail_(ss, templateKey, recipients, tokens);

  } else if (templateKey === "REPAIR_QUOTE") {
    var quoteAmt = getCellByHeader_(rowData, map, "Quote Amount") || "0";
    var repairId = getCellByHeader_(rowData, map, "Repair ID") || "-";
    var vendor = getCellByHeader_(rowData, map, "Repair Vendor") || "-";
    var taskNotes = getCellByHeader_(rowData, map, "Task Notes") || "-";
    var repairNotes = getCellByHeader_(rowData, map, "Repair Notes") || "-";
    // v2.6.4: Get photos URL from Repair ID hyperlink
    var inspPhotos = "#";
    var resendRepIdCol = map["Repair ID"];
    if (resendRepIdCol) {
      var resendRepRt = activeSheet.getRange(row, resendRepIdCol).getRichTextValue();
      if (resendRepRt && resendRepRt.getLinkUrl()) inspPhotos = resendRepRt.getLinkUrl();
    }
    // v4.5.0 — include Sidemark
    var _rsRqSm = invLookup ? (invLookup.sidemark || "") : "";
    tokens = {
      "{{ITEM_ID}}": itemId, "{{CLIENT_NAME}}": clientName,
      "{{DESCRIPTION}}": desc, "{{ITEM_TABLE_HTML}}": itemTableHtml,
      "{{TASK_NOTES}}": taskNotes, "{{QUOTE_AMOUNT}}": formatCurrency_(quoteAmt),
      "{{REPAIR_ID}}": repairId, "{{REPAIR_VENDOR}}": vendor,
      "{{NOTES}}": repairNotes, "{{PHOTOS_URL}}": inspPhotos,
      "{{SIDEMARK}}": _rsRqSm,
      "{{SIDEMARK_HEADER}}": buildSidemarkHeader_(_rsRqSm),
      "{{APP_DEEP_LINK}}": repairId ? "https://www.mystridehub.com/#/repairs?open=" + encodeURIComponent(repairId) + "&client=" + encodeURIComponent(ss.getId()) : ""
    };
    sendTemplateEmail_(ss, templateKey, clientEmail, tokens);

  } else if (templateKey === "REPAIR_COMPLETE") {
    var repResult = getCellByHeader_(rowData, map, "Repair Result") || "-";
    var repResultColor = (repResult === "Pass" || repResult === "PASS") ? "#16A34A" :
                         (repResult === "Fail" || repResult === "FAIL") ? "#DC2626" : "#64748B";
    var repairId = getCellByHeader_(rowData, map, "Repair ID") || "-";
    var quoteAmt = getCellByHeader_(rowData, map, "Quote Amount") || "0";
    var finalAmt = getCellByHeader_(rowData, map, "Final Amount") || getCellByHeader_(rowData, map, "Quote Amount") || "0";
    var vendor = getCellByHeader_(rowData, map, "Repair Vendor") || "-";
    var partsCost = getCellByHeader_(rowData, map, "Parts Cost") || "-";
    var laborHours = getCellByHeader_(rowData, map, "Labor Hours") || "-";
    // v2.6.4: Get repair photos URL from Repair ID hyperlink
    var repairPhotos = "#";
    var resendRepIdCol2 = map["Repair ID"];
    if (resendRepIdCol2) {
      var resendRepRt2 = activeSheet.getRange(row, resendRepIdCol2).getRichTextValue();
      if (resendRepRt2 && resendRepRt2.getLinkUrl()) repairPhotos = resendRepRt2.getLinkUrl();
    }
    var repairNotes = getCellByHeader_(rowData, map, "Repair Notes") || "-";
    var compDate = getCellByHeader_(rowData, map, "Completed Date");
    var compDateStr = compDate ? Utilities.formatDate(compDate instanceof Date ? compDate : new Date(compDate), Session.getScriptTimeZone(), "MM/dd/yyyy") : "-";
    // v4.5.0 — include Sidemark
    var _rsRcSm = invLookup ? (invLookup.sidemark || "") : "";
    tokens = {
      "{{ITEM_ID}}": itemId, "{{CLIENT_NAME}}": clientName,
      "{{DESCRIPTION}}": desc, "{{ITEM_TABLE_HTML}}": itemTableHtml,
      "{{REPAIR_RESULT}}": repResult, "{{REPAIR_RESULT_COLOR}}": repResultColor,
      "{{COMPLETED_DATE}}": compDateStr,
      "{{QUOTE_AMOUNT}}": formatCurrency_(quoteAmt), "{{FINAL_AMOUNT}}": formatCurrency_(finalAmt),
      "{{REPAIR_VENDOR}}": vendor, "{{PARTS_COST}}": formatCurrency_(partsCost),
      "{{LABOR_HOURS}}": laborHours, "{{REPAIR_PHOTOS_URL}}": repairPhotos,
      "{{REPAIR_ID}}": repairId, "{{NOTES}}": repairNotes,
      "{{SIDEMARK}}": _rsRcSm,
      "{{SIDEMARK_HEADER}}": buildSidemarkHeader_(_rsRcSm),
      "{{APP_DEEP_LINK}}": repairId ? "https://www.mystridehub.com/#/repairs?open=" + encodeURIComponent(repairId) + "&client=" + encodeURIComponent(ss.getId()) : ""
    };
    sendTemplateEmail_(ss, templateKey, clientEmail, tokens);

  } else if (templateKey === "REPAIR_QUOTE_REQUEST") {
    var location = getCellByHeader_(rowData, map, "Location") || invLookup ? invLookup.location : "" || "-";
    var sidemark = getCellByHeader_(rowData, map, "Sidemark") || invLookup ? invLookup.sidemark : "" || "-";
    tokens = {
      "{{ITEM_ID}}": itemId, "{{CLIENT_NAME}}": clientName,
      "{{DESCRIPTION}}": desc, "{{LOCATION}}": location,
      "{{SIDEMARK}}": sidemark, "{{ITEM_TABLE_HTML}}": itemTableHtml
    };
    sendTemplateEmail_(ss, templateKey, staffEmails, tokens);
  }

  ui.alert("Email re-sent: " + emailTypes[choice - 1] + "\nItem: " + itemId);
}

/* ============================================================
   DATE FORMAT HELPER
   ============================================================ */

function formatDateShort_(v) {
  if (!v) return "";
  var d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "MM/dd/yy");
}

/* ============================================================
   TEST SEND EMAILS & DOCS
   ============================================================ */

function StrideTestSendAll() {
  var ss = SpreadsheetApp.getActive();
  var clientEmail = getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_EMAIL) || "";
  var clientName = getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_NAME) || "Test Client";

  var html = '' +
    '<style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;margin:0;padding:16px;color:#1E293B;}' +
    'h2{margin:0 0 8px;font-size:16px;}' +
    'input[type=text]{width:100%;padding:8px;border:1px solid #CBD5E1;border-radius:6px;font-size:13px;box-sizing:border-box;}' +
    '.btn{padding:10px 20px;border:none;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;}' +
    '.btn-primary{background:#E85D2D;color:#fff;}.btn-primary:hover{background:#D4501F;}' +
    '.btn-secondary{background:#E2E8F0;color:#1E293B;}' +
    '.group{margin:12px 0;padding:10px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;}' +
    '.group h3{margin:0 0 6px;font-size:12px;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;}' +
    'label{display:block;font-size:12px;padding:2px 0;cursor:pointer;}' +
    'label input{margin-right:6px;}' +
    '#status{margin-top:10px;font-size:12px;color:#64748B;min-height:20px;}' +
    '.ok{color:#16A34A;font-weight:700;}.err{color:#DC2626;font-weight:700;}' +
    '.spinner{display:inline-block;width:14px;height:14px;border:2px solid #E2E8F0;border-top:2px solid #E85D2D;border-radius:50%;animation:spin 0.8s linear infinite;vertical-align:middle;margin-right:6px;}' +
    '@keyframes spin{to{transform:rotate(360deg)}}' +
    '</style>' +
    '<h2>Test Send Emails & Docs</h2>' +
    '<p style="font-size:11px;color:#64748B;margin:0 0 10px;">Sends all templates with sample data to the email below. No real data is changed.</p>' +
    '<label style="font-size:12px;font-weight:700;margin-bottom:4px;">Send To:</label>' +
    '<input type="text" id="email" value="' + clientEmail + '" />' +
    '<div class="group"><h3>Emails</h3>' +
    '<label><input type="checkbox" class="tmpl" value="INSP_EMAIL" checked> Inspection Report</label>' +
    '<label><input type="checkbox" class="tmpl" value="TASK_COMPLETE" checked> Task Complete</label>' +
    '<label><input type="checkbox" class="tmpl" value="REPAIR_QUOTE_REQUEST" checked> Repair Quote Request</label>' +
    '<label><input type="checkbox" class="tmpl" value="REPAIR_QUOTE" checked> Repair Quote</label>' +
    '<label><input type="checkbox" class="tmpl" value="REPAIR_APPROVED" checked> Repair Approved</label>' +
    '<label><input type="checkbox" class="tmpl" value="REPAIR_DECLINED" checked> Repair Declined</label>' +
    '<label><input type="checkbox" class="tmpl" value="REPAIR_COMPLETE" checked> Repair Complete</label>' +
    '<label><input type="checkbox" class="tmpl" value="SHIPMENT_RECEIVED" checked> Shipment Received</label>' +
    '<label><input type="checkbox" class="tmpl" value="WILL_CALL_CREATED" checked> Will Call Created</label>' +
    '<label><input type="checkbox" class="tmpl" value="WILL_CALL_RELEASE" checked> Will Call Release</label>' +
    '<label><input type="checkbox" class="tmpl" value="WILL_CALL_CANCELLED" checked> Will Call Cancelled</label>' +
    '<label><input type="checkbox" class="tmpl" value="WELCOME_EMAIL" checked> Welcome Email</label>' +
    '</div>' +
    '<div class="group"><h3>Document PDFs (attached to email)</h3>' +
    '<label><input type="checkbox" class="tmpl" value="DOC_RECEIVING" checked> Receiving Document</label>' +
    '<label><input type="checkbox" class="tmpl" value="DOC_TASK_WORK_ORDER" checked> Task Work Order</label>' +
    '<label><input type="checkbox" class="tmpl" value="DOC_REPAIR_WORK_ORDER" checked> Repair Work Order</label>' +
    '<label><input type="checkbox" class="tmpl" value="DOC_WILL_CALL_RELEASE" checked> Will Call Release</label>' +
    '</div>' +
    '<div style="margin-top:10px;">' +
    '<label><input type="checkbox" id="selAll" checked onchange="toggleAll(this.checked)"> <b>Select All</b></label>' +
    '</div>' +
    '<div style="margin-top:12px;text-align:right;">' +
    '<button class="btn btn-secondary" onclick="google.script.host.close()">Cancel</button> ' +
    '<button class="btn btn-primary" id="sendBtn" onclick="sendTests()">Send Tests</button>' +
    '</div>' +
    '<div id="status"></div>' +
    '<script>' +
    'function toggleAll(c){var boxes=document.querySelectorAll(".tmpl");for(var i=0;i<boxes.length;i++)boxes[i].checked=c;}' +
    'function sendTests(){' +
    '  var email=document.getElementById("email").value.trim();' +
    '  if(!email||email.indexOf("@")===-1){alert("Enter a valid email.");return;}' +
    '  var boxes=document.querySelectorAll(".tmpl:checked");' +
    '  var selected=[];for(var i=0;i<boxes.length;i++)selected.push(boxes[i].value);' +
    '  if(!selected.length){alert("Select at least one template.");return;}' +
    '  document.getElementById("sendBtn").disabled=true;' +
    '  document.getElementById("status").innerHTML="<span class=\\"spinner\\"></span> Sending " + selected.length + " test emails...";' +
    '  google.script.run.withSuccessHandler(function(r){' +
    '    if(r.error){document.getElementById("status").innerHTML="<span class=\\"err\\">Error: "+r.error+"</span>";document.getElementById("sendBtn").disabled=false;return;}' +
    '    var h="<div class=\\"ok\\">Done!</div><div style=\\"margin-top:6px;font-size:11px;\\">";' +
    '    for(var i=0;i<r.results.length;i++){' +
    '      var x=r.results[i];' +
    '      h+="<div>"+(x.ok?"<span class=\\"ok\\">✓</span> ":"<span class=\\"err\\">✗</span> ")+x.key+(x.ok?"":" — "+x.err)+"</div>";' +
    '    }' +
    '    h+="</div>";' +
    '    document.getElementById("status").innerHTML=h;' +
    '    document.getElementById("sendBtn").disabled=false;' +
    '  }).withFailureHandler(function(err){' +
    '    document.getElementById("status").innerHTML="<span class=\\"err\\">Error: "+err.message+"</span>";' +
    '    document.getElementById("sendBtn").disabled=false;' +
    '  }).testSendAllTemplatesCallback(email,selected);' +
    '}' +
    '</script>';

  var dialog = HtmlService.createHtmlOutput(html).setWidth(480).setHeight(580).setTitle("Test Send Emails & Docs");
  SpreadsheetApp.getUi().showModalDialog(dialog, "Test Send Emails & Docs");
}

/**
 * Server-side: sends selected test templates to the given email.
 */
function testSendAllTemplatesCallback(testEmail, selectedKeys) {
  try {
    var ss = SpreadsheetApp.getActive();
    var clientName = getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_NAME) || "Test Client";
    var logoUrl = getSetting_(ss, "LOGO_URL") || "";
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MM/dd/yyyy");

    // Sample item table HTML used across multiple templates
    var sampleItemTable = '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-size:12px;">' +
      '<tr style="background:#F1F5F9;"><th>Item ID</th><th>Qty</th><th>Vendor</th><th>Description</th><th>Class</th><th>Location</th><th>Sidemark</th></tr>' +
      '<tr><td>TEST-12345</td><td>1</td><td>TEST VENDOR</td><td>Sample Furniture — Dining Table</td><td>M</td><td>A1.1</td><td>SAMPLE</td></tr></table>';

    var sampleWcItemsTable = '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-size:12px;">' +
      '<tr style="background:#F1F5F9;"><th>#</th><th>Item ID</th><th>Qty</th><th>Vendor</th><th>Description</th><th>Class</th><th>Location</th><th>Sidemark</th></tr>' +
      '<tr><td>1</td><td>TEST-12345</td><td>1</td><td>TEST VENDOR</td><td>Sample Furniture</td><td>M</td><td>A1.1</td><td>SAMPLE</td></tr></table>';

    // Token maps for each email template
    var tokenMaps = {
      "INSP_EMAIL": {
        "{{ITEM_ID}}": "TEST-12345", "{{CLIENT_NAME}}": clientName, "{{SHIPMENT_NO}}": "SHP-TEST-001",
        "{{RESULT}}": "Pass", "{{TASK_TYPE}}": "Inspection", "{{SVC_NAME}}": "Inspection",
        "{{TASK_NOTES}}": "Item inspected — no damage found.", "{{DESCRIPTION}}": "Sample Furniture — Dining Table",
        "{{ITEM_TABLE_HTML}}": sampleItemTable, "{{PHOTOS_URL}}": "", "{{RESULT_COLOR}}": "#16A34A",
        "{{REPAIR_NOTE}}": ""
      },
      "TASK_COMPLETE": {
        "{{ITEM_ID}}": "TEST-12345", "{{CLIENT_NAME}}": clientName, "{{SHIPMENT_NO}}": "SHP-TEST-001",
        "{{RESULT}}": "Complete", "{{TASK_TYPE}}": "Assembly", "{{SVC_NAME}}": "Assembly",
        "{{TASK_NOTES}}": "Assembly completed successfully.", "{{DESCRIPTION}}": "Sample Furniture — Dining Table",
        "{{ITEM_TABLE_HTML}}": sampleItemTable, "{{PHOTOS_URL}}": "", "{{RESULT_COLOR}}": "#16A34A",
        "{{REPAIR_NOTE}}": ""
      },
      "REPAIR_QUOTE_REQUEST": {
        "{{ITEM_ID}}": "TEST-12345", "{{CLIENT_NAME}}": clientName, "{{DESCRIPTION}}": "Sample Furniture — Dining Table",
        "{{LOCATION}}": "A1.1", "{{SIDEMARK}}": "SAMPLE", "{{ITEM_TABLE_HTML}}": sampleItemTable,
        "{{PHOTOS_URL}}": ""
      },
      "REPAIR_QUOTE": {
        "{{ITEM_ID}}": "TEST-12345", "{{CLIENT_NAME}}": clientName, "{{DESCRIPTION}}": "Sample Furniture — Dining Table",
        "{{ITEM_TABLE_HTML}}": sampleItemTable, "{{TASK_NOTES}}": "Scratched surface needs refinishing.",
        "{{QUOTE_AMOUNT}}": "$25.00", "{{REPAIR_ID}}": "RPR-TEST-001", "{{REPAIR_VENDOR}}": "Test Repair Co",
        "{{NOTES}}": "Estimated 2-3 business days.", "{{PHOTOS_URL}}": "", "{{PHOTOS_BUTTON}}": ""
      },
      "REPAIR_APPROVED": {
        "{{ITEM_ID}}": "TEST-12345", "{{CLIENT_NAME}}": clientName, "{{REPAIR_ID}}": "RPR-TEST-001",
        "{{QUOTE_AMOUNT}}": "25.00", "{{LOCATION}}": "A1.1", "{{SIDEMARK}}": "SAMPLE",
        "{{ITEM_TABLE_HTML}}": sampleItemTable
      },
      "REPAIR_DECLINED": {
        "{{ITEM_ID}}": "TEST-12345", "{{CLIENT_NAME}}": clientName, "{{REPAIR_ID}}": "RPR-TEST-001",
        "{{QUOTE_AMOUNT}}": "25.00", "{{LOCATION}}": "A1.1", "{{SIDEMARK}}": "SAMPLE",
        "{{ITEM_TABLE_HTML}}": sampleItemTable
      },
      "REPAIR_COMPLETE": {
        "{{ITEM_ID}}": "TEST-12345", "{{CLIENT_NAME}}": clientName, "{{DESCRIPTION}}": "Sample Furniture — Dining Table",
        "{{ITEM_TABLE_HTML}}": sampleItemTable, "{{REPAIR_RESULT}}": "Complete",
        "{{REPAIR_RESULT_COLOR}}": "#16A34A", "{{COMPLETED_DATE}}": today,
        "{{QUOTE_AMOUNT}}": "$25.00", "{{FINAL_AMOUNT}}": "$25.00", "{{REPAIR_VENDOR}}": "Test Repair Co",
        "{{PARTS_COST}}": "$10.00", "{{LABOR_HOURS}}": "1.5", "{{REPAIR_PHOTOS_URL}}": "",
        "{{REPAIR_ID}}": "RPR-TEST-001", "{{NOTES}}": "Repair completed — surface refinished."
      },
      "SHIPMENT_RECEIVED": {
        "{{SHIPMENT_NO}}": "SHP-TEST-001", "{{ITEM_COUNT}}": "3", "{{CARRIER}}": "UPS",
        "{{TRACKING}}": "1Z999AA10123456784", "{{PHOTOS_URL}}": "", "{{CLIENT_NAME}}": clientName,
        "{{RECEIVED_DATE}}": today, "{{ITEMS_TABLE}}": sampleItemTable, "{{SHIPMENT_NOTES}}": "Test shipment — all items in good condition."
      },
      "WILL_CALL_CREATED": {
        "{{WC_NUMBER}}": "WC-TEST-001", "{{CLIENT_NAME}}": clientName, "{{PICKUP_PARTY}}": "Test Delivery Co",
        "{{PICKUP_PHONE}}": "206-555-0100", "{{REQUESTED_BY}}": "JT", "{{EST_PICKUP_DATE}}": today,
        "{{NOTES}}": "Please call before delivery.", "{{ITEMS_TABLE}}": sampleWcItemsTable,
        "{{ITEMS_COUNT}}": "1", "{{TOTAL_WC_FEE}}": "$13.50", "{{STATUS}}": "Scheduled",
        "{{COD}}": "No", "{{CREATED_DATE}}": today, "{{CREATED_BY}}": "Test User",
        "{{PHOTOS_URL}}": ""
      },
      "WILL_CALL_RELEASE": {
        "{{WC_NUMBER}}": "WC-TEST-001", "{{CLIENT_NAME}}": clientName, "{{PICKUP_PARTY}}": "Test Delivery Co",
        "{{PICKUP_DATE}}": today, "{{ITEMS_TABLE}}": sampleWcItemsTable, "{{ITEMS_COUNT}}": "1",
        "{{PHOTOS_URL}}": "", "{{PARTIAL_NOTE}}": "", "{{NOTES}}": ""
      },
      "WILL_CALL_CANCELLED": {
        "{{WC_NUMBER}}": "WC-TEST-001", "{{CLIENT_NAME}}": clientName,
        "{{ITEMS_TABLE}}": sampleWcItemsTable, "{{ITEMS_COUNT}}": "1", "{{CANCEL_DATE}}": today
      }
    };

    // Doc token maps
    var docTokenMaps = {
      "DOC_RECEIVING": {
        "{{LOGO_URL}}": logoUrl, "{{SHIPMENT_NO}}": "SHP-TEST-001", "{{RECEIVED_DATE}}": today,
        "{{CARRIER}}": "UPS", "{{TRACKING}}": "1Z999AA10123456784", "{{ITEM_COUNT}}": "1",
        "{{CLIENT_NAME}}": clientName, "{{CLIENT_EMAIL_HTML}}": "<div style='font-size:11px;color:#64748B;'>test@example.com</div>",
        "{{SHIPMENT_NOTES_HTML}}": "", "{{TOTAL_ITEMS}}": "1",
        "{{ITEMS_TABLE_ROWS}}": "<tr><td style='padding:6px;text-align:center;border-bottom:1px solid #E2E8F0;'>1</td><td style='padding:6px;border-bottom:1px solid #E2E8F0;font-weight:700;'>TEST-12345</td><td style='padding:6px;text-align:center;border-bottom:1px solid #E2E8F0;'>1</td><td style='padding:6px;border-bottom:1px solid #E2E8F0;'>TEST VENDOR</td><td style='padding:6px;border-bottom:1px solid #E2E8F0;'>Sample Furniture</td><td style='padding:6px;text-align:center;border-bottom:1px solid #E2E8F0;'>M</td><td style='padding:6px;border-bottom:1px solid #E2E8F0;'>A1.1</td><td style='padding:6px;border-bottom:1px solid #E2E8F0;'>SAMPLE</td><td style='padding:6px;border-bottom:1px solid #E2E8F0;'>-</td></tr>"
      },
      "DOC_TASK_WORK_ORDER": {
        "{{LOGO_URL}}": logoUrl, "{{TASK_ID}}": "TSK-TEST-001", "{{CLIENT_NAME}}": clientName,
        "{{SIDEMARK_ROW}}": "", "{{DATE}}": today, "{{STATUS}}": "Open",
        "{{TASK_TYPE}}": "Assembly", "{{NOTES_ROW}}": "<tr><td style='font-size:10px;color:#64748B;padding:2px 0;width:100px;font-weight:700;'>Notes</td><td style='font-size:12px;'>Assemble dining table per manufacturer instructions.</td></tr>",
        "{{PHOTOS_ROW}}": "", "{{ITEM_ID}}": "TEST-12345", "{{ITEM_QTY}}": "1",
        "{{ITEM_VENDOR}}": "TEST VENDOR", "{{ITEM_DESC}}": "Sample Furniture — Dining Table",
        "{{ITEM_SIDEMARK}}": "SAMPLE", "{{ITEM_ROOM}}": "",
        "{{RESULT_OPTIONS_HTML}}": "<span style='display:inline-block;margin-right:16px;font-size:11px;'><span style='display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;'></span> Pass</span><span style='display:inline-block;margin-right:16px;font-size:11px;'><span style='display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;'></span> Fail</span><span style='display:inline-block;margin-right:16px;font-size:11px;'><span style='display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;'></span> Needs Repair</span><span style='display:inline-block;font-size:11px;'><span style='display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;'></span> Other</span>"
      },
      "DOC_REPAIR_WORK_ORDER": {
        "{{LOGO_URL}}": logoUrl, "{{REPAIR_ID}}": "RPR-TEST-001", "{{CLIENT_NAME}}": clientName,
        "{{SIDEMARK_ROW}}": "<tr><td style='font-size:10px;color:#64748B;padding:2px 0;width:80px;font-weight:700;'>SIDEMARK</td><td style='font-size:12px;'>SAMPLE</td></tr>",
        "{{DATE}}": today, "{{STATUS}}": "Approved",
        "{{REPAIR_TYPE}}": "Surface Refinishing", "{{APPROVED_ROW}}": "<tr><td style='font-size:10px;color:#64748B;padding:2px 0;width:100px;font-weight:700;'>Approved Amount</td><td style='font-size:12px;font-weight:700;'>$25.00</td></tr>",
        "{{NOTES_ROW}}": "<tr><td style='font-size:10px;color:#64748B;padding:2px 0;width:100px;font-weight:700;'>Notes</td><td style='font-size:12px;'>Scratched surface needs refinishing.</td></tr>",
        "{{PHOTOS_ROW}}": "", "{{ITEM_ID}}": "TEST-12345", "{{ITEM_QTY}}": "1",
        "{{ITEM_VENDOR}}": "TEST VENDOR", "{{ITEM_DESC}}": "Sample Furniture — Dining Table",
        "{{ITEM_SIDEMARK}}": "SAMPLE", "{{ITEM_ROOM}}": "",
        "{{RESULT_OPTIONS_HTML}}": "<span style='display:inline-block;margin-right:16px;font-size:11px;'><span style='display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;'></span> Complete</span><span style='display:inline-block;margin-right:16px;font-size:11px;'><span style='display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;'></span> Partial</span><span style='display:inline-block;margin-right:16px;font-size:11px;'><span style='display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;'></span> Unable to Repair</span><span style='display:inline-block;font-size:11px;'><span style='display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;'></span> Other</span>"
      },
      "DOC_WILL_CALL_RELEASE": {
        "{{LOGO_URL}}": logoUrl, "{{WC_NUMBER}}": "WC-TEST-001", "{{COD_BANNER_HTML}}": "<div style='background:#FEF2F2;border:2px solid #DC2626;border-radius:6px;padding:10px 14px;margin-bottom:10px;text-align:center;'><span style='font-size:16px;font-weight:900;color:#DC2626;letter-spacing:1px;'>COD - PAYMENT DUE AT PICKUP: $25.00</span></div>",
        "{{CLIENT_NAME}}": clientName, "{{DATE}}": today,
        "{{EST_PICKUP_ROW}}": "<tr><td style='font-size:10px;color:#64748B;padding:2px 0;'>Est. Pickup</td><td style='font-size:12px;font-weight:700;'>" + today + "</td></tr>",
        "{{REQUESTED_BY_ROW}}": "<tr><td style='font-size:10px;color:#64748B;padding:2px 0;'>Requested By</td><td style='font-size:12px;'>JT</td></tr>",
        "{{ITEM_COUNT}}": "1", "{{PICKUP_PARTY}}": "Test Delivery Co",
        "{{PICKUP_PHONE_HTML}}": "<div style='font-size:11px;color:#64748B;'>206-555-0100</div>",
        "{{NOTES_HTML}}": "<div style='background:#FFFBEB;border:1px solid #F59E0B;border-radius:6px;padding:8px 12px;margin-bottom:10px;'><div style='font-size:9px;color:#92400E;font-weight:800;text-transform:uppercase;margin-bottom:2px;'>Notes</div><div style='font-size:11px;color:#78350F;'>Please call before delivery.</div></div>",
        "{{TOTAL_ITEMS}}": "1",
        "{{ITEMS_TABLE_ROWS}}": "<tr><td style='padding:6px;text-align:center;border-bottom:1px solid #E2E8F0;'>1</td><td style='padding:6px;border-bottom:1px solid #E2E8F0;font-weight:700;'>TEST-12345</td><td style='padding:6px;text-align:center;border-bottom:1px solid #E2E8F0;'>1</td><td style='padding:6px;border-bottom:1px solid #E2E8F0;'>TEST VENDOR</td><td style='padding:6px;border-bottom:1px solid #E2E8F0;'>Sample Furniture</td><td style='padding:6px;text-align:center;border-bottom:1px solid #E2E8F0;'>M</td><td style='padding:6px;border-bottom:1px solid #E2E8F0;'>A1.1</td><td style='padding:6px;border-bottom:1px solid #E2E8F0;'>SAMPLE</td></tr>"
      }
    };

    var results = [];

    for (var k = 0; k < selectedKeys.length; k++) {
      var key = selectedKeys[k];
      try {
        if (key.indexOf("DOC_") === 0) {
          // Generate doc PDF and send as attachment
          var docTokens = docTokenMaps[key] || {};
          var templateResult = getDocTemplateHtml_(ss, key);
          var docHtml = templateResult ? templateResult.html : getDefaultDocHtml_(key);
          if (!docHtml) { results.push({ key: key, ok: false, err: "No template found" }); continue; }
          docHtml = resolveDocTokens_(docHtml, docTokens);
          var docTitle = "TEST_" + key;
          var docId = createGoogleDocFromHtml_(docTitle, docHtml);
          var pdfBlob = exportDocAsPdfBlob_(docId, docTitle + ".pdf", 0.25);
          // Clean up temp doc
          try { DriveApp.getFileById(docId).setTrashed(true); } catch(_) {}
          // Send email with PDF attached
          GmailApp.sendEmail(testEmail, "[TEST] " + key.replace(/_/g, " "), "", {
            htmlBody: "<p>Test document PDF attached: <b>" + key + "</b></p><p>Generated: " + today + "</p><p>Client: " + clientName + "</p>",
            attachments: [pdfBlob],
            from: "whse@stridenw.com"
          });
          results.push({ key: key, ok: true });
        } else if (key === "WELCOME_EMAIL") {
          // Send welcome email directly to test address
          var welcomeHtml = "";
          try {
            var wTmpl = getDocTemplateHtml_(ss, "WELCOME_EMAIL");
            if (wTmpl && wTmpl.html) welcomeHtml = wTmpl.html;
          } catch (_) {}
          if (!welcomeHtml) welcomeHtml = getDefaultWelcomeHtml_();
          var wTokens = { "{{CLIENT_NAME}}": clientName, "{{SPREADSHEET_URL}}": ss.getUrl() || "#", "{{CLIENT_EMAIL}}": testEmail, "{{APP_URL}}": "https://www.mystridehub.com" };
          var wEntries = Object.entries(wTokens);
          var wSubject = "Welcome to Stride Warehouse Management — " + clientName;
          for (var w = 0; w < wEntries.length; w++) {
            wSubject = wSubject.split(wEntries[w][0]).join(String(wEntries[w][1] || ""));
            welcomeHtml = welcomeHtml.split(wEntries[w][0]).join(String(wEntries[w][1] || ""));
          }
          GmailApp.sendEmail(testEmail, "[TEST] " + wSubject, "", { htmlBody: welcomeHtml });
          results.push({ key: key, ok: true });
        } else {
          // Send email template with sample tokens
          var tokens = tokenMaps[key] || {};
          // Override recipients — send to test email only
          sendTemplateEmail_(ss, key, testEmail, tokens);
          results.push({ key: key, ok: true });
        }
      } catch (err) {
        results.push({ key: key, ok: false, err: String(err.message || err).substring(0, 120) });
      }
    }

    return { results: results };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

/* ============================================================
   WELCOME EMAIL — v3.0.1
   Sent to clients after onboarding. Branded HTML with tips on
   using the Stride Client menu. Template stored in
   Email_Templates as WELCOME_EMAIL for easy updates.
   ============================================================ */

function getDefaultWelcomeHtml_() {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;">' +
    '<div style="max-width:600px;margin:0 auto;background:#ffffff;">' +
    // --- Header ---
    '<div style="background:#1E293B;padding:24px 32px;text-align:center;">' +
    '<div style="display:inline-block;vertical-align:middle;">' +
    '<span style="font-size:26px;font-weight:bold;color:#ffffff;">Stride Logistics </span>' +
    '<span style="font-size:26px;font-weight:bold;color:#E85D2D;">WMS</span>' +
    '</div>' +
    '<div style="font-size:12px;color:#94A3B8;margin-top:6px;">Warehouse Management System</div>' +
    '</div>' +
    // --- Welcome Banner ---
    '<div style="background:#E85D2D;padding:20px 32px;text-align:center;">' +
    '<div style="font-size:22px;font-weight:bold;color:#ffffff;">Welcome, {{CLIENT_NAME}}!</div>' +
    '<div style="font-size:14px;color:#FFD4C4;margin-top:6px;">Your inventory management portal is ready to go.</div>' +
    '</div>' +
    // --- Body ---
    '<div style="padding:28px 32px;">' +
    '<p style="font-size:14px;color:#1E293B;line-height:1.6;margin:0 0 20px;">Your Stride Hub account has been set up. You can view your inventory, shipments, tasks, repairs, and will calls anytime from your browser or phone.</p>' +
    // --- Getting Started ---
    '<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:16px 20px;margin:0 0 20px;">' +
    '<div style="font-size:15px;font-weight:bold;color:#1D4ED8;margin:0 0 10px;">Getting Started</div>' +
    '<ol style="margin:0;padding-left:20px;font-size:13px;color:#1E293B;line-height:1.8;">' +
    '<li>Go to <a href="https://www.mystridehub.com" style="color:#E85D2D;font-weight:bold;">www.mystridehub.com</a></li>' +
    '<li>Your username is <b>this email address</b> (the one receiving this email)</li>' +
    '<li>Click <b>"Forgot Password"</b> on the login page</li>' +
    '<li>Check your inbox for the password reset link</li>' +
    '<li>Create your password and log in</li>' +
    '</ol>' +
    '</div>' +
    // --- Open Stride Hub Button ---
    '<div style="text-align:center;margin:0 0 28px;">' +
    '<a href="https://www.mystridehub.com" style="display:inline-block;background:#E85D2D;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:15px;font-weight:bold;">Open Stride Hub</a>' +
    '</div>' +
    // --- Divider ---
    '<div style="border-top:2px solid #E2E8F0;margin:0 0 24px;"></div>' +
    '<div style="font-size:16px;font-weight:bold;color:#1E293B;margin:0 0 16px;">What You Can Do</div>' +
    // --- Tip 1: View Inventory ---
    '<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:16px 20px;margin:0 0 12px;">' +
    '<div style="font-size:14px;font-weight:bold;color:#E85D2D;margin:0 0 6px;">View Your Inventory</div>' +
    '<div style="font-size:13px;color:#475569;line-height:1.5;">See all items in storage with full search, sorting, and filtering. Click any item to view details, photos, and history.</div>' +
    '</div>' +
    // --- Tip 2: Track Shipments ---
    '<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:16px 20px;margin:0 0 12px;">' +
    '<div style="font-size:14px;font-weight:bold;color:#E85D2D;margin:0 0 6px;">Track Shipments</div>' +
    '<div style="font-size:13px;color:#475569;line-height:1.5;">View all incoming shipments with carrier, tracking, and item details. Photos are linked directly from each shipment.</div>' +
    '</div>' +
    // --- Tip 3: Request Services ---
    '<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:16px 20px;margin:0 0 12px;">' +
    '<div style="font-size:14px;font-weight:bold;color:#E85D2D;margin:0 0 6px;">Request Inspections &amp; Repairs</div>' +
    '<div style="font-size:13px;color:#475569;line-height:1.5;">Select items and request inspections or repair quotes directly from the app. You will receive email updates as work progresses.</div>' +
    '</div>' +
    // --- Tip 4: Will Calls ---
    '<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:16px 20px;margin:0 0 12px;">' +
    '<div style="font-size:14px;font-weight:bold;color:#E85D2D;margin:0 0 6px;">Schedule Will Calls</div>' +
    '<div style="font-size:13px;color:#475569;line-height:1.5;">Create will calls to schedule item pickups. Add or remove items as needed before the pickup date.</div>' +
    '</div>' +
    // --- What to Expect ---
    '<div style="border-top:2px solid #E2E8F0;margin:24px 0 20px;"></div>' +
    '<div style="font-size:16px;font-weight:bold;color:#1E293B;margin:0 0 12px;">What to Expect</div>' +
    '<div style="font-size:13px;color:#475569;line-height:1.7;margin:0 0 20px;">' +
    '&bull; You will receive <b>email notifications</b> when shipments arrive, inspections are completed, repair quotes are ready, and items are released.<br>' +
    '&bull; Each email includes a <b>View in Stride Hub</b> button that takes you directly to the relevant page.<br>' +
    '&bull; Your data updates in <b>real time</b> &mdash; use the refresh button on any page to pull the latest.' +
    '</div>' +
    // --- Contact ---
    '<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:16px 20px;text-align:center;">' +
    '<div style="font-size:14px;font-weight:bold;color:#1E293B;margin:0 0 6px;">Questions?</div>' +
    '<div style="font-size:13px;color:#475569;">Contact us anytime at <a href="mailto:whse@stridenw.com" style="color:#E85D2D;font-weight:bold;text-decoration:none;">whse@stridenw.com</a> or call <b>206-550-1848</b></div>' +
    '</div>' +
    '</div>' +
    // --- Footer ---
    '<div style="background:#1E293B;padding:16px 32px;text-align:center;">' +
    '<div style="font-size:11px;color:#94A3B8;">Stride Logistics &middot; Kent, WA &middot; 206-550-1848</div>' +
    '<div style="font-size:10px;color:#64748B;margin-top:4px;">This is an automated message from Stride Warehouse Management System</div>' +
    '</div>' +
    '</div>' +
    '</body></html>';
}

/**
 * Sends a welcome email to the client after onboarding.
 * Tries WELCOME_EMAIL template from Email_Templates first, falls back to default.
 * @param {Spreadsheet} ss  The client spreadsheet
 */
function StrideSendWelcomeEmail() {
  var ss = SpreadsheetApp.getActive();
  sendWelcomeEmail_(ss);
  safeAlert_("Welcome email sent to " + (getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_EMAIL) || "client") + ".");
}

function sendWelcomeEmail_(ss) {
  var clientName = getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_NAME) || "Valued Client";
  var clientEmail = getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_EMAIL) || "";
  if (!clientEmail) {
    Logger.log("[WELCOME_EMAIL] No CLIENT_EMAIL in Settings — skipping welcome email.");
    return;
  }

  var subject = "Welcome to Stride Warehouse Management — " + clientName;
  var htmlBody = "";

  // Try to load from Email_Templates on master
  try {
    var tmpl = getDocTemplateHtml_(ss, "WELCOME_EMAIL");
    if (tmpl && tmpl.html) {
      htmlBody = tmpl.html;
      if (tmpl.title) subject = tmpl.title;
    }
  } catch (err) {
    Logger.log("[WELCOME_EMAIL] Template lookup failed: " + err);
  }

  // Fallback to default
  if (!htmlBody) {
    htmlBody = getDefaultWelcomeHtml_();
  }

  // Resolve recipients from template
  var staffEmails = getSetting_(ss, CI_SETTINGS_KEYS.NOTIFICATION_EMAILS) || "";
  var toEmails = clientEmail;
  if (tmpl && tmpl.recipients) {
    toEmails = tmpl.recipients
      .replace(/\{\{STAFF_EMAILS\}\}/gi, staffEmails)
      .replace(/\{\{CLIENT_EMAIL\}\}/gi, clientEmail)
      .replace(/^[,\s]+|[,\s]+$/g, "");
  }
  if (!toEmails) toEmails = clientEmail;

  // Resolve tokens — v4.2.0 adds {{APP_URL}} for parity with
  // StrideAPI.gs handleSendWelcomeEmail_. Master templates now use
  // {{APP_URL}} for the login CTA instead of {{SPREADSHEET_URL}}.
  var tokens = {
    "{{CLIENT_NAME}}": clientName,
    "{{SPREADSHEET_URL}}": ss.getUrl() || "#",
    "{{CLIENT_EMAIL}}": clientEmail,
    "{{APP_URL}}": "https://www.mystridehub.com"
  };
  var entries = Object.entries(tokens);
  for (var j = 0; j < entries.length; j++) {
    subject = subject.split(entries[j][0]).join(String(entries[j][1] || ""));
    htmlBody = htmlBody.split(entries[j][0]).join(String(entries[j][1] || ""));
  }

  try {
    GmailApp.sendEmail(toEmails, subject, "", {
      htmlBody: htmlBody
    });
    Logger.log("[WELCOME_EMAIL] Sent to " + toEmails + " for " + clientName);
  } catch (err) {
    Logger.log("[WELCOME_EMAIL] Send failed: " + err);
  }
}
