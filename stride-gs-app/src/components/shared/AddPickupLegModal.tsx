/**
 * AddPickupLegModal — Multi-pickup Phase 1.5.
 *
 * Mini-modal triggered by the "Add Pickup" button on a delivery's
 * OrderPage. Creates an additional pickup leg (dt_orders row +
 * dt_pickup_links join row) so a single delivery can collect from
 * multiple sites en route. The original `-P` pickup keeps its
 * identifier; the new leg gets `-P2`, `-P3`, ... matching the
 * sort_order on the join row.
 *
 * Scope:
 *   • Pickup contact block + time window + label + per-leg notes.
 *   • Per-leg pickup zone fee preview (looked up from delivery_zones
 *     by zip). The parent delivery's base_delivery_fee + order_total
 *     are incremented by that fee on save — fixing the Phase 1 gap
 *     where adding N pickups did not increase the bill.
 *   • Auto-pushes the new pickup to DispatchTrack after a successful
 *     create (Phase 1 required operators to click Push from the
 *     delivery page manually — easy to forget).
 *   • No items input — operator adds items via the regular edit flow
 *     after the leg is created (existing affordances on the pickup's
 *     OrderPage). Keeps the modal under a single-screen footprint.
 *
 * Identifier scheme (per spec §5):
 *   Original pickup keeps `-P`; new pickups start at `-P2` and increment.
 *   The identifier suffix tracks sort_order+1 when sort_order > 0; sort_order=0
 *   reserves the base `-P` for the original. We always allocate the next
 *   sort_order = (max existing) + 1, so the original `-P` (sort_order=0)
 *   and N additions (sort_order=1..N) line up with suffixes -P2..-P(N+1).
 *
 * Identifier collision: pickup_order_id has a UNIQUE constraint on the
 * join table, and dt_orders.dt_identifier is UNIQUE per tenant. We
 * generate `-P{sortOrder+1}` from the delivery's base identifier — if
 * that exact identifier already exists in dt_orders (rare race), the
 * INSERT will fail; user-visible as "save failed" with the Postgres
 * unique-violation message.
 *
 * Notes deduplication: pickup_notes is written ONLY to the new pickup
 * dt_orders row. The dt_pickup_links.pickup_notes column was a redundant
 * mirror in PR #577 — dt-push-order builds the leg's DT payload from
 * dt_orders.pickup_notes, so writing to the link row added nothing and
 * created a divergence risk. The supabaseQueries read path now joins
 * the pickup dt_orders row for the authoritative value.
 */

import React, { useState, useEffect } from 'react';
import { X, Truck, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { fetchDeliveryZone, type DtOrderForUI, type DeliveryZone } from '../../lib/supabaseQueries';
import { theme } from '../../styles/theme';
import { EntityPageTokens as EP } from './EntityPage';

interface Props {
  open: boolean;
  onClose: () => void;
  /** The delivery order on whose OrderPage the modal was opened. */
  deliveryOrder: DtOrderForUI;
  /** Fires after a successful insert so the parent can refetch the
   *  order (to pick up the new linked pickup in dt_pickup_links). */
  onSuccess: () => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', fontSize: 13,
  border: `1px solid ${theme.colors.border}`, borderRadius: 8,
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
  background: '#fff',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 700,
  letterSpacing: '0.06em', textTransform: 'uppercase',
  color: EP.textMuted, marginBottom: 4,
};

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: 'text' | 'date' | 'time' | 'email' | 'tel';
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={labelStyle}>{label}</label>
      <input type={type} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)} style={inputStyle} />
    </div>
  );
}

function TextareaField({ label, value, onChange, rows = 3, placeholder, help }: {
  label: string; value: string; onChange: (v: string) => void;
  rows?: number; placeholder?: string; help?: string;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={labelStyle}>{label}</label>
      <textarea value={value} rows={rows} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        style={{ ...inputStyle, resize: 'vertical' }} />
      {help && (
        <div style={{ fontSize: 11, color: EP.textMuted, marginTop: 4, lineHeight: 1.5 }}>{help}</div>
      )}
    </div>
  );
}

export function AddPickupLegModal({ open, onClose, deliveryOrder, onSuccess }: Props) {
  const [contactName, setContactName] = useState('');
  const [contactAddress, setContactAddress] = useState('');
  const [contactCity, setContactCity] = useState('');
  const [contactState, setContactState] = useState('');
  const [contactZip, setContactZip] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [serviceDate, setServiceDate] = useState(deliveryOrder.localServiceDate || '');
  const [windowStart, setWindowStart] = useState((deliveryOrder.windowStartLocal || '').slice(0, 5));
  const [windowEnd, setWindowEnd] = useState((deliveryOrder.windowEndLocal || '').slice(0, 5));
  const [label, setLabel] = useState('');
  const [pickupNotes, setPickupNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-leg zone fee preview. Resolved from delivery_zones when the
  // entered zip is a complete 5-digit code; null while loading or for
  // out-of-service zips. The same value snapshots onto
  // dt_pickup_links.pickup_leg_fee on save and increments the parent
  // delivery's base_delivery_fee + order_total.
  const [pickupZone, setPickupZone] = useState<DeliveryZone | null>(null);
  const [zoneLoading, setZoneLoading] = useState(false);

  useEffect(() => {
    const trimmed = contactZip.trim();
    if (trimmed.length !== 5) {
      setPickupZone(null);
      return;
    }
    let cancelled = false;
    setZoneLoading(true);
    fetchDeliveryZone(trimmed).then(z => {
      if (cancelled) return;
      setPickupZone(z);
      setZoneLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setPickupZone(null);
      setZoneLoading(false);
    });
    return () => { cancelled = true; };
  }, [contactZip]);

  if (!open) return null;

  const legFee = pickupZone?.baseRate ?? 0;
  const callForQuote = contactZip.trim().length === 5 && pickupZone != null && pickupZone.baseRate == null;
  const outOfArea    = contactZip.trim().length === 5 && pickupZone == null && !zoneLoading;
  const canSave = !saving && contactName.trim().length > 0 && serviceDate.length > 0;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // 1. Allocate next sort_order. Max + 1; cap at 8 (so suffix stays
      //    single-digit -P2..-P9). Original `-P` lives at sort_order=0.
      const existingSorts = deliveryOrder.linkedPickups.map(lp => lp.sortOrder ?? 0);
      const maxSort = existingSorts.length > 0 ? Math.max(...existingSorts) : 0;
      const nextSort = maxSort + 1;
      if (nextSort > 8) {
        setError('This delivery already has 9 pickup legs — the cap for single-digit -P suffixes. Phase 1 supports up to 9 (-P through -P9).');
        setSaving(false);
        return;
      }

      // 2. Compute identifier. Delivery is `BASE-D`; pickup is
      //    `BASE-P{nextSort+1}` per spec §5 (sort_order=1 → -P2,
      //    sort_order=2 → -P3, ...). Original pickup at sort_order=0
      //    keeps `-P`.
      const deliveryIdent = deliveryOrder.dtIdentifier || '';
      const base = deliveryIdent.endsWith('-D')
        ? deliveryIdent.slice(0, -2)
        : deliveryIdent;
      const newPickupIdent = `${base}-P${nextSort + 1}`;

      // 3. INSERT the pickup dt_orders row. Mirrors the create flow
      //    in CreateDeliveryOrderModal but stripped to the essentials:
      //    pickup-only row, no items (operator adds via edit flow),
      //    linked_order_id pointing at the delivery for back-compat
      //    with single-pickup consumers. pricing_override+null totals
      //    match the canonical P+D pickup-leg pattern (the leg's fee
      //    is rolled into the parent delivery's totals; see step 5).
      const { data: newPickupRow, error: insertErr } = await supabase
        .from('dt_orders')
        .insert({
          tenant_id:           deliveryOrder.tenantId,
          dt_identifier:       newPickupIdent,
          order_type:          'pickup',
          is_pickup:           true,
          linked_order_id:     deliveryOrder.id,
          contact_name:        contactName.trim(),
          contact_address:     contactAddress.trim() || null,
          contact_city:        contactCity.trim()    || null,
          contact_state:       contactState.trim()   || null,
          contact_zip:         contactZip.trim()     || null,
          contact_phone:       contactPhone.trim()   || null,
          contact_email:       contactEmail.trim()   || null,
          local_service_date:  serviceDate || null,
          window_start_local:  windowStart || null,
          window_end_local:    windowEnd   || null,
          pickup_notes:        pickupNotes.trim() || null,
          review_status:       deliveryOrder.reviewStatus || 'approved',
          source:              'app',
          // Canonical P+D pickup-leg pattern (mirrors the P+D save in
          // CreateDeliveryOrderModal at ~line 2695): pickup leg of a
          // multi-leg order never bills standalone — pricing rolls
          // into the delivery row. Snapshot stays on dt_pickup_links.
          base_delivery_fee:   null,
          order_total:         null,
          pricing_override:    true,
          pricing_notes:       'Pickup leg of multi-pickup delivery — pricing rolled into delivery order.',
        })
        .select('id')
        .single();
      if (insertErr || !newPickupRow) throw new Error(`Failed to create pickup row: ${insertErr?.message ?? 'unknown'}`);
      const newPickupId = (newPickupRow as { id: string }).id;

      // 4. INSERT the join row. Label defaults to contact name when
      //    empty (per Justin's decision §2b Q7). pickup_notes is NOT
      //    written here — see file docstring ("Notes deduplication").
      //    pickup_leg_fee snapshots the zone baseRate at create time
      //    so historical rates don't drift if delivery_zones is later
      //    re-priced.
      const { error: linkErr } = await supabase
        .from('dt_pickup_links')
        .insert({
          tenant_id:         deliveryOrder.tenantId,
          delivery_order_id: deliveryOrder.id,
          pickup_order_id:   newPickupId,
          pickup_label:      label.trim() || contactName.trim() || null,
          pickup_leg_fee:    legFee > 0 ? legFee : null,
          sort_order:        nextSort,
        });
      if (linkErr) throw new Error(`Pickup created but join-row insert failed: ${linkErr.message}`);

      // 5. Increment the parent delivery's totals so the new leg is
      //    billed. SELECT-then-UPDATE — Postgres has no atomic
      //    "increment numeric" via PostgREST and the leg-add flow is
      //    serial enough (one operator clicking one modal) that the
      //    race window is negligible. legFee=0 (out-of-service zip /
      //    call-for-quote) skips the bump; operators will price those
      //    manually during the same review pass that already handles
      //    out-of-service zips on initial create.
      if (legFee > 0) {
        const { data: parentRow, error: parentSelErr } = await supabase
          .from('dt_orders')
          .select('base_delivery_fee, order_total')
          .eq('id', deliveryOrder.id)
          .maybeSingle();
        if (parentSelErr) {
          console.warn('[AddPickupLegModal] parent delivery fetch for fee bump failed:', parentSelErr.message);
        } else if (parentRow) {
          const currentBase  = Number((parentRow as { base_delivery_fee: number | null }).base_delivery_fee ?? 0);
          const currentTotal = Number((parentRow as { order_total:        number | null }).order_total        ?? 0);
          const { error: bumpErr } = await supabase
            .from('dt_orders')
            .update({
              base_delivery_fee: currentBase  + legFee,
              order_total:       currentTotal + legFee,
            })
            .eq('id', deliveryOrder.id);
          if (bumpErr) {
            console.warn('[AddPickupLegModal] parent delivery fee bump failed:', bumpErr.message);
          }
        }
      }

      // 6. Auto-push to DT so the operator doesn't have to remember
      //    a separate Push step. Fire-and-await: the modal stays open
      //    on push failure with a clear error, since a "leg created
      //    but not pushed" state is exactly what we're trying to
      //    avoid. dt-push-order's fan-out re-pushes the parent
      //    delivery alongside this new leg so DT's manifest reflects
      //    the cross-reference and the increased load.
      let pushOk  = false;
      let pushMsg = '';
      try {
        const { data: pushData, error: pushErr } = await supabase.functions.invoke('dt-push-order', {
          body: { orderId: newPickupId },
        });
        if (pushErr) {
          pushMsg = pushErr.message;
          try {
            const ctx = (pushErr as { context?: { json?: () => Promise<unknown> } }).context;
            if (ctx?.json) {
              const body = await ctx.json() as { error?: string } | null;
              if (body?.error) pushMsg = body.error;
            }
          } catch (_) { /* fall back to invokeErr.message */ }
        } else {
          const res = pushData as { ok?: boolean; error?: string; dt_identifier?: string } | null;
          if (res?.ok) {
            pushOk = true;
            pushMsg = res.dt_identifier || newPickupIdent;
          } else {
            pushMsg = res?.error || 'DT push failed';
          }
        }
      } catch (e) {
        pushMsg = (e as Error).message;
      }

      onSuccess();
      onClose();
      // Native alert: matches the existing footer-button DT push UX
      // pattern on OrderPage (no toast library in this app).
      if (pushOk) {
        alert(`Pickup leg ${newPickupIdent} created and pushed to DispatchTrack.`);
      } else {
        alert(`Pickup leg ${newPickupIdent} created in Stride, but the DispatchTrack push failed:\n\n${pushMsg}\n\nOpen the new pickup's page and click Push to retry.`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 12, width: '100%', maxWidth: 560,
          maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${theme.colors.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Truck size={16} color={EP.textPrimary} />
            <div style={{ fontSize: 15, fontWeight: 600, color: EP.textPrimary }}>
              Add Pickup Leg
            </div>
          </div>
          <button onClick={onClose} disabled={saving}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: EP.textMuted }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 12, color: EP.textMuted, marginBottom: 14, lineHeight: 1.5 }}>
            Adds a pickup stop to delivery <strong>{deliveryOrder.dtIdentifier}</strong>.
            The new pickup will be <strong>{(deliveryOrder.dtIdentifier || '').replace(/-D$/, '')}-P{(Math.max(0, ...deliveryOrder.linkedPickups.map(l => l.sortOrder ?? 0)) + 2)}</strong>.
            Items can be added on the new pickup's page after it's created.
          </div>

          <Field label="Pickup Contact Name *" value={contactName} onChange={setContactName} placeholder="Customer / pickup contact" />
          <Field label="Pickup Label" value={label} onChange={setLabel} placeholder={contactName || "e.g. Sarah's house"} />
          <div style={{ fontSize: 11, color: EP.textMuted, marginTop: -6, marginBottom: 10, lineHeight: 1.5 }}>
            Optional. Defaults to the contact name. Used on the delivery's pickup list and the DT description.
          </div>

          <Field label="Pickup Address" value={contactAddress} onChange={setContactAddress} placeholder="Street address" />
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
            <Field label="City" value={contactCity} onChange={setContactCity} />
            <Field label="State" value={contactState} onChange={setContactState} />
            <Field label="ZIP" value={contactZip} onChange={setContactZip} />
          </div>

          {/* Per-leg pickup fee preview. Sourced from the same
              delivery_zones table the create-order modal uses, so a
              zip that's "out of area" or "call for quote" gets the
              same treatment here as on initial order create. */}
          {contactZip.trim().length === 5 && (
            <div style={{
              marginBottom: 10, padding: '10px 12px', borderRadius: 8,
              background: legFee > 0 ? '#ECFDF5' : '#FEF3C7',
              border: `1px solid ${legFee > 0 ? '#A7F3D0' : '#FCD34D'}`,
              fontSize: 12, color: legFee > 0 ? '#065F46' : '#92400E', lineHeight: 1.5,
            }}>
              {zoneLoading ? (
                <>Resolving pickup zone…</>
              ) : callForQuote ? (
                <><strong>Pickup zone is CALL FOR QUOTE</strong> — pickup fee TBD during staff review. The new leg will be added without bumping the order total.</>
              ) : outOfArea ? (
                <><strong>Pickup zip is out of service area</strong> — pickup fee TBD during staff review. The new leg will be added without bumping the order total.</>
              ) : (
                <>
                  <strong>Pickup leg fee:</strong> ${legFee.toFixed(2)}{pickupZone ? ` (Zone ${pickupZone.zone})` : ''}
                  <div style={{ marginTop: 4 }}>
                    This will be added to delivery <strong>{deliveryOrder.dtIdentifier}</strong>'s order total on save.
                  </div>
                </>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Phone" value={contactPhone} onChange={setContactPhone} type="tel" />
            <Field label="Email" value={contactEmail} onChange={setContactEmail} type="email" />
          </div>

          <Field label="Service Date *" value={serviceDate} onChange={setServiceDate} type="date" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Window Start" value={windowStart} onChange={setWindowStart} type="time" />
            <Field label="Window End" value={windowEnd} onChange={setWindowEnd} type="time" />
          </div>

          <TextareaField
            label="Pickup Notes"
            value={pickupNotes}
            onChange={setPickupNotes}
            rows={3}
            placeholder="Gate codes, parking, what to grab, anything driver-specific…"
            help="Pushed to this pickup leg's DT card as the driver-facing note."
          />

          {error && (
            <div style={{
              background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 8,
              padding: '10px 12px', fontSize: 12, color: '#991B1B', marginTop: 6, lineHeight: 1.5,
            }}>
              {error}
            </div>
          )}
        </div>

        <div style={{
          padding: '12px 20px', borderTop: `1px solid ${theme.colors.border}`,
          display: 'flex', justifyContent: 'flex-end', gap: 8, background: '#FAFAF9',
          borderRadius: '0 0 12px 12px',
        }}>
          <button onClick={onClose} disabled={saving}
            style={{
              background: '#fff', color: EP.textPrimary,
              border: `1px solid ${theme.colors.border}`,
              cursor: saving ? 'not-allowed' : 'pointer',
              padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
              opacity: saving ? 0.6 : 1, fontFamily: 'inherit',
            }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={!canSave}
            style={{
              background: canSave ? EP.accent : '#9CA3AF', color: '#fff', border: 'none',
              cursor: canSave ? 'pointer' : 'not-allowed',
              padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              opacity: saving ? 0.85 : 1, fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
            {saving && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
            {saving ? 'Creating & pushing…' : 'Add Pickup & Push to DT'}
          </button>
        </div>
      </div>
    </div>
  );
}
