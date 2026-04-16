import { useState } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useAccountInvitations,
  useAccountPortalUsers,
  useCreateInvitation,
  useResendInvitation,
  useCancelInvitation,
  useDeactivatePortalUser,
  ClientInvitation,
  ClientPortalUser,
} from '@/hooks/useClientInvitations';
import { formatDistanceToNow, format } from 'date-fns';

interface ClientPortalSectionProps {
  accountId: string;
  accountName: string;
}

export function ClientPortalSection({ accountId, accountName }: ClientPortalSectionProps) {
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFirstName, setInviteFirstName] = useState('');
  const [inviteLastName, setInviteLastName] = useState('');
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<string | null>(null);

  const { data: invitations = [], isLoading: loadingInvitations } = useAccountInvitations(accountId);
  const { data: portalUsers = [], isLoading: loadingUsers } = useAccountPortalUsers(accountId);

  const createInvitation = useCreateInvitation();
  const resendInvitation = useResendInvitation();
  const cancelInvitation = useCancelInvitation();
  const deactivateUser = useDeactivatePortalUser();

  const pendingInvitations = invitations.filter(
    (inv) => inv.status === 'pending' || inv.status === 'sent'
  );

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;

    await createInvitation.mutateAsync({
      accountId,
      email: inviteEmail.trim(),
      firstName: inviteFirstName.trim() || undefined,
      lastName: inviteLastName.trim() || undefined,
    });

    setShowInviteDialog(false);
    setInviteEmail('');
    setInviteFirstName('');
    setInviteLastName('');
  };

  const getStatusBadge = (invitation: ClientInvitation) => {
    const isExpired = new Date(invitation.expires_at) < new Date();
    if (isExpired && invitation.status !== 'accepted' && invitation.status !== 'cancelled') {
      return <StatusIndicator status="expired" size="sm" />;
    }
    return <StatusIndicator status={invitation.status} size="sm" />;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="group" size="md" />
              Client Portal Access
            </CardTitle>
            <CardDescription>
              Manage client users who can access the portal for {accountName}
            </CardDescription>
          </div>
          <Button type="button" onClick={() => setShowInviteDialog(true)}>
            <MaterialIcon name="person_add" size="sm" className="mr-2" />
            Invite Client
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="users">
          <TabsList>
            <TabsTrigger value="users" className="gap-2">
              <MaterialIcon name="group" size="sm" />
              Active Users ({portalUsers.length})
            </TabsTrigger>
            <TabsTrigger value="invitations" className="gap-2">
              <MaterialIcon name="mail" size="sm" />
              Invitations ({pendingInvitations.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="mt-4">
            {loadingUsers ? (
              <div className="py-8 text-center text-muted-foreground">Loading...</div>
            ) : portalUsers.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <MaterialIcon name="group" className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No active portal users</p>
                <p className="text-sm mt-1">Invite clients to give them access to the portal</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {portalUsers.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">
                        {user.first_name || user.last_name
                          ? `${user.first_name || ''} ${user.last_name || ''}`.trim()
                          : '—'}
                        {user.is_primary && (
                          <Badge variant="outline" className="ml-2">
                            Primary
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        {user.last_login_at
                          ? formatDistanceToNow(new Date(user.last_login_at), { addSuffix: true })
                          : 'Never'}
                      </TableCell>
                      <TableCell>
                        {format(new Date(user.created_at), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmDeactivate(user.id)}
                        >
                          <MaterialIcon name="delete" size="sm" className="text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          <TabsContent value="invitations" className="mt-4">
            {loadingInvitations ? (
              <div className="py-8 text-center text-muted-foreground">Loading...</div>
            ) : invitations.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <MaterialIcon name="mail" className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No invitations sent</p>
                <p className="text-sm mt-1">Click "Invite Client" to send an invitation</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Sent</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="w-[120px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations.map((invitation) => {
                    const isExpired = new Date(invitation.expires_at) < new Date();
                    const canResend =
                      (invitation.status === 'sent' || invitation.status === 'pending' || isExpired) &&
                      invitation.status !== 'accepted' &&
                      invitation.status !== 'cancelled';
                    const canCancel =
                      invitation.status !== 'accepted' && invitation.status !== 'cancelled';

                    return (
                      <TableRow key={invitation.id}>
                        <TableCell>{invitation.email}</TableCell>
                        <TableCell>
                          {invitation.first_name || invitation.last_name
                            ? `${invitation.first_name || ''} ${invitation.last_name || ''}`.trim()
                            : '—'}
                        </TableCell>
                        <TableCell>{getStatusBadge(invitation)}</TableCell>
                        <TableCell>
                          {invitation.sent_at
                            ? formatDistanceToNow(new Date(invitation.sent_at), { addSuffix: true })
                            : '—'}
                        </TableCell>
                        <TableCell>
                          {invitation.status !== 'accepted' && invitation.status !== 'cancelled' && (
                            <span className={isExpired ? 'text-destructive' : ''}>
                              {isExpired
                                ? 'Expired'
                                : formatDistanceToNow(new Date(invitation.expires_at), {
                                    addSuffix: true,
                                  })}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {canResend && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => resendInvitation.mutate(invitation.id)}
                                disabled={resendInvitation.isPending}
                              >
                                <MaterialIcon name="refresh" size="sm" />
                              </Button>
                            )}
                            {canCancel && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setConfirmCancel(invitation.id)}
                              >
                                <MaterialIcon name="cancel" size="sm" className="text-destructive" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        </Tabs>

        {/* Invite Dialog */}
        <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite Client to Portal</DialogTitle>
              <DialogDescription>
                Send an invitation email to give this person access to the client portal for{' '}
                {accountName}.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email Address *</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="client@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    placeholder="John"
                    value={inviteFirstName}
                    onChange={(e) => setInviteFirstName(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    placeholder="Doe"
                    value={inviteLastName}
                    onChange={(e) => setInviteLastName(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowInviteDialog(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleInvite}
                disabled={!inviteEmail.trim() || createInvitation.isPending}
              >
                {createInvitation.isPending ? 'Sending...' : 'Send Invitation'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Cancel Invitation Confirmation */}
        <AlertDialog open={!!confirmCancel} onOpenChange={() => setConfirmCancel(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel Invitation?</AlertDialogTitle>
              <AlertDialogDescription>
                This will cancel the invitation. The recipient will no longer be able to use it to
                create an account.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep Invitation</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (confirmCancel) {
                    cancelInvitation.mutate(confirmCancel);
                    setConfirmCancel(null);
                  }
                }}
              >
                Cancel Invitation
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Deactivate User Confirmation */}
        <AlertDialog open={!!confirmDeactivate} onOpenChange={() => setConfirmDeactivate(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke Portal Access?</AlertDialogTitle>
              <AlertDialogDescription>
                This will revoke this user's access to the client portal. They will no longer be able
                to log in or view any information.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep Access</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  if (confirmDeactivate) {
                    deactivateUser.mutate(confirmDeactivate);
                    setConfirmDeactivate(null);
                  }
                }}
              >
                Revoke Access
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
