/**
 * intakePdf — generates a printable signed T&C PDF for the client.
 *
 * Fetches the DOC_CLIENT_TC template body from Supabase, injects the
 * signatory's name, initials, and signature into a Stride-branded print
 * shell, then opens a new window and triggers window.print() so the
 * client can save to PDF or print a physical copy.
 *
 * Mirrors the quotePdf.ts pattern (fetch template → DOM inject → print).
 */
import { supabase } from './supabase';

export interface SignedTcPdfParams {
  businessName: string;
  contactName: string;
  email: string;
  signedAt?: string;            // ISO string or formatted — falls back to now()
  insuranceChoice: string;      // 'own_policy' | 'stride_coverage' | 'eis_coverage' | ''
  signatureType: 'typed' | 'drawn';
  signatureData: string;        // typed name OR base64 PNG data URL
  sectionInitials: Record<string, string>; // { storage: 'ABC', ... }
}

const SECTION_LABELS: Record<string, string> = {
  storage:   '§1 — How we work together',
  insurance: '§2 — Coverage & liability',
  billing:   '§3 — Billing & payment',
  lien:      '§4 — Our lien on your goods',
  general:   '§5 — Everything else',
};

const INSURANCE_LABELS: Record<string, string> = {
  own_policy:      'My own policy',
  stride_coverage: "Add me to Stride's policy",
  eis_coverage:    "Add me to Stride's policy",
};

export async function generateSignedTcPdf(params: SignedTcPdfParams): Promise<void> {
  // 1. Fetch template body from Supabase (anon key — DOC_CLIENT_TC is publicly readable)
  const { data } = await supabase
    .from('email_templates')
    .select('body')
    .eq('template_key', 'DOC_CLIENT_TC')
    .single();

  if (!data?.body) {
    alert('Agreement template is not available. Please contact Stride Logistics for a copy.');
    return;
  }

  const signedDate = params.signedAt
    ? new Date(params.signedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const coverageLabel = INSURANCE_LABELS[params.insuranceChoice] ?? params.insuranceChoice ?? '—';

  // 2. Substitute standard tokens
  let body = data.body
    .replace(/\{\{BUSINESS_NAME\}\}/g, esc(params.businessName))
    .replace(/\{\{CONTACT_NAME\}\}/g, esc(params.contactName))
    .replace(/\{\{SIGNED_DATE\}\}/g, esc(signedDate));

  // Coverage-option notes: leave blank (they're already in the template prose)
  body = body.replace(/\{\{COVERAGE_[A-Z_]+_NOTE\}\}/g, '');

  // 3. DOM-inject initials + signature
  body = injectInitialsAndSignature(body, params, signedDate, coverageLabel);

  // 4. Wrap in branded print shell
  const html = buildPrintShell(body, params.businessName, params.contactName, signedDate);

  // 5. Open window and print
  const win = window.open('', '_blank');
  if (!win) {
    alert('Please allow pop-ups for this site, then try again.');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  // Short delay lets the browser render before the print dialog fires
  setTimeout(() => {
    try { win.print(); } catch { /* user may have closed window */ }
  }, 450);
}

// ─── DOM injection ────────────────────────────────────────────────────────────

function injectInitialsAndSignature(
  body: string,
  params: SignedTcPdfParams,
  signedDate: string,
  coverageLabel: string,
): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${body}</body>`, 'text/html');
  const bodyEl = doc.body;

  // Inject initials block at end of each data-tc-section
  bodyEl.querySelectorAll<HTMLElement>('section[data-tc-section]').forEach(section => {
    const key = section.getAttribute('data-tc-section') ?? '';
    const val = params.sectionInitials[key] ?? '—';
    const label = SECTION_LABELS[key] ?? key;
    const stub = doc.createElement('div');
    stub.setAttribute('class', 'initials-stub');
    stub.innerHTML = `
      <span class="initials-label">Initials</span>
      <span class="initials-pill">${esc(val)}</span>
      <span class="initials-section">${esc(label)}</span>`;
    section.appendChild(stub);
  });

  // Inject coverage choice highlight into insurance section
  const insuranceSection = bodyEl.querySelector<HTMLElement>('section[data-tc-section="insurance"]');
  if (insuranceSection) {
    const choiceDiv = doc.createElement('div');
    choiceDiv.setAttribute('class', 'coverage-choice');
    choiceDiv.innerHTML = `<strong>Selected coverage:</strong> ${esc(coverageLabel)}`;
    const firstH2 = insuranceSection.querySelector('h2');
    if (firstH2) firstH2.insertAdjacentElement('afterend', choiceDiv);
    else insuranceSection.prepend(choiceDiv);
  }

  // Inject signature block into data-tc-signature section
  const sigSection = bodyEl.querySelector<HTMLElement>('section[data-tc-signature]');
  if (sigSection) {
    const sigBlock = doc.createElement('div');
    sigBlock.setAttribute('class', 'sig-block');
    sigBlock.innerHTML = buildSignatureBlockHtml(params, signedDate);
    sigSection.appendChild(sigBlock);
  }

  return bodyEl.innerHTML;
}

function buildSignatureBlockHtml(params: SignedTcPdfParams, signedDate: string): string {
  const sigContent = params.signatureType === 'drawn'
    ? `<img src="${params.signatureData}" class="sig-image" alt="Drawn signature">`
    : `<span class="sig-typed">${esc(params.signatureData)}</span>`;

  return `
    <div class="sig-inner">
      <div class="sig-col">
        <div class="sig-field-label">Signature</div>
        ${sigContent}
        <div class="sig-name-line">${esc(params.contactName)}</div>
      </div>
      <div class="sig-col">
        <div class="sig-field-label">Business</div>
        <div class="sig-biz">${esc(params.businessName)}</div>
        <div class="sig-date">Signed ${esc(signedDate)}</div>
        <div class="sig-email">${esc(params.email)}</div>
      </div>
    </div>
    <div class="sig-legal">
      Electronically signed under the federal ESIGN Act and Washington's Uniform Electronic Transactions Act (UETA).
      This electronic signature is legally binding.
    </div>`;
}

// ─── Print shell ──────────────────────────────────────────────────────────────

function buildPrintShell(
  body: string,
  businessName: string,
  contactName: string,
  signedDate: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Signed Agreement — ${esc(businessName)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Caveat:wght@600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #F5F2EE;
      color: #1C1C1C;
      font-size: 13.5px;
      line-height: 1.65;
    }

    /* ── Header ── */
    .print-header {
      background: #1C1C1C;
      color: #fff;
      padding: 18px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header-brand { display: flex; align-items: center; gap: 12px; }
    .header-logo {
      width: 38px; height: 38px; border-radius: 8px;
      background: #E8692A;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; font-weight: 900; color: #fff; letter-spacing: -1px;
    }
    .header-name { font-size: 15px; font-weight: 700; letter-spacing: 2.5px; }
    .header-sub  { font-size: 10px; letter-spacing: 1.5px; color: rgba(255,255,255,0.5); margin-top: 2px; }
    .header-meta { text-align: right; font-size: 12px; color: rgba(255,255,255,0.7); line-height: 1.5; }
    .header-meta strong { color: #fff; font-size: 13px; }

    /* ── Body container ── */
    .doc-body { max-width: 820px; margin: 0 auto; padding: 32px 24px 56px; }

    /* ── Sections ── */
    section {
      background: #fff;
      border-radius: 14px;
      padding: 22px 24px;
      margin-bottom: 16px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }
    section[data-tc-intro] {
      background: #FFF7F2;
      border: 1px solid rgba(232,105,42,0.18);
    }
    section[data-tc-signature] { background: #fff; border: 1px solid #e2e8f0; }

    h2 {
      font-size: 17px; font-weight: 700; color: #1C1C1C;
      margin-bottom: 14px; padding-bottom: 10px;
      border-bottom: 1.5px solid #F0ECE6;
    }
    h3 {
      font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.6px; color: #64748B;
      margin: 14px 0 6px;
    }
    p { color: #334155; margin-bottom: 10px; font-size: 13px; }
    p:last-of-type { margin-bottom: 0; }
    a { color: #E8692A; text-decoration: none; }
    strong { color: #1C1C1C; }

    /* "In short" callouts — match online form left-border style */
    p[style*="border-left"] {
      background: #FFF7F0 !important;
      border-left: 3.5px solid #E8692A !important;
      padding: 10px 14px !important;
      margin: 10px 0 !important;
      border-radius: 0 6px 6px 0 !important;
      font-size: 13px !important;
    }

    /* Coverage option boxes */
    p[style*="background:#F5F2EE"] {
      background: #F5F2EE !important;
      padding: 10px 14px !important;
      border-radius: 8px !important;
      margin: 6px 0 !important;
      font-size: 12.5px !important;
    }

    /* ── Coverage choice badge ── */
    .coverage-choice {
      margin: 10px 0 14px;
      display: inline-flex; align-items: center; gap: 8px;
      padding: 6px 14px;
      background: rgba(232,105,42,0.1);
      border: 1px solid rgba(232,105,42,0.3);
      border-radius: 100px;
      font-size: 12px; color: #C05A20;
    }
    .coverage-choice strong { color: #C05A20; }

    /* ── Initials stub ── */
    .initials-stub {
      display: flex; align-items: center; gap: 12px;
      margin-top: 14px; padding: 8px 14px;
      background: #F5F2EE; border-radius: 8px;
    }
    .initials-label {
      font-size: 9px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 1.5px; color: #94A3B8; min-width: 52px;
    }
    .initials-pill {
      font-size: 16px; font-weight: 700; letter-spacing: 4px;
      color: #1C1C1C; text-transform: uppercase;
      background: #fff; padding: 3px 14px;
      border-radius: 6px; border: 1px solid #E2E8F0;
      min-width: 60px; text-align: center;
    }
    .initials-section { font-size: 11px; color: #94A3B8; }

    /* ── Signature block ── */
    .sig-block {
      margin-top: 20px; padding: 20px;
      background: #fff; border: 1px solid #E2E8F0;
      border-radius: 12px;
    }
    .sig-inner { display: flex; gap: 40px; flex-wrap: wrap; margin-bottom: 14px; }
    .sig-col { flex: 1; min-width: 180px; }
    .sig-field-label {
      font-size: 9px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 1.5px; color: #94A3B8; margin-bottom: 8px;
    }
    .sig-image { height: 68px; display: block; margin-bottom: 6px; }
    .sig-typed {
      font-family: 'Caveat', 'Brush Script MT', cursive;
      font-size: 32px; font-weight: 600; color: #1C1C1C;
      display: block; line-height: 1.1; margin-bottom: 6px;
    }
    .sig-name-line {
      border-top: 1.5px solid #1C1C1C; padding-top: 4px;
      font-size: 12px; color: #1C1C1C; font-weight: 500;
    }
    .sig-biz { font-size: 15px; font-weight: 600; color: #1C1C1C; margin-bottom: 3px; }
    .sig-date { font-size: 12px; color: #475569; }
    .sig-email { font-size: 11px; color: #94A3B8; margin-top: 2px; }
    .sig-legal {
      font-size: 10px; color: #94A3B8;
      border-top: 1px solid #F0ECE6; padding-top: 10px;
      line-height: 1.5;
    }

    /* ── Footer ── */
    .print-footer {
      text-align: center; font-size: 10.5px; color: #94A3B8;
      margin-top: 32px; padding-top: 18px;
      border-top: 1px solid #E2E8F0; line-height: 1.6;
    }

    /* ── Print overrides ── */
    @media print {
      body { background: #F5F2EE; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .print-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      section { break-inside: avoid; }
      .sig-block { break-inside: avoid; }
      @page { margin: 0.4in; size: letter; }
    }
  </style>
</head>
<body>
  <div class="print-header">
    <div class="header-brand">
      <div class="header-logo">S</div>
      <div>
        <div class="header-name">STRIDE</div>
        <div class="header-sub">LOGISTICS</div>
      </div>
    </div>
    <div class="header-meta">
      <div>Warehousing &amp; Delivery Agreement</div>
      <div><strong>${esc(businessName)}</strong> · ${esc(contactName)}</div>
      <div>Signed ${esc(signedDate)}</div>
    </div>
  </div>
  <div class="doc-body">
    ${body}
    <div class="print-footer">
      Stride Logistics · Express Installation Services Inc, DBA Stride Logistics · 19803 87th Ave S, Kent, WA 98031<br>
      info@stridenw.com · mystridehub.com<br>
      Electronically signed and legally binding under the federal ESIGN Act and Washington UETA.
    </div>
  </div>
</body>
</html>`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(s: string | undefined | null): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
