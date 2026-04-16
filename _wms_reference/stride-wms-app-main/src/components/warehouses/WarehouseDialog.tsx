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
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

const warehouseSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  code: z.string().min(1, 'Code is required').max(20).regex(/^[A-Z0-9_-]+$/i, 'Code must be alphanumeric with dashes or underscores'),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  postal_code: z.string().optional(),
  timezone: z.string().min(1, 'Timezone is required'),
  status: z.enum(['active', 'inactive', 'maintenance']),
});

type WarehouseFormData = z.infer<typeof warehouseSchema>;

interface WarehouseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouseId: string | null;
  onSuccess: () => void;
}

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Australia/Sydney',
];

export function WarehouseDialog({
  open,
  onOpenChange,
  warehouseId,
  onSuccess,
}: WarehouseDialogProps) {
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const { toast } = useToast();
  const { profile } = useAuth();

  const form = useForm<WarehouseFormData>({
    resolver: zodResolver(warehouseSchema),
    defaultValues: {
      name: '',
      code: '',
      address: '',
      city: '',
      state: '',
      country: '',
      postal_code: '',
      timezone: 'America/New_York',
      status: 'active',
    },
  });

  useEffect(() => {
    if (open && warehouseId) {
      fetchWarehouse(warehouseId);
    } else if (open && !warehouseId) {
      form.reset({
        name: '',
        code: '',
        address: '',
        city: '',
        state: '',
        country: '',
        postal_code: '',
        timezone: 'America/New_York',
        status: 'active',
      });
    }
  }, [open, warehouseId]);

  const fetchWarehouse = async (id: string) => {
    try {
      setFetching(true);
      const { data, error } = await supabase
        .from('warehouses')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;

      form.reset({
        name: data.name,
        code: data.code,
        address: data.address || '',
        city: data.city || '',
        state: data.state || '',
        country: data.country || '',
        postal_code: data.postal_code || '',
        timezone: data.timezone,
        status: data.status as 'active' | 'inactive' | 'maintenance',
      });
    } catch (error) {
      console.error('Error fetching warehouse:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load warehouse details',
      });
      onOpenChange(false);
    } finally {
      setFetching(false);
    }
  };

  const onSubmit = async (data: WarehouseFormData) => {
    if (!profile?.tenant_id) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No tenant found. Please log in again.',
      });
      return;
    }

    try {
      setLoading(true);

      if (warehouseId) {
        // Update existing warehouse
        const { error } = await supabase
          .from('warehouses')
          .update({
            name: data.name,
            code: data.code,
            address: data.address || null,
            city: data.city || null,
            state: data.state || null,
            country: data.country || null,
            postal_code: data.postal_code || null,
            timezone: data.timezone,
            status: data.status,
          })
          .eq('id', warehouseId);

        if (error) throw error;

        toast({
          title: 'Warehouse updated',
          description: `${data.name} has been updated successfully.`,
        });
      } else {
        // Create new warehouse
        const { error } = await supabase.from('warehouses').insert([
          {
            name: data.name,
            code: data.code,
            address: data.address || null,
            city: data.city || null,
            state: data.state || null,
            country: data.country || null,
            postal_code: data.postal_code || null,
            timezone: data.timezone,
            status: data.status,
            tenant_id: profile.tenant_id,
          },
        ]);

        if (error) throw error;

        toast({
          title: 'Warehouse created',
          description: `${data.name} has been created successfully.`,
        });
      }

      onSuccess();
    } catch (error: unknown) {
      console.error('Error saving warehouse:', error);
      const errorMessage = error instanceof Error && 'code' in error && (error as { code: string }).code === '23505'
        ? 'A warehouse with this code already exists'
        : 'Failed to save warehouse';
      toast({
        variant: 'destructive',
        title: 'Error',
        description: errorMessage,
      });
    } finally {
      setLoading(false);
    }
  };

  const isEditing = !!warehouseId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Warehouse' : 'Add Warehouse'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update the warehouse details below.'
              : 'Enter the details for your new warehouse.'}
          </DialogDescription>
        </DialogHeader>

        {fetching ? (
          <div className="flex items-center justify-center h-48">
            <MaterialIcon name="progress_activity" className="animate-spin text-muted-foreground" style={{ fontSize: '32px' }} />
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="Main Warehouse" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Code *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="WH-MAIN"
                          {...field}
                          onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                        />
                      </FormControl>
                      <FormDescription>Unique identifier</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="123 Warehouse Street"
                        className="resize-none"
                        rows={2}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <FormControl>
                        <Input placeholder="New York" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>State / Province</FormLabel>
                      <FormControl>
                        <Input placeholder="NY" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="country"
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

                <FormField
                  control={form.control}
                  name="postal_code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Postal Code</FormLabel>
                      <FormControl>
                        <Input placeholder="10001" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="timezone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Timezone *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select timezone" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {TIMEZONES.map((tz) => (
                            <SelectItem key={tz} value={tz}>
                              {tz.replace(/_/g, ' ')}
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
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                          <SelectItem value="maintenance">Maintenance</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter className="pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
                  {isEditing ? 'Update Warehouse' : 'Create Warehouse'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
