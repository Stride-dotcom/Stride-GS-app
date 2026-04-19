import type { CalendarEvent } from '../../hooks/useCalendarEvents';
import { EVENT_COLORS } from './CalendarEventPill';

interface Props {
  event: CalendarEvent;
  x: number;
  y: number;
}

function fmt(label: string, value: string | number | undefined | null) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', minWidth: 70 }}>{label}</span>
      <span style={{ color: '#fff', fontSize: 12 }}>{value}</span>
    </div>
  );
}

export function CalendarTooltip({ event, x, y }: Props) {
  const c = EVENT_COLORS[event.type];
  // Clamp position to viewport
  const maxX = typeof window !== 'undefined' ? window.innerWidth - 300 : x;
  const maxY = typeof window !== 'undefined' ? window.innerHeight - 240 : y;
  const left = Math.min(x, maxX);
  const top = Math.min(y, maxY);

  return (
    <div
      style={{
        position: 'fixed',
        left,
        top,
        background: '#1C1C1C',
        color: '#fff',
        padding: '14px 16px',
        borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        fontFamily: "'Inter', -apple-system, sans-serif",
        fontSize: 12,
        zIndex: 10000,
        minWidth: 240,
        maxWidth: 320,
        pointerEvents: 'none',
        border: '1px solid rgba(255,255,255,0.1)',
      }}
    >
      <div style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 100,
        background: c.bg,
        color: c.border,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '2px',
        textTransform: 'uppercase',
        marginBottom: 6,
      }}>
        {c.label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{event.details.title || event.label}</div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{event.client}</div>
      <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '10px 0' }} />
      {fmt('Date', event.date)}
      {fmt('Vendor', event.details.vendor)}
      {fmt('Carrier', event.details.carrier)}
      {fmt('Tracking', event.details.tracking)}
      {fmt('Pieces', event.details.pieces)}
      {fmt('Pickup', event.details.pickupParty)}
      {fmt('Status', event.details.status)}
      {fmt('Repair', event.details.repairVendor)}
      {fmt('Desc', event.details.description)}
      {fmt('Priority', event.details.priority)}
      {fmt('Notes', event.details.notes)}
    </div>
  );
}
