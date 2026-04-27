/**
 * PublicServiceRequest — no-auth service-request page.
 *
 * Phase 2 rewrite: copied from CreateDeliveryOrderModal as the
 * structural starting point so the public form looks and behaves
 * exactly like the authenticated modal — same sections, same
 * styling, same fields, same date/time pickers, same mode selector,
 * same address field layout. Differences are limited to:
 *   • Modal overlay → full-page layout with a public header/footer.
 *   • Client account selector → free-text contact info section
 *     (name, company, phone, email).
 *   • Bill To panel hidden (anon submissions are unbilled until
 *     review).
 *   • Inventory item picker hidden (only ad-hoc items are allowed
 *     for public submitters).
 *   • Valuation coverage / accessorials / pricing summary hidden
 *     (anon users do not see prices; staff sets them on review).
 *   • Single "Submit Request" CTA — no draft, no DT push.
 *   • Submission writes directly to Supabase via the anon INSERT
 *     RLS policies on dt_orders + dt_order_items, with
 *     source='public_form', review_status='pending_review',
 *     tenant_id=null.
 *
 * Backed by migration 20260426220000_dt_orders_public_form_anon_insert.sql.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, AlertTriangle, Loader2, Plus, Trash2,
  Truck, Box, Wrench, MapPin, ArrowRight,
} from 'lucide-react';
import { theme } from '../styles/theme';
import { supabase } from '../lib/supabase';

// ── Types ──────────────────────────────────────────────────────────────
type OrderMode = 'delivery' | 'pickup' | 'pickup_and_delivery' | 'service_only';

interface FreeItem {
  id: string;
  description: string;
  quantity: number;
  weight?: number | null;
  cubicFeet?: number | null;
}

function genUid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── AddressFields sub-component ────────────────────────────────────────
// Mirrors the modal's AddressFields but with the address-book autocomplete
// + Browse button stripped out (anon users have no tenant). Field layout
// and styling are otherwise identical so the visual rhythm matches.
interface AddressFieldsProps {
  contactName: string;     setContactName: (v: string) => void;
  address: string;         setAddress: (v: string) => void;
  city: string;            setCity: (v: string) => void;
  state: string;           setState: (v: string) => void;
  zip: string;             setZip: (v: string) => void;
  phone: string;           setPhone: (v: string) => void;
  phone2: string;          setPhone2: (v: string) => void;
  email: string;           setEmail: (v: string) => void;
  input: React.CSSProperties;
  label: React.CSSProperties;
  contactLabel: string;
}

function AddressFields({
  contactName, setContactName,
  address, setAddress,
  city, setCity,
  state, setState,
  zip, setZip,
  phone, setPhone,
  phone2, setPhone2,
  email, setEmail,
  input, label,
  contactLabel,
}: AddressFieldsProps) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div>
        <label style={label}>{contactLabel}</label>
        <input
          style={input}
          value={contactName}
          onChange={e => setContactName(e.target.value)}
          placeholder="Full name"
        />
      </div>
      <div>
        <label style={label}>Address</label>
        <input style={input} value={address} onChange={e => setAddress(e.target.value)} placeholder="Street address" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px', gap: 10 }}>
        <div>
          <label style={label}>City</label>
          <input style={input} value={city} onChange={e => setCity(e.target.value)} placeholder="City" />
        </div>
        <div>
          <label style={label}>State</label>
          <input style={input} value={state} onChange={e => setState(e.target.value.toUpperCase().slice(0, 2))} maxLength={2} placeholder="WA" />
        </div>
        <div>
          <label style={label}>Zip</label>
          <input
            style={input}
            value={zip}
            onChange={e => setZip(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
            maxLength={5}
            placeholder="00000"
          />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label style={label}>Cell Phone Number</label>
          <input style={input} value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 555-1234" />
        </div>
        <div>
          <label style={label}>Secondary Phone</label>
          <input style={input} value={phone2} onChange={e => setPhone2(e.target.value)} placeholder="(555) 555-5678" />
        </div>
      </div>
      <div>
        <label style={label}>Email</label>
        <input style={input} value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" />
        <div style={{ fontSize: 10, color: theme.colors.textMuted, marginTop: 3 }}>
          Separate multiple emails with commas
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────
export function PublicServiceRequest() {
  // ── Contact info (replaces client selector) ─────────────────────────
  const [contactName, setContactName] = useState('');
  const [contactCompany, setContactCompany] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  // ── Mode ────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<OrderMode>('delivery');

  // ── Schedule ────────────────────────────────────────────────────────
  const [serviceDate, setServiceDate] = useState('');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');

  // ── Pickup contact + items ──────────────────────────────────────────
  const [pickupContactName, setPickupContactName] = useState('');
  const [pickupAddress, setPickupAddress] = useState('');
  const [pickupCity, setPickupCity] = useState('');
  const [pickupState, setPickupState] = useState('WA');
  const [pickupZip, setPickupZip] = useState('');
  const [pickupPhone, setPickupPhone] = useState('');
  const [pickupPhone2, setPickupPhone2] = useState('');
  const [pickupEmail, setPickupEmail] = useState('');
  const [pickupFreeItems, setPickupFreeItems] = useState<FreeItem[]>([
    { id: genUid(), description: '', quantity: 1 },
  ]);

  // ── Delivery contact ────────────────────────────────────────────────
  const [deliveryContactName, setDeliveryContactName] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryCity, setDeliveryCity] = useState('');
  const [deliveryState, setDeliveryState] = useState('WA');
  const [deliveryZip, setDeliveryZip] = useState('');
  const [deliveryPhone, setDeliveryPhone] = useState('');
  const [deliveryPhone2, setDeliveryPhone2] = useState('');
  const [deliveryEmail, setDeliveryEmail] = useState('');

  // ── Service-only description ────────────────────────────────────────
  const [serviceDescription, setServiceDescription] = useState('');

  // ── Ad-hoc delivery items ───────────────────────────────────────────
  const [deliveryFreeItems, setDeliveryFreeItems] = useState<FreeItem[]>([
    { id: genUid(), description: '', quantity: 1, weight: null, cubicFeet: null },
  ]);

  // ── Notes ───────────────────────────────────────────────────────────
  const [details, setDetails] = useState('');

  // ── Submission state ────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ identifier: string } | null>(null);

  // ── Honeypot ────────────────────────────────────────────────────────
  // Bots fill every field they see. Real users never tab into a field
  // pushed off-screen with tabIndex=-1. If this is non-empty on submit
  // we silently no-op (show success without writing).
  const [honeypot, setHoneypot] = useState('');

  // Default delivery contact name to the submitter's name when blank —
  // makes single-name flows (you ARE the recipient) zero-friction.
  useEffect(() => {
    if (contactName && !deliveryContactName) setDeliveryContactName(contactName);
  }, [contactName]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reusable styles (mirror the modal) ──────────────────────────────
  const input: React.CSSProperties = {
    width: '100%', padding: '9px 12px', fontSize: 13,
    border: `1px solid ${theme.colors.border}`, borderRadius: 8,
    outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
  };
  const label: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 600, color: theme.colors.textMuted,
    marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
  };
  const section: React.CSSProperties = {
    marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${theme.colors.border}`,
  };
  const sectionTitle: React.CSSProperties = {
    fontSize: 12, fontWeight: 700, color: theme.colors.text,
    marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6,
    textTransform: 'uppercase', letterSpacing: '0.06em',
  };

  // ── Time window options (9am–5pm, 30-min increments) ────────────────
  const timeOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [{ value: '', label: '— None —' }];
    for (let h = 9; h <= 17; h++) {
      for (let m = 0; m < 60; m += 30) {
        if (h === 17 && m > 0) break;
        const hh = String(h).padStart(2, '0');
        const mm = String(m).padStart(2, '0');
        const ampm = h < 12 ? 'AM' : 'PM';
        const h12 = h > 12 ? h - 12 : h;
        opts.push({ value: `${hh}:${mm}`, label: `${h12}:${mm} ${ampm}` });
      }
    }
    return opts;
  }, []);

  // ── Mode cards (mirror the modal) ───────────────────────────────────
  const modeCards: Array<{ mode: OrderMode; icon: React.ReactNode; label: string; desc: string }> = [
    { mode: 'delivery',            icon: <Truck size={20} />,             label: 'Delivery',           desc: 'Bring items to us, we deliver them out' },
    { mode: 'pickup',              icon: <Box size={20} />,               label: 'Pickup',             desc: 'We pick up items and bring them to our warehouse' },
    { mode: 'pickup_and_delivery', icon: <ArrowRight size={20} />,        label: 'Pickup + Delivery',  desc: 'We pick up and deliver — skip the warehouse' },
    { mode: 'service_only',        icon: <Wrench size={20} />,            label: 'Service Only',       desc: 'On-site visit, no items moved' },
  ];

  // ── Validation ──────────────────────────────────────────────────────
  const needsPickup = mode === 'pickup' || mode === 'pickup_and_delivery';
  const needsDelivery = mode === 'delivery' || mode === 'pickup_and_delivery' || mode === 'service_only';
  const needsItems = mode !== 'service_only';

  const missingFields = useMemo(() => {
    const out: string[] = [];
    if (!contactName.trim()) out.push('your name');
    if (!contactEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) out.push('a valid email');
    if (!contactPhone.trim()) out.push('your phone');
    if (needsPickup) {
      if (!pickupAddress.trim() || !pickupCity.trim() || pickupZip.length !== 5) out.push('pickup address');
    }
    if (needsDelivery) {
      const lbl = mode === 'service_only' ? 'service address' : 'delivery address';
      if (!deliveryAddress.trim() || !deliveryCity.trim() || deliveryZip.length !== 5) out.push(lbl);
    }
    if (mode === 'service_only' && !serviceDescription.trim()) out.push('a description of the service needed');
    if (needsItems) {
      const list = mode === 'pickup' ? pickupFreeItems : deliveryFreeItems;
      const altList = mode === 'pickup_and_delivery' ? pickupFreeItems : null;
      const hasAny =
        list.some(i => i.description.trim()) ||
        (altList ? altList.some(i => i.description.trim()) : false);
      if (!hasAny) out.push('at least one item');
    }
    return out;
  }, [
    contactName, contactEmail, contactPhone,
    pickupAddress, pickupCity, pickupZip,
    deliveryAddress, deliveryCity, deliveryZip,
    mode, serviceDescription, pickupFreeItems, deliveryFreeItems,
    needsPickup, needsDelivery, needsItems,
  ]);

  const canSubmit = !submitting && missingFields.length === 0;

  // ── Submit ──────────────────────────────────────────────────────────
  async function submitPublicRequest() {
    // Honeypot check first — pretend success so a bot can't probe the
    // failure state to learn what to bypass.
    if (honeypot.trim()) {
      setSuccess({ identifier: 'REQ-IGNORED' });
      return;
    }

    if (!canSubmit) {
      setSubmitError('Please fill in all required fields.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      // Anon role can't call the next-order-number RPC, so we mint a
      // collision-resistant stub identifier. Staff issues a proper
      // DT-####-### number on review. Combines a base36 timestamp with
      // 4 random base36 chars — concurrent submissions in the same ms
      // still differ on the random suffix.
      const dtIdentifier = `REQ-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

      // Pack submitter contact + notes into the existing `details`
      // column. Staff sees this on the review screen.
      const detailLines: string[] = [
        `Submitted via public form by ${contactName.trim()}${contactCompany.trim() ? ` (${contactCompany.trim()})` : ''}`,
        `Email: ${contactEmail.trim()}`,
        `Phone: ${contactPhone.trim()}`,
      ];
      if (mode === 'service_only' && serviceDescription.trim()) {
        detailLines.push('');
        detailLines.push(`Service description: ${serviceDescription.trim()}`);
      }
      if (details.trim()) {
        detailLines.push('');
        detailLines.push(`Notes: ${details.trim()}`);
      }

      // Pick the contact row to seed contact_* columns from. Delivery
      // takes precedence when there is one; pickup-only requests fall
      // back to pickup. The submitter's typed name wins over the
      // address-block contact name when the latter is blank.
      const isPickupOnly = mode === 'pickup';
      const contactSeed = isPickupOnly
        ? {
            name: (pickupContactName || contactName).trim(),
            address: pickupAddress.trim(),
            city: pickupCity.trim(),
            state: pickupState.trim(),
            zip: pickupZip.trim(),
            phone: pickupPhone.trim() || contactPhone.trim(),
            phone2: pickupPhone2.trim(),
            email: pickupEmail.trim() || contactEmail.trim(),
          }
        : {
            name: (deliveryContactName || contactName).trim(),
            address: deliveryAddress.trim(),
            city: deliveryCity.trim(),
            state: deliveryState.trim(),
            zip: deliveryZip.trim(),
            phone: deliveryPhone.trim() || contactPhone.trim(),
            phone2: deliveryPhone2.trim(),
            email: deliveryEmail.trim() || contactEmail.trim(),
          };

      const orderPayload: Record<string, unknown> = {
        // RLS-required defaults
        source: 'public_form',
        review_status: 'pending_review',
        tenant_id: null,
        created_by_user: null,
        created_by_role: 'public',

        // Identity + scheduling
        dt_identifier: dtIdentifier,
        timezone: 'America/Los_Angeles',
        local_service_date: serviceDate || null,
        window_start_local: windowStart || null,
        window_end_local: windowEnd || null,

        // Order shape
        order_type: mode,
        is_pickup: mode === 'pickup',

        // Contact (single-leg). For P+D, anon submission collapses to a
        // single dt_orders row — staff splits into linked pair on review.
        contact_name: contactSeed.name,
        contact_company: contactCompany.trim() || null,
        contact_address: contactSeed.address || null,
        contact_city: contactSeed.city || null,
        contact_state: contactSeed.state || null,
        contact_zip: contactSeed.zip || null,
        contact_phone: contactSeed.phone || null,
        contact_phone2: contactSeed.phone2 || null,
        contact_email: contactSeed.email || null,

        // Free-text submitter info + notes
        details: detailLines.join('\n'),

        // Public submissions are unpriced — staff sets fees on review.
        pricing_override: true,
        pricing_notes: 'Submitted via public form — staff to confirm pricing on review.',
      };

      const { data: orderRow, error: orderErr } = await supabase
        .from('dt_orders')
        .insert(orderPayload)
        .select('id, dt_identifier')
        .single();
      if (orderErr || !orderRow) {
        // Don't echo Supabase error details to anon users — could leak
        // schema/constraint names. Log for debugging, show generic copy.
        if (orderErr) console.warn('[public-service-request] order insert failed:', orderErr);
        throw new Error('We could not submit your request. Please try again, or email us if the problem persists.');
      }

      // Items — combine pickup + delivery ad-hoc lists per mode. P+D
      // ships the pickup list (delivery leg auto-copies on review).
      const itemRows: Array<Record<string, unknown>> = [];
      const adhocSources: FreeItem[][] =
        mode === 'pickup' ? [pickupFreeItems]
        : mode === 'delivery' ? [deliveryFreeItems]
        : mode === 'pickup_and_delivery' ? [pickupFreeItems]
        : [];
      for (const list of adhocSources) {
        for (const item of list) {
          if (!item.description.trim()) continue;
          const qty = Math.max(1, Number(item.quantity) || 1);
          const weight = Number.isFinite(Number(item.weight)) && Number(item.weight) > 0 ? Number(item.weight) : null;
          const cuFt = Number.isFinite(Number(item.cubicFeet)) && Number(item.cubicFeet) > 0 ? Number(item.cubicFeet) : null;
          itemRows.push({
            dt_order_id: (orderRow as { id: string }).id,
            dt_item_code: null,
            description: item.description.trim(),
            quantity: qty,
            original_quantity: qty,
            cubic_feet: cuFt != null ? cuFt * qty : null,
            extras: {
              source: 'public_form_adhoc',
              weight,
              cuft: cuFt,
            },
          });
        }
      }
      if (itemRows.length > 0) {
        const { error: itemsErr } = await supabase.from('dt_order_items').insert(itemRows);
        if (itemsErr) {
          console.warn('[public-service-request] items insert failed:', itemsErr);
          throw new Error('Your request was received, but we could not save the items list. Please email us with the items so we can attach them.');
        }
      }

      setSuccess({ identifier: (orderRow as { dt_identifier: string }).dt_identifier });

      // Fire-and-forget submitter confirmation + internal alert. The
      // function uses the service role to read the order/items + the
      // public_form_settings.alert_emails list and dispatches both
      // emails via GAS sendRawEmail. We don't block the success state
      // on it — failure to email shouldn't change what the submitter
      // sees, and admins will see the order in the Review Queue
      // regardless.
      void supabase.functions
        .invoke('notify-public-request', { body: { orderId: (orderRow as { id: string }).id } })
        .catch(err => console.warn('[public-service-request] notify-public-request failed:', err));
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setContactName('');
    setContactCompany('');
    setContactEmail('');
    setContactPhone('');
    setMode('delivery');
    setServiceDate('');
    setWindowStart('');
    setWindowEnd('');
    setPickupContactName(''); setPickupAddress(''); setPickupCity('');
    setPickupState('WA'); setPickupZip(''); setPickupPhone('');
    setPickupPhone2(''); setPickupEmail('');
    setPickupFreeItems([{ id: genUid(), description: '', quantity: 1 }]);
    setDeliveryContactName(''); setDeliveryAddress(''); setDeliveryCity('');
    setDeliveryState('WA'); setDeliveryZip(''); setDeliveryPhone('');
    setDeliveryPhone2(''); setDeliveryEmail('');
    setDeliveryFreeItems([{ id: genUid(), description: '', quantity: 1, weight: null, cubicFeet: null }]);
    setServiceDescription('');
    setDetails('');
    setSubmitError(null);
    setSuccess(null);
    setHoneypot('');
  }

  // ── Success view ────────────────────────────────────────────────────
  if (success) {
    return (
      <PageShell>
        <div style={{
          background: '#fff', borderRadius: 16, padding: 40,
          border: `1px solid ${theme.colors.border}`,
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
          textAlign: 'center',
        }}>
          <CheckCircle2 size={48} color="#15803D" style={{ margin: '0 auto 16px' }} />
          <div style={{ fontSize: 22, fontWeight: 700, color: theme.colors.text, marginBottom: 8 }}>
            Request received
          </div>
          <div style={{ fontSize: 13, color: theme.colors.textMuted, marginBottom: 4 }}>
            Reference number
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 600, color: theme.colors.primary, marginBottom: 18 }}>
            {success.identifier}
          </div>
          <p style={{ margin: '0 auto 24px', fontSize: 14, color: theme.colors.textMuted, maxWidth: 480, lineHeight: 1.5 }}>
            Thanks{contactName.trim() ? `, ${contactName.trim()}` : ''}. We'll review your
            request and follow up at <strong style={{ color: theme.colors.text }}>{contactEmail || 'the email you provided'}</strong>{' '}
            within one business day.
          </p>
          <button
            type="button"
            onClick={resetForm}
            style={{
              padding: '10px 22px', borderRadius: 8,
              border: `1px solid ${theme.colors.border}`,
              background: '#fff', color: theme.colors.text,
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Submit another request
          </button>
        </div>
      </PageShell>
    );
  }

  // ── Form view ───────────────────────────────────────────────────────
  return (
    <PageShell>
      <div style={{
        background: '#fff', borderRadius: 16,
        border: `1px solid ${theme.colors.border}`,
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        overflow: 'hidden',
      }}>
        {/* Form body */}
        <div style={{ padding: 24 }}>

          {/* Your contact info — replaces the modal's Client selector */}
          <div style={section}>
            <div style={sectionTitle}>Your contact info</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={label}>Full name</label>
                <input style={input} value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Jane Smith" />
              </div>
              <div>
                <label style={label}>Company</label>
                <input style={input} value={contactCompany} onChange={e => setContactCompany(e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <label style={label}>Email</label>
                <input style={input} type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="you@example.com" />
              </div>
              <div>
                <label style={label}>Phone</label>
                <input style={input} type="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="(555) 555-5555" />
              </div>
            </div>
          </div>

          {/* Mode cards */}
          <div style={section}>
            <div style={sectionTitle}>What type of request?</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              {modeCards.map(card => (
                <button
                  key={card.mode}
                  type="button"
                  onClick={() => setMode(card.mode)}
                  style={{
                    padding: '14px 14px', borderRadius: 12,
                    border: mode === card.mode ? `2px solid ${theme.colors.primary}` : `1px solid ${theme.colors.border}`,
                    background: mode === card.mode ? '#FFF7ED' : '#fff',
                    color: mode === card.mode ? theme.colors.primary : theme.colors.text,
                    cursor: 'pointer', fontFamily: 'inherit',
                    textAlign: 'left',
                    display: 'flex', flexDirection: 'column', gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700 }}>
                    {card.icon} {card.label}
                  </div>
                  <div style={{ fontSize: 11, color: theme.colors.textMuted, lineHeight: 1.3 }}>
                    {card.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Schedule */}
          <div style={section}>
            <div style={sectionTitle}>Preferred schedule</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <label style={label}>Preferred Service Date</label>
                <input type="date" value={serviceDate} onChange={e => setServiceDate(e.target.value)} style={input} />
              </div>
              <div>
                <label style={label}>Preferred Window Start</label>
                <select value={windowStart} onChange={e => setWindowStart(e.target.value)} style={{ ...input, cursor: 'pointer' }}>
                  {timeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label style={label}>Preferred Window End</label>
                <select value={windowEnd} onChange={e => setWindowEnd(e.target.value)} style={{ ...input, cursor: 'pointer' }}>
                  {timeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 8 }}>
              We'll do our best — final scheduling is confirmed after staff review.
            </div>
          </div>

          {/* PICKUP section */}
          {(mode === 'pickup' || mode === 'pickup_and_delivery') && (
            <div style={section}>
              <div style={sectionTitle}>
                <Box size={12} /> Pickup From
              </div>
              <AddressFields
                contactName={pickupContactName}     setContactName={setPickupContactName}
                address={pickupAddress}             setAddress={setPickupAddress}
                city={pickupCity}                   setCity={setPickupCity}
                state={pickupState}                 setState={setPickupState}
                zip={pickupZip}                     setZip={setPickupZip}
                phone={pickupPhone}                 setPhone={setPickupPhone}
                phone2={pickupPhone2}               setPhone2={setPickupPhone2}
                email={pickupEmail}                 setEmail={setPickupEmail}
                input={input} label={label}
                contactLabel="Contact at pickup"
              />
              <div style={{ marginTop: 14 }}>
                <div style={{ ...label, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Items to Pick Up</span>
                  <button
                    type="button"
                    onClick={() => setPickupFreeItems(prev => [...prev, { id: genUid(), description: '', quantity: 1 }])}
                    style={{ background: 'none', border: 'none', color: theme.colors.primary, cursor: 'pointer', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    <Plus size={11} /> Add Item
                  </button>
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {pickupFreeItems.map(item => (
                    <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 32px', gap: 8, alignItems: 'center' }}>
                      <input
                        style={input}
                        placeholder="Description (e.g., sofa, dining table)"
                        value={item.description}
                        onChange={e => setPickupFreeItems(prev => prev.map(i => i.id === item.id ? { ...i, description: e.target.value } : i))}
                      />
                      <input
                        style={input}
                        type="number" min={1}
                        placeholder="Qty"
                        value={item.quantity}
                        onChange={e => setPickupFreeItems(prev => prev.map(i => i.id === item.id ? { ...i, quantity: Math.max(1, parseInt(e.target.value, 10) || 1) } : i))}
                      />
                      <button
                        type="button"
                        onClick={() => setPickupFreeItems(prev => prev.filter(i => i.id !== item.id))}
                        disabled={pickupFreeItems.length <= 1}
                        style={{ background: 'none', border: 'none', cursor: pickupFreeItems.length > 1 ? 'pointer' : 'not-allowed', color: '#991B1B', padding: 4, opacity: pickupFreeItems.length > 1 ? 1 : 0.4 }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                {mode === 'pickup_and_delivery' && (
                  <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 8, fontStyle: 'italic' }}>
                    These items will also be delivered to the address below.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* DELIVERY / SERVICE section */}
          {(mode === 'delivery' || mode === 'pickup_and_delivery' || mode === 'service_only') && (
            <div style={section}>
              <div style={sectionTitle}>
                {mode === 'service_only' ? <><Wrench size={12} /> Service At</> : <><MapPin size={12} /> Deliver To</>}
              </div>
              <AddressFields
                contactName={deliveryContactName}     setContactName={setDeliveryContactName}
                address={deliveryAddress}             setAddress={setDeliveryAddress}
                city={deliveryCity}                   setCity={setDeliveryCity}
                state={deliveryState}                 setState={setDeliveryState}
                zip={deliveryZip}                     setZip={setDeliveryZip}
                phone={deliveryPhone}                 setPhone={setDeliveryPhone}
                phone2={deliveryPhone2}               setPhone2={setDeliveryPhone2}
                email={deliveryEmail}                 setEmail={setDeliveryEmail}
                input={input} label={label}
                contactLabel={mode === 'service_only' ? 'On-site contact' : 'Recipient'}
              />

              {/* Ad-hoc items for delivery mode (public users have no
                  warehouse inventory access — only ad-hoc lines). */}
              {mode === 'delivery' && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ ...label, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                    <span>Items</span>
                    <button
                      type="button"
                      onClick={() => setDeliveryFreeItems(prev => [...prev, { id: genUid(), description: '', quantity: 1, weight: null, cubicFeet: null }])}
                      style={{ background: 'none', border: 'none', color: theme.colors.primary, cursor: 'pointer', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <Plus size={11} /> Add item
                    </button>
                  </div>
                  <div style={{
                    background: '#FFFBEB',
                    border: '1px solid #FDE68A',
                    borderRadius: 8,
                    padding: 8,
                    display: 'grid', gap: 6,
                  }}>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 70px 80px 80px 32px',
                      gap: 8,
                      fontSize: 10, fontWeight: 600, color: '#92400E',
                      textTransform: 'uppercase', letterSpacing: '0.5px',
                      padding: '0 4px',
                    }}>
                      <span>Description</span>
                      <span>Qty</span>
                      <span>Weight (lb)</span>
                      <span>Volume (cu ft)</span>
                      <span />
                    </div>
                    {deliveryFreeItems.map(item => (
                      <div key={item.id} style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 70px 80px 80px 32px',
                        gap: 8,
                        alignItems: 'center',
                      }}>
                        <input
                          style={input}
                          placeholder="Description (required)"
                          value={item.description}
                          onChange={e => setDeliveryFreeItems(prev => prev.map(i => i.id === item.id ? { ...i, description: e.target.value } : i))}
                        />
                        <input
                          style={input}
                          type="number" min={1}
                          placeholder="Qty"
                          value={item.quantity}
                          onChange={e => setDeliveryFreeItems(prev => prev.map(i => i.id === item.id ? { ...i, quantity: Math.max(1, parseInt(e.target.value, 10) || 1) } : i))}
                        />
                        <input
                          style={input}
                          type="number" min={0} step="0.1"
                          placeholder="—"
                          value={item.weight ?? ''}
                          onChange={e => setDeliveryFreeItems(prev => prev.map(i => {
                            if (i.id !== item.id) return i;
                            const v = e.target.value.trim();
                            if (v === '') return { ...i, weight: null };
                            const n = parseFloat(v);
                            return { ...i, weight: Number.isFinite(n) && n >= 0 ? n : null };
                          }))}
                        />
                        <input
                          style={input}
                          type="number" min={0} step="0.1"
                          placeholder="—"
                          value={item.cubicFeet ?? ''}
                          onChange={e => setDeliveryFreeItems(prev => prev.map(i => {
                            if (i.id !== item.id) return i;
                            const v = e.target.value.trim();
                            if (v === '') return { ...i, cubicFeet: null };
                            const n = parseFloat(v);
                            return { ...i, cubicFeet: Number.isFinite(n) && n >= 0 ? n : null };
                          }))}
                        />
                        <button
                          type="button"
                          onClick={() => setDeliveryFreeItems(prev => prev.length <= 1 ? prev : prev.filter(i => i.id !== item.id))}
                          disabled={deliveryFreeItems.length <= 1}
                          title="Remove item"
                          style={{
                            background: 'none', border: 'none',
                            cursor: deliveryFreeItems.length > 1 ? 'pointer' : 'not-allowed',
                            color: '#991B1B', padding: 4,
                            opacity: deliveryFreeItems.length > 1 ? 1 : 0.4,
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Auto-copied items echo for pickup_and_delivery */}
              {mode === 'pickup_and_delivery' && (
                <div style={{ marginTop: 14 }}>
                  <div style={label}>Items to deliver (copied from pickup)</div>
                  <div style={{ padding: 12, background: '#F9FAFB', borderRadius: 8, fontSize: 12, color: theme.colors.textMuted }}>
                    {pickupFreeItems.filter(i => i.description.trim()).length === 0
                      ? "Add items on the Pickup section above — they'll appear here automatically."
                      : pickupFreeItems.filter(i => i.description.trim()).map((i, idx) => (
                          <div key={i.id} style={{ paddingTop: idx > 0 ? 4 : 0 }}>
                            • {i.description} (qty {i.quantity})
                          </div>
                        ))
                    }
                  </div>
                </div>
              )}

              {/* Service description for service-only */}
              {mode === 'service_only' && (
                <div style={{ marginTop: 14 }}>
                  <label style={label}>What service is needed?</label>
                  <textarea
                    style={{ ...input, minHeight: 70, resize: 'vertical' }}
                    value={serviceDescription}
                    onChange={e => setServiceDescription(e.target.value)}
                    placeholder="e.g., On-site quote visit, drop off samples, repair, etc."
                  />
                </div>
              )}
            </div>
          )}

          {/* Notes / Special Instructions */}
          <div style={section}>
            <div style={sectionTitle}>Notes / Special Instructions</div>
            <textarea
              style={{ ...input, minHeight: 70, resize: 'vertical' }}
              value={details}
              onChange={e => setDetails(e.target.value)}
              placeholder={mode === 'service_only'
                ? 'Anything else we should know? Access details, parking, etc.'
                : 'Delivery instructions, gate codes, elevator notes, fragile items, stairs, etc.'}
            />
          </div>

          {/* Honeypot — visually + accessibility hidden */}
          <div aria-hidden="true" style={{ position: 'absolute', left: -10000, top: -10000, height: 0, width: 0, overflow: 'hidden' }}>
            <label>
              Leave this empty
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={e => setHoneypot(e.target.value)}
              />
            </label>
          </div>

          {/* Error banner */}
          {submitError && (
            <div style={{
              marginTop: 4, marginBottom: 12,
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '10px 14px', borderRadius: 8,
              background: '#FEF2F2', border: '1px solid #FECACA',
              fontSize: 13, color: '#991B1B',
            }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{submitError}</span>
            </div>
          )}
        </div>

        {/* Footer — mirrors the modal's footer */}
        <div style={{
          padding: '14px 24px', borderTop: `1px solid ${theme.colors.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          background: '#FAFAFA',
          flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {missingFields.length > 0 && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                fontSize: 11, color: '#92400E', lineHeight: 1.5,
              }}>
                <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  Still needed before submit: <strong>{missingFields.join(', ')}</strong>
                </span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={submitPublicRequest}
            disabled={!canSubmit}
            style={{
              padding: '10px 28px', borderRadius: 8,
              border: 'none',
              background: canSubmit ? theme.colors.primary : theme.colors.border,
              color: '#fff',
              fontSize: 14, fontWeight: 600,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', gap: 8,
            }}
          >
            {submitting ? <Loader2 size={14} className="spin" /> : null}
            {submitting ? 'Submitting…' : 'Submit Request'}
          </button>
        </div>
      </div>
    </PageShell>
  );
}

// ── Page shell (header + body container + footer) ─────────────────────
// Visual style matches the existing PublicRates / PublicPhotoGallery
// public pages so a customer who lands on any of the three sees a
// cohesive Stride-branded surface.
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: theme.colors.bgSubtle,
      fontFamily: theme.typography.fontFamily,
      color: theme.colors.text,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header bar */}
      <header style={{
        background: '#fff',
        borderBottom: `1px solid ${theme.colors.border}`,
        padding: '20px 24px',
      }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            color: theme.colors.primary, fontSize: 11, fontWeight: 700,
            letterSpacing: '0.12em', textTransform: 'uppercase',
            marginBottom: 6,
          }}>
            <Truck size={14} /> Stride Logistics
          </div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: theme.colors.text }}>
            Service Request
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: theme.colors.textMuted }}>
            Tell us what you need delivered, picked up, or serviced and a Stride
            team member will follow up to confirm details and pricing.
          </p>
        </div>
      </header>

      {/* Body */}
      <main style={{
        flex: 1,
        maxWidth: 960, width: '100%', margin: '0 auto',
        padding: '24px 16px',
        boxSizing: 'border-box',
      }}>
        {children}
      </main>

      {/* Footer */}
      <footer style={{
        padding: '16px 24px', borderTop: `1px solid ${theme.colors.border}`,
        textAlign: 'center', fontSize: 12, color: theme.colors.textMuted,
        background: '#fff',
      }}>
        Already a Stride customer?{' '}
        <a href="/#/" style={{ color: theme.colors.primary, fontWeight: 600, textDecoration: 'none' }}>
          Sign in
        </a>
      </footer>
    </div>
  );
}
