/**
 * ItemListTable - Reusable standardized item list table
 * Used across Inventory, Shipments, Tasks for consistent column order
 * 
 * Standard Column Order:
 * 1. Checkbox (if selectable)
 * 2. Photo thumbnail (if showPhoto)
 * 3. Item Code (clickable)
 * 4. Qty
 * 5. Vendor
 * 6. Description
 * 7. Location
 * 8. Sidemark
 * 9. Room
 * 10. Actions (if provided)
 */

import { useNavigate } from 'react-router-dom';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ItemPreviewCard } from '@/components/items/ItemPreviewCard';
import { cn } from '@/lib/utils';

export interface ItemRow {
  id: string;
  item_code: string;
  quantity?: number;
  vendor?: string | null;
  description?: string | null;
  location_code?: string | null;
  location_name?: string | null;
  warehouse_name?: string | null;
  sidemark?: string | null;
  room?: string | null;
  primary_photo_url?: string | null;
  // Additional fields that may be present
  status?: string;
  client_account?: string | null;
  account_id?: string | null;
  warehouse_id?: string | null;
  location_id?: string | null;
  /** True when item has any active indicator flags */
  has_indicator_flags?: boolean;
}

type SortField = 'item_code' | 'quantity' | 'vendor' | 'description' | 'location_code' | 'sidemark' | 'room';
type SortDirection = 'asc' | 'desc' | null;

interface ItemListTableProps {
  items: ItemRow[];
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (id: string) => void;
  onSelectAll?: () => void;
  showPhoto?: boolean;
  sortField?: SortField | null;
  sortDirection?: SortDirection;
  onSort?: (field: SortField) => void;
  actions?: (item: ItemRow) => React.ReactNode;
  emptyMessage?: string;
  className?: string;
}

export function ItemListTable({
  items,
  selectable = false,
  selectedIds = new Set(),
  onSelectionChange,
  onSelectAll,
  showPhoto = true,
  sortField,
  sortDirection,
  onSort,
  actions,
  emptyMessage = 'No items found',
  className,
}: ItemListTableProps) {
  const navigate = useNavigate();

  const handleRowClick = (item: ItemRow) => {
    navigate(`/inventory/${item.id}`);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field || !sortDirection) return null;
    return sortDirection === 'asc' ? (
      <MaterialIcon name="expand_less" className="text-[12px]" />
    ) : (
      <MaterialIcon name="expand_more" className="text-[12px]" />
    );
  };

  const SortableHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => {
    if (!onSort) {
      return <>{children}</>;
    }
    return (
      <div
        className="flex items-center gap-1 cursor-pointer hover:text-foreground"
        onClick={() => onSort(field)}
      >
        {children}
        <SortIcon field={field} />
      </div>
    );
  };

  if (items.length === 0) {
    return (
      <div className="text-center py-12">
        <MaterialIcon name="inventory_2" className="mx-auto text-[48px] text-muted-foreground" />
        <h3 className="mt-4 text-lg font-semibold">No items</h3>
        <p className="text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={cn('overflow-x-auto rounded-md border', className)}>
      <Table>
        <TableHeader>
          <TableRow>
            {selectable && (
              <TableHead className="w-10">
                <Checkbox
                  checked={selectedIds.size === items.length && items.length > 0}
                  onCheckedChange={onSelectAll}
                  className="h-3.5 w-3.5"
                />
              </TableHead>
            )}
            {showPhoto && <TableHead className="w-12">Photo</TableHead>}
            <TableHead className={cn(onSort && 'cursor-pointer hover:bg-muted/50')}>
              <SortableHeader field="item_code">Item Code</SortableHeader>
            </TableHead>
            <TableHead className={cn('text-right', onSort && 'cursor-pointer hover:bg-muted/50')}>
              <SortableHeader field="quantity">Qty</SortableHeader>
            </TableHead>
            <TableHead className={cn(onSort && 'cursor-pointer hover:bg-muted/50')}>
              <SortableHeader field="vendor">Vendor</SortableHeader>
            </TableHead>
            <TableHead className={cn(onSort && 'cursor-pointer hover:bg-muted/50')}>
              <SortableHeader field="description">Description</SortableHeader>
            </TableHead>
            <TableHead className={cn(onSort && 'cursor-pointer hover:bg-muted/50')}>
              <SortableHeader field="location_code">Location</SortableHeader>
            </TableHead>
            <TableHead className={cn(onSort && 'cursor-pointer hover:bg-muted/50')}>
              <SortableHeader field="sidemark">Sidemark</SortableHeader>
            </TableHead>
            <TableHead className={cn(onSort && 'cursor-pointer hover:bg-muted/50')}>
              <SortableHeader field="room">Room</SortableHeader>
            </TableHead>
            {actions && <TableHead className="w-10"></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow
              key={item.id}
              className={cn(
                'cursor-pointer hover:bg-muted/50',
                selectedIds.has(item.id) && 'bg-muted/30'
              )}
              onClick={() => handleRowClick(item)}
            >
              {selectable && (
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selectedIds.has(item.id)}
                    onCheckedChange={() => onSelectionChange?.(item.id)}
                    className="h-3.5 w-3.5"
                  />
                </TableCell>
              )}
              {showPhoto && (
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <ItemPreviewCard itemId={item.id}>
                    {item.primary_photo_url ? (
                      <img
                        src={item.primary_photo_url}
                        alt={item.item_code}
                        className="h-8 w-8 rounded object-cover cursor-pointer"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded bg-muted flex items-center justify-center">
                        <MaterialIcon name="inventory_2" size="sm" className="text-muted-foreground" />
                      </div>
                    )}
                  </ItemPreviewCard>
                </TableCell>
              )}
              <TableCell className="font-medium" onClick={(e) => e.stopPropagation()}>
                <ItemPreviewCard itemId={item.id}>
                  <span
                    className="text-primary hover:underline cursor-pointer inline-flex items-center gap-1"
                    onClick={() => navigate(`/inventory/${item.id}`)}
                  >
                    {item.has_indicator_flags && <span title="Has indicator flags">{'\u26A0\uFE0F'}</span>}
                    {item.item_code}
                  </span>
                </ItemPreviewCard>
              </TableCell>
              <TableCell className="text-right">{item.quantity ?? '-'}</TableCell>
              <TableCell>{item.vendor || '-'}</TableCell>
              <TableCell className="line-clamp-1 max-w-[200px]">
                {item.description || '-'}
              </TableCell>
              <TableCell>
                {item.location_code ? (
                  <span className="text-sm">
                    {item.location_code}
                    {item.warehouse_name && (
                      <span className="text-muted-foreground ml-1">({item.warehouse_name})</span>
                    )}
                  </span>
                ) : (
                  '-'
                )}
              </TableCell>
              <TableCell>{item.sidemark || '-'}</TableCell>
              <TableCell>{item.room || '-'}</TableCell>
              {actions && (
                <TableCell onClick={(e) => e.stopPropagation()}>{actions(item)}</TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
