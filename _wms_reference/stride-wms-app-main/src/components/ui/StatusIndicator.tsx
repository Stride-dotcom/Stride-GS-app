import { cn } from '@/lib/utils';

const statusStyles = {
  // Common lifecycle states (used by containers and other resources)
  archived: {
    bg: 'bg-red-500/10 dark:bg-red-400/15',
    text: 'text-red-700 dark:text-red-400',
    dot: 'bg-red-500',
  },
  pending: {
    bg: 'bg-yellow-500/10 dark:bg-yellow-400/15',
    text: 'text-yellow-700 dark:text-yellow-400',
    dot: 'bg-yellow-500',
  },
  in_progress: {
    bg: 'bg-blue-500/10 dark:bg-blue-400/15',
    text: 'text-blue-700 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  completed: {
    bg: 'bg-green-500/10 dark:bg-green-400/15',
    text: 'text-green-700 dark:text-green-400',
    dot: 'bg-green-500',
  },
  failed: {
    bg: 'bg-red-500/10 dark:bg-red-400/15',
    text: 'text-red-700 dark:text-red-400',
    dot: 'bg-red-500',
  },
  cancelled: {
    bg: 'bg-gray-500/10 dark:bg-gray-400/15',
    text: 'text-gray-600 dark:text-gray-400',
    dot: 'bg-gray-500',
  },
  normal: {
    bg: 'bg-green-500/10 dark:bg-green-400/15',
    text: 'text-green-700 dark:text-green-400',
    dot: 'bg-green-500',
  },
  damaged: {
    bg: 'bg-red-500/10 dark:bg-red-400/15',
    text: 'text-red-700 dark:text-red-400',
    dot: 'bg-red-500',
  },
  attention: {
    bg: 'bg-orange-500/10 dark:bg-orange-400/15',
    text: 'text-orange-700 dark:text-orange-400',
    dot: 'bg-orange-500',
  },
  pass: {
    bg: 'bg-green-500/10 dark:bg-green-400/15',
    text: 'text-green-700 dark:text-green-400',
    dot: 'bg-green-500',
  },
  fail: {
    bg: 'bg-red-500/10 dark:bg-red-400/15',
    text: 'text-red-700 dark:text-red-400',
    dot: 'bg-red-500',
  },
  draft: {
    bg: 'bg-gray-500/10 dark:bg-gray-400/15',
    text: 'text-gray-600 dark:text-gray-400',
    dot: 'bg-gray-500',
  },
  sent: {
    bg: 'bg-blue-500/10 dark:bg-blue-400/15',
    text: 'text-blue-700 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  paid: {
    bg: 'bg-green-500/10 dark:bg-green-400/15',
    text: 'text-green-700 dark:text-green-400',
    dot: 'bg-green-500',
  },
  overdue: {
    bg: 'bg-red-500/10 dark:bg-red-400/15',
    text: 'text-red-700 dark:text-red-400',
    dot: 'bg-red-500',
  },
  open: {
    bg: 'bg-blue-500/10 dark:bg-blue-400/15',
    text: 'text-blue-700 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  under_review: {
    bg: 'bg-yellow-500/10 dark:bg-yellow-400/15',
    text: 'text-yellow-700 dark:text-yellow-400',
    dot: 'bg-yellow-500',
  },
  pending_review: {
    bg: 'bg-yellow-500/10 dark:bg-yellow-400/15',
    text: 'text-yellow-700 dark:text-yellow-400',
    dot: 'bg-yellow-500',
  },
  waiting_split: {
    bg: 'bg-amber-500/10 dark:bg-amber-400/15',
    text: 'text-amber-700 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  resolved: {
    bg: 'bg-green-500/10 dark:bg-green-400/15',
    text: 'text-green-700 dark:text-green-400',
    dot: 'bg-green-500',
  },
  accepted: {
    bg: 'bg-green-500/10 dark:bg-green-400/15',
    text: 'text-green-700 dark:text-green-400',
    dot: 'bg-green-500',
  },
  expected: {
    bg: 'bg-blue-500/10 dark:bg-blue-400/15',
    text: 'text-blue-700 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  receiving: {
    bg: 'bg-orange-500/10 dark:bg-orange-400/15',
    text: 'text-orange-700 dark:text-orange-400',
    dot: 'bg-orange-500',
  },
  received: {
    bg: 'bg-green-500/10 dark:bg-green-400/15',
    text: 'text-green-700 dark:text-green-400',
    dot: 'bg-green-500',
  },
  released: {
    bg: 'bg-green-500/10 dark:bg-green-400/15',
    text: 'text-green-700 dark:text-green-400',
    dot: 'bg-green-500',
  },
  shipped: {
    bg: 'bg-blue-500/10 dark:bg-blue-400/15',
    text: 'text-blue-700 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  partial: {
    bg: 'bg-orange-500/10 dark:bg-orange-400/15',
    text: 'text-orange-700 dark:text-orange-400',
    dot: 'bg-orange-500',
  },
  expired: {
    bg: 'bg-gray-500/10 dark:bg-gray-400/15',
    text: 'text-gray-600 dark:text-gray-400',
    dot: 'bg-gray-500',
  },
  declined: {
    bg: 'bg-red-500/10 dark:bg-red-400/15',
    text: 'text-red-700 dark:text-red-400',
    dot: 'bg-red-500',
  },
  active: {
    bg: 'bg-green-500/10 dark:bg-green-400/15',
    text: 'text-green-700 dark:text-green-400',
    dot: 'bg-green-500',
  },
  inactive: {
    bg: 'bg-gray-500/10 dark:bg-gray-400/15',
    text: 'text-gray-600 dark:text-gray-400',
    dot: 'bg-gray-500',
  },
  suspended: {
    bg: 'bg-red-500/10 dark:bg-red-400/15',
    text: 'text-red-700 dark:text-red-400',
    dot: 'bg-red-500',
  },
  maintenance: {
    bg: 'bg-amber-500/10 dark:bg-amber-400/15',
    text: 'text-amber-700 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  full: {
    bg: 'bg-amber-500/10 dark:bg-amber-400/15',
    text: 'text-amber-700 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  initiated: {
    bg: 'bg-blue-500/10 dark:bg-blue-400/15',
    text: 'text-blue-700 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  pending_approval: {
    bg: 'bg-orange-500/10 dark:bg-orange-400/15',
    text: 'text-orange-700 dark:text-orange-400',
    dot: 'bg-orange-500',
  },
  pending_acceptance: {
    bg: 'bg-purple-500/10 dark:bg-purple-400/15',
    text: 'text-purple-700 dark:text-purple-400',
    dot: 'bg-purple-500',
  },
  credited: {
    bg: 'bg-emerald-500/10 dark:bg-emerald-400/15',
    text: 'text-emerald-700 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  closed: {
    bg: 'bg-gray-500/10 dark:bg-gray-400/15',
    text: 'text-gray-600 dark:text-gray-400',
    dot: 'bg-gray-500',
  },
  denied: {
    bg: 'bg-red-500/10 dark:bg-red-400/15',
    text: 'text-red-700 dark:text-red-400',
    dot: 'bg-red-500',
  },
  approved: {
    bg: 'bg-green-500/10 dark:bg-green-400/15',
    text: 'text-green-700 dark:text-green-400',
    dot: 'bg-green-500',
  },
  unable_to_complete: {
    bg: 'bg-red-500/10 dark:bg-red-400/15',
    text: 'text-red-700 dark:text-red-400',
    dot: 'bg-red-500',
  },
  void: {
    bg: 'bg-red-500/10 dark:bg-red-400/15',
    text: 'text-red-700 dark:text-red-400',
    dot: 'bg-red-500',
  },
  running: {
    bg: 'bg-blue-500/10 dark:bg-blue-400/15',
    text: 'text-blue-700 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  skip: {
    bg: 'bg-yellow-500/10 dark:bg-yellow-400/15',
    text: 'text-yellow-700 dark:text-yellow-400',
    dot: 'bg-yellow-500',
  },
  error: {
    bg: 'bg-red-500/10 dark:bg-red-400/15',
    text: 'text-red-700 dark:text-red-400',
    dot: 'bg-red-500',
  },
  sent_to_client: {
    bg: 'bg-blue-500/10 dark:bg-blue-400/15',
    text: 'text-blue-700 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  in_transit: {
    bg: 'bg-blue-500/10 dark:bg-blue-400/15',
    text: 'text-blue-700 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  delivered: {
    bg: 'bg-green-500/10 dark:bg-green-400/15',
    text: 'text-green-700 dark:text-green-400',
    dot: 'bg-green-500',
  },
  on_track: {
    bg: 'bg-green-500/10 dark:bg-green-400/15',
    text: 'text-green-700 dark:text-green-400',
    dot: 'bg-green-500',
  },
  due_soon: {
    bg: 'bg-yellow-500/10 dark:bg-yellow-400/15',
    text: 'text-yellow-700 dark:text-yellow-400',
    dot: 'bg-yellow-500',
  },
  paused: {
    bg: 'bg-gray-500/10 dark:bg-gray-400/15',
    text: 'text-gray-600 dark:text-gray-400',
    dot: 'bg-gray-500',
  },
  scanned: {
    bg: 'bg-green-500/10 dark:bg-green-400/15',
    text: 'text-green-700 dark:text-green-400',
    dot: 'bg-green-500',
  },
  inbound: {
    bg: 'bg-blue-500/10 dark:bg-blue-400/15',
    text: 'text-blue-700 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  incoming: {
    bg: 'bg-blue-500/10 dark:bg-blue-400/15',
    text: 'text-blue-700 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  outbound: {
    bg: 'bg-purple-500/10 dark:bg-purple-400/15',
    text: 'text-purple-700 dark:text-purple-400',
    dot: 'bg-purple-500',
  },
  outgoing: {
    bg: 'bg-purple-500/10 dark:bg-purple-400/15',
    text: 'text-purple-700 dark:text-purple-400',
    dot: 'bg-purple-500',
  },
  unbilled: {
    bg: 'bg-amber-500/10 dark:bg-amber-400/15',
    text: 'text-amber-700 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  invoiced: {
    bg: 'bg-green-500/10 dark:bg-green-400/15',
    text: 'text-green-700 dark:text-green-400',
    dot: 'bg-green-500',
  },
  invited: {
    bg: 'bg-blue-500/10 dark:bg-blue-400/15',
    text: 'text-blue-700 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  awaiting_assignment: {
    bg: 'bg-yellow-500/10 dark:bg-yellow-400/15',
    text: 'text-yellow-700 dark:text-yellow-400',
    dot: 'bg-yellow-500',
  },
  sent_to_tech: {
    bg: 'bg-blue-500/10 dark:bg-blue-400/15',
    text: 'text-blue-700 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  tech_declined: {
    bg: 'bg-red-500/10 dark:bg-red-400/15',
    text: 'text-red-700 dark:text-red-400',
    dot: 'bg-red-500',
  },
  tech_submitted: {
    bg: 'bg-orange-500/10 dark:bg-orange-400/15',
    text: 'text-orange-700 dark:text-orange-400',
    dot: 'bg-orange-500',
  },
  default: {
    bg: 'bg-gray-500/10 dark:bg-gray-400/15',
    text: 'text-gray-600 dark:text-gray-400',
    dot: 'bg-gray-500',
  },
} as const;

interface StatusIndicatorProps {
  status: string;
  label?: string;
  showDot?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export function StatusIndicator({
  status,
  label,
  showDot = true,
  size = 'md',
  className,
}: StatusIndicatorProps) {
  const normalizedStatus = status
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '') as keyof typeof statusStyles;

  const style = statusStyles[normalizedStatus] || statusStyles.default;

  const displayLabel =
    label ||
    status
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-semibold',
        style.bg,
        style.text,
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        className
      )}
    >
      {showDot && (
        <span
          className={cn(
            'rounded-full flex-shrink-0',
            style.dot,
            size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2'
          )}
        />
      )}
      {displayLabel}
    </span>
  );
}
