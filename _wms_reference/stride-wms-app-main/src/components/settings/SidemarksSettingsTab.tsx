import { useState, useEffect } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useSidemarks, Sidemark } from '@/hooks/useSidemarks';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface Account {
  id: string;
  account_name: string;
  account_code: string;
}

export function SidemarksSettingsTab() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingSidemark, setEditingSidemark] = useState<Sidemark | null>(null);
  const [deletingSidemarkId, setDeletingSidemarkId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    sidemark_name: '',
    sidemark_code: '',
    account_id: '',
    description: '',
  });

  const { toast } = useToast();
  const { profile } = useAuth();
  const { sidemarks, loading, createSidemark, updateSidemark, deleteSidemark, refetch } = useSidemarks(
    selectedAccountId === 'all' ? undefined : selectedAccountId
  );

  // Fetch accounts
  useEffect(() => {
    const fetchAccounts = async () => {
      if (!profile?.tenant_id) return;

      const { data, error } = await supabase
        .from('accounts')
        .select('id, account_name, account_code')
        .eq('tenant_id', profile.tenant_id)
        .is('deleted_at', null)
        .eq('status', 'active')
        .order('account_name');

      if (error) {
        console.error('Error fetching accounts:', error);
        return;
      }

      setAccounts(data || []);
    };

    fetchAccounts();
  }, [profile?.tenant_id]);

  const filteredSidemarks = sidemarks.filter(sm => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      sm.sidemark_name.toLowerCase().includes(query) ||
      sm.sidemark_code?.toLowerCase().includes(query) ||
      sm.account?.account_name?.toLowerCase().includes(query)
    );
  });

  const handleOpenCreate = () => {
    setEditingSidemark(null);
    setFormData({
      sidemark_name: '',
      sidemark_code: '',
      account_id: selectedAccountId === 'all' ? '' : selectedAccountId,
      description: '',
    });
    setDialogOpen(true);
  };

  const handleOpenEdit = (sidemark: Sidemark) => {
    setEditingSidemark(sidemark);
    setFormData({
      sidemark_name: sidemark.sidemark_name,
      sidemark_code: sidemark.sidemark_code || '',
      account_id: sidemark.account_id,
      description: sidemark.notes || '',
    });
    setDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    setDeletingSidemarkId(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!deletingSidemarkId) return;
    
    try {
      await deleteSidemark(deletingSidemarkId);
      toast({
        title: 'Sidemark Deleted',
        description: 'The sidemark has been removed.',
      });
    } catch (error) {
      console.error('Error deleting sidemark:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to delete sidemark.',
      });
    } finally {
      setDeleteDialogOpen(false);
      setDeletingSidemarkId(null);
    }
  };

  const handleSubmit = async () => {
    if (!formData.sidemark_name || !formData.account_id) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Name and account are required.',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingSidemark) {
        await updateSidemark(editingSidemark.id, {
          sidemark_name: formData.sidemark_name,
          sidemark_code: formData.sidemark_code || null,
          notes: formData.description || null,
        });
        toast({
          title: 'Sidemark Updated',
          description: 'Changes have been saved.',
        });
      } else {
        await createSidemark({
          sidemark_name: formData.sidemark_name,
          sidemark_code: formData.sidemark_code || null,
          account_id: formData.account_id,
          notes: formData.description || null,
        });
        toast({
          title: 'Sidemark Created',
          description: 'New sidemark has been added.',
        });
      }
      setDialogOpen(false);
    } catch (error) {
      console.error('Error saving sidemark:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to save sidemark.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="label" size="md" />
              Sidemarks
            </CardTitle>
            <CardDescription>
              Manage project/billing separators for accounts. Sidemarks allow you to group items and track billing separately within the same account.
            </CardDescription>
          </div>
          <Button onClick={handleOpenCreate}>
            <MaterialIcon name="add" size="sm" className="mr-2" />
            Add Sidemark
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search sidemarks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
            <SelectTrigger className="w-[250px]">
              <SelectValue placeholder="Filter by account" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Accounts</SelectItem>
              {accounts.map((acc) => (
                <SelectItem key={acc.id} value={acc.id}>
                  {acc.account_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
          </div>
        ) : filteredSidemarks.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <MaterialIcon name="label" size="lg" className="mx-auto mb-4 opacity-50" />
            <p>No sidemarks found</p>
            <Button variant="link" onClick={handleOpenCreate}>
              Create your first sidemark
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSidemarks.map((sm) => (
                <TableRow key={sm.id}>
                  <TableCell className="font-medium">{sm.sidemark_name}</TableCell>
                  <TableCell>
                    {sm.sidemark_code && (
                      <Badge variant="outline">{sm.sidemark_code}</Badge>
                    )}
                  </TableCell>
                  <TableCell>{sm.account?.account_name || '-'}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground">
                    {sm.notes || '-'}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenEdit(sm)}
                      >
                        <MaterialIcon name="edit" size="sm" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(sm.id)}
                      >
                        <MaterialIcon name="delete" size="sm" className="text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingSidemark ? 'Edit Sidemark' : 'Create Sidemark'}
            </DialogTitle>
            <DialogDescription>
              {editingSidemark 
                ? 'Update the sidemark details below.'
                : 'Create a new sidemark for project/billing separation.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Account *</Label>
              <Select 
                value={formData.account_id} 
                onValueChange={(v) => setFormData(d => ({ ...d, account_id: v }))}
                disabled={!!editingSidemark}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Sidemark Name *</Label>
              <Input
                value={formData.sidemark_name}
                onChange={(e) => setFormData(d => ({ ...d, sidemark_name: e.target.value }))}
                placeholder="e.g., Project Alpha, Living Room Set"
              />
            </div>
            <div className="space-y-2">
              <Label>Code (optional)</Label>
              <Input
                value={formData.sidemark_code}
                onChange={(e) => setFormData(d => ({ ...d, sidemark_code: e.target.value }))}
                placeholder="e.g., PA-001"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData(d => ({ ...d, description: e.target.value }))}
                placeholder="Optional notes about this sidemark..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit} 
              disabled={isSubmitting || !formData.sidemark_name || !formData.account_id}
            >
              {isSubmitting && <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-2" />}
              {editingSidemark ? 'Save Changes' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Sidemark?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the sidemark. Items assigned to this sidemark will need to be reassigned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
