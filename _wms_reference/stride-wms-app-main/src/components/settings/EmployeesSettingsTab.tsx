import { useState, useEffect } from 'react';
import { getRoleDisplayName } from '@/lib/roles';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface Employee {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  labor_rate: number | null;
  roles: { id: string; name: string }[];
}

interface Role {
  id: string;
  name: string;
  description: string | null;
}

export function EmployeesSettingsTab() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    labor_rate: 0,
    role_id: 'none',
  });

  const [inviteData, setInviteData] = useState({
    email: '',
    first_name: '',
    last_name: '',
    role_id: 'none',
    labor_rate: 0,
  });

  useEffect(() => {
    if (profile?.tenant_id) {
      fetchEmployees();
      fetchRoles();
    }
  }, [profile?.tenant_id]);

  const fetchEmployees = async () => {
    if (!profile?.tenant_id) return;

    try {
      setLoading(true);
      const { data: users, error } = await supabase
        .from('users')
        .select(`
          id, email, first_name, last_name, labor_rate,
          user_roles!user_roles_user_id_fkey(
            role:roles(id, name)
          )
        `)
        .eq('tenant_id', profile.tenant_id)
        .is('deleted_at', null);

      if (error) throw error;

      // Transform the data
      const employeesData = (users || []).map((user: any) => ({
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        labor_rate: user.labor_rate,
        roles: user.user_roles
          ?.map((ur: any) => ur.role)
          .filter(Boolean) || [],
      }));

      setEmployees(employeesData);
    } catch (error) {
      console.error('Error fetching employees:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchRoles = async () => {
    if (!profile?.tenant_id) return;

    try {
      const { data, error } = await supabase
        .from('roles')
        .select('id, name, description')
        .eq('tenant_id', profile.tenant_id)
        .is('deleted_at', null)
        .in('name', ['admin', 'manager', 'warehouse']);

      if (error) throw error;
      setRoles(data || []);
    } catch (error) {
      console.error('Error fetching roles:', error);
    }
  };

  const handleEditEmployee = (employee: Employee) => {
    setSelectedEmployee(employee);
    setFormData({
      labor_rate: employee.labor_rate || 0,
      role_id: employee.roles[0]?.id || 'none',
    });
    setDialogOpen(true);
  };

  const handleSaveEmployee = async () => {
    if (!selectedEmployee) return;

    setSaving(true);
    try {
      // Update labor rate
      const { error: userError } = await supabase
        .from('users')
        .update({ labor_rate: formData.labor_rate })
        .eq('id', selectedEmployee.id);

      if (userError) throw userError;

      // Update role if changed
      if (formData.role_id !== 'none') {
        const currentRoleId = selectedEmployee.roles[0]?.id;
        
        if (currentRoleId !== formData.role_id) {
          // Remove old role
          if (currentRoleId) {
            await supabase
              .from('user_roles')
              .delete()
              .eq('user_id', selectedEmployee.id)
              .eq('role_id', currentRoleId);
          }

          // Add new role
          await supabase
            .from('user_roles')
            .insert({
              user_id: selectedEmployee.id,
              role_id: formData.role_id,
            });
        }
      }

      toast({
        title: 'Employee Updated',
        description: 'Employee details have been saved.',
      });

      setDialogOpen(false);
      fetchEmployees();
    } catch (error) {
      console.error('Error saving employee:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to save employee details.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCreateEmployee = async (sendInvite: boolean) => {
    if (!profile?.tenant_id || !inviteData.email) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Email is required.',
      });
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(inviteData.email)) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Please enter a valid email address.',
      });
      return;
    }

    setSaving(true);
    try {
      // Check if user with this email already exists
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('email', inviteData.email.toLowerCase())
        .eq('tenant_id', profile.tenant_id)
        .is('deleted_at', null)
        .maybeSingle();

      if (existingUser) {
        toast({
          variant: 'destructive',
          title: 'User Exists',
          description: 'An employee with this email already exists.',
        });
        setSaving(false);
        return;
      }

      // Generate invite token
      const inviteToken = crypto.randomUUID();

      // Create user record in users table
      const { data: newUser, error: userError } = await supabase
        .from('users')
        .insert({
          email: inviteData.email.toLowerCase(),
          first_name: inviteData.first_name || null,
          last_name: inviteData.last_name || null,
          labor_rate: inviteData.labor_rate || null,
          tenant_id: profile.tenant_id,
          status: 'pending',
          password_hash: 'pending',
          invite_token: inviteToken,
        })
        .select('id')
        .single();

      if (userError) {
        console.error('Error creating user:', userError);
        throw new Error('Failed to create employee record');
      }

      // Assign role if selected
      if (inviteData.role_id && inviteData.role_id !== 'none') {
        const { error: roleError } = await supabase
          .from('user_roles')
          .insert({
            user_id: newUser.id,
            role_id: inviteData.role_id,
          });

        if (roleError) {
          console.error('Error assigning role:', roleError);
          // Don't fail the whole operation, just log it
        }
      }

      // Send invite email if requested
      if (sendInvite) {
        const { error: inviteError } = await supabase.functions.invoke('send-employee-invite', {
          body: {
            user_id: newUser.id,
            tenant_id: profile.tenant_id,
          },
        });

        if (inviteError) {
          console.error('Error sending invite:', inviteError);
          toast({
            title: 'Employee Created',
            description: `Employee saved but invitation email failed to send. You can resend later.`,
          });
        } else {
          toast({
            title: 'Invitation Sent',
            description: `An invitation has been sent to ${inviteData.email}.`,
          });
        }
      } else {
        toast({
          title: 'Employee Created',
          description: `${inviteData.first_name || inviteData.email} has been added as an employee.`,
        });
      }

      setInviteDialogOpen(false);
      setInviteData({
        email: '',
        first_name: '',
        last_name: '',
        role_id: 'none',
        labor_rate: 0,
      });
      fetchEmployees();
    } catch (error) {
      console.error('Error creating employee:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create employee.',
      });
    } finally {
      setSaving(false);
    }
  };

  const getRoleBadgeColor = (roleName: string) => {
    switch (roleName.toLowerCase()) {
      case 'admin':
        return 'bg-red-100 text-red-800';
      case 'manager':
        return 'bg-blue-100 text-blue-800';
      case 'warehouse':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="group" size="md" />
              Employees
            </CardTitle>
            <CardDescription>
              Manage employee roles and labor rates
            </CardDescription>
          </div>
          <Button onClick={() => setInviteDialogOpen(true)}>
            <MaterialIcon name="person_add" size="sm" className="mr-2" />
            Invite Employee
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
          </div>
        ) : employees.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            No employees found. Invite employees to get started.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Labor Rate</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((employee) => (
                <TableRow key={employee.id}>
                  <TableCell className="font-medium">
                    {employee.first_name || employee.last_name
                      ? `${employee.first_name || ''} ${employee.last_name || ''}`.trim()
                      : '-'}
                  </TableCell>
                  <TableCell>{employee.email}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {employee.roles.map((role) => (
                        <Badge
                          key={role.id}
                          className={getRoleBadgeColor(role.name)}
                        >
                          {getRoleDisplayName(role.name)}
                        </Badge>
                      ))}
                      {employee.roles.length === 0 && (
                        <span className="text-muted-foreground">No role</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {employee.labor_rate != null ? (
                      <span className="flex items-center gap-1">
                        <MaterialIcon name="attach_money" size="sm" />
                        {employee.labor_rate.toFixed(2)}/hr
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Not set</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEditEmployee(employee)}
                    >
                      <MaterialIcon name="edit" size="sm" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Edit Employee Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Employee</DialogTitle>
            <DialogDescription>
              Update role and labor rate for{' '}
              {selectedEmployee?.first_name || selectedEmployee?.email}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={formData.role_id}
                onValueChange={(value) =>
                  setFormData((prev) => ({ ...prev, role_id: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Role</SelectItem>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {getRoleDisplayName(role.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="labor_rate">Labor Rate ($/hour)</Label>
              <Input
                id="labor_rate"
                type="number"
                min="0"
                step="0.01"
                value={formData.labor_rate}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    labor_rate: parseFloat(e.target.value) || 0,
                  }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEmployee} disabled={saving}>
              {saving ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite Employee Dialog */}
      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Employee</DialogTitle>
            <DialogDescription>
              Send an invitation email to a new employee
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="invite_email">Email *</Label>
              <Input
                id="invite_email"
                type="email"
                value={inviteData.email}
                onChange={(e) =>
                  setInviteData((prev) => ({ ...prev, email: e.target.value }))
                }
                placeholder="employee@company.com"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="invite_first_name">First Name</Label>
                <Input
                  id="invite_first_name"
                  value={inviteData.first_name}
                  onChange={(e) =>
                    setInviteData((prev) => ({ ...prev, first_name: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite_last_name">Last Name</Label>
                <Input
                  id="invite_last_name"
                  value={inviteData.last_name}
                  onChange={(e) =>
                    setInviteData((prev) => ({ ...prev, last_name: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={inviteData.role_id}
                onValueChange={(value) =>
                  setInviteData((prev) => ({ ...prev, role_id: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Role</SelectItem>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {getRoleDisplayName(role.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite_labor_rate">Labor Rate ($/hour)</Label>
              <Input
                id="invite_labor_rate"
                type="number"
                min="0"
                step="0.01"
                value={inviteData.labor_rate}
                onChange={(e) =>
                  setInviteData((prev) => ({
                    ...prev,
                    labor_rate: parseFloat(e.target.value) || 0,
                  }))
                }
              />
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleCreateEmployee(false)}
              disabled={saving || !inviteData.email}
            >
              {saving ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Only'
              )}
            </Button>
            <Button
              onClick={() => handleCreateEmployee(true)}
              disabled={saving || !inviteData.email}
            >
              {saving ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                'Save & Send Invitation'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
