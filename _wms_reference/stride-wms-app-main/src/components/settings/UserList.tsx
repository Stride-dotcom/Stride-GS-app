import { useState, useMemo } from 'react';
import { getRoleDisplayName } from '@/lib/roles';
import { UserWithRoles, Role } from '@/hooks/useUsers';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  MobileDataCard,
  MobileDataCardHeader,
  MobileDataCardTitle,
  MobileDataCardDescription,
  MobileDataCardContent,
  MobileDataCardActions,
} from '@/components/ui/mobile-data-card';
import { PromptLevel } from '@/types/guidedPrompts';

interface UserListProps {
  users: UserWithRoles[];
  roles: Role[];
  loading: boolean;
  currentUserId?: string;
  onEdit: (userId: string) => void;
  onDelete: (userId: string) => Promise<void>;
  onRefresh: () => void;
  onInvite?: () => void;
}

export function UserList({ 
  users, 
  roles, 
  loading, 
  currentUserId,
  onEdit, 
  onDelete, 
  onRefresh,
  onInvite,
}: UserListProps) {
  const isMobile = useIsMobile();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserWithRoles | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [employeeFilter, setEmployeeFilter] = useState<string>('all');
  const { toast } = useToast();

  // Get unique role names for filter dropdown (filter out empty strings)
  const uniqueRoles = useMemo(() => {
    const roleSet = new Set<string>();
    users.forEach(user => {
      user.roles.forEach(role => {
        if (role.name && role.name.trim()) {
          roleSet.add(role.name);
        }
      });
    });
    return Array.from(roleSet).sort();
  }, [users]);

  // Filter users based on search, role, and status
  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      // Search filter
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = !searchQuery || 
        user.email.toLowerCase().includes(searchLower) ||
        (user.first_name?.toLowerCase() || '').includes(searchLower) ||
        (user.last_name?.toLowerCase() || '').includes(searchLower) ||
        (user.username?.toLowerCase() || '').includes(searchLower);

      // Role filter
      const matchesRole = roleFilter === 'all' || 
        user.roles.some(role => role.name === roleFilter) ||
        (roleFilter === 'no-role' && user.roles.length === 0);

      // Status filter
      const matchesStatus = statusFilter === 'all' || user.status === statusFilter;

      // Employee filter (users with labor_rate are employees)
      let matchesEmployee = true;
      if (employeeFilter === 'employees') {
        matchesEmployee = user.labor_rate !== null && user.labor_rate > 0;
      } else if (employeeFilter === 'non-employees') {
        matchesEmployee = user.labor_rate === null || user.labor_rate === 0;
      }

      return matchesSearch && matchesRole && matchesStatus && matchesEmployee;
    });
  }, [users, searchQuery, roleFilter, statusFilter, employeeFilter]);

  const handleDeleteClick = (user: UserWithRoles) => {
    setUserToDelete(user);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!userToDelete) return;

    try {
      setDeleting(true);
      await onDelete(userToDelete.id);
      toast({
        title: 'User deleted',
        description: `${userToDelete.email} has been removed.`,
      });
      onRefresh();
    } catch (error) {
      console.error('Error deleting user:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to delete user',
      });
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
      setUserToDelete(null);
    }
  };

  const getStatusBadge = (status: string) => (
    <StatusIndicator status={status} size="sm" />
  );

  const getPromptLevelBadge = (level?: PromptLevel) => {
    switch (level) {
      case 'training':
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="border-blue-500 text-blue-600">
                  <MaterialIcon name="school" size="sm" className="mr-1" />
                  Training
                </Badge>
              </TooltipTrigger>
              <TooltipContent>All prompts shown</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      case 'standard':
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="border-amber-500 text-amber-600">
                  <MaterialIcon name="verified_user" size="sm" className="mr-1" />
                  Standard
                </Badge>
              </TooltipTrigger>
              <TooltipContent>Warning & blocking prompts only</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      case 'advanced':
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="border-green-500 text-green-600">
                  <MaterialIcon name="workspace_premium" size="sm" className="mr-1" />
                  Advanced
                </Badge>
              </TooltipTrigger>
              <TooltipContent>Blocking prompts only</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      default:
        return null;
    }
  };

  const formatName = (user: UserWithRoles) => {
    if (user.first_name || user.last_name) {
      return `${user.first_name || ''} ${user.last_name || ''}`.trim();
    }
    return '-';
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-48">
          <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (users.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center h-48 text-center">
          <MaterialIcon name="group" size="lg" className="text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No users yet</h3>
          <p className="text-muted-foreground text-sm mt-1">
            Users will appear here when they register.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Users</CardTitle>
              <CardDescription>
                {filteredUsers.length} of {users.length} user{users.length !== 1 ? 's' : ''} in your organization
              </CardDescription>
            </div>
            {onInvite && (
              <Button onClick={onInvite}>
                <MaterialIcon name="person_add" size="sm" className="mr-2" />
                Add User
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Filter by role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="no-role">No Role</SelectItem>
                {uniqueRoles.map(role => (
                  <SelectItem key={role} value={role}>
                    {getRoleDisplayName(role)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
              </SelectContent>
            </Select>
            <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                <SelectItem value="employees">Employees Only</SelectItem>
                <SelectItem value="non-employees">Non-Employees</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filteredUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <MaterialIcon name="group" size="lg" className="text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No users match your filters</h3>
              <p className="text-muted-foreground text-sm mt-1">
                Try adjusting your search or filter criteria
              </p>
            </div>
          ) : isMobile ? (
            <div className="space-y-3">
              {filteredUsers.map((user) => (
                <MobileDataCard key={user.id} onClick={() => onEdit(user.id)}>
                  <MobileDataCardHeader>
                    <div>
                      <MobileDataCardTitle className="flex items-center gap-2">
                        {formatName(user)}
                        {user.id === currentUserId && (
                          <Badge variant="outline">You</Badge>
                        )}
                      </MobileDataCardTitle>
                      <MobileDataCardDescription>
                        {user.email}
                        {user.username ? ` · @${user.username}` : ''}
                      </MobileDataCardDescription>
                    </div>
                    {getStatusBadge(user.status)}
                  </MobileDataCardHeader>
                  <MobileDataCardContent>
                    <div className="flex items-center gap-1 flex-wrap">
                      {user.roles.length > 0 ? (
                        user.roles.map((role) => (
                          <Badge key={role.id} variant="outline" className="text-xs">
                            <MaterialIcon name="shield" size="sm" className="mr-1" />
                            {getRoleDisplayName(role.name)}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-muted-foreground text-sm">No roles</span>
                      )}
                      {user.prompt_level && getPromptLevelBadge(user.prompt_level)}
                    </div>
                  </MobileDataCardContent>
                  <MobileDataCardActions>
                    <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => onEdit(user.id)}>
                      <MaterialIcon name="edit" size="sm" />
                    </Button>
                    {user.id !== currentUserId && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 text-destructive"
                        onClick={() => handleDeleteClick(user)}
                      >
                        <MaterialIcon name="delete" size="sm" />
                      </Button>
                    )}
                  </MobileDataCardActions>
                </MobileDataCard>
              ))}
            </div>
          ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Prompt Level</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[70px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.map((user) => (
                <TableRow 
                  key={user.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => onEdit(user.id)}
                >
                  <TableCell className="font-medium">
                    <div className="space-y-0.5">
                      <div>
                        {formatName(user)}
                        {user.id === currentUserId && (
                          <Badge variant="outline" className="ml-2">You</Badge>
                        )}
                      </div>
                      {user.username && (
                        <div className="text-xs text-muted-foreground">@{user.username}</div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 flex-wrap">
                      {user.roles.length > 0 ? (
                        user.roles.map((role) => (
                          <Badge key={role.id} variant="outline" className="text-xs">
                            <MaterialIcon name="shield" size="sm" className="mr-1" />
                            {getRoleDisplayName(role.name)}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-muted-foreground text-sm">No roles</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{getPromptLevelBadge(user.prompt_level)}</TableCell>
                  <TableCell>{getStatusBadge(user.status)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MaterialIcon name="more_horiz" size="sm" />
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit(user.id)}>
                          <MaterialIcon name="edit" size="sm" className="mr-2" />
                          Edit
                        </DropdownMenuItem>
                        {user.id !== currentUserId && (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => handleDeleteClick(user)}
                          >
                            <MaterialIcon name="delete" size="sm" className="mr-2" />
                            Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{userToDelete?.email}</strong>?
              This will remove their access to the system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
