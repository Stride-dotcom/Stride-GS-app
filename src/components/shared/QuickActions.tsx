import { theme } from '../../styles/theme';

interface QuickAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  variant?: 'default' | 'primary' | 'danger';
}

interface QuickActionsProps {
  actions: QuickAction[];
}

export function QuickActions({ actions }: QuickActionsProps) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={action.onClick}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: theme.radii.md,
            fontSize: theme.typography.sizes.sm,
            fontWeight: theme.typography.weights.medium,
            fontFamily: theme.typography.fontFamily,
            cursor: 'pointer',
            border: `1px solid ${
              action.variant === 'primary'
                ? theme.colors.primary
                : action.variant === 'danger'
                ? theme.colors.statusRed
                : theme.colors.borderDefault
            }`,
            background:
              action.variant === 'primary'
                ? theme.colors.primary
                : action.variant === 'danger'
                ? theme.colors.statusRedBg
                : '#FFFFFF',
            color:
              action.variant === 'primary'
                ? '#FFFFFF'
                : action.variant === 'danger'
                ? theme.colors.statusRed
                : theme.colors.textPrimary,
          }}
        >
          {action.icon}
          {action.label}
        </button>
      ))}
    </div>
  );
}
