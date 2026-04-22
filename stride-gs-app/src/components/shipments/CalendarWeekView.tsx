import { useMemo, useState } from 'react';
import type { CalendarEvent } from '../../hooks/useCalendarEvents';
import { CalendarEventPill } from './CalendarEventPill';
import { CalendarTooltip } from './CalendarTooltip';

function isCompleted(ev: CalendarEvent): boolean {
  const s = ev.details.status;
  if (!s) return false;
  if (ev.type === 'task' || ev.type === 'repair') return s === 'Completed';
  if (ev.type === 'willcall') return s === 'Released';
  return false;
}

interface Props {
  weekStart: Date; // Monday (session 73 — week now starts Monday)
  events: CalendarEvent[];
  onEventClick?: (event: CalendarEvent) => void;
}

function toDateKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarWeekView({ weekStart, events, onEventClick }: Props) {
  const [hover, setHover] = useState<{ event: CalendarEvent; x: number; y: number } | null>(null);

  const days = useMemo(() => {
    const result: Date[] = [];
    for (let i = 0; i < 7; i++) {
      result.push(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i));
    }
    return result;
  }, [weekStart]);

  const eventsByDate = useMemo(() => {
    const m: Record<string, CalendarEvent[]> = {};
    for (const e of events) {
      if (!m[e.date]) m[e.date] = [];
      m[e.date].push(e);
    }
    return m;
  }, [events]);

  const todayKey = toDateKey(new Date());

  return (
    <div style={{ background: '#fff', borderRadius: 20, padding: 20, border: '1px solid rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {days.map((d, idx) => {
          const key = toDateKey(d);
          const isToday = key === todayKey;
          const dayEvents = eventsByDate[key] || [];

          return (
            <div key={idx} style={{
              background: isToday ? 'rgba(232,105,42,0.08)' : '#FBFAF7',
              borderRadius: 10,
              padding: 10,
              border: isToday ? '2px solid #E8692A' : '1px solid rgba(0,0,0,0.04)',
              minHeight: 360,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 600, letterSpacing: '2px',
                textTransform: 'uppercase', color: isToday ? '#E8692A' : '#999',
              }}>
                {DOW[d.getDay()]}
              </div>
              <div style={{
                fontSize: 22, fontWeight: isToday ? 700 : 400,
                color: isToday ? '#E8692A' : '#1C1C1C',
                marginBottom: 8,
              }}>
                {d.getDate()}
              </div>
              {dayEvents.length === 0 && (
                <div style={{ fontSize: 11, color: '#BBB', fontStyle: 'italic', padding: '6px 4px' }}>No events</div>
              )}
              {dayEvents.map(ev => (
                <CalendarEventPill
                  key={ev.id}
                  type={ev.type}
                  label={ev.label}
                  pending={ev.pending}
                  completed={isCompleted(ev)}
                  onMouseEnter={(e) => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setHover({ event: ev, x: rect.right + 8, y: rect.top });
                  }}
                  onMouseLeave={() => setHover(null)}
                  onClick={onEventClick ? () => { setHover(null); onEventClick(ev); } : undefined}
                />
              ))}
            </div>
          );
        })}
      </div>

      {hover && <CalendarTooltip event={hover.event} x={hover.x} y={hover.y} />}
    </div>
  );
}
