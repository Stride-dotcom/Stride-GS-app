/**
 * AddPickupLegModal — Multi-pickup Phase 1.
 *
 * Mini-modal triggered by the "Add Pickup" button on a delivery's
 * OrderPage. Creates an additional pickup leg (dt_orders row +
 * dt_pickup_links join row) so a single delivery can collect from
 * multiple sites en route. The original `-P` pickup keeps its
 * identifier; the new leg gets `-P2`, `-P3`, ... matching the
 * sort_order on the join row.
 *
 * Scope (Phase 1 minimal):
 *   • Pickup contact block + time window + label + per-leg notes.
 *   • No items input — operator adds items via the regular edit flow
 *     after the leg is created (existing affordances on the pickup's
 *     OrderPage). Keeps the modal under a single-screen footprint.
 *   • Does NOT trigger dt-push-order; operator clicks Push from the
 *     delivery OrderPage when ready (Phase 2 will wire auto-push).
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
 */

import React, { useState } from 'react';
import { X, Truck, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { DtOrderForUI } from '../../lib/supabaseQueries';
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

  if (!open) return null;

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
      //    with single-pickup consumers.
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
        })
        .select('id')
        .single();
      if (insertErr || !newPickupRow) throw new Error(`Failed to create pickup row: ${insertErr?.message ?? 'unknown'}`);

      // 4. INSERT the join row. Label defaults to contact name when
      //    empty (per Justin's decision §2b Q7).
      const { error: linkErr } = await supabase
        .from('dt_pickup_links')
        .insert({
          tenant_id:         deliveryOrder.tenantId,
          delivery_order_id: deliveryOrder.id,
          pickup_order_id:   (newPickupRow as { id: string }).id,
          pickup_label:      label.trim() || contactName.trim() || null,
          pickup_notes:      pickupNotes.trim() || null,
          sort_order:        nextSort,
        });
      if (linkErr) throw new Error(`Pickup created but join-row insert failed: ${linkErr.message}`);

      onSuccess();
      onClose();
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
            {saving ? 'Creating…' : 'Add Pickup Leg'}
          </button>
        </div>
      </div>
    </div>
  );
}
