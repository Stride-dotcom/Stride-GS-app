import { useState } from 'react';
import { getRoleDisplayName } from '@/lib/roles';
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
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
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Role } from '@/hooks/useUsers';
import { PromptLevel } from '@/types/guidedPrompts';
import { syncStripeSubscriptionSeatsBestEffort } from '@/lib/saas/syncStripeSeats';

const inviteSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  role_id: z.string().min(1, 'Please select a role'),
  prompt_level: z.enum(['training', 'standard', 'advanced']),
  is_employee: z.boolean(),
  labor_rate: z.number().min(0).nullable(),
});

type InviteFormData = z.infer<typeof inviteSchema>;

interface InviteUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: Role[];
  onSuccess: () => void;
}

const PROMPT_LEVEL_INFO: Record<PromptLevel, { label: string; description: string }> = {
  training: {
    label: 'Training',
    description: 'All prompts shown - best for new employees',
  },
  standard: {
    label: 'Standard',
    description: 'Warning and blocking prompts only',
  },
  advanced: {
    label: 'Advanced',
    description: 'Blocking prompts only - for experienced staff',
  },
};

export function InviteUserDialog({
  open,
  onOpenChange,
  roles,
  onSuccess,
}: InviteUserDialogProps) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { profile } = useAuth();

  const form = useForm<InviteFormData>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: '',
      first_name: '',
      last_name: '',
      role_id: '',
      prompt_level: 'training',
      is_employee: false,
      labor_rate: null,
    },
  });

  const isEmployee = form.watch('is_employee');

  const onSubmit = async (data: InviteFormData) => {
    if (!profile?.tenant_id || !profile?.id) return;

    try {
      setLoading(true);

      // Check if user already exists
      const { data: existingUser } = await supabase
        .from('users')
        .select('id, email, deleted_at')
        .eq('email', data.email.toLowerCase())
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle();

      if (existingUser && !existingUser.deleted_at) {
        toast({
          variant: 'destructive',
          title: 'User already exists',
          description: 'A user with this email already exists in your organization.',
        });
        return;
      }

      // Create a pending user record
      const { data: newUser, error: userError } = await supabase
        .from('users')
        .insert({
          email: data.email.toLowerCase(),
          first_name: data.first_name || null,
          last_name: data.last_name || null,
          tenant_id: profile.tenant_id,
          status: 'pending',
          password_hash: 'PENDING_INVITE',
          labor_rate: data.is_employee ? data.labor_rate : null,
        })
        .select()
        .single();

      if (userError) throw userError;

      // Assign the selected role
      const { error: roleError } = await supabase
        .from('user_roles')
        .insert({
          user_id: newUser.id,
          role_id: data.role_id,
          assigned_by: profile.id,
        });

      if (roleError) throw roleError;

      // Create prompt settings
      const { error: promptError } = await supabase
        .from('user_prompt_settings')
        .insert({
          user_id: newUser.id,
          tenant_id: profile.tenant_id,
          prompt_level: data.prompt_level,
        });

      if (promptError) {
        console.error('Error creating prompt settings:', promptError);
        // Don't fail the whole operation
      }

      toast({
        title: 'Invitation sent',
        description: `An invitation has been created for ${data.email}. They will receive access when they sign up with this email.`,
      });

      // Seat-based billing: adding a staff member should update Stripe quantity automatically.
      void syncStripeSubscriptionSeatsBestEffort("invite_user_dialog_created");

      form.reset();
      onSuccess();
    } catch (error) {
      console.error('Error inviting user:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to create invitation. Please try again.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MaterialIcon name="person_add" size="md" />
            Add User
          </DialogTitle>
          <DialogDescription>
            Add a new user to your organization. They will receive access when they sign up.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Address *</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <MaterialIcon name="mail" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="user@example.com"
                        className="pl-9"
                        {...field}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="first_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First Name</FormLabel>
                    <FormControl>
                      <Input placeholder="John" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="last_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="role_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role *</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={!roles || roles.length === 0}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={!roles || roles.length === 0 ? "Loading roles..." : "Select a role"} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(!roles || roles.length === 0) ? (
                          <SelectItem value="__loading__" disabled>
                            No roles available
                          </SelectItem>
                        ) : (
                          roles.map((role) => (
                            <SelectItem key={role.id} value={role.id}>
                              {getRoleDisplayName(role.name)}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="prompt_level"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prompt Level</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select level" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(Object.keys(PROMPT_LEVEL_INFO) as PromptLevel[]).map((level) => (
                          <SelectItem key={level} value={level}>
                            {PROMPT_LEVEL_INFO[level].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription className="text-xs">
                      {PROMPT_LEVEL_INFO[field.value]?.description}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* Employee Section */}
            <FormField
              control={form.control}
              name="is_employee"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Employee</FormLabel>
                    <FormDescription>
                      Track labor costs for this user
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

            {isEmployee && (
              <FormField
                control={form.control}
                name="labor_rate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hourly Rate ($)</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <MaterialIcon name="attach_money" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          className="pl-9"
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                        />
                      </div>
                    </FormControl>
                    <FormDescription>
                      Used for labor cost calculations in reports
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

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
                Send Invitation
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
