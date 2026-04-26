/**
 * CreateDeliveryOrderModal — Phase 2c (expanded) — v3 2026-04-25 PST
 *   v3: Valuation coverage + service_catalog rewire —
 *       • Required Valuation Coverage selector for delivery / pickup /
 *         pickup+delivery modes (NOT service-only). Sources from
 *         `coverage_options` via useCoverageOptions; defaults to Standard
 *         ($0 flat). FND/FWD (percent_declared) reveals a required
 *         declared-value input and rolls the resulting one-time charge
 *         (rate% × declared) into the order total. Persists
 *         coverage_option_id / declared_value / coverage_charge on every
 *         insert path including the linked P+D delivery leg.
 *       • Add-Ons list now reads from `service_catalog` filtered by
 *         show_as_delivery_service=true, instead of the legacy
 *         delivery_accessorials table. Catalog units (per_task /
 *         per_item / per_hour / per_day) are mapped to the existing
 *         accessorial rate-unit semantics so the rendering path is
 *         unchanged.
 *   v2: Code-review fixes —
 *       • H3 admin auto-push to DT is now AWAITED, with failures surfaced as
 *         a banner on the success screen instead of swallowed in a fire-and-
 *         forget .catch().
 *       • H4 P+D back-link update is now error-checked; a failure throws so
 *         the user knows to retry rather than shipping a half-linked pair.
 *       • H5 pickup-leg item rows now use POSITIVE quantities — the pickup
 *         vs delivery distinction is carried by the parent order_type, not
 *         by the sign of dt_order_items.quantity.
 *       • H6 generateOrderNumber now THROWS on RPC failure instead of
 *         falling back to a timestamp slice (which produced collision-prone,
 *         non-monotonic identifiers).
 *       • M9 dropped the duplicate `order_notes` write — dt_orders has a
 *         single `details` column for free-text notes, and there was no
 *         separate UI input feeding `order_notes`.
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
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Check, Loader2, CheckCircle2, MapPin, Truck,
  ArrowRight, Wrench, Box, Plus, Trash2, CreditCard, BookOpen, Search,
  ChevronDown, ChevronRight, AlertTriangle,
} from 'lucide-react';
import { AutocompleteSelect } from './AutocompleteSelect';
import { theme } from '../../styles/theme';
import { WriteButton } from './WriteButton';
import { useAuth } from '../../contexts/AuthContext';
import { useClients } from '../../hooks/useClients';
import { useInventory } from '../../hooks/useInventory';
import {
  fetchDeliveryZone,
  fetchDeliveryServicesFromCatalog,
  fetchItemClassMinutes,
  type DeliveryZone,
  type DeliveryAccessorial,
} from '../../lib/supabaseQueries';
import { supabase } from '../../lib/supabase';
import { useCoverageOptions, type CoverageOption } from '../../hooks/useCoverageOptions';
import { ProcessingOverlay } from './ProcessingOverlay';

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
  /** When set, the modal opens in edit-an-existing-order mode. Loads
   *  the dt_orders row + its dt_order_items, prefills every form
   *  field.
   *
   *  Behavior depends on the loaded row's review_status:
   *    • 'draft' → Save Draft updates in place; Submit for Review
   *      "promotes" the row (replaces DRAFT-xxx with a real generated
   *      order number, flips review_status to pending_review/approved).
   *    • anything else → Save Changes updates the row in place
   *      (identifier + review_status preserved). Save Draft is
   *      disabled (you can't downgrade a real order to a draft).
   */
  editOrderId?: string | null;
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
  editOrderId = null,
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
  // Collapse-toggle for the inventory list section. Defaults to expanded
  // when there are no selections yet (you need to see the list to pick),
  // collapsed once you've added items (you don't need the picker, you
  // need to see what you've added). Operator can flip either way.
  const [inventoryExpanded, setInventoryExpanded] = useState(true);
  // Auto-collapse the picker the first time selections appear so the
  // selected-items summary takes the focus. Doesn't fight subsequent
  // manual toggles.
  const collapsedAfterFirstSelection = React.useRef(false);
  useEffect(() => {
    if (selectedIds.size > 0 && !collapsedAfterFirstSelection.current) {
      setInventoryExpanded(false);
      collapsedAfterFirstSelection.current = true;
    }
  }, [selectedIds.size]);
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
  // Add-ons section collapsed by default — most orders don't use any
  // add-ons and the long list crowds the form. Header shows the count
  // of selected add-ons so the operator can see at a glance whether
  // there's anything in there.
  const [addonsExpanded, setAddonsExpanded] = useState(false);

  useEffect(() => {
    // Source the add-on list from service_catalog (show_as_delivery_service).
    // ADDL_ITEM is auto-computed via the existing extra-items math (every order
    // gets 3 free, then $25 each), so we exclude it from the user-pickable list
    // to avoid double-charging. The legacy EXTRA_ITEM exclusion is kept too in
    // case any historical row carrying that code is still around.
    fetchDeliveryServicesFromCatalog().then(data => {
      if (!data) return;
      const base = data.filter(a => a.code !== 'ADDL_ITEM' && a.code !== 'EXTRA_ITEM');
      setAllAccessorials(base);
      const filtered = base
        .filter(a => a.availableForDelivery)             // catalog flag
        .filter(a => isStaff || a.visibleToClient);      // role gate
      setAccessorials(filtered);
    });
  }, [isStaff]);

  // ── Item class service time defaults ──────────────────────────────────
  const [classMinutesMap, setClassMinutesMap] = useState<Record<string, number>>({});
  useEffect(() => { fetchItemClassMinutes().then(setClassMinutesMap); }, []);

  // ── Valuation coverage (delivery / pickup / P+D — NOT service-only) ───
  // Required for any order that physically moves items. Mirrors the Quote
  // Tool's coverage card semantics: a 'flat' option (Standard $0) is the
  // default; 'percent_declared' options (FND/FWD) require the user to enter
  // a declared value, with the resulting one-time charge rolled into the
  // order total. The choice is persisted on dt_orders so the Review Queue
  // and downstream reports can audit it.
  const { options: coverageOptions } = useCoverageOptions();
  // Filter to options that make sense at order-creation time:
  //   • storage_added is a storage-billing tier — irrelevant to delivery
  //     orders (storage is billed monthly via insurance_charges_log).
  //   • per_lb (Standard Valuation, freight-style) is not currently used
  //     for our market — left out so the radio list stays uncluttered.
  // Keep flat (Standard) + percent_declared (FND, FWD) only.
  const deliveryCoverageOptions = useMemo<CoverageOption[]>(() => {
    return coverageOptions.filter(o =>
      o.active && o.id !== 'storage_added' && (o.calcType === 'flat' || o.calcType === 'percent_declared')
    );
  }, [coverageOptions]);

  const [coverageOptionId, setCoverageOptionId] = useState<string>('standard');
  const [declaredValue, setDeclaredValue] = useState<string>(''); // string for input control

  // Auto-correct selection if the chosen option disappears (e.g. admin
  // deactivated it mid-session) — fall back to the first available row,
  // preferring 'standard' if it's still there.
  useEffect(() => {
    if (deliveryCoverageOptions.length === 0) return;
    const stillThere = deliveryCoverageOptions.some(o => o.id === coverageOptionId);
    if (!stillThere) {
      const std = deliveryCoverageOptions.find(o => o.id === 'standard');
      setCoverageOptionId(std?.id ?? deliveryCoverageOptions[0].id);
    }
  }, [deliveryCoverageOptions, coverageOptionId]);

  const selectedCoverage = useMemo(
    () => deliveryCoverageOptions.find(o => o.id === coverageOptionId) ?? null,
    [deliveryCoverageOptions, coverageOptionId]
  );

  // declared_value × coverage_rate% = one-time coverage charge.
  // Matches `quoteCalc.ts` lines 117-130 for the Quote Tool — keeping the
  // formula identical so an order created from a quote produces the same
  // number you'd see on the quote PDF.
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
        if (acc.rateUnit === 'flat' || acc.rateUnit === 'plus_base') {
          subtotal = acc.rate;
        } else {
          // per_mile / per_15min / per_item / per_hour / per_day all multiply
          // the unit rate by the user-entered quantity (miles / 15-min blocks
          // / items / hours / days).
          subtotal = acc.rate * quantity;
        }
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

  // Coverage applies to every order mode that physically moves items —
  // delivery, pickup, and pickup_and_delivery. service_only is excluded by
  // the surrounding `mode !== 'service_only'` checks in the JSX.
  const orderTotal = useMemo(() => {
    if (baseFee == null) return null;
    return baseFee + pickupLegFee + extraItemsFee + accessorialsTotal + coverageCharge;
  }, [baseFee, pickupLegFee, extraItemsFee, accessorialsTotal, coverageCharge]);

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
    // serviceDate is intentionally NOT required at submit — operator
    // can save the order without nailing down the day, then schedule it
    // later from the order detail page.
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
    // Valuation coverage is required for any item-moving order. percent_declared
    // tiers (FND/FWD) need a non-zero declared value so we can compute the
    // one-time charge — block submit until the field is filled.
    if (selectedCoverage?.calcType === 'percent_declared') {
      const dv = parseFloat(declaredValue);
      if (!Number.isFinite(dv) || dv <= 0) return false;
    }
    return true;
  }, [
    clientSheetId, serviceDate, mode,
    deliveryContactName, deliveryAddress, deliveryCity, deliveryZip, serviceDescription,
    pickupContactName, pickupAddress, pickupCity, pickupZip, pickupFreeItems,
    itemsSource, selectedInvItems,
    selectedCoverage, declaredValue,
  ]);

  // What's blocking the submit, in human terms — shown next to the
  // disabled Submit button so the operator doesn't have to scroll the
  // form looking for an empty asterisked field.
  const missingFields = useMemo(() => {
    if (canSubmit) return [];
    const out: string[] = [];
    if (!clientSheetId) out.push('client');
    // serviceDate omitted on purpose — not a hard requirement.
    if (mode === 'service_only') {
      if (!deliveryContactName.trim()) out.push('recipient name');
      if (!deliveryAddress.trim())     out.push('address');
      if (!deliveryCity.trim())        out.push('city');
      if (!deliveryZip.trim())         out.push('ZIP');
      if (!serviceDescription.trim())  out.push('service description');
    }
    const needsPickup   = mode === 'pickup' || mode === 'pickup_and_delivery';
    const needsDelivery = mode === 'delivery' || mode === 'pickup_and_delivery';
    if (needsPickup) {
      if (!pickupContactName.trim()) out.push('pickup contact');
      if (!pickupAddress.trim())     out.push('pickup address');
      if (!pickupCity.trim())        out.push('pickup city');
      if (!pickupZip.trim())         out.push('pickup ZIP');
      if (!pickupFreeItems.some(i => i.description.trim())) out.push('at least one pickup item');
    }
    if (needsDelivery) {
      if (!deliveryContactName.trim()) out.push('recipient name');
      if (!deliveryAddress.trim())     out.push('delivery address');
      if (!deliveryCity.trim())        out.push('delivery city');
      if (!deliveryZip.trim())         out.push('delivery ZIP');
      if (mode === 'delivery' && itemsSource === 'warehouse' && selectedInvItems.length === 0) {
        out.push('at least one item selected from inventory');
      }
    }
    if (selectedCoverage?.calcType === 'percent_declared') {
      const dv = parseFloat(declaredValue);
      if (!Number.isFinite(dv) || dv <= 0) out.push('declared value (for the coverage tier)');
    }
    return out;
  }, [
    canSubmit, clientSheetId, serviceDate, mode,
    deliveryContactName, deliveryAddress, deliveryCity, deliveryZip, serviceDescription,
    pickupContactName, pickupAddress, pickupCity, pickupZip, pickupFreeItems,
    itemsSource, selectedInvItems, selectedCoverage, declaredValue,
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

    // Get next sequence number from Supabase. The previous version fell back
    // to a timestamp slice on RPC failure, but that's collision-prone and
    // produces non-monotonic numbers, so we now refuse to mint an order
    // number when the RPC fails — the surrounding submit handler turns the
    // throw into a visible error banner instead of silently writing a bad
    // identifier.
    const { data: seqData, error: seqErr } = await supabase.rpc('next_order_number');
    if (seqErr || !seqData) {
      throw new Error(
        `Could not allocate order number (next_order_number RPC failed: ${seqErr?.message ?? 'no data returned'}). Try again, or contact support if the problem persists.`
      );
    }
    const seqNum: string = seqData; // already zero-padded from the DB function

    // Build reference portion from PO Number (no spaces)
    const ref = poNumber.trim().replace(/\s+/g, '-');

    let orderNum = ref ? `${prefix}-${seqNum}-${ref}` : `${prefix}-${seqNum}`;
    if (suffix) orderNum += `-${suffix}`;
    return orderNum;
  };

  // ── Edit-existing-order state ──────────────────────────────────────────
  // Tracks the dt_orders.id we're editing. Set when the modal opens
  // with editOrderId (load existing — draft OR real order) OR after
  // the first successful Save Draft on a new modal (so subsequent
  // saves UPDATE instead of re-INSERTing a second row).
  const editingDraftRowIdRef = useRef<string | null>(editOrderId ?? null);
  // The review_status of the loaded row at prefill time. Drives the
  // submit branch (draft → promote with new identifier + status flip;
  // anything else → save-changes UPDATE preserving identifier + status)
  // and the Save Draft button enabled state.
  const originalReviewStatusRef = useRef<string | null>(null);
  // For P+D edits: tracks the linked PICKUP leg's id so save/promote
  // can UPDATE both rows in lockstep. Loaded by the prefill effect
  // when the opened row is a 'pickup_and_delivery' delivery leg, OR
  // populated after an INSERT in the P+D Save Draft path so subsequent
  // saves UPDATE in place instead of re-INSERTing a duplicate pair.
  const editingPickupRowIdRef = useRef<string | null>(null);
  const [, forceUpdateForRefs] = useState(0);  // tick when refs change so labels re-render
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  // Generates a DRAFT-<short-id> placeholder identifier. Random rather
  // than sequenced — sequencing would burn real order numbers on every
  // draft (gaps in the sequence are ugly). Short-id is collision-safe
  // for the volume; UNIQUE(tenant_id, dt_identifier) catches any clash.
  const genDraftIdent = (suffix?: string): string => {
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return suffix ? `DRAFT-${rand}-${suffix}` : `DRAFT-${rand}`;
  };

  // Prefill the form from an existing order (draft OR real) when the
  // modal opens with editOrderId. Loads dt_orders + dt_order_items +
  // the auxiliary selections (selectedAccessorials, selectedIds), then
  // overwrites the freshly-mounted state. Best-effort — on failure
  // shows an error banner; user can either retry by reopening or cancel.
  useEffect(() => {
    if (!editOrderId) return;
    let cancelled = false;
    (async () => {
      const { data: row, error } = await supabase
        .from('dt_orders')
        .select('*, dt_order_items(*)')
        .eq('id', editOrderId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !row) {
        setSubmitError(`Could not load order: ${error?.message || 'not found'}`);
        return;
      }
      const r = row as Record<string, unknown>;
      // Capture the loaded row's review_status — drives whether
      // submit promotes (draft → real order) or just saves changes.
      originalReviewStatusRef.current = (r.review_status as string) || null;
      forceUpdateForRefs(t => t + 1);
      // Restore high-level mode + source first so dependent UI mounts.
      const ot = (r.order_type as string) || 'delivery';
      setMode(ot === 'pickup' || ot === 'delivery' || ot === 'service_only' || ot === 'pickup_and_delivery' ? ot : 'delivery');
      // Common fields
      if (r.po_number)              setPoNumber(r.po_number as string);
      if (r.sidemark)               setSidemark(r.sidemark as string);
      if (r.details)                setDetails(r.details as string);
      if (r.local_service_date)     setServiceDate(r.local_service_date as string);
      if (r.window_start_local)     setWindowStart(r.window_start_local as string);
      if (r.window_end_local)       setWindowEnd(r.window_end_local as string);
      if (r.billing_method)         setBillingMethod(r.billing_method as BillingMethod);
      if (r.service_time_minutes != null) setServiceTimeOverride(Number(r.service_time_minutes));
      if (r.coverage_option_id)     setCoverageOptionId(r.coverage_option_id as string);
      if (r.declared_value != null) setDeclaredValue(String(r.declared_value));
      // Contacts — pickup vs delivery depending on mode
      if (ot === 'pickup') {
        if (r.contact_name)    setPickupContactName(r.contact_name as string);
        if (r.contact_address) setPickupAddress(r.contact_address as string);
        if (r.contact_city)    setPickupCity(r.contact_city as string);
        if (r.contact_state)   setPickupState(r.contact_state as string);
        if (r.contact_zip)     setPickupZip(r.contact_zip as string);
        if (r.contact_phone)   setPickupPhone(r.contact_phone as string);
        if (r.contact_phone2)  setPickupPhone2(r.contact_phone2 as string);
        if (r.contact_email)   setPickupEmail(r.contact_email as string);
      } else {
        if (r.contact_name)    setDeliveryContactName(r.contact_name as string);
        if (r.contact_address) setDeliveryAddress(r.contact_address as string);
        if (r.contact_city)    setDeliveryCity(r.contact_city as string);
        if (r.contact_state)   setDeliveryState(r.contact_state as string);
        if (r.contact_zip)     setDeliveryZip(r.contact_zip as string);
        if (r.contact_phone)   setDeliveryPhone(r.contact_phone as string);
        if (r.contact_phone2)  setDeliveryPhone2(r.contact_phone2 as string);
        if (r.contact_email)   setDeliveryEmail(r.contact_email as string);
      }
      // P+D — also load the linked pickup leg so the operator can
      // edit BOTH contact sets + see the pickup items in context.
      // The opened row is the DELIVERY leg (order_type=
      // 'pickup_and_delivery' carries delivery contact + total
      // pricing); linked_order_id points at the PICKUP leg.
      if (ot === 'pickup_and_delivery' && r.linked_order_id) {
        try {
          const { data: pickupRow } = await supabase
            .from('dt_orders')
            .select('id, contact_name, contact_address, contact_city, contact_state, contact_zip, contact_phone, contact_phone2, contact_email')
            .eq('id', r.linked_order_id as string)
            .maybeSingle();
          if (pickupRow && !cancelled) {
            const p = pickupRow as Record<string, unknown>;
            editingPickupRowIdRef.current = String(p.id || '');
            if (p.contact_name)    setPickupContactName(p.contact_name as string);
            if (p.contact_address) setPickupAddress(p.contact_address as string);
            if (p.contact_city)    setPickupCity(p.contact_city as string);
            if (p.contact_state)   setPickupState(p.contact_state as string);
            if (p.contact_zip)     setPickupZip(p.contact_zip as string);
            if (p.contact_phone)   setPickupPhone(p.contact_phone as string);
            if (p.contact_phone2)  setPickupPhone2(p.contact_phone2 as string);
            if (p.contact_email)   setPickupEmail(p.contact_email as string);
          }
        } catch (_) { /* tolerate — pickup leg edit will be unavailable */ }
      }
      // Items: warehouse-source selections come from dt_order_items
      const items = Array.isArray(r.dt_order_items) ? (r.dt_order_items as Array<Record<string, unknown>>) : [];
      const itemIds = items
        .map(it => String(it.dt_item_code || it.description || '').trim())
        .filter(Boolean);
      if (itemIds.length > 0) setSelectedIds(new Set(itemIds));
      // Accessorials JSON
      const accs = Array.isArray(r.accessorials_json) ? (r.accessorials_json as Array<{ code: string; quantity: number; subtotal: number }>) : [];
      if (accs.length > 0) {
        const m = new Map<string, SelectedAccessorial>();
        for (const a of accs) m.set(a.code, { code: a.code, quantity: a.quantity, subtotal: a.subtotal });
        setSelectedAccessorials(m);
      }
      // Service description (service_only mode)
      if (ot === 'service_only' && r.details) setServiceDescription(r.details as string);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editOrderId]);

  // ── Save Draft ─────────────────────────────────────────────────────────
  // Persists the in-progress order as a dt_orders row with
  // review_status='draft' and a DRAFT-xxx placeholder identifier. The
  // operator can return to this draft from the Orders page (filter to
  // Drafts → click the row → modal reopens with everything prefilled).
  // Subsequent saves UPDATE the same row. On Submit for Review, the
  // promote path replaces the placeholder identifier with a real
  // generated number and flips review_status.
  //
  // Save Draft is disabled when editing a non-draft order — can't
  // downgrade a real submitted/approved order back to a draft (use
  // Save Changes / the primary submit instead). P+D drafts ARE now
  // supported as of this turn; both legs save+update+promote in
  // lockstep via the dedicated P+D branches in handleSaveDraft +
  // handleSubmit.
  const isEditingRealOrder = !!editOrderId
    && originalReviewStatusRef.current != null
    && originalReviewStatusRef.current !== 'draft';
  const canSaveDraft = !!clientSheetId && !isEditingRealOrder;
  const handleSaveDraft = async () => {
    if (!canSaveDraft || savingDraft) return;
    setSavingDraft(true);
    setSubmitError(null);

    try {
      const { data: authData } = await supabase.auth.getUser();
      const authUid = authData?.user?.id || null;

      const accList = Array.from(selectedAccessorials.values()).map(a => ({
        code: a.code,
        quantity: a.quantity,
        rate: accessorials.find(x => x.code === a.code)?.rate || 0,
        subtotal: a.subtotal,
      }));

      // ── P+D Save Draft path ───────────────────────────────────────────
      // Two linked rows. Mirrors the real-submit P+D path but with
      // DRAFT-xxx-P / DRAFT-xxx-D placeholders + status='draft'. On
      // re-save, both refs are populated → UPDATE both rows in place.
      if (mode === 'pickup_and_delivery') {
        const commonDraft: Record<string, unknown> = {
          tenant_id: clientSheetId,
          timezone: 'America/Los_Angeles',
          local_service_date: serviceDate || null,
          window_start_local: windowStart || null,
          window_end_local: windowEnd || null,
          po_number: poNumber.trim() || null,
          sidemark: sidemark.trim() || null,
          details: details.trim() || null,
          source: 'app',
          review_status: 'draft',
          created_by_user: authUid,
          created_by_role: user?.role || 'client',
          billing_method: billingMethod,
          service_time_minutes: effectiveServiceTime || null,
          coverage_option_id: selectedCoverage?.id ?? null,
          declared_value: selectedCoverage?.calcType === 'percent_declared' ? (parseFloat(declaredValue) || null) : null,
          coverage_charge: coverageCharge || 0,
        };
        const pickupPayload: Record<string, unknown> = {
          ...commonDraft,
          order_type: 'pickup',
          is_pickup: true,
          contact_name: pickupContactName.trim() || null,
          contact_address: pickupAddress.trim() || null,
          contact_city: pickupCity.trim() || null,
          contact_state: pickupState.trim() || null,
          contact_zip: pickupZip.trim() || null,
          contact_phone: pickupPhone.trim() || null,
          contact_phone2: pickupPhone2.trim() || null,
          contact_email: pickupEmail.trim() || null,
          base_delivery_fee: null,
          order_total: null,
          pricing_override: true,
          pricing_notes: 'Pickup leg of linked pickup+delivery — pricing rolled into delivery order.',
        };
        const deliveryPayload: Record<string, unknown> = {
          ...commonDraft,
          order_type: 'pickup_and_delivery',
          is_pickup: false,
          contact_name: deliveryContactName.trim() || null,
          contact_address: deliveryAddress.trim() || null,
          contact_city: deliveryCity.trim() || null,
          contact_state: deliveryState.trim() || null,
          contact_zip: deliveryZip.trim() || null,
          contact_phone: deliveryPhone.trim() || null,
          contact_phone2: deliveryPhone2.trim() || null,
          contact_email: deliveryEmail.trim() || null,
          base_delivery_fee: baseFee != null ? baseFee + pickupLegFee : null,
          extra_items_count: extraItemsCount,
          extra_items_fee: extraItemsFee,
          accessorials_json: accList.length > 0 ? accList : null,
          accessorials_total: accessorialsTotal,
          order_total: orderTotal,
        };

        if (editingDraftRowIdRef.current && editingPickupRowIdRef.current) {
          // UPDATE both rows in place
          const upPickup = await supabase.from('dt_orders').update(pickupPayload).eq('id', editingPickupRowIdRef.current);
          if (upPickup.error) throw new Error(`Draft pickup update failed: ${upPickup.error.message}`);
          const upDelivery = await supabase.from('dt_orders').update(deliveryPayload).eq('id', editingDraftRowIdRef.current);
          if (upDelivery.error) throw new Error(`Draft delivery update failed: ${upDelivery.error.message}`);
          // Items live on the delivery leg only (the pickup leg's
          // pricing is rolled into delivery; same convention as the
          // real-submit path).
          await supabase.from('dt_order_items').delete().eq('dt_order_id', editingDraftRowIdRef.current);
          if (itemsSource === 'warehouse' && selectedInvItems.length > 0) {
            const itemRows = selectedInvItems.map(i => ({
              dt_order_id: editingDraftRowIdRef.current,
              dt_item_code: i.itemId,
              description: i.description || '',
              quantity: i.qty || 1,
              vendor: i.vendor || null,
              class_name: i.itemClass || null,
              cubic_feet: classToCuFt(i.itemClass) ?? null,
            }));
            await supabase.from('dt_order_items').insert(itemRows);
          }
        } else {
          // INSERT new linked pair. Same pattern as the real-submit
          // P+D path: pickup first, delivery with linked_order_id,
          // then back-link pickup → delivery.
          const baseRand = Math.random().toString(36).slice(2, 8).toUpperCase();
          const pickupIdent = `DRAFT-${baseRand}-P`;
          const deliveryIdent = `DRAFT-${baseRand}-D`;
          const insP = await supabase
            .from('dt_orders')
            .insert({ ...pickupPayload, dt_identifier: pickupIdent })
            .select('id').single();
          if (insP.error || !insP.data) throw new Error(`Pickup draft insert failed: ${insP.error?.message}`);
          const pickupId = (insP.data as { id: string }).id;
          editingPickupRowIdRef.current = pickupId;
          const insD = await supabase
            .from('dt_orders')
            .insert({ ...deliveryPayload, dt_identifier: deliveryIdent, linked_order_id: pickupId })
            .select('id').single();
          if (insD.error || !insD.data) throw new Error(`Delivery draft insert failed: ${insD.error?.message}`);
          const deliveryId = (insD.data as { id: string }).id;
          editingDraftRowIdRef.current = deliveryId;
          // Back-link pickup → delivery for bidirectional navigation.
          await supabase.from('dt_orders').update({ linked_order_id: deliveryId }).eq('id', pickupId);
          // Items on delivery leg.
          if (itemsSource === 'warehouse' && selectedInvItems.length > 0) {
            const itemRows = selectedInvItems.map(i => ({
              dt_order_id: deliveryId,
              dt_item_code: i.itemId,
              description: i.description || '',
              quantity: i.qty || 1,
              vendor: i.vendor || null,
              class_name: i.itemClass || null,
              cubic_feet: classToCuFt(i.itemClass) ?? null,
            }));
            await supabase.from('dt_order_items').insert(itemRows);
          }
        }
        setDraftSavedAt(new Date());
        setSavingDraft(false);
        return;
      }

      // ── Single-leg Save Draft path (existing) ─────────────────────────
      // Pick the right contact set for the mode
      const contact = mode === 'pickup' ? {
        name: pickupContactName, address: pickupAddress, city: pickupCity, state: pickupState,
        zip: pickupZip, phone: pickupPhone, phone2: pickupPhone2, email: pickupEmail,
      } : {
        name: deliveryContactName, address: deliveryAddress, city: deliveryCity, state: deliveryState,
        zip: deliveryZip, phone: deliveryPhone, phone2: deliveryPhone2, email: deliveryEmail,
      };

      const payload: Record<string, unknown> = {
        tenant_id: clientSheetId,
        timezone: 'America/Los_Angeles',
        local_service_date: serviceDate || null,
        window_start_local: windowStart || null,
        window_end_local: windowEnd || null,
        po_number: poNumber.trim() || null,
        sidemark: sidemark.trim() || null,
        details: mode === 'service_only'
          ? (serviceDescription.trim() ? serviceDescription.trim() : (details.trim() || null))
          : (details.trim() || null),
        source: 'app',
        review_status: 'draft',
        created_by_user: authUid,
        created_by_role: user?.role || 'client',
        billing_method: billingMethod,
        service_time_minutes: effectiveServiceTime || null,
        order_type: mode,
        is_pickup: mode === 'pickup',
        contact_name: contact.name.trim() || null,
        contact_address: contact.address.trim() || null,
        contact_city: contact.city.trim() || null,
        contact_state: contact.state.trim() || null,
        contact_zip: contact.zip.trim() || null,
        contact_phone: contact.phone.trim() || null,
        contact_phone2: contact.phone2.trim() || null,
        contact_email: contact.email.trim() || null,
        base_delivery_fee: baseFee != null ? baseFee : null,
        extra_items_count: extraItemsCount,
        extra_items_fee: extraItemsFee,
        accessorials_json: accList.length > 0 ? accList : null,
        accessorials_total: accessorialsTotal,
        order_total: orderTotal,
        coverage_option_id: selectedCoverage?.id ?? null,
        declared_value: selectedCoverage?.calcType === 'percent_declared' ? (parseFloat(declaredValue) || null) : null,
        coverage_charge: coverageCharge || 0,
      };

      if (editingDraftRowIdRef.current) {
        // UPDATE existing draft row
        const { error: upErr } = await supabase
          .from('dt_orders')
          .update(payload)
          .eq('id', editingDraftRowIdRef.current);
        if (upErr) throw new Error(`Draft update failed: ${upErr.message}`);
        // Refresh dt_order_items: delete existing + reinsert (simple,
        // safe — drafts aren't queried for reporting between saves).
        await supabase.from('dt_order_items').delete().eq('dt_order_id', editingDraftRowIdRef.current);
        if (mode === 'delivery' && itemsSource === 'warehouse' && selectedInvItems.length > 0) {
          const itemRows = selectedInvItems.map(i => ({
            dt_order_id: editingDraftRowIdRef.current,
            dt_item_code: i.itemId,
            description: i.description || '',
            quantity: i.qty || 1,
            vendor: i.vendor || null,
            class_name: i.itemClass || null,
            cubic_feet: classToCuFt(i.itemClass) ?? null,
          }));
          await supabase.from('dt_order_items').insert(itemRows);
        }
      } else {
        // INSERT new draft row
        const draftIdent = genDraftIdent();
        const { data: row, error: insErr } = await supabase
          .from('dt_orders')
          .insert({ ...payload, dt_identifier: draftIdent })
          .select('id')
          .single();
        if (insErr || !row) throw new Error(`Draft insert failed: ${insErr?.message}`);
        editingDraftRowIdRef.current = (row as { id: string }).id;
        // Insert items (delivery + warehouse source only)
        if (mode === 'delivery' && itemsSource === 'warehouse' && selectedInvItems.length > 0) {
          const itemRows = selectedInvItems.map(i => ({
            dt_order_id: editingDraftRowIdRef.current,
            dt_item_code: i.itemId,
            description: i.description || '',
            quantity: i.qty || 1,
            vendor: i.vendor || null,
            class_name: i.itemClass || null,
            cubic_feet: classToCuFt(i.itemClass) ?? null,
          }));
          await supabase.from('dt_order_items').insert(itemRows);
        }
      }
      setDraftSavedAt(new Date());
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingDraft(false);
    }
  };

  // ── Submit ─────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<{ dtIdentifier: string; linkedIdentifier?: string; orderId: string } | null>(null);
  const [orderPaid, setOrderPaid] = useState(false);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);

    // Edit-existing-row path. When the modal was opened on an existing
    // draft (or auto-saved one mid-build), or on a real order via the
    // OrderPage "Edit Full Order" button, we UPDATE the existing row(s)
    // instead of INSERTing new ones. Two sub-cases on each leg:
    //   • original status = 'draft' → PROMOTE: replace DRAFT-xxx with
    //     a real generated identifier + flip review_status to
    //     pending_review (or approved for admin).
    //   • original status = anything else → SAVE CHANGES: keep
    //     identifier + review_status, just update the field values.
    // P+D edits update BOTH the pickup + delivery rows in lockstep
    // via editingPickupRowIdRef + editingDraftRowIdRef.
    if (editingDraftRowIdRef.current && mode === 'pickup_and_delivery' && editingPickupRowIdRef.current) {
      const wasDraftPD = originalReviewStatusRef.current === 'draft' || !originalReviewStatusRef.current;
      try {
        const { data: authData2 } = await supabase.auth.getUser();
        const authUid2 = authData2?.user?.id || null;
        const accListPD = Array.from(selectedAccessorials.values()).map(a => ({
          code: a.code, quantity: a.quantity,
          rate: accessorials.find(x => x.code === a.code)?.rate || 0,
          subtotal: a.subtotal,
        }));
        const commonEdit: Record<string, unknown> = {
          tenant_id: clientSheetId,
          timezone: 'America/Los_Angeles',
          local_service_date: serviceDate || null,
          window_start_local: windowStart || null,
          window_end_local: windowEnd || null,
          po_number: poNumber.trim() || null,
          sidemark: sidemark.trim() || null,
          details: details.trim() || null,
          billing_method: billingMethod,
          service_time_minutes: effectiveServiceTime || null,
          coverage_option_id: selectedCoverage?.id ?? null,
          declared_value: selectedCoverage?.calcType === 'percent_declared' ? (parseFloat(declaredValue) || null) : null,
          coverage_charge: coverageCharge || 0,
          updated_by_user: authUid2,
        };
        const pickupEdit: Record<string, unknown> = {
          ...commonEdit,
          order_type: 'pickup',
          is_pickup: true,
          contact_name: pickupContactName.trim() || null,
          contact_address: pickupAddress.trim() || null,
          contact_city: pickupCity.trim() || null,
          contact_state: pickupState.trim() || null,
          contact_zip: pickupZip.trim() || null,
          contact_phone: pickupPhone.trim() || null,
          contact_phone2: pickupPhone2.trim() || null,
          contact_email: pickupEmail.trim() || null,
        };
        const deliveryEdit: Record<string, unknown> = {
          ...commonEdit,
          order_type: 'pickup_and_delivery',
          is_pickup: false,
          contact_name: deliveryContactName.trim() || null,
          contact_address: deliveryAddress.trim() || null,
          contact_city: deliveryCity.trim() || null,
          contact_state: deliveryState.trim() || null,
          contact_zip: deliveryZip.trim() || null,
          contact_phone: deliveryPhone.trim() || null,
          contact_phone2: deliveryPhone2.trim() || null,
          contact_email: deliveryEmail.trim() || null,
          base_delivery_fee: baseFee != null ? baseFee + pickupLegFee : null,
          extra_items_count: extraItemsCount,
          extra_items_fee: extraItemsFee,
          accessorials_json: accListPD.length > 0 ? accListPD : null,
          accessorials_total: accessorialsTotal,
          order_total: orderTotal,
        };
        // Promote → both legs get fresh real identifiers + flip status.
        if (wasDraftPD) {
          pickupEdit.dt_identifier = await generateOrderNumber('P');
          pickupEdit.review_status = user?.role === 'admin' ? 'approved' : 'pending_review';
          deliveryEdit.dt_identifier = await generateOrderNumber('D');
          deliveryEdit.review_status = user?.role === 'admin' ? 'approved' : 'pending_review';
        }
        const upP = await supabase.from('dt_orders').update(pickupEdit).eq('id', editingPickupRowIdRef.current);
        if (upP.error) throw new Error(`Pickup leg ${wasDraftPD ? 'promote' : 'save'} failed: ${upP.error.message}`);
        const { data: savedD, error: saveDErr } = await supabase
          .from('dt_orders').update(deliveryEdit).eq('id', editingDraftRowIdRef.current)
          .select('id, dt_identifier, review_status').single();
        if (saveDErr || !savedD) throw new Error(`Delivery leg ${wasDraftPD ? 'promote' : 'save'} failed: ${saveDErr?.message || 'no row returned'}`);
        // Refresh items on the delivery leg only (matches the create
        // path: items live on the delivery leg, pickup leg has none).
        await supabase.from('dt_order_items').delete().eq('dt_order_id', editingDraftRowIdRef.current);
        if (itemsSource === 'warehouse' && selectedInvItems.length > 0) {
          const itemRows = selectedInvItems.map(i => ({
            dt_order_id: editingDraftRowIdRef.current,
            dt_item_code: i.itemId,
            description: i.description || '',
            quantity: i.qty || 1,
            vendor: i.vendor || null,
            class_name: i.itemClass || null,
            cubic_feet: classToCuFt(i.itemClass) ?? null,
          }));
          await supabase.from('dt_order_items').insert(itemRows);
        }
        const savedDelivery = savedD as { id: string; dt_identifier: string; review_status: string };
        onSubmit?.({
          dtOrderId: savedDelivery.id,
          dtIdentifier: savedDelivery.dt_identifier,
          reviewStatus: savedDelivery.review_status,
        });
        onClose();
        return;
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : String(e));
        setSubmitting(false);
        return;
      }
    }

    if (editingDraftRowIdRef.current && mode !== 'pickup_and_delivery') {
      const wasDraft = originalReviewStatusRef.current === 'draft' || !originalReviewStatusRef.current;
      try {
        const { data: authData2 } = await supabase.auth.getUser();
        const authUid2 = authData2?.user?.id || null;
        const accList2 = Array.from(selectedAccessorials.values()).map(a => ({
          code: a.code, quantity: a.quantity,
          rate: accessorials.find(x => x.code === a.code)?.rate || 0,
          subtotal: a.subtotal,
        }));
        const contact = mode === 'pickup' ? {
          name: pickupContactName, address: pickupAddress, city: pickupCity, state: pickupState,
          zip: pickupZip, phone: pickupPhone, phone2: pickupPhone2, email: pickupEmail,
        } : {
          name: deliveryContactName, address: deliveryAddress, city: deliveryCity, state: deliveryState,
          zip: deliveryZip, phone: deliveryPhone, phone2: deliveryPhone2, email: deliveryEmail,
        };
        const editPayload: Record<string, unknown> = {
          tenant_id: clientSheetId,
          timezone: 'America/Los_Angeles',
          local_service_date: serviceDate || null,
          window_start_local: windowStart || null,
          window_end_local: windowEnd || null,
          po_number: poNumber.trim() || null,
          sidemark: sidemark.trim() || null,
          details: mode === 'service_only'
            ? (serviceDescription.trim() ? serviceDescription.trim() : (details.trim() || null))
            : (details.trim() || null),
          billing_method: billingMethod,
          service_time_minutes: effectiveServiceTime || null,
          order_type: mode,
          is_pickup: mode === 'pickup',
          contact_name: contact.name.trim() || null,
          contact_address: contact.address.trim() || null,
          contact_city: contact.city.trim() || null,
          contact_state: contact.state.trim() || null,
          contact_zip: contact.zip.trim() || null,
          contact_phone: contact.phone.trim() || null,
          contact_phone2: contact.phone2.trim() || null,
          contact_email: contact.email.trim() || null,
          base_delivery_fee: baseFee != null ? baseFee : null,
          extra_items_count: extraItemsCount,
          extra_items_fee: extraItemsFee,
          accessorials_json: accList2.length > 0 ? accList2 : null,
          accessorials_total: accessorialsTotal,
          order_total: orderTotal,
          coverage_option_id: selectedCoverage?.id ?? null,
          declared_value: selectedCoverage?.calcType === 'percent_declared' ? (parseFloat(declaredValue) || null) : null,
          coverage_charge: coverageCharge || 0,
          updated_by_user: authUid2,
        };
        // Only the promote branch reassigns the identifier + bumps
        // review_status. Save-changes leaves both alone — preserves
        // pushed_to_dt_at semantics, audit history, etc.
        if (wasDraft) {
          editPayload.dt_identifier = await generateOrderNumber(mode === 'pickup' ? 'P' : undefined);
          editPayload.review_status = user?.role === 'admin' ? 'approved' : 'pending_review';
        }
        const { data: saved, error: saveErr } = await supabase
          .from('dt_orders')
          .update(editPayload)
          .eq('id', editingDraftRowIdRef.current)
          .select('id, dt_identifier, review_status')
          .single();
        if (saveErr || !saved) throw new Error(`${wasDraft ? 'Draft promote' : 'Order save'} failed: ${saveErr?.message || 'no row returned'}`);
        // Refresh items (delete + reinsert is simpler than diff for
        // the typical small item count).
        await supabase.from('dt_order_items').delete().eq('dt_order_id', editingDraftRowIdRef.current);
        if (mode === 'delivery' && itemsSource === 'warehouse' && selectedInvItems.length > 0) {
          const itemRows = selectedInvItems.map(i => ({
            dt_order_id: editingDraftRowIdRef.current,
            dt_item_code: i.itemId,
            description: i.description || '',
            quantity: i.qty || 1,
            vendor: i.vendor || null,
            class_name: i.itemClass || null,
            cubic_feet: classToCuFt(i.itemClass) ?? null,
          }));
          await supabase.from('dt_order_items').insert(itemRows);
        }
        const savedRow = saved as { id: string; dt_identifier: string; review_status: string };
        onSubmit?.({
          dtOrderId: savedRow.id,
          dtIdentifier: savedRow.dt_identifier,
          reviewStatus: savedRow.review_status,
        });
        onClose();
        return;
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : String(e));
        setSubmitting(false);
        return;
      }
    }

    const { data: authData } = await supabase.auth.getUser();
    const authUid = authData?.user?.id || null;

    const accList = Array.from(selectedAccessorials.values()).map(a => ({
      code: a.code,
      quantity: a.quantity,
      rate: accessorials.find(x => x.code === a.code)?.rate || 0,
      subtotal: a.subtotal,
    }));

    // Coverage values get written to BOTH legs of a P+D pair (the pickup
    // leg has its pricing rolled into the delivery leg, but the option/
    // declared-value belong to the shipment as a whole — duplicating them
    // means the Review Queue and reports never have to JOIN to the
    // delivery leg to know what coverage was selected).
    const coverageFields = mode === 'service_only'
      ? { coverage_option_id: null, declared_value: null, coverage_charge: null }
      : {
          coverage_option_id: selectedCoverage?.id ?? null,
          declared_value: selectedCoverage?.calcType === 'percent_declared'
            ? (parseFloat(declaredValue) || 0)
            : null,
          coverage_charge: coverageCharge || 0,
        };

    const commonFields = {
      tenant_id: clientSheetId,
      timezone: 'America/Los_Angeles',
      // dt_orders.local_service_date is a date column. An empty string
      // makes Postgres throw "invalid input syntax for type date" — has
      // to be null when the operator hasn't picked a day. (Service date
      // is no longer required at submit; we may write rows without one.)
      local_service_date: serviceDate || null,
      window_start_local: windowStart || null,
      window_end_local: windowEnd || null,
      po_number: poNumber.trim() || null,
      sidemark: sidemark.trim() || null,
      // dt_orders has a single `details` column for free-text notes. The legacy
      // `order_notes` write was a duplicate of `details` from the same form
      // field — there is no separate UI input — so we don't write a second
      // copy. (The dt_order_notes table holds threaded staff/client notes
      // and is unrelated to this column.)
      details: details.trim() || null,
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
            ...coverageFields,
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
            ...coverageFields,
          })
          .select('id, dt_identifier')
          .single();
        if (dErr || !deliveryRow) throw new Error(`Delivery order insert failed: ${dErr?.message}`);

        // 3) Backlink pickup → delivery for bidirectional navigation. If this
        //    fails the pickup row is left without a linked_order_id, which
        //    breaks the Review Queue's "linked pair" detection — surface the
        //    error so the user knows to retry rather than silently shipping a
        //    half-linked pair.
        const { error: backlinkErr } = await supabase.from('dt_orders')
          .update({ linked_order_id: deliveryRow.id })
          .eq('id', pickupRow.id);
        if (backlinkErr) {
          throw new Error(
            `Pickup→delivery back-link failed: ${backlinkErr.message}. The two orders were created but the pickup leg is not linked back to the delivery leg.`
          );
        }

        // 4) Insert items. Free-text items go on BOTH orders with a positive
        //    quantity on each leg — the pickup vs delivery distinction is
        //    carried by the parent row's `order_type` ('pickup' vs
        //    'pickup_and_delivery'), not by the sign of the item quantity.
        //    The previous negative-quantity convention broke item-count
        //    aggregations and made dt_order_items.quantity violate its
        //    natural non-negative invariant.
        const pickupItemRows = pickupFreeItems
          .filter(i => i.description.trim())
          .flatMap(i => {
            const qty = Math.max(1, Number(i.quantity) || 1);
            return [
              {
                dt_order_id: pickupRow.id,
                dt_item_code: null,
                description: `PU: ${i.description.trim()}`,
                quantity: qty,
                original_quantity: qty,
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

        setCreateResult({ dtIdentifier: deliveryRow.dt_identifier, linkedIdentifier: pickupRow.dt_identifier, orderId: deliveryRow.id });
        onSubmit?.({
          dtOrderId: deliveryRow.id,
          dtIdentifier: deliveryRow.dt_identifier,
          reviewStatus: isAdminAutoApprove ? 'approved' : 'pending_review',
        });
        // Admin auto-push to DT. We AWAIT the call (rather than fire-and-forget)
        // so that DT rejections surface to the user as a visible warning on the
        // success screen — previously the modal said "Submitted" even when DT
        // bounced the payload, leaving silently-stuck orders. The order row
        // itself stays in 'approved' state regardless, so the reviewer can
        // retry the push from the Review Queue. The success screen still shows
        // because the dt_orders insert succeeded — only the DT push failed.
        if (isAdminAutoApprove) {
          try {
            const { data: pushData, error: pushErr } = await supabase.functions.invoke('dt-push-order', {
              body: { orderId: deliveryRow.id },
            });
            const pushResult = pushData as { ok?: boolean; error?: string } | null;
            if (pushErr || !pushResult?.ok) {
              const msg = pushErr?.message ?? pushResult?.error ?? 'Unknown error';
              console.warn('[delivery] Admin auto-push to DT failed:', msg);
              setSubmitError(`Order created, but DT push failed: ${msg}. Retry from the Review Queue.`);
            }
          } catch (pushEx) {
            const msg = pushEx instanceof Error ? pushEx.message : String(pushEx);
            console.warn('[delivery] Admin auto-push to DT threw:', msg);
            setSubmitError(`Order created, but DT push failed: ${msg}. Retry from the Review Queue.`);
          }
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
            ...coverageFields,
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
              service_date: serviceDate || null,
              order_type: mode,
            },
            performed_by: user?.email || 'unknown',
            source: 'app',
          }));
          supabase.from('entity_audit_log').insert(auditRows).then(({ error: aErr }) => {
            if (aErr) console.warn('[delivery] Audit log insert failed (non-fatal):', aErr.message);
          });
        }

        setCreateResult({ dtIdentifier: orderRow.dt_identifier, orderId: orderRow.id });
        onSubmit?.({
          dtOrderId: orderRow.id,
          dtIdentifier: orderRow.dt_identifier,
          reviewStatus: isAdminAutoApprove ? 'approved' : 'pending_review',
        });
        // Admin auto-push to DT. AWAITED so DT rejections surface to the user
        // — see the matching block in the pickup_and_delivery branch above for
        // the full rationale.
        if (isAdminAutoApprove) {
          try {
            const { data: pushData, error: pushErr } = await supabase.functions.invoke('dt-push-order', {
              body: { orderId: orderRow.id },
            });
            const pushResult = pushData as { ok?: boolean; error?: string } | null;
            if (pushErr || !pushResult?.ok) {
              const msg = pushErr?.message ?? pushResult?.error ?? 'Unknown error';
              console.warn('[delivery] Admin auto-push to DT failed:', msg);
              setSubmitError(`Order created, but DT push failed: ${msg}. Retry from the Review Queue.`);
            }
          } catch (pushEx) {
            const msg = pushEx instanceof Error ? pushEx.message : String(pushEx);
            console.warn('[delivery] Admin auto-push to DT threw:', msg);
            setSubmitError(`Order created, but DT push failed: ${msg}. Retry from the Review Queue.`);
          }
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
  // Selected-items summary table cells (peach-themed to match the
  // surrounding panel that contains them).
  const summaryTh: React.CSSProperties = {
    padding: '6px 10px', textAlign: 'left',
    fontSize: 10, fontWeight: 700, color: '#9A3412',
    textTransform: 'uppercase', letterSpacing: '0.06em',
  };
  const summaryTd: React.CSSProperties = {
    padding: '6px 10px', verticalAlign: 'middle',
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
          {/* DT push failure (admin auto-push only). The dt_orders row was
              still created — only the DispatchTrack-side push failed — so the
              user sees both the success state and a warning banner with the
              actionable next step. */}
          {submitError && (
            <div style={{
              background: '#FEE2E2', color: '#991B1B', padding: '10px 14px',
              borderRadius: 8, fontSize: 12, marginBottom: 20, textAlign: 'left',
              border: '1px solid #FCA5A5',
            }}>
              <strong>Heads up:</strong> {submitError}
            </div>
          )}

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
              {orderPaid ? (
                <div style={{ fontSize: 13, color: '#15803D' }}>Payment of ${orderTotal != null ? orderTotal.toFixed(2) : '0.00'} collected and recorded.</div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 8 }}>
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
                        flex: 1, padding: '10px 16px', borderRadius: 8,
                        border: 'none', background: theme.colors.orange, color: '#fff',
                        fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}
                    >
                      <CreditCard size={14} /> Collect via Stax
                    </button>
                    <WriteButton label="Mark Paid" variant="secondary" blockedReason={orderTotal == null ? 'No order total' : undefined} onClick={async () => {
                      const nowIso = new Date().toISOString();
                      const { error } = await supabase.from('dt_orders').update({
                        paid_at: nowIso,
                        paid_amount: orderTotal,
                        paid_method: 'Stax',
                        payment_collected: true,
                        payment_collected_at: nowIso,
                      }).eq('id', createResult.orderId);
                      if (error) throw new Error(error.message);
                      setOrderPaid(true);
                    }} />
                  </div>
                  <div style={{ fontSize: 10, color: '#92400E', marginTop: 6 }}>
                    Opens Stax payment page in new tab. After collecting payment, tap "Mark Paid" to record it.
                  </div>
                </>
              )}
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
      {/* z-index bumped from 200/201 to 1000/1001 so the modal footer
          (Cancel + Submit for Review) is never covered by the
          FloatingActionBar at the bottom of the page. The FAB's parent
          stacking context was winning the layer fight on tall screens
          where the modal's bottom edge sits behind the FAB.

          Backdrop click does NOT close the modal — too easy to lose a
          half-built order with one stray click. Operator must use
          Cancel, Save Draft, or Submit for Review explicitly. */}
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 1100, maxWidth: '96vw', maxHeight: '94vh',
        background: '#fff', borderRadius: 16, zIndex: 1001,
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <ProcessingOverlay
          visible={submitting || savingDraft}
          message={savingDraft ? 'Saving your draft' : 'Hold tight — creating your delivery order'}
          subMessage={savingDraft
            ? 'Just a moment.'
            : 'We’re generating the order, calculating zones, and pushing to DispatchTrack. This can take 5–10 seconds.'}
        />
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
                  {/* Header with collapse toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => setInventoryExpanded(v => !v)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '4px 6px', borderRadius: 6,
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontFamily: 'inherit', textAlign: 'left',
                      }}
                      title={inventoryExpanded ? 'Hide the inventory picker' : 'Show the inventory picker'}
                    >
                      {inventoryExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span style={label}>Items (from inventory, {selectedInvItems.length} selected{totalSelectedCuFt > 0 ? ` · ${totalSelectedCuFt} cuFt` : ''})</span>
                    </button>
                    {invLoading && inventoryExpanded && (
                      <span style={{ fontSize: 11, color: theme.colors.textMuted, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Loader2 size={12} className="spin" /> Loading inventory…
                      </span>
                    )}
                  </div>

                  {/* Selected-items summary — always visible (whether the
                      picker is expanded or collapsed). Table format mirrors
                      the picker columns so the operator can re-confirm
                      what's on the order without cross-referencing.
                      Trash icon per row removes without re-opening the
                      picker. */}
                  {selectedInvItems.length > 0 && (
                    <div style={{
                      marginBottom: 10,
                      background: '#FFF7ED', border: '1px solid #FED7AA',
                      borderRadius: 8, overflow: 'hidden',
                    }}>
                      <div style={{
                        padding: '10px 12px',
                        fontSize: 10, fontWeight: 700, color: '#9A3412',
                        textTransform: 'uppercase', letterSpacing: '1px',
                        borderBottom: '1px solid #FED7AA',
                      }}>
                        On this order ({selectedInvItems.length} {selectedInvItems.length === 1 ? 'item' : 'items'}{totalSelectedCuFt > 0 ? ` · ${totalSelectedCuFt} cuFt` : ''})
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{
                          width: '100%', borderCollapse: 'collapse',
                          fontSize: 12, color: theme.colors.text,
                        }}>
                          <thead>
                            <tr style={{ background: '#FFEDD5' }}>
                              <th style={{ ...summaryTh, width: 90 }}>Item ID</th>
                              <th style={{ ...summaryTh, width: 50, textAlign: 'right' }}>Qty</th>
                              <th style={{ ...summaryTh, width: 110 }}>Vendor</th>
                              <th style={summaryTh}>Description</th>
                              <th style={{ ...summaryTh, width: 110 }}>Sidemark</th>
                              <th style={{ ...summaryTh, width: 110 }}>Reference</th>
                              <th style={{ ...summaryTh, width: 32 }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedInvItems.map((it, idx) => (
                              <tr
                                key={it.itemId}
                                style={{
                                  background: idx % 2 === 0 ? '#FFFBF5' : '#FFF7ED',
                                  borderTop: idx === 0 ? 'none' : '1px solid #FFEDD5',
                                }}
                              >
                                <td style={{ ...summaryTd, fontFamily: 'monospace', fontWeight: 700, color: theme.colors.primary }}>
                                  {it.itemId}
                                </td>
                                <td style={{ ...summaryTd, textAlign: 'right', color: theme.colors.textMuted }}>
                                  {it.qty ?? 1}
                                </td>
                                <td style={{ ...summaryTd, color: theme.colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }} title={it.vendor || ''}>
                                  {it.vendor || '—'}
                                </td>
                                <td style={{ ...summaryTd, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.description || ''}>
                                  {it.description || '—'}
                                </td>
                                <td style={{ ...summaryTd, color: theme.colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }} title={it.sidemark || ''}>
                                  {it.sidemark || '—'}
                                </td>
                                <td style={{ ...summaryTd, color: theme.colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }} title={(it as { reference?: string }).reference || ''}>
                                  {(it as { reference?: string }).reference || '—'}
                                </td>
                                <td style={{ ...summaryTd, textAlign: 'center' }}>
                                  <button
                                    type="button"
                                    onClick={() => toggleItem(it.itemId)}
                                    title="Remove from order"
                                    style={{
                                      background: 'transparent', border: 'none', cursor: 'pointer',
                                      color: '#9A3412', padding: 4, borderRadius: 4,
                                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    }}
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Picker — only mounted when expanded so the modal
                      doesn't waste vertical space when the operator's
                      already done picking. */}
                  {inventoryExpanded && (
                  <>
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
                  </>
                  )}
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

          {/* Valuation Coverage — required for any item-moving order */}
          {mode !== 'service_only' && deliveryCoverageOptions.length > 0 && (
            <div style={section}>
              <div style={sectionTitle}>
                Valuation Coverage
                <span style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>
                  (required)
                </span>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {deliveryCoverageOptions.map(opt => {
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

          {/* Accessorials — collapsed by default */}
          {accessorials.length > 0 && mode !== 'service_only' && (
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
                title={addonsExpanded ? 'Hide the add-ons list' : 'Show the add-ons list'}
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
                  {isStaff && (
                    <span style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>
                      (includes staff-only options)
                    </span>
                  )}
                </div>
              </button>
              {addonsExpanded && (
              <div style={{ display: 'grid', gap: 8 }}>
                {accessorials.map(acc => {
                  const selected = isAccessorialSelected(acc.code);
                  const current = selectedAccessorials.get(acc.code);
                  const needsQuantity = acc.rateUnit === 'per_15min' || acc.rateUnit === 'per_mile' || acc.rateUnit === 'per_item' || acc.rateUnit === 'per_hour' || acc.rateUnit === 'per_day';
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
                                {acc.rateUnit === 'per_hour' && ' / hour'}
                                {acc.rateUnit === 'per_day' && ' / day'}
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
              )}
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
              {/* Always show the coverage line — even when it's the
                  free Standard tier ($0). Operators want explicit
                  confirmation that valuation is accounted for in the
                  total, not silently absent because it's free. */}
              {selectedCoverage && (
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
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexShrink: 0,
          background: '#FAFAFA',
        }}>
          {/* "What's missing" hint — shown on the left, only when the
              submit button is disabled. Listing the empty required
              fields here saves the operator from scrolling the form
              hunting for an unset field. Empty when canSubmit=true so
              the hint vanishes the moment the form is ready. */}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            {/* Discard Draft — only when editing an existing draft
                (NOT a real order). Admin/staff only. Hard-deletes the
                row + its items. Real orders should be Voided through
                their detail page, not deleted. */}
            {editingDraftRowIdRef.current && isStaff && !isEditingRealOrder && (
              <button
                type="button"
                onClick={async () => {
                  if (!editingDraftRowIdRef.current) return;
                  if (!confirm('Discard this draft? This cannot be undone.')) return;
                  try {
                    const id = editingDraftRowIdRef.current;
                    await supabase.from('dt_order_items').delete().eq('dt_order_id', id);
                    const { error } = await supabase.from('dt_orders').delete().eq('id', id);
                    if (error) throw new Error(error.message);
                    onClose();
                  } catch (e) {
                    setSubmitError(e instanceof Error ? e.message : String(e));
                  }
                }}
                style={{
                  padding: '9px 16px', borderRadius: 8,
                  border: '1px solid #FCA5A5',
                  background: '#FEF2F2', color: '#B91C1C',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
                title="Permanently delete this draft"
              >
                Discard Draft
              </button>
            )}
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
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={!canSaveDraft || savingDraft || submitting}
              title={
                !canSaveDraft && !clientSheetId
                  ? 'Pick a client first'
                  : !canSaveDraft && isEditingRealOrder
                    ? 'This is a real order, not a draft — use Save Changes instead. (Operators can\'t downgrade real orders back to drafts.)'
                    : draftSavedAt
                      ? `Last saved ${draftSavedAt.toLocaleTimeString()}`
                      : 'Save what you have so far. Pick it back up later from the Orders → Drafts list.'
              }
              style={{
                padding: '9px 18px', borderRadius: 8,
                border: `1px solid ${theme.colors.border}`,
                background: canSaveDraft && !savingDraft ? '#fff' : '#F9FAFB',
                color: canSaveDraft ? theme.colors.text : theme.colors.textMuted,
                fontSize: 13, fontWeight: 600,
                cursor: canSaveDraft && !savingDraft ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              {savingDraft ? <Loader2 size={13} className="spin" /> : null}
              {savingDraft
                ? 'Saving…'
                : draftSavedAt
                  ? `Saved ${draftSavedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                  : editingDraftRowIdRef.current
                    ? 'Update Draft'
                    : 'Save Draft'}
            </button>
            <WriteButton
              onClick={handleSubmit}
              disabled={!canSubmit}
              label={
                !editingDraftRowIdRef.current
                  ? 'Submit for Review'
                  : isEditingRealOrder
                    ? 'Save Changes'
                    : 'Promote to Review'
              }
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
      </div>
    </>
  );
}
