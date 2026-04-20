import type { CalendarEventType } from '../../hooks/useCalendarEvents';

export const EVENT_COLORS: Record<CalendarEventType, { bg: string; border: string; text: string; label: string }> = {
  shipment: { bg: 'rgba(232,105,42,0.15)', border: '#E8692A', text: '#B34710', label: 'Shipment' },
  willcall: { bg: 'rgba(74,138,92,0.15)', border: '#4A8A5C', text: '#2F6B42', label: 'Will Call' },
  repair:   { bg: 'rgba(40,130,200,0.15)', border: '#2882C8', text: '#1A5E94', label: 'Repair' },
  task:     { bg: 'rgba(124,58,237,0.12)', border: '#7C3AED', text: '#5B21B6', label: 'Task' },
};

interface Props {
  type: CalendarEventType;
  label: string;
  onMouseEnter?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave?: () => void;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  compact?: boolean;
  /** True when the source row is an optimistic TEMP- entry still waiting
   *  on the GAS/Supabase round-trip. Renders with dashed border + ~60%
   *  opacity + a "syncing" dot so users can tell a pending write from a
   *  confirmed one at a glance. */
  pending?: boolean;
}

export function CalendarEventPill({ type, label, onMouseEnter, onMouseLeave, onClick, compact, pending }: Props) {
  const c = EVENT_COLORS[type];
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      style={{
        background: c.bg,
        borderLeft: pending ? `3px dashed ${c.border}` : `3px solid ${c.border}`,
        color: c.text,
        padding: compact ? '2px 6px' : '4px 8px',
        borderRadius: 4,
        fontSize: compact ? 10 : 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        cursor: 'pointer',
        marginBottom: 2,
        maxWidth: '100%',
        opacity: pending ? 0.6 : 1,
        fontStyle: pending ? 'italic' : 'normal',
      }}
      title={pending ? `${label} (syncing…)` : label}
    >
      {pending && (
        <span
          aria-label="syncing"
          style={{
            display: 'inline-block',
            width: 6, height: 6, borderRadius: '50%',
            background: c.border, marginRight: 5,
            verticalAlign: 'middle',
            animation: 'stridePulse 1.2s ease-in-out infinite',
          }}
        />
      )}
      {label}
    </div>
  );
}
