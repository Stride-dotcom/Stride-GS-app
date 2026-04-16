import { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { CoverageSelector, CoverageType } from '@/components/coverage/CoverageSelector';
import { Skeleton } from '@/components/ui/skeleton';

interface ItemForCoverage {
  id: string;
  item_code: string;
  description: string | null;
  coverage_type: string | null;
  declared_value: number | null;
  weight_lbs: number | null;
  account: { id: string; account_name: string } | null;
  sidemark: { id: string; sidemark_name: string } | null;
}

export default function CoverageQuickEntry() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<ItemForCoverage[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<'all' | 'pending' | 'uncovered'>('pending');
  const [search, setSearch] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [accounts, setAccounts] = useState<{ id: string; account_name: string }[]>([]);

  useEffect(() => {
    if (profile?.tenant_id) {
      fetchAccounts();
      fetchItems();
    }
  }, [profile?.tenant_id, filterType, selectedAccountId]);

  const fetchAccounts = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase
      .from('accounts')
      .select('id, account_name')
      .eq('tenant_id', profile.tenant_id)
      .eq('is_active', true)
      .order('account_name');
    setAccounts(data || []);
  };

  const fetchItems = async () => {
    if (!profile?.tenant_id) return;
    setLoading(true);

    let query = supabase
      .from('items')
      .select(`
        id, item_code, description, coverage_type, declared_value, weight_lbs,
        account:accounts!items_account_id_fkey(id, account_name),
        sidemark:sidemarks!items_sidemark_id_fkey(id, sidemark_name)
      `)
      .eq('tenant_id', profile.tenant_id)
      .is('deleted_at', null)
      .in('status', ['in_storage', 'received'])
      .order('created_at', { ascending: false })
      .limit(100);

    if (filterType === 'pending') {
      query = query.eq('coverage_type', 'pending');
    } else if (filterType === 'uncovered') {
      query = query.or('coverage_type.is.null,coverage_type.eq.pending');
    }

    if (selectedAccountId) {
      query = query.eq('account_id', selectedAccountId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching items:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load items' });
    }

    setItems((data || []) as unknown as ItemForCoverage[]);
    setLoading(false);
  };

  const handleCoverageUpdate = (
    itemId: string,
    coverageType: CoverageType,
    declaredValue: number | null
  ) => {
    // Update local state to reflect the change immediately
    setItems(prev =>
      prev.map(item =>
        item.id === itemId
          ? { ...item, coverage_type: coverageType, declared_value: declaredValue }
          : item
      )
    );
  };

  const filteredItems = items.filter(item => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      item.item_code.toLowerCase().includes(searchLower) ||
      item.description?.toLowerCase().includes(searchLower) ||
      item.account?.account_name.toLowerCase().includes(searchLower)
    );
  });

  const pendingCount = items.filter(i => i.coverage_type === 'pending' || !i.coverage_type).length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Coverage Quick Entry</h1>
            <p className="text-muted-foreground">Assign coverage types and declared values to items</p>
          </div>
          {pendingCount > 0 && (
            <Badge variant="secondary" className="text-lg px-4 py-1">
              {pendingCount} Pending
            </Badge>
          )}
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search items..."
                  className="pl-10"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <Select value={filterType} onValueChange={(v) => setFilterType(v as 'all' | 'pending' | 'uncovered')}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending Only</SelectItem>
                  <SelectItem value="uncovered">Uncovered</SelectItem>
                  <SelectItem value="all">All Items</SelectItem>
                </SelectContent>
              </Select>
              <Select value={selectedAccountId || '__all__'} onValueChange={(v) => setSelectedAccountId(v === '__all__' ? '' : v)}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="All Accounts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Accounts</SelectItem>
                  {accounts.map(acc => (
                    <SelectItem key={acc.id} value={acc.id}>{acc.account_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={fetchItems}>
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Items Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="shield" size="md" />
              Items Requiring Coverage
            </CardTitle>
            <CardDescription>
              Select coverage type and enter declared value for each item
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <MaterialIcon name="inventory_2" size="xl" className="mx-auto mb-4 opacity-50" />
                <p>No items requiring coverage assignment</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item Code</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Current Coverage</TableHead>
                      <TableHead>Declared Value</TableHead>
                      <TableHead className="w-[280px]">Update Coverage</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map(item => (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono text-sm">{item.item_code}</TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {item.description || '-'}
                        </TableCell>
                        <TableCell>{item.account?.account_name || '-'}</TableCell>
                        <TableCell>
                          <Badge variant={item.coverage_type === 'pending' || !item.coverage_type ? 'destructive' : 'secondary'}>
                            {item.coverage_type || 'None'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {item.declared_value != null ? `$${item.declared_value.toFixed(2)}` : '-'}
                        </TableCell>
                        <TableCell>
                          <CoverageSelector
                            itemId={item.id}
                            currentCoverage={item.coverage_type as CoverageType | null}
                            currentDeclaredValue={item.declared_value}
                            currentWeight={item.weight_lbs}
                            onUpdate={(type, value) => handleCoverageUpdate(item.id, type, value)}
                            compact
                          />
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
    </DashboardLayout>
  );
}
