import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from '@/lib/utils';
import { useShipmentExceptions } from '@/hooks/useShipmentExceptions';
import { supabase } from '@/integrations/supabase/client';

interface ShipmentExceptionBadgeProps {
  shipmentId: string;
  count?: number;
  onClick?: () => void;
  className?: string;
}

export function ShipmentExceptionBadge({
  shipmentId,
  count,
  onClick,
  className,
}: ShipmentExceptionBadgeProps) {
  const { openCount } = useShipmentExceptions(count === undefined ? shipmentId : undefined);
  const [itemFlagCount, setItemFlagCount] = useState(0);

  useEffect(() => {
    if (count !== undefined || !shipmentId) return;

    let cancelled = false;

    const loadFlagCount = async () => {
      const { data, error } = await (supabase.from('shipment_items') as any)
        .select('flags')
        .eq('shipment_id', shipmentId);

      if (cancelled || error || !Array.isArray(data)) return;

      const total = data.reduce((sum: number, row: { flags?: unknown[] | null }) => {
        if (!Array.isArray(row.flags)) return sum;
        return sum + row.flags.filter((flag) => typeof flag === 'string').length;
      }, 0);

      setItemFlagCount(total);
    };

    loadFlagCount();
    return () => {
      cancelled = true;
    };
  }, [count, shipmentId]);

  const value = count ?? (openCount + itemFlagCount);

  if (value <= 0) return null;

  if (onClick) {
    return (
      <Button
        variant="outline"
        size="sm"
        className={cn('h-6 px-2 text-xs gap-1 text-amber-700 border-amber-300', className)}
        onClick={onClick}
      >
        <MaterialIcon name="warning" size="sm" />
        {value}
      </Button>
    );
  }

  return (
    <Badge
      variant="outline"
      className={cn('h-6 px-2 text-xs gap-1 text-amber-700 border-amber-300', className)}
    >
      <MaterialIcon name="warning" size="sm" />
      {value}
    </Badge>
  );
}
