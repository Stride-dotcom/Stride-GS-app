import { theme } from '../../styles/theme';

interface FloatingActionBarProps {
  selectedCount: number;
  actions: Array<{
    label: string;
    onClick: () => void;
    variant?: 'default' | 'danger';
  }>;
  onClear: () => void;
}

export function FloatingActionBar({ selectedCount, actions, onClear }: FloatingActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: theme.colors.textPrimary,
        borderRadius: theme.radii['2xl'],
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        boxShadow: theme.shadows.xl,
        zIndex: 100,
        animation: 'slideUp 0.2s ease',
      }}
    >
      <span
        style={{
          fontSize: theme.typography.sizes.sm,
          color: 'rgba(255,255,255,0.7)',
          fontFamily: theme.typography.fontFamily,
          paddingRight: '8px',
          borderRight: '1px solid rgba(255,255,255,0.15)',
        }}
      >
        {selectedCount} selected
      </span>
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={action.onClick}
          style={{
            padding: '5px 12px',
            borderRadius: theme.radii.md,
            border: 'none',
            cursor: 'pointer',
            fontSize: theme.typography.sizes.sm,
            fontWeight: theme.typography.weights.medium,
            fontFamily: theme.typography.fontFamily,
            background:
              action.variant === 'danger'
                ? 'rgba(239, 68, 68, 0.2)'
                : 'rgba(255, 255, 255, 0.12)',
            color: action.variant === 'danger' ? '#FCA5A5' : '#FFFFFF',
            transition: 'background 0.15s',
          }}
        >
          {action.label}
        </button>
      ))}
      <button
        onClick={onClear}
        style={{
          padding: '5px 10px',
          borderRadius: theme.radii.md,
          border: 'none',
          cursor: 'pointer',
          fontSize: theme.typography.sizes.sm,
          fontFamily: theme.typography.fontFamily,
          background: 'transparent',
          color: 'rgba(255,255,255,0.5)',
        }}
      >
        ✕
      </button>
    </div>
  );
}
