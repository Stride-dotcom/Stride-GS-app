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
  ArrowRight, Wrench, Box, Plus, Trash2, CreditCard, BookOpen, Search,
} from 'lucide-react';
import { AutocompleteSelect } from './AutocompleteSelect';
import { theme } from '../../styles/theme';
import { WriteButton } from './WriteButton';
import { useAuth } from '../../contexts/AuthContext';
import { useClients } from '../../hooks/useClients';
import { useInventory } from '../../hooks/useInventory';
import {
  fetchDeliveryZone,
  fetchDeliveryAccessorials,
  fetchItemClassMinutes,
  type DeliveryZone,
  type DeliveryAccessorial,
} from '../../lib/supabaseQueries';
import { supabase } from '../../lib/supabase';

// ── Address Book helpers ─────────────────────────────────────────────────
interface AddressBookContact {
  id: string;
  tenant_id: string;
  contact_name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  updated_at: string;
}

async function fetchAddressBookContacts(tenantId: string): Promise<AddressBookContact[]> {
  if (!tenantId) return [];
  const { data, error } = await supabase
    .from('dt_address_book')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('contact_name', { ascending: true });
  if (error || !data) return [];
  return data as AddressBookContact[];
}

async function upsertAddressBookContact(contact: {
  tenant_id: string;
  contact_name: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  phone2?: string;
  email?: string;
}): Promise<void> {
  if (!contact.tenant_id || !contact.contact_name.trim()) return;
  await supabase
    .from('dt_address_book')
    .upsert({
      tenant_id: contact.tenant_id,
      contact_name: contact.contact_name.trim(),
      address: contact.address?.trim() || null,
      city: contact.city?.trim() || null,
      state: contact.state?.trim() || null,
      zip: contact.zip?.trim() || null,
      phone: contact.phone?.trim() || null,
      phone2: contact.phone2?.trim() || null,
      email: contact.email?.trim() || null,
    }, { onConflict: 'tenant_id,contact_name,address' });
}

// Inventory class → cuFt volume. Matches StrideAPI.gs CLASS_CUFT lookup.
// Used to populate dt_order_items.cubic_feet so the DT push payload can carry
// total load volume per order.
const CLASS_CUBIC_FEET: Record<string, number> = {
  XS: 10, S: 25, M: 50, L: 75, XL: 110,
};
function classToCuFt(cls: string | undefined | null): number | null {
  if (!cls) return null;
  const key = String(cls).trim().toUpperCase();
  return CLASS_CUBIC_FEET[key] ?? null;
}
// Expanded description for DT push: "Vendor — Description (Sidemark · Room)"
// Falls back gracefully when optional bits aren't set.
function buildItemDescription(i: { description?: string; vendor?: string; sidemark?: string; room?: string; itemId?: string }): string {
  const parts: string[] = [];
  if (i.vendor) parts.push(i.vendor);
  if (i.description) parts.push(i.description);
  const tail: string[] = [];
  if (i.sidemark) tail.push(i.sidemark);
  if (i.room) tail.push(i.room);
  let base = parts.filter(Boolean).join(' — ');
  if (!base) base = i.description || i.itemId || '';
  if (tail.length) base += ` (${tail.join(' · ')})`;
  return base;
}

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
  itemClass?: string;
  room?: string;
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

// ── AddressFields sub-component ──────────────────────────────────────────
// Inline definition — used for both pickup and delivery contact sections.
// Includes address book autocomplete and browse functionality.
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
  addressBook: AddressBookContact[];
  onSelectContact: (c: AddressBookContact) => void;
  zoneInfo?: {
    loading: boolean;
    zone: DeliveryZone | null;
    mode: string;
    isCallForQuote: boolean;
    displayRate: number | null;
  } | null;
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
  addressBook,
  onSelectContact,
  zoneInfo,
}: AddressFieldsProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showBrowse, setShowBrowse] = useState(false);
  const [browseSearch, setBrowseSearch] = useState('');

  // Filter suggestions as user types
  const suggestions = useMemo(() => {
    if (!contactName.trim() || contactName.length < 2) return [];
    const q = contactName.toLowerCase();
    return addressBook.filter(c =>
      c.contact_name.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [contactName, addressBook]);

  // Filter for browse modal
  const browseFiltered = useMemo(() => {
    if (!browseSearch.trim()) return addressBook;
    const q = browseSearch.toLowerCase();
    return addressBook.filter(c =>
      c.contact_name.toLowerCase().includes(q)
      || (c.address || '').toLowerCase().includes(q)
      || (c.city || '').toLowerCase().includes(q)
      || (c.phone || '').toLowerCase().includes(q)
      || (c.email || '').toLowerCase().includes(q)
    );
  }, [browseSearch, addressBook]);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {/* Contact name with autocomplete */}
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <label style={{ ...label, marginBottom: 0 }}>{contactLabel}</label>
          {addressBook.length > 0 && (
            <button
              type="button"
              onClick={() => setShowBrowse(true)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 10, fontWeight: 600, color: theme.colors.primary,
                display: 'flex', alignItems: 'center', gap: 3,
              }}
            >
              <BookOpen size={10} /> Address Book
            </button>
          )}
        </div>
        <input
          style={input}
          value={contactName}
          onChange={e => { setContactName(e.target.value); setShowSuggestions(true); }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          placeholder="Full name"
        />
        {/* Autocomplete dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
            background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: 200, overflowY: 'auto',
            marginTop: 2,
          }}>
            {suggestions.map(c => (
              <div
                key={c.id}
                onMouseDown={() => { onSelectContact(c); setShowSuggestions(false); }}
                style={{
                  padding: '8px 12px', cursor: 'pointer', fontSize: 12,
                  borderBottom: `1px solid ${theme.colors.border}`,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#FFF7ED')}
                onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
              >
                <div style={{ fontWeight: 600, color: theme.colors.text }}>{c.contact_name}</div>
                <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 1 }}>
                  {[c.address, c.city, c.state, c.zip].filter(Boolean).join(', ')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Browse Address Book modal */}
      {showBrowse && (
        <>
          <div onClick={() => setShowBrowse(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 300 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            width: 520, maxHeight: '70vh', background: '#fff', borderRadius: 12,
            boxShadow: '0 16px 48px rgba(0,0,0,0.25)', zIndex: 301,
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            <div style={{
              padding: '12px 16px', borderBottom: `1px solid ${theme.colors.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 700 }}>
                <BookOpen size={14} color={theme.colors.primary} /> Address Book
              </div>
              <button onClick={() => setShowBrowse(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ padding: '10px 16px', borderBottom: `1px solid ${theme.colors.border}` }}>
              <div style={{ position: 'relative' }}>
                <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: theme.colors.textMuted }} />
                <input
                  style={{ ...input, paddingLeft: 30 }}
                  placeholder="Search contacts…"
                  value={browseSearch}
                  onChange={e => setBrowseSearch(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {browseFiltered.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: theme.colors.textMuted }}>
                  {addressBook.length === 0 ? 'No saved contacts yet' : 'No matches'}
                </div>
              ) : (
                browseFiltered.map(c => (
                  <div
                    key={c.id}
                    onClick={() => { onSelectContact(c); setShowBrowse(false); }}
                    style={{
                      padding: '10px 16px', cursor: 'pointer',
                      borderBottom: `1px solid ${theme.colors.border}`,
                      fontSize: 12,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#FFF7ED')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                  >
                    <div style={{ fontWeight: 600, color: theme.colors.text }}>{c.contact_name}</div>
                    <div style={{ color: theme.colors.textMuted, marginTop: 2 }}>
                      {[c.address, c.city, c.state, c.zip].filter(Boolean).join(', ')}
                    </div>
                    {(c.phone || c.email) && (
                      <div style={{ color: theme.colors.textMuted, marginTop: 1, fontSize: 11 }}>
                        {[c.phone, c.email].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

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
          <input style={input} value={state} onChange={e => setState(e.target.value)} maxLength={2} placeholder="WA" />
        </div>
        <div>
          <label style={label}>Zip</label>
          <input style={input} value={zip} onChange={e => setZip(e.target.value)} maxLength={5} placeholder="00000" />
          {zoneInfo && (
            <div style={{ fontSize: 10, marginTop: 4, color: theme.colors.textMuted }}>
              {zoneInfo.loading ? 'Looking up zone…' :
                zoneInfo.zone ? (
                  zoneInfo.isCallForQuote
                    ? `Zone ${zoneInfo.zone.zone} — CALL FOR QUOTE`
                    : `Zone ${zoneInfo.zone.zone} — ${zoneInfo.mode} $${(zoneInfo.displayRate ?? 0).toFixed(2)}`
                ) : 'Zip not in service area'}
            </div>
          )}
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

// ── Main Component ──────────────────────────────────────────────────────
export function CreateDeliveryOrderModal({
  onClose,
  onSubmit,
  preSelectedItemIds = [],
  liveItems: liveItemsProp = [],
}: Props) {
  const { user } = useAuth();
  const isStaff = user?.role === 'staff' || user?.role === 'admin';

  // If no liveItems were passed (modal opened from Orders page, not Inventory),
  // pull our own inventory. useInventory auto-scopes to accessible clients.
  const invHookResult = useInventory(liveItemsProp.length === 0);
  const liveItems: LiveItem[] = useMemo(() => {
    if (liveItemsProp.length > 0) return liveItemsProp;
    return invHookResult.items.map(i => ({
      itemId: i.itemId, clientName: i.clientName, clientId: i.clientId,
      vendor: i.vendor || '', description: i.description || '',
      location: i.location || '', sidemark: i.sidemark || '',
      status: i.status, qty: i.qty,
      itemClass: i.itemClass || '', room: i.room || '',
    }));
  }, [liveItemsProp, invHookResult.items]);
  const invLoading = liveItemsProp.length === 0 && invHookResult.loading;

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

  // ── Address Book ────────────────────────────────────────────────────────
  const [addressBook, setAddressBook] = useState<AddressBookContact[]>([]);
  useEffect(() => {
    if (clientSheetId) {
      fetchAddressBookContacts(clientSheetId).then(setAddressBook);
    } else {
      setAddressBook([]);
    }
  }, [clientSheetId]);

  const fillPickupFromContact = (c: AddressBookContact) => {
    setPickupContactName(c.contact_name);
    setPickupAddress(c.address || '');
    setPickupCity(c.city || '');
    setPickupState(c.state || 'WA');
    setPickupZip(c.zip || '');
    setPickupPhone(c.phone || '');
    setPickupPhone2(c.phone2 || '');
    setPickupEmail(c.email || '');
  };

  const fillDeliveryFromContact = (c: AddressBookContact) => {
    setDeliveryContactName(c.contact_name);
    setDeliveryAddress(c.address || '');
    setDeliveryCity(c.city || '');
    setDeliveryState(c.state || 'WA');
    setDeliveryZip(c.zip || '');
    setDeliveryPhone(c.phone || '');
    setDeliveryPhone2(c.phone2 || '');
    setDeliveryEmail(c.email || '');
  };

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
  const [pickupPhone2, setPickupPhone2] = useState('');
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
  const [deliveryPhone2, setDeliveryPhone2] = useState('');
  const [deliveryEmail, setDeliveryEmail] = useState('');

  // ── Service-only description ───────────────────────────────────────────
  const [serviceDescription, setServiceDescription] = useState('');

  // ── Inventory item selection (delivery + warehouse-source only) ────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(preSelectedItemIds));
  const activeItems = useMemo(
    () => liveItems.filter(i => {
      if (i.status !== 'Active') return false;
      if (!clientName) return true;
      // Match by name OR by sheet ID (covers cases where clientName hasn't resolved yet)
      if (i.clientName === clientName) return true;
      if (clientSheetId && i.clientId === clientSheetId) return true;
      return false;
    }),
    [liveItems, clientName, clientSheetId]
  );
  const [itemSearch, setItemSearch] = useState('');
  const [itemSort, setItemSort] = useState<{ col: string; desc: boolean }>({ col: 'itemId', desc: false });
  const filteredItems = useMemo(() => {
    let list = activeItems;
    if (itemSearch) {
      const q = itemSearch.toLowerCase();
      list = list.filter(
        i => i.itemId.toLowerCase().includes(q)
          || (i.description || '').toLowerCase().includes(q)
          || (i.vendor || '').toLowerCase().includes(q)
          || (i.sidemark || '').toLowerCase().includes(q)
          || (i.location || '').toLowerCase().includes(q)
          || (i.itemClass || '').toLowerCase().includes(q)
      );
    }
    const sorted = [...list].sort((a, b) => {
      const av = String((a as any)[itemSort.col] ?? '').toLowerCase();
      const bv = String((b as any)[itemSort.col] ?? '').toLowerCase();
      const cmp = av.localeCompare(bv, undefined, { numeric: true });
      return itemSort.desc ? -cmp : cmp;
    });
    return sorted;
  }, [activeItems, itemSearch, itemSort]);
  const selectedInvItems = useMemo(
    () => liveItems.filter(i => selectedIds.has(i.itemId)),
    [liveItems, selectedIds]
  );
  const toggleItemSort = (col: string) => {
    setItemSort(prev => prev.col === col ? { col, desc: !prev.desc } : { col, desc: false });
  };

  const toggleItem = (id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  // Total cuFt for visible selection — helps the user see total load volume.
  const totalSelectedCuFt = useMemo(
    () => selectedInvItems.reduce((s, i) => s + (classToCuFt(i.itemClass) ?? 0) * (Number(i.qty) || 1), 0),
    [selectedInvItems]
  );

  // ── Billing ────────────────────────────────────────────────────────────
  type BillingMethod = 'bill_to_client' | 'customer_collect';
  const [billingMethod, setBillingMethod] = useState<BillingMethod>('bill_to_client');

  // ── Reference fields ───────────────────────────────────────────────────
  const [poNumber, setPoNumber] = useState('');
  const [sidemark, setSidemark] = useState('');
  const [details, setDetails] = useState('');

  // ── Pricing inputs ─────────────────────────────────────────────────────
  // deliveryZone: zone for the DELIVERY zip (delivery / P+D / service_only)
  // pickupZone:   zone for the PICKUP zip — only used by pickup + P+D modes
  const [zone, setZone] = useState<DeliveryZone | null>(null);
  const [zoneLoading, setZoneLoading] = useState(false);
  const [pickupZone, setPickupZone] = useState<DeliveryZone | null>(null);
  const [pickupZoneLoading, setPickupZoneLoading] = useState(false);

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

  // For P+D: also look up the PICKUP zip so we can charge the pickup leg fee
  useEffect(() => {
    if (mode !== 'pickup_and_delivery') { setPickupZone(null); return; }
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
  }, [mode, pickupZip]);

  // ── Accessorials (role-filtered) ───────────────────────────────────────
  const [accessorials, setAccessorials] = useState<DeliveryAccessorial[]>([]);
  const [allAccessorials, setAllAccessorials] = useState<DeliveryAccessorial[]>([]);
  const [selectedAccessorials, setSelectedAccessorials] = useState<Map<string, SelectedAccessorial>>(new Map());

  useEffect(() => {
    fetchDeliveryAccessorials().then(data => {
      if (!data) return;
      const base = data.filter(a => a.code !== 'EXTRA_ITEM'); // auto-computed
      setAllAccessorials(base); // admin can add any
      const filtered = base
        .filter(a => a.availableForDelivery)             // delivery dropdown gate
        .filter(a => isStaff || a.visibleToClient);      // role gate
      setAccessorials(filtered);
    });
  }, [isStaff]);

  // ── Item class service time defaults ──────────────────────────────────
  const [classMinutesMap, setClassMinutesMap] = useState<Record<string, number>>({});
  useEffect(() => { fetchItemClassMinutes().then(setClassMinutesMap); }, []);

  const toggleAccessorial = (acc: DeliveryAccessorial, quantity: number = 1, forceRemove?: boolean) => {
    setSelectedAccessorials(prev => {
      const n = new Map(prev);
      if (forceRemove || (n.has(acc.code) && quantity <= 0)) {
        n.delete(acc.code);
      } else if (acc.quoteRequired) {
        // Quote-required accessorials: $0 subtotal, added for tracking
        n.set(acc.code, { code: acc.code, quantity, subtotal: 0 });
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
  // baseFee: delivery rate for delivery/P+D; pickup rate for pickup-only.
  const baseFee = useMemo(() => {
    if (!zone) return null;
    if (mode === 'pickup') return zone.pickupRate;
    return zone.baseRate;   // delivery or P+D delivery leg
  }, [zone, mode]);

  // pickupLegFee: for P+D, also charge the pickup-zone pickup rate.
  // This is the separate pickup trip fee on top of the delivery fee.
  const pickupLegFee = useMemo(() => {
    if (mode !== 'pickup_and_delivery') return 0;
    if (!pickupZone) return 0;
    return pickupZone.pickupRate ?? 0;
  }, [mode, pickupZone]);

  const isPickupCallForQuote = mode === 'pickup_and_delivery' && pickupZip.length === 5 && pickupZone && pickupZone.pickupRate == null;

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

  const orderTotal = useMemo(() => {
    if (baseFee == null) return null;
    return baseFee + pickupLegFee + extraItemsFee + accessorialsTotal;
  }, [baseFee, pickupLegFee, extraItemsFee, accessorialsTotal]);

  const isCallForQuote = zipForPricing.length === 5 && zone && zone.baseRate == null;

  // ── Service time calculation ──────────────────────────────────────────
  const [serviceTimeOverride, setServiceTimeOverride] = useState<number | null>(null);

  // Auto-calc service time: sum item class minutes + accessorial service minutes
  const calculatedServiceTime = useMemo(() => {
    let total = 0;
    // Item class minutes
    if (mode === 'delivery' && itemsSource === 'warehouse') {
      for (const item of selectedInvItems) {
        const cls = item.itemClass?.toUpperCase() || '';
        const qty = Number(item.qty) || 1;
        total += (classMinutesMap[cls] || 0) * qty;
      }
    } else if (mode !== 'service_only') {
      // Pickup / free-text items — use Medium (10 min) as fallback per item
      for (const item of pickupFreeItems) {
        if (!item.description.trim()) continue;
        const qty = Math.max(1, Number(item.quantity) || 1);
        total += (classMinutesMap['M'] || 10) * qty;
      }
    }
    // Accessorial service minutes
    for (const [code, sel] of selectedAccessorials) {
      const acc = accessorials.find(a => a.code === code) || allAccessorials.find(a => a.code === code);
      if (acc && !acc.quoteRequired) {
        total += acc.serviceMinutes * sel.quantity;
      }
    }
    return total;
  }, [mode, itemsSource, selectedInvItems, pickupFreeItems, selectedAccessorials, classMinutesMap, accessorials, allAccessorials]);

  const effectiveServiceTime = serviceTimeOverride ?? calculatedServiceTime;

  // Total volume (cubic feet)
  const totalVolume = useMemo(() => {
    if (mode === 'delivery' && itemsSource === 'warehouse') {
      return selectedInvItems.reduce((sum, i) => {
        const cuFt = classToCuFt(i.itemClass);
        const qty = Number(i.qty) || 1;
        return sum + (cuFt != null ? cuFt * qty : 0);
      }, 0);
    }
    return 0;
  }, [mode, itemsSource, selectedInvItems]);

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

  // ── Order number generation ────────────────────────────────────────────
  // Format: PREFIX-00001-ClientReference  (with -P/-D suffixes for P+D)
  // PREFIX = first 3 uppercase chars of client name
  // 00001  = global auto-increment from dt_order_number_seq
  // ClientReference = the PO/Reference field value (spaces → dashes)
  const generateOrderNumber = async (suffix?: string): Promise<string> => {
    // Get prefix from client name (first 3 chars uppercase, fallback STR)
    const prefix = clientName
      ? clientName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'STR'
      : 'STR';

    // Get next sequence number from Supabase
    let seqNum = '00001';
    try {
      const { data, error } = await supabase.rpc('next_order_number');
      if (!error && data) {
        seqNum = data; // already zero-padded from the DB function
      }
    } catch {
      // Fallback: timestamp-based if RPC fails
      const now = new Date();
      seqNum = String(now.getTime()).slice(-5);
    }

    // Build reference portion from PO Number (no spaces)
    const ref = poNumber.trim().replace(/\s+/g, '-');

    let orderNum = ref ? `${prefix}-${seqNum}-${ref}` : `${prefix}-${seqNum}`;
    if (suffix) orderNum += `-${suffix}`;
    return orderNum;
  };

  // ── Submit ─────────────────────────────────────────────────────────────
  const [, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<{ dtIdentifier: string; linkedIdentifier?: string } | null>(null);

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
      order_notes: details.trim() || null,
      source: 'app',
      review_status: user?.role === 'admin' ? 'approved' : 'pending_review',
      created_by_user: authUid,
      created_by_role: user?.role || 'client',
      billing_method: billingMethod,
      service_time_minutes: effectiveServiceTime || null,
      // status_id intentionally omitted — app-created orders have no DT status
      // until they are approved and pushed to DT via the dt-push-order Edge Function.
    };
    const isAdminAutoApprove = user?.role === 'admin';

    try {
      if (mode === 'pickup_and_delivery') {
        // Two linked orders — create BOTH in a single flow.
        // Generate order numbers before inserts
        const pickupIdent = await generateOrderNumber('P');
        const deliveryIdent = await generateOrderNumber('D');

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
            contact_phone2: pickupPhone2.trim() || null,
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
        const pdPricingNotes = [
          pickupLegFee > 0
            ? `Pickup fee (${pickupZip} Zone ${pickupZone?.zone}): $${pickupLegFee.toFixed(2)}`
            : isPickupCallForQuote
              ? `Pickup zip ${pickupZip} is CALL FOR QUOTE — pickup fee requires manual review.`
              : pickupZip.length === 5 && !pickupZone
                ? `Pickup zip ${pickupZip} not in service area — pickup fee requires manual review.`
                : null,
          isCallForQuote ? 'Delivery zone marked CALL FOR QUOTE — delivery fee requires manual review.' : null,
        ].filter(Boolean).join(' | ') || null;

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
            contact_phone2: deliveryPhone2.trim() || null,
            contact_email: deliveryEmail.trim() || null,
            linked_order_id: pickupRow.id,
            // Pricing goes on the delivery leg (user-facing total)
            // baseFee = delivery zone base rate; pickupLegFee = pickup zone pickup rate
            base_delivery_fee: baseFee != null ? baseFee + pickupLegFee : null,
            extra_items_count: extraItemsCount,
            extra_items_fee: extraItemsFee,
            accessorials_json: accList,
            accessorials_total: accessorialsTotal,
            order_total: orderTotal,
            pricing_override: !!(isCallForQuote || isPickupCallForQuote),
            pricing_notes: pdPricingNotes,
          })
          .select('id, dt_identifier')
          .single();
        if (dErr || !deliveryRow) throw new Error(`Delivery order insert failed: ${dErr?.message}`);

        // 3) Backlink pickup → delivery for bidirectional navigation
        await supabase.from('dt_orders')
          .update({ linked_order_id: deliveryRow.id })
          .eq('id', pickupRow.id);

        // 4) Insert items. Free-text items go on BOTH orders.
        //    Pickup leg: prefix "PU: " + qty -1 (items inbound to warehouse).
        //    Delivery leg: normal description + qty as entered.
        const pickupItemRows = pickupFreeItems
          .filter(i => i.description.trim())
          .flatMap(i => {
            const qty = Math.max(1, Number(i.quantity) || 1);
            return [
              {
                dt_order_id: pickupRow.id,
                dt_item_code: null,
                description: `PU: ${i.description.trim()}`,
                quantity: -qty,
                original_quantity: -qty,
                extras: { source: 'pickup_free_text' },
              },
              {
                dt_order_id: deliveryRow.id,
                dt_item_code: null,
                description: i.description.trim(),
                quantity: qty,
                original_quantity: qty,
                extras: { source: 'pickup_free_text', linked_to_pickup: pickupRow.id },
              },
            ];
          });
        if (pickupItemRows.length > 0) {
          const { error: iErr } = await supabase.from('dt_order_items').insert(pickupItemRows);
          if (iErr) throw new Error(`Items insert failed: ${iErr.message}`);
        }

        setCreateResult({ dtIdentifier: deliveryRow.dt_identifier, linkedIdentifier: pickupRow.dt_identifier });
        onSubmit?.({
          dtOrderId: deliveryRow.id,
          dtIdentifier: deliveryRow.dt_identifier,
          reviewStatus: isAdminAutoApprove ? 'approved' : 'pending_review',
        });
        // Admin auto-push to DT — best-effort, order stays "approved" for retry if push fails
        if (isAdminAutoApprove) {
          supabase.functions.invoke('dt-push-order', {
            body: { orderId: deliveryRow.id },
          }).catch((err) => { console.warn('[delivery] Admin auto-push failed (non-fatal):', err); });
        }
        // Auto-save contacts to address book — best-effort
        upsertAddressBookContact({
          tenant_id: clientSheetId, contact_name: pickupContactName,
          address: pickupAddress, city: pickupCity, state: pickupState, zip: pickupZip,
          phone: pickupPhone, phone2: pickupPhone2, email: pickupEmail,
        }).catch(() => {});
        upsertAddressBookContact({
          tenant_id: clientSheetId, contact_name: deliveryContactName,
          address: deliveryAddress, city: deliveryCity, state: deliveryState, zip: deliveryZip,
          phone: deliveryPhone, phone2: deliveryPhone2, email: deliveryEmail,
        }).catch(() => {});
        // Notify staff — best-effort, never block submit success
        supabase.functions.invoke('notify-new-order', {
          body: { orderId: deliveryRow.id, submittedBy: user?.email ?? 'Unknown' },
        }).catch(() => { /* notification failure is non-fatal */ });
      } else {
        // Single-order path (delivery / pickup / service_only)
        const dtIdentifier = await generateOrderNumber();
        const isPickup = mode === 'pickup';
        const isServiceOnly = mode === 'service_only';

        const contactName = isPickup ? pickupContactName : deliveryContactName;
        const contactAddress = isPickup ? pickupAddress : deliveryAddress;
        const contactCity = isPickup ? pickupCity : deliveryCity;
        const contactState = isPickup ? pickupState : deliveryState;
        const contactZip = isPickup ? pickupZip : deliveryZip;
        const contactPhone = isPickup ? pickupPhone : deliveryPhone;
        const contactPhone2 = isPickup ? pickupPhone2 : deliveryPhone2;
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
            contact_phone2: contactPhone2.trim() || null,
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
          const itemRows = selectedInvItems.map(i => {
            const cuFt = classToCuFt(i.itemClass);
            const qty = Number(i.qty) || 1;
            return {
              dt_order_id: orderRow.id,
              dt_item_code: i.itemId,
              description: buildItemDescription({
                description: i.description, vendor: i.vendor,
                sidemark: i.sidemark, room: i.room, itemId: i.itemId,
              }),
              quantity: qty,
              original_quantity: qty,
              cubic_feet: cuFt != null ? cuFt * qty : null,
              class_name: i.itemClass || null,
              vendor: i.vendor || null,
              room: i.room || null,
              extras: {
                vendor: i.vendor || null,
                sidemark: i.sidemark || null,
                location: i.location || null,
                room: i.room || null,
                className: i.itemClass || null,
                source: 'inventory',
              },
            };
          });
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

        // Write delivery audit log entries for warehouse inventory items — best-effort
        if (mode === 'delivery' && itemsSource === 'warehouse' && selectedInvItems.length > 0) {
          const auditRows = selectedInvItems.map(i => ({
            entity_type: 'inventory',
            entity_id: i.itemId,
            tenant_id: clientSheetId,
            action: 'delivery_order_created',
            changes: {
              dt_order_id: orderRow.id,
              dt_identifier: orderRow.dt_identifier,
              contact_name: contactName.trim(),
              service_date: serviceDate,
              order_type: mode,
            },
            performed_by: user?.email || 'unknown',
            source: 'app',
          }));
          supabase.from('entity_audit_log').insert(auditRows).then(({ error: aErr }) => {
            if (aErr) console.warn('[delivery] Audit log insert failed (non-fatal):', aErr.message);
          });
        }

        setCreateResult({ dtIdentifier: orderRow.dt_identifier });
        onSubmit?.({
          dtOrderId: orderRow.id,
          dtIdentifier: orderRow.dt_identifier,
          reviewStatus: isAdminAutoApprove ? 'approved' : 'pending_review',
        });
        // Admin auto-push to DT — best-effort, order stays "approved" for retry if push fails
        if (isAdminAutoApprove) {
          supabase.functions.invoke('dt-push-order', {
            body: { orderId: orderRow.id },
          }).catch((err) => { console.warn('[delivery] Admin auto-push failed (non-fatal):', err); });
        }
        // Auto-save contact to address book — best-effort
        if (contactName.trim()) {
          upsertAddressBookContact({
            tenant_id: clientSheetId, contact_name: contactName,
            address: contactAddress, city: contactCity, state: contactState, zip: contactZip,
            phone: contactPhone, phone2: contactPhone2, email: contactEmail,
          }).catch(() => {});
        }
        // Notify staff — best-effort, never block submit success
        supabase.functions.invoke('notify-new-order', {
          body: { orderId: orderRow.id, submittedBy: user?.email ?? 'Unknown' },
        }).catch(() => { /* notification failure is non-fatal */ });
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

  // ── Time window options (9am–5pm, 30-min increments) ─────────────────
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

          {/* Stax payment — only when billing method is Customer Collect */}
          {billingMethod === 'customer_collect' && (
            <div style={{
              background: '#FFFBF5', border: '1px solid #FED7AA',
              borderRadius: 8, padding: 14, marginBottom: 16, textAlign: 'left',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <CreditCard size={14} color="#B45309" />
                <span style={{ fontSize: 12, fontWeight: 600, color: '#92400E' }}>Customer Collect — Payment Due</span>
              </div>
              {orderTotal != null && (
                <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>
                  ${orderTotal.toFixed(2)}
                </div>
              )}
              <button
                onClick={() => {
                  const orderNum = createResult.dtIdentifier || '';
                  const params = new URLSearchParams();
                  if (orderNum) {
                    params.set('order', orderNum);
                    params.set('notes', `Delivery ${orderNum}`);
                  }
                  if (orderTotal != null) params.set('amount', orderTotal.toFixed(2));
                  window.open(`/stax-payment.html?${params.toString()}`, '_blank');
                }}
                style={{
                  width: '100%', padding: '10px 16px', borderRadius: 8,
                  border: 'none', background: theme.colors.orange, color: '#fff',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                <CreditCard size={14} /> Collect via Stax
              </button>
              <div style={{ fontSize: 10, color: '#92400E', marginTop: 6 }}>
                Opens Stax payment page in new tab. Customer pays directly; staff can mark paid from the order detail panel.
              </div>
            </div>
          )}

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
        width: 1100, maxWidth: '96vw', maxHeight: '94vh',
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

          {/* Bill To — moved to step 2 right after Client */}
          {mode !== 'service_only' && (
            <div style={section}>
              <div style={sectionTitle}>Bill To</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {([
                  { value: 'bill_to_client' as BillingMethod, label: 'Bill to Client Account' },
                  { value: 'customer_collect' as BillingMethod, label: 'Customer Collect' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setBillingMethod(opt.value)}
                    type="button"
                    style={{
                      padding: '12px 14px', borderRadius: 10,
                      border: billingMethod === opt.value ? `2px solid ${theme.colors.primary}` : `1px solid ${theme.colors.border}`,
                      background: billingMethod === opt.value ? '#FFF7ED' : '#fff',
                      cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, color: billingMethod === opt.value ? theme.colors.primary : theme.colors.text }}>
                      {opt.label}
                    </div>
                  </button>
                ))}
              </div>
              {billingMethod === 'customer_collect' && (
                <div style={{ marginTop: 8, padding: '8px 12px', background: '#FFFBF5', border: '1px solid #FED7AA', borderRadius: 8, fontSize: 11, color: '#92400E' }}>
                  Customer Collect selected — a <strong>Collect via Stax</strong> button will appear after submit and on the order detail panel so staff can run the charge.
                </div>
              )}
            </div>
          )}

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
                  <div style={{ fontSize: 13, fontWeight: 700 }}>Stride Warehouse</div>
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
                  <div style={{ fontSize: 13, fontWeight: 700 }}>Requires Pickup</div>
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
                phone2={pickupPhone2}               setPhone2={setPickupPhone2}
                email={pickupEmail}                 setEmail={setPickupEmail}
                input={input} label={label}
                contactLabel="Contact at pickup"
                addressBook={addressBook}
                onSelectContact={fillPickupFromContact}
                zoneInfo={pickupZip.length === 5 ? {
                  loading: mode === 'pickup_and_delivery' ? pickupZoneLoading : zoneLoading,
                  zone: mode === 'pickup_and_delivery' ? pickupZone : zone,
                  mode: 'Pickup',
                  isCallForQuote: !!(mode === 'pickup_and_delivery' ? isPickupCallForQuote : isCallForQuote),
                  displayRate: mode === 'pickup_and_delivery' ? (pickupZone?.pickupRate ?? null) : (zone?.pickupRate ?? null),
                } : null}
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
                phone2={deliveryPhone2}               setPhone2={setDeliveryPhone2}
                email={deliveryEmail}                 setEmail={setDeliveryEmail}
                input={input} label={label}
                contactLabel={mode === 'service_only' ? 'On-site contact' : 'Recipient'}
                addressBook={addressBook}
                onSelectContact={fillDeliveryFromContact}
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
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    <div style={label}>Items (from inventory, {selectedInvItems.length} selected{totalSelectedCuFt > 0 ? ` · ${totalSelectedCuFt} cuFt` : ''})</div>
                    {invLoading && (
                      <span style={{ fontSize: 11, color: theme.colors.textMuted, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Loader2 size={12} className="spin" /> Loading inventory…
                      </span>
                    )}
                  </div>
                  <input
                    style={{ ...input, marginBottom: 10 }}
                    placeholder="Search by item ID, description, vendor, class, sidemark, location…"
                    value={itemSearch}
                    onChange={e => setItemSearch(e.target.value)}
                  />
                  <div style={{
                    maxHeight: 320, overflowY: 'auto', overflowX: 'auto',
                    border: `1px solid ${theme.colors.border}`, borderRadius: 8,
                  }}>
                    {/* Column headers */}
                    <div style={{
                      display: 'grid', gridTemplateColumns: '28px 100px 50px 110px 1fr 100px 100px',
                      padding: '8px 12px', background: '#F5F2EE', position: 'sticky', top: 0, zIndex: 1,
                      borderBottom: `1px solid ${theme.colors.border}`,
                      fontSize: 10, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '1px',
                      alignItems: 'center', gap: 4,
                    }}>
                      <span />
                      {[
                        { col: 'itemId', label: 'ID' },
                        { col: 'qty', label: 'Qty' },
                        { col: 'vendor', label: 'Vendor' },
                        { col: 'description', label: 'Description' },
                        { col: 'sidemark', label: 'Sidemark' },
                        { col: 'reference', label: 'Reference' },
                      ].map(c => (
                        <span
                          key={c.col}
                          onClick={() => toggleItemSort(c.col)}
                          style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                        >
                          {c.label}{itemSort.col === c.col ? (itemSort.desc ? ' ↓' : ' ↑') : ''}
                        </span>
                      ))}
                    </div>
                    {filteredItems.length === 0 ? (
                      <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: theme.colors.textMuted }}>
                        {clientName ? (invLoading ? 'Loading inventory…' : 'No active items for this client') : 'Select a client to see items'}
                      </div>
                    ) : (
                      filteredItems.map((item, idx) => {
                        const checked = selectedIds.has(item.itemId);
                        return (
                          <div
                            key={item.itemId}
                            onClick={() => toggleItem(item.itemId)}
                            style={{
                              display: 'grid', gridTemplateColumns: '28px 100px 50px 110px 1fr 100px 100px',
                              padding: '8px 12px', cursor: 'pointer', alignItems: 'center', gap: 4,
                              background: checked ? '#FFF7ED' : idx % 2 === 0 ? '#fff' : '#fafafa',
                              borderBottom: `1px solid ${theme.colors.borderLight || '#f0f0f0'}`,
                              fontSize: 12,
                            }}
                          >
                            <div style={{
                              width: 16, height: 16, borderRadius: 3,
                              border: `2px solid ${checked ? theme.colors.primary : theme.colors.border}`,
                              background: checked ? theme.colors.primary : '#fff',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                            }}>
                              {checked && <Check size={10} color="#fff" />}
                            </div>
                            <span style={{ fontFamily: 'monospace', fontWeight: 600, color: theme.colors.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {item.itemId}
                            </span>
                            <span style={{ whiteSpace: 'nowrap', color: theme.colors.textMuted }}>
                              {item.qty ?? 1}
                            </span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: theme.colors.textMuted }}>
                              {item.vendor || '—'}
                            </span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: theme.colors.text }}>
                              {item.description || '—'}
                            </span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: theme.colors.textMuted }}>
                              {item.sidemark || '—'}
                            </span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: theme.colors.textMuted }}>
                              {(item as any).reference || '—'}
                            </span>
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
                          onChange={() => selected ? toggleAccessorial(acc, 1, true) : toggleAccessorial(acc, needsQuantity ? 1 : 1)}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                            {acc.name}
                            {staffOnly && (
                              <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: '#E0E7FF', color: '#3730A3', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                Staff
                              </span>
                            )}
                            {acc.quoteRequired ? (
                              <span style={{ color: '#B45309', fontWeight: 600, fontStyle: 'italic', marginLeft: 'auto', fontSize: 12 }}>
                                Quote Required
                              </span>
                            ) : acc.rate != null ? (
                              <span style={{ color: theme.colors.textMuted, fontWeight: 400, marginLeft: 'auto' }}>
                                ${acc.rate.toFixed(2)}
                                {acc.rateUnit === 'per_mile' && ' / mile'}
                                {acc.rateUnit === 'per_15min' && ' / 15 min'}
                                {acc.rateUnit === 'per_item' && ' / item'}
                                {acc.rateUnit === 'plus_base' && ' + base'}
                              </span>
                            ) : null}
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
                  <label style={label}>PO / Reference Number</label>
                  <input style={input} value={poNumber} onChange={e => setPoNumber(e.target.value)} placeholder="Client reference (becomes part of order number)" />
                </div>
                <div>
                  <label style={label}>Sidemark</label>
                  <input style={input} value={sidemark} onChange={e => setSidemark(e.target.value)} />
                </div>
              </div>
              <label style={label}>
                Notes / Special Instructions
                {mode === 'pickup_and_delivery' && (
                  <span style={{ fontWeight: 400, textTransform: 'none', color: theme.colors.textMuted, marginLeft: 6, fontSize: 10 }}>
                    (appear on both pickup and delivery orders)
                  </span>
                )}
              </label>
              <textarea
                style={{ ...input, minHeight: 60, resize: 'vertical' }}
                value={details}
                onChange={e => setDetails(e.target.value)}
                placeholder={mode === 'pickup_and_delivery'
                  ? 'Instructions that apply to both the pickup and delivery (gate codes, elevator, fragile items, etc.)'
                  : 'Delivery instructions, gate codes, elevator notes, etc.'}
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
                Estimated Pricing Summary
              </div>
              {mode === 'pickup_and_delivery' ? (
                <>
                  {baseFee != null && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                      <span>Delivery Fee{zone ? ` (Zone ${zone.zone})` : ''}</span>
                      <span style={{ fontWeight: 500 }}>${baseFee.toFixed(2)}</span>
                    </div>
                  )}
                  {pickupLegFee > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                      <span>Pickup Fee{pickupZone ? ` (Zone ${pickupZone.zone})` : ''}</span>
                      <span style={{ fontWeight: 500 }}>${pickupLegFee.toFixed(2)}</span>
                    </div>
                  )}
                  {isPickupCallForQuote && (
                    <div style={{ fontSize: 12, color: '#B45309', marginBottom: 4, fontStyle: 'italic' }}>
                      Pickup zip is CALL FOR QUOTE — pickup fee TBD during review
                    </div>
                  )}
                  {pickupZip.length === 5 && !pickupZone && !pickupZoneLoading && !isPickupCallForQuote && (
                    <div style={{ fontSize: 12, color: '#B45309', marginBottom: 4, fontStyle: 'italic' }}>
                      Pickup zip not in service area — pickup fee TBD during review
                    </div>
                  )}
                </>
              ) : (
                baseFee != null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                    <span>{mode === 'pickup' ? 'Base Pickup Fee' : 'Base Delivery Fee'}</span>
                    <span style={{ fontWeight: 500 }}>${baseFee.toFixed(2)}</span>
                  </div>
                )
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
                <span>Estimated Total</span>
                <span>{orderTotal != null ? `$${orderTotal.toFixed(2)}` : isCallForQuote ? 'Call for quote' : '—'}</span>
              </div>
              <div style={{ fontSize: 10, color: theme.colors.textMuted, marginTop: 6, fontStyle: 'italic' }}>
                Rates shown are estimates. Final pricing will be confirmed by Stride staff during review.
              </div>
            </div>
          )}

          {/* ── Order Summary ───────────────────────────────────────────── */}
          {mode !== 'service_only' && (
            <div style={{
              padding: 14, background: '#FFF7ED', borderRadius: 10,
              border: `1px solid ${theme.colors.orangeLight || '#FED7AA'}`,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: theme.colors.orange, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Order Summary
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                  <span style={{ fontWeight: 600 }}>Pieces:</span> {itemCount}
                </div>
                <div style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                  <span style={{ fontWeight: 600 }}>Volume:</span> {totalVolume > 0 ? `${totalVolume} cu ft` : '—'}
                </div>
                <div style={{ fontSize: 12, color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontWeight: 600 }}>Service Time:</span>
                  {isStaff ? (
                    <input
                      type="number"
                      min={0}
                      value={serviceTimeOverride ?? calculatedServiceTime}
                      onChange={e => {
                        const v = e.target.value === '' ? null : parseInt(e.target.value, 10);
                        setServiceTimeOverride(v === calculatedServiceTime ? null : v);
                      }}
                      style={{
                        width: 50, padding: '2px 4px', fontSize: 12, border: `1px solid ${serviceTimeOverride != null ? theme.colors.orange : theme.colors.border}`,
                        borderRadius: 4, textAlign: 'center', background: serviceTimeOverride != null ? '#FFF7ED' : '#fff',
                      }}
                    />
                  ) : (
                    <span>{effectiveServiceTime}</span>
                  )}
                  <span style={{ fontSize: 11, color: theme.colors.textMuted }}>min</span>
                  {serviceTimeOverride != null && isStaff && (
                    <button onClick={() => setServiceTimeOverride(null)} style={{ fontSize: 10, color: theme.colors.orange, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>reset</button>
                  )}
                </div>
                <div style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                  <span style={{ fontWeight: 600 }}>Total:</span> {orderTotal != null ? `$${orderTotal.toFixed(2)}` : isCallForQuote ? 'Quote' : '—'}
                </div>
              </div>
              {Array.from(selectedAccessorials.values()).some(a => {
                const acc = accessorials.find(x => x.code === a.code) || allAccessorials.find(x => x.code === a.code);
                return acc?.quoteRequired;
              }) && (
                <div style={{ fontSize: 11, color: '#B45309', marginTop: 8, fontStyle: 'italic' }}>
                  ⚠ One or more services marked "Quote Required" — service time and pricing will be finalized during review.
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
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, flexShrink: 0,
          background: '#FAFAFA',
        }}>
          <button
            onClick={onClose}
            type="button"
            style={{
              padding: '9px 20px', borderRadius: 8,
              border: `1px solid ${theme.colors.border}`,
              background: '#fff', color: theme.colors.text,
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <WriteButton
            onClick={handleSubmit}
            disabled={!canSubmit}
            label="Submit for Review"
            variant="primary"
            style={{
              padding: '9px 24px', borderRadius: 8,
              border: 'none',
              background: canSubmit ? theme.colors.primary : theme.colors.border,
              color: '#fff',
              fontSize: 13, fontWeight: 600, cursor: canSubmit ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
            }}
          />
        </div>
      </div>
    </>
  );
}
                                                                            