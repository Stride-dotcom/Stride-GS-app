/**
 * CreateDeliveryOrderModal — Phase 2c (expanded)
 *
 * Four order modes, selected up front:
 *   • delivery            → items leave Stride warehouse to a customer
 *   • pickup              → items come from a customer to Stride warehouse
 *   • pickup_and_delivery → items move from one address to another
 *                           (creates TWO linked dt_orders rows via
 *                           linked_order_id)
 *   • service_only        → on-site visit, no items
 *
 * Accessorials are role-gated: clients see only `visible_to_client=true`
 * rows; staff/admin see everything.
 *
 * Submit writes directly to Supabase (dt_orders + dt_order_items) with
 * review_status='pending_review'. Nothing goes to DT until a reviewer
 * hits "Approve & Push" on the Review Queue — at which point the
 * `dt-push-order` Edge Function handles linked pairs correctly.
 *
 * Multi-stop (>2 stops) is deferred; this modal handles 1 stop + an
 * optional linked pickup for the pickup_and_delivery mode.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  X, Check, Loader2, CheckCircle2, MapPin, Truck,
  ArrowRight, Wrench, Box, Plus, Trash2,
} from 'lucide-react';
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

type OrderMode = 'delivery' | 'pickup' | 'pickup_and_delivery' | 'service_only';
type ItemsSource = 'warehouse' | 'pickup';

interface LiveItem {
  itemId: string;
  clientName: string;
  clientId: string;
  vendor: string;
  description: string;
  location: string;
  sidemark: string;
  status: string;
  qty?: number;
  [k: string]: any;
}

interface Props {
  onClose: () => void;
  onSubmit?: (data: { dtOrderId: string; dtIdentifier: string; reviewStatus: string }) => void;
  preSelectedItemIds?: string[];
  liveItems?: LiveItem[];
}

// A free-text item entered on a pickup form (not linked to inventory)
interface FreeItem {
  id: string;              // client-side uid for React key
  description: string;
  quantity: number;
}

interface SelectedAccessorial {
  code: string;
  quantity: number;
  subtotal: number;
}

const INCLUDED_ITEMS = 3;
const EXTRA_ITEM_RATE = 25;

function genUid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function CreateDeliveryOrderModal({
  onClose,
  onSubmit,
  preSelectedItemIds = [],
  liveItems = [],
}: Props) {
  const { user } = useAuth();
  const isStaff = user?.role === 'staff' || user?.role === 'admin';

  // ── Mode selection (Step 0) ────────────────────────────────────────────
  const hasPreSelected = preSelectedItemIds.length > 0;
  // If items were pre-selected on the Inventory page, assume 'delivery' mode
  const [mode, setMode] = useState<OrderMode>(hasPreSelected ? 'delivery' : 'delivery');
  const [itemsSource, setItemsSource] = useState<ItemsSource>('warehouse');

  // Switching to pickup-related modes clears the inventory selection
  useEffect(() => {
    if (mode === 'pickup' || mode === 'service_only') {
      setItemsSource('warehouse');
      setSelectedIds(new Set());
    }
    // If user picks pickup_and_delivery, default to pickup-as-source for items
    if (mode === 'pickup_and_delivery') {
      setItemsSource('pickup');
    }
    if (mode === 'delivery' && hasPreSelected) {
      setItemsSource('warehouse');
    }
  }, [mode, hasPreSelected]);

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

  // ── Schedule ───────────────────────────────────────────────────────────
  const [serviceDate, setServiceDate] = useState('');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');

  // ── Pickup contact + items (pickup / pickup_and_delivery) ──────────────
  const [pickupContactName, setPickupContactName] = useState('');
  const [pickupAddress, setPickupAddress] = useState('');
  const [pickupCity, setPickupCity] = useState('');
  const [pickupState, setPickupState] = useState('WA');
  const [pickupZip, setPickupZip] = useState('');
  const [pickupPhone, setPickupPhone] = useState('');
  const [pickupEmail, setPickupEmail] = useState('');
  const [pickupFreeItems, setPickupFreeItems] = useState<FreeItem[]>([
    { id: genUid(), description: '', quantity: 1 },
  ]);

  // ── Delivery contact (delivery / pickup_and_delivery / service_only) ───
  const [deliveryContactName, setDeliveryContactName] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryCity, setDeliveryCity] = useState('');
  const [deliveryState, setDeliveryState] = useState('WA');
  const [deliveryZip, setDeliveryZip] = useState('');
  const [deliveryPhone, setDeliveryPhone] = useState('');
  const [deliveryEmail, setDeliveryEmail] = useState('');

  // ── Service-only description ───────────────────────────────────────────
  const [serviceDescription, setServiceDescription] = useState('');

  // ── Inventory item selection (delivery + warehouse-source only) ────────
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
  const selectedInvItems = useMemo(
    () => liveItems.filter(i => selectedIds.has(i.itemId)),
    [liveItems, selectedIds]
  );

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

  // ── Pricing inputs (zone lookup uses the DELIVERY zip for delivery/P+D;
  //     the PICKUP zip for pickup-only; destination zip for service_only) ─
  const [zone, setZone] = useState<DeliveryZone | null>(null);
  const [zoneLoading, setZoneLoading] = useState(false);
  const zipForPricing = useMemo(() => {
    if (mode === 'pickup') return pickupZip;
    return deliveryZip;
  }, [mode, pickupZip, deliveryZip]);

  useEffect(() => {
    const trimmed = zipForPricing.trim();
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
  }, [zipForPricing]);

  // ── Accessorials (role-filtered) ───────────────────────────────────────
  const [accessorials, setAccessorials] = useState<DeliveryAccessorial[]>([]);
  const [selectedAccessorials, setSelectedAccessorials] = useState<Map<string, SelectedAccessorial>>(new Map());

  useEffect(() => {
    fetchDeliveryAccessorials().then(data => {
      if (!data) return;
      const filtered = data
        .filter(a => a.code !== 'EXTRA_ITEM')           // auto-computed
        .filter(a => isStaff || a.visibleToClient);     // role gate
      setAccessorials(filtered);
    });
  }, [isStaff]);

  const toggleAccessorial = (acc: DeliveryAccessorial, quantity: number = 1) => {
    setSelectedAccessorials(prev => {
      const n = new Map(prev);
      if (n.has(acc.code) && quantity === 0) {
        n.delete(acc.code);
      } else if (acc.rate != null) {
        let subtotal = 0;
        if (acc.rateUnit === 'flat' || acc.rateUnit === 'plus_base') subtotal = acc.rate;
        else if (acc.rateUnit === 'per_mile' || acc.rateUnit === 'per_15min' || acc.rateUnit === 'per_item') subtotal = acc.rate * quantity;
        n.set(acc.code, { code: acc.code, quantity, subtotal });
      }
      return n;
    });
  };
  const isAccessorialSelected = (code: string) => selectedAccessorials.has(code);

  // ── Pricing calculation ────────────────────────────────────────────────
  // Base fee: for pickup-only, use pickup rate; for delivery/P+D, use delivery rate;
  // service_only uses delivery rate (driving to site).
  const baseFee = useMemo(() => {
    if (!zone) return null;
    if (mode === 'pickup') return zone.pickupRate;
    return zone.baseRate;
  }, [zone, mode]);

  // "Extra items" logic only applies when there are actual items
  const itemCount = useMemo(() => {
    if (mode === 'service_only') return 0;
    if (mode === 'delivery' && itemsSource === 'warehouse') return selectedInvItems.length;
    return pickupFreeItems.filter(i => i.description.trim()).reduce((sum, i) => sum + Math.max(1, Number(i.quantity) || 1), 0);
  }, [mode, itemsSource, selectedInvItems, pickupFreeItems]);

  const extraItemsCount = Math.max(0, itemCount - INCLUDED_ITEMS);
  const extraItemsFee = extraItemsCount * EXTRA_ITEM_RATE;

  const accessorialsTotal = useMemo(
    () => Array.from(selectedAccessorials.values()).reduce((s, a) => s + a.subtotal, 0),
    [selectedAccessorials]
  );

  // pickup_and_delivery involves both a pickup trip AND a delivery trip;
  // we charge the pickup-zone pickup rate on top of the delivery fee.
  const pickupLegFee = useMemo(() => {
    if (mode !== 'pickup_and_delivery' || !pickupZip || pickupZip.length !== 5) return 0;
    // Optimistic estimate using the delivery zone rate (we don't fetch the pickup zone
    // separately — staff will adjust during review if the pickup zip is a higher zone).
    return 0; // placeholder — staff applies OUT_OF_AREA / DRIVE_OUT during review if needed
  }, [mode, pickupZip]);

  const orderTotal = useMemo(() => {
    if (baseFee == null) return null;
    return baseFee + pickupLegFee + extraItemsFee + accessorialsTotal;
  }, [baseFee, pickupLegFee, extraItemsFee, accessorialsTotal]);

  const isCallForQuote = zipForPricing.length === 5 && zone && zone.baseRate == null;

  // ── Validation ─────────────────────────────────────────────────────────
  const canSubmit = useMemo(() => {
    if (!clientSheetId) return false;
    if (!serviceDate) return false;
    if (mode === 'service_only') {
      return !!(deliveryContactName.trim() && deliveryAddress.trim() && deliveryCity.trim() && deliveryZip.trim() && serviceDescription.trim());
    }
    const needsPickup = mode === 'pickup' || mode === 'pickup_and_delivery';
    const needsDelivery = mode === 'delivery' || mode === 'pickup_and_delivery';
    if (needsPickup) {
      if (!pickupContactName.trim() || !pickupAddress.trim() || !pickupCity.trim() || !pickupZip.trim()) return false;
      const hasPickupItems = pickupFreeItems.some(i => i.description.trim());
      if (!hasPickupItems) return false;
    }
    if (needsDelivery) {
      if (!deliveryContactName.trim() || !deliveryAddress.trim() || !deliveryCity.trim() || !deliveryZip.trim()) return false;
      // For delivery-only with warehouse source, require item selection
      if (mode === 'delivery' && itemsSource === 'warehouse' && selectedInvItems.length === 0) return false;
    }
    return true;
  }, [
    clientSheetId, serviceDate, mode,
    deliveryContactName, deliveryAddress, deliveryCity, deliveryZip, serviceDescription,
    pickupContactName, pickupAddress, pickupCity, pickupZip, pickupFreeItems,
    itemsSource, selectedInvItems,
  ]);

  // ── Submit ─────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<{ dtIdentifier: string; linkedIdentifier?: string } | null>(null);

  // Generate a client-side order number: STR-YYMMDD-HHMMSS-XX
  const genDtIdentifier = (suffix?: string): string => {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const rand = Math.random().toString(36).slice(2, 4).toUpperCase();
    const base = `STR-${yy}${mm}${dd}-${hh}${mi}${ss}-${rand}`;
    return suffix ? `${base}-${suffix}` : base;
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);

    const { data: authData } = await supabase.auth.getUser();
    const authUid = authData?.user?.id || null;

    const accList = Array.from(selectedAccessorials.values()).map(a => ({
      code: a.code,
      quantity: a.quantity,
      rate: accessorials.find(x => x.code === a.code)?.rate || 0,
      subtotal: a.subtotal,
    }));

    const commonFields = {
      tenant_id: clientSheetId,
      timezone: 'America/Los_Angeles',
      local_service_date: serviceDate,
      window_start_local: windowStart || null,
      window_end_local: windowEnd || null,
      po_number: poNumber.trim() || null,
      sidemark: sidemark.trim() || null,
      details: details.trim() || null,
      source: 'app',
      review_status: 'pending_review',
      created_by_user: authUid,
      created_by_role: user?.role || 'client',
      status_id: 0, // Entered
    };

    try {
      if (mode === 'pickup_and_delivery') {
        // Two linked orders — create BOTH in a single flow.
        // Strategy: insert pickup row first (get its id), then insert delivery
        // row with linked_order_id=pickup.id, then back-update pickup to set
        // linked_order_id=delivery.id. This creates a bidirectional link.
        const baseId = genDtIdentifier();
        const pickupIdent = `${baseId}-P`;
        const deliveryIdent = `${baseId}-D`;

        // 1) Insert pickup
        const { data: pickupRow, error: pErr } = await supabase
          .from('dt_orders')
          .insert({
            ...commonFields,
            dt_identifier: pickupIdent,
            order_type: 'pickup',
            is_pickup: true,
            contact_name: pickupContactName.trim(),
            contact_address: pickupAddress.trim(),
            contact_city: pickupCity.trim(),
            contact_state: pickupState.trim(),
            contact_zip: pickupZip.trim(),
            contact_phone: pickupPhone.trim() || null,
            contact_email: pickupEmail.trim() || null,
            base_delivery_fee: null,         // pickup leg not priced separately here
            order_total: null,
            pricing_override: true,
            pricing_notes: 'Pickup leg of linked pickup+delivery — pricing rolled into delivery order.',
          })
          .select('id, dt_identifier')
          .single();
        if (pErr || !pickupRow) throw new Error(`Pickup order insert failed: ${pErr?.message}`);

        // 2) Insert delivery (links to pickup)
        const { data: deliveryRow, error: dErr } = await supabase
          .from('dt_orders')
          .insert({
            ...commonFields,
            dt_identifier: deliveryIdent,
            order_type: 'pickup_and_delivery',
            is_pickup: false,
            contact_name: deliveryContactName.trim(),
            contact_address: deliveryAddress.trim(),
            contact_city: deliveryCity.trim(),
            contact_state: deliveryState.trim(),
            contact_zip: deliveryZip.trim(),
            contact_phone: deliveryPhone.trim() || null,
            contact_email: deliveryEmail.trim() || null,
            linked_order_id: pickupRow.id,
            // Pricing goes on the delivery leg (user-facing total)
            base_delivery_fee: baseFee,
            extra_items_count: extraItemsCount,
            extra_items_fee: extraItemsFee,
            accessorials_json: accList,
            accessorials_total: accessorialsTotal,
            order_total: orderTotal,
            pricing_override: isCallForQuote || false,
            pricing_notes: isCallForQuote
              ? 'Delivery zone marked CALL FOR QUOTE — pricing requires manual review.'
              : 'Linked pickup+delivery. Pickup zone may require additional OUT_OF_AREA/DRIVE_OUT adjustment during review.',
          })
          .select('id, dt_identifier')
          .single();
        if (dErr || !deliveryRow) throw new Error(`Delivery order insert failed: ${dErr?.message}`);

        // 3) Backlink pickup → delivery for bidirectional navigation
        await supabase.from('dt_orders')
          .update({ linked_order_id: deliveryRow.id })
          .eq('id', pickupRow.id);

        // 4) Insert items. Free-text items go on BOTH orders (so the pickup
        //    shows what's being picked up and the delivery shows the same
        //    list). dt_order_items.inventory_id is NULL for free-text.
        const pickupItemRows = pickupFreeItems
          .filter(i => i.description.trim())
          .flatMap(i => [
            {
              dt_order_id: pickupRow.id,
              dt_item_code: null,
              description: i.description.trim(),
              quantity: Math.max(1, Number(i.quantity) || 1),
              original_quantity: Math.max(1, Number(i.quantity) || 1),
              extras: { source: 'pickup_free_text' },
            },
            {
              dt_order_id: deliveryRow.id,
              dt_item_code: null,
              description: i.description.trim(),
              quantity: Math.max(1, Number(i.quantity) || 1),
              original_quantity: Math.max(1, Number(i.quantity) || 1),
              extras: { source: 'pickup_free_text', linked_to_pickup: pickupRow.id },
            },
          ]);
        if (pickupItemRows.length > 0) {
          const { error: iErr } = await supabase.from('dt_order_items').insert(pickupItemRows);
          if (iErr) throw new Error(`Items insert failed: ${iErr.message}`);
        }

        setCreateResult({ dtIdentifier: deliveryRow.dt_identifier, linkedIdentifier: pickupRow.dt_identifier });
        onSubmit?.({
          dtOrderId: deliveryRow.id,
          dtIdentifier: deliveryRow.dt_identifier,
          reviewStatus: 'pending_review',
        });
      } else {
        // Single-order path (delivery / pickup / service_only)
        const dtIdentifier = genDtIdentifier();
        const isPickup = mode === 'pickup';
        const isServiceOnly = mode === 'service_only';

        const contactName = isPickup ? pickupContactName : deliveryContactName;
        const contactAddress = isPickup ? pickupAddress : deliveryAddress;
        const contactCity = isPickup ? pickupCity : deliveryCity;
        const contactState = isPickup ? pickupState : deliveryState;
        const contactZip = isPickup ? pickupZip : deliveryZip;
        const contactPhone = isPickup ? pickupPhone : deliveryPhone;
        const contactEmail = isPickup ? pickupEmail : deliveryEmail;

        const { data: orderRow, error: orderErr } = await supabase
          .from('dt_orders')
          .insert({
            ...commonFields,
            dt_identifier: dtIdentifier,
            order_type: mode,
            is_pickup: isPickup,
            contact_name: contactName.trim(),
            contact_address: contactAddress.trim(),
            contact_city: contactCity.trim(),
            contact_state: contactState.trim(),
            contact_zip: contactZip.trim(),
            contact_phone: contactPhone.trim() || null,
            contact_email: contactEmail.trim() || null,
            details: isServiceOnly
              ? `${serviceDescription.trim()}\n\n${details.trim()}`.trim()
              : details.trim() || null,
            base_delivery_fee: isServiceOnly ? null : baseFee,
            extra_items_count: isServiceOnly ? 0 : extraItemsCount,
            extra_items_fee: isServiceOnly ? 0 : extraItemsFee,
            accessorials_json: accList,
            accessorials_total: accessorialsTotal,
            order_total: isServiceOnly ? accessorialsTotal || null : orderTotal,
            pricing_override: isServiceOnly || isCallForQuote,
            pricing_notes: isServiceOnly
              ? 'Service-only visit — no items. Staff to confirm service fee during review.'
              : isCallForQuote
                ? 'Zone marked CALL FOR QUOTE — pricing requires manual review.'
                : null,
          })
          .select('id, dt_identifier')
          .single();

        if (orderErr || !orderRow) {
          throw new Error(orderErr?.message || 'Failed to create order');
        }

        // Items
        if (mode === 'delivery' && itemsSource === 'warehouse' && selectedInvItems.length > 0) {
          const itemRows = selectedInvItems.map(i => ({
            dt_order_id: orderRow.id,
            dt_item_code: i.itemId,
            description: i.description || i.itemId,
            quantity: Number(i.qty) || 1,
            original_quantity: Number(i.qty) || 1,
            extras: { vendor: i.vendor || null, sidemark: i.sidemark || null, location: i.location || null, source: 'inventory' },
          }));
          const { error: iErr } = await supabase.from('dt_order_items').insert(itemRows);
          if (iErr) throw new Error(`Items insert failed: ${iErr.message}`);
        } else if (mode === 'pickup') {
          const freeRows = pickupFreeItems.filter(i => i.description.trim()).map(i => ({
            dt_order_id: orderRow.id,
            dt_item_code: null,
            description: i.description.trim(),
            quantity: Math.max(1, Number(i.quantity) || 1),
            original_quantity: Math.max(1, Number(i.quantity) || 1),
            extras: { source: 'pickup_free_text' },
          }));
          if (freeRows.length > 0) {
            const { error: iErr } = await supabase.from('dt_order_items').insert(freeRows);
            if (iErr) throw new Error(`Items insert failed: ${iErr.message}`);
          }
        }
        // service_only has no items — nothing to insert.

        setCreateResult({ dtIdentifier: orderRow.dt_identifier });
        onSubmit?.({
          dtOrderId: orderRow.id,
          dtIdentifier: orderRow.dt_identifier,
          reviewStatus: 'pending_review',
        });
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
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
            {mode === 'pickup_and_delivery' ? 'Pickup + Delivery Submitted' : mode === 'service_only' ? 'Service Request Submitted' : 'Order Submitted'}
          </div>
          <div style={{ fontSize: 13, color: theme.colors.textMuted, marginBottom: 4 }}>
            {createResult.linkedIdentifier ? 'Delivery Order' : 'Order Number'}
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 600, color: theme.colors.primary, marginBottom: 8 }}>
            {createResult.dtIdentifier}
          </div>
          {createResult.linkedIdentifier && (
            <>
              <div style={{ fontSize: 13, color: theme.colors.textMuted, marginTop: 10, marginBottom: 4 }}>Linked Pickup</div>
              <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color: theme.colors.primary, marginBottom: 20 }}>
                {createResult.linkedIdentifier}
              </div>
            </>
          )}
          <div style={{
            background: '#FEF3C7', color: '#92400E', padding: '10px 14px',
            borderRadius: 8, fontSize: 12, marginTop: 12, marginBottom: 20, textAlign: 'left',
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

  // ── Order type cards ───────────────────────────────────────────────────
  const modeCards: Array<{ mode: OrderMode; icon: React.ReactNode; label: string; desc: string }> = [
    { mode: 'delivery',            icon: <Truck size={20} />,             label: 'Delivery',           desc: 'Items from Stride warehouse → customer' },
    { mode: 'pickup',              icon: <Box size={20} />,               label: 'Pickup',             desc: 'Items from customer → Stride warehouse' },
    { mode: 'pickup_and_delivery', icon: <ArrowRight size={20} />,        label: 'Pickup + Delivery',  desc: 'Customer → Customer (skip warehouse)' },
    { mode: 'service_only',        icon: <Wrench size={20} />,            label: 'Service Only',       desc: 'On-site visit, no items' },
  ];

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 200 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 760, maxWidth: '95vw', maxHeight: '92vh',
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
            <div style={{ fontSize: 16, fontWeight: 700 }}>New Delivery Order</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

          {/* Mode cards */}
          <div style={section}>
            <div style={sectionTitle}>What type of order?</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              {modeCards.map(card => (
                <button
                  key={card.mode}
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

          {/* Items source toggle — only for delivery mode */}
          {mode === 'delivery' && (
            <div style={section}>
              <div style={sectionTitle}>Where are the items?</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <button
                  onClick={() => setItemsSource('warehouse')}
                  style={{
                    padding: '12px 14px', borderRadius: 10,
                    border: itemsSource === 'warehouse' ? `2px solid ${theme.colors.primary}` : `1px solid ${theme.colors.border}`,
                    background: itemsSource === 'warehouse' ? '#FFF7ED' : '#fff',
                    cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700 }}>🏭 Stride Warehouse</div>
                  <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 4 }}>
                    Pick from client inventory
                  </div>
                </button>
                <button
                  onClick={() => { setItemsSource('pickup'); setMode('pickup_and_delivery'); }}
                  style={{
                    padding: '12px 14px', borderRadius: 10,
                    border: `1px solid ${theme.colors.border}`,
                    background: '#fff',
                    cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700 }}>📦 Requires Pickup</div>
                  <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 4 }}>
                    Items need to be picked up first
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Schedule */}
          <div style={section}>
            <div style={sectionTitle}>Schedule</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <label style={label}>Service Date</label>
                <input type="date" value={serviceDate} onChange={e => setServiceDate(e.target.value)} style={input} />
              </div>
              <div>
                <label style={label}>Window Start</label>
                <input type="time" value={windowStart} onChange={e => setWindowStart(e.target.value)} style={input} />
              </div>
              <div>
                <label style={label}>Window End</label>
                <input type="time" value={windowEnd} onChange={e => setWindowEnd(e.target.value)} style={input} />
              </div>
            </div>
            {zone?.serviceDays && (
              <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 8 }}>
                Zone {zone.zone} service days: <strong>{zone.serviceDays}</strong>
              </div>
            )}
          </div>

          {/* PICKUP section — for pickup and pickup_and_delivery modes */}
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
                  {pickupFreeItems.map((item) => (
                    <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 32px', gap: 8, alignItems: 'center' }}>
                      <input
                        style={input}
                        placeholder="Description"
                        value={item.description}
                        onChange={e => setPickupFreeItems(prev => prev.map(i => i.id === item.id ? { ...i, description: e.target.value } : i))}
                      />
                      <input
                        style={input}
                        type="number" min={1}
                        placeholder="Qty"
                        value={item.quantity}
                        onChange={e => setPickupFreeItems(prev => prev.map(i => i.id === item.id ? { ...i, quantity: Math.max(1, parseInt(e.target.value) || 1) } : i))}
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
                    These items will auto-appear on the delivery leg below.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* DELIVERY section — for delivery, pickup_and_delivery, and service_only */}
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
                email={deliveryEmail}                 setEmail={setDeliveryEmail}
                input={input} label={label}
                contactLabel={mode === 'service_only' ? 'On-site contact' : 'Recipient'}
                zoneInfo={deliveryZip.length === 5 ? {
                  loading: zoneLoading,
                  zone,
                  mode: mode === 'service_only' ? 'Service Visit' : 'Delivery',
                  isCallForQuote: !!isCallForQuote,
                  displayRate: zone?.baseRate ?? null,
                } : null}
              />

              {/* Items sub-section for delivery mode */}
              {mode === 'delivery' && itemsSource === 'warehouse' && (
                <div style={{ marginTop: 14 }}>
                  <div style={label}>Items (from inventory, {selectedInvItems.length} selected)</div>
                  <input
                    style={{ ...input, marginBottom: 10 }}
                    placeholder="Search items…"
                    value={itemSearch}
                    onChange={e => setItemSearch(e.target.value)}
                  />
                  <div style={{
                    maxHeight: 200, overflowY: 'auto',
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
                </div>
              )}

              {/* Auto-copied items display for pickup_and_delivery */}
              {mode === 'pickup_and_delivery' && (
                <div style={{ marginTop: 14 }}>
                  <div style={label}>Items to deliver (copied from pickup)</div>
                  <div style={{ padding: 12, background: '#F9FAFB', borderRadius: 8, fontSize: 12, color: theme.colors.textMuted }}>
                    {pickupFreeItems.filter(i => i.description.trim()).length === 0
                      ? 'Add items on the Pickup section above — they\'ll appear here automatically.'
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
                    placeholder="e.g., On-site inspection, quote visit, adjust existing install, drop off samples, etc."
                  />
                </div>
              )}
            </div>
          )}

          {/* Accessorials */}
          {accessorials.length > 0 && mode !== 'service_only' && (
            <div style={section}>
              <div style={sectionTitle}>
                Add-Ons
                {isStaff && (
                  <span style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>
                    (includes staff-only options)
                  </span>
                )}
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {accessorials.map(acc => {
                  const selected = isAccessorialSelected(acc.code);
                  const current = selectedAccessorials.get(acc.code);
                  const needsQuantity = acc.rateUnit === 'per_15min' || acc.rateUnit === 'per_mile' || acc.rateUnit === 'per_item';
                  const staffOnly = !acc.visibleToClient;
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
                          <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                            {acc.name}
                            {staffOnly && (
                              <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: '#E0E7FF', color: '#3730A3', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                Staff
                              </span>
                            )}
                            {acc.rate != null && (
                              <span style={{ color: theme.colors.textMuted, fontWeight: 400, marginLeft: 'auto' }}>
                                ${acc.rate.toFixed(2)}
                                {acc.rateUnit === 'per_mile' && ' / mile'}
                                {acc.rateUnit === 'per_15min' && ' / 15 min'}
                                {acc.rateUnit === 'per_item' && ' / item'}
                                {acc.rateUnit === 'plus_base' && ' + base'}
                              </span>
                            )}
                          </div>
                          {acc.description && (
                            <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 2 }}>{acc.description}</div>
                          )}
                        </div>
                        {selected && needsQuantity && (
                          <input
                            type="number" min={1}
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
          )}

          {/* Reference (non-service_only) */}
          {mode !== 'service_only' && (
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
          )}

          {/* Pricing summary */}
          {mode !== 'service_only' && (
            <div style={{
              padding: 14, background: '#F9FAFB', borderRadius: 10,
              border: `1px solid ${theme.colors.border}`,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: theme.colors.textMuted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Pricing Summary
              </div>
              {baseFee != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                  <span>{mode === 'pickup' ? 'Base Pickup Fee' : 'Base Delivery Fee'}</span>
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
                <span>{orderTotal != null ? `$${orderTotal.toFixed(2)}` : isCallForQuote ? 'Call for quote' : '—'}</span>
              </div>
              {(isCallForQuote || mode === 'pickup_and_delivery') && (
                <div style={{ fontSize: 11, color: '#B45309', marginTop: 6, fontStyle: 'italic' }}>
                  Staff will confirm final pricing during review.
                </div>
              )}
            </div>
          )}

          {mode === 'service_only' && (
            <div style={{
              padding: 14, background: '#F9FAFB', borderRadius: 10,
              border: `1px solid ${theme.colors.border}`,
              fontSize: 12, color: theme.colors.textMuted,
            }}>
              <strong>Service-only orders don't have standard pricing.</strong> Staff will set the service fee during review based on travel time and work scope.
            </div>
          )}

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
              label={submitting ? 'Submitting…' : `Submit ${modeCards.find(c => c.mode === mode)?.label ?? 'Order'}`}
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

// ── AddressFields sub-component ──────────────────────────────────────────
interface AddressFieldsProps {
  contactName: string; setContactName: (v: string) => void;
  address: string; setAddress: (v: string) => void;
  city: string; setCity: (v: string) => void;
  state: string; setState: (v: string) => void;
  zip: string; setZip: (v: string) => void;
  phone: string; setPhone: (v: string) => void;
  email: string; setEmail: (v: string) => void;
  input: React.CSSProperties;
  label: React.CSSProperties;
  contactLabel: string;
  zoneInfo?: {
    loading: boolean;
    zone: DeliveryZone | null;
    mode: string;
    isCallForQuote: boolean;
    displayRate: number | null;
  } | null;
}

function AddressFields(p: AddressFieldsProps) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div>
        <label style={p.label}>{p.contactLabel}</label>
        <input style={p.input} value={p.contactName} onChange={e => p.setContactName(e.target.value)} placeholder="Name" />
      </div>
      <div>
        <label style={p.label}>Street Address</label>
        <input style={p.input} value={p.address} onChange={e => p.setAddress(e.target.value)} placeholder="123 Main St" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
        <div>
          <label style={p.label}>City</label>
          <input style={p.input} value={p.city} onChange={e => p.setCity(e.target.value)} />
        </div>
        <div>
          <label style={p.label}>State</label>
          <input style={p.input} value={p.state} onChange={e => p.setState(e.target.value.toUpperCase())} maxLength={2} />
        </div>
        <div>
          <label style={p.label}>ZIP</label>
          <input
            style={{
              ...p.input,
              borderColor: p.zoneInfo?.zone && p.zoneInfo.zone.baseRate != null ? '#16A34A'
                : p.zoneInfo?.isCallForQuote ? '#B45309'
                : (p.input.borderColor ?? '#E5E7EB'),
            }}
            value={p.zip}
            onChange={e => p.setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
            placeholder="98101"
          />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label style={p.label}>Phone</label>
          <input style={p.input} value={p.phone} onChange={e => p.setPhone(e.target.value)} placeholder="(555) 555-5555" />
        </div>
        <div>
          <label style={p.label}>Email</label>
          <input style={p.input} value={p.email} onChange={e => p.setEmail(e.target.value)} type="email" />
        </div>
      </div>
      {p.zoneInfo && p.zip.length === 5 && (
        <div style={{
          padding: '8px 12px', borderRadius: 8, fontSize: 12,
          background: p.zoneInfo.zone?.baseRate != null ? '#F0FDF4'
            : p.zoneInfo.isCallForQuote ? '#FEF3C7' : '#F3F4F6',
          color: p.zoneInfo.zone?.baseRate != null ? '#15803D'
            : p.zoneInfo.isCallForQuote ? '#92400E' : '#6B7280',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <MapPin size={12} />
          {p.zoneInfo.loading ? 'Looking up zone…'
            : !p.zoneInfo.zone ? `ZIP ${p.zip} not in service area — call for quote`
            : p.zoneInfo.zone.baseRate == null ? `${p.zoneInfo.zone.city} (Zone ${p.zoneInfo.zone.zone}) — CALL FOR QUOTE`
            : `${p.zoneInfo.zone.city} (Zone ${p.zoneInfo.zone.zone}) — ${p.zoneInfo.mode} rate $${p.zoneInfo.displayRate?.toFixed(2)}`}
        </div>
      )}
    </div>
  );
}
