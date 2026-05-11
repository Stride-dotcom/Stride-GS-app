/**
 * CreateDeliveryOrderModal — Phase 2c (expanded) — v5 2026-04-30 PST
 *   v5: Customizable add-on charges. Every selected add-on now exposes
 *       editable Qty + Rate inputs (catalog rate is the default, staff/
 *       admin can override; clients can adjust qty only). Subtotal is
 *       always qty × rate so flat-rate items like Disposal can be
 *       charged for 40 pieces in one line. The per-order rate is
 *       persisted in `accessorials_json[].rate` (the column already
 *       carried this field — previously it was reset to the catalog
 *       lookup at save time). A "Modified" badge surfaces overrides
 *       to reviewers; old rows without a saved rate fall back to
 *       subtotal/qty so the form still shows the effective rate.
 *   v4: Tax-exemption awareness (Task 8a). On client select, fetch
 *       tax_exempt / reason / cert_expires / tax_rate_pct from
 *       Supabase clients. Shows a green "✓ Tax-exempt" chip for
 *       wholesale customers (the common case) or an amber "⚠ Tax
 *       applies" chip for direct-to-consumer. When non-exempt, the
 *       Pricing Summary adds a Subtotal + Sales Tax line above the
 *       Estimated Total, and order_total is now grand-total
 *       (subtotal + tax). Snapshots tax_amount / tax_rate_pct /
 *       customer_tax_exempt onto every dt_orders insert/update so
 *       the historical audit + future billing-ledger writer (Task
 *       8b) has the values frozen at order-creation time. v1 does
 *       not split per-line by service_catalog.taxable — the entire
 *       DO is treated as one taxable delivery service.
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
import { logDtOrderAudit } from '../../lib/dtOrderAudit';
import { useClients } from '../../hooks/useClients';
import { useInventory } from '../../hooks/useInventory';
import { useIsMobile } from '../../hooks/useIsMobile';
import {
  fetchDeliveryZone,
  fetchDeliveryServicesFromCatalog,
  fetchItemClassMinutes,
  type DeliveryZone,
  type DeliveryAccessorial,
} from '../../lib/supabaseQueries';
import { supabase } from '../../lib/supabase';
import { useCoverageOptions, type CoverageOption } from '../../hooks/useCoverageOptions';
import { useItemClasses } from '../../hooks/useItemClasses';
import { useServiceCatalog } from '../../hooks/useServiceCatalog';
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

// Inventory class codes ("XS", "M", "XL"…) ↔ Settings → Pricing → Classes
// rows. The Supabase `item_classes` table stores names ("Extra Small",
// "Medium", "XX-Large") + storage_size. Inventory rows store the short
// code. We derive the code from the name once per render and build a
// lookup so the modal's volume math stays synced with whatever the admin
// set in Settings (was hardcoded XS=10 / S=25 / M=50 / L=75 / XL=110, no
// XXL — drifted out of sync with the live values 5/15/45/75/100/150).
function deriveClassCode(name: string): string {
  // Take the first letter of every whitespace-separated token, then
  // collapse a leading "XX-" into "XX" so "XX-Large" → "XXL". Keeps
  // any future "Triple XL" / "Mini" additions roughly correct without
  // a hardcoded reverse map. Codes always returned uppercase to match
  // inventory.item_class storage.
  const cleaned = name.replace(/^XX-/i, 'XX ').trim();
  return cleaned
    .split(/\s+/)
    .map(w => w[0] ?? '')
    .join('')
    .toUpperCase();
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
  /** Postgres UUID of the source inventory row. Used to set
   *  dt_order_items.inventory_id (UUID FK) so OrderPage can offer
   *  Release Items on the resulting order. */
  inventoryRowId?: string;
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
  // v2026-05-09 — onSubmit's payload surfaces the client-resubmit flag
  // so OrderPage knows when to fire notify-order-revision with action
  // 'updated_by_client'. The flag is true ONLY when a client-role user
  // saves changes to a non-draft order; staff edits + draft promotes
  // never set it.
  onSubmit?: (data: { dtOrderId: string; dtIdentifier: string; reviewStatus: string; clientResubmit?: boolean }) => void;
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

// A free-text item entered on a pickup or delivery form (not linked to inventory).
// weight (lbs) and cubicFeet are optional ad-hoc estimates the operator can
// enter when there's no inventory record to derive them from. They flow into
// dt_order_items.extras so downstream pricing/load-planning can use them.
interface FreeItem {
  id: string;              // client-side uid for React key
  description: string;
  quantity: number;
  weight?: number | null;     // lbs — optional, ad-hoc only
  cubicFeet?: number | null;  // cu ft — optional, ad-hoc only
}

interface SelectedAccessorial {
  code: string;
  quantity: number;
  // Per-order rate override. Defaults to the catalog rate but the
  // operator can edit it on the order form (e.g. negotiated price,
  // bulk discount). Subtotal is always quantity × rate.
  rate: number;
  subtotal: number;
  // Free-text describing what the client needs (e.g. "assemble bed
  // only"). Captured on client-submitted orders so staff can price
  // the work during review. Persisted in accessorials_json.
  clientNotes?: string;
  // Marks the line as awaiting staff pricing — set whenever a non-
  // staff user added the accessorial. Rate/subtotal are forced to 0
  // for these; staff fill them in on the Edit Full Order pass.
  quotePending?: boolean;
}

// "Extra Piece" (per piece beyond the included quantity) used to be
// hardcoded here as INCLUDED_ITEMS=3 + EXTRA_ITEM_RATE=$25. The values
// now come from the XTRA_PC row in service_catalog so an admin can
// retune both in Settings → Pricing → Delivery without a code change.
// Constant is the lookup code only; the rate and threshold are live.
const EXTRA_PIECE_CODE = 'XTRA_PC';

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

/**
 * Inline rate cell used inside the pricing summary. Renders the dollar
 * amount as a static span for clients (read-only); for staff/admin it
 * renders a small numeric input plus a "reset" link when overridden.
 * The override state lives on the parent — this is purely a view +
 * change handler.
 *
 *   value:    the effective rate (already includes any override)
 *   override: null when the rate is auto-computed, a number when manual
 *   negative: prepends a "-" sign for the bundle-discount line
 */
function RateOverrideCell({
  value, override, onChange, canEdit, negative,
}: {
  value: number;
  override: number | null;
  onChange: (next: number | null) => void;
  canEdit: boolean;
  negative?: boolean;
}) {
  if (!canEdit) {
    return <span style={{ fontWeight: 500 }}>{negative ? '-' : ''}${value.toFixed(2)}</span>;
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
      {negative ? '-' : ''}$
      <input
        type="number" min={0} step="0.01"
        value={Number.isFinite(value) ? value : 0}
        onChange={e => {
          const raw = e.target.value;
          if (raw === '') { onChange(null); return; }
          const n = parseFloat(raw);
          onChange(Number.isFinite(n) ? n : null);
        }}
        title={override != null ? 'Manual rate — click reset to use the auto-computed rate' : 'Edit to override the auto-computed rate'}
        style={{
          width: 88, padding: '3px 6px', fontSize: 13, fontWeight: 500,
          border: `1px solid ${override != null ? '#E8692A' : '#D1D5DB'}`,
          borderRadius: 4, textAlign: 'right',
          background: override != null ? '#FFF7ED' : '#fff',
          fontFamily: 'inherit', outline: 'none',
        }}
      />
      {override != null && (
        <button
          type="button"
          onClick={() => onChange(null)}
          style={{
            fontSize: 10, color: '#E8692A', background: 'none', border: 'none',
            cursor: 'pointer', textDecoration: 'underline', padding: 0, fontFamily: 'inherit',
          }}
          title="Use the auto-computed rate"
        >
          reset
        </button>
      )}
    </span>
  );
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
// v2026-05-09 — diff helper for the client-resubmit flow.
//
// Compares a snapshot (taken at edit-modal load) against the editPayload
// about to be UPDATE'd, and returns a JSONB-shaped diff:
//   { "<column>": { "old": <prev>, "new": <curr> }, ... }
// Plus a synthetic 'items' entry when the item set changed (count or
// signature). Skips equal values, null-vs-empty-string, and synthetic
// keys (those starting with _).
//
// Stored in dt_orders.last_resubmit_diff for the OrderPage banner +
// notify-order-revision email body.
function computeResubmitDiff(
  snapshot: Record<string, unknown>,
  editPayload: Record<string, unknown>,
  newItemsSignature: string,
  newItemsCount: number,
): Record<string, { old: unknown; new: unknown }> | null {
  const diff: Record<string, { old: unknown; new: unknown }> = {};
  const norm = (v: unknown) => (v === null || v === undefined || v === '') ? null : v;
  for (const key of Object.keys(snapshot)) {
    if (key.startsWith('_')) continue; // synthetic keys handled below
    if (!Object.prototype.hasOwnProperty.call(editPayload, key)) continue;
    const prev = norm(snapshot[key]);
    const curr = norm(editPayload[key]);
    // Compare strings vs numbers via String() so '5' === 5 doesn't show
    // up as a diff for service_time_minutes / fees / etc.
    if (String(prev ?? '') !== String(curr ?? '')) {
      diff[key] = { old: prev, new: curr };
    }
  }
  // Items synthetic — flag when count or signature differs. Don't
  // commit to per-item add/remove diffing in v1; staff can scan the
  // current item list on the OrderPage. Surfacing "items changed" is
  // the load-bearing signal.
  const oldCount = Number(snapshot._items_count ?? 0);
  const oldSig   = String(snapshot._items_signature ?? '');
  if (oldCount !== newItemsCount || oldSig !== newItemsSignature) {
    diff.items = { old: { count: oldCount }, new: { count: newItemsCount } };
  }
  return Object.keys(diff).length > 0 ? diff : null;
}

export function CreateDeliveryOrderModal({
  onClose,
  onSubmit,
  preSelectedItemIds = [],
  liveItems: liveItemsProp = [],
  editOrderId = null,
}: Props) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const isStaff = user?.role === 'staff' || user?.role === 'admin';
  // Admin-only privileges. Staff can review/approve and price client
  // accessorial lines, but only admin can hand-edit the auto-computed
  // fees in the pricing summary (delivery/pickup/bundle/extra-items
  // dollar amounts) — that's a "modify-this-specific-order" override
  // and we want a clear paper trail of who can do it.
  const isAdmin = user?.role === 'admin';

  // Live item-class storage sizes (was hardcoded — see deriveClassCode notes).
  // useItemClasses subscribes to the same realtime feed Settings uses, so an
  // admin tweaking M from 45→50 in Pricing immediately re-flows through
  // every cuft calc on the open modal.
  const { classes: itemClasses } = useItemClasses();
  // Extra-piece pricing comes from the XTRA_PC service. Falls back to
  // the legacy hardcoded values (3 included, $25 each) only if the
  // service row hasn't been seeded yet — in practice it's seeded by
  // migration 20260426010000, so this never fires in production. The
  // fallback keeps behavior stable for any environment that's mid-
  // migration.
  const { services: catalogServices } = useServiceCatalog();
  const extraPieceService = useMemo(
    () => catalogServices.find(s => s.code === EXTRA_PIECE_CODE && s.active),
    [catalogServices],
  );
  const includedItems = extraPieceService?.includedQuantity ?? 3;
  const extraItemRate = extraPieceService?.flatRate ?? 25;
  const cuFtByCode = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of itemClasses) {
      if (!c.active) continue;
      const code = deriveClassCode(c.name);
      if (code && c.storageSize > 0) map.set(code, c.storageSize);
    }
    return map;
  }, [itemClasses]);
  const classToCuFt = (cls: string | undefined | null): number | null => {
    if (!cls) return null;
    return cuFtByCode.get(String(cls).trim().toUpperCase()) ?? null;
  };

  // If no liveItems were passed (modal opened from Orders page, not Inventory),
  // pull our own inventory. useInventory auto-scopes to accessible clients.
  // Force a refetch on every modal open so room/vendor/etc edits made
  // since the cached fetch flow into the order — Bundle B's "real-time
  // updates even on pushed orders" contract relies on this. Without
  // it, the operator could open a 5-minute-old cached inventory and
  // not see the room they just changed two minutes ago.
  const invHookResult = useInventory(liveItemsProp.length === 0);
  useEffect(() => {
    if (liveItemsProp.length === 0) invHookResult.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  // Client-role users can only place orders for their own account(s) — never
  // for other tenants. Default to the user's own accessible client list and
  // auto-select when there's just one.
  const accessibleClientNames = useMemo(() => {
    if (isStaff) return null; // null = no restriction
    return new Set(user?.accessibleClientNames ?? []);
  }, [isStaff, user?.accessibleClientNames]);
  const initialClientName = useMemo(() => {
    if (autoClient) return autoClient;
    if (!isStaff && user?.accessibleClientNames?.length === 1) {
      return user.accessibleClientNames[0]!;
    }
    return '';
  }, [autoClient, isStaff, user?.accessibleClientNames]);
  const [clientName, setClientName] = useState(initialClientName);
  useEffect(() => {
    if (!clientName && initialClientName) setClientName(initialClientName);
  }, [initialClientName, clientName]);
  const clientSheetId = apiClients.find(c => c.name === clientName)?.spreadsheetId || '';

  // ── Tax info for the selected client (Task 8a) ──────────────────────────
  // Most clients are wholesale resellers (tax_exempt=true) and pay no sales
  // tax. For direct-to-consumer customers we compute tax = subtotal × rate
  // and roll it into order_total. Snapshot the exemption + rate onto the
  // dt_orders row so the historical audit shows what was applied at the
  // moment of creation, even if the customer's status later changes.
  interface ClientTaxInfo {
    taxExempt: boolean;
    taxExemptReason: string | null;
    resaleCertExpires: string | null;
    resaleCertUrl: string | null;
    taxRatePct: number;
  }
  const [clientTaxInfo, setClientTaxInfo] = useState<ClientTaxInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!clientSheetId) { setClientTaxInfo(null); return; }
    supabase.from('clients')
      .select('tax_exempt, tax_exempt_reason, resale_cert_expires, resale_cert_url, tax_rate_pct')
      .eq('spreadsheet_id', clientSheetId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (!data) { setClientTaxInfo(null); return; }
        setClientTaxInfo({
          taxExempt: data.tax_exempt !== false, // default true if missing
          taxExemptReason: data.tax_exempt_reason || null,
          resaleCertExpires: data.resale_cert_expires || null,
          resaleCertUrl: data.resale_cert_url || null,
          taxRatePct: data.tax_rate_pct != null ? Number(data.tax_rate_pct) : 10.1,
        });
      });
    return () => { cancelled = true; };
  }, [clientSheetId]);

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

  // ── Ad-hoc (free-text) items for delivery mode ─────────────────────────
  // Operator can mix free-text items with warehouse inventory on a single
  // delivery order — handy for things that aren't (yet) in the catalog or
  // last-minute additions the customer asks for at booking time. Same
  // FreeItem shape as the pickup side, but weight/cubicFeet are exposed
  // as optional fields the operator can fill if known.
  const [deliveryFreeItems, setDeliveryFreeItems] = useState<FreeItem[]>([]);

  // ── Inventory item selection (delivery + warehouse-source only) ────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(preSelectedItemIds));

  // v2026-05-11 — Switching clients in the dropdown clears any item
  // selections from the prior client. Without this, selectedIds (a Set
  // of item IDs from Client A) silently persisted when the operator
  // switched to Client B — those IDs vanished from the filtered
  // activeItems list, but selectedAccessorials / qty / counts still
  // referenced them downstream. Clearing on switch matches the user's
  // mental model ("new client → start fresh") and prevents cross-tenant
  // item IDs from leaking into the order payload.
  //
  // Guard: skip the clear when `prev` is falsy. That covers both:
  //   - Initial mount (prev = null) → preSelectedItemIds from the
  //     Inventory "Create Order" path stay intact.
  //   - Empty → resolved transitions (prev = '') — including the
  //     edit-mode load path where apiClients resolves async and
  //     `setClientName(matched)` + `setSelectedIds(new Set(itemIds))`
  //     can land in the same React 18 batch. Without this, the
  //     effect would fire post-batch and wipe the just-restored
  //     itemIds because prev had already snapshotted to ''.
  //
  // A genuine user-driven dropdown switch (`'Client A' → 'Client B'`)
  // still has truthy prev so the clear fires as intended.
  //
  // Effect placed AFTER all state declarations it references —
  // TypeScript flags use-before-declaration even when the reference
  // is inside a closure that only runs post-render.
  const prevClientNameRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevClientNameRef.current;
    prevClientNameRef.current = clientName;
    if (!prev) return; // covers null (mount) + '' (pre-resolve edit-load)
    if (prev === clientName) return; // no actual change
    setSelectedIds(new Set());
    setPickupFreeItems([]);
    setDeliveryFreeItems([]);
  }, [clientName]);
  // Per-order room overrides for inventory items. Keyed by dt_item_code.
  // The inventory row carries a default room that flows in when an item
  // is selected — but the operator can override it on a per-order basis
  // (e.g. inventory says "Bedroom" but this delivery is to the new
  // primary suite). The override is what gets written to dt_order_items
  // and into the DT description ("Vendor desc — Room"); inventory is
  // not modified. Hydrated from saved dt_order_items.room on edit-load.
  const [roomOverrides, setRoomOverrides] = useState<Record<string, string>>({});
  const setRoomOverride = (itemId: string, room: string) => {
    setRoomOverrides(prev => ({ ...prev, [itemId]: room }));
  };
  // Effective room used by the save paths and the line UI: override
  // wins, otherwise the inventory row's room.
  const effectiveRoom = (itemId: string, fallback?: string | null): string => {
    const override = roomOverrides[itemId];
    if (override !== undefined) return override;
    return fallback ?? '';
  };
  // Collapse-toggle for the inventory list section. Defaults to
  // EXPANDED in two cases:
  //   1. Brand-new order (no editOrderId) — operator needs to see the
  //      list to pick anything in the first place.
  //   2. Edit Full Order opened against an existing order (editOrderId
  //      set at mount) — operator most often clicks Edit Full Order to
  //      add items that came in after the order was created (the
  //      05-11 AUB-00030 incident: operator couldn't find how to add
  //      more inventory because the picker collapsed below the chevron).
  // Defaults to COLLAPSED only when editOrderId arrives AFTER mount
  // (e.g. a brand-new draft that just got saved an id) — that flow
  // wants to settle into a compact review state.
  const [inventoryExpanded, setInventoryExpanded] = useState(true);
  // Snapshot "was this modal opened on an existing order?" at mount.
  // Drives the two auto-collapse effects below — if true, both stay
  // out of the operator's way so the picker remains expanded for the
  // entire edit session (operator can still flip it manually).
  const editAtMountRef = useRef(!!editOrderId);
  // If editOrderId arrives after mount (new draft just saved), collapse
  // for compact review. Skipped when editOrderId was already set at
  // mount (edit-from-orders-list flow stays expanded).
  const autoCollapsedInvRef = useRef(false);
  // Re-arm autoCollapsedInvRef whenever editOrderId transitions. No-op
  // when the modal was opened on an existing order (editAtMountRef.current
  // is true so the effect below bails anyway), but keeps the reset
  // semantics correct for the draft-just-saved transition.
  useEffect(() => { autoCollapsedInvRef.current = false; }, [editOrderId]);
  useEffect(() => {
    if (autoCollapsedInvRef.current) return;
    if (!editOrderId) return;
    if (editAtMountRef.current) return;
    setInventoryExpanded(false);
    autoCollapsedInvRef.current = true;
  }, [editOrderId]);
  // Auto-collapse the picker the first time selections appear so the
  // selected-items summary takes the focus. For NEW-order flow this
  // fires when the operator clicks the first checkbox. For
  // edit-from-orders-list flow, the ref is pre-armed (true) at mount
  // so the load hydrating selectedIds doesn't trigger a collapse —
  // the operator just opened Edit Full Order, they want to see the
  // picker, not have it disappear the moment their items load.
  const collapsedAfterFirstSelection = React.useRef(editAtMountRef.current);
  useEffect(() => {
    if (selectedIds.size > 0 && !collapsedAfterFirstSelection.current) {
      setInventoryExpanded(false);
      collapsedAfterFirstSelection.current = true;
    }
  }, [selectedIds.size]);
  const activeItems = useMemo(
    () => liveItems.filter(i => {
      if (i.status !== 'Active') return false;
      // v2026-05-11 — require a client match. Pre-fix `if (!clientName)
      // return true` was a pass-through fallback intended for the brief
      // window between modal mount and client resolution, but it leaked
      // ALL clients' inventory into the picker for staff/admin users
      // (whose useInventory fetch is un-scoped — useClientFilter only
      // narrows for client-role users). With no client identifier set,
      // there's no correct answer; show nothing instead of everything.
      if (!clientName && !clientSheetId) return false;
      // Match by name OR by sheet ID. Sheet ID is the authoritative
      // tenant identifier; name match is a fallback when the item row's
      // clientId is missing (legacy data) but the name canonical-matches.
      if (clientName && i.clientName === clientName) return true;
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

  // Header select-all: operates on the *currently filtered* list, so
  // the operator can search → "select all" → search again → "select
  // all" again to build up multi-criteria selections without losing
  // earlier picks. All-checked = clear, otherwise = add. Empty
  // filtered list disables the control.
  const filteredAllChecked = filteredItems.length > 0
    && filteredItems.every(i => selectedIds.has(i.itemId));
  const filteredSomeChecked = filteredItems.some(i => selectedIds.has(i.itemId));
  const toggleAllFiltered = () => {
    if (filteredItems.length === 0) return;
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (filteredAllChecked) {
        for (const i of filteredItems) n.delete(i.itemId);
      } else {
        for (const i of filteredItems) n.add(i.itemId);
      }
      return n;
    });
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
  // Phase 1: three-notes split. `details` (column dt_orders.details)
  // continues to carry the customer-facing "Order Details" text — what
  // this order involves, why it exists, what it includes. The new
  // `driverNotes` (dt_orders.driver_notes) is the public driver-facing
  // crew-on-site note (parking, gate codes, building access). The new
  // `internalNotes` (dt_orders.internal_notes) is staff-only and
  // hidden entirely from clients.
  const [driverNotes, setDriverNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');

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

  // Subtotal math per service_catalog.billing_mode:
  //   per_class — sum( classRates[item.itemClass] × item.qty ) over the
  //               order's selected inventory items. Quantity is implicit;
  //               the rate varies by item class. The stored `quantity` /
  //               `rate` fields are unused for this mode (kept for the
  //               picker UI — they re-hydrate to defaults on mode flip).
  //   per_qty   — flat_rate × quantity. Quantity is operator-editable for
  //               every per_qty service (defaults to itemCount on toggle
  //               so per-item services compute correctly without extra
  //               clicks; operator can override for hours/sqft/etc.).
  //   per_job   — flat_rate × 1, regardless of items. Quantity field is
  //               hidden in the UI.
  // Quote-required forces 0 until a real rate is entered (operator types
  // the actual amount on the order form).
  const computeAccessorialSubtotal = (
    acc: DeliveryAccessorial | undefined,
    sel: { quantity: number; rate: number } | { quantity: number; rate: number } | undefined,
    items: typeof selectedInvItems,
  ): number => {
    if (!acc || !sel) return 0;
    if (acc.quoteRequired && (!Number.isFinite(sel.rate) || sel.rate <= 0)) return 0;
    if (acc.billingMode === 'per_class') {
      let sum = 0;
      for (const it of items) {
        const cls = String(it.itemClass || 'M').toUpperCase() as keyof DeliveryAccessorial['classRates'];
        const r = acc.classRates[cls] ?? 0;
        sum += r * (Number(it.qty) || 1);
      }
      return Math.max(0, sum);
    }
    if (acc.billingMode === 'per_job') {
      return Math.max(0, sel.rate);
    }
    // per_qty
    return Math.max(0, sel.rate) * Math.max(0, sel.quantity);
  };

  const toggleAccessorial = (acc: DeliveryAccessorial, quantity: number = 1, forceRemove?: boolean) => {
    setSelectedAccessorials(prev => {
      const n = new Map(prev);
      if (forceRemove || (n.has(acc.code) && quantity <= 0)) {
        n.delete(acc.code);
        return n;
      }
      const rate = acc.rate ?? 0;
      // Default qty depends on mode. per_qty + per-item services are most
      // useful with qty seeded from itemCount so the operator doesn't have
      // to manually count pieces — they can override if needed.
      const defaultQty = acc.billingMode === 'per_qty' && (acc.rateUnit === 'per_item' || acc.rateUnit === 'flat')
        ? Math.max(1, itemCount || quantity)
        : quantity;
      // Client-submitted accessorials are quote-pending: rate/subtotal
      // forced to 0, staff price the line during review.
      if (!isStaff) {
        n.set(acc.code, { code: acc.code, quantity: defaultQty, rate: 0, subtotal: 0, quotePending: true, clientNotes: '' });
        return n;
      }
      const sel = { code: acc.code, quantity: defaultQty, rate };
      n.set(acc.code, { ...sel, subtotal: computeAccessorialSubtotal(acc, sel, selectedInvItems) });
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

  const updateAccessorialQty = (code: string, quantity: number) => {
    setSelectedAccessorials(prev => {
      const cur = prev.get(code);
      if (!cur) return prev;
      const acc = accessorials.find(a => a.code === code) || allAccessorials.find(a => a.code === code);
      // Floor at 1 to match the UI input's min — qty=0 silently zeroes
      // the subtotal which is confusing; if the user wants to drop the
      // add-on entirely they uncheck it.
      const q = Math.max(1, Math.floor(quantity));
      const sel = { ...cur, quantity: q };
      const n = new Map(prev);
      n.set(code, { ...sel, subtotal: computeAccessorialSubtotal(acc, sel, selectedInvItems) });
      return n;
    });
  };

  const updateAccessorialRate = (code: string, rate: number) => {
    setSelectedAccessorials(prev => {
      const cur = prev.get(code);
      if (!cur) return prev;
      const acc = accessorials.find(a => a.code === code) || allAccessorials.find(a => a.code === code);
      const r = Math.max(0, Number.isFinite(rate) ? rate : 0);
      const sel = { ...cur, rate: r };
      const n = new Map(prev);
      n.set(code, { ...sel, subtotal: computeAccessorialSubtotal(acc, sel, selectedInvItems) });
      return n;
    });
  };

  // Recompute per_class accessorial subtotals whenever the selected items
  // change — class rates × items can only be answered with the current
  // item list, so the cached subtotal in selectedAccessorials goes stale
  // when items are added/removed/swapped. Cheap enough to run on every
  // selection change; only writes when the resulting Map differs.
  useEffect(() => {
    setSelectedAccessorials(prev => {
      let changed = false;
      const n = new Map(prev);
      for (const [code, cur] of prev) {
        const acc = accessorials.find(a => a.code === code) || allAccessorials.find(a => a.code === code);
        if (!acc || acc.billingMode !== 'per_class') continue;
        const fresh = computeAccessorialSubtotal(acc, cur, selectedInvItems);
        if (Math.abs(fresh - (cur.subtotal ?? 0)) > 0.001) {
          n.set(code, { ...cur, subtotal: fresh });
          changed = true;
        }
      }
      return changed ? n : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInvItems, accessorials, allAccessorials]);

  const isAccessorialSelected = (code: string) => selectedAccessorials.has(code);

  // ── Pricing calculation ────────────────────────────────────────────────
  // Both legs now bill at zone.baseRate. The legacy zone.pickupRate column
  // is no longer consulted for pricing — pickup-only and P+D pickup legs
  // both use the same baseRate as a delivery in that zone. The bundle
  // discount (PD_DISCOUNT in service_catalog) makes P+D cheaper than
  // running two separate orders.
  //
  // Per-order rate overrides (admin/staff only). When set, they replace
  // the zone-derived auto rate. Used for the rare case where a quoted
  // rate doesn't match the zone (custom deal, surge pricing, etc.).
  // Hydrated on edit-load below by comparing the saved
  // base_delivery_fee against the zone-derived auto value. Clients
  // never see the edit affordance.
  const [baseFeeOverride, setBaseFeeOverride] = useState<number | null>(null);
  const [pickupLegFeeOverride, setPickupLegFeeOverride] = useState<number | null>(null);
  const [bundleDiscountOverride, setBundleDiscountOverride] = useState<number | null>(null);
  const [extraItemsFeeOverride, setExtraItemsFeeOverride] = useState<number | null>(null);
  // Set in the edit-load effect, consumed by the hydration effect that
  // runs once the zone (and pickupZone for P+D) finishes resolving.
  const savedBaseDeliveryFeeRef = useRef<number | null>(null);
  // Saved extra-items fee — applied as an override when it differs
  // from the auto-computed extraItemsFeeAuto on the loaded items.
  const savedExtraItemsFeeRef = useRef<number | null>(null);

  const baseFee = useMemo(() => {
    if (baseFeeOverride != null) return baseFeeOverride;
    if (!zone) return null;
    return zone.baseRate;
  }, [zone, baseFeeOverride]);

  // pickupLegFee: for P+D, charge the pickup zone's baseRate (same as a
  // delivery in that zone). PD_DISCOUNT below offsets this for the bundle.
  const pickupLegFee = useMemo(() => {
    if (pickupLegFeeOverride != null) return pickupLegFeeOverride;
    if (mode !== 'pickup_and_delivery') return 0;
    if (!pickupZone) return 0;
    return pickupZone.baseRate ?? 0;
  }, [mode, pickupZone, pickupLegFeeOverride]);

  // P+D bundle discount — flat amount pulled from service_catalog so staff
  // can tune it from the Price List page without a code deploy. Only
  // applied to pickup_and_delivery orders.
  const bundleDiscount = useMemo(() => {
    if (bundleDiscountOverride != null) return bundleDiscountOverride;
    if (mode !== 'pickup_and_delivery') return 0;
    const svc = catalogServices.find(s => s.code === 'PD_DISCOUNT' && s.active);
    return Number(svc?.flatRate ?? 0);
  }, [mode, catalogServices, bundleDiscountOverride]);

  // Hydrate the base-fee override on edit-load. Compares the saved
  // base_delivery_fee against the zone-derived auto value once the
  // zone(s) have loaded; if they disagree, the difference becomes the
  // override so the displayed pricing matches the saved order_total
  // — and any subsequent save preserves the manual rate. P+D attributes
  // the entire delta to baseFeeOverride (we don't know the original
  // split between base / pickup leg from a single column).
  useEffect(() => {
    const saved = savedBaseDeliveryFeeRef.current;
    if (saved == null) return;
    if (baseFeeOverride != null) return;
    if (mode === 'pickup_and_delivery') {
      const autoBase = zone?.baseRate ?? null;
      const autoPickup = pickupZone?.baseRate ?? null;
      if (autoBase == null || autoPickup == null) return;
      if (Math.abs(saved - (autoBase + autoPickup)) > 0.01) {
        setBaseFeeOverride(saved - autoPickup);
        savedBaseDeliveryFeeRef.current = null;
      } else {
        savedBaseDeliveryFeeRef.current = null;
      }
    } else {
      const autoBase = zone?.baseRate ?? null;
      if (autoBase == null) return;
      if (Math.abs(saved - autoBase) > 0.01) {
        setBaseFeeOverride(saved);
        savedBaseDeliveryFeeRef.current = null;
      } else {
        savedBaseDeliveryFeeRef.current = null;
      }
    }
  }, [zone, pickupZone, mode, baseFeeOverride]);

  const isPickupCallForQuote = mode === 'pickup_and_delivery' && pickupZip.length === 5 && pickupZone && pickupZone.baseRate == null;

  // Build dt_order_items rows for a P+D pair.
  //   • Inventory items     → DELIVERY leg only (they're already in
  //                           our warehouse, no pickup needed).
  //   • Pickup ad-hoc       → BOTH legs (picked up at the origin,
  //                           delivered to the destination — the
  //                           driver needs to see them on each card).
  //                           Stored clean on both sides; the edge
  //                           function adds the "PICK UP for Del
  //                           <id>: " prefix on the pickup-leg DT
  //                           push via buildItemDesc.
  //   • Delivery ad-hoc     → DELIVERY leg only (supplies/equipment
  //                           that joins the load at the warehouse).
  // Used by every P+D save path so all three refresh both legs
  // symmetrically.
  const buildPDItemRows = (pickupId: string, deliveryId: string): Array<Record<string, unknown>> => {
    const rows: Array<Record<string, unknown>> = [];
    for (const i of selectedInvItems) {
      const room = effectiveRoom(i.itemId, i.room);
      rows.push({
        dt_order_id: deliveryId,
        inventory_id: i.inventoryRowId ?? null,
        dt_item_code: i.itemId,
        description: i.description || '',
        quantity: i.qty || 1,
        vendor: i.vendor || null,
        class_name: i.itemClass || null,
        cubic_feet: classToCuFt(i.itemClass) ?? null,
        room: room || null,
        extras: {
          vendor: i.vendor || null,
          sidemark: i.sidemark || null,
          location: i.location || null,
          room: room || null,
          className: i.itemClass || null,
          source: 'inventory',
        },
      });
    }
    // v2026-05-11 (rev 2) — pickup ad-hoc items live on BOTH legs.
    //
    // The driver picks them up at location A and then delivers them to
    // location B, so they need to appear on BOTH DT cards. The pickup
    // leg gets them so the driver sees what to grab at the source; the
    // delivery leg gets a mirror copy so the same driver (or a later
    // one) sees what to drop off at the destination. The delivery card
    // also carries any inventory items (already at the warehouse — no
    // pickup needed) and any delivery-only ad-hoc (supplies, equipment,
    // anything that joins the load at the warehouse).
    //
    // Description format is stored CLEAN (no "PU: " prefix) on either
    // leg. The dt-push-order edge function adds a contextual prefix on
    // the pickup leg at push time via buildItemDesc — "PICK UP for Del
    // <delivery DT id>: …" so dispatch can spot pickup-leg items in DT
    // without us double-encoding the marker into the persisted row
    // (the previous rev stored "PU: …" which rendered as the doubled
    // "PICK UP for Del …: PU: …" string on the DT pickup card).
    //
    // Source markers distinguish edit-load handling:
    //   • pickup_free_text           — pickup leg's own row
    //   • pickup_free_text_delivered — delivery leg's MIRROR row
    //   • delivery_free_text         — delivery leg's own (delivery-only)
    // Edit-load reads pickupFreeItems from the pickup leg and
    // deliveryFreeItems from delivery_free_text rows only, so the
    // mirrored rows are visible to the driver in DT but invisible in
    // the delivery ad-hoc editor (which keeps the operator from
    // accidentally editing a pickup item from the wrong place).
    for (const i of pickupFreeItems) {
      const desc = i.description.trim();
      if (!desc) continue;
      const qty = Math.max(1, Number(i.quantity) || 1);
      rows.push({
        dt_order_id: pickupId,
        dt_item_code: null,
        description: desc,
        quantity: qty,
        original_quantity: qty,
        extras: { source: 'pickup_free_text' },
      });
      rows.push({
        dt_order_id: deliveryId,
        dt_item_code: null,
        description: desc,
        quantity: qty,
        original_quantity: qty,
        extras: { source: 'pickup_free_text_delivered' },
      });
    }
    for (const i of deliveryFreeItems) {
      const desc = i.description.trim();
      if (!desc) continue;
      const qty = Math.max(1, Number(i.quantity) || 1);
      const wRaw = i.weight != null ? Number(i.weight) : null;
      const cuftPerUnit = Number.isFinite(Number(i.cubicFeet)) && Number(i.cubicFeet) > 0
        ? Number(i.cubicFeet)
        : null;
      // Match the convention used by the delivery-only / pickup-only
      // adhoc-save paths (see ~line 2492 and friends):
      //   - dt_order_items.cubic_feet = per-unit × qty (total for the
      //     line, used downstream by pricing rollups)
      //   - extras.cuft = per-unit (what the editor stores + reads
      //     back; renaming would break round-trip with edit-load)
      //   - extras.weight = per-unit lbs
      // Pre-fix this stored extras.cubicFeet (wrong key) and
      // cubic_feet=per-unit (no qty multiplier), which silently lost
      // cuft on reopen AND undercounted weight/cube rollups on the
      // delivery leg of P+D orders.
      rows.push({
        dt_order_id: deliveryId,
        dt_item_code: null,
        description: desc,
        quantity: qty,
        original_quantity: qty,
        cubic_feet: cuftPerUnit != null ? cuftPerUnit * qty : null,
        extras: {
          source: 'delivery_free_text',
          weight: Number.isFinite(wRaw) && wRaw && wRaw > 0 ? wRaw : null,
          cuft: cuftPerUnit,
        },
      });
    }
    return rows;
  };

  // "Extra items" logic only applies when there are actual items.
  // Piece count is the sum of per-line quantities — NOT the row count.
  // A line "tom dixon fat stools, qty 2" is two pieces of work, not one,
  // and the customer-facing pricing + DT shipment math both bill on
  // pieces. Earlier versions counted rows for warehouse selections,
  // which under-billed any inventory item with qty>1 (the 2026-05-07
  // MRS-00047 incident: 7 rows / 8 pieces).
  const itemCount = useMemo(() => {
    if (mode === 'service_only') return 0;
    const invQty = selectedInvItems.reduce((s, i) => s + Math.max(1, Number(i.qty) || 1), 0);
    const pickupQty = pickupFreeItems
      .filter(i => i.description.trim())
      .reduce((sum, i) => sum + Math.max(1, Number(i.quantity) || 1), 0);
    const deliveryQty = deliveryFreeItems
      .filter(i => i.description.trim())
      .reduce((sum, i) => sum + Math.max(1, Number(i.quantity) || 1), 0);
    if (mode === 'delivery' && itemsSource === 'warehouse') {
      return invQty + deliveryQty;
    }
    // v2026-05-11 — P+D now sums all three: warehouse inventory +
    // pickup-leg ad-hoc + delivery-leg ad-hoc. Pre-fix only pickupQty
    // counted; deliveryFreeItems didn't exist on P+D mode.
    if (mode === 'pickup_and_delivery') return invQty + pickupQty + deliveryQty;
    return pickupQty;
  }, [mode, itemsSource, selectedInvItems, pickupFreeItems, deliveryFreeItems]);

  const extraItemsCount = Math.max(0, itemCount - includedItems);
  // P+D charges extra pieces on BOTH legs (pickup + delivery) — same items
  // get loaded once and unloaded twice from the operator's perspective, so
  // the per-piece fee is doubled.
  const extraItemsLegMultiplier = mode === 'pickup_and_delivery' ? 2 : 1;
  const extraItemsFeeAuto = extraItemsCount * extraItemRate * extraItemsLegMultiplier;
  const extraItemsFee = extraItemsFeeOverride ?? extraItemsFeeAuto;

  // Hydrate the extra-items-fee override on edit-load: if the saved
  // fee differs from what we'd auto-compute on the loaded items, the
  // delta becomes an admin override so the displayed total matches
  // the saved order_total. Same shape as the base-fee hydration
  // effect; runs once items finish loading.
  useEffect(() => {
    const saved = savedExtraItemsFeeRef.current;
    if (saved == null) return;
    if (extraItemsFeeOverride != null) return;
    // Don't lock in an override before items have loaded — extraItemsFeeAuto
    // is 0 on a fresh open until selectedIds + pickupFreeItems hydrate.
    if (extraItemsCount === 0 && saved > 0) return;
    if (Math.abs(saved - extraItemsFeeAuto) > 0.01) {
      setExtraItemsFeeOverride(saved);
    }
    savedExtraItemsFeeRef.current = null;
  }, [extraItemsFeeAuto, extraItemsCount, extraItemsFeeOverride]);

  // Hard cap: orders over MAX_PIECES need a custom quote. Above this volume
  // the per-piece tier doesn't reflect the labor / truck-space reality —
  // staff need to price these manually. Hardcoded for now; future PR can
  // surface this on the XTRA_PC service_catalog row.
  const MAX_PIECES = 20;
  const isPieceCountOverLimit = itemCount > MAX_PIECES;

  const accessorialsTotal = useMemo(
    () => Array.from(selectedAccessorials.values()).reduce((s, a) => s + a.subtotal, 0),
    [selectedAccessorials]
  );

  // Coverage applies to every order mode that physically moves items —
  // delivery, pickup, and pickup_and_delivery. service_only is excluded by
  // the surrounding `mode !== 'service_only'` checks in the JSX.
  const subtotalBeforeTax = useMemo(() => {
    if (baseFee == null) return null;
    return baseFee + pickupLegFee - bundleDiscount + extraItemsFee + accessorialsTotal + coverageCharge;
  }, [baseFee, pickupLegFee, bundleDiscount, extraItemsFee, accessorialsTotal, coverageCharge]);

  // Sales tax (Task 8a). For tax-exempt customers (the common case for this
  // 3PL — most clients are wholesale resellers) tax is always 0 and the
  // chip shows green. For non-exempt customers we apply the customer's
  // saved rate to the entire pre-tax subtotal. v1 does NOT split per-line
  // by service_catalog.taxable; the whole DO is treated as a taxable
  // delivery service. Per-line gating lands with 8b (billing-ledger writer).
  const taxAmount = useMemo(() => {
    if (subtotalBeforeTax == null) return 0;
    if (!clientTaxInfo || clientTaxInfo.taxExempt) return 0;
    const rate = clientTaxInfo.taxRatePct;
    if (!Number.isFinite(rate) || rate <= 0) return 0;
    return subtotalBeforeTax * (rate / 100);
  }, [subtotalBeforeTax, clientTaxInfo]);

  const orderTotal = useMemo(() => {
    if (subtotalBeforeTax == null) return null;
    return subtotalBeforeTax + taxAmount;
  }, [subtotalBeforeTax, taxAmount]);

  const isCallForQuote = zipForPricing.length === 5 && zone && zone.baseRate == null;

  // ── Service time calculation ──────────────────────────────────────────
  const [serviceTimeOverride, setServiceTimeOverride] = useState<number | null>(null);

  // Auto-calc service time: sum item class minutes + accessorial service minutes
  const calculatedServiceTime = useMemo(() => {
    let total = 0;
    // Item class minutes for warehouse selections (delivery + P+D both
    // pull from inventory). Ad-hoc lines have no class — fall back to
    // Medium per piece.
    if ((mode === 'delivery' && itemsSource === 'warehouse') || mode === 'pickup_and_delivery') {
      for (const item of selectedInvItems) {
        const cls = item.itemClass?.toUpperCase() || '';
        const qty = Number(item.qty) || 1;
        total += (classMinutesMap[cls] || 0) * qty;
      }
    }
    if (mode === 'delivery' && itemsSource === 'warehouse') {
      for (const item of deliveryFreeItems) {
        if (!item.description.trim()) continue;
        const qty = Math.max(1, Number(item.quantity) || 1);
        total += (classMinutesMap['M'] || 10) * qty;
      }
    }
    if (mode === 'pickup' || mode === 'pickup_and_delivery') {
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
  }, [mode, itemsSource, selectedInvItems, pickupFreeItems, deliveryFreeItems, selectedAccessorials, classMinutesMap, accessorials, allAccessorials]);

  const effectiveServiceTime = serviceTimeOverride ?? calculatedServiceTime;

  // Total volume (cubic feet) — sums warehouse inventory volume plus any
  // operator-supplied cubicFeet on ad-hoc lines (skipped if blank).
  const totalVolume = useMemo(() => {
    let total = 0;
    // Warehouse inventory volume: included for delivery+warehouse and
    // for P+D (which can mix warehouse + pickup-leg ad-hoc items).
    if ((mode === 'delivery' && itemsSource === 'warehouse') || mode === 'pickup_and_delivery') {
      total += selectedInvItems.reduce((sum, i) => {
        const cuFt = classToCuFt(i.itemClass);
        const qty = Number(i.qty) || 1;
        return sum + (cuFt != null ? cuFt * qty : 0);
      }, 0);
    }
    // Ad-hoc delivery lines carry an optional cubicFeet field.
    if (mode === 'delivery' && itemsSource === 'warehouse') {
      total += deliveryFreeItems.reduce((sum, i) => {
        if (!i.description.trim()) return sum;
        const cuFt = Number(i.cubicFeet);
        if (!Number.isFinite(cuFt) || cuFt <= 0) return sum;
        const qty = Math.max(1, Number(i.quantity) || 1);
        return sum + cuFt * qty;
      }, 0);
    }
    return total;
  }, [mode, itemsSource, selectedInvItems, deliveryFreeItems]);

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
      // Pickup-only requires a pickup line. P+D is satisfied as long
      // as the order has SOMETHING to move — pickup items, warehouse
      // items, or both. (Customer might just want us to deliver from
      // storage and grab one thing along the way, or vice versa.)
      if (mode === 'pickup' && !hasPickupItems) return false;
      // v2026-05-11 — P+D now has THREE potential item sources:
      // warehouse inventory, pickup ad-hoc lines, OR delivery ad-hoc
      // lines (new independent list). Require at least one of them.
      // Pre-fix the gate only checked pickup + inventory and would
      // block submit on a "delivery-only ad-hoc + grab nothing on the
      // way" P+D order even though the operator clearly had something
      // to deliver.
      const hasDeliveryAdhoc = deliveryFreeItems.some(i => i.description.trim());
      if (mode === 'pickup_and_delivery' && !hasPickupItems && selectedInvItems.length === 0 && !hasDeliveryAdhoc) return false;
    }
    if (needsDelivery) {
      if (!deliveryContactName.trim() || !deliveryAddress.trim() || !deliveryCity.trim() || !deliveryZip.trim()) return false;
      // For delivery-only with warehouse source, require either an inventory
      // selection OR at least one filled-out ad-hoc line item.
      if (mode === 'delivery' && itemsSource === 'warehouse') {
        const hasAdhoc = deliveryFreeItems.some(i => i.description.trim());
        if (selectedInvItems.length === 0 && !hasAdhoc) return false;
      }
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
    itemsSource, selectedInvItems, deliveryFreeItems,
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
      const hasPickupItems = pickupFreeItems.some(i => i.description.trim());
      if (mode === 'pickup' && !hasPickupItems) out.push('at least one pickup item');
      const hasDeliveryAdhocMF = deliveryFreeItems.some(i => i.description.trim());
      if (mode === 'pickup_and_delivery' && !hasPickupItems && selectedInvItems.length === 0 && !hasDeliveryAdhocMF) {
        out.push('at least one item (pickup, delivery, or from warehouse)');
      }
    }
    if (needsDelivery) {
      if (!deliveryContactName.trim()) out.push('recipient name');
      if (!deliveryAddress.trim())     out.push('delivery address');
      if (!deliveryCity.trim())        out.push('delivery city');
      if (!deliveryZip.trim())         out.push('delivery ZIP');
      if (mode === 'delivery' && itemsSource === 'warehouse') {
        const hasAdhoc = deliveryFreeItems.some(i => i.description.trim());
        if (selectedInvItems.length === 0 && !hasAdhoc) {
          out.push('at least one item (inventory or ad-hoc)');
        }
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
    itemsSource, selectedInvItems, deliveryFreeItems, selectedCoverage, declaredValue,
  ]);

  // ── Order number generation ────────────────────────────────────────────
  // Format: PREFIX-00001-ClientReference  (with -P/-D suffixes for P+D)
  // PREFIX = first 3 uppercase chars of client name
  // 00001  = global auto-increment from dt_order_number_seq
  // ClientReference = the PO/Reference field value (spaces → dashes)
  //
  // Shared private helper: pulls the next sequence number once and
  // builds a base identifier. P+D callers then append -P and -D in
  // lockstep so both legs share the same MRS-NNNNN root and the pair
  // is easy to spot in any list. Single-leg callers append their own
  // suffix (or none).
  const buildOrderNumberBase = async (): Promise<string> => {
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
    const ref = poNumber.trim().replace(/\s+/g, '-');
    return ref ? `${prefix}-${seqNum}-${ref}` : `${prefix}-${seqNum}`;
  };

  const generateOrderNumber = async (suffix?: string): Promise<string> => {
    const base = await buildOrderNumberBase();
    return suffix ? `${base}-${suffix}` : base;
  };

  // P+D pair generator. ONE call to next_order_number → both legs get
  // the same MRS-NNNNN root. Fixes the 2026-05-07 incident where each
  // pair burned through two sequence numbers (e.g. MRS-00046-P paired
  // with MRS-00047-D) — visually disconnected in the orders list and
  // confusing for staff trying to spot the pair.
  const generateLinkedOrderNumbers = async (): Promise<{ pickup: string; delivery: string }> => {
    const base = await buildOrderNumberBase();
    return { pickup: `${base}-P`, delivery: `${base}-D` };
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
  // v2026-05-09 — captured alongside the original review_status. When a
  // client edits a non-draft order, the save-changes path appends a
  // "Updated by [name] on [date]" stamp to review_notes WITHOUT
  // discarding any prior reviewer notes. Loaded in the same effect
  // that populates originalReviewStatusRef.
  const originalReviewNotesRef = useRef<string | null>(null);
  // v2026-05-09 — snapshot of the loaded order row + items at edit-time.
  // Used by the client-resubmit save path to compute a field-level diff
  // (last_resubmit_diff). Includes scalar dt_orders columns the modal
  // can edit, plus an items_signature string that captures the item set
  // (concatenated dt_item_code|qty|description) so we can flag "items
  // changed" without committing to per-item add/remove diffing for v1.
  const originalOrderSnapshotRef = useRef<Record<string, unknown> | null>(null);
  // Captured during the edit-order load; consumed by the late-
  // resolve effect below once apiClients populates so the Client
  // field doesn't blank out when Edit Full Order opens before
  // apiClients has loaded.
  const pendingTenantIdRef = useRef<string | null>(null);
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
        // v2026-05-04 — DT→App reconcile soft-marks items removed by DT.
        // Edit modal hides those so the operator never republishes a
        // ghost line item to DT after editing.
        .is('dt_order_items.removed_at', null)
        .eq('id', editOrderId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !row) {
        setSubmitError(`Could not load order: ${error?.message || 'not found'}`);
        return;
      }
      let r = row as Record<string, unknown>;
      // v2026-05-11 — capture the pickup leg's own items so the P+D
      // edit path can split ad-hoc lines into pickupFreeItems (from
      // the pickup leg) vs. deliveryFreeItems (from the delivery
      // leg). Populated in two paths:
      //   Path A — pickup-opened-then-swapped: pickup items live on
      //   the originally-loaded `row.dt_order_items`. Capture BEFORE
      //   the swap-to-delivery overwrites r.
      //   Path B — delivery-opened: the linked-fetch at the contact-
      //   stash block below pulls pickup contacts; we extend its
      //   SELECT to also include dt_order_items.
      let pickupLegItems: Array<Record<string, unknown>> = [];
      // Pickup-leg-of-P+D detection. When the user opens a pickup row
      // that's half of a P+D pair (order_type='pickup' AND
      // linked_order_id points at a delivery leg), the modal needs
      // to behave exactly like opening the delivery leg — same
      // unified P+D form, same pricing on the delivery row only.
      // We swap r to the delivery row but stash the originally-
      // opened pickup contacts first so they don't get clobbered by
      // the delivery-side branch below. Without this swap the
      // operator was getting a single-leg pickup view (with its own
      // standalone pricing) which was the 2026-05-07 double-bill
      // bug — saving from that view stamped a real fee onto the
      // pickup leg even though P+D billing is supposed to live
      // entirely on the delivery leg.
      const initialOrderType = String(r.order_type || '');
      if (initialOrderType === 'pickup' && r.linked_order_id) {
        const pickupContacts = {
          name: r.contact_name,
          address: r.contact_address,
          city: r.contact_city,
          state: r.contact_state,
          zip: r.contact_zip,
          phone: r.contact_phone,
          phone2: r.contact_phone2,
          email: r.contact_email,
        };
        // Path A — capture pickup items BEFORE we overwrite r.
        pickupLegItems = Array.isArray(r.dt_order_items)
          ? (r.dt_order_items as Array<Record<string, unknown>>)
          : [];
        const pickupLegRowId = String(r.id || '');
        const { data: deliveryRow } = await supabase
          .from('dt_orders')
          .select('*, dt_order_items(*)')
          .is('dt_order_items.removed_at', null)
          .eq('id', r.linked_order_id as string)
          .maybeSingle();
        if (cancelled) return;
        if (deliveryRow) {
          r = deliveryRow as Record<string, unknown>;
          editingDraftRowIdRef.current = String(r.id || '');
          editingPickupRowIdRef.current = pickupLegRowId;
          // Pre-apply pickup contacts now; the delivery-side branch
          // below will set delivery contacts independently.
          if (pickupContacts.name)    setPickupContactName(pickupContacts.name as string);
          if (pickupContacts.address) setPickupAddress(pickupContacts.address as string);
          if (pickupContacts.city)    setPickupCity(pickupContacts.city as string);
          if (pickupContacts.state)   setPickupState(pickupContacts.state as string);
          if (pickupContacts.zip)     setPickupZip(pickupContacts.zip as string);
          if (pickupContacts.phone)   setPickupPhone(pickupContacts.phone as string);
          if (pickupContacts.phone2)  setPickupPhone2(pickupContacts.phone2 as string);
          if (pickupContacts.email)   setPickupEmail(pickupContacts.email as string);
        }
      }
      // Capture the loaded row's review_status — drives whether
      // submit promotes (draft → real order) or just saves changes.
      originalReviewStatusRef.current = (r.review_status as string) || null;
      // Capture review_notes for the client-resubmit audit-trail
      // append (preserves prior reviewer notes alongside the new stamp).
      originalReviewNotesRef.current  = (r.review_notes as string) || null;
      // v2026-05-09 — snapshot the loaded order's editable scalar fields
      // + a stable item signature for the client-resubmit diff. Only
      // columns the modal can mutate are captured — order_total,
      // accessorials, etc. are derived/recomputed and would produce
      // noisy diffs that aren't useful to staff.
      const loadedItems = Array.isArray((r as Record<string, unknown>).dt_order_items)
        ? ((r as { dt_order_items: Array<Record<string, unknown>> }).dt_order_items)
        : [];
      const itemsSignature = loadedItems
        .map(it => `${String(it.dt_item_code ?? it.inventory_id ?? '')}|${String(it.quantity ?? '')}|${String(it.description ?? '')}`)
        .sort()
        .join('§');
      originalOrderSnapshotRef.current = {
        local_service_date: r.local_service_date ?? null,
        window_start_local: r.window_start_local ?? null,
        window_end_local:   r.window_end_local ?? null,
        po_number:          r.po_number ?? null,
        sidemark:           r.sidemark ?? null,
        details:            r.details ?? null,
        driver_notes:       r.driver_notes ?? null,
        contact_name:       r.contact_name ?? null,
        contact_address:    r.contact_address ?? null,
        contact_city:       r.contact_city ?? null,
        contact_state:      r.contact_state ?? null,
        contact_zip:        r.contact_zip ?? null,
        contact_phone:      r.contact_phone ?? null,
        contact_phone2:     r.contact_phone2 ?? null,
        contact_email:      r.contact_email ?? null,
        billing_method:     r.billing_method ?? null,
        service_time_minutes: r.service_time_minutes ?? null,
        order_type:         r.order_type ?? null,
        coverage_option_id: r.coverage_option_id ?? null,
        declared_value:     r.declared_value ?? null,
        // synthetic keys (not real columns) — drive the items entry in the diff
        _items_count:     loadedItems.length,
        _items_signature: itemsSignature,
      };
      // Stash the saved base_delivery_fee for the override-hydration
      // effect below — it can't run yet because the zone hasn't loaded.
      const savedBaseFee = r.base_delivery_fee != null ? Number(r.base_delivery_fee) : null;
      savedBaseDeliveryFeeRef.current = Number.isFinite(savedBaseFee) ? savedBaseFee : null;
      // Hydrate the extra-items override if the saved fee differs
      // from the auto-computed value. Set straight to state because
      // there's no zone dependency — extraItemsFee is purely a
      // function of itemCount × rate × legMultiplier, and we know
      // those at load time once items hydrate. Done in a second
      // useEffect below to wait for items.
      const savedExtraFee = r.extra_items_fee != null ? Number(r.extra_items_fee) : null;
      savedExtraItemsFeeRef.current = Number.isFinite(savedExtraFee) ? savedExtraFee : null;
      forceUpdateForRefs(t => t + 1);
      // Restore the client selection from the saved tenant_id by
      // resolving the matching apiClients name. Without this, the
      // clientName state stayed empty and the modal blanked the
      // Client field every time Edit Full Order opened — and
      // because clientSheetId derives from clientName (line 578),
      // every "Still needed before submit: client" check fired and
      // Save Changes was disabled.
      //
      // Stash the tenant_id so a follow-up effect can resolve it
      // once apiClients finishes loading. Without that, opening
      // Edit before clients arrived left the field blank forever.
      if (r.tenant_id) {
        pendingTenantIdRef.current = r.tenant_id as string;
        const matched = apiClients.find(c => c.spreadsheetId === r.tenant_id)?.name;
        if (matched) setClientName(matched);
      }
      // Restore high-level mode + source first so dependent UI mounts.
      const ot = (r.order_type as string) || 'delivery';
      setMode(ot === 'pickup' || ot === 'delivery' || ot === 'service_only' || ot === 'pickup_and_delivery' ? ot : 'delivery');
      // Common fields
      if (r.po_number)              setPoNumber(r.po_number as string);
      if (r.sidemark)               setSidemark(r.sidemark as string);
      if (r.details)                setDetails(r.details as string);
      if (r.driver_notes)           setDriverNotes(r.driver_notes as string);
      if (r.internal_notes)         setInternalNotes(r.internal_notes as string);
      if (r.local_service_date)     setServiceDate(r.local_service_date as string);
      // Postgres `time` columns serialize as 'HH:MM:SS' but the dropdown
      // options use 'HH:MM' — slicing the seconds off lets the <select>
      // match the saved value instead of falling back to "— None —".
      if (r.window_start_local)     setWindowStart(String(r.window_start_local).slice(0, 5));
      if (r.window_end_local)       setWindowEnd(String(r.window_end_local).slice(0, 5));
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
          // v2026-05-11 — Path B: also pull the pickup leg's
          // dt_order_items so the ad-hoc split below can hydrate
          // pickupFreeItems from the PICKUP row (not the delivery row,
          // which now only carries delivery ad-hoc).
          const { data: pickupRow } = await supabase
            .from('dt_orders')
            .select('id, contact_name, contact_address, contact_city, contact_state, contact_zip, contact_phone, contact_phone2, contact_email, dt_order_items(*)')
            .is('dt_order_items.removed_at', null)
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
            pickupLegItems = Array.isArray(p.dt_order_items)
              ? (p.dt_order_items as Array<Record<string, unknown>>)
              : [];
          }
        } catch (_) { /* tolerate — pickup leg edit will be unavailable */ }
      }
      // Items: warehouse-source selections come from dt_order_items.
      // Rows with a non-null dt_item_code are inventory selections; rows
      // with dt_item_code=null + extras.source='delivery_free_text' are
      // ad-hoc lines and should hydrate the free-item editor instead.
      const items = Array.isArray(r.dt_order_items) ? (r.dt_order_items as Array<Record<string, unknown>>) : [];
      const itemIds = items
        .map(it => String(it.dt_item_code || '').trim())
        .filter(Boolean);
      if (itemIds.length > 0) setSelectedIds(new Set(itemIds));
      // Per-line room values are intentionally NOT hydrated from saved
      // dt_order_items here. The room (along with vendor/sidemark/etc)
      // flows live from the current inventory row each time the modal
      // opens — that's the explicit Bundle B contract: edit room in
      // inventory, reopen any order containing that item, and the new
      // room is what gets shown + persisted on the next save (and on
      // the next Save & Resync to DT). If the operator wants a per-
      // order override that survives across reopens, they edit the
      // Room column on the line during this session — that creates a
      // roomOverrides entry that the save path uses.
      if (ot === 'delivery') {
        const adhoc: FreeItem[] = items
          .filter(it => {
            const code = String(it.dt_item_code || '').trim();
            if (code) return false;
            const ex = (it.extras && typeof it.extras === 'object' ? it.extras : {}) as Record<string, unknown>;
            return ex.source === 'delivery_free_text';
          })
          .map(it => {
            const ex = (it.extras && typeof it.extras === 'object' ? it.extras : {}) as Record<string, unknown>;
            const qtyN = Number(it.quantity);
            const wRaw = Number(ex.weight);
            const cuftRaw = Number(ex.cuft);
            return {
              id: genUid(),
              description: String(it.description || ''),
              quantity: Number.isFinite(qtyN) && qtyN > 0 ? qtyN : 1,
              weight: Number.isFinite(wRaw) && wRaw > 0 ? wRaw : null,
              cubicFeet: Number.isFinite(cuftRaw) && cuftRaw > 0 ? cuftRaw : null,
            };
          });
        if (adhoc.length > 0) setDeliveryFreeItems(adhoc);
      } else if (ot === 'pickup_and_delivery') {
        // v2026-05-11 (rev 2) — P+D ad-hoc model:
        //   - pickupFreeItems  ← pickup leg ad-hoc rows
        //                        (source='pickup_free_text' or unset
        //                        on legacy; "PU: " desc prefix stripped
        //                        for back-compat with rows saved by
        //                        the pre-rev-2 build).
        //   - deliveryFreeItems ← delivery leg ad-hoc rows with
        //                        source='delivery_free_text' only.
        //                        The delivery leg ALSO carries mirror
        //                        copies of every pickup ad-hoc item
        //                        (source='pickup_free_text_delivered',
        //                        and on legacy P+D rows just
        //                        'pickup_free_text' since the old
        //                        duplicate-to-both-legs model didn't
        //                        distinguish). Those don't enter
        //                        deliveryFreeItems — they're managed
        //                        on the pickup side and re-mirrored on
        //                        every save by buildPDItemRows.
        const pickupAdhoc: FreeItem[] = pickupLegItems
          .filter(it => {
            if (String(it.dt_item_code || '').trim()) return false;
            const ex = (it.extras && typeof it.extras === 'object' ? it.extras : {}) as Record<string, unknown>;
            // Symmetric with the delivery filter below — only include
            // rows that are unambiguously pickup ad-hoc. Untagged
            // legacy rows match (older saves didn't always set
            // extras.source). A row tagged 'pickup_free_text_delivered'
            // would mean a delivery-leg mirror landed on the pickup
            // leg by accident — exclude it rather than silently
            // surfacing in the editor.
            const src = ex.source;
            return src === undefined || src === null || src === '' || src === 'pickup_free_text';
          })
          .map(it => {
            const qtyN = Number(it.quantity);
            const ex = (it.extras && typeof it.extras === 'object' ? it.extras : {}) as Record<string, unknown>;
            const wRaw = Number(ex.weight);
            const cuftRaw = Number(ex.cuft);
            const desc = String(it.description || '');
            // Strip a legacy "PU: " prefix. Rev 2 stops adding it on
            // save (the edge function now adds a contextual "PICK UP
            // for Del <id>: " prefix at push time); rows saved under
            // earlier builds still carry it and we don't want it
            // showing up in the editor.
            const cleanDesc = desc.startsWith('PU: ') ? desc.slice(4) : desc;
            return {
              id: genUid(),
              description: cleanDesc,
              quantity: Number.isFinite(qtyN) && qtyN > 0 ? qtyN : 1,
              weight: Number.isFinite(wRaw) && wRaw > 0 ? wRaw : null,
              cubicFeet: Number.isFinite(cuftRaw) && cuftRaw > 0 ? cuftRaw : null,
            };
          });
        if (pickupAdhoc.length > 0) setPickupFreeItems(pickupAdhoc);
        const deliveryAdhoc: FreeItem[] = items
          .filter(it => {
            if (String(it.dt_item_code || '').trim()) return false;
            const ex = (it.extras && typeof it.extras === 'object' ? it.extras : {}) as Record<string, unknown>;
            // Only true delivery-only ad-hoc here. Mirror copies of
            // pickup ad-hoc carry source='pickup_free_text_delivered'
            // (new) or 'pickup_free_text' (legacy duplicate-to-both-
            // legs orders); both are excluded.
            return ex.source === 'delivery_free_text';
          })
          .map(it => {
            const ex = (it.extras && typeof it.extras === 'object' ? it.extras : {}) as Record<string, unknown>;
            const qtyN = Number(it.quantity);
            const wRaw = Number(ex.weight);
            // Read both cuft keys for back-compat: new writes use
            // extras.cuft (per-unit); a brief in-progress version of
            // this PR wrote extras.cubicFeet before review caught the
            // mismatch with the rest of the codebase. Either survives
            // a reopen.
            const cuftRaw = Number.isFinite(Number(ex.cuft)) ? Number(ex.cuft) : Number(ex.cubicFeet);
            return {
              id: genUid(),
              description: String(it.description || ''),
              quantity: Number.isFinite(qtyN) && qtyN > 0 ? qtyN : 1,
              weight: Number.isFinite(wRaw) && wRaw > 0 ? wRaw : null,
              cubicFeet: Number.isFinite(cuftRaw) && cuftRaw > 0 ? cuftRaw : null,
            };
          });
        if (deliveryAdhoc.length > 0) setDeliveryFreeItems(deliveryAdhoc);
      } else if (ot === 'pickup') {
        // Standalone pickup-only (not part of a P+D pair — those get
        // swapped to delivery above before we reach this branch).
        // Loads ad-hoc lines from the pickup row's own items.
        const adhoc: FreeItem[] = items
          .filter(it => !String(it.dt_item_code || '').trim())
          .map(it => {
            const qtyN = Number(it.quantity);
            const desc = String(it.description || '');
            const cleanDesc = desc.startsWith('PU: ') ? desc.slice(4) : desc;
            return {
              id: genUid(),
              description: cleanDesc,
              quantity: Number.isFinite(qtyN) && qtyN > 0 ? qtyN : 1,
              weight: null,
              cubicFeet: null,
            };
          });
        if (adhoc.length > 0) setPickupFreeItems(adhoc);
      }
      // Accessorials JSON. Older rows were saved without a per-order rate
      // — fall back to qty>0 ? subtotal/qty : 0 so the rate input shows the
      // effective rate that produced the saved subtotal.
      const accs = Array.isArray(r.accessorials_json) ? (r.accessorials_json as Array<{ code: string; quantity: number; rate?: number; subtotal: number; clientNotes?: string | null; quotePending?: boolean }>) : [];
      if (accs.length > 0) {
        const m = new Map<string, SelectedAccessorial>();
        for (const a of accs) {
          const qty = Number(a.quantity) || 0;
          const rate = Number.isFinite(a.rate) ? Number(a.rate) : (qty > 0 ? Number(a.subtotal) / qty : 0);
          m.set(a.code, {
            code: a.code, quantity: qty, rate, subtotal: Number(a.subtotal) || 0,
            clientNotes: a.clientNotes ?? '',
            quotePending: !!a.quotePending,
          });
        }
        setSelectedAccessorials(m);
      }
      // Service description (service_only mode)
      if (ot === 'service_only' && r.details) setServiceDescription(r.details as string);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editOrderId]);

  // Late-resolve the client name when apiClients finishes loading
  // AFTER the edit-order load already ran. The load effect above
  // tries to match the tenant_id against apiClients on mount, but
  // when the modal opens during the apiClients fetch the list is
  // still empty and the match silently fails. This effect re-runs
  // whenever apiClients changes; it stops trying once a name has
  // been set so it doesn't fight operator edits.
  useEffect(() => {
    if (!pendingTenantIdRef.current || clientName) return;
    if (apiClients.length === 0) return;
    const matched = apiClients.find(c => c.spreadsheetId === pendingTenantIdRef.current)?.name;
    if (matched) {
      setClientName(matched);
      pendingTenantIdRef.current = null;
    }
  }, [apiClients, clientName]);

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
        rate: a.rate,
        subtotal: a.subtotal,
        clientNotes: a.clientNotes ?? null,
        quotePending: !!a.quotePending,
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
          driver_notes: driverNotes.trim() || null,
          internal_notes: internalNotes.trim() || null,
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
          // Pickup leg of P+D NEVER bills standalone — every charge
          // lives on the delivery leg. Explicitly null/zero each
          // pricing column so an UPDATE here can't leave stale
          // values behind from a prior single-leg-pickup save.
          base_delivery_fee: null,
          extra_items_count: 0,
          extra_items_fee: 0,
          accessorials_json: null,
          accessorials_total: null,
          coverage_charge: null,
          tax_amount: null,
          tax_rate_pct: null,
          customer_tax_exempt: null,
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
          // Refresh items on BOTH legs. The pre-fix code only deleted
          // and reinserted on the delivery leg, which silently stranded
          // any pickup-leg items written by the original create-new
          // submit (the 2026-05-07 MRS-00046-P / MRS-00048-P incident).
          // Throw on delete failure — RLS silently dropping the delete
          // was the root cause of "edit doubles items every save"
          // before the dt_order_items_delete_* policies landed.
          {
            const { error: delDErr } = await supabase.from('dt_order_items')
              .delete().eq('dt_order_id', editingDraftRowIdRef.current);
            if (delDErr) throw new Error(`P+D draft items delete (delivery) failed: ${delDErr.message}`);
            const { error: delPErr } = await supabase.from('dt_order_items')
              .delete().eq('dt_order_id', editingPickupRowIdRef.current);
            if (delPErr) throw new Error(`P+D draft items delete (pickup) failed: ${delPErr.message}`);
          }
          const pdItemRows = buildPDItemRows(editingPickupRowIdRef.current, editingDraftRowIdRef.current);
          if (pdItemRows.length > 0) {
            const { error: iErr } = await supabase.from('dt_order_items').insert(pdItemRows);
            if (iErr) throw new Error(`P+D draft items insert failed: ${iErr.message}`);
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
          // Items on BOTH legs (inventory → delivery, ad-hoc free-text
          // → both, with "PU: " prefix on the pickup leg).
          const pdItemRows = buildPDItemRows(pickupId, deliveryId);
          if (pdItemRows.length > 0) {
            const { error: iErr } = await supabase.from('dt_order_items').insert(pdItemRows);
            if (iErr) throw new Error(`P+D draft items insert failed: ${iErr.message}`);
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

      // Build the combined items list (inventory + ad-hoc) once so the
      // INSERT and UPDATE branches stay in sync. Handles both
      // delivery+warehouse (selectedInvItems + deliveryFreeItems) and
      // pickup-only (pickupFreeItems). service_only and the P+D
      // branches use buildPDItemRows or skip items entirely.
      const buildDeliveryDraftItems = (orderId: string) => {
        if (mode === 'service_only') return [] as Array<Record<string, unknown>>;
        if (mode === 'pickup') {
          return pickupFreeItems
            .filter(i => i.description.trim())
            .map(i => {
              const qty = Math.max(1, Number(i.quantity) || 1);
              return {
                dt_order_id: orderId,
                dt_item_code: null,
                description: i.description.trim(),
                quantity: qty,
                original_quantity: qty,
                extras: { source: 'pickup_free_text' },
              };
            });
        }
        if (mode !== 'delivery' || itemsSource !== 'warehouse') return [] as Array<Record<string, unknown>>;
        const invRows = selectedInvItems.map(i => {
          const room = effectiveRoom(i.itemId, i.room);
          return {
            dt_order_id: orderId,
            inventory_id: i.inventoryRowId ?? null,
            dt_item_code: i.itemId,
            description: i.description || '',
            quantity: i.qty || 1,
            vendor: i.vendor || null,
            class_name: i.itemClass || null,
            cubic_feet: classToCuFt(i.itemClass) ?? null,
            room: room || null,
            extras: {
              vendor: i.vendor || null,
              sidemark: i.sidemark || null,
              location: i.location || null,
              room: room || null,
              className: i.itemClass || null,
              source: 'inventory',
            },
          };
        });
        const adhocRows = deliveryFreeItems
          .filter(i => i.description.trim())
          .map(i => {
            const qty = Math.max(1, Number(i.quantity) || 1);
            const weight = Number.isFinite(Number(i.weight)) && Number(i.weight) > 0 ? Number(i.weight) : null;
            const cuFtPerUnit = Number.isFinite(Number(i.cubicFeet)) && Number(i.cubicFeet) > 0 ? Number(i.cubicFeet) : null;
            return {
              dt_order_id: orderId,
              dt_item_code: null,
              description: i.description.trim(),
              quantity: qty,
              cubic_feet: cuFtPerUnit != null ? cuFtPerUnit * qty : null,
              extras: { source: 'delivery_free_text', weight, cuft: cuFtPerUnit },
            };
          });
        return [...invRows, ...adhocRows];
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
        // Throw on delete failure — see P+D branch above for context.
        {
          const { error: delErr } = await supabase.from('dt_order_items')
            .delete().eq('dt_order_id', editingDraftRowIdRef.current);
          if (delErr) throw new Error(`Single-leg draft items delete failed: ${delErr.message}`);
        }
        const draftItems = buildDeliveryDraftItems(editingDraftRowIdRef.current);
        if (draftItems.length > 0) {
          await supabase.from('dt_order_items').insert(draftItems);
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
        const draftItems = buildDeliveryDraftItems(editingDraftRowIdRef.current);
        if (draftItems.length > 0) {
          await supabase.from('dt_order_items').insert(draftItems);
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

    // Tax snapshot fields written to every dt_orders insert/update so the
    // order row is self-describing for audit + downstream billing (Task 8b).
    // tax_amount is null (rather than 0) when the customer is exempt — the
    // billing-ledger writer can short-circuit on null without doing math.
    const taxFields = {
      tax_amount: clientTaxInfo && !clientTaxInfo.taxExempt ? taxAmount : null,
      tax_rate_pct: clientTaxInfo ? clientTaxInfo.taxRatePct : null,
      customer_tax_exempt: clientTaxInfo ? clientTaxInfo.taxExempt : null,
    };

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
          rate: a.rate,
          subtotal: a.subtotal,
          clientNotes: a.clientNotes ?? null,
          quotePending: !!a.quotePending,
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
          driver_notes: driverNotes.trim() || null,
          internal_notes: internalNotes.trim() || null,
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
          // Pickup leg of P+D NEVER bills standalone — wipe any
          // pricing that might have been written by a prior single-
          // leg-pickup save (the 2026-05-07 double-bill scenario).
          base_delivery_fee: null,
          extra_items_count: 0,
          extra_items_fee: 0,
          accessorials_json: null,
          accessorials_total: null,
          coverage_option_id: null,
          declared_value: null,
          coverage_charge: null,
          tax_amount: null,
          tax_rate_pct: null,
          customer_tax_exempt: null,
          order_total: null,
          pricing_override: true,
          pricing_notes: 'Pickup leg of linked pickup+delivery — pricing rolled into delivery order.',
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
          ...taxFields,
        };
        // Promote → both legs get fresh real identifiers + flip status.
        // ONE seq increment for the pair so -P and -D share the same root.
        if (wasDraftPD) {
          const pair = await generateLinkedOrderNumbers();
          pickupEdit.dt_identifier = pair.pickup;
          pickupEdit.review_status = (user?.role === 'admin' || user?.role === 'staff') ? 'approved' : 'pending_review';
          deliveryEdit.dt_identifier = pair.delivery;
          deliveryEdit.review_status = (user?.role === 'admin' || user?.role === 'staff') ? 'approved' : 'pending_review';
        }
        // v2026-05-09 — client save-changes on a non-draft P+D order
        // flips both legs back to 'pending_review' and stamps review_notes
        // on the delivery leg (the "primary" leg in our P+D model — it's
        // the one the OrderPage navigates to). Mirrors single-leg behaviour.
        const isClientResubmittingPD = !wasDraftPD
          && user?.role === 'client'
          && !!originalReviewStatusRef.current
          && originalReviewStatusRef.current !== 'draft';
        if (isClientResubmittingPD) {
          pickupEdit.review_status = 'pending_review';
          deliveryEdit.review_status = 'pending_review';
          const actorName = user?.displayName || user?.email || 'Client';
          const stamp = `Updated by ${actorName} on ${new Date().toLocaleString()}`;
          const prevNotes = (originalReviewNotesRef.current || '').trim();
          const newNotes = prevNotes ? `${stamp}\n— prior notes —\n${prevNotes}` : stamp;
          deliveryEdit.review_notes = newNotes;
          // v2026-05-09 — diff computation for the resubmit banner +
          // email. Snapshot is keyed off the loaded delivery leg row,
          // so the diff lands on deliveryEdit (the "primary" leg the
          // OrderPage opens). Pickup leg's last_resubmit_* stay null.
          if (originalOrderSnapshotRef.current) {
            const newItemsCount = selectedInvItems.length;
            const newItemsSignature = selectedInvItems
              .map(i => `${String(i.itemId ?? '')}|${String(i.qty ?? '')}|${String(i.description ?? '')}`)
              .sort()
              .join('§');
            const diff = computeResubmitDiff(
              originalOrderSnapshotRef.current,
              deliveryEdit,
              newItemsSignature,
              newItemsCount,
            );
            if (diff) {
              deliveryEdit.last_resubmit_diff = diff;
              deliveryEdit.last_resubmit_at = new Date().toISOString();
              deliveryEdit.last_resubmit_by = actorName;
            }
          }
        }
        const upP = await supabase.from('dt_orders').update(pickupEdit).eq('id', editingPickupRowIdRef.current);
        if (upP.error) throw new Error(`Pickup leg ${wasDraftPD ? 'promote' : 'save'} failed: ${upP.error.message}`);
        const { data: savedD, error: saveDErr } = await supabase
          .from('dt_orders').update(deliveryEdit).eq('id', editingDraftRowIdRef.current)
          .select('id, dt_identifier, review_status').single();
        if (saveDErr || !savedD) throw new Error(`Delivery leg ${wasDraftPD ? 'promote' : 'save'} failed: ${saveDErr?.message || 'no row returned'}`);
        // Refresh items on BOTH legs (matches the create-new path —
        // ad-hoc lines live on both legs with "PU: " prefix on the
        // pickup leg). Pre-fix code only refreshed the delivery leg
        // and stranded the pickup leg's items on every promote/save.
        {
          const { error: delDErr } = await supabase.from('dt_order_items')
            .delete().eq('dt_order_id', editingDraftRowIdRef.current);
          if (delDErr) throw new Error(`P+D promote items delete (delivery) failed: ${delDErr.message}`);
          if (editingPickupRowIdRef.current) {
            const { error: delPErr } = await supabase.from('dt_order_items')
              .delete().eq('dt_order_id', editingPickupRowIdRef.current);
            if (delPErr) throw new Error(`P+D promote items delete (pickup) failed: ${delPErr.message}`);
          }
        }
        if (editingPickupRowIdRef.current && editingDraftRowIdRef.current) {
          const pdItemRows = buildPDItemRows(editingPickupRowIdRef.current, editingDraftRowIdRef.current);
          if (pdItemRows.length > 0) {
            const { error: iErr } = await supabase.from('dt_order_items').insert(pdItemRows);
            if (iErr) throw new Error(`P+D promote items insert failed: ${iErr.message}`);
          }
        }
        const savedDelivery = savedD as { id: string; dt_identifier: string; review_status: string };
        // Audit: P+D edit-save / draft-promote. Best-effort.
        void logDtOrderAudit({
          orderId: savedDelivery.id,
          tenantId: clientSheetId,
          action: 'update',
          changes: {
            mode: 'pickup_and_delivery',
            wasDraft: wasDraftPD,
            dtIdentifier: savedDelivery.dt_identifier,
            reviewStatus: savedDelivery.review_status,
            itemCount: selectedInvItems.length,
            orderTotal: orderTotal ?? null,
          },
          performedBy: user?.email ?? null,
        });
        onSubmit?.({
          dtOrderId: savedDelivery.id,
          dtIdentifier: savedDelivery.dt_identifier,
          reviewStatus: savedDelivery.review_status,
          clientResubmit: isClientResubmittingPD,
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
          rate: a.rate,
          subtotal: a.subtotal,
          clientNotes: a.clientNotes ?? null,
          quotePending: !!a.quotePending,
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
          ...taxFields,
        };
        // Only the promote branch reassigns the identifier + bumps
        // review_status. Save-changes leaves both alone — preserves
        // pushed_to_dt_at semantics, audit history, etc.
        if (wasDraft) {
          editPayload.dt_identifier = await generateOrderNumber(mode === 'pickup' ? 'P' : undefined);
          editPayload.review_status = (user?.role === 'admin' || user?.role === 'staff') ? 'approved' : 'pending_review';
        }
        // v2026-05-09 — client save-changes on a non-draft order flips
        // review_status BACK to 'pending_review' so staff sees a re-
        // review queue entry. The audit trail is appended to
        // review_notes (preserving any prior reviewer notes). Office
        // gets pinged via notify-order-revision (action='updated_by_client')
        // from the OrderPage onSubmit handler.
        const isClientResubmittingSingle = !wasDraft
          && user?.role === 'client'
          && !!originalReviewStatusRef.current
          && originalReviewStatusRef.current !== 'draft';
        if (isClientResubmittingSingle) {
          editPayload.review_status = 'pending_review';
          // Stamp who/when in review_notes so the office sees the
          // audit trail in the email + on the order page.
          const actorName = user?.displayName || user?.email || 'Client';
          const stamp = `Updated by ${actorName} on ${new Date().toLocaleString()}`;
          const prevNotes = (originalReviewNotesRef.current || '').trim();
          editPayload.review_notes = prevNotes
            ? `${stamp}\n— prior notes —\n${prevNotes}`
            : stamp;
          // v2026-05-09 — compute the field-level diff + write the
          // last_resubmit_* columns so the OrderPage banner + the
          // notify-order-revision email can show staff exactly what
          // changed without forcing them to compare-and-contrast.
          if (originalOrderSnapshotRef.current) {
            // Build the new items signature using the same shape the
            // load-time snapshot used (sorted, §-joined). For single-
            // leg orders that's the upcoming dt_order_items payload —
            // use selectedInvItems for warehouse mode, ad-hoc lines
            // for delivery, or service-only's empty set.
            // Items signature combines warehouse-selected items
            // (selectedInvItems) + ad-hoc lines (deliveryFreeItems for
            // delivery mode, pickupFreeItems for pickup). Service-only
            // has no items. The signature is sorted before joining so
            // reorder-only changes don't false-positive.
            const adhoc = mode === 'pickup' ? pickupFreeItems
              : mode === 'delivery' ? deliveryFreeItems
              : [];
            const newItemsCount = mode === 'service_only' ? 0 : selectedInvItems.length + adhoc.length;
            const invSig = selectedInvItems
              .map(i => `${String(i.itemId ?? '')}|${String(i.qty ?? '')}|${String(i.description ?? '')}`);
            const adhocSig = adhoc
              .map(a => `|${String(a.quantity ?? '')}|${String(a.description ?? '')}`);
            const newItemsSignature = mode === 'service_only'
              ? ''
              : [...invSig, ...adhocSig].sort().join('§');
            const diff = computeResubmitDiff(
              originalOrderSnapshotRef.current,
              editPayload,
              newItemsSignature,
              newItemsCount,
            );
            if (diff) {
              editPayload.last_resubmit_diff = diff;
              editPayload.last_resubmit_at = new Date().toISOString();
              editPayload.last_resubmit_by = actorName;
            }
          }
        }
        const { data: saved, error: saveErr } = await supabase
          .from('dt_orders')
          .update(editPayload)
          .eq('id', editingDraftRowIdRef.current)
          .select('id, dt_identifier, review_status')
          .single();
        if (saveErr || !saved) throw new Error(`${wasDraft ? 'Draft promote' : 'Order save'} failed: ${saveErr?.message || 'no row returned'}`);
        // Refresh items (delete + reinsert is simpler than diff for
        // the typical small item count). Includes ad-hoc lines for
        // delivery mode alongside warehouse-inventory selections.
        // Throw on delete failure — see P+D branch above for context.
        {
          const { error: delErr } = await supabase.from('dt_order_items')
            .delete().eq('dt_order_id', editingDraftRowIdRef.current);
          if (delErr) throw new Error(`Single-leg edit items delete failed: ${delErr.message}`);
        }
        if (mode === 'delivery' && itemsSource === 'warehouse') {
          const invRows = selectedInvItems.map(i => {
            const room = effectiveRoom(i.itemId, i.room);
            return {
              dt_order_id: editingDraftRowIdRef.current,
              inventory_id: i.inventoryRowId ?? null,
              dt_item_code: i.itemId,
              description: i.description || '',
              quantity: i.qty || 1,
              vendor: i.vendor || null,
              class_name: i.itemClass || null,
              cubic_feet: classToCuFt(i.itemClass) ?? null,
              room: room || null,
              extras: {
                vendor: i.vendor || null,
                sidemark: i.sidemark || null,
                location: i.location || null,
                room: room || null,
                className: i.itemClass || null,
                source: 'inventory',
              },
            };
          });
          const adhocRows = deliveryFreeItems
            .filter(i => i.description.trim())
            .map(i => {
              const qty = Math.max(1, Number(i.quantity) || 1);
              const weight = Number.isFinite(Number(i.weight)) && Number(i.weight) > 0 ? Number(i.weight) : null;
              const cuFtPerUnit = Number.isFinite(Number(i.cubicFeet)) && Number(i.cubicFeet) > 0 ? Number(i.cubicFeet) : null;
              return {
                dt_order_id: editingDraftRowIdRef.current,
                dt_item_code: null,
                description: i.description.trim(),
                quantity: qty,
                cubic_feet: cuFtPerUnit != null ? cuFtPerUnit * qty : null,
                extras: { source: 'delivery_free_text', weight, cuft: cuFtPerUnit },
              };
            });
          const itemRows = [...invRows, ...adhocRows];
          if (itemRows.length > 0) {
            await supabase.from('dt_order_items').insert(itemRows);
          }
        } else if (mode === 'pickup') {
          // Pickup-only edit/promote was missing this branch — items
          // were deleted but never reinserted, so any pickup-only
          // order saved through this path lost its lines silently.
          const freeRows = pickupFreeItems
            .filter(i => i.description.trim())
            .map(i => {
              const qty = Math.max(1, Number(i.quantity) || 1);
              return {
                dt_order_id: editingDraftRowIdRef.current,
                dt_item_code: null,
                description: i.description.trim(),
                quantity: qty,
                original_quantity: qty,
                extras: { source: 'pickup_free_text' },
              };
            });
          if (freeRows.length > 0) {
            const { error: iErr } = await supabase.from('dt_order_items').insert(freeRows);
            if (iErr) throw new Error(`Pickup items insert failed: ${iErr.message}`);
          }
        }
        const savedRow = saved as { id: string; dt_identifier: string; review_status: string };
        // Audit: single-leg edit-save / draft-promote. Best-effort.
        void logDtOrderAudit({
          orderId: savedRow.id,
          tenantId: clientSheetId,
          action: 'update',
          changes: {
            mode,
            wasDraft,
            dtIdentifier: savedRow.dt_identifier,
            reviewStatus: savedRow.review_status,
            itemCount: itemCount ?? null,
            orderTotal: orderTotal ?? null,
          },
          performedBy: user?.email ?? null,
        });
        onSubmit?.({
          dtOrderId: savedRow.id,
          dtIdentifier: savedRow.dt_identifier,
          reviewStatus: savedRow.review_status,
          clientResubmit: isClientResubmittingSingle,
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
      rate: a.rate,
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
      // Three free-text notes columns (Phase 1):
      //   • details         → "Order Details" (everyone)
      //   • driver_notes    → on-site instructions (everyone, pushed to DT)
      //   • internal_notes  → staff-only, hidden from clients
      // (The dt_order_notes table holds threaded staff/client notes and
      // is unrelated to these columns.)
      details: details.trim() || null,
      driver_notes: driverNotes.trim() || null,
      internal_notes: internalNotes.trim() || null,
      source: 'app',
      review_status: (user?.role === 'admin' || user?.role === 'staff') ? 'approved' : 'pending_review',
      created_by_user: authUid,
      created_by_role: user?.role || 'client',
      billing_method: billingMethod,
      service_time_minutes: effectiveServiceTime || null,
      // status_id intentionally omitted — app-created orders have no DT status
      // until they are approved and pushed to DT via the dt-push-order Edge Function.
    };
    // Admin AND staff bypass the review queue — they're submitting from
    // inside the warehouse and the order is correct by construction.
    // Only client-role submissions need pending_review.
    const isAdminAutoApprove = user?.role === 'admin' || user?.role === 'staff';

    try {
      if (mode === 'pickup_and_delivery') {
        // Two linked orders — create BOTH in a single flow.
        // Generate order numbers before inserts
        const pair = await generateLinkedOrderNumbers();
        const pickupIdent = pair.pickup;
        const deliveryIdent = pair.delivery;

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
            pricing_override: !!(isCallForQuote || isPickupCallForQuote || isPieceCountOverLimit
              || baseFeeOverride != null || pickupLegFeeOverride != null || bundleDiscountOverride != null || extraItemsFeeOverride != null),
            pricing_notes: [pdPricingNotes, isPieceCountOverLimit ? `Item count ${itemCount} exceeds ${MAX_PIECES}-piece auto-pricing limit — custom quote required.` : null].filter(Boolean).join(' | ') || null,
            ...coverageFields,
            ...taxFields,
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
        // Items: ad-hoc pickup lines on BOTH legs (with "PU: " prefix
        // on pickup) + any warehouse inventory items on the delivery
        // leg. buildPDItemRows already encodes both halves so all P+D
        // save paths stay symmetric.
        const pdItemRows = buildPDItemRows(pickupRow.id, deliveryRow.id);
        if (pdItemRows.length > 0) {
          const { error: iErr } = await supabase.from('dt_order_items').insert(pdItemRows);
          if (iErr) throw new Error(`Items insert failed: ${iErr.message}`);
        }

        setCreateResult({ dtIdentifier: deliveryRow.dt_identifier, linkedIdentifier: pickupRow.dt_identifier, orderId: deliveryRow.id });
        // Audit: P+D order created. Best-effort. (Push-to-DT is audited
        // separately by the dt-push-order edge function once it lands.)
        void logDtOrderAudit({
          orderId: deliveryRow.id,
          tenantId: clientSheetId,
          action: 'create',
          changes: {
            mode: 'pickup_and_delivery',
            dtIdentifier: deliveryRow.dt_identifier,
            linkedIdentifier: pickupRow.dt_identifier,
            reviewStatus: isAdminAutoApprove ? 'approved' : 'pending_review',
            itemCount: selectedInvItems.length,
            orderTotal: orderTotal ?? null,
            autoApproved: isAdminAutoApprove,
          },
          performedBy: user?.email ?? null,
        });
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
            pricing_override: isServiceOnly || isCallForQuote || (!isServiceOnly && isPieceCountOverLimit)
              || baseFeeOverride != null || pickupLegFeeOverride != null || bundleDiscountOverride != null || extraItemsFeeOverride != null,
            pricing_notes: isServiceOnly
              ? 'Service-only visit — no items. Staff to confirm service fee during review.'
              : [
                  isCallForQuote ? 'Zone marked CALL FOR QUOTE — pricing requires manual review.' : null,
                  isPieceCountOverLimit ? `Item count ${itemCount} exceeds ${MAX_PIECES}-piece auto-pricing limit — custom quote required.` : null,
                ].filter(Boolean).join(' | ') || null,
            ...coverageFields,
            ...taxFields,
          })
          .select('id, dt_identifier')
          .single();

        if (orderErr || !orderRow) {
          throw new Error(orderErr?.message || 'Failed to create order');
        }

        // Items
        if (mode === 'delivery' && itemsSource === 'warehouse') {
          const invRows = selectedInvItems.map(i => {
            const cuFt = classToCuFt(i.itemClass);
            const qty = Number(i.qty) || 1;
            const room = effectiveRoom(i.itemId, i.room);
            return {
              dt_order_id: orderRow.id,
              inventory_id: i.inventoryRowId ?? null,
              dt_item_code: i.itemId,
              description: buildItemDescription({
                description: i.description, vendor: i.vendor,
                sidemark: i.sidemark, room: room, itemId: i.itemId,
              }),
              quantity: qty,
              original_quantity: qty,
              cubic_feet: cuFt != null ? cuFt * qty : null,
              class_name: i.itemClass || null,
              vendor: i.vendor || null,
              room: room || null,
              extras: {
                vendor: i.vendor || null,
                sidemark: i.sidemark || null,
                location: i.location || null,
                room: room || null,
                className: i.itemClass || null,
                source: 'inventory',
              },
            };
          });
          const adhocRows = deliveryFreeItems
            .filter(i => i.description.trim())
            .map(i => {
              const qty = Math.max(1, Number(i.quantity) || 1);
              const weight = Number.isFinite(Number(i.weight)) && Number(i.weight) > 0 ? Number(i.weight) : null;
              const cuFtPerUnit = Number.isFinite(Number(i.cubicFeet)) && Number(i.cubicFeet) > 0 ? Number(i.cubicFeet) : null;
              return {
                dt_order_id: orderRow.id,
                dt_item_code: null,
                description: i.description.trim(),
                quantity: qty,
                original_quantity: qty,
                cubic_feet: cuFtPerUnit != null ? cuFtPerUnit * qty : null,
                extras: {
                  source: 'delivery_free_text',
                  weight,
                  cuft: cuFtPerUnit,
                },
              };
            });
          const itemRows = [...invRows, ...adhocRows];
          if (itemRows.length > 0) {
            const { error: iErr } = await supabase.from('dt_order_items').insert(itemRows);
            if (iErr) throw new Error(`Items insert failed: ${iErr.message}`);
          }
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
        // Audit: single-leg order created. Best-effort. The inventory-side
        // 'delivery_order_created' rows above are per-item history;
        // this one row is the dt_order's own audit entry that powers
        // the OrderPage Activity tab.
        void logDtOrderAudit({
          orderId: orderRow.id,
          tenantId: clientSheetId,
          action: 'create',
          changes: {
            mode,
            dtIdentifier: orderRow.dt_identifier,
            reviewStatus: isAdminAutoApprove ? 'approved' : 'pending_review',
            itemCount: itemCount ?? null,
            orderTotal: orderTotal ?? null,
            autoApproved: isAdminAutoApprove,
          },
          performedBy: user?.email ?? null,
        });
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

  const clientNames = liveClients
    .map(c => c.name)
    .filter(n => accessibleClientNames === null || accessibleClientNames.has(n))
    .sort();

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
      <div style={isMobile ? {
        // v2026-05-09 — full-sheet on mobile so the Body's
        // `flex: 1 + overflowY: auto` actually has a bounded parent and
        // touch-scroll works through the entire form. Pre-fix the modal
        // used `top: 50% + transform: translate(-50%,-50%) + maxHeight: 94vh`,
        // which on iOS Safari clipped both the header AND the footer
        // behind the dynamic URL bar — operator literally couldn't reach
        // Submit / Save Draft on a tall draft. The full-sheet form pins
        // header + footer to the viewport edges and lets the body fill
        // (and scroll) the available space.
        position: 'fixed', inset: 0,
        background: '#fff', borderRadius: 0, zIndex: 1001,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        // safe-area-inset-bottom keeps the footer above the iOS home
        // indicator on devices with no physical home button.
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      } : {
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
        <div style={{
          flex: 1,
          overflowY: 'auto',
          // Tighter padding on mobile so the form isn't squeezed into
          // a thin column inside the device's narrow viewport.
          padding: isMobile ? '14px 14px' : 20,
          // iOS legacy momentum scrolling. Modern Safari ignores this
          // (touch scrolling is the default), but it's harmless and
          // covers older WebView shells.
          WebkitOverflowScrolling: 'touch',
          // Stop the page underneath from scroll-bouncing when the
          // body hits its top/bottom — keeps the modal interaction
          // self-contained.
          overscrollBehavior: 'contain',
        }}>

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
            {!isStaff && clientNames.length <= 1 ? (
              <div style={{
                padding: '10px 12px', borderRadius: 8,
                background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.borderSubtle}`,
                fontSize: 14, fontWeight: 600, color: theme.colors.textPrimary,
              }}>
                {clientName || '—'}
              </div>
            ) : (
              <AutocompleteSelect
                options={clientNames.map(n => ({ value: n, label: n }))}
                value={clientName}
                onChange={setClientName}
                placeholder="Select client…"
              />
            )}
            {clientName && clientTaxInfo && (
              clientTaxInfo.taxExempt ? (
                <div style={{
                  marginTop: 8, padding: '8px 12px', borderRadius: 8,
                  background: '#ECFDF5', border: '1px solid #A7F3D0',
                  fontSize: 12, color: '#065F46', display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span style={{ fontWeight: 700 }}>✓ Tax-exempt</span>
                  <span>
                    ({clientTaxInfo.taxExemptReason || 'Resale'}
                    {clientTaxInfo.resaleCertExpires
                      ? ` — cert valid through ${clientTaxInfo.resaleCertExpires}`
                      : clientTaxInfo.resaleCertUrl
                        ? ' — cert on file'
                        : ' — no cert on file'})
                  </span>
                </div>
              ) : (
                <div style={{
                  marginTop: 8, padding: '8px 12px', borderRadius: 8,
                  background: '#FEF3C7', border: '1px solid #FCD34D',
                  fontSize: 12, color: '#92400E', display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span style={{ fontWeight: 700 }}>⚠ Tax applies</span>
                  <span>({clientTaxInfo.taxRatePct.toFixed(3)}% sales tax — direct-to-consumer)</span>
                </div>
              )
            )}
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
                  displayRate: mode === 'pickup_and_delivery' ? (pickupZone?.baseRate ?? null) : (zone?.baseRate ?? null),
                } : null}
              />
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                  <span style={{
                    fontSize: 13, fontWeight: 700, color: theme.colors.text,
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                  }}>
                    Items to Pick Up
                  </span>
                  <button
                    type="button"
                    onClick={() => setPickupFreeItems(prev => [...prev, { id: genUid(), description: '', quantity: 1 }])}
                    style={{
                      background: theme.colors.primary, border: 'none',
                      color: '#fff', cursor: 'pointer',
                      fontSize: 12, fontWeight: 700,
                      padding: '6px 12px', borderRadius: 6,
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      fontFamily: 'inherit',
                    }}
                  >
                    <Plus size={13} /> Add Item
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
                        title="Remove ad-hoc item"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991B1B', padding: 4 }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                {mode === 'pickup_and_delivery' && (
                  <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 8, fontStyle: 'italic' }}>
                    These items will auto-appear on the delivery leg below — driver picks them up here and drops them at the delivery address.
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

              {/* PO / Reference / Sidemark / Order Details — relocated
                  from the standalone "Reference" section below to right
                  after the contact email so operators fill order
                  metadata BEFORE picking items. Driver Notes + Internal
                  Notes stay below the items picker (filled in last,
                  after the operator has seen what's actually on the
                  order). Gated on non-service_only since service-only
                  orders don't carry a customer PO/sidemark workflow. */}
              {mode !== 'service_only' && (
                <div style={{ marginTop: 14 }}>
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
                  <label style={label}>Order Details</label>
                  <div style={{ fontSize: 11, color: theme.colors.textMuted, marginBottom: 6, lineHeight: 1.5 }}>
                    Describe what this order involves — services needed, special handling instructions, or anything our team should know about the job.
                  </div>
                  <textarea
                    style={{ ...input, minHeight: 60, resize: 'vertical' }}
                    value={details}
                    onChange={e => setDetails(e.target.value)}
                    placeholder="Order overview"
                  />
                </div>
              )}

              {/* Inventory picker — delivery+warehouse and P+D both
                  support pulling items from the client's stored
                  inventory. P+D can mix warehouse items (delivered
                  alongside) with the ad-hoc pickup list below. */}
              {((mode === 'delivery' && itemsSource === 'warehouse') || mode === 'pickup_and_delivery') && (
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
                      {inventoryExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      <span style={{
                        fontSize: 13, fontWeight: 700, color: theme.colors.text,
                        textTransform: 'uppercase', letterSpacing: '0.06em',
                      }}>
                        Items <span style={{ color: theme.colors.textMuted, fontWeight: 600 }}>
                          (from inventory, {selectedInvItems.length} selected{totalSelectedCuFt > 0 ? ` · ${totalSelectedCuFt} cuFt` : ''})
                        </span>
                      </span>
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
                              <th style={{ ...summaryTh, width: 130 }}>Room</th>
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
                                <td style={{ ...summaryTd, padding: '4px 6px' }}>
                                  {/* Per-order room override. Default flows in
                                      from the inventory row; any edit here
                                      gets persisted to dt_order_items.room
                                      (and extras.room) on save and is
                                      appended to the DT description as
                                      "Vendor desc — Room". The inventory row
                                      itself is NOT modified. */}
                                  <input
                                    type="text"
                                    value={effectiveRoom(it.itemId, it.room)}
                                    onChange={e => setRoomOverride(it.itemId, e.target.value)}
                                    placeholder="—"
                                    style={{
                                      width: '100%', boxSizing: 'border-box',
                                      padding: '3px 6px', fontSize: 12,
                                      border: `1px solid ${theme.colors.border}`,
                                      borderRadius: 4, background: '#fff',
                                      fontFamily: 'inherit',
                                    }}
                                  />
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
                      <div
                        onClick={(e) => { e.stopPropagation(); toggleAllFiltered(); }}
                        title={filteredItems.length === 0
                          ? 'No items to select'
                          : filteredAllChecked
                            ? `Deselect all ${filteredItems.length} shown`
                            : `Select all ${filteredItems.length} shown`}
                        style={{
                          width: 16, height: 16, borderRadius: 3,
                          border: `2px solid ${filteredSomeChecked ? theme.colors.primary : theme.colors.border}`,
                          background: filteredAllChecked ? theme.colors.primary : '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          cursor: filteredItems.length === 0 ? 'not-allowed' : 'pointer',
                          opacity: filteredItems.length === 0 ? 0.4 : 1,
                        }}
                      >
                        {filteredAllChecked
                          ? <Check size={10} color="#fff" />
                          : filteredSomeChecked
                            ? <div style={{ width: 8, height: 2, background: theme.colors.primary, borderRadius: 1 }} />
                            : null}
                      </div>
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

                  {/* Ad-hoc (free-text) items — operator can mix non-inventory
                      lines onto a delivery order. Counts toward the same
                      "extra items" pricing tier as warehouse items. */}
                  <div style={{ marginTop: 18 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          fontSize: 13, fontWeight: 700, color: theme.colors.text,
                          textTransform: 'uppercase', letterSpacing: '0.06em',
                        }}>
                          Ad-Hoc Items
                        </span>
                        <span style={{
                          fontSize: 9, fontWeight: 700, letterSpacing: '0.5px',
                          padding: '2px 7px', borderRadius: 4,
                          background: '#FEF3C7', color: '#92400E',
                          textTransform: 'uppercase',
                        }}>
                          Not in inventory
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setDeliveryFreeItems(prev => [...prev, { id: genUid(), description: '', quantity: 1, weight: null, cubicFeet: null }])}
                        style={{
                          background: theme.colors.primary, border: 'none',
                          color: '#fff', cursor: 'pointer',
                          fontSize: 12, fontWeight: 700,
                          padding: '6px 12px', borderRadius: 6,
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          fontFamily: 'inherit',
                        }}
                      >
                        <Plus size={13} /> Add Ad-Hoc Item
                      </button>
                    </div>
                    {deliveryFreeItems.length === 0 ? (
                      <div style={{ fontSize: 11, color: theme.colors.textMuted, fontStyle: 'italic', padding: '4px 0' }}>
                        Add a line for anything that isn't in the warehouse inventory above.
                      </div>
                    ) : (
                      <div style={{
                        background: '#FFFBEB',
                        border: '1px solid #FDE68A',
                        borderRadius: 8,
                        padding: 8,
                        display: 'grid', gap: 6,
                      }}>
                        {/* Column headers — only visible above the first row */}
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
                        {deliveryFreeItems.map((item) => (
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
                              onChange={e => setDeliveryFreeItems(prev => prev.map(i => i.id === item.id ? { ...i, quantity: Math.max(1, parseInt(e.target.value) || 1) } : i))}
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
                              onClick={() => setDeliveryFreeItems(prev => prev.filter(i => i.id !== item.id))}
                              title="Remove ad-hoc item"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991B1B', padding: 4 }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* v2026-05-11 (rev 2) — read-only mirror of the pickup
                  ad-hoc items. The driver picks them up at the origin
                  and delivers them to this address, so they show on
                  BOTH legs in DT. Edited on the pickup side; this is
                  display-only confirmation so the operator sees the
                  full delivery manifest without having to scroll back
                  up. */}
              {mode === 'pickup_and_delivery' && (
                <div style={{ marginTop: 18 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 700, color: theme.colors.text,
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                    marginBottom: 8,
                  }}>
                    Items From Pickup <span style={{ color: theme.colors.textMuted, fontWeight: 600 }}>(also delivered here)</span>
                  </div>
                  {pickupFreeItems.filter(i => i.description.trim()).length === 0 ? (
                    <div style={{ padding: 12, background: '#F9FAFB', borderRadius: 8, fontSize: 12, color: theme.colors.textMuted, fontStyle: 'italic' }}>
                      Add items in the Pickup section above — they&apos;ll appear here automatically.
                    </div>
                  ) : (
                    <div style={{
                      padding: 12, background: '#F9FAFB',
                      border: `1px solid ${theme.colors.borderLight || '#e5e7eb'}`,
                      borderRadius: 8,
                      display: 'flex', flexDirection: 'column', gap: 6,
                    }}>
                      {pickupFreeItems.filter(i => i.description.trim()).map(i => (
                        <div key={i.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 13, color: theme.colors.text }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                            <span style={{ width: 4, height: 4, borderRadius: '50%', background: theme.colors.primary, flexShrink: 0 }} />
                            <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {i.description}
                            </span>
                          </span>
                          <span style={{
                            fontSize: 11, fontWeight: 600,
                            padding: '2px 8px', borderRadius: 100,
                            background: '#FFEDD5', color: '#9A3412',
                            flexShrink: 0,
                          }}>
                            qty {i.quantity}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
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
                  const staffOnly = !acc.visibleToClient;
                  const catalogRate = acc.rate ?? 0;
                  const currentRate = current?.rate ?? catalogRate;
                  const rateOverridden = selected && !acc.quoteRequired && Math.abs(currentRate - catalogRate) > 0.0001;
                  // Rate is editable for staff/admin only — clients see
                  // the catalog rate locked. Qty is editable for everyone
                  // once selected (so a client booking 40 disposals can
                  // still set the count, but can't lower the unit price).
                  const canEditRate = isStaff;
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
                          onChange={() => selected ? toggleAccessorial(acc, 1, true) : toggleAccessorial(acc, 1)}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                            {acc.name}
                            {staffOnly && (
                              <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: '#E0E7FF', color: '#3730A3', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                Staff
                              </span>
                            )}
                            {rateOverridden && (
                              <span
                                title={`Catalog rate: $${catalogRate.toFixed(2)}`}
                                style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: '#FEF3C7', color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.5px' }}
                              >
                                Modified
                              </span>
                            )}
                            {!selected && (acc.quoteRequired ? (
                              <span style={{ color: '#B45309', fontWeight: 600, fontStyle: 'italic', marginLeft: 'auto', fontSize: 12 }}>
                                Quote Required
                              </span>
                            ) : acc.billingMode === 'per_class' ? (
                              <span style={{ color: theme.colors.textMuted, fontWeight: 400, marginLeft: 'auto', fontSize: 12 }}>
                                Per class rate
                              </span>
                            ) : acc.rate != null ? (
                              <span style={{ color: theme.colors.textMuted, fontWeight: 400, marginLeft: 'auto' }}>
                                ${acc.rate.toFixed(2)}{unitSuffix}
                              </span>
                            ) : null)}
                          </div>
                          {acc.description && (
                            <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 2 }}>{acc.description}</div>
                          )}
                        </div>
                      </label>
                      {selected && isStaff && (
                        <div
                          style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${theme.colors.border}` }}
                          onClick={e => e.stopPropagation()}
                        >
                          {/* Qty input: only meaningful for per_qty services.
                              per_class derives qty implicitly from selected
                              items × class; per_job is always 1 (single fee).
                              Show a small inline note instead so the operator
                              knows why there's no input. */}
                          {acc.billingMode === 'per_qty' ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Qty</span>
                              <input
                                type="number" min={1} step={1}
                                value={current?.quantity ?? 1}
                                onChange={e => updateAccessorialQty(acc.code, Math.max(1, parseInt(e.target.value, 10) || 1))}
                                style={{ ...input, width: 80, padding: '4px 8px' }}
                              />
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 80 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Qty</span>
                              <span style={{ fontSize: 11, color: theme.colors.textMuted, fontStyle: 'italic', padding: '4px 0' }}>
                                {acc.billingMode === 'per_class' ? 'per item × class' : 'per job'}
                              </span>
                            </div>
                          )}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              Rate{unitSuffix && <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{unitSuffix}</span>}
                            </span>
                            <input
                              type="number" min={0} step="0.01"
                              value={Number.isFinite(currentRate) ? currentRate : 0}
                              onChange={e => updateAccessorialRate(acc.code, parseFloat(e.target.value) || 0)}
                              disabled={!canEditRate || acc.billingMode === 'per_class'}
                              title={
                                acc.billingMode === 'per_class'
                                  ? 'Rate is per-item-class — edit on the Price List page.'
                                  : canEditRate ? '' : 'Rate is locked to the catalog price for client-submitted orders.'
                              }
                              style={{
                                ...input, width: 100, padding: '4px 8px',
                                background: (canEditRate && acc.billingMode !== 'per_class') ? '#fff' : '#F3F4F6',
                                color: (canEditRate && acc.billingMode !== 'per_class') ? theme.colors.text : theme.colors.textMuted,
                                cursor: (canEditRate && acc.billingMode !== 'per_class') ? 'text' : 'not-allowed',
                              }}
                            />
                          </div>
                          <div style={{ flex: 1, textAlign: 'right' }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Subtotal</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: theme.colors.text }}>
                              {acc.quoteRequired && (current?.subtotal ?? 0) === 0
                                ? <span style={{ color: '#B45309', fontStyle: 'italic', fontWeight: 600, fontSize: 12 }}>Quote Required</span>
                                : `$${(current?.subtotal ?? 0).toFixed(2)}`}
                            </div>
                          </div>
                        </div>
                      )}
                      {selected && !isStaff && (
                        <div
                          style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${theme.colors.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}
                          onClick={e => e.stopPropagation()}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
                              Our team will review your order and add pricing for this service. You can check back after approval for the final rate.
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

          {/* Notes (non-service_only). PO / Sidemark / Order Details
              moved up next to the contact block so the operator fills
              order metadata before picking items. Driver Notes + Internal
              Notes live here because they're typically filled in LAST,
              after the items roster is known and any on-site quirks are
              fresh in the operator's head. */}
          {mode !== 'service_only' && (
            <div style={section}>
              <div style={sectionTitle}>Notes</div>

              <label style={label}>Driver Notes</label>
              <div style={{ fontSize: 11, color: theme.colors.textMuted, marginBottom: 6, lineHeight: 1.5 }}>
                Notes for the delivery crew — parking instructions, gate codes, building access, or anything they'll need on-site.
              </div>
              <textarea
                style={{ ...input, minHeight: 60, resize: 'vertical' }}
                value={driverNotes}
                onChange={e => setDriverNotes(e.target.value)}
                placeholder="Parking, gate codes, building access…"
              />

              {/* Internal Notes — staff/admin only. Clients never see
                  this label or textarea, so they can't accidentally
                  mistake it for a customer-visible field. */}
              {isStaff && (
                <>
                  <label style={{ ...label, marginTop: 14 }}>Internal Notes</label>
                  <div style={{ fontSize: 11, color: theme.colors.textMuted, marginBottom: 6, lineHeight: 1.5 }}>
                    Internal notes — only visible to Stride staff. Not shared with clients or drivers.
                  </div>
                  <textarea
                    style={{ ...input, minHeight: 60, resize: 'vertical', background: '#FEF3C7', borderColor: '#FCD34D' }}
                    value={internalNotes}
                    onChange={e => setInternalNotes(e.target.value)}
                    placeholder="Anything the rest of the team should know about this order, behind the scenes."
                  />
                  <div style={{ fontSize: 10.5, color: theme.colors.textMuted, marginTop: 4, lineHeight: 1.5, fontStyle: 'italic' }}>
                    Only visible to Stride staff. Clients and drivers will not see these notes — not shared in the customer portal or DispatchTrack.
                  </div>
                </>
              )}
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
              {isPieceCountOverLimit && (
                <div style={{
                  marginBottom: 10, padding: '10px 12px', borderRadius: 8,
                  background: '#FEF3C7', border: '1px solid #FCD34D', color: '#92400E',
                  fontSize: 12, lineHeight: 1.45,
                }}>
                  <strong>Custom quote required.</strong> Orders over {MAX_PIECES} pieces ({itemCount} on this order) need staff review — the figures below are placeholders and will be adjusted during review.
                </div>
              )}
              {mode === 'pickup_and_delivery' ? (
                <>
                  {baseFee != null && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4, alignItems: 'center' }}>
                      <span>Delivery Fee{zone ? ` (Zone ${zone.zone})` : ''}</span>
                      <RateOverrideCell
                        value={baseFee} override={baseFeeOverride} onChange={setBaseFeeOverride}
                        canEdit={isAdmin}
                      />
                    </div>
                  )}
                  {pickupLegFee > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4, alignItems: 'center' }}>
                      <span>Pickup Fee{pickupZone ? ` (Zone ${pickupZone.zone})` : ''}</span>
                      <RateOverrideCell
                        value={pickupLegFee} override={pickupLegFeeOverride} onChange={setPickupLegFeeOverride}
                        canEdit={isAdmin}
                      />
                    </div>
                  )}
                  {bundleDiscount > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4, color: '#047857', alignItems: 'center' }}>
                      <span>Bundle Discount</span>
                      <RateOverrideCell
                        value={bundleDiscount} override={bundleDiscountOverride} onChange={setBundleDiscountOverride}
                        canEdit={isStaff} negative
                      />
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4, alignItems: 'center' }}>
                    <span>{mode === 'pickup' ? 'Base Pickup Fee' : 'Base Delivery Fee'}</span>
                    <RateOverrideCell
                      value={baseFee} override={baseFeeOverride} onChange={setBaseFeeOverride}
                      canEdit={isStaff}
                    />
                  </div>
                )
              )}
              {extraItemsCount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4, alignItems: 'center' }}>
                  <span>Extra Items ({extraItemsCount} × ${extraItemRate.toFixed(2)}{extraItemsLegMultiplier > 1 ? ` × ${extraItemsLegMultiplier} legs` : ''})</span>
                  <RateOverrideCell
                    value={extraItemsFee} override={extraItemsFeeOverride} onChange={setExtraItemsFeeOverride}
                    canEdit={isAdmin}
                  />
                </div>
              )}
              {Array.from(selectedAccessorials.values()).map(a => {
                const acc = accessorials.find(x => x.code === a.code);
                const isQuotePending = !!a.quotePending;
                return (
                  <div key={a.code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                    <span>{acc?.name}{a.quantity > 1 ? ` × ${a.quantity}` : ''}</span>
                    <span style={{ fontWeight: 500, color: isQuotePending ? '#B45309' : undefined, fontStyle: isQuotePending ? 'italic' : undefined }}>
                      {isQuotePending ? 'Quote pending' : `$${a.subtotal.toFixed(2)}`}
                    </span>
                  </div>
                );
              })}
              {Array.from(selectedAccessorials.values()).some(a => a.quotePending) && (
                <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 6, fontStyle: 'italic', lineHeight: 1.45 }}>
                  Services marked "Quote pending" will be priced by our team during review.
                </div>
              )}
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
              {clientTaxInfo && !clientTaxInfo.taxExempt && subtotalBeforeTax != null && (
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
                    <span>Sales Tax ({clientTaxInfo.taxRatePct.toFixed(3)}%)</span>
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
                <span>{orderTotal != null ? `$${orderTotal.toFixed(2)}` : isCallForQuote ? 'Call for quote' : '—'}</span>
              </div>
              <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 8, fontStyle: 'italic', lineHeight: 1.45 }}>
                Pricing is estimated based on the information provided. If additional assembly, labor, or special handling services are required at the time of delivery, rates may be adjusted accordingly.
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
          padding: isMobile ? '10px 12px' : '14px 20px',
          borderTop: `1px solid ${theme.colors.border}`,
          display: 'flex',
          // On mobile let the missing-fields hint wrap above the button
          // group instead of compressing both onto one line; the four
          // action buttons (Discard / Cancel / Save Draft / Submit) need
          // the full row width on a phone.
          flexWrap: isMobile ? 'wrap' : 'nowrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10, flexShrink: 0,
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
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            // Mobile: allow the 3-4 buttons to wrap onto a second row
            // so Submit isn't cut off the right edge of a narrow phone.
            flexWrap: isMobile ? 'wrap' : 'nowrap',
            flexShrink: 0,
            justifyContent: isMobile ? 'flex-end' : 'flex-end',
          }}>
            {/* Discard Draft — only when editing an existing draft
                (NOT a real order). Hard-deletes the row + its items.
                Available to anyone who can open the draft (clients see
                only their own via RLS). Real orders should be Voided
                through their detail page, not deleted. */}
            {editingDraftRowIdRef.current && !isEditingRealOrder && (
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
