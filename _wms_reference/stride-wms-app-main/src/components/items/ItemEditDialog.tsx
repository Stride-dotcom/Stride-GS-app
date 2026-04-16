import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { logItemActivity } from '@/lib/activity/logItemActivity';
import { ClassSelect } from '@/components/ui/class-select';
import { AutocompleteInput } from '@/components/ui/autocomplete-input';
import { useFieldSuggestions } from '@/hooks/useFieldSuggestions';
import { useAccountSidemarks } from '@/hooks/useAccountSidemarks';
import { useItemDisplaySettings } from '@/hooks/useItemDisplaySettings';
import { isEmptyCustomFieldValue } from '@/lib/items/itemDisplaySettings';
import type { BuiltinItemColumnKey } from '@/lib/items/itemDisplaySettings';
import { Switch } from '@/components/ui/switch';
import { formatClassCubicFeetLabel, getClassCubicFeetSingleValue } from '@/lib/pricing/classCubicFeet';

const itemSchema = z.object({
  description: z.string().optional(),
  sku: z.string().optional(),
  quantity: z.coerce.number().min(1).default(1),
  sidemark: z.string().optional(),
  sidemark_id: z.string().optional(),
  class_id: z.string().optional(),
  vendor: z.string().optional(),
  size: z.coerce.number().optional(),
  size_unit: z.string().optional(),
  room: z.string().optional(),
  link: z.string().optional().transform((val) => {
    if (!val || val.trim() === '') return '';
    // Auto-prepend https:// if no protocol is provided
    if (!/^https?:\/\//i.test(val)) {
      return `https://${val}`;
    }
    return val;
  }),
  status: z.string().optional(),
  client_account: z.string().optional(),
  account_id: z.string().optional(),
});

type ItemFormData = z.infer<typeof itemSchema>;

interface Account {
  id: string;
  account_name: string;
  account_code: string;
}

interface ItemEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: {
    id: string;
    item_code: string;
    description: string | null;
    sku?: string | null;
    metadata?: Record<string, unknown> | null;
    quantity: number;
    sidemark: string | null;
    sidemark_id?: string | null;
    class_id?: string | null;
    account_id?: string | null;
    vendor: string | null;
    size: number | null;
    size_unit: string | null;
    room?: string | null;
    link?: string | null;
    status: string;
    item_type_id?: string | null;
    client_account?: string | null;
  } | null;
  onSuccess: () => void;
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'released', label: 'Released', disabled: true },
];

const SIZE_UNITS = [
  { value: 'sq_ft', label: 'sq ft' },
  { value: 'cu_ft', label: 'cu ft' },
  { value: 'inches', label: 'inches' },
  { value: 'feet', label: 'feet' },
];

function nearlyEqual(a: number, b: number, epsilon = 0.0001): boolean {
  return Math.abs(a - b) <= epsilon;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function ItemEditDialog({
  open,
  onOpenChange,
  item,
  onSuccess,
}: ItemEditDialogProps) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sizeManuallyOverridden, setSizeManuallyOverridden] = useState(false);
  const [overwriteSizeDialogOpen, setOverwriteSizeDialogOpen] = useState(false);
  const [pendingAutoSize, setPendingAutoSize] = useState<{ size: number; sizeUnit: string; classId: string; classLabel?: string } | null>(null);

  const classSizeCacheRef = useRef<Map<string, { single: number | null; label: string | null }>>(new Map());
  const lastAutoSizeRef = useRef<number | null>(null);
  const lastAutoClassIdRef = useRef<string | null>(null);

  // Field suggestions for room and sidemark
  const { suggestions: roomSuggestions, addOrUpdateSuggestion: addRoomSuggestion } = useFieldSuggestions('room');
  const { suggestions: skuSuggestions, addOrUpdateSuggestion: addSkuSuggestion } = useFieldSuggestions('sku');

  // Tenant-managed custom item fields
  const { settings: itemDisplaySettings } = useItemDisplaySettings();
  const customFieldsForForm = itemDisplaySettings.custom_fields.filter((f) => f.enabled && f.show_on_detail);
  const [customFieldDraft, setCustomFieldDraft] = useState<Record<string, unknown>>({});

  const isRequiredBuiltin = (key: BuiltinItemColumnKey) => itemDisplaySettings.required_builtin?.[key] === true;

  // Fetch accounts
  useEffect(() => {
    const fetchData = async () => {
      const accountsRes = await supabase
        .from('accounts')
        .select('id, account_name, account_code')
        .is('deleted_at', null)
        .eq('status', 'active')
        .order('account_name');
      if (accountsRes.data) setAccounts(accountsRes.data);
    };
    if (open) fetchData();
  }, [open]);

  const form = useForm<ItemFormData>({
    resolver: zodResolver(itemSchema),
    defaultValues: {
      description: '',
      sku: '',
      quantity: 1,
      sidemark: '',
      sidemark_id: '',
      class_id: '',
      account_id: '',
      vendor: '',
      size: undefined,
      size_unit: '',
      room: '',
      link: '',
      status: 'active',
      client_account: '',
    },
  });

  // Track selected account for sidemark filtering
  const selectedAccountId = form.watch('account_id');

  // Account sidemarks for autocomplete
  const { sidemarks: accountSidemarks, addSidemark: addAccountSidemark } = useAccountSidemarks(selectedAccountId || undefined);
  const sidemarkSuggestions = accountSidemarks.map((s) => ({ value: s.sidemark, label: s.sidemark }));

  const fetchClassSizeInfo = useCallback(async (classId: string) => {
    if (!profile?.tenant_id) return null;
    if (!classId) return null;

    const cached = classSizeCacheRef.current.get(classId);
    if (cached) return cached;

    try {
      const { data, error } = await (supabase.from('classes') as any)
        .select('id, code, name, min_cubic_feet, max_cubic_feet')
        .eq('tenant_id', profile.tenant_id)
        .eq('id', classId)
        .maybeSingle();

      if (error || !data) return null;

      const single = getClassCubicFeetSingleValue(data);
      const label = formatClassCubicFeetLabel(data);
      const info = { single, label };
      classSizeCacheRef.current.set(classId, info);
      return info;
    } catch {
      return null;
    }
  }, [profile?.tenant_id]);

  useEffect(() => {
    if (open && item) {
      form.reset({
        description: item.description || '',
        sku: item.sku || '',
        quantity: item.quantity || 1,
        sidemark: item.sidemark || '',
        sidemark_id: item.sidemark_id || '',
        class_id: item.class_id || '',
        account_id: item.account_id || '',
        vendor: item.vendor || '',
        size: item.size ?? undefined,
        size_unit: item.size_unit || '',
        room: item.room || '',
        link: item.link || '',
        status: item.status || 'active',
        client_account: item.client_account || '',
      });

      const meta = item.metadata && typeof item.metadata === 'object' ? item.metadata : null;
      const custom = meta && typeof (meta as any).custom_fields === 'object' ? (meta as any).custom_fields : null;
      setCustomFieldDraft(custom && typeof custom === 'object' ? { ...(custom as any) } : {});

      // Initialize "manual size override" tracking so we can prompt on class changes.
      // Best-effort: if size matches the current class cubic-feet default, treat as NOT overridden.
      setOverwriteSizeDialogOpen(false);
      setPendingAutoSize(null);
      void (async () => {
        const currentSize = item.size;
        if (currentSize === null || currentSize === undefined) {
          lastAutoSizeRef.current = null;
          lastAutoClassIdRef.current = item.class_id || null;
          setSizeManuallyOverridden(false);
          return;
        }

        if (!item.class_id) {
          lastAutoSizeRef.current = null;
          lastAutoClassIdRef.current = null;
          setSizeManuallyOverridden(true);
          return;
        }

        const info = await fetchClassSizeInfo(item.class_id);
        const classDefault = info?.single ?? null;
        lastAutoSizeRef.current = classDefault;
        lastAutoClassIdRef.current = item.class_id;

        const unit = item.size_unit;
        if (classDefault !== null && nearlyEqual(currentSize, classDefault) && (!unit || unit === 'cu_ft')) {
          setSizeManuallyOverridden(false);
        } else {
          setSizeManuallyOverridden(true);
        }
      })();
    } else if (open) {
      setCustomFieldDraft({});
      lastAutoSizeRef.current = null;
      lastAutoClassIdRef.current = null;
      setSizeManuallyOverridden(false);
      setOverwriteSizeDialogOpen(false);
      setPendingAutoSize(null);
    }
  }, [open, item]);

  const applyAutoSize = useCallback((nextClassId: string, nextSize: number) => {
    form.setValue('size', nextSize, { shouldDirty: true });
    form.setValue('size_unit', 'cu_ft', { shouldDirty: true });
    lastAutoSizeRef.current = nextSize;
    lastAutoClassIdRef.current = nextClassId;
    setSizeManuallyOverridden(false);
    setOverwriteSizeDialogOpen(false);
    setPendingAutoSize(null);
  }, [form]);

  const maybeAutoFillSizeFromClass = useCallback(async (nextClassId: string) => {
    if (!nextClassId) return;
    const info = await fetchClassSizeInfo(nextClassId);

    if (!info) return;

    if (info.single === null) {
      // Legacy range or missing size — don't guess a single value.
      if (info.label) {
        toast({
          title: 'Class size needs a single value',
          description: `Selected class is configured as "${info.label}". Set a single cubic-feet value in Settings → Service Rates → Classes to enable auto-fill.`,
        });
      }
      return;
    }

    const currentSize = toOptionalNumber(form.getValues('size'));
    const hasManualSize = currentSize !== undefined && currentSize !== null;

    // If user has manually edited size, prompt before overwriting.
    if (sizeManuallyOverridden && hasManualSize) {
      setPendingAutoSize({
        size: info.single,
        sizeUnit: 'cu_ft',
        classId: nextClassId,
        classLabel: info.label ?? undefined,
      });
      setOverwriteSizeDialogOpen(true);
      return;
    }

    applyAutoSize(nextClassId, info.single);
  }, [applyAutoSize, fetchClassSizeInfo, form, sizeManuallyOverridden, toast]);

  const onSubmit = async (data: ItemFormData) => {
    if (!item) return;

    const missingBuiltin: Array<{ field: keyof ItemFormData; label: string }> = [];
    if (isRequiredBuiltin('vendor') && !(data.vendor || '').trim()) {
      missingBuiltin.push({ field: 'vendor', label: 'Vendor' });
    }
    if (isRequiredBuiltin('sku') && !(data.sku || '').trim()) {
      missingBuiltin.push({ field: 'sku', label: 'SKU' });
    }
    if (isRequiredBuiltin('description') && !(data.description || '').trim()) {
      missingBuiltin.push({ field: 'description', label: 'Description' });
    }
    if (isRequiredBuiltin('sidemark') && !(data.sidemark || '').trim()) {
      missingBuiltin.push({ field: 'sidemark', label: 'Sidemark' });
    }
    if (isRequiredBuiltin('room') && !(data.room || '').trim()) {
      missingBuiltin.push({ field: 'room', label: 'Room' });
    }

    if (missingBuiltin.length > 0) {
      for (const missing of missingBuiltin) {
        form.setError(missing.field, { type: 'manual', message: `${missing.label} is required.` });
      }
      toast({
        variant: 'destructive',
        title: 'Required fields missing',
        description: `Please fill: ${missingBuiltin.map((m) => m.label).join(', ')}`,
      });
      return;
    }

    for (const f of customFieldsForForm) {
      if (f.required !== true) continue;
      if (isEmptyCustomFieldValue(f as any, customFieldDraft[f.key])) {
        toast({
          variant: 'destructive',
          title: 'Required field missing',
          description: `${f.label} is required.`,
        });
        return;
      }
    }

    setLoading(true);
    try {
      // If sidemark text was entered, ensure it exists in account_sidemarks
      if (data.sidemark?.trim() && data.account_id) {
        await addAccountSidemark(data.sidemark.trim());
      }

      const updateData = {
        description: data.description || null,
        sku: data.sku || null,
        quantity: data.quantity,
        sidemark: data.sidemark || null,
        class_id: data.class_id || null,
        account_id: data.account_id || null,
        vendor: data.vendor || null,
        size: data.size ?? null,
        size_unit: data.size_unit || null,
        room: data.room || null,
        link: data.link || null,
        status: data.status || 'active',
        client_account: data.client_account || null,
      };

      // Merge custom field values into metadata.custom_fields
      const existingMeta = item.metadata && typeof item.metadata === 'object' ? (item.metadata as Record<string, unknown>) : {};
      const existingCustom =
        (existingMeta as any).custom_fields && typeof (existingMeta as any).custom_fields === 'object'
          ? { ...(existingMeta as any).custom_fields }
          : {};

      const nextCustom: Record<string, unknown> = { ...(existingCustom as any) };
      for (const f of customFieldsForForm) {
        const raw = customFieldDraft[f.key];
        if (raw === undefined || raw === null) {
          delete (nextCustom as any)[f.key];
          continue;
        }
        if (f.type === 'checkbox') {
          if (raw === true) (nextCustom as any)[f.key] = true;
          else delete (nextCustom as any)[f.key];
          continue;
        }
        if (f.type === 'number') {
          const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
          if (Number.isFinite(n)) (nextCustom as any)[f.key] = n;
          else delete (nextCustom as any)[f.key];
          continue;
        }
        const s = String(raw).trim();
        if (s) (nextCustom as any)[f.key] = s;
        else delete (nextCustom as any)[f.key];
      }

      const nextMeta: Record<string, unknown> = { ...(existingMeta as any) };
      if (Object.keys(nextCustom).length > 0) {
        (nextMeta as any).custom_fields = nextCustom;
      } else {
        delete (nextMeta as any).custom_fields;
      }

      (updateData as any).metadata = nextMeta;

      const { error } = await (supabase.from('items') as any)
        .update(updateData)
        .eq('id', item.id);

      if (error) throw error;

      // Log activity for key field changes
      if (profile?.tenant_id) {
        // Custom field diffs (stored under metadata.custom_fields)
        for (const f of customFieldsForForm) {
          const fromVal = (existingCustom as any)[f.key] ?? null;
          const toVal = (nextCustom as any)[f.key] ?? null;
          if (fromVal === toVal) continue;

          logItemActivity({
            tenantId: profile.tenant_id,
            itemId: item.id,
            actorUserId: profile.id,
            eventType: 'item_custom_field_updated',
            eventLabel: `${f.label} updated`,
            details: { field_key: f.key, label: f.label, from: fromVal, to: toVal },
          });
        }

        if (data.status !== item.status) {
          logItemActivity({
            tenantId: profile.tenant_id,
            itemId: item.id,
            actorUserId: profile.id,
            eventType: 'item_status_changed',
            eventLabel: `Status changed: ${item.status} → ${data.status}`,
            details: { from: item.status, to: data.status },
          });
        }
        if ((data.account_id || null) !== (item.account_id || null)) {
          const newAccount = accounts.find(a => a.id === data.account_id);
          logItemActivity({
            tenantId: profile.tenant_id,
            itemId: item.id,
            actorUserId: profile.id,
            eventType: 'item_account_changed',
            eventLabel: `Account changed${newAccount ? `: ${newAccount.account_name}` : ''}`,
            details: { from_account_id: item.account_id, to_account_id: data.account_id || null, to_account_name: newAccount?.account_name },
          });
        }
        if ((data.class_id || null) !== (item.class_id || null)) {
          logItemActivity({
            tenantId: profile.tenant_id,
            itemId: item.id,
            actorUserId: profile.id,
            eventType: 'item_class_changed',
            eventLabel: 'Item class changed',
            details: { from_class_id: item.class_id, to_class_id: data.class_id || null },
          });
        }
      }

      // Add room to suggestions
      if (data.room) addRoomSuggestion(data.room);
      if (data.sku) addSkuSuggestion(data.sku);

      toast({
        title: 'Item Updated',
        description: `${item.item_code} has been updated successfully.`,
      });

      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      console.error('Error updating item:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to update item',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Edit Item</DialogTitle>
          <DialogDescription>
            Update details for {item?.item_code}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 pr-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {/* Class (Pricing Tier) */}
              <FormField
                control={form.control}
                name="class_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Class (Pricing Tier)</FormLabel>
                    <FormControl>
                      <ClassSelect
                        value={field.value}
                        onChange={(next) => {
                          field.onChange(next);
                          void maybeAutoFillSizeFromClass(next);
                        }}
                        placeholder="Select class..."
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Quantity & Status */}
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="quantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Quantity</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || undefined}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {STATUS_OPTIONS.map((opt) => (
                            <SelectItem
                              key={opt.value}
                              value={opt.value}
                              disabled={'disabled' in opt && opt.disabled}
                            >
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Vendor */}
              <FormField
                control={form.control}
                name="vendor"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1">
                      Vendor {isRequiredBuiltin('vendor') ? <span className="text-destructive">*</span> : null}
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="Vendor" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* SKU */}
              <FormField
                control={form.control}
                name="sku"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1">
                      {isRequiredBuiltin('sku') ? 'SKU' : 'SKU (optional)'}{' '}
                      {isRequiredBuiltin('sku') ? <span className="text-destructive">*</span> : null}
                    </FormLabel>
                    <FormControl>
                      <AutocompleteInput
                        value={field.value || ''}
                        onChange={field.onChange}
                        suggestions={skuSuggestions}
                        placeholder="SKU"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Description */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1">
                      Description {isRequiredBuiltin('description') ? <span className="text-destructive">*</span> : null}
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Item description..."
                        className="resize-none"
                        rows={2}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Custom Fields */}
              {customFieldsForForm.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Custom Fields</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {customFieldsForForm.map((f) => {
                      const raw = customFieldDraft[f.key];
                      const stringVal = raw === null || raw === undefined ? '' : String(raw);
                      const dateVal = stringVal && stringVal.includes('T') ? stringVal.slice(0, 10) : stringVal;
                      const checked = raw === true || raw === 'true' || raw === 1 || raw === '1';

                      return (
                        <div key={f.id} className="space-y-1">
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            {f.label} {f.required === true && f.type !== 'checkbox' ? <span className="text-destructive">*</span> : null}
                          </div>
                          {f.type === 'select' ? (
                            <Select
                              value={stringVal || '__none__'}
                              onValueChange={(val) => {
                                const next = val === '__none__' ? '' : val;
                                setCustomFieldDraft((prev) => ({ ...prev, [f.key]: next }));
                              }}
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue placeholder="Select…" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">-</SelectItem>
                                {(f.options || []).map((opt) => (
                                  <SelectItem key={opt} value={opt}>
                                    {opt}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : f.type === 'checkbox' ? (
                            <div className="h-9 flex items-center">
                              <Switch checked={checked} onCheckedChange={(val) => setCustomFieldDraft((prev) => ({ ...prev, [f.key]: val }))} />
                            </div>
                          ) : (
                            <Input
                              value={f.type === 'date' ? dateVal : stringVal}
                              type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                              onChange={(e) => setCustomFieldDraft((prev) => ({ ...prev, [f.key]: e.target.value }))}
                              placeholder="-"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Account */}
              <FormField
                control={form.control}
                name="account_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account</FormLabel>
                    <Select
                      onValueChange={(val) => {
                        if (val === '_none_') {
                          field.onChange('');
                          form.setValue('client_account', '');
                          form.setValue('sidemark', ''); // Clear sidemark when account changes
                        } else {
                          field.onChange(val);
                          const account = accounts.find(a => a.id === val);
                          form.setValue('client_account', account?.account_name || '');
                          form.setValue('sidemark', ''); // Clear sidemark when account changes
                        }
                      }}
                      value={field.value || '_none_'}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select account..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="_none_">No account</SelectItem>
                        {accounts.filter(account => account.id).map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.account_name} ({account.account_code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Sidemark & Room */}
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="sidemark"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1">
                        Sidemark (Project) {isRequiredBuiltin('sidemark') ? <span className="text-destructive">*</span> : null}
                      </FormLabel>
                      <FormControl>
                        <AutocompleteInput
                          value={field.value || ''}
                          onChange={field.onChange}
                          suggestions={sidemarkSuggestions}
                          placeholder="e.g., Living Room Set"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="room"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1">
                        Room {isRequiredBuiltin('room') ? <span className="text-destructive">*</span> : null}
                      </FormLabel>
                      <FormControl>
                        <AutocompleteInput
                          value={field.value || ''}
                          onChange={field.onChange}
                          suggestions={roomSuggestions}
                          placeholder="e.g., Living Room"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Link */}
              <FormField
                control={form.control}
                name="link"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Link (URL)</FormLabel>
                    <FormControl>
                      <Input type="url" placeholder="https://..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Size & Size Unit */}
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="size"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Size</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          inputMode="decimal"
                          placeholder="Size"
                          value={field.value ?? ''}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (!raw) {
                              field.onChange(undefined);
                              setSizeManuallyOverridden(false);
                              return;
                            }
                            const n = e.target.valueAsNumber;
                            if (Number.isFinite(n)) {
                              field.onChange(n);
                              setSizeManuallyOverridden(true);
                              return;
                            }
                            // Fallback: keep raw so the user can finish typing.
                            field.onChange(raw as any);
                            setSizeManuallyOverridden(true);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="size_unit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Size Unit</FormLabel>
                      <Select
                        onValueChange={(val) => {
                          field.onChange(val);
                          if (toOptionalNumber(form.getValues('size')) !== undefined) {
                            setSizeManuallyOverridden(true);
                          }
                        }}
                        value={field.value || undefined}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Unit" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SIZE_UNITS.map((unit) => (
                            <SelectItem key={unit.value} value={unit.value}>
                              {unit.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </form>
          </Form>
        </div>

        <DialogFooter className="flex-shrink-0 pt-4 border-t">
          <Button onClick={form.handleSubmit(onSubmit)} disabled={loading}>
            {loading && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Prompt before overwriting a manually-entered size */}
      <AlertDialog open={overwriteSizeDialogOpen} onOpenChange={setOverwriteSizeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Overwrite item size?</AlertDialogTitle>
            <AlertDialogDescription>
              This item&apos;s size was manually edited. Changing the class can auto-fill size from the selected class
              {pendingAutoSize?.classLabel ? ` (${pendingAutoSize.classLabel})` : ''}. Do you want to overwrite your manual size?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setOverwriteSizeDialogOpen(false); setPendingAutoSize(null); }}>
              Keep manual size
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingAutoSize) return;
                applyAutoSize(pendingAutoSize.classId, pendingAutoSize.size);
              }}
            >
              Overwrite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
