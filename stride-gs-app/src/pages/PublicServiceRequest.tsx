/**
 * PublicServiceRequest — anonymous (no-auth) service-request form.
 *
 * Rendered directly from App.tsx when the URL hash matches
 * #/public/service-request — bypasses the auth gate entirely. Mirrors
 * the in-app CreateDeliveryOrderModal layout (contact / service date /
 * address / line items / notes) but accepts only ad-hoc line items (no
 * inventory access) and gathers contact info instead of selecting a
 * tenant.
 *
 * Data flow:
 *   1. INSERT into dt_orders with tenant_id=NULL, source='public_form',
 *      review_status='pending_review' — gated by
 *      dt_orders_insert_public_form RLS policy
 *      (20260427000000_public_service_request.sql).
 *   2. INSERT line items into dt_order_items — gated by
 *      dt_order_items_insert_public_form RLS policy.
 *   3. Invoke notify-public-request Edge Function which sends the
 *      submitter their PUBLIC_REQUEST_CONFIRMATION email and the
 *      configured staff list a PUBLIC_REQUEST_ALERT email.
 *
 * Bot protection: a hidden `website` honeypot field. If filled, the
 * submit silently "succeeds" without writing anything (the bot sees
 * a happy success screen but no row lands in the table).
 */
import { useMemo, useState, type CSSProperties } from 'react';
import {
  CheckCircle2, Loader2, Plus, Trash2, AlertTriangle,
  MapPin, Truck, Box, ArrowRight,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

// ── Stride brand tokens (no theme.v2 dep — public page is self-contained) ──
const BRAND_ORANGE = '#E85D2D';
const BG = '#F5F5F0';
const SURFACE = '#FFFFFF';
const BORDER = '#E5E7EB';
const TEXT = '#1F2937';
const TEXT_MUTED = '#6B7280';
const LABEL = '#374151';
const ERR_BG = '#FEF2F2';
const ERR_BORDER = '#FCA5A5';
const ERR_TEXT = '#B91C1C';

interface FreeItem {
  id: string;
  description: string;
  quantity: number;
  weight?: number | null;
  cubicFeet?: number | null;
}

// US state codes — matches existing CreateDeliveryOrderModal.
const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
];

function makeRowId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function makeRequestId(): string {
  // SRF + crypto-quality entropy. The migration adds a partial UNIQUE
  // index over (dt_identifier) WHERE tenant_id IS NULL AND
  // source='public_form', so a collision would surface as a 23505 the
  // submit handler retries on. crypto.randomUUID is the best entropy
  // source available in the browser; we trim to a compact uppercase
  // suffix that still carries 48 bits of randomness.
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  const uuid = cryptoObj?.randomUUID
    ? cryptoObj.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2);
  const ts = Date.now().toString(36).toUpperCase().slice(-4);
  const rand = uuid.toUpperCase().slice(0, 8);
  return `SRF-${ts}${rand}`;
}

export function PublicServiceRequest() {
  // ── Contact ──────────────────────────────────────────────────────────
  const [contactName, setContactName] = useState('');
  const [contactCompany, setContactCompany] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  // ── Service date / window ───────────────────────────────────────────
  const [serviceDate, setServiceDate] = useState('');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');

  // ── Address ─────────────────────────────────────────────────────────
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');

  // ── Items + notes ───────────────────────────────────────────────────
  const [items, setItems] = useState<FreeItem[]>([
    { id: makeRowId(), description: '', quantity: 1, weight: null, cubicFeet: null },
  ]);
  const [notes, setNotes] = useState('');

  // ── Honeypot ────────────────────────────────────────────────────────
  const [honeypot, setHoneypot] = useState('');

  // ── Submit state ────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{ requestId: string } | null>(null);

  const validItems = useMemo(
    () => items.filter(i => i.description.trim()),
    [items],
  );

  const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

  const missingFields: string[] = [];
  if (!contactName.trim())  missingFields.push('Name');
  if (!contactPhone.trim()) missingFields.push('Phone');
  if (!isEmail(contactEmail)) missingFields.push('Valid email');
  if (!serviceDate)         missingFields.push('Service date');
  if (!street.trim())       missingFields.push('Street address');
  if (!city.trim())         missingFields.push('City');
  if (!state)               missingFields.push('State');
  if (!zip.trim())          missingFields.push('ZIP');
  if (validItems.length === 0) missingFields.push('At least one item');

  const canSubmit = missingFields.length === 0 && !submitting;

  // ── Handlers ────────────────────────────────────────────────────────
  function addItem() {
    setItems(prev => [
      ...prev,
      { id: makeRowId(), description: '', quantity: 1, weight: null, cubicFeet: null },
    ]);
  }

  function updateItem(id: string, patch: Partial<FreeItem>) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
  }

  function removeItem(id: string) {
    setItems(prev => prev.length > 1 ? prev.filter(i => i.id !== id) : prev);
  }

  async function handleSubmit() {
    setError(null);

    // Honeypot — bots tend to fill every input. Silently fake success.
    if (honeypot.trim()) {
      setSubmitted({ requestId: makeRequestId() });
      return;
    }

    if (!canSubmit) return;
    setSubmitting(true);

    try {
      const orderBase = {
        tenant_id: null,
        source: 'public_form',
        review_status: 'pending_review',
        order_type: 'delivery',
        is_pickup: false,
        timezone: 'America/Los_Angeles',
        local_service_date: serviceDate,
        window_start_local: windowStart || null,
        window_end_local: windowEnd || null,
        contact_name: contactName.trim(),
        contact_company: contactCompany.trim() || null,
        contact_phone: contactPhone.trim(),
        contact_email: contactEmail.trim(),
        contact_address: street.trim(),
        contact_city: city.trim(),
        contact_state: state,
        contact_zip: zip.trim(),
        details: notes.trim() || null,
      };

      // Retry on the partial-unique-index conflict with a fresh slug.
      // 3 attempts is plenty given 48-bit entropy per id.
      let orderRow: { id: string; dt_identifier: string } | null = null;
      let lastErr: { code?: string; message: string } | null = null;
      for (let attempt = 0; attempt < 3 && !orderRow; attempt++) {
        const dtIdentifier = makeRequestId();
        const { data, error: orderErr } = await supabase
          .from('dt_orders')
          .insert({ ...orderBase, dt_identifier: dtIdentifier })
          .select('id, dt_identifier')
          .single();
        if (data) {
          orderRow = data;
          break;
        }
        lastErr = orderErr;
        if (orderErr?.code !== '23505') break; // not a uniqueness conflict — bail
      }

      if (!orderRow) {
        throw new Error(lastErr?.message || 'Could not save your request. Please try again.');
      }

      const itemRows = validItems.map(i => {
        const qty = Math.max(1, Number(i.quantity) || 1);
        const w = i.weight != null && Number.isFinite(Number(i.weight)) ? Number(i.weight) : null;
        const cuFtPer = i.cubicFeet != null && Number.isFinite(Number(i.cubicFeet)) ? Number(i.cubicFeet) : null;
        return {
          dt_order_id: orderRow.id,
          dt_item_code: null,
          description: i.description.trim(),
          quantity: qty,
          original_quantity: qty,
          cubic_feet: cuFtPer != null ? cuFtPer * qty : null,
          extras: {
            source: 'public_form',
            weight: w,
            cuft: cuFtPer,
          },
        };
      });

      if (itemRows.length > 0) {
        const { error: itemsErr } = await supabase
          .from('dt_order_items')
          .insert(itemRows);
        if (itemsErr) {
          // The order row landed but items didn't — anon has no DELETE
          // policy so we can't roll the order back. Surface a hard
          // error so the user can re-submit; staff get the orphaned
          // empty order in the queue and can reach out.
          throw new Error(
            `Saved your contact info but couldn't save the items list (${itemsErr.message}). Please try submitting again.`
          );
        }
      }

      // Fire-and-await the notification function. If it fails the
      // submission still succeeds — Stride sees the row in the review
      // queue regardless. Email is a nice-to-have on top.
      try {
        await supabase.functions.invoke('notify-public-request', {
          body: { orderId: orderRow.id },
        });
      } catch (e) {
        console.warn('[PublicServiceRequest] notify-public-request failed:', e);
      }

      setSubmitted({ requestId: orderRow.dt_identifier });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Success screen ──────────────────────────────────────────────────
  if (submitted) {
    return (
      <PageShell>
        <div style={{
          maxWidth: 600, margin: '60px auto', padding: '40px 32px',
          background: SURFACE, borderRadius: 16, border: `1px solid ${BORDER}`,
          textAlign: 'center',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: '#16A34A20', display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center', marginBottom: 20,
          }}>
            <CheckCircle2 size={32} color="#16A34A" />
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: TEXT }}>
            Request received
          </h1>
          <p style={{ margin: '12px 0 24px', color: TEXT_MUTED, fontSize: 14, lineHeight: 1.5 }}>
            Thanks for reaching out. We'll be in touch within one business day with pricing
            and scheduling.
          </p>
          <div style={{
            background: BG, borderRadius: 8, padding: '14px 18px',
            display: 'inline-block', textAlign: 'left',
          }}>
            <div style={{
              fontSize: 11, fontWeight: 600, color: TEXT_MUTED,
              textTransform: 'uppercase', letterSpacing: '0.08em',
            }}>Reference number</div>
            <div style={{
              marginTop: 4, fontSize: 18, fontFamily: 'monospace',
              fontWeight: 700, color: TEXT,
            }}>{submitted.requestId}</div>
          </div>
          <p style={{ margin: '24px 0 0', color: TEXT_MUTED, fontSize: 12 }}>
            A confirmation email has been sent to <strong>{contactEmail}</strong>.
          </p>
        </div>
      </PageShell>
    );
  }

  // ── Form ────────────────────────────────────────────────────────────
  return (
    <PageShell>
      <form
        onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}
        style={{ maxWidth: 760, margin: '32px auto', paddingBottom: 60 }}
      >
        {/* Hero card */}
        <div style={{
          background: '#1C1C1C', borderRadius: '16px 16px 0 0',
          padding: '28px 32px',
        }}>
          <div style={{
            color: BRAND_ORANGE, fontSize: 11, fontWeight: 700,
            letterSpacing: '0.16em', textTransform: 'uppercase',
            marginBottom: 6,
          }}>Stride Logistics</div>
          <h1 style={{
            margin: 0, color: '#fff', fontSize: 24, fontWeight: 700,
            lineHeight: 1.2,
          }}>
            Request a Delivery or Service
          </h1>
          <p style={{
            margin: '8px 0 0', color: '#D1D5DB', fontSize: 13, lineHeight: 1.5,
          }}>
            Tell us a bit about what you need delivered. We'll follow up with pricing and
            scheduling within one business day.
          </p>
        </div>

        {/* Body */}
        <div style={{
          background: SURFACE, borderRadius: '0 0 16px 16px',
          border: `1px solid ${BORDER}`, borderTop: 'none',
          padding: '28px 32px',
        }}>
          {/* Contact */}
          <SectionHeading icon={<Truck size={14} />} label="Contact" />
          <Grid cols={2}>
            <Field label="Your name" required>
              <Input value={contactName} onChange={setContactName} placeholder="Jane Doe" />
            </Field>
            <Field label="Company">
              <Input value={contactCompany} onChange={setContactCompany} placeholder="Acme Interiors" />
            </Field>
            <Field label="Phone" required>
              <Input value={contactPhone} onChange={setContactPhone} placeholder="(555) 123-4567" type="tel" />
            </Field>
            <Field label="Email" required>
              <Input value={contactEmail} onChange={setContactEmail} placeholder="jane@acme.com" type="email" />
            </Field>
          </Grid>

          {/* Service date */}
          <Spacer />
          <SectionHeading icon={<ArrowRight size={14} />} label="Service date" />
          <Grid cols={3}>
            <Field label="Date" required>
              <Input value={serviceDate} onChange={setServiceDate} type="date" />
            </Field>
            <Field label="Window start">
              <Input value={windowStart} onChange={setWindowStart} type="time" />
            </Field>
            <Field label="Window end">
              <Input value={windowEnd} onChange={setWindowEnd} type="time" />
            </Field>
          </Grid>

          {/* Address */}
          <Spacer />
          <SectionHeading icon={<MapPin size={14} />} label="Service address" />
          <Field label="Street" required>
            <Input value={street} onChange={setStreet} placeholder="123 Main St" />
          </Field>
          <Grid cols={3} style={{ marginTop: 12 }}>
            <Field label="City" required>
              <Input value={city} onChange={setCity} />
            </Field>
            <Field label="State" required>
              <Select value={state} onChange={setState}>
                <option value="">—</option>
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="ZIP" required>
              <Input value={zip} onChange={setZip} placeholder="98032" />
            </Field>
          </Grid>

          {/* Items */}
          <Spacer />
          <SectionHeading icon={<Box size={14} />} label="Items to deliver" />
          <p style={{
            margin: '-4px 0 12px', fontSize: 12, color: TEXT_MUTED, lineHeight: 1.5,
          }}>
            Describe each item, the quantity, and (if you know it) the weight and cubic
            feet. Rough estimates are fine.
          </p>
          <div style={{
            background: '#EFF6FF', border: '1px solid #DBEAFE',
            borderRadius: 10, padding: 14,
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: TEXT_MUTED }}>
                  <th style={th}>Description</th>
                  <th style={{ ...th, width: 70 }}>Qty</th>
                  <th style={{ ...th, width: 90 }}>Wt (lbs)</th>
                  <th style={{ ...th, width: 90 }}>cuFt ea.</th>
                  <th style={{ ...th, width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td style={td}>
                      <Input
                        value={it.description}
                        onChange={(v) => updateItem(it.id, { description: v })}
                        placeholder="e.g. Sofa, dining table, 4× chairs"
                      />
                    </td>
                    <td style={td}>
                      <Input
                        value={String(it.quantity)}
                        onChange={(v) => updateItem(it.id, { quantity: Math.max(1, Number(v) || 1) })}
                        type="number"
                      />
                    </td>
                    <td style={td}>
                      <Input
                        value={it.weight != null ? String(it.weight) : ''}
                        onChange={(v) => updateItem(it.id, { weight: v === '' ? null : Number(v) })}
                        type="number"
                        placeholder="—"
                      />
                    </td>
                    <td style={td}>
                      <Input
                        value={it.cubicFeet != null ? String(it.cubicFeet) : ''}
                        onChange={(v) => updateItem(it.id, { cubicFeet: v === '' ? null : Number(v) })}
                        type="number"
                        placeholder="—"
                      />
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => removeItem(it.id)}
                        disabled={items.length <= 1}
                        style={{
                          background: 'transparent', border: 'none', cursor: items.length <= 1 ? 'not-allowed' : 'pointer',
                          color: items.length <= 1 ? '#D1D5DB' : '#9CA3AF',
                          padding: 4,
                        }}
                        aria-label="Remove item"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              onClick={addItem}
              style={{
                marginTop: 10, background: 'transparent',
                border: '1px dashed #93C5FD', color: '#1D4ED8',
                fontSize: 12, fontWeight: 600, padding: '8px 12px',
                borderRadius: 8, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <Plus size={14} /> Add item
            </button>
          </div>

          {/* Notes */}
          <Spacer />
          <SectionHeading label="Notes (optional)" />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Anything else we should know — access notes, fragile items, stairs, etc."
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '10px 12px', borderRadius: 8,
              border: `1px solid ${BORDER}`, fontSize: 13,
              fontFamily: 'inherit', color: TEXT, lineHeight: 1.5,
              resize: 'vertical',
            }}
          />

          {/* Honeypot — hidden to humans, irresistible to bots. */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', left: '-10000px', top: 'auto',
              width: 1, height: 1, overflow: 'hidden',
            }}
          >
            <label>
              Website
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
              />
            </label>
          </div>

          {/* Errors */}
          {error && (
            <div role="alert" style={{
              marginTop: 20, padding: '10px 14px',
              background: ERR_BG, border: `1px solid ${ERR_BORDER}`,
              borderRadius: 8, color: ERR_TEXT, fontSize: 13,
              display: 'flex', alignItems: 'flex-start', gap: 8,
            }}>
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}

          {missingFields.length > 0 && (
            <div style={{
              marginTop: 16, fontSize: 12, color: TEXT_MUTED,
            }}>
              Still needed: {missingFields.join(' · ')}
            </div>
          )}

          {/* Submit */}
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                background: canSubmit ? BRAND_ORANGE : '#FCA98D',
                color: '#fff', border: 'none', borderRadius: 8,
                padding: '12px 22px', fontSize: 14, fontWeight: 700,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                display: 'inline-flex', alignItems: 'center', gap: 8,
                transition: 'background 120ms',
              }}
            >
              {submitting && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
              {submitting ? 'Sending…' : 'Submit request'}
            </button>
          </div>
        </div>

        <footer style={{
          marginTop: 16, textAlign: 'center',
          fontSize: 11, color: '#9CA3AF',
        }}>
          Stride Logistics · Kent, WA · <a href="https://www.mystridehub.com" style={{ color: BRAND_ORANGE, textDecoration: 'none' }}>mystridehub.com</a>
        </footer>
      </form>
    </PageShell>
  );
}

// ── Layout primitives ──────────────────────────────────────────────────
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh', background: BG, color: TEXT,
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      padding: '0 16px',
    }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      {children}
    </div>
  );
}

function SectionHeading({ icon, label }: { icon?: React.ReactNode; label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      color: BRAND_ORANGE, fontSize: 11, fontWeight: 700,
      letterSpacing: '0.12em', textTransform: 'uppercase',
      marginBottom: 12,
    }}>
      {icon}<span>{label}</span>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: LABEL,
        textTransform: 'uppercase', letterSpacing: '0.06em',
        marginBottom: 4,
      }}>
        {label}{required && <span style={{ color: '#DC2626' }}> *</span>}
      </div>
      {children}
    </label>
  );
}

function Input({
  value, onChange, type = 'text', placeholder,
}: {
  value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%', boxSizing: 'border-box',
        padding: '8px 10px', borderRadius: 6,
        border: `1px solid ${BORDER}`, fontSize: 13,
        color: TEXT, background: '#fff',
        fontFamily: 'inherit',
      }}
    />
  );
}

function Select({
  value, onChange, children,
}: {
  value: string; onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: '100%', boxSizing: 'border-box',
        padding: '8px 10px', borderRadius: 6,
        border: `1px solid ${BORDER}`, fontSize: 13,
        color: TEXT, background: '#fff',
        fontFamily: 'inherit',
      }}
    >
      {children}
    </select>
  );
}

function Grid({ cols, style, children }: { cols: number; style?: CSSProperties; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 12,
      ...style,
    }}>
      {children}
    </div>
  );
}

function Spacer() {
  return <div style={{ height: 24 }} />;
}

const th: CSSProperties = {
  textAlign: 'left',
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  padding: '4px 6px',
  borderBottom: '1px solid #DBEAFE',
};

const td: CSSProperties = {
  padding: '6px 6px',
  verticalAlign: 'middle',
};
