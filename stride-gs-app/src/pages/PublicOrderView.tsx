/**
 * PublicOrderView — read-only order summary for anonymous public-form
 * submitters. Lives at /#/p/order/:id?email=<encoded>.
 *
 * Why this exists: the order-confirmation email sent to anonymous
 * public-form submitters had a "View your order" button that linked
 * back to the normal /orders/:id route — which sits behind the React
 * auth wall. Recipients had no account, so the button bounced them
 * to login with no way through. This page is reachable without auth.
 *
 * Security: calls public.get_public_order(uuid, text) RPC. That
 * function (SECURITY DEFINER) returns the row only when BOTH the
 * order UUID and the contact_email query param match. UUID alone is
 * not enough to view; email alone is not enough either. Internal
 * fields (driver_notes, internal_notes, pricing_notes, push_error)
 * are excluded from the function's RETURNS clause — they never reach
 * the public client.
 *
 * Mirrors the visual style of the existing public service-request
 * confirmation screen (PublicServiceRequest.tsx) so the customer
 * experience is consistent from submit → email → status check.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { theme } from '../styles/theme';

type PublicOrder = {
  id: string;
  dt_identifier: string | null;
  source: string;
  review_status: string;
  review_notes: string | null;
  order_type: string | null;
  is_pickup: boolean | null;
  local_service_date: string | null;
  window_start_local: string | null;
  window_end_local: string | null;
  timezone: string | null;
  contact_name: string | null;
  contact_company: string | null;
  contact_address: string | null;
  contact_city: string | null;
  contact_state: string | null;
  contact_zip: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  details: string | null;
  base_delivery_fee: number | null;
  extra_items_count: number | null;
  extra_items_fee: number | null;
  accessorials_total: number | null;
  fabric_protection_total: number | null;
  tax_amount: number | null;
  tax_rate_pct: number | null;
  coverage_charge: number | null;
  order_total: number | null;
  payment_collected: boolean | null;
  paid_at: string | null;
  paid_amount: number | null;
  created_at: string;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  dt_status_code: string | null;
  driver_name: string | null;
  truck_name: string | null;
};

// Customer-facing status copy. The review_status / dt_status_code enums
// surface internal state ("revision_requested", staged DT codes); these
// translate to plain English the recipient will recognize from email.
function statusLabel(o: PublicOrder): { label: string; tone: 'pending' | 'good' | 'bad' | 'done' } {
  if (o.finished_at) return { label: 'Delivered', tone: 'done' };
  if (o.started_at) return { label: 'In progress', tone: 'good' };
  if (o.review_status === 'rejected') return { label: 'Declined', tone: 'bad' };
  if (o.review_status === 'revision_requested') return { label: 'Needs your update', tone: 'pending' };
  if (o.review_status === 'pending_review') return { label: 'Awaiting review', tone: 'pending' };
  if (o.review_status === 'approved' && o.scheduled_at) return { label: 'Scheduled', tone: 'good' };
  if (o.review_status === 'approved') return { label: 'Approved', tone: 'good' };
  if (o.review_status === 'draft') return { label: 'Draft', tone: 'pending' };
  return { label: o.dt_status_code || o.review_status || 'Submitted', tone: 'pending' };
}

const TONE_COLOR: Record<string, { bg: string; fg: string }> = {
  pending: { bg: '#FEF3C7', fg: '#92400E' },
  good:    { bg: '#DBEAFE', fg: '#1E40AF' },
  done:    { bg: '#D1FAE5', fg: '#065F46' },
  bad:     { bg: '#FEE2E2', fg: '#991B1B' },
};

function fmtMoney(n: number | null | undefined): string | null {
  if (n == null) return null;
  const v = Number(n);
  if (isNaN(v) || v === 0) return null;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
}

function fmtDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = new Date(s.length === 10 ? s + 'T12:00:00' : s);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function PublicOrderView({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      // Email comes from the ?email= query param in the email link. We
      // accept it on the URL (encoded) and trim so capitalization /
      // surrounding whitespace doesn't break the lookup.
      const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
      const email = (params.get('email') || '').trim();
      if (!email) {
        if (!cancelled) { setError('Missing email — open this link from the original confirmation message.'); setLoading(false); }
        return;
      }
      const { data, error: err } = await supabase
        .rpc('get_public_order', { p_order_id: orderId, p_email: email });
      if (cancelled) return;
      if (err) {
        setError("We couldn't load this order. The link may be expired or incorrect.");
      } else if (!data || (Array.isArray(data) && data.length === 0)) {
        // Function returns no rows when UUID + email don't match. Generic
        // copy on purpose — don't reveal whether the UUID exists.
        setError("This order link doesn't match our records. Please use the link from your most recent confirmation email.");
      } else {
        setOrder(Array.isArray(data) ? data[0] : data);
      }
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [orderId]);

  return (
    <div style={{
      minHeight: '100vh', background: '#F8FAFC',
      padding: '40px 20px', fontFamily: theme.typography.fontFamily,
      color: theme.colors.text,
    }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src="/stride-logo.png" alt="Stride Logistics" style={{ height: 36, marginBottom: 8 }} />
          <div style={{ fontSize: 11, letterSpacing: 2, color: theme.colors.textMuted, textTransform: 'uppercase' }}>
            Stride Logistics
          </div>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: 60, color: theme.colors.textMuted }}>Loading your order…</div>
        )}

        {!loading && error && (
          <div style={{
            background: '#fff', borderRadius: 12, padding: 32, textAlign: 'center',
            border: `1px solid ${theme.colors.border}`,
          }}>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>We couldn't open this order</div>
            <div style={{ fontSize: 14, color: theme.colors.textMuted, marginBottom: 20 }}>{error}</div>
            <a
              href="#/p/orders/lookup"
              style={{
                display: 'inline-block', padding: '10px 20px', borderRadius: 100,
                background: theme.colors.orange, color: '#fff',
                fontSize: 13, fontWeight: 600, textDecoration: 'none',
                fontFamily: 'inherit',
              }}
            >
              Find your order by reference + email
            </a>
          </div>
        )}

        {!loading && order && (() => {
          const status = statusLabel(order);
          const tone = TONE_COLOR[status.tone];
          const serviceDate = fmtDate(order.local_service_date);
          const window =
            order.window_start_local && order.window_end_local
              ? `${order.window_start_local} – ${order.window_end_local}`
              : null;
          const fullAddress = [
            order.contact_address,
            [order.contact_city, order.contact_state].filter(Boolean).join(', '),
            order.contact_zip,
          ].filter(Boolean).join(' · ');
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Header card with status */}
              <div style={{
                background: '#fff', borderRadius: 12, padding: 28,
                border: `1px solid ${theme.colors.border}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 11, letterSpacing: 1, color: theme.colors.textMuted, textTransform: 'uppercase' }}>
                      Order
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: theme.colors.orange }}>
                      {order.dt_identifier || order.id.slice(0, 8)}
                    </div>
                  </div>
                  <span style={{
                    padding: '6px 14px', borderRadius: 100,
                    background: tone.bg, color: tone.fg,
                    fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
                  }}>
                    {status.label}
                  </span>
                </div>

                {order.review_notes && (
                  <div style={{
                    marginTop: 16, padding: 14, borderRadius: 8,
                    background: '#FEF3C7', border: '1px solid #FCD34D',
                    fontSize: 13, color: '#78350F',
                  }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Note from our team</div>
                    {order.review_notes}
                  </div>
                )}
              </div>

              {/* Service details */}
              <Section title="Service">
                <Row label="Type" value={order.order_type === 'pickup' ? 'Pickup' : order.order_type === 'delivery' ? 'Delivery' : order.order_type === 'pickup_and_delivery' ? 'Pickup & Delivery' : order.order_type === 'service_only' ? 'Service' : order.order_type} />
                <Row label="Date" value={serviceDate} />
                <Row label="Window" value={window} />
                {order.driver_name && <Row label="Driver" value={order.driver_name} />}
                {order.truck_name && <Row label="Truck" value={order.truck_name} />}
              </Section>

              {/* Contact / address */}
              <Section title="Contact">
                <Row label="Name" value={order.contact_name} />
                <Row label="Company" value={order.contact_company} />
                <Row label="Address" value={fullAddress || null} />
                <Row label="Phone" value={order.contact_phone} />
                <Row label="Email" value={order.contact_email} />
              </Section>

              {/* Pricing — only shown if anything has been set */}
              {(order.order_total != null && order.order_total > 0) && (
                <Section title="Pricing">
                  <Row label="Delivery fee" value={fmtMoney(order.base_delivery_fee)} />
                  {order.extra_items_count != null && order.extra_items_count > 0 && (
                    <Row label={`Extra items (${order.extra_items_count})`} value={fmtMoney(order.extra_items_fee)} />
                  )}
                  <Row label="Accessorials" value={fmtMoney(order.accessorials_total)} />
                  <Row label="Fabric protection" value={fmtMoney(order.fabric_protection_total)} />
                  <Row label="Coverage" value={fmtMoney(order.coverage_charge)} />
                  <Row label={`Tax${order.tax_rate_pct ? ` (${Number(order.tax_rate_pct).toFixed(2)}%)` : ''}`} value={fmtMoney(order.tax_amount)} />
                  <div style={{ borderTop: `1px solid ${theme.colors.border}`, paddingTop: 10, marginTop: 4 }}>
                    <Row label="Total" value={fmtMoney(order.order_total)} bold />
                  </div>
                  {order.payment_collected && order.paid_amount != null && (
                    <Row label="Paid" value={`${fmtMoney(order.paid_amount)}${order.paid_at ? ` on ${fmtDate(order.paid_at)}` : ''}`} />
                  )}
                </Section>
              )}

              {order.details && (
                <Section title="Details">
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5, color: theme.colors.textSecondary }}>
                    {order.details}
                  </div>
                </Section>
              )}

              <div style={{ textAlign: 'center', padding: 16, fontSize: 12, color: theme.colors.textMuted }}>
                Questions? Reply to your confirmation email and our team will follow up.
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 12, padding: 24,
      border: `1px solid ${theme.colors.border}`,
    }}>
      <div style={{
        fontSize: 11, letterSpacing: 2, color: theme.colors.orange,
        textTransform: 'uppercase', marginBottom: 12, fontWeight: 700,
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string | null | undefined; bold?: boolean }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 13 }}>
      <span style={{ color: theme.colors.textMuted }}>{label}</span>
      <span style={{ color: theme.colors.text, fontWeight: bold ? 700 : 500, textAlign: 'right' }}>{value}</span>
    </div>
  );
}
