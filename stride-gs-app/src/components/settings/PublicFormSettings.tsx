/**
 * PublicFormSettings — admin UI for the public service-request form.
 *
 * Wraps the singleton row in public_form_settings (id=1) — the alert
 * recipient list (text[]) and an optional reply-to email used by the
 * submitter confirmation. RLS restricts SELECT/UPDATE to admins, so
 * this component is only mounted under the admin Settings tab.
 *
 * The data shape comes from migration
 * 20260427000000_public_service_request.sql:
 *   • alert_emails    text[]   — internal alert distribution list
 *   • reply_to_email  text     — reply-to header on confirmation email
 */
import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, AlertTriangle, CheckCircle2, Copy } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { theme } from '../../styles/theme';

const PUBLIC_FORM_URL = 'https://www.mystridehub.com/#/public/service-request';

interface SettingsRow {
  alert_emails: string[];
  reply_to_email: string | null;
}

export function PublicFormSettings() {
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [saving, setSaving]     = useState(false);
  const [savedAt, setSavedAt]   = useState<Date | null>(null);

  const [emails, setEmails]     = useState<string[]>([]);
  const [replyTo, setReplyTo]   = useState('');
  const [draftEmail, setDraftEmail] = useState('');

  // ── Initial load ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error: err } = await supabase
        .from('public_form_settings')
        .select('alert_emails, reply_to_email')
        .eq('id', 1)
        .single<SettingsRow>();
      if (cancelled) return;
      if (err) {
        setError(err.message);
      } else if (data) {
        setEmails(Array.isArray(data.alert_emails) ? data.alert_emails : []);
        setReplyTo(data.reply_to_email ?? '');
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────
  function isEmail(s: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
  }

  function addEmail() {
    const v = draftEmail.trim();
    if (!v) return;
    if (!isEmail(v)) {
      setError('Enter a valid email address.');
      return;
    }
    if (emails.includes(v)) {
      setDraftEmail('');
      return;
    }
    setEmails(prev => [...prev, v]);
    setDraftEmail('');
    setError(null);
  }

  function removeEmail(idx: number) {
    setEmails(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (replyTo.trim() && !isEmail(replyTo)) {
      setError('Reply-to must be a valid email address (or empty).');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const { error: err } = await supabase
        .from('public_form_settings')
        .update({
          alert_emails: emails,
          reply_to_email: replyTo.trim() || null,
        })
        .eq('id', 1);
      if (err) throw new Error(err.message);
      setSavedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function copyLink() {
    void navigator.clipboard.writeText(PUBLIC_FORM_URL);
  }

  // ── Render ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 8, color: theme.colors.textMuted, fontSize: 13 }}>
        <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading…
      </div>
    );
  }

  return (
    <>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Public form link card */}
      <div style={card}>
        <div style={sectionTitle}>Public service-request form</div>
        <div style={{ fontSize: 13, color: theme.colors.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
          Anyone with this link can submit a delivery or service request without logging in.
          Submissions land in the Review Queue with status <code>pending_review</code> for staff to triage.
        </div>
        <div style={{
          display: 'flex', gap: 8, alignItems: 'center',
          background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`,
          borderRadius: 8, padding: '8px 10px',
        }}>
          <code style={{
            flex: 1, fontSize: 12, color: theme.colors.textPrimary,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{PUBLIC_FORM_URL}</code>
          <button
            type="button"
            onClick={copyLink}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: theme.colors.orangeLight, border: 'none',
              color: theme.colors.orange, fontWeight: 600, fontSize: 12,
              padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
            }}
          >
            <Copy size={12} /> Copy
          </button>
        </div>
      </div>

      {/* Alert recipients */}
      <div style={card}>
        <div style={sectionTitle}>Alert recipients</div>
        <div style={{ fontSize: 13, color: theme.colors.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
          Stride staff who get an email alert each time a public service request is submitted.
          The submitter receives a separate auto-confirmation.
        </div>

        {/* Existing list */}
        {emails.length === 0 ? (
          <div style={{
            padding: '14px 16px', borderRadius: 8,
            background: '#FEF3C7', border: '1px solid #FCD34D',
            color: '#92400E', fontSize: 12, marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <AlertTriangle size={14} />
            No recipients configured — alert emails will not be sent. Add at least one.
          </div>
        ) : (
          <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {emails.map((e, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px', borderRadius: 6,
                background: theme.colors.bgSubtle,
                border: `1px solid ${theme.colors.border}`,
                fontSize: 13,
              }}>
                <span style={{ flex: 1 }}>{e}</span>
                <button
                  type="button"
                  onClick={() => removeEmail(i)}
                  aria-label={`Remove ${e}`}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: theme.colors.textMuted, padding: 4,
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add row */}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="email"
            value={draftEmail}
            onChange={(e) => setDraftEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEmail(); } }}
            placeholder="ops@strideleads.com"
            style={{ ...input, flex: 1 }}
          />
          <button
            type="button"
            onClick={addEmail}
            disabled={!draftEmail.trim()}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: draftEmail.trim() ? theme.colors.orange : theme.colors.bgSubtle,
              border: 'none', color: draftEmail.trim() ? '#fff' : theme.colors.textMuted,
              fontSize: 12, fontWeight: 600, padding: '0 14px',
              borderRadius: 8, cursor: draftEmail.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      {/* Reply-to */}
      <div style={card}>
        <div style={sectionTitle}>Confirmation reply-to (optional)</div>
        <div style={{ fontSize: 13, color: theme.colors.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
          When a submitter receives their auto-confirmation, replies route to this address. Leave
          blank to use the default Gmail account that sends Stride email.
        </div>
        <input
          type="email"
          value={replyTo}
          onChange={(e) => setReplyTo(e.target.value)}
          placeholder="ops@strideleads.com"
          style={input}
        />
      </div>

      {/* Save */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: saving ? '#FCA98D' : theme.colors.orange,
            color: '#fff', border: 'none',
            fontSize: 13, fontWeight: 700, padding: '10px 18px',
            borderRadius: 8, cursor: saving ? 'wait' : 'pointer',
          }}
        >
          {saving && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {savedAt && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            color: '#16A34A', fontSize: 12,
          }}>
            <CheckCircle2 size={14} /> Saved {savedAt.toLocaleTimeString()}
          </span>
        )}
        {error && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            color: '#B91C1C', fontSize: 12,
          }}>
            <AlertTriangle size={14} /> {error}
          </span>
        )}
      </div>
    </>
  );
}

// ── Local style tokens (mirror Settings.tsx) ───────────────────────────
const card: React.CSSProperties = {
  background: '#fff',
  border: `1px solid ${theme.colors.border}`,
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
};
const input: React.CSSProperties = {
  width: '100%', padding: '9px 12px', fontSize: 13,
  border: `1px solid ${theme.colors.border}`, borderRadius: 8,
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
};
const sectionTitle: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, marginBottom: 12,
};
