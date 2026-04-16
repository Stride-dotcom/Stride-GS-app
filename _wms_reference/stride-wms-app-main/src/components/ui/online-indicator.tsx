import { cn } from '@/lib/utils';

export type PresenceStatus = 'online' | 'away' | 'offline';

interface OnlineIndicatorProps {
  status: PresenceStatus;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showPulse?: boolean;
}

/**
 * A small colored dot indicator for user presence status
 * - Green dot with pulse for online
 * - Yellow dot for away
 * - Gray dot for offline
 */
export function OnlineIndicator({
  status,
  size = 'sm',
  className,
  showPulse = true,
}: OnlineIndicatorProps) {
  const sizeClasses = {
    sm: 'h-2.5 w-2.5',
    md: 'h-3 w-3',
    lg: 'h-4 w-4',
  };

  const statusColors = {
    online: 'bg-green-500',
    away: 'bg-yellow-500',
    offline: 'bg-gray-400 dark:bg-gray-600',
  };

  return (
    <span
      className={cn(
        'relative inline-flex rounded-full',
        sizeClasses[size],
        statusColors[status],
        className
      )}
      title={status.charAt(0).toUpperCase() + status.slice(1)}
    >
      {status === 'online' && showPulse && (
        <span
          className={cn(
            'absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 animate-ping'
          )}
        />
      )}
    </span>
  );
}

interface AvatarWithPresenceProps {
  children: React.ReactNode;
  status: PresenceStatus;
  indicatorSize?: 'sm' | 'md' | 'lg';
  indicatorPosition?: 'bottom-right' | 'top-right';
  className?: string;
}

/**
 * Wrapper component to add a presence indicator to any avatar
 */
export function AvatarWithPresence({
  children,
  status,
  indicatorSize = 'sm',
  indicatorPosition = 'bottom-right',
  className,
}: AvatarWithPresenceProps) {
  const positionClasses = {
    'bottom-right': 'bottom-0 right-0',
    'top-right': 'top-0 right-0',
  };

  return (
    <div className={cn('relative inline-block', className)}>
      {children}
      <OnlineIndicator
        status={status}
        size={indicatorSize}
        className={cn(
          'absolute ring-2 ring-background',
          positionClasses[indicatorPosition]
        )}
      />
    </div>
  );
}
