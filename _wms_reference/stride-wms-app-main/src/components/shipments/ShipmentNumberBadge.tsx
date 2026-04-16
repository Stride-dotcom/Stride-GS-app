import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from '@/lib/utils';

interface ShipmentNumberBadgeProps {
  shipmentNumber: string;
  exceptionType?: string | null;
  className?: string;
}

export function ShipmentNumberBadge({ shipmentNumber, exceptionType, className }: ShipmentNumberBadgeProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-sm font-medium truncate", className)}>
      <span className="truncate">{shipmentNumber}</span>
      {exceptionType && (
        <MaterialIcon
          name="warning"
          size="sm"
          className="text-orange-500 flex-shrink-0"
          title={`Exception: ${exceptionType.replace(/_/g, ' ')}`}
        />
      )}
    </span>
  );
}
