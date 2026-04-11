import { theme } from '../../styles/theme';

interface CardProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  onClick?: () => void;
  padding?: string;
}

export function Card({ children, style, onClick, padding }: CardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        background: theme.colors.bgBase,
        border: `1px solid ${theme.colors.borderDefault}`,
        borderRadius: theme.radii.xl,
        padding: padding ?? theme.spacing['2xl'],
        cursor: onClick ? 'pointer' : undefined,
        transition: onClick ? 'box-shadow 0.15s' : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
