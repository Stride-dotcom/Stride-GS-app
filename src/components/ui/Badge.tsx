import { theme } from '../../styles/theme';
import type { InventoryStatus, TaskStatus, RepairStatus, WillCallStatus } from '../../lib/types';

type BadgeVariant = 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'purple' | 'orange';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
}

const variantStyles: Record<BadgeVariant, { color: string; background: string }> = {
  green: { color: theme.colors.statusGreen, background: theme.colors.statusGreenBg },
  amber: { color: theme.colors.statusAmber, background: theme.colors.statusAmberBg },
  red: { color: theme.colors.statusRed, background: theme.colors.statusRedBg },
  blue: { color: theme.colors.statusBlue, background: theme.colors.statusBlueBg },
  gray: { color: theme.colors.statusGray, background: theme.colors.statusGrayBg },
  purple: { color: theme.colors.statusPurple, background: theme.colors.statusPurpleBg },
  orange: { color: theme.colors.primary, background: theme.colors.primaryLight },
};

export function Badge({ children, variant = 'gray', size = 'sm' }: BadgeProps) {
  const styles = variantStyles[variant];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: size === 'sm' ? '2px 7px' : '3px 10px',
        borderRadius: theme.radii.full,
        fontSize: size === 'sm' ? theme.typography.sizes.xs : theme.typography.sizes.sm,
        fontWeight: theme.typography.weights.medium,
        color: styles.color,
        background: styles.background,
        lineHeight: 1.5,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export function InventoryStatusBadge({ status }: { status: InventoryStatus }) {
  const map: Record<InventoryStatus, BadgeVariant> = {
    Active: 'green',
    Released: 'blue',
    'On Hold': 'amber',
    Transferred: 'purple',
  };
  return <Badge variant={map[status]}>{status}</Badge>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const map: Record<TaskStatus, BadgeVariant> = {
    Open: 'orange',
    'In Progress': 'amber',
    Completed: 'green',
    Cancelled: 'gray',
  };
  return <Badge variant={map[status]}>{status}</Badge>;
}

export function RepairStatusBadge({ status }: { status: RepairStatus }) {
  const map: Record<RepairStatus, BadgeVariant> = {
    'Pending Quote': 'amber',
    'Quote Sent': 'blue',
    Approved: 'green',
    Declined: 'red',
    'In Progress': 'purple',
    Complete: 'green',
    Cancelled: 'gray',
  };
  return <Badge variant={map[status]}>{status}</Badge>;
}

export function WillCallStatusBadge({ status }: { status: WillCallStatus }) {
  const map: Record<WillCallStatus, BadgeVariant> = {
    Pending: 'amber',
    Scheduled: 'blue',
    Released: 'green',
    Partial: 'orange',
    Cancelled: 'gray',
  };
  return <Badge variant={map[status]}>{status}</Badge>;
}
