/**
 * ============================================================================
 * STRIDE DESIGNER CAMPAIGN v2
 * Multi-campaign email management system for Stride Logistics
 * Gmail + Google Apps Script + Google Sheets
 * ============================================================================
 *
 * Supports:
 *  - One-shot "Blast" campaigns
 *  - Multi-step "Sequence" campaigns with follow-ups (up to 3)
 *  - Multiple simultaneous campaigns with priority + conflict resolution
 *  - Global suppression, bounce/unsubscribe detection, daily digest
 *
 * Hard Rules:
 *  1. One active sequence per contact at a time
 *  2. No contact receives more than one campaign email in 24 hours
 *  3. Blasts do not bypass suppression
 *  4. Bounces/unsubscribes = global suppression
 *  5. Replies = global suppression in v1
 *  6. Exhausted is campaign-specific only
 *  7. All sends create Campaign Contacts row AND Campaign Log row
 *  8. Campaign Contacts row created at enrollment, not just after send
 *  9. Quota checked before each run
 * 10. Activation validates everything
 */

// ============================================================================
// SOURCE SPREADSHEET IDs
// ============================================================================
var ARCHITECTS_SHEET_ID = '12cPe6-rI1knUwRJ1dxkGPH2Getiaiix4TQg0qcaO3aw';
var MAILING_LIST_SHEET_ID = '1jahMRsoCPaAwTXp5OQNoxtmcXQSb-z69Z8-kjdHw7Bk';

// ============================================================================
// STRIDE LOGO URL
// ============================================================================
var STRIDE_LOGO_URL = 'https://static.wixstatic.com/media/a38fbc_e4bdb945b21f4b9f8b10873799e8f8f1~mv2.png';

// ============================================================================
// TAB NAMES
// ============================================================================
var TAB_CONTACTS         = 'Contacts';
var TAB_CAMPAIGNS        = 'Campaigns';
var TAB_CAMPAIGN_CONTACTS = 'Campaign Contacts';
var TAB_CAMPAIGN_LOG     = 'Campaign Log';
var TAB_TEMPLATES        = 'Templates';
var TAB_SETTINGS         = 'Settings';
var TAB_DASHBOARD        = 'Dashboard';
var TAB_SUPPRESSION_LOG  = 'Suppression Log';

// ============================================================================
// CONTACTS TAB COLUMN INDICES (0-based)
// ============================================================================
var CON_DATE_ADDED        = 0;  // A
var CON_ADDED_BY          = 1;  // B
var CON_SOURCE            = 2;  // C
var CON_FIRST_NAME        = 3;  // D
var CON_LAST_NAME         = 4;  // E
var CON_EMAIL             = 5;  // F
var CON_COMPANY           = 6;  // G
var CON_STATUS            = 7;  // H
var CON_EXISTING_CLIENT   = 8;  // I
var CON_CAMPAIGN_TAG      = 9;  // J
var CON_LAST_CAMPAIGN_DATE= 10; // K
var CON_REPLIED           = 11; // L
var CON_CONVERTED         = 12; // M
var CON_BOUNCED           = 13; // N
var CON_UNSUBSCRIBED      = 14; // O
var CON_SUPPRESSED        = 15; // P
var CON_SUPPRESSION_REASON= 16; // Q
var CON_SUPPRESSION_DATE  = 17; // R
var CON_MANUAL_RELEASE    = 18; // S
var CON_UNSUB_TOKEN       = 19; // T
var CON_NOTES             = 20; // U

var CONTACTS_HEADERS = [
  'Date Added', 'Added By', 'Source', 'First Name', 'Last Name', 'Email',
  'Company', 'Status', 'Existing Client', 'Campaign Tag',
  'Last Campaign Sent Date', 'Replied', 'Converted', 'Bounced',
  'Unsubscribed', 'Suppressed', 'Suppression Reason', 'Suppression Date',
  'Manual Release Note', 'Unsub Token', 'Notes'
];

var CONTACTS_NOTES = {
  0: 'Date this contact was added',
  1: 'Import source or user who added',
  2: 'Source list (Architects/Mailing List/Manual)',
  3: 'Contact first name',
  4: 'Contact last name',
  5: 'Contact email address (unique key)',
  6: 'Company name',
  7: 'Pending, Client, or Suppressed',
  8: 'TRUE if existing Stride client',
  9: 'Tag for targeted campaigns',
  10: 'Date of last campaign email sent',
  11: 'TRUE if contact has replied to any campaign',
  12: 'TRUE if contact converted',
  13: 'TRUE if email bounced',
  14: 'TRUE if contact unsubscribed',
  15: 'TRUE if globally suppressed',
  16: 'Reason for suppression',
  17: 'Date suppression was applied',
  18: 'Notes if manually released from suppression',
  19: 'MD5-based unsubscribe token',
  20: 'General notes'
};

// ============================================================================
// CAMPAIGNS TAB COLUMN INDICES (0-based)
// ============================================================================
var CMP_ID                = 0;  // A
var CMP_NAME              = 1;  // B
var CMP_TYPE              = 2;  // C
var CMP_STATUS            = 3;  // D
var CMP_PRIORITY          = 4;  // E
var CMP_TARGET_TYPE       = 5;  // F
var CMP_TARGET_VALUE      = 6;  // G
var CMP_ENROLLMENT_MODE   = 7;  // H
var CMP_INITIAL_TEMPLATE  = 8;  // I
var CMP_FOLLOWUP1_TPL     = 9;  // J
var CMP_FOLLOWUP2_TPL     = 10; // K
var CMP_FOLLOWUP3_TPL     = 11; // L
var CMP_MAX_FOLLOWUPS     = 12; // M
var CMP_FOLLOWUP_INTERVAL = 13; // N
var CMP_DAILY_LIMIT       = 14; // O
var CMP_SEND_START        = 15; // P
var CMP_SEND_END          = 16; // Q
var CMP_START_DATE        = 17; // R
var CMP_END_DATE          = 18; // S
var CMP_TEST_MODE         = 19; // T
var CMP_TEST_RECIPIENT    = 20; // U
var CMP_CREATED_DATE      = 21; // V
var CMP_LAST_RUN_DATE     = 22; // W
var CMP_VALIDATION_STATUS = 23; // X
var CMP_VALIDATION_NOTES  = 24; // Y
var CMP_LAST_ERROR        = 25; // Z
var CMP_TOTAL_SENT        = 26; // AA
var CMP_TOTAL_REPLIED     = 27; // AB
var CMP_TOTAL_BOUNCED     = 28; // AC
var CMP_TOTAL_UNSUB       = 29; // AD
var CMP_TOTAL_CONVERTED   = 30; // AE
var CMP_NOTES             = 31; // AF
var CMP_CUSTOM1           = 32; // AG
var CMP_CUSTOM2           = 33; // AH
var CMP_CUSTOM3           = 34; // AI

var CAMPAIGNS_HEADERS = [
  'Campaign ID', 'Campaign Name', 'Type', 'Status', 'Priority',
  'Target Type', 'Target Value', 'Enrollment Mode', 'Initial Template',
  'Follow-Up 1 Template', 'Follow-Up 2 Template', 'Follow-Up 3 Template',
  'Max Follow-Ups', 'Follow-Up Interval Days', 'Daily Send Limit',
  'Send Window Start', 'Send Window End', 'Start Date', 'End Date',
  'Test Mode', 'Test Recipient', 'Created Date', 'Last Run Date',
  'Validation Status', 'Validation Notes', 'Last Error',
  'Total Sent', 'Total Replied', 'Total Bounced', 'Total Unsubscribed',
  'Total Converted', 'Notes', 'Custom 1', 'Custom 2', 'Custom 3'
];

var CAMPAIGNS_NOTES = {
  0: 'Auto-generated: CMP-0001, CMP-0002...',
  1: 'Descriptive campaign name',
  2: 'Sequence (multi-step) or Blast (one-shot)',
  3: 'Draft, Active, Paused, or Complete',
  4: 'Lower number = higher priority',
  5: 'All Active Leads, Existing Clients, Non-Clients, Campaign Tag, Manual List',
  6: 'Value for Campaign Tag or Manual List targeting',
  7: 'Dynamic (continuously enroll new) or Snapshot (enroll once)',
  8: 'Template name for initial send',
  9: 'Template name for 1st follow-up',
  10: 'Template name for 2nd follow-up',
  11: 'Template name for 3rd follow-up',
  12: 'Number of follow-ups (0-3)',
  13: 'Days between follow-ups',
  14: 'Max emails to send per day for this campaign',
  15: 'Hour to start sending (24h, e.g. 8)',
  16: 'Hour to stop sending (24h, e.g. 17)',
  17: 'Campaign start date',
  18: 'Campaign end date (optional)',
  19: 'TRUE = sends go to Test Recipient only',
  20: 'Email address for test sends',
  21: 'Date campaign was created',
  22: 'Date of last campaign run',
  23: 'Valid or Invalid after activation check',
  24: 'Details from validation check',
  25: 'Last error encountered',
  26: 'Total emails sent',
  27: 'Total replies received',
  28: 'Total bounces',
  29: 'Total unsubscribes',
  30: 'Total conversions',
  31: 'General notes',
  32: 'Custom token 1 value for templates',
  33: 'Custom token 2 value for templates',
  34: 'Custom token 3 value for templates'
};

// ============================================================================
// CAMPAIGN CONTACTS TAB COLUMN INDICES (0-based)
// ============================================================================
var CC_CAMPAIGN_ID       = 0;  // A
var CC_CAMPAIGN_NAME     = 1;  // B
var CC_EMAIL             = 2;  // C
var CC_CONTACT_NAME      = 3;  // D
var CC_CAMPAIGN_TYPE     = 4;  // E
var CC_STATUS            = 5;  // F
var CC_CURRENT_STEP      = 6;  // G
var CC_FOLLOWUP_COUNT    = 7;  // H
var CC_LAST_CONTACT_DATE = 8;  // I
var CC_NEXT_FOLLOWUP     = 9;  // J
var CC_LAST_ATTEMPT_DATE = 10; // K
var CC_REPLIED           = 11; // L
var CC_BOUNCED           = 12; // M
var CC_UNSUBSCRIBED      = 13; // N
var CC_CONVERTED         = 14; // O
var CC_SUPPRESSED        = 15; // P
var CC_SUPPRESSION_REASON= 16; // Q
var CC_THREAD_ID         = 17; // R
var CC_MESSAGE_ID        = 18; // S
var CC_DATE_ENTERED      = 19; // T
var CC_DATE_COMPLETED    = 20; // U
var CC_COMPLETED_REASON  = 21; // V

var CAMPAIGN_CONTACTS_HEADERS = [
  'Campaign ID', 'Campaign Name', 'Contact Email', 'Contact Name',
  'Campaign Type', 'Status', 'Current Step', 'Follow-Up Count',
  'Last Contact Date', 'Next Follow-Up Date', 'Last Attempt Date',
  'Replied', 'Bounced', 'Unsubscribed', 'Converted', 'Suppressed',
  'Suppression Reason', 'Gmail Thread ID', 'Gmail Message ID',
  'Date Entered', 'Date Completed', 'Completed Reason'
];

var CAMPAIGN_CONTACTS_NOTES = {
  0: 'Campaign this contact belongs to',
  1: 'Campaign name for reference',
  2: 'Contact email address',
  3: 'Contact full name',
  4: 'Sequence or Blast',
  5: 'Pending, Sent, Follow-Up Scheduled, Replied, Bounced, Unsubscribed, Exhausted, Complete',
  6: 'Initial, Follow-Up 1, Follow-Up 2, Follow-Up 3',
  7: 'Number of follow-ups sent',
  8: 'Date of last email sent to this contact',
  9: 'Date for next scheduled follow-up',
  10: 'Date of last send attempt',
  11: 'TRUE if contact replied',
  12: 'TRUE if email bounced',
  13: 'TRUE if contact unsubscribed',
  14: 'TRUE if contact converted',
  15: 'TRUE if suppressed',
  16: 'Reason for suppression',
  17: 'Gmail thread ID for reply tracking',
  18: 'Gmail message ID',
  19: 'Date contact was enrolled in campaign',
  20: 'Date contact completed or exited campaign',
  21: 'Reason: Replied, Bounced, Unsubscribed, Exhausted, Campaign Completed'
};

// ============================================================================
// CAMPAIGN LOG TAB COLUMN INDICES (0-based)
// ============================================================================
var LOG_TIMESTAMP    = 0;  // A
var LOG_CAMPAIGN_ID  = 1;  // B
var LOG_CAMPAIGN_NAME= 2;  // C
var LOG_EMAIL        = 3;  // D
var LOG_CONTACT_NAME = 4;  // E
var LOG_COMPANY      = 5;  // F
var LOG_TEMPLATE     = 6;  // G
var LOG_STEP         = 7;  // H
var LOG_SUBJECT      = 8;  // I
var LOG_RESULT       = 9;  // J
var LOG_ERROR        = 10; // K
var LOG_TEST_MODE    = 11; // L

var CAMPAIGN_LOG_HEADERS = [
  'Timestamp', 'Campaign ID', 'Campaign Name', 'Email', 'Contact Name',
  'Company', 'Template Name', 'Email Step', 'Subject', 'Send Result',
  'Error Message', 'Test Mode Used'
];

// ============================================================================
// TEMPLATES TAB COLUMN INDICES (0-based)
// ============================================================================
var TPL_NAME     = 0; // A
var TPL_SUBJECT  = 1; // B
var TPL_PREVIEW  = 2; // C
var TPL_BODY     = 3; // D
var TPL_VERSION  = 4; // E

var TEMPLATES_HEADERS = [
  'Template Name', 'Subject Line', 'Preview Text', 'HTML Body', 'Version'
];

// ============================================================================
// SUPPRESSION LOG TAB COLUMN INDICES (0-based)
// ============================================================================
var SUP_TIMESTAMP = 0; // A
var SUP_EMAIL     = 1; // B
var SUP_FIRST     = 2; // C
var SUP_COMPANY   = 3; // D
var SUP_REASON    = 4; // E
var SUP_TRIGGERED = 5; // F

var SUPPRESSION_LOG_HEADERS = [
  'Timestamp', 'Email', 'First Name', 'Company', 'Suppression Reason', 'Triggered By'
];

// ============================================================================
// GMAIL LABELS
// ============================================================================
var GMAIL_LABELS = [
  'Stride/Campaign',
  'Stride/Campaign/Sent',
  'Stride/Campaign/Replied',
  'Stride/Campaign/Bounced',
  'Stride/Campaign/Unsubscribed',
  'Stride/Campaign/Converted',
  'Stride/Campaign/Follow-Up',
  'Stride/Campaign/Exhausted'
];

// ============================================================================
// UNSUBSCRIBE KEYWORDS
// ============================================================================
var UNSUB_KEYWORDS = [
  'unsubscribe', 'stop', 'remove me', 'opt out', 'opt-out',
  'take me off', 'no more', 'cancel subscription', 'stop emailing'
];

// ============================================================================
// TOKEN REFERENCE DATA
// ============================================================================
var TOKEN_REFERENCE = [
  ['{{First Name}}', 'Contact first name from Contacts tab'],
  ['{{Last Name}}', 'Contact last name from Contacts tab'],
  ['{{Full Name}}', 'First Name + Last Name combined'],
  ['{{Company}}', 'Contact company name'],
  ['{{Email}}', 'Contact email address'],
  ['{{BookingURL}}', 'Booking URL from Settings tab'],
  ['{{EMAIL_HASH}}', 'MD5 hash of contact email (for tracking)'],
  ['{{UNSUB_URL}}', 'Full unsubscribe URL with token'],
  ['{{Campaign Name}}', 'Name of the campaign being sent'],
  ['{{Sender Name}}', 'Sender name from Settings tab'],
  ['{{Sender Phone}}', 'Sender phone from Settings tab'],
  ['{{Sender Email}}', 'Sender email from Settings tab'],
  ['{{Website URL}}', 'Website URL from Settings tab'],
  ['{{Current Year}}', 'Current 4-digit year (e.g. 2026)'],
  ['{{Current Month}}', 'Current month name (e.g. March)'],
  ['{{Send Date}}', 'Date the email is sent (MM/DD/YYYY)'],
  ['{{Custom 1}}', 'Custom value 1 from campaign row (col AG)'],
  ['{{Custom 2}}', 'Custom value 2 from campaign row (col AH)'],
  ['{{Custom 3}}', 'Custom value 3 from campaign row (col AI)']
];


// ============================================================================
// SETUP
// ============================================================================

/**
 * Creates or verifies the "Stride Designer Campaign" spreadsheet,
 * all 8 tabs with headers and hover notes, Gmail labels, triggers,
 * default settings, token reference, and imports contacts.
 * Idempotent — safe to re-run.
 */
function setupCampaign() {
  var ss = getCampaignSheet_();

  // If no spreadsheet stored, create or find it
  if (!ss) {
    var files = DriveApp.getFilesByName('Stride Designer Campaign');
    if (files.hasNext()) {
      ss = SpreadsheetApp.open(files.next());
    } else {
      ss = SpreadsheetApp.create('Stride Designer Campaign');
    }
    PropertiesService.getScriptProperties().setProperty('CAMPAIGN_SHEET_ID', ss.getId());
  }

  // Create/verify all 8 tabs
  ensureTab_(ss, TAB_CONTACTS, CONTACTS_HEADERS, CONTACTS_NOTES);
  ensureTab_(ss, TAB_CAMPAIGNS, CAMPAIGNS_HEADERS, CAMPAIGNS_NOTES);
  ensureTab_(ss, TAB_CAMPAIGN_CONTACTS, CAMPAIGN_CONTACTS_HEADERS, CAMPAIGN_CONTACTS_NOTES);
  ensureTab_(ss, TAB_CAMPAIGN_LOG, CAMPAIGN_LOG_HEADERS, {});
  ensureTab_(ss, TAB_TEMPLATES, TEMPLATES_HEADERS, {});
  ensureTab_(ss, TAB_SETTINGS, ['Key', 'Value'], {});
  ensureTab_(ss, TAB_DASHBOARD, ['Metric'], {});
  ensureTab_(ss, TAB_SUPPRESSION_LOG, SUPPRESSION_LOG_HEADERS, {});

  // Remove default Sheet1 if it exists and there are other sheets
  var sheets = ss.getSheets();
  if (sheets.length > 1) {
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getName() === 'Sheet1') {
        ss.deleteSheet(sheets[i]);
        break;
      }
    }
  }

  // Create Gmail labels
  for (var i = 0; i < GMAIL_LABELS.length; i++) {
    ensureGmailLabel_(GMAIL_LABELS[i]);
  }

  // Install triggers (idempotent)
  installTriggers_();

  // Populate Settings defaults
  populateSettings_(ss);

  // Add token reference to Templates tab
  addTokenReference_(ss);

  // Import contacts
  importContacts();

  try {
    SpreadsheetApp.getUi().alert('Setup complete! Spreadsheet: ' + ss.getName() + '\nID: ' + ss.getId());
  } catch (e) {
    Logger.log('Setup complete! Spreadsheet: ' + ss.getName() + ' | ID: ' + ss.getId());
  }
}

/**
 * Ensures a tab exists with the correct headers and hover notes.
 * @param {SpreadsheetApp.Spreadsheet} ss - The spreadsheet.
 * @param {string} tabName - Tab name.
 * @param {string[]} headers - Header values.
 * @param {Object} notes - Map of column index to note text.
 */
function ensureTab_(ss, tabName, headers, notes) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  }

  // Set headers in row 1
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#4a86c8');
  headerRange.setFontColor('#ffffff');

  // Set hover notes
  for (var col in notes) {
    if (notes.hasOwnProperty(col)) {
      sheet.getRange(1, parseInt(col) + 1).setNote(notes[col]);
    }
  }

  // Freeze header row
  sheet.setFrozenRows(1);
}

/**
 * Ensures a Gmail label exists.
 * @param {string} labelName - The label name (e.g. "Stride/Campaign/Sent").
 */
function ensureGmailLabel_(labelName) {
  var label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    GmailApp.createLabel(labelName);
  }
}

/**
 * Installs time-based triggers for checkInbox (7:30am PT) and
 * runAllCampaigns (8:30am PT), plus onEdit. Idempotent.
 */
function installTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();
  var hasCheckInbox = false;
  var hasRunAll = false;
  var hasOnEdit = false;
  var hasOnOpen = false;

  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === 'checkInbox') hasCheckInbox = true;
    if (fn === 'runAllCampaigns') hasRunAll = true;
    if (fn === 'onEditTrigger') hasOnEdit = true;
    if (fn === 'onOpen') hasOnOpen = true;
  }

  if (!hasCheckInbox) {
    ScriptApp.newTrigger('checkInbox')
      .timeBased()
      .atHour(7)
      .nearMinute(30)
      .everyDays(1)
      .inTimezone('America/Los_Angeles')
      .create();
  }

  if (!hasRunAll) {
    ScriptApp.newTrigger('runAllCampaigns')
      .timeBased()
      .atHour(8)
      .nearMinute(30)
      .everyDays(1)
      .inTimezone('America/Los_Angeles')
      .create();
  }

  if (!hasOnEdit) {
    ScriptApp.newTrigger('onEditTrigger')
      .forSpreadsheet(getCampaignSheet_())
      .onEdit()
      .create();
  }

  if (!hasOnOpen) {
    ScriptApp.newTrigger('onOpen')
      .forSpreadsheet(getCampaignSheet_())
      .onOpen()
      .create();
    Logger.log('Trigger installed: onOpen for custom menu');
  }
}

/**
 * Populates default settings in the Settings tab.
 * @param {SpreadsheetApp.Spreadsheet} ss - The spreadsheet.
 */
function populateSettings_(ss) {
  var sheet = ss.getSheetByName(TAB_SETTINGS);
  var defaults = {
    'Daily Digest Email': 'justin@stridenw.com',
    'Booking URL': 'https://www.stridenw.com/booking-availability?ref=email',
    'Unsubscribe Base URL': '(paste deployed web app URL here)',
    'Sender Name': 'Stride Logistics',
    'Sender Phone': '(206) 550-1848',
    'Sender Email': 'info@stridenw.com',
    'Send From Email': 'SeattleReceiver@stridenw.com',
    'Website URL': 'https://www.stridenw.com'
  };

  var data = sheet.getDataRange().getValues();
  var existingKeys = {};
  for (var i = 1; i < data.length; i++) {
    existingKeys[data[i][0]] = i + 1; // row number
  }

  var keys = Object.keys(defaults);
  for (var k = 0; k < keys.length; k++) {
    var key = keys[k];
    if (!existingKeys[key]) {
      sheet.appendRow([key, defaults[key]]);
    }
  }
}

/**
 * Adds the token reference section to the Templates tab starting at row 10.
 * @param {SpreadsheetApp.Spreadsheet} ss - The spreadsheet.
 */
function addTokenReference_(ss) {
  var sheet = ss.getSheetByName(TAB_TEMPLATES);

  // Row 10: merged header
  var mergedRange = sheet.getRange(10, 1, 1, 5);
  mergedRange.merge();
  mergedRange.setValue('--- TOKEN REFERENCE ---');
  mergedRange.setFontWeight('bold');
  mergedRange.setBackground('#f4b342');
  mergedRange.setHorizontalAlignment('center');

  // Token rows starting at row 11
  for (var i = 0; i < TOKEN_REFERENCE.length; i++) {
    var row = 11 + i;
    sheet.getRange(row, 1).setValue(TOKEN_REFERENCE[i][0]);
    sheet.getRange(row, 2).setValue(TOKEN_REFERENCE[i][1]);
  }
}


// ============================================================================
// CONTACT IMPORT
// ============================================================================

/**
 * Imports contacts from Architects list and Mailing list spreadsheets.
 * Deduplicates by email. Architects list: headers row 3, data row 4+.
 * Mailing list: headers row 1, data row 2+. Col A=prospect, B=client, C=excluded.
 */
function importContacts() {
  var ss = getCampaignSheet_();
  if (!ss) {
    try { SpreadsheetApp.getUi().alert('Campaign spreadsheet not found. Run Setup first.'); } catch (e) {}
    Logger.log('Campaign spreadsheet not found. Run Setup first.');
    return;
  }

  var contactsSheet = ss.getSheetByName(TAB_CONTACTS);
  var existingData = contactsSheet.getDataRange().getValues();
  var existingEmails = {};
  for (var i = 1; i < existingData.length; i++) {
    var email = String(existingData[i][CON_EMAIL]).toLowerCase().trim();
    if (email) {
      existingEmails[email] = true;
    }
  }

  var newRows = [];
  var now = new Date();

  // --- Architects List ---
  try {
    var archSS = SpreadsheetApp.openById(ARCHITECTS_SHEET_ID);
    var archSheet = archSS.getSheets()[0];
    var archData = archSheet.getDataRange().getValues();

    // Data starts at row 4 (index 3)
    for (var r = 3; r < archData.length; r++) {
      var row = archData[r];
      var email = String(row[9] || '').toLowerCase().trim(); // Col J index 9
      if (!email || !isValidEmail_(email)) continue;
      if (existingEmails[email]) continue;

      var isExisting = String(row[10] || '').toUpperCase().trim() === 'Y'; // Col K index 10
      var firstName = capitalize_(String(row[6] || '').trim());  // Col G
      var lastName = capitalize_(String(row[7] || '').trim());   // Col H
      var company = String(row[0] || '').trim();                  // Col A
      var status = isExisting ? 'Client' : 'Pending';

      var contactRow = buildContactRow_(
        now, 'Import', 'Architects List',
        firstName, lastName, email, company,
        status, isExisting, '', '', false, false, false, false, false,
        '', '', '', generateUnsubToken(email), ''
      );
      newRows.push(contactRow);
      existingEmails[email] = true;
    }
  } catch (e) {
    Logger.log('Error importing Architects list: ' + e.message);
  }

  // --- Mailing List ---
  try {
    var mailSS = SpreadsheetApp.openById(MAILING_LIST_SHEET_ID);
    var mailSheet = mailSS.getSheets()[0];
    var mailData = mailSheet.getDataRange().getValues();

    // Col C = Non Working (EXCLUDED) — build exclusion set first
    var excluded = {};
    for (var r = 1; r < mailData.length; r++) {
      var excEmail = String(mailData[r][2] || '').toLowerCase().trim();
      if (excEmail) excluded[excEmail] = true;
    }

    // Col A = Potential Client Email (prospect)
    for (var r = 1; r < mailData.length; r++) {
      var email = String(mailData[r][0] || '').toLowerCase().trim();
      if (!email || !isValidEmail_(email)) continue;
      if (existingEmails[email] || excluded[email]) continue;

      var parsed = extractNameFromEmail_(email);
      var contactRow = buildContactRow_(
        now, 'Import', 'Mailing List',
        parsed.firstName, parsed.lastName, email, parsed.company,
        'Pending', false, '', '', false, false, false, false, false,
        '', '', '', generateUnsubToken(email), ''
      );
      newRows.push(contactRow);
      existingEmails[email] = true;
    }

    // Col B = Existing Client Email
    for (var r = 1; r < mailData.length; r++) {
      var email = String(mailData[r][1] || '').toLowerCase().trim();
      if (!email || !isValidEmail_(email)) continue;
      if (existingEmails[email] || excluded[email]) continue;

      var parsed = extractNameFromEmail_(email);
      var contactRow = buildContactRow_(
        now, 'Import', 'Mailing List',
        parsed.firstName, parsed.lastName, email, parsed.company,
        'Client', true, '', '', false, false, false, false, false,
        '', '', '', generateUnsubToken(email), ''
      );
      newRows.push(contactRow);
      existingEmails[email] = true;
    }
  } catch (e) {
    Logger.log('Error importing Mailing list: ' + e.message);
  }

  // Append all new rows
  if (newRows.length > 0) {
    contactsSheet.getRange(
      contactsSheet.getLastRow() + 1, 1,
      newRows.length, newRows[0].length
    ).setValues(newRows);
  }

  Logger.log('Imported ' + newRows.length + ' new contacts.');
  try {
    SpreadsheetApp.getUi().alert('Imported ' + newRows.length + ' new contacts.');
  } catch (e) {
    // Called from trigger, no UI
  }
}


// ============================================================================
// MENU + EDIT HANDLER
// ============================================================================

/**
 * Creates custom menu when spreadsheet opens.
 */
function onOpen() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { Logger.log('No UI context'); return; }
  ui.createMenu('Stride Campaign')
    .addItem('Add New Contact', 'showAddContactForm')
    .addItem('Create New Campaign', 'showCreateCampaignForm')
    .addSeparator()
    .addItem('Activate Campaign', 'activateCampaign')
    .addItem('Pause Campaign', 'pauseCampaign')
    .addItem('Complete Campaign', 'completeCampaign')
    .addSeparator()
    .addItem('Preview Campaign Email', 'previewCampaignEmail')
    .addItem('Run All Campaigns', 'runAllCampaigns')
    .addItem('Check Inbox', 'checkInbox')
    .addSeparator()
    .addItem('Add New Template', 'showAddTemplateForm')
    .addItem('Import Contacts', 'importContacts')
    .addItem('Refresh Dashboard', 'refreshDashboard')
    .addItem('Send Daily Digest', 'sendDailyDigest')
    .addToUi();

  // Don't auto-refresh dashboard on open — can be slow on large datasets
  // User can click Stride Campaign → Refresh Dashboard instead
}

/**
 * Edit trigger handler. Auto-fills Date Added and Status on new Contacts rows.
 * @param {Object} e - Edit event object.
 */
function onEditTrigger(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    if (sheet.getName() !== TAB_CONTACTS) return;

    var row = e.range.getRow();
    if (row <= 1) return; // Header row

    var dateCell = sheet.getRange(row, CON_DATE_ADDED + 1);
    if (!dateCell.getValue()) {
      dateCell.setValue(new Date());
    }

    var statusCell = sheet.getRange(row, CON_STATUS + 1);
    if (!statusCell.getValue()) {
      statusCell.setValue('Pending');
    }
  } catch (err) {
    Logger.log('onEditTrigger error: ' + err.message);
  }
}

/**
 * Wrapper for onEdit in case direct trigger is used.
 * @param {Object} e - Edit event object.
 */
function onEdit(e) {
  onEditTrigger(e);
}


// ============================================================================
// CAMPAIGN MANAGEMENT
// ============================================================================

/**
 * Creates a new campaign row in the Campaigns tab with defaults.
 * Prompts user for campaign name via UI.
 */
function createNewCampaign() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt('New Campaign', 'Enter campaign name:', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;

  var name = response.getResponseText().trim();
  if (!name) {
    ui.alert('Campaign name cannot be empty.');
    return;
  }

  var ss = getCampaignSheet_();
  var sheet = ss.getSheetByName(TAB_CAMPAIGNS);
  var nextId = getNextCampaignId_(ss);
  var now = new Date();

  var newRow = [];
  for (var i = 0; i <= CMP_CUSTOM3; i++) {
    newRow.push('');
  }

  newRow[CMP_ID] = nextId;
  newRow[CMP_NAME] = name;
  newRow[CMP_TYPE] = 'Sequence';
  newRow[CMP_STATUS] = 'Draft';
  newRow[CMP_PRIORITY] = 10;
  newRow[CMP_TARGET_TYPE] = 'All Active Leads';
  newRow[CMP_ENROLLMENT_MODE] = 'Dynamic';
  newRow[CMP_MAX_FOLLOWUPS] = 0;
  newRow[CMP_FOLLOWUP_INTERVAL] = 3;
  newRow[CMP_DAILY_LIMIT] = 50;
  newRow[CMP_SEND_START] = 8;
  newRow[CMP_SEND_END] = 17;
  newRow[CMP_TEST_MODE] = true;
  newRow[CMP_CREATED_DATE] = now;
  newRow[CMP_TOTAL_SENT] = 0;
  newRow[CMP_TOTAL_REPLIED] = 0;
  newRow[CMP_TOTAL_BOUNCED] = 0;
  newRow[CMP_TOTAL_UNSUB] = 0;
  newRow[CMP_TOTAL_CONVERTED] = 0;

  sheet.appendRow(newRow);

  ui.alert('Campaign created!\n\nID: ' + nextId + '\nName: ' + name +
    '\n\nEdit the row to configure templates, targeting, and settings. Then Activate when ready.');
}

/**
 * Activates the campaign selected in the Campaigns tab.
 * Validates all fields, enrolls contacts.
 */
function activateCampaign() {
  var ui = SpreadsheetApp.getUi();
  var ss = getCampaignSheet_();
  var sheet = ss.getSheetByName(TAB_CAMPAIGNS);

  // Use getActiveSpreadsheet for the active context (works from menu clicks)
  var activeSS = SpreadsheetApp.getActiveSpreadsheet();
  var activeSheet = activeSS ? activeSS.getActiveSheet() : null;

  if (!activeSheet || activeSheet.getName() !== TAB_CAMPAIGNS) {
    ui.alert('Please select a row in the Campaigns tab first.\n\n(Make sure you are on the Campaigns tab and have clicked a cell in the campaign row.)');
    return;
  }

  var row = activeSS.getActiveCell().getRow();
  if (row <= 1) {
    ui.alert('Please select a campaign row (not the header).');
    return;
  }

  var data = sheet.getRange(row, 1, 1, CAMPAIGNS_HEADERS.length).getValues()[0];
  var campaignId = data[CMP_ID];
  var campaignName = data[CMP_NAME];

  if (!campaignId) {
    ui.alert('No campaign found in selected row.');
    return;
  }

  if (data[CMP_STATUS] === 'Active') {
    ui.alert('Campaign "' + campaignName + '" is already active.');
    return;
  }

  // Validate
  var templates = getTemplates();
  var validation = validateCampaign_(data, templates);

  sheet.getRange(row, CMP_VALIDATION_STATUS + 1).setValue(validation.valid ? 'Valid' : 'Invalid');
  sheet.getRange(row, CMP_VALIDATION_NOTES + 1).setValue(validation.notes);

  if (!validation.valid) {
    ui.alert('Validation failed for "' + campaignName + '":\n\n' + validation.notes);
    return;
  }

  // Set Active
  sheet.getRange(row, CMP_STATUS + 1).setValue('Active');

  // Enroll contacts
  var enrolled = enrollContacts_(data, ss);

  ui.alert('Campaign "' + campaignName + '" activated!\n' +
    'Enrolled ' + enrolled + ' contacts.\n' +
    'Enrollment mode: ' + data[CMP_ENROLLMENT_MODE]);
}

/**
 * Pauses the campaign selected in the Campaigns tab.
 */
function pauseCampaign() {
  var ui = SpreadsheetApp.getUi();
  var ss = getCampaignSheet_();
  var activeSS = SpreadsheetApp.getActiveSpreadsheet();
  var activeSheet = activeSS ? activeSS.getActiveSheet() : null;

  if (!activeSheet || activeSheet.getName() !== TAB_CAMPAIGNS) {
    ui.alert('Please select a row in the Campaigns tab first.');
    return;
  }

  var row = activeSS.getActiveCell().getRow();
  if (row <= 1) return;

  var sheet = ss.getSheetByName(TAB_CAMPAIGNS);
  var name = sheet.getRange(row, CMP_NAME + 1).getValue();
  sheet.getRange(row, CMP_STATUS + 1).setValue('Paused');

  ui.alert('Campaign "' + name + '" has been paused.');
}

/**
 * Completes the campaign selected in the Campaigns tab.
 * Marks all Pending Campaign Contacts as Complete.
 */
function completeCampaign() {
  var ui = SpreadsheetApp.getUi();
  var ss = getCampaignSheet_();
  var activeSS = SpreadsheetApp.getActiveSpreadsheet();
  var activeSheet = activeSS ? activeSS.getActiveSheet() : null;

  if (!activeSheet || activeSheet.getName() !== TAB_CAMPAIGNS) {
    ui.alert('Please select a row in the Campaigns tab first.');
    return;
  }

  var row = activeSS.getActiveCell().getRow();
  if (row <= 1) return;

  var sheet = ss.getSheetByName(TAB_CAMPAIGNS);
  var campaignId = sheet.getRange(row, CMP_ID + 1).getValue();
  var name = sheet.getRange(row, CMP_NAME + 1).getValue();

  sheet.getRange(row, CMP_STATUS + 1).setValue('Complete');

  // Mark all pending Campaign Contacts as Complete
  var ccSheet = ss.getSheetByName(TAB_CAMPAIGN_CONTACTS);
  var ccData = ccSheet.getDataRange().getValues();
  for (var i = 1; i < ccData.length; i++) {
    if (ccData[i][CC_CAMPAIGN_ID] === campaignId) {
      var status = ccData[i][CC_STATUS];
      if (status === 'Pending' || status === 'Sent' || status === 'Follow-Up Scheduled') {
        ccSheet.getRange(i + 1, CC_STATUS + 1).setValue('Complete');
        ccSheet.getRange(i + 1, CC_DATE_COMPLETED + 1).setValue(new Date());
        ccSheet.getRange(i + 1, CC_COMPLETED_REASON + 1).setValue('Campaign Completed');
      }
    }
  }

  ui.alert('Campaign "' + name + '" has been completed.\nAll pending contacts marked as Complete.');
}


// ============================================================================
// CAMPAIGN EXECUTION
// ============================================================================

/**
 * Runs all active campaigns in priority order.
 * Handles enrollment, suppression, send windows, limits, sending, and logging.
 */
function runAllCampaigns() {
  var ss = getCampaignSheet_();
  if (!ss) {
    Logger.log('Campaign spreadsheet not found.');
    return;
  }

  var settings = getSettings();
  var templates = getTemplates();
  var campaigns = getCampaigns();
  var now = new Date();

  // Sort by priority (lower = higher priority)
  campaigns.sort(function(a, b) {
    return (a[CMP_PRIORITY] || 99) - (b[CMP_PRIORITY] || 99);
  });

  var contactsSheet = ss.getSheetByName(TAB_CONTACTS);
  var ccSheet = ss.getSheetByName(TAB_CAMPAIGN_CONTACTS);
  var logSheet = ss.getSheetByName(TAB_CAMPAIGN_LOG);
  var campaignsSheet = ss.getSheetByName(TAB_CAMPAIGNS);

  var totalSentToday = 0;

  for (var c = 0; c < campaigns.length; c++) {
    var camp = campaigns[c];

    // Only process Active campaigns
    if (camp[CMP_STATUS] !== 'Active') continue;

    // Check campaign date range
    if (camp[CMP_END_DATE] && new Date(camp[CMP_END_DATE]) < now) {
      continue;
    }
    if (camp[CMP_START_DATE] && new Date(camp[CMP_START_DATE]) > now) {
      continue;
    }

    // Check send window
    var currentHour = now.getHours();
    var sendStart = parseInt(camp[CMP_SEND_START]) || 8;
    var sendEnd = parseInt(camp[CMP_SEND_END]) || 17;
    if (currentHour < sendStart || currentHour >= sendEnd) continue;

    // Dynamic enrollment: find new eligible contacts
    if (camp[CMP_ENROLLMENT_MODE] === 'Dynamic') {
      enrollContacts_(camp, ss);
    }

    // Get Campaign Contacts for this campaign
    var ccData = ccSheet.getDataRange().getValues();
    var dailyLimit = parseInt(camp[CMP_DAILY_LIMIT]) || 50;
    var campaignSentToday = countCampaignSendsToday_(camp[CMP_ID], logSheet);

    // Load Contacts data for suppression/24h checks
    var contactsData = contactsSheet.getDataRange().getValues();
    var contactsByEmail = {};
    for (var ci = 1; ci < contactsData.length; ci++) {
      var cemail = String(contactsData[ci][CON_EMAIL]).toLowerCase().trim();
      if (cemail) contactsByEmail[cemail] = { row: ci + 1, data: contactsData[ci] };
    }

    for (var i = 1; i < ccData.length; i++) {
      // Check global quota
      var remaining = MailApp.getRemainingDailyQuota();
      if (remaining <= 1) {
        Logger.log('Gmail daily quota exhausted. Stopping.');
        break;
      }

      // Check campaign daily limit
      if (campaignSentToday >= dailyLimit) break;

      var ccRow = ccData[i];
      if (ccRow[CC_CAMPAIGN_ID] !== camp[CMP_ID]) continue;

      var ccStatus = ccRow[CC_STATUS];
      if (ccStatus !== 'Pending' && ccStatus !== 'Follow-Up Scheduled') continue;

      var contactEmail = String(ccRow[CC_EMAIL]).toLowerCase().trim();
      var contactInfo = contactsByEmail[contactEmail];

      if (!contactInfo) continue;

      // Global suppression check
      if (contactInfo.data[CON_SUPPRESSED] === true || contactInfo.data[CON_SUPPRESSED] === 'TRUE') {
        ccSheet.getRange(i + 1, CC_STATUS + 1).setValue('Complete');
        ccSheet.getRange(i + 1, CC_SUPPRESSED + 1).setValue(true);
        ccSheet.getRange(i + 1, CC_SUPPRESSION_REASON + 1).setValue('Globally Suppressed');
        ccSheet.getRange(i + 1, CC_DATE_COMPLETED + 1).setValue(now);
        ccSheet.getRange(i + 1, CC_COMPLETED_REASON + 1).setValue('Suppressed');
        continue;
      }

      // 24-hour rule: check last campaign sent date
      var lastSentDate = contactInfo.data[CON_LAST_CAMPAIGN_DATE];
      if (lastSentDate) {
        var hoursSinceLast = (now.getTime() - new Date(lastSentDate).getTime()) / (1000 * 60 * 60);
        if (hoursSinceLast < 24) continue;
      }

      // One active sequence per contact rule
      if (camp[CMP_TYPE] === 'Sequence') {
        var otherActive = getActiveCampaignContactsForEmail_(contactEmail, ss, camp[CMP_ID]);
        if (otherActive) continue;
      }

      // Determine step and template
      var step = ccRow[CC_CURRENT_STEP] || 'Initial';
      var templateName = '';
      if (step === 'Initial') {
        templateName = camp[CMP_INITIAL_TEMPLATE];
      } else if (step === 'Follow-Up 1') {
        templateName = camp[CMP_FOLLOWUP1_TPL];
      } else if (step === 'Follow-Up 2') {
        templateName = camp[CMP_FOLLOWUP2_TPL];
      } else if (step === 'Follow-Up 3') {
        templateName = camp[CMP_FOLLOWUP3_TPL];
      }

      if (!templateName || !templates[templateName]) {
        logCampaignSend_(logSheet, now, camp, contactEmail,
          contactInfo.data[CON_FIRST_NAME] + ' ' + contactInfo.data[CON_LAST_NAME],
          contactInfo.data[CON_COMPANY], templateName, step, '', 'Skipped',
          'Template not found: ' + templateName, camp[CMP_TEST_MODE]);
        continue;
      }

      var template = templates[templateName];

      // Build contact object for buildEmail
      var contact = {
        firstName: contactInfo.data[CON_FIRST_NAME] || '',
        lastName: contactInfo.data[CON_LAST_NAME] || '',
        email: contactEmail,
        company: contactInfo.data[CON_COMPANY] || '',
        unsubToken: contactInfo.data[CON_UNSUB_TOKEN] || ''
      };

      var trackingMarker = generateTrackingMarker_(camp[CMP_ID], contactEmail, step);
      var emailResult = buildEmail(template, contact, settings, camp, step, trackingMarker);
      var subject = emailResult.subject;
      var htmlBody = emailResult.body;

      // Test mode handling
      var sendTo = contactEmail;
      if (camp[CMP_TEST_MODE] === true || camp[CMP_TEST_MODE] === 'TRUE') {
        sendTo = camp[CMP_TEST_RECIPIENT] || settings['Daily Digest Email'];
        subject = '[TEST] ' + subject;
      }

      // Send email
      try {
        var sendFromEmail = settings['Send From Email'] || '';
        var sendOpts = {
          htmlBody: htmlBody,
          name: settings['Sender Name'],
          replyTo: settings['Sender Email']
        };
        if (sendFromEmail && sendFromEmail.indexOf('@') > -1) {
          sendOpts.from = sendFromEmail;
        }
        GmailApp.sendEmail(sendTo, subject, '', sendOpts);

        // Get thread and message IDs using a unique searchable marker
        Utilities.sleep(2500); // Give Gmail extra time to index the sent message
        var safeTo = String(sendTo).replace(/"/g, '');
        var searchQuery = 'to:"' + safeTo + '" newer_than:2d "' + trackingMarker + '"';
        var threads = GmailApp.search(searchQuery, 0, 1);
        var threadId = '';
        var messageId = '';
        if (threads.length > 0) {
          threadId = threads[0].getId();
          var msgs = threads[0].getMessages();
          if (msgs.length > 0) {
            messageId = msgs[msgs.length - 1].getId();
          }
          // Apply Gmail label
          var sentLabel = GmailApp.getUserLabelByName('Stride/Campaign/Sent');
          if (sentLabel) sentLabel.addToThread(threads[0]);
          var mainLabel = GmailApp.getUserLabelByName('Stride/Campaign');
          if (mainLabel) mainLabel.addToThread(threads[0]);

          if (step !== 'Initial') {
            var fuLabel = GmailApp.getUserLabelByName('Stride/Campaign/Follow-Up');
            if (fuLabel) fuLabel.addToThread(threads[0]);
          }
        }

        // Update Campaign Contacts row
        var newStatus = (camp[CMP_TYPE] === 'Blast') ? 'Complete' : 'Sent';
        var nextStep = step;
        var followUpCount = parseInt(ccRow[CC_FOLLOWUP_COUNT]) || 0;

        if (step !== 'Initial') {
          followUpCount++;
        }

        ccSheet.getRange(i + 1, CC_STATUS + 1).setValue(newStatus);
        ccSheet.getRange(i + 1, CC_CURRENT_STEP + 1).setValue(step);
        ccSheet.getRange(i + 1, CC_FOLLOWUP_COUNT + 1).setValue(followUpCount);
        ccSheet.getRange(i + 1, CC_LAST_CONTACT_DATE + 1).setValue(now);
        ccSheet.getRange(i + 1, CC_LAST_ATTEMPT_DATE + 1).setValue(now);
        ccSheet.getRange(i + 1, CC_THREAD_ID + 1).setValue(threadId);
        ccSheet.getRange(i + 1, CC_MESSAGE_ID + 1).setValue(messageId);

        if (camp[CMP_TYPE] === 'Blast') {
          ccSheet.getRange(i + 1, CC_DATE_COMPLETED + 1).setValue(now);
          ccSheet.getRange(i + 1, CC_COMPLETED_REASON + 1).setValue('Blast Sent');
        }

        // Update Contacts tab: Last Campaign Sent Date
        contactsSheet.getRange(contactInfo.row, CON_LAST_CAMPAIGN_DATE + 1).setValue(now);

        // Log success
        logCampaignSend_(logSheet, now, camp, contactEmail,
          contact.firstName + ' ' + contact.lastName, contact.company,
          templateName, step, subject, 'Success', '', camp[CMP_TEST_MODE]);

        campaignSentToday++;
        totalSentToday++;

      } catch (sendErr) {
        // Log failure
        logCampaignSend_(logSheet, now, camp, contactEmail,
          contact.firstName + ' ' + contact.lastName, contact.company,
          templateName, step, subject, 'Failed', sendErr.message, camp[CMP_TEST_MODE]);

        ccSheet.getRange(i + 1, CC_LAST_ATTEMPT_DATE + 1).setValue(now);

        // Update campaign last error
        var campRow = findCampaignRow_(ss, camp[CMP_ID]);
        if (campRow > 0) {
          campaignsSheet.getRange(campRow, CMP_LAST_ERROR + 1).setValue(sendErr.message);
        }
      }
    }

    // Schedule follow-ups for sequence campaigns
    if (camp[CMP_TYPE] === 'Sequence') {
      scheduleFollowUps_(camp, ss);
    }

    // Update campaign stats
    updateCampaignStats_(camp[CMP_ID], ss);

    // Update last run date
    var campRow = findCampaignRow_(ss, camp[CMP_ID]);
    if (campRow > 0) {
      campaignsSheet.getRange(campRow, CMP_LAST_RUN_DATE + 1).setValue(now);
    }
  }

  // Refresh dashboard
  refreshDashboard();

  // Send daily digest
  sendDailyDigest();
}

/**
 * Schedules follow-ups for a sequence campaign.
 * Checks if contacts are ready for follow-up based on interval and max follow-ups.
 * @param {Array} campaign - Campaign row data.
 * @param {SpreadsheetApp.Spreadsheet} ss - The spreadsheet.
 */
function scheduleFollowUps_(campaign, ss) {
  var ccSheet = ss.getSheetByName(TAB_CAMPAIGN_CONTACTS);
  var ccData = ccSheet.getDataRange().getValues();
  var now = new Date();
  var interval = parseInt(campaign[CMP_FOLLOWUP_INTERVAL]) || 3;
  var maxFollowUps = parseInt(campaign[CMP_MAX_FOLLOWUPS]) || 0;

  for (var i = 1; i < ccData.length; i++) {
    var row = ccData[i];
    if (row[CC_CAMPAIGN_ID] !== campaign[CMP_ID]) continue;

    var status = row[CC_STATUS];

    // Check for contacts who have been sent and are due for follow-up
    if (status === 'Sent') {
      var lastContact = row[CC_LAST_CONTACT_DATE];
      if (!lastContact) continue;

      var daysSinceLast = (now.getTime() - new Date(lastContact).getTime()) / (1000 * 60 * 60 * 24);
      var followUpCount = parseInt(row[CC_FOLLOWUP_COUNT]) || 0;

      if (daysSinceLast >= interval && followUpCount < maxFollowUps) {
        // Determine next step
        var nextStep = 'Follow-Up ' + (followUpCount + 1);
        ccSheet.getRange(i + 1, CC_STATUS + 1).setValue('Follow-Up Scheduled');
        ccSheet.getRange(i + 1, CC_NEXT_FOLLOWUP + 1).setValue(now);
        ccSheet.getRange(i + 1, CC_CURRENT_STEP + 1).setValue(nextStep);
      } else if (followUpCount >= maxFollowUps) {
        // Exhausted — campaign-specific only
        ccSheet.getRange(i + 1, CC_STATUS + 1).setValue('Exhausted');
        ccSheet.getRange(i + 1, CC_DATE_COMPLETED + 1).setValue(now);
        ccSheet.getRange(i + 1, CC_COMPLETED_REASON + 1).setValue('Exhausted');

        // Apply Exhausted Gmail label
        var threadId = row[CC_THREAD_ID];
        if (threadId) {
          try {
            var thread = GmailApp.getThreadById(threadId);
            var exLabel = GmailApp.getUserLabelByName('Stride/Campaign/Exhausted');
            if (exLabel && thread) exLabel.addToThread(thread);
          } catch (e) {
            // Thread may not exist
          }
        }
      }
    }
  }
}

/**
 * Public wrapper for scheduleFollowUps that processes all active sequence campaigns.
 */
function scheduleFollowUps() {
  var ss = getCampaignSheet_();
  if (!ss) return;

  var campaigns = getCampaigns();
  for (var c = 0; c < campaigns.length; c++) {
    if (campaigns[c][CMP_STATUS] === 'Active' && campaigns[c][CMP_TYPE] === 'Sequence') {
      scheduleFollowUps_(campaigns[c], ss);
    }
  }
}


// ============================================================================
// INBOX CHECK + REPLY/BOUNCE/UNSUB DETECTION
// ============================================================================

/**
 * Checks inbox for replies, bounces, and unsubscribe requests.
 * Updates Campaign Contacts and Contacts tabs accordingly.
 */
function checkInbox() {
  var ss = getCampaignSheet_();
  if (!ss) return;

  var ccSheet = ss.getSheetByName(TAB_CAMPAIGN_CONTACTS);
  var contactsSheet = ss.getSheetByName(TAB_CONTACTS);
  var ccData = ccSheet.getDataRange().getValues();
  var contactsData_cache_ = null; // Lazy-loaded cache for contacts data
  var now = new Date();

  // Build lookup of thread IDs to CC rows
  var threadLookup = {};
  for (var i = 1; i < ccData.length; i++) {
    var tid = ccData[i][CC_THREAD_ID];
    if (tid) {
      if (!threadLookup[tid]) threadLookup[tid] = [];
      threadLookup[tid].push(i);
    }
  }

  // --- Reply Detection ---
  // Check threads that have Campaign Contacts entries
  // Track already-processed emails to prevent double-processing
  var checkedThreads = {};
  var processedEmails = {};
  for (var threadId in threadLookup) {
    if (!threadLookup.hasOwnProperty(threadId)) continue;
    if (checkedThreads[threadId]) continue;
    checkedThreads[threadId] = true;

    try {
      var thread = GmailApp.getThreadById(threadId);
      if (!thread) continue;

      var messages = thread.getMessages();
      if (messages.length <= 1) continue; // Only original, no reply

      // Check for new replies (messages after the first one from someone other than us)
      var replyHandled = false;
      for (var m = 1; m < messages.length && !replyHandled; m++) {
        var msg = messages[m];
        var fromEmail = extractEmailFromHeader_(msg.getFrom());

        // Skip if we already processed this email in this run
        if (processedEmails[fromEmail]) continue;

        // Check if this is from a contact (not us)
        var ccRows = threadLookup[threadId];
        for (var r = 0; r < ccRows.length; r++) {
          var rowIdx = ccRows[r];
          var ccEmail = String(ccData[rowIdx][CC_EMAIL]).toLowerCase().trim();

          if (fromEmail === ccEmail && toBool_(ccData[rowIdx][CC_REPLIED]) !== true) {
            // Check for unsubscribe keywords in reply
            var bodyText = msg.getPlainBody().toLowerCase();
            var subjectText = msg.getSubject().toLowerCase();
            var isUnsub = false;

            for (var u = 0; u < UNSUB_KEYWORDS.length; u++) {
              if (bodyText.indexOf(UNSUB_KEYWORDS[u]) !== -1 || subjectText.indexOf(UNSUB_KEYWORDS[u]) !== -1) {
                isUnsub = true;
                break;
              }
            }

            if (isUnsub) {
              processUnsubscribes(ccEmail, 'Reply Keyword');
              ccSheet.getRange(rowIdx + 1, CC_STATUS + 1).setValue('Unsubscribed');
              ccSheet.getRange(rowIdx + 1, CC_UNSUBSCRIBED + 1).setValue(true);
              ccSheet.getRange(rowIdx + 1, CC_DATE_COMPLETED + 1).setValue(now);
              ccSheet.getRange(rowIdx + 1, CC_COMPLETED_REASON + 1).setValue('Unsubscribed');

              var unsubLabel = GmailApp.getUserLabelByName('Stride/Campaign/Unsubscribed');
              if (unsubLabel) unsubLabel.addToThread(thread);
            } else {
              // Regular reply — suppress in v1
              ccSheet.getRange(rowIdx + 1, CC_STATUS + 1).setValue('Replied');
              ccSheet.getRange(rowIdx + 1, CC_REPLIED + 1).setValue(true);
              ccSheet.getRange(rowIdx + 1, CC_DATE_COMPLETED + 1).setValue(now);
              ccSheet.getRange(rowIdx + 1, CC_COMPLETED_REASON + 1).setValue('Replied');

              // Update Contacts tab
              var conRow = findContactRow_(contactsSheet, ccEmail);
              if (conRow > 0) {
                contactsSheet.getRange(conRow, CON_REPLIED + 1).setValue(true);
                contactsSheet.getRange(conRow, CON_SUPPRESSED + 1).setValue(true);
                contactsSheet.getRange(conRow, CON_SUPPRESSION_REASON + 1).setValue('Replied');
                contactsSheet.getRange(conRow, CON_SUPPRESSION_DATE + 1).setValue(now);
              }

              // Append to Suppression Log
              var supSheet = ss.getSheetByName(TAB_SUPPRESSION_LOG);
              var conData = conRow > 0 ? contactsSheet.getRange(conRow, 1, 1, CONTACTS_HEADERS.length).getValues()[0] : [];
              supSheet.appendRow([
                now, ccEmail,
                conData[CON_FIRST_NAME] || '', conData[CON_COMPANY] || '',
                'Replied', 'checkInbox'
              ]);

              var repLabel = GmailApp.getUserLabelByName('Stride/Campaign/Replied');
              if (repLabel) repLabel.addToThread(thread);
            }
            // Mark processed and break — one handling per contact per thread per run
            processedEmails[ccEmail] = true;
            replyHandled = true;
            break;
          }
        }
      }
    } catch (e) {
      Logger.log('Error checking thread ' + threadId + ': ' + e.message);
    }
  }

  // --- Bounce Detection ---
  // Extract emails from bounce messages, then match against contacts
  // Reuse contactsData if already loaded, otherwise load once
  try {
    var bounceThreads = GmailApp.search('from:mailer-daemon newer_than:2d');
    if (!contactsData_cache_) {
      contactsData_cache_ = contactsSheet.getDataRange().getValues();
    }
    var contactsData = contactsData_cache_;
    var contactEmailSet = {};
    for (var ci = 1; ci < contactsData.length; ci++) {
      var ce = String(contactsData[ci][CON_EMAIL]).toLowerCase().trim();
      if (ce) contactEmailSet[ce] = ci + 1;
    }

    var emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

    for (var bt = 0; bt < bounceThreads.length; bt++) {
      var bMsgs = bounceThreads[bt].getMessages();
      for (var bm = 0; bm < bMsgs.length; bm++) {
        var bounceBody = bMsgs[bm].getPlainBody().toLowerCase();

        // Extract all email addresses from bounce message body
        var foundEmails = bounceBody.match(emailRegex) || [];
        var bouncedSet = {};
        for (var fe = 0; fe < foundEmails.length; fe++) {
          bouncedSet[foundEmails[fe].toLowerCase()] = true;
        }

        // Match extracted emails against our contacts
        for (var email in bouncedSet) {
          if (!bouncedSet.hasOwnProperty(email)) continue;
          if (!contactEmailSet[email]) continue;
          // Found a bounced contact
          if (true) {
            var conRowNum = contactEmailSet[email];

            // Check if already marked bounced
            if (contactsData[conRowNum - 1][CON_BOUNCED] === true || contactsData[conRowNum - 1][CON_BOUNCED] === 'TRUE') continue;

            // Suppress globally
            contactsSheet.getRange(conRowNum, CON_BOUNCED + 1).setValue(true);
            contactsSheet.getRange(conRowNum, CON_SUPPRESSED + 1).setValue(true);
            contactsSheet.getRange(conRowNum, CON_SUPPRESSION_REASON + 1).setValue('Bounced');
            contactsSheet.getRange(conRowNum, CON_SUPPRESSION_DATE + 1).setValue(now);

            // Update Campaign Contacts — use existing ccData instead of re-reading
            for (var cci = 1; cci < ccData.length; cci++) {
              if (String(ccData[cci][CC_EMAIL]).toLowerCase().trim() === email) {
                var ccStatus = String(ccData[cci][CC_STATUS]);
                if (ccStatus !== 'Bounced' && ccStatus !== 'Complete') {
                  ccSheet.getRange(cci + 1, CC_STATUS + 1).setValue('Bounced');
                  ccSheet.getRange(cci + 1, CC_BOUNCED + 1).setValue(true);
                  ccSheet.getRange(cci + 1, CC_DATE_COMPLETED + 1).setValue(now);
                  ccSheet.getRange(cci + 1, CC_COMPLETED_REASON + 1).setValue('Bounced');
                }
              }
            }

            // Suppression Log
            var supSheet = ss.getSheetByName(TAB_SUPPRESSION_LOG);
            supSheet.appendRow([
              now, email,
              contactsData[conRowNum - 1][CON_FIRST_NAME] || '',
              contactsData[conRowNum - 1][CON_COMPANY] || '',
              'Bounced', 'checkInbox'
            ]);

            // Gmail label
            var bLabel = GmailApp.getUserLabelByName('Stride/Campaign/Bounced');
            if (bLabel) bLabel.addToThread(bounceThreads[bt]);
          }
        }
      }
    }
  } catch (e) {
    Logger.log('Error checking bounces: ' + e.message);
  }

  // Update stats for all active campaigns
  var campaigns = getCampaigns();
  for (var c = 0; c < campaigns.length; c++) {
    if (campaigns[c][CMP_STATUS] === 'Active') {
      updateCampaignStats_(campaigns[c][CMP_ID], ss);
    }
  }

  Logger.log('Inbox check complete.');
}


// ============================================================================
// UNSUBSCRIBE PROCESSING
// ============================================================================

/**
 * Processes an unsubscribe request globally and per-campaign.
 * @param {string} contactEmail - The email to unsubscribe.
 * @param {string} triggeredBy - What triggered the unsub (e.g. "Reply Keyword", "Web App").
 */
function processUnsubscribes(contactEmail, triggeredBy) {
  var ss = getCampaignSheet_();
  if (!ss) return;

  var contactsSheet = ss.getSheetByName(TAB_CONTACTS);
  var ccSheet = ss.getSheetByName(TAB_CAMPAIGN_CONTACTS);
  var supSheet = ss.getSheetByName(TAB_SUPPRESSION_LOG);
  var now = new Date();
  var email = String(contactEmail).toLowerCase().trim();

  // Global: update Contacts tab
  var conRow = findContactRow_(contactsSheet, email);
  var firstName = '';
  var company = '';
  if (conRow > 0) {
    var conData = contactsSheet.getRange(conRow, 1, 1, CONTACTS_HEADERS.length).getValues()[0];
    firstName = conData[CON_FIRST_NAME];
    company = conData[CON_COMPANY];

    contactsSheet.getRange(conRow, CON_UNSUBSCRIBED + 1).setValue(true);
    contactsSheet.getRange(conRow, CON_SUPPRESSED + 1).setValue(true);
    contactsSheet.getRange(conRow, CON_SUPPRESSION_REASON + 1).setValue('Unsubscribed');
    contactsSheet.getRange(conRow, CON_SUPPRESSION_DATE + 1).setValue(now);
  }

  // Campaign-specific: update all active Campaign Contacts
  var ccData = ccSheet.getDataRange().getValues();
  for (var i = 1; i < ccData.length; i++) {
    if (String(ccData[i][CC_EMAIL]).toLowerCase().trim() === email) {
      var status = ccData[i][CC_STATUS];
      if (status !== 'Complete' && status !== 'Bounced' && status !== 'Unsubscribed') {
        ccSheet.getRange(i + 1, CC_STATUS + 1).setValue('Unsubscribed');
        ccSheet.getRange(i + 1, CC_UNSUBSCRIBED + 1).setValue(true);
        ccSheet.getRange(i + 1, CC_DATE_COMPLETED + 1).setValue(now);
        ccSheet.getRange(i + 1, CC_COMPLETED_REASON + 1).setValue('Unsubscribed');
      }
    }
  }

  // Append to Suppression Log
  supSheet.appendRow([now, email, firstName, company, 'Unsubscribed', triggeredBy]);

  // Apply Gmail label to any thread
  try {
    var threads = GmailApp.search('to:' + email + ' OR from:' + email, 0, 5);
    var unsubLabel = GmailApp.getUserLabelByName('Stride/Campaign/Unsubscribed');
    for (var t = 0; t < threads.length; t++) {
      if (unsubLabel) unsubLabel.addToThread(threads[t]);
    }
  } catch (e) {
    Logger.log('Error applying unsub label: ' + e.message);
  }
}


// ============================================================================
// EMAIL BUILDING
// ============================================================================

/**
 * Builds an email by replacing all tokens in a template.
 * @param {Object} templateObj - Template with subject, body, preview, name.
 * @param {Object} contact - Contact object with firstName, lastName, email, company, unsubToken.
 * @param {Object} settings - Settings key-value map.
 * @param {Array} campaign - Campaign row data.
 * @return {Object} { subject, body }
 */
function buildEmail(templateObj, contact, settings, campaign, step, trackingMarker) {
  var subject = templateObj.subject || '';
  var body = templateObj.body || '';
  var now = new Date();
  var months = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

  var fullName = ((contact.firstName || '') + ' ' + (contact.lastName || '')).trim();
  var emailHash = generateEmailHash_(contact.email);
  var marker = trackingMarker || generateTrackingMarker_(campaign ? campaign[CMP_ID] : '', contact.email, step || 'Initial');
  var unsubBaseUrl = settings['Unsubscribe Base URL'] || '';
  var unsubUrl = unsubBaseUrl;
  if (unsubBaseUrl && unsubBaseUrl.indexOf('(paste') === -1) {
    unsubUrl = unsubBaseUrl + '?token=' + (contact.unsubToken || '') + '&email=' + encodeURIComponent(contact.email);
  }

  var tokens = {
    '{{First Name}}': contact.firstName || '',
    '{{Last Name}}': contact.lastName || '',
    '{{Full Name}}': fullName,
    '{{Company}}': contact.company || '',
    '{{Email}}': contact.email || '',
    '{{BookingURL}}': settings['Booking URL'] || '',
    '{{EMAIL_HASH}}': emailHash,
    '{{UNSUB_URL}}': unsubUrl,
    '{{Campaign Name}}': campaign[CMP_NAME] || '',
    '{{Sender Name}}': settings['Sender Name'] || '',
    '{{Sender Phone}}': settings['Sender Phone'] || '',
    '{{Sender Email}}': settings['Sender Email'] || '',
    '{{Website URL}}': settings['Website URL'] || '',
    '{{Current Year}}': String(now.getFullYear()),
    '{{Current Month}}': months[now.getMonth()],
    '{{Send Date}}': Utilities.formatDate(now, Session.getScriptTimeZone(), 'MM/dd/yyyy'),
    '{{Custom 1}}': campaign[CMP_CUSTOM1] || '',
    '{{Custom 2}}': campaign[CMP_CUSTOM2] || '',
    '{{Custom 3}}': campaign[CMP_CUSTOM3] || ''
  };

  var tokenKeys = Object.keys(tokens);
  for (var t = 0; t < tokenKeys.length; t++) {
    var key = tokenKeys[t];
    var val = tokens[key];
    subject = subject.split(key).join(val);
    body = body.split(key).join(val);
  }

  // Embed a searchable tracking marker for reliable Gmail thread lookup.
  // Do not use an HTML comment because Gmail search may not index comments.
  body += '<div style="font-size:1px;line-height:1px;color:#ffffff;overflow:hidden;max-height:1px;">' + marker + '</div>';

  return { subject: subject, body: body };
}


// ============================================================================
// UNSUBSCRIBE TOKEN
// ============================================================================

/**
 * Generates an MD5-based unsubscribe token for an email.
 * 32 chars, never regenerates existing.
 * @param {string} email - Contact email.
 * @return {string} 32-char hex token.
 */
function generateUnsubToken(email) {
  var ss = getCampaignSheet_();
  if (ss) {
    var contactsSheet = ss.getSheetByName(TAB_CONTACTS);
    if (contactsSheet) {
      var data = contactsSheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][CON_EMAIL]).toLowerCase().trim() === String(email).toLowerCase().trim()) {
          var existingToken = data[i][CON_UNSUB_TOKEN];
          if (existingToken) return existingToken;
        }
      }
    }
  }

  var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, email.toLowerCase().trim() + '_stride_unsub');
  var token = '';
  for (var i = 0; i < rawHash.length; i++) {
    var byte = rawHash[i];
    if (byte < 0) byte += 256;
    var hex = byte.toString(16);
    if (hex.length === 1) hex = '0' + hex;
    token += hex;
  }
  return token;
}


// ============================================================================
// PREVIEW
// ============================================================================

/**
 * Previews a campaign email by sending to the test recipient.
 * Prompts user for campaign ID.
 */
function previewCampaignEmail() {
  var ui = SpreadsheetApp.getUi();
  var ss = getCampaignSheet_();

  // List available campaigns
  var campaigns = getCampaigns();
  var list = '';
  for (var c = 0; c < campaigns.length; c++) {
    list += campaigns[c][CMP_ID] + ' - ' + campaigns[c][CMP_NAME] + ' (' + campaigns[c][CMP_STATUS] + ')\n';
  }

  var response = ui.prompt('Preview Campaign Email',
    'Available campaigns:\n' + list + '\nEnter Campaign ID to preview:',
    ui.ButtonSet.OK_CANCEL);

  if (response.getSelectedButton() !== ui.Button.OK) return;

  var campaignId = response.getResponseText().trim();
  var campaign = null;
  for (var c = 0; c < campaigns.length; c++) {
    if (campaigns[c][CMP_ID] === campaignId) {
      campaign = campaigns[c];
      break;
    }
  }

  if (!campaign) {
    ui.alert('Campaign not found: ' + campaignId);
    return;
  }

  var settings = getSettings();
  var templates = getTemplates();
  var templateName = campaign[CMP_INITIAL_TEMPLATE];

  if (!templateName || !templates[templateName]) {
    ui.alert('Initial template not found: ' + (templateName || '(empty)'));
    return;
  }

  // Find first eligible contact or use test data
  var contact = {
    firstName: 'Test',
    lastName: 'Contact',
    email: 'test@example.com',
    company: 'Test Company',
    unsubToken: 'abc123def456'
  };

  var contactsSheet = ss.getSheetByName(TAB_CONTACTS);
  var contactsData = contactsSheet.getDataRange().getValues();
  for (var i = 1; i < contactsData.length; i++) {
    if (contactsData[i][CON_SUPPRESSED] !== true && contactsData[i][CON_SUPPRESSED] !== 'TRUE') {
      contact = {
        firstName: contactsData[i][CON_FIRST_NAME] || 'Test',
        lastName: contactsData[i][CON_LAST_NAME] || 'Contact',
        email: String(contactsData[i][CON_EMAIL] || 'test@example.com'),
        company: contactsData[i][CON_COMPANY] || 'Test Company',
        unsubToken: contactsData[i][CON_UNSUB_TOKEN] || 'abc123def456'
      };
      break;
    }
  }

  var emailResult = buildEmail(templates[templateName], contact, settings, campaign, 'Initial', generateTrackingMarker_(campaign[CMP_ID], contact.email, 'Preview'));
  var sendTo = campaign[CMP_TEST_RECIPIENT] || settings['Daily Digest Email'];

  var previewOpts = {
    htmlBody: emailResult.body,
    name: settings['Sender Name'],
    replyTo: settings['Sender Email']
  };
  var sendFromEmail = settings['Send From Email'] || '';
  if (sendFromEmail && sendFromEmail.indexOf('@') > -1) {
    previewOpts.from = sendFromEmail;
  }
  GmailApp.sendEmail(sendTo, '[PREVIEW] ' + emailResult.subject, '', previewOpts);

  ui.alert('Preview sent to ' + sendTo + '!');
}


// ============================================================================
// DAILY DIGEST
// ============================================================================

/**
 * Sends a daily digest email with per-campaign stats and global totals.
 */
function sendDailyDigest() {
  var ss = getCampaignSheet_();
  if (!ss) return;

  // Once-per-day guard — skip if digest already sent today
  var props = PropertiesService.getScriptProperties();
  var now = new Date();
  var todayStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var lastDigestDate = props.getProperty('LAST_DIGEST_DATE');
  if (lastDigestDate === todayStr) {
    Logger.log('Daily digest already sent today (' + todayStr + '). Skipping.');
    return;
  }

  var settings = getSettings();
  var digestEmail = settings['Daily Digest Email'];
  var campaigns = getCampaigns();
  var logSheet = ss.getSheetByName(TAB_CAMPAIGN_LOG);
  var logData = logSheet.getDataRange().getValues();

  var globalSentToday = 0;
  var globalTotalSent = 0;
  var globalReplies = 0;
  var globalBounces = 0;
  var globalUnsubs = 0;
  var globalConverted = 0;
  var globalErrors = 0;

  var campaignStats = [];
  var activeOrComplete = [];
  var statsById = {};

  for (var c = 0; c < campaigns.length; c++) {
    var camp = campaigns[c];
    if (camp[CMP_STATUS] !== 'Active' && camp[CMP_STATUS] !== 'Complete') continue;

    var stat = {
      id: camp[CMP_ID],
      name: camp[CMP_NAME],
      status: camp[CMP_STATUS],
      type: camp[CMP_TYPE],
      sentToday: 0,
      totalSent: parseInt(camp[CMP_TOTAL_SENT]) || 0,
      replied: parseInt(camp[CMP_TOTAL_REPLIED]) || 0,
      bounced: parseInt(camp[CMP_TOTAL_BOUNCED]) || 0,
      unsubs: parseInt(camp[CMP_TOTAL_UNSUB]) || 0,
      converted: parseInt(camp[CMP_TOTAL_CONVERTED]) || 0
    };
    activeOrComplete.push(camp);
    statsById[camp[CMP_ID]] = stat;

    globalTotalSent += stat.totalSent;
    globalReplies += stat.replied;
    globalBounces += stat.bounced;
    globalUnsubs += stat.unsubs;
    globalConverted += stat.converted;
  }

  for (var l = 1; l < logData.length; l++) {
    var logCampaignId = logData[l][LOG_CAMPAIGN_ID];
    var statRef = statsById[logCampaignId];
    if (!statRef) continue;

    var logDate = logData[l][LOG_TIMESTAMP];
    if (logDate) {
      var logDateStr = Utilities.formatDate(new Date(logDate), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      if (logDateStr === todayStr && logData[l][LOG_RESULT] === 'Success') {
        statRef.sentToday++;
        globalSentToday++;
      }
    }
    if (logData[l][LOG_RESULT] === 'Failed') {
      globalErrors++;
    }
  }

  for (var campaignId in statsById) {
    if (statsById.hasOwnProperty(campaignId)) campaignStats.push(statsById[campaignId]);
  }
  var quota = MailApp.getRemainingDailyQuota();
  var sheetUrl = ss.getUrl();

  // Build HTML digest
  var html = '<div style="font-family:Arial,sans-serif;max-width:650px;margin:0 auto;">';
  html += '<div style="text-align:center;padding:20px 0;">';
  html += '<img src="' + STRIDE_LOGO_URL + '" alt="Stride Logistics" style="max-width:200px;">';
  html += '</div>';
  html += '<h2 style="color:#333;border-bottom:2px solid #4a86c8;padding-bottom:10px;">Daily Campaign Digest</h2>';
  html += '<p style="color:#666;">' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'EEEE, MMMM d, yyyy h:mm a') + '</p>';

  // Global Summary
  html += '<div style="background:#f0f4f8;padding:15px;border-radius:8px;margin:15px 0;">';
  html += '<h3 style="margin-top:0;color:#4a86c8;">Global Summary</h3>';
  html += '<table style="width:100%;border-collapse:collapse;">';
  html += '<tr><td style="padding:5px;">Sent Today:</td><td style="padding:5px;font-weight:bold;">' + globalSentToday + '</td>';
  html += '<td style="padding:5px;">Total Sent:</td><td style="padding:5px;font-weight:bold;">' + globalTotalSent + '</td></tr>';
  html += '<tr><td style="padding:5px;">Replies:</td><td style="padding:5px;font-weight:bold;">' + globalReplies + '</td>';
  html += '<td style="padding:5px;">Bounces:</td><td style="padding:5px;font-weight:bold;">' + globalBounces + '</td></tr>';
  html += '<tr><td style="padding:5px;">Unsubscribes:</td><td style="padding:5px;font-weight:bold;">' + globalUnsubs + '</td>';
  html += '<td style="padding:5px;">Conversions:</td><td style="padding:5px;font-weight:bold;">' + globalConverted + '</td></tr>';
  html += '<tr><td style="padding:5px;">Errors:</td><td style="padding:5px;font-weight:bold;">' + globalErrors + '</td>';
  html += '<td style="padding:5px;">Quota Remaining:</td><td style="padding:5px;font-weight:bold;">' + quota + '</td></tr>';
  html += '</table></div>';

  // Per-campaign breakdown
  if (campaignStats.length > 0) {
    html += '<h3 style="color:#333;">Campaign Breakdown</h3>';
    html += '<table style="width:100%;border-collapse:collapse;border:1px solid #ddd;">';
    html += '<tr style="background:#4a86c8;color:#fff;">';
    html += '<th style="padding:8px;text-align:left;">Campaign</th>';
    html += '<th style="padding:8px;text-align:center;">Type</th>';
    html += '<th style="padding:8px;text-align:center;">Today</th>';
    html += '<th style="padding:8px;text-align:center;">Total</th>';
    html += '<th style="padding:8px;text-align:center;">Replied</th>';
    html += '<th style="padding:8px;text-align:center;">Bounced</th>';
    html += '<th style="padding:8px;text-align:center;">Unsub</th>';
    html += '</tr>';

    for (var s = 0; s < campaignStats.length; s++) {
      var cs = campaignStats[s];
      var bgColor = s % 2 === 0 ? '#fff' : '#f9f9f9';
      html += '<tr style="background:' + bgColor + ';">';
      html += '<td style="padding:8px;">' + cs.name + ' (' + cs.id + ')</td>';
      html += '<td style="padding:8px;text-align:center;">' + cs.type + '</td>';
      html += '<td style="padding:8px;text-align:center;">' + cs.sentToday + '</td>';
      html += '<td style="padding:8px;text-align:center;">' + cs.totalSent + '</td>';
      html += '<td style="padding:8px;text-align:center;">' + cs.replied + '</td>';
      html += '<td style="padding:8px;text-align:center;">' + cs.bounced + '</td>';
      html += '<td style="padding:8px;text-align:center;">' + cs.unsubs + '</td>';
      html += '</tr>';
    }
    html += '</table>';
  }

  html += '<p style="margin-top:20px;"><a href="' + sheetUrl + '" style="color:#4a86c8;">Open Campaign Spreadsheet</a></p>';
  html += '<p style="color:#999;font-size:11px;">Stride Designer Campaign v2 — Automated Digest</p>';
  html += '</div>';

  GmailApp.sendEmail(digestEmail, 'Stride Campaign Daily Digest — ' + todayStr, '', {
    htmlBody: html,
    name: 'Stride Campaign System'
  });

  // Mark digest as sent for today
  props.setProperty('LAST_DIGEST_DATE', todayStr);
  Logger.log('Daily digest sent for ' + todayStr);
}


// ============================================================================
// DASHBOARD
// ============================================================================

/**
 * Refreshes the Dashboard tab with per-campaign stats and global totals.
 */
function refreshDashboard() {
  var ss = getCampaignSheet_();
  if (!ss) return;

  var dashSheet = ss.getSheetByName(TAB_DASHBOARD);
  if (!dashSheet) return;

  dashSheet.clear();

  var campaigns = getCampaigns();
  var ccSheet = ss.getSheetByName(TAB_CAMPAIGN_CONTACTS);
  var ccData = ccSheet.getDataRange().getValues();
  var contactsSheet = ss.getSheetByName(TAB_CONTACTS);
  var contactsData = contactsSheet.getDataRange().getValues();

  var now = new Date();
  var row = 1;

  // Header
  dashSheet.getRange(row, 1).setValue('Stride Campaign Dashboard');
  dashSheet.getRange(row, 1).setFontSize(14).setFontWeight('bold');
  dashSheet.getRange(row, 2).setValue('Last Refreshed: ' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'MM/dd/yyyy h:mm a'));
  row += 2;

  // Global stats
  var totalContacts = contactsData.length - 1;
  var suppressed = 0;
  var clients = 0;
  var pending = 0;
  for (var ci = 1; ci < contactsData.length; ci++) {
    if (contactsData[ci][CON_SUPPRESSED] === true || contactsData[ci][CON_SUPPRESSED] === 'TRUE') suppressed++;
    if (contactsData[ci][CON_STATUS] === 'Client') clients++;
    if (contactsData[ci][CON_STATUS] === 'Pending') pending++;
  }

  dashSheet.getRange(row, 1).setValue('GLOBAL STATS').setFontWeight('bold').setBackground('#4a86c8').setFontColor('#fff');
  dashSheet.getRange(row, 2).setBackground('#4a86c8');
  dashSheet.getRange(row, 3).setBackground('#4a86c8');
  dashSheet.getRange(row, 4).setBackground('#4a86c8');
  row++;
  dashSheet.getRange(row, 1).setValue('Total Contacts');
  dashSheet.getRange(row, 2).setValue(totalContacts);
  dashSheet.getRange(row, 3).setValue('Suppressed');
  dashSheet.getRange(row, 4).setValue(suppressed);
  row++;
  dashSheet.getRange(row, 1).setValue('Clients');
  dashSheet.getRange(row, 2).setValue(clients);
  dashSheet.getRange(row, 3).setValue('Pending Leads');
  dashSheet.getRange(row, 4).setValue(pending);
  row++;
  dashSheet.getRange(row, 1).setValue('Gmail Quota Remaining');
  dashSheet.getRange(row, 2).setValue(MailApp.getRemainingDailyQuota());
  row += 2;

  // Per-campaign stats
  var headers = ['Campaign ID', 'Name', 'Type', 'Status', 'Priority', 'Enrolled', 'Sent',
    'Replied', 'Bounced', 'Unsubscribed', 'Converted', 'Pending', 'Exhausted'];
  dashSheet.getRange(row, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#4a86c8').setFontColor('#fff');
  row++;

  var globalTotalSent = 0;
  var globalTotalReplied = 0;
  var globalTotalBounced = 0;
  var globalTotalUnsub = 0;
  var globalTotalConverted = 0;

  for (var c = 0; c < campaigns.length; c++) {
    var camp = campaigns[c];

    // Count CC statuses for this campaign
    var enrolled = 0, cSent = 0, cReplied = 0, cBounced = 0, cUnsub = 0, cConverted = 0, cPending = 0, cExhausted = 0;
    for (var i = 1; i < ccData.length; i++) {
      if (ccData[i][CC_CAMPAIGN_ID] !== camp[CMP_ID]) continue;
      enrolled++;
      var st = ccData[i][CC_STATUS];
      if (st === 'Pending' || st === 'Follow-Up Scheduled') cPending++;
      if (st === 'Sent' || st === 'Complete') cSent++;
      if (st === 'Replied') { cReplied++; cSent++; }
      if (st === 'Bounced') { cBounced++; }
      if (st === 'Unsubscribed') { cUnsub++; }
      if (st === 'Exhausted') { cExhausted++; cSent++; }
      if (ccData[i][CC_CONVERTED] === true || ccData[i][CC_CONVERTED] === 'TRUE') cConverted++;
    }

    var rowData = [
      camp[CMP_ID], camp[CMP_NAME], camp[CMP_TYPE], camp[CMP_STATUS],
      camp[CMP_PRIORITY], enrolled, cSent, cReplied, cBounced, cUnsub,
      cConverted, cPending, cExhausted
    ];
    dashSheet.getRange(row, 1, 1, rowData.length).setValues([rowData]);

    if (row % 2 === 0) {
      dashSheet.getRange(row, 1, 1, rowData.length).setBackground('#f0f4f8');
    }

    globalTotalSent += cSent;
    globalTotalReplied += cReplied;
    globalTotalBounced += cBounced;
    globalTotalUnsub += cUnsub;
    globalTotalConverted += cConverted;
    row++;
  }

  // Global totals row
  row++;
  var totals = ['', 'TOTALS', '', '', '', '', globalTotalSent, globalTotalReplied,
    globalTotalBounced, globalTotalUnsub, globalTotalConverted, '', ''];
  dashSheet.getRange(row, 1, 1, totals.length).setValues([totals]).setFontWeight('bold').setBackground('#f4b342');

  // Auto-resize
  for (var col = 1; col <= headers.length; col++) {
    dashSheet.autoResizeColumn(col);
  }
}


// ============================================================================
// WEB APP (UNSUBSCRIBE)
// ============================================================================

/**
 * Handles GET requests for the unsubscribe web app.
 * @param {Object} e - Event object with query parameters.
 * @return {HtmlOutput} Branded confirmation page.
 */
function doGet(e) {
  var token = (e && e.parameter && e.parameter.token) ? e.parameter.token : '';
  var email = (e && e.parameter && e.parameter.email) ? decodeURIComponent(e.parameter.email) : '';

  if (!token || !email) {
    return HtmlService.createHtmlOutput(
      '<html><body style="font-family:Arial,sans-serif;text-align:center;padding:50px;">' +
      '<img src="' + STRIDE_LOGO_URL + '" alt="Stride" style="max-width:200px;margin-bottom:20px;"><br>' +
      '<h2>Invalid Unsubscribe Link</h2>' +
      '<p>This unsubscribe link appears to be invalid or expired.</p>' +
      '<p>Please contact <a href="mailto:info@stridenw.com">info@stridenw.com</a> for assistance.</p>' +
      '</body></html>'
    ).setTitle('Stride — Unsubscribe');
  }

  // Verify token
  var ss = getCampaignSheet_();
  var contactsSheet = ss.getSheetByName(TAB_CONTACTS);
  var data = contactsSheet.getDataRange().getValues();
  var found = false;

  for (var i = 1; i < data.length; i++) {
    var conEmail = String(data[i][CON_EMAIL]).toLowerCase().trim();
    var conToken = String(data[i][CON_UNSUB_TOKEN]).trim();

    if (conEmail === email.toLowerCase().trim() && conToken === token) {
      found = true;
      processUnsubscribes(email, 'Web App');
      break;
    }
  }

  if (!found) {
    return HtmlService.createHtmlOutput(
      '<html><body style="font-family:Arial,sans-serif;text-align:center;padding:50px;">' +
      '<img src="' + STRIDE_LOGO_URL + '" alt="Stride" style="max-width:200px;margin-bottom:20px;"><br>' +
      '<h2>Unsubscribe Error</h2>' +
      '<p>We could not verify your unsubscribe request. Please contact ' +
      '<a href="mailto:info@stridenw.com">info@stridenw.com</a> for assistance.</p>' +
      '</body></html>'
    ).setTitle('Stride — Unsubscribe');
  }

  return HtmlService.createHtmlOutput(
    '<html><head><meta http-equiv="refresh" content="3;url=https://www.stridenw.com"></head>' +
    '<body style="font-family:Arial,sans-serif;text-align:center;padding:50px;">' +
    '<img src="' + STRIDE_LOGO_URL + '" alt="Stride" style="max-width:200px;margin-bottom:20px;"><br>' +
    '<h2 style="color:#4a86c8;">You have been unsubscribed</h2>' +
    '<p>Your email address <strong>' + email + '</strong> has been removed from all future campaign emails.</p>' +
    '<p style="color:#999;">You will be redirected to <a href="https://www.stridenw.com">stridenw.com</a> in 3 seconds...</p>' +
    '</body></html>'
  ).setTitle('Stride — Unsubscribed');
}


// ============================================================================
// DATA READERS
// ============================================================================

/**
 * Reads the Settings tab into a key-value object.
 * @return {Object} Settings map.
 */
function getSettings() {
  var ss = getCampaignSheet_();
  if (!ss) return {};

  var sheet = ss.getSheetByName(TAB_SETTINGS);
  if (!sheet) return {};

  var data = sheet.getDataRange().getValues();
  var settings = {};
  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][0]).trim();
    if (key) settings[key] = data[i][1];
  }
  return settings;
}

/**
 * Reads the Templates tab into a keyed object (by template name).
 * @return {Object} Map of template name to {name, subject, preview, body, version}.
 */
function getTemplates() {
  var ss = getCampaignSheet_();
  if (!ss) return {};

  var sheet = ss.getSheetByName(TAB_TEMPLATES);
  if (!sheet) return {};

  var data = sheet.getDataRange().getValues();
  var templates = {};
  for (var i = 1; i < data.length; i++) {
    var name = String(data[i][TPL_NAME]).trim();
    if (!name || name.indexOf('---') === 0) break; // Stop at token reference section
    if (name) {
      templates[name] = {
        name: name,
        subject: data[i][TPL_SUBJECT] || '',
        preview: data[i][TPL_PREVIEW] || '',
        body: data[i][TPL_BODY] || '',
        version: data[i][TPL_VERSION] || ''
      };
    }
  }
  return templates;
}

/**
 * Reads the Campaigns tab into an array of row arrays.
 * @return {Array[]} Array of campaign row data.
 */
function getCampaigns() {
  var ss = getCampaignSheet_();
  if (!ss) return [];

  var sheet = ss.getSheetByName(TAB_CAMPAIGNS);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  var campaigns = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][CMP_ID]) {
      campaigns.push(data[i]);
    }
  }
  return campaigns;
}


// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Gets the campaign spreadsheet by stored ID.
 * @return {SpreadsheetApp.Spreadsheet|null}
 * @private
 */
function getCampaignSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('CAMPAIGN_SHEET_ID');
  if (!id) return null;
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    Logger.log('Could not open spreadsheet: ' + e.message);
    return null;
  }
}

/**
 * Extracts first name, last name, and company from an email address.
 * @param {string} email - Email address.
 * @return {Object} {firstName, lastName, company}
 * @private
 */
function extractNameFromEmail_(email) {
  var result = { firstName: '', lastName: '', company: '' };
  if (!email) return result;

  var parts = email.split('@');
  if (parts.length < 2) return result;

  var prefix = parts[0];
  var domain = parts[1];

  // Company from domain
  var domainParts = domain.split('.');
  if (domainParts.length > 0) {
    result.company = capitalize_(domainParts[0]);
  }

  // Name from prefix
  if (prefix.indexOf('.') !== -1) {
    var nameParts = prefix.split('.');
    result.firstName = capitalize_(nameParts[0]);
    result.lastName = capitalize_(nameParts.slice(1).join(' '));
  } else if (prefix.indexOf('_') !== -1) {
    var nameParts = prefix.split('_');
    result.firstName = capitalize_(nameParts[0]);
    result.lastName = capitalize_(nameParts.slice(1).join(' '));
  } else {
    result.firstName = capitalize_(prefix);
  }

  return result;
}

/**
 * Capitalizes the first letter of a string.
 * @param {string} str - Input string.
 * @return {string}
 * @private
 */
function capitalize_(str) {
  if (!str) return '';
  str = String(str).trim();
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Normalizes boolean values from Sheets (handles TRUE, 'TRUE', 'true', 1, etc.)
 * @param {*} val - Value to check.
 * @return {boolean}
 * @private
 */
function toBool_(val) {
  if (val === true) return true;
  if (val === false) return false;
  if (typeof val === 'string') return val.toUpperCase() === 'TRUE';
  if (typeof val === 'number') return val !== 0;
  return false;
}

/**
 * Builds a contact row array for the Contacts tab.
 * @param {Date} dateAdded
 * @param {string} addedBy
 * @param {string} source
 * @param {string} firstName
 * @param {string} lastName
 * @param {string} email
 * @param {string} company
 * @param {string} status
 * @param {boolean} existingClient
 * @param {string} campaignTag
 * @param {string} lastCampaignDate
 * @param {boolean} replied
 * @param {boolean} converted
 * @param {boolean} bounced
 * @param {boolean} unsubscribed
 * @param {boolean} suppressed
 * @param {string} suppressionReason
 * @param {string} suppressionDate
 * @param {string} manualRelease
 * @param {string} unsubToken
 * @param {string} notes
 * @return {Array}
 * @private
 */
function buildContactRow_(dateAdded, addedBy, source, firstName, lastName, email, company,
    status, existingClient, campaignTag, lastCampaignDate, replied, converted,
    bounced, unsubscribed, suppressed, suppressionReason, suppressionDate,
    manualRelease, unsubToken, notes) {
  return [
    dateAdded, addedBy, source, firstName, lastName, email, company,
    status, existingClient, campaignTag, lastCampaignDate, replied, converted,
    bounced, unsubscribed, suppressed, suppressionReason, suppressionDate,
    manualRelease, unsubToken, notes
  ];
}

/**
 * Generates the next Campaign ID (CMP-0001, CMP-0002...).
 * @param {SpreadsheetApp.Spreadsheet} ss - The spreadsheet.
 * @return {string}
 * @private
 */
function getNextCampaignId_(ss) {
  var sheet = ss.getSheetByName(TAB_CAMPAIGNS);
  var data = sheet.getDataRange().getValues();
  var maxNum = 0;

  for (var i = 1; i < data.length; i++) {
    var id = String(data[i][CMP_ID]);
    if (id.indexOf('CMP-') === 0) {
      var num = parseInt(id.replace('CMP-', ''), 10);
      if (num > maxNum) maxNum = num;
    }
  }

  var nextNum = maxNum + 1;
  var padded = String(nextNum);
  while (padded.length < 4) padded = '0' + padded;
  return 'CMP-' + padded;
}

/**
 * Enrolls eligible contacts into a campaign's Campaign Contacts tab.
 * @param {Array} campaignRow - Campaign row data.
 * @param {SpreadsheetApp.Spreadsheet} ss - The spreadsheet.
 * @return {number} Number of contacts enrolled.
 * @private
 */
function enrollContacts_(campaignRow, ss) {
  var ccSheet = ss.getSheetByName(TAB_CAMPAIGN_CONTACTS);
  var contactsSheet = ss.getSheetByName(TAB_CONTACTS);
  var contactsData = contactsSheet.getDataRange().getValues();
  var ccData = ccSheet.getDataRange().getValues();

  var campaignId = campaignRow[CMP_ID];
  var campaignName = campaignRow[CMP_NAME];
  var campaignType = campaignRow[CMP_TYPE];

  // Build set of already-enrolled emails for this campaign
  var enrolledEmails = {};
  for (var i = 1; i < ccData.length; i++) {
    if (ccData[i][CC_CAMPAIGN_ID] === campaignId) {
      enrolledEmails[String(ccData[i][CC_EMAIL]).toLowerCase().trim()] = true;
    }
  }

  var newRows = [];
  var now = new Date();

  for (var c = 1; c < contactsData.length; c++) {
    var contact = contactsData[c];
    var email = String(contact[CON_EMAIL]).toLowerCase().trim();
    if (!email) continue;

    // Skip already enrolled
    if (enrolledEmails[email]) continue;

    // Check eligibility
    if (!isContactEligible_(contact, campaignRow)) continue;

    // One active sequence per contact
    if (campaignType === 'Sequence') {
      var otherActive = getActiveCampaignContactsForEmail_(email, ss, campaignId);
      if (otherActive) continue;
    }

    var fullName = ((contact[CON_FIRST_NAME] || '') + ' ' + (contact[CON_LAST_NAME] || '')).trim();

    var ccRow = [];
    for (var col = 0; col <= CC_COMPLETED_REASON; col++) {
      ccRow.push('');
    }

    ccRow[CC_CAMPAIGN_ID] = campaignId;
    ccRow[CC_CAMPAIGN_NAME] = campaignName;
    ccRow[CC_EMAIL] = email;
    ccRow[CC_CONTACT_NAME] = fullName;
    ccRow[CC_CAMPAIGN_TYPE] = campaignType;
    ccRow[CC_STATUS] = 'Pending';
    ccRow[CC_CURRENT_STEP] = 'Initial';
    ccRow[CC_FOLLOWUP_COUNT] = 0;
    ccRow[CC_DATE_ENTERED] = now;

    newRows.push(ccRow);
    enrolledEmails[email] = true;
  }

  if (newRows.length > 0) {
    ccSheet.getRange(
      ccSheet.getLastRow() + 1, 1,
      newRows.length, newRows[0].length
    ).setValues(newRows);
  }

  return newRows.length;
}

/**
 * Validates a campaign row before activation.
 * @param {Array} campaignRow - Campaign row data.
 * @param {Object} templates - Templates map.
 * @return {Object} {valid: boolean, notes: string}
 * @private
 */
function validateCampaign_(campaignRow, templates) {
  var issues = [];

  // Campaign name
  if (!campaignRow[CMP_NAME]) {
    issues.push('Campaign name is required.');
  }

  // Type
  if (campaignRow[CMP_TYPE] !== 'Sequence' && campaignRow[CMP_TYPE] !== 'Blast') {
    issues.push('Campaign type must be Sequence or Blast.');
  }

  // Initial template
  if (!campaignRow[CMP_INITIAL_TEMPLATE]) {
    issues.push('Initial template is required.');
  } else if (!templates[campaignRow[CMP_INITIAL_TEMPLATE]]) {
    issues.push('Initial template "' + campaignRow[CMP_INITIAL_TEMPLATE] + '" not found in Templates tab.');
  }

  // Follow-up templates (for Sequence only)
  if (campaignRow[CMP_TYPE] === 'Sequence') {
    var maxFU = parseInt(campaignRow[CMP_MAX_FOLLOWUPS]) || 0;

    if (maxFU >= 1) {
      if (!campaignRow[CMP_FOLLOWUP1_TPL] || !templates[campaignRow[CMP_FOLLOWUP1_TPL]]) {
        issues.push('Follow-Up 1 template is required (max follow-ups >= 1).');
      }
    }
    if (maxFU >= 2) {
      if (!campaignRow[CMP_FOLLOWUP2_TPL] || !templates[campaignRow[CMP_FOLLOWUP2_TPL]]) {
        issues.push('Follow-Up 2 template is required (max follow-ups >= 2).');
      }
    }
    if (maxFU >= 3) {
      if (!campaignRow[CMP_FOLLOWUP3_TPL] || !templates[campaignRow[CMP_FOLLOWUP3_TPL]]) {
        issues.push('Follow-Up 3 template is required (max follow-ups >= 3).');
      }
    }

    if (!campaignRow[CMP_FOLLOWUP_INTERVAL] || parseInt(campaignRow[CMP_FOLLOWUP_INTERVAL]) < 1) {
      issues.push('Follow-up interval must be at least 1 day for Sequence campaigns.');
    }
  }

  // Daily limit
  var dailyLimit = parseInt(campaignRow[CMP_DAILY_LIMIT]);
  if (!dailyLimit || dailyLimit < 1) {
    issues.push('Daily send limit must be at least 1.');
  }

  // Send window
  var sendStart = parseInt(campaignRow[CMP_SEND_START]);
  var sendEnd = parseInt(campaignRow[CMP_SEND_END]);
  if (isNaN(sendStart) || isNaN(sendEnd) || sendStart >= sendEnd) {
    issues.push('Send window start must be before send window end.');
  }

  // Target type
  var validTargets = ['All Active Leads', 'Existing Clients', 'Non-Clients', 'Campaign Tag', 'Manual List'];
  if (validTargets.indexOf(campaignRow[CMP_TARGET_TYPE]) === -1) {
    issues.push('Invalid target type. Must be one of: ' + validTargets.join(', '));
  }

  // Target value for Campaign Tag and Manual List
  if ((campaignRow[CMP_TARGET_TYPE] === 'Campaign Tag' || campaignRow[CMP_TARGET_TYPE] === 'Manual List') &&
      !campaignRow[CMP_TARGET_VALUE]) {
    issues.push('Target value is required for Campaign Tag and Manual List targeting.');
  }

  // Enrollment mode
  if (campaignRow[CMP_ENROLLMENT_MODE] !== 'Dynamic' && campaignRow[CMP_ENROLLMENT_MODE] !== 'Snapshot') {
    issues.push('Enrollment mode must be Dynamic or Snapshot.');
  }

  // Date validation
  if (campaignRow[CMP_START_DATE] && campaignRow[CMP_END_DATE]) {
    var startDate = new Date(campaignRow[CMP_START_DATE]);
    var endDate = new Date(campaignRow[CMP_END_DATE]);
    if (endDate < startDate) {
      issues.push('End date must be after start date.');
    }
  }

  // Test mode validation
  if ((campaignRow[CMP_TEST_MODE] === true || campaignRow[CMP_TEST_MODE] === 'TRUE') &&
      !campaignRow[CMP_TEST_RECIPIENT]) {
    issues.push('Test recipient email is required when test mode is enabled.');
  }

  return {
    valid: issues.length === 0,
    notes: issues.length > 0 ? issues.join('\n') : 'All validations passed.'
  };
}

/**
 * Checks if a contact is eligible for a campaign based on targeting rules.
 * @param {Array} contactRow - Contact row data.
 * @param {Array} campaignRow - Campaign row data.
 * @return {boolean}
 * @private
 */
function isContactEligible_(contactRow, campaignRow) {
  // Global suppression check
  if (contactRow[CON_SUPPRESSED] === true || contactRow[CON_SUPPRESSED] === 'TRUE') return false;
  if (contactRow[CON_BOUNCED] === true || contactRow[CON_BOUNCED] === 'TRUE') return false;
  if (contactRow[CON_UNSUBSCRIBED] === true || contactRow[CON_UNSUBSCRIBED] === 'TRUE') return false;

  var email = String(contactRow[CON_EMAIL]).toLowerCase().trim();
  if (!email) return false;

  var targetType = campaignRow[CMP_TARGET_TYPE];
  var targetValue = String(campaignRow[CMP_TARGET_VALUE] || '').trim();

  switch (targetType) {
    case 'All Active Leads':
      return contactRow[CON_STATUS] === 'Pending';

    case 'Existing Clients':
      return contactRow[CON_EXISTING_CLIENT] === true || contactRow[CON_EXISTING_CLIENT] === 'TRUE' ||
             contactRow[CON_STATUS] === 'Client';

    case 'Non-Clients':
      return contactRow[CON_EXISTING_CLIENT] !== true && contactRow[CON_EXISTING_CLIENT] !== 'TRUE' &&
             contactRow[CON_STATUS] !== 'Client';

    case 'Campaign Tag':
      return String(contactRow[CON_CAMPAIGN_TAG]).trim() === targetValue;

    case 'Manual List':
      // Manual list: target value is a comma-separated list of emails
      var emails = targetValue.toLowerCase().split(',');
      for (var e = 0; e < emails.length; e++) {
        if (emails[e].trim() === email) return true;
      }
      return false;

    default:
      return false;
  }
}

/**
 * Checks if a contact has an active Campaign Contacts entry in another sequence campaign.
 * @param {string} email - Contact email.
 * @param {SpreadsheetApp.Spreadsheet} ss - The spreadsheet.
 * @param {string} excludeCampaignId - Campaign ID to exclude from check.
 * @return {boolean} True if contact has another active sequence.
 * @private
 */
function getActiveCampaignContactsForEmail_(email, ss, excludeCampaignId) {
  var ccSheet = ss.getSheetByName(TAB_CAMPAIGN_CONTACTS);
  var ccData = ccSheet.getDataRange().getValues();
  var campaignsSheet = ss.getSheetByName(TAB_CAMPAIGNS);
  var campData = campaignsSheet.getDataRange().getValues();

  // Build lookup of active sequence campaign IDs
  var activeSequences = {};
  for (var c = 1; c < campData.length; c++) {
    if (campData[c][CMP_STATUS] === 'Active' && campData[c][CMP_TYPE] === 'Sequence' &&
        campData[c][CMP_ID] !== excludeCampaignId) {
      activeSequences[campData[c][CMP_ID]] = true;
    }
  }

  email = String(email).toLowerCase().trim();

  for (var i = 1; i < ccData.length; i++) {
    var ccEmail = String(ccData[i][CC_EMAIL]).toLowerCase().trim();
    if (ccEmail !== email) continue;

    var ccCampId = ccData[i][CC_CAMPAIGN_ID];
    if (!activeSequences[ccCampId]) continue;

    var ccStatus = ccData[i][CC_STATUS];
    if (ccStatus === 'Pending' || ccStatus === 'Sent' || ccStatus === 'Follow-Up Scheduled') {
      return true;
    }
  }

  return false;
}

/**
 * Counts how many emails were sent today for a specific campaign.
 * @param {string} campaignId - Campaign ID.
 * @param {SpreadsheetApp.Sheet} logSheet - Campaign Log sheet.
 * @return {number}
 * @private
 */
function countCampaignSendsToday_(campaignId, logSheet) {
  var data = logSheet.getDataRange().getValues();
  var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var count = 0;

  for (var i = 1; i < data.length; i++) {
    if (data[i][LOG_CAMPAIGN_ID] !== campaignId) continue;
    if (data[i][LOG_RESULT] !== 'Success') continue;
    var ts = data[i][LOG_TIMESTAMP];
    if (ts) {
      var dateStr = Utilities.formatDate(new Date(ts), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      if (dateStr === todayStr) count++;
    }
  }

  return count;
}

/**
 * Logs a campaign send attempt.
 * @param {SpreadsheetApp.Sheet} logSheet
 * @param {Date} timestamp
 * @param {Array} campaign - Campaign row data.
 * @param {string} email
 * @param {string} contactName
 * @param {string} company
 * @param {string} templateName
 * @param {string} step
 * @param {string} subject
 * @param {string} result - Success, Failed, Skipped.
 * @param {string} error
 * @param {boolean} testMode
 * @private
 */
function logCampaignSend_(logSheet, timestamp, campaign, email, contactName,
    company, templateName, step, subject, result, error, testMode) {
  logSheet.appendRow([
    timestamp,
    campaign[CMP_ID],
    campaign[CMP_NAME],
    email,
    contactName,
    company,
    templateName,
    step,
    subject,
    result,
    error || '',
    testMode === true || testMode === 'TRUE' ? 'Yes' : 'No'
  ]);
}

/**
 * Finds the row number of a campaign by ID.
 * @param {SpreadsheetApp.Spreadsheet} ss
 * @param {string} campaignId
 * @return {number} Row number (1-based) or 0 if not found.
 * @private
 */
function findCampaignRow_(ss, campaignId) {
  var sheet = ss.getSheetByName(TAB_CAMPAIGNS);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][CMP_ID] === campaignId) return i + 1;
  }
  return 0;
}

/**
 * Finds the row number of a contact by email.
 * @param {SpreadsheetApp.Sheet} contactsSheet
 * @param {string} email
 * @return {number} Row number (1-based) or 0 if not found.
 * @private
 */
function findContactRow_(contactsSheet, email) {
  var data = contactsSheet.getDataRange().getValues();
  email = String(email).toLowerCase().trim();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][CON_EMAIL]).toLowerCase().trim() === email) return i + 1;
  }
  return 0;
}

/**
 * Updates campaign stats (totals) from Campaign Contacts data.
 * @param {string} campaignId
 * @param {SpreadsheetApp.Spreadsheet} ss
 * @private
 */
function updateCampaignStats_(campaignId, ss) {
  var ccSheet = ss.getSheetByName(TAB_CAMPAIGN_CONTACTS);
  var ccData = ccSheet.getDataRange().getValues();
  var campaignsSheet = ss.getSheetByName(TAB_CAMPAIGNS);

  var sent = 0, replied = 0, bounced = 0, unsub = 0, converted = 0;

  for (var i = 1; i < ccData.length; i++) {
    if (ccData[i][CC_CAMPAIGN_ID] !== campaignId) continue;

    var st = ccData[i][CC_STATUS];
    if (st === 'Sent' || st === 'Complete' || st === 'Replied' || st === 'Exhausted') sent++;
    if (st === 'Replied') replied++;
    if (st === 'Bounced') bounced++;
    if (st === 'Unsubscribed') unsub++;
    if (ccData[i][CC_CONVERTED] === true || ccData[i][CC_CONVERTED] === 'TRUE') converted++;
  }

  var campRow = findCampaignRow_(ss, campaignId);
  if (campRow > 0) {
    campaignsSheet.getRange(campRow, CMP_TOTAL_SENT + 1).setValue(sent);
    campaignsSheet.getRange(campRow, CMP_TOTAL_REPLIED + 1).setValue(replied);
    campaignsSheet.getRange(campRow, CMP_TOTAL_BOUNCED + 1).setValue(bounced);
    campaignsSheet.getRange(campRow, CMP_TOTAL_UNSUB + 1).setValue(unsub);
    campaignsSheet.getRange(campRow, CMP_TOTAL_CONVERTED + 1).setValue(converted);
  }
}

/**
 * Validates an email address format.
 * @param {string} email
 * @return {boolean}
 * @private
 */
function isValidEmail_(email) {
  if (!email) return false;
  var pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return pattern.test(email);
}

/**
 * Generates an MD5 hash of an email address (for EMAIL_HASH token).
 * @param {string} email
 * @return {string} 32-char hex hash.
 * @private
 */
function generateEmailHash_(email) {
  var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(email).toLowerCase().trim());
  var hash = '';
  for (var i = 0; i < rawHash.length; i++) {
    var byte = rawHash[i];
    if (byte < 0) byte += 256;
    var hex = byte.toString(16);
    if (hex.length === 1) hex = '0' + hex;
    hash += hex;
  }
  return hash;
}


/**
 * Generates a unique searchable tracking marker for sent-email lookup.
 * The marker is per send, not just per contact, to reduce thread collisions.
 * @param {string} campaignId
 * @param {string} email
 * @param {string} step
 * @return {string}
 * @private
 */
function generateTrackingMarker_(campaignId, email, step) {
  var base = [String(campaignId || ''), String(email || '').toLowerCase().trim(), String(step || ''), String((new Date()).getTime())].join('|');
  var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, base);
  var hash = '';
  for (var i = 0; i < rawHash.length; i++) {
    var b = rawHash[i];
    if (b < 0) b += 256;
    var hx = b.toString(16);
    if (hx.length === 1) hx = '0' + hx;
    hash += hx;
  }
  return 'SID-' + hash.toUpperCase();
}

/**
 * Extracts email address from a Gmail "From" header.
 * e.g. "John Doe <john@example.com>" => "john@example.com"
 * @param {string} fromHeader
 * @return {string}
 * @private
 */
function extractEmailFromHeader_(fromHeader) {
  if (!fromHeader) return '';
  var match = fromHeader.match(/<(.+?)>/);
  if (match) return match[1].toLowerCase().trim();
  return fromHeader.toLowerCase().trim();
}

/**
 * Scans for duplicate emails in existing contacts data.
 * @param {string[][]} existingData - Existing contacts data.
 * @param {string} email - Email to check.
 * @return {boolean} True if duplicate found.
 * @private
 */
function scanDuplicates_(existingData, email) {
  email = String(email).toLowerCase().trim();
  for (var i = 1; i < existingData.length; i++) {
    if (String(existingData[i][CON_EMAIL]).toLowerCase().trim() === email) {
      return true;
    }
  }
  return false;
}


// ============================================================================
// ADD NEW CONTACT FORM
// ============================================================================

/**
 * Shows the Add New Contact form dialog.
 */
function showAddContactForm() {
  var html = HtmlService.createHtmlOutput(getAddContactFormHtml_())
    .setWidth(420)
    .setHeight(440)
    .setTitle('Add New Contact');
  SpreadsheetApp.getUi().showModalDialog(html, 'Add New Contact');
}

/**
 * Returns the HTML for the Add Contact form.
 * @private
 */
function getAddContactFormHtml_() {
  return '<!DOCTYPE html><html><head>' +
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">' +
    '<style>' +
    'body{font-family:"Inter",Arial,sans-serif;margin:0;padding:24px;background:#fff;color:#1C1C1C;}' +
    'h2{font-size:18px;font-weight:600;color:#E8692A;margin:0 0 20px 0;letter-spacing:0.5px;}' +
    'label{display:block;font-size:12px;font-weight:500;color:#666;margin-bottom:4px;letter-spacing:0.5px;text-transform:uppercase;}' +
    'input[type=text],input[type=email],select{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;font-family:"Inter",Arial,sans-serif;box-sizing:border-box;margin-bottom:14px;}' +
    'input:focus,select:focus{outline:none;border-color:#E8692A;}' +
    '.required{color:#E8692A;}' +
    '.btn{background:#E8692A;color:#fff;border:none;padding:12px 28px;border-radius:100px;font-size:13px;font-weight:500;letter-spacing:1px;text-transform:uppercase;cursor:pointer;margin-right:8px;}' +
    '.btn:hover{background:#d45a22;}' +
    '.btn-cancel{background:#eee;color:#666;}' +
    '.btn-cancel:hover{background:#ddd;}' +
    '.row{display:flex;gap:12px;}' +
    '.row>div{flex:1;}' +
    '.msg{padding:10px;border-radius:8px;margin-bottom:14px;font-size:13px;display:none;}' +
    '.msg.success{display:block;background:#e8f5e9;color:#2e7d32;}' +
    '.msg.error{display:block;background:#fce4ec;color:#c62828;}' +
    '</style></head><body>' +
    '<h2>Add New Contact</h2>' +
    '<div id="msg" class="msg"></div>' +
    '<div class="row">' +
    '  <div><label>First Name <span class="required">*</span></label><input type="text" id="firstName"></div>' +
    '  <div><label>Last Name <span class="required">*</span></label><input type="text" id="lastName"></div>' +
    '</div>' +
    '<label>Email <span class="required">*</span></label><input type="email" id="email">' +
    '<label>Company</label><input type="text" id="company">' +
    '<label>Existing Client?</label>' +
    '<select id="existingClient"><option value="false">No</option><option value="true">Yes</option></select>' +
    '<label>Campaign Tag (optional)</label><input type="text" id="campaignTag" placeholder="e.g. Software Launch">' +
    '<div style="margin-top:8px;">' +
    '  <button class="btn" onclick="submitContact()">Add Contact</button>' +
    '  <button class="btn btn-cancel" onclick="google.script.host.close()">Cancel</button>' +
    '</div>' +
    '<script>' +
    'function submitContact(){' +
    '  var d={firstName:document.getElementById("firstName").value.trim(),' +
    '    lastName:document.getElementById("lastName").value.trim(),' +
    '    email:document.getElementById("email").value.trim(),' +
    '    company:document.getElementById("company").value.trim(),' +
    '    existingClient:document.getElementById("existingClient").value==="true",' +
    '    campaignTag:document.getElementById("campaignTag").value.trim()};' +
    '  if(!d.firstName||!d.lastName||!d.email){showMsg("error","First Name, Last Name, and Email are required.");return;}' +
    '  if(d.email.indexOf("@")===-1){showMsg("error","Please enter a valid email address.");return;}' +
    '  google.script.run.withSuccessHandler(function(r){' +
    '    if(r.success){showMsg("success",r.message);' +
    '      document.getElementById("firstName").value="";document.getElementById("lastName").value="";' +
    '      document.getElementById("email").value="";document.getElementById("company").value="";' +
    '      document.getElementById("campaignTag").value="";}' +
    '    else{showMsg("error",r.message);}' +
    '  }).withFailureHandler(function(e){showMsg("error","Error: "+e.message);}).addContactFromForm(d);}' +
    'function showMsg(t,m){var el=document.getElementById("msg");el.className="msg "+t;el.textContent=m;}' +
    '</script></body></html>';
}

/**
 * Server-side handler for the Add Contact form.
 * @param {Object} data - Form data.
 * @return {Object} {success: boolean, message: string}
 */
function addContactFromForm(data) {
  try {
    var ss = getCampaignSheet_();
    var sheet = ss.getSheetByName(TAB_CONTACTS);
    var existingData = sheet.getDataRange().getValues();

    // Check for duplicate
    var emailLower = String(data.email).toLowerCase().trim();
    for (var i = 1; i < existingData.length; i++) {
      if (String(existingData[i][CON_EMAIL]).toLowerCase().trim() === emailLower) {
        return { success: false, message: 'This email already exists in the Contacts list.' };
      }
    }

    var now = new Date();
    var status = data.existingClient ? 'Client' : 'Pending';
    var row = [];
    for (var c = 0; c <= CON_NOTES; c++) row.push('');

    row[CON_DATE_ADDED] = now;
    row[CON_ADDED_BY] = 'Form';
    row[CON_SOURCE] = 'Manual Entry';
    row[CON_FIRST_NAME] = data.firstName;
    row[CON_LAST_NAME] = data.lastName;
    row[CON_EMAIL] = data.email;
    row[CON_COMPANY] = data.company || '';
    row[CON_STATUS] = status;
    row[CON_EXISTING_CLIENT] = data.existingClient ? true : false;
    row[CON_CAMPAIGN_TAG] = data.campaignTag || '';

    sheet.appendRow(row);
    return { success: true, message: data.firstName + ' ' + data.lastName + ' added successfully!' };
  } catch (e) {
    return { success: false, message: 'Error: ' + e.message };
  }
}


// ============================================================================
// CREATE NEW CAMPAIGN FORM
// ============================================================================

/**
 * Shows the Create New Campaign form dialog.
 */
function showCreateCampaignForm() {
  // Get template names for the dropdown
  var templates = getTemplates();
  var templateNames = Object.keys(templates);
  var templateOptions = '<option value="">-- Select Template --</option>';
  for (var i = 0; i < templateNames.length; i++) {
    templateOptions += '<option value="' + templateNames[i] + '">' + templateNames[i] + '</option>';
  }

  var html = HtmlService.createHtmlOutput(getCreateCampaignFormHtml_(templateOptions))
    .setWidth(500)
    .setHeight(620)
    .setTitle('Create New Campaign');
  SpreadsheetApp.getUi().showModalDialog(html, 'Create New Campaign');
}

/**
 * Returns the HTML for the Create Campaign form.
 * @param {string} templateOptions - HTML option tags for template dropdowns.
 * @private
 */
function getCreateCampaignFormHtml_(templateOptions) {
  return '<!DOCTYPE html><html><head>' +
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">' +
    '<style>' +
    'body{font-family:"Inter",Arial,sans-serif;margin:0;padding:24px;background:#fff;color:#1C1C1C;overflow-y:auto;}' +
    'h2{font-size:18px;font-weight:600;color:#E8692A;margin:0 0 16px 0;}' +
    'label{display:block;font-size:11px;font-weight:500;color:#666;margin-bottom:3px;letter-spacing:0.5px;text-transform:uppercase;}' +
    'input[type=text],input[type=number],select{width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;font-family:"Inter",Arial,sans-serif;box-sizing:border-box;margin-bottom:10px;}' +
    'input:focus,select:focus{outline:none;border-color:#E8692A;}' +
    '.row{display:flex;gap:10px;}.row>div{flex:1;}' +
    '.section{font-size:12px;font-weight:600;color:#E8692A;text-transform:uppercase;letter-spacing:1px;margin:14px 0 8px 0;border-bottom:1px solid #eee;padding-bottom:4px;}' +
    '.btn{background:#E8692A;color:#fff;border:none;padding:12px 28px;border-radius:100px;font-size:12px;font-weight:500;letter-spacing:1px;text-transform:uppercase;cursor:pointer;margin-right:8px;}' +
    '.btn:hover{background:#d45a22;}' +
    '.btn-cancel{background:#eee;color:#666;}.btn-cancel:hover{background:#ddd;}' +
    '.msg{padding:8px;border-radius:8px;margin-bottom:10px;font-size:12px;display:none;}' +
    '.msg.success{display:block;background:#e8f5e9;color:#2e7d32;}' +
    '.msg.error{display:block;background:#fce4ec;color:#c62828;}' +
    '.hint{font-size:11px;color:#999;margin:-6px 0 10px 0;}' +
    '</style></head><body>' +
    '<h2>Create New Campaign</h2>' +
    '<div id="msg" class="msg"></div>' +
    '<label>Campaign Name *</label><input type="text" id="name" placeholder="e.g. Designer Prospecting Q1">' +
    '<div class="row">' +
    '  <div><label>Type</label><select id="type"><option value="Sequence">Sequence (with follow-ups)</option><option value="Blast">Blast (single email)</option></select></div>' +
    '  <div><label>Priority</label><input type="number" id="priority" value="10" min="1" max="99">' +
    '  <div class="hint">Lower = higher priority</div></div>' +
    '</div>' +
    '<div class="section">Targeting</div>' +
    '<div class="row">' +
    '  <div><label>Target Type</label><select id="targetType">' +
    '    <option value="All Active Leads">All Active Leads</option>' +
    '    <option value="Existing Clients">Existing Clients</option>' +
    '    <option value="Non-Clients">Non-Clients</option>' +
    '    <option value="Campaign Tag">Campaign Tag</option>' +
    '    <option value="Manual List">Manual List</option>' +
    '  </select></div>' +
    '  <div><label>Target Value</label><input type="text" id="targetValue" placeholder="Tag or list name">' +
    '  <div class="hint">Only for Campaign Tag or Manual List</div></div>' +
    '</div>' +
    '<label>Enrollment Mode</label><select id="enrollment"><option value="Dynamic">Dynamic (keeps adding new matches)</option><option value="Snapshot">Snapshot (fixed list at activation)</option></select>' +
    '<div class="section">Templates</div>' +
    '<label>Initial Template *</label><select id="tplInitial">' + templateOptions + '</select>' +
    '<div class="row">' +
    '  <div><label>Follow-Up 1</label><select id="tplFU1"><option value="">None</option>' + templateOptions.replace('-- Select Template --', '-- None --') + '</select></div>' +
    '  <div><label>Follow-Up 2</label><select id="tplFU2"><option value="">None</option>' + templateOptions.replace('-- Select Template --', '-- None --') + '</select></div>' +
    '  <div><label>Follow-Up 3</label><select id="tplFU3"><option value="">None</option>' + templateOptions.replace('-- Select Template --', '-- None --') + '</select></div>' +
    '</div>' +
    '<div class="section">Send Settings</div>' +
    '<div class="row">' +
    '  <div><label>Max Follow-Ups</label><input type="number" id="maxFU" value="3" min="0" max="3"></div>' +
    '  <div><label>Interval (days)</label><input type="number" id="interval" value="7" min="1" max="30"></div>' +
    '  <div><label>Daily Limit</label><input type="number" id="dailyLimit" value="30" min="1" max="200"></div>' +
    '</div>' +
    '<div class="row">' +
    '  <div><label>Send Window Start</label><input type="number" id="sendStart" value="8" min="0" max="23"></div>' +
    '  <div><label>Send Window End</label><input type="number" id="sendEnd" value="17" min="1" max="24"></div>' +
    '</div>' +
    '<div class="section">Testing</div>' +
    '<div class="row">' +
    '  <div><label>Test Mode</label><select id="testMode"><option value="true" selected>On (sends to test email only)</option><option value="false">Off (sends to real contacts)</option></select></div>' +
    '  <div><label>Test Recipient</label><input type="text" id="testRecipient" value="justin@stridenw.com"></div>' +
    '</div>' +
    '<div style="margin-top:14px;">' +
    '  <button class="btn" onclick="submitCampaign()">Create Campaign</button>' +
    '  <button class="btn btn-cancel" onclick="google.script.host.close()">Cancel</button>' +
    '</div>' +
    '<script>' +
    'function submitCampaign(){' +
    '  var d={name:document.getElementById("name").value.trim(),' +
    '    type:document.getElementById("type").value,' +
    '    priority:parseInt(document.getElementById("priority").value)||10,' +
    '    targetType:document.getElementById("targetType").value,' +
    '    targetValue:document.getElementById("targetValue").value.trim(),' +
    '    enrollment:document.getElementById("enrollment").value,' +
    '    tplInitial:document.getElementById("tplInitial").value,' +
    '    tplFU1:document.getElementById("tplFU1").value,' +
    '    tplFU2:document.getElementById("tplFU2").value,' +
    '    tplFU3:document.getElementById("tplFU3").value,' +
    '    maxFU:parseInt(document.getElementById("maxFU").value)||0,' +
    '    interval:parseInt(document.getElementById("interval").value)||7,' +
    '    dailyLimit:parseInt(document.getElementById("dailyLimit").value)||30,' +
    '    sendStart:parseInt(document.getElementById("sendStart").value)||8,' +
    '    sendEnd:parseInt(document.getElementById("sendEnd").value)||17,' +
    '    testMode:document.getElementById("testMode").value==="true",' +
    '    testRecipient:document.getElementById("testRecipient").value.trim()};' +
    '  if(!d.name){showMsg("error","Campaign name is required.");return;}' +
    '  if(!d.tplInitial){showMsg("error","Initial Template is required.");return;}' +
    '  google.script.run.withSuccessHandler(function(r){' +
    '    if(r.success){showMsg("success",r.message);setTimeout(function(){google.script.host.close();},1500);}' +
    '    else{showMsg("error",r.message);}' +
    '  }).withFailureHandler(function(e){showMsg("error","Error: "+e.message);}).createCampaignFromForm(d);}' +
    'function showMsg(t,m){var el=document.getElementById("msg");el.className="msg "+t;el.textContent=m;}' +
    '</script></body></html>';
}

/**
 * Server-side handler for the Create Campaign form.
 * @param {Object} data - Form data.
 * @return {Object} {success: boolean, message: string}
 */
function createCampaignFromForm(data) {
  try {
    var ss = getCampaignSheet_();
    var sheet = ss.getSheetByName(TAB_CAMPAIGNS);
    var nextId = getNextCampaignId_(ss);
    var now = new Date();

    var newRow = [];
    for (var i = 0; i <= CMP_CUSTOM3; i++) {
      newRow.push('');
    }

    newRow[CMP_ID] = nextId;
    newRow[CMP_NAME] = data.name;
    newRow[CMP_TYPE] = data.type;
    newRow[CMP_STATUS] = 'Draft';
    newRow[CMP_PRIORITY] = data.priority;
    newRow[CMP_TARGET_TYPE] = data.targetType;
    newRow[CMP_TARGET_VALUE] = data.targetValue || '';
    newRow[CMP_ENROLLMENT_MODE] = data.enrollment;
    newRow[CMP_INITIAL_TEMPLATE] = data.tplInitial;
    newRow[CMP_FOLLOWUP1_TPL] = data.tplFU1 || '';
    newRow[CMP_FOLLOWUP2_TPL] = data.tplFU2 || '';
    newRow[CMP_FOLLOWUP3_TPL] = data.tplFU3 || '';
    newRow[CMP_MAX_FOLLOWUPS] = data.maxFU;
    newRow[CMP_FOLLOWUP_INTERVAL] = data.interval;
    newRow[CMP_DAILY_LIMIT] = data.dailyLimit;
    newRow[CMP_SEND_START] = data.sendStart;
    newRow[CMP_SEND_END] = data.sendEnd;
    newRow[CMP_TEST_MODE] = data.testMode;
    newRow[CMP_TEST_RECIPIENT] = data.testRecipient || '';
    newRow[CMP_CREATED_DATE] = now;
    newRow[CMP_TOTAL_SENT] = 0;
    newRow[CMP_TOTAL_REPLIED] = 0;
    newRow[CMP_TOTAL_BOUNCED] = 0;
    newRow[CMP_TOTAL_UNSUB] = 0;
    newRow[CMP_TOTAL_CONVERTED] = 0;

    sheet.appendRow(newRow);

    return { success: true, message: 'Campaign "' + data.name + '" created as ' + nextId + '! Status: Draft. Select the row and click Activate when ready.' };
  } catch (e) {
    return { success: false, message: 'Error: ' + e.message };
  }
}


// ============================================================================
// ADD NEW TEMPLATE FORM
// ============================================================================

/**
 * Shows the Add New Template form dialog.
 */
function showAddTemplateForm() {
  var html = HtmlService.createHtmlOutput(getAddTemplateFormHtml_())
    .setWidth(560)
    .setHeight(520)
    .setTitle('Add New Template');
  SpreadsheetApp.getUi().showModalDialog(html, 'Add New Template');
}

/**
 * Returns the HTML for the Add Template form.
 * @private
 */
function getAddTemplateFormHtml_() {
  return '<!DOCTYPE html><html><head>' +
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">' +
    '<style>' +
    'body{font-family:"Inter",Arial,sans-serif;margin:0;padding:24px;background:#fff;color:#1C1C1C;overflow-y:auto;}' +
    'h2{font-size:18px;font-weight:600;color:#E8692A;margin:0 0 16px 0;}' +
    'label{display:block;font-size:11px;font-weight:500;color:#666;margin-bottom:3px;letter-spacing:0.5px;text-transform:uppercase;}' +
    'input[type=text],textarea{width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;font-family:"Inter",Arial,sans-serif;box-sizing:border-box;margin-bottom:12px;}' +
    'textarea{height:140px;resize:vertical;font-family:monospace;font-size:12px;}' +
    'input:focus,textarea:focus{outline:none;border-color:#E8692A;}' +
    '.required{color:#E8692A;}' +
    '.btn{background:#E8692A;color:#fff;border:none;padding:12px 28px;border-radius:100px;font-size:12px;font-weight:500;letter-spacing:1px;text-transform:uppercase;cursor:pointer;margin-right:8px;}' +
    '.btn:hover{background:#d45a22;}' +
    '.btn-cancel{background:#eee;color:#666;}.btn-cancel:hover{background:#ddd;}' +
    '.msg{padding:8px;border-radius:8px;margin-bottom:10px;font-size:12px;display:none;}' +
    '.msg.success{display:block;background:#e8f5e9;color:#2e7d32;}' +
    '.msg.error{display:block;background:#fce4ec;color:#c62828;}' +
    '.hint{font-size:11px;color:#999;margin:-8px 0 12px 0;}' +
    '.tokens{background:#f9f7f5;border:1px solid #eee;border-radius:8px;padding:12px;margin-bottom:14px;font-size:11px;color:#666;line-height:1.8;}' +
    '.tokens code{background:#fff;padding:2px 6px;border-radius:4px;color:#E8692A;font-size:11px;}' +
    '</style></head><body>' +
    '<h2>Add New Template</h2>' +
    '<div id="msg" class="msg"></div>' +
    '<label>Template Name <span class="required">*</span></label>' +
    '<input type="text" id="templateName" placeholder="e.g. Software Launch Initial">' +
    '<div class="hint">Must match exactly when referenced in a Campaign</div>' +
    '<label>Subject Line <span class="required">*</span></label>' +
    '<input type="text" id="subject" placeholder="e.g. Exciting news from Stride, {{First Name}}">' +
    '<label>Preview Text</label>' +
    '<input type="text" id="preview" placeholder="Text shown in inbox before opening the email">' +
    '<label>Version</label>' +
    '<input type="text" id="version" placeholder="e.g. v1" value="v1">' +
    '<div class="tokens"><strong>Available tokens:</strong><br>' +
    '<code>{{First Name}}</code> <code>{{Last Name}}</code> <code>{{Company}}</code> <code>{{Email}}</code> ' +
    '<code>{{BookingURL}}</code> <code>{{UNSUB_URL}}</code> <code>{{EMAIL_HASH}}</code> ' +
    '<code>{{Campaign Name}}</code> <code>{{Sender Name}}</code> <code>{{Sender Phone}}</code> ' +
    '<code>{{Current Year}}</code> <code>{{Send Date}}</code> <code>{{Custom 1}}</code> <code>{{Custom 2}}</code> <code>{{Custom 3}}</code></div>' +
    '<label>HTML Body <span class="required">*</span></label>' +
    '<textarea id="htmlBody" placeholder="Paste your full HTML email code here..."></textarea>' +
    '<div class="hint">Paste complete HTML including &lt;!DOCTYPE&gt; tag. Must contain {{UNSUB_URL}} somewhere.</div>' +
    '<div style="margin-top:10px;">' +
    '  <button class="btn" onclick="submitTemplate()">Add Template</button>' +
    '  <button class="btn btn-cancel" onclick="google.script.host.close()">Cancel</button>' +
    '</div>' +
    '<script>' +
    'function submitTemplate(){' +
    '  var d={name:document.getElementById("templateName").value.trim(),' +
    '    subject:document.getElementById("subject").value.trim(),' +
    '    preview:document.getElementById("preview").value.trim(),' +
    '    version:document.getElementById("version").value.trim(),' +
    '    htmlBody:document.getElementById("htmlBody").value};' +
    '  if(!d.name){showMsg("error","Template Name is required.");return;}' +
    '  if(!d.subject){showMsg("error","Subject Line is required.");return;}' +
    '  if(!d.htmlBody){showMsg("error","HTML Body is required.");return;}' +
    '  if(d.htmlBody.indexOf("{{UNSUB_URL}}")===-1){showMsg("error","HTML Body must contain {{UNSUB_URL}} for the unsubscribe link.");return;}' +
    '  google.script.run.withSuccessHandler(function(r){' +
    '    if(r.success){showMsg("success",r.message);setTimeout(function(){google.script.host.close();},1500);}' +
    '    else{showMsg("error",r.message);}' +
    '  }).withFailureHandler(function(e){showMsg("error","Error: "+e.message);}).addTemplateFromForm(d);}' +
    'function showMsg(t,m){var el=document.getElementById("msg");el.className="msg "+t;el.textContent=m;}' +
    '</script></body></html>';
}

/**
 * Server-side handler for the Add Template form.
 * @param {Object} data - Form data.
 * @return {Object} {success: boolean, message: string}
 */
function addTemplateFromForm(data) {
  try {
    var ss = getCampaignSheet_();
    var sheet = ss.getSheetByName(TAB_TEMPLATES);
    var existing = sheet.getDataRange().getValues();

    // Check for duplicate name
    for (var i = 1; i < existing.length; i++) {
      if (String(existing[i][0]).trim() === data.name) {
        return { success: false, message: 'A template named "' + data.name + '" already exists. Use a different name or edit the existing one directly in the sheet.' };
      }
    }

    // Find first empty row (skip token reference section)
    var insertRow = sheet.getLastRow() + 1;
    for (var r = 1; r < existing.length; r++) {
      if (String(existing[r][0]).indexOf('---') > -1) {
        insertRow = r + 1; // Insert before token reference
        break;
      }
    }

    sheet.insertRowBefore(insertRow);
    sheet.getRange(insertRow, 1).setValue(data.name);
    sheet.getRange(insertRow, 2).setValue(data.subject);
    sheet.getRange(insertRow, 3).setValue(data.preview || '');
    sheet.getRange(insertRow, 4).setValue(data.htmlBody);
    sheet.getRange(insertRow, 5).setValue(data.version || 'v1');

    return { success: true, message: 'Template "' + data.name + '" added!' };
  } catch (e) {
    return { success: false, message: 'Error: ' + e.message };
  }
}
