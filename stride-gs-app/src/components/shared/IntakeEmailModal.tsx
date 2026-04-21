/**
 * IntakeEmailModal — pre-filled email preview for sending an intake
 * invitation to a prospect.
 *
 * The parent substitutes {{PROSPECT_NAME}}, {{INTAKE_LINK}},
 * {{EXPIRES_DATE}} tokens before passing templateSubject / templateBody.
 * The admin can edit the subject line before sending.
 */
import React, { useState } from 'react';
import { X, Send, Copy, CheckCircle2 } from 'lucide-react';
import { theme } from '../../styles/theme';

export interface IntakeEmailModalProps {
  prospectName: string;
  prospectEmail: string;
  intakeUrl: string;
  templateSubject: string;  // pre-substituted
  templateBody: string;     // pre-substituted HTML
  onSend: (subject: string, bodyHtml: string) => Promise<void>;
  onCopyLink: () => void;   // copy URL and dismiss
  onClose: () => void;
  sending: boolean;
}

const FONT = theme.typography.fontFamily;

export function IntakeEmailModal({
  prospectName,
  prospectEmail,
  intakeUrl,
  templateSubject,
  templateBody,
  onSend,
  onCopyLink,
  onClose,
  sending,
}: IntakeEmailModalProps) {
  const [subject, setSubject] = useState(templateSubject);
  const [copied, setCopied] = useState(false);

  const copyLink = () => {
    void navigator.clipboard.writeText(intakeUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const handleCopyOnly = () => {
    copyLink();
    onCopyLink();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: FONT,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 14,
          width: 'min(600px, 94vw)', maxHeight: '88vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 12px 48px rgba(0,0,0,0.22)',
        }}
      >
        {/* ── Header ── */}
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${theme.colors.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: theme.colors.text }}>
            Send Intake Invitation
          </div>
          <button onClick={onClose} style={iconBtnStyle}>
            <X size={18} />
          </button>
        </div>

        {/* ── Meta fields ── */}
        <div style={{
          padding: '14px 20px', borderBottom: `1px solid ${theme.colors.borderLight}`,
          display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0,
        }}>
          {/* To */}
          <div>
            <div style={labelStyle}>To</div>
            <div style={{ padding: '8px 10px', fontSize: 13, background: theme.colors.bgSubtle, borderRadius: 8, color: theme.colors.textSecondary }}>
              {prospectName ? `${prospectName} <${prospectEmail}>` : prospectEmail}
            </div>
          </div>

          {/* Subject */}
          <div>
            <label style={labelStyle}>Subject</label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '8px 10px',
                fontSize: 13, fontFamily: FONT,
                border: `1px solid ${theme.colors.border}`, borderRadius: 8, outline: 'none',
              }}
            />
          </div>

          {/* Link preview */}
          <div>
            <div style={labelStyle}>Intake Link</div>
            <div style={{ padding: '7px 10px', fontSize: 11, background: theme.colors.bgSubtle, borderRadius: 8, fontFamily: 'monospace', wordBreak: 'break-all', color: theme.colors.textMuted }}>
              {intakeUrl}
            </div>
          </div>
        </div>

        {/* ── Email body preview ── */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px' }}>
          <div style={labelStyle}>Email Preview</div>
          {templateBody ? (
            <div
              style={{
                border: `1px solid ${theme.colors.borderLight}`,
                borderRadius: 10, padding: '14px 18px',
                fontSize: 13, lineHeight: 1.65, color: theme.colors.text,
                maxHeight: 280, overflowY: 'auto',
              }}
              dangerouslySetInnerHTML={{ __html: templateBody }}
            />
          ) : (
            <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: theme.colors.textMuted }}>
              No email template found — sending link only.
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{
          padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`,
          display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center',
          flexShrink: 0,
        }}>
          <button onClick={onClose} disabled={sending} style={{ ...ghostBtnStyle, opacity: sending ? 0.5 : 1 }}>
            Cancel
          </button>
          <button
            onClick={handleCopyOnly}
            disabled={sending}
            style={{ ...ghostBtnStyle, opacity: sending ? 0.5 : 1 }}
            title="Copy link and close without sending"
          >
            {copied ? <CheckCircle2 size={13} color="#15803D" /> : <Copy size={13} />}
            Copy Link Only
          </button>
          <button
            onClick={() => { void onSend(subject, templateBody); }}
            disabled={sending || !subject.trim()}
            style={{ ...sendBtnStyle, opacity: sending || !subject.trim() ? 0.6 : 1, cursor: sending || !subject.trim() ? 'not-allowed' : 'pointer' }}
          >
            <Send size={13} />
            {sending ? 'Sending…' : 'Send Email'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase',
  color: theme.colors.textMuted, marginBottom: 4, display: 'block',
};
const iconBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: theme.colors.textMuted, padding: 4, display: 'flex', alignItems: 'center',
};
const ghostBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '8px 14px', fontSize: 11, fontWeight: 600,
  letterSpacing: '1px', textTransform: 'uppercase',
  background: '#fff', color: theme.colors.textSecondary,
  border: `1px solid ${theme.colors.border}`, borderRadius: 100,
  cursor: 'pointer', fontFamily: FONT,
};
const sendBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '8px 18px', fontSize: 11, fontWeight: 700,
  letterSpacing: '1.5px', textTransform: 'uppercase',
  background: theme.colors.orange, color: '#fff',
  border: 'none', borderRadius: 100,
  cursor: 'pointer', fontFamily: FONT,
};
