import { useEffect, useState } from 'react';
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
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { SaveButton } from '@/components/ui/SaveButton';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ClientPortalSection } from './ClientPortalSection';
import { AddAddonDialog } from '@/components/billing/AddAddonDialog';
import { AddCreditDialog } from '@/components/billing/AddCreditDialog';
import { AccountPricingTab } from './AccountPricingTab';
import { AccountInvoicesTab } from './AccountInvoicesTab';
import { AccountActivityTab } from './AccountActivityTab';
import { useAccountTypes } from '@/components/settings/preferences/AccountTypesSection';

const accountSchema = z.object({
  // Basic
  account_code: z.string().min(1, 'Account code is required').max(50),
  account_name: z.string().min(1, 'Account name is required').max(200),
  account_type: z.string().optional(),
  status: z.enum(['active', 'on_hold', 'archived', 'credit_hold']),
  is_master_account: z.boolean().optional(),
  parent_account_id: z.string().optional(),
  can_view_parent_data: z.boolean().optional(),
  allow_item_reassignment: z.boolean().optional(),
  sidemark_label: z.string().optional(),
  notes: z.string().optional(),
  // Contacts - Primary
  primary_contact_name: z.string().optional(),
  primary_contact_email: z.string().email().optional().or(z.literal('')),
  primary_contact_phone: z.string().optional(),
  // Contacts - Billing
  billing_contact_name: z.string().optional(),
  billing_contact_email: z.string().email().optional().or(z.literal('')),
  billing_contact_phone: z.string().optional(),
  // Contacts - Alerts
  alerts_contact_name: z.string().optional(),
  alerts_contact_email: z.string().email().optional().or(z.literal('')),
  account_alert_recipients: z.string().optional(),
  // Billing Address
  billing_address: z.string().optional(),
  billing_city: z.string().optional(),
  billing_state: z.string().optional(),
  billing_postal_code: z.string().optional(),
  billing_country: z.string().optional(),
  // Billing Settings
  billing_type: z.string().optional(),
  billing_method: z.string().optional(),
  billing_frequency: z.string().optional(),
  billing_schedule: z.string().optional(),
  payment_terms: z.string().optional(),
  currency: z.string().optional(),
  billing_net_terms: z.coerce.number().optional(),
  net_terms: z.coerce.number().optional(),
  credit_limit: z.coerce.number().optional(),
  credit_limit_amount: z.coerce.number().optional(),
  prepay_required: z.boolean().optional(),
  credit_hold: z.boolean().optional(),
  // Pricing
  pricing_level: z.string().optional(),
  pricing_percentage: z.coerce.number().optional(),
  pricing_apply_to: z.string().optional(),
  pricing_selected_services: z.array(z.string()).optional(),
  // Automations
  auto_inspection_on_receiving: z.boolean().optional(),
  auto_assembly_on_receiving: z.boolean().optional(),
  auto_repair_on_damage: z.boolean().optional(),
  auto_quarantine_damaged_items: z.boolean().optional(),
  // Inventory
  require_sidemark: z.boolean().optional(),
  require_inspection_photos: z.boolean().optional(),
  hide_internal_fields_from_clients: z.boolean().optional(),
  default_receiving_status: z.string().optional(),
  default_receiving_location_id: z.string().optional(),
  // Default notes
  default_item_notes: z.string().optional(),
  highlight_item_notes: z.boolean().optional(),
  default_shipment_notes: z.string().optional(),
  highlight_shipment_notes: z.boolean().optional(),
  // Communications
  use_tenant_email_defaults: z.boolean().optional(),
  use_tenant_communication_defaults: z.boolean().optional(),
  disable_email_communications: z.boolean().optional(),
  copy_from_account_id: z.string().optional(),
  email_subject_override: z.string().optional(),
  email_html_body_override: z.string().optional(),
  email_recipients_override: z.string().optional(),
  // Permissions
  access_level: z.string().optional(),
  can_modify_pricing: z.boolean().optional(),
  can_delete_accounts: z.boolean().optional(),
  read_only_access: z.boolean().optional(),
});

type AccountFormData = z.infer<typeof accountSchema>;

interface AccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string | null;
  onSuccess: () => void;
}

interface Account {
  id: string;
  account_name: string;
}

// Account types are now managed via useAccountTypes hook from preferences

const BILLING_TYPES = [
  { value: 'automatic', label: 'Automatic' },
  { value: 'manual', label: 'Manual' },
  { value: 'mixed', label: 'Mixed' },
];

const BILLING_METHODS = [
  { value: 'per_shipment', label: 'Per Shipment' },
  { value: 'consolidated', label: 'Consolidated' },
  { value: 'monthly', label: 'Monthly' },
];

const ACCOUNT_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'archived', label: 'Archived' },
  { value: 'credit_hold', label: 'Credit Hold' },
];

const PRICING_LEVELS = [
  { value: 'default', label: 'Use Default Price List' },
  { value: 'percentage', label: 'Apply Percentage Change' },
];

const PRICING_APPLY_TO = [
  { value: 'all', label: 'All Services' },
  { value: 'selected', label: 'Select Services' },
];

// Available services for selection
const AVAILABLE_SERVICES = [
  { key: 'receiving', label: 'Receiving', description: 'Receiving and inspection of incoming items' },
  { key: 'storage', label: 'Storage', description: 'Monthly/daily warehouse storage' },
  { key: 'picking', label: 'Picking', description: 'Order picking and preparation' },
  { key: 'packing', label: 'Packing', description: 'Packaging and wrapping' },
  { key: 'shipping', label: 'Shipping', description: 'Outbound shipping and delivery' },
  { key: 'assembly', label: 'Assembly', description: 'Item assembly and setup' },
  { key: 'inspection', label: 'Inspection', description: 'Quality inspection services' },
  { key: 'repair', label: 'Repair', description: 'Repair and restoration' },
  { key: 'minor_touchup', label: 'Minor Touch-up', description: 'Minor repairs and touch-ups' },
  { key: 'custom_packaging', label: 'Custom Packaging', description: 'Custom crating and packaging' },
  { key: 'handling', label: 'Handling', description: 'Manual handling and labor' },
  { key: 'move', label: 'Move', description: 'Internal warehouse moves' },
  { key: 'delivery', label: 'Delivery', description: 'Final mile delivery' },
];

const BILLING_FREQUENCIES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
];

const BILLING_SCHEDULES = [
  { value: 'not_set', label: 'Not set' },
  { value: 'first_of_month', label: '1st of Month' },
  { value: 'fifteenth_of_month', label: '15th of Month' },
  { value: 'last_of_month', label: 'Last Day of Month' },
];

const PAYMENT_TERMS = [
  { value: 'net_15', label: 'Net 15' },
  { value: 'net_30', label: 'Net 30' },
  { value: 'net_45', label: 'Net 45' },
  { value: 'net_60', label: 'Net 60' },
  { value: 'due_on_receipt', label: 'Due on Receipt' },
];

const CURRENCIES = [
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
  { value: 'GBP', label: 'GBP' },
  { value: 'CAD', label: 'CAD' },
];

const RECEIVING_STATUSES = [
  { value: 'available', label: 'Available' },
  { value: 'pending_inspection', label: 'Pending Inspection' },
  { value: 'quarantine', label: 'Quarantine' },
];

const ACCESS_LEVELS = [
  { value: 'client_read_only', label: 'Client - Read-Only Access' },
  { value: 'client_full', label: 'Client - Full Access' },
  { value: 'partner', label: 'Partner' },
  { value: 'internal', label: 'Internal' },
];

const getDefaultValues = (): AccountFormData => ({
  account_code: '',
  account_name: '',
  account_type: '',
  status: 'active',
  is_master_account: false,
  parent_account_id: 'none',
  can_view_parent_data: false,
  allow_item_reassignment: false,
  sidemark_label: 'sidemark',
  notes: '',
  primary_contact_name: '',
  primary_contact_email: '',
  primary_contact_phone: '',
  billing_contact_name: '',
  billing_contact_email: '',
  billing_contact_phone: '',
  alerts_contact_name: '',
  alerts_contact_email: '',
  account_alert_recipients: '',
  billing_address: '',
  billing_city: '',
  billing_state: '',
  billing_postal_code: '',
  billing_country: 'USA',
  billing_type: 'automatic',
  billing_method: 'per_shipment',
  billing_frequency: 'monthly',
  billing_schedule: 'not_set',
  payment_terms: 'net_30',
  currency: 'USD',
  billing_net_terms: 30,
  net_terms: 30,
  credit_limit: undefined,
  credit_limit_amount: undefined,
  prepay_required: false,
  credit_hold: false,
  pricing_level: 'default',
  pricing_percentage: undefined,
  pricing_apply_to: 'all',
  pricing_selected_services: [],
  auto_inspection_on_receiving: false,
  auto_assembly_on_receiving: false,
  auto_repair_on_damage: false,
  auto_quarantine_damaged_items: false,
  require_sidemark: false,
  require_inspection_photos: false,
  hide_internal_fields_from_clients: false,
  default_receiving_status: 'available',
  default_receiving_location_id: '',
  default_item_notes: '',
  highlight_item_notes: false,
  default_shipment_notes: '',
  highlight_shipment_notes: false,
  use_tenant_email_defaults: true,
  use_tenant_communication_defaults: true,
  disable_email_communications: false,
  copy_from_account_id: 'none',
  email_subject_override: '',
  email_html_body_override: '',
  email_recipients_override: '',
  access_level: 'client_read_only',
  can_modify_pricing: false,
  can_delete_accounts: false,
  read_only_access: false,
});

// Generate account code from name (first 4 chars uppercase + random 3 digits)
const generateAccountCode = (name: string): string => {
  const prefix = name
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, 4)
    .toUpperCase()
    .padEnd(4, 'X');
  const suffix = Math.floor(100 + Math.random() * 900).toString();
  return `${prefix}-${suffix}`;
};

export function AccountDialog({
  open,
  onOpenChange,
  accountId,
  onSuccess,
}: AccountDialogProps) {
  const [fetching, setFetching] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [serviceSelectionOpen, setServiceSelectionOpen] = useState(false);
  const [accountCodeManuallyEdited, setAccountCodeManuallyEdited] = useState(false);
  const [addAddonDialogOpen, setAddAddonDialogOpen] = useState(false);
  const [addCreditDialogOpen, setAddCreditDialogOpen] = useState(false);
  const { toast } = useToast();
  const { profile } = useAuth();
  const { hasRole } = usePermissions();
  const canAddCredit = hasRole('admin') || hasRole('billing_manager');
  const { types: accountTypes } = useAccountTypes();

  const form = useForm<AccountFormData>({
    resolver: zodResolver(accountSchema),
    defaultValues: getDefaultValues(),
  });

  useEffect(() => {
    if (open) {
      fetchAccounts();
      if (accountId) {
        fetchAccount(accountId);
        setAccountCodeManuallyEdited(true); // Existing accounts have their own code
      } else {
        form.reset(getDefaultValues());
        setAccountCodeManuallyEdited(false); // New accounts can auto-generate
      }
    }
  }, [open, accountId]);

  // Watch account name and auto-generate code for new accounts
  const accountName = form.watch('account_name');
  useEffect(() => {
    if (!accountId && !accountCodeManuallyEdited && accountName && accountName.length >= 2) {
      const generatedCode = generateAccountCode(accountName);
      form.setValue('account_code', generatedCode);
    }
  }, [accountName, accountId, accountCodeManuallyEdited, form]);

  const fetchAccounts = async () => {
    try {
      const { data } = await supabase
        .from('accounts')
        .select('id, account_name')
        .is('deleted_at', null)
        .order('account_name');
      setAccounts(data || []);
    } catch (error) {
      console.error('Error fetching accounts:', error);
    }
  };

  const fetchAccount = async (id: string) => {
    try {
      setFetching(true);
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;

      // Map legacy status values to new ones
      const mapStatus = (s: string): 'active' | 'on_hold' | 'archived' | 'credit_hold' => {
        if (s === 'inactive' || s === 'suspended') return 'on_hold';
        if (s === 'on_hold' || s === 'archived' || s === 'credit_hold') return s as 'on_hold' | 'archived' | 'credit_hold';
        return 'active';
      };

      form.reset({
        account_code: data.account_code,
        account_name: data.account_name,
        account_type: data.account_type || '',
        status: mapStatus(data.status),
        is_master_account: data.is_master_account || false,
        parent_account_id: data.parent_account_id || 'none',
        can_view_parent_data: data.can_view_parent_data || false,
        allow_item_reassignment: data.allow_item_reassignment || false,
        sidemark_label: data.sidemark_label || 'sidemark',
        notes: data.notes || '',
        primary_contact_name: data.primary_contact_name || '',
        primary_contact_email: data.primary_contact_email || '',
        primary_contact_phone: data.primary_contact_phone || '',
        billing_contact_name: data.billing_contact_name || '',
        billing_contact_email: data.billing_contact_email || '',
        billing_contact_phone: data.billing_contact_phone || '',
        alerts_contact_name: data.alerts_contact_name || '',
        alerts_contact_email: data.alerts_contact_email || '',
        account_alert_recipients: data.account_alert_recipients || '',
        billing_address: data.billing_address || '',
        billing_city: data.billing_city || '',
        billing_state: data.billing_state || '',
        billing_postal_code: data.billing_postal_code || '',
        billing_country: data.billing_country || 'USA',
        billing_type: data.billing_type || 'automatic',
        billing_method: data.billing_method || 'per_shipment',
        billing_frequency: data.billing_frequency || 'monthly',
        billing_schedule: data.billing_schedule || 'not_set',
        payment_terms: data.payment_terms || 'net_30',
        currency: data.currency || 'USD',
        billing_net_terms: data.billing_net_terms || 30,
        net_terms: data.net_terms || 30,
        credit_limit: data.credit_limit || undefined,
        credit_limit_amount: data.credit_limit_amount || undefined,
        prepay_required: data.prepay_required || false,
        credit_hold: data.credit_hold || false,
        pricing_level: data.pricing_level || 'default',
        pricing_percentage: undefined,
        pricing_apply_to: 'all',
        pricing_selected_services: [],
        auto_inspection_on_receiving: data.auto_inspection_on_receiving || false,
        auto_assembly_on_receiving: data.auto_assembly_on_receiving || false,
        auto_repair_on_damage: data.auto_repair_on_damage || false,
        auto_quarantine_damaged_items: data.auto_quarantine_damaged_items || false,
        require_sidemark: data.require_sidemark || false,
        require_inspection_photos: data.require_inspection_photos || false,
        hide_internal_fields_from_clients: data.hide_internal_fields_from_clients || false,
        default_receiving_status: data.default_receiving_status || 'available',
        default_receiving_location_id: data.default_receiving_location_id || '',
        default_item_notes: data.default_item_notes || '',
        highlight_item_notes: data.highlight_item_notes || false,
        default_shipment_notes: data.default_shipment_notes || '',
        highlight_shipment_notes: data.highlight_shipment_notes || false,
        use_tenant_email_defaults: data.use_tenant_email_defaults ?? true,
        use_tenant_communication_defaults: data.use_tenant_communication_defaults ?? true,
        disable_email_communications: data.disable_email_communications || false,
        copy_from_account_id: data.copy_from_account_id || 'none',
        email_subject_override: data.email_subject_override || '',
        email_html_body_override: data.email_html_body_override || '',
        email_recipients_override: data.email_recipients_override || '',
        access_level: data.access_level || 'client_read_only',
        can_modify_pricing: data.can_modify_pricing || false,
        can_delete_accounts: data.can_delete_accounts || false,
        read_only_access: data.read_only_access || false,
      });
    } catch (error) {
      console.error('Error fetching account:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load account details',
      });
      onOpenChange(false);
    } finally {
      setFetching(false);
    }
  };

  const onSubmit = async (data: AccountFormData) => {
    if (!profile?.tenant_id) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No tenant found. Please log in again.',
      });
      return;
    }

    try {
      const accountData = {
        account_code: data.account_code,
        account_name: data.account_name,
        account_type: data.account_type || null,
        status: data.status,
        is_master_account: data.is_master_account || false,
        parent_account_id: data.parent_account_id === 'none' ? null : data.parent_account_id || null,
        can_view_parent_data: data.can_view_parent_data || false,
        allow_item_reassignment: data.allow_item_reassignment || false,
        sidemark_label: data.sidemark_label || 'sidemark',
        notes: data.notes || null,
        primary_contact_name: data.primary_contact_name || null,
        primary_contact_email: data.primary_contact_email || null,
        primary_contact_phone: data.primary_contact_phone || null,
        billing_contact_name: data.billing_contact_name || null,
        billing_contact_email: data.billing_contact_email || null,
        billing_contact_phone: data.billing_contact_phone || null,
        alerts_contact_name: data.alerts_contact_name || null,
        alerts_contact_email: data.alerts_contact_email || null,
        account_alert_recipients: data.account_alert_recipients || null,
        billing_address: data.billing_address || null,
        billing_city: data.billing_city || null,
        billing_state: data.billing_state || null,
        billing_postal_code: data.billing_postal_code || null,
        billing_country: data.billing_country || null,
        billing_type: data.billing_type || null,
        billing_method: data.billing_method || null,
        billing_frequency: data.billing_frequency || null,
        billing_schedule: data.billing_schedule || null,
        payment_terms: data.payment_terms || null,
        currency: data.currency || null,
        billing_net_terms: data.billing_net_terms || null,
        net_terms: data.net_terms || null,
        credit_limit: data.credit_limit || null,
        credit_limit_amount: data.credit_limit_amount || null,
        prepay_required: data.prepay_required || false,
        credit_hold: data.credit_hold || false,
        pricing_level: data.pricing_level || null,
        auto_inspection_on_receiving: data.auto_inspection_on_receiving || false,
        auto_assembly_on_receiving: data.auto_assembly_on_receiving || false,
        auto_repair_on_damage: data.auto_repair_on_damage || false,
        auto_quarantine_damaged_items: data.auto_quarantine_damaged_items || false,
        require_sidemark: data.require_sidemark || false,
        require_inspection_photos: data.require_inspection_photos || false,
        hide_internal_fields_from_clients: data.hide_internal_fields_from_clients || false,
        default_receiving_status: data.default_receiving_status || null,
        default_receiving_location_id: data.default_receiving_location_id || null,
        default_item_notes: data.default_item_notes || null,
        highlight_item_notes: data.highlight_item_notes || false,
        default_shipment_notes: data.default_shipment_notes || null,
        highlight_shipment_notes: data.highlight_shipment_notes || false,
        use_tenant_email_defaults: data.use_tenant_email_defaults ?? true,
        use_tenant_communication_defaults: data.use_tenant_communication_defaults ?? true,
        disable_email_communications: data.disable_email_communications || false,
        copy_from_account_id: data.copy_from_account_id === 'none' ? null : data.copy_from_account_id || null,
        email_subject_override: data.email_subject_override || null,
        email_html_body_override: data.email_html_body_override || null,
        email_recipients_override: data.email_recipients_override || null,
        access_level: data.access_level || null,
        can_modify_pricing: data.can_modify_pricing || false,
        can_delete_accounts: data.can_delete_accounts || false,
        read_only_access: data.read_only_access || false,
      };

      if (accountId) {
        const { error } = await supabase
          .from('accounts')
          .update(accountData)
          .eq('id', accountId);

        if (error) throw error;

        toast({
          title: 'Account updated',
          description: `${data.account_name} has been updated successfully.`,
        });
      } else {
        const { error } = await supabase.from('accounts').insert([
          {
            ...accountData,
            tenant_id: profile.tenant_id,
          },
        ]);

        if (error) throw error;

        toast({
          title: 'Account created',
          description: `${data.account_name} has been created successfully.`,
        });
      }

      onSuccess();
    } catch (error: unknown) {
      console.error('Error saving account:', error);
      const errorMessage =
        error instanceof Error && 'code' in error && (error as { code: string }).code === '23505'
          ? 'An account with this code already exists'
          : 'Failed to save account';
      toast({
        variant: 'destructive',
        title: 'Error',
        description: errorMessage,
      });
      throw error;
    }
  };

  const isEditing = !!accountId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[850px] max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Account' : 'Add New Account'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update the account details below.'
              : 'Create a new customer account with master or sub-account configuration.'}
          </DialogDescription>
        </DialogHeader>

        {fetching ? (
          <div className="flex items-center justify-center h-48">
            <MaterialIcon name="progress_activity" className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <Tabs defaultValue="basic" className="w-full">
                <TabsList className={`grid w-full mb-4 gap-1 h-auto ${isEditing ? 'grid-cols-5 sm:grid-cols-9' : 'grid-cols-4 sm:grid-cols-6'}`}>
                  <TabsTrigger value="basic" className="text-xs sm:text-sm px-2 sm:px-3 truncate min-w-0">Basic</TabsTrigger>
                  <TabsTrigger value="contacts" className="text-xs sm:text-sm px-2 sm:px-3 truncate min-w-0">Contacts</TabsTrigger>
                  <TabsTrigger value="pricing" className="text-xs sm:text-sm px-2 sm:px-3 truncate min-w-0">Pricing</TabsTrigger>
                  <TabsTrigger value="billing" className="text-xs sm:text-sm px-2 sm:px-3 truncate min-w-0">Billing</TabsTrigger>
                  <TabsTrigger value="preferences" className="text-xs sm:text-sm px-2 sm:px-3 truncate min-w-0">Preferences</TabsTrigger>
                  <TabsTrigger value="permissions" className="text-xs sm:text-sm px-2 sm:px-3 truncate min-w-0">Permissions</TabsTrigger>
                  {isEditing && (
                    <TabsTrigger value="invoices" className="text-xs sm:text-sm px-2 sm:px-3 truncate min-w-0 gap-1">
                      <MaterialIcon name="receipt" className="h-3 w-3 hidden sm:inline" />
                      Invoices
                    </TabsTrigger>
                  )}
                  {isEditing && (
                    <TabsTrigger value="portal" className="text-xs sm:text-sm px-2 sm:px-3 truncate min-w-0 gap-1">
                      <MaterialIcon name="group" className="h-3 w-3 hidden sm:inline" />
                      Portal
                    </TabsTrigger>
                  )}
                  {isEditing && (
                    <TabsTrigger value="activity" className="text-xs sm:text-sm px-2 sm:px-3 truncate min-w-0 gap-1">
                      <MaterialIcon name="timeline" className="h-3 w-3 hidden sm:inline" />
                      Activity
                    </TabsTrigger>
                  )}
                </TabsList>

                <ScrollArea className="h-[50vh] pr-4">
                  {/* Basic Tab */}
                  <TabsContent value="basic" className="space-y-4 mt-0">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="account_name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Client Account Name *</FormLabel>
                            <FormControl>
                              <Input placeholder="Account Name" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="account_code"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Account Code *</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="ACME-001"
                                {...field}
                                onChange={(e) => {
                                  setAccountCodeManuallyEdited(true);
                                  field.onChange(e.target.value.toUpperCase());
                                }}
                              />
                            </FormControl>
                            <FormDescription>
                              Auto-generated from account name. Edit to customize.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="account_type"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Account Type</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select type" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {accountTypes.map((type) => (
                                  <SelectItem key={type} value={type}>
                                    {type}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="status"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Status *</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select status" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {ACCOUNT_STATUSES.map((s) => (
                                  <SelectItem key={s.value} value={s.value}>
                                    {s.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="space-y-4">
                      <FormField
                        control={form.control}
                        name="is_master_account"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={(checked) => {
                                  field.onChange(checked);
                                  if (!checked) {
                                    form.setValue('parent_account_id', 'none');
                                  }
                                }}
                              />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                              <FormLabel className="font-normal">
                                Sub Account
                              </FormLabel>
                              <FormDescription>
                                Check if this is a sub-account of another primary account
                              </FormDescription>
                            </div>
                          </FormItem>
                        )}
                      />

                      {form.watch('is_master_account') && (
                        <>
                          <FormField
                            control={form.control}
                            name="parent_account_id"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Primary Account</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Search and select primary account..." />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="none">Select a primary account</SelectItem>
                                    {accounts
                                      .filter((a) => a.id !== accountId)
                                      .map((a) => (
                                        <SelectItem key={a.id} value={a.id}>
                                          {a.account_name}
                                        </SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                                <FormDescription>
                                  Primary account users automatically have access to this sub-account.
                                </FormDescription>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="can_view_parent_data"
                            render={({ field }) => (
                              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                                <div className="space-y-0.5">
                                  <FormLabel className="text-base">View Parent Data</FormLabel>
                                  <FormDescription>
                                    Allow users of this sub-account to view parent account items and data
                                  </FormDescription>
                                </div>
                                <FormControl>
                                  <Switch
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="sidemark_label"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Sidemark Display Label</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="sidemark">Sidemark</SelectItem>
                                    <SelectItem value="reference">Reference</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormDescription>
                                  How sidemark fields appear in the UI for this account
                                </FormDescription>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </>
                      )}

                      {/* Parent account permissions - only show for non-sub-accounts */}
                      {!form.watch('is_master_account') && (
                        <FormField
                          control={form.control}
                          name="allow_item_reassignment"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                              <div className="space-y-0.5">
                                <FormLabel className="text-base">Allow Item Reassignment</FormLabel>
                                <FormDescription>
                                  Enable all users in this account hierarchy to reassign items between accounts
                                </FormDescription>
                              </div>
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      )}
                    </div>

                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description / Notes</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Additional notes about this account..."
                              className="resize-none"
                              rows={3}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </TabsContent>

                  {/* Contacts Tab */}
                  <TabsContent value="contacts" className="space-y-6 mt-0">
                    <div>
                      <h4 className="text-sm font-medium mb-3">Primary Contact</h4>
                      <div className="grid grid-cols-3 gap-4">
                        <FormField
                          control={form.control}
                          name="primary_contact_name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Name</FormLabel>
                              <FormControl>
                                <Input placeholder="John Doe" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="primary_contact_email"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Email</FormLabel>
                              <FormControl>
                                <Input type="email" placeholder="john@example.com" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="primary_contact_phone"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Phone</FormLabel>
                              <FormControl>
                                <Input placeholder="(555) 123-4567" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium mb-3">Billing Contact</h4>
                      <div className="grid grid-cols-3 gap-4">
                        <FormField
                          control={form.control}
                          name="billing_contact_name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Name</FormLabel>
                              <FormControl>
                                <Input placeholder="Jane Doe" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="billing_contact_email"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Email</FormLabel>
                              <FormControl>
                                <Input type="email" placeholder="billing@example.com" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="billing_contact_phone"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Phone</FormLabel>
                              <FormControl>
                                <Input placeholder="(555) 987-6543" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium mb-3">Alerts Contact</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="alerts_contact_name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Name</FormLabel>
                              <FormControl>
                                <Input placeholder="Operations Manager" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="alerts_contact_email"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Email</FormLabel>
                              <FormControl>
                                <Input type="email" placeholder="alerts@example.com" {...field} />
                              </FormControl>
                              <FormDescription>
                                Receives system alerts and notifications
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium mb-3">Alert Recipients</h4>
                      <FormField
                        control={form.control}
                        name="account_alert_recipients"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Contact Recipients</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="john@example.com, +1-555-123-4567, jane@example.com"
                                className="resize-none"
                                rows={2}
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              Comma-separated emails and phone numbers for all account alerts. 
                              Available in templates as {'{{account_contact_email}}'}, {'{{account_contact_phone}}'}, and {'{{account_contact_recipients_raw}}'}.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div>
                      <h4 className="text-sm font-medium mb-3">Billing Address</h4>
                      <div className="space-y-4">
                        <FormField
                          control={form.control}
                          name="billing_address"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Street Address</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="123 Main Street"
                                  className="resize-none"
                                  rows={2}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="grid grid-cols-4 gap-4">
                          <FormField
                            control={form.control}
                            name="billing_city"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>City</FormLabel>
                                <FormControl>
                                  <Input placeholder="Seattle" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="billing_state"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>State</FormLabel>
                                <FormControl>
                                  <Input placeholder="WA" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="billing_postal_code"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Postal Code</FormLabel>
                                <FormControl>
                                  <Input placeholder="98121" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="billing_country"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Country</FormLabel>
                                <FormControl>
                                  <Input placeholder="USA" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  {/* Pricing Tab - Account-specific price adjustments */}
                  <TabsContent value="pricing" className="space-y-4 mt-0">
                    {accountId ? (
                      <AccountPricingTab
                        accountId={accountId}
                        accountName={form.watch('account_name') || 'this account'}
                      />
                    ) : (
                      <div className="text-center py-12 text-muted-foreground">
                        <MaterialIcon name="attach_money" className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p className="font-medium">Pricing Adjustments</p>
                        <p className="text-sm mt-2">
                          Save the account first to configure custom pricing adjustments.
                        </p>
                      </div>
                    )}
                  </TabsContent>

                  {/* Billing Tab */}
                  <TabsContent value="billing" className="space-y-4 mt-0">
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="billing_type"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Billing Type</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select type" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {BILLING_TYPES.map((type) => (
                                  <SelectItem key={type.value} value={type.value}>
                                    {type.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="billing_frequency"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Billing Frequency</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select frequency" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {BILLING_FREQUENCIES.map((freq) => (
                                  <SelectItem key={freq.value} value={freq.value}>
                                    {freq.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="billing_schedule"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Billing Schedule</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select schedule" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {BILLING_SCHEDULES.map((schedule) => (
                                  <SelectItem key={schedule.value} value={schedule.value}>
                                    {schedule.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="payment_terms"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Payment Terms</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select terms" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {PAYMENT_TERMS.map((term) => (
                                  <SelectItem key={term.value} value={term.value}>
                                    {term.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="currency"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Currency</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select currency" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {CURRENCIES.map((curr) => (
                                  <SelectItem key={curr.value} value={curr.value}>
                                    {curr.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="billing_net_terms"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Net Terms (Days)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                placeholder="30"
                                {...field}
                                value={field.value ?? ''}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="credit_limit"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Credit Limit</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                placeholder="10000.00"
                                {...field}
                                value={field.value ?? ''}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="pt-6">
                        <FormField
                          control={form.control}
                          name="prepay_required"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                              <FormLabel className="font-normal">Prepayment Required</FormLabel>
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                  </TabsContent>

                  {/* Preferences Tab (merged Automations + Inventory) */}
                  <TabsContent value="preferences" className="space-y-6 mt-0">
                    {/* Automations Section */}
                    <div className="space-y-4">
                      <h4 className="text-sm font-medium">Automations</h4>
                      <p className="text-sm text-muted-foreground">
                        Configure per-account automation settings.
                      </p>

                      <FormField
                        control={form.control}
                        name="auto_inspection_on_receiving"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                            <FormLabel className="font-normal">Auto Inspection on Receiving</FormLabel>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="auto_assembly_on_receiving"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                            <FormLabel className="font-normal">Auto Assembly on Receiving</FormLabel>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="auto_repair_on_damage"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                            <FormLabel className="font-normal">Auto Repair on Damage</FormLabel>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="auto_quarantine_damaged_items"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                            <FormLabel className="font-normal">Auto Quarantine Damaged Items</FormLabel>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* Inventory Section */}
                    <div className="space-y-4 pt-4 border-t">
                      <h4 className="text-sm font-medium">Inventory Settings</h4>
                      <p className="text-sm text-muted-foreground">
                        Control inventory handling and visibility rules for this account.
                      </p>

                      <FormField
                        control={form.control}
                        name="require_sidemark"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                            <FormLabel className="font-normal">Require Sidemark</FormLabel>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="require_inspection_photos"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                            <FormLabel className="font-normal">Require Inspection Photos</FormLabel>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="hide_internal_fields_from_clients"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                            <FormLabel className="font-normal">Hide Internal Fields from Clients</FormLabel>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="default_receiving_status"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Default Receiving Status</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select status" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {RECEIVING_STATUSES.map((status) => (
                                  <SelectItem key={status.value} value={status.value}>
                                    {status.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* Default Notes Section */}
                    <div className="space-y-4 pt-4 border-t">
                      <h4 className="text-sm font-medium">Default Notes</h4>
                      <p className="text-sm text-muted-foreground">
                        These notes will automatically appear on items and shipments for this account.
                      </p>

                      <FormField
                        control={form.control}
                        name="default_item_notes"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Default Item Notes</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="Enter notes that will be displayed on all items for this account..."
                                className="resize-none"
                                rows={3}
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              These notes will be displayed on the item details page for all items belonging to this account.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="highlight_item_notes"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                            <FormLabel className="font-normal">Highlight item notes on details page</FormLabel>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="default_shipment_notes"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Default Shipment Notes</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="Enter notes that will pre-fill the shipment notes field..."
                                className="resize-none"
                                rows={3}
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              These notes will pre-fill the notes field when creating shipments (editable by user).
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="highlight_shipment_notes"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                            <FormLabel className="font-normal">Highlight shipment notes for visibility</FormLabel>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                  </TabsContent>

                  {/* Permissions Tab */}
                  <TabsContent value="permissions" className="space-y-4 mt-0">
                    <p className="text-sm text-muted-foreground">
                      Configure access level settings for this account.
                    </p>

                    <FormField
                      control={form.control}
                      name="access_level"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Access Level</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select access level" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {ACCESS_LEVELS.map((level) => (
                                <SelectItem key={level.value} value={level.value}>
                                  {level.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormDescription>
                            Controls the default access level for users associated with this account
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </TabsContent>

                  {/* Invoices Tab - Only shown when editing */}
                  {isEditing && accountId && (
                    <TabsContent value="invoices" className="mt-0">
                      <AccountInvoicesTab
                        accountId={accountId}
                        accountName={form.watch('account_name') || 'this account'}
                      />
                    </TabsContent>
                  )}

                  {/* Portal Tab - Only shown when editing */}
                  {isEditing && accountId && (
                    <TabsContent value="portal" className="mt-0">
                      <ClientPortalSection
                        accountId={accountId}
                        accountName={form.watch('account_name') || 'this account'}
                      />
                    </TabsContent>
                  )}

                  {/* Activity Tab - Only shown when editing */}
                  {isEditing && accountId && (
                    <TabsContent value="activity" className="mt-0">
                      <AccountActivityTab accountId={accountId} />
                    </TabsContent>
                  )}
                </ScrollArea>
              </Tabs>

              <DialogFooter className="pt-4 border-t mt-4">
                {isEditing && accountId && (
                  <div className="flex gap-2 mr-auto">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setAddAddonDialogOpen(true)}
                    >
                      <MaterialIcon name="attach_money" size="sm" className="mr-2" />
                      Add Charge
                    </Button>
                    {canAddCredit && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setAddCreditDialogOpen(true)}
                      >
                        <MaterialIcon name="money_off" size="sm" className="mr-2" />
                        Add Credit
                      </Button>
                    )}
                  </div>
                )}
                <SaveButton
                  type="button"
                  onClick={() => form.handleSubmit(onSubmit)()}
                  label={isEditing ? 'Update Account' : 'Create Account'}
                  savingLabel={isEditing ? 'Updating...' : 'Creating...'}
                  savedLabel={isEditing ? 'Updated' : 'Created'}
                />
              </DialogFooter>
            </form>
          </Form>
        )}

        {/* Add Charge Dialog */}
        {isEditing && accountId && (
          <AddAddonDialog
            open={addAddonDialogOpen}
            onOpenChange={setAddAddonDialogOpen}
            accountId={accountId}
            accountName={form.watch('account_name') || undefined}
            onSuccess={onSuccess}
          />
        )}

        {/* Add Credit Dialog - Admin Only */}
        {isEditing && accountId && (
          <AddCreditDialog
            open={addCreditDialogOpen}
            onOpenChange={setAddCreditDialogOpen}
            accountId={accountId}
            accountName={form.watch('account_name') || undefined}
            onSuccess={onSuccess}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
