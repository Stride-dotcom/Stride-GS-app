import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { SearchableSelect, type SelectOption } from '@/components/ui/searchable-select';
import { PrintLabelsDialog } from '@/components/inventory/PrintLabelsDialog';
import type { ItemLabelData } from '@/lib/labelGenerator';
import { queueSplitCompletedAlert } from '@/lib/alertQueue';
import { useExpectedCodeScanMode } from '@/lib/scan/modes/useExpectedCodeScanMode';

type OriginEntityType = 'shipment' | 'task';

type SplitWorkflowMeta = {
  origin_entity_type?: OriginEntityType;
  origin_entity_id?: string;
  origin_entity_number?: string | null;
  parent_item_id?: string;
  parent_item_code?: string;
  grouped_qty?: number;
  keep_qty?: number;
  leftover_qty?: number;
  requested_by_email?: string | null;
  requested_by_name?: string | null;
  request_notes?: string | null;
  child_item_codes?: string[] | null;
};

type CompleteSplitRpcResult = {
  ok?: boolean;
  already_completed?: boolean;
  parent_item_code?: string | null;
  requester_email?: string | null;
  requester_name?: string | null;
  child_item_codes?: string[] | null;
};

interface SplitTaskPanelProps {
  taskId: string;
  task: {
    id: string;
    tenant_id: string;
    task_type: string;
    status: string;
    warehouse_id: string | null;
    metadata: any | null;
    warehouse?: { id: string; name: string } | null;
    account?: { id: string; account_name: string } | null;
  };
  taskItems: Array<{
    item_id: string;
    item?: {
      id: string;
      item_code: string;
      quantity?: number | null;
      description?: string | null;
      vendor?: string | null;
      sidemark?: string | null;
      room?: string | null;
      location?: { code: string } | null;
      account?: { account_name: string } | null;
    } | null;
  }>;
  onRefetch?: () => void;
}

function normalizeScan(v: string): string {
  return (v || '').trim().toLowerCase();
}

export function SplitTaskPanel({ taskId, task, taskItems, onRefetch }: SplitTaskPanelProps) {
  const { profile } = useAuth();
  const { toast } = useToast();

  const splitMeta: SplitWorkflowMeta | null = useMemo(() => {
    const meta = task.metadata && typeof task.metadata === 'object' ? task.metadata : null;
    const sw = meta && typeof meta.split_workflow === 'object' ? meta.split_workflow : null;
    return sw as SplitWorkflowMeta | null;
  }, [task.metadata]);

  const originJob = useMemo(() => {
    const originType = splitMeta?.origin_entity_type;
    const originId = splitMeta?.origin_entity_id;
    if (!originType || !originId) return null;

    const path =
      originType === 'shipment' ? `/shipments/${originId}`
      : originType === 'task' ? `/tasks/${originId}`
      : null;
    if (!path) return null;

    return {
      typeLabel: originType === 'shipment' ? 'Shipment' : 'Task',
      id: originId,
      number: splitMeta?.origin_entity_number || null,
      path,
    };
  }, [splitMeta?.origin_entity_type, splitMeta?.origin_entity_id, splitMeta?.origin_entity_number]);

  const parentTaskItem = useMemo(() => {
    const parentId = splitMeta?.parent_item_id;
    if (parentId) {
      return taskItems.find((ti) => ti.item_id === parentId) || taskItems[0] || null;
    }
    return taskItems[0] || null;
  }, [splitMeta?.parent_item_id, taskItems]);

  const parentItemCode = parentTaskItem?.item?.item_code || splitMeta?.parent_item_code || '';
  const parentItemId = parentTaskItem?.item_id || splitMeta?.parent_item_id || '';
  const groupedQty =
    (typeof parentTaskItem?.item?.quantity === 'number' ? parentTaskItem?.item?.quantity : null) ??
    (typeof splitMeta?.grouped_qty === 'number' ? splitMeta?.grouped_qty : null) ??
    null;
  const keepQty = typeof splitMeta?.keep_qty === 'number' ? splitMeta.keep_qty : null;
  const leftoverQty = typeof splitMeta?.leftover_qty === 'number' ? splitMeta.leftover_qty : null;

  // Parent scan gate
  const [parentScanValue, setParentScanValue] = useState('');
  const [parentScanned, setParentScanned] = useState(false);

  // Target location selection (defaults to warehouse default receiving location)
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationOptions, setLocationOptions] = useState<SelectOption[]>([]);
  const [targetLocationId, setTargetLocationId] = useState<string>('');

  const targetLocationCode = useMemo(() => {
    return locationOptions.find((o) => o.value === targetLocationId)?.label || '';
  }, [locationOptions, targetLocationId]);

  // Preview/apply state
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewCodes, setPreviewCodes] = useState<string[]>([]);
  const [expectedStartSuffix, setExpectedStartSuffix] = useState<number | null>(null);

  const [applyLoading, setApplyLoading] = useState(false);
  const [childItemIds, setChildItemIds] = useState<string[]>([]);
  const [childItemCodes, setChildItemCodes] = useState<string[]>([]);
  const [completeLoading, setCompleteLoading] = useState(false);

  // Print dialog
  const [printOpen, setPrintOpen] = useState(false);
  const [labelItems, setLabelItems] = useState<ItemLabelData[]>([]);

  // Label application scan gate (must scan all child codes)
  const [childScanValue, setChildScanValue] = useState('');
  const [scannedChildCodes, setScannedChildCodes] = useState<Set<string>>(new Set());

  const splitAlreadyApplied = childItemCodes.length > 0;
  const canPreview = !splitAlreadyApplied && !!profile?.tenant_id && !!parentItemId && typeof leftoverQty === 'number' && leftoverQty > 0;
  const canApply = !splitAlreadyApplied && canPreview && parentScanned && !!targetLocationId && previewCodes.length === leftoverQty;
  const allChildrenScanned = childItemCodes.length > 0 && scannedChildCodes.size === childItemCodes.length;

  const parentScanMode = useExpectedCodeScanMode({
    enabled: !parentScanned && !!parentItemCode,
    expectedCodes: [parentItemCode, parentItemId].filter(Boolean),
    normalize: normalizeScan,
    onMatched: (code) => {
      setParentScanned(true);
      setParentScanValue('');
      toast({ title: 'Parent item confirmed', description: code });
    },
    onUnknown: (code) => {
      toast({
        variant: 'destructive',
        title: 'Wrong item',
        description: `Scanned "${code}" but expected "${parentItemCode}".`,
      });
    },
    onUnexpectedError: (error, raw) => {
      console.error('[SplitTaskPanel] parent scan error:', error, { raw });
      toast({
        variant: 'destructive',
        title: 'Scan failed',
        description: 'Could not process the parent scan.',
      });
    },
  });

  const childScanMode = useExpectedCodeScanMode({
    enabled: childItemCodes.length > 0,
    expectedCodes: childItemCodes,
    scannedCodes: scannedChildCodes,
    normalize: normalizeScan,
    onMatched: (_code, normalizedCode) => {
      setScannedChildCodes((prev) => {
        const next = new Set(prev);
        next.add(normalizedCode);
        return next;
      });
    },
    onUnknown: () => {
      toast({
        variant: 'destructive',
        title: 'Not a new label',
        description: 'This code is not part of this split task.',
      });
    },
    onUnexpectedError: (error, raw) => {
      console.error('[SplitTaskPanel] child scan error:', error, { raw });
      toast({
        variant: 'destructive',
        title: 'Scan failed',
        description: 'Could not process the child label scan.',
      });
    },
  });

  // Load locations + default receiving location
  useEffect(() => {
    const warehouseId = task.warehouse_id;
    if (!profile?.tenant_id || !warehouseId) return;

    const run = async () => {
      setLocationsLoading(true);
      try {
        const [{ data: whRow, error: whErr }, { data: locRows, error: locErr }] = await Promise.all([
          (supabase.from('warehouses') as any)
            .select('id, default_receiving_location_id')
            .eq('tenant_id', profile.tenant_id)
            .eq('id', warehouseId)
            .maybeSingle(),
          (supabase.from('locations') as any)
            .select('id, code, name')
            .eq('warehouse_id', warehouseId)
            .is('deleted_at', null)
            .eq('is_active', true)
            .order('code')
            .limit(500),
        ]);

        if (whErr) throw whErr;
        if (locErr) throw locErr;

        const opts: SelectOption[] = (locRows || []).map((l: any) => ({
          value: l.id,
          label: l.code,
          subtitle: l.name || undefined,
        }));
        setLocationOptions(opts);

        const defaultId = whRow?.default_receiving_location_id as string | null | undefined;
        if (defaultId && opts.some((o) => o.value === defaultId)) {
          setTargetLocationId(defaultId);
        } else if (opts.length > 0 && !targetLocationId) {
          setTargetLocationId(opts[0].value);
        }
      } catch (err: any) {
        console.error('[SplitTaskPanel] load locations error:', err);
        toast({
          variant: 'destructive',
          title: 'Could not load locations',
          description: err?.message || 'Please try again.',
        });
      } finally {
        setLocationsLoading(false);
      }
    };

    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.tenant_id, task.warehouse_id]);

  const fetchChildItemsWithLabels = async (
    tenantId: string,
    splitTaskId: string
  ): Promise<{ ids: string[]; codes: string[]; labelData: ItemLabelData[] }> => {
    const { data: childRows, error: childErr } = await (supabase.from('items') as any)
      .select(`
        id,
        item_code,
        description,
        vendor,
        sidemark,
        room,
        location:locations!items_current_location_id_fkey(code),
        account:accounts!items_account_id_fkey(account_name)
      `)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .contains('metadata', { split_task_id: splitTaskId })
      .order('item_code')
      .limit(200);

    if (childErr) throw childErr;

    const rows = Array.isArray(childRows) ? childRows : [];
    const ids = rows.map((r: any) => String(r.id));
    const codes = rows.map((r: any) => String(r.item_code));

    const accountFallback =
      task.account?.account_name ||
      parentTaskItem?.item?.account?.account_name ||
      'Account';

    const labelData: ItemLabelData[] = rows.map((r: any) => ({
      id: String(r.id),
      itemCode: String(r.item_code),
      description: String(r.description || ''),
      vendor: String(r.vendor || ''),
      account: String(r.account?.account_name || accountFallback),
      sidemark: r.sidemark ? String(r.sidemark) : undefined,
      room: r.room ? String(r.room) : undefined,
      warehouseName: task.warehouse?.name || undefined,
      locationCode: r.location?.code ? String(r.location.code) : undefined,
    }));

    return { ids, codes, labelData };
  };

  // Hydrate existing child items for this task (supports refresh/reprint/recovery)
  useEffect(() => {
    if (!profile?.tenant_id || !taskId) return;
    if (childItemCodes.length > 0) return;

    // Best-effort: if the task already has child codes in metadata, show them immediately.
    const metaCodes = Array.isArray(splitMeta?.child_item_codes)
      ? splitMeta?.child_item_codes.map(String).filter(Boolean)
      : [];
    if (metaCodes.length > 0) {
      setChildItemCodes(metaCodes);
    }

    let cancelled = false;
    const run = async () => {
      try {
        const { ids, codes, labelData } = await fetchChildItemsWithLabels(profile.tenant_id, taskId);
        if (cancelled) return;
        if (codes.length === 0) return;

        setChildItemIds(ids);
        setChildItemCodes(codes);
        setLabelItems(labelData);
      } catch (err: any) {
        // Optional: do not block the panel if hydration fails
        console.warn('[SplitTaskPanel] hydrate child items failed:', err);
      }
    };

    void run();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.tenant_id, taskId, splitMeta?.child_item_codes]);

  const handleParentScan = () => {
    const scanned = parentScanValue.trim();
    if (!scanned) return;

    if (!parentItemCode) {
      toast({ variant: 'destructive', title: 'Missing parent item code', description: 'Cannot validate scan.' });
      return;
    }

    parentScanMode.onScan(scanned);
  };

  const handlePreview = async () => {
    if (!canPreview) return;
    setPreviewLoading(true);
    try {
      const { data, error } = await (supabase.rpc as any)('rpc_preview_grouped_item_split_off_leftover', {
        p_parent_item_id: parentItemId,
        p_leftover_qty: leftoverQty,
      });
      if (error) throw error;

      const codes = Array.isArray(data?.child_item_codes) ? data.child_item_codes.map(String) : [];
      const start = typeof data?.start_suffix === 'number' ? data.start_suffix : null;
      setPreviewCodes(codes);
      setExpectedStartSuffix(start);
    } catch (err: any) {
      console.error('[SplitTaskPanel] preview error:', err);
      toast({
        variant: 'destructive',
        title: 'Preview failed',
        description: err?.message || 'Could not preview child codes.',
      });
      setPreviewCodes([]);
      setExpectedStartSuffix(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleApplySplit = async () => {
    if (!canApply || typeof leftoverQty !== 'number') return;
    setApplyLoading(true);
    try {
      const resolvedKeepQty =
        typeof keepQty === 'number' && Number.isFinite(keepQty)
          ? keepQty
          : typeof groupedQty === 'number' && Number.isFinite(groupedQty)
            ? groupedQty - leftoverQty
            : null;

      // Explicit confirmation: applying the split updates the parent quantity.
      const confirmOk = window.confirm(
        `Confirm split:\n\n` +
          `Parent label: ${parentItemCode || parentItemId}\n` +
          `Parent quantity will be set to: ${resolvedKeepQty ?? '(calculated)'}\n` +
          `New child labels to create: ${leftoverQty}\n\n` +
          `Continue?`
      );
      if (!confirmOk) return;

      const { data, error } = await (supabase.rpc as any)('rpc_apply_grouped_item_split_off_leftover', {
        p_parent_item_id: parentItemId,
        p_leftover_qty: leftoverQty,
        p_target_location_id: targetLocationId || null,
        p_expected_start_suffix: expectedStartSuffix,
        p_split_task_id: taskId,
      });
      if (error) throw error;

      const ids = Array.isArray(data?.child_item_ids)
        ? data.child_item_ids.map(String)
        : Array.isArray(data?.child_ids)
          ? data.child_ids.map(String)
          : [];
      const codes = Array.isArray(data?.child_item_codes)
        ? data.child_item_codes.map(String)
        : Array.isArray(data?.child_codes)
          ? data.child_codes.map(String)
          : [];
      setChildItemIds(ids);
      setChildItemCodes(codes);
      setScannedChildCodes(new Set());

      // Persist the generated codes immediately so the task is recoverable after refresh.
      // (Completion will also store them, but that can happen later.)
      try {
        const taskMeta = task.metadata && typeof task.metadata === 'object' ? task.metadata : {};
        const sw = taskMeta.split_workflow && typeof taskMeta.split_workflow === 'object' ? taskMeta.split_workflow : {};
        const nextTaskMeta = {
          ...taskMeta,
          split_workflow: {
            ...sw,
            child_item_codes: codes,
          },
        };
        await (supabase.from('tasks') as any)
          .update({ metadata: nextTaskMeta })
          .eq('id', taskId);
      } catch (err) {
        console.warn('[SplitTaskPanel] failed to persist child codes in task metadata:', err);
      }

      // Build label data from parent item + target location
      const parent = parentTaskItem?.item;
      const accountName =
        task.account?.account_name ||
        parent?.account?.account_name ||
        'Account';

      const labelData: ItemLabelData[] = codes.map((code, idx) => ({
        id: ids[idx] || `${code}-${idx}`,
        itemCode: code,
        description: parent?.description || '',
        vendor: parent?.vendor || '',
        account: accountName,
        sidemark: parent?.sidemark || undefined,
        room: parent?.room || undefined,
        warehouseName: task.warehouse?.name || undefined,
        locationCode: targetLocationCode || parent?.location?.code || undefined,
      }));
      setLabelItems(labelData);

      // Open print dialog immediately (user gesture required for printing in browsers)
      setPrintOpen(true);

      toast({
        title: 'Split created',
        description: `${codes.length} new label(s) generated.`,
      });

      onRefetch?.();
    } catch (err: any) {
      console.error('[SplitTaskPanel] apply error:', err);
      toast({
        variant: 'destructive',
        title: 'Split failed',
        description: err?.message || 'Could not create split items.',
      });
    } finally {
      setApplyLoading(false);
    }
  };

  const handleReprint = async () => {
    if (!profile?.tenant_id) {
      setPrintOpen(true);
      return;
    }

    // If we already have label items (with ids), reuse them.
    if (labelItems.length > 0) {
      setPrintOpen(true);
      return;
    }

    try {
      const { labelData } = await fetchChildItemsWithLabels(profile.tenant_id, taskId);
      if (labelData.length > 0) setLabelItems(labelData);
    } catch (err: any) {
      console.warn('[SplitTaskPanel] reprint hydration failed:', err);
      toast({
        variant: 'destructive',
        title: 'Could not load labels',
        description: err?.message || 'Please try again.',
      });
    } finally {
      setPrintOpen(true);
    }
  };

  const handleChildScan = () => {
    const scanned = childScanValue.trim();
    if (!scanned) return;
    childScanMode.onScan(scanned);
    setChildScanValue('');
  };

  const completeSplitTask = async () => {
    if (!profile?.tenant_id || !profile?.id) return;
    if (completeLoading) return;
    if (task.status === 'completed') return;
    if (!allChildrenScanned) {
      toast({
        variant: 'destructive',
        title: 'Scan required',
        description: 'Scan each newly generated child label before completing this Split task.',
      });
      return;
    }

    setCompleteLoading(true);
    try {
      const { data, error } = await (supabase.rpc as any)('rpc_complete_split_task', {
        p_split_task_id: taskId,
      });
      if (error) throw error;

      const rpcResult: CompleteSplitRpcResult =
        data && typeof data === 'object' ? (data as CompleteSplitRpcResult) : {};

      const dbChildCodes = Array.isArray(rpcResult.child_item_codes)
        ? rpcResult.child_item_codes.map(String).filter(Boolean)
        : [];
      if (dbChildCodes.length > 0) {
        setChildItemCodes(dbChildCodes);
      }

      // Notify requester only after successful RPC completion and only on first completion.
      const requesterEmail =
        (typeof rpcResult.requester_email === 'string' ? rpcResult.requester_email : splitMeta?.requested_by_email || '')
          .trim();
      const resolvedParentCode =
        (typeof rpcResult.parent_item_code === 'string' && rpcResult.parent_item_code.trim()
          ? rpcResult.parent_item_code
          : parentItemCode || 'Item');
      if (!rpcResult.already_completed && requesterEmail) {
        void queueSplitCompletedAlert(profile.tenant_id, taskId, resolvedParentCode, requesterEmail);
      }

      toast({ title: rpcResult.already_completed ? 'Split task was already completed' : 'Split task completed' });
      onRefetch?.();
    } catch (err: any) {
      console.error('[SplitTaskPanel] complete error:', err);
      toast({
        variant: 'destructive',
        title: 'Could not complete split task',
        description: err?.message || 'Please try again.',
      });
    } finally {
      setCompleteLoading(false);
    }
  };

  if (!splitMeta || !parentTaskItem) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="call_split" size="sm" />
            Split Task
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          This task is missing split workflow metadata.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="call_split" size="sm" />
            Split Workflow
            <Badge variant="outline" className="ml-2">
              {leftoverQty || 0} label{(leftoverQty || 0) === 1 ? '' : 's'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Parent item</Label>
              <div className="font-medium">{parentItemCode || parentItemId}</div>
              <div className="text-sm text-muted-foreground">
                Current location: {parentTaskItem.item?.location?.code || '—'}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Quantities</Label>
              <div className="text-sm">
                Grouped: <span className="font-medium">{groupedQty ?? '—'}</span>
                {keepQty != null && (
                  <>
                    {' '}· Keep: <span className="font-medium">{keepQty}</span>
                  </>
                )}
                {leftoverQty != null && (
                  <>
                    {' '}· Split: <span className="font-medium">{leftoverQty}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {originJob && (
            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
              <div className="min-w-0">
                <Label className="text-xs text-muted-foreground">Origin job</Label>
                <div className="text-sm font-medium truncate">
                  {originJob.typeLabel} {originJob.number || originJob.id}
                </div>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link to={originJob.path}>Open</Link>
              </Button>
            </div>
          )}

          {/* Step 1: Scan parent */}
          <div className="space-y-2">
            <Label>Step 1 — Scan parent item code</Label>
            <div className="flex gap-2">
              <Input
                placeholder={`Scan ${parentItemCode}`}
                value={parentScanValue}
                onChange={(e) => setParentScanValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleParentScan();
                  }
                }}
                disabled={parentScanned}
              />
              <Button onClick={handleParentScan} disabled={parentScanned || !parentScanValue.trim()}>
                {parentScanned ? (
                  <>
                    <MaterialIcon name="check" size="sm" className="mr-2" />
                    Confirmed
                  </>
                ) : (
                  'Confirm'
                )}
              </Button>
            </div>
          </div>

          {/* Step 2: Choose target location for leftovers */}
          <div className="space-y-2">
            <Label>Step 2 — Target location for leftover child items</Label>
            <SearchableSelect
              value={targetLocationId}
              onChange={setTargetLocationId}
              options={locationOptions}
              placeholder={locationsLoading ? 'Loading locations…' : 'Select a location'}
              disabled={locationsLoading || locationOptions.length === 0}
            />
            <p className="text-xs text-muted-foreground">
              Defaults to the warehouse’s default receiving location. Leftover child items are <span className="font-medium">not</span> automatically placed into any container.
            </p>
          </div>

          {/* Step 3: Preview codes */}
          <div className="space-y-2">
            <Label>Step 3 — Preview new child codes</Label>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handlePreview} disabled={!canPreview || previewLoading}>
                {previewLoading ? (
                  <>
                    <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                    Previewing…
                  </>
                ) : (
                  <>
                    <MaterialIcon name="preview" size="sm" className="mr-2" />
                    Preview codes
                  </>
                )}
              </Button>
              <div className="text-xs text-muted-foreground flex items-center">
                {previewCodes.length > 0 ? `${previewCodes.length} code(s) ready` : '—'}
              </div>
            </div>
            {previewCodes.length > 0 && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm font-mono whitespace-pre-wrap">
                {previewCodes.join('\n')}
              </div>
            )}
                  {splitAlreadyApplied && (
                    <p className="text-xs text-muted-foreground">
                      This Split task already has child labels created. Reprint labels or scan to complete.
                    </p>
                  )}
          </div>

          {/* Step 4: Apply split */}
          <div className="space-y-2">
            <Label>Step 4 — Create split + print labels</Label>
            <Button onClick={handleApplySplit} disabled={!canApply || applyLoading}>
              {applyLoading ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <MaterialIcon name="print" size="sm" className="mr-2" />
                  Split &amp; Print Labels
                </>
              )}
            </Button>
            {childItemCodes.length > 0 && (
              <div className="text-sm text-muted-foreground">
                Created {childItemCodes.length} child item(s): <span className="font-mono">{childItemCodes[0]}</span>
                {childItemCodes.length > 1 ? ` … (+${childItemCodes.length - 1})` : ''}
              </div>
            )}
            {childItemCodes.length > 0 && (
              <div className="flex gap-2">
                      <Button variant="outline" onClick={handleReprint}>
                  Reprint labels
                </Button>
              </div>
            )}
          </div>

          {/* Step 5: Scan child labels to confirm applied */}
          {childItemCodes.length > 0 && (
            <div className="space-y-2">
              <Label>Step 5 — Scan each new child label after it’s attached</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Scan child label code…"
                  value={childScanValue}
                  onChange={(e) => setChildScanValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleChildScan();
                    }
                  }}
                />
                <Button onClick={handleChildScan} disabled={!childScanValue.trim()}>
                  Add scan
                </Button>
              </div>
              <div className="rounded-md border p-3 space-y-1">
                {childItemCodes.map((c) => {
                  const done = scannedChildCodes.has(normalizeScan(c));
                  return (
                    <div key={c} className="flex items-center justify-between text-sm">
                      <span className="font-mono">{c}</span>
                      {done ? (
                        <span className="text-green-600 flex items-center gap-1">
                          <MaterialIcon name="check" size="sm" />
                          Scanned
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Pending</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <Button onClick={completeSplitTask} disabled={!allChildrenScanned || completeLoading || task.status === 'completed'}>
                <MaterialIcon name="check_circle" size="sm" className="mr-2" />
                Complete Split Task
              </Button>
              {!allChildrenScanned && (
                <p className="text-xs text-muted-foreground">
                  You must scan exactly {childItemCodes.length} new label(s) to complete this task.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <PrintLabelsDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        items={labelItems}
        title="Print Split Labels"
        description={
          labelItems.length > 0
            ? `Print ${labelItems.length} new child label(s) for ${parentItemCode}`
            : 'Print labels'
        }
      />
    </>
  );
}

