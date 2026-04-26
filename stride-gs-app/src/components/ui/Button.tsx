import { theme } from '../../styles/theme';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: React.ReactNode;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  /** When true, button shows a spinner, swaps label to loadingText (if set), and is disabled. */
  loading?: boolean;
  /** Optional text shown next to spinner while loading. Defaults to "Working…". */
  loadingText?: string;
}

// Inline keyframes — injected once on first import. Avoids a separate stylesheet.
const SPINNER_KEYFRAMES_ID = 'stride-btn-spinner-kf';
if (typeof document !== 'undefined' && !document.getElementById(SPINNER_KEYFRAMES_ID)) {
  const style = document.createElement('style');
  style.id = SPINNER_KEYFRAMES_ID;
  style.textContent = `
@keyframes stride-btn-spin { to { transform: rotate(360deg); } }
@keyframes stride-btn-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }
`;
  document.head.appendChild(style);
}

function Spinner({ size, color }: { size: number; color: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        border: `2px solid ${color}`,
        borderTopColor: 'transparent',
        animation: 'stride-btn-spin 0.7s linear infinite',
        flexShrink: 0,
      }}
    />
  );
}

export function Button({
  variant = 'secondary',
  size = 'md',
  children,
  icon,
  iconPosition = 'left',
  loading = false,
  loadingText,
  disabled,
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
    transition: 'background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s',
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

  const isDisabled = disabled || loading;
  const spinnerColor = variant === 'primary' ? '#FFFFFF' : theme.colors.primary;
  const spinnerSize = size === 'sm' ? 12 : size === 'lg' ? 16 : 14;

  const disabledStyle: React.CSSProperties = isDisabled
    ? {
        cursor: loading ? 'progress' : 'not-allowed',
        opacity: loading ? 1 : 0.55,
        ...(loading
          ? {
              animation: 'stride-btn-pulse 1.6s ease-in-out infinite',
            }
          : {}),
      }
    : {};

  return (
    <button
      type={props.type ?? 'button'}
      aria-busy={loading || undefined}
      disabled={isDisabled}
      style={{
        ...base,
        ...sizeStyles[size],
        ...variantStyles[variant],
        ...disabledStyle,
        ...style,
      }}
      {...props}
    >
      {loading ? (
        <>
          <Spinner size={spinnerSize} color={spinnerColor} />
          <span>{loadingText ?? 'Working…'}</span>
        </>
      ) : (
        <>
          {icon && iconPosition === 'left' && icon}
          {children}
          {icon && iconPosition === 'right' && icon}
        </>
      )}
    </button>
  );
}
