import { cn } from '@/lib/utils';
import { AlertTriangle, Search, Star, Wrench } from 'lucide-react';

const indicatorConfig = {
  attention: {
    icon: AlertTriangle,
    label: 'Attention',
    chipClass: 'bg-red-500 text-white border-red-600/30 shadow-sm',
  },
  inspection: {
    icon: Search,
    label: 'Inspection',
    chipClass: 'bg-blue-500 text-white border-blue-600/30 shadow-sm',
  },
  primary: {
    icon: Star,
    label: 'Primary',
    chipClass: 'bg-amber-500 text-white border-amber-600/30 shadow-sm',
  },
  repair: {
    icon: Wrench,
    label: 'Repair',
    chipClass: 'bg-purple-500 text-white border-purple-600/30 shadow-sm',
  },
} as const;

interface PhotoIndicatorChipProps {
  type: keyof typeof indicatorConfig;
  className?: string;
  showLabel?: boolean;
}

export function PhotoIndicatorChip({
  type,
  className,
  showLabel = true,
}: PhotoIndicatorChipProps) {
  const config = indicatorConfig[type];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        // Bold, consistent pill styling (matches iOS-style status chips)
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 min-h-6',
        config.chipClass,
        className
      )}
    >
      <Icon className="h-3.5 w-3.5 flex-shrink-0" />
      {showLabel && (
        <span className="text-xs font-semibold whitespace-nowrap">
          {config.label}
        </span>
      )}
    </div>
  );
}
