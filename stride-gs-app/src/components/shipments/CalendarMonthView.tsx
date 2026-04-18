import { useMemo, useState } from 'react';
import type { CalendarEvent } from '../../hooks/useCalendarEvents';
import { CalendarEventPill } from './CalendarEventPill';
import { CalendarTooltip } from './CalendarTooltip';

interface Props {
  year: number;
  month: number; // 0-11
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

export function CalendarMonthView({ year, month, events, onEventClick }: Props) {
  const [hover, setHover] = useState<{ event: CalendarEvent; x: number; y: number } | null>(null);
  const [expandDate, setExpandDate] = useState<string | null>(null);

  const grid = useMemo(() => {
    const first = new Date(year, month, 1);
    const startDow = first.getDay();
    const gridStart = new Date(year, month, 1 - startDow);
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) {
      cells.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
    }
    return cells;
  }, [year, month]);

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
      {/* Day-of-week header */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0, marginBottom: 8 }}>
        {DOW.map(d => (
          <div key={d} style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '2px',
            textTransform: 'uppercase', color: '#999', padding: '8px 4px', textAlign: 'center',
          }}>{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: 'minmax(108px, auto)', gap: 4 }}>
        {grid.map((d, idx) => {
          const key = toDateKey(d);
          const isOtherMonth = d.getMonth() !== month;
          const isToday = key === todayKey;
          const dayEvents = eventsByDate[key] || [];
          const MAX = 3;
          const expanded = expandDate === key;
          const visible = expanded ? dayEvents : dayEvents.slice(0, MAX);
          const hidden = dayEvents.length - MAX;

          return (
            <div key={idx} style={{
              background: isToday ? 'rgba(232,105,42,0.08)' : '#FBFAF7',
              borderRadius: 10,
              padding: 6,
              border: isToday ? '2px solid #E8692A' : '1px solid rgba(0,0,0,0.04)',
              minHeight: 108,
              opacity: isOtherMonth ? 0.4 : 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}>
              <div style={{
                fontSize: 12,
                fontWeight: isToday ? 700 : 500,
                color: isToday ? '#E8692A' : '#1C1C1C',
                marginBottom: 4,
                padding: '2px 4px',
              }}>
                {d.getDate()}
              </div>
              {visible.map(ev => (
                <CalendarEventPill
                  key={ev.id}
                  type={ev.type}
                  label={ev.label}
                  compact
                  onMouseEnter={(e) => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setHover({ event: ev, x: rect.right + 8, y: rect.top });
                  }}
                  onMouseLeave={() => setHover(null)}
                  onClick={onEventClick ? () => { setHover(null); onEventClick(ev); } : undefined}
                />
              ))}
              {!expanded && hidden > 0 && (
                <div
                  onClick={() => setExpandDate(key)}
                  style={{ fontSize: 10, color: '#666', cursor: 'pointer', padding: '2px 4px', fontWeight: 600 }}
                >
                  +{hidden} more
                </div>
              )}
              {expanded && (
                <div
                  onClick={() => setExpandDate(null)}
                  style={{ fontSize: 10, color: '#666', cursor: 'pointer', padding: '2px 4px', fontWeight: 600 }}
                >
                  show less
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hover && <CalendarTooltip event={hover.event} x={hover.x} y={hover.y} />}
    </div>
  );
}
