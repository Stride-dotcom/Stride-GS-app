import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useOutboundTypes, useAccountItems } from '@/hooks/useOutbound';
import { useSidemarks } from '@/hooks/useSidemarks';
import { useDocuments } from '@/hooks/useDocuments';
import { useShipmentExceptions } from '@/hooks/useShipmentExceptions';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { SearchableSelect, SelectOption } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PhotoScannerButton } from '@/components/common/PhotoScannerButton';
import { PhotoUploadButton } from '@/components/common/PhotoUploadButton';
import { TaggablePhotoGrid, TaggablePhoto, getPhotoUrls } from '@/components/common/TaggablePhotoGrid';
import { DocumentCapture } from '@/components/scanner/DocumentCapture';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ShipmentExceptionsChips } from '@/components/shipments/ShipmentExceptionsChips';
import { ShipmentNotesSection } from '@/components/shipments/ShipmentNotesSection';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { HelpButton } from '@/components/prompts';
import { coerceOutboundShipmentNumber } from '@/lib/shipmentNumberUtils';
import { deriveLegacyReleaseTypeFromOutboundTypeName } from '@/lib/outboundReleaseTypeUtils';
import { logActivity } from '@/lib/activity/logActivity';
import { queueSplitRequiredAlert } from '@/lib/alertQueue';
import { EntityActivityFeed } from '@/components/activity/EntityActivityFeed';
import { useItemDisplaySettingsForUser } from '@/hooks/useItemDisplaySettingsForUser';
import { ItemColumnsPopover } from '@/components/items/ItemColumnsPopover';
import { ItemPreviewCard } from '@/components/items/ItemPreviewCard';
import { formatItemSize } from '@/lib/items/formatItemSize';
import { format } from 'date-fns';
import {
  type BuiltinItemColumnKey,
  type ItemColumnKey,
  getColumnLabel,
  getViewById,
  getVisibleColumnsForView,
  parseCustomFieldColumnKey,
} from '@/lib/items/itemDisplaySettings';

// ============================================
// TYPES
// ============================================

interface Account {
  id: string;
  account_name: string;
  account_code: string | null;
}

interface Warehouse {
  id: string;
  name: string;
}

interface FormErrors {
  account?: string;
  warehouse?: string;
  outbound_type?: string;
  items?: string;
}

// ============================================
// COMPONENT
// ============================================

export default function OutboundCreate() {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();
  const { toast } = useToast();

  // Get pre-selected items from navigation state (from Inventory or Item Details)
  const preSelectedItemIds = (location.state as any)?.itemIds || [];
  const preSelectedAccountId = (location.state as any)?.accountId || '';

  // Hooks
  const { outboundTypes, loading: typesLoading } = useOutboundTypes();

  // Item table view (tenant-managed)
  const {
    settings: itemDisplaySettings,
    tenantSettings: tenantItemDisplaySettings,
    defaultViewId: defaultItemViewId,
    loading: itemDisplayLoading,
    saving: itemDisplaySaving,
    saveSettings: saveItemDisplaySettings,
  } = useItemDisplaySettingsForUser();
  const [activeItemViewId, setActiveItemViewId] = useState<string>('');

  useEffect(() => {
    if (!activeItemViewId && defaultItemViewId) {
      setActiveItemViewId(defaultItemViewId);
    }
  }, [defaultItemViewId, activeItemViewId]);

  const activeItemView = useMemo(() => {
    return (
      getViewById(itemDisplaySettings, activeItemViewId) ||
      getViewById(itemDisplaySettings, defaultItemViewId) ||
      itemDisplaySettings.views[0]
    );
  }, [itemDisplaySettings, activeItemViewId, defaultItemViewId]);

  const outboundItemVisibleColumns = useMemo(
    () => (activeItemView ? getVisibleColumnsForView(activeItemView) : []),
    [activeItemView]
  );

  // Draft outbound shipment (create immediately to get OUT-##### number)
  const [draftShipmentId, setDraftShipmentId] = useState<string | null>(null);
  const [draftShipmentNumber, setDraftShipmentNumber] = useState<string | null>(null);
  const [draftCreating, setDraftCreating] = useState(false);
  const draftCreateStartedRef = useRef(false);
  const draftFinalizedRef = useRef(false);
  const draftCleanupStartedRef = useRef(false);

  const cleanupDraftShipment = useCallback(async () => {
    if (!profile?.tenant_id) return;
    if (!draftShipmentId) return;
    if (draftFinalizedRef.current) return;
    if (draftCleanupStartedRef.current) return;
    draftCleanupStartedRef.current = true;

    try {
      const now = new Date().toISOString();

      // If anything allocated items for this draft, restore them before removing draft rows.
      const { data: draftItems, error: draftItemsError } = await (supabase.from('shipment_items') as any)
        .select('item_id')
        .eq('shipment_id', draftShipmentId);

      if (!draftItemsError) {
        const draftItemIds: string[] = (Array.isArray(draftItems) ? draftItems : [])
          .map((r: any) => r?.item_id)
          .filter((v: any) => typeof v === 'string');

        if (draftItemIds.length > 0) {
          await (supabase.from('items') as any)
            .update({ status: 'stored' })
            .in('id', draftItemIds)
            .eq('status', 'allocated');
        }
      } else {
        console.warn('[OutboundCreate] draft cleanup fetch items error:', draftItemsError);
      }

      // Best-effort cleanup so abandoned drafts don't appear in outbound lists.
      await (supabase.from('shipment_items') as any)
        .delete()
        .eq('shipment_id', draftShipmentId);

      await (supabase.from('shipments') as any)
        .update({ deleted_at: now, status: 'cancelled' })
        .eq('tenant_id', profile.tenant_id)
        .eq('id', draftShipmentId);
    } catch (err) {
      console.warn('[OutboundCreate] draft cleanup error:', err);
    }
  }, [draftShipmentId, profile?.tenant_id]);

  // Form state
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [errors, setErrors] = useState<FormErrors>({});

  // Shipment fields
  const [accountId, setAccountId] = useState<string>(preSelectedAccountId);
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [outboundTypeId, setOutboundTypeId] = useState<string>('');
  const [sidemarkId, setSidemarkId] = useState<string>('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [notesTouched, setNotesTouched] = useState(false);
  const [releasedTo, setReleasedTo] = useState('');
  const [releaseToEmail, setReleaseToEmail] = useState('');
  const [releaseToPhone, setReleaseToPhone] = useState('');
  const [customerAuthorized, setCustomerAuthorized] = useState(true);
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [poNumber, setPoNumber] = useState('');

  const [accountDefaultShipmentNotes, setAccountDefaultShipmentNotes] = useState<string | null>(null);
  const [accountHighlightShipmentNotes, setAccountHighlightShipmentNotes] = useState(false);
  const [internalNotes, setInternalNotes] = useState('');

  // Photos/Documents (match intake behavior)
  const [receivingPhotos, setReceivingPhotos] = useState<(string | TaggablePhoto)[]>([]);
  const {
    documents,
    refetch: refetchDocuments,
  } = useDocuments({ contextType: 'shipment', contextId: draftShipmentId || undefined });
  const { openCount: draftOpenExceptionCount } = useShipmentExceptions(draftShipmentId || undefined);

  // Item selection
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set(preSelectedItemIds));
  const [searchQuery, setSearchQuery] = useState('');
  // Requested quantity per selected item (defaults to full available qty)
  const [requestedQtyByItemId, setRequestedQtyByItemId] = useState<Record<string, number>>({});

  // Fetch account items
  const { items: accountItems, loading: itemsLoading } = useAccountItems(accountId || undefined);

  // Fetch sidemarks filtered by account
  const { sidemarks, loading: sidemarksLoading } = useSidemarks(accountId || undefined);

  // Create draft shipment on entry (OUT# assigned by DB trigger)
  useEffect(() => {
    if (!profile?.tenant_id || !profile?.id) return;
    if (draftShipmentId) return;
    if (draftCreateStartedRef.current) return;
    draftCreateStartedRef.current = true;

    const createDraft = async () => {
      setDraftCreating(true);
      try {
        const now = new Date().toISOString();
        const { data, error } = await (supabase.from('shipments') as any)
          .insert({
            tenant_id: profile.tenant_id,
            shipment_type: 'outbound',
            status: 'pending',
            // Create as soft-deleted so abandoned drafts don't surface as real shipments.
            // We'll "un-delete" it on successful submit.
            deleted_at: now,
            // Seed account if the user navigated here from an item context
            account_id: preSelectedAccountId || null,
            created_by: profile.id,
            customer_authorized: true,
            customer_authorized_at: now,
            customer_authorized_by: profile.id,
            release_type: 'will_call',
          })
          .select('id, shipment_number')
          .single();

        if (error) throw error;
        let effectiveShipmentNumber: string | null = data.shipment_number;

        // Guard: some envs still generate SHP-###### for outbound shipments.
        // Coerce to OUT-##### for new outbound shipments and persist back to DB.
        const coerced = coerceOutboundShipmentNumber(effectiveShipmentNumber);
        if (coerced) {
          const { error: renumberError } = await (supabase.from('shipments') as any)
            .update({ shipment_number: coerced })
            .eq('tenant_id', profile.tenant_id)
            .eq('id', data.id);

          if (renumberError) {
            console.warn('[OutboundCreate] failed to coerce outbound shipment_number:', renumberError);
          } else {
            effectiveShipmentNumber = coerced;
          }
        }

        setDraftShipmentId(data.id);
        setDraftShipmentNumber(effectiveShipmentNumber);
      } catch (err: any) {
        console.error('[OutboundCreate] draft create error:', err);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: err?.message || 'Failed to start outbound shipment',
        });
        // Allow retry if the user refreshes
        draftCreateStartedRef.current = false;
      } finally {
        setDraftCreating(false);
      }
    };

    void createDraft();
  }, [profile?.tenant_id, profile?.id, draftShipmentId, preSelectedAccountId, toast]);

  // Load draft photos (if any) once the draft exists.
  useEffect(() => {
    if (!profile?.tenant_id || !draftShipmentId) return;

    let cancelled = false;
    const load = async () => {
      const { data, error } = await supabase
        .from('shipments')
        .select('receiving_photos')
        .eq('tenant_id', profile.tenant_id)
        .eq('id', draftShipmentId)
        .maybeSingle();

      if (cancelled) return;
      if (error) return;

      const existing = (data as any)?.receiving_photos;
      if (Array.isArray(existing)) {
        setReceivingPhotos(existing as (string | TaggablePhoto)[]);
      } else {
        setReceivingPhotos([]);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [draftShipmentId, profile?.tenant_id]);

  const saveReceivingPhotosToShipment = useCallback(async (photos: (string | TaggablePhoto)[]): Promise<boolean> => {
    if (!profile?.tenant_id || !draftShipmentId) return false;
    try {
      const { error } = await supabase
        .from('shipments')
        .update({ receiving_photos: photos as unknown as Json })
        .eq('tenant_id', profile.tenant_id)
        .eq('id', draftShipmentId);
      if (error) throw error;
      return true;
    } catch (err: any) {
      console.error('[OutboundCreate] Failed to save photos:', err);
      toast({
        variant: 'destructive',
        title: 'Photo Save Error',
        description: err?.message || 'Failed to save photos',
      });
      return false;
    }
  }, [draftShipmentId, profile?.tenant_id, toast]);

  const mergeAndSaveReceivingPhotoUrls = useCallback(async (urls: string[]) => {
    const existingUrls = getPhotoUrls(receivingPhotos);
    const newUrls = urls.filter(u => !existingUrls.includes(u));
    const newTaggablePhotos: TaggablePhoto[] = newUrls.map(url => ({
      url,
      isPrimary: false,
      needsAttention: false,
      isRepair: false,
    }));
    const normalizedExisting: TaggablePhoto[] = receivingPhotos.map(p =>
      typeof p === 'string'
        ? { url: p, isPrimary: false, needsAttention: false, isRepair: false }
        : p
    );
    const allPhotos = [...normalizedExisting, ...newTaggablePhotos];
    setReceivingPhotos(allPhotos);
    await saveReceivingPhotosToShipment(allPhotos);
  }, [receivingPhotos, saveReceivingPhotosToShipment]);

  // Cleanup draft shipment if the user abandons the page.
  useEffect(() => {
    return () => {
      void cleanupDraftShipment();
    };
  }, [cleanupDraftShipment]);

  // Pull default shipment notes from Account Settings (accounts.default_shipment_notes)
  useEffect(() => {
    if (!profile?.tenant_id || !accountId) {
      setAccountDefaultShipmentNotes(null);
      setAccountHighlightShipmentNotes(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      const { data, error } = await (supabase.from('accounts') as any)
        .select('default_shipment_notes, highlight_shipment_notes')
        .eq('tenant_id', profile.tenant_id)
        .eq('id', accountId)
        .single();

      if (cancelled) return;
      if (error) {
        console.warn('[OutboundCreate] Failed to load account default shipment notes:', error.message);
        setAccountDefaultShipmentNotes(null);
        setAccountHighlightShipmentNotes(false);
        return;
      }

      setAccountDefaultShipmentNotes((data?.default_shipment_notes as string | null) ?? null);
      setAccountHighlightShipmentNotes(!!data?.highlight_shipment_notes);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [profile?.tenant_id, accountId]);

  // Prefill notes if blank and user hasn't typed anything yet
  useEffect(() => {
    if (!accountId) return;
    if (notesTouched) return;
    if (notes.trim()) return;
    if (!accountDefaultShipmentNotes?.trim()) return;
    setNotes(accountDefaultShipmentNotes);
  }, [accountId, notesTouched, notes, accountDefaultShipmentNotes]);
  // ------------------------------------------
  // Fetch reference data
  // ------------------------------------------
  useEffect(() => {
    if (!profile?.tenant_id) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch accounts
        const accountsRes = await (supabase.from('accounts') as any)
          .select('id, account_name, account_code')
          .eq('tenant_id', profile.tenant_id)
          .is('deleted_at', null)
          .order('account_name');

        // Fetch warehouses
        const warehousesRes = await (supabase.from('warehouses') as any)
          .select('id, name')
          .eq('tenant_id', profile.tenant_id)
          .is('deleted_at', null)
          .order('name');

        if (accountsRes.error) {
          console.error('[OutboundCreate] accounts fetch:', accountsRes.error);
        }
        if (warehousesRes.error) {
          console.error('[OutboundCreate] warehouses fetch:', warehousesRes.error);
        }

        setAccounts(accountsRes.data || []);
        setWarehouses(warehousesRes.data || []);

        // Set default warehouse if only one exists
        if (warehousesRes.data?.length === 1) {
          setWarehouseId(warehousesRes.data[0].id);
        }

        // Set default outbound type (Will Call)
        // This will be set after outbound types load
      } catch (err) {
        console.error('[OutboundCreate] fetchData exception:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [profile?.tenant_id]);

  // Set default outbound type when types load
  useEffect(() => {
    if (outboundTypes.length > 0 && !outboundTypeId) {
      const willCall = outboundTypes.find(t => t.name === 'Will Call');
      setOutboundTypeId(willCall?.id || outboundTypes[0].id);
    }
  }, [outboundTypes, outboundTypeId]);

  // Convert to SelectOption arrays
  const accountOptions: SelectOption[] = useMemo(
    () => accounts.map(a => ({
      value: a.id,
      label: a.account_name,
      subtitle: a.account_code || undefined,
    })),
    [accounts]
  );

  const selectedAccountName = useMemo(
    () => accounts.find((a) => a.id === accountId)?.account_name || '',
    [accounts, accountId]
  );

  const warehouseOptions: SelectOption[] = useMemo(
    () => warehouses.map(w => ({ value: w.id, label: w.name })),
    [warehouses]
  );

  const outboundTypeOptions: SelectOption[] = useMemo(
    () => outboundTypes.map(t => ({ value: t.id, label: t.name })),
    [outboundTypes]
  );

  const sidemarkOptions: SelectOption[] = useMemo(
    () => sidemarks.map(s => ({
      value: s.id,
      label: s.sidemark_name,
      subtitle: s.sidemark_code || undefined,
    })),
    [sidemarks]
  );

  const derivedReleaseType = useMemo(() => {
    const selectedType = outboundTypes.find((t) => t.id === outboundTypeId);
    return deriveLegacyReleaseTypeFromOutboundTypeName(selectedType?.name);
  }, [outboundTypeId, outboundTypes]);

  // Filter items by search
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return accountItems;
    const query = searchQuery.toLowerCase();
    return accountItems.filter(item =>
      item.item_code?.toLowerCase().includes(query) ||
      item.description?.toLowerCase().includes(query) ||
      item.vendor?.toLowerCase().includes(query) ||
      item.location?.code?.toLowerCase().includes(query) ||
      item.sidemark?.sidemark_name?.toLowerCase().includes(query) ||
      item.room?.toLowerCase().includes(query)
    );
  }, [accountItems, searchQuery]);

  const availableQtyById = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of accountItems as any[]) {
      const qty = typeof item?.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : 1;
      if (typeof item?.id === 'string') {
        map.set(item.id, qty);
      }
    }
    return map;
  }, [accountItems]);

  const getRequestedQty = useCallback((itemId: string): number => {
    const available = availableQtyById.get(itemId) ?? 1;
    const raw = requestedQtyByItemId[itemId];
    const qty = typeof raw === 'number' && Number.isFinite(raw) ? raw : available;
    // Clamp within [1, available]
    return Math.max(1, Math.min(available, qty));
  }, [availableQtyById, requestedQtyByItemId]);

  // Keep requested qty map hydrated for selected items (including pre-selected)
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

  // ------------------------------------------
  // Item selection handlers
  // ------------------------------------------
  const toggleItemSelection = (itemId: string) => {
    const newSet = new Set(selectedItemIds);
    if (newSet.has(itemId)) {
      newSet.delete(itemId);
      // Optional cleanup: keep the map small (safe to rehydrate later)
      setRequestedQtyByItemId((prev) => {
        if (prev[itemId] == null) return prev;
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
    } else {
      newSet.add(itemId);
      // Default requested qty to the full available qty
      setRequestedQtyByItemId((prev) => {
        if (prev[itemId] != null) return prev;
        const next = { ...prev };
        next[itemId] = availableQtyById.get(itemId) ?? 1;
        return next;
      });
    }
    setSelectedItemIds(newSet);
    if (errors.items) {
      setErrors({ ...errors, items: undefined });
    }
  };

  const selectAllItems = () => {
    const allIds = new Set(filteredItems.map(item => item.id));
    setSelectedItemIds(allIds);
    if (errors.items) {
      setErrors({ ...errors, items: undefined });
    }
  };

  const deselectAllItems = () => {
    setSelectedItemIds(new Set());
  };

  // ------------------------------------------
  // Validation
  // ------------------------------------------
  const validate = (): boolean => {
    const newErrors: FormErrors = {};

    if (!accountId) {
      newErrors.account = 'Please select an account';
    }
    if (!warehouseId) {
      newErrors.warehouse = 'Please select a warehouse';
    }
    if (!outboundTypeId) {
      newErrors.outbound_type = 'Please select an outbound type';
    }
    if (selectedItemIds.size === 0) {
      newErrors.items = 'Please select at least one item';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // ------------------------------------------
  // Submit handler
  // ------------------------------------------
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!profile?.tenant_id || !profile?.id) {
      toast({ variant: 'destructive', title: 'Error', description: 'Not authenticated' });
      return;
    }

    if (!validate()) {
      toast({ variant: 'destructive', title: 'Validation Error', description: 'Please fix the errors below' });
      return;
    }

    if (!draftShipmentId) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Outbound shipment draft not ready yet. Please wait a moment and try again.',
      });
      return;
    }

    setSaving(true);

    try {
      const itemIds = Array.from(selectedItemIds);
      let publicNotesForSave = notes.trim();
      let internalNotesForSave = internalNotes.trim();

      if (draftShipmentId && profile?.tenant_id) {
        const { data: unifiedRows, error: unifiedFetchError } = await (supabase.from('notes') as any)
          .select('note, note_type')
          .eq('tenant_id', profile.tenant_id)
          .eq('source_entity_type', 'shipment')
          .eq('source_entity_id', draftShipmentId)
          .is('deleted_at', null)
          .is('parent_note_id', null)
          .in('note_type', ['public', 'internal'])
          .order('updated_at', { ascending: false });

        if (unifiedFetchError) {
          console.warn('[OutboundCreate] failed loading unified shipment notes for submit:', unifiedFetchError.message);
        } else {
          const latestPublic = (unifiedRows || []).find((row: any) => row.note_type === 'public');
          const latestInternal = (unifiedRows || []).find((row: any) => row.note_type === 'internal');
          publicNotesForSave = (latestPublic?.note || publicNotesForSave || '').trim();
          internalNotesForSave = (latestInternal?.note || internalNotesForSave || '').trim();
        }
      }

      const syncLegacyShipmentNote = async (
        rawText: string,
        noteType: 'public' | 'internal',
        legacyField: 'shipments.notes' | 'shipments.receiving_notes'
      ) => {
        const trimmed = rawText.trim();
        if (!trimmed || !draftShipmentId) return;

        const { data: existingRows, error: existingError } = await (supabase.from('notes') as any)
          .select('id, note, note_type, metadata')
          .eq('tenant_id', profile.tenant_id)
          .eq('source_entity_type', 'shipment')
          .eq('source_entity_id', draftShipmentId)
          .eq('note_type', noteType)
          .is('parent_note_id', null)
          .is('deleted_at', null)
          .order('created_at', { ascending: true });

        if (existingError) {
          console.warn('[OutboundCreate] failed to query existing unified notes:', existingError.message);
        }

        const existing = (existingRows || []).find((row: any) => row?.metadata?.legacy_field === legacyField);
        if (existing?.id) {
          if ((existing.note || '').trim() === trimmed) return;
          const { error: updateNoteError } = await (supabase.from('notes') as any)
            .update({ note: trimmed, updated_at: new Date().toISOString() })
            .eq('id', existing.id);
          if (updateNoteError) {
            console.warn('[OutboundCreate] failed to update unified legacy note mirror:', updateNoteError.message);
          }
          return;
        }

        const duplicate = (existingRows || []).some(
          (row: any) =>
            typeof row?.note === 'string' &&
            row.note.trim() === trimmed &&
            row.note_type === noteType
        );
        if (duplicate) return;

        const { error: createNoteError } = await (supabase as any).rpc('create_unified_note', {
          p_entity_type: 'shipment',
          p_entity_id: draftShipmentId,
          p_note_text: trimmed,
          p_note_type: noteType,
          p_source_entity_number: draftShipmentNumber || null,
          p_metadata: {
            source: 'outbound_create',
            legacy_field: legacyField,
          },
        });
        if (createNoteError) {
          console.warn('[OutboundCreate] failed to mirror note into unified notes:', createNoteError.message);
        }
      };

      // 1) Fetch existing items so retries are idempotent (and can reconcile deselections)
      const { data: existingItems, error: existingError } = await (supabase.from('shipment_items') as any)
        .select('item_id')
        .eq('shipment_id', draftShipmentId);

      if (existingError) throw existingError;
      const existingItemIds: string[] = (Array.isArray(existingItems) ? existingItems : [])
        .map((r: any) => r?.item_id)
        .filter((v: any) => typeof v === 'string');

      const removedItemIds = existingItemIds.filter((id) => !selectedItemIds.has(id));

      // 2) Update the draft shipment details (keep it soft-deleted until everything succeeds)
      const { error: updateError } = await (supabase.from('shipments') as any)
        .update({
          account_id: accountId,
          warehouse_id: warehouseId,
          outbound_type_id: outboundTypeId,
          sidemark_id: sidemarkId || null,
          expected_arrival_date: expectedDate || null,
          notes: publicNotesForSave || null,
          receiving_notes: internalNotesForSave || null,
          // Legacy field: derived from current outbound type
          release_type: derivedReleaseType,
          released_to: releasedTo.trim() || null,
          driver_name: releasedTo.trim() || null,
          // Keep legacy contact fields in sync (used by older release flows)
          release_to_name: releasedTo.trim() || null,
          release_to_email: releaseToEmail.trim() || null,
          release_to_phone: releaseToPhone.trim() || null,
          customer_authorized: customerAuthorized,
          customer_authorized_at: customerAuthorized ? new Date().toISOString() : null,
          customer_authorized_by: customerAuthorized ? profile.id : null,
          carrier: carrier.trim() || null,
          tracking_number: trackingNumber.trim() || null,
          po_number: poNumber.trim() || null,
        })
        .eq('id', draftShipmentId);

      if (updateError) throw updateError;

      // 3) Replace shipment_items to exactly match the current selection
      const { error: deleteItemsError } = await (supabase.from('shipment_items') as any)
        .delete()
        .eq('shipment_id', draftShipmentId);
      if (deleteItemsError) throw deleteItemsError;

      const toInsert = itemIds.map((item_id) => ({
        shipment_id: draftShipmentId,
        item_id,
        expected_quantity: getRequestedQty(item_id),
        status: 'pending',
      }));

      if (toInsert.length > 0) {
        const { error: insertError } = await (supabase.from('shipment_items') as any).insert(toInsert);
        if (insertError) throw insertError;
      }

      // 4) Best-effort: un-allocate items removed from the draft selection
      if (removedItemIds.length > 0) {
        const { error: deallocateError } = await (supabase.from('items') as any)
          .update({ status: 'stored' })
          .in('id', removedItemIds)
          .eq('status', 'allocated');
        if (deallocateError) throw deallocateError;
      }

      // 5) Finalize the draft by un-deleting it before allocating inventory
      const { error: finalizeError } = await (supabase.from('shipments') as any)
        .update({ deleted_at: null })
        .eq('id', draftShipmentId);
      if (finalizeError) throw finalizeError;

      await syncLegacyShipmentNote(publicNotesForSave, 'public', 'shipments.notes');
      await syncLegacyShipmentNote(internalNotesForSave, 'internal', 'shipments.receiving_notes');

      // 5b) Activity log: items linked/unlinked to shipment
      // Do this after finalize so activity doesn't point to a "hidden" draft.
      try {
        const shipmentNumberForLog = draftShipmentNumber || 'OUT';

        // Resolve item codes in one query (best-effort)
        const itemCodeMap = new Map<string, string>();
        if (itemIds.length > 0) {
          const { data: itemRows } = await (supabase.from('items') as any)
            .select('id, item_code')
            .in('id', itemIds);
          (itemRows || []).forEach((r: any) => {
            if (r?.id && r?.item_code) itemCodeMap.set(r.id, r.item_code);
          });
        }

        // Linked (selected items)
        void Promise.allSettled(
          itemIds.map((iid) =>
            logActivity({
              entityType: 'item',
              tenantId: profile.tenant_id,
              entityId: iid,
              actorUserId: profile.id,
              eventType: 'item_shipment_linked',
              eventLabel: `Added to outbound shipment ${shipmentNumberForLog}`,
              details: {
                shipment_id: draftShipmentId,
                shipment_number: shipmentNumberForLog,
                shipment_type: 'outbound',
                item_code: itemCodeMap.get(iid) || null,
              },
            })
          )
        );

        // Unlinked (deselected items)
        if (removedItemIds.length > 0) {
          void Promise.allSettled(
            removedItemIds.map((iid) =>
              logActivity({
                entityType: 'item',
                tenantId: profile.tenant_id,
                entityId: iid,
                actorUserId: profile.id,
                eventType: 'item_shipment_unlinked',
                eventLabel: `Removed from outbound shipment ${shipmentNumberForLog}`,
                details: {
                  shipment_id: draftShipmentId,
                  shipment_number: shipmentNumberForLog,
                  shipment_type: 'outbound',
                },
              })
            )
          );
        }

        // Shipment-level activity (selected items)
        void Promise.allSettled(
          itemIds.map((iid) =>
            logActivity({
              entityType: 'shipment',
              tenantId: profile.tenant_id,
              entityId: draftShipmentId,
              actorUserId: profile.id,
              eventType: 'item_added',
              eventLabel: `Item ${itemCodeMap.get(iid) || iid} added`,
              details: { item_id: iid, item_code: itemCodeMap.get(iid) || null },
            })
          )
        );
      } catch {
        // Non-blocking: activity logging must not break shipment creation
      }

      // 5c) If any selected items are grouped (qty > 1) AND the requested qty is partial,
      // create a blocking Split task per item and queue an internal alert.
      //
      // Internal users always follow the split-required workflow (no toggle).
      const splitCandidates = itemIds
        .map((item_id) => {
          const available = availableQtyById.get(item_id) ?? 1;
          const requested = getRequestedQty(item_id);
          return {
            item_id,
            available,
            requested,
            leftover: Math.max(0, available - requested),
          };
        })
        .filter((r) => r.available > 1 && r.requested < r.available);

      if (splitCandidates.length > 0) {
        const requestNotes = [
          publicNotesForSave ? `Customer notes:\n${publicNotesForSave}` : '',
          internalNotesForSave ? `Internal notes:\n${internalNotesForSave}` : '',
        ]
          .filter(Boolean)
          .join('\n\n');

        const splitTaskIds: string[] = [];
        const splitItemsForMeta: any[] = [];

        for (const c of splitCandidates) {
          const { data: itemRow, error: itemErr } = await (supabase.from('items') as any)
            .select('id, item_code, quantity, current_location')
            .eq('id', c.item_id)
            .maybeSingle();
          if (itemErr || !itemRow?.id) throw itemErr || new Error('Item not found');

          const groupedQty = typeof itemRow.quantity === 'number' && Number.isFinite(itemRow.quantity) ? itemRow.quantity : c.available;
          const keepQty = c.requested;
          const leftoverQty = Math.max(0, groupedQty - keepQty);

          // Idempotency: if a split task already exists for this shipment+item, reuse it.
          const { data: existingSplitTask } = await (supabase.from('tasks') as any)
            .select('id')
            .eq('tenant_id', profile.tenant_id)
            .eq('task_type', 'Split')
            .contains('metadata', {
              split_workflow: {
                origin_entity_type: 'shipment',
                origin_entity_id: draftShipmentId,
                parent_item_id: c.item_id,
              },
            })
            .in('status', ['pending', 'in_progress'])
            .limit(1)
            .maybeSingle();

          let splitTaskId: string | null = existingSplitTask?.id || null;

          if (!splitTaskId) {
            const nowIso = new Date().toISOString();
            const title = draftShipmentNumber
              ? `Split - ${itemRow.item_code} (for ${draftShipmentNumber})`
              : `Split - ${itemRow.item_code}`;

            const description = [
              `Split required for grouped item ${itemRow.item_code}.`,
              `Keep qty on parent label: ${keepQty} (of ${groupedQty}).`,
              `Leftover qty to relabel: ${leftoverQty}.`,
              '',
              'Instructions:',
              `- Scan the parent item code (${itemRow.item_code}) before splitting.`,
              `- Parent label stays on the job; parent quantity will be set to ${keepQty}.`,
              `- Leftover items get NEW child labels and should be placed in the default receiving location (unless overridden).`,
              '- Print and attach ALL new labels, then scan each new child label to confirm application.',
              requestNotes ? `\n${requestNotes}` : '',
            ]
              .filter(Boolean)
              .join('\n');

            const { data: newTask, error: taskErr } = await (supabase.from('tasks') as any)
              .insert({
                tenant_id: profile.tenant_id,
                account_id: accountId || null,
                warehouse_id: warehouseId || null,
                related_item_id: c.item_id,
                task_type: 'Split',
                title,
                description,
                priority: 'urgent',
                status: 'pending',
                assigned_department: 'warehouse',
                metadata: {
                  split_workflow: {
                    origin_entity_type: 'shipment',
                    origin_entity_id: draftShipmentId,
                    origin_entity_number: draftShipmentNumber,
                    parent_item_id: c.item_id,
                    parent_item_code: itemRow.item_code,
                    grouped_qty: groupedQty,
                    keep_qty: keepQty,
                    leftover_qty: leftoverQty,
                    requested_by_user_id: profile.id,
                    requested_by_name: 'Internal user',
                    requested_by_email: null,
                    request_notes: requestNotes || null,
                    created_at: nowIso,
                  },
                } as Json,
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
              parent_item_code: itemRow.item_code,
              grouped_qty: groupedQty,
              keep_qty: keepQty,
              leftover_qty: leftoverQty,
              current_location: itemRow.current_location || null,
              split_task_id: splitTaskId,
            });

            // Notify office/warehouse (email + optional in-app configured by tenant)
            void queueSplitRequiredAlert(profile.tenant_id, splitTaskId, itemRow.item_code);
          }
        }

        // Mark the shipment as blocked by split-required tasks
        const { data: existingShipmentRow, error: shipmentMetaErr } = await (supabase.from('shipments') as any)
          .select('metadata')
          .eq('id', draftShipmentId)
          .maybeSingle();
        if (shipmentMetaErr) throw shipmentMetaErr;

        const existingMeta = existingShipmentRow?.metadata && typeof existingShipmentRow.metadata === 'object'
          ? existingShipmentRow.metadata
          : {};

        const nextMeta = {
          ...(existingMeta as any),
          split_required: true,
          split_required_task_ids: splitTaskIds,
          split_required_items: splitItemsForMeta,
          split_required_created_at: new Date().toISOString(),
        };

        const { error: splitMetaUpdateErr } = await (supabase.from('shipments') as any)
          .update({ metadata: nextMeta as Json })
          .eq('id', draftShipmentId);
        if (splitMetaUpdateErr) throw splitMetaUpdateErr;
      }

      // 6) Mark selected items as allocated (after the shipment is visible)
      if (itemIds.length > 0) {
        const { error: allocateError } = await (supabase.from('items') as any)
          .update({ status: 'allocated' })
          .in('id', itemIds);
        if (allocateError) throw allocateError;
      }

      toast({
        title: 'Outbound Shipment Created',
        description: draftShipmentNumber ? `Shipment ${draftShipmentNumber} created.` : 'Outbound shipment created.',
      });

      draftFinalizedRef.current = true;
      navigate(`/shipments/${draftShipmentId}`);
    } catch (err: any) {
      console.error('[OutboundCreate] submit error:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err.message || 'Failed to create outbound shipment',
      });
    } finally {
      setSaving(false);
    }
  };

  // ------------------------------------------
  // Loading state
  // ------------------------------------------
  if (loading || typesLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <MaterialIcon name="progress_activity" size="xl" className="animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="container mx-auto max-w-4xl px-4 pb-safe">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6 pt-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="shrink-0">
            <MaterialIcon name="arrow_back" size="md" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl font-bold truncate flex items-center gap-2">
              Create Outbound Shipment
              <Badge variant="outline" className="font-mono whitespace-nowrap">
                {draftCreating ? 'Generating…' : (draftShipmentNumber || '—')}
              </Badge>
            </h1>
            <p className="text-sm text-muted-foreground">Select items to ship out</p>
          </div>
          <HelpButton workflow="outbound" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Shipment Details */}
          <Card>
            <CardHeader>
              <CardTitle>Shipment Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Account */}
              <div className="space-y-1.5">
                <Label>
                  Account <span className="text-destructive">*</span>
                </Label>
                <SearchableSelect
                  data-testid="account-select"
                  options={accountOptions}
                  value={accountId}
                  onChange={(v) => {
                    setAccountId(v);
                    setSidemarkId('');
                    setSelectedItemIds(new Set()); // Clear selection when account changes
                    setNotes('');
                    setNotesTouched(false);
                    setInternalNotes('');
                    if (errors.account) setErrors({ ...errors, account: undefined });
                  }}
                  placeholder="Select account..."
                  searchPlaceholder="Search accounts..."
                  emptyText="No accounts found"
                  recentKey="outbound-accounts"
                  error={errors.account}
                />
              </div>

              {/* Outbound Type & Warehouse - side by side */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>
                    Outbound Type <span className="text-destructive">*</span>
                  </Label>
                  <SearchableSelect
                    data-testid="outbound-type-select"
                    options={outboundTypeOptions}
                    value={outboundTypeId}
                    onChange={(v) => {
                      setOutboundTypeId(v);
                      if (errors.outbound_type) setErrors({ ...errors, outbound_type: undefined });
                    }}
                    placeholder="Select type..."
                    searchPlaceholder="Search types..."
                    emptyText="No types found"
                    error={errors.outbound_type}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>
                    Warehouse <span className="text-destructive">*</span>
                  </Label>
                  <SearchableSelect
                    data-testid="warehouse-select"
                    options={warehouseOptions}
                    value={warehouseId}
                    onChange={(v) => {
                      setWarehouseId(v);
                      if (errors.warehouse) setErrors({ ...errors, warehouse: undefined });
                    }}
                    placeholder="Select warehouse..."
                    searchPlaceholder="Search warehouses..."
                    emptyText="No warehouses found"
                    error={errors.warehouse}
                  />
                </div>
              </div>

              {/* Sidemark (filtered by account) */}
              {accountId && (
                <div className="space-y-1.5">
                  <Label>Sidemark / Project</Label>
                  <SearchableSelect
                    options={sidemarkOptions}
                    value={sidemarkId}
                    onChange={setSidemarkId}
                    placeholder={sidemarksLoading ? 'Loading...' : 'Select sidemark (optional)...'}
                    searchPlaceholder="Search sidemarks..."
                    emptyText="No sidemarks for this account"
                    disabled={sidemarksLoading}
                    clearable
                  />
                </div>
              )}

              {/* Legacy outbound release fields (restore) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Carrier</Label>
                  <Input
                    value={carrier}
                    onChange={(e) => setCarrier(e.target.value)}
                    placeholder="e.g., FedEx, UPS, Local Delivery"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Tracking Number</Label>
                  <Input
                    value={trackingNumber}
                    onChange={(e) => setTrackingNumber(e.target.value)}
                    placeholder="Tracking number"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>PO Number</Label>
                  <Input
                    value={poNumber}
                    onChange={(e) => setPoNumber(e.target.value)}
                    placeholder="Purchase order number"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Released To / Driver Name</Label>
                  <Input
                    value={releasedTo}
                    onChange={(e) => setReleasedTo(e.target.value)}
                    placeholder="Name of person picking up / driver"
                  />
                  <p className="text-xs text-muted-foreground">
                    Required before completing the release (signature step will also ask).
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Release Contact Phone</Label>
                  <Input
                    value={releaseToPhone}
                    onChange={(e) => setReleaseToPhone(e.target.value)}
                    placeholder="(555) 555-5555"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Release Contact Email</Label>
                <Input
                  type="email"
                  value={releaseToEmail}
                  onChange={(e) => setReleaseToEmail(e.target.value)}
                  placeholder="email@example.com"
                />
              </div>

              <div className="flex items-start space-x-3 p-3 rounded-md border bg-muted/30">
                <Checkbox
                  id="customer-authorized"
                  checked={customerAuthorized}
                  onCheckedChange={(checked) => setCustomerAuthorized(checked === true)}
                  className="mt-1"
                />
                <div>
                  <Label htmlFor="customer-authorized" className="cursor-pointer font-medium">
                    Customer Authorized
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Mark when the client has approved this outbound request (portal, email, or phone).
                  </p>
                </div>
              </div>

              {/* Expected Date */}
              <div className="space-y-1.5">
                <Label>Expected Pickup/Ship Date</Label>
                <Input
                  type="date"
                  value={expectedDate}
                  onChange={(e) => setExpectedDate(e.target.value)}
                />
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label>Notes</Label>
                {!draftShipmentId && accountHighlightShipmentNotes && accountDefaultShipmentNotes?.trim() && (
                  <div className="rounded-md border border-orange-200 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20 p-3 text-sm text-orange-900 dark:text-orange-100">
                    <div className="font-medium mb-1">Default Shipment Notes</div>
                    <p className="whitespace-pre-wrap">{accountDefaultShipmentNotes}</p>
                  </div>
                )}
                <Tabs defaultValue="public" className="w-full">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="public">Public</TabsTrigger>
                    <TabsTrigger value="internal">Internal</TabsTrigger>
                    <TabsTrigger value="exceptions" className="gap-2">
                      Exceptions
                      {draftOpenExceptionCount > 0 && (
                        <Badge variant="destructive" className="h-5 min-w-5 text-xs">
                          {draftOpenExceptionCount}
                        </Badge>
                      )}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="public" className="mt-2 space-y-2">
                    {draftShipmentId ? (
                      <ShipmentNotesSection
                        shipmentId={draftShipmentId}
                        accountId={accountId || null}
                        embedded
                        forcedNoteType="public"
                      />
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground">
                          Public notes are visible to the client in the portal.
                        </p>
                        <Textarea
                          value={notes}
                          onChange={(e) => {
                            setNotesTouched(true);
                            setNotes(e.target.value);
                          }}
                          placeholder="Add public notes..."
                          rows={3}
                        />
                      </>
                    )}
                  </TabsContent>
                  <TabsContent value="internal" className="mt-2 space-y-2">
                    {draftShipmentId ? (
                      <ShipmentNotesSection
                        shipmentId={draftShipmentId}
                        accountId={accountId || null}
                        embedded
                        forcedNoteType="internal"
                      />
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground">
                          Internal notes are visible to staff only.
                        </p>
                        <Textarea
                          value={internalNotes}
                          onChange={(e) => setInternalNotes(e.target.value)}
                          placeholder="Add internal notes..."
                          rows={3}
                        />
                      </>
                    )}
                  </TabsContent>
                  <TabsContent value="exceptions" className="mt-2">
                    {draftShipmentId ? (
                      <div className="space-y-3">
                        <ShipmentNotesSection
                          shipmentId={draftShipmentId}
                          accountId={accountId || null}
                          embedded
                          forcedNoteType="exception"
                        />
                        <ShipmentExceptionsChips shipmentId={draftShipmentId} />
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground py-2">
                        Creating draft shipment…
                      </p>
                    )}
                  </TabsContent>
                </Tabs>
              </div>
            </CardContent>
          </Card>

          {/* Photos (match intake shipment page) */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <MaterialIcon name="photo_camera" size="sm" />
                  Photos
                  <Badge variant="outline">{getPhotoUrls(receivingPhotos).length}</Badge>
                </CardTitle>
                <CardDescription>Capture or upload photos (paperwork, condition, etc.).</CardDescription>
              </div>
              <div className="flex gap-2">
                <PhotoScannerButton
                  entityType="shipment"
                  entityId={draftShipmentId || undefined}
                  tenantId={profile?.tenant_id}
                  existingPhotos={getPhotoUrls(receivingPhotos)}
                  maxPhotos={20}
                  size="sm"
                  label="Add"
                  showCount={false}
                  onPhotosSaved={async (urls) => {
                    try {
                      await mergeAndSaveReceivingPhotoUrls(urls);
                    } catch (err: any) {
                      toast({
                        variant: 'destructive',
                        title: 'Photo Error',
                        description: err?.message || 'Failed to save photos',
                      });
                    }
                  }}
                />
                <PhotoUploadButton
                  entityType="shipment"
                  entityId={draftShipmentId || undefined}
                  tenantId={profile?.tenant_id}
                  existingPhotos={getPhotoUrls(receivingPhotos)}
                  maxPhotos={20}
                  size="sm"
                  onPhotosSaved={async (urls) => {
                    try {
                      await mergeAndSaveReceivingPhotoUrls(urls);
                    } catch (err: any) {
                      toast({
                        variant: 'destructive',
                        title: 'Photo Error',
                        description: err?.message || 'Failed to save photos',
                      });
                    }
                  }}
                />
              </div>
            </CardHeader>
            <CardContent>
              {getPhotoUrls(receivingPhotos).length > 0 ? (
                <TaggablePhotoGrid
                  photos={receivingPhotos}
                  enableTagging={true}
                  onPhotosChange={async (photos) => {
                    try {
                      await saveReceivingPhotosToShipment(photos);
                    } catch (err: any) {
                      toast({
                        variant: 'destructive',
                        title: 'Photo Error',
                        description: err?.message || 'Failed to save photos',
                      });
                    }
                  }}
                />
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No photos yet.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Documents (match intake shipment page) */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MaterialIcon name="description" size="sm" />
                Documents
                <Badge variant="outline">{documents.length}</Badge>
              </CardTitle>
              <CardDescription>
                Capture or upload delivery paperwork and supporting outbound documents.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {draftShipmentId ? (
                <DocumentCapture
                  context={{ type: 'shipment', shipmentId: draftShipmentId }}
                  maxDocuments={12}
                  ocrEnabled={true}
                  onDocumentAdded={() => {
                    void refetchDocuments();
                  }}
                  onDocumentRemoved={() => {
                    void refetchDocuments();
                  }}
                />
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Creating draft shipment…
                </p>
              )}
            </CardContent>
          </Card>

          {/* Items Selection */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="text-lg">Select Items</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedItemIds.size} item{selectedItemIds.size !== 1 ? 's' : ''} selected
                </p>
              </div>
              {accountId && accountItems.length > 0 && (
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
              {!accountId ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <MaterialIcon name="inventory_2" size="xl" className="text-muted-foreground mb-2" />
                  <p className="text-muted-foreground">Select an account to view available items</p>
                </div>
              ) : itemsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
                </div>
              ) : accountItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <MaterialIcon name="error" size="xl" className="text-muted-foreground mb-2" />
                  <p className="text-muted-foreground">No available items for this account</p>
                  <p className="text-sm text-muted-foreground">Items must be in storage to be shipped</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Search + view */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[220px]">
                      <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search items..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <Select
                        value={activeItemViewId || defaultItemViewId || 'default'}
                        onValueChange={setActiveItemViewId}
                        disabled={itemDisplayLoading || itemDisplaySettings.views.length === 0}
                      >
                        <SelectTrigger className="w-[140px] sm:w-[180px] h-10">
                          <div className="flex items-center gap-2">
                            <MaterialIcon name="view_list" size="sm" className="text-muted-foreground" />
                            <SelectValue placeholder="View" />
                          </div>
                        </SelectTrigger>
                        <SelectContent>
                          {itemDisplaySettings.views.map((v) => (
                            <SelectItem key={v.id} value={v.id}>
                              {v.name}
                              {v.is_default ? ' (default)' : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <ItemColumnsPopover
                        settings={itemDisplaySettings}
                        baseSettings={tenantItemDisplaySettings}
                        viewId={activeItemViewId || defaultItemViewId || 'default'}
                        disabled={itemDisplayLoading || itemDisplaySaving || itemDisplaySettings.views.length === 0}
                        onSave={saveItemDisplaySettings}
                      />
                    </div>
                  </div>

                  {/* Error message */}
                  {errors.items && (
                    <p className="text-sm text-destructive">{errors.items}</p>
                  )}

                  {/* Items table */}
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12"></TableHead>
                          {outboundItemVisibleColumns.map((col) => (
                            <TableHead
                              key={col}
                              className={
                                col === 'quantity' || col === 'size'
                                  ? 'text-right'
                                  : col === 'photo'
                                  ? 'w-12'
                                  : undefined
                              }
                            >
                              {getColumnLabel(itemDisplaySettings, col)}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredItems.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={1 + outboundItemVisibleColumns.length} className="text-center py-8 text-muted-foreground">
                              No items match your search
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredItems.map((item) => (
                            <TableRow
                              key={item.id}
                              className="cursor-pointer hover:bg-muted/50"
                              onClick={() => toggleItemSelection(item.id)}
                            >
                              <TableCell>
                                <input
                                  type="checkbox"
                                  checked={selectedItemIds.has(item.id)}
                                  onChange={() => toggleItemSelection(item.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-4 w-4 rounded border border-primary accent-primary cursor-pointer"
                                />
                              </TableCell>
                              {outboundItemVisibleColumns.map((col) => {
                                const cfKey = parseCustomFieldColumnKey(col);
                                if (cfKey) {
                                  const meta = (item as any).metadata;
                                  const custom = meta && typeof meta === 'object' ? (meta as any).custom_fields : null;
                                  const raw = custom && typeof custom === 'object' ? (custom as any)[cfKey] : null;
                                  const display = raw === null || raw === undefined || raw === '' ? '-' : String(raw);
                                  return <TableCell key={col} className="max-w-[180px] truncate">{display}</TableCell>;
                                }

                                switch (col as BuiltinItemColumnKey) {
                                  case 'photo': {
                                    const url = (item as any).primary_photo_url as string | null | undefined;
                                    const node = url ? (
                                      <img src={url} alt={item.item_code} className="h-8 w-8 rounded object-cover" />
                                    ) : (
                                      <div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-sm">📦</div>
                                    );
                                    return (
                                      <TableCell key={col} className="w-12" onClick={(e) => e.stopPropagation()}>
                                        <ItemPreviewCard itemId={item.id}>{node}</ItemPreviewCard>
                                      </TableCell>
                                    );
                                  }
                                  case 'item_code':
                                    return <TableCell key={col} className="font-medium">{item.item_code}</TableCell>;
                                  case 'sku':
                                    return <TableCell key={col}>{(item as any).sku || '-'}</TableCell>;
                                  case 'quantity': {
                                    const available =
                                      typeof (item as any).quantity === 'number' && Number.isFinite((item as any).quantity)
                                        ? (item as any).quantity
                                        : 1;
                                    const selected = selectedItemIds.has(item.id);

                                    if (!selected) {
                                      return (
                                        <TableCell key={col} className="text-right tabular-nums">
                                          {typeof available === 'number' ? available : '-'}
                                        </TableCell>
                                      );
                                    }

                                    const requested = getRequestedQty(item.id);
                                    const showMax = typeof available === 'number' && available > 1;

                                    return (
                                      <TableCell
                                        key={col}
                                        className="text-right tabular-nums"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <div className="flex items-center justify-end gap-2">
                                          <Input
                                            type="number"
                                            min={1}
                                            max={available}
                                            step={1}
                                            value={requested}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => {
                                              const raw = parseInt(e.target.value || '0', 10);
                                              const next = Number.isFinite(raw) ? raw : 1;
                                              const clamped = Math.max(1, Math.min(available, next));
                                              setRequestedQtyByItemId((prev) => ({ ...prev, [item.id]: clamped }));
                                            }}
                                            className="h-8 w-20 text-right"
                                            aria-label={`Requested quantity for ${item.item_code}`}
                                          />
                                          {showMax && (
                                            <span className="text-xs text-muted-foreground">/ {available}</span>
                                          )}
                                        </div>
                                      </TableCell>
                                    );
                                  }
                                  case 'size':
                                    return <TableCell key={col} className="text-right tabular-nums">{formatItemSize((item as any).size ?? null, (item as any).size_unit ?? null)}</TableCell>;
                                  case 'vendor':
                                    return <TableCell key={col}>{item.vendor || '-'}</TableCell>;
                                  case 'description':
                                    return <TableCell key={col} className="max-w-[240px] truncate">{item.description || '-'}</TableCell>;
                                  case 'location':
                                    return <TableCell key={col}>{item.location?.code || '-'}</TableCell>;
                                  case 'client_account':
                                    return <TableCell key={col}>{selectedAccountName || '-'}</TableCell>;
                                  case 'sidemark':
                                    return <TableCell key={col}>{item.sidemark?.sidemark_name || '-'}</TableCell>;
                                  case 'room':
                                    return <TableCell key={col}>{item.room || '-'}</TableCell>;
                                  case 'received_date':
                                    return <TableCell key={col}>{(item as any).received_at ? format(new Date((item as any).received_at), 'MMM d, yyyy') : '-'}</TableCell>;
                                  default:
                                    return <TableCell key={col}>-</TableCell>;
                                }
                              })}
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
            <Button type="button" variant="outline" onClick={() => navigate(-1)} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="submit"
              data-testid="create-outbound-submit"
              disabled={saving || selectedItemIds.size === 0 || !draftShipmentId}
              className="min-w-[160px]"
            >
              {saving ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <MaterialIcon name="save" size="sm" className="mr-2" />
                  Create Outbound
                </>
              )}
            </Button>
          </div>
        </form>

        {/* Activity (draft shipment timeline) */}
        {draftShipmentId && (
          <div className="pb-6">
            <EntityActivityFeed
              entityType="shipment"
              entityId={draftShipmentId}
              title="Activity"
              description="Timeline of changes to this outbound shipment draft"
            />
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
