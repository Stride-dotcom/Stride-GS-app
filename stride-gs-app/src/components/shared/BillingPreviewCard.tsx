/**
 * BillingPreviewCard — port of the WMS BillingCalculator, expanded to be
 * the SINGLE place for billing controls on a task / repair / will call.
 *
 * Sections:
 *   1. Projected — primary line (editable qty/rate) + queued add-ons
 *      (editable qty/rate, deletable) + "+ Add Service" button.
 *   2. Recorded — read-only ledger rows pulled from public.billing.
 *   3. Total + breakdown footer.
 *
 * Editing flow:
 *   - Primary rate edits flow back to the parent via `onUpdatePrimaryRate`
 *     (the parent persists — TaskDetailPanel writes to tasks.custom_price
 *     via postUpdateTaskCustomPrice + Supabase mirror).
 *   - Add-on add/update/delete flow back via `onAddAddon`, `onUpdateAddon`,
 *     `onDeleteAddon` (parent calls useTaskAddons).
 *   - Edits save on blur or after a 600ms debounce so each keystroke
 *     doesn't fire a network call.
 *
 * The card is the only billing UI on the entity panel — the previous
 * "Add-on Services" section, Price Override field, and footer Add Service
 * button were removed in favor of this consolidated card.
 *
 * Staff/admin only — clients don't see billing math in entity panels.
 *
 * Schema mapping vs WMS source:
 *   service_events → service_catalog (via useServiceCatalog)
 *   billing_events → billing
 *   addon-via-metadata → task_addons (own table, see useTaskAddons)
 *   profile.tenant_id → user.clientSheetId
 *   wc_number column → there is no wc_number column; will calls live in
 *                      task_id like tasks do.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, DollarSign, Loader2, AlertTriangle, Receipt, Plus, Trash2 } from 'lucide-react';
import { theme } from '../../styles/theme';
import { supabase } from '../../lib/supabase';
import { useServiceCatalog, type CatalogService } from '../../hooks/useServiceCatalog';
import type { EntityAddon, AddEntityAddonInput } from '../../hooks/useEntityAddons';
import { AddTaskServiceModal } from './AddTaskServiceModal';

export type BillingPreviewEntity = 'task' | 'repair' | 'will_call';

interface Props {
  entityType: BillingPreviewEntity;
  /** taskId / repairId / wcNumber. Will calls share the task_id column. */
  entityId: string;
  tenantId: string;
  /** Reserved for future cross-entity rollup. Currently unused. */
  itemId?: string | null;
  /** Primary service code (e.g. INSP, ASM, REPAIR, WC). Null = no primary line. */
  svcCode?: string | null;
  /** Item class for class-based services (XS/S/M/L/XL/XXL). */
  itemClass?: string | null;
  /**
   * Per-task custom rate override on the primary line.
   * Only NON-ZERO values count as overrides — `0`, `null`, and `undefined`
   * all mean "no override; use catalog rate." This matches the WMS
   * convention and avoids the prior bug where `customPrice = 0` flipped
   * the whole primary line to a $0 charge.
   */
  customPrice?: number | null;
  /**
   * For will_call entityType: the items being released. Required for the
   * primary projection because WC bills one row per item with rate keyed
   * on each item's class — passing `itemClass` alone (singular) gives a
   * $0 projection because catalog WC rates are class-banded (XS/S/M/L/XL/XXL)
   * and the panel passes itemClass=null since a WC can span classes.
   * Ignored for task/repair which use the singular itemClass path.
   */
  wcItems?: { itemId: string; itemClass?: string | null }[];
  /** Queued addons for this entity (any parent_type). v38.177.0 — was
   *  task-only via TaskAddon[]; now polymorphic via EntityAddon[]. */
  addons?: EntityAddon[];
  /** Hide for clients. */
  visible?: boolean;
  /** Initial open/closed state. Defaults to closed. */
  defaultOpen?: boolean;
  /** When true, render qty/rate inputs + Add Service + delete buttons.
   *  When false, the card is read-only. */
  editable?: boolean;
  /** Persist primary rate. Pass `null` to clear the override. */
  onUpdatePrimaryRate?: (rate: number | null) => Promise<unknown>;
  /** Persist a new addon row. */
  onAddAddon?: (input: AddEntityAddonInput) => Promise<unknown>;
  /** Persist qty/rate edit on an existing addon. */
  onUpdateAddon?: (id: string, patch: { quantity?: number; rate?: number | null }) => Promise<unknown>;
  /** Delete an addon row. */
  onDeleteAddon?: (id: string) => Promise<unknown>;
}

interface BillingRow {
  ledger_row_id: string;
  status: string | null;
  invoice_no: string | null;
  date: string | null;
  svc_code: string | null;
  svc_name: string | null;
  description: string | null;
  qty: number | string | null;
  rate: number | string | null;
  total: number | string | null;
  task_id: string | null;
  repair_id: string | null;
  shipment_number: string | null;
  item_id: string | null;
  item_class: string | null;
  item_notes: string | null;
}

const STATUS_CFG: Record<string, { bg: string; color: string }> = {
  Unbilled: { bg: '#EFF6FF', color: '#1D4ED8' },
  Invoiced: { bg: '#F0FDF4', color: '#15803D' },
  Billed:   { bg: '#F0FDF4', color: '#15803D' },
  Void:     { bg: '#F3F4F6', color: '#6B7280' },
};

const SAVE_DEBOUNCE_MS = 600;

function rateForClass(svc: CatalogService, itemClass: string | null | undefined): number {
  if (svc.billing === 'flat') return Number(svc.flatRate || 0);
  const k = (itemClass || '').toUpperCase() as keyof typeof svc.rates;
  return Number(svc.rates?.[k] ?? 0);
}

function fmtMoney(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (isNaN(v)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Component ───────────────────────────────────────────────────────────

export function BillingPreviewCard({
  entityType, entityId, tenantId,
  svcCode, itemClass, customPrice, wcItems,
  addons, visible = true, defaultOpen = false,
  editable = false,
  onUpdatePrimaryRate, onAddAddon, onUpdateAddon, onDeleteAddon,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [recorded, setRecorded] = useState<BillingRow[]>([]);
  const [loadingRecorded, setLoadingRecorded] = useState(false);
  const [recordedError, setRecordedError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const { services, loading: catalogLoading } = useServiceCatalog();

  // ─── Primary line ──────────────────────────────────────────────────────
  // Only NON-ZERO customPrice counts as an override. `0`, `null`, and
  // `undefined` all fall through to the catalog rate (fix for the prior
  // bug where customPrice = 0 zeroed out the whole primary charge).
  const hasOverride = customPrice != null && !isNaN(Number(customPrice)) && Number(customPrice) > 0;

  const primary = useMemo(() => {
    if (!svcCode) return null;
    const svc = services.find(s => s.code === svcCode);
    if (!svc) {
      return { code: svcCode, name: svcCode, catalogRate: 0, billing: 'flat' as const, missing: true };
    }
    return {
      code: svc.code,
      name: svc.name,
      catalogRate: rateForClass(svc, itemClass),
      billing: svc.billing,
      missing: false,
    };
  }, [svcCode, services, itemClass]);

  const effectivePrimaryRate = hasOverride ? Number(customPrice) : (primary?.catalogRate ?? 0);

  // Local edit state — synced from props on catalog/customPrice change so
  // external updates (override cleared elsewhere, catalog edited) reflect.
  const [primaryRateDraft, setPrimaryRateDraft] = useState(String(effectivePrimaryRate));
  useEffect(() => {
    setPrimaryRateDraft(String(effectivePrimaryRate));
  }, [effectivePrimaryRate]);

  const primaryRateNum = Number(primaryRateDraft);
  const primaryRate = isNaN(primaryRateNum) ? 0 : primaryRateNum;
  const primaryIsOverride = primary && Math.abs(primaryRate - primary.catalogRate) > 0.0001;

  // ── Will Call: per-item × class projection ──────────────────────────────
  // Tasks/Repairs bill one row at qty=1 with a single class; WCs bill one
  // row PER ITEM with rate keyed on each item's class. The catalog WC rates
  // are class-banded (XS/S/M/L/XL/XXL), so passing itemClass=null returns 0
  // — that's why the preview was rendering "$0.00" for every WC. When the
  // caller passes wcItems we sum across the items here so the preview
  // matches what handleProcessWcRelease_ will actually write. Items are
  // grouped by class so we can render ONE row per class with the real
  // catalog rate (e.g. "Will Call Release (M) · 4 items @ $15 = $60"
  // + "Will Call Release (XS) · 1 item @ $10 = $10") instead of one
  // averaged-rate row that doesn't match any catalog price — the latter
  // confuses operators because the displayed rate ($14 avg) doesn't
  // appear in the price list at all.
  const isWillCall = entityType === 'will_call';
  const wcGroupedByClass = useMemo(() => {
    if (!isWillCall || !wcItems || wcItems.length === 0) return null;
    const svc = services.find(s => s.code === (svcCode ?? ''));
    if (!svc) return null;
    const byClass = new Map<string, { count: number; rate: number }>();
    let total = 0;
    for (const it of wcItems) {
      const klass = (it.itemClass || '').toUpperCase() || '(no class)';
      const rate = rateForClass(svc, it.itemClass ?? null);
      total += rate;
      const prev = byClass.get(klass);
      if (prev) prev.count += 1;
      else byClass.set(klass, { count: 1, rate });
    }
    // Stable order — rate desc, then class name (so XL before XS by amount,
    // and identical-rate buckets sort alphabetically).
    const groups = Array.from(byClass.entries())
      .map(([klass, v]) => ({ klass, count: v.count, rate: v.rate, total: v.count * v.rate }))
      .sort((a, b) => b.rate - a.rate || a.klass.localeCompare(b.klass));
    return { groups, total, totalCount: wcItems.length };
  }, [isWillCall, wcItems, services, svcCode]);

  // primaryTotal still feeds the bottom-line "Projected: $X" + grand total.
  // For WC we use the summed across all classes; for task/repair the existing
  // "qty=1, rate=primaryRate" model.
  const primaryTotal = isWillCall && wcGroupedByClass ? wcGroupedByClass.total : primaryRate;

  const primarySaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedulePrimarySave = useCallback((newRate: number) => {
    if (!editable || !onUpdatePrimaryRate || !primary) return;
    if (primarySaveTimer.current) clearTimeout(primarySaveTimer.current);
    primarySaveTimer.current = setTimeout(() => {
      const isCatalog = Math.abs(newRate - primary.catalogRate) < 0.0001;
      void onUpdatePrimaryRate(isCatalog ? null : newRate);
    }, SAVE_DEBOUNCE_MS);
  }, [editable, onUpdatePrimaryRate, primary]);

  const flushPrimarySave = useCallback(() => {
    if (!editable || !onUpdatePrimaryRate || !primary) return;
    if (primarySaveTimer.current) {
      clearTimeout(primarySaveTimer.current);
      primarySaveTimer.current = null;
    }
    const isCatalog = Math.abs(primaryRate - primary.catalogRate) < 0.0001;
    void onUpdatePrimaryRate(isCatalog ? null : primaryRate);
  }, [editable, onUpdatePrimaryRate, primary, primaryRate]);

  const resetPrimary = useCallback(() => {
    if (!primary) return;
    setPrimaryRateDraft(String(primary.catalogRate));
    if (editable && onUpdatePrimaryRate) {
      void onUpdatePrimaryRate(null);
    }
  }, [primary, editable, onUpdatePrimaryRate]);

  // ─── Addons ────────────────────────────────────────────────────────────
  // v38.177.0 — polymorphic. Addons now flow through to repair / will_call
  // panels too via the unified `addons` table. Unbilled rows show in the
  // projected section; billed rows display with a "Billed" badge but stay
  // visible so staff can see what was added before the entity completed.
  const projectedAddons = useMemo(
    () => addons ?? [],
    [addons],
  );

  // ─── Recorded charges ──────────────────────────────────────────────────
  const fetchRecorded = useCallback(async () => {
    if (!visible || !open || !tenantId || !entityId) return;
    setLoadingRecorded(true);
    setRecordedError(null);
    try {
      let query = supabase
        .from('billing')
        .select('ledger_row_id,status,invoice_no,date,svc_code,svc_name,description,qty,rate,total,task_id,repair_id,shipment_number,item_id,item_class,item_notes')
        .eq('tenant_id', tenantId);

      if (entityType === 'task') {
        // Primary task row OR addon rows whose Task ID is "{taskId}-{svcCode}".
        query = query.or(`task_id.eq.${entityId},task_id.like.${entityId}-%`);
      } else if (entityType === 'will_call') {
        // WC ledger rows + WC addon rows both stamp shipment_number=wcNumber
        // (per handleProcessWcRelease_ + api_writeAddonsToLedger_). Filter on
        // shipment_number alone so addon rows (svc_code != 'WC') are pulled
        // in too. v38.177.0 — was `.eq('svc_code', 'WC')` which excluded
        // addons; widened so the recorded panel now shows them.
        query = query.eq('shipment_number', entityId);
      } else if (entityType === 'repair') {
        // Primary repair row OR addon rows whose Repair ID is "{repairId}-{svcCode}".
        query = query.or(`repair_id.eq.${entityId},repair_id.like.${entityId}-%`);
      }

      const { data, error } = await query
        .order('date', { ascending: true })
        .limit(200);
      if (error) {
        setRecordedError(error.message);
        setRecorded([]);
      } else {
        setRecorded((data ?? []) as BillingRow[]);
      }
    } catch (e) {
      setRecordedError(e instanceof Error ? e.message : String(e));
      setRecorded([]);
    } finally {
      setLoadingRecorded(false);
    }
  }, [visible, open, tenantId, entityType, entityId]);

  useEffect(() => { void fetchRecorded(); }, [fetchRecorded]);

  useEffect(() => {
    if (!visible || !open || !tenantId) return;
    const channel = supabase
      .channel(`billing_preview:${entityType}:${entityId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'billing', filter: `tenant_id=eq.${tenantId}` },
        () => { void fetchRecorded(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [visible, open, tenantId, entityType, entityId, fetchRecorded]);

  if (!visible) return null;

  // ─── Totals ────────────────────────────────────────────────────────────
  const recordedTotal = recorded.reduce(
    (sum, r) => sum + (r.status === 'Void' ? 0 : Number(r.total ?? 0)),
    0,
  );
  const projectedAddonsTotal = projectedAddons.reduce((sum, a) => sum + (a.total ?? 0), 0);

  const primaryAlreadyBooked = primary && recorded.some(r => {
    if (entityType === 'task') {
      return r.ledger_row_id === `${primary.code}-TASK-${entityId}`;
    }
    if (entityType === 'will_call') {
      // WC ledger rows use ledger_row_id="WC-{itemId}-{wcNumber}" — one row
      // per released item. Any matching row means at least some items are
      // booked; the recorded panel below shows the per-item breakdown.
      return r.svc_code === primary.code && r.shipment_number === entityId;
    }
    if (entityType === 'repair') {
      return r.repair_id === entityId && r.svc_code === primary.code;
    }
    return false;
  });

  const showPreview = !primaryAlreadyBooked;
  const projectedTotal = showPreview ? (primaryTotal + projectedAddonsTotal) : 0;
  const grandTotal = recordedTotal + projectedTotal;

  // An addon is "booked" once api_writeAddonsToLedger_ has materialized
  // it to Billing_Ledger. Detection: the addon row itself has billed=true
  // (the most reliable signal), OR a recorded row matches the canonical
  // ledger_row_id prefix `{entityId}-{svcCode}-ADDON-`.
  function isAddonBooked(addon: EntityAddon): boolean {
    if (addon.billed) return true;
    return recorded.some(r =>
      (r.ledger_row_id ?? '').startsWith(`${entityId}-${addon.serviceCode}-ADDON-`)
    );
  }

  const hasAnyContent =
    (showPreview && (primary || projectedAddons.length > 0)) ||
    recorded.length > 0;

  return (
    <>
      <div style={{
        background: '#fff',
        border: `1px solid ${theme.colors.border}`,
        borderRadius: 14,
        marginBottom: 16,
        overflow: 'hidden',
      }}>
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            width: '100%',
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 14px',
            background: 'none', border: 'none',
            cursor: 'pointer', fontFamily: 'inherit',
            textAlign: 'left',
          }}
        >
          {open ? <ChevronDown size={14} color={theme.colors.textMuted} /> : <ChevronRight size={14} color={theme.colors.textMuted} />}
          <DollarSign size={14} color={theme.colors.orange} />
          <span style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>Billing Preview</span>
          <span style={{ fontSize: 12, color: theme.colors.textMuted, fontWeight: 600 }}>
            {fmtMoney(grandTotal)}
          </span>
        </button>

        {open && (
          <div style={{ padding: '4px 14px 14px' }}>
            {/* ── Projected on completion ───────────────────────── */}
            {showPreview && (primary || projectedAddons.length > 0 || (editable && entityType === 'task')) && (
              <SectionHeader icon="schedule" label="Projected on completion" />
            )}
            {showPreview && (
              <div style={{
                border: `1px solid ${theme.colors.border}`,
                borderRadius: 8,
                overflow: 'hidden',
                marginBottom: 12,
              }}>
                {/* WC: emit one ProjectedRow PER class group so each row
                    shows the real catalog rate. Falls through to single-row
                    rendering below if no items / catalog miss. */}
                {primary && isWillCall && wcGroupedByClass && wcGroupedByClass.groups.length > 0 ? (
                  wcGroupedByClass.groups.map(g => (
                    <ProjectedRow
                      key={g.klass}
                      primary
                      serviceName={`${primary.name} · ${g.count} item${g.count !== 1 ? 's' : ''}`}
                      serviceCode={primary.code}
                      classCode={g.klass === '(no class)' ? null : g.klass}
                      qty={g.count}
                      qtyEditable={false}
                      rate={g.rate}
                      rateEditable={false}
                      rateDraft={String(g.rate)}
                      onRateChange={() => { /* read-only for WC */ }}
                      onRateBlur={() => { /* read-only for WC */ }}
                      total={g.total}
                      hasError={false}
                      badge={null}
                      catalogRate={g.rate}
                    />
                  ))
                ) : primary && (
                  <ProjectedRow
                    primary
                    serviceName={primary.name}
                    serviceCode={primary.code}
                    classCode={primary.billing === 'class_based' ? itemClass : null}
                    qty={1}
                    qtyEditable={false}
                    rate={primaryRate}
                    rateEditable={editable && !!onUpdatePrimaryRate}
                    rateDraft={primaryRateDraft}
                    onRateChange={(v) => {
                      setPrimaryRateDraft(v);
                      const num = Number(v);
                      if (!isNaN(num)) schedulePrimarySave(num);
                    }}
                    onRateBlur={flushPrimarySave}
                    total={primaryRate}
                    hasError={primary.missing && !primaryIsOverride}
                    badge={primaryIsOverride ? 'Override' : null}
                    onResetOverride={primaryIsOverride && editable ? resetPrimary : undefined}
                    catalogRate={primary.catalogRate}
                  />
                )}
                {catalogLoading && !primary && <NoteRow text="Loading catalog…" />}
                {projectedAddons.map(a => {
                  const booked = isAddonBooked(a);
                  return (
                    <AddonRowEditable
                      key={a.id}
                      addon={a}
                      editable={editable && !booked && !!onUpdateAddon}
                      deletable={editable && !!onDeleteAddon}
                      booked={booked}
                      onUpdate={onUpdateAddon}
                      onDelete={onDeleteAddon}
                    />
                  );
                })}
                {/* "+ Add Service" — staff/admin only, lives inside the
                    projected section so all addon controls are in one place.
                    v38.177.0: shown for any entity type (was task-only). */}
                {editable && onAddAddon && (
                  <button
                    onClick={() => setShowAddModal(true)}
                    style={{
                      width: '100%',
                      padding: '8px 12px', fontSize: 12, fontWeight: 600,
                      border: 'none', borderTop: `1px dashed ${theme.colors.border}`,
                      background: '#fff', color: theme.colors.orange,
                      cursor: 'pointer', fontFamily: 'inherit',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = theme.colors.bgSubtle; }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
                  >
                    <Plus size={13} /> Add Service
                  </button>
                )}
                <SubtotalRow
                  label={`Projected subtotal · ${(primary ? 1 : 0) + projectedAddons.length} ${(primary ? 1 : 0) + projectedAddons.length === 1 ? 'line' : 'lines'}`}
                  value={primaryTotal + projectedAddonsTotal}
                />
              </div>
            )}

            {primary?.missing && !primaryIsOverride && showPreview && (
              <NoteBanner
                tone="warn"
                title="Missing rate"
                message={`No catalog rate for ${primary.code}${itemClass ? ` / class ${itemClass}` : ''}. The completion will create the row with a Missing Rate flag.`}
              />
            )}

            {/* ── Recorded on the ledger ─────────────────────────── */}
            {recorded.length > 0 && (
              <SectionHeader icon="receipt" label={`Recorded on the ledger (${recorded.length})`} />
            )}
            {loadingRecorded ? (
              <NoteRow text={<><Loader2 size={11} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle', marginRight: 4 }} />Loading…</>} />
            ) : recordedError ? (
              <NoteRow text={`Error loading recorded charges: ${recordedError}`} error />
            ) : recorded.length > 0 ? (
              <div style={{
                border: `1px solid ${theme.colors.border}`,
                borderRadius: 8,
                overflow: 'hidden',
                marginBottom: 12,
              }}>
                {recorded.map(r => <RecordedRow key={r.ledger_row_id} row={r} entityId={entityId} />)}
                <SubtotalRow label="Recorded subtotal (excl. void)" value={recordedTotal} />
              </div>
            ) : null}

            {!hasAnyContent && !editable && (
              <div style={{
                padding: '16px 12px', textAlign: 'center',
                fontSize: 12, color: theme.colors.textMuted,
                border: `1px dashed ${theme.colors.border}`,
                borderRadius: 8, marginBottom: 12,
              }}>
                No billing charges yet
              </div>
            )}

            {/* Grand total */}
            <div style={{
              paddingTop: 10,
              borderTop: `1px solid ${theme.colors.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Total (projected + recorded)</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: theme.colors.orange }}>
                {fmtMoney(grandTotal)}
              </span>
            </div>
            {(projectedTotal > 0 || recordedTotal > 0) && (
              <div style={{
                fontSize: 10, color: theme.colors.textMuted,
                textAlign: 'right', marginTop: 4,
                display: 'flex', justifyContent: 'flex-end', gap: 10,
              }}>
                {showPreview && projectedTotal > 0 && <span>Projected: {fmtMoney(projectedTotal)}</span>}
                {recordedTotal > 0 && <span>Recorded: {fmtMoney(recordedTotal)}</span>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Service modal — only mounted on demand. */}
      {showAddModal && onAddAddon && (
        <AddTaskServiceModal
          itemClass={itemClass || null}
          parentType={entityType}
          onClose={() => setShowAddModal(false)}
          onSubmit={async (input) => { await onAddAddon(input); }}
        />
      )}
    </>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function SectionHeader({ icon, label }: { icon: 'schedule' | 'receipt'; label: string }) {
  const Icon = icon === 'schedule' ? Loader2 : Receipt;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      fontSize: 10, fontWeight: 700, color: theme.colors.textMuted,
      textTransform: 'uppercase', letterSpacing: '0.06em',
      marginBottom: 6,
    }}>
      <Icon size={12} />
      {label}
    </div>
  );
}

const inputStyleCompact: React.CSSProperties = {
  width: 70, padding: '4px 6px', fontSize: 12,
  border: `1px solid ${theme.colors.border}`, borderRadius: 6,
  outline: 'none', fontFamily: 'inherit',
  textAlign: 'right',
};

function ProjectedRow({
  serviceName, serviceCode, classCode,
  qty, qtyEditable, qtyDraft, onQtyChange,
  rate, rateEditable, rateDraft, onRateChange, onRateBlur,
  total, primary, hasError, badge, onResetOverride, catalogRate,
}: {
  serviceName: string;
  serviceCode: string;
  classCode?: string | null;
  qty: number;
  qtyEditable?: boolean;
  qtyDraft?: string;
  onQtyChange?: (v: string) => void;
  rate: number;
  rateEditable?: boolean;
  rateDraft?: string;
  onRateChange?: (v: string) => void;
  onRateBlur?: () => void;
  total: number;
  primary?: boolean;
  hasError?: boolean;
  badge?: string | null;
  onResetOverride?: () => void;
  catalogRate?: number;
}) {
  return (
    <div style={{
      padding: '8px 12px', fontSize: 12,
      background: primary ? '#fff' : theme.colors.bgSubtle,
      borderTop: primary ? 'none' : `1px solid ${theme.colors.border}`,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8, flexWrap: 'wrap',
      }}>
        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, color: theme.colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {serviceName}
            </span>
            <span style={{ fontSize: 10, color: theme.colors.textMuted, fontWeight: 500 }}>
              ({serviceCode})
            </span>
            {classCode && (
              <span style={{
                fontSize: 9, padding: '1px 5px', borderRadius: 4,
                border: `1px solid ${theme.colors.border}`, color: theme.colors.textSecondary,
                fontWeight: 600,
              }}>
                {classCode}
              </span>
            )}
            {badge && (
              <span style={{
                fontSize: 9, padding: '1px 5px', borderRadius: 4,
                background: '#FEF3C7', color: '#92400E', fontWeight: 600,
              }}>
                {badge}
              </span>
            )}
            {hasError && <AlertTriangle size={11} color="#B45309" />}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
          <label style={{ fontSize: 10, color: theme.colors.textMuted, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>Qty</span>
            {qtyEditable && onQtyChange ? (
              <input
                type="number" min={0} step={1}
                value={qtyDraft ?? String(qty)}
                onChange={e => onQtyChange(e.target.value)}
                style={{ ...inputStyleCompact, width: 50 }}
              />
            ) : (
              <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.text, minWidth: 16, textAlign: 'right' }}>
                {qty}
              </span>
            )}
          </label>
          <label style={{ fontSize: 10, color: theme.colors.textMuted, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>Rate</span>
            {rateEditable && onRateChange ? (
              <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <span style={{ position: 'absolute', left: 6, fontSize: 11, color: theme.colors.textMuted, pointerEvents: 'none' }}>$</span>
                <input
                  type="number" min={0} step={0.01}
                  value={rateDraft ?? String(rate)}
                  onChange={e => onRateChange(e.target.value)}
                  onBlur={onRateBlur}
                  style={{ ...inputStyleCompact, paddingLeft: 14 }}
                />
              </span>
            ) : (
              <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.text }}>{fmtMoney(rate)}</span>
            )}
          </label>
          <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: 64, textAlign: 'right' }}>
            {fmtMoney(total)}
          </span>
        </div>
      </div>
      {rateEditable && onResetOverride && catalogRate != null && (
        <div style={{ marginTop: 4, fontSize: 10, color: theme.colors.textMuted, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <span>Catalog: {fmtMoney(catalogRate)}</span>
          <button
            type="button"
            onClick={onResetOverride}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: theme.colors.orange, fontSize: 10, fontWeight: 600, fontFamily: 'inherit' }}
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}

function AddonRowEditable({
  addon, editable, deletable, booked, onUpdate, onDelete,
}: {
  addon: EntityAddon;
  editable: boolean;
  deletable: boolean;
  booked: boolean;
  onUpdate?: (id: string, patch: { quantity?: number; rate?: number | null }) => Promise<unknown>;
  onDelete?: (id: string) => Promise<unknown>;
}) {
  const [qtyDraft, setQtyDraft] = useState(String(addon.quantity));
  const [rateDraft, setRateDraft] = useState(String(addon.rate ?? 0));
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { setQtyDraft(String(addon.quantity)); }, [addon.quantity]);
  useEffect(() => { setRateDraft(String(addon.rate ?? 0)); }, [addon.rate]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSave = useCallback((patch: { quantity?: number; rate?: number | null }) => {
    if (!editable || !onUpdate) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void onUpdate(addon.id, patch); }, SAVE_DEBOUNCE_MS);
  }, [editable, onUpdate, addon.id]);

  const flush = useCallback(() => {
    if (!editable || !onUpdate) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const qty = Number(qtyDraft);
    const rate = Number(rateDraft);
    void onUpdate(addon.id, {
      quantity: isNaN(qty) ? addon.quantity : qty,
      rate: isNaN(rate) ? addon.rate : rate,
    });
  }, [editable, onUpdate, addon.id, addon.quantity, addon.rate, qtyDraft, rateDraft]);

  const qtyNum = Number(qtyDraft);
  const rateNum = Number(rateDraft);
  const liveQty = isNaN(qtyNum) ? addon.quantity : qtyNum;
  const liveRate = isNaN(rateNum) ? Number(addon.rate ?? 0) : rateNum;
  const liveTotal = Math.round(liveQty * liveRate * 100) / 100;

  return (
    <div style={{
      padding: '8px 12px', fontSize: 12,
      background: theme.colors.bgSubtle,
      borderTop: `1px solid ${theme.colors.border}`,
      opacity: booked ? 0.55 : 1,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8, flexWrap: 'wrap',
      }}>
        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, color: theme.colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {addon.serviceName}
            </span>
            <span style={{ fontSize: 10, color: theme.colors.textMuted, fontWeight: 500 }}>
              ({addon.serviceCode})
            </span>
            {addon.itemClass && (
              <span style={{
                fontSize: 9, padding: '1px 5px', borderRadius: 4,
                border: `1px solid ${theme.colors.border}`, color: theme.colors.textSecondary,
                fontWeight: 600,
              }}>
                {addon.itemClass}
              </span>
            )}
            {booked && (
              <span style={{
                fontSize: 9, padding: '1px 5px', borderRadius: 4,
                background: '#FEF3C7', color: '#92400E', fontWeight: 600,
              }}>
                Already billed
              </span>
            )}
          </div>
          {addon.addedByName && (
            <div style={{ fontSize: 10, color: theme.colors.textMuted, marginTop: 1 }}>
              by {addon.addedByName}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
          <label style={{ fontSize: 10, color: theme.colors.textMuted, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>Qty</span>
            {editable ? (
              <input
                type="number" min={0} step={1}
                value={qtyDraft}
                onChange={e => {
                  setQtyDraft(e.target.value);
                  const v = Number(e.target.value);
                  if (!isNaN(v)) scheduleSave({ quantity: v });
                }}
                onBlur={flush}
                style={{ ...inputStyleCompact, width: 50 }}
              />
            ) : (
              <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.text }}>{addon.quantity}</span>
            )}
          </label>
          <label style={{ fontSize: 10, color: theme.colors.textMuted, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>Rate</span>
            {editable ? (
              <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <span style={{ position: 'absolute', left: 6, fontSize: 11, color: theme.colors.textMuted, pointerEvents: 'none' }}>$</span>
                <input
                  type="number" min={0} step={0.01}
                  value={rateDraft}
                  onChange={e => {
                    setRateDraft(e.target.value);
                    const v = Number(e.target.value);
                    if (!isNaN(v)) scheduleSave({ rate: v });
                  }}
                  onBlur={flush}
                  style={{ ...inputStyleCompact, paddingLeft: 14 }}
                />
              </span>
            ) : (
              <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.text }}>{fmtMoney(addon.rate ?? 0)}</span>
            )}
          </label>
          <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: 64, textAlign: 'right' }}>
            {fmtMoney(liveTotal)}
          </span>
          {deletable && onDelete && (
            <button
              onClick={async () => {
                if (!confirm(`Remove ${addon.serviceName}?`)) return;
                setDeleting(true);
                try { await onDelete(addon.id); } finally { setDeleting(false); }
              }}
              disabled={deleting}
              style={{
                background: 'none', border: 'none', padding: 4, cursor: 'pointer',
                color: deleting ? theme.colors.textMuted : '#DC2626',
                display: 'flex', alignItems: 'center',
              }}
              aria-label="Remove addon"
              title="Remove addon"
            >
              {deleting
                ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                : <Trash2 size={13} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RecordedRow({ row, entityId }: { row: BillingRow; entityId: string }) {
  const status = row.status || 'Unbilled';
  const cfg = STATUS_CFG[status] || STATUS_CFG.Unbilled;
  const total = Number(row.total ?? 0);
  const rateVal = row.rate == null ? null : Number(row.rate);
  const hasMissingRate = rateVal == null;
  const isAddon =
    (row.ledger_row_id ?? '').startsWith(`${entityId}-`) &&
    /-ADDON-\d+$/.test(row.ledger_row_id ?? '');

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      padding: '8px 12px', fontSize: 12,
      borderTop: `1px solid ${theme.colors.border}`,
      gap: 8,
      opacity: status === 'Void' ? 0.55 : 1,
      background: hasMissingRate ? '#FEF2F2' : '#fff',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{
            fontWeight: 600, color: theme.colors.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {row.svc_name || row.svc_code || '—'}
          </span>
          {row.svc_code && (
            <span style={{ fontSize: 10, color: theme.colors.textMuted, fontWeight: 500 }}>
              ({row.svc_code})
            </span>
          )}
          <span style={{
            fontSize: 9, padding: '1px 6px', borderRadius: 4,
            background: cfg.bg, color: cfg.color, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            {status}
          </span>
          {hasMissingRate && (
            <span style={{
              fontSize: 9, padding: '1px 6px', borderRadius: 4,
              background: '#FEE2E2', color: '#991B1B', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              Rate Required
            </span>
          )}
          {isAddon && (
            <span style={{
              fontSize: 9, padding: '1px 5px', borderRadius: 4,
              border: `1px solid ${theme.colors.border}`, color: theme.colors.textSecondary,
              fontWeight: 600,
            }}>
              manual
            </span>
          )}
          {row.item_class && (
            <span style={{
              fontSize: 9, padding: '1px 5px', borderRadius: 4,
              border: `1px solid ${theme.colors.border}`, color: theme.colors.textSecondary,
              fontWeight: 600,
            }}>
              {row.item_class}
            </span>
          )}
        </div>
        <div style={{ fontSize: 10, color: theme.colors.textMuted, marginTop: 2 }}>
          {fmtDate(row.date)}
          {row.qty != null && rateVal != null ? ` · Qty ${row.qty} × ${fmtMoney(rateVal)}` : ''}
          {row.invoice_no ? ` · Invoice ${row.invoice_no}` : ''}
        </div>
      </div>
      <div style={{ whiteSpace: 'nowrap' }}>
        {hasMissingRate ? (
          <span style={{ fontSize: 11, fontWeight: 600, color: '#DC2626' }}>
            Set rate to invoice
          </span>
        ) : (
          <span style={{
            fontSize: 13, fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            textDecoration: status === 'Void' ? 'line-through' : 'none',
          }}>
            {fmtMoney(total)}
          </span>
        )}
      </div>
    </div>
  );
}

function SubtotalRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      padding: '8px 12px', fontSize: 11, fontWeight: 700,
      borderTop: `1px solid ${theme.colors.border}`,
      background: theme.colors.bgSubtle,
      color: theme.colors.textMuted,
      textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>
      <span>{label}</span>
      <span style={{ color: theme.colors.text, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(value)}</span>
    </div>
  );
}

function NoteRow({ text, error }: { text: React.ReactNode; error?: boolean }) {
  return (
    <div style={{
      padding: '10px 12px', fontSize: 12,
      color: error ? '#DC2626' : theme.colors.textMuted,
    }}>
      {text}
    </div>
  );
}

function NoteBanner({ tone, title, message }: { tone: 'warn'; title: string; message: string }) {
  const colors = tone === 'warn'
    ? { bg: '#FEF3C7', border: '#FCD34D', text: '#92400E' }
    : { bg: '#FEE2E2', border: '#FCA5A5', text: '#991B1B' };
  return (
    <div style={{
      padding: '10px 12px',
      background: colors.bg,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
      marginBottom: 12,
      fontSize: 12,
      color: colors.text,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <AlertTriangle size={13} style={{ marginTop: 1, flexShrink: 0 }} />
        <div>
          <div style={{ fontWeight: 700 }}>{title}</div>
          <div style={{ marginTop: 2 }}>{message}</div>
        </div>
      </div>
    </div>
  );
}
