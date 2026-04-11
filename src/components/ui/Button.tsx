import { theme } from '../../styles/theme';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: React.ReactNode;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
}

export function Button({
  variant = 'secondary',
  size = 'md',
  children,
  icon,
  iconPosition = 'left',
  style,
  ...props
}: ButtonProps) {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    fontFamily: theme.typography.fontFamily,
    fontWeight: theme.typography.weights.medium,
    borderRadius: theme.radii.md,
    border: '1px solid transparent',
    cursor: 'pointer',
    transition: 'background 0.15s, border-color 0.15s, color 0.15s',
    lineHeight: 1,
    whiteSpace: 'nowrap',
  };

  const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
    sm: { padding: '5px 10px', fontSize: theme.typography.sizes.sm },
    md: { padding: '7px 14px', fontSize: theme.typography.sizes.base },
    lg: { padding: '9px 18px', fontSize: theme.typography.sizes.md },
  };

  const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
    primary: {
      background: theme.colors.primary,
      color: '#FFFFFF',
      borderColor: theme.colors.primary,
    },
    secondary: {
      background: '#FFFFFF',
      color: theme.colors.textPrimary,
      borderColor: theme.colors.borderDefault,
    },
    ghost: {
      background: 'transparent',
      color: theme.colors.textSecondary,
      borderColor: 'transparent',
    },
    danger: {
      background: theme.colors.statusRedBg,
      color: theme.colors.statusRed,
      borderColor: theme.colors.statusRed,
    },
  };

  return (
    <button
      style={{ ...base, ...sizeStyles[size], ...variantStyles[variant], ...style }}
      {...props}
    >
      {icon && iconPosition === 'left' && icon}
      {children}
      {icon && iconPosition === 'right' && icon}
    </button>
  );
}
