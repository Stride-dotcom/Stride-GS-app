/**
 * build-settlement-template.mjs
 * Populates the Settlement Agreement Google Doc template with layout + all 17 tokens.
 * Uses Drive API to push HTML content into the existing Google Doc.
 * Run from: stride-client-inventory/ directory
 * Usage: node admin/build-settlement-template.mjs
 */
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRED_PATH = join(__dirname, '.credentials.json');

// Settlement template doc ID (from CB Claims_Config SETTLEMENT_TEMPLATE_DOC_ID)
const DOC_ID = '1zVmZkV-0bd9TVDlSU---QjqVib2EAxdXXAW5G1yF4-A';

const HTML = `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #1E293B; margin: 0; padding: 0; font-size: 10pt; }
  table { border-collapse: collapse; }
  .label { font-size: 8pt; color: #64748B; font-weight: bold; text-transform: uppercase; }
  .section-box { border: 1px solid #CBD5E1; padding: 8px 10px; margin-bottom: 10px; }
  .no-border td { border: none; }
  .sig-line { border-bottom: 1.5px solid #1E293B; height: 38px; }
  .footer { font-size: 8.5pt; color: #94A3B8; border-top: 1px solid #E2E8F0; padding-top: 6px; margin-top: 16px; }
</style>
</head>
<body>

<!-- HEADER -->
<table width="100%" style="margin-bottom:8px; border:none;">
  <tr>
    <td style="width:55%; vertical-align:middle;">
      <span style="font-size:18pt; font-weight:bold; color:#1E293B;">Stride Logistics </span><span style="font-size:18pt; font-weight:bold; color:#E85D2D;">WMS</span><br>
      <span style="font-size:8.5pt; color:#64748B;">Kent, WA &nbsp;&middot;&nbsp; whse@stridenw.com &nbsp;&middot;&nbsp; 206-550-1848</span>
    </td>
    <td style="text-align:right; vertical-align:middle; width:45%;">
      <span style="font-size:18pt; font-weight:bold; color:#1E293B;">Settlement Agreement</span><br>
      <span style="font-size:9.5pt; color:#64748B;">Claim {{CLAIM_NO}} &nbsp;&middot;&nbsp; Version {{SETTLEMENT_VERSION}}</span>
    </td>
  </tr>
</table>
<hr style="border:none; border-top:2px solid #E2E8F0; margin-bottom:12px;">

<!-- CLAIM DETAILS + CLAIMANT INFO -->
<table width="100%" style="margin-bottom:12px; border:none;">
  <tr>
    <td style="width:50%; vertical-align:top; padding-right:8px; border:none;">
      <div style="padding:8px 10px; margin-bottom:10px;">
        <div class="label" style="margin-bottom:6px;">Claim Details</div>
        <table style="border:none;">
          <tr><td style="font-size:8.5pt; color:#64748B; width:105px; padding:1px 0; border:none;">Claim #</td><td style="font-size:11pt; font-weight:bold; border:none;">{{CLAIM_NO}}</td></tr>
          <tr><td style="font-size:8.5pt; color:#64748B; padding:1px 0; border:none;">Claim Type</td><td style="font-size:10pt; border:none;">{{CLAIM_TYPE}}</td></tr>
          <tr><td style="font-size:8.5pt; color:#64748B; padding:1px 0; border:none;">Date Opened</td><td style="font-size:10pt; border:none;">{{DATE_OPENED}}</td></tr>
          <tr><td style="font-size:8.5pt; color:#64748B; padding:1px 0; border:none;">Incident Date</td><td style="font-size:10pt; border:none;">{{INCIDENT_DATE}}</td></tr>
          <tr><td style="font-size:8.5pt; color:#64748B; padding:1px 0; border:none;">Settlement Date</td><td style="font-size:10pt; font-weight:bold; border:none;">{{SETTLEMENT_DATE}}</td></tr>
          <tr><td style="font-size:8.5pt; color:#64748B; padding:1px 0; border:none;">Version</td><td style="font-size:10pt; border:none;">{{SETTLEMENT_VERSION}}</td></tr>
        </table>
      </div>
    </td>
    <td style="width:50%; vertical-align:top; border:none;">
      <div style="padding:8px 10px; margin-bottom:10px;">
        <div class="label" style="margin-bottom:6px;">Claimant</div>
        <div style="font-size:13pt; font-weight:bold; margin-bottom:2px;">{{CLAIMANT_NAME}}</div>
        <div style="font-size:11pt; margin-bottom:6px;">{{COMPANY_NAME}}</div>
        <table style="border:none;">
          <tr><td style="font-size:8.5pt; color:#64748B; width:95px; padding:1px 0; border:none;">Coverage Type</td><td style="font-size:10pt; border:none;">{{COVERAGE_TYPE}}</td></tr>
        </table>
      </div>
    </td>
  </tr>
</table>

<!-- ITEM REFERENCE -->
<div class="label" style="margin-bottom:4px;">Item / Property Reference</div>
<div style="margin-bottom:12px; font-size:10pt;">{{ITEM_REFERENCE}}</div>

<!-- ISSUE DESCRIPTION -->
<div class="label" style="margin-bottom:4px;">Issue Description</div>
<div style="margin-bottom:12px; font-size:10pt; line-height:1.5;">{{ISSUE_DESCRIPTION}}</div>

<!-- SETTLEMENT TERMS TABLE -->
<div class="label" style="margin-bottom:4px;">Settlement Terms</div>
<table width="100%" style="border-collapse:collapse; margin-bottom:12px; border:1px solid #E2E8F0;">
  <tr style="background-color:#E85D2D;">
    <td style="padding:5px 8px; font-size:8.5pt; color:#ffffff; font-weight:bold; width:38%;">Term</td>
    <td style="padding:5px 8px; font-size:8.5pt; color:#ffffff; font-weight:bold;">Value</td>
  </tr>
  <tr>
    <td style="padding:5px 8px; font-size:8.5pt; color:#64748B; border-bottom:1px solid #E2E8F0;">Outcome</td>
    <td style="padding:5px 8px; font-size:11pt; font-weight:bold; border-bottom:1px solid #E2E8F0;">{{OUTCOME_TYPE}}</td>
  </tr>
  <tr style="background-color:#F8FAFC;">
    <td style="padding:5px 8px; font-size:8.5pt; color:#64748B; border-bottom:1px solid #E2E8F0;">Resolution Type</td>
    <td style="padding:5px 8px; font-size:10pt; border-bottom:1px solid #E2E8F0;">{{RESOLUTION_TYPE}}</td>
  </tr>
  <tr>
    <td style="padding:5px 8px; font-size:8.5pt; color:#64748B; border-bottom:1px solid #E2E8F0;">Requested Amount</td>
    <td style="padding:5px 8px; font-size:10pt; border-bottom:1px solid #E2E8F0;">{{REQUESTED_AMOUNT}}</td>
  </tr>
  <tr style="background-color:#FFF7ED;">
    <td style="padding:6px 8px; font-size:8.5pt; color:#64748B; font-weight:bold; border-bottom:1px solid #E2E8F0;">Approved Settlement Amount</td>
    <td style="padding:6px 8px; font-size:15pt; font-weight:bold; color:#E85D2D; border-bottom:1px solid #E2E8F0;">{{APPROVED_AMOUNT}}</td>
  </tr>
  <tr style="background-color:#F8FAFC;">
    <td style="padding:5px 8px; font-size:8.5pt; color:#64748B; vertical-align:top;">Decision / Terms</td>
    <td style="padding:5px 8px; font-size:10pt; line-height:1.5;">{{DECISION_EXPLANATION}}</td>
  </tr>
</table>

<!-- LEGAL TERMS -->
<div class="label" style="margin-bottom:4px;">Legal Terms &amp; Release</div>
<div class="section-box" style="margin-bottom:16px; font-size:8.5pt; color:#475569; line-height:1.6;">{{LEGAL_TERMS}}</div>

<!-- SIGNATURES -->
<div class="label" style="margin-bottom:14px;">Warehouse Use Only — Signatures Required</div>
<table width="100%" style="margin-bottom:16px; border:none;">
  <tr>
    <td style="width:46%; border:none; border-bottom:1.5px solid #1E293B; height:38px; padding:0;"></td>
    <td style="width:8%; border:none;"></td>
    <td style="width:46%; border:none; border-bottom:1.5px solid #1E293B; height:38px; padding:0;"></td>
  </tr>
  <tr>
    <td style="font-size:8.5pt; color:#64748B; padding-top:3px; border:none;">Claimant Signature / Date</td>
    <td style="border:none;"></td>
    <td style="font-size:8.5pt; color:#64748B; padding-top:3px; border:none;">Printed Name</td>
  </tr>
</table>
<table width="100%" style="margin-bottom:40px; border:none;">
  <tr>
    <td style="width:46%; border:none; border-bottom:1.5px solid #1E293B; height:38px; padding:0;"></td>
    <td style="width:54%; border:none;"></td>
  </tr>
  <tr>
    <td style="font-size:8.5pt; color:#64748B; padding-top:3px; border:none;">Stride Representative / Date</td>
    <td style="border:none;"></td>
  </tr>
</table>

<!-- FOOTER -->
<div class="footer">Stride Logistics &nbsp;&middot;&nbsp; 206-550-1848 &nbsp;&middot;&nbsp; whse@stridenw.com</div>

</body>
</html>`;

async function main() {
  console.log('Reading credentials...');
  const creds = JSON.parse(readFileSync(CRED_PATH, 'utf8'));

  const auth = new google.auth.OAuth2(creds.client_id, creds.client_secret);
  auth.setCredentials({
    access_token: creds.access_token,
    refresh_token: creds.refresh_token,
    token_type: creds.token_type,
  });

  const drive = google.drive({ version: 'v3', auth });

  console.log('Pushing settlement template content to Google Doc...');
  console.log('Doc ID:', DOC_ID);

  const result = await drive.files.update({
    fileId: DOC_ID,
    media: {
      mimeType: 'text/html',
      body: Readable.from([HTML]),
    },
  });

  console.log('✅ Done. Status:', result.status);
  console.log('');
  console.log('Open the doc to verify the layout:');
  console.log('https://docs.google.com/document/d/' + DOC_ID + '/edit');
  console.log('');
  console.log('All 17 tokens are placed. The backend will replace them when generating a settlement PDF.');
}

main().catch(err => {
  console.error('❌ Error:', err.message || err);
  process.exit(1);
});
