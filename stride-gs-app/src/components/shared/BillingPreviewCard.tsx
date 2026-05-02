/**
 * BillingPreviewCard — collapsible "Billing Preview" card for the
 * Details tab of TaskDetailPanel / RepairDetailPanel / WillCallDetailPanel.
 *
 * Two sections:
 *   1. Projected charges — what WILL bill on completion. Sourced from the
 *      service_catalog rate for the entity's svcCode + itemClass, plus
 *      any queued task add-ons (public.task_addons). Honors customPrice
 *      override on the primary line.
 *   2. Recorded charges — billing rows already on the ledger for this
 *      item / entity. Pulled live from public.billing.
 *
 * Staff/admin only. Clients don't see billing math in entity panels.
 *
 * Defaults to collapsed so the Details body stays scannable.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, DollarSign, Loader2 } from 'lucide-react';
import { theme } from '../../styles/theme';
import { supabase } from '../../lib/supabase';
import { useServiceCatalog, type CatalogService } from '../../hooks/useServiceCatalog';
import type { TaskAddon } from '../../hooks/useTaskAddons';

export type BillingPreviewEntity = 'task' | 'repair' | 'will_call';

interface Props {
  entityType: BillingPreviewEntity;
  entityId: string;          // taskId / repairId / wcNumber
  tenantId: string;
  itemId?: string | null;
  /** Primary service code (e.g. INSP, ASM, REPAIR, WC). Null = no primary line. */
  svcCode?: string | null;
  /** Item class for class-based services (XS/S/M/L/XL/XXL). */
  itemClass?: string | null;
  /** Custom price override on the primary line. null = use catalog rate. */
  customPrice?: number | null;
  /** Queued task addons. Pass undefined if entity isn't a task. */
  addons?: TaskAddon[];
  /** Hide for clients — set this to false from the panel. */
  visible?: boolean;
  /** Optional initial open state. Defaults to false (collapsed). */
  defaultOpen?: boolean;
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
  wc_number: string | null;
  item_id: string | null;
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
  if (n == null || isNaN(Number(n))) return '—';
  return `$${Number(n).toFixed(2)}`;
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function BillingPreviewCard({
  entityType, entityId, tenantId, itemId,
  svcCode, itemClass, customPrice,
  addons, visible = true, defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [recorded, setRecorded] = useState<BillingRow[]>([]);
  const [loadingRecorded, setLoadingRecorded] = useState(false);
  const [recordedError, setRecordedError] = useState<string | null>(null);

  const { services, loading: catalogLoading } = useServiceCatalog();

  const primary = useMemo(() => {
    if (!svcCode) return null;
    const svc = services.find(s => s.code === svcCode);
    if (!svc) return { code: svcCode, name: svcCode, rate: 0, total: 0, fromOverride: false, missing: true };
    const catalogRate = rateForClass(svc, itemClass);
    const usingOverride = customPrice != null && !isNaN(customPrice);
    const rate = usingOverride ? Number(customPrice) : catalogRate;
    return {
      code: svc.code,
      name: svc.name,
      rate,
      total: rate,
      fromOverride: usingOverride,
      missing: !usingOverride && rate <= 0,
    };
  }, [svcCode, services, itemClass, customPrice]);

  const projectedAddons = useMemo(
    () => (entityType === 'task' && addons) ? addons : [],
    [entityType, addons],
  );

  const projectedTotal = useMemo(() => {
    let t = primary?.total ?? 0;
    for (const a of projectedAddons) t += a.total ?? 0;
    return t;
  }, [primary, projectedAddons]);

  // ── Fetch recorded charges from public.billing ───────────────────────
  // Match by entity column (task_id / repair_id / wc_number) so addon rows
  // (which carry "{taskId}-{svcCode}" in task_id) ALSO show up under the
  // parent task — see the GAS flush in handleCompleteTask_.
  const fetchRecorded = useCallback(async () => {
    if (!visible || !open || !tenantId) return;
    setLoadingRecorded(true);
    setRecordedError(null);
    try {
      let query = supabase
        .from('billing')
        .select('ledger_row_id,status,invoice_no,date,svc_code,svc_name,description,qty,rate,total,task_id,repair_id,wc_number,item_id')
        .eq('tenant_id', tenantId);

      if (entityType === 'task') {
        // Addon rows have task_id = "{parentTaskId}-{svcCode}", so use a
        // prefix match (task_id eq parent OR task_id like parent-%).
        query = query.or(`task_id.eq.${entityId},task_id.like.${entityId}-%`);
      } else if (entityType === 'repair') {
        query = query.eq('repair_id', entityId);
      } else if (entityType === 'will_call') {
        query = query.eq('wc_number', entityId);
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

  // Realtime: any billing change for this tenant nudges a refetch when
  // the card is open. Cheap because the card is collapsed by default.
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

  const recordedTotal = recorded.reduce(
    (sum, r) => sum + (r.status === 'Void' ? 0 : Number(r.total ?? 0)),
    0,
  );
  const grandTotal = projectedTotal + recordedTotal;

  // Suppress double-counting: if a recorded row already covers the
  // primary line (ledger_row_id starts with svcCode + "-TASK-" + entityId
  // for tasks; or carries the raw entity id for repairs/will calls), the
  // primary line is "already booked" — show it dimmed.
  const primaryAlreadyBooked = primary && recorded.some(r => {
    if (entityType === 'task') return r.ledger_row_id === `${primary.code}-TASK-${entityId}`;
    if (entityType === 'repair') return r.repair_id === entityId && r.svc_code === primary.code;
    return r.wc_number === entityId && r.svc_code === primary.code;
  });

  // For tasks: addon already booked if a recorded row's ledger_row_id
  // matches `{taskId}-{addonCode}-ADDON-{n}` (n is positional, see
  // handleCompleteTask_'s addon flush). Match by prefix to stay robust.
  function isAddonBooked(addon: TaskAddon): boolean {
    if (entityType !== 'task') return false;
    return recorded.some(r =>
      r.task_id === `${entityId}-${addon.serviceCode}` ||
      (r.ledger_row_id ?? '').startsWith(`${entityId}-${addon.serviceCode}-ADDON-`)
    );
  }

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
          {/* ── Projected ─────────────────────────────────────────── */}
          <div style={{ marginBottom: 10 }}>
            <div style={{
              fontSize: 10, fontWeight: 600, color: theme.colors.textMuted,
              textTransform: 'uppercase', letterSpacing: '0.04em',
              marginBottom: 6,
            }}>
              Projected on completion
            </div>
            <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
              {/* Primary line */}
              {primary ? (
                <Row
                  primary
                  label={`${primary.name}${primary.fromOverride ? ' · override' : ''}`}
                  code={primary.code}
                  qty={1}
                  rate={primary.rate}
                  total={primary.total}
                  dim={!!primaryAlreadyBooked}
                  badge={primaryAlreadyBooked ? 'Already billed' : (primary.missing ? 'Missing rate' : null)}
                />
              ) : (
                <NoteRow text="No primary service code on this entity." />
              )}
              {catalogLoading && !primary && (
                <NoteRow text="Loading catalog…" />
              )}
              {/* Addons */}
              {projectedAddons.map(a => {
                const booked = isAddonBooked(a);
                return (
                  <Row
                    key={a.id}
                    label={a.serviceName}
                    code={a.serviceCode}
                    qty={a.quantity}
                    rate={a.rate ?? 0}
                    total={a.total ?? 0}
                    dim={booked}
                    badge={booked ? 'Already billed' : null}
                  />
                );
              })}
              <TotalRow
                label="Projected total"
                value={projectedTotal}
              />
            </div>
            {entityType === 'task' && projectedAddons.length === 0 && (
              <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 4 }}>
                No add-on services queued. Use Add Service in the footer to attach extras.
              </div>
            )}
          </div>

          {/* ── Recorded ──────────────────────────────────────────── */}
          <div>
            <div style={{
              fontSize: 10, fontWeight: 600, color: theme.colors.textMuted,
              textTransform: 'uppercase', letterSpacing: '0.04em',
              marginBottom: 6,
            }}>
              Recorded on the ledger
            </div>
            <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
              {loadingRecorded ? (
                <NoteRow text={<><Loader2 size={11} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle', marginRight: 4 }} />Loading…</>} />
              ) : recordedError ? (
                <NoteRow text={`Error: ${recordedError}`} error />
              ) : recorded.length === 0 ? (
                <NoteRow text="No billing rows recorded yet." />
              ) : (
                <>
                  {recorded.map(r => (
                    <RecordedRow key={r.ledger_row_id} row={r} />
                  ))}
                  <TotalRow
                    label="Recorded total (excl. void)"
                    value={recordedTotal}
                  />
                </>
              )}
            </div>
          </div>

          {/* ── Grand total ───────────────────────────────────────── */}
          <div style={{
            marginTop: 10, padding: '8px 12px',
            background: theme.colors.bgSubtle,
            borderRadius: 8,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Total (projected + recorded)
            </span>
            <span style={{ fontSize: 14, fontWeight: 700 }}>
              {fmtMoney(grandTotal)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Row sub-components ───────────────────────────────────────────────────

function Row({
  label, code, qty, rate, total, primary, dim, badge,
}: {
  label: string; code?: string; qty: number; rate: number; total: number;
  primary?: boolean; dim?: boolean; badge?: string | null;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 12px', fontSize: 12,
      background: primary ? '#fff' : theme.colors.bgSubtle,
      borderTop: primary ? 'none' : `1px solid ${theme.colors.border}`,
      gap: 8,
      opacity: dim ? 0.55 : 1,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: theme.colors.text, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label}
          </span>
          {code && (
            <span style={{ fontSize: 10, color: theme.colors.textMuted, fontWeight: 500 }}>
              ({code})
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
        </div>
        <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 1 }}>
          Qty {qty} × {fmtMoney(rate)}
        </div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
        {fmtMoney(total)}
      </div>
    </div>
  );
}

function RecordedRow({ row }: { row: BillingRow }) {
  const status = row.status || 'Unbilled';
  const cfg = STATUS_CFG[status] || STATUS_CFG.Unbilled;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 12px', fontSize: 12,
      borderTop: `1px solid ${theme.colors.border}`,
      gap: 8,
      opacity: status === 'Void' ? 0.55 : 1,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: theme.colors.text, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.svc_name || row.svc_code || '—'}
          </span>
          {row.svc_code && (
            <span style={{ fontSize: 10, color: theme.colors.textMuted, fontWeight: 500 }}>
              ({row.svc_code})
            </span>
          )}
          <span style={{
            fontSize: 9, padding: '1px 6px', borderRadius: 4,
            background: cfg.bg, color: cfg.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            {status}
          </span>
        </div>
        <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 1 }}>
          {fmtDate(row.date)}
          {row.qty != null && row.rate != null ? ` · Qty ${row.qty} × ${fmtMoney(Number(row.rate))}` : ''}
          {row.invoice_no ? ` · Invoice ${row.invoice_no}` : ''}
        </div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
        {fmtMoney(Number(row.total ?? 0))}
      </div>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      padding: '8px 12px', fontSize: 12,
      borderTop: `1px solid ${theme.colors.border}`,
      background: theme.colors.bgSubtle,
      fontWeight: 700,
    }}>
      <span style={{ color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 11 }}>
        {label}
      </span>
      <span>{fmtMoney(value)}</span>
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
