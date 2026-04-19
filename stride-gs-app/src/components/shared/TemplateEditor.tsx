import { useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Save, Eye, Code, Loader2, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight, FileText, Download } from 'lucide-react';
import { theme } from '../../styles/theme';
import type { EmailTemplate } from '../../lib/api';
import { postUpdateEmailTemplate, postTestGenerateDoc } from '../../lib/api';

/**
 * TemplateEditor — inline HTML editor + live preview for email/doc templates.
 * Opens as an overlay panel when user clicks Edit on a template card.
 *
 * Session 73 Phase 6: writes go directly to Supabase via the optional
 * `onSave` callback (injected by Settings → useEmailTemplates). If the
 * caller doesn't provide `onSave`, falls back to the v38.12.0 behaviour
 * of POSTing `updateEmailTemplate` to GAS — so older consumers still work.
 */

// Mock tokens for preview — frontend-only, covers all template types
const MOCK_TOKENS: Record<string, string> = {
  '{{CLIENT_NAME}}': 'Demo Company',
  '{{SHIPMENT_NO}}': 'SHP-00099',
  '{{RECEIVED_DATE}}': '04/08/2026',
  '{{CARRIER}}': 'UPS Freight',
  '{{TRACKING}}': '1Z999AA10123456784',
  '{{ITEM_COUNT}}': '5',
  '{{ITEM_ID}}': '12345',
  '{{TASK_ID}}': 'INSP-12345-1',
  '{{TASK_TYPE}}': 'Inspection',
  '{{RESULT}}': 'Pass',
  '{{TASK_NOTES}}': 'All items in good condition',
  '{{TASK_RESULT}}': 'Pass',
  '{{DESCRIPTION}}': 'Balmtl Swivel Chair — Soft Glow Oak',
  '{{REPAIR_ID}}': 'RPR-12345-1',
  '{{REPAIR_TYPE}}': 'Upholstery Repair',
  '{{REPAIR_RESULT}}': 'Complete',
  '{{QUOTE_AMOUNT}}': '$125.00',
  '{{FINAL_AMOUNT}}': '$125.00',
  '{{QUOTE_NOTES}}': 'Minor touch-up required on left arm',
  '{{APPROVED_ROW}}': '<tr><td style="font-size:10px;color:#64748B;padding:2px 0;font-weight:700;">Approved</td><td style="font-size:12px;">$125.00</td></tr>',
  '{{WC_NUMBER}}': 'WC-032426',
  '{{WC_NO}}': 'WC-032426',
  '{{PICKUP_DATE}}': '04/15/2026',
  '{{PICKUP_PARTY}}': 'John Smith',
  '{{PICKUP_PHONE_HTML}}': '<div style="font-size:12px;color:#475569;">206-555-0123</div>',
  '{{COD_BANNER_HTML}}': '',
  '{{EST_PICKUP_ROW}}': '<tr><td style="font-size:10px;color:#64748B;padding:2px 0;">Est. Pickup</td><td style="font-size:12px;font-weight:bold;">04/15/2026</td></tr>',
  '{{REQUESTED_BY_ROW}}': '',
  '{{NOTES_HTML}}': '',
  '{{NOTES_ROW}}': '<tr><td style="font-size:10px;color:#64748B;padding:2px 0;font-weight:700;">Notes</td><td style="font-size:12px;">Sample task notes</td></tr>',
  '{{PHOTOS_ROW}}': '',
  '{{PHOTOS_URL}}': '#',
  '{{RELEASE_DATE}}': '04/08/2026',
  '{{RELEASED_ITEMS}}': 'ITM-12345',
  '{{SOURCE_CLIENT_NAME}}': 'Source Client',
  '{{CANCEL_REASON}}': 'Client request',
  '{{CANCEL_DATE}}': '04/08/2026',
  '{{ITEMS_COUNT}}': '3',
  '{{ITEMS_TABLE}}': '<table><tr><td>Sample items table</td></tr></table>',
  '{{ITEMS_TABLE_ROWS}}': '<tr><td style="padding:5px 6px;font-size:10px;text-align:center;border-bottom:1px solid #E2E8F0;">1</td><td style="padding:5px 6px;font-size:10px;font-weight:bold;border-bottom:1px solid #E2E8F0;">12345</td><td style="padding:5px 6px;font-size:10px;text-align:center;border-bottom:1px solid #E2E8F0;">1</td><td style="padding:5px 6px;font-size:10px;border-bottom:1px solid #E2E8F0;">Four Hands</td><td style="padding:5px 6px;font-size:10px;border-bottom:1px solid #E2E8F0;">Balmtl Swivel Chair</td><td style="padding:5px 6px;font-size:10px;text-align:center;border-bottom:1px solid #E2E8F0;">M</td><td style="padding:5px 6px;font-size:10px;border-bottom:1px solid #E2E8F0;">A1.1</td><td style="padding:5px 6px;font-size:10px;border-bottom:1px solid #E2E8F0;">Reilly</td><td style="padding:5px 6px;font-size:10px;border-bottom:1px solid #E2E8F0;">OK</td></tr>',
  '{{TOTAL_ITEMS}}': '5',
  '{{TOTAL_RELEASED}}': '3',
  '{{CLIENT_EMAIL}}': 'demo@example.com',
  '{{CLIENT_EMAIL_HTML}}': '<div style="font-size:11px;color:#64748B;">demo@example.com</div>',
  '{{SHIPMENT_NOTES_HTML}}': '<div style="background:#FEF3C7;border:1px solid #FCD34D;padding:8px 12px;margin-bottom:14px;font-size:11px;"><span style="font-weight:bold;color:#92400E;">Notes:</span> Handle with care</div>',
  '{{SPREADSHEET_URL}}': '#',
  '{{APP_URL}}': 'https://www.mystridehub.com/#',
  '{{LOGO_URL}}': 'https://static.wixstatic.com/media/a38fbc_a8c7a368447f4723b782c4dbd765ca0e~mv2.png',
  '{{SIDEMARK}}': 'REILLY',
  '{{SIDEMARK_ROW}}': '<tr><td style="font-size:10px;color:#64748B;padding:2px 0;font-weight:700;">SIDEMARK</td><td style="font-size:12px;">REILLY</td></tr>',
  '{{STATUS}}': 'In Progress',
  '{{DATE}}': '04/08/2026',
  '{{ITEM_QTY}}': '1',
  '{{ITEM_VENDOR}}': 'Four Hands',
  '{{ITEM_DESC}}': 'Balmtl Swivel Chair — Soft Glow Oak',
  '{{ITEM_SIDEMARK}}': 'REILLY',
  '{{ITEM_ROOM}}': 'Living Room',
  '{{RESULT_OPTIONS_HTML}}': '<span style="display:inline-block;margin-right:16px;font-size:11px;">☐ Pass</span><span style="display:inline-block;margin-right:16px;font-size:11px;">☐ Fail</span><span style="display:inline-block;margin-right:16px;font-size:11px;">☐ Needs Repair</span><span style="display:inline-block;font-size:11px;">☐ Other</span>',
  '{{CLAIM_ID}}': 'CLM-001',
  '{{CLAIM_NO}}': 'CLM-001',
  '{{CLAIMANT_NAME}}': 'Jane Doe',
  '{{COMPANY_CLIENT_NAME}}': 'Demo Company',
  '{{CREATED_BY}}': 'whse@stridenw.com',
  '{{WC_ITEMS}}': 'ITM-12345 — Swivel Chair',
  '{{COD_AMOUNT}}': '$0.00',
  '{{IS_COD}}': 'No',
  '{{TRANSFER_ITEMS}}': 'ITM-12345 — Swivel Chair',
  '{{INVENTORY_URL}}': '#',
  // Invoice-specific tokens (DOC_INVOICE)
  '{{INV_NO}}': 'INV-2026-0042',
  '{{INV_DATE}}': '04/19/2026',
  '{{PAYMENT_TERMS}}': 'NET 30',
  '{{DUE_DATE}}': '05/19/2026',
  '{{SUBTOTAL}}': '$450.00',
  '{{GRAND_TOTAL}}': '$450.00',
  '{{LINE_ITEMS_HTML}}':
    '<tr><td style="padding:4px 6px;border:1px solid #ddd;">04/14</td><td style="padding:4px 6px;border:1px solid #ddd;">Receiving — M</td><td style="padding:4px 6px;border:1px solid #ddd;">62426</td><td style="padding:4px 6px;border:1px solid #ddd;text-align:right;">1</td><td style="padding:4px 6px;border:1px solid #ddd;text-align:right;">$15.00</td><td style="padding:4px 6px;border:1px solid #ddd;text-align:right;">$15.00</td></tr>'
    + '<tr><td style="padding:4px 6px;border:1px solid #ddd;">04/14</td><td style="padding:4px 6px;border:1px solid #ddd;">Storage — M × 30 days</td><td style="padding:4px 6px;border:1px solid #ddd;">62426</td><td style="padding:4px 6px;border:1px solid #ddd;text-align:right;">30</td><td style="padding:4px 6px;border:1px solid #ddd;text-align:right;">$0.15</td><td style="padding:4px 6px;border:1px solid #ddd;text-align:right;">$4.50</td></tr>',
  '{{DISCOUNT_ROWS}}': '',
  '{{INVOICE_NOTES_BLOCK}}': '',
};

function resolveMockTokens(html: string): string {
  let resolved = html;
  for (const [token, value] of Object.entries(MOCK_TOKENS)) {
    resolved = resolved.split(token).join(value);
  }
  return resolved;
}

interface Props {
  template: EmailTemplate;
  onClose: () => void;
  onSaved: () => void;
  /**
   * Optional save handler injected by Settings → useEmailTemplates. Writes
   * directly to Supabase (with audit rows). If omitted, the editor falls
   * back to POSTing updateEmailTemplate through GAS.
   */
  onSave?: (templateKey: string, patch: { subject?: string; bodyHtml?: string }) => Promise<boolean>;
}

export function TemplateEditor({ template, onClose, onSaved, onSave }: Props) {
  const [subject, setSubject] = useState(template.subject);
  const [bodyHtml, setBodyHtml] = useState(template.bodyHtml);
  const [activeTab, setActiveTab] = useState<'split' | 'code' | 'preview'>('split');
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<'success' | 'error' | null>(null);
  const [saveError, setSaveError] = useState('');
  const [showTokens, setShowTokens] = useState(false);

  const isDocument = template.category === 'document' || template.category === 'doc';
  const [pdfLoading, setPdfLoading] = useState<null | 'preview' | 'download'>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const isDirty = subject !== template.subject || bodyHtml !== template.bodyHtml;
  const previewHtml = useMemo(() => resolveMockTokens(bodyHtml), [bodyHtml]);

  /** Decode the server's base64 PDF into a Blob URL. */
  const fetchPreviewPdf = useCallback(async () => {
    const res = await postTestGenerateDoc({ templateKey: template.key });
    if (!res.ok || !res.data?.success || !res.data.pdfBase64) {
      throw new Error(res.error || 'PDF generation failed');
    }
    const bin = atob(res.data.pdfBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { blob: new Blob([bytes], { type: 'application/pdf' }), filename: res.data.filename };
  }, [template.key]);

  const handlePreviewPdf = useCallback(async () => {
    if (isDirty) {
      setPdfError('Save your changes first — PDF preview reads the saved template.');
      setTimeout(() => setPdfError(null), 4000);
      return;
    }
    setPdfLoading('preview');
    setPdfError(null);
    try {
      const { blob } = await fetchPreviewPdf();
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (!win) setPdfError('Popup blocked — allow popups to preview PDFs');
      // Revoke after 60s so the browser has time to render
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : String(e));
    } finally {
      setPdfLoading(null);
    }
  }, [fetchPreviewPdf, isDirty]);

  const handleDownloadPdf = useCallback(async () => {
    if (isDirty) {
      setPdfError('Save your changes first — PDF download uses the saved template.');
      setTimeout(() => setPdfError(null), 4000);
      return;
    }
    setPdfLoading('download');
    setPdfError(null);
    try {
      const { blob, filename } = await fetchPreviewPdf();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `${template.key}_preview.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : String(e));
    } finally {
      setPdfLoading(null);
    }
  }, [fetchPreviewPdf, isDirty, template.key]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveResult(null);
    setSaveError('');

    const patch: { subject?: string; bodyHtml?: string } = {};
    if (subject !== template.subject) patch.subject = subject;
    if (bodyHtml !== template.bodyHtml) patch.bodyHtml = bodyHtml;

    // v38.82.0 — prefer the injected onSave (Supabase-direct). Fall back
    // to GAS postUpdateEmailTemplate for any caller that hasn't adopted
    // useEmailTemplates yet.
    let ok = false;
    let errorMessage: string | null = null;
    if (onSave) {
      try {
        ok = await onSave(template.key, patch);
        if (!ok) errorMessage = 'Save failed — admin role required, or Supabase unreachable';
      } catch (e) {
        errorMessage = e instanceof Error ? e.message : String(e);
      }
    } else {
      const resp = await postUpdateEmailTemplate({ templateKey: template.key, ...patch });
      ok = !!(resp.ok && resp.data?.success);
      if (!ok) errorMessage = resp.error || resp.data?.error || 'Save failed';
    }
    setSaving(false);

    if (ok) {
      setSaveResult('success');
      setTimeout(() => setSaveResult(null), 8000); // longer display for reminder
      onSaved();
    } else {
      setSaveResult('error');
      setSaveError(errorMessage ?? 'Save failed');
    }
  }, [template, subject, bodyHtml, onSaved, onSave]);

  // Detect known tokens in the template for the reference panel
  const usedTokens = useMemo(() => {
    const found: string[] = [];
    const regex = /\{\{[A-Z_]+\}\}/g;
    let match;
    while ((match = regex.exec(bodyHtml)) !== null) {
      if (!found.includes(match[0])) found.push(match[0]);
    }
    return found;
  }, [bodyHtml]);

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 2000, display: 'flex', justifyContent: 'center', alignItems: 'stretch', padding: 10 }}>
      <div style={{ background: '#fff', borderRadius: 20, width: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.25)' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Edit Template</div>
            <div style={{ fontSize: 11, color: theme.colors.textMuted, fontFamily: 'monospace' }}>{template.key}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {saveResult === 'success' && <span style={{ fontSize: 11, color: '#15803D', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle2 size={13} /> Saved. Emails will use the new version immediately.</span>}
            {saveResult === 'error' && <span style={{ fontSize: 11, color: '#DC2626', display: 'flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={13} /> {saveError}</span>}
            {pdfError && <span style={{ fontSize: 11, color: '#DC2626', display: 'flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={13} /> {pdfError}</span>}
            {isDocument && (
              <>
                <button
                  onClick={handlePreviewPdf}
                  disabled={!!pdfLoading || isDirty}
                  title={isDirty ? 'Save your changes first' : 'Render PDF with sample data and open in a new tab'}
                  style={{
                    padding: '6px 12px', fontSize: 11, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 6,
                    background: '#fff', color: theme.colors.textSecondary,
                    cursor: (pdfLoading || isDirty) ? 'default' : 'pointer',
                    fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
                    opacity: (pdfLoading || isDirty) ? 0.55 : 1,
                  }}
                >
                  {pdfLoading === 'preview' ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <FileText size={12} />}
                  {pdfLoading === 'preview' ? 'Generating…' : 'Preview PDF'}
                </button>
                <button
                  onClick={handleDownloadPdf}
                  disabled={!!pdfLoading || isDirty}
                  title={isDirty ? 'Save your changes first' : 'Render PDF with sample data and download'}
                  style={{
                    padding: '6px 12px', fontSize: 11, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 6,
                    background: '#fff', color: theme.colors.textSecondary,
                    cursor: (pdfLoading || isDirty) ? 'default' : 'pointer',
                    fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
                    opacity: (pdfLoading || isDirty) ? 0.55 : 1,
                  }}
                >
                  {pdfLoading === 'download' ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={12} />}
                  {pdfLoading === 'download' ? 'Generating…' : 'Download PDF'}
                </button>
              </>
            )}
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              style={{
                padding: '7px 16px', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 8,
                background: (isDirty && !saving) ? theme.colors.orange : theme.colors.bgMuted,
                color: (isDirty && !saving) ? '#fff' : theme.colors.textMuted,
                cursor: (isDirty && !saving) ? 'pointer' : 'default',
                fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              {saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />}
              {saving ? 'Saving…' : isDirty ? 'Save' : 'No changes'}
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted }}><X size={18} /></button>
          </div>
        </div>

        {/* Subject */}
        <div style={{ padding: '10px 18px', borderBottom: `1px solid ${theme.colors.borderLight}`, flexShrink: 0 }}>
          <label style={{ fontSize: 10, fontWeight: 600, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3 }}>Subject</label>
          <input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 6, fontFamily: 'inherit', marginTop: 4 }}
          />
        </div>

        {/* Tab switcher */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
          {(['split', 'code', 'preview'] as const).map(t => {
            const label = t === 'split' ? 'Split' : t === 'code' ? 'HTML Code' : 'Preview';
            const icon = t === 'split' ? <><Code size={13} /><Eye size={13} /></> : t === 'code' ? <Code size={13} /> : <Eye size={13} />;
            return (
              <button key={t} onClick={() => setActiveTab(t)} style={{ padding: '8px 18px', fontSize: 12, fontWeight: activeTab === t ? 700 : 500, border: 'none', borderBottom: activeTab === t ? `2px solid ${theme.colors.orange}` : '2px solid transparent', background: 'none', color: activeTab === t ? theme.colors.orange : theme.colors.textSecondary, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit' }}>{icon} {label}</button>
            );
          })}
          <button onClick={() => setShowTokens(t => !t)} style={{ marginLeft: 'auto', padding: '8px 14px', fontSize: 11, fontWeight: 500, border: 'none', background: 'none', color: theme.colors.textMuted, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit' }}>
            {showTokens ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Tokens ({usedTokens.length})
          </button>
        </div>

        {/* Token reference (collapsible) */}
        {showTokens && (
          <div style={{ padding: '8px 18px', borderBottom: `1px solid ${theme.colors.borderLight}`, background: theme.colors.bgSubtle, maxHeight: 120, overflow: 'auto', flexShrink: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
              {usedTokens.map(t => (
                <span key={t} style={{ fontSize: 10, fontFamily: 'monospace', color: theme.colors.orange, background: '#FEF3EE', padding: '2px 6px', borderRadius: 4 }}>{t}</span>
              ))}
            </div>
          </div>
        )}

        {/* Main content area — split / code / preview */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: activeTab === 'split' ? 'row' : 'column' }}>
          {/* Code pane (visible in split + code modes) */}
          {(activeTab === 'split' || activeTab === 'code') && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: activeTab === 'split' ? `1px solid ${theme.colors.border}` : 'none' }}>
              <textarea
                value={bodyHtml}
                onChange={e => setBodyHtml(e.target.value)}
                spellCheck={false}
                style={{
                  flex: 1, width: '100%', padding: '12px 18px', fontSize: 11, fontFamily: 'Consolas, Monaco, monospace',
                  border: 'none', outline: 'none', resize: 'none', lineHeight: 1.5, color: theme.colors.text,
                  background: '#FAFBFC',
                }}
              />
              <div style={{ padding: '6px 12px 8px', borderTop: `1px solid ${theme.colors.borderLight}`, background: '#FAFBFC', display: 'flex', flexWrap: 'wrap', gap: 4, flexShrink: 0 }}>
                {usedTokens.map(tk => (
                  <button key={tk} onClick={() => setBodyHtml(prev => prev + tk)} style={{
                    background: '#F1F5F9', padding: '2px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    fontSize: 10, fontFamily: 'monospace', color: '#475569',
                  }}>{tk}</button>
                ))}
              </div>
            </div>
          )}
          {/* Preview pane (visible in split + preview modes) */}
          {(activeTab === 'split' || activeTab === 'preview') && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {activeTab === 'split' && (
                <div style={{ padding: '4px 12px', background: theme.colors.bgSubtle, borderBottom: `1px solid ${theme.colors.borderLight}`, fontSize: 10, fontWeight: 600, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 }}>Live Preview</div>
              )}
              <iframe
                srcDoc={previewHtml}
                sandbox=""
                title="Template Preview"
                style={{ flex: 1, width: '100%', border: 'none', background: '#fff' }}
              />
            </div>
          )}
        </div>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>,
    document.body
  );
}
