/**
 * PublicServiceRequest — no-auth service-request page.
 *
 * Phase 3 rewrite (2026-05-12): full parity with the authenticated
 * CreateDeliveryOrderModal — same pricing engine, valuation
 * coverage, add-ons, and estimated total. Differences are limited
 * to what an anonymous submitter cannot have:
 *
 *   • Client account selector → free-text "Your contact info"
 *     section (submitter's name / company / email / phone). The
 *     billable client is set later by staff on review.
 *   • Address-book autocomplete + Browse modal removed — no tenant
 *     context, so no address book to read.
 *   • Inventory item picker removed — public users have no access
 *     to warehouse inventory; only ad-hoc items are accepted.
 *   • Staff-only fields removed: internal notes, rate overrides,
 *     service-time override.
 *
 * Public-form-specific behavior:
 *
 *   • Bill-To section after pickup / delivery / service sections.
 *     Radio: "Same as pickup contact" / "Same as delivery contact"
 *     / "Same as service contact" (whichever apply for the mode) /
 *     "Other (enter bill-to)". The chosen source's contact fields
 *     pre-fill the bill-to inputs which remain editable.
 *   • Sales tax defaults to the Kent, WA combined rate (10.4%) —
 *     staff confirms / overrides on review.
 *   • Client-added accessorials always render as "Quote pending"
 *     (rate / subtotal forced to 0 in accessorials_json), same as
 *     the authenticated client view. Staff prices on review.
 *   • Over-piece-cap (> 20) and out-of-service-area ZIPs surface a
 *     "may require quote review" banner; submission still proceeds
 *     and pricing_override is set so staff confirm the rates.
 *   • Disclaimer + acknowledgment checkbox is required before the
 *     submit button enables — the estimate is informational, not
 *     binding.
 *   • Service-only mode still calculates the drive-out fee from
 *     the service ZIP's zone — most need rate adjustment but the
 *     starting point matches what staff sees.
 *   • Submission writes review_status='pending_review' (the anon
 *     INSERT policy locks the value to that string); staff pushes
 *     to DispatchTrack from the Review Queue.
 *
 * Columns written on insert: bill_to_* (8 cols, migration
 * 20260512120000), plus the standard pricing snapshot —
 * base_delivery_fee, extra_items_count, extra_items_fee,
 * accessorials_json, accessorials_total, coverage_option_id,
 * declared_value, coverage_charge, tax_amount, tax_rate_pct,
 * customer_tax_exempt (=false on public submissions), order_total,
 * pricing_override=true, pricing_notes.
 *
 * KEEP IN SYNC with CreateDeliveryOrderModal's pricing math —
 * both surfaces read the same DB rows (delivery_zones,
 * service_catalog, coverage_options) so when an XTRA_PC threshold,
 * coverage rate, or zone rate moves there, the public form should
 * pick it up automatically. The formulas (subtotal composition,
 * tax application, accessorial billingMode handling) are duplicated
 * intentionally — extracting them is a future cleanup once a third
 * surface needs them.
 *
 * Backed by migration 20260426220000_dt_orders_public_form_anon_insert.sql
 * (anon INSERT policy) + 20260512120000_dt_orders_bill_to_columns.sql.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, AlertTriangle, Loader2, Plus, Trash2,
  Truck, Box, Wrench, MapPin, ArrowRight,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { theme } from '../styles/theme';
import { supabase } from '../lib/supabase';
import {
  fetchDeliveryZone,
  fetchDeliveryServicesFromCatalog,
  type DeliveryZone,
  type DeliveryAccessorial,
} from '../lib/supabaseQueries';

// ── Types ──────────────────────────────────────────────────────────────
type OrderMode = 'delivery' | 'pickup' | 'pickup_and_delivery' | 'service_only';
type BillToMode = 'pickup' | 'delivery' | 'service' | 'other';

interface FreeItem {
  id: string;
  description: string;
  quantity: number;
  weight?: number | null;
  cubicFeet?: number | null;
}

interface SelectedAccessorial {
  code: string;
  quantity: number;
  rate: number;
  subtotal: number;
  clientNotes?: string;
  quotePending?: boolean;
}

interface CoverageOptionRow {
  id: string;
  name: string;
  calcType: 'flat' | 'percent_declared' | 'per_lb' | 'included';
  rate: number;
  note: string | null;
  displayOrder: number;
}

// ── Constants ──────────────────────────────────────────────────────────
// Kent, WA combined sales tax — public form default. Staff overrides on
// review when the billable client turns out to be tax-exempt or in a
// different jurisdiction.
const TAX_RATE_PCT = 10.4;
// Orders over this piece count flip to "may require quote review" — the
// per-piece tier doesn't reflect labor / truck-space reality past this.
// Matches the modal's hardcoded cap; a future cleanup can surface both
// from the XTRA_PC service_catalog row.
const MAX_PIECES = 20;
const EXTRA_PIECE_CODE = 'XTRA_PC';

function genUid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── AddressFields sub-component ────────────────────────────────────────
// Mirrors the modal's AddressFields but with the address-book
// autocomplete + Browse button stripped (anon users have no tenant).
// Field layout and styling are otherwise identical so the visual rhythm
// matches.
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

  // ── Delivery / service contact ──────────────────────────────────────
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

  // ── Coverage ────────────────────────────────────────────────────────
  const [coverageOptions, setCoverageOptions] = useState<CoverageOptionRow[]>([]);
  const [coverageOptionId, setCoverageOptionId] = useState<string>('standard');
  const [declaredValue, setDeclaredValue] = useState<string>('');

  // ── Add-ons ─────────────────────────────────────────────────────────
  const [accessorials, setAccessorials] = useState<DeliveryAccessorial[]>([]);
  const [selectedAccessorials, setSelectedAccessorials] = useState<Map<string, SelectedAccessorial>>(new Map());
  const [addonsExpanded, setAddonsExpanded] = useState(false);

  // ── Extra-piece config (XTRA_PC service_catalog row) ────────────────
  const [extraPieceConfig, setExtraPieceConfig] = useState<{ included: number; rate: number }>({ included: 3, rate: 25 });

  // ── Zone lookups ────────────────────────────────────────────────────
  const [deliveryZone, setDeliveryZone] = useState<DeliveryZone | null>(null);
  const [pickupZone, setPickupZone] = useState<DeliveryZone | null>(null);
  const [deliveryZoneLoading, setDeliveryZoneLoading] = useState(false);
  const [pickupZoneLoading, setPickupZoneLoading] = useState(false);

  // ── Bill-To ─────────────────────────────────────────────────────────
  // Radio mode is a one-shot "copy from" trigger — selecting one populates
  // the bill-to fields from the source contact; the fields remain editable
  // afterwards. The radio value is NOT persisted, only the resulting field
  // values are submitted.
  const [billToMode, setBillToMode] = useState<BillToMode>('delivery');
  const [billToName, setBillToName] = useState('');
  const [billToCompany, setBillToCompany] = useState('');
  const [billToEmail, setBillToEmail] = useState('');
  const [billToPhone, setBillToPhone] = useState('');
  const [billToAddress, setBillToAddress] = useState('');
  const [billToCity, setBillToCity] = useState('');
  const [billToState, setBillToState] = useState('');
  const [billToZip, setBillToZip] = useState('');

  // ── Driver notes ────────────────────────────────────────────────────
  const [driverNotes, setDriverNotes] = useState('');

  // ── Acknowledgment ──────────────────────────────────────────────────
  const [priceAcknowledged, setPriceAcknowledged] = useState(false);

  // ── Submission state ────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ identifier: string } | null>(null);

  // ── Honeypot ────────────────────────────────────────────────────────
  // Bots fill every field they see. Real users never tab into a field
  // pushed off-screen with tabIndex=-1. If non-empty on submit we silently
  // no-op (show success without writing).
  const [honeypot, setHoneypot] = useState('');

  // Default delivery contact name to the submitter's name when blank.
  useEffect(() => {
    if (contactName && !deliveryContactName) setDeliveryContactName(contactName);
  }, [contactName]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reusable styles ─────────────────────────────────────────────────
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

  // ── Mode cards ──────────────────────────────────────────────────────
  const modeCards: Array<{ mode: OrderMode; icon: React.ReactNode; label: string; desc: string }> = [
    { mode: 'delivery',            icon: <Truck size={20} />,             label: 'Delivery',           desc: 'Bring items to us, we deliver them out' },
    { mode: 'pickup',              icon: <Box size={20} />,               label: 'Pickup',             desc: 'We pick up items and bring them to our warehouse' },
    { mode: 'pickup_and_delivery', icon: <ArrowRight size={20} />,        label: 'Pickup + Delivery',  desc: 'We pick up and deliver — skip the warehouse' },
    { mode: 'service_only',        icon: <Wrench size={20} />,            label: 'Service Only',       desc: 'On-site visit, no items moved' },
  ];

  const needsPickup = mode === 'pickup' || mode === 'pickup_and_delivery';
  const needsDelivery = mode === 'delivery' || mode === 'pickup_and_delivery';
  const needsService = mode === 'service_only';
  const needsItems = mode !== 'service_only';

  // ── Fetch coverage options ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('coverage_options')
        .select('id, name, calc_type, rate, note, display_order')
        .eq('active', true)
        .order('display_order', { ascending: true });
      if (cancelled || error || !data) return;
      const opts: CoverageOptionRow[] = (data as Array<{
        id: string; name: string; calc_type: string;
        rate: number | string; note: string | null; display_order: number | null;
      }>)
        .filter(r => r.id !== 'storage_added' && (r.calc_type === 'flat' || r.calc_type === 'percent_declared'))
        .map(r => ({
          id: r.id,
          name: r.name,
          calcType: r.calc_type as CoverageOptionRow['calcType'],
          rate: typeof r.rate === 'number' ? r.rate : parseFloat(String(r.rate)) || 0,
          note: r.note,
          displayOrder: r.display_order ?? 0,
        }));
      setCoverageOptions(opts);
      const stillThere = opts.some(o => o.id === coverageOptionId);
      if (!stillThere) {
        const std = opts.find(o => o.id === 'standard');
        setCoverageOptionId(std?.id ?? opts[0]?.id ?? 'standard');
      }
    })();
    return () => { cancelled = true; };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch add-ons (client-visible only) ─────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetchDeliveryServicesFromCatalog().then(data => {
      if (cancelled || !data) return;
      const base = data.filter(a => a.code !== 'ADDL_ITEM' && a.code !== 'EXTRA_ITEM');
      const filtered = base
        .filter(a => a.availableForDelivery)
        .filter(a => a.visibleToClient);
      setAccessorials(filtered);
    });
    return () => { cancelled = true; };
  }, []);

  // ── Fetch XTRA_PC config (extras threshold + per-piece rate) ────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('service_catalog')
        .select('flat_rate, included_quantity')
        .eq('code', EXTRA_PIECE_CODE)
        .eq('active', true)
        .maybeSingle();
      if (cancelled || error || !data) return;
      const r = data as { flat_rate: number | string | null; included_quantity: number | null };
      const rate = r.flat_rate == null ? 25 : (typeof r.flat_rate === 'number' ? r.flat_rate : parseFloat(String(r.flat_rate)));
      const included = r.included_quantity ?? 3;
      setExtraPieceConfig({ included, rate: Number.isFinite(rate) ? rate : 25 });
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Zone lookup: delivery zip ───────────────────────────────────────
  // Service-only uses the deliveryZip (which represents the service
  // address) so the drive-out fee still reflects the destination zone.
  useEffect(() => {
    const trimmed = deliveryZip.trim();
    if (!/^\d{5}$/.test(trimmed)) { setDeliveryZone(null); return; }
    setDeliveryZoneLoading(true);
    let cancelled = false;
    fetchDeliveryZone(trimmed).then(z => {
      if (cancelled) return;
      setDeliveryZone(z);
      setDeliveryZoneLoading(false);
    });
    return () => { cancelled = true; };
  }, [deliveryZip]);

  // ── Zone lookup: pickup zip (P+D and pickup-only) ───────────────────
  useEffect(() => {
    if (!needsPickup) { setPickupZone(null); return; }
    const trimmed = pickupZip.trim();
    if (!/^\d{5}$/.test(trimmed)) { setPickupZone(null); return; }
    setPickupZoneLoading(true);
    let cancelled = false;
    fetchDeliveryZone(trimmed).then(z => {
      if (cancelled) return;
      setPickupZone(z);
      setPickupZoneLoading(false);
    });
    return () => { cancelled = true; };
  }, [needsPickup, pickupZip]);

  // ── Derived: item count + volume ────────────────────────────────────
  const itemCount = useMemo(() => {
    if (mode === 'service_only') return 0;
    const pickupQty = pickupFreeItems
      .filter(i => i.description.trim())
      .reduce((s, i) => s + Math.max(1, Number(i.quantity) || 1), 0);
    const deliveryQty = deliveryFreeItems
      .filter(i => i.description.trim())
      .reduce((s, i) => s + Math.max(1, Number(i.quantity) || 1), 0);
    if (mode === 'pickup') return pickupQty;
    if (mode === 'delivery') return deliveryQty;
    // pickup_and_delivery — delivery list mirrors pickup; bill the pickup list.
    return pickupQty;
  }, [mode, pickupFreeItems, deliveryFreeItems]);

  const totalVolume = useMemo(() => {
    if (mode === 'service_only') return 0;
    const list = mode === 'pickup' ? pickupFreeItems : deliveryFreeItems;
    return list
      .filter(i => i.description.trim())
      .reduce((s, i) => {
        const cu = Number(i.cubicFeet);
        const qty = Math.max(1, Number(i.quantity) || 1);
        return s + (Number.isFinite(cu) && cu > 0 ? cu * qty : 0);
      }, 0);
  }, [mode, pickupFreeItems, deliveryFreeItems]);

  // ── Derived: coverage ───────────────────────────────────────────────
  const selectedCoverage = useMemo(
    () => coverageOptions.find(o => o.id === coverageOptionId) ?? null,
    [coverageOptions, coverageOptionId]
  );
  const coverageCharge = useMemo(() => {
    if (!selectedCoverage) return 0;
    if (selectedCoverage.calcType === 'flat') return selectedCoverage.rate;
    if (selectedCoverage.calcType === 'percent_declared') {
      const dv = parseFloat(declaredValue);
      if (!Number.isFinite(dv) || dv <= 0) return 0;
      return (selectedCoverage.rate / 100) * dv;
    }
    return 0;
  }, [selectedCoverage, declaredValue]);

  // ── Derived: pricing ────────────────────────────────────────────────
  // Pickup-only and the P+D pickup leg both use the zone's baseRate as
  // the per-leg fee (matches the modal — pickup_rate is not consulted).
  const baseFee = useMemo<number | null>(() => {
    if (mode === 'pickup') {
      if (!pickupZone) return null;
      return pickupZone.baseRate;
    }
    if (!deliveryZone) return null;
    return deliveryZone.baseRate;
  }, [mode, pickupZone, deliveryZone]);

  const pickupLegFee = useMemo<number>(() => {
    if (mode !== 'pickup_and_delivery') return 0;
    if (!pickupZone) return 0;
    return pickupZone.baseRate ?? 0;
  }, [mode, pickupZone]);

  const extraItemsCount = Math.max(0, itemCount - extraPieceConfig.included);
  const extraItemsLegMultiplier = mode === 'pickup_and_delivery' ? 2 : 1;
  const extraItemsFee = extraItemsCount * extraPieceConfig.rate * extraItemsLegMultiplier;

  const accessorialsTotal = useMemo(
    () => Array.from(selectedAccessorials.values()).reduce((s, a) => s + a.subtotal, 0),
    [selectedAccessorials]
  );

  // Coverage applies to every mode that physically moves items. For
  // service-only the modal hides pricing entirely; per Justin we keep
  // pricing visible on the public form (drive-out + add-ons) but skip
  // the coverage line and the extras formula since there are no items.
  const subtotalBeforeTax = useMemo<number | null>(() => {
    if (baseFee == null) return null;
    if (mode === 'service_only') return baseFee + accessorialsTotal;
    return baseFee + pickupLegFee + extraItemsFee + accessorialsTotal + coverageCharge;
  }, [mode, baseFee, pickupLegFee, extraItemsFee, accessorialsTotal, coverageCharge]);

  const taxAmount = useMemo(() => {
    if (subtotalBeforeTax == null) return 0;
    return subtotalBeforeTax * (TAX_RATE_PCT / 100);
  }, [subtotalBeforeTax]);

  const orderTotal = useMemo<number | null>(() => {
    if (subtotalBeforeTax == null) return null;
    return subtotalBeforeTax + taxAmount;
  }, [subtotalBeforeTax, taxAmount]);

  const isCallForQuote =
    (mode === 'pickup' && pickupZip.length === 5 && pickupZone != null && pickupZone.baseRate == null)
    || ((mode === 'delivery' || mode === 'pickup_and_delivery' || mode === 'service_only')
        && deliveryZip.length === 5 && deliveryZone != null && deliveryZone.baseRate == null);

  // ZIP fully entered but not in any zone (out of service area).
  const deliveryOutOfArea = (mode === 'delivery' || mode === 'pickup_and_delivery' || mode === 'service_only')
    && deliveryZip.length === 5 && !deliveryZoneLoading && deliveryZone == null;
  const pickupOutOfArea = needsPickup
    && pickupZip.length === 5 && !pickupZoneLoading && pickupZone == null;

  const isPieceCountOverLimit = itemCount > MAX_PIECES;

  // ── Accessorial helpers (public = always quote-pending) ─────────────
  // Mirrors the modal's !isStaff branch — rate / subtotal forced to 0,
  // qty editable, optional clientNotes for staff to read on review.
  const toggleAccessorial = (acc: DeliveryAccessorial, forceRemove?: boolean) => {
    setSelectedAccessorials(prev => {
      const n = new Map(prev);
      if (forceRemove || n.has(acc.code)) {
        if (forceRemove || n.has(acc.code)) { n.delete(acc.code); return n; }
      }
      const defaultQty = acc.billingMode === 'per_qty' && (acc.rateUnit === 'per_item' || acc.rateUnit === 'flat')
        ? Math.max(1, itemCount || 1)
        : 1;
      n.set(acc.code, {
        code: acc.code,
        quantity: defaultQty,
        rate: 0,
        subtotal: 0,
        quotePending: true,
        clientNotes: '',
      });
      return n;
    });
  };

  const updateAccessorialQty = (code: string, quantity: number) => {
    setSelectedAccessorials(prev => {
      const cur = prev.get(code);
      if (!cur) return prev;
      const q = Math.max(1, Math.floor(quantity));
      const n = new Map(prev);
      n.set(code, { ...cur, quantity: q });
      return n;
    });
  };

  const updateAccessorialNotes = (code: string, notes: string) => {
    setSelectedAccessorials(prev => {
      const cur = prev.get(code);
      if (!cur) return prev;
      const n = new Map(prev);
      n.set(code, { ...cur, clientNotes: notes });
      return n;
    });
  };

  const isAccessorialSelected = (code: string) => selectedAccessorials.has(code);

  // ── Bill-To: auto-populate when mode is "Same as X" ─────────────────
  // The radio is a "copy from" trigger; fields remain editable afterwards.
  // We re-copy whenever the source contact changes AND the radio is still
  // pointing at it, so a typo correction on a pickup-contact field flows
  // through into the bill-to inputs without the user re-clicking the
  // radio. "other" never auto-copies.
  useEffect(() => {
    if (billToMode === 'pickup') {
      setBillToName(pickupContactName || contactName);
      setBillToCompany(contactCompany);
      setBillToEmail(pickupEmail || contactEmail);
      setBillToPhone(pickupPhone || contactPhone);
      setBillToAddress(pickupAddress);
      setBillToCity(pickupCity);
      setBillToState(pickupState);
      setBillToZip(pickupZip);
    } else if (billToMode === 'delivery' || billToMode === 'service') {
      setBillToName(deliveryContactName || contactName);
      setBillToCompany(contactCompany);
      setBillToEmail(deliveryEmail || contactEmail);
      setBillToPhone(deliveryPhone || contactPhone);
      setBillToAddress(deliveryAddress);
      setBillToCity(deliveryCity);
      setBillToState(deliveryState);
      setBillToZip(deliveryZip);
    }
    // 'other' deliberately does nothing — fields stay whatever they were.
  }, [
    billToMode,
    pickupContactName, pickupEmail, pickupPhone, pickupAddress, pickupCity, pickupState, pickupZip,
    deliveryContactName, deliveryEmail, deliveryPhone, deliveryAddress, deliveryCity, deliveryState, deliveryZip,
    contactName, contactCompany, contactEmail, contactPhone,
  ]);

  // When the order mode changes, snap bill-to mode to the new mode's
  // default so the radio isn't stuck on an option that no longer
  // applies (e.g. picking "Same as delivery" then switching to
  // pickup-only mode).
  useEffect(() => {
    if (mode === 'pickup') setBillToMode(m => (m === 'pickup' || m === 'other' ? m : 'pickup'));
    else if (mode === 'service_only') setBillToMode(m => (m === 'service' || m === 'other' ? m : 'service'));
    else if (mode === 'delivery') setBillToMode(m => (m === 'delivery' || m === 'other' ? m : 'delivery'));
    // pickup_and_delivery: any of pickup/delivery/other is fine — leave as-is.
  }, [mode]);

  // ── Validation ──────────────────────────────────────────────────────
  const missingFields = useMemo(() => {
    const out: string[] = [];
    if (!contactName.trim()) out.push('your name');
    if (!contactEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) out.push('a valid email');
    if (!contactPhone.trim()) out.push('your phone');
    if (needsPickup) {
      if (!pickupAddress.trim() || !pickupCity.trim() || pickupZip.length !== 5) out.push('pickup address');
    }
    if (needsDelivery) {
      if (!deliveryAddress.trim() || !deliveryCity.trim() || deliveryZip.length !== 5) out.push('delivery address');
    }
    if (needsService) {
      if (!deliveryAddress.trim() || !deliveryCity.trim() || deliveryZip.length !== 5) out.push('service address');
      if (!serviceDescription.trim()) out.push('a description of the service needed');
    }
    if (needsItems) {
      const list = mode === 'pickup' ? pickupFreeItems
        : mode === 'pickup_and_delivery' ? pickupFreeItems
        : deliveryFreeItems;
      if (!list.some(i => i.description.trim())) out.push('at least one item');
    }
    // Bill-to required for every mode.
    if (!billToName.trim()) out.push('bill-to name');
    if (!billToPhone.trim()) out.push('bill-to phone');
    if (!billToEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billToEmail.trim())) out.push('a valid bill-to email');
    if (!priceAcknowledged) out.push('the pricing acknowledgment');
    return out;
  }, [
    contactName, contactEmail, contactPhone,
    pickupAddress, pickupCity, pickupZip,
    deliveryAddress, deliveryCity, deliveryZip,
    mode, serviceDescription, pickupFreeItems, deliveryFreeItems,
    needsPickup, needsDelivery, needsService, needsItems,
    billToName, billToPhone, billToEmail, priceAcknowledged,
  ]);

  const canSubmit = !submitting && missingFields.length === 0;

  // ── Submit ──────────────────────────────────────────────────────────
  async function submitPublicRequest() {
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
      const dtIdentifier = `REQ-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

      const detailLines: string[] = [
        `Submitted via public form by ${contactName.trim()}${contactCompany.trim() ? ` (${contactCompany.trim()})` : ''}`,
        `Email: ${contactEmail.trim()}`,
        `Phone: ${contactPhone.trim()}`,
      ];
      if (mode === 'service_only' && serviceDescription.trim()) {
        detailLines.push('');
        detailLines.push(`Service description: ${serviceDescription.trim()}`);
      }

      // Pick the contact row to seed contact_* columns from. Delivery
      // takes precedence; pickup-only requests fall back to pickup.
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

      // accessorials_json mirrors the modal's shape so the Review Queue
      // renders identically regardless of source.
      const accList = Array.from(selectedAccessorials.values()).map(a => ({
        code: a.code,
        quantity: a.quantity,
        rate: a.rate,
        subtotal: a.subtotal,
        ...(a.clientNotes ? { clientNotes: a.clientNotes } : {}),
        ...(a.quotePending ? { quotePending: true } : {}),
      }));

      const pricingNotes = [
        'Submitted via public form — estimate only, staff confirms pricing on review.',
        isPieceCountOverLimit ? `Item count ${itemCount} exceeds ${MAX_PIECES}-piece auto-pricing limit — custom quote required.` : null,
        isCallForQuote ? 'ZIP marked Call for Quote — base fee TBD on review.' : null,
        deliveryOutOfArea ? 'Delivery ZIP not in zone table — quote required.' : null,
        pickupOutOfArea ? 'Pickup ZIP not in zone table — quote required.' : null,
        accList.some(a => a.quotePending) ? 'Client-added accessorials present — staff to price.' : null,
      ].filter(Boolean).join(' | ');

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

        // Contact (on-site)
        contact_name: contactSeed.name || null,
        contact_company: contactCompany.trim() || null,
        contact_address: contactSeed.address || null,
        contact_city: contactSeed.city || null,
        contact_state: contactSeed.state || null,
        contact_zip: contactSeed.zip || null,
        contact_phone: contactSeed.phone || null,
        contact_phone2: contactSeed.phone2 || null,
        contact_email: contactSeed.email || null,

        // Bill-To (billable party)
        bill_to_name:    billToName.trim() || null,
        bill_to_company: billToCompany.trim() || null,
        bill_to_email:   billToEmail.trim() || null,
        bill_to_phone:   billToPhone.trim() || null,
        bill_to_address: billToAddress.trim() || null,
        bill_to_city:    billToCity.trim() || null,
        bill_to_state:   billToState.trim() || null,
        bill_to_zip:     billToZip.trim() || null,

        // Notes
        details: detailLines.join('\n'),
        driver_notes: driverNotes.trim() || null,

        // Pricing snapshot (estimate — staff confirms on review)
        base_delivery_fee:  baseFee != null ? baseFee + pickupLegFee : null,
        extra_items_count:  extraItemsCount,
        extra_items_fee:    extraItemsFee,
        accessorials_json:  accList.length > 0 ? accList : null,
        accessorials_total: accessorialsTotal,
        coverage_option_id: mode === 'service_only' ? null : (selectedCoverage?.id ?? null),
        declared_value:     selectedCoverage?.calcType === 'percent_declared' ? (parseFloat(declaredValue) || null) : null,
        coverage_charge:    mode === 'service_only' ? 0 : (coverageCharge || 0),
        tax_amount:         taxAmount || 0,
        tax_rate_pct:       TAX_RATE_PCT,
        customer_tax_exempt: false,
        order_total:        orderTotal,

        // Always override on public submissions — staff confirms rates
        // on review regardless of whether the auto-calc returned a value.
        pricing_override: true,
        pricing_notes:    pricingNotes || null,
      };

      const { data: orderRow, error: orderErr } = await supabase
        .from('dt_orders')
        .insert(orderPayload)
        .select('id, dt_identifier')
        .single();
      if (orderErr || !orderRow) {
        if (orderErr) console.warn('[public-service-request] order insert failed:', orderErr);
        throw new Error('We could not submit your request. Please try again, or email us if the problem persists.');
      }

      // Items — public users only get ad-hoc lines (no inventory).
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

      // Fire-and-forget submitter confirmation + internal alert. Failure
      // to email shouldn't change what the submitter sees — admins still
      // see the order in the Review Queue.
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
    setContactName(''); setContactCompany(''); setContactEmail(''); setContactPhone('');
    setMode('delivery');
    setServiceDate(''); setWindowStart(''); setWindowEnd('');
    setPickupContactName(''); setPickupAddress(''); setPickupCity('');
    setPickupState('WA'); setPickupZip(''); setPickupPhone('');
    setPickupPhone2(''); setPickupEmail('');
    setPickupFreeItems([{ id: genUid(), description: '', quantity: 1 }]);
    setDeliveryContactName(''); setDeliveryAddress(''); setDeliveryCity('');
    setDeliveryState('WA'); setDeliveryZip(''); setDeliveryPhone('');
    setDeliveryPhone2(''); setDeliveryEmail('');
    setDeliveryFreeItems([{ id: genUid(), description: '', quantity: 1, weight: null, cubicFeet: null }]);
    setServiceDescription('');
    setCoverageOptionId('standard');
    setDeclaredValue('');
    setSelectedAccessorials(new Map());
    setAddonsExpanded(false);
    setBillToMode('delivery');
    setBillToName(''); setBillToCompany(''); setBillToEmail(''); setBillToPhone('');
    setBillToAddress(''); setBillToCity(''); setBillToState(''); setBillToZip('');
    setDriverNotes('');
    setPriceAcknowledged(false);
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
            within one business day with confirmed pricing and scheduling.
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

  // ── Bill-To radio options (depends on mode) ─────────────────────────
  const billToRadioOptions: Array<{ value: BillToMode; label: string }> = (() => {
    const opts: Array<{ value: BillToMode; label: string }> = [];
    if (mode === 'pickup_and_delivery') {
      opts.push({ value: 'pickup',   label: 'Same as pickup contact' });
      opts.push({ value: 'delivery', label: 'Same as delivery contact' });
    } else if (mode === 'pickup') {
      opts.push({ value: 'pickup',   label: 'Same as pickup contact' });
    } else if (mode === 'service_only') {
      opts.push({ value: 'service',  label: 'Same as on-site contact' });
    } else {
      opts.push({ value: 'delivery', label: 'Same as delivery contact' });
    }
    opts.push({ value: 'other', label: 'Other (enter bill-to)' });
    return opts;
  })();

  // ── Form view ───────────────────────────────────────────────────────
  return (
    <PageShell>
      <div style={{
        background: '#fff', borderRadius: 16,
        border: `1px solid ${theme.colors.border}`,
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        overflow: 'hidden',
      }}>
        <div style={{ padding: 24 }}>

          {/* Your contact info */}
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
          {needsPickup && (
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
          {(needsDelivery || needsService) && (
            <div style={section}>
              <div style={sectionTitle}>
                {needsService ? <><Wrench size={12} /> Service At</> : <><MapPin size={12} /> Deliver To</>}
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
                contactLabel={needsService ? 'On-site contact' : 'Recipient'}
              />

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

              {needsService && (
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

          {/* Valuation Coverage — every item-moving mode */}
          {mode !== 'service_only' && coverageOptions.length > 0 && (
            <div style={section}>
              <div style={sectionTitle}>
                Valuation Coverage
                <span style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>
                  (required)
                </span>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {coverageOptions.map(opt => {
                  const selected = coverageOptionId === opt.id;
                  const rateLabel =
                    opt.calcType === 'flat'
                      ? (opt.rate > 0 ? `$${opt.rate.toFixed(2)} flat` : 'Included — $0')
                      : `${opt.rate.toFixed(2)}% of declared value`;
                  return (
                    <label
                      key={opt.id}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
                        borderRadius: 8, cursor: 'pointer',
                        border: `1px solid ${selected ? theme.colors.primary : theme.colors.border}`,
                        background: selected ? '#FFF7ED' : '#fff',
                      }}
                    >
                      <input
                        type="radio"
                        name="coverage"
                        value={opt.id}
                        checked={selected}
                        onChange={() => setCoverageOptionId(opt.id)}
                        style={{ marginTop: 2, accentColor: theme.colors.primary }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: theme.colors.text }}>{opt.name}</span>
                          <span style={{ fontSize: 12, color: theme.colors.textMuted }}>{rateLabel}</span>
                        </div>
                        {opt.note && (
                          <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 3 }}>{opt.note}</div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
              {selectedCoverage?.calcType === 'percent_declared' && (
                <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={label}>Declared Value ($) *</label>
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={declaredValue}
                      onChange={e => setDeclaredValue(e.target.value)}
                      style={input}
                      placeholder="e.g. 5000"
                    />
                  </div>
                  <div>
                    <label style={label}>Coverage Charge</label>
                    <div style={{
                      ...input,
                      background: '#F9FAFB', display: 'flex', alignItems: 'center',
                      fontWeight: 600, color: theme.colors.text,
                    }}>
                      {coverageCharge > 0 ? `$${coverageCharge.toFixed(2)}` : '—'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Add-Ons — collapsed by default */}
          {accessorials.length > 0 && (
            <div style={section}>
              <button
                type="button"
                onClick={() => setAddonsExpanded(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  width: '100%', padding: '4px 6px', borderRadius: 6,
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: 'inherit', textAlign: 'left',
                  marginBottom: addonsExpanded ? 12 : 0,
                }}
              >
                {addonsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <div style={{ ...sectionTitle, marginBottom: 0 }}>
                  Add-Ons
                  {selectedAccessorials.size > 0 && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 100,
                      background: theme.colors.primary, color: '#fff',
                      textTransform: 'none', letterSpacing: 0,
                    }}>
                      {selectedAccessorials.size} selected
                    </span>
                  )}
                </div>
              </button>
              {addonsExpanded && (
                <div style={{ display: 'grid', gap: 8 }}>
                  {accessorials.map(acc => {
                    const selected = isAccessorialSelected(acc.code);
                    const current = selectedAccessorials.get(acc.code);
                    const catalogRate = acc.rate ?? 0;
                    const unitSuffix =
                      acc.rateUnit === 'per_mile' ? ' / mile' :
                      acc.rateUnit === 'per_15min' ? ' / 15 min' :
                      acc.rateUnit === 'per_item' ? ' / item' :
                      acc.rateUnit === 'per_hour' ? ' / hour' :
                      acc.rateUnit === 'per_day' ? ' / day' :
                      acc.rateUnit === 'plus_base' ? ' + base' : '';
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
                            onChange={() => toggleAccessorial(acc, selected)}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                              {acc.name}
                              {!selected && (acc.quoteRequired ? (
                                <span style={{ color: '#B45309', fontWeight: 600, fontStyle: 'italic', marginLeft: 'auto', fontSize: 12 }}>
                                  Quote Required
                                </span>
                              ) : acc.billingMode === 'per_class' ? (
                                <span style={{ color: theme.colors.textMuted, fontWeight: 400, marginLeft: 'auto', fontSize: 12 }}>
                                  Per class rate
                                </span>
                              ) : catalogRate != null ? (
                                <span style={{ color: theme.colors.textMuted, fontWeight: 400, marginLeft: 'auto' }}>
                                  ${catalogRate.toFixed(2)}{unitSuffix}
                                </span>
                              ) : null)}
                            </div>
                            {acc.description && (
                              <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 2 }}>{acc.description}</div>
                            )}
                          </div>
                        </label>
                        {selected && (
                          <div
                            style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${theme.colors.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}
                            onClick={e => e.stopPropagation()}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                              {acc.billingMode === 'per_qty' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                  <span style={{ fontSize: 10, fontWeight: 700, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Qty</span>
                                  <input
                                    type="number" min={1} step={1}
                                    value={current?.quantity ?? 1}
                                    onChange={e => updateAccessorialQty(acc.code, Math.max(1, parseInt(e.target.value, 10) || 1))}
                                    style={{ ...input, width: 80, padding: '4px 8px' }}
                                  />
                                </div>
                              )}
                              <span style={{
                                fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                                background: '#FEF3C7', color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.5px',
                              }}>
                                Quote pending
                              </span>
                              <span style={{ fontSize: 11, color: theme.colors.textMuted, fontStyle: 'italic' }}>
                                Our team will review your order and add pricing for this service.
                              </span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Instructions for our team
                              </span>
                              <textarea
                                value={current?.clientNotes ?? ''}
                                onChange={e => updateAccessorialNotes(acc.code, e.target.value)}
                                placeholder={`Describe what you need — e.g., "${acc.code === 'ASSEMBLY' ? 'assemble bed frame only' : 'specific scope, room, or items this should apply to'}"`}
                                rows={2}
                                style={{ ...input, padding: '6px 8px', resize: 'vertical', minHeight: 48, fontFamily: 'inherit' }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Bill-To */}
          <div style={section}>
            <div style={sectionTitle}>
              <CreditCardIcon /> Bill To
              <span style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>
                (who we'll invoice for these services)
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {billToRadioOptions.map(o => (
                <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="radio"
                    name="billToMode"
                    value={o.value}
                    checked={billToMode === o.value}
                    onChange={() => setBillToMode(o.value)}
                    style={{ accentColor: theme.colors.primary }}
                  />
                  <span style={{ color: billToMode === o.value ? theme.colors.text : theme.colors.textMuted }}>{o.label}</span>
                </label>
              ))}
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={label}>Bill-To Name *</label>
                  <input style={input} value={billToName} onChange={e => setBillToName(e.target.value)} placeholder="Full name" />
                </div>
                <div>
                  <label style={label}>Company</label>
                  <input style={input} value={billToCompany} onChange={e => setBillToCompany(e.target.value)} placeholder="Optional" />
                </div>
                <div>
                  <label style={label}>Email *</label>
                  <input style={input} type="email" value={billToEmail} onChange={e => setBillToEmail(e.target.value)} placeholder="invoice@example.com" />
                </div>
                <div>
                  <label style={label}>Phone *</label>
                  <input style={input} type="tel" value={billToPhone} onChange={e => setBillToPhone(e.target.value)} placeholder="(555) 555-5555" />
                </div>
              </div>
              <div>
                <label style={label}>Billing Address (optional)</label>
                <input style={input} value={billToAddress} onChange={e => setBillToAddress(e.target.value)} placeholder="Street address" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px', gap: 10 }}>
                <div>
                  <label style={label}>City</label>
                  <input style={input} value={billToCity} onChange={e => setBillToCity(e.target.value)} placeholder="City" />
                </div>
                <div>
                  <label style={label}>State</label>
                  <input style={input} value={billToState} onChange={e => setBillToState(e.target.value.toUpperCase().slice(0, 2))} maxLength={2} placeholder="WA" />
                </div>
                <div>
                  <label style={label}>Zip</label>
                  <input
                    style={input}
                    value={billToZip}
                    onChange={e => setBillToZip(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
                    maxLength={5}
                    placeholder="00000"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Driver Notes */}
          <div style={section}>
            <div style={sectionTitle}>Notes / Special Instructions</div>
            <div style={{ fontSize: 11, color: theme.colors.textMuted, marginBottom: 6, lineHeight: 1.5 }}>
              Anything our crew should know on-site — parking, gate codes, building access, fragile items, stairs, etc.
            </div>
            <textarea
              style={{ ...input, minHeight: 70, resize: 'vertical' }}
              value={driverNotes}
              onChange={e => setDriverNotes(e.target.value)}
              placeholder={mode === 'service_only'
                ? 'Anything else we should know? Access details, parking, etc.'
                : 'Parking, gate codes, elevator notes, stairs, fragile items, etc.'}
            />
          </div>

          {/* Pricing summary */}
          <div style={{
            padding: 14, background: '#F9FAFB', borderRadius: 10,
            border: `1px solid ${theme.colors.border}`,
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: theme.colors.textMuted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Estimated Pricing Summary
            </div>

            {(isPieceCountOverLimit || deliveryOutOfArea || pickupOutOfArea || isCallForQuote) && (
              <div style={{
                marginBottom: 10, padding: '10px 12px', borderRadius: 8,
                background: '#FEF3C7', border: '1px solid #FCD34D', color: '#92400E',
                fontSize: 12, lineHeight: 1.45,
              }}>
                <strong>This order may require quote review.</strong>{' '}
                {isPieceCountOverLimit && `Item count ${itemCount} exceeds the ${MAX_PIECES}-piece auto-pricing limit. `}
                {(deliveryOutOfArea || pickupOutOfArea) && `One or more ZIP codes are not in our standard service area. `}
                {isCallForQuote && `One or more ZIP codes is flagged Call for Quote. `}
                Pricing below is a placeholder — Stride will review and confirm.
              </div>
            )}

            {mode === 'pickup_and_delivery' ? (
              <>
                {baseFee != null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                    <span>Delivery Fee{deliveryZone ? ` (Zone ${deliveryZone.zone})` : ''}</span>
                    <span style={{ fontWeight: 500 }}>${baseFee.toFixed(2)}</span>
                  </div>
                )}
                {pickupLegFee > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                    <span>Pickup Fee{pickupZone ? ` (Zone ${pickupZone.zone})` : ''}</span>
                    <span style={{ fontWeight: 500 }}>${pickupLegFee.toFixed(2)}</span>
                  </div>
                )}
              </>
            ) : baseFee != null ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span>
                  {mode === 'pickup' ? 'Base Pickup Fee' : mode === 'service_only' ? 'Drive-Out Fee' : 'Base Delivery Fee'}
                  {(mode === 'pickup' ? pickupZone : deliveryZone)?.zone
                    ? ` (Zone ${(mode === 'pickup' ? pickupZone : deliveryZone)!.zone})`
                    : ''}
                </span>
                <span style={{ fontWeight: 500 }}>${baseFee.toFixed(2)}</span>
              </div>
            ) : (deliveryZip.length === 5 || pickupZip.length === 5) ? (
              <div style={{ fontSize: 12, color: '#B45309', marginBottom: 6, fontStyle: 'italic' }}>
                Quote required — ZIP not in current rate table.
              </div>
            ) : null}

            {mode !== 'service_only' && extraItemsCount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span>Extra Items ({extraItemsCount} × ${extraPieceConfig.rate.toFixed(2)}{extraItemsLegMultiplier > 1 ? ` × ${extraItemsLegMultiplier} legs` : ''})</span>
                <span style={{ fontWeight: 500 }}>${extraItemsFee.toFixed(2)}</span>
              </div>
            )}

            {Array.from(selectedAccessorials.values()).map(a => {
              const acc = accessorials.find(x => x.code === a.code);
              return (
                <div key={a.code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                  <span>{acc?.name ?? a.code}{a.quantity > 1 ? ` × ${a.quantity}` : ''}</span>
                  <span style={{ fontWeight: 500, color: '#B45309', fontStyle: 'italic' }}>Quote pending</span>
                </div>
              );
            })}
            {Array.from(selectedAccessorials.values()).length > 0 && (
              <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 4, marginBottom: 4, fontStyle: 'italic', lineHeight: 1.45 }}>
                Add-ons will be priced by our team during review.
              </div>
            )}

            {mode !== 'service_only' && selectedCoverage && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span>
                  Coverage ({selectedCoverage.name}
                  {selectedCoverage.calcType === 'percent_declared' && declaredValue
                    ? ` — ${selectedCoverage.rate.toFixed(2)}% × $${parseFloat(declaredValue).toFixed(0)}`
                    : selectedCoverage.calcType === 'percent_declared'
                      ? ` — ${selectedCoverage.rate.toFixed(2)}% (declared value not set)`
                      : ''})
                </span>
                <span style={{ fontWeight: 500 }}>{coverageCharge > 0 ? `$${coverageCharge.toFixed(2)}` : 'Included'}</span>
              </div>
            )}

            {subtotalBeforeTax != null && (
              <>
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  fontSize: 13, marginTop: 8, paddingTop: 8,
                  borderTop: `1px dashed ${theme.colors.border}`,
                }}>
                  <span>Subtotal</span>
                  <span style={{ fontWeight: 500 }}>${subtotalBeforeTax.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                  <span>Sales Tax ({TAX_RATE_PCT.toFixed(1)}%)</span>
                  <span style={{ fontWeight: 500 }}>${taxAmount.toFixed(2)}</span>
                </div>
              </>
            )}

            <div style={{
              display: 'flex', justifyContent: 'space-between',
              marginTop: 10, paddingTop: 10, borderTop: `1px solid ${theme.colors.border}`,
              fontSize: 15, fontWeight: 700,
            }}>
              <span>Estimated Total</span>
              <span>{orderTotal != null ? `$${orderTotal.toFixed(2)}` : 'Quote required'}</span>
            </div>
            <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 8, fontStyle: 'italic', lineHeight: 1.45 }}>
              Pricing is estimated based on the information provided. Stride will review and adjust delivery rates, add-on charges, and tax as needed to confirm the final price.
            </div>
          </div>

          {/* Order Summary (pieces + volume) */}
          {mode !== 'service_only' && (
            <div style={{
              padding: 14, background: '#FFF7ED', borderRadius: 10,
              border: `1px solid ${theme.colors.orangeLight || '#FED7AA'}`,
              marginBottom: 16,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: theme.colors.orange, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Order Summary
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                  <span style={{ fontWeight: 600 }}>Pieces:</span> {itemCount}
                </div>
                <div style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                  <span style={{ fontWeight: 600 }}>Volume:</span> {totalVolume > 0 ? `${totalVolume.toFixed(1)} cu ft` : '—'}
                </div>
                <div style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                  <span style={{ fontWeight: 600 }}>Total:</span> {orderTotal != null ? `$${orderTotal.toFixed(2)}` : 'Quote'}
                </div>
              </div>
            </div>
          )}

          {/* Acknowledgment */}
          <label style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '12px 14px', borderRadius: 10,
            background: priceAcknowledged ? '#ECFDF5' : '#FFFBEB',
            border: `1px solid ${priceAcknowledged ? '#A7F3D0' : '#FDE68A'}`,
            cursor: 'pointer',
            marginBottom: 16,
          }}>
            <input
              type="checkbox"
              checked={priceAcknowledged}
              onChange={e => setPriceAcknowledged(e.target.checked)}
              style={{ marginTop: 2, accentColor: theme.colors.primary }}
            />
            <span style={{ fontSize: 12, lineHeight: 1.45, color: priceAcknowledged ? '#065F46' : '#92400E' }}>
              I understand this is an <strong>estimated price</strong>. Stride will review my request and may adjust the delivery rate, add-on charges, or tax before confirming the final price. I will receive an email with the confirmed pricing before any work begins.
            </span>
          </label>

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

        {/* Footer */}
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

// Inline credit-card icon — kept local so we don't add another lucide
// import to the top-of-file list. Used in the Bill To section header.
function CreditCardIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2"/>
      <line x1="2" y1="10" x2="22" y2="10"/>
    </svg>
  );
}

// ── Page shell (header + body container + footer) ─────────────────────
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: theme.colors.bgSubtle,
      fontFamily: theme.typography.fontFamily,
      color: theme.colors.text,
      display: 'flex', flexDirection: 'column',
    }}>
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

      <main style={{
        flex: 1,
        maxWidth: 960, width: '100%', margin: '0 auto',
        padding: '24px 16px',
        boxSizing: 'border-box',
      }}>
        {children}
      </main>

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
