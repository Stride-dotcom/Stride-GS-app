import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useReceivingSession } from '@/hooks/useReceivingSession';
import { usePermissions, PERMISSIONS } from '@/hooks/usePermissions';
import { useItemDisplaySettingsForUser } from '@/hooks/useItemDisplaySettingsForUser';
import {
  type ItemColumnKey,
  getColumnLabel,
  getViewById,
  getVisibleColumnsForView,
} from '@/lib/items/itemDisplaySettings';
import { ItemColumnsPopover } from '@/components/items/ItemColumnsPopover';
import { isValidUuid, cn } from '@/lib/utils';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AddAddonDialog } from '@/components/billing/AddAddonDialog';
import { AddCreditDialog } from '@/components/billing/AddCreditDialog';
import { BillingCalculator } from '@/components/billing/BillingCalculator';
import { calculateShipmentBillingPreview } from '@/lib/billing/billingCalculation';
import { ShipmentCoverageDialog } from '@/components/shipments/ShipmentCoverageDialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format } from 'date-fns';
import { DocumentCapture } from '@/components/scanner/DocumentCapture';
import { PhotoScannerButton } from '@/components/common/PhotoScannerButton';
import { PhotoUploadButton } from '@/components/common/PhotoUploadButton';
import { TaggablePhotoGrid, TaggablePhoto, getPhotoUrls } from '@/components/common/TaggablePhotoGrid';
import { PrintLabelsDialog } from '@/components/inventory/PrintLabelsDialog';
import { ItemLabelData } from '@/lib/labelGenerator';
import { AddShipmentItemDialog } from '@/components/shipments/AddShipmentItemDialog';
import { ShipmentItemRow } from '@/components/shipments/ShipmentItemRow';
import { ReassignAccountDialog } from '@/components/common/ReassignAccountDialog';
import { TaskDialog } from '@/components/tasks/TaskDialog';
import { EntityActivityFeed } from '@/components/activity/EntityActivityFeed';
import { SaveButton } from '@/components/ui/SaveButton';
import { SignatureDialog } from '@/components/shipments/SignatureDialog';
import { generateReleasePdf, ReleasePdfData, ReleasePdfItem } from '@/lib/releasePdf';
import { QRScanner } from '@/components/scan/QRScanner';
import { useLocations } from '@/hooks/useLocations';
import { useDocuments } from '@/hooks/useDocuments';
import { hapticError, hapticSuccess } from '@/lib/haptics';
import { parseScanPayload } from '@/lib/scan/parseScanPayload';
import { isLikelyLocationCode as isLikelyLocationCodeUtil } from '@/lib/scan/isLikelyLocationCode';
import { useItemWorkflowScanMode } from '@/lib/scan/modes/useItemWorkflowScanMode';
import { useOrgPreferences } from '@/hooks/useOrgPreferences';
import { HelpButton, usePromptContextSafe } from '@/components/prompts';
import { SOPValidationDialog, SOPBlocker } from '@/components/common/SOPValidationDialog';
import { ShipmentExceptionBadge } from '@/components/shipments/ShipmentExceptionBadge';
import { ShipmentExceptionsChips } from '@/components/shipments/ShipmentExceptionsChips';
import { ShipmentNotesSection } from '@/components/shipments/ShipmentNotesSection';
import {
  MATCHING_DISCREPANCY_CODES,
  SHIPMENT_EXCEPTION_CODE_META,
  useShipmentExceptions,
  type ShipmentExceptionCode,
} from '@/hooks/useShipmentExceptions';
import { createCharges } from '@/services/billing';
import { BILLING_DISABLED_ERROR, getEffectiveRate } from '@/lib/billing/chargeTypeUtils';
import {
  queueAlert,
  queueBillingEventAlert,
  queueShipmentPartialCompletedAlert,
  queueShipmentUnableToCompleteAlert,
} from '@/lib/alertQueue';
import { mergeServiceTimeActualSnapshot, mergeServiceTimeSnapshot } from '@/lib/time/serviceTimeSnapshot';
import { formatMinutesShort } from '@/lib/time/serviceTimeEstimate';
import { minutesBetweenIso } from '@/lib/time/minutesBetweenIso';
import { resolveActiveJobLabel } from '@/lib/time/resolveActiveJobLabel';
import { promptResumePausedTask } from '@/lib/time/promptResumePausedTask';
import { JobTimerWidget } from '@/components/time/JobTimerWidget';
import { ServiceTimeAdjustmentDialog } from '@/components/time/ServiceTimeAdjustmentDialog';
import { timerEndJob, timerStartJob } from '@/lib/time/timerClient';
import { StatusBar } from '@/components/receiving/StatusBar';

// ============================================
// TYPES
// ============================================

interface ShipmentItem {
  id: string;
  expected_description: string | null;
  expected_vendor: string | null;
  expected_sidemark: string | null;
  expected_class_id: string | null;
  expected_quantity: number;
  actual_quantity: number | null;
  status: string;
  item_id: string | null;
  expected_class?: {
    id: string;
    code: string;
    name: string;
  } | null;
  item?: {
    id: string;
    item_code: string;
    quantity?: number | null;
    description: string | null;
    vendor: string | null;
    sidemark: string | null;
    room: string | null;
    class_id: string | null;
    declared_value: number | null;
    coverage_type: string | null;
    current_location?: { code: string } | null;
    account?: { account_name: string } | null;
    class?: { id: string; code: string; name: string } | null;
  } | null;
}

// Type adapter to match ShipmentItemRow expected interface
type ShipmentItemRowData = ShipmentItem & {
  expected_quantity: number | null;
};

// Local type for received item tracking in UI
interface ReceivedItemData {
  shipment_item_id: string;
  expected_description: string | null;
  expected_quantity: number;
  actual_quantity: number;
  expected_vendor: string | null;
  expected_sidemark: string | null;
  expected_item_type_id: string | null;
  notes: string | null;
  status: 'received' | 'partial' | 'missing';
}

type ScanListSortField = 'item_code' | 'location';

interface Shipment {
  id: string;
  shipment_number: string;
  tenant_id: string;
  shipment_type: string;
  status: string;
  account_id: string | null;
  warehouse_id: string | null;
  // Outbound / release (SOP) fields
  customer_authorized: boolean | null;
  customer_authorized_at: string | null;
  customer_authorized_by: string | null;
  driver_name: string | null;
  liability_accepted: boolean | null;
  release_to_name: string | null;
  release_to_email: string | null;
  carrier: string | null;
  tracking_number: string | null;
  po_number: string | null;
  expected_arrival_date: string | null;
  received_at: string | null;
  shipped_at: string | null;
  notes: string | null;
  receiving_notes: string | null;
  receiving_photos: (string | TaggablePhoto)[] | null;
  receiving_documents: string[] | null;
  metadata?: Record<string, any> | null;
  release_type: string | null;
  released_to: string | null;
  release_to_phone: string | null;
  destination_name: string | null;
  origin_name: string | null;
  scheduled_date: string | null;
  sidemark_id: string | null;
  sidemark: string | null;
  signature_data: string | null;
  signature_name: string | null;
  signature_timestamp: string | null;
  created_at: string;
  accounts?: { id: string; account_name: string; account_code: string } | null;
  warehouses?: { id: string; name: string } | null;
}

interface LastScanResult {
  itemCode: string;
  result: 'success' | 'duplicate' | 'invalid' | 'error';
  message: string;
}

// ============================================
// COMPONENT
// ============================================

export default function ShipmentDetail() {
  const { id } = useParams<{ id: string }>();

  // ============================================
  // RENDER-TIME UUID GUARD - executes before any hooks
  // ============================================
  if (!id || !isValidUuid(id)) {
    return <Navigate to="/shipments" replace />;
  }

  // Now we know id is a valid UUID - safe to use hooks
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { toast } = useToast();
  const { hasPermission, hasRole } = usePermissions();
  const { preferences: orgPrefs } = useOrgPreferences();

  // Tenant-managed defaults + per-user overrides for item list views
  const {
    settings: itemDisplaySettings,
    tenantSettings: tenantItemDisplaySettings,
    defaultViewId: defaultItemViewId,
    loading: itemDisplayLoading,
    saving: itemDisplaySaving,
    saveSettings: saveItemDisplaySettings,
  } = useItemDisplaySettingsForUser();

  const activeItemView = useMemo(() => {
    return (
      getViewById(itemDisplaySettings, defaultItemViewId) ||
      itemDisplaySettings.views[0]
    );
  }, [itemDisplaySettings, defaultItemViewId]);

  const shipmentItemVisibleColumns: ItemColumnKey[] = useMemo(
    () => (activeItemView ? getVisibleColumnsForView(activeItemView) : []),
    [activeItemView]
  );
  const shipmentItemsTableColSpan = 2 + shipmentItemVisibleColumns.length + 4; // checkbox + expand + view columns + (class, status, actions, column settings)

  // Only managers and admins can see billing fields
  const canSeeBilling = hasRole('admin') || hasRole('manager') || hasRole('billing_manager');
  const canAdjustServiceTime = hasRole('admin') || hasRole('manager') || hasRole('billing_manager');
  // Only admins and billing managers can add credits
  const canAddCredit = hasRole('admin') || hasRole('billing_manager');

  // State
  const [loading, setLoading] = useState(true);
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [items, setItems] = useState<ShipmentItem[]>([]);
  const [showFinishDialog, setShowFinishDialog] = useState(false);
  const [receivedItems, setReceivedItems] = useState<ReceivedItemData[]>([]);
  const [receivingPhotos, setReceivingPhotos] = useState<(string | TaggablePhoto)[]>([]);
  const [receivingDocuments, setReceivingDocuments] = useState<string[]>([]);
  const [showPrintLabelsDialog, setShowPrintLabelsDialog] = useState(false);
  const [createdItemIds, setCreatedItemIds] = useState<string[]>([]);
  const [createdItemsForLabels, setCreatedItemsForLabels] = useState<ItemLabelData[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [adjustTimeOpen, setAdjustTimeOpen] = useState(false);
  const [editCarrier, setEditCarrier] = useState('');
  const [editTrackingNumber, setEditTrackingNumber] = useState('');
  const [editPoNumber, setEditPoNumber] = useState('');
  const [editExpectedArrival, setEditExpectedArrival] = useState<Date | undefined>(undefined);
  const [editReleaseType, setEditReleaseType] = useState('');
  const [editReleasedTo, setEditReleasedTo] = useState('');
  const [editReleaseToName, setEditReleaseToName] = useState('');
  const [editReleaseToEmail, setEditReleaseToEmail] = useState('');
  const [editReleaseToPhone, setEditReleaseToPhone] = useState('');
  const [editDriverName, setEditDriverName] = useState('');
  const [editDestinationName, setEditDestinationName] = useState('');
  const [editOriginName, setEditOriginName] = useState('');
  const [editScheduledDate, setEditScheduledDate] = useState<Date | undefined>(undefined);
  const [editCustomerAuthorized, setEditCustomerAuthorized] = useState(false);
  const [addAddonDialogOpen, setAddAddonDialogOpen] = useState(false);
  const [addCreditDialogOpen, setAddCreditDialogOpen] = useState(false);
  const [coverageDialogOpen, setCoverageDialogOpen] = useState(false);
  const [addItemDialogOpen, setAddItemDialogOpen] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [showCreateTaskDialog, setShowCreateTaskDialog] = useState(false);
  const [selectedTaskType, setSelectedTaskType] = useState<string>('');
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showDeleteShipmentDialog, setShowDeleteShipmentDialog] = useState(false);
  const [showReassignDialog, setShowReassignDialog] = useState(false);
  const [showOutboundCompleteDialog, setShowOutboundCompleteDialog] = useState(false);
  const [completingOutbound, setCompletingOutbound] = useState(false);
  const [outboundNotesTab, setOutboundNotesTab] = useState<'public' | 'internal' | 'exceptions'>('internal');
  const [missingExceptionNoteCodes, setMissingExceptionNoteCodes] = useState<ShipmentExceptionCode[]>([]);
  const outboundNotesRef = useRef<HTMLDivElement | null>(null);
  const [classes, setClasses] = useState<{ id: string; code: string; name: string }[]>([]);
  const [billingRefreshKey, setBillingRefreshKey] = useState(0);
  const [documentRefreshKey, setDocumentRefreshKey] = useState(0);
  const [pullSessionActive, setPullSessionActive] = useState(false);
  const [releaseSessionActive, setReleaseSessionActive] = useState(false);
  const [outboundTimerConfirmOpen, setOutboundTimerConfirmOpen] = useState(false);
  const [outboundTimerConfirmLoading, setOutboundTimerConfirmLoading] = useState(false);
  const [outboundTimerActiveJobLabel, setOutboundTimerActiveJobLabel] = useState<string | null>(null);
  const [outboundTimerPendingMode, setOutboundTimerPendingMode] = useState<'pull' | 'release' | null>(null);
  const [processingScan, setProcessingScan] = useState(false);
  const [lastScan, setLastScan] = useState<LastScanResult | null>(null);
  const [manualScanValue, setManualScanValue] = useState('');
  const outboundScanBlockRef = useRef<(config: { reason: string; code?: string; title?: string }) => void>(() => {});
  const [manualOverrideItemIds, setManualOverrideItemIds] = useState<Set<string>>(new Set());
  const [showPartialReleaseDialog, setShowPartialReleaseDialog] = useState(false);
  const [partialReleaseNote, setPartialReleaseNote] = useState('');
  const [partialReleaseItems, setPartialReleaseItems] = useState<Set<string>>(new Set());
  const [sopValidationOpen, setSopValidationOpen] = useState(false);
  const [sopBlockers, setSopBlockers] = useState<SOPBlocker[]>([]);
  const [showSignatureDialog, setShowSignatureDialog] = useState(false);
  const [pendingOverrideWarnings, setPendingOverrideWarnings] = useState<SOPBlocker[] | undefined>(undefined);
  const [submittingPartialRelease, setSubmittingPartialRelease] = useState(false);
  const [scanListSortField, setScanListSortField] = useState<ScanListSortField>('location');
  const [scanListSortDirection, setScanListSortDirection] = useState<'asc' | 'desc'>('asc');
  const [legacyContainerUnitLinksEnabled, setLegacyContainerUnitLinksEnabled] = useState(false);

  const { documents, refetch: refetchDocuments } = useDocuments({
    contextType: 'shipment',
    contextId: shipment?.id,
  });

  // Receiving session hook
  const {
    session,
    loading: sessionLoading,
    fetchSession,
    startSession: rawStartSession,
    finishSession: rawFinishSession,
    cancelSession,
  } = useReceivingSession(id);

  const { locations } = useLocations(shipment?.warehouse_id || undefined);
  const { openCount: outboundOpenExceptionCount } = useShipmentExceptions(
    shipment?.shipment_type === 'outbound' ? shipment?.id : undefined
  );

  const normalizeLocationCode = (code?: string | null) =>
    (code || '').toUpperCase().replace(/[_\s]+/g, '-');
  const isOutboundDock = (code?: string | null) => normalizeLocationCode(code) === 'OUTBOUND-DOCK';
  const isReleasedLocation = (code?: string | null) =>
    ['RELEASED', 'RELEASE'].includes(normalizeLocationCode(code));
  const outboundDockLocation = locations.find(location => isOutboundDock(location.code));
  const releasedLocation = locations.find(location => normalizeLocationCode(location.code) === 'RELEASED')
    || locations.find(location => location.type === 'release');

  // Early declaration so hooks below can reference it before the final const block.
  const isOutbound = shipment?.shipment_type === 'outbound';

  useEffect(() => {
    if (!profile?.tenant_id) return;
    let cancelled = false;

    const loadLegacyContainerUnitMode = async () => {
      try {
        const { data } = await (supabase.from('tenant_settings') as any)
          .select('setting_value')
          .eq('tenant_id', profile.tenant_id)
          .eq('setting_key', 'receiving_legacy_inventory_units_enabled')
          .maybeSingle();
        const raw = data?.setting_value;
        const enabled =
          typeof raw === 'boolean'
            ? raw
            : typeof raw === 'string'
              ? raw.trim().toLowerCase() === 'true'
              : false;
        if (!cancelled) setLegacyContainerUnitLinksEnabled(enabled);
      } catch {
        if (!cancelled) setLegacyContainerUnitLinksEnabled(false);
      }
    };

    void loadLegacyContainerUnitMode();
    return () => {
      cancelled = true;
    };
  }, [profile?.tenant_id]);

  const logShipmentAudit = useCallback(async (action: string, changes: Record<string, unknown>) => {
    if (!profile?.tenant_id || !profile?.id || !shipment?.id) return;
    const { error } = await (supabase.from('admin_audit_log') as any).insert({
      action,
      actor_id: profile.id,
      tenant_id: profile.tenant_id,
      entity_type: 'shipment',
      entity_id: shipment.id,
      changes_json: changes as Json,
    });

    if (error) {
      console.error('Error logging shipment audit:', error);
    }
  }, [profile?.id, profile?.tenant_id, shipment?.id]);

  const appendUnifiedShipmentSystemNote = useCallback(
    async (noteText: string, metadata: Record<string, unknown>) => {
      if (!shipment?.id) return;
      const trimmed = noteText.trim();
      if (!trimmed) return;
      const { error } = await (supabase as any).rpc('create_unified_note', {
        p_entity_type: 'shipment',
        p_entity_id: shipment.id,
        p_note_text: trimmed,
        p_note_type: 'internal',
        p_source_entity_number: shipment.shipment_number || null,
        p_metadata: {
          source: 'shipment_detail',
          ...metadata,
        },
      });
      if (error) {
        console.warn('[ShipmentDetail] Failed to append unified shipment note:', error.message);
      }
    },
    [shipment?.id, shipment?.shipment_number]
  );

  // Prompt context for guided prompts
  const promptContext = usePromptContextSafe();

  // startSession is defined after fetchShipment below

  // Wrapped finishSession with prompt trigger and competency tracking
  const finishSession = useCallback(async (
    verificationData: Parameters<typeof rawFinishSession>[0],
    createItems?: Parameters<typeof rawFinishSession>[1]
  ) => {
    // Show completion prompt if available
    if (promptContext?.showPrompt) {
      promptContext.showPrompt('receiving_completion', {
        contextType: 'shipment',
        contextId: id,
      });
    }
    const result = await rawFinishSession(verificationData, createItems);
    if (result.success) {
      promptResumePausedTask();
    }
    // Track competency after completion
    if (promptContext?.trackCompetencyEvent) {
      promptContext.trackCompetencyEvent('receiving', 'task_completed');
    }
    return result;
  }, [rawFinishSession, promptContext, id]);

  // ------------------------------------------
  // Fetch shipment data
  // ------------------------------------------
  const fetchShipment = useCallback(async () => {
    if (!profile?.tenant_id) return;

    try {
      // Fetch shipment with related data
      const { data: shipmentData, error: shipmentError } = await supabase
        .from('shipments')
        .select(`
          *,
          accounts:account_id(id, account_name, account_code),
          warehouses:warehouse_id(id, name)
        `)
        .eq('id', id)
        .eq('tenant_id', profile.tenant_id)
        .is('deleted_at', null)
        .single();

      if (shipmentError) {
        console.error('[ShipmentDetail] fetch shipment failed:', shipmentError);
        toast({ variant: 'destructive', title: 'Error', description: 'Failed to load shipment' });
        return;
      }

      // Fetch classes first (needed for mapping)
      const { data: classesData } = await supabase
        .from('classes')
        .select('id, code, name')
        .eq('tenant_id', profile.tenant_id)
        .order('code');

      if (classesData) {
        setClasses(classesData);
      }

      // Build class lookup map
      const classById = new Map((classesData || []).map(c => [c.id, c]));

      // Fetch shipment items - use flat queries to avoid nested PostgREST join failures with RLS
      const { data: shipmentItemsRaw, error: itemsError } = await supabase
        .from('shipment_items')
        .select('id, expected_description, expected_vendor, expected_sidemark, expected_class_id, expected_quantity, actual_quantity, status, item_id')
        .eq('shipment_id', id)
        .order('created_at');

      if (itemsError) {
        console.error('[ShipmentDetail] fetch shipment_items failed:', itemsError);
      }

      // Fetch linked items separately to avoid nested join issues
      const itemIds = (shipmentItemsRaw || []).map(si => si.item_id).filter(Boolean) as string[];
      const itemsById = new Map<string, any>();

      if (itemIds.length > 0) {
        const { data: itemsRows, error: itemsFetchError } = await supabase
          .from('items')
          .select('id, item_code, quantity, sku, size, size_unit, description, vendor, sidemark, room, primary_photo_url, metadata, class_id, declared_value, coverage_type, current_location_id, account_id')
          .in('id', itemIds);

        if (itemsFetchError) {
          console.error('[ShipmentDetail] fetch items failed:', itemsFetchError);
        }

        if (itemsRows && itemsRows.length > 0) {
          // Fetch locations and accounts separately
          const locationIds = [...new Set(itemsRows.map(i => i.current_location_id).filter(Boolean))] as string[];
          const accountIds = [...new Set(itemsRows.map(i => i.account_id).filter(Boolean))] as string[];

          const [locResult, accResult] = await Promise.all([
            locationIds.length > 0
              ? supabase.from('locations').select('id, code').in('id', locationIds)
              : Promise.resolve({ data: [] as { id: string; code: string }[] }),
            accountIds.length > 0
              ? supabase.from('accounts').select('id, account_name').in('id', accountIds)
              : Promise.resolve({ data: [] as { id: string; account_name: string }[] }),
          ]);

          const locMap = new Map((locResult.data || []).map(l => [l.id, l]));
          const accMap = new Map((accResult.data || []).map(a => [a.id, a]));

          for (const row of itemsRows) {
            const loc = row.current_location_id ? locMap.get(row.current_location_id) : null;
            const acc = row.account_id ? accMap.get(row.account_id) : null;
            itemsById.set(row.id, {
              id: row.id,
              item_code: row.item_code,
              quantity: row.quantity ?? null,
              sku: null,
              description: row.description,
              vendor: row.vendor,
              sidemark: row.sidemark,
              room: row.room,
              primary_photo_url: row.primary_photo_url ?? null,
              metadata: row.metadata ?? null,
              class_id: row.class_id,
              declared_value: row.declared_value,
              coverage_type: row.coverage_type,
              current_location: loc ? { code: loc.code } : null,
              account: acc ? { account_name: acc.account_name } : null,
            });
          }
        }
      }

      // Combine shipment items with their linked item data and class lookups
      const mappedItems = (shipmentItemsRaw || []).map(si => {
        const item = si.item_id ? itemsById.get(si.item_id) || null : null;
        const expected_class = si.expected_class_id ? classById.get(si.expected_class_id) || null : null;
        if (item?.class_id) {
          item.class = classById.get(item.class_id) || null;
        }
        return { ...si, expected_class, item };
      });

      setShipment(shipmentData as unknown as Shipment);
      setItems(mappedItems as unknown as ShipmentItem[]);
      setBillingRefreshKey(prev => prev + 1); // Trigger billing recalculation

      // Initialize receiving photos/documents from shipment
      if (shipmentData.receiving_photos) {
        setReceivingPhotos(shipmentData.receiving_photos as string[]);
      }
      if (shipmentData.receiving_documents) {
        setReceivingDocuments(shipmentData.receiving_documents as string[]);
      }

      // Check for active session
      await fetchSession();
    } catch (err) {
      console.error('[ShipmentDetail] fetchShipment exception:', err);
    } finally {
      setLoading(false);
    }
  }, [id, profile?.tenant_id, fetchSession, toast]);

  useEffect(() => {
    fetchShipment();
  }, [fetchShipment]);

  // Reset exception-note validation state when navigating between shipments
  useEffect(() => {
    setMissingExceptionNoteCodes([]);
  }, [shipment?.id]);

  // Wrapped startSession with prompt trigger and audit logging
  const startSession = useCallback(async () => {
    // Show pre-task prompt if available (non-blocking, informational only)
    if (promptContext?.showPrompt) {
      promptContext.showPrompt('receiving_pre_task', {
        contextType: 'shipment',
        contextId: id,
      });
    }
    
    // Always start the session regardless of prompt
    const result = await rawStartSession();
    
    // Log status change to audit if session started successfully
    if (result && profile?.tenant_id && profile?.id) {
      await logShipmentAudit('status_changed', {
        previous_status: shipment?.status || 'incoming',
        new_status: 'receiving',
        action: 'Started receiving session',
      });
    }
    
    // Refetch shipment to reflect status change in UI
    await fetchShipment();
    
    return result;
  }, [rawStartSession, promptContext, id, logShipmentAudit, profile?.tenant_id, profile?.id, shipment?.status, fetchShipment]);

  const outboundItems = items.filter(item => item.item?.id);
  const activeOutboundItems = outboundItems.filter(item => item.status !== 'cancelled');
  const allPulled = activeOutboundItems.length > 0
    && activeOutboundItems.every(item => isOutboundDock(item.item?.current_location?.code));
  const allReleased = activeOutboundItems.length > 0
    && activeOutboundItems.every(item => isReleasedLocation(item.item?.current_location?.code));

  const updateShipmentStatus = useCallback(async (status: string) => {
    if (!shipment) return;
    const { error } = await supabase
      .from('shipments')
      .update({ status })
      .eq('id', shipment.id);

    if (error) {
      console.error('Error updating shipment status:', error);
      return;
    }
    await fetchShipment();
  }, [fetchShipment, shipment]);

  useEffect(() => {
    if (!shipment || shipment.shipment_type !== 'outbound') return;
    if (pullSessionActive && allPulled) {
      setPullSessionActive(false);
      toast({
        title: 'Pull complete',
        description: 'All items are staged at Outbound Dock.',
      });
      logShipmentAudit('pull_completed', {
        shipment_id: shipment.id,
        item_count: activeOutboundItems.length,
      });
      // End pull timer interval (best-effort)
      if (profile?.tenant_id && profile?.id) {
        timerEndJob({
          tenantId: profile.tenant_id,
          userId: profile.id,
          jobType: 'shipment',
          jobId: shipment.id,
          reason: 'pull_complete',
        }).catch(() => undefined);
      }
    }
  }, [activeOutboundItems.length, allPulled, logShipmentAudit, pullSessionActive, shipment, toast, profile?.tenant_id, profile?.id]);

  useEffect(() => {
    if (!shipment || shipment.shipment_type !== 'outbound') return;
    if (releaseSessionActive && allReleased) {
      setReleaseSessionActive(false);
      toast({
        title: 'Release scan complete',
        description: 'All items have been scanned as Released.',
      });
      logShipmentAudit('release_scan_completed', {
        shipment_id: shipment.id,
        item_count: activeOutboundItems.length,
      });
      // End release timer interval (best-effort)
      if (profile?.tenant_id && profile?.id) {
        timerEndJob({
          tenantId: profile.tenant_id,
          userId: profile.id,
          jobType: 'shipment',
          jobId: shipment.id,
          reason: 'release_complete',
        }).catch(() => undefined);
      }
      if (shipment.status !== 'released') {
        updateShipmentStatus('released');
      }
    }
  }, [activeOutboundItems.length, allReleased, logShipmentAudit, releaseSessionActive, shipment, toast, updateShipmentStatus, profile?.tenant_id, profile?.id]);

  useEffect(() => {
    if (!shipment || shipment.shipment_type !== 'outbound') return;
    if (shipment.status === 'in_progress' && !allPulled && !pullSessionActive) {
      setPullSessionActive(true);
    }
    if (shipment.status === 'released' && !allReleased && !releaseSessionActive) {
      setReleaseSessionActive(true);
    }
  }, [allPulled, allReleased, pullSessionActive, releaseSessionActive, shipment]);

  // ------------------------------------------
  // Initialize received items for finish dialog
  // ------------------------------------------
  const openFinishDialog = () => {
    const initialReceivedItems: ReceivedItemData[] = items.map(item => ({
      shipment_item_id: item.id,
      expected_description: item.expected_description,
      expected_quantity: item.expected_quantity,
      actual_quantity: item.actual_quantity ?? item.expected_quantity,
      expected_vendor: item.expected_vendor,
      expected_sidemark: item.expected_sidemark,
      expected_item_type_id: null,
      notes: null,
      status: 'received' as const,
    }));
    setReceivedItems(initialReceivedItems);
    setShowFinishDialog(true);
  };

  // ------------------------------------------
  // Update received item quantity
  // ------------------------------------------
  const updateReceivedQuantity = (shipmentItemId: string, quantity: number) => {
    setReceivedItems(prev => prev.map(item => {
      if (item.shipment_item_id === shipmentItemId) {
        const status = quantity === 0 ? 'missing' : 
                       quantity < item.expected_quantity ? 'partial' : 'received';
        return { ...item, actual_quantity: quantity, status };
      }
      return item;
    }));
  };

  // ------------------------------------------
  // Handle finish receiving
  // ------------------------------------------
  const handleFinishReceiving = async () => {
    if (!shipment) return;

    // Call SOP validator RPC first
    try {
      const { data: validationResult, error: rpcError } = await (supabase as any).rpc(
        'validate_shipment_receiving_completion',
        { p_shipment_id: shipment.id }
      );

      if (rpcError) {
        console.error('Validation RPC error:', rpcError);
        toast({
          variant: 'destructive',
          title: 'Validation Error',
          description: 'Failed to validate receiving completion. Please try again.',
        });
        return;
      }

      let result = validationResult as { ok: boolean; blockers: SOPBlocker[] };
      let blockers = (result?.blockers || []).filter(
        (b: SOPBlocker) => b.severity === 'blocking' || !b.severity
      );

      // If ITEMS_WITHOUT_LOCATION blocker fires, attempt auto-assign then re-validate
      const hasLocationBlocker = blockers.some(b => b.code === 'ITEMS_WITHOUT_LOCATION');
      if (hasLocationBlocker && shipment.id) {
        try {
          const { data: assignResult } = await supabase.rpc(
            'rpc_assign_receiving_location_for_shipment',
            { p_shipment_id: shipment.id, p_note: 'Auto-assigned on Finish Receiving validation' }
          );
          const assignRes = assignResult as any;
          if (assignRes?.ok && assignRes.updated_count > 0) {
            toast({
              title: 'Location Assigned',
              description: `${assignRes.updated_count} item(s) assigned to ${assignRes.effective_location_code}.`,
            });
            // Re-validate after assignment
            const { data: revalidation } = await (supabase as any).rpc(
              'validate_shipment_receiving_completion',
              { p_shipment_id: shipment.id }
            );
            if (revalidation) {
              result = revalidation as { ok: boolean; blockers: SOPBlocker[] };
              blockers = (result?.blockers || []).filter(
                (b: SOPBlocker) => b.severity === 'blocking' || !b.severity
              );
            }
          }
        } catch {
          // If auto-assign fails, continue with original blockers
        }
      }

      if (!result?.ok && blockers.length > 0) {
        setSopBlockers(result.blockers);
        setSopValidationOpen(true);
        setShowFinishDialog(false);
        return;
      }
    } catch (err) {
      console.error('Validation error:', err);
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'An unexpected error occurred during validation.',
      });
      return;
    }

    // Validate all items have a class assigned for billing
    const itemsWithoutClass = items.filter(item => {
      // For received items, check item.class_id; for pending items, check expected_class_id
      const hasClass = item.item?.class_id || item.expected_class_id;
      return !hasClass;
    });

    if (itemsWithoutClass.length > 0) {
      toast({
        variant: 'destructive',
        title: 'Class Required',
        description: `${itemsWithoutClass.length} item(s) need a class assigned for billing. Please update them before finishing.`,
      });
      setShowFinishDialog(false);
      return;
    }

    // Convert local ReceivedItemData to VerificationData format expected by hook
    const verificationData = {
      expected_items: items.map(item => ({
        description: item.expected_description || '',
        quantity: item.expected_quantity,
      })),
      received_items: receivedItems
        .filter(item => item.status !== 'missing')
        .map(item => ({
          description: item.expected_description || '',
          quantity: item.actual_quantity,
          shipment_item_id: item.shipment_item_id,
        })),
      discrepancies: receivedItems
        .filter(item => item.actual_quantity !== item.expected_quantity)
        .map(item => ({
          description: item.expected_description || '',
          expected: item.expected_quantity,
          received: item.actual_quantity,
        })),
      backorder_items: receivedItems
        .filter(item => item.actual_quantity < item.expected_quantity)
        .map(item => ({
          description: item.expected_description || '',
          quantity: item.expected_quantity - item.actual_quantity,
        })),
    };

    const result = await finishSession(verificationData, true);

    if (result.success) {
      setShowFinishDialog(false);
      setCreatedItemIds(result.createdItemIds);
      
      // Fetch created items for label printing
      if (result.createdItemIds.length > 0) {
        const { data: createdItems } = await supabase
          .from('items')
          .select('id, item_code, description, vendor, sidemark_id, room')
          .in('id', result.createdItemIds);

        if (createdItems) {
          const labelData: ItemLabelData[] = createdItems.map(item => ({
            id: item.id,
            itemCode: item.item_code || '',
            sku: (item as any).sku || '',
            description: item.description || '',
            vendor: item.vendor || '',
            account: shipment?.accounts?.account_name || '',
            sidemark: '',
            room: (item as any).room || '',
            warehouseName: shipment?.warehouses?.name || '',
          }));
          setCreatedItemsForLabels(labelData);
          setShowPrintLabelsDialog(true);
        }
      }
      
      await fetchShipment();
    }
  };

  // ------------------------------------------
  // Handle cancel receiving
  // ------------------------------------------
  const handleCancelReceiving = async () => {
    await cancelSession();
    await fetchShipment();
  };

  // ------------------------------------------
  // Item selection helpers
  // ------------------------------------------
  const toggleItemSelection = (itemId: string) => {
    setSelectedItemIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    const receivedItems = items.filter(i => i.item?.id);
    if (selectedItemIds.size === receivedItems.length) {
      setSelectedItemIds(new Set());
    } else {
      setSelectedItemIds(new Set(receivedItems.map(i => i.item!.id)));
    }
  };

  const handleCreateTask = () => {
    if (selectedItemIds.size === 0 || !selectedTaskType) return;
    // Create tasks via the TaskDialog (there is no /tasks/new route).
    setShowCreateTaskDialog(true);
  };

  const handleTaskDialogSuccess = (createdTaskId?: string) => {
    setShowCreateTaskDialog(false);
    setSelectedTaskType('');
    if (createdTaskId) {
      navigate(`/tasks/${createdTaskId}`);
    }
  };

  const handleCreateOutbound = () => {
    if (selectedItemIds.size === 0) return;
    navigate('/shipments/outbound/new', {
      state: {
        itemIds: Array.from(selectedItemIds),
        accountId: shipment?.account_id || '',
      },
    });
  };

  // ------------------------------------------
  // Handle duplicate shipment item
  // ------------------------------------------
  const handleDuplicateItem = async (itemToDuplicate: ShipmentItem) => {
    if (!shipment || !profile?.tenant_id) return;

    try {
      const { error } = await supabase
        .from('shipment_items')
        .insert({
          shipment_id: shipment.id,
          expected_description: itemToDuplicate.expected_description,
          expected_vendor: itemToDuplicate.expected_vendor,
          expected_sidemark: itemToDuplicate.expected_sidemark,
          expected_quantity: itemToDuplicate.expected_quantity,
          expected_class_id: itemToDuplicate.expected_class_id,
          status: 'pending',
        });

      if (error) throw error;

      toast({ title: 'Item duplicated' });
      fetchShipment();
    } catch (error) {
      console.error('Error duplicating item:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to duplicate item' });
    }
  };

  // ------------------------------------------
  // Handle cancel shipment
  // ------------------------------------------
  const handleCancelShipment = async () => {
    if (!shipment) return;
    setCancelling(true);
    try {
      const cancelNote = shipment.notes || 'Shipment cancelled by user action.';
      const cancellationAuditNote = 'Shipment cancelled by user action.';
      const { error } = await supabase
        .from('shipments')
        .update({ status: 'cancelled', notes: cancelNote })
        .eq('id', shipment.id);

      if (error) throw error;

      await appendUnifiedShipmentSystemNote(cancellationAuditNote, {
        action: 'shipment_cancelled',
        legacy_field: 'shipments.notes',
      });

      await queueShipmentUnableToCompleteAlert(
        profile?.tenant_id || shipment.tenant_id,
        shipment.id,
        shipment.shipment_number,
        cancelNote
      );

      toast({ title: 'Shipment Cancelled' });
      setShowCancelDialog(false);
      fetchShipment();
    } catch (error) {
      console.error('Error cancelling shipment:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to cancel shipment' });
    } finally {
      setCancelling(false);
    }
  };

  const handleDeleteShipment = async () => {
    if (!shipment) return;
    const { error } = await (supabase as any)
      .from('shipments')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', shipment.id);
    if (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to delete shipment' });
    } else {
      toast({ title: 'Deleted', description: 'Shipment has been removed.' });
      navigate('/shipments');
    }
  };

  const isLikelyLocationCode = useCallback((input: string): boolean => {
    return isLikelyLocationCodeUtil(input, locations);
  }, [locations]);

  const findShipmentItemByScan = (scanValue: string) => {
    const raw = scanValue.trim();
    if (!raw) return null;

    const payload = parseScanPayload(raw);
    // Never treat explicit locations as items (even if a location code happens to match an item code).
    if (payload?.type === 'location' || payload?.type === 'container') return null;

    const candidates = new Set<string>();
    const add = (v?: string) => {
      const t = (v || '').trim();
      if (!t) return;
      candidates.add(t.toLowerCase());
    };

    add(payload?.id);
    add(payload?.code);
    add(raw);

    for (const normalized of candidates) {
      const match =
        activeOutboundItems.find(item =>
          item.item?.id?.toLowerCase() === normalized
          || item.item?.item_code?.toLowerCase() === normalized
        ) || null;
      if (match) return match;
    }

    return null;
  };

  const updateItemLocation = async (itemId: string, locationId: string) => {
    const { error } = await (supabase.from('items') as any)
      .update({ current_location_id: locationId })
      .eq('id', itemId);

    if (error) {
      throw error;
    }
  };

  const updateItemReleasedState = async (itemId: string) => {
    const now = new Date().toISOString();
    const { error } = await (supabase.from('items') as any)
      .update({
        status: 'released',
        released_at: now,
        released_date: now,
      })
      .eq('id', itemId);

    if (error) {
      throw error;
    }
  };

  const updateShipmentItemRelease = async (shipmentItemId: string) => {
    const { error } = await (supabase.from('shipment_items') as any)
      .update({
        status: 'released',
        released_at: new Date().toISOString(),
      })
      .eq('id', shipmentItemId);

    if (error) {
      throw error;
    }
  };

  type ScannableContainer = {
    id: string;
    container_code: string;
    status: string;
  };

  const lookupContainerFromScan = async (
    scanValue: string,
    payloadHint?: ReturnType<typeof parseScanPayload>
  ): Promise<ScannableContainer | null> => {
    const payload = payloadHint ?? parseScanPayload(scanValue);
    const raw = scanValue.trim();
    if (!raw || !payload) return null;

    const codeCandidate = (payload.code || payload.id || raw).trim();
    const escapeIlikeExact = (value: string) => value.replace(/([\\%_])/g, '\\$1');

    if (payload.id && isValidUuid(payload.id)) {
      const { data } = await supabase
        .from('containers')
        .select('id, container_code, status')
        .eq('id', payload.id)
        .is('deleted_at', null)
        .maybeSingle();
      if (data) {
        return {
          id: data.id,
          container_code: data.container_code,
          status: data.status || 'active',
        };
      }
    }

    if (!codeCandidate) return null;

    const { data } = await supabase
      .from('containers')
      .select('id, container_code, status')
      .ilike('container_code', escapeIlikeExact(codeCandidate))
      .is('deleted_at', null)
      .maybeSingle();

    if (!data) return null;
    return {
      id: data.id,
      container_code: data.container_code,
      status: data.status || 'active',
    };
  };

  const lookupAndOfferContainerNavigation = async (
    scanValue: string,
    payloadHint?: ReturnType<typeof parseScanPayload>
  ): Promise<boolean> => {
    const container = await lookupContainerFromScan(scanValue, payloadHint);
    if (!container) return false;

    const ok = window.confirm(
      `This screen expects item codes.\n\nYou scanned a container (${container.container_code}).\n\nOpen container details?`
    );
    if (!ok) return false;

    navigate(`/containers/${container.id}`);
    return true;
  };

  const blockOutboundScan = useCallback((reason: string, code?: string, title = 'SCAN ERROR') => {
    outboundScanBlockRef.current({
      title,
      reason,
      code: (code || '').trim(),
    });
  }, []);

  const processContainerScanForOutbound = async (
    scanValue: string,
    mode: 'pull' | 'release',
    payloadHint?: ReturnType<typeof parseScanPayload>
  ): Promise<boolean> => {
    if (!shipment || !orgPrefs.scan_shortcuts_open_container_enabled) return false;

    const container = await lookupContainerFromScan(scanValue, payloadHint);
    if (!container) return false;
    const activeByShipmentItemId = new Map(activeOutboundItems.map((item) => [item.id, item]));
    const activeByItemId = new Map(
      activeOutboundItems
        .filter((row) => typeof row.item?.id === 'string' && row.item.id.length > 0)
        .map((row) => [row.item!.id, row])
    );

    let matchedRows: ShipmentItem[] = [];
    let matchedSource: 'item_metadata' | 'legacy_units' | 'none' = 'none';

    // Item-code-first lookup: resolve container links directly from items.metadata.
    try {
      const [{ data: metaByContainerId }, { data: metaByContainerCode }] = await Promise.all([
        (supabase.from('items') as any)
          .select('id')
          .is('deleted_at', null)
          .contains('metadata', { container_id: container.id })
          .limit(500),
        (supabase.from('items') as any)
          .select('id')
          .is('deleted_at', null)
          .contains('metadata', { container_code: container.container_code })
          .limit(500),
      ]);

      const linkedItemIds = Array.from(
        new Set(
          ([...(metaByContainerId || []), ...(metaByContainerCode || [])] as any[])
            .map((row) => (typeof row?.id === 'string' ? row.id : null))
            .filter((v): v is string => !!v)
        )
      );

      if (linkedItemIds.length > 0) {
        matchedRows = Array.from(
          new Map(
            linkedItemIds
              .map((itemId) => activeByItemId.get(itemId))
              .filter((row): row is ShipmentItem => !!row && !!row.item?.id)
              .map((row) => [row.id, row])
          ).values()
        );
        if (matchedRows.length > 0) {
          matchedSource = 'item_metadata';
        }
      }
    } catch (metaErr) {
      console.warn('[ShipmentDetail] item metadata container lookup failed:', metaErr);
    }

    // Legacy fallback path: use inventory_units links only when tenant setting enables it.
    if (matchedRows.length === 0 && legacyContainerUnitLinksEnabled) {
      const { data: units, error: unitsError } = await supabase
        .from('inventory_units')
        .select('shipment_item_id')
        .eq('container_id', container.id);

      if (unitsError) {
        console.error('[ShipmentDetail] failed loading container units:', unitsError);
        const message = `Failed to read contents of container ${container.container_code}.`;
        setLastScan({ itemCode: container.container_code, result: 'error', message });
        hapticError();
        blockOutboundScan('CONTAINER SCAN FAILED', container.container_code);
        await logShipmentAudit('scan_error', {
          scan_value: scanValue.trim(),
          mode,
          error: unitsError.message,
          container_id: container.id,
        });
        return true;
      }

      const shipmentItemIds = Array.from(
        new Set(
          (units || [])
            .map((u) => u.shipment_item_id)
            .filter((v): v is string => typeof v === 'string' && v.length > 0)
        )
      );

      if (shipmentItemIds.length > 0) {
        matchedRows = Array.from(
          new Map(
            shipmentItemIds
              .map((shipmentItemId) => activeByShipmentItemId.get(shipmentItemId))
              .filter((row): row is ShipmentItem => !!row && !!row.item?.id)
              .map((row) => [row.id, row])
          ).values()
        );
        if (matchedRows.length > 0) {
          matchedSource = 'legacy_units';
        }
      }
    }

    if (matchedRows.length === 0) {
      const didNavigate = await lookupAndOfferContainerNavigation(scanValue, payloadHint);
      if (didNavigate) return true;
      const message =
        matchedSource === 'none' && !legacyContainerUnitLinksEnabled
          ? `Container ${container.container_code} has no item metadata links. Enable legacy container unit links to use IC-based container batch scans.`
          : `Container ${container.container_code} does not contain active items for this shipment.`;
      setLastScan({ itemCode: container.container_code, result: 'invalid', message });
      hapticError();
      blockOutboundScan('NO MATCHING SHIPMENT ITEMS', container.container_code);
      await logShipmentAudit('scan_invalid', {
        scan_value: scanValue.trim(),
        mode,
        message,
        parsed_type: 'container',
        container_id: container.id,
      });
      return true;
    }

    const actionLabel = mode === 'pull' ? 'stage at Outbound Dock' : 'mark as Released';
    const processHere = window.confirm(
      `Scanned container ${container.container_code}.\n\n` +
        `Process ${matchedRows.length} matching shipment item(s) from this container and ${actionLabel}?\n\n` +
        `Press Cancel to use the existing "open container details" shortcut.`
    );
    if (!processHere) {
      const didNavigate = await lookupAndOfferContainerNavigation(scanValue, payloadHint);
      if (didNavigate) return true;
      setLastScan({
        itemCode: container.container_code,
        result: 'duplicate',
        message: 'Container scan ignored.',
      });
      return true;
    }

    if (mode === 'pull' && !outboundDockLocation?.id) {
      blockOutboundScan('OUTBOUND DOCK MISSING', 'OUTBOUND-DOCK');
      return true;
    }
    if (mode === 'release' && !releasedLocation?.id) {
      blockOutboundScan('RELEASED LOCATION MISSING', 'RELEASED');
      return true;
    }

    const groupedRows = matchedRows.filter((row) => {
      const qty = typeof (row.item as any)?.quantity === 'number' ? Number((row.item as any).quantity) : 1;
      return Number.isFinite(qty) && qty > 1 && !isReleasedLocation(row.item?.current_location?.code);
    });
    if (mode === 'release' && groupedRows.length > 0) {
      const groupedTotal = groupedRows.reduce((sum, row) => {
        const qty = typeof (row.item as any)?.quantity === 'number' ? Number((row.item as any).quantity) : 1;
        return sum + (Number.isFinite(qty) && qty > 0 ? qty : 1);
      }, 0);
      const groupedOk = window.confirm(
        `This container includes ${groupedRows.length} grouped label(s) representing ${groupedTotal} total unit(s).\n\n` +
          `Mark all of them as Released?`
      );
      if (!groupedOk) {
        setLastScan({
          itemCode: container.container_code,
          result: 'error',
          message: 'Bulk release cancelled.',
        });
        return true;
      }
    }

    let successCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;

    for (const matched of matchedRows) {
      if (!matched.item?.id) continue;
      try {
        if (mode === 'pull') {
          if (isOutboundDock(matched.item.current_location?.code)) {
            duplicateCount += 1;
            continue;
          }

          await updateItemLocation(matched.item.id, outboundDockLocation!.id);
          successCount += 1;
          await logShipmentAudit('pull_scan_success', {
            item_id: matched.item.id,
            shipment_item_id: matched.id,
            location_id: outboundDockLocation!.id,
            via_container_scan: true,
            container_id: container.id,
            container_code: container.container_code,
          });
          continue;
        }

        if (isReleasedLocation(matched.item.current_location?.code)) {
          duplicateCount += 1;
          continue;
        }

        await updateItemLocation(matched.item.id, releasedLocation!.id);
        await updateItemReleasedState(matched.item.id);
        await updateShipmentItemRelease(matched.id);
        successCount += 1;
        await logShipmentAudit('release_scan_success', {
          item_id: matched.item.id,
          shipment_item_id: matched.id,
          location_id: releasedLocation!.id,
          via_container_scan: true,
          container_id: container.id,
          container_code: container.container_code,
        });
      } catch (err: any) {
        errorCount += 1;
        console.error('[ShipmentDetail] bulk container scan item update failed:', err, {
          shipment_item_id: matched.id,
          item_id: matched.item?.id,
          mode,
        });
      }
    }

    if (successCount > 0) {
      await fetchShipment();
    }

    if (errorCount > 0) {
      await logShipmentAudit('scan_error', {
        scan_value: scanValue.trim(),
        mode,
        container_id: container.id,
        container_code: container.container_code,
        success_count: successCount,
        duplicate_count: duplicateCount,
        error_count: errorCount,
      });
    } else if (duplicateCount > 0) {
      await logShipmentAudit('scan_duplicate', {
        scan_value: scanValue.trim(),
        mode,
        container_id: container.id,
        container_code: container.container_code,
        duplicate_count: duplicateCount,
      });
    }

    const message = [
      `${mode === 'pull' ? 'Staged' : 'Released'} ${successCount} item(s) from ${container.container_code}.`,
      duplicateCount > 0 ? `${duplicateCount} already ${mode === 'pull' ? 'staged' : 'released'}.` : null,
      errorCount > 0 ? `${errorCount} failed.` : null,
    ].filter(Boolean).join(' ');

    if (successCount > 0) {
      setLastScan({ itemCode: container.container_code, result: 'success', message });
      hapticSuccess();
      return true;
    }

    if (duplicateCount > 0 && errorCount === 0) {
      setLastScan({ itemCode: container.container_code, result: 'duplicate', message });
      hapticError();
      return true;
    }

    setLastScan({ itemCode: container.container_code, result: 'error', message });
    hapticError();
    blockOutboundScan('CONTAINER SCAN FAILED', container.container_code);
    return true;
  };

  const processOutboundScan = async (scanValue: string, mode: 'pull' | 'release') => {
    if (!shipment) return;
    const trimmed = scanValue.trim();
    if (!trimmed) return;

    setLastScan(null);

    const payload = parseScanPayload(trimmed);
    const displayValue = (payload?.code || payload?.id || trimmed).trim();

    if (payload?.type === 'location' || isLikelyLocationCode(trimmed)) {
      // Optional shortcut: open location details (org setting)
      if (orgPrefs.scan_shortcuts_open_location_enabled) {
        const ok = window.confirm(
          `This screen expects item codes.\n\nYou scanned a location (${displayValue}).\n\nOpen location details?`
        );
        if (ok) {
          if (payload?.id && isValidUuid(payload.id)) {
            navigate(`/locations/${payload.id}`);
            return;
          }

          // Fallback: lookup by code
          const { data } = await supabase
            .from('locations')
            .select('id')
            .eq('code', displayValue)
            .is('deleted_at', null)
            .maybeSingle();
          if (data?.id) {
            navigate(`/locations/${data.id}`);
            return;
          }
        }
      }

      const message = `"${displayValue}" is a location. Please scan an item from this shipment.`;
      setLastScan({ itemCode: displayValue, result: 'invalid', message });
      hapticError();
      blockOutboundScan('WRONG BARCODE TYPE', displayValue);
      await logShipmentAudit('scan_invalid', {
        scan_value: trimmed,
        mode,
        message,
        parsed_type: payload?.type || 'unknown',
      });
      return;
    }

    const matched = findShipmentItemByScan(trimmed);
    if (!matched || !matched.item?.id) {
      if (orgPrefs.scan_shortcuts_open_container_enabled) {
        const handledContainer = await processContainerScanForOutbound(trimmed, mode, payload);
        if (handledContainer) return;
      }

      const message = 'This is the wrong item. Please return the item to its previous location.';
      setLastScan({ itemCode: displayValue, result: 'invalid', message });
      hapticError();
      blockOutboundScan('WRONG ITEM FOR THIS SHIPMENT', displayValue);
      await logShipmentAudit('scan_invalid', {
        scan_value: trimmed,
        mode,
        message,
        parsed_type: payload?.type || 'unknown',
      });
      return;
    }

    if (mode === 'pull') {
      if (!outboundDockLocation?.id) {
        blockOutboundScan('OUTBOUND DOCK MISSING', 'OUTBOUND-DOCK');
        return;
      }

      if (isOutboundDock(matched.item.current_location?.code)) {
        const message = 'Item already staged at Outbound Dock.';
        setLastScan({ itemCode: matched.item.item_code, result: 'duplicate', message });
        hapticError();
        blockOutboundScan('DUPLICATE SCAN', matched.item.item_code);
        await logShipmentAudit('scan_duplicate', {
          scan_value: trimmed,
          mode,
          item_id: matched.item.id,
        });
        return;
      }

      await updateItemLocation(matched.item.id, outboundDockLocation.id);
      setLastScan({
        itemCode: matched.item.item_code,
        result: 'success',
        message: 'Moved to Outbound Dock.',
      });
      hapticSuccess();
      await logShipmentAudit('pull_scan_success', {
        item_id: matched.item.id,
        shipment_item_id: matched.id,
        location_id: outboundDockLocation.id,
      });
    }

    if (mode === 'release') {
      if (!releasedLocation?.id) {
        blockOutboundScan('RELEASED LOCATION MISSING', 'RELEASED');
        return;
      }

      if (isReleasedLocation(matched.item.current_location?.code)) {
        const message = 'Item already scanned as Released.';
        setLastScan({ itemCode: matched.item.item_code, result: 'duplicate', message });
        hapticError();
        blockOutboundScan('DUPLICATE SCAN', matched.item.item_code);
        await logShipmentAudit('scan_duplicate', {
          scan_value: trimmed,
          mode,
          item_id: matched.item.id,
        });
        return;
      }

      const groupedQty =
        typeof (matched.item as any).quantity === 'number' && Number.isFinite((matched.item as any).quantity)
          ? (matched.item as any).quantity
          : 1;
      if (groupedQty > 1) {
        const ok = window.confirm(
          `This label represents quantity ${groupedQty}.\n\nMark ALL ${groupedQty} units as Released for this outbound?`
        );
        if (!ok) {
          setLastScan({
            itemCode: matched.item.item_code,
            result: 'error',
            message: 'Release cancelled.',
          });
          return;
        }
      }

      await updateItemLocation(matched.item.id, releasedLocation.id);
      await updateItemReleasedState(matched.item.id);
      await updateShipmentItemRelease(matched.id);
      setLastScan({
        itemCode: matched.item.item_code,
        result: 'success',
        message: 'Marked as Released.',
      });
      hapticSuccess();
      await logShipmentAudit('release_scan_success', {
        item_id: matched.item.id,
        shipment_item_id: matched.id,
        location_id: releasedLocation.id,
      });
    }

    await fetchShipment();
  };

  const outboundScanEngine = useItemWorkflowScanMode({
    enabled: isOutbound && (pullSessionActive || releaseSessionActive),
    processing: processingScan,
    setProcessing: setProcessingScan,
    allowedTypes: ['item', 'unknown'],
    onBlockedType: async (event, controls) => {
      const mode: 'pull' | 'release' = pullSessionActive ? 'pull' : 'release';

      // Container shortcut: process matching items in container (with fallback to open details)
      if (event.type === 'container' && orgPrefs.scan_shortcuts_open_container_enabled) {
        const handledContainer = await processContainerScanForOutbound(event.raw, mode, event.payload);
        if (handledContainer) return true;
      }

      const typeLabel = event.type === 'container' ? 'container' : event.type === 'location' ? 'location' : event.type;
      const message = `"${event.code}" is a ${typeLabel}. Please scan an item from this shipment.`;
      setLastScan({ itemCode: event.code, result: 'invalid', message });
      hapticError();
      controls.block({
        title: 'SCAN ERROR',
        reason: 'WRONG BARCODE TYPE',
        code: event.code,
      });

      await logShipmentAudit('scan_invalid', {
        scan_value: event.raw.trim(),
        mode,
        message,
        parsed_type: event.type,
      });
      return true;
    },
    onScan: async (event) => {
      const mode: 'pull' | 'release' = pullSessionActive ? 'pull' : 'release';
      await processOutboundScan(event.raw, mode);
    },
    onUnexpectedError: (error, raw) => {
      console.error('[ShipmentDetail] Outbound scan error:', error, { raw });
      setLastScan({ itemCode: raw.trim(), result: 'error', message: 'Failed to process scan.' });
      hapticError();

      // Keep audit behavior consistent with the previous handler implementation.
      const mode: 'pull' | 'release' = pullSessionActive ? 'pull' : 'release';
      void logShipmentAudit('scan_error', {
        scan_value: raw.trim(),
        mode,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  outboundScanBlockRef.current = outboundScanEngine.block;

  useEffect(() => {
    if (!(isOutbound && (pullSessionActive || releaseSessionActive))) {
      outboundScanEngine.reset();
    }
  }, [isOutbound, pullSessionActive, releaseSessionActive, outboundScanEngine.reset]);

  const beginOutboundMode = async (mode: 'pull' | 'release') => {
    if (!shipment) return;

    if (mode === 'pull') {
      setPullSessionActive(true);
      setReleaseSessionActive(false);
      if (['expected', 'pending'].includes(shipment.status)) {
        await updateShipmentStatus('in_progress');
      }
      await logShipmentAudit('pull_started', {
        shipment_id: shipment.id,
        item_count: activeOutboundItems.length,
      });
      return;
    }

    // release
    setReleaseSessionActive(true);
    setPullSessionActive(false);
    await logShipmentAudit('release_scan_started', {
      shipment_id: shipment.id,
      item_count: activeOutboundItems.length,
    });
  };

  const tryStartOutboundTimer = async (mode: 'pull' | 'release', pauseExisting: boolean) => {
    if (!shipment || !profile?.tenant_id) return false;

    try {
      const res = await timerStartJob({
        tenantId: profile.tenant_id,
        userId: profile.id,
        jobType: 'shipment',
        jobId: shipment.id,
        pauseExisting,
      });
      if (res?.ok === false) {
        if (res.error_code === 'ACTIVE_TIMER_EXISTS' && !pauseExisting) {
          setOutboundTimerPendingMode(mode);
          setOutboundTimerActiveJobLabel(
            await resolveActiveJobLabel(profile?.tenant_id, res.active_job_type, res.active_job_id),
          );
          setOutboundTimerConfirmOpen(true);
          return false;
        }
        toast({
          variant: 'destructive',
          title: 'Unable to start timer',
          description: res.error_message || 'Failed to start timer',
        });
        return false;
      }

      return true;
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Unable to start timer',
        description: err?.message || 'Failed to start timer',
      });
      return false;
    }
  };

  const handleStartPull = async () => {
    if (!shipment) return;
    const meta = shipment.metadata && typeof shipment.metadata === 'object' ? shipment.metadata : null;
    const splitRequired = !!(meta && (meta as any).split_required === true);
    const splitTaskIds = splitRequired && Array.isArray((meta as any).split_required_task_ids)
      ? ((meta as any).split_required_task_ids as any[]).map(String)
      : [];
    const pendingReview = !!(meta && (meta as any).pending_review === true);

    if (splitRequired) {
      toast({
        variant: 'destructive',
        title: 'Split required',
        description: splitTaskIds.length > 0
          ? `This outbound is blocked until ${splitTaskIds.length} Split task(s) are completed.`
          : 'This outbound is blocked until the required Split task is completed.',
      });
      return;
    }

    // Manual review workflow: allow start, but clear the "Pending review" marker.
    if (pendingReview) {
      try {
        const nextMeta: any = { ...(meta as any) };
        delete nextMeta.pending_review;
        delete nextMeta.pending_review_reason;
        delete nextMeta.split_workflow;
        const { error: clearErr } = await (supabase.from('shipments') as any)
          .update({ metadata: nextMeta })
          .eq('id', shipment.id);
        if (clearErr) throw clearErr;
        toast({
          title: 'Review started',
          description: 'Pending review cleared for this shipment.',
        });
      } catch (err) {
        console.warn('[ShipmentDetail] failed to clear pending_review metadata:', err);
      }
    }
    if (!outboundDockLocation?.id) {
      toast({
        variant: 'destructive',
        title: 'Outbound Dock missing',
        description: 'Create an OUTBOUND-DOCK location before starting the pull.',
      });
      return;
    }

    const ok = await tryStartOutboundTimer('pull', false);
    if (!ok) return;

    await beginOutboundMode('pull');
  };

  const handleStartRelease = async () => {
    if (!shipment) return;
    if (!allPulled) {
      toast({
        variant: 'destructive',
        title: 'Items not staged',
        description: 'All items must be at Outbound Dock before release scanning.',
      });
      return;
    }
    if (!releasedLocation?.id) {
      toast({
        variant: 'destructive',
        title: 'Released location missing',
        description: 'Create a RELEASED (or type Release) location before starting the release scan.',
      });
      return;
    }

    const ok = await tryStartOutboundTimer('release', false);
    if (!ok) return;

    await beginOutboundMode('release');
  };

  const handleManualOverride = async (mode: 'pull' | 'release') => {
    if (manualOverrideItemIds.size === 0) return;
    const targetItems = items.filter(item => item.item?.id && manualOverrideItemIds.has(item.item.id));
    if (targetItems.length === 0) return;
    try {
      for (const targetItem of targetItems) {
        if (!targetItem.item?.id) continue;

        if (mode === 'pull') {
          if (!outboundDockLocation?.id) return;
          await updateItemLocation(targetItem.item.id, outboundDockLocation.id);
          await logShipmentAudit('pull_manual_override', {
            shipment_item_id: targetItem.id,
            item_id: targetItem.item.id,
          });
        }

        if (mode === 'release') {
          if (!releasedLocation?.id) return;
          await updateItemLocation(targetItem.item.id, releasedLocation.id);
          await updateItemReleasedState(targetItem.item.id);
          await updateShipmentItemRelease(targetItem.id);
          await logShipmentAudit('release_manual_override', {
            shipment_item_id: targetItem.id,
            item_id: targetItem.item.id,
          });
        }
      }

      const count = targetItems.length;
      if (mode === 'pull') {
        toast({ title: `${count} item${count > 1 ? 's' : ''} staged`, description: 'Marked as Outbound Dock.' });
      } else {
        toast({ title: `${count} item${count > 1 ? 's' : ''} released`, description: 'Marked as Released.' });
      }

      setManualOverrideItemIds(new Set());
      await fetchShipment();
    } catch (error) {
      console.error('Error applying manual override:', error);
      toast({
        variant: 'destructive',
        title: 'Manual override failed',
        description: 'Unable to update items.',
      });
    }
  };

  const handleSubmitPartialRelease = async () => {
    if (!shipment || partialReleaseItems.size === 0) return;
    if (!partialReleaseNote.trim()) {
      toast({
        variant: 'destructive',
        title: 'Note required',
        description: 'Please add a note explaining the partial release.',
      });
      return;
    }
    setSubmittingPartialRelease(true);
    try {
      const ids = Array.from(partialReleaseItems);

      // 1. Update shipment_items status to cancelled
      const { error } = await (supabase.from('shipment_items') as any)
        .update({
          status: 'cancelled',
          notes: partialReleaseNote || null,
        })
        .in('id', ids);

      if (error) throw error;

      // 1b. Mark shipment partial and persist reason in shipment notes.
      const mergedNotes = [shipment.notes || '', `Partial release: ${partialReleaseNote}`]
        .map((entry) => entry.trim())
        .filter(Boolean)
        .join('\n');
      await (supabase.from('shipments') as any)
        .update({
          status: 'partial',
          notes: mergedNotes,
        })
        .eq('id', shipment.id);

      await appendUnifiedShipmentSystemNote(`Partial release: ${partialReleaseNote}`, {
        action: 'shipment_partial_release',
        legacy_field: 'shipments.notes',
      });

      // 2. Restore items to their account's default location (remove from outbound dock)
      // Get the item_ids for the cancelled shipment items
      const cancelledShipmentItems = items.filter(si => ids.includes(si.id) && si.item_id);
      const itemIds = cancelledShipmentItems.map(si => si.item_id).filter(Boolean) as string[];

      if (itemIds.length > 0) {
        // Find a default warehouse location to restore items to (first non-special location or warehouse default)
        const defaultLocation = locations.find(l =>
          l.type === 'storage' || (l.type === 'default' && !isOutboundDock(l.code) && !isReleasedLocation(l.code))
        ) || locations.find(l => !isOutboundDock(l.code) && !isReleasedLocation(l.code) && l.type !== 'release');

        if (defaultLocation?.id) {
          await (supabase.from('items') as any)
            .update({ current_location_id: defaultLocation.id })
            .in('id', itemIds);
        }

        // Reset item status back to stored (from any outbound staging status)
        await (supabase.from('items') as any)
          .update({ status: 'stored' })
          .in('id', itemIds)
          .in('status', ['staged', 'pulling']);
      }

      await logShipmentAudit('partial_release', {
        shipment_id: shipment.id,
        removed_items: ids,
        restored_item_ids: itemIds,
        note: partialReleaseNote || null,
      });

      await queueShipmentPartialCompletedAlert(
        profile?.tenant_id || shipment.tenant_id,
        shipment.id,
        shipment.shipment_number,
        ids.length,
        partialReleaseNote
      );
      setPartialReleaseItems(new Set());
      setPartialReleaseNote('');
      setShowPartialReleaseDialog(false);
      await fetchShipment();
      toast({ title: 'Items removed', description: `${ids.length} item(s) removed from shipment and restored to storage.` });
    } catch (error) {
      console.error('Error applying partial release:', error);
      toast({
        variant: 'destructive',
        title: 'Partial release failed',
        description: 'Unable to update shipment items.',
      });
    } finally {
      setSubmittingPartialRelease(false);
    }
  };

  // ------------------------------------------
  // Execute the actual outbound completion with signature capture
  // ------------------------------------------
  const executeOutboundCompletion = async (
    signatureInfo: { signatureData: string | null; signatureName: string },
    overriddenWarnings?: SOPBlocker[]
  ) => {
    if (!shipment) return;

    setCompletingOutbound(true);
    try {
      const now = new Date().toISOString();
      const releasedToName =
        signatureInfo.signatureName?.trim()
        || shipment.released_to
        || shipment.driver_name
        || shipment.release_to_name
        || null;

      // Snapshot estimated service time at completion (best-effort; must not block shipping)
      let completedMetadata: any | undefined = undefined;
      try {
        if (profile?.tenant_id) {
          const preview = await calculateShipmentBillingPreview(profile.tenant_id, shipment.id, 'outbound');
          const estimatedMinutes = (preview?.lineItems || []).reduce(
            (sum, li) => sum + (li.estimatedMinutes || 0),
            0,
          );
          completedMetadata = mergeServiceTimeSnapshot((shipment as any).metadata ?? null, {
            estimated_minutes: Math.round(estimatedMinutes),
            estimated_snapshot_at: now,
            estimated_source: 'billing_preview',
            estimated_version: 1,
          });
        }
      } catch (err) {
        console.warn('[ShipmentDetail] Failed to snapshot estimated service time:', err);
      }

      // Snapshot actual service time at completion (best-effort)
      try {
        if (profile?.tenant_id) {
          // End any active interval for this shipment first (idempotent)
          try {
            await timerEndJob({
              tenantId: profile.tenant_id,
              userId: profile.id,
              jobType: 'shipment',
              jobId: shipment.id,
              reason: 'complete',
            });
          } catch {
            // Best-effort
          }

          const { data: rows } = await (supabase
            .from('job_time_intervals') as any)
            .select('started_at, ended_at')
            .eq('tenant_id', profile.tenant_id)
            .eq('job_type', 'shipment')
            .eq('job_id', shipment.id);

          const laborMinutes = Math.round(
            (rows || []).reduce((sum: number, r: any) => {
              const start = r.started_at as string;
              const end = (r.ended_at as string | null) || now;
              return sum + minutesBetweenIso(start, end);
            }, 0)
          );

          completedMetadata = mergeServiceTimeActualSnapshot(
            completedMetadata ?? (shipment as any).metadata ?? null,
            {
              actual_cycle_minutes: laborMinutes,
              actual_labor_minutes: laborMinutes,
              actual_snapshot_at: now,
              actual_version: 1,
            }
          );
        }
      } catch (err) {
        console.warn('[ShipmentDetail] Failed to snapshot actual service time:', err);
      }

      // Update shipment with signature and completion data
      const shipmentUpdate: any = {
        status: 'shipped',
        shipped_at: now,
        completed_at: now,
        completed_by: profile?.id || null,
        signature_data: signatureInfo.signatureData,
        signature_name: signatureInfo.signatureName,
        signature_timestamp: now,
        // Persist release recipient (validation requires released_to OR driver_name)
        released_to: releasedToName,
        driver_name: releasedToName,
        // Keep legacy contact field in sync for older UIs/exports
        release_to_name: releasedToName,
      };
      if (completedMetadata !== undefined) {
        shipmentUpdate.metadata = completedMetadata;
      }

      const { error: shipmentError } = await supabase
        .from('shipments')
        .update(shipmentUpdate)
        .eq('id', shipment.id);

      if (shipmentError) throw shipmentError;

      // Update all items in the shipment to released status
      const itemIds = activeOutboundItems.filter(i => i.item_id).map(i => i.item_id);
      if (itemIds.length > 0) {
        const itemUpdate: Record<string, string | null> = {
          status: 'released',
          released_at: now,
          released_date: now,
        };
        if (releasedLocation?.id) {
          itemUpdate.current_location_id = releasedLocation.id;
        }
        const { error: itemsError } = await supabase
          .from('items')
          .update(itemUpdate)
          .in('id', itemIds);

        if (itemsError) throw itemsError;
      }

      // Update shipment_items status to released
      const { error: shipmentItemsError } = await supabase
        .from('shipment_items')
        .update({
          status: 'released',
          released_at: now,
        })
        .eq('shipment_id', shipment.id)
        .neq('status', 'cancelled');

      if (shipmentItemsError) throw shipmentItemsError;

      // Log completion with signature + any overridden warnings
      await logShipmentAudit('shipment_completed', {
        shipment_id: shipment.id,
        item_count: activeOutboundItems.length,
        signature_captured: true,
        signature_name: signatureInfo.signatureName,
        ...(overriddenWarnings && overriddenWarnings.length > 0 && {
          warnings_overridden: overriddenWarnings.map(w => ({
            code: w.code,
            message: w.message,
          })),
          override_by: profile?.id || null,
          override_at: now,
        }),
      });

      // Will-call billing + client alert (non-blocking; completion should still succeed)
      if (
        shipment.shipment_type === 'outbound' &&
        shipment.release_type === 'will_call' &&
        profile?.tenant_id &&
        profile?.id &&
        shipment.account_id
      ) {
        try {
          // Fetch shipment_items + item details for rate lookup and billing context.
          // Do not rely on the page's local item state here (it may be stale after updates).
          const { data: shipmentItemsForBilling, error: shipmentItemsBillingError } = await (supabase
            .from('shipment_items') as any)
            .select(`
              id,
              expected_quantity,
              item_id,
              items:item_id(
                id,
                item_code,
                class_id,
                sidemark_id,
                account_id,
                account:accounts(account_name)
              )
            `)
            .eq('shipment_id', shipment.id)
            .neq('status', 'cancelled')
            .is('deleted_at', null);

          if (shipmentItemsBillingError) throw shipmentItemsBillingError;

          const rawItems = (shipmentItemsForBilling || []) as any[];
          const uniqueItemIds = [
            ...new Set(rawItems.map((si) => si?.items?.id).filter(Boolean) as string[]),
          ];

          // Deduplicate: skip items already billed for this shipment (avoid accidental double-charges).
          const existingBilledItemIds = new Set<string>();
          if (uniqueItemIds.length > 0) {
            const { data: existingEvents, error: existingError } = await supabase
              .from('billing_events')
              .select('item_id')
              .eq('tenant_id', profile.tenant_id)
              .eq('shipment_id', shipment.id)
              .eq('event_type', 'will_call')
              .eq('charge_type', 'Will_Call')
              .neq('status', 'void')
              .in('item_id', uniqueItemIds);

            if (existingError) {
              console.warn('[ShipmentDetail] Unable to check existing billing events (will proceed):', existingError);
            } else {
              (existingEvents || []).forEach((e: any) => {
                if (e?.item_id) existingBilledItemIds.add(e.item_id);
              });
            }
          }

          // Fetch only the classes we need to map class_id → class_code
          const classIds = [
            ...new Set(rawItems.map((si) => si?.items?.class_id).filter(Boolean) as string[]),
          ];
          const classMap = new Map<string, string>();
          if (classIds.length > 0) {
            const { data: classesData, error: classesError } = await supabase
              .from('classes')
              .select('id, code')
              .eq('tenant_id', profile.tenant_id)
              .in('id', classIds);

            if (classesError) throw classesError;
            (classesData || []).forEach((c: any) => {
              if (c?.id) classMap.set(c.id, c.code);
            });
          }

          const chargeRequests: Parameters<typeof createCharges>[0] = [];
          const alertRequests: Array<{
            index: number;
            tenantId: string;
            serviceName: string;
            itemCode: string;
            accountName: string;
            amount: number;
            description: string;
          }> = [];

          for (const si of rawItems) {
            const item = si?.items;
            if (!item?.id || existingBilledItemIds.has(item.id)) continue;

            const accountId: string | null = item.account_id || shipment.account_id;
            if (!accountId) continue;

            const classCode: string | null = item.class_id ? (classMap.get(item.class_id) ?? null) : null;

            // Rate lookup via unified pricing (new system first, legacy fallback)
            let rate = 0;
            let serviceName = 'Will Call';
            let alertRule: string = 'none';
            let hasError = false;
            let errorMessage: string | undefined = undefined;

            try {
              const rateResult = await getEffectiveRate({
                tenantId: profile.tenant_id,
                chargeCode: 'Will_Call',
                accountId,
                classCode: classCode || undefined,
              });

              serviceName = rateResult.charge_name || serviceName;
              alertRule = rateResult.alert_rule || 'none';

              if (rateResult.has_error) {
                rate = 0;
                hasError = true;
                errorMessage = rateResult.error_message || 'Rate lookup error';
              } else {
                rate = rateResult.effective_rate || 0;
              }
            } catch (rateErr: any) {
              const msg = rateErr instanceof Error ? rateErr.message : String(rateErr);
              if (msg === BILLING_DISABLED_ERROR) {
                throw new Error(BILLING_DISABLED_ERROR);
              }
              rate = 0;
              hasError = true;
              errorMessage = msg;
            }

            const quantityRaw = Number(si?.expected_quantity ?? 1);
            const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? quantityRaw : 1;
            const description = `Will Call: ${item.item_code}`;
            const totalAmount = quantity * rate;

            const requestIndex = chargeRequests.length;

            chargeRequests.push({
              tenantId: profile.tenant_id,
              accountId,
              chargeCode: 'Will_Call',
              eventType: 'will_call',
              context: { type: 'shipment', shipmentId: shipment.id, itemId: item.id },
              description,
              quantity,
              classCode,
              rateOverride: rate,
              hasRateError: hasError,
              rateErrorMessage: errorMessage,
              sidemarkId: item.sidemark_id || shipment.sidemark_id || null,
              classId: item.class_id || null,
              metadata: { class_code: classCode },
              userId: profile.id,
            });

            // Track alerts to queue for services with alert_rule: 'email_office'
            if (alertRule === 'email_office') {
              alertRequests.push({
                index: requestIndex,
                tenantId: profile.tenant_id,
                serviceName,
                itemCode: item.item_code,
                accountName:
                  item.account?.account_name ||
                  shipment.accounts?.account_name ||
                  'Unknown Account',
                amount: totalAmount,
                description,
              });
            }
          }

          if (chargeRequests.length > 0) {
            const results = await createCharges(chargeRequests);

            for (const alert of alertRequests) {
              const res = results[alert.index];
              if (res?.success && res.billingEventId) {
                await queueBillingEventAlert(
                  alert.tenantId,
                  res.billingEventId,
                  alert.serviceName,
                  alert.itemCode,
                  alert.accountName,
                  // Use persisted amount if available (promos may adjust totals)
                  typeof res.amount === 'number' ? res.amount : alert.amount,
                  alert.description
                );
              }
            }
          }
        } catch (billingErr: any) {
          if (billingErr?.message === BILLING_DISABLED_ERROR) {
            toast({
              variant: 'destructive',
              title: 'Billing Disabled',
              description: BILLING_DISABLED_ERROR,
            });
          } else {
            console.error('[ShipmentDetail] Outbound billing failed (non-blocking):', billingErr);
          }
        }

        // Queue client-facing "Will Call Released" communication trigger
        try {
          await queueAlert({
            tenantId: profile.tenant_id,
            alertType: 'will_call_released',
            entityType: 'shipment',
            entityId: shipment.id,
            subject: `Will-Call Released — ${shipment.shipment_number}`,
          });
        } catch (alertErr) {
          console.error('[ShipmentDetail] Failed to queue will-call released alert (non-blocking):', alertErr);
        }
      }

      // Generate release PDF and upload as a document
      try {
        const staffName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || null;
        const releasedToForPdf =
          signatureInfo.signatureName?.trim()
          || shipment.released_to
          || shipment.driver_name
          || shipment.release_to_name
          || null;

        const pdfItems: ReleasePdfItem[] = activeOutboundItems.map(si => ({
          itemCode: si.item?.item_code || si.expected_description || '-',
          quantity: si.actual_quantity ?? si.expected_quantity ?? 1,
          description: si.item?.description || si.expected_description || null,
          vendor: si.item?.vendor || si.expected_vendor || null,
          sidemark: si.item?.sidemark || si.expected_sidemark || null,
        }));

        // Fetch tenant settings for branding
        const { data: tenantSettings } = await supabase
          .from('tenant_company_settings')
          .select('company_name, company_address, company_phone, company_email, logo_url')
          .eq('tenant_id', profile?.tenant_id || '')
          .maybeSingle();

        const pdfData: ReleasePdfData = {
          shipmentNumber: shipment.shipment_number,
          shipmentType: shipment.shipment_type,
          releaseType: shipment.release_type,
          releasedTo: releasedToForPdf,
          releaseToPhone: shipment.release_to_phone || null,
          carrier: shipment.carrier,
          trackingNumber: shipment.tracking_number,
          poNumber: shipment.po_number,
          accountName: shipment.accounts?.account_name || null,
          accountCode: shipment.accounts?.account_code || null,
          companyName: tenantSettings?.company_name || 'Warehouse',
          companyAddress: tenantSettings?.company_address || null,
          companyPhone: tenantSettings?.company_phone || null,
          companyEmail: tenantSettings?.company_email || null,
          companyLogo: tenantSettings?.logo_url || null,
          warehouseName: shipment.warehouses?.name || null,
          items: pdfItems,
          signatureData: signatureInfo.signatureData,
          signatureName: signatureInfo.signatureName,
          signedAt: now,
          completedByName: staffName,
          completedAt: now,
        };

        const doc = generateReleasePdf(pdfData);
        const pdfBlob = doc.output('blob');
        const fileName = `Release_${shipment.shipment_number}_${Date.now()}.pdf`;
        const storagePath = `${profile?.tenant_id}/shipment/${shipment.id}/${fileName}`;

        // Upload PDF to storage
        const { error: uploadError } = await supabase.storage
          .from('documents-private')
          .upload(storagePath, pdfBlob, {
            contentType: 'application/pdf',
            upsert: false,
          });

        if (!uploadError) {
          // Create document record via edge function
          await supabase.functions.invoke('create-document', {
            body: {
              context_type: 'shipment',
              context_id: shipment.id,
              file_name: fileName,
              storage_key: storagePath,
              file_size: pdfBlob.size,
              page_count: 1,
              mime_type: 'application/pdf',
              label: `Release Document - ${shipment.shipment_number}`,
              notes: `Release signed by ${releasedToForPdf || 'Driver'}`,
              is_sensitive: false,
            },
          });
        } else {
          console.error('Failed to upload release PDF:', uploadError);
        }
      } catch (pdfErr) {
        console.error('Error generating release PDF (non-blocking):', pdfErr);
      }

      toast({ title: 'Shipment Shipped', description: 'Items have been released and release document generated.' });
      promptResumePausedTask();
      setShowOutboundCompleteDialog(false);
      setShowSignatureDialog(false);
      setPendingOverrideWarnings(undefined);
      setDocumentRefreshKey(prev => prev + 1);
      void refetchDocuments();
      fetchShipment();
    } catch (error) {
      console.error('Error completing outbound shipment:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to complete shipment' });
    } finally {
      setCompletingOutbound(false);
    }
  };

  // ------------------------------------------
  // Handle complete outbound shipment (validates, then executes or shows dialog)
  // ------------------------------------------
  const handleCompleteOutbound = async () => {
    if (!shipment) return;

    // Intake-style: if any OPEN shipment exception is missing its note, block completion
    // and direct the user to the Exceptions tab to fill notes.
    if (profile?.tenant_id) {
      try {
        const { data: openExceptionRows, error: openExceptionError } = await (supabase
          .from('shipment_exceptions') as any)
          .select('code, note')
          .eq('tenant_id', profile.tenant_id)
          .eq('shipment_id', shipment.id)
          .eq('status', 'open');

        if (openExceptionError) throw openExceptionError;

        const missingCodes: ShipmentExceptionCode[] = (Array.isArray(openExceptionRows) ? openExceptionRows : [])
          .map((r: any) => ({
            code: r?.code as ShipmentExceptionCode,
            note: r?.note as string | null,
          }))
          .filter((r: any) => r?.code && !MATCHING_DISCREPANCY_CODES.has(r.code) && !String(r.note || '').trim())
          .map((r: any) => r.code);

        if (missingCodes.length > 0) {
          setMissingExceptionNoteCodes(missingCodes);
          setOutboundNotesTab('exceptions');
          setShowOutboundCompleteDialog(false);
          outboundNotesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          toast({
            variant: 'destructive',
            title: 'Cannot Complete Shipment',
            description: missingCodes
              .map((code) => `Exception note required: ${SHIPMENT_EXCEPTION_CODE_META[code]?.label || code}`)
              .join('. '),
          });
          return;
        }

        // Clear any prior validation state once requirements are satisfied
        if (missingExceptionNoteCodes.length > 0) {
          setMissingExceptionNoteCodes([]);
        }
      } catch (err) {
        console.error('[ShipmentDetail] Exception note validation error:', err);
        setShowOutboundCompleteDialog(false);
        toast({
          variant: 'destructive',
          title: 'Validation Error',
          description: 'Failed to validate exception notes. Please try again.',
        });
        return;
      }
    }

    // Call SOP validator RPC first
    try {
      const { data: validationResult, error: rpcError } = await (supabase as any).rpc(
        'validate_shipment_outbound_completion',
        { p_shipment_id: shipment.id }
      );

      if (rpcError) {
        console.error('Validation RPC error:', rpcError);
        toast({
          variant: 'destructive',
          title: 'Validation Error',
          description: 'Failed to validate outbound completion. Please try again.',
        });
        return;
      }

      const result = validationResult as { ok: boolean; blockers: SOPBlocker[] };
      const allBlockers = result?.blockers || [];
      // "Released To / Driver Name" is captured in the Signature dialog immediately after validation,
      // so don't block completion on it here.
      const blockersForDialog = allBlockers.filter((b: SOPBlocker) => b.code !== 'NO_RELEASED_TO');

      const hardBlockers = blockersForDialog.filter(
        (b: SOPBlocker) => b.severity === 'blocking' || !b.severity
      );
      const warnings = blockersForDialog.filter((b: SOPBlocker) => b.severity === 'warning');

      // If there are hard blockers, show the dialog (no override)
      if (hardBlockers.length > 0) {
        setSopBlockers(blockersForDialog);
        setSopValidationOpen(true);
        setShowOutboundCompleteDialog(false);
        return;
      }

      // If there are warnings (but no hard blockers), show the dialog with override option
      if (warnings.length > 0) {
        setSopBlockers(blockersForDialog);
        setSopValidationOpen(true);
        setShowOutboundCompleteDialog(false);
        return;
      }
    } catch (err) {
      console.error('Validation error:', err);
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'An unexpected error occurred during validation.',
      });
      return;
    }

    if (activeOutboundItems.length > 0 && !allReleased) {
      toast({
        variant: 'destructive',
        title: 'Release scanning incomplete',
        description: 'All items must be scanned as Released before completion.',
      });
      return;
    }

    // No blockers, no warnings - show signature dialog to capture signature before completing
    setPendingOverrideWarnings(undefined);
    setShowOutboundCompleteDialog(false);
    setShowSignatureDialog(true);
  };

  // ------------------------------------------
  // Status badge helper
  // ------------------------------------------
  const shipmentStatusLabels: Record<string, string> = {
    expected: 'Expected',
    pending: 'Pending',
    receiving: 'In Progress',
    in_progress: 'In Progress',
    received: 'Received',
    partial: 'Partial',
    released: 'Released',
    shipped: 'Shipped',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };

  // ------------------------------------------
  // Render loading state
  // ------------------------------------------
  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <MaterialIcon name="progress_activity" size="xl" className="animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  // ------------------------------------------
  // Render not found
  // ------------------------------------------
  if (!shipment) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <MaterialIcon name="inventory_2" size="xl" className="mx-auto text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Shipment Not Found</h2>
          <p className="text-muted-foreground mb-4">This shipment doesn't exist or you don't have access.</p>
          <Button onClick={() => navigate('/shipments')}>
            <MaterialIcon name="arrow_back" size="sm" className="mr-2" />
            Back to Shipments
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const isInbound = shipment.shipment_type === 'inbound' || shipment.shipment_type === 'return';
  // isOutbound already declared above (line 341)
  const isDockIntakeShipment = (shipment as any).inbound_kind === 'dock_intake';
  const shipmentMeta = shipment.metadata && typeof shipment.metadata === 'object' ? shipment.metadata : null;
  const shipmentPendingReview = !!(shipmentMeta && (shipmentMeta as any).pending_review === true);
  const pendingReviewReason = shipmentPendingReview
    ? String((shipmentMeta as any).pending_review_reason || '')
    : '';
  const shipmentSplitRequired = !!(shipmentMeta && (shipmentMeta as any).split_required === true);
  const splitTaskCount = shipmentSplitRequired && Array.isArray((shipmentMeta as any).split_required_task_ids)
    ? (shipmentMeta as any).split_required_task_ids.length
    : 0;
  const baseShipmentStatusLabel = shipmentStatusLabels[shipment.status] || shipment.status;
  const displayShipmentStatus =
    ['released', 'shipped', 'completed', 'cancelled'].includes(shipment.status)
      ? { status: shipment.status, label: baseShipmentStatusLabel }
      : shipmentPendingReview
        ? { status: 'pending_review', label: 'Pending review' }
        : shipmentSplitRequired
          ? { status: 'waiting_split', label: 'Waiting for split' }
          : { status: shipment.status, label: baseShipmentStatusLabel };
  const canReceive = isInbound && ['expected', 'receiving'].includes(shipment.status);
  const isReceiving = session !== null;
  const isReceived = shipment.status === 'received' || shipment.status === 'partial';
  const canStartPull = isOutbound && !pullSessionActive && !allPulled && ['expected', 'pending', 'in_progress'].includes(shipment.status);
  const canStartRelease = isOutbound && allPulled && !releaseSessionActive && !allReleased;
  const canCompleteOutbound = isOutbound && (activeOutboundItems.length === 0 || allReleased);
  const partialReleaseCandidates = activeOutboundItems.filter(item => !isReleasedLocation(item.item?.current_location?.code));
  const outboundActiveStatus = isOutbound && ['expected', 'pending', 'in_progress', 'released'].includes(shipment.status);

  const serviceTimeSnapshot = ((shipment as any)?.metadata as any)?.service_time as
    | {
        estimated_minutes?: number;
        estimated_snapshot_at?: string;
        actual_labor_minutes?: number;
        actual_cycle_minutes?: number;
        actual_snapshot_at?: string;
      }
    | undefined;

  const estimatedMinutes = Number(serviceTimeSnapshot?.estimated_minutes ?? 0);
  const actualLaborMinutes = Number(serviceTimeSnapshot?.actual_labor_minutes ?? 0);
  const shipmentStatusBarKey: 'draft' | 'stage1_complete' | 'receiving' | 'closed' | 'partial' | 'cancelled' = (() => {
    if (shipment.status === 'cancelled') return 'cancelled';
    if (shipment.status === 'partial') return 'partial';
    if (['received', 'released', 'shipped', 'completed'].includes(shipment.status)) return 'closed';
    if (['receiving', 'in_progress'].includes(shipment.status)) return 'receiving';
    if (shipment.status === 'pending') return 'stage1_complete';
    return 'draft';
  })();
  const shipmentStatusLabel = shipmentStatusLabels[shipment.status] || shipment.status;
  const shipmentContextLabel = isOutbound ? 'Shipment · Outbound' : 'Shipment · Inbound';
  const statusBarActions = (() => {
    if (isInbound) {
      if (isReceiving) {
        return (
          <>
            <JobTimerWidget
              jobType="shipment"
              jobId={shipment.id}
              variant="inline"
              showControls={false}
            />
            <Button variant="outline" size="sm" onClick={handleCancelReceiving}>
              <MaterialIcon name="cancel" size="sm" className="mr-2" />
              Cancel
            </Button>
            <Button size="sm" onClick={openFinishDialog}>
              <MaterialIcon name="check_circle" size="sm" className="mr-2" />
              Finish Receiving
            </Button>
          </>
        );
      }

      if (canReceive && hasPermission(PERMISSIONS.SHIPMENTS_RECEIVE)) {
        return (
          <Button size="sm" onClick={startSession} disabled={sessionLoading}>
            <MaterialIcon name="play_arrow" size="sm" className="mr-2" />
            Start Receiving
          </Button>
        );
      }
      return null;
    }

    if (!outboundActiveStatus) return null;
    return (
      <>
        {(pullSessionActive || releaseSessionActive) && (
          <JobTimerWidget
            jobType="shipment"
            jobId={shipment.id}
            variant="inline"
            showControls={false}
          />
        )}
        {['expected', 'pending', 'receiving', 'in_progress'].includes(shipment.status) && (
          <Button variant="outline" size="sm" onClick={() => setShowCancelDialog(true)}>
            <MaterialIcon name="cancel" size="sm" className="mr-2" />
            Cancel
          </Button>
        )}
        {canStartPull && (
          <Button size="sm" onClick={handleStartPull}>
            <MaterialIcon name="qr_code_scanner" size="sm" className="mr-2" />
            Pull Items
          </Button>
        )}
        {canStartRelease && (
          <Button size="sm" onClick={handleStartRelease}>
            <MaterialIcon name="local_shipping" size="sm" className="mr-2" />
            Release Scan
          </Button>
        )}
        {allReleased && (
          <Button size="sm" onClick={() => setShowOutboundCompleteDialog(true)} disabled={!canCompleteOutbound}>
            <MaterialIcon name="check_circle" size="sm" className="mr-2" />
            Complete Release
          </Button>
        )}
      </>
    );
  })();

  return (
    <DashboardLayout>
      {/* Header / Actions (keep stable during sidebar expand/collapse) */}
      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        {/* Left: shipment identity */}
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="shrink-0">
            <MaterialIcon name="arrow_back" size="md" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold">{shipment.shipment_number}</h1>
              <ShipmentExceptionBadge
                shipmentId={shipment.id}
                onClick={
                  isDockIntakeShipment
                    ? () => navigate(`/incoming/dock-intake/${shipment.id}?tab=exceptions`)
                    : undefined
                }
              />
              {shipment.release_type && (
                <Badge variant="outline" className="text-xs capitalize">{shipment.release_type.replace(/_/g, ' ')}</Badge>
              )}
              {estimatedMinutes > 0 && (
                <Badge
                  variant="secondary"
                  className="text-xs tabular-nums whitespace-nowrap"
                  title={serviceTimeSnapshot?.estimated_snapshot_at ? `Estimated snapshot: ${serviceTimeSnapshot.estimated_snapshot_at}` : undefined}
                >
                  Est. {formatMinutesShort(estimatedMinutes)}
                </Badge>
              )}
              {actualLaborMinutes > 0 && (
                <Badge
                  variant="secondary"
                  className="text-xs tabular-nums whitespace-nowrap"
                  title={serviceTimeSnapshot?.actual_snapshot_at ? `Actual snapshot: ${serviceTimeSnapshot.actual_snapshot_at}` : undefined}
                >
                  Actual {formatMinutesShort(actualLaborMinutes)}
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground text-sm truncate">
              {shipment.accounts?.account_name || 'No account'} • {shipment.warehouses?.name || 'No warehouse'}
            </p>
            {shipmentPendingReview && (
              <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20 p-2 text-xs text-amber-900 dark:text-amber-100">
                <div className="font-medium flex items-center gap-1">
                  <MaterialIcon name="search" size="sm" />
                  Pending review
                </div>
                <p className="mt-1 whitespace-pre-wrap">
                  {pendingReviewReason || 'This shipment has been flagged for manual review before normal processing.'}
                </p>
              </div>
            )}
            {!shipmentPendingReview && shipmentSplitRequired && (
              <div className="mt-2 rounded-md border border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20 p-2 text-xs text-blue-900 dark:text-blue-100">
                <div className="font-medium flex items-center gap-1">
                  <MaterialIcon name="call_split" size="sm" />
                  Waiting for split
                </div>
                <p className="mt-1">
                  {splitTaskCount > 0
                    ? `This shipment is blocked until ${splitTaskCount} split task(s) are completed by warehouse.`
                    : 'This shipment is blocked until required split work is completed by warehouse.'}
                </p>
              </div>
            )}
          </div>
          {['expected', 'pending'].includes(shipment.status) && (
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={() => setShowDeleteShipmentDialog(true)}
            >
              <MaterialIcon name="delete" size="md" />
            </Button>
          )}
        </div>

        {/* Right: actions */}
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Button variant="outline" size="sm" onClick={() => {
              if (!isEditing) {
                setEditCarrier(shipment.carrier || '');
                setEditTrackingNumber(shipment.tracking_number || '');
                setEditPoNumber(shipment.po_number || '');
                setEditExpectedArrival(shipment.expected_arrival_date ? new Date(shipment.expected_arrival_date) : undefined);
                if (shipment.shipment_type === 'outbound') {
                  setEditReleaseType(
                    shipment.release_type?.startsWith('will_call')
                      ? 'will_call'
                      : (shipment.release_type || 'will_call')
                  );
                  setEditReleasedTo(shipment.released_to || shipment.driver_name || shipment.release_to_name || '');
                  setEditReleaseToName(shipment.release_to_name || '');
                  setEditReleaseToEmail(shipment.release_to_email || '');
                  setEditReleaseToPhone(shipment.release_to_phone || '');
                  setEditDriverName(shipment.driver_name || '');
                  setEditDestinationName(shipment.destination_name || '');
                  setEditOriginName(shipment.origin_name || '');
                  setEditScheduledDate(shipment.scheduled_date ? new Date(shipment.scheduled_date) : undefined);
                  setEditCustomerAuthorized(!!shipment.customer_authorized);
                } else {
                  setEditReleaseType('');
                  setEditReleasedTo('');
                  setEditReleaseToName('');
                  setEditReleaseToEmail('');
                  setEditReleaseToPhone('');
                  setEditDriverName('');
                  setEditDestinationName('');
                  setEditOriginName('');
                  setEditScheduledDate(undefined);
                  setEditCustomerAuthorized(false);
                }
              }
              setIsEditing(!isEditing);
            }}>
              <MaterialIcon name="edit" size="sm" className="mr-1 sm:mr-2" />
              <span className="hidden sm:inline">{isEditing ? 'Cancel Edit' : 'Edit'}</span>
              <span className="sm:hidden">{isEditing ? 'Cancel' : 'Edit'}</span>
            </Button>
            {canAdjustServiceTime && actualLaborMinutes > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAdjustTimeOpen(true)}
                title="Adjust actual service time (manager/admin)"
              >
                <MaterialIcon name="schedule" size="sm" className="mr-1 sm:mr-2" />
                <span className="hidden sm:inline">Adjust Time</span>
                <span className="sm:hidden">Time</span>
              </Button>
            )}
            {shipment.account_id && canSeeBilling && (
              <Button variant="secondary" size="sm" onClick={() => setAddAddonDialogOpen(true)}>
                <MaterialIcon name="attach_money" size="sm" className="mr-1 sm:mr-2" />
                <span className="hidden sm:inline">Add Charge</span>
                <span className="sm:hidden">Charge</span>
              </Button>
            )}
            {/* Add Credit Button - Admin Only */}
            {shipment.account_id && canAddCredit && (
              <Button variant="secondary" size="sm" onClick={() => setAddCreditDialogOpen(true)}>
                <MaterialIcon name="money_off" size="sm" className="mr-1 sm:mr-2" />
                <span className="hidden sm:inline">Add Credit</span>
                <span className="sm:hidden">Credit</span>
              </Button>
            )}
            {/* Add Coverage button - only for inbound shipments with received items */}
            {shipment.account_id && canSeeBilling && isInbound && items.some(i => i.item_id) && (
              <Button variant="outline" size="sm" onClick={() => setCoverageDialogOpen(true)}>
                <MaterialIcon name="verified_user" size="sm" className="mr-1 sm:mr-2 text-blue-600" />
                <span className="hidden sm:inline">Add Coverage</span>
                <span className="sm:hidden">Coverage</span>
              </Button>
            )}
            {/* Reassign Account - moved to selected items bar */}
            {/* Help button for receiving workflow */}
            {isInbound && <HelpButton workflow="receiving" />}
          </div>
        </div>
      </div>

      <StatusBar
        statusKey={shipmentStatusBarKey}
        contextLabel={shipmentContextLabel}
        labelOverride={shipmentStatusLabel}
      >
        {statusBarActions}
      </StatusBar>

      <div className="mt-6 flex flex-col gap-6">
      {/* Outbound Scanning */}
      {isOutbound && (pullSessionActive || releaseSessionActive) && (
        <Card className="order-20 border-primary/40">
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle>Outbound Scanning</CardTitle>
                <CardDescription>
                  {pullSessionActive
                    ? 'Scan each item to stage it at Outbound Dock.'
                    : 'Scan each item to mark it Released.'}
                </CardDescription>
              </div>
              <div className="text-sm text-muted-foreground">
                {activeOutboundItems.length} item{activeOutboundItems.length !== 1 ? 's' : ''} •
                {' '}
                {pullSessionActive ? 'Staged' : 'Released'} {pullSessionActive ? activeOutboundItems.filter(item => isOutboundDock(item.item?.current_location?.code)).length : activeOutboundItems.filter(item => isReleasedLocation(item.item?.current_location?.code)).length}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
              <div className="space-y-4">
                <QRScanner
                  onScan={outboundScanEngine.onScan}
                  onError={() => {
                    setLastScan({ itemCode: '', result: 'error', message: 'Scanner error. Please try again.' });
                    outboundScanEngine.block({
                      title: 'SCAN ERROR',
                      reason: 'CAMERA SCANNER ERROR',
                      code: '',
                    });
                  }}
                  // Keep camera open; scan engine blocks processing when needed.
                  scanning
                  paused={outboundScanEngine.isOverlayBlocked}
                  blockingOverlay={
                    outboundScanEngine.overlay
                      ? {
                          open: true,
                          title: outboundScanEngine.overlay.title,
                          reason: outboundScanEngine.overlay.reason,
                          code: outboundScanEngine.overlay.code,
                          hint: 'Tap to dismiss',
                          dismissLabel: 'Dismiss / Continue Scanning',
                          onDismiss: outboundScanEngine.dismissOverlay,
                        }
                      : null
                  }
                />
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    value={manualScanValue}
                    onChange={(e) => setManualScanValue(e.target.value)}
                    placeholder="Enter or scan item code"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        outboundScanEngine.onScan(manualScanValue);
                        setManualScanValue('');
                      }
                    }}
                  />
                  <Button
                    onClick={() => {
                      outboundScanEngine.onScan(manualScanValue);
                      setManualScanValue('');
                    }}
                    disabled={!manualScanValue.trim() || processingScan}
                  >
                    Scan
                  </Button>
                </div>
              </div>
              <div className="space-y-4">
                {lastScan && (
                  <div className={cn(
                    'rounded-lg border p-3 text-sm',
                    lastScan.result === 'success' && 'border-green-500/40 bg-green-500/10 text-green-500',
                    lastScan.result === 'duplicate' && 'border-yellow-500/40 bg-yellow-500/10 text-yellow-500',
                    (lastScan.result === 'invalid' || lastScan.result === 'error') && 'border-red-500/40 bg-red-500/10 text-red-500'
                  )}>
                    <p className="font-semibold">{lastScan.itemCode || 'Scan Result'}</p>
                    <p>{lastScan.message}</p>
                  </div>
                )}
                <div className="space-y-2">
                  <Label className="text-sm">Manual override</Label>
                  <div className="max-h-[min(16rem,45vh)] overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y rounded-md border pr-1 scrollbar-thin">
                    {(() => {
                      const overrideCandidates = pullSessionActive
                        ? activeOutboundItems.filter(item => !isOutboundDock(item.item?.current_location?.code))
                        : activeOutboundItems.filter(item => !isReleasedLocation(item.item?.current_location?.code));

                      if (overrideCandidates.length === 0) {
                        return (
                          <p className="text-xs text-muted-foreground p-2">
                            All items already {pullSessionActive ? 'pulled' : 'released'}.
                          </p>
                        );
                      }

                      const selectableIds = overrideCandidates
                        .map(item => item.item?.id)
                        .filter(Boolean) as string[];

                      const allSelected =
                        selectableIds.length > 0 && selectableIds.every((id) => manualOverrideItemIds.has(id));

                      const compare = (a: string, b: string) =>
                        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

                      const dir = scanListSortDirection === 'asc' ? 1 : -1;
                      const getItemCode = (si: ShipmentItem) =>
                        (si.item?.item_code || si.expected_description || '').trim();
                      const getLocationCode = (si: ShipmentItem) =>
                        (si.item?.current_location?.code || '').trim();

                      const sortedCandidates = [...overrideCandidates].sort((a, b) => {
                        const aVal = scanListSortField === 'location' ? getLocationCode(a) : getItemCode(a);
                        const bVal = scanListSortField === 'location' ? getLocationCode(b) : getItemCode(b);
                        return compare(aVal, bVal) * dir;
                      });

                      const toggleSort = (field: ScanListSortField) => {
                        if (scanListSortField === field) {
                          setScanListSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
                        } else {
                          setScanListSortField(field);
                          setScanListSortDirection('asc');
                        }
                      };

                      const sortIconName =
                        scanListSortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward';

                      return (
                        <>
                          <div className="sticky top-0 z-10 bg-background px-2 py-1 border-b">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <Checkbox
                                  checked={allSelected}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      setManualOverrideItemIds(new Set(selectableIds));
                                    } else {
                                      setManualOverrideItemIds(new Set());
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  className="text-xs font-medium inline-flex items-center gap-1 hover:underline"
                                  onClick={() => toggleSort('item_code')}
                                >
                                  Item Code
                                  {scanListSortField === 'item_code' && (
                                    <MaterialIcon name={sortIconName} size="sm" className="opacity-70" />
                                  )}
                                </button>
                                <span className="text-xs text-muted-foreground">
                                  ({overrideCandidates.length})
                                </span>
                              </div>
                              <button
                                type="button"
                                className="text-xs font-medium inline-flex items-center gap-1 hover:underline"
                                onClick={() => toggleSort('location')}
                              >
                                Location
                                {scanListSortField === 'location' && (
                                  <MaterialIcon name={sortIconName} size="sm" className="opacity-70" />
                                )}
                              </button>
                            </div>
                          </div>
                          <div className="p-2 space-y-1">
                            {sortedCandidates.map(item => (
                              <div key={item.id} className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <Checkbox
                                    checked={!!item.item?.id && manualOverrideItemIds.has(item.item.id)}
                                    onCheckedChange={(checked) => {
                                      if (!item.item?.id) return;
                                      setManualOverrideItemIds(prev => {
                                        const next = new Set(prev);
                                        if (checked) {
                                          next.add(item.item!.id);
                                        } else {
                                          next.delete(item.item!.id);
                                        }
                                        return next;
                                      });
                                    }}
                                  />
                                  <span className="text-sm font-mono truncate">
                                    {item.item?.item_code || item.expected_description || 'Unknown item'}
                                  </span>
                                </div>
                                <span className="text-xs font-mono text-muted-foreground">
                                  {item.item?.current_location?.code || '-'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                  {manualOverrideItemIds.size > 0 && (
                    <p className="text-xs text-muted-foreground">{manualOverrideItemIds.size} item{manualOverrideItemIds.size > 1 ? 's' : ''} selected</p>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => handleManualOverride(pullSessionActive ? 'pull' : 'release')}
                    disabled={manualOverrideItemIds.size === 0}
                  >
                    Mark {pullSessionActive ? 'Pulled' : 'Released'} ({manualOverrideItemIds.size})
                  </Button>
                </div>
                {releaseSessionActive && (
                  <Button variant="destructive" onClick={() => setShowPartialReleaseDialog(true)}>
                    Partial Release / Remove Items
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit Mode */}
      {isEditing && (
        <Card className="order-5 border-primary/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Edit Shipment</CardTitle>
            <CardDescription>Update shipment details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Outbound-specific fields (legacy outbound system parity) */}
            {isOutbound && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Release Type</Label>
                  <Select value={editReleaseType} onValueChange={setEditReleaseType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select release type" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[min(18rem,50vh)]">
                      <SelectItem value="will_call">Will Call (Pickup/Release)</SelectItem>
                      <SelectItem value="disposal">Disposal</SelectItem>
                      <SelectItem value="return">Return to Sender</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Released To / Driver Name</Label>
                  <Input
                    value={editReleasedTo}
                    onChange={(e) => setEditReleasedTo(e.target.value)}
                    placeholder="Name of person picking up / driver"
                  />
                </div>

                <div className="sm:col-span-2 flex items-center gap-3 rounded-md border p-3">
                  <Checkbox
                    id="customer-authorized"
                    checked={editCustomerAuthorized}
                    onCheckedChange={(checked) => setEditCustomerAuthorized(checked === true)}
                  />
                  <div>
                    <Label htmlFor="customer-authorized" className="cursor-pointer font-medium">
                      Customer Authorized
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Mark when the client approved this outbound release (portal, email, or phone).
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Carrier</Label>
                <Input
                  value={editCarrier}
                  onChange={(e) => setEditCarrier(e.target.value)}
                  placeholder="e.g., FedEx, UPS, Local Delivery"
                />
              </div>
              <div className="space-y-2">
                <Label>Tracking Number</Label>
                <Input
                  value={editTrackingNumber}
                  onChange={(e) => setEditTrackingNumber(e.target.value)}
                  placeholder="Enter tracking number"
                />
              </div>
              <div className="space-y-2">
                <Label>PO Number</Label>
                <Input
                  value={editPoNumber}
                  onChange={(e) => setEditPoNumber(e.target.value)}
                  placeholder="Enter PO number"
                />
              </div>
              <div className="space-y-2">
                <Label>{isOutbound ? 'Expected Pickup/Ship Date' : 'Expected Arrival'}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        'w-full justify-start text-left font-normal',
                        !editExpectedArrival && 'text-muted-foreground'
                      )}
                    >
                      <MaterialIcon name="calendar_today" size="sm" className="mr-2" />
                      {editExpectedArrival ? format(editExpectedArrival, 'PPP') : 'Select date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={editExpectedArrival}
                      onSelect={setEditExpectedArrival}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              {isOutbound ? (
                <Tabs value={outboundNotesTab} onValueChange={(v) => setOutboundNotesTab(v as any)} className="w-full">
                  <TabsList className="grid w-full grid-cols-3 h-auto">
                    <TabsTrigger
                      value="public"
                      className="gap-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                    >
                      <MaterialIcon name="public" size="sm" />
                      Public
                    </TabsTrigger>
                    <TabsTrigger
                      value="internal"
                      className="gap-2 data-[state=active]:bg-amber-600 data-[state=active]:text-white"
                    >
                      <MaterialIcon name="lock" size="sm" />
                      Internal
                    </TabsTrigger>
                    <TabsTrigger
                      value="exceptions"
                      className="gap-2 data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground"
                    >
                      <MaterialIcon name="warning" size="sm" />
                      Exceptions
                      {outboundOpenExceptionCount > 0 && (
                        <Badge variant="destructive" className="ml-1 h-5 min-w-5 text-xs">
                          {outboundOpenExceptionCount}
                        </Badge>
                      )}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="public" className="mt-2">
                    <ShipmentNotesSection
                      shipmentId={shipment.id}
                      accountId={shipment.account_id}
                      embedded
                      forcedNoteType="public"
                    />
                  </TabsContent>

                  <TabsContent value="internal" className="mt-2">
                    <ShipmentNotesSection
                      shipmentId={shipment.id}
                      accountId={shipment.account_id}
                      embedded
                      forcedNoteType="internal"
                    />
                  </TabsContent>

                  <TabsContent value="exceptions" className="mt-2 space-y-3">
                    <ShipmentNotesSection
                      shipmentId={shipment.id}
                      accountId={shipment.account_id}
                      embedded
                      forcedNoteType="exception"
                    />
                    <ShipmentExceptionsChips
                      shipmentId={shipment.id}
                      showHistory={true}
                      missingNoteCodes={missingExceptionNoteCodes}
                      onMissingNoteCodeFilled={(code) =>
                        setMissingExceptionNoteCodes((prev) => prev.filter((c) => c !== code))
                      }
                    />
                  </TabsContent>
                </Tabs>
              ) : (
                <ShipmentNotesSection
                  shipmentId={shipment.id}
                  accountId={shipment.account_id}
                  embedded
                />
              )}
            </div>

            {/* Outbound-specific fields */}
            {isOutbound && (
              <>
                <div className="pt-4 border-t">
                  <h4 className="font-medium text-sm mb-3">Outbound / Release Details</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Contact Name</Label>
                      <Input
                        value={editReleaseToName}
                        onChange={(e) => setEditReleaseToName(e.target.value)}
                        placeholder="Contact person name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Contact Email</Label>
                      <Input
                        type="email"
                        value={editReleaseToEmail}
                        onChange={(e) => setEditReleaseToEmail(e.target.value)}
                        placeholder="email@example.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Contact Phone</Label>
                      <Input
                        type="tel"
                        value={editReleaseToPhone}
                        onChange={(e) => setEditReleaseToPhone(e.target.value)}
                        placeholder="Phone number"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Driver Name</Label>
                      <Input
                        value={editDriverName}
                        onChange={(e) => setEditDriverName(e.target.value)}
                        placeholder="Driver or pickup person name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Scheduled Date</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              'w-full justify-start text-left font-normal',
                              !editScheduledDate && 'text-muted-foreground'
                            )}
                          >
                            <MaterialIcon name="calendar_today" size="sm" className="mr-2" />
                            {editScheduledDate ? format(editScheduledDate, 'PPP') : 'Select date'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={editScheduledDate}
                            onSelect={setEditScheduledDate}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-2">
                      <Label>Origin Name</Label>
                      <Input
                        value={editOriginName}
                        onChange={(e) => setEditOriginName(e.target.value)}
                        placeholder="Pickup location or origin"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Destination Name</Label>
                      <Input
                        value={editDestinationName}
                        onChange={(e) => setEditDestinationName(e.target.value)}
                        placeholder="Delivery location or destination"
                      />
                    </div>
                  </div>
                </div>
              </>
            )}

            <div className="flex gap-2">
              <SaveButton
                onClick={async () => {
                  const updates: Record<string, unknown> = {
                    carrier: editCarrier.trim() || null,
                    tracking_number: editTrackingNumber.trim() || null,
                    po_number: editPoNumber.trim() || null,
                    expected_arrival_date: editExpectedArrival?.toISOString() || null,
                  };

                  // Add outbound-specific fields if this is an outbound shipment
                  if (isOutbound) {
                    updates.release_type = editReleaseType || null;
                    updates.released_to = editReleasedTo.trim() || null;
                    updates.release_to_name = editReleaseToName.trim() || null;
                    updates.release_to_email = editReleaseToEmail.trim() || null;
                    updates.release_to_phone = editReleaseToPhone.trim() || null;
                    updates.driver_name = editDriverName.trim() || null;
                    updates.destination_name = editDestinationName.trim() || null;
                    updates.origin_name = editOriginName.trim() || null;
                    updates.scheduled_date = editScheduledDate?.toISOString() || null;

                    const wasCustomerAuthorized = !!shipment.customer_authorized;
                    updates.customer_authorized = editCustomerAuthorized;
                    if (editCustomerAuthorized !== wasCustomerAuthorized) {
                      if (editCustomerAuthorized) {
                        updates.customer_authorized_at = new Date().toISOString();
                        updates.customer_authorized_by = profile?.id || null;
                      } else {
                        updates.customer_authorized_at = null;
                        updates.customer_authorized_by = null;
                      }
                    }
                  }

                  const { error } = await supabase
                    .from('shipments')
                    .update(updates)
                    .eq('id', shipment.id);
                  if (error) throw error;
                  
                  await logShipmentAudit('shipment_updated', updates);
                  toast({ title: 'Shipment Updated' });
                  fetchShipment();
                  setIsEditing(false);
                }}
                label="Save Changes"
                savedLabel="Saved"
              />
              <Button variant="outline" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="order-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        {/* Shipment Details */}
        <Card>
          <CardHeader>
            <CardTitle>Shipment Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <Label className="text-muted-foreground">Type</Label>
                <p className="font-medium capitalize">{shipment.shipment_type}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Carrier</Label>
                <p className="font-medium">{shipment.carrier || '-'}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Tracking</Label>
                <p className="font-medium">{shipment.tracking_number || '-'}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">PO Number</Label>
                <p className="font-medium">{shipment.po_number || '-'}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">
                  {isOutbound ? 'Expected Pickup/Ship Date' : 'Expected Arrival'}
                </Label>
                <p className="font-medium">
                  {shipment.expected_arrival_date
                    ? format(new Date(shipment.expected_arrival_date), 'MMM d, yyyy')
                    : '-'}
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">
                  {isOutbound ? 'Released To' : 'Received At'}
                </Label>
                <p className="font-medium">
                  {isOutbound
                    ? shipment.released_to || shipment.driver_name || shipment.release_to_name || '-'
                    : shipment.received_at
                      ? format(new Date(shipment.received_at), 'MMM d, yyyy h:mm a')
                      : '-'}
                </p>
              </div>
              {isOutbound && (
                <div>
                  <Label className="text-muted-foreground">Release Type</Label>
                  <p className="font-medium capitalize">{shipment.release_type?.replace(/_/g, ' ') || '-'}</p>
                </div>
              )}
              {isOutbound && (
                <div>
                  <Label className="text-muted-foreground">Customer Authorized</Label>
                  <p className="font-medium">
                    {shipment.customer_authorized ? (
                      <Badge variant="outline" className="text-green-600 border-green-300">Authorized</Badge>
                    ) : (
                      <Badge variant="outline" className="text-yellow-600 border-yellow-300">Not Authorized</Badge>
                    )}
                  </p>
                </div>
              )}
            </div>

            {/* Outbound-specific fields */}
            {isOutbound && (
              <div className="border-t pt-4 mt-4">
                <h4 className="font-medium text-sm mb-3">Release Details</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  {shipment.release_to_name && (
                    <div>
                      <Label className="text-muted-foreground">Contact Name</Label>
                      <p className="font-medium">{shipment.release_to_name}</p>
                    </div>
                  )}
                  {shipment.release_to_email && (
                    <div>
                      <Label className="text-muted-foreground">Contact Email</Label>
                      <p className="font-medium">{shipment.release_to_email}</p>
                    </div>
                  )}
                  {shipment.release_to_phone && (
                    <div>
                      <Label className="text-muted-foreground">Contact Phone</Label>
                      <p className="font-medium">{shipment.release_to_phone}</p>
                    </div>
                  )}
                  {shipment.driver_name && (
                    <div>
                      <Label className="text-muted-foreground">Driver Name</Label>
                      <p className="font-medium">{shipment.driver_name}</p>
                    </div>
                  )}
                  {shipment.scheduled_date && (
                    <div>
                      <Label className="text-muted-foreground">Scheduled Date</Label>
                      <p className="font-medium">
                        {format(new Date(shipment.scheduled_date), 'MMM d, yyyy')}
                      </p>
                    </div>
                  )}
                  {shipment.origin_name && (
                    <div>
                      <Label className="text-muted-foreground">Origin</Label>
                      <p className="font-medium">{shipment.origin_name}</p>
                    </div>
                  )}
                  {shipment.destination_name && (
                    <div>
                      <Label className="text-muted-foreground">Destination</Label>
                      <p className="font-medium">{shipment.destination_name}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-2" ref={outboundNotesRef}>
              <Label className="text-muted-foreground">Notes</Label>
              {isOutbound ? (
                <Tabs value={outboundNotesTab} onValueChange={(v) => setOutboundNotesTab(v as any)} className="w-full">
                  <TabsList className="grid w-full grid-cols-3 h-auto">
                    <TabsTrigger
                      value="public"
                      className="gap-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                    >
                      <MaterialIcon name="public" size="sm" />
                      Public
                    </TabsTrigger>
                    <TabsTrigger
                      value="internal"
                      className="gap-2 data-[state=active]:bg-amber-600 data-[state=active]:text-white"
                    >
                      <MaterialIcon name="lock" size="sm" />
                      Internal
                    </TabsTrigger>
                    <TabsTrigger
                      value="exceptions"
                      className="gap-2 data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground"
                    >
                      <MaterialIcon name="warning" size="sm" />
                      Exceptions
                      {outboundOpenExceptionCount > 0 && (
                        <Badge variant="destructive" className="ml-1 h-5 min-w-5 text-xs">
                          {outboundOpenExceptionCount}
                        </Badge>
                      )}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="public" className="mt-2">
                    <ShipmentNotesSection
                      shipmentId={shipment.id}
                      accountId={shipment.account_id}
                      embedded
                      forcedNoteType="public"
                    />
                  </TabsContent>

                  <TabsContent value="internal" className="mt-2">
                    <ShipmentNotesSection
                      shipmentId={shipment.id}
                      accountId={shipment.account_id}
                      embedded
                      forcedNoteType="internal"
                    />
                  </TabsContent>

                  <TabsContent value="exceptions" className="mt-2 space-y-3">
                    <ShipmentNotesSection
                      shipmentId={shipment.id}
                      accountId={shipment.account_id}
                      embedded
                      forcedNoteType="exception"
                    />
                    <ShipmentExceptionsChips
                      shipmentId={shipment.id}
                      showHistory={true}
                      missingNoteCodes={missingExceptionNoteCodes}
                      onMissingNoteCodeFilled={(code) =>
                        setMissingExceptionNoteCodes((prev) => prev.filter((c) => c !== code))
                      }
                    />
                  </TabsContent>
                </Tabs>
              ) : (
                <ShipmentNotesSection shipmentId={shipment.id} accountId={shipment.account_id} embedded />
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {canSeeBilling && shipment.account_id && (
            <BillingCalculator
              shipmentId={shipment.id}
              shipmentDirection={shipment.shipment_type as 'inbound' | 'outbound' | 'return'}
              refreshKey={billingRefreshKey}
              title="Billing Calculator"
            />
          )}

        {/* Quick Info / Summary */}
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Expected Items</span>
              <span className="font-medium">{items.length}</span>
            </div>
            {isOutbound ? (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Released Items</span>
                  <span className="font-medium">
                    {items.filter(i => i.status === 'released').length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Released At</span>
                  <span className="font-medium">
                    {shipment.signature_timestamp
                      ? format(new Date(shipment.signature_timestamp), 'MMM d, yyyy h:mm a')
                      : shipment.shipped_at
                        ? format(new Date(shipment.shipped_at), 'MMM d, yyyy h:mm a')
                        : '-'}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Received Items</span>
                <span className="font-medium">
                  {items.filter(i => i.status === 'received').length}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created</span>
              <span className="font-medium">
                {format(new Date(shipment.created_at), 'MMM d, yyyy')}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Inbound dock-intake signature (carrier sign-for) */}
        {!isOutbound && (shipment.signature_data || shipment.signature_name) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MaterialIcon name="draw" size="sm" />
                Signature
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="border rounded-md p-2 bg-white">
                {shipment.signature_data ? (
                  <img
                    src={shipment.signature_data}
                    alt="Signature"
                    className="max-h-24 mx-auto"
                  />
                ) : (
                  <div className="min-h-24 flex items-center justify-center">
                    <span className="text-3xl font-cursive italic text-gray-800">
                      {(shipment.signature_name || '').trim()}
                    </span>
                  </div>
                )}
              </div>
              <div className="text-sm text-muted-foreground">
                <div>
                  Signed by:{' '}
                  <span className="text-foreground">
                    {(shipment.signature_name || '').trim() || '—'}
                  </span>
                </div>
                {shipment.signature_timestamp ? (
                  <div>
                    Signed at:{' '}
                    <span className="text-foreground">
                      {format(new Date(shipment.signature_timestamp), 'MMM d, yyyy h:mm a')}
                    </span>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        )}
        </div>
      </div>
      {/* Shipment Items */}
      <Card className="order-30">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle>Items</CardTitle>
              <CardDescription>Expected and received items for this shipment</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Add Items button for inbound/return shipments that are not completed */}
              {(shipment.shipment_type === 'inbound' || shipment.shipment_type === 'return') &&
               shipment.status !== 'completed' && shipment.status !== 'cancelled' && (
                <Button variant="outline" size="sm" onClick={() => setAddItemDialogOpen(true)}>
                  <MaterialIcon name="add" size="sm" className="mr-1 sm:mr-2" />
                  <span className="hidden sm:inline">Add Items</span>
                  <span className="sm:hidden">Add</span>
                </Button>
              )}
            {/* Create Task from selected items */}
            {selectedItemIds.size > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">{selectedItemIds.size} selected</span>
                <Select value={selectedTaskType} onValueChange={setSelectedTaskType}>
                  <SelectTrigger className="w-[130px] sm:w-[160px]">
                    <SelectValue placeholder="Task type..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-[min(18rem,50vh)]">
                    <SelectItem value="Inspection">Inspection</SelectItem>
                    <SelectItem value="Assembly">Assembly</SelectItem>
                    <SelectItem value="Repair">Repair</SelectItem>
                    <SelectItem value="Disposal">Disposal</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  onClick={handleCreateTask}
                  disabled={!selectedTaskType}
                >
                  <MaterialIcon name="assignment" size="sm" className="mr-1 sm:mr-2" />
                  <span className="hidden sm:inline">Create Task</span>
                  <span className="sm:hidden">Create</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCreateOutbound}
                >
                  <MaterialIcon name="local_shipping" size="sm" className="mr-1 sm:mr-2" />
                  <span className="hidden sm:inline">Outbound</span>
                  <span className="sm:hidden">Outbound</span>
                </Button>
                {shipment.account_id && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowReassignDialog(true)}
                  >
                    <MaterialIcon name="swap_horiz" size="sm" className="mr-1 sm:mr-2" />
                    <span className="hidden sm:inline">Reassign</span>
                    <span className="sm:hidden">Reassign</span>
                  </Button>
                )}
              </div>
            )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={items.filter(i => i.item?.id).length > 0 && selectedItemIds.size === items.filter(i => i.item?.id).length}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead className="w-10"></TableHead>
                {shipmentItemVisibleColumns.map((col) => (
                  <TableHead key={col}>{getColumnLabel(itemDisplaySettings, col)}</TableHead>
                ))}
                <TableHead className="w-24">Class</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-20"></TableHead>
                <TableHead className="w-8">
                  <div className="flex justify-end">
                    <ItemColumnsPopover
                      settings={itemDisplaySettings}
                      baseSettings={tenantItemDisplaySettings}
                      viewId={defaultItemViewId || itemDisplaySettings.views[0]?.id || 'default'}
                      disabled={itemDisplayLoading || itemDisplaySaving || itemDisplaySettings.views.length === 0}
                      onSave={saveItemDisplaySettings}
                      compact
                    />
                  </div>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={shipmentItemsTableColSpan} className="text-center text-muted-foreground py-8">
                    No items in this shipment
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <ShipmentItemRow
                    key={item.id}
                    item={item as ShipmentItemRowData}
                    isSelected={item.item?.id ? selectedItemIds.has(item.item.id) : false}
                    visibleColumns={shipmentItemVisibleColumns}
                    onSelect={(checked) => {
                      if (item.item?.id) {
                        if (checked) {
                          setSelectedItemIds(prev => new Set([...prev, item.item!.id]));
                        } else {
                          setSelectedItemIds(prev => {
                            const next = new Set(prev);
                            next.delete(item.item!.id);
                            return next;
                          });
                        }
                      }
                    }}
                    onUpdate={fetchShipment}
                    onDelete={() => fetchShipment()}
                    onDuplicate={handleDuplicateItem}
                    isInbound={isInbound}
                    isCompleted={shipment.status === 'completed' || shipment.status === 'cancelled' || shipment.status === 'shipped'}
                    classes={classes}
                    accountId={shipment.account_id || undefined}
                  />
                ))
              )}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      {/* Photos Section */}
      <Card className="order-40">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle>Photos</CardTitle>
            <CardDescription>Capture or upload photos</CardDescription>
          </div>
          <div className="flex gap-2">
            <PhotoScannerButton
              entityType="shipment"
              entityId={shipment.id}
              tenantId={profile?.tenant_id}
              existingPhotos={getPhotoUrls(receivingPhotos)}
              maxPhotos={20}
              onPhotosSaved={async (urls) => {
                // Convert new URLs to TaggablePhoto format and merge with existing
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
                await supabase
                  .from('shipments')
                  .update({ receiving_photos: allPhotos as unknown as Json })
                  .eq('id', shipment.id);
              }}
              label="Photo"
              size="sm"
            />
            <PhotoUploadButton
              entityType="shipment"
              entityId={shipment.id}
              tenantId={profile?.tenant_id}
              existingPhotos={getPhotoUrls(receivingPhotos)}
              maxPhotos={20}
              size="sm"
              onPhotosSaved={async (urls) => {
                // Convert new URLs to TaggablePhoto format and merge with existing
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
                await supabase
                  .from('shipments')
                  .update({ receiving_photos: allPhotos as unknown as Json })
                  .eq('id', shipment.id);
              }}
            />
          </div>
        </CardHeader>
        <CardContent>
          {receivingPhotos.length > 0 ? (
            <TaggablePhotoGrid
              photos={receivingPhotos}
              onPhotosChange={async (photos) => {
                setReceivingPhotos(photos);
                await supabase
                  .from('shipments')
                  .update({ receiving_photos: photos as unknown as Json })
                  .eq('id', shipment.id);
              }}
              enableTagging={true}
            />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">
              No photos yet. Tap "Take Photos" to capture.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Documents Section */}
      <Card className="order-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MaterialIcon name="description" size="sm" />
            Documents
            <Badge variant="outline">{documents.length}</Badge>
          </CardTitle>
          <CardDescription>
            Capture or upload paperwork and supporting shipment documents.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DocumentCapture
            refetchKey={documentRefreshKey}
            context={{ type: 'shipment', shipmentId: shipment.id, shipmentNumber: shipment.shipment_number }}
            maxDocuments={12}
            ocrEnabled={true}
            onDocumentAdded={() => {
              void refetchDocuments();
            }}
            onDocumentRemoved={() => {
              void refetchDocuments();
            }}
          />
        </CardContent>
      </Card>

      {/* Shipment Activity - Comprehensive timeline of all events */}
      <div className="order-70">
        <EntityActivityFeed entityType="shipment" entityId={shipment.id} title="Activity" description="Complete timeline of billing, operations, and status changes for this shipment" />
      </div>
      </div>

      {/* Finish Receiving Dialog */}
      <AlertDialog open={showFinishDialog} onOpenChange={setShowFinishDialog}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Finish Receiving</AlertDialogTitle>
            <AlertDialogDescription>
              Verify the quantities received for each item. This will create inventory items.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="max-h-96 overflow-y-auto overflow-x-hidden overscroll-contain pr-1 scrollbar-thin">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-center">Expected</TableHead>
                  <TableHead className="text-center w-32">Received</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receivedItems.map((item) => (
                  <TableRow key={item.shipment_item_id}>
                    <TableCell>{item.expected_description || '-'}</TableCell>
                    <TableCell className="text-center">{item.expected_quantity}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        value={item.actual_quantity}
                        onChange={(e) => updateReceivedQuantity(
                          item.shipment_item_id,
                          parseInt(e.target.value) || 0
                        )}
                        className="w-20 text-center mx-auto"
                      />
                    </TableCell>
                    <TableCell>
                      <StatusIndicator status={item.status} size="sm" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {receivedItems.some(i => i.status !== 'received') && (
            <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-950 rounded-md text-sm">
              <MaterialIcon name="warning" size="sm" className="text-yellow-600" />
              <span>Some items have discrepancies. These will be flagged for review.</span>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleFinishReceiving}>
              Complete Receiving
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Print Labels Dialog */}
      <PrintLabelsDialog
        open={showPrintLabelsDialog}
        onOpenChange={setShowPrintLabelsDialog}
        items={createdItemsForLabels}
        title="Print Item Labels"
        description={`${createdItemsForLabels.length} items were created from receiving. Print labels now?`}
      />

      {/* Add Charge Dialog - Manager/Admin Only */}
      {shipment.account_id && canSeeBilling && (
        <AddAddonDialog
          open={addAddonDialogOpen}
          onOpenChange={setAddAddonDialogOpen}
          accountId={shipment.account_id}
          accountName={shipment.accounts?.account_name}
          shipmentId={shipment.id}
          onSuccess={() => {
            fetchShipment();
            setBillingRefreshKey(prev => prev + 1);
          }}
        />
      )}

      {/* Add Credit Dialog - Admin Only */}
      {shipment.account_id && canAddCredit && (
        <AddCreditDialog
          open={addCreditDialogOpen}
          onOpenChange={setAddCreditDialogOpen}
          accountId={shipment.account_id}
          accountName={shipment.accounts?.account_name}
          shipmentId={shipment.id}
          onSuccess={() => {
            fetchShipment();
            setBillingRefreshKey(prev => prev + 1);
          }}
        />
      )}

      {/* Shipment Coverage Dialog - Manager/Admin Only */}
      {shipment.account_id && canSeeBilling && (
        <ShipmentCoverageDialog
          open={coverageDialogOpen}
          onOpenChange={setCoverageDialogOpen}
          shipmentId={shipment.id}
          accountId={shipment.account_id}
          shipmentNumber={shipment.shipment_number}
          itemCount={items.length}
          onSuccess={() => {
            fetchShipment();
            setBillingRefreshKey(prev => prev + 1);
          }}
        />
      )}

      {/* Add Item Dialog for Inbound Shipments */}
      <AddShipmentItemDialog
        open={addItemDialogOpen}
        onOpenChange={setAddItemDialogOpen}
        shipmentId={shipment.id}
        accountId={shipment.account_id || undefined}
        warehouseId={shipment.warehouse_id || undefined}
        sidemarkId={shipment.sidemark_id || undefined}
        tenantId={profile?.tenant_id}
        classes={classes}
        onSuccess={() => {
          fetchShipment();
        }}
      />

      {/* Service time adjustment (manager/admin) */}
      <ServiceTimeAdjustmentDialog
        open={adjustTimeOpen}
        onOpenChange={setAdjustTimeOpen}
        jobType="shipment"
        jobId={shipment.id}
        currentMinutes={actualLaborMinutes > 0 ? actualLaborMinutes : null}
        onSaved={() => {
          fetchShipment();
        }}
      />

      {/* Outbound timer: pause existing job confirmation */}
      <AlertDialog open={outboundTimerConfirmOpen} onOpenChange={setOutboundTimerConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause current job?</AlertDialogTitle>
            <AlertDialogDescription>
              It looks like you already have a job in progress{outboundTimerActiveJobLabel ? ` (${outboundTimerActiveJobLabel})` : ''}.
              Do you want to pause it and start this outbound step?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setOutboundTimerActiveJobLabel(null);
                setOutboundTimerPendingMode(null);
              }}
              disabled={outboundTimerConfirmLoading}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async (e) => {
                e.preventDefault();
                if (!shipment || !outboundTimerPendingMode) return;

                // Re-check minimal prerequisites
                if (outboundTimerPendingMode === 'pull' && !outboundDockLocation?.id) {
                  toast({
                    variant: 'destructive',
                    title: 'Outbound Dock missing',
                    description: 'Create an OUTBOUND-DOCK location before starting the pull.',
                  });
                  return;
                }
                if (outboundTimerPendingMode === 'release') {
                  if (!allPulled) {
                    toast({
                      variant: 'destructive',
                      title: 'Items not staged',
                      description: 'All items must be at Outbound Dock before release scanning.',
                    });
                    return;
                  }
                  if (!releasedLocation?.id) {
                    toast({
                      variant: 'destructive',
                      title: 'Released location missing',
                      description: 'Create a RELEASED (or type Release) location before starting the release scan.',
                    });
                    return;
                  }
                }

                setOutboundTimerConfirmLoading(true);
                try {
                  const ok = await tryStartOutboundTimer(outboundTimerPendingMode, true);
                  if (!ok) return;

                  await beginOutboundMode(outboundTimerPendingMode);
                  toast({ title: 'Started', description: 'Paused your previous job and started this step.' });

                  setOutboundTimerConfirmOpen(false);
                  setOutboundTimerActiveJobLabel(null);
                  setOutboundTimerPendingMode(null);
                } finally {
                  setOutboundTimerConfirmLoading(false);
                }
              }}
              disabled={outboundTimerConfirmLoading}
            >
              Pause & Start
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Shipment Dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Shipment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this shipment? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Shipment</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelShipment}
              disabled={cancelling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelling ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Cancelling...
                </>
              ) : (
                'Cancel Shipment'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Outbound Completion Dialog */}
      <AlertDialog open={showOutboundCompleteDialog} onOpenChange={setShowOutboundCompleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Complete Shipment</AlertDialogTitle>
            <AlertDialogDescription>
              This will release {items.length} item(s) and mark the shipment as shipped.
              {receivingPhotos.length === 0 && (
                <span className="block mt-2 text-destructive font-medium">
                  Note: At least one photo is required to complete this shipment.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCompleteOutbound}
              disabled={completingOutbound || receivingPhotos.length === 0}
            >
              {completingOutbound ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Completing...
                </>
              ) : (
                'Complete Shipment'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Partial Release Dialog */}
      <AlertDialog open={showPartialReleaseDialog} onOpenChange={setShowPartialReleaseDialog}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Partial Release</AlertDialogTitle>
            <AlertDialogDescription>
              Select items to remove from this shipment and add a required note.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4">
            <div className="space-y-2 max-h-64 overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y rounded-md border p-3 pr-2 scrollbar-thin">
              {partialReleaseCandidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">All items are already released.</p>
              ) : (
                partialReleaseCandidates.map(item => (
                  <div key={item.id} className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={partialReleaseItems.has(item.id)}
                        onCheckedChange={(checked) => {
                          setPartialReleaseItems(prev => {
                            const next = new Set(prev);
                            if (checked) {
                              next.add(item.id);
                            } else {
                              next.delete(item.id);
                            }
                            return next;
                          });
                        }}
                      />
                      <div className="text-sm">
                        <p className="font-medium">{item.item?.item_code || item.expected_description || 'Unknown item'}</p>
                        <p className="text-muted-foreground">
                          Location: {item.item?.current_location?.code || '-'}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="space-y-2">
              <Label>Required note</Label>
              <Textarea
                value={partialReleaseNote}
                onChange={(e) => setPartialReleaseNote(e.target.value)}
                placeholder="Explain why items are not being released..."
                rows={3}
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSubmitPartialRelease}
              disabled={submittingPartialRelease || partialReleaseItems.size === 0 || !partialReleaseNote.trim()}
            >
              {submittingPartialRelease ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Remove Selected Items'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create Task Dialog (selected shipment items) */}
      <TaskDialog
        open={showCreateTaskDialog}
        onOpenChange={(open) => {
          setShowCreateTaskDialog(open);
          if (!open) setSelectedTaskType('');
        }}
        selectedItemIds={Array.from(selectedItemIds)}
        preSelectedTaskType={selectedTaskType}
        onSuccess={handleTaskDialogSuccess}
      />

      {/* Reassign Account Dialog - operates on selected items */}
      {shipment.account_id && (
        <ReassignAccountDialog
          open={showReassignDialog}
          onOpenChange={(open) => {
            setShowReassignDialog(open);
            if (!open) setSelectedItemIds(new Set());
          }}
          entityType="items"
          entityIds={Array.from(selectedItemIds)}
          currentAccountId={shipment.account_id}
          currentAccountName={shipment.accounts?.account_name}
          onSuccess={() => {
            fetchShipment();
            setSelectedItemIds(new Set());
          }}
          onShipmentCreated={(newShipmentId) => {
            navigate(`/shipments/${newShipmentId}`);
          }}
          tenantId={profile?.tenant_id}
          userId={profile?.id}
        />
      )}

      {/* SOP Validation Dialog */}
      <SOPValidationDialog
        open={sopValidationOpen}
        onOpenChange={setSopValidationOpen}
        blockers={sopBlockers}
        onOverride={() => {
          const warnings = sopBlockers.filter(b => b.severity === 'warning');
          setPendingOverrideWarnings(warnings);
          setSopValidationOpen(false);
          setShowSignatureDialog(true);
        }}
      />

      {/* Signature Dialog - shown after validation passes, before completing outbound */}
      {isOutbound && (
        <SignatureDialog
          open={showSignatureDialog}
          onOpenChange={(open) => {
            setShowSignatureDialog(open);
            if (!open) setPendingOverrideWarnings(undefined);
          }}
          releasedToName={shipment?.released_to || undefined}
          itemCount={activeOutboundItems.length}
          onConfirm={async (sigData) => {
            await executeOutboundCompletion(sigData, pendingOverrideWarnings);
          }}
        />
      )}

      {/* Delete shipment confirmation */}
      <AlertDialog open={showDeleteShipmentDialog} onOpenChange={setShowDeleteShipmentDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Shipment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the shipment from all lists. This action cannot be easily undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteShipment}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
