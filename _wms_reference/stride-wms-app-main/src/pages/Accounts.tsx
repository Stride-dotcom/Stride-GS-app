import { useEffect, useState, useRef } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { AccountDialog } from '@/components/accounts/AccountDialog';
import { AccountImportDialog } from '@/components/accounts/AccountImportDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  MobileDataCard,
  MobileDataCardHeader,
  MobileDataCardTitle,
  MobileDataCardDescription,
  MobileDataCardContent,
} from '@/components/ui/mobile-data-card';

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string | null;
  status: string;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  billing_city: string | null;
  billing_state: string | null;
  credit_hold: boolean | null;
  parent_account_id: string | null;
  is_master_account: boolean | null;
}

export default function Accounts() {
  const isMobile = useIsMobile();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportFile(file);
      setImportDialogOpen(true);
    }
    e.target.value = '';
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    try {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, account_code, account_name, account_type, status, primary_contact_name, primary_contact_email, billing_city, billing_state, credit_hold, parent_account_id, is_master_account')
        .is('deleted_at', null)
        .order('account_name', { ascending: true })
        .limit(200);

      if (error) throw error;
      setAccounts(data || []);
    } catch (error) {
      console.error('Error fetching accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredAccounts = accounts.filter((account) => {
    const matchesSearch =
      account.account_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      account.account_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      account.primary_contact_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      account.primary_contact_email?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'all' || account.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Organize accounts into a tree structure for nested display
  const organizedAccounts = (): { account: Account; level: number }[] => {
    const result: { account: Account; level: number }[] = [];
    
    // Get top-level accounts (no parent or parent not in list)
    const topLevel = filteredAccounts.filter(
      (a) => !a.parent_account_id || !filteredAccounts.some((p) => p.id === a.parent_account_id)
    );
    
    // Recursively add children with circular reference protection
    const visited = new Set<string>();
    const addWithChildren = (account: Account, level: number) => {
      if (visited.has(account.id)) return;
      visited.add(account.id);
      result.push({ account, level });
      const children = filteredAccounts.filter((a) => a.parent_account_id === account.id);
      children.forEach((child) => addWithChildren(child, level + 1));
    };
    
    topLevel.forEach((account) => addWithChildren(account, 0));
    return result;
  };

  const nestedAccounts = organizedAccounts();

  const getStatusBadge = (status: string, creditHold: boolean | null) => {
    if (creditHold) {
      return <Badge variant="destructive">Credit Hold</Badge>;
    }
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      active: 'default',
      on_hold: 'secondary',
      archived: 'outline',
      credit_hold: 'destructive',
      inactive: 'secondary',
      suspended: 'destructive',
    };
    const labels: Record<string, string> = {
      active: 'Active',
      on_hold: 'On Hold',
      archived: 'Archived',
      credit_hold: 'Credit Hold',
      inactive: 'Inactive',
      suspended: 'Suspended',
    };
    return <Badge variant={variants[status] || 'default'}>{labels[status] || status}</Badge>;
  };

  const uniqueStatuses = [...new Set(accounts.map((account) => account.status))];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <PageHeader
            primaryText="Client"
            accentText="Directory"
            description="Manage client accounts and billing information"
          />
          <div className="grid grid-cols-2 gap-2 w-full sm:w-auto sm:flex sm:gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileChange}
              className="hidden"
            />
            <Button variant="secondary" onClick={handleImportClick} className="w-full justify-center">
              <MaterialIcon name="upload" size="sm" className="mr-2" />
              Import
            </Button>
            <Button onClick={() => { setEditingAccountId(null); setDialogOpen(true); }} className="w-full justify-center">
              <MaterialIcon name="add" size="sm" className="mr-2" />
              New Account
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Client Accounts</CardTitle>
            <CardDescription>
              {nestedAccounts.length} accounts found
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-row sm:flex-wrap sm:items-center mb-6">
              <div className="relative col-span-2 sm:flex-1 sm:min-w-[260px]">
                <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by account code, name, or contact..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="col-span-2 sm:col-span-auto">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full sm:w-48">
                  <MaterialIcon name="filter_list" size="sm" className="mr-2" />
                  <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {uniqueStatuses.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-48">
                <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
              </div>
            ) : nestedAccounts.length === 0 ? (
              <div className="text-center py-12">
                <MaterialIcon name="business" size="xl" className="mx-auto text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold">No accounts found</h3>
                <p className="text-muted-foreground">
                  {searchQuery || statusFilter !== 'all'
                    ? 'Try adjusting your search or filters'
                    : 'Get started by creating a new account'}
                </p>
              </div>
            ) : isMobile ? (
              <div className="space-y-3">
                {nestedAccounts.map(({ account, level }) => (
                  <MobileDataCard 
                    key={account.id} 
                    onClick={() => { setEditingAccountId(account.id); setDialogOpen(true); }}
                    style={{ marginLeft: `${level * 0.75}rem` }}
                  >
                    <MobileDataCardHeader>
                      <div>
                        <MobileDataCardTitle className="flex items-center gap-2">
                          {level > 0 && <span className="text-muted-foreground">└</span>}
                          {account.account_code}
                          {account.is_master_account && (
                            <Badge variant="outline" className="text-xs">Master</Badge>
                          )}
                        </MobileDataCardTitle>
                        <MobileDataCardDescription>{account.account_name}</MobileDataCardDescription>
                      </div>
                      {getStatusBadge(account.status, account.credit_hold)}
                    </MobileDataCardHeader>
                    <MobileDataCardContent>
                      <div className="grid grid-cols-2 gap-2 text-muted-foreground text-xs">
                        <div>
                          <span>Type:</span>
                          <div className="text-foreground">{account.account_type || '-'}</div>
                        </div>
                        <div>
                          <span>Location:</span>
                          <div className="text-foreground">
                            {account.billing_city || account.billing_state
                              ? `${account.billing_city || ''}${account.billing_city && account.billing_state ? ', ' : ''}${account.billing_state || ''}`
                              : '-'}
                          </div>
                        </div>
                      </div>
                      {account.primary_contact_name && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          <span>Contact:</span>
                          <div className="text-foreground">{account.primary_contact_name}</div>
                        </div>
                      )}
                    </MobileDataCardContent>
                  </MobileDataCard>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account Code</TableHead>
                      <TableHead>Account Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Primary Contact</TableHead>
                      <TableHead>Location</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {nestedAccounts.map(({ account, level }) => (
                      <TableRow 
                        key={account.id} 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => { setEditingAccountId(account.id); setDialogOpen(true); }}
                      >
                        <TableCell className="font-medium">
                          <span style={{ paddingLeft: `${level * 1.5}rem` }}>
                            {level > 0 && <span className="text-muted-foreground mr-2">└</span>}
                            {account.account_code}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span style={{ paddingLeft: `${level * 1.5}rem` }}>
                            {account.account_name}
                            {account.is_master_account && (
                              <Badge variant="outline" className="ml-2 text-xs">Master</Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>{account.account_type || '-'}</TableCell>
                        <TableCell>{getStatusBadge(account.status, account.credit_hold)}</TableCell>
                        <TableCell>
                          {account.primary_contact_name ? (
                            <div>
                              <div>{account.primary_contact_name}</div>
                              {account.primary_contact_email && (
                                <div className="text-sm text-muted-foreground">
                                  {account.primary_contact_email}
                                </div>
                              )}
                            </div>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell>
                          {account.billing_city || account.billing_state
                            ? `${account.billing_city || ''}${account.billing_city && account.billing_state ? ', ' : ''}${account.billing_state || ''}`
                            : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AccountDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        accountId={editingAccountId}
        onSuccess={() => {
          setDialogOpen(false);
          setEditingAccountId(null);
          fetchAccounts();
        }}
      />

      <AccountImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        file={importFile}
        onSuccess={() => {
          setImportDialogOpen(false);
          setImportFile(null);
          fetchAccounts();
        }}
      />
    </DashboardLayout>
  );
}
