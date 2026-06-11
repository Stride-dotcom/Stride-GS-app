import React, { useState, useMemo } from 'react';
import { X, Check, ClipboardList, Loader2, AlertTriangle, Split as SplitIcon, ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { postBatchCreateTasks, postCreateSplitTask } from '../../lib/api';
import type { InventoryItem, Task } from '../../lib/types';
import { usePricing } from '../../hooks/usePricing';
import { useServiceCatalog } from '../../hooks/useServiceCatalog';
import { useFeatureFlagRow, resolveFlagBackend } from '../../contexts/FeatureFlagContext';
import { theme } from '../../styles/theme';
import { ProcessingOverlay } from './ProcessingOverlay';
import { entityEvents } from '../../lib/entityEvents';

interface Props {
  items: InventoryItem[];
  clientSheetId: string;
  onClose: () => void;
  onSuccess: (taskIds: string[]) => void;
  // Phase 2C — optimistic create functions (optional)
  addOptimisticTask?: (task: Task) => void;
  removeOptimisticTask?: (tempTaskId: string) => void;
  clientName?: string;
  /** Existing tasks — used to warn about duplicates before submit */
  existingTasks?: Task[];
}

interface ConflictInfo {
  itemId: string;
  taskId: string;
  svcCode: string;
  typeName: string;
}

// Always offer these core task types
const CORE_TYPES = [
  { code: 'INSP', name: 'Inspection' },
  { code: 'ASM',  name: 'Assembly' },
];

// Exclude billing-only and special-flow types from the generic batch picker.
// SPLIT is excluded here because the batch picker creates one task per
// (item, svcCode) combo via the generic `batchCreateTasks` handler, which
// has no notion of grouped-qty splitting — Split tasks come exclusively
// from the dedicated `createSplitTask` flow (Item detail page button, or
// auto-create from this modal's grouped-item detection below).
const EXCLUDE_CODES = new Set(['STOR', 'RCVG', 'REPAIR', 'RPR', 'WC', 'WCPU', 'SPLIT']);

export function CreateTaskModal({ items, clientSheetId, onClose, onSuccess, addOptimisticTask, removeOptimisticTask, clientName, existingTasks }: Props) {
  const { priceList } = usePricing(true);
  // Service catalog provides default_sla_hours per svcCode — used to
  // pre-stamp Due Date on the new task rows so they show up correctly
  // in the "sort by due date" dashboard view. Pre-2026-05-13 the field
  // existed in the catalog (Settings → Price List → Services) but was
  // never read at task creation, so every new task had Due Date = blank
  // regardless of what the operator set.
  const { services: serviceCatalog } = useServiceCatalog();
  const slaHoursBySvcCode = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const row of serviceCatalog) {
      const code = String(row.code || '').trim().toUpperCase();
      if (code && row.defaultSlaHours != null && row.defaultSlaHours > 0) {
        map[code] = row.defaultSlaHours;
      }
    }
    return map;
  }, [serviceCatalog]);
  // Start with NO task type pre-selected. Previously this defaulted to
  // {'INSP'}, which caused accidental Inspection tasks when an operator
  // didn't notice it was already checked. The operator must now actively
  // pick at least one type; the Create button stays disabled until they do.
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());

  // 2026-05-29 — Advanced section state. All three fields are optional:
  // dueDateOverride empty means "use the auto-calculated SLA from the
  // service catalog"; taskNotes empty stamps a blank Task Notes cell;
  // priority defaults to Standard (mapped to 'Normal' on submit so it
  // round-trips with the legacy schema).
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [dueDateOverride, setDueDateOverride] = useState('');
  const [taskNotesInput, setTaskNotesInput] = useState('');
  const [priorityInput, setPriorityInput] = useState<'Standard' | 'High' | 'Urgent'>('Standard');
  // Map the user-facing label back to the wire value. Schema today only
  // distinguishes Normal vs High; Urgent piggybacks on High but also forces
  // due_date = today so it floats to the top of the dashboard the same way
  // the priority chip toggle does (Tasks.tsx __toggleTaskPriority).
  const priorityForWire = priorityInput === 'Standard' ? 'Normal' : 'High';
  const todayPT = useMemo(() => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()), []);
  // Preview of the auto-calculated due date for the FIRST selected svcCode
  // — shown as placeholder text on the date input so the operator knows
  // what they'll get if they leave the override blank. Multi-svc selections
  // will get per-svcCode dates from slaHoursBySvcCode, so we don't bother
  // surfacing a "varies" preview.
  const autoDueDatePreview = useMemo(() => {
    if (selectedCodes.size !== 1) return '';
    const code = Array.from(selectedCodes)[0];
    const hrs = slaHoursBySvcCode[code];
    if (!hrs || hrs <= 0) return '';
    const dt = new Date(Date.now() + hrs * 3600 * 1000);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(dt);
  }, [selectedCodes, slaHoursBySvcCode]);

  // Grouped-item detection — same notice the WC modal shows. Any item with
  // qty > 1 will need a warehouse split before per-piece tasks can be done.
  const groupedItems = useMemo(
    () => items.filter(i => Number((i as { qty?: number }).qty) > 1),
    [items],
  );

  // BatchWorkItems (2026-06-11) — "single batch task" mode. Gated on the
  // batchWorkItemsTasks flag resolved against the DATA tenant (same UI-only
  // gate the detail panels use), and only meaningful with 2+ items. The
  // flag's tenant scope is a subset of the createTask SB canary, so any
  // tenant that can see this toggle is routed to batch-create-tasks-sb (the
  // GAS handler ignores batchMode).
  // D6 (BATCH_WORK_ITEMS_QA.md): TASK batch surfaces are parked behind this
  // separate, intentionally-unseeded key while the per-item workflow is
  // proven on repairs — so the toggle is hidden everywhere until a
  // 'batchWorkItemsTasks' feature_flags row is inserted (no deploy needed).
  const batchWorkFlagRow = useFeatureFlagRow('batchWorkItemsTasks');
  const batchModeAvailable =
    items.length > 1 &&
    !!batchWorkFlagRow &&
    resolveFlagBackend(batchWorkFlagRow, clientSheetId || null) === 'supabase';
  // D1 (BATCH_WORK_ITEMS_QA.md): batch is the DEFAULT whenever it's
  // available — staff opt OUT for per-item tasks. Tracked as an opt-out
  // boolean (not initial state) because the flag row loads async: at first
  // render batchModeAvailable is false, so a `useState(batchModeAvailable)`
  // default would freeze OFF.
  const [batchOptOut, setBatchOptOut] = useState(false);
  const batchMode = batchModeAvailable && !batchOptOut;
  const batchModeActive = batchMode;

  // Mixed-class guard for batch mode: complete_task_atomic rates a
  // class_based service (INSP and RUSH are class_based in the live catalog)
  // from the batch task's PRIMARY item class only, billing rate × total qty
  // — a batch spanning classes would mis-rate every other class. Block
  // submit and explain; the EF rejects server-side too (backstop).
  const classBasedSelected = useMemo(() => {
    const classBased = new Set<string>();
    for (const s of serviceCatalog) {
      const c = String(s.code || '').trim().toUpperCase();
      if (c && s.billing === 'class_based') classBased.add(c);
    }
    return Array.from(selectedCodes).filter(c => classBased.has(c));
  }, [serviceCatalog, selectedCodes]);
  const distinctItemClasses = useMemo(() => {
    const set = new Set(items.map(i => String(i.itemClass || '').trim().toUpperCase()));
    return Array.from(set);
  }, [items]);
  const batchClassConflict =
    batchModeActive && classBasedSelected.length > 0 && distinctItemClasses.length > 1;
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ created: number; skippedCount: number; taskIds: string[] } | null>(null);
  const [error, setError] = useState('');
  const [dismissedConflicts, setDismissedConflicts] = useState(false);

  // Build deduplicated task type list: core first, then pricing extras
  // gated on the service-catalog `showAsTask` flag.
  //
  // Pre-2026-05-28 this added every priceList row that wasn't on the
  // EXCLUDE_CODES denylist, which surfaced shipping/billing-only services
  // (Blanket Wrap Delivery, Custom Crating, Photo Documentation, After-
  // Hours Access, Long Carry Fee, Insurance Surcharge, etc.) in the
  // operator's task-type picker even though those services aren't tasks
  // at all — they're delivery accessorials or billing line items.
  //
  // New gate: a non-CORE service code only appears here if the matching
  // service_catalog row has BOTH `active=true` AND `showAsTask=true`. The
  // catalog admin (Settings → Price List → service edit) is where the
  // operator opts a service in to the task picker, so this puts the
  // picker in sync with the toggle they already control.
  //
  // CORE_TYPES (INSP, ASM) bypass the gate — they're the primary task
  // types and must always be available even on a fresh tenant whose
  // catalog hasn't been customized yet.
  //
  // Safety fallback: if `serviceCatalog` is empty (still loading or
  // unreachable), the gate is skipped and the legacy denylist-only
  // behavior applies so the modal stays usable. Once the catalog
  // arrives the React re-render flips to the filtered list.
  const taskTypes = useMemo(() => {
    const catalogLoaded = serviceCatalog.length > 0;
    const taskEnabledCodes = new Set<string>();
    // Fabric Protection services are used rarely but the operator wants
    // them ALL flagged showAsTask=true (it'd be tedious to maintain a
    // per-service toggle on a category that's "all-on by policy"). The
    // category has ~11 codes today (FAB_RUG, FAB_BED, FAB_CARPET, …) so
    // they'd push the everyday INSP/ASM/etc. picks below the fold. Push
    // every Fabric Protection code to the END of the list so the
    // common picks stay at the top.
    const fabricCodes = new Set<string>();
    if (catalogLoaded) {
      for (const s of serviceCatalog) {
        const c = String(s.code || '').trim().toUpperCase();
        if (!c) continue;
        if (s.active && s.showAsTask) taskEnabledCodes.add(c);
        if (s.category === 'Fabric Protection') fabricCodes.add(c);
      }
    }
    const seen = new Set<string>(CORE_TYPES.map(t => t.code));
    const types = [...CORE_TYPES];
    priceList.forEach(p => {
      const code = String(p['Service Code'] || '').trim().toUpperCase();
      const name = String(p['Service Name'] || code).trim();
      if (!code || seen.has(code) || EXCLUDE_CODES.has(code)) return;
      if (catalogLoaded && !taskEnabledCodes.has(code)) return;
      types.push({ code, name });
      seen.add(code);
    });
    // Partition: keep non-fabric in their existing order (CORE first,
    // then priceList order), then append fabric codes at the end.
    if (fabricCodes.size === 0) return types;
    const nonFabric = types.filter(t => !fabricCodes.has(t.code));
    const fabric    = types.filter(t =>  fabricCodes.has(t.code));
    return [...nonFabric, ...fabric];
  }, [priceList, serviceCatalog]);

  // Check for existing open tasks that conflict with selected items + task types (exclude optimistic TEMP entries)
  const conflicts = useMemo<ConflictInfo[]>(() => {
    if (!existingTasks?.length || !selectedCodes.size) return [];
    const openStatuses = new Set(['Open', 'In Progress']);
    const itemIdSet = new Set(items.map(i => i.itemId));
    const results: ConflictInfo[] = [];
    for (const t of existingTasks) {
      if (t.taskId.startsWith('TEMP-')) continue; // skip optimistic creates
      if (!openStatuses.has(t.status)) continue;
      if (!itemIdSet.has(t.itemId)) continue;
      const code = (t.svcCode || t.type || '').toUpperCase();
      if (!selectedCodes.has(code)) continue;
      const typeName = taskTypes.find(tt => tt.code === code)?.name || code;
      results.push({ itemId: t.itemId, taskId: t.taskId, svcCode: code, typeName });
    }
    return results;
  }, [existingTasks, items, selectedCodes, taskTypes]);

  const toggleCode = (code: string) => {
    setDismissedConflicts(false);
    setSelectedCodes(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!selectedCodes.size || loading || batchClassConflict) return;
    setLoading(true);
    setError('');

    // Phase 2C: insert temp task rows immediately
    const tempIds: string[] = [];
    const now = new Date().toISOString().slice(0, 10);
    // Urgent forces due_date = today (PT) at create time — see priorityForWire above.
    const effectiveDueDate = dueDateOverride
      || (priorityInput === 'Urgent' ? todayPT : '');
    const trimmedNotes = taskNotesInput.trim();
    if (addOptimisticTask) {
      // batchMode: ONE temp task per svcCode (covering all items, primary =
      // first item) — mirrors what the EF will create. Legacy: one per
      // (item, svcCode).
      const tempItems = batchModeActive ? items.slice(0, 1) : items;
      tempItems.forEach((item, ii) => {
        Array.from(selectedCodes).forEach((code, ci) => {
          const tempId = `TEMP-${Date.now()}-${ii}-${ci}`;
          tempIds.push(tempId);
          addOptimisticTask({
            taskId: tempId,
            type: code,
            svcCode: code,
            status: 'Open',
            itemId: item.itemId,
            clientId: clientSheetId,
            clientName: clientName || '',
            vendor: item.vendor,
            description: item.description || '',
            location: item.location,
            sidemark: item.sidemark,
            created: now,
            billed: false,
            dueDate: effectiveDueDate || undefined,
            priority: priorityForWire as 'Normal' | 'High',
            taskNotes: trimmedNotes || undefined,
          });
        });
      });
    }

    try {
      const res = await postBatchCreateTasks(
        {
          items: items.map(i => ({
            itemId:      i.itemId,
            vendor:      i.vendor,
            description: i.description,
            location:    i.location,
            sidemark:    i.sidemark,
            itemNotes:   i.notes,
            shipmentNo:  i.shipmentNumber,
          })),
          svcCodes: Array.from(selectedCodes),
          // Per-svcCode default SLA hours from the service catalog —
          // GAS handleBatchCreateTasks_ stamps Due Date = now() + N hours
          // on each new task row when the svcCode has a value here.
          slaHoursBySvcCode,
          // 2026-05-29 — Advanced fields from the collapsible section.
          // Only sent when the operator filled them in; otherwise the
          // GAS / SB handlers fall back to slaHoursBySvcCode + blank notes
          // + Normal priority.
          ...(effectiveDueDate ? { dueDate: effectiveDueDate } : {}),
          ...(trimmedNotes     ? { taskNotes: trimmedNotes } : {}),
          priority: priorityForWire,
          ...(batchModeActive ? { batchMode: true } : {}),
        },
        clientSheetId
      );
      if (res.data?.success) {
        const r = res.data;
        // Don't remove the temps here — useTasks.auto-reconcile drops them
        // when the real tasks arrive (matched by type|itemId|clientSheetId
        // signature). Eager removal creates a 1-3s gap where the temp
        // tasks vanish from the Tasks list AND the (I) / (A) badges drop
        // off the inventory rows until the GAS write-through propagates.
        // Realtime fan-out via entityEvents.emit triggers the refetch.
        for (const tid of (r.taskIds ?? [])) entityEvents.emit('task', tid);
        setResult({ created: r.created, skippedCount: r.skipped?.length ?? 0, taskIds: r.taskIds ?? [] });
        onSuccess(r.taskIds ?? []);

        // Auto-create a Split task for every grouped item, so per-piece
        // work can proceed against individual labels. Best-effort.
        if (groupedItems.length > 0) {
          await Promise.all(groupedItems.map(async (gi) => {
            try {
              const giQty = Number((gi as { qty?: number }).qty) || 1;
              await postCreateSplitTask({
                itemId: gi.itemId,
                groupedQty: giQty,
                keepQty: 1,
                leftoverQty: Math.max(1, giQty - 1),
                notes: `Auto-created alongside ${Array.from(selectedCodes).join('+')} tasks.`,
                origin: 'task',
                originEntityId: (r.taskIds ?? [])[0] || undefined,
                originEntityNumber: (r.taskIds ?? [])[0] || undefined,
              }, clientSheetId);
            } catch (e) {
              console.warn('[CreateTaskModal] auto-split create failed for', gi.itemId, e);
            }
          }));
        }
      } else {
        // Rollback temp rows
        tempIds.forEach(id => removeOptimisticTask?.(id));
        setError(res.error || res.data?.error || 'Failed to create tasks');
      }
    } catch (err: unknown) {
      // Rollback temp rows
      tempIds.forEach(id => removeOptimisticTask?.(id));
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const toggleStyle = (on: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
    border: `1px solid ${on ? theme.colors.orange : theme.colors.border}`,
    background: on ? theme.colors.orangeLight : '#fff',
    transition: 'all 0.15s',
  });

  return (
    <>
      <div onClick={loading ? undefined : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 200 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 420, maxWidth: '95vw', maxHeight: '85vh',
        background: '#fff', borderRadius: 20, boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
        zIndex: 201, fontFamily: theme.typography.fontFamily, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        <ProcessingOverlay
          visible={loading}
          message={`Hold tight — creating ${selectedCodes.size > 1 ? 'tasks' : 'your task'}`}
          subMessage="This usually takes a few seconds. You can leave this open."
        />

        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${theme.colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ClipboardList size={16} color={theme.colors.orange} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Create Tasks</div>
              <div style={{ fontSize: 11, color: theme.colors.textMuted }}>
                {items.length} item{items.length !== 1 ? 's' : ''} selected
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          {result ? (
            /* Success state */
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>✓</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#15803D', marginBottom: 6 }}>
                {result.created} task{result.created !== 1 ? 's' : ''} created
              </div>
              {result.skippedCount > 0 && (
                <div style={{ fontSize: 12, color: theme.colors.textMuted, marginBottom: 6 }}>
                  {result.skippedCount} skipped (already had open task)
                </div>
              )}
              <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 4 }}>
                {result.taskIds.slice(0, 5).join(', ')}{result.taskIds.length > 5 ? ` +${result.taskIds.length - 5} more` : ''}
              </div>
            </div>
          ) : (
            <>
              {/* BatchWorkItems — single batch task toggle (flag-gated,
                  2+ items). D1: ON by default, at the TOP of the modal.
                  One task per service covering ALL items, each tracked
                  individually (Start/Pass/Fail + photos per item) on the
                  task detail page. Staff uncheck to create per-item tasks. */}
              {batchModeAvailable && (
                <div onClick={() => setBatchOptOut(b => !b)} style={{ ...toggleStyle(batchMode), marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Layers size={16} color={batchMode ? theme.colors.orange : theme.colors.textMuted} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: batchMode ? theme.colors.orange : theme.colors.text }}>
                        Create as one batch task
                      </div>
                      <div style={{ fontSize: 10, color: theme.colors.textMuted }}>
                        One task per service covering all {items.length} items — each item gets its own
                        Start / Pass / Fail tracking and photos on the task.
                        Uncheck to create a separate task per item.
                      </div>
                    </div>
                  </div>
                  {batchMode && <Check size={14} color={theme.colors.orange} />}
                </div>
              )}

              {/* Task type selector */}
              <div style={{ fontSize: 12, color: theme.colors.textMuted, marginBottom: 12 }}>
                Select task type(s) to create for all selected items:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {taskTypes.map(t => {
                  const on = selectedCodes.has(t.code);
                  return (
                    <div key={t.code} onClick={() => toggleCode(t.code)} style={toggleStyle(on)}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: on ? theme.colors.orange : theme.colors.text }}>
                          {t.name}
                        </div>
                        <div style={{ fontSize: 10, color: theme.colors.textMuted }}>{t.code}</div>
                      </div>
                      {on && <Check size={14} color={theme.colors.orange} />}
                    </div>
                  );
                })}
              </div>

              {batchClassConflict && (
                <div style={{ padding: '10px 12px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <AlertTriangle size={14} color="#B91C1C" />
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#B91C1C' }}>
                      Batch task can't mix item classes
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#7F1D1D', lineHeight: 1.5 }}>
                    {classBasedSelected.join(' + ')} bills by item class, and your selection spans{' '}
                    {distinctItemClasses.length} classes ({distinctItemClasses.map(c => c || 'no class').join(', ')}).
                    A single batch task would rate every piece at the first item's class.
                    Select items of one class per batch, or turn off batch mode to create per-item tasks.
                  </div>
                </div>
              )}

              {/* Advanced (optional): due date, notes, priority */}
              <div style={{ marginBottom: 16 }}>
                <button
                  type="button"
                  onClick={() => setAdvancedOpen(o => !o)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: 0, fontFamily: 'inherit',
                    fontSize: 11, fontWeight: 600, color: theme.colors.textSecondary,
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                  }}
                  aria-expanded={advancedOpen}
                >
                  {advancedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  Advanced (optional)
                </button>
                {advancedOpen && (
                  <div style={{ marginTop: 10, padding: '12px 14px', borderRadius: 10, background: theme.colors.bgSubtle, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* Due date */}
                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: theme.colors.textMuted, marginBottom: 4, fontWeight: 600 }}>
                        Due date
                      </label>
                      <input
                        type="date"
                        value={dueDateOverride}
                        onChange={e => setDueDateOverride(e.target.value)}
                        style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, outline: 'none', fontFamily: 'inherit' }}
                      />
                      <div style={{ fontSize: 10, color: theme.colors.textMuted, marginTop: 3 }}>
                        {dueDateOverride
                          ? 'Override applied to every task in this batch.'
                          : autoDueDatePreview
                            ? `Leave blank to auto-set to ${autoDueDatePreview} (catalog SLA).`
                            : 'Leave blank to use the catalog SLA per service type.'}
                      </div>
                    </div>

                    {/* Task notes */}
                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: theme.colors.textMuted, marginBottom: 4, fontWeight: 600 }}>
                        Task notes
                      </label>
                      <textarea
                        value={taskNotesInput}
                        onChange={e => setTaskNotesInput(e.target.value)}
                        rows={3}
                        placeholder="Warehouse instructions, e.g. &quot;Only unroll half the rug, take photos of pattern.&quot;"
                        style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, outline: 'none', fontFamily: 'inherit', resize: 'vertical', minHeight: 60 }}
                      />
                    </div>

                    {/* Priority */}
                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: theme.colors.textMuted, marginBottom: 4, fontWeight: 600 }}>
                        Priority
                      </label>
                      <select
                        value={priorityInput}
                        onChange={e => setPriorityInput(e.target.value as 'Standard' | 'High' | 'Urgent')}
                        style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, outline: 'none', fontFamily: 'inherit', background: '#fff' }}
                      >
                        <option value="Standard">Standard</option>
                        <option value="High">High</option>
                        <option value="Urgent">Urgent (due today)</option>
                      </select>
                      {priorityInput === 'Urgent' && !dueDateOverride && (
                        <div style={{ fontSize: 10, color: theme.colors.textMuted, marginTop: 3 }}>
                          Urgent forces due date to today ({todayPT}).
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Items preview */}
              <div style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Items ({items.length})
              </div>
              <div style={{
                maxHeight: 90, overflowY: 'auto', fontSize: 11, color: theme.colors.textSecondary,
                lineHeight: 1.7, padding: '8px 10px', background: theme.colors.bgSubtle,
                borderRadius: 8, marginBottom: 16,
              }}>
                {items.map(i => (
                  <div key={i.itemId}>
                    <span style={{ fontWeight: 600 }}>{i.itemId}</span>
                    {(i.description || i.vendor) ? ` — ${i.description || i.vendor}` : ''}
                  </div>
                ))}
              </div>

              {groupedItems.length > 0 && (
                <div style={{ padding: '10px 12px', borderRadius: 8, background: '#FFF7ED', border: '1px solid #FDBA74', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <SplitIcon size={14} color="#C2410C" />
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#C2410C' }}>
                      {groupedItems.length === 1 ? 'Grouped item detected' : `${groupedItems.length} grouped items detected`}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#7C2D12', lineHeight: 1.5 }}>
                    {groupedItems.map((gi) => (
                      <div key={gi.itemId}>
                        Item <strong>{gi.itemId}</strong> has a grouped quantity of <strong>{Number((gi as { qty?: number }).qty) || 1}</strong>. The warehouse will split it before tasking individual pieces.
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: '#7C2D12', marginTop: 6 }}>
                    A Split task will be auto-created and assigned to the warehouse team alongside this request.
                  </div>
                </div>
              )}
              {conflicts.length > 0 && !dismissedConflicts && (
                <div style={{ padding: '10px 12px', borderRadius: 8, background: '#FEF3C7', border: '1px solid #FCD34D', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <AlertTriangle size={14} color="#B45309" />
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#92400E' }}>
                      {conflicts.length === 1 ? 'Existing open task found' : `${conflicts.length} existing open tasks found`}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#92400E', lineHeight: 1.7 }}>
                    {conflicts.map((c, i) => (
                      <div key={i}>
                        Item <strong>{c.itemId}</strong> already has an open {c.typeName} task{' '}
                        <a
                          href={`#/tasks/${c.taskId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#B45309', fontWeight: 700, textDecoration: 'underline' }}
                          onClick={e => e.stopPropagation()}
                        >{c.taskId}</a>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: '#92400E', marginTop: 6 }}>
                    Duplicates will be skipped automatically if you proceed.
                  </div>
                  <button
                    onClick={() => setDismissedConflicts(true)}
                    style={{ marginTop: 6, fontSize: 11, padding: '3px 10px', border: '1px solid #D97706', borderRadius: 6, background: 'transparent', color: '#92400E', cursor: 'pointer', fontWeight: 600 }}
                  >Dismiss</button>
                </div>
              )}

              {error && (
                <div style={{ padding: '8px 12px', borderRadius: 8, background: '#FEF2F2', color: '#DC2626', fontSize: 12, marginBottom: 12 }}>
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${theme.colors.border}`, display: 'flex', justifyContent: result ? 'center' : 'space-between', flexShrink: 0 }}>
          {result ? (
            <button onClick={onClose} style={{ padding: '12px 28px', border: 'none', borderRadius: 100, background: theme.colors.orange, color: '#fff', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11 }}>
              Done
            </button>
          ) : (
            <>
              <button onClick={onClose} style={{ padding: '12px 24px', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 100, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#666' }}>
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading || !selectedCodes.size || batchClassConflict}
                style={{
                  padding: '12px 28px', border: 'none', borderRadius: 100,
                  background: selectedCodes.size && !loading && !batchClassConflict ? theme.colors.orange : theme.colors.border,
                  color: selectedCodes.size && !loading && !batchClassConflict ? '#fff' : theme.colors.textMuted,
                  fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', cursor: selectedCodes.size && !loading && !batchClassConflict ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit', fontSize: 11,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {loading
                  ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Creating…</>
                  : <>{selectedCodes.size ? `Create ${Array.from(selectedCodes).join(' + ')} Tasks` : 'Create Tasks'}</>
                }
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
