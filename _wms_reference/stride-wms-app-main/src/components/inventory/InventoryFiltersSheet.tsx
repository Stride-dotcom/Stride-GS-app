import { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const ALL_VALUE = '__all__';

export interface InventoryFilters {
  vendor: string;
  accountId: string;
  sidemark: string;
  locationId: string;
  warehouseId: string;
  coverageType?: string;
}

interface InventoryFiltersSheetProps {
  filters: InventoryFilters;
  onFiltersChange: (filters: InventoryFilters) => void;
}

export function InventoryFiltersSheet({
  filters,
  onFiltersChange,
}: InventoryFiltersSheetProps) {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [localFilters, setLocalFilters] = useState(filters);
  
  // Options state
  const [vendors, setVendors] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; account_name: string }[]>([]);
  const [sidemarks, setSidemarks] = useState<string[]>([]);
  const [locations, setLocations] = useState<{ id: string; code: string; name: string | null }[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (open && profile?.tenant_id) {
      fetchFilterOptions();
    }
  }, [open, profile?.tenant_id]);

  useEffect(() => {
    setLocalFilters(filters);
  }, [filters]);

  const fetchFilterOptions = async () => {
    if (!profile?.tenant_id) return;

    // Fetch unique vendors from items
    const { data: vendorData } = await (supabase.from('items') as any)
      .select('vendor')
      .eq('tenant_id', profile.tenant_id)
      .is('deleted_at', null)
      .not('vendor', 'is', null);
    
    const uniqueVendors = [...new Set((vendorData || []).map((v: any) => v.vendor).filter(Boolean))] as string[];
    setVendors(uniqueVendors.sort());

    // Fetch unique sidemarks from items
    const { data: sidemarkData } = await (supabase.from('items') as any)
      .select('sidemark')
      .eq('tenant_id', profile.tenant_id)
      .is('deleted_at', null)
      .not('sidemark', 'is', null);
    
    const uniqueSidemarks = [...new Set((sidemarkData || []).map((s: any) => s.sidemark).filter(Boolean))] as string[];
    setSidemarks(uniqueSidemarks.sort());

    // Fetch accounts
    const { data: accountData } = await supabase
      .from('accounts')
      .select('id, account_name')
      .eq('tenant_id', profile.tenant_id)
      .is('deleted_at', null)
      .order('account_name');
    
    setAccounts(accountData || []);

    // Fetch locations
    const { data: locationData } = await (supabase
      .from('locations') as any)
      .select('id, code, name')
      .eq('tenant_id', profile.tenant_id)
      .is('deleted_at', null)
      .order('code');
    
    setLocations(locationData || []);

    // Fetch warehouses
    const { data: warehouseData } = await supabase
      .from('warehouses')
      .select('id, name')
      .eq('tenant_id', profile.tenant_id)
      .is('deleted_at', null)
      .order('name');
    
    setWarehouses(warehouseData || []);
  };

  const handleApply = () => {
    onFiltersChange(localFilters);
    setOpen(false);
  };

  const handleClear = () => {
    const clearedFilters: InventoryFilters = {
      vendor: '',
      accountId: '',
      sidemark: '',
      locationId: '',
      warehouseId: '',
      coverageType: '',
    };
    setLocalFilters(clearedFilters);
    onFiltersChange(clearedFilters);
    setOpen(false);
  };

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className="relative">
          <MaterialIcon name="filter_list" size="sm" className="mr-2" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-2">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Filter Inventory</SheetTitle>
          <SheetDescription>
            Apply filters to narrow down the inventory list
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 py-6">
          {/* Vendor Filter */}
          <div className="space-y-2">
            <Label>Vendor</Label>
            <Select
              value={localFilters.vendor || ALL_VALUE}
              onValueChange={(value) =>
                setLocalFilters({
                  ...localFilters,
                  vendor: value === ALL_VALUE ? '' : value,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All vendors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All vendors</SelectItem>
                {vendors.map((vendor) => (
                  <SelectItem key={vendor} value={vendor}>
                    {vendor}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Account Filter */}
          <div className="space-y-2">
            <Label>Account</Label>
            <Select
              value={localFilters.accountId || ALL_VALUE}
              onValueChange={(value) =>
                setLocalFilters({
                  ...localFilters,
                  accountId: value === ALL_VALUE ? '' : value,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All accounts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All accounts</SelectItem>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.account_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Sidemark Filter */}
          <div className="space-y-2">
            <Label>Sidemark</Label>
            <Select
              value={localFilters.sidemark || ALL_VALUE}
              onValueChange={(value) =>
                setLocalFilters({
                  ...localFilters,
                  sidemark: value === ALL_VALUE ? '' : value,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All sidemarks" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All sidemarks</SelectItem>
                {sidemarks.map((sidemark) => (
                  <SelectItem key={sidemark} value={sidemark}>
                    {sidemark}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Location Filter */}
          <div className="space-y-2">
            <Label>Location</Label>
            <Select
              value={localFilters.locationId || ALL_VALUE}
              onValueChange={(value) =>
                setLocalFilters({
                  ...localFilters,
                  locationId: value === ALL_VALUE ? '' : value,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All locations</SelectItem>
                {locations.map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    {location.code} {location.name && `(${location.name})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Warehouse Filter */}
          <div className="space-y-2">
            <Label>Warehouse</Label>
            <Select
              value={localFilters.warehouseId || ALL_VALUE}
              onValueChange={(value) =>
                setLocalFilters({
                  ...localFilters,
                  warehouseId: value === ALL_VALUE ? '' : value,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All warehouses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All warehouses</SelectItem>
                {warehouses.map((warehouse) => (
                  <SelectItem key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Coverage Filter */}
          <div className="space-y-2">
            <Label>Coverage</Label>
            <Select
              value={localFilters.coverageType || ALL_VALUE}
              onValueChange={(value) =>
                setLocalFilters({
                  ...localFilters,
                  coverageType: value === ALL_VALUE ? '' : value,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All coverage types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All coverage types</SelectItem>
                <SelectItem value="uncovered">Uncovered (No coverage)</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="standard">Standard Coverage</SelectItem>
                <SelectItem value="full_replacement_deductible">Full Replacement (w/ deductible)</SelectItem>
                <SelectItem value="full_replacement_no_deductible">Full Replacement (no deductible)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <SheetFooter className="flex gap-2">
          <Button variant="outline" onClick={handleClear} className="flex-1">
            <MaterialIcon name="close" size="sm" className="mr-2" />
            Clear All
          </Button>
          <Button onClick={handleApply} className="flex-1">
            Apply Filters
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
