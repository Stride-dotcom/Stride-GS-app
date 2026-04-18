import type { CalendarEventType } from '../../hooks/useCalendarEvents';

export const EVENT_COLORS: Record<CalendarEventType, { bg: string; border: string; text: string; label: string }> = {
  shipment: { bg: 'rgba(232,105,42,0.15)', border: '#E8692A', text: '#B34710', label: 'Shipment' },
  willcall: { bg: 'rgba(74,138,92,0.15)', border: '#4A8A5C', text: '#2F6B42', label: 'Will Call' },
  repair:   { bg: 'rgba(40,130,200,0.15)', border: '#2882C8', text: '#1A5E94', label: 'Repair' },
};

interface Props {
  type: CalendarEventType;
  label: string;
  onMouseEnter?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave?: () => void;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  compact?: boolean;
}

export function CalendarEventPill({ type, label, onMouseEnter, onMouseLeave, onClick, compact }: Props) {
  const c = EVENT_COLORS[type];
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      style={{
        background: c.bg,
        borderLeft: `3px solid ${c.border}`,
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
      }}
      title={label}
    >
      {label}
    </div>
  );
}
