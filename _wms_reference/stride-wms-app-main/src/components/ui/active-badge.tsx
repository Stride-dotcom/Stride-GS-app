import { cn } from '@/lib/utils';

interface ActiveBadgeProps {
  active: boolean;
  className?: string;
}

export function ActiveBadge({ active, className }: ActiveBadgeProps) {
  if (active) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs text-green-600', className)}>
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        Active
      </span>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}>
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
      Inactive
    </span>
  );
}
