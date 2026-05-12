/**
 * PublicOrderLookup — anon-accessible page where any public-form
 * submitter can find their order from scratch using the reference
 * number on their confirmation screen + the email they submitted with.
 *
 * Backstop for the cases where: (a) the recipient lost the email,
 * (b) their email client mangled the link, (c) they want to check
 * status from a different device, or (d) the email was rejected /
 * filtered to spam and they only have the on-screen confirmation
 * reference from the submit flow.
 *
 * The two-factor (ref + email) check is enforced server-side by
 * public.find_public_order_id, which resolves either a UUID or
 * dt_identifier to the underlying row's UUID. The page then redirects
 * into the existing /p/order/<uuid>?email=… viewer — same security
 * model, same render, no duplicated logic.
 */
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { theme } from '../styles/theme';

export function PublicOrderLookup() {
  const [reference, setReference] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = reference.trim().length > 0 && email.trim().length > 0 && !busy;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .rpc('find_public_order_id', {
          p_ref: reference.trim(),
          p_email: email.trim(),
        });
      if (err) {
        // RPC-level error (network, auth) — generic copy.
        setError("We couldn't look that up right now. Please try again in a moment.");
        return;
      }
      const resolvedId = typeof data === 'string' ? data : null;
      if (!resolvedId) {
        // No match. Deliberately generic — don't reveal whether the
        // reference exists in isolation. Same pattern as the
        // /p/order/:id mismatch case.
        setError(
          "We couldn't find an order matching that reference and email. " +
          "Double-check both fields against your confirmation email or screen — " +
          "the reference looks like REQ-abc123 or your order's confirmation number."
        );
        return;
      }
      // Redirect into the public viewer. Use hash navigation so we
      // stay outside the React Router auth wall.
      const target = `#/p/order/${resolvedId}?email=${encodeURIComponent(email.trim())}`;
      window.location.hash = target;
    } catch {
      setError("We couldn't look that up right now. Please try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#F8FAFC',
      padding: '40px 20px', fontFamily: theme.typography.fontFamily,
      color: theme.colors.text, display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ maxWidth: 520, margin: '0 auto', width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src="/stride-logo.png" alt="Stride Logistics" style={{ height: 36, marginBottom: 8 }} />
          <div style={{ fontSize: 11, letterSpacing: 2, color: theme.colors.textMuted, textTransform: 'uppercase' }}>
            Stride Logistics
          </div>
        </div>

        <div style={{
          background: '#fff', borderRadius: 12, padding: 32,
          border: `1px solid ${theme.colors.border}`,
        }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, marginBottom: 8 }}>
            Find your order
          </h1>
          <p style={{ fontSize: 14, color: theme.colors.textMuted, margin: 0, marginBottom: 24, lineHeight: 1.5 }}>
            Enter the reference number from your confirmation email or screen
            (e.g. <code style={{ background: '#F1F5F9', padding: '1px 5px', borderRadius: 4 }}>REQ-mp2wxo4g-x4mu</code>) and the email
            you submitted with. We'll take you straight to your order.
          </p>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.text }}>Reference number</span>
              <input
                type="text"
                value={reference}
                onChange={e => setReference(e.target.value)}
                placeholder="REQ-… or your order number"
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                style={{
                  padding: '10px 12px', fontSize: 14, fontFamily: 'inherit',
                  border: `1px solid ${theme.colors.border}`, borderRadius: 8,
                  background: busy ? '#F8FAFC' : '#fff', outline: 'none',
                }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.text }}>Email</span>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                spellCheck={false}
                disabled={busy}
                style={{
                  padding: '10px 12px', fontSize: 14, fontFamily: 'inherit',
                  border: `1px solid ${theme.colors.border}`, borderRadius: 8,
                  background: busy ? '#F8FAFC' : '#fff', outline: 'none',
                }}
              />
            </label>

            {error && (
              <div style={{
                padding: 12, borderRadius: 8,
                background: '#FEE2E2', border: '1px solid #FCA5A5',
                fontSize: 13, color: '#991B1B', lineHeight: 1.4,
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                padding: '12px 16px', fontSize: 14, fontWeight: 600,
                background: canSubmit ? theme.colors.orange : theme.colors.border,
                color: '#fff', border: 'none', borderRadius: 100,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit', marginTop: 6,
              }}
            >
              {busy ? 'Looking up…' : 'Find my order'}
            </button>
          </form>
        </div>

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: theme.colors.textMuted }}>
          Don't have a reference? Reply to your confirmation email and our team will help.
        </div>
      </div>
    </div>
  );
}
