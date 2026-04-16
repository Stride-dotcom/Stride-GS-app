import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useFieldSuggestions } from '@/hooks/useFieldSuggestions';
import { useAccountSidemarks } from '@/hooks/useAccountSidemarks';
import { useClientPortalContext } from '@/hooks/useClientPortal';
import { ClientPortalLayout } from '@/components/client-portal/ClientPortalLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { AutocompleteInput } from '@/components/ui/autocomplete-input';
import { ExpectedItemCard, ExpectedItemData, ExpectedItemErrors } from '@/components/shipments/ExpectedItemCard';
import { ShipmentNotesSection } from '@/components/shipments/ShipmentNotesSection';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { getClassCubicFeetSingleValue } from '@/lib/pricing/classCubicFeet';

interface Warehouse {
  id: string;
  name: string;
}

interface ClassOption {
  id: string;
  code: string;
  name: string;
  min_cubic_feet: number | null;
  max_cubic_feet: number | null;
}

interface FormErrors {
  warehouse?: string;
  items?: Record<string, ExpectedItemErrors>;
}

export default function ClientInboundCreate() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { portalUser, account, tenant, isLoading: contextLoading } = useClientPortalContext();

  const userName = portalUser?.first_name
    ? `${portalUser.first_name} ${portalUser.last_name || ''}`.trim()
    : portalUser?.email || 'User';

  // Form state
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [errors, setErrors] = useState<FormErrors>({});

  // Shipment fields
  const [warehouseId, setWarehouseId] = useState('');
  const [sidemark, setSidemark] = useState('');
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [expectedArrivalDate, setExpectedArrivalDate] = useState('');
  const [notes, setNotes] = useState('');
  const [draftShipmentId, setDraftShipmentId] = useState<string | null>(null);
  const [draftShipmentNumber, setDraftShipmentNumber] = useState<string | null>(null);
  const [creatingDraft, setCreatingDraft] = useState(false);

  // Account sidemarks for autocomplete
  const { sidemarks: accountSidemarks, addSidemark: addAccountSidemark } = useAccountSidemarks(portalUser?.account_id || undefined);

  // Expected items
  const [expectedItems, setExpectedItems] = useState<ExpectedItemData[]>([
    { id: crypto.randomUUID(), description: '', vendor: '', quantity: 1 },
  ]);

  // Field suggestions
  const { suggestions: vendorSuggestions, addOrUpdateSuggestion: recordVendor } = useFieldSuggestions('vendor');
  const { suggestions: descriptionSuggestions, addOrUpdateSuggestion: recordDescription } = useFieldSuggestions('description');

  const vendorValues = useMemo(() => vendorSuggestions.map(s => s.value), [vendorSuggestions]);
  const descriptionSuggestionOptions = useMemo(
    () => descriptionSuggestions.map(s => ({ value: s.value, label: s.value })),
    [descriptionSuggestions]
  );

  const sidemarkSuggestions = useMemo(
    () => accountSidemarks.map(s => ({ value: s.sidemark, label: s.sidemark })),
    [accountSidemarks]
  );

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
      const { data: draft, error } = await (supabase.from('shipments') as any)
        .insert({
          tenant_id: portalUser.tenant_id,
          account_id: portalUser.account_id,
          warehouse_id: warehouseId || null,
          shipment_type: 'inbound',
          inbound_kind: 'expected',
          inbound_status: 'draft',
          status: 'expected',
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
            source: 'client_inbound_create_draft_seed',
            legacy_field: 'shipments.notes',
          },
        });
        if (mirrorError) {
          console.warn('[ClientInboundCreate] Failed to seed draft note:', mirrorError.message);
        } else {
          setNotes('');
        }
      }

      return draftId;
    } catch (err) {
      console.error('[ClientInboundCreate] Failed to create notes draft shipment:', err);
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
    notes,
    portalUser?.account_id,
    portalUser?.email,
    portalUser?.tenant_id,
    toast,
    userName,
    warehouseId,
  ]);

  // Fetch reference data
  useEffect(() => {
    if (!portalUser?.tenant_id) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        const [warehousesRes, classesRes] = await Promise.all([
          (supabase.from('warehouses') as any)
            .select('id, name')
            .eq('tenant_id', portalUser.tenant_id)
            .is('deleted_at', null)
            .order('name'),
          (supabase.from('classes') as any)
            .select('id, code, name, min_cubic_feet, max_cubic_feet')
            .eq('tenant_id', portalUser.tenant_id)
            .eq('is_active', true)
            .order('sort_order', { ascending: true }),
        ]);

        setWarehouses(warehousesRes.data || []);
        setClasses(classesRes.data || []);

        // Auto-select warehouse if only one
        if (warehousesRes.data?.length === 1) {
          setWarehouseId(warehousesRes.data[0].id);
        }
      } catch (err) {
        console.error('[ClientInboundCreate] fetchData error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [portalUser?.tenant_id]);

  // Item management
  const addItem = () => {
    setExpectedItems([
      ...expectedItems,
      { id: crypto.randomUUID(), description: '', vendor: '', quantity: 1 },
    ]);
  };

  const removeItem = (id: string) => {
    if (expectedItems.length === 1) return;
    setExpectedItems(expectedItems.filter(item => item.id !== id));
    if (errors.items?.[id]) {
      const newItemErrors = { ...errors.items };
      delete newItemErrors[id];
      setErrors({ ...errors, items: newItemErrors });
    }
  };

  const duplicateItem = (itemToDuplicate: ExpectedItemData) => {
    const newItem: ExpectedItemData = {
      id: crypto.randomUUID(),
      description: itemToDuplicate.description,
      vendor: itemToDuplicate.vendor,
      quantity: itemToDuplicate.quantity,
      classId: itemToDuplicate.classId,
      classCode: itemToDuplicate.classCode,
    };
    const index = expectedItems.findIndex(item => item.id === itemToDuplicate.id);
    const newItems = [...expectedItems];
    newItems.splice(index + 1, 0, newItem);
    setExpectedItems(newItems);
  };

  const updateItem = (id: string, field: keyof ExpectedItemData, value: string | number) => {
    setExpectedItems(expectedItems.map(item => (item.id === id ? { ...item, [field]: value } : item)));
    if (errors.items?.[id]?.[field as keyof ExpectedItemErrors]) {
      const newItemErrors = { ...errors.items };
      if (newItemErrors[id]) {
        delete newItemErrors[id][field as keyof ExpectedItemErrors];
      }
      setErrors({ ...errors, items: newItemErrors });
    }
  };

  // Validation — class is NOT required for client inbound
  const validate = (): boolean => {
    const newErrors: FormErrors = {};

    if (!warehouseId) {
      newErrors.warehouse = 'Please select a warehouse';
    }

    const itemErrors: Record<string, ExpectedItemErrors> = {};
    let hasItemErrors = false;

    expectedItems.forEach(item => {
      const errs: ExpectedItemErrors = {};
      if (!item.description.trim()) {
        errs.description = 'Description is required';
        hasItemErrors = true;
      }
      if (item.quantity < 1) {
        errs.quantity = 'Quantity must be at least 1';
        hasItemErrors = true;
      }
      if (Object.keys(errs).length > 0) {
        itemErrors[item.id] = errs;
      }
    });

    if (hasItemErrors) {
      newErrors.items = itemErrors;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!portalUser?.tenant_id || !portalUser?.account_id) {
      toast({ variant: 'destructive', title: 'Error', description: 'Missing account information' });
      return;
    }

    if (!validate()) {
      toast({ variant: 'destructive', title: 'Validation Error', description: 'Please fix the errors below' });
      return;
    }

    setSaving(true);

    try {
      // Ensure sidemark exists in account_sidemarks
      if (sidemark.trim() && portalUser.account_id) {
        await addAccountSidemark(sidemark.trim());
      }

      const fallbackPublicNote = notes.trim();
      const draftId = draftShipmentId || (await ensureDraftShipment());
      let shipment: { id: string; shipment_number: string | null };

      if (draftId) {
        const threadedPublicNote = await fetchLatestPublicUnifiedNote(draftId);
        const publicNotesForSave = threadedPublicNote || fallbackPublicNote || null;
        const { data: updatedShipment, error: shipmentError } = await (supabase.from('shipments') as any)
          .update({
            warehouse_id: warehouseId,
            sidemark: sidemark.trim() || null,
            shipment_type: 'inbound',
            inbound_kind: 'expected',
            inbound_status: 'draft',
            status: 'expected',
            carrier: carrier || null,
            tracking_number: trackingNumber || null,
            po_number: poNumber || null,
            expected_arrival_date: expectedArrivalDate || null,
            notes: publicNotesForSave,
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
            account_id: portalUser.account_id,
            warehouse_id: warehouseId,
            sidemark: sidemark.trim() || null,
            shipment_type: 'inbound',
            // Align with inbound planning so EXP-##### numbering is applied via DB trigger.
            inbound_kind: 'expected',
            inbound_status: 'draft',
            status: 'expected',
            carrier: carrier || null,
            tracking_number: trackingNumber || null,
            po_number: poNumber || null,
            expected_arrival_date: expectedArrivalDate || null,
            notes: fallbackPublicNote || null,
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

      if (!draftId && fallbackPublicNote) {
        const { error: mirrorNoteError } = await (supabase as any).rpc('create_unified_note', {
          p_entity_type: 'shipment',
          p_entity_id: shipment.id,
          p_note_text: fallbackPublicNote,
          p_note_type: 'public',
          p_source_entity_number: shipment.shipment_number || null,
          p_metadata: {
            source: 'client_inbound_create',
            legacy_field: 'shipments.notes',
          },
        });
        if (mirrorNoteError) {
          console.warn('[ClientInboundCreate] Failed to mirror note into unified notes:', mirrorNoteError.message);
        }
      }

      // Create items and shipment_items
      const validItems = expectedItems.filter(item => item.description.trim());

      for (const expectedItem of validItems) {
        const cls = expectedItem.classId ? classes.find((c) => c.id === expectedItem.classId) : undefined;
        const classCubicFeet = cls ? getClassCubicFeetSingleValue(cls) : null;

        const itemPayload = {
          tenant_id: portalUser.tenant_id,
          account_id: portalUser.account_id,
          warehouse_id: warehouseId,
          description: expectedItem.description.trim(),
          vendor: expectedItem.vendor || null,
          quantity: expectedItem.quantity,
          class_id: expectedItem.classId || null,
          size: classCubicFeet,
          size_unit: classCubicFeet !== null ? 'cu_ft' : null,
          sidemark: sidemark.trim() || null,
          receiving_shipment_id: shipment.id,
          status: 'pending_receipt',
        };

        const { data: newItem, error: itemError } = await (supabase.from('items') as any)
          .insert(itemPayload)
          .select('id')
          .single();

        if (itemError) throw itemError;

        const { error: shipmentItemError } = await (supabase.from('shipment_items') as any)
          .insert({
            shipment_id: shipment.id,
            item_id: newItem.id,
            expected_description: expectedItem.description.trim(),
            expected_quantity: expectedItem.quantity,
            expected_vendor: expectedItem.vendor || null,
            expected_class_id: expectedItem.classId || null,
            status: 'pending',
          });

        if (shipmentItemError) throw shipmentItemError;
      }

      // Record field suggestions
      expectedItems.forEach(item => {
        if (item.vendor) recordVendor(item.vendor);
        if (item.description) recordDescription(item.description);
      });

      toast({ title: 'Shipment Created', description: 'Your inbound shipment has been submitted to the warehouse.' });
      navigate('/client/shipments');
    } catch (err: any) {
      console.error('[ClientInboundCreate] submit error:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err.message || 'Failed to create shipment',
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
          <Link to="/client/shipments">
            <Button variant="ghost" size="icon">
              <MaterialIcon name="arrow_back" size="sm" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Create Inbound Shipment</h1>
            <p className="text-muted-foreground">
              Notify the warehouse about an incoming shipment
            </p>
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
                <label className="text-sm font-medium">Account</label>
                <div className="flex items-center h-10 px-3 rounded-md border bg-muted/50 text-sm">
                  {account?.name || 'Your Account'}
                </div>
              </div>

              {/* Warehouse */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Warehouse <span className="text-destructive">*</span>
                </label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={warehouseId}
                  onChange={e => {
                    setWarehouseId(e.target.value);
                    if (errors.warehouse) setErrors({ ...errors, warehouse: undefined });
                  }}
                >
                  <option value="">Select warehouse...</option>
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
                {errors.warehouse && <p className="text-sm text-destructive">{errors.warehouse}</p>}
              </div>

              {/* Sidemark */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Sidemark / Project</label>
                <AutocompleteInput
                  value={sidemark}
                  onChange={setSidemark}
                  suggestions={sidemarkSuggestions}
                  placeholder="e.g., Living Room Set"
                />
              </div>

              {/* Carrier & Tracking */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  label="Carrier"
                  name="carrier"
                  value={carrier}
                  onChange={setCarrier}
                  placeholder="e.g., FedEx, UPS"
                />
                <FormField
                  label="Tracking Number"
                  name="tracking"
                  value={trackingNumber}
                  onChange={setTrackingNumber}
                  placeholder="Tracking number"
                />
              </div>

              {/* PO & Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  label="PO Number"
                  name="po"
                  value={poNumber}
                  onChange={setPoNumber}
                  placeholder="Purchase order number"
                />
                <FormField
                  label="Expected Arrival"
                  name="arrival"
                  type="date"
                  value={expectedArrivalDate}
                  onChange={setExpectedArrivalDate}
                />
              </div>

              {/* Notes */}
              {draftShipmentId ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Public Notes</label>
                  <ShipmentNotesSection
                    shipmentId={draftShipmentId}
                    isClientUser
                    allowClientWrite
                    embedded
                    forcedNoteType="public"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <FormField
                    label="Public Notes"
                    name="notes"
                    type="textarea"
                    value={notes}
                    onChange={(next) => {
                      setNotes(next);
                      if (next.trim() && !draftShipmentId && !creatingDraft) {
                        void ensureDraftShipment();
                      }
                    }}
                    placeholder="Additional notes about this shipment..."
                    minRows={2}
                    maxRows={4}
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
                </div>
              )}
            </CardContent>
          </Card>

          {/* Expected Items */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle className="text-lg">Expected Items</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addItem}>
                <MaterialIcon name="add" size="sm" className="mr-2" />
                Add Item
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {expectedItems.map((item, index) => (
                <ExpectedItemCard
                  key={item.id}
                  item={item}
                  index={index}
                  vendorSuggestions={vendorValues}
                  descriptionSuggestions={descriptionSuggestionOptions}
                  sidemarkSuggestions={sidemarkSuggestions}
                  classes={classes}
                  classOptional
                  errors={errors.items?.[item.id]}
                  canDelete={expectedItems.length > 1}
                  onUpdate={updateItem}
                  onDelete={removeItem}
                  onDuplicate={duplicateItem}
                  onVendorUsed={recordVendor}
                />
              ))}
            </CardContent>
          </Card>

          {/* Submit */}
          <div className="flex justify-end gap-3 pb-6">
            <Link to="/client/shipments">
              <Button type="button" variant="outline" disabled={saving}>
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={saving} className="min-w-[140px]">
              {saving ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <MaterialIcon name="send" size="sm" className="mr-2" />
                  Submit Shipment
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </ClientPortalLayout>
  );
}
