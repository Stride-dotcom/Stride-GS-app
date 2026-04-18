import { X } from 'lucide-react';
import { theme } from '../../styles/theme';

interface DetailPanelProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
}

export function DetailPanel({ title, subtitle, onClose, children, width = '380px' }: DetailPanelProps) {
  return (
    <div
      style={{
        width,
        minWidth: width,
        height: '100%',
        background: theme.colors.bgBase,
        borderLeft: `1px solid ${theme.colors.borderDefault}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: `${theme.spacing.lg} ${theme.spacing['2xl']}`,
          borderBottom: `1px solid ${theme.colors.borderDefault}`,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '12px',
          flexShrink: 0,
        }}
      >
        <div>
          <div
            style={{
              fontSize: theme.typography.sizes.md,
              fontWeight: theme.typography.weights.semibold,
              color: theme.colors.textPrimary,
              fontFamily: theme.typography.fontFamily,
            }}
          >
            {title}
          </div>
          {subtitle && (
            <div
              style={{
                fontSize: theme.typography.sizes.sm,
                color: theme.colors.textSecondary,
                fontFamily: theme.typography.fontFamily,
                marginTop: '2px',
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            width: '24px',
            height: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: theme.colors.textMuted,
            borderRadius: theme.radii.sm,
            flexShrink: 0,
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: theme.spacing['2xl'] }}>
        {children}
      </div>
    </div>
  );
}

export function DetailField({ label, value }: { label: string; value?: React.ReactNode }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom: '14px' }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 500,
          color: '#E8692A',
          textTransform: 'uppercase',
          letterSpacing: '2px',
          marginBottom: 6,
          fontFamily: theme.typography.fontFamily,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: theme.typography.sizes.sm,
          color: theme.colors.textPrimary,
          fontFamily: theme.typography.fontFamily,
        }}
      >
        {value}
      </div>
    </div>
  );
}
