/**
 * CreateDeliveryOrderModal — Phase 2b
 *
 * Creates a DispatchTrack delivery/pickup order from the React app.
 *
 * Flow:
 *   1. User fills the form (client, address, zip, items, accessorials)
 *   2. ZIP lookup auto-fills base rate from `delivery_zones`
 *   3. Pricing calculator runs live as user edits items/accessorials
 *   4. Submit writes `dt_orders` + `dt_order_items` to Supabase with
 *      `review_status='pending_review'`, `source='app'`, `created_by_role`
 *   5. Staff reviews in the Review Queue tab → approves → `dt-push-order`
 *      Edge Function POSTs to DispatchTrack /orders/api/add_order
 *
 * We do NOT push to DT from this modal — that's the review step.
 * Orders created here sit in Supabase until approved.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { X, Check, Loader2, CheckCircle2, MapPin, Truck, Package } from 'lucide-react';
import { AutocompleteSelect } from './AutocompleteSelect';
import { theme } from '../../styles/theme';
import { WriteButton } from './WriteButton';
import { useAuth } from '../../contexts/AuthContext';
import { useClients } from '../../hooks/useClients';
import {
  fetchDeliveryZone,
  fetchDeliveryAccessorials,
  type DeliveryZone,
  type DeliveryAccessorial,
} from '../../lib/supabaseQueries';
import { supabase } from '../../lib/supabase';

interface LiveItem {
  itemId: string;
  clientName: string;
  clientId: string;
  vendor: string;
  description: string;
  location: string;
  sidemark: string;
  status: string;
  [k: string]: any;
}

interface Props {
  onClose: () => void;
  onSubmit?: (data: { dtOrderId: string; dtIdentifier: string; reviewStatus: string }) => void;
  preSelectedItemIds?: string[];
  liveItems?: LiveItem[];
}

// Selected accessorial state: code → quantity (for DETENTION etc.) or 1 for flat
interface SelectedAccessorial {
  code: string;
  quantity: number;   // 1 for flat, N for per_15min or per_mile
  subtotal: number;
}

const INCLUDED_ITEMS = 3;
const EXTRA_ITEM_RATE = 25;

export function CreateDeliveryOrderModal({
  onClose,
  onSubmit,
  preSelectedItemIds = [],
  liveItems = [],
}: Props) {
  const { user } = useAuth();

  // ── Client + service type ──────────────────────────────────────────────
  const autoClient = useMemo(() => {
    if (!preSelectedItemIds.length || !liveItems.length) return '';
    const names = new Set(
      preSelectedItemIds.map(id => liveItems.find(i => i.itemId === id)?.clientName).filter(Boolean)
    );
    return names.size === 1 ? [...names][0]! : '';
  }, [preSelectedItemIds, liveItems]);

  const { clients: liveClients, apiClients } = useClients(true);
  const [clientName, setClientName] = useState(autoClient);
  useEffect(() => { if (autoClient && !clientName) setClientName(autoClient); }, [autoClient]);

  const clientSheetId = apiClients.find(c => c.name === clientName)?.spreadsheetId || '';

  const [serviceType, setServiceType] = useState<'Delivery' | 'Pickup'>('Delivery');

  // ── Schedule ───────────────────────────────────────────────────────────
  const [serviceDate, setServiceDate] = useState('');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');

  // ── Contact / address ──────────────────────────────────────────────────
  const [contactName, setContactName] = useState('');
  const [contactAddress, setContactAddress] = useState('');
  const [contactCity, setContactCity] = useState('');
  const [contactState, setContactState] = useState('WA');
  const [contactZip, setContactZip] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  // ── Items (from inventory) ─────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(preSelectedItemIds));
  const activeItems = useMemo(
    () => liveItems.filter(i => i.status === 'Active' && (!clientName || i.clientName === clientName)),
    [liveItems, clientName]
  );
  const [itemSearch, setItemSearch] = useState('');
  const filteredItems = useMemo(() => {
    if (!itemSearch) return activeItems;
    const q = itemSearch.toLowerCase();
    return activeItems.filter(
      i => i.itemId.toLowerCase().includes(q)
        || (i.description || '').toLowerCase().includes(q)
        || (i.vendor || '').toLowerCase().includes(q)
        || (i.sidemark || '').toLowerCase().includes(q)
    );
  }, [activeItems, itemSearch]);
  const selectedItems = useMemo(() => liveItems.filter(i => selectedIds.has(i.itemId)), [liveItems, selectedIds]);

  const toggleItem = (id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  // ── Reference fields ───────────────────────────────────────────────────
  const [poNumber, setPoNumber] = useState('');
  const [sidemark, setSidemark] = useState('');
  const [details, setDetails] = useState('');

  // ── Zone + pricing ─────────────────────────────────────────────────────
  const [zone, setZone] = useState<DeliveryZone | null>(null);
  const [zoneLoading, setZoneLoading] = useState(false);
  const [accessorials, setAccessorials] = useState<DeliveryAccessorial[]>([]);
  const [selectedAccessorials, setSelectedAccessorials] = useState<Map<string, SelectedAccessorial>>(new Map());

  // Load accessorials once
  useEffect(() => {
    fetchDeliveryAccessorials().then(data => {
      if (data) setAccessorials(data.filter(a => a.code !== 'EXTRA_ITEM')); // EXTRA_ITEM is auto-computed
    });
  }, []);

  // Debounced ZIP lookup
  useEffect(() => {
    const trimmed = contactZip.trim();
    if (!/^\d{5}$/.test(trimmed)) {
      setZone(null);
      return;
    }
    setZoneLoading(true);
    let cancelled = false;
    fetchDeliveryZone(trimmed).then(z => {
      if (cancelled) return;
      setZone(z);
      setZoneLoading(false);
    });
    return () => { cancelled = true; };
  }, [contactZip]);

  // ── Pricing calculation ────────────────────────────────────────────────
  const baseFee = useMemo(() => {
    if (!zone) return null;
    return serviceType === 'Pickup' ? zone.pickupRate : zone.baseRate;
  }, [zone, serviceType]);

  const extraItemsCount = Math.max(0, selectedItems.length - INCLUDED_ITEMS);
  const extraItemsFee = extraItemsCount * EXTRA_ITEM_RATE;

  const accessorialsTotal = useMemo(
    () => Array.from(selectedAccessorials.values()).reduce((s, a) => s + a.subtotal, 0),
    [selectedAccessorials]
  );

  const orderTotal = useMemo(() => {
    if (baseFee == null) return null;
    return baseFee + extraItemsFee + accessorialsTotal;
  }, [baseFee, extraItemsFee, accessorialsTotal]);

  const isCallForQuote = contactZip.trim().length === 5 && zone && zone.baseRate == null;

  const toggleAccessorial = (acc: DeliveryAccessorial, quantity: number = 1) => {
    setSelectedAccessorials(prev => {
      const n = new Map(prev);
      if (n.has(acc.code) && quantity === 0) {
        n.delete(acc.code);
      } else if (acc.rate != null) {
        // rate_unit handling: plus_base adds rate on top; per_mile/per_15min multiply by quantity
        let subtotal = 0;
        if (acc.rateUnit === 'flat' || acc.rateUnit === 'plus_base') subtotal = acc.rate;
        else if (acc.rateUnit === 'per_mile' || acc.rateUnit === 'per_15min' || acc.rateUnit === 'per_item') subtotal = acc.rate * quantity;
        n.set(acc.code, { code: acc.code, quantity, subtotal });
      }
      return n;
    });
  };

  const isAccessorialSelected = (code: string) => selectedAccessorials.has(code);

  // ── Submit ─────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<{ dtIdentifier: string } | null>(null);

  const canSubmit = !!(
    clientSheetId
    && contactName.trim()
    && contactAddress.trim()
    && contactCity.trim()
    && contactState.trim()
    && contactZip.trim()
    && serviceDate
    && selectedItems.length > 0
    && !submitting
  );

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);

    // Generate a client-side order number (DT permits any unique string)
    // Format: STR-YYMMDD-HHMMSS-XX (e.g., STR-260420-143022-A7)
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const rand = Math.random().toString(36).slice(2, 4).toUpperCase();
    const dtIdentifier = `STR-${yy}${mm}${dd}-${hh}${mi}${ss}-${rand}`;

    // Serialize accessorials for dt_orders.accessorials_json
    const accList = Array.from(selectedAccessorials.values()).map(a => ({
      code: a.code,
      quantity: a.quantity,
      rate: accessorials.find(x => x.code === a.code)?.rate || 0,
      subtotal: a.subtotal,
    }));

    // Get Supabase auth user id for created_by_user FK
    const { data: authData } = await supabase.auth.getUser();
    const authUid = authData?.user?.id || null;

    // Insert dt_orders
    const { data: orderRow, error: orderErr } = await supabase
      .from('dt_orders')
      .insert({
        tenant_id: clientSheetId,
        dt_identifier: dtIdentifier,
        is_pickup: serviceType === 'Pickup',
        status_id: 0, // Entered
        contact_name: contactName.trim(),
        contact_address: contactAddress.trim(),
        contact_city: contactCity.trim(),
        contact_state: contactState.trim(),
        contact_zip: contactZip.trim(),
        contact_phone: contactPhone.trim() || null,
        contact_email: contactEmail.trim() || null,
        local_service_date: serviceDate,
        window_start_local: windowStart || null,
        window_end_local: windowEnd || null,
        timezone: 'America/Los_Angeles',
        po_number: poNumber.trim() || null,
        sidemark: sidemark.trim() || null,
        details: details.trim() || null,
        source: 'app',
        // Pricing
        base_delivery_fee: baseFee,
        extra_items_count: extraItemsCount,
        extra_items_fee: extraItemsFee,
        accessorials_json: accList,
        accessorials_total: accessorialsTotal,
        order_total: orderTotal,
        pricing_override: isCallForQuote || false,
        pricing_notes: isCallForQuote ? 'Zone marked CALL FOR QUOTE — pricing requires manual review.' : null,
        // Review workflow
        review_status: 'pending_review',
        created_by_user: authUid,
        created_by_role: user?.role || 'client',
      })
      .select('id, dt_identifier')
      .single();

    if (orderErr || !orderRow) {
      setSubmitError(orderErr?.message || 'Failed to create order');
      setSubmitting(false);
      return;
    }

    // Insert items
    if (selectedItems.length > 0) {
      const itemRows = selectedItems.map(i => ({
        dt_order_id: orderRow.id,
        dt_item_code: i.itemId,
        description: i.description || i.itemId,
        quantity: Number(i.qty) || 1,
        original_quantity: Number(i.qty) || 1,
        extras: { vendor: i.vendor || null, sidemark: i.sidemark || null, location: i.location || null },
      }));
      const { error: itemsErr } = await supabase.from('dt_order_items').insert(itemRows);
      if (itemsErr) {
        setSubmitError(`Order created, but items failed to save: ${itemsErr.message}`);
        setSubmitting(false);
        return;
      }
    }

    setCreateResult({ dtIdentifier: orderRow.dt_identifier });
    setSubmitting(false);
    onSubmit?.({ dtOrderId: orderRow.id, dtIdentifier: orderRow.dt_identifier, reviewStatus: 'pending_review' });
  };

  // ── Styling helpers ────────────────────────────────────────────────────
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

  const clientNames = liveClients.map(c => c.name).sort();

  // ── Success screen ─────────────────────────────────────────────────────
  if (createResult) {
    return (
      <>
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 200 }} />
        <div style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          width: 480, maxHeight: '85vh', background: '#fff', borderRadius: 16,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)', zIndex: 201,
          padding: 32, textAlign: 'center',
        }}>
          <CheckCircle2 size={48} color="#15803D" style={{ margin: '0 auto 16px' }} />
          <div style={{ fontSize: 18, fontWeight: 700, color: theme.colors.text, marginBottom: 8 }}>
            Delivery Order Created
          </div>
          <div style={{ fontSize: 13, color: theme.colors.textMuted, marginBottom: 4 }}>
            Order Number
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 600, color: theme.colors.primary, marginBottom: 20 }}>
            {createResult.dtIdentifier}
          </div>
          <div style={{
            background: '#FEF3C7', color: '#92400E', padding: '10px 14px',
            borderRadius: 8, fontSize: 12, marginBottom: 20, textAlign: 'left',
          }}>
            <strong>Status:</strong> Pending Review<br />
            Stride staff will review this order and confirm pricing + availability before it's dispatched.
          </div>
          <button
            onClick={onClose}
            style={{
              width: '100%', padding: '10px 16px', borderRadius: 8,
              border: 'none', background: theme.colors.primary, color: '#fff',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 200 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 720, maxWidth: '95vw', maxHeight: '90vh',
        background: '#fff', borderRadius: 16, zIndex: 201,
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${theme.colors.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Truck size={18} color={theme.colors.primary} />
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              Create {serviceType}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

          {/* Service type toggle */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {(['Delivery', 'Pickup'] as const).map(t => (
              <button
                key={t}
                onClick={() => setServiceType(t)}
                style={{
                  flex: 1, padding: '10px 16px', borderRadius: 8,
                  border: serviceType === t ? `2px solid ${theme.colors.primary}` : `1px solid ${theme.colors.border}`,
                  background: serviceType === t ? '#FFF7ED' : '#fff',
                  color: serviceType === t ? theme.colors.primary : theme.colors.text,
                  fontSize: 13, fontWeight: serviceType === t ? 700 : 500, cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {t === 'Delivery' ? '🚚 Delivery' : '📦 Pickup'}
              </button>
            ))}
          </div>

          {/* Client */}
          <div style={section}>
            <div style={sectionTitle}>Client</div>
            <AutocompleteSelect
              options={clientNames.map(n => ({ value: n, label: n }))}
              value={clientName}
              onChange={setClientName}
              placeholder="Select client…"
            />
          </div>

          {/* Schedule */}
          <div style={section}>
            <div style={sectionTitle}>Schedule</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <label style={label}>Service Date</label>
                <input
                  type="date"
                  value={serviceDate}
                  onChange={e => setServiceDate(e.target.value)}
                  style={input}
                />
              </div>
              <div>
                <label style={label}>Window Start</label>
                <input
                  type="time"
                  value={windowStart}
                  onChange={e => setWindowStart(e.target.value)}
                  style={input}
                />
              </div>
              <div>
                <label style={label}>Window End</label>
                <input
                  type="time"
                  value={windowEnd}
                  onChange={e => setWindowEnd(e.target.value)}
                  style={input}
                />
              </div>
            </div>
            {zone?.serviceDays && (
              <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 8 }}>
                Zone {zone.zone} service days: <strong>{zone.serviceDays}</strong>
              </div>
            )}
          </div>

          {/* Contact */}
          <div style={section}>
            <div style={sectionTitle}>
              {serviceType === 'Delivery' ? 'Delivery Recipient' : 'Pickup From'}
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <label style={label}>Name</label>
                <input style={input} value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Recipient name" />
              </div>
              <div>
                <label style={label}>Street Address</label>
                <input style={input} value={contactAddress} onChange={e => setContactAddress(e.target.value)} placeholder="123 Main St" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
                <div>
                  <label style={label}>City</label>
                  <input style={input} value={contactCity} onChange={e => setContactCity(e.target.value)} />
                </div>
                <div>
                  <label style={label}>State</label>
                  <input style={input} value={contactState} onChange={e => setContactState(e.target.value.toUpperCase())} maxLength={2} />
                </div>
                <div>
                  <label style={label}>ZIP</label>
                  <input
                    style={{
                      ...input,
                      borderColor: zone && zone.baseRate != null ? '#16A34A' : isCallForQuote ? '#B45309' : theme.colors.border,
                    }}
                    value={contactZip}
                    onChange={e => setContactZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
                    placeholder="98101"
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={label}>Phone</label>
                  <input style={input} value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="(555) 555-5555" />
                </div>
                <div>
                  <label style={label}>Email</label>
                  <input style={input} value={contactEmail} onChange={e => setContactEmail(e.target.value)} type="email" />
                </div>
              </div>
              {/* Zone info */}
              {contactZip.length === 5 && (
                <div style={{
                  padding: '8px 12px', borderRadius: 8, fontSize: 12,
                  background: zone?.baseRate != null ? '#F0FDF4' : isCallForQuote ? '#FEF3C7' : '#F3F4F6',
                  color: zone?.baseRate != null ? '#15803D' : isCallForQuote ? '#92400E' : theme.colors.textMuted,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <MapPin size={12} />
                  {zoneLoading ? 'Looking up zone…'
                    : !zone ? `ZIP ${contactZip} not in service area — call for quote`
                    : zone.baseRate == null ? `${zone.city} (Zone ${zone.zone}) — CALL FOR QUOTE`
                    : `${zone.city} (Zone ${zone.zone}) — ${serviceType} rate $${(serviceType === 'Pickup' ? zone.pickupRate : zone.baseRate)?.toFixed(2)}`}
                </div>
              )}
            </div>
          </div>

          {/* Items */}
          <div style={section}>
            <div style={sectionTitle}>
              <Package size={12} /> Items ({selectedItems.length} selected)
            </div>
            <input
              style={{ ...input, marginBottom: 10 }}
              placeholder="Search items…"
              value={itemSearch}
              onChange={e => setItemSearch(e.target.value)}
            />
            <div style={{
              maxHeight: 220, overflowY: 'auto',
              border: `1px solid ${theme.colors.border}`, borderRadius: 8,
            }}>
              {filteredItems.length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: theme.colors.textMuted }}>
                  {clientName ? 'No active items for this client' : 'Select a client to see items'}
                </div>
              ) : (
                filteredItems.map(item => {
                  const checked = selectedIds.has(item.itemId);
                  return (
                    <div
                      key={item.itemId}
                      onClick={() => toggleItem(item.itemId)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 12px', cursor: 'pointer',
                        background: checked ? '#FFF7ED' : '#fff',
                        borderBottom: `1px solid ${theme.colors.border}`,
                      }}
                    >
                      <div style={{
                        width: 18, height: 18, borderRadius: 4,
                        border: `2px solid ${checked ? theme.colors.primary : theme.colors.border}`,
                        background: checked ? theme.colors.primary : '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        {checked && <Check size={12} color="#fff" />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          <span style={{ fontFamily: 'monospace', color: theme.colors.primary }}>{item.itemId}</span>
                          {item.vendor && <span style={{ color: theme.colors.textMuted, fontWeight: 400 }}> · {item.vendor}</span>}
                        </div>
                        <div style={{ fontSize: 11, color: theme.colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.description}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {selectedItems.length > INCLUDED_ITEMS && (
              <div style={{ fontSize: 11, color: '#B45309', marginTop: 6 }}>
                {extraItemsCount} extra item{extraItemsCount !== 1 ? 's' : ''} beyond the {INCLUDED_ITEMS} included in base rate (${extraItemsFee.toFixed(2)} surcharge)
              </div>
            )}
          </div>

          {/* Accessorials */}
          <div style={section}>
            <div style={sectionTitle}>Add-Ons</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {accessorials.map(acc => {
                const selected = isAccessorialSelected(acc.code);
                const current = selectedAccessorials.get(acc.code);
                const needsQuantity = acc.rateUnit === 'per_15min' || acc.rateUnit === 'per_mile';
                return (
                  <div key={acc.code} style={{
                    padding: '10px 12px', borderRadius: 8,
                    border: `1px solid ${selected ? theme.colors.primary : theme.colors.border}`,
                    background: selected ? '#FFF7ED' : '#fff',
                  }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleAccessorial(acc, needsQuantity ? (current?.quantity || 1) : 1)}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {acc.name}
                          {acc.rate != null && (
                            <span style={{ color: theme.colors.textMuted, fontWeight: 400, marginLeft: 8 }}>
                              ${acc.rate.toFixed(2)}
                              {acc.rateUnit === 'per_mile' && ' / mile'}
                              {acc.rateUnit === 'per_15min' && ' / 15 min'}
                              {acc.rateUnit === 'plus_base' && ' (on top of base)'}
                            </span>
                          )}
                        </div>
                        {acc.description && (
                          <div style={{ fontSize: 11, color: theme.colors.textMuted }}>{acc.description}</div>
                        )}
                      </div>
                      {selected && needsQuantity && (
                        <input
                          type="number"
                          min={1}
                          value={current?.quantity || 1}
                          onChange={e => toggleAccessorial(acc, Math.max(1, parseInt(e.target.value) || 1))}
                          onClick={e => e.stopPropagation()}
                          style={{ ...input, width: 72, padding: '4px 8px' }}
                        />
                      )}
                    </label>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Reference */}
          <div style={section}>
            <div style={sectionTitle}>Reference</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={label}>PO Number</label>
                <input style={input} value={poNumber} onChange={e => setPoNumber(e.target.value)} />
              </div>
              <div>
                <label style={label}>Sidemark</label>
                <input style={input} value={sidemark} onChange={e => setSidemark(e.target.value)} />
              </div>
            </div>
            <label style={label}>Notes / Special Instructions</label>
            <textarea
              style={{ ...input, minHeight: 60, resize: 'vertical' }}
              value={details}
              onChange={e => setDetails(e.target.value)}
              placeholder="Delivery instructions, gate codes, elevator notes, etc."
            />
          </div>

          {/* Pricing summary */}
          <div style={{
            padding: 14, background: '#F9FAFB', borderRadius: 10,
            border: `1px solid ${theme.colors.border}`,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: theme.colors.textMuted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Pricing Summary
            </div>
            {baseFee != null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span>Base {serviceType} Fee</span>
                <span style={{ fontWeight: 500 }}>${baseFee.toFixed(2)}</span>
              </div>
            )}
            {extraItemsCount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span>Extra Items ({extraItemsCount} × $25)</span>
                <span style={{ fontWeight: 500 }}>${extraItemsFee.toFixed(2)}</span>
              </div>
            )}
            {Array.from(selectedAccessorials.values()).map(a => {
              const acc = accessorials.find(x => x.code === a.code);
              return (
                <div key={a.code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                  <span>{acc?.name}{a.quantity > 1 ? ` × ${a.quantity}` : ''}</span>
                  <span style={{ fontWeight: 500 }}>${a.subtotal.toFixed(2)}</span>
                </div>
              );
            })}
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              marginTop: 10, paddingTop: 10, borderTop: `1px solid ${theme.colors.border}`,
              fontSize: 15, fontWeight: 700,
            }}>
              <span>Order Total</span>
              <span>
                {orderTotal != null ? `$${orderTotal.toFixed(2)}` : isCallForQuote ? 'Call for quote' : '—'}
              </span>
            </div>
            {isCallForQuote && (
              <div style={{ fontSize: 11, color: '#B45309', marginTop: 6, fontStyle: 'italic' }}>
                Staff will confirm final pricing during review.
              </div>
            )}
          </div>

          {submitError && (
            <div style={{
              marginTop: 16, padding: '10px 14px', borderRadius: 8,
              background: '#FEF2F2', border: '1px solid #FECACA',
              fontSize: 13, color: '#991B1B',
            }}>
              {submitError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: '#FAFAFA', flexShrink: 0,
        }}>
          <div style={{ fontSize: 11, color: theme.colors.textMuted }}>
            Order will be reviewed by Stride staff before dispatch
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: '9px 16px', borderRadius: 8,
                border: `1px solid ${theme.colors.border}`, background: '#fff',
                fontSize: 13, fontWeight: 500, color: theme.colors.text,
                cursor: submitting ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
            <WriteButton
              label={submitting ? 'Creating…' : `Submit ${serviceType} Request`}
              onClick={handleSubmit}
              disabled={!canSubmit}
              size="md"
              icon={submitting ? <Loader2 size={14} className="spin" /> : undefined}
            />
          </div>
        </div>
      </div>
    </>
  );
}
