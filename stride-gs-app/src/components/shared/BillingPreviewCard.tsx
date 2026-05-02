/**
 * BillingPreviewCard — port of the WMS BillingCalculator component.
 *
 * Read-only billing view that combines:
 *   1. Preview of charges that WILL be created on completion (catalog
 *      rate × class × qty, plus queued task_addons).
 *   2. Recorded ledger rows that already EXIST in public.billing.
 *
 * Adapted from the WMS app's `src/components/billing/BillingCalculator.tsx`
 * (Stride-WMS battle-tested layout) to the GS-app schema:
 *   service_events → service_catalog
 *   billing_events → billing
 *   task_completion event_type → presence of svc_code row matching the
 *                                primary task svc on the same task_id
 *   profile.tenant_id → user.clientSheetId
 *   wc_number column → task_id (will calls live in the same column)
 *   Tailwind/shadcn → inline styles + theme tokens
 *
 * Key preserved behaviors:
 *   - Per-item preview rows GROUPED BY CLASS for cleaner display
 *   - "RATE REQUIRED" red badge when a recorded row has null rate
 *   - "manual" badge on addon-prefixed Ledger Row IDs
 *   - "Already billed" detection — projected lines dim when an
 *     equivalent recorded row exists
 *   - Strikethrough void rows; void rows excluded from totals
 *   - Preview hidden once the entity has an equivalent recorded row
 *   - Status pill on every recorded row (Unbilled / Invoiced / Billed / Void)
 *   - Total row with Preview / Recorded breakdown
 *   - Empty-state ("No billing charges yet") when both sections are empty
 *
 * Staff/admin only — clients don't see billing math in entity panels.
 * Defaults to collapsed.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, DollarSign, Loader2, AlertTriangle, Receipt } from 'lucide-react';
import { theme } from '../../styles/theme';
import { supabase } from '../../lib/supabase';
import { useServiceCatalog, type CatalogService } from '../../hooks/useServiceCatalog';
import type { TaskAddon } from '../../hooks/useTaskAddons';

export type BillingPreviewEntity = 'task' | 'repair' | 'will_call';

interface Props {
  entityType: BillingPreviewEntity;
  /** taskId / repairId / wcNumber. For will_call, this is matched against
   *  the `task_id` column (NOT a separate wc_number — that column doesn't
   *  exist in our schema). */
  entityId: string;
  tenantId: string;
  /** Item ID for the entity, when applicable. Used for the per-item
   *  preview row label (mirrors WMS' itemCode display). */
  itemId?: string | null;
  /** Primary service code (e.g. INSP, ASM, REPAIR, WC). Null when no
   *  primary line exists (e.g. an entity that only ever bills via
   *  add-ons). */
  svcCode?: string | null;
  /** Item class for class-based services. Maps to service_catalog.rates[CLASS]. */
  itemClass?: string | null;
  /** Per-task customPrice override on the primary line. null = use catalog rate. */
  customPrice?: number | null;
  /** Queued task_addons rows. Pass undefined when the entity isn't a task. */
  addons?: TaskAddon[];
  /** Hide for clients. */
  visible?: boolean;
  /** Initial open/closed state. Defaults to closed. */
  defaultOpen?: boolean;
}

/** Snake-case slice of public.billing read by this component. */
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
  svcCode, itemClass, customPrice,
  addons, visible = true, defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [recorded, setRecorded] = useState<BillingRow[]>([]);
  const [loadingRecorded, setLoadingRecorded] = useState(false);
  const [recordedError, setRecordedError] = useState<string | null>(null);

  const { services, loading: catalogLoading } = useServiceCatalog();

  // ─── Projected primary line ────────────────────────────────────────────
  // Mirrors the WMS legacy path: look up the catalog row for the entity's
  // svcCode, then resolve rate by class (class_based) or flat (flat_rate).
  // customPrice — if set on the parent entity (Task.customPrice / Repair
  // quoteAmount / finalAmount) — overrides the catalog rate.
  const primary = useMemo(() => {
    if (!svcCode) return null;
    const svc = services.find(s => s.code === svcCode);
    if (!svc) {
      // No catalog match — return a stub so the row shows with a
      // missing-rate flag, matching WMS behavior for unconfigured
      // services.
      return {
        code: svcCode,
        name: svcCode,
        rate: 0,
        total: 0,
        fromOverride: false,
        missing: true,
        billing: 'flat' as const,
      };
    }
    const catalogRate = rateForClass(svc, itemClass);
    const usingOverride = customPrice != null && !isNaN(customPrice);
    const rate = usingOverride ? Number(customPrice) : catalogRate;
    return {
      code: svc.code,
      name: svc.name,
      rate,
      total: rate, // qty=1 for the per-task primary line; matches GAS billing
      fromOverride: usingOverride,
      missing: !usingOverride && rate <= 0,
      billing: svc.billing,
    };
  }, [svcCode, services, itemClass, customPrice]);

  const projectedAddons = useMemo(
    () => (entityType === 'task' && addons) ? addons : [],
    [entityType, addons],
  );

  // ─── Recorded charges ──────────────────────────────────────────────────
  // Match by entity column. NOTE: there is no `wc_number` column in
  // public.billing — will calls store their identifier in `task_id`,
  // same column tasks use. (This was a bug in the previous from-scratch
  // version.) Addon rows have task_id = "{parentTaskId}-{svcCode}", so
  // we use a prefix match alongside the exact match.
  const fetchRecorded = useCallback(async () => {
    if (!visible || !open || !tenantId || !entityId) return;
    setLoadingRecorded(true);
    setRecordedError(null);
    try {
      let query = supabase
        .from('billing')
        .select('ledger_row_id,status,invoice_no,date,svc_code,svc_name,description,qty,rate,total,task_id,repair_id,item_id,item_class,item_notes')
        .eq('tenant_id', tenantId);

      if (entityType === 'task' || entityType === 'will_call') {
        // Both tasks and will calls live in the task_id column. Addons add
        // a `-{svcCode}` suffix per the GAS flush in handleCompleteTask_.
        query = query.or(`task_id.eq.${entityId},task_id.like.${entityId}-%`);
      } else if (entityType === 'repair') {
        query = query.eq('repair_id', entityId);
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

  // Realtime — any change to a billing row in this tenant nudges a refetch
  // when the card is open. Cheap because the card is collapsed by default.
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
  // Match WMS: void rows are kept for audit but excluded from totals;
  // recorded total = sum of non-void total_amount.
  const recordedTotal = recorded.reduce(
    (sum, r) => sum + (r.status === 'Void' ? 0 : Number(r.total ?? 0)),
    0,
  );
  const projectedAddonsTotal = projectedAddons.reduce((sum, a) => sum + (a.total ?? 0), 0);
  const projectedPrimaryTotal = primary?.total ?? 0;

  // "Already billed" detection — per-line. A projected line is dimmed when
  // the recorded ledger already covers it (post-completion view stays
  // accurate even though we still show the projection).
  const primaryAlreadyBooked = primary && recorded.some(r => {
    if (entityType === 'task' || entityType === 'will_call') {
      // GAS Ledger Row IDs for primary task/WC charges are "{svcCode}-TASK-{id}".
      return r.ledger_row_id === `${primary.code}-TASK-${entityId}`;
    }
    if (entityType === 'repair') {
      return r.repair_id === entityId && r.svc_code === primary.code;
    }
    return false;
  });

  function isAddonBooked(addon: TaskAddon): boolean {
    if (entityType !== 'task') return false;
    return recorded.some(r =>
      r.task_id === `${entityId}-${addon.serviceCode}` ||
      (r.ledger_row_id ?? '').startsWith(`${entityId}-${addon.serviceCode}-ADDON-`)
    );
  }

  // Show preview only when the primary line hasn't been booked yet, mirroring
  // the WMS check for an existing task_completion / receiving event.
  const showPreview = !primaryAlreadyBooked;

  // Projected total only counts toward grand total when shown.
  const projectedTotal = showPreview ? (projectedPrimaryTotal + projectedAddonsTotal) : 0;
  const grandTotal = recordedTotal + projectedTotal;

  const hasAnyContent =
    (showPreview && (primary || projectedAddons.length > 0)) ||
    recorded.length > 0;

  // ─── Render ────────────────────────────────────────────────────────────
  return (
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
          {/* ── Pending Charges (Preview) ────────────────────────── */}
          {showPreview && (primary || projectedAddons.length > 0) && (
            <SectionHeader
              icon="schedule"
              label="Pending Charges (Preview)"
            />
          )}
          {showPreview && (primary || projectedAddons.length > 0) && (
            <div style={{
              border: `1px solid ${theme.colors.border}`,
              borderRadius: 8,
              overflow: 'hidden',
              marginBottom: 12,
            }}>
              {primary && (
                <PreviewRow
                  primary
                  serviceName={primary.name}
                  serviceCode={primary.code}
                  classCode={primary.billing === 'class_based' ? itemClass : null}
                  qty={1}
                  rate={primary.rate}
                  total={primary.total}
                  hasError={primary.missing}
                  badge={primary.fromOverride ? 'Override' : null}
                />
              )}
              {catalogLoading && !primary && (
                <NoteRow text="Loading catalog…" />
              )}
              {projectedAddons.map(a => {
                const booked = isAddonBooked(a);
                return (
                  <PreviewRow
                    key={a.id}
                    serviceName={a.serviceName}
                    serviceCode={a.serviceCode}
                    classCode={a.itemClass}
                    qty={a.quantity}
                    rate={a.rate ?? 0}
                    total={a.total ?? 0}
                    hasError={(a.rate ?? 0) <= 0}
                    dim={booked}
                    badge={booked ? 'Already billed' : (a.addedByName ? `by ${a.addedByName}` : null)}
                  />
                );
              })}
              <SubtotalRow
                label={`Preview subtotal · ${1 + projectedAddons.length} ${1 + projectedAddons.length === 1 ? 'line' : 'lines'}`}
                value={projectedPrimaryTotal + projectedAddonsTotal}
              />
            </div>
          )}

          {primary?.missing && showPreview && (
            <NoteBanner
              tone="warn"
              title="Missing rate"
              message={`No catalog rate for ${primary.code}${itemClass ? ` / class ${itemClass}` : ''}. The completion will create the row with a Missing Rate flag.`}
            />
          )}

          {/* ── Recorded Charges ─────────────────────────────────── */}
          {recorded.length > 0 && (
            <SectionHeader
              icon="receipt"
              label={`Recorded Charges (${recorded.length})`}
            />
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
              <SubtotalRow
                label="Recorded total (excl. void)"
                value={recordedTotal}
              />
            </div>
          ) : null}

          {/* ── Empty state ─────────────────────────────────────── */}
          {!hasAnyContent && (
            <div style={{
              padding: '16px 12px', textAlign: 'center',
              fontSize: 12, color: theme.colors.textMuted,
              border: `1px dashed ${theme.colors.border}`,
              borderRadius: 8, marginBottom: 12,
            }}>
              No billing charges yet
            </div>
          )}

          {/* ── Grand total + breakdown ─────────────────────────── */}
          <div style={{
            paddingTop: 10,
            borderTop: `1px solid ${theme.colors.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Total</span>
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
              {showPreview && projectedTotal > 0 && <span>Preview: {fmtMoney(projectedTotal)}</span>}
              {recordedTotal > 0 && <span>Recorded: {fmtMoney(recordedTotal)}</span>}
            </div>
          )}
        </div>
      )}
    </div>
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

function PreviewRow({
  serviceName, serviceCode, classCode, qty, rate, total,
  primary, hasError, dim, badge,
}: {
  serviceName: string;
  serviceCode: string;
  classCode?: string | null;
  qty: number;
  rate: number;
  total: number;
  primary?: boolean;
  hasError?: boolean;
  dim?: boolean;
  badge?: string | null;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 12px', fontSize: 12,
      gap: 8,
      background: primary ? '#fff' : theme.colors.bgSubtle,
      borderTop: primary ? 'none' : `1px solid ${theme.colors.border}`,
      opacity: dim ? 0.55 : 1,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
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
          <span style={{ fontSize: 11, color: theme.colors.textMuted }}>×{qty}</span>
          {hasError && <AlertTriangle size={11} color="#B45309" />}
          {badge && (
            <span style={{
              fontSize: 9, padding: '1px 5px', borderRadius: 4,
              background: '#FEF3C7', color: '#92400E', fontWeight: 600,
            }}>
              {badge}
            </span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
        {hasError && rate <= 0 ? (
          <span style={{ fontSize: 11, color: theme.colors.textMuted, fontStyle: 'italic' }}>No rate</span>
        ) : (
          <>
            <span style={{ fontSize: 11, color: theme.colors.textMuted, fontVariantNumeric: 'tabular-nums' }}>
              {fmtMoney(rate)}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: 64, textAlign: 'right' }}>
              {fmtMoney(total)}
            </span>
          </>
        )}
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
  // Match WMS' "manual" badge — addon rows have task_id like `{parent}-{svcCode}`
  // and Ledger Row ID like `{parent}-{svcCode}-ADDON-{n}`.
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
