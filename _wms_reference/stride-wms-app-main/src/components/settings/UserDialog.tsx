import { useEffect, useMemo, useState } from 'react';
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
import { getRoleDisplayName } from '@/lib/roles';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { SaveButton } from '@/components/ui/SaveButton';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { UserWithRoles, Role } from '@/hooks/useUsers';
import { PromptLevel } from '@/types/guidedPrompts';
import { isUsernameFormatValid, normalizeUsernameInput, USERNAME_FORMAT_HINT } from '@/lib/users/username';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
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

const userSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  status: z.enum(['active', 'inactive', 'suspended', 'pending']),
  roleIds: z.array(z.string()),
  prompt_level: z.enum(['training', 'standard', 'advanced']),
  is_employee: z.boolean(),
  labor_rate: z.number().min(0).nullable(),
});

type UserFormData = z.infer<typeof userSchema>;

interface UserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
  users: UserWithRoles[];
  roles: Role[];
  currentUserId?: string;
  onSuccess: () => void;
  onAssignRole: (userId: string, roleId: string) => Promise<void>;
  onRemoveRole: (userId: string, roleId: string) => Promise<void>;
  onUpdatePromptLevel?: (userId: string, level: PromptLevel) => Promise<void>;
  onResendInvite?: (userId: string) => Promise<void>;
  onRevokeAccess?: (userId: string) => Promise<void>;
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

export function UserDialog({
  open,
  onOpenChange,
  userId,
  users,
  roles,
  currentUserId,
  onSuccess,
  onAssignRole,
  onRemoveRole,
  onUpdatePromptLevel,
  onResendInvite,
  onRevokeAccess,
}: UserDialogProps) {
  const [loading, setLoading] = useState(false);
  const [resendingInvite, setResendingInvite] = useState(false);
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [inAppEnabled, setInAppEnabled] = useState(true);
  const [inAppLoading, setInAppLoading] = useState(false);
  const [inAppSaving, setInAppSaving] = useState(false);
  const { toast } = useToast();

  const user = users.find((u) => u.id === userId);
  const isCurrentUser = userId === currentUserId;
  const isPending = user?.status === 'pending';
  const actor = users.find((u) => u.id === currentUserId);

  const actorRoleNames = useMemo(
    () => new Set((actor?.roles || []).map((r) => r.name.toLowerCase())),
    [actor?.roles]
  );
  const targetRoleNames = useMemo(
    () => new Set((user?.roles || []).map((r) => r.name.toLowerCase())),
    [user?.roles]
  );
  const canManagerControl = ['manager', 'admin', 'admin_dev'].some((r) => actorRoleNames.has(r));
  const targetOperationalRole = ['client_user', 'warehouse', 'technician'].some((r) => targetRoleNames.has(r));
  const canDisableInAppForTarget = canManagerControl && targetOperationalRole;
  const canEnableInAppForTarget = canManagerControl || isCurrentUser;
  const showInAppToggle = Boolean(userId) && (canManagerControl || isCurrentUser);

  const form = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      first_name: '',
      last_name: '',
      username: '',
      status: 'active',
      roleIds: [],
      prompt_level: 'training',
      is_employee: false,
      labor_rate: null,
    },
  });

  const isEmployee = form.watch('is_employee');

  useEffect(() => {
    if (open && user) {
      const hasLaborRate = user.labor_rate !== null && user.labor_rate > 0;
      form.reset({
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        username: user.username || '',
        status: user.status as 'active' | 'inactive' | 'suspended' | 'pending',
        roleIds: user.roles.map((r) => r.id),
        prompt_level: user.prompt_level || 'training',
        is_employee: hasLaborRate,
        labor_rate: user.labor_rate || null,
      });
    }
  }, [open, user, form]);

  useEffect(() => {
    if (!open || !userId || !showInAppToggle) return;
    let cancelled = false;

    const loadPreference = async () => {
      setInAppLoading(true);
      try {
        const { data, error } = await (supabase as any).rpc('rpc_get_user_in_app_alert_preference', {
          p_user_id: userId,
        });
        if (error) throw error;

        const row = Array.isArray(data) ? data[0] : null;
        const enabled = row?.enabled !== false;
        if (!cancelled) {
          setInAppEnabled(enabled);
        }
      } catch (error) {
        console.error('Error loading in-app preference:', error);
      } finally {
        if (!cancelled) {
          setInAppLoading(false);
        }
      }
    };

    void loadPreference();
    return () => {
      cancelled = true;
    };
  }, [open, showInAppToggle, userId]);

  const handleToggleInAppPreference = async (checked: boolean) => {
    if (!userId) return;
    if (!checked && !canDisableInAppForTarget) {
      toast({
        variant: 'destructive',
        title: 'Not allowed',
        description: 'Only manager/admin roles can turn OFF in-app alerts for client/warehouse users.',
      });
      return;
    }
    if (checked && !canEnableInAppForTarget) {
      toast({
        variant: 'destructive',
        title: 'Not allowed',
        description: 'You are not allowed to enable in-app alerts for this user.',
      });
      return;
    }

    const previous = inAppEnabled;
    setInAppEnabled(checked);
    setInAppSaving(true);
    try {
      const { error } = await (supabase as any).rpc('rpc_set_user_in_app_alert_preference', {
        p_user_id: userId,
        p_enabled: checked,
      });
      if (error) throw error;
      toast({
        title: 'Updated',
        description: `In-app alerts ${checked ? 'enabled' : 'disabled'} for this user.`,
      });
    } catch (error) {
      console.error('Error saving in-app preference:', error);
      setInAppEnabled(previous);
      toast({
        variant: 'destructive',
        title: 'Update failed',
        description: 'Failed to save in-app alert preference.',
      });
    } finally {
      setInAppSaving(false);
    }
  };

  const handleResendInvite = async () => {
    if (!userId || !onResendInvite) return;

    try {
      setResendingInvite(true);
      await onResendInvite(userId);
      toast({
        title: 'Invitation sent',
        description: 'The invitation email has been resent.',
      });
    } catch (error) {
      console.error('Error resending invite:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to resend invitation',
      });
    } finally {
      setResendingInvite(false);
    }
  };

  const handleRevokeAccess = async () => {
    if (!userId || !onRevokeAccess) return;

    try {
      await onRevokeAccess(userId);
      toast({
        title: 'Access revoked',
        description: 'User access has been suspended.',
      });
      setRevokeDialogOpen(false);
      onSuccess();
    } catch (error) {
      console.error('Error revoking access:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to revoke access',
      });
    }
  };

  const onSubmit = async (data: UserFormData) => {
    if (!userId) return;

    try {
      setLoading(true);

      const requestedUsername = (data.username || '').trim();
      const normalizedUsername = normalizeUsernameInput(requestedUsername);

      if (requestedUsername && !normalizedUsername) {
        toast({
          variant: 'destructive',
          title: 'Invalid username',
          description: USERNAME_FORMAT_HINT,
        });
        return;
      }

      if (normalizedUsername && !isUsernameFormatValid(normalizedUsername)) {
        toast({
          variant: 'destructive',
          title: 'Invalid username',
          description: USERNAME_FORMAT_HINT,
        });
        return;
      }

      if (normalizedUsername && user?.tenant_id) {
        const { data: existingUsernameOwner, error: usernameCheckError } = await (supabase as any)
          .from('users')
          .select('id')
          .eq('tenant_id', user.tenant_id)
          .eq('username', normalizedUsername)
          .is('deleted_at', null)
          .neq('id', userId)
          .limit(1)
          .maybeSingle();

        if (usernameCheckError) throw usernameCheckError;
        if (existingUsernameOwner?.id) {
          toast({
            variant: 'destructive',
            title: 'Username unavailable',
            description: `@${normalizedUsername} is already in use.`,
          });
          return;
        }
      }

      const existingUsername = normalizeUsernameInput(user?.username || '');
      const usernameChanged = normalizedUsername !== existingUsername;
      const nextUsernameIsManual = normalizedUsername
        ? (usernameChanged ? true : Boolean(user?.username_is_manual))
        : false;

      // Update user details including labor_rate
      const { error: updateError } = await (supabase as any)
        .from('users')
        .update({
          first_name: data.first_name || null,
          last_name: data.last_name || null,
          username: normalizedUsername || null,
          username_is_manual: nextUsernameIsManual,
          status: data.status,
          labor_rate: data.is_employee ? data.labor_rate : null,
        })
        .eq('id', userId);

      if (updateError) throw updateError;

      // Update prompt level if handler provided
      if (onUpdatePromptLevel && data.prompt_level !== user?.prompt_level) {
        await onUpdatePromptLevel(userId, data.prompt_level);
      }

      // Handle role changes
      const currentRoleIds = user?.roles.map((r) => r.id) || [];
      const newRoleIds = data.roleIds;

      // Roles to add
      const rolesToAdd = newRoleIds.filter((id) => !currentRoleIds.includes(id));
      // Roles to remove
      const rolesToRemove = currentRoleIds.filter((id) => !newRoleIds.includes(id));

      // Add new roles
      for (const roleId of rolesToAdd) {
        await onAssignRole(userId, roleId);
      }

      // Remove old roles
      for (const roleId of rolesToRemove) {
        await onRemoveRole(userId, roleId);
      }

      toast({
        title: 'User updated',
        description: 'User has been updated successfully.',
      });

      onSuccess();
    } catch (error) {
      console.error('Error updating user:', error);
      if ((error as any)?.code === '23505') {
        toast({
          variant: 'destructive',
          title: 'Username unavailable',
          description: 'This username is already in use in your organization.',
        });
        return;
      }
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update user',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="person" size="md" />
              Edit User
            </DialogTitle>
            <DialogDescription>
              Update user details, roles, and settings.
              {user && <span className="block mt-1 font-medium">{user.email}</span>}
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {/* Basic Info */}
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

              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">@</span>
                        <Input
                          placeholder="first_last"
                          className="pl-8"
                          {...field}
                          value={field.value || ''}
                          onBlur={(e) => field.onChange(normalizeUsernameInput(e.target.value))}
                        />
                      </div>
                    </FormControl>
                    <FormDescription>{USERNAME_FORMAT_HINT} Leave blank to use auto-generated.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={isCurrentUser}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                          <SelectItem value="suspended">Suspended</SelectItem>
                          <SelectItem value="pending">Pending</SelectItem>
                        </SelectContent>
                      </Select>
                      {isCurrentUser && (
                        <p className="text-xs text-muted-foreground">
                          You cannot change your own status
                        </p>
                      )}
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
                              <div className="flex flex-col">
                                <span>{PROMPT_LEVEL_INFO[level].label}</span>
                              </div>
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
              <div className="space-y-4">
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
              </div>

              <Separator />

              {/* Roles */}
              <FormField
                control={form.control}
                name="roleIds"
                render={() => (
                  <FormItem>
                    <FormLabel>Roles</FormLabel>
                    <div className="space-y-2 border rounded-md p-3 max-h-48 overflow-y-auto">
                      {roles.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No roles available</p>
                      ) : (
                        roles.map((role) => (
                          <FormField
                            key={role.id}
                            control={form.control}
                            name="roleIds"
                            render={({ field }) => {
                              const currentValue = field.value || [];
                              return (
                                <FormItem className="flex items-center space-x-2 space-y-0">
                                  <FormControl>
                                    <Checkbox
                                      checked={currentValue.includes(role.id)}
                                      disabled={isCurrentUser && role.name === 'admin'}
                                      onCheckedChange={(checked) => {
                                        if (checked) {
                                          field.onChange([...currentValue, role.id]);
                                        } else {
                                          field.onChange(
                                            currentValue.filter((id) => id !== role.id)
                                          );
                                        }
                                      }}
                                    />
                                  </FormControl>
                                  <div className="flex-1">
                                    <FormLabel className="font-normal cursor-pointer">
                                      {getRoleDisplayName(role.name)}
                                    </FormLabel>
                                    {role.description && (
                                      <p className="text-xs text-muted-foreground">
                                        {role.description}
                                      </p>
                                    )}
                                  </div>
                                </FormItem>
                              );
                            }}
                          />
                        ))
                      )}
                    </div>
                    {isCurrentUser && (
                      <p className="text-xs text-muted-foreground">
                        You cannot remove your own admin role
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {showInAppToggle && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <FormLabel>In-app Alert Delivery</FormLabel>
                    <div className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">In-app alerts from Alert System</p>
                          <p className="text-xs text-muted-foreground">
                            Single switch for alert-system in-app notifications only.
                          </p>
                        </div>
                        <Switch
                          checked={inAppEnabled}
                          disabled={
                            inAppLoading ||
                            inAppSaving ||
                            (inAppEnabled ? !canDisableInAppForTarget : !canEnableInAppForTarget)
                          }
                          onCheckedChange={(checked) => void handleToggleInAppPreference(Boolean(checked))}
                        />
                      </div>
                      {!canDisableInAppForTarget && inAppEnabled && (
                        <p className="text-xs text-muted-foreground">
                          OFF control is limited to manager/admin for client and warehouse role users.
                        </p>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Quick Actions for non-current users */}
              {!isCurrentUser && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <FormLabel>Quick Actions</FormLabel>
                    <div className="flex flex-wrap gap-2">
                      {isPending && onResendInvite && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleResendInvite}
                          disabled={resendingInvite}
                        >
                          {resendingInvite ? (
                            <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                          ) : (
                            <MaterialIcon name="mail" size="sm" className="mr-2" />
                          )}
                          Resend Invite
                        </Button>
                      )}
                      {user?.status === 'active' && onRevokeAccess && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-destructive border-destructive hover:bg-destructive/10"
                          onClick={() => setRevokeDialogOpen(true)}
                        >
                          <MaterialIcon name="block" size="sm" className="mr-2" />
                          Revoke Access
                        </Button>
                      )}
                    </div>
                  </div>
                </>
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
                <SaveButton
                  type="button"
                  onClick={() => form.handleSubmit(onSubmit)()}
                  label="Save Changes"
                  savingLabel="Saving..."
                  savedLabel="Saved"
                  saveDisabled={loading}
                />
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Revoke Access Confirmation */}
      <AlertDialog open={revokeDialogOpen} onOpenChange={setRevokeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke User Access</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to revoke access for <strong>{user?.email}</strong>?
              They will no longer be able to log in or access the system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevokeAccess}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Revoke Access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
