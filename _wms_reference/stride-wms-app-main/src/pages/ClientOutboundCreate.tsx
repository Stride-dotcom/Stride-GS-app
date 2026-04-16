import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useClientPortalContext, useClientItems } from '@/hooks/useClientPortal';
import { ClientPortalLayout } from '@/components/client-portal/ClientPortalLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { ShipmentNotesSection } from '@/components/shipments/ShipmentNotesSection';
import { coerceOutboundShipmentNumber } from '@/lib/shipmentNumberUtils';
import { deriveLegacyReleaseTypeFromOutboundTypeName } from '@/lib/outboundReleaseTypeUtils';
import { queueSplitManualReviewAlert, queueSplitRequiredAlert } from '@/lib/alertQueue';
import { markdownToEmailHtml } from '@/lib/emailTemplates/brandedEmailBuilder';

interface Warehouse {
  id: string;
  name: string;
}

interface OutboundType {
  id: string;
  name: string;
}

interface LocationState {
  itemIds?: string[];
  accountId?: string;
}

export default function ClientOutboundCreate() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { portalUser, account, tenant, isLoading: contextLoading } = useClientPortalContext();
  const { data: allItems = [], isLoading: itemsLoading } = useClientItems();

  const state = (location.state as LocationState) || {};
  const preSelectedItemIds = state.itemIds || [];

  const userName = portalUser?.first_name
    ? `${portalUser.first_name} ${portalUser.last_name || ''}`.trim()
    : portalUser?.email || 'User';

  // Reference data
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [outboundTypes, setOutboundTypes] = useState<OutboundType[]>([]);

  // Form fields
  const [warehouseId, setWarehouseId] = useState('');
  const [outboundTypeId, setOutboundTypeId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [draftShipmentId, setDraftShipmentId] = useState<string | null>(null);
  const [draftShipmentNumber, setDraftShipmentNumber] = useState<string | null>(null);
  const [creatingDraft, setCreatingDraft] = useState(false);

  // Item selection
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set(preSelectedItemIds));
  const [searchQuery, setSearchQuery] = useState('');
  const [requestedQtyByItemId, setRequestedQtyByItemId] = useState<Record<string, number>>({});

  // Org preference: allow client partial requests from grouped items
  const [clientPartialGroupedEnabled, setClientPartialGroupedEnabled] = useState(false);

  // Only show items that are in storage / available
  const availableItems = useMemo(() => {
    return allItems.filter((item: any) => {
      const status = item.status?.toLowerCase();
      return status === 'available' || status === 'in_storage' || status === 'active' || status === 'stored';
    });
  }, [allItems]);

  const availableQtyById = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of availableItems as any[]) {
      const qty = typeof item?.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : 1;
      if (typeof item?.id === 'string') map.set(item.id, qty);
    }
    return map;
  }, [availableItems]);

  const getRequestedQty = (itemId: string): number => {
    const available = availableQtyById.get(itemId) ?? 1;
    const raw = requestedQtyByItemId[itemId];
    const qty = typeof raw === 'number' && Number.isFinite(raw) ? raw : available;
    return Math.max(1, Math.min(available, qty));
  };

  const hasPartialGroupedSelection = useMemo(() => {
    for (const itemId of selectedItemIds) {
      const available = availableQtyById.get(itemId) ?? 1;
      const requested = getRequestedQty(itemId);
      if (available > 1 && requested < available) return true;
    }
    return false;
  }, [selectedItemIds, availableQtyById, requestedQtyByItemId]);

  // Keep requested qty hydrated for selected items (including pre-selected)
  useEffect(() => {
    if (selectedItemIds.size === 0) return;
    let changed = false;
    const next: Record<string, number> = { ...requestedQtyByItemId };
    for (const itemId of selectedItemIds) {
      if (next[itemId] == null) {
        next[itemId] = availableQtyById.get(itemId) ?? 1;
        changed = true;
      }
    }
    if (changed) setRequestedQtyByItemId(next);
  }, [availableQtyById, requestedQtyByItemId, selectedItemIds]);

  // Filter by search
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return availableItems;
    const query = searchQuery.toLowerCase();
    return availableItems.filter((item: any) =>
      item.item_code?.toLowerCase().includes(query) ||
      item.description?.toLowerCase().includes(query)
    );
  }, [availableItems, searchQuery]);

  // Fetch reference data
  useEffect(() => {
    if (!portalUser?.tenant_id) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        const [warehousesRes, typesRes] = await Promise.all([
          (supabase.from('warehouses') as any)
            .select('id, name')
            .eq('tenant_id', portalUser.tenant_id)
            .is('deleted_at', null)
            .order('name'),
          (supabase.from('outbound_types') as any)
            .select('id, name')
            .eq('tenant_id', portalUser.tenant_id)
            .eq('is_active', true)
            .order('sort_order'),
        ]);

        setWarehouses(warehousesRes.data || []);
        setOutboundTypes(typesRes.data || []);

        // Auto-select warehouse if only one
        if (warehousesRes.data?.length === 1) {
          setWarehouseId(warehousesRes.data[0].id);
        }

        // Default to Will Call type
        const willCall = (typesRes.data || []).find((t: OutboundType) => t.name === 'Will Call');
        setOutboundTypeId(willCall?.id || typesRes.data?.[0]?.id || '');
      } catch (err) {
        console.error('[ClientOutboundCreate] fetchData error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [portalUser?.tenant_id]);

  // Load preference (best-effort; default = disabled/manual review)
  useEffect(() => {
    if (!portalUser?.tenant_id) return;
    const run = async () => {
      try {
        const { data, error } = await (supabase as any)
          .from('tenant_settings')
          .select('setting_value')
          .eq('tenant_id', portalUser.tenant_id)
          .eq('setting_key', 'client_partial_grouped_enabled')
          .maybeSingle();
        if (error) throw error;
        const v = data?.setting_value as unknown;
        if (typeof v === 'boolean') setClientPartialGroupedEnabled(v);
        else if (typeof v === 'string') setClientPartialGroupedEnabled(v.trim().toLowerCase() === 'true');
        else setClientPartialGroupedEnabled(false);
      } catch {
        // Safe default: disabled/manual review
        setClientPartialGroupedEnabled(false);
      }
    };
    void run();
  }, [portalUser?.tenant_id]);

  // Item selection handlers
  const toggleItemSelection = (itemId: string) => {
    const newSet = new Set(selectedItemIds);
    if (newSet.has(itemId)) {
      newSet.delete(itemId);
      setRequestedQtyByItemId((prev) => {
        if (prev[itemId] == null) return prev;
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
    } else {
      newSet.add(itemId);
      setRequestedQtyByItemId((prev) => {
        if (prev[itemId] != null) return prev;
        const next = { ...prev };
        next[itemId] = availableQtyById.get(itemId) ?? 1;
        return next;
      });
    }
    setSelectedItemIds(newSet);
  };

  const selectAllItems = () => {
    setSelectedItemIds(new Set(filteredItems.map((item: any) => item.id)));
  };

  const deselectAllItems = () => {
    setSelectedItemIds(new Set());
  };

  // Validation
  const validate = (): boolean => {
    if (!warehouseId) {
      toast({ variant: 'destructive', title: 'Validation Error', description: 'Please select a warehouse' });
      return false;
    }
    if (!outboundTypeId) {
      toast({ variant: 'destructive', title: 'Validation Error', description: 'Please select an outbound type' });
      return false;
    }
    if (selectedItemIds.size === 0) {
      toast({ variant: 'destructive', title: 'Validation Error', description: 'Please select at least one item' });
      return false;
    }
    return true;
  };

  const loadShipmentMetadata = async (
    shipmentId: string,
    tenantId: string
  ): Promise<Record<string, any>> => {
    const { data, error } = await (supabase.from('shipments') as any)
      .select('metadata')
      .eq('id', shipmentId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) throw error;
    return data?.metadata && typeof data.metadata === 'object' ? data.metadata : {};
  };

  const updateShipmentMetadataMerged = async (args: {
    shipmentId: string;
    tenantId: string;
    warnLabel: string;
    build: (existing: Record<string, any>) => Record<string, any>;
  }): Promise<void> => {
    const existingMeta = await loadShipmentMetadata(args.shipmentId, args.tenantId);
    const nextMeta = args.build(existingMeta);

    const { error } = await (supabase.from('shipments') as any)
      .update({ metadata: nextMeta })
      .eq('id', args.shipmentId)
      .eq('tenant_id', args.tenantId);

    if (error) {
      console.warn(`[ClientOutboundCreate] ${args.warnLabel} metadata update failed:`, error);
    }
  };

  const fetchLatestPublicUnifiedNote = useCallback(async (shipmentId: string): Promise<string> => {
    if (!portalUser?.tenant_id) return '';
    const { data } = await (supabase as any)
      .from('notes')
      .select('note')
      .eq('tenant_id', portalUser.tenant_id)
      .eq('source_entity_type', 'shipment')
      .eq('source_entity_id', shipmentId)
      .eq('note_type', 'public')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return typeof data?.note === 'string' ? data.note.trim() : '';
  }, [portalUser?.tenant_id]);

  const ensureDraftShipment = useCallback(async (): Promise<string | null> => {
    if (draftShipmentId || creatingDraft) return draftShipmentId;
    if (!portalUser?.tenant_id || !portalUser?.account_id) return null;

    setCreatingDraft(true);
    try {
      const selectedOutboundType = outboundTypes.find((t) => t.id === outboundTypeId);
      const releaseType = deriveLegacyReleaseTypeFromOutboundTypeName(selectedOutboundType?.name);

      const { data: draft, error } = await (supabase.from('shipments') as any)
        .insert({
          tenant_id: portalUser.tenant_id,
          shipment_type: 'outbound',
          release_type: releaseType,
          status: 'pending',
          account_id: portalUser.account_id,
          warehouse_id: warehouseId || null,
          outbound_type_id: outboundTypeId || null,
          expected_arrival_date: expectedDate || null,
          customer_authorized: true,
          customer_authorized_at: new Date().toISOString(),
          metadata: {
            client_portal_request: true,
            client_portal_draft: true,
            requested_by_email: portalUser.email,
            requested_by_name: userName,
          },
        })
        .select('id, shipment_number')
        .single();

      if (error) throw error;

      const draftId = draft.id as string;
      const draftNumber = (draft.shipment_number as string | null) || null;
      setDraftShipmentId(draftId);
      setDraftShipmentNumber(draftNumber);

      const initialText = notes.trim();
      if (initialText) {
        const { error: mirrorError } = await (supabase as any).rpc('create_unified_note', {
          p_entity_type: 'shipment',
          p_entity_id: draftId,
          p_note_text: initialText,
          p_note_type: 'public',
          p_source_entity_number: draftNumber,
          p_metadata: {
            source: 'client_outbound_create_draft_seed',
            legacy_field: 'shipments.notes',
          },
        });
        if (mirrorError) {
          console.warn('[ClientOutboundCreate] Failed to seed draft note:', mirrorError.message);
        } else {
          setNotes('');
        }
      }

      return draftId;
    } catch (err) {
      console.error('[ClientOutboundCreate] Failed to create notes draft shipment:', err);
      toast({
        variant: 'destructive',
        title: 'Unable to start notes thread',
        description: 'You can still submit using the basic note field.',
      });
      return null;
    } finally {
      setCreatingDraft(false);
    }
  }, [
    creatingDraft,
    draftShipmentId,
    expectedDate,
    notes,
    outboundTypeId,
    outboundTypes,
    portalUser?.account_id,
    portalUser?.email,
    portalUser?.tenant_id,
    toast,
    userName,
    warehouseId,
  ]);

  // Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!portalUser?.tenant_id || !portalUser?.account_id) {
      toast({ variant: 'destructive', title: 'Error', description: 'Missing account information' });
      return;
    }

    if (!validate()) return;

    setSaving(true);

    try {
      const itemIds = Array.from(selectedItemIds);
      const initialSplitCandidates = itemIds
        .map((item_id) => {
          const available = availableQtyById.get(item_id) ?? 1;
          const requested = getRequestedQty(item_id);
          return { item_id, available, requested };
        })
        .filter((r) => r.available > 1 && r.requested < r.available);

      if (initialSplitCandidates.length > 0) {
        if (!clientPartialGroupedEnabled) {
          const ok = window.confirm(
            `${tenant?.name || 'The warehouse team'} will review this request before processing.\n\n` +
              `This outbound includes a partial quantity from a grouped item.\n\n` +
              `Continue and submit as Pending review?`
          );
          if (!ok) return;
        } else {
          const ok = window.confirm(
            `This outbound includes a partial quantity from a grouped item.\n\n` +
              `The warehouse will create new labels and complete a Split task before the job can start.\n\n` +
              `Continue and submit?`
          );
          if (!ok) return;
        }
      }

      const selectedOutboundType = outboundTypes.find((t) => t.id === outboundTypeId);
      const derivedReleaseType = deriveLegacyReleaseTypeFromOutboundTypeName(selectedOutboundType?.name);
      const fallbackPublicNote = notes.trim();
      const draftId = draftShipmentId || (await ensureDraftShipment());
      let shipment: { id: string; shipment_number: string | null };

      if (draftId) {
        const threadedPublicNote = await fetchLatestPublicUnifiedNote(draftId);
        const publicNotesForSave = threadedPublicNote || fallbackPublicNote || null;
        const { data: updatedShipment, error: shipmentError } = await (supabase.from('shipments') as any)
          .update({
            shipment_type: 'outbound',
            release_type: derivedReleaseType,
            status: 'pending',
            account_id: portalUser.account_id,
            warehouse_id: warehouseId,
            outbound_type_id: outboundTypeId,
            notes: publicNotesForSave,
            expected_arrival_date: expectedDate || null,
            customer_authorized: true,
            customer_authorized_at: new Date().toISOString(),
            metadata: {
              client_portal_request: true,
              requested_by_email: portalUser.email,
              requested_by_name: userName,
            },
          })
          .eq('id', draftId)
          .eq('tenant_id', portalUser.tenant_id)
          .select('id, shipment_number')
          .single();
        if (shipmentError) throw shipmentError;
        shipment = {
          id: updatedShipment.id,
          shipment_number: updatedShipment.shipment_number || draftShipmentNumber || null,
        };
      } else {
        const { data: createdShipment, error: shipmentError } = await (supabase.from('shipments') as any)
          .insert({
            tenant_id: portalUser.tenant_id,
            shipment_type: 'outbound',
            // Legacy field: derived from current outbound type (required for SOP validation)
            release_type: derivedReleaseType,
            status: 'pending',
            account_id: portalUser.account_id,
            warehouse_id: warehouseId,
            outbound_type_id: outboundTypeId,
            notes: fallbackPublicNote || null,
            expected_arrival_date: expectedDate || null,
            customer_authorized: true,
            customer_authorized_at: new Date().toISOString(),
            metadata: {
              client_portal_request: true,
              requested_by_email: portalUser.email,
              requested_by_name: userName,
            },
          })
          .select('id, shipment_number')
          .single();
        if (shipmentError) throw shipmentError;
        shipment = {
          id: createdShipment.id,
          shipment_number: createdShipment.shipment_number || null,
        };
      }
      let effectiveShipmentNumber: string | null = shipment.shipment_number;

      // Coerce legacy SHP-###### → OUT-##### for new outbound shipments (best-effort).
      const coerced = coerceOutboundShipmentNumber(effectiveShipmentNumber);
      if (coerced) {
        const { error: renumberError } = await (supabase.from('shipments') as any)
          .update({ shipment_number: coerced })
          .eq('tenant_id', portalUser.tenant_id)
          .eq('id', shipment.id);
        if (!renumberError) {
          effectiveShipmentNumber = coerced;
        }
      }

      if (!draftId && fallbackPublicNote) {
        const { error: mirrorNoteError } = await (supabase as any).rpc('create_unified_note', {
          p_entity_type: 'shipment',
          p_entity_id: shipment.id,
          p_note_text: fallbackPublicNote,
          p_note_type: 'public',
          p_source_entity_number: effectiveShipmentNumber || shipment.shipment_number || null,
          p_metadata: {
            source: 'client_outbound_create',
            legacy_field: 'shipments.notes',
          },
        });
        if (mirrorNoteError) {
          console.warn('[ClientOutboundCreate] Failed to mirror note into unified notes:', mirrorNoteError.message);
        }
      }

      // Create shipment items
      if (itemIds.length > 0) {
        const shipmentItems = itemIds.map(item_id => ({
          shipment_id: shipment.id,
          item_id,
          expected_quantity: getRequestedQty(item_id),
          status: 'pending',
        }));

        const { error: itemsError } = await (supabase.from('shipment_items') as any)
          .insert(shipmentItems);

        if (itemsError) {
          console.error('[ClientOutboundCreate] shipment items error:', itemsError);
        }

        // Mark items as allocated
        await (supabase.from('items') as any)
          .update({ status: 'allocated' })
          .in('id', itemIds);

        // Detect grouped-item partial requests
        const splitCandidates = itemIds
          .map((item_id) => {
            const available = availableQtyById.get(item_id) ?? 1;
            const requested = getRequestedQty(item_id);
            return { item_id, available, requested, leftover: Math.max(0, available - requested) };
          })
          .filter((r) => r.available > 1 && r.requested < r.available);

        if (splitCandidates.length > 0) {
          const requestNotes = notes.trim() || null;

          if (clientPartialGroupedEnabled) {
            // Automated Split Required workflow: create a Split task per grouped item
            const splitTaskIds: string[] = [];
            const splitItemsForMeta: any[] = [];

            for (const c of splitCandidates) {
              const itemRow = availableItems.find((it: any) => it.id === c.item_id);
              const itemCode = itemRow?.item_code || c.item_id;
              const groupedQty = typeof itemRow?.quantity === 'number' ? itemRow.quantity : c.available;
              const keepQty = c.requested;
              const leftoverQty = groupedQty - keepQty;

              // Idempotency: reuse existing split task if it already exists
              const { data: existingSplitTask } = await (supabase.from('tasks') as any)
                .select('id')
                .eq('tenant_id', portalUser.tenant_id)
                .eq('task_type', 'Split')
                .contains('metadata', {
                  split_workflow: {
                    origin_entity_type: 'shipment',
                    origin_entity_id: shipment.id,
                    parent_item_id: c.item_id,
                  },
                })
                .in('status', ['pending', 'in_progress'])
                .limit(1)
                .maybeSingle();

              let splitTaskId: string | null = existingSplitTask?.id || null;

              if (!splitTaskId) {
                const nowIso = new Date().toISOString();
                const title = effectiveShipmentNumber
                  ? `Split - ${itemCode} (for ${effectiveShipmentNumber})`
                  : `Split - ${itemCode}`;

                const description = [
                  `Split required for grouped item ${itemCode}.`,
                  `Keep qty on parent label: ${keepQty} (of ${groupedQty}).`,
                  `Leftover qty to relabel: ${leftoverQty}.`,
                  '',
                  'Client note:',
                  requestNotes || '(none)',
                ].join('\n');

                const { data: newTask, error: taskErr } = await (supabase.from('tasks') as any)
                  .insert({
                    tenant_id: portalUser.tenant_id,
                    account_id: portalUser.account_id,
                    warehouse_id: warehouseId,
                    related_item_id: c.item_id,
                    task_type: 'Split',
                    title,
                    description,
                    priority: 'urgent',
                    status: 'pending',
                    assigned_department: 'warehouse',
                    metadata: {
                      client_portal_request: true,
                      requested_by_email: portalUser.email,
                      requested_by_name: userName,
                      split_workflow: {
                        origin_entity_type: 'shipment',
                        origin_entity_id: shipment.id,
                        origin_entity_number: effectiveShipmentNumber,
                        parent_item_id: c.item_id,
                        parent_item_code: itemCode,
                        grouped_qty: groupedQty,
                        keep_qty: keepQty,
                        leftover_qty: leftoverQty,
                        requested_by_name: userName,
                        requested_by_email: portalUser.email,
                        request_notes: requestNotes,
                        created_at: nowIso,
                      },
                    },
                  })
                  .select('id')
                  .single();

                if (taskErr) throw taskErr;
                splitTaskId = newTask.id;

                const { error: linkErr } = await (supabase.from('task_items') as any).insert({
                  task_id: splitTaskId,
                  item_id: c.item_id,
                });
                if (linkErr) throw linkErr;
              }

              if (splitTaskId) {
                splitTaskIds.push(splitTaskId);
                splitItemsForMeta.push({
                  parent_item_id: c.item_id,
                  parent_item_code: itemCode,
                  grouped_qty: groupedQty,
                  keep_qty: keepQty,
                  leftover_qty: leftoverQty,
                  split_task_id: splitTaskId,
                });

                void queueSplitRequiredAlert(portalUser.tenant_id, splitTaskId, itemCode);
              }
            }

            // Block the outbound until split tasks are completed.
            // Merge metadata to avoid wiping unrelated keys and clear stale manual-review keys.
            await updateShipmentMetadataMerged({
              shipmentId: shipment.id,
              tenantId: portalUser.tenant_id,
              warnLabel: 'split_required',
              build: (existingMeta) => {
                const nextMeta: Record<string, any> = {
                  ...(existingMeta as any),
                  client_portal_request: true,
                  requested_by_email: portalUser.email,
                  requested_by_name: userName,
                  split_required: true,
                  split_required_task_ids: splitTaskIds,
                  split_required_items: splitItemsForMeta,
                  split_required_created_at: new Date().toISOString(),
                };

                // Ensure the shipment does not carry contradictory pending-review split state.
                delete nextMeta.pending_review;
                delete nextMeta.pending_review_reason;
                delete nextMeta.split_workflow;
                delete nextMeta.split_workflow_items;
                delete nextMeta.origin_job_type;
                delete nextMeta.origin_job_number;
                return nextMeta;
              },
            });
          } else {
            // Manual review flow: no split task, mark the job Pending review + alert internal staff
            const splitItemsForMeta = splitCandidates.map((c) => {
              const itemRow = availableItems.find((it: any) => it.id === c.item_id);
              const itemCode = itemRow?.item_code || c.item_id;
              return {
                parent_item_id: c.item_id,
                parent_item_code: itemCode,
                grouped_qty: c.available,
                keep_qty: c.requested,
                leftover_qty: c.leftover,
                request_notes: requestNotes,
                requested_by_name: userName,
                requested_by_email: portalUser.email,
              };
            });

            const first = splitItemsForMeta[0];
            const itemCode = first?.parent_item_code || first?.parent_item_id || splitCandidates[0]?.item_id;

            const reviewReason =
              splitItemsForMeta.length <= 1
                ? `Client requested ${first.keep_qty} of ${first.grouped_qty} units from grouped item ${itemCode}.`
                : `Client requested partial quantities from ${splitItemsForMeta.length} grouped items: ${splitItemsForMeta
                    .map((c) => `${c.parent_item_code} (${c.keep_qty} of ${c.grouped_qty})`)
                    .join('; ')}.`;

            await updateShipmentMetadataMerged({
              shipmentId: shipment.id,
              tenantId: portalUser.tenant_id,
              warnLabel: 'pending_review',
              build: (existingMeta) => {
                const nextMeta: Record<string, any> = {
                  ...(existingMeta as any),
                  client_portal_request: true,
                  requested_by_email: portalUser.email,
                  requested_by_name: userName,
                  pending_review: true,
                  pending_review_reason: reviewReason,
                  split_workflow: {
                    ...(first as any),
                  },
                  split_workflow_items: splitItemsForMeta,
                  origin_job_type: 'Shipment',
                  origin_job_number: effectiveShipmentNumber,
                };

                // Ensure the shipment does not carry contradictory split-required state.
                delete nextMeta.split_required;
                delete nextMeta.split_required_task_ids;
                delete nextMeta.split_required_items;
                delete nextMeta.split_required_created_at;
                return nextMeta;
              },
            });

            const manualReviewBodyText = [
              'A client requested a partial quantity from one or more grouped items, but automated split tasks are disabled for this tenant.',
              'This shipment is marked Pending review.',
              ' ',
              'Requested grouped items:',
              ...splitItemsForMeta.map(
                (c) =>
                  `- ${c.parent_item_code}: requested ${c.keep_qty} of ${c.grouped_qty} (leftover ${c.leftover_qty})`
              ),
              ' ',
              `Origin Job: Shipment ${effectiveShipmentNumber || shipment.id}`,
              requestNotes ? `Notes: ${requestNotes}` : '',
            ]
              .filter(Boolean)
              .join('\n');

            const manualReviewBodyHtml = `<div style="font-family: ui-sans-serif, system-ui; font-size: 14px;">${markdownToEmailHtml(manualReviewBodyText)}</div>`;

            void queueSplitManualReviewAlert(
              portalUser.tenant_id,
              'shipment',
              shipment.id,
              itemCode,
              manualReviewBodyText,
              manualReviewBodyHtml
            );
          }
        }
      }

      toast({
        title: 'Outbound Shipment Submitted',
        description:
          itemIds.some((iid) => (availableQtyById.get(iid) ?? 1) > 1 && getRequestedQty(iid) < (availableQtyById.get(iid) ?? 1))
            ? clientPartialGroupedEnabled
              ? `Shipment ${effectiveShipmentNumber || ''} submitted. Waiting for warehouse split completion.`
              : `Shipment ${effectiveShipmentNumber || ''} submitted as Pending review.`
            : `Shipment ${effectiveShipmentNumber || ''} has been submitted to the warehouse.`,
      });

      navigate('/client/shipments');
    } catch (err: any) {
      console.error('[ClientOutboundCreate] submit error:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err.message || 'Failed to create outbound shipment',
      });
    } finally {
      setSaving(false);
    }
  };

  if (contextLoading || loading) {
    return (
      <ClientPortalLayout>
        <div className="flex items-center justify-center h-64">
          <MaterialIcon name="progress_activity" size="xl" className="animate-spin text-muted-foreground" />
        </div>
      </ClientPortalLayout>
    );
  }

  return (
    <ClientPortalLayout
      accountName={account?.name}
      warehouseName={tenant?.name}
      userName={userName}
    >
      <div className="space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link to="/client/items">
            <Button variant="ghost" size="icon">
              <MaterialIcon name="arrow_back" size="sm" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Create Outbound Shipment</h1>
            <p className="text-muted-foreground">Select items to ship out from your inventory</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Shipment Details */}
          <Card>
            <CardHeader>
              <CardTitle>Shipment Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Account (read-only) */}
              <div className="space-y-1.5">
                <Label>Account</Label>
                <div className="flex items-center h-10 px-3 rounded-md border bg-muted/50 text-sm">
                  {account?.name || 'Your Account'}
                </div>
              </div>

              {/* Outbound Type & Warehouse */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>
                    Outbound Type <span className="text-destructive">*</span>
                  </Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={outboundTypeId}
                    onChange={e => setOutboundTypeId(e.target.value)}
                  >
                    <option value="">Select type...</option>
                    {outboundTypes.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label>
                    Warehouse <span className="text-destructive">*</span>
                  </Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={warehouseId}
                    onChange={e => setWarehouseId(e.target.value)}
                  >
                    <option value="">Select warehouse...</option>
                    {warehouses.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Expected Date */}
              <div className="space-y-1.5">
                <Label>Expected Pickup/Ship Date</Label>
                <Input
                  type="date"
                  value={expectedDate}
                  onChange={e => setExpectedDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label>Public Notes</Label>
                {draftShipmentId ? (
                  <ShipmentNotesSection
                    shipmentId={draftShipmentId}
                    isClientUser
                    allowClientWrite
                    embedded
                    forcedNoteType="public"
                  />
                ) : (
                  <>
                    <Textarea
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      onFocus={() => {
                        if (!draftShipmentId && !creatingDraft) {
                          void ensureDraftShipment();
                        }
                      }}
                      placeholder="Additional notes or pickup instructions..."
                      rows={2}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={creatingDraft}
                      onClick={() => {
                        void ensureDraftShipment();
                      }}
                    >
                      {creatingDraft ? 'Starting thread...' : 'Use threaded notes'}
                    </Button>
                  </>
                )}
                {hasPartialGroupedSelection && (
                  <p className="text-xs text-muted-foreground">
                    If you need specific items from a grouped package/carton, add details here (e.g., matching set, serials, photos, etc.).
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Items Selection */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="text-lg">Select Items</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedItemIds.size} item{selectedItemIds.size !== 1 ? 's' : ''} selected
                  {availableItems.length > 0 && ` of ${availableItems.length} available`}
                </p>
              </div>
              {availableItems.length > 0 && (
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={selectAllItems}>
                    Select All
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={deselectAllItems}>
                    Clear
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {itemsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
                </div>
              ) : availableItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <MaterialIcon name="inventory_2" size="xl" className="text-muted-foreground mb-2" />
                  <p className="text-muted-foreground">No available items in your account</p>
                  <p className="text-sm text-muted-foreground">Items must be in storage to be shipped out</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Search */}
                  <div className="relative">
                    <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search items..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>

                  {/* Items table */}
                  <div className="border rounded-lg overflow-hidden max-h-96 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12"></TableHead>
                          <TableHead>Item Code</TableHead>
                          <TableHead className="w-28 text-right">Qty</TableHead>
                          <TableHead className="hidden sm:table-cell">Description</TableHead>
                          <TableHead className="hidden md:table-cell">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredItems.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                              No items match your search
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredItems.map((item: any) => (
                            <TableRow
                              key={item.id}
                              className={`cursor-pointer hover:bg-muted/50 ${selectedItemIds.has(item.id) ? 'bg-muted/30' : ''}`}
                              onClick={() => toggleItemSelection(item.id)}
                            >
                              <TableCell>
                                <Checkbox
                                  checked={selectedItemIds.has(item.id)}
                                  onCheckedChange={() => toggleItemSelection(item.id)}
                                  onClick={e => e.stopPropagation()}
                                />
                              </TableCell>
                              <TableCell className="font-medium">{item.item_code}</TableCell>
                              <TableCell className="text-right tabular-nums" onClick={(e) => e.stopPropagation()}>
                                {selectedItemIds.has(item.id) ? (
                                  <div className="flex items-center justify-end gap-2">
                                    <Input
                                      type="number"
                                      min={1}
                                      max={typeof item.quantity === 'number' ? item.quantity : 1}
                                      step={1}
                                      value={getRequestedQty(item.id)}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => {
                                        const available = typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : 1;
                                        const raw = parseInt(e.target.value || '0', 10);
                                        const next = Number.isFinite(raw) ? raw : 1;
                                        const clamped = Math.max(1, Math.min(available, next));
                                        setRequestedQtyByItemId((prev) => ({ ...prev, [item.id]: clamped }));
                                      }}
                                      className="h-8 w-20 text-right"
                                      aria-label={`Requested quantity for ${item.item_code}`}
                                    />
                                    {typeof item.quantity === 'number' && item.quantity > 1 && (
                                      <span className="text-xs text-muted-foreground">/ {item.quantity}</span>
                                    )}
                                  </div>
                                ) : (
                                  <span>{typeof item.quantity === 'number' ? item.quantity : 1}</span>
                                )}
                              </TableCell>
                              <TableCell className="hidden sm:table-cell max-w-[200px] truncate">
                                {item.description || '-'}
                              </TableCell>
                              <TableCell className="hidden md:table-cell">
                                <Badge variant="outline">{item.status?.replace(/_/g, ' ')}</Badge>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Submit */}
          <div className="flex justify-end gap-3 pb-6">
            <Link to="/client/items">
              <Button type="button" variant="outline" disabled={saving}>
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={saving || selectedItemIds.size === 0} className="min-w-[160px]">
              {saving ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <MaterialIcon name="send" size="sm" className="mr-2" />
                  Submit Outbound
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </ClientPortalLayout>
  );
}
