import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface CrossWarehouseBannerProps {
  itemWarehouse: string;
  destWarehouse: string;
  isMixedBatch?: boolean;
}

export function CrossWarehouseBanner({
  itemWarehouse,
  destWarehouse,
  isMixedBatch,
}: CrossWarehouseBannerProps) {
  const message = isMixedBatch
    ? 'Batch contains items from multiple warehouses. Verify destination warehouse before moving.'
    : `Item is in ${itemWarehouse}, but destination is ${destWarehouse}. Move is allowed, but verify this is intended.`;

  return (
    <div className="w-full max-w-md mt-3 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 flex items-center gap-2">
      <MaterialIcon name="swap_horiz" size="sm" className="flex-shrink-0" />
      <div>
        <span className="font-medium">Warehouse mismatch</span>
        <span className="mx-1">&mdash;</span>
        {message}
      </div>
    </div>
  );
}
