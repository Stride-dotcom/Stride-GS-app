import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface ItemLineageHistorySectionProps {
  itemId: string;
  itemCode: string;
  itemCreatedAt: string;
  metadata: Record<string, unknown> | null;
  isClientUser: boolean;
  canSeeBilling: boolean;
}

interface LineageItemSummary {
  id: string;
  item_code: string;
  quantity: number;
  status: string;
  created_at: string;
  received_at: string | null;
}

interface InheritedTaskSummary {
  id: string;
  title: string;
  task_type: string;
  status: string;
  created_at: string;
}

interface InheritedBillingSummary {
  id: string;
  charge_type: string;
  status: string;
  total_amount: number | null;
  unit_rate: number | null;
  quantity: number | null;
  created_at: string;
}

interface InheritedNoteSummary {
  id: string;
  note: string;
  note_type: string | null;
  created_at: string;
}

interface InheritedParentHistory {
  cutoff_at: string;
  activity_count: number;
  task_count: number;
  billing_count: number;
  note_count: number;
  photo_count: number;
  recent_tasks: InheritedTaskSummary[];
  recent_billing: InheritedBillingSummary[];
  recent_notes: InheritedNoteSummary[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readStringField(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function safeDate(value: string | null | undefined, formatPattern: string): string {
  if (!value) return '—';
  try {
    return format(new Date(value), formatPattern);
  } catch {
    return value;
  }
}

function toLineageItem(row: any): LineageItemSummary {
  return {
    id: String(row.id),
    item_code: String(row.item_code || ''),
    quantity: typeof row.quantity === 'number' && Number.isFinite(row.quantity) ? row.quantity : 1,
    status: String(row.status || 'active'),
    created_at: String(row.created_at || ''),
    received_at: row.received_at ? String(row.received_at) : null,
  };
}

export function ItemLineageHistorySection({
  itemId,
  itemCode,
  itemCreatedAt,
  metadata,
  isClientUser,
  canSeeBilling,
}: ItemLineageHistorySectionProps) {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [lineageLoading, setLineageLoading] = useState(false);
  const [lineageParent, setLineageParent] = useState<LineageItemSummary | null>(null);
  const [lineageChildren, setLineageChildren] = useState<LineageItemSummary[]>([]);
  const [lineageSiblings, setLineageSiblings] = useState<LineageItemSummary[]>([]);
  const [lineageSplitTaskId, setLineageSplitTaskId] = useState<string | null>(null);

  const [inheritedLoading, setInheritedLoading] = useState(false);
  const [inheritedHistory, setInheritedHistory] = useState<InheritedParentHistory | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const money = useMemo(
    () => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }),
    []
  );

  const metadataRecord = asRecord(metadata);
  const splitParentItemIdHint = readStringField(metadataRecord, 'split_parent_item_id');
  const splitTaskIdHint = readStringField(metadataRecord, 'split_task_id');
  const metadataKey = JSON.stringify(metadataRecord || {});

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!profile?.tenant_id || !itemId) {
        setLineageParent(null);
        setLineageChildren([]);
        setLineageSiblings([]);
        setLineageSplitTaskId(null);
        setInheritedHistory(null);
        setLoadError(null);
        setLineageLoading(false);
        setInheritedLoading(false);
        return;
      }

      const meta = asRecord(metadata);
      const splitParentItemId = readStringField(meta, 'split_parent_item_id');
      const splitTaskId = readStringField(meta, 'split_task_id');
      const cutoffAt = itemCreatedAt;

      setLineageLoading(true);
      setLoadError(null);
      setLineageSplitTaskId(splitTaskId);
      setInheritedHistory(null);
      setInheritedLoading(Boolean(splitParentItemId));

      try {
        const childrenPromise = (supabase.from('items') as any)
          .select('id, item_code, quantity, status, created_at, received_at')
          .eq('tenant_id', profile.tenant_id)
          .is('deleted_at', null)
          .contains('metadata', { split_parent_item_id: itemId })
          .order('created_at', { ascending: true })
          .limit(200);

        const parentPromise = splitParentItemId
          ? (supabase.from('items') as any)
              .select('id, item_code, quantity, status, created_at, received_at')
              .eq('tenant_id', profile.tenant_id)
              .eq('id', splitParentItemId)
              .is('deleted_at', null)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null } as any);

        const siblingsPromise = splitParentItemId
          ? (supabase.from('items') as any)
              .select('id, item_code, quantity, status, created_at, received_at')
              .eq('tenant_id', profile.tenant_id)
              .is('deleted_at', null)
              .contains('metadata', { split_parent_item_id: splitParentItemId })
              .neq('id', itemId)
              .order('created_at', { ascending: true })
              .limit(200)
          : Promise.resolve({ data: [], error: null } as any);

        const [childrenRes, parentRes, siblingsRes] = await Promise.all([
          childrenPromise,
          parentPromise,
          siblingsPromise,
        ]);

        if (childrenRes.error) throw childrenRes.error;
        if (parentRes.error) throw parentRes.error;
        if (siblingsRes.error) throw siblingsRes.error;

        const nextChildren = (childrenRes.data || []).map(toLineageItem);
        const nextParent = parentRes.data ? toLineageItem(parentRes.data) : null;
        const nextSiblings = (siblingsRes.data || []).map(toLineageItem);

        if (!cancelled) {
          setLineageChildren(nextChildren);
          setLineageParent(nextParent);
          setLineageSiblings(nextSiblings);
        }

        if (splitParentItemId) {
          const [
            activityCountRes,
            noteCountRes,
            noteRecentRes,
            photoCountRes,
            parentTaskLinksRes,
            billingCountRes,
            billingRecentRes,
          ] = await Promise.all([
            (supabase.from('item_activity') as any)
              .select('id', { head: true, count: 'exact' })
              .eq('tenant_id', profile.tenant_id)
              .eq('item_id', splitParentItemId)
              .lt('created_at', cutoffAt),
            (supabase.from('item_notes') as any)
              .select('id', { head: true, count: 'exact' })
              .eq('item_id', splitParentItemId)
              .is('deleted_at', null)
              .lt('created_at', cutoffAt),
            (supabase.from('item_notes') as any)
              .select('id, note, note_type, created_at')
              .eq('item_id', splitParentItemId)
              .is('deleted_at', null)
              .lt('created_at', cutoffAt)
              .order('created_at', { ascending: false })
              .limit(5),
            (supabase.from('item_photos') as any)
              .select('id', { head: true, count: 'exact' })
              .eq('item_id', splitParentItemId)
              .lt('created_at', cutoffAt),
            (supabase.from('task_items') as any)
              .select('task_id')
              .eq('item_id', splitParentItemId)
              .limit(500),
            canSeeBilling
              ? (supabase.from('billing_events') as any)
                  .select('id', { head: true, count: 'exact' })
                  .eq('tenant_id', profile.tenant_id)
                  .eq('item_id', splitParentItemId)
                  .lt('created_at', cutoffAt)
                  .in('status', ['unbilled', 'invoiced', 'void'])
              : Promise.resolve({ count: 0, error: null } as any),
            canSeeBilling
              ? (supabase.from('billing_events') as any)
                  .select('id, charge_type, status, total_amount, unit_rate, quantity, created_at')
                  .eq('tenant_id', profile.tenant_id)
                  .eq('item_id', splitParentItemId)
                  .lt('created_at', cutoffAt)
                  .in('status', ['unbilled', 'invoiced', 'void'])
                  .order('created_at', { ascending: false })
                  .limit(5)
              : Promise.resolve({ data: [], error: null } as any),
          ]);

          if (activityCountRes.error) throw activityCountRes.error;
          if (noteCountRes.error) throw noteCountRes.error;
          if (noteRecentRes.error) throw noteRecentRes.error;
          if (photoCountRes.error) throw photoCountRes.error;
          if (parentTaskLinksRes.error) throw parentTaskLinksRes.error;
          if (billingCountRes.error) throw billingCountRes.error;
          if (billingRecentRes.error) throw billingRecentRes.error;

          const taskIds = Array.from(
            new Set(
              (parentTaskLinksRes.data || [])
                .map((row: any) => String(row.task_id))
                .filter((taskId: string) => taskId.length > 0)
            )
          );

          let taskCount = 0;
          let recentTasks: InheritedTaskSummary[] = [];

          if (taskIds.length > 0) {
            const [taskCountRes, taskRecentRes] = await Promise.all([
              (supabase.from('tasks') as any)
                .select('id', { head: true, count: 'exact' })
                .in('id', taskIds)
                .is('deleted_at', null)
                .lt('created_at', cutoffAt),
              (supabase.from('tasks') as any)
                .select('id, title, task_type, status, created_at')
                .in('id', taskIds)
                .is('deleted_at', null)
                .lt('created_at', cutoffAt)
                .order('created_at', { ascending: false })
                .limit(5),
            ]);

            if (taskCountRes.error) throw taskCountRes.error;
            if (taskRecentRes.error) throw taskRecentRes.error;

            taskCount = Number(taskCountRes.count || 0);
            recentTasks = (taskRecentRes.data || []).map((row: any) => ({
              id: String(row.id),
              title: String(row.title || 'Task'),
              task_type: String(row.task_type || 'Task'),
              status: String(row.status || 'pending'),
              created_at: String(row.created_at || ''),
            }));
          }

          const recentBilling: InheritedBillingSummary[] = canSeeBilling
            ? (billingRecentRes.data || []).map((row: any) => ({
                id: String(row.id),
                charge_type: String(row.charge_type || 'Charge'),
                status: String(row.status || 'unbilled'),
                total_amount:
                  typeof row.total_amount === 'number' && Number.isFinite(row.total_amount)
                    ? row.total_amount
                    : null,
                unit_rate:
                  typeof row.unit_rate === 'number' && Number.isFinite(row.unit_rate)
                    ? row.unit_rate
                    : null,
                quantity:
                  typeof row.quantity === 'number' && Number.isFinite(row.quantity)
                    ? row.quantity
                    : null,
                created_at: String(row.created_at || ''),
              }))
            : [];

          const recentNotes: InheritedNoteSummary[] = (noteRecentRes.data || []).map((row: any) => ({
            id: String(row.id),
            note: String(row.note || ''),
            note_type: row.note_type ? String(row.note_type) : null,
            created_at: String(row.created_at || ''),
          }));

          if (!cancelled) {
            setInheritedHistory({
              cutoff_at: cutoffAt,
              activity_count: Number(activityCountRes.count || 0),
              task_count: taskCount,
              billing_count: Number(billingCountRes.count || 0),
              note_count: Number(noteCountRes.count || 0),
              photo_count: Number(photoCountRes.count || 0),
              recent_tasks: recentTasks,
              recent_billing: recentBilling,
              recent_notes: recentNotes,
            });
          }
        } else if (!cancelled) {
          setInheritedHistory(null);
        }
      } catch (error: any) {
        console.error('[ItemLineageHistorySection] failed to load lineage/history:', error);
        if (!cancelled) {
          setLoadError(error?.message || 'Could not load lineage details.');
        }
      } finally {
        if (!cancelled) {
          setLineageLoading(false);
          setInheritedLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [itemId, itemCreatedAt, metadata, metadataKey, canSeeBilling, profile?.tenant_id]);

  const shouldRender =
    lineageLoading ||
    inheritedLoading ||
    !!lineageParent ||
    lineageChildren.length > 0 ||
    lineageSiblings.length > 0 ||
    !!splitParentItemIdHint ||
    !!splitTaskIdHint ||
    !!loadError;

  if (!shouldRender) return null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <MaterialIcon name="account_tree" size="sm" />
            Split Lineage
          </CardTitle>
          <CardDescription>
            Parent/child relationships for labels created through split workflows.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {lineageSplitTaskId && (
            <div className="text-xs text-muted-foreground">
              Split task reference: <code className="bg-muted px-1 py-0.5 rounded">{lineageSplitTaskId}</code>
            </div>
          )}

          {lineageLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
              Loading lineage…
            </div>
          ) : (
            <>
              {lineageParent && (
                <div className="rounded-md border bg-muted/20 px-3 py-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Parent item</p>
                    <button
                      type="button"
                      onClick={() => navigate(`/inventory/${lineageParent.id}`)}
                      className="text-sm font-semibold text-primary hover:underline"
                    >
                      {lineageParent.item_code}
                    </button>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Qty {lineageParent.quantity} · Created {safeDate(lineageParent.created_at, 'MMM d, yyyy')}
                    </p>
                  </div>
                  <Badge variant="outline">Status: {lineageParent.status}</Badge>
                </div>
              )}

              {lineageSiblings.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    Sibling labels ({lineageSiblings.length})
                  </p>
                  <div className="space-y-1">
                    {lineageSiblings.slice(0, 8).map((sibling) => (
                      <button
                        key={sibling.id}
                        type="button"
                        onClick={() => navigate(`/inventory/${sibling.id}`)}
                        className="w-full text-left rounded-md border px-3 py-2 hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{sibling.item_code}</code>
                          <Badge variant="outline" className="text-[11px]">
                            Qty {sibling.quantity}
                          </Badge>
                        </div>
                      </button>
                    ))}
                    {lineageSiblings.length > 8 && (
                      <p className="text-xs text-muted-foreground">
                        +{lineageSiblings.length - 8} more sibling label(s)
                      </p>
                    )}
                  </div>
                </div>
              )}

              {lineageChildren.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    Child labels created from {itemCode} ({lineageChildren.length})
                  </p>
                  <div className="space-y-1">
                    {lineageChildren.slice(0, 10).map((child) => (
                      <button
                        key={child.id}
                        type="button"
                        onClick={() => navigate(`/inventory/${child.id}`)}
                        className="w-full text-left rounded-md border px-3 py-2 hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{child.item_code}</code>
                          <Badge variant="outline" className="text-[11px]">
                            Qty {child.quantity}
                          </Badge>
                        </div>
                      </button>
                    ))}
                    {lineageChildren.length > 10 && (
                      <p className="text-xs text-muted-foreground">
                        +{lineageChildren.length - 10} more child label(s)
                      </p>
                    )}
                  </div>
                </div>
              )}

              {!lineageParent && lineageSiblings.length === 0 && lineageChildren.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No split lineage links found for this item.
                </p>
              )}
            </>
          )}

          {loadError && (
            <p className="text-xs text-destructive">{loadError}</p>
          )}
        </CardContent>
      </Card>

      {lineageParent && (inheritedLoading || inheritedHistory) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <MaterialIcon name="history" size="sm" />
              Inherited Pre-Split History
            </CardTitle>
            <CardDescription>
              Read-only parent history before this child label was created ({safeDate(itemCreatedAt, 'MMM d, yyyy h:mm a')}).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {inheritedLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                Loading pre-split history…
              </div>
            ) : inheritedHistory ? (
              <>
                <div className="text-xs text-muted-foreground rounded-md border bg-muted/20 px-3 py-2">
                  This section references parent-item work completed before split time for traceability only. It does not duplicate or re-bill parent transactions.
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">Activities: {inheritedHistory.activity_count}</Badge>
                  <Badge variant="secondary">Tasks: {inheritedHistory.task_count}</Badge>
                  {!isClientUser && canSeeBilling && (
                    <Badge variant="secondary">Billing events: {inheritedHistory.billing_count}</Badge>
                  )}
                  <Badge variant="secondary">Notes: {inheritedHistory.note_count}</Badge>
                  <Badge variant="secondary">Photos: {inheritedHistory.photo_count}</Badge>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Recent parent tasks</p>
                    {inheritedHistory.recent_tasks.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No pre-split tasks found.</p>
                    ) : (
                      <div className="space-y-1">
                        {inheritedHistory.recent_tasks.map((task) => (
                          <button
                            key={task.id}
                            type="button"
                            onClick={() => navigate(`/tasks/${task.id}`)}
                            className="w-full text-left rounded-md border px-2.5 py-2 hover:bg-muted/30 transition-colors"
                          >
                            <p className="text-sm font-medium truncate">{task.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {task.task_type} · {task.status.replace('_', ' ')} · {safeDate(task.created_at, 'MMM d, yyyy')}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {!isClientUser && canSeeBilling && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Recent parent billing history</p>
                      {inheritedHistory.recent_billing.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No pre-split billing events found.</p>
                      ) : (
                        <div className="space-y-1">
                          {inheritedHistory.recent_billing.map((event) => {
                            const fallback = (event.unit_rate || 0) * (event.quantity || 0);
                            const amount =
                              typeof event.total_amount === 'number' && Number.isFinite(event.total_amount)
                                ? event.total_amount
                                : fallback;
                            return (
                              <div key={event.id} className="rounded-md border px-2.5 py-2">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-sm font-medium truncate">{event.charge_type}</p>
                                  <p className="text-sm font-semibold">{money.format(amount)}</p>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {event.status} · {safeDate(event.created_at, 'MMM d, yyyy')}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-2 md:col-span-2">
                    <p className="text-sm font-medium">Recent parent notes</p>
                    {inheritedHistory.recent_notes.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No pre-split notes found.</p>
                    ) : (
                      <div className="space-y-1">
                        {inheritedHistory.recent_notes.map((note) => (
                          <div key={note.id} className="rounded-md border px-2.5 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <Badge variant="outline" className="text-[11px]">
                                {note.note_type || 'note'}
                              </Badge>
                              <p className="text-xs text-muted-foreground">
                                {safeDate(note.created_at, 'MMM d, yyyy h:mm a')}
                              </p>
                            </div>
                            <p className="text-sm mt-1 whitespace-pre-wrap">
                              {note.note.length > 240 ? `${note.note.slice(0, 240)}...` : note.note}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/inventory/${lineageParent.id}?tab=activity`)}
                  >
                    <MaterialIcon name="open_in_new" size="sm" className="mr-2" />
                    Open full parent history
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No pre-split history was found on the parent item before this split.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
